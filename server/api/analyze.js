const { ServerStockfishEngine } = require('./_lib/stockfish-engine');
const { loadAnalyzer, loadChess } = require('./_lib/analysis-loader');
const {
  incrementPublicStats,
} = require('./_lib/firebase-stats');
const { requireQuota } = require('./_lib/user-service');

const SERVER_REVIEW_PROFILE = {
  depth: 14,
  multiPv: 1,
  timeoutMs: 4500,
};
const SERVER_POSITION_BATCH_LIMIT = 8;
const SERVER_ACTIVE_ANALYSIS_LIMIT = 5;

const cachedEngines = new Map();
const cachedEngineInits = new Map();
let engineChain = Promise.resolve();
let activeAnalysisJobs = 0;
const analysisQueue = [];
const evalCache = new Map();
const EVAL_CACHE_LIMIT = 800;

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
      const key = `eval|${depth}|${fen}`;
      const cached = cacheGet(key);
      if (cached) return cached;
      const result = await engine.evaluate(fen, depth, timeoutMs);
      cacheSet(key, result);
      return result;
    },
    evaluateMultiPV: async (fen, depth, numPV, timeoutMs) => {
      const key = `multipv|${depth}|${numPV}|${fen}`;
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

async function getServerEngine(preferFull = false) {
  const key = preferFull ? 'full' : 'lite';
  const cachedEngine = cachedEngines.get(key);
  if (cachedEngine?.ready) return cachedEngine;
  if (!cachedEngineInits.has(key)) {
    const engine = new ServerStockfishEngine({ preferFull });
    cachedEngines.set(key, engine);
    cachedEngineInits.set(key, engine.init().catch((err) => {
      try {
        engine?.destroy();
      } catch (_destroyErr) {
        // Ignore teardown failures after a failed init.
      }
      cachedEngines.delete(key);
      cachedEngineInits.delete(key);
      throw err;
    }));
  }
  await cachedEngineInits.get(key);
  return cachedEngines.get(key);
}

function resetServerEngine(preferFull = false) {
  const key = preferFull ? 'full' : 'lite';
  try {
    cachedEngines.get(key)?.destroy();
  } catch (_destroyErr) {
    // Ignore teardown while recovering.
  }
  cachedEngines.delete(key);
  cachedEngineInits.delete(key);
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
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Use POST.' });
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
    if (moves.length > 500) {
      return retryable('Server review is capped at 500 plies. Use the streaming endpoint for full games.');
    }
    if (positions.length > 500) {
      return retryable('Server review is capped at 500 positions per request.');
    }

      const Chess = loadChess();
        const { MoveAnalyzer } = loadAnalyzer();
	      const analyzer = new MoveAnalyzer();
	      const profile = payload.profile || {};
      const preferFullServer = quotaState.plan?.plan === 'boost' && profile.serverEngine === 'full';
      analyzer.setReviewProfile({
        depth: 14,
        multiPv: Math.max(1, Math.min(Number(profile.multiPv) || SERVER_REVIEW_PROFILE.multiPv, 2)),
        timeoutMs: Math.max(1200, Math.min(Number(profile.timeoutMs) || SERVER_REVIEW_PROFILE.timeoutMs, SERVER_REVIEW_PROFILE.timeoutMs)),
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
        const engine = await withTimeout(
	          getServerEngine(preferFullServer),
          8000,
          'Server engine is still warming up.'
        );
        const reviewEngine = cachedEngineAdapter(engine);
      if (positions.length > 0) {
        const evals = await withEngineQueue(() => analyzer.evaluatePositions(positions, reviewEngine, null));
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
      const results = await withEngineQueue(() => analyzer.analyzeGame(moves, reviewEngine, null, { initialFen, headers: payload.headers || {} }));
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
        openingDrift: results.openingDrift,
        trainingQueue: results.trainingQueue,
        patternStats: results.patternStats,
        reviewNarrative: results.reviewNarrative,
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
      resetServerEngine(false);
      resetServerEngine(true);
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
      analyzer.setReviewProfile({
        depth: 14,
        multiPv: Math.max(1, Math.min(Number(profile.multiPv) || SERVER_REVIEW_PROFILE.multiPv, 2)),
        timeoutMs: Math.max(1200, Math.min(Number(profile.timeoutMs) || SERVER_REVIEW_PROFILE.timeoutMs, SERVER_REVIEW_PROFILE.timeoutMs)),
      });

      const initialFen = payload.initialFen || payload.headers?.FEN || undefined;
      if (initialFen) {
        const validation = new Chess();
        if (!validation.load(initialFen)) throw new Error('Invalid initial FEN.');
      }

      const engine = await withTimeout(getServerEngine(preferFullServer), 8000, 'Server engine is still warming up.');
      const reviewEngine = cachedEngineAdapter(engine);
      const positions = analyzer._positionsForMoves(moves, initialFen);
      if (moves.length > 50) {
        analyzer._mateThreat = () => null;
      }
      const evals = await withEngineQueue(() => analyzer.evaluatePositions(
        positions,
        reviewEngine,
        (index, total) => {
          if (res.destroyed) return;
          sseWrite(res, 'progress', {
            completed: index + 1,
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
      resetServerEngine(false);
      resetServerEngine(true);
    }
	    sseWrite(res, 'error', { error: err.message || 'Server analysis failed.' });
  } finally {
    res.end();
  }
};

exports.analysisQueueStatus = analysisQueueStatus;
