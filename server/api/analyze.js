const { getServerEngine, resetServerEngine } = require('./_lib/stockfish-engine');
const { loadAnalyzer, loadChess } = require('./_lib/analysis-loader');
const {
  incrementPublicStats,
} = require('./_lib/firebase-stats');
const { requireQuota } = require('./_lib/user-service');
const crypto = require('crypto');

const SERVER_POSITION_BATCH_LIMIT = 12;
const SERVER_ACTIVE_ANALYSIS_LIMIT = 5;

// Auto-detect CPU cores and set thread count for the engine.
// Limits to 4 threads max to avoid overloading serverless instances.
function _detectThreadCount() {
  const os = require('os');
  const cores = Math.max(1, os.cpus?.length || 1);
  return Math.min(cores, 4);
}

// Default review profiles tuned for speed while maintaining quality.
// Depth 14 is the speed/quality sweet spot for non-boost reviews: at fixed
// depth lite-single reaches depth 14 in ~0.6s/position (vs ~1.3s at 16),
// roughly halving review wall-clock while leaving move classifications
// essentially unchanged. Boost "strong" reviews use SERVER_STRONG below.
const _threads = _detectThreadCount();
const SERVER_REVIEW_PROFILE = {
  depth: 14,
  multiPv: 3,
  timeoutMs: 5000,
  threads: _threads,
};
const SERVER_STRONG_REVIEW_PROFILE = {
  depth: 18,
  multiPv: 3,
  timeoutMs: 8000,
  threads: _threads,
};

let engineChain = Promise.resolve();
let activeAnalysisJobs = 0;
const analysisQueue = [];
const evalCache = new Map();
const EVAL_CACHE_LIMIT = 2000;

// Hash FEN to avoid long cache keys (FEN can be 80+ chars)
function hashFen(fen) {
  return crypto.createHash('sha256').update(fen).digest('hex').slice(0, 16);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function cacheGet(key) {
  if (!evalCache.has(key)) return null;
  const value = evalCache.get(key);
  evalCache.delete(key);
  evalCache.set(key, value);
  return cloneJson(value);
}

function cacheSet(key, value) {
  evalCache.set(key, cloneJson(value));
  while (evalCache.size > EVAL_CACHE_LIMIT) {
    evalCache.delete(evalCache.keys().next().value);
  }
}

function cachedEngineAdapter(engine) {
  return {
    get ready() {
      return engine.ready;
    },
    newGame: () => engine.newGame(),
    evaluate: async (fen, depth, timeoutMs) => {
      const key = `eval|${depth}|${hashFen(fen)}`;
      const cached = cacheGet(key);
      if (cached) return cached;
      const result = await engine.evaluate(fen, depth, timeoutMs);
      cacheSet(key, result);
      return result;
    },
    evaluateMultiPV: async (fen, depth, numPV, timeoutMs) => {
      const key = `multipv|${depth}|${numPV}|${hashFen(fen)}`;
      const cached = cacheGet(key);
      if (cached) return cached;
      const result = await engine.evaluateMultiPV(fen, depth, numPV, timeoutMs);
      cacheSet(key, result);
      return result;
    },
  };
}

function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// The engine is a single shared, process-wide instance owned by
// stockfish-engine.js (the `stockfish` npm package is a hard singleton: a
// second initEngine() call throws "INIT_ENGINE(...) is not a function" and
// crashes the process via an uncaught WASM LinkError). Adapters expose the
// ready/newGame/evaluate/evaluateMultiPV surface MoveAnalyzer expects;
// evaluatePositionsPooled fans out across the single-element list.
async function getEngineAdapters(_preferFull = false) {
  const single = await withTimeout(getServerEngine(), 8000, 'Server engine is still warming up.');
  return [cachedEngineAdapter(single)];
}

function withEngineQueue(work) {
  const run = engineChain.then(work, work);
  engineChain = run.catch(() => {});
  return run;
}

function drainAnalysisQueue() {
  while (activeAnalysisJobs < SERVER_ACTIVE_ANALYSIS_LIMIT && analysisQueue.length) {
    const next = analysisQueue.shift();
    activeAnalysisJobs += 1;
    next.resolve();
  }
}

function analysisQueueStatus() {
  return {
    active: activeAnalysisJobs,
    queued: analysisQueue.length,
    limit: SERVER_ACTIVE_ANALYSIS_LIMIT,
  };
}

function withAnalysisSlot(work, onQueued = null) {
  const queuedIndex = analysisQueue.length + 1;
  const enter = activeAnalysisJobs < SERVER_ACTIVE_ANALYSIS_LIMIT
    ? Promise.resolve().then(() => {
        activeAnalysisJobs += 1;
      })
    : new Promise((resolve) => {
        analysisQueue.push({ resolve });
        if (onQueued) onQueued({ ...analysisQueueStatus(), queuedPosition: queuedIndex });
      });

  return enter
    .then(() => work(analysisQueueStatus()))
    .finally(() => {
      activeAnalysisJobs = Math.max(0, activeAnalysisJobs - 1);
      drainAnalysisQueue();
    });
}

function analyzedMoveCountForPositions(start, count) {
  const first = Math.max(0, Math.floor(Number(start) || 0));
  const length = Math.max(0, Math.floor(Number(count) || 0));
  if (!length) return 0;
  const last = first + length - 1;
  return Math.max(0, last - Math.max(first, 1) + 1);
}

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  },
  body: JSON.stringify(body),
});

function retryable(message) {
  return json(200, { error: message, retryable: true });
}

exports.handler = async (event, context = {}) => {
  context.callbackWaitsForEmptyEventLoop = false;
  if (event.httpMethod === 'OPTIONS') {
    return json(200, {});
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Use POST.' });
  }

  // Validate the request body BEFORE claiming quota. A malformed/empty payload
  // should 400 without burning the user's daily review slot — otherwise a few
  // bad requests (or an attacker with a stolen token) can lock a free user out
  // for the day.
  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (_err) {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const moves = Array.isArray(payload.moves) ? payload.moves : [];
  const positions = Array.isArray(payload.positions) ? payload.positions : [];
  if (moves.length === 0 && positions.length === 0) {
    return json(400, { error: 'No moves were provided.' });
  }
  if (moves.length > 500) {
    return retryable('Server review is capped at 500 plies.');
  }
  if (positions.length > 500) {
    return retryable('Server review is capped at 500 positions per request.');
  }

  let quotaState = null;
  try {
    quotaState = await requireQuota(event, 'serverReviews');
  } catch (err) {
    return json(err.statusCode || 500, {
      error: err.message || 'Server review quota check failed.',
      code: err.code,
      quota: err.quota,
      plan: err.plan,
    });
  }

      const Chess = loadChess();
        const { MoveAnalyzer } = loadAnalyzer();
	      const analyzer = new MoveAnalyzer();
	      const profile = payload.profile || {};
      const preferFullServer = quotaState.plan?.plan === 'boost' && profile.serverEngine === 'full';
      const isStrong = preferFullServer && profile.strength === 'strong';
      const baseProfile = isStrong ? SERVER_STRONG_REVIEW_PROFILE : SERVER_REVIEW_PROFILE;
      analyzer.setReviewProfile({
        depth: Math.max(baseProfile.depth, Math.min(Number(profile.depth) || baseProfile.depth, isStrong ? 20 : 18)),
        multiPv: Math.max(1, Math.min(Number(profile.multiPv) || baseProfile.multiPv, isStrong ? 4 : 3)),
        timeoutMs: Math.max(2000, Math.min(Number(profile.timeoutMs) || baseProfile.timeoutMs, baseProfile.timeoutMs)),
      });

  const initialFen = payload.initialFen || payload.headers?.FEN || undefined;
  if (initialFen) {
    const validation = new Chess();
    if (!validation.load(initialFen)) {
      return json(400, { error: 'Invalid initial FEN.' });
    }
  }

    try {
      return await withAnalysisSlot(async () => {
        const engines = await getEngineAdapters(preferFullServer);
        const reviewEngine = engines[0];
      if (positions.length > 0) {
        const evals = await withEngineQueue(() => analyzer.evaluatePositionsPooled(positions, engines, null));
        let publicStats = null;
        try {
          const movesAnalyzed = analyzedMoveCountForPositions(payload.chunkStart, evals.length);
          if (movesAnalyzed) publicStats = await incrementPublicStats({ movesAnalyzed });
        } catch (err) {
          console.warn('Could not update server move stats:', err.message);
        }
        return json(200, {
          evals,
          depth: analyzer.analysisDepth,
          multiPv: analyzer.multiPvCount,
           source: 'server',
          quota: quotaState.quota,
          plan: quotaState.plan,
          publicStats,
        });
      }

      if (moves.length > 50) {
        analyzer._mateThreat = () => null;
      }
      const results = await withEngineQueue(() => analyzer.analyzeGame(moves, reviewEngine, null, { initialFen, headers: payload.headers || {}, engines }));
      let publicStats = null;
      try {
        publicStats = await incrementPublicStats({ movesAnalyzed: moves.length });
      } catch (err) {
        console.warn('Could not update public stats:', err.message);
      }
    const plainResults = results.map((entry) => ({
      ...entry,
      classification: undefined,
      classificationKey: entry.classificationKey,
    }));
    const criticalMoments = (results.criticalMoments || []).map((entry) => ({
      ...entry,
      classification: undefined,
      classificationKey: entry.classificationKey,
    }));

    return json(200, {
        results: plainResults,
        opening: results.opening,
        criticalMoments,
      whiteAccuracy: results.whiteAccuracy,
      blackAccuracy: results.blackAccuracy,
      whiteAcpl: results.whiteAcpl,
      blackAcpl: results.blackAcpl,
      whiteCaps: results.whiteCaps,
      blackCaps: results.blackCaps,
      phaseSummary: results.phaseSummary,
      depth: analyzer.analysisDepth,
      multiPv: analyzer.multiPvCount,
       source: 'server',
      quota: quotaState.quota,
      plan: quotaState.plan,
      publicStats,
    });
      });
  } catch (err) {
    console.error('Server analysis failed:', err);
    if (/cancelled|not ready|timed out waiting|out of memory|abort/i.test(String(err?.message || err))) {
      // Non-destructive: clears the hash (UCI newGame) on the shared engine.
      // We never destroy/recreate it — that would initEngine() a second time
      // and crash the process.
      resetServerEngine();
    }
    return retryable(err.message || 'Server analysis failed.');
  }
};

function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data || {})}\n\n`);
}

exports.streamHandler = async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  let quotaState = null;
  try {
    quotaState = await requireQuota({
      httpMethod: req.method,
      headers: req.headers || {},
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
    }, 'serverReviews');
  } catch (err) {
    sseWrite(res, 'error', {
      error: err.message || 'Server review quota check failed.',
      code: err.code,
      quota: err.quota,
      plan: err.plan,
    });
    res.end();
    return;
  }

  let payload = {};
  try {
    payload = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch (_err) {
    sseWrite(res, 'error', { error: 'Invalid JSON body.' });
    res.end();
    return;
  }

  const moves = Array.isArray(payload.moves) ? payload.moves : [];
  if (!moves.length) {
    sseWrite(res, 'error', { error: 'No moves were provided.' });
    res.end();
    return;
  }
  if (moves.length > 500) {
    sseWrite(res, 'error', { error: 'Server review is capped at 500 plies.' });
    res.end();
    return;
  }

  try {
    await withAnalysisSlot(async (slotStatus) => {
      sseWrite(res, 'status', { message: 'started', queue: slotStatus });
      const Chess = loadChess();
      const { MoveAnalyzer } = loadAnalyzer();
	      const analyzer = new MoveAnalyzer();
	      const profile = payload.profile || {};
      const preferFullServer = quotaState.plan?.plan === 'boost' && profile.serverEngine === 'full';
      const isStrong = preferFullServer && profile.strength === 'strong';
      const baseSseProfile = isStrong ? SERVER_STRONG_REVIEW_PROFILE : SERVER_REVIEW_PROFILE;
      analyzer.setReviewProfile({
        depth: baseSseProfile.depth,
        multiPv: Math.max(1, Math.min(Number(profile.multiPv) || baseSseProfile.multiPv, baseSseProfile.multiPv)),
        timeoutMs: Math.max(2000, Math.min(Number(profile.timeoutMs) || baseSseProfile.timeoutMs, baseSseProfile.timeoutMs)),
      });

      const initialFen = payload.initialFen || payload.headers?.FEN || undefined;
      if (initialFen) {
        const validation = new Chess();
        if (!validation.load(initialFen)) throw new Error('Invalid initial FEN.');
      }

      const engines = await getEngineAdapters(preferFullServer);
      const positions = analyzer._positionsForMoves(moves, initialFen);
      if (moves.length > 50) {
        analyzer._mateThreat = () => null;
      }
      const evals = await withEngineQueue(() => analyzer.evaluatePositionsPooled(
        positions,
        engines,
        (completed, total) => {
          if (res.destroyed) return;
          sseWrite(res, 'progress', {
            completed,
            total,
          });
        },
      ));

      const results = await analyzer.resultsFromEvals(
        moves,
        positions,
        evals,
        analyzer.detectOpening(moves),
        { initialFen, headers: payload.headers || {}, skipMateThreat: true }
      );

      let publicStats = null;
      try {
        publicStats = await incrementPublicStats({ movesAnalyzed: moves.length });
      } catch (err) {
        console.warn('Could not update public stats:', err.message);
      }

      const plainResults = results.map((entry) => ({
        ...entry,
        classification: undefined,
        classificationKey: entry.classificationKey,
      }));
      sseWrite(res, 'complete', {
        results: plainResults,
        opening: results.opening,
        openingDrift: results.openingDrift,
        trainingQueue: results.trainingQueue,
        patternStats: results.patternStats,
        reviewNarrative: results.reviewNarrative,
        criticalMoments: (results.criticalMoments || []).map((entry) => ({
          ...entry,
          classification: undefined,
          classificationKey: entry.classificationKey,
        })),
        whiteAccuracy: results.whiteAccuracy,
        blackAccuracy: results.blackAccuracy,
        whiteAcpl: results.whiteAcpl,
        blackAcpl: results.blackAcpl,
        whiteCaps: results.whiteCaps,
        blackCaps: results.blackCaps,
	        phaseSummary: results.phaseSummary,
	        depth: analyzer.analysisDepth,
	        multiPv: analyzer.multiPvCount,
	        source: 'server-stream',
        quota: quotaState.quota,
        plan: quotaState.plan,
	        publicStats,
	      });
    }, (queue) => {
      sseWrite(res, 'queued', queue);
    });
	  } catch (err) {
	    console.error('Server stream analysis failed:', err);
    if (/cancelled|not ready|timed out waiting|out of memory|abort/i.test(String(err?.message || err))) {
      // Non-destructive: clears the hash (UCI newGame) on the shared engine.
      // We never destroy/recreate it — that would initEngine() a second time
      // and crash the process.
      resetServerEngine();
    }
	    sseWrite(res, 'error', { error: err.message || 'Server analysis failed.' });
  } finally {
    res.end();
  }
};

exports.analysisQueueStatus = analysisQueueStatus;
