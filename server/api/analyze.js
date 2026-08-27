const { getServerEngine, resetServerEngine } = require('./_lib/stockfish-engine');
const { loadAnalyzer, loadChess } = require('./_lib/analysis-loader');
const {
  incrementPublicStats,
} = require('./_lib/firebase-stats');
const { requireQuota, isPaidOrAbove } = require('./_lib/user-service');
const { acquireHeavyAction, releaseHeavyAction, getBusyAction } = require('./_lib/action-lock');
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

// Server review profiles — two-pass analysis.
//
// Pass 1 (Quick-scan): every position is evaluated at a moderate depth with a
//   tight movetime ceiling. This catches big blunders and eval swings fast.
// Pass 2 (Deep re-analysis): only positions flagged as critical moments are
//   re-evaluated at a higher depth with a generous movetime ceiling. One gnarly
//   tactical position can't stall the whole queue.
//
// Normal review: quick-scan depth 12 / movetime 300ms, mid depth 14 / movetime 2000ms,
//   deep depth 16 / movetime 4000ms. Critical moments get a mid-depth pass; the most
//   severe ("really big") moments get an extra deepest pass.
// Strong review:  quick-scan depth 16 / movetime 500ms, deep depth 22 / movetime 8000ms
const _threads = _detectThreadCount();
const SERVER_FAST_PROFILE = {
  mode: 'depth+movetime', depth: 10, movetimeMs: 200, multiPv: 2, timeoutMs: 3000,
};
const SERVER_REVIEW_PROFILE = {
  quickScan: { mode: 'depth+movetime', depth: 12, movetimeMs: 300, multiPv: 3, timeoutMs: 5000 },
  mid:       { mode: 'depth+movetime', depth: 14, movetimeMs: 2000, multiPv: 3, timeoutMs: 6000 },
  deep:      { mode: 'depth+movetime', depth: 16, movetimeMs: 4000, multiPv: 3, timeoutMs: 10000 },
  threads: _threads,
};
const SERVER_STRONG_REVIEW_PROFILE = {
  quickScan: { mode: 'depth+movetime', depth: 16, movetimeMs: 500, multiPv: 3, timeoutMs: 6000 },
  deep:      { mode: 'depth+movetime', depth: 22, movetimeMs: 8000, multiPv: 3, timeoutMs: 15000 },
  threads: _threads,
};

// Critical moments whose severity is at or above this threshold are treated as
// "really big moves" and get the deepest re-analysis pass (depth 16) in normal
// review. Lower-severity critical moments only get the mid-depth pass (14).
const REALLY_BIG_SEVERITY = 1.0;

// Build a review profile object from a profile spec + user multiPv override.
function _reviewProfile(spec, profile) {
  return {
    mode: spec.mode,
    movetimeMs: spec.movetimeMs,
    depth: spec.depth,
    multiPv: Math.max(1, Math.min(Number(profile.multiPv) || spec.multiPv, spec.multiPv)),
    timeoutMs: spec.timeoutMs,
  };
}

// Re-analyze critical moments after the quick-scan pass.
//
// Normal review uses a three-tier ladder: every critical moment gets a mid-depth
// pass (14), and the most severe "really big" moments (severityScore >=
// REALLY_BIG_SEVERITY) get an extra deepest pass (16). Strong review keeps its
// single deep pass (22) on all critical moments.
//
// Returns the patched evals array aligned with `quickResults` (non-critical
// entries carry over the quick-scan eval).
async function _deepenCriticalMoments({ analyzer, engines, moves, initialFen, quickResults, baseProfile, profile, onProgress }) {
  const positions = analyzer._positionsForMoves(moves, initialFen);
  const criticalIndices = [];
  for (let i = 0; i < quickResults.length; i++) {
    if (quickResults[i].isCriticalMoment) criticalIndices.push(i);
  }
  if (criticalIndices.length === 0) return null;

  const patchedEvals = [...quickResults.map((r) => ({
    cp: r.evalBefore,
    bestMove: r.bestMove,
    pv: r.bestMovePv,
    pvSan: r.bestMovePvSan,
    depth: r.depth,
    lines: (r.alternatives || []).map((alt) => ({
      cp: alt.eval,
      move: alt.moveUci,
      pvUci: alt.pvUci || '',
      pvSan: alt.pvSan || '',
      depth: r.depth,
    })),
  }))];

  // Map a pooled (completed, total) count to the game move index of the
  // furthest critical moment being analyzed. Critical FENs are pulled in game
  // order, so the `completed`-th critical moment is the furthest one underway.
  const gameIndexFor = (indices, completed) => {
    const k = Math.min(Math.max(0, completed), indices.length - 1);
    return indices[k];
  };

  // Mid-depth pass (14) on every critical moment.
  if (baseProfile.mid) {
    analyzer.setReviewProfile(_reviewProfile(baseProfile.mid, profile));
    const midFens = criticalIndices.map((idx) => positions[idx]);
    const midEvals = await withEngineQueue(() => analyzer.evaluatePositionsPooled(
      midFens, engines,
      onProgress
        ? (completed, total) => onProgress(completed, total, 'mid', gameIndexFor(criticalIndices, completed), moves.length)
        : null,
    ));
    for (let k = 0; k < criticalIndices.length; k++) patchedEvals[criticalIndices[k]] = midEvals[k];
  }

  // Deepest pass. For normal review (which has a mid pass), only the "really
  // big" critical moments (severityScore >= REALLY_BIG_SEVERITY) get it. For
  // strong review (no mid pass), every critical moment gets the deep pass.
  const deepTargets = baseProfile.mid
    ? criticalIndices.filter((idx) => (quickResults[idx].severityScore || 0) >= REALLY_BIG_SEVERITY)
    : criticalIndices;
  if (deepTargets.length > 0 && baseProfile.deep) {
    analyzer.setReviewProfile(_reviewProfile(baseProfile.deep, profile));
    const deepFens = deepTargets.map((idx) => positions[idx]);
    const deepEvals = await withEngineQueue(() => analyzer.evaluatePositionsPooled(
      deepFens,
      engines,
      onProgress
        ? (completed, total) => onProgress(completed, total, 'deep', gameIndexFor(deepTargets, completed), moves.length)
        : null,
    ));
    for (let k = 0; k < deepTargets.length; k++) patchedEvals[deepTargets[k]] = deepEvals[k];
  }

  return patchedEvals;
}

// Progressive-depth single-pass review for NORMAL mode.
//
// Instead of the two-pass "quick-scan all + deepen critical moments" model,
// this analyzes every position exactly once at a depth that grows with how far
// through the game it is:
//   0–50%  of moves → depth 12 (quick pass)
//   50–75% of moves → depth 14 (more advanced)
//   75–100% of moves → depth 16 (highest, for the indicator)
//
// Because each move is analyzed exactly once, the progress bar advances
// linearly 0→100% with no backwards jumps — exactly what the frontend board
// overlay expects.
async function _evaluateProgressiveReview({ analyzer, engines, moves, initialFen, baseProfile, profile, onProgress }) {
  const positions = analyzer._positionsForMoves(moves, initialFen);
  const total = positions.length;
  const results = new Array(total);

  // Tier boundaries by move index (0-based). 0–50% quick, 50–75% mid, 75–100% deep.
  const midStart = Math.floor(total * 0.50);
  const deepStart = Math.floor(total * 0.75);

  const tiers = [
    { name: 'quick', start: 0, end: midStart, spec: baseProfile.quickScan },
    { name: 'mid', start: midStart, end: deepStart, spec: baseProfile.mid },
    { name: 'deep', start: deepStart, end: total, spec: baseProfile.deep },
  ];

  for (const tier of tiers) {
    if (tier.end <= tier.start) continue;
    const tierPositions = positions.slice(tier.start, tier.end);
    analyzer.setReviewProfile(_reviewProfile(tier.spec, profile));
    const tierEvals = await withEngineQueue(() => analyzer.evaluatePositionsPooled(
      tierPositions,
      engines,
      onProgress
        ? (done) => onProgress(tier.start + done, total, tier.name, tier.start + done, total)
        : null,
    ));
    for (let k = 0; k < tierEvals.length; k++) results[tier.start + k] = tierEvals[k];
  }

  return results;
}

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
  // The trailing options arg carries mode/movetimeMs for server review.
  // Cache keys include the resolved mode + budget so depth- and movetime-mode
  // results for the same FEN never collide.
  const optKey = (options) =>
    options && options.mode === 'movetime' ? `|mt|${options.movetimeMs}` : '|dep';
  return {
    get ready() {
      return engine.ready;
    },
    newGame: () => engine.newGame(),
    evaluate: async (fen, depth, timeoutMs, options) => {
      const key = `eval|${depth}|${hashFen(fen)}${optKey(options)}`;
      const cached = cacheGet(key);
      if (cached) return cached;
      const result = await engine.evaluate(fen, depth, timeoutMs, options);
      cacheSet(key, result);
      return result;
    },
    evaluateMultiPV: async (fen, depth, numPV, timeoutMs, options) => {
      const key = `multipv|${depth}|${numPV}|${hashFen(fen)}${optKey(options)}`;
      const cached = cacheGet(key);
      if (cached) return cached;
      const result = await engine.evaluateMultiPV(fen, depth, numPV, timeoutMs, options);
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

  const uid = quotaState?.user?.uid || null;
  if (!acquireHeavyAction(uid, 'review')) {
    const busy = getBusyAction(uid);
    return json(429, {
      error: busy === 'coach'
        ? 'You already have a coach chat running. Please wait for it to finish before starting a review.'
        : 'You already have a review running. Please wait for it to finish.',
      code: 'heavy_action_busy',
    });
  }

      const Chess = loadChess();
        const { MoveAnalyzer } = loadAnalyzer();
	      const analyzer = new MoveAnalyzer();
	      const profile = payload.profile || {};
      const preferFullServer = isPaidOrAbove(quotaState.plan?.plan, 'boost') && profile.serverEngine === 'full';
      const isFast = profile.strength === 'fast';
      const isStrong = preferFullServer && profile.strength === 'strong';
      const baseProfile = isFast ? SERVER_FAST_PROFILE : (isStrong ? SERVER_STRONG_REVIEW_PROFILE : SERVER_REVIEW_PROFILE);

  const initialFen = payload.initialFen || payload.headers?.FEN || undefined;
  if (initialFen) {
    const validation = new Chess();
    if (!validation.load(initialFen)) {
      releaseHeavyAction(uid);
      return json(400, { error: 'Invalid initial FEN.' });
    }
  }

    try {
      return await withAnalysisSlot(async () => {
        const engines = await getEngineAdapters(preferFullServer);
        const reviewEngine = engines[0];
      if (positions.length > 0) {
        // Raw position evaluation (no game context) — single pass only.
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

      // ── Server review ──────────────────────────────────────────────
      let results;
      if (isFast) {
        // Fast mode: single pass at low depth, no re-analysis.
        analyzer.setReviewProfile({
          mode: baseProfile.mode,
          movetimeMs: baseProfile.movetimeMs,
          depth: baseProfile.depth,
          multiPv: Math.max(1, Math.min(Number(profile.multiPv) || baseProfile.multiPv, baseProfile.multiPv)),
          timeoutMs: baseProfile.timeoutMs,
        });
        results = await withEngineQueue(() => analyzer.analyzeGame(moves, reviewEngine, null, { initialFen, headers: payload.headers || {}, engines }));
      } else {
        // Progressive-depth single pass: every move analyzed once at a depth
        // that grows with game progress (0–50% depth 12, 50–75% depth 14,
        // 75–100% depth 16).
        const positions = analyzer._positionsForMoves(moves, initialFen);
        const progressiveEvals = await _evaluateProgressiveReview({
          analyzer,
          engines,
          moves,
          initialFen,
          baseProfile,
          profile,
          onProgress: null,
        });
        results = await analyzer.resultsFromEvals(moves, positions, progressiveEvals, analyzer.detectOpening(moves), {
          initialFen,
          headers: payload.headers || {},
          skipMateThreat: moves.length > 50,
        });
      }
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
    releaseHeavyAction(uid);
    return retryable(err.message || 'Server analysis failed.');
  }
  releaseHeavyAction(uid);
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

  const uid = quotaState?.user?.uid || null;
  if (!acquireHeavyAction(uid, 'review')) {
    const busy = getBusyAction(uid);
    sseWrite(res, 'error', {
      error: busy === 'coach'
        ? 'You already have a coach chat running. Please wait for it to finish before starting a review.'
        : 'You already have a review running. Please wait for it to finish.',
      code: 'heavy_action_busy',
    });
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
      const preferFullServer = isPaidOrAbove(quotaState.plan?.plan, 'boost') && profile.serverEngine === 'full';
      const isFast = profile.strength === 'fast';
      const isStrong = preferFullServer && profile.strength === 'strong';
      const baseSseProfile = isFast ? SERVER_FAST_PROFILE : (isStrong ? SERVER_STRONG_REVIEW_PROFILE : SERVER_REVIEW_PROFILE);

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

      // ── Server review (streaming) ───────────────────────────────────
      let results;
      if (isFast) {
        // Fast mode: single pass at low depth, no re-analysis.
        analyzer.setReviewProfile({
          mode: baseSseProfile.mode,
          movetimeMs: baseSseProfile.movetimeMs,
          depth: baseSseProfile.depth,
          multiPv: Math.max(1, Math.min(Number(profile.multiPv) || baseSseProfile.multiPv, baseSseProfile.multiPv)),
          timeoutMs: baseSseProfile.timeoutMs,
        });
        const evals = await withEngineQueue(() => analyzer.evaluatePositionsPooled(
          positions, engines,
          (completed, total) => {
            if (res.destroyed) return;
            const moveIndex = Math.min(Math.max(0, completed), moves.length - 1);
            sseWrite(res, 'progress', { completed, total, pass: 'quick', moveIndex, totalMoves: moves.length, mode: baseSseProfile.mode });
          },
        ));
        results = await analyzer.resultsFromEvals(moves, positions, evals, analyzer.detectOpening(moves), { initialFen, headers: payload.headers || {}, skipMateThreat: true });
      } else {
        // Progressive-depth single pass: every move analyzed once at a depth
        // that grows with game progress (0–50% depth 12, 50–75% depth 14,
        // 75–100% depth 16). Clean linear 0–100% progress.
        const progressiveEvals = await _evaluateProgressiveReview({
          analyzer,
          engines,
          moves,
          initialFen,
          baseProfile: baseSseProfile,
          profile,
          onProgress: (completed, total, pass, moveIndex, totalMoves) => {
            if (res.destroyed) return;
            sseWrite(res, 'progress', { completed, total, pass, moveIndex, totalMoves, mode: baseSseProfile.mode });
          },
        });
        results = await analyzer.resultsFromEvals(moves, positions, progressiveEvals, analyzer.detectOpening(moves), { initialFen, headers: payload.headers || {}, skipMateThreat: true });
      }

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
    releaseHeavyAction(uid);
    res.end();
  }
};

exports.analysisQueueStatus = analysisQueueStatus;
