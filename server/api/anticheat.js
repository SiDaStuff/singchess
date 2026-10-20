let getServerEngine = null;
let resetServerEngine = null;
let loadAnalyzer = null;
let loadChess = null;
let _moduleLoadError = null;
try {
  const _sf = require('./_lib/stockfish-engine');
  const _al = require('./_lib/analysis-loader');
  getServerEngine = _sf.getServerEngine;
  resetServerEngine = _sf.resetServerEngine;
  loadAnalyzer = _al.loadAnalyzer;
  loadChess = _al.loadChess;
} catch (err) {
  _moduleLoadError = err;
  console.error('Anticheat module load failed:', err && err.message ? err.message : err);
}

// Shared helpers used by the legacy sync handler, the SSE stream handler,
// and the new background-job path (`_runAnticheatJob`). Imported here so the
// background job can write its results to Firebase without duplicating the
// analysis pipeline.
const { requireUser, requireQuota, activePlan, isPaidOrAbove, _pruneStaleDataGlobal, _pushNotification, initAdmin } = require('./_lib/user-service');
const { acquireHeavyAction, releaseHeavyAction, getBusyAction } = require('./_lib/action-lock');

// Per-user background-job concurrency: jobId -> uid. Each job can hold the
// shared engine queue for up to ~1h, so without a cap one Max account could
// stack many jobs and starve every other user's reviews.
const MAX_ANTICHEAT_JOBS_PER_UID = 2;
const _runningAnticheatJobs = new Map();
// Lets long background jobs yield to a foreground game review running on the
// same shared engine, and resume once that review finishes.
const { waitForInteractiveReviewIdle, isInteractiveReviewRunning } = require('./_lib/review-coordination');
const cryptoNode = require('crypto');

const MAX_GAMES = 15;
const MAX_PLIES_PER_GAME = 90;
// Limit total positions evaluated in one request to avoid serverless timeouts.
const TOTAL_POSITIONS_LIMIT = 360;
// Anticheat evaluates up to TOTAL_POSITIONS_LIMIT positions (potentially across
// multiple games) on the shared server engine. Depth 18 gives far stronger
// cheat-detection signal than the old depth 12 (the native engine reaches depth
// 18 reliably in ~3-6s/position), but each run is now a much heavier operation,
// so the per-position + overall timeouts are raised to let depth-20 searches
// actually finish instead of being cut short.
const ANTICHEAT_PROFILE = {
  depth: 20,
  multiPv: 3,
  timeoutMs: 15000,
  modelVersion: 'fairplay-evidence-v2',
};

function perGamePositionLimit(gameCount) {
  return Math.min(MAX_PLIES_PER_GAME, Math.max(18, Math.floor(TOTAL_POSITIONS_LIMIT / Math.max(1, gameCount))));
}
const { fetchCompat } = require('./_lib/fetch-compat');
const crypto = require('crypto');

let activeAnalysisJobs = 0;
const analysisQueue = [];
const SERVER_ACTIVE_ANALYSIS_LIMIT = 5;
const evalCache = new Map();
const EVAL_CACHE_LIMIT = 900;

// Hash FEN to avoid long cache keys
function hashFen(fen) {
  return crypto.createHash('sha256').update(fen).digest('hex').slice(0, 16);
}

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  },
  body: JSON.stringify(body),
});

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

function withEngineQueue(work, onQueued = null) {
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

function splitPgnGames(text) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const games = normalized
    .split(/\n\s*\n(?=\s*\[[A-Za-z0-9_]+\s+")/g)
    .map((game) => game.trim())
    .filter(Boolean);
  return games.length ? games : [normalized];
}

function readHeaders(pgn) {
  const headers = {};
  for (const match of String(pgn || '').matchAll(/^\s*\[([A-Za-z0-9_]+)\s+"([^"]*)"\]\s*$/gm)) {
    headers[match[1]] = match[2];
  }
  return headers;
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function sideForUsername(headers, username) {
  const target = normalizeName(username);
  if (!target) return null;
  if (normalizeName(headers.White) === target) return 'white';
  if (normalizeName(headers.Black) === target) return 'black';
  return null;
}

function resultForSide(headers, side) {
  const result = String(headers.Result || '').trim();
  if (result === '1/2-1/2') return 0.5;
  if (side === 'white') return result === '1-0' ? 1 : 0;
  if (side === 'black') return result === '0-1' ? 1 : 0;
  return 0;
}

function parseClock(raw) {
  const parts = String(raw || '').split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  return parts[0] || null;
}

function parseIncrement(headers) {
  const tc = String(headers.TimeControl || headers.Time || '');
  const match = tc.match(/^\s*\d+\+(\d+)/);
  return match ? Number(match[1]) || 0 : 0;
}

function parseBaseClock(headers) {
  const tc = String(headers.TimeControl || headers.Time || '');
  const match = tc.match(/^\s*(\d+)\+/);
  return match ? Number(match[1]) || null : null;
}

function moveTimesFromPgn(pgn, movesLength, headers) {
  const clocks = [...String(pgn || '').matchAll(/\[%clk\s+([0-9:.]+)\]/g)]
    .map((match) => parseClock(match[1]))
    .filter((value) => Number.isFinite(value));
  if (clocks.length < movesLength) return [];

  const increment = parseIncrement(headers);
  const baseClock = parseBaseClock(headers);
  const lastClock = { white: baseClock, black: baseClock };
  const times = [];
  const remaining = [];

  for (let i = 0; i < movesLength; i += 1) {
    const side = i % 2 === 0 ? 'white' : 'black';
    const current = clocks[i];
    const previous = Number.isFinite(lastClock[side]) ? lastClock[side] : null;
    const spent = previous === null ? null : Math.max(0, previous - current + increment);
    times.push(Number.isFinite(spent) ? spent : null);
    remaining.push(Number.isFinite(current) ? current : null);
    lastClock[side] = current;
  }

  times.remaining = remaining;
  return times;
}

function safeAverage(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function stddev(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 2) return 0;
  const avg = safeAverage(clean);
  const variance = safeAverage(clean.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function percentile(values, p) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const index = Math.max(0, Math.min(clean.length - 1, Math.round((clean.length - 1) * p)));
  return clean[index];
}

function correlation(a, b) {
  const pairs = a.map((value, index) => [value, b[index]])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length < 4) return 0;
  const ax = safeAverage(pairs.map(([x]) => x));
  const ay = safeAverage(pairs.map(([, y]) => y));
  const numerator = pairs.reduce((sum, [x, y]) => sum + ((x - ax) * (y - ay)), 0);
  const dx = Math.sqrt(pairs.reduce((sum, [x]) => sum + ((x - ax) ** 2), 0));
  const dy = Math.sqrt(pairs.reduce((sum, [, y]) => sum + ((y - ay) ** 2), 0));
  return dx && dy ? numerator / (dx * dy) : 0;
}

function playerRating(headers, side) {
  const raw = side === 'white' ? headers.WhiteElo : headers.BlackElo;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function timeControlClass(headers) {
  const seconds = parseBaseClock(headers);
  if (!Number.isFinite(seconds)) return 'unknown';
  if (seconds < 180) return 'bullet';
  if (seconds < 600) return 'blitz';
  if (seconds < 1800) return 'rapid';
  return 'classical';
}

function sideMetrics(results, side, times, headers) {
  const isWhite = side === 'white';
  const allMoves = results.filter((entry) => entry.isWhite === isWhite);
  const bookMoves = allMoves.filter((entry) => entry.classificationKey === 'BOOK');
  const forcedMoves = allMoves.filter((entry) => Array.isArray(entry.alternatives) && entry.alternatives.length <= 1);
  const moves = allMoves.filter((entry) => entry.classificationKey !== 'BOOK'
    && !(Array.isArray(entry.alternatives) && entry.alternatives.length <= 1));
  const strongKeys = new Set(['BRILLIANT', 'GREAT', 'BEST', 'EXCELLENT']);
  const mistakeKeys = new Set(['INACCURACY', 'MISTAKE', 'BLUNDER', 'MISS']);
  const strongMoves = moves.filter((entry) => strongKeys.has(entry.classificationKey) && !entry.opponentJustBlundered);
  const mistakeMoves = moves.filter((entry) => mistakeKeys.has(entry.classificationKey));
  const speed = timeControlClass(headers);
  const fastThreshold = speed === 'bullet' ? 2.5 : speed === 'blitz' ? 5 : speed === 'rapid' ? 9 : 14;
  const timedStrong = strongMoves.filter((entry) => {
    const spent = times[entry.moveIndex];
    const remaining = times.remaining?.[entry.moveIndex];
    const notInTimeTrouble = !Number.isFinite(remaining) || remaining > Math.max(15, (parseBaseClock(headers) || 0) * .05);
    return notInTimeTrouble && Number.isFinite(spent) && spent <= fastThreshold && (entry.cpLoss || 0) <= 8;
  });
  const timedCritical = moves.filter((entry) => {
    const spent = times[entry.moveIndex];
    return Number.isFinite(spent) && spent <= fastThreshold * 1.2 && (entry.isCriticalMoment || Math.abs(entry.swing || 0) >= 120);
  });
  const sideTimes = moves.map((entry) => times[entry.moveIndex]).filter((value) => Number.isFinite(value));
  const accuracy = results.whiteAccuracy !== undefined
    ? (isWhite ? results.whiteAccuracy : results.blackAccuracy)
    : 0;
  const averageCpLoss = isWhite ? results.whiteAcpl : results.blackAcpl;
  const win = resultForSide(headers, side);
  const bestRate = moves.length ? (strongMoves.length / moves.length) * 100 : 0;
  const mistakeRate = moves.length ? (mistakeMoves.length / moves.length) * 100 : 0;
  const fastBestRate = strongMoves.length ? (timedStrong.length / strongMoves.length) * 100 : 0;
  const fastCriticalRate = moves.length ? (timedCritical.length / moves.length) * 100 : 0;
  const avgThink = safeAverage(sideTimes);
  const topThreeMoves = moves.filter((entry) => (entry.alternatives || []).slice(0, 3)
    .some((alternative) => alternative.moveUci === entry.moveUci));
  const exactBestMoves = moves.filter((entry) => entry.moveUci && entry.moveUci === entry.alternatives?.[0]?.moveUci);
  const quietBestMoves = strongMoves.filter((entry) => !/[x+#=]/.test(entry.moveSan || '')
    && Math.abs(entry.swing || 0) < 80);
  const unusualEngineMoves = moves.filter((entry) => {
    const alternatives = entry.alternatives || [];
    const gap = alternatives.length > 1 ? Math.abs((alternatives[0].eval || 0) - (alternatives[1].eval || 0)) : 0;
    return entry.moveUci === alternatives[0]?.moveUci && gap >= 80 && !/[x+#]/.test(entry.moveSan || '');
  });
  const criticalMoves = moves.filter((entry) => entry.isCriticalMoment || Math.abs(entry.swing || 0) >= 120);
  const criticalStrong = criticalMoves.filter((entry) => strongKeys.has(entry.classificationKey));
  const criticalExact = criticalMoves.filter((entry) => entry.moveUci && entry.moveUci === entry.alternatives?.[0]?.moveUci);
  let exactStreak = 0;
  let longestExactStreak = 0;
  for (const entry of moves) {
    if (entry.moveUci && entry.moveUci === entry.alternatives?.[0]?.moveUci) {
      exactStreak += 1;
      longestExactStreak = Math.max(longestExactStreak, exactStreak);
    } else {
      exactStreak = 0;
    }
  }
  const complexities = moves.map((entry) => {
    const alternatives = entry.alternatives || [];
    const gap = alternatives.length > 1 ? Math.abs((alternatives[0].eval || 0) - (alternatives[1].eval || 0)) : 0;
    return Math.min(300, gap) + (entry.isCriticalMoment ? 120 : 0) + Math.min(150, Math.abs(entry.swing || 0));
  });
  const moveThinkTimes = moves.map((entry) => times[entry.moveIndex]);
  const phaseAccuracy = {};
  for (const phase of ['opening', 'middlegame', 'endgame']) {
    const phaseMoves = moves.filter((entry) => String(entry.phase || '').toLowerCase() === phase);
    phaseAccuracy[phase] = phaseMoves.length
      ? safeAverage(phaseMoves.map((entry) => Math.max(0, 100 - Math.min(100, Number(entry.cpLoss) || 0))))
      : null;
  }

  return {
    side,
    player: side === 'white' ? headers.White || 'White' : headers.Black || 'Black',
    moves: moves.length,
    accuracy,
    acpl: averageCpLoss,
    win,
    bestRate,
    mistakeRate,
    fastBestRate,
    fastCriticalRate,
    avgThink,
    timeSamples: sideTimes.length,
    rating: playerRating(headers, side),
    timeControl: timeControlClass(headers),
    bookMovesExcluded: bookMoves.length,
    forcedMovesExcluded: forcedMoves.length,
    topThreeRate: moves.length ? (topThreeMoves.length / moves.length) * 100 : 0,
    exactBestRate: moves.length ? (exactBestMoves.length / moves.length) * 100 : 0,
    longestExactStreak,
    criticalBestRate: criticalMoves.length ? (criticalStrong.length / criticalMoves.length) * 100 : 0,
    criticalExactRate: criticalMoves.length ? (criticalExact.length / criticalMoves.length) * 100 : 0,
    quietBestRate: moves.length ? (quietBestMoves.length / moves.length) * 100 : 0,
    unusualEngineRate: moves.length ? (unusualEngineMoves.length / moves.length) * 100 : 0,
    complexityThinkCorrelation: correlation(complexities, moveThinkTimes),
    medianThink: percentile(sideTimes, 0.5),
    thinkTimeStd: stddev(sideTimes),
    phaseAccuracy,
  };
}

function scoreMetrics(metricsList) {
  const games = metricsList.length;
  const accuracy = safeAverage(metricsList.map((entry) => entry.accuracy));
  const acpl = safeAverage(metricsList.map((entry) => entry.acpl));
  const winRate = games ? safeAverage(metricsList.map((entry) => entry.win)) * 100 : 0;
  const bestRate = safeAverage(metricsList.map((entry) => entry.bestRate));
  const mistakeRate = safeAverage(metricsList.map((entry) => entry.mistakeRate));
  const fastBestRate = safeAverage(metricsList.map((entry) => entry.fastBestRate));
  const fastCriticalRate = safeAverage(metricsList.map((entry) => entry.fastCriticalRate));
  const accuracyStd = stddev(metricsList.map((entry) => entry.accuracy));
  const timeCoverage = safeAverage(metricsList.map((entry) => entry.timeSamples > 0 ? 1 : 0));
  const avgMoves = safeAverage(metricsList.map((entry) => entry.moves));
  const topThreeRate = safeAverage(metricsList.map((entry) => entry.topThreeRate));
  const exactBestRate = safeAverage(metricsList.map((entry) => entry.exactBestRate));
  const longestExactStreak = Math.max(0, ...metricsList.map((entry) => Number(entry.longestExactStreak) || 0));
  const criticalBestRate = safeAverage(metricsList.map((entry) => entry.criticalBestRate));
  const criticalExactRate = safeAverage(metricsList.map((entry) => entry.criticalExactRate));
  const quietBestRate = safeAverage(metricsList.map((entry) => entry.quietBestRate));
  const unusualEngineRate = safeAverage(metricsList.map((entry) => entry.unusualEngineRate));
  const complexityThinkCorrelation = safeAverage(metricsList.map((entry) => entry.complexityThinkCorrelation));
  const rating = safeAverage(metricsList.map((entry) => entry.rating).filter(Number.isFinite));
  const ratingExpectedAccuracy = rating ? Math.max(68, Math.min(91, 68 + ((rating - 800) / 80))) : 82;
  const accuracyAboveRating = accuracy - ratingExpectedAccuracy;
  const recent = metricsList.slice(0, Math.min(3, metricsList.length));
  const baseline = metricsList.slice(Math.min(3, metricsList.length));
  const performanceShift = baseline.length
    ? safeAverage(recent.map((entry) => entry.accuracy)) - safeAverage(baseline.map((entry) => entry.accuracy))
    : 0;

  const signals = [];
  const addSignal = (key, label, points, value, detail) => {
    const applied = Math.max(0, Math.round(points * 10) / 10);
    signals.push({ key, label, points: applied, value, detail });
    return applied;
  };

  let score = 0;
  score += addSignal('rating_accuracy', 'Accuracy above rating expectation', Math.min(24, accuracyAboveRating * 1.45), accuracyAboveRating, `${Math.round(accuracy)}% observed vs ${Math.round(ratingExpectedAccuracy)}% expected`);
  score += addSignal('acpl', 'Low centipawn loss', Math.min(12, (34 - acpl) * 0.42), acpl, `${Math.round(acpl)} ACPL`);
  score += addSignal('exact_engine', 'Exact engine choices', Math.min(22, (exactBestRate - 48) * 0.48), exactBestRate, `${Math.round(exactBestRate)}% exact first choices`);
  score += addSignal('top_three', 'Top-three agreement', Math.min(8, (topThreeRate - 80) * 0.35), topThreeRate, `${Math.round(topThreeRate)}% top-three choices`);
  score += addSignal('critical_exact', 'Exact choices in critical positions', Math.min(12, (criticalExactRate - 50) * .3), criticalExactRate, `${Math.round(criticalExactRate)}% exact in critical positions`);
  score += addSignal('quiet_moves', 'Quiet best moves', Math.min(7, (quietBestRate - 22) * 0.28), quietBestRate, `${Math.round(quietBestRate)}% quiet strong moves`);
  score += addSignal('unusual_moves', 'Distinctive engine choices', Math.min(8, (unusualEngineRate - 5) * 0.5), unusualEngineRate, `${Math.round(unusualEngineRate)}% distinctive engine choices`);
  score += addSignal('fast_strong', 'Fast strong moves', Math.min(10, (fastBestRate - 35) * 0.24) * timeCoverage, fastBestRate, `${Math.round(fastBestRate)}% with clock coverage`);
  score += addSignal('fast_critical', 'Fast critical moves', Math.min(7, (fastCriticalRate - 8) * 0.5) * timeCoverage, fastCriticalRate, `${Math.round(fastCriticalRate)}%`);
  score += addSignal('time_complexity', 'Time use versus complexity', Math.min(7, Math.max(0, -complexityThinkCorrelation) * 11) * timeCoverage, complexityThinkCorrelation, 'Negative values mean harder positions were played faster');
  score += addSignal('exact_streak', 'Consecutive exact engine choices', Math.min(7, Math.max(0, longestExactStreak - 4) * 1.2), longestExactStreak, `${longestExactStreak} in a row`);
  score += addSignal('performance_shift', 'Change from earlier games', Math.min(8, Math.max(0, performanceShift - 4) * 0.6), performanceShift, `${performanceShift >= 0 ? '+' : ''}${performanceShift.toFixed(1)} accuracy points`);
  score += addSignal('results', 'Result pattern', Math.min(3, (winRate - 78) * 0.12), winRate, `${Math.round(winRate)}% score`);
  if (games >= 4 && accuracy >= 88 && accuracyStd <= 5) score += addSignal('consistency', 'Unusually consistent accuracy', 5, accuracyStd, `${accuracyStd.toFixed(1)} standard deviation`);

  const independentSignals = signals.filter((signal) => signal.points >= 4).length;
  if (games < 2 || avgMoves < 10 || independentSignals < 3) score = Math.min(score, 69);
  else if (games < 3) score = Math.min(score, 79);
  score = Math.round(Math.max(0, Math.min(100, score)));
  const riskLevel = score >= 72 ? 'High' : score >= 42 ? 'Watch' : 'Low';
  const headline = riskLevel === 'High'
    ? 'Strong indicators require human review.'
    : riskLevel === 'Watch'
      ? 'Some indicators are unusual.'
      : 'No strong cheating pattern found.';
  const effectiveSamples = Math.max(0, Math.round(avgMoves * games));
  const confidence = effectiveSamples >= 120 && games >= 8 ? 'High' : effectiveSamples >= 45 && games >= 3 ? 'Moderate' : 'Low';
  const margin = Math.round(Math.max(6, 28 / Math.sqrt(Math.max(1, games))));
  const explanation = 'This evidence score uses independent move, timing, rating, and cross-game signals. It is not a probability or proof; a trained reviewer must inspect the games before any action.';
  const phaseAccuracy = Object.fromEntries(['opening', 'middlegame', 'endgame'].map((phase) => [phase,
    safeAverage(metricsList.map((entry) => entry.phaseAccuracy?.[phase]).filter(Number.isFinite))]));

  return {
    score,
    riskLevel,
    headline,
    explanation,
    games,
    winRate,
    accuracy,
    acpl,
    bestRate,
    exactBestRate,
    longestExactStreak,
    mistakeRate,
    fastBestRate,
    fastCriticalRate,
    topThreeRate,
    criticalBestRate,
    criticalExactRate,
    quietBestRate,
    unusualEngineRate,
    complexityThinkCorrelation,
    rating: rating || null,
    ratingExpectedAccuracy,
    accuracyAboveRating,
    performanceShift,
    accuracyStd,
    phaseAccuracy,
    timeControls: [...new Set(metricsList.map((entry) => entry.timeControl).filter(Boolean))],
    excluded: {
      book: metricsList.reduce((sum, entry) => sum + (entry.bookMovesExcluded || 0), 0),
      forced: metricsList.reduce((sum, entry) => sum + (entry.forcedMovesExcluded || 0), 0),
    },
    confidence,
    scoreRange: [Math.max(0, score - margin), Math.min(100, score + margin)],
    effectiveSamples,
    independentSignals,
    modelVersion: ANTICHEAT_PROFILE.modelVersion,
    signals: signals.sort((a, b) => b.points - a.points),
    requiresHumanReview: riskLevel === 'High',
  };
}

function parseGame(pgn, options = {}) {
  const Chess = loadChess();
  const chess = new Chess();
  const normalized = String(pgn || '').replace(/\r\n?/g, '\n').trim();
  if (!chess.load_pgn(normalized, { sloppy: true })) {
    throw new Error('Could not parse one of the PGNs.');
  }
  const moves = chess.history();
  const limit = options.full ? moves.length : Math.min(moves.length, MAX_PLIES_PER_GAME);
  return {
    headers: { ...readHeaders(normalized), ...chess.header() },
    moves: moves.slice(0, limit),
    pgn: normalized,
  };
}

function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data || {})}\n\n`);
}

async function lichessGames(username, limit) {
  const params = new URLSearchParams({
    max: String(limit),
    moves: 'true',
    clocks: 'true',
    opening: 'true',
    finished: 'true',
    sort: 'dateDesc',
  });
  const response = await fetchCompat(`https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params.toString()}`, {
    headers: { Accept: 'application/x-chess-pgn' },
  });
  if (!response.ok) throw new Error(`Lichess responded with ${response.status}`);
  const text = await response.text();
  return splitPgnGames(text);
}

const CHESSCOM_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; SingChess/1.0; +https://lichess.org)',
};

async function chessComGames(username, limit) {
  const archiveResponse = await fetchCompat(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`, {
    headers: CHESSCOM_HEADERS,
  });
  if (!archiveResponse.ok) {
    if (archiveResponse.status === 403) {
      throw new Error('Chess.com blocked this request. Try again later or paste a PGN instead.');
    }
    throw new Error(`Chess.com responded with ${archiveResponse.status}`);
  }
  const archiveData = await archiveResponse.json();
  const archives = Array.isArray(archiveData.archives) ? archiveData.archives.slice().reverse() : [];
  const games = [];

  for (const monthUrl of archives) {
    if (games.length >= Math.max(limit, 20)) break;
    const monthResponse = await fetchCompat(monthUrl, { headers: CHESSCOM_HEADERS });
    if (!monthResponse.ok) continue;
    const monthData = await monthResponse.json();
    for (const game of Array.isArray(monthData.games) ? monthData.games : []) {
      if (game.pgn) games.push(game.pgn);
    }
  }

  return games.slice(0, limit);
}

async function loadPgns(payload) {
  const source = String(payload.source || 'pgn');
  const limit = Math.max(1, Math.min(Number(payload.limit) || 10, MAX_GAMES));
  if (source === 'pgn') return splitPgnGames(payload.pgn).slice(0, limit);
  const username = String(payload.username || '').trim();
  if (!username) throw new Error('Username is required.');
  if (source === 'lichess') return (await lichessGames(username, limit)).slice(0, limit);
  if (source === 'chesscom') return (await chessComGames(username, limit)).slice(0, limit);
  throw new Error('source must be pgn, lichess, or chesscom.');
}

async function analyzeParsedGame(game, analyzer, engine) {
  if (!game.moves.length) throw new Error('A PGN had no moves.');
  const positions = analyzer._positionsForMoves(game.moves, game.headers.FEN || game.headers.Fen || game.headers.fen);
  const evals = await analyzer.evaluatePositions(positions, engine, null, { newGame: false });
  const results = await analyzer.resultsFromEvals(
    game.moves,
    positions,
    evals,
    analyzer.detectOpening(game.moves),
    { headers: game.headers, skipMateThreat: true }
  );
  return results;
}

exports.handler = async (event, context = {}) => {
  context.callbackWaitsForEmptyEventLoop = false;
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (_err) {
    return json(400, { error: 'Invalid JSON body.' });
  }

  // Validate the games BEFORE claiming quota. An empty/invalid payload should
  // 400 without burning the user's daily anticheat slot.
  let preloadedPgns = null;
  try {
    if (_moduleLoadError && payload.mode !== 'list') {
      return json(500, { error: `Anticheat module load failed: ${_moduleLoadError.message || String(_moduleLoadError)}` });
    }
    preloadedPgns = await loadPgns(payload);
    if (!preloadedPgns.length) return json(400, { error: 'No games found.' });
  } catch (err) {
    return json(400, { error: err.message || 'Could not load games.' });
  }

  try {
    // Charge per-game, up front, against the weekly quota (Boost/Max). Fails
    // fast if the batch alone would exceed the remaining weekly budget, so we
    // don't run expensive analysis a user can't afford. Free users are hard-
    // blocked here with code 'upgrade_required' (no analysis runs).
    const quotaState = await requireQuota(event, 'anticheat', { amount: preloadedPgns.length });
    // Allow 'list' mode even if the server lacks the engine modules.
    if (payload.mode === 'list') {
      return json(200, { pgns: preloadedPgns, quota: quotaState.quota, plan: quotaState.plan });
    }

    if (_moduleLoadError) return json(500, { error: `Anticheat module load failed: ${_moduleLoadError.message || String(_moduleLoadError)}` });

    const pgns = preloadedPgns;

    // Same per-user heavy-action lock the game review uses: anticheat holds
    // the shared engine queue for minutes, so it must not run alongside (or
    // be started during) a review or coach chat for the same account.
    const lockUid = quotaState?.user?.uid || null;
    if (!acquireHeavyAction(lockUid, 'anticheat')) {
      const busy = getBusyAction(lockUid);
      return json(429, {
        error: busy === 'review'
          ? 'You already have a review or anticheat check running. Please wait for it to finish.'
          : 'You already have a coach chat running. Please wait for it to finish before starting an anticheat check.',
        code: 'heavy_action_busy',
      });
    }
    let lockHeld = true;
    try {
      return await _anticheatAnalysis({ payload, pgns, quotaState, username: String(payload.username || '').trim() });
    } finally {
      if (lockHeld) releaseHeavyAction(lockUid);
    }
  } catch (err) {
    console.error('Anticheat failed:', err);
    if (/cancelled|not ready|timed out waiting|out of memory|abort/i.test(String(err?.message || err))) {
      // Non-destructive: clears the hash (UCI newGame) on the shared engine.
      // We never destroy/recreate it — that would initEngine() a second time
      // and crash the process.
      try {
        resetServerEngine();
      } catch (_resetErr) {
        // Ignore reset failures while recovering.
      }
    }
    return json(err.statusCode || 500, { error: err.message || 'Anticheat analysis failed.', code: err.code, quota: err.quota, plan: err.plan });
  }
};

// The analysis body of the legacy sync handler, extracted so the per-user
// heavy-action lock wraps it cleanly (acquire → run → release in finally).
// Returns the response object; throws propagate to the caller's catch.
async function _anticheatAnalysis({ payload, pgns, quotaState, username }) {
  const engine = await withTimeout(getServerEngine(), 9000, 'Server engine is still warming up.');
  const reviewEngine = cachedEngineAdapter(engine);

  // Engine-only mode: return per-position engine evaluations for each PGN.
  if (payload.mode === 'engine') {
      // Deep three-line searches are bounded per position and across the batch.
      const overallTimeoutMs = 900000;
      const result = await withTimeout(withEngineQueue(async () => {
        await reviewEngine.newGame();
        const responses = [];
        let processedPositions = 0;
	        const gamePositionLimit = perGamePositionLimit(pgns.length);

        for (const pgn of pgns) {
          try {
            const parsed = parseGame(pgn);
	            const movesAllowed = Math.max(1, Math.min(parsed.moves.length, gamePositionLimit, TOTAL_POSITIONS_LIMIT - processedPositions));
            if (movesAllowed < parsed.moves.length) parsed.moves = parsed.moves.slice(0, movesAllowed);
            processedPositions += parsed.moves.length;

            // Build positions array.
            const Chess = loadChess();
            const chess = new Chess();
            if (parsed.headers.FEN || parsed.headers.Fen || parsed.headers.fen) chess.load(parsed.headers.FEN || parsed.headers.Fen || parsed.headers.fen);
            const positions = [chess.fen()];
            for (const mv of parsed.moves) {
              chess.move(mv, { sloppy: true });
              positions.push(chess.fen());
            }

            const evals = [];
            for (let i = 0; i < positions.length; i++) {
              const fen = positions[i];
              let multi = null;
              try {
                multi = await reviewEngine.evaluateMultiPV(fen, ANTICHEAT_PROFILE.depth, ANTICHEAT_PROFILE.multiPv, ANTICHEAT_PROFILE.timeoutMs);
              } catch (_e) {
                try {
                  multi = await reviewEngine.evaluate(fen, ANTICHEAT_PROFILE.depth, ANTICHEAT_PROFILE.timeoutMs);
                  multi = { lines: [{ score: multi.score, scoreType: multi.scoreType, pv: multi.pv || '', depth: multi.depth || 0 }], bestMove: multi.bestMove };
                } catch (err) {
                  multi = { lines: [], bestMove: '', timedOut: true };
                }
              }
              evals.push(multi || { lines: [], bestMove: '', timedOut: true });
            }

            responses.push({ headers: parsed.headers, moves: parsed.moves, positions, evals, pgn: parsed.pgn });
          } catch (err) {
            console.warn('Skipping engine anticheat game:', err.message);
          }
        }

        return { results: responses, profile: ANTICHEAT_PROFILE };
      }), overallTimeoutMs, 'Anticheat overall processing timed out.');

      return json(200, { ...result, quota: quotaState.quota, plan: quotaState.plan });
    }

	  // Full server-side analysis (legacy): use MoveAnalyzer to compute metrics server-side.
	  const { MoveAnalyzer } = loadAnalyzer();
	    const analyzer = new MoveAnalyzer();
	    analyzer.setReviewProfile(ANTICHEAT_PROFILE);
	    const result = await withTimeout(withEngineQueue(async () => {
	      await reviewEngine.newGame();
	      const allMetrics = [];
	      const aggregatedGames = [];
	      let skipped = 0;
	      let processedPositions = 0;
	      const gamePositionLimit = perGamePositionLimit(pgns.length);

	      for (const pgn of pgns) {
	        try {
	          const parsed = parseGame(pgn);
	          const remaining = TOTAL_POSITIONS_LIMIT - processedPositions;
	          if (remaining <= 0) {
	            skipped += 1;
	            continue;
	          }
	          if (parsed.moves.length > Math.min(remaining, gamePositionLimit)) parsed.moves = parsed.moves.slice(0, Math.min(remaining, gamePositionLimit));
	          processedPositions += parsed.moves.length;
	          const results = await analyzeParsedGame(parsed, analyzer, reviewEngine);
	          const times = moveTimesFromPgn(parsed.pgn, parsed.moves.length, parsed.headers);
	          const targetSide = sideForUsername(parsed.headers, username);
	          const sides = targetSide ? [targetSide] : ['white', 'black'];

	          for (const side of sides) {
	            const metrics = sideMetrics(results, side, times, parsed.headers);
	            allMetrics.push(metrics);
	            const singleScore = scoreMetrics([metrics]);
	            aggregatedGames.push({
	              title: `${metrics.player} as ${side}`,
	              score: singleScore.score,
	              note: `Accuracy ${Math.round(metrics.accuracy)}%, ACPL ${Math.round(metrics.acpl)}, fast bests ${Math.round(metrics.fastBestRate)}%`,
	            });
	          }
	        } catch (err) {
	          skipped += 1;
	          console.warn('Skipping anticheat game:', err.message);
	        }
	      }

	      if (!allMetrics.length) throw new Error('No standard chess games could be analyzed. Try fewer or shorter games.');
	      return {
	        summary: scoreMetrics(allMetrics),
	        games: aggregatedGames,
	        gamesAnalyzed: pgns.length - skipped,
	        gamesSkipped: skipped,
	        subjectsAnalyzed: allMetrics.length,
	        profile: ANTICHEAT_PROFILE,
	      };
	    }), 180000, 'Anticheat overall processing timed out.');

	  return json(200, { ...result, quota: quotaState.quota, plan: quotaState.plan });
}

exports.streamHandler = async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  if (_moduleLoadError) {
    sseWrite(res, 'error', { error: `Anticheat module load failed: ${_moduleLoadError.message || String(_moduleLoadError)}` });
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

  // Load games first so we can charge per-game against the weekly quota.
  let preloadedPgns = [];
  try {
    preloadedPgns = await loadPgns(payload);
    if (!preloadedPgns.length) {
      sseWrite(res, 'error', { error: 'No games found.' });
      res.end();
      return;
    }
  } catch (err) {
    sseWrite(res, 'error', { error: err.message || 'Could not load games.' });
    res.end();
    return;
  }

  // Concurrency cap before the quota charge (same reason as the submit
  // handler: a capped-out user must not spend weekly games on a rejected
  // stream request). requireUser is cheap here — getMe inside requireQuota
  // reuses the same Firebase token verification, and this also gives us the
  // uid the cap is keyed on.
  let streamUser = null;
  try {
    streamUser = await requireUser({
      httpMethod: req.method,
      headers: req.headers || {},
    });
  } catch (err) {
    sseWrite(res, 'error', { error: err.message || 'Login required.', code: err.code || 'unauthorized' });
    res.end();
    return;
  }
  const runningForUidEarly = [..._runningAnticheatJobs.values()].filter((u) => u === streamUser.uid).length;
  if (runningForUidEarly >= MAX_ANTICHEAT_JOBS_PER_UID) {
    sseWrite(res, 'error', {
      error: `You already have ${runningForUidEarly} background review${runningForUidEarly === 1 ? '' : 's'} running. Wait for one to finish first.`,
      code: 'too_many_jobs',
    });
    res.end();
    return;
  }

  let quotaState = null;
  try {
    // Charge per-game up front (Boost/Max weekly quota). Fails fast if the batch
    // alone would exceed the remaining budget; Free users are hard-blocked here.
    quotaState = await requireQuota({
      httpMethod: req.method,
      headers: req.headers || {},
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
    }, 'anticheat', { amount: preloadedPgns.length });
  } catch (err) {
    sseWrite(res, 'error', {
      error: err.message || 'Anticheat quota check failed.',
      code: err.code,
      quota: err.quota,
      plan: err.plan,
    });
    res.end();
    return;
  }

  try {
    const pgns = preloadedPgns;

    // Declared here so the finally below can reference it even when the
    // early busy-returns skipped the close-listener setup (block-scoped let
    // inside a deeper block would not be visible to finally).
    let onClose = null;

    // Same per-user heavy-action lock as the sync handler: the stream holds
    // the shared engine queue for the whole batch, so it must not overlap a
    // review / coach chat / other anticheat run for the same account.
    let lockHeld = false;
    const lockUid = streamUser?.uid || null;
    if (!acquireHeavyAction(lockUid, 'anticheat')) {
      const busy = getBusyAction(lockUid);
      sseWrite(res, 'error', {
        error: busy === 'review'
          ? 'You already have a review or anticheat check running. Please wait for it to finish.'
          : 'You already have a coach chat running. Please wait for it to finish before starting an anticheat check.',
        code: 'heavy_action_busy',
      });
      res.end();
      return;
    }
    lockHeld = true;

    const engine = await withTimeout(getServerEngine(), 9000, 'Server engine is still warming up.');
    const reviewEngine = cachedEngineAdapter(engine);
    const { MoveAnalyzer } = loadAnalyzer();
    const analyzer = new MoveAnalyzer();
    analyzer.setReviewProfile(ANTICHEAT_PROFILE);
    const username = String(payload.username || '').trim();

    sseWrite(res, 'status', { message: 'started', games: pgns.length });

    // Client-gone detection: if the browser disconnects (tab closed, Cancel
    // clicked), stop burning the engine queue on a nobody-is-watching batch.
    // The loop checks clientGone between games; res.destroyed covers the
    // inner per-position callbacks too. Removed in the finally below.
    let clientGone = false;
    onClose = () => { clientGone = true; };
    req.on('close', onClose);

    const allMetrics = [];
    const aggregatedGames = [];
    let skipped = 0;

    // Same caps as the sync handlers: { full: true } (unbounded plies) with no
    // overall timeout once let one request hold an engine-queue slot for hours
    // and starve every review. Balanced sampling keeps all requested games in
    // the evidence set while this cap bounds the complete deep search.
    const streamOverallTimeoutMs = 900000;
    await withTimeout(withEngineQueue(async () => {
      await reviewEngine.newGame();
      let processedPositions = 0;
	      const gamePositionLimit = perGamePositionLimit(pgns.length);
      for (let gameIndex = 0; gameIndex < pgns.length; gameIndex += 1) {
        if (res.destroyed || clientGone) return;
        const pgn = pgns[gameIndex];
        sseWrite(res, 'progress', {
          phase: 'game',
          gameIndex: gameIndex + 1,
          gameTotal: pgns.length,
          message: `Analyzing game ${gameIndex + 1}/${pgns.length}`,
        });

        try {
          const parsed = parseGame(pgn);
          if (!parsed.moves.length) throw new Error('A PGN had no moves.');
          const remaining = TOTAL_POSITIONS_LIMIT - processedPositions;
          if (remaining <= 0) {
            skipped += 1;
            continue;
          }
	          if (parsed.moves.length > Math.min(remaining, gamePositionLimit)) parsed.moves = parsed.moves.slice(0, Math.min(remaining, gamePositionLimit));
          processedPositions += parsed.moves.length;

          const positions = analyzer._positionsForMoves(
            parsed.moves,
            parsed.headers.FEN || parsed.headers.Fen || parsed.headers.fen,
          );
          const evals = await analyzer.evaluatePositions(
            positions,
            reviewEngine,
            (index, total) => {
              if (res.destroyed || clientGone) return;
              sseWrite(res, 'progress', {
                phase: 'positions',
                gameIndex: gameIndex + 1,
                gameTotal: pgns.length,
                completed: index + 1,
                total,
              });
            },
            { newGame: false },
          );

          const results = await analyzer.resultsFromEvals(
            parsed.moves,
            positions,
            evals,
            analyzer.detectOpening(parsed.moves),
            { headers: parsed.headers, skipMateThreat: true },
          );
          const times = moveTimesFromPgn(parsed.pgn, parsed.moves.length, parsed.headers);
          const targetSide = sideForUsername(parsed.headers, username);
          const sides = targetSide ? [targetSide] : ['white', 'black'];

          for (const side of sides) {
            const metrics = sideMetrics(results, side, times, parsed.headers);
            allMetrics.push(metrics);
            const singleScore = scoreMetrics([metrics]);
            aggregatedGames.push({
              title: `${metrics.player} as ${side}`,
              score: singleScore.score,
              note: `Accuracy ${Math.round(metrics.accuracy)}%, ACPL ${Math.round(metrics.acpl)}, fast bests ${Math.round(metrics.fastBestRate)}%`,
            });
          }
        } catch (err) {
          skipped += 1;
          console.warn('Anticheat stream skipped a game:', err.message);
        }
      }
    }), streamOverallTimeoutMs, 'Anticheat analysis timed out.');

    if (!allMetrics.length) {
      sseWrite(res, 'error', { error: 'No standard chess games could be analyzed.' });
      res.end();
      return;
    }

    const summary = scoreMetrics(allMetrics);
    sseWrite(res, 'complete', {
      summary,
      games: aggregatedGames,
      gamesAnalyzed: pgns.length - skipped,
      gamesSkipped: skipped,
      subjectsAnalyzed: allMetrics.length,
      profile: ANTICHEAT_PROFILE,
      quota: quotaState.quota,
      plan: quotaState.plan,
    });
  } catch (err) {
    console.error('Anticheat stream failed:', err);
    sseWrite(res, 'error', {
      error: err.message || 'Anticheat analysis failed.',
      code: err.code,
      quota: quotaState?.quota,
      plan: quotaState?.plan,
    });
  } finally {
    // Detach the close listener (declared after lock acquisition; when we got
    // here without it, there's nothing to clean up).
    if (onClose) req.removeListener('close', onClose);
    // Release the heavy-action lock — but only if this request actually
    // acquired it. lockHeld stays false on the early busy-returns above,
    // so we never drop another action's hold on the same uid.
    if (lockHeld) releaseHeavyAction(lockUid);
    res.end();
  }
};

// ── Background-job path ─────────────────────────────────────────────────────
// POST /api/anticheat/submit  -> returns { jobId, status: 'running' }
// GET  /api/anticheat/status  -> returns the saved report
// The work runs in-process via setImmediate so the HTTP response is fast;
// the user gets a notification + can revisit the result at
// /anticheat/report/<jobId> for the next 3 days (TTL enforced by the
// lazy `_pruneStaleData` cleanup on user-service.js).

// Pulled out of `exports.handler` so the background job can call the same
// analysis pipeline. Returns the legacy result shape, throws on failure.
async function _runLegacyAnalysisForJob(pgns, payload, onProgress) {
  const engine = await withTimeout(getServerEngine(), 9000, 'Server engine is still warming up.');
  const reviewEngine = cachedEngineAdapter(engine);
  const { MoveAnalyzer } = loadAnalyzer();
  const analyzer = new MoveAnalyzer();
  analyzer.setReviewProfile(ANTICHEAT_PROFILE);
  const username = String(payload.username || '').trim();

  const allMetrics = [];
  const aggregatedGames = [];
  let skipped = 0;
  let processedPositions = 0;
	  const gamePositionLimit = perGamePositionLimit(pgns.length);

  return await withTimeout(withEngineQueue(async () => {
    await reviewEngine.newGame();
    for (let gameIndex = 0; gameIndex < pgns.length; gameIndex += 1) {
      // Pause between games while a foreground game review is on the shared
      // engine, then continue once it finishes. The one-hour job timeout below
      // still bounds the whole run, but we give reviews priority by yielding.
      // A review never runs anywhere near 10 minutes (it has its own timeouts),
      // so this cap just guarantees the job can't stall forever on a hung one.
      if (isInteractiveReviewRunning()) {
        await waitForInteractiveReviewIdle({ timeoutMs: 10 * 60 * 1000 });
      }
      const pgn = pgns[gameIndex];
      try {
        const parsed = parseGame(pgn);
        const remaining = TOTAL_POSITIONS_LIMIT - processedPositions;
        if (remaining <= 0) { skipped += 1; continue; }
	        if (parsed.moves.length > Math.min(remaining, gamePositionLimit)) parsed.moves = parsed.moves.slice(0, Math.min(remaining, gamePositionLimit));
        processedPositions += parsed.moves.length;
        const results = await analyzeParsedGame(parsed, analyzer, reviewEngine);
        const times = moveTimesFromPgn(parsed.pgn, parsed.moves.length, parsed.headers);
        const targetSide = sideForUsername(parsed.headers, username);
        const sides = targetSide ? [targetSide] : ['white', 'black'];
        for (const side of sides) {
          const metrics = sideMetrics(results, side, times, parsed.headers);
          allMetrics.push(metrics);
          const singleScore = scoreMetrics([metrics]);
          aggregatedGames.push({
            title: `${metrics.player} as ${side}`,
            score: singleScore.score,
            note: `Accuracy ${Math.round(metrics.accuracy)}%, ACPL ${Math.round(metrics.acpl)}, fast bests ${Math.round(metrics.fastBestRate)}%`,
          });
        }
      } catch (err) {
        skipped += 1;
        console.warn('Skipping background anticheat game:', err.message);
      }
      // Persist running progress so the anticheat page's "In progress" list
      // can show games-analyzed/total while the job is still going.
      if (onProgress) {
        try { await onProgress({ gameDone: gameIndex + 1, gameTotal: pgns.length }); } catch (_e) {}
      }
    }

    if (!allMetrics.length) throw new Error('No standard chess games could be analyzed. Try fewer or shorter games.');
    return {
      summary: scoreMetrics(allMetrics),
      games: aggregatedGames,
      gamesAnalyzed: pgns.length - skipped,
      gamesSkipped: skipped,
      subjectsAnalyzed: allMetrics.length,
      profile: ANTICHEAT_PROFILE,
    };
  }), 3600000, 'Anticheat overall processing timed out.'); // 1 hour
}

// Engine-only mode (depth-20, three-line analysis per position). Same as above but
// returns the engine-results list, used when `mode: 'engine'` is requested.
async function _runEngineAnalysisForJob(pgns, onProgress) {
  const engine = await withTimeout(getServerEngine(), 9000, 'Server engine is still warming up.');
  const reviewEngine = cachedEngineAdapter(engine);

  return await withTimeout(withEngineQueue(async () => {
    await reviewEngine.newGame();
    const responses = [];
    let processedPositions = 0;
	    const gamePositionLimit = perGamePositionLimit(pgns.length);

    for (let gameIndex = 0; gameIndex < pgns.length; gameIndex += 1) {
      // Pause between games while a foreground game review is on the shared
      // engine, then continue once it finishes.
      if (isInteractiveReviewRunning()) {
        await waitForInteractiveReviewIdle({ timeoutMs: 10 * 60 * 1000 });
      }
      const pgn = pgns[gameIndex];
      try {
        const parsed = parseGame(pgn);
	        const movesAllowed = Math.max(1, Math.min(parsed.moves.length, gamePositionLimit, TOTAL_POSITIONS_LIMIT - processedPositions));
        if (movesAllowed < parsed.moves.length) parsed.moves = parsed.moves.slice(0, movesAllowed);
        processedPositions += parsed.moves.length;

        const Chess = loadChess();
        const chess = new Chess();
        if (parsed.headers.FEN || parsed.headers.Fen || parsed.headers.fen) chess.load(parsed.headers.FEN || parsed.headers.Fen || parsed.headers.fen);
        const positions = [chess.fen()];
        for (const mv of parsed.moves) {
          chess.move(mv, { sloppy: true });
          positions.push(chess.fen());
        }

        const evals = [];
        for (let i = 0; i < positions.length; i++) {
          const fen = positions[i];
          let multi = null;
          try {
            multi = await reviewEngine.evaluateMultiPV(fen, ANTICHEAT_PROFILE.depth, ANTICHEAT_PROFILE.multiPv, ANTICHEAT_PROFILE.timeoutMs);
          } catch (_e) {
            try {
              multi = await reviewEngine.evaluate(fen, ANTICHEAT_PROFILE.depth, ANTICHEAT_PROFILE.timeoutMs);
              multi = { lines: [{ score: multi.score, scoreType: multi.scoreType, pv: multi.pv || '', depth: multi.depth || 0 }], bestMove: multi.bestMove };
            } catch (err) {
              multi = { lines: [], bestMove: '', timedOut: true };
            }
          }
          evals.push(multi || { lines: [], bestMove: '', timedOut: true });
        }

        responses.push({ headers: parsed.headers, moves: parsed.moves, positions, evals, pgn: parsed.pgn });
      } catch (err) {
        console.warn('Skipping background engine anticheat game:', err.message);
      }
      // Persist running progress for the anticheat page's "In progress" list.
      if (onProgress) {
        try { await onProgress({ gameDone: gameIndex + 1, gameTotal: pgns.length }); } catch (_e) {}
      }
    }
    return { results: responses, profile: ANTICHEAT_PROFILE };
  }), 3600000, 'Anticheat overall processing timed out.'); // 1 hour
}

// Background-job runner. Runs the analysis async, writes the result to
// `anticheatReports/<uid>/<jobId>`, and pushes a notification on completion
// (success OR failure). Used by `exports.submit` (below). The `setImmediate`
// schedule means the HTTP response has already returned by the time the
// engine queue picks the job up.
// `preloadedPgns` (optional): PGNs already loaded by exports.submit — passing
// them skips a redundant second fetch from lichess/chess.com inside the job.
async function _runAnticheatJob(jobId, payload, uid, quota, plan, preloadedPgns) {
  const { db } = initAdmin();
  const reportRef = db.ref(`anticheatReports/${uid}/${jobId}`);

  let pgns = [];
  try {
    pgns = Array.isArray(preloadedPgns) && preloadedPgns.length ? preloadedPgns : await loadPgns(payload);
    if (!pgns.length) throw new Error('No games found.');
  } catch (err) {
    await reportRef.update({
      status: 'error',
      error: err.message || 'Could not load games.',
      completedAt: Date.now(),
    }).catch(() => {});
    await _pushNotification(uid, {
      type: 'anticheat.error',
      title: 'Anticheat review failed',
      body: err.message || 'Could not load games.',
      link: `/anticheat/report/${jobId}`,
      reportId: jobId,
    });
    return;
  }

  try {
    const isEngine = payload.mode === 'engine';
    // Persist per-game progress while the job runs so the anticheat page's
    // "In progress" list can show a live games-analyzed count + bar. The final
    // update below overwrites gamesAnalyzed with the authoritative total.
    const onProgress = async ({ gameDone, gameTotal }) => {
      await reportRef.update({
        gamesAnalyzed: gameDone,
        limit: payload.limit != null ? Number(payload.limit) : gameTotal,
        gamesTotal: gameTotal,
      }).catch(() => {});
    };
    const result = isEngine
      ? { engineResults: (await _runEngineAnalysisForJob(pgns, onProgress)).results, profile: ANTICHEAT_PROFILE }
      : await _runLegacyAnalysisForJob(pgns, payload, onProgress);

    await reportRef.update({
      status: 'done',
      completedAt: Date.now(),
      summary: isEngine ? null : result.summary,
      games: isEngine ? null : result.games,
      gamesAnalyzed: isEngine ? null : result.gamesAnalyzed,
      gamesSkipped: isEngine ? null : result.gamesSkipped,
      subjectsAnalyzed: isEngine ? null : result.subjectsAnalyzed,
      engineResults: isEngine ? result.engineResults : null,
      profile: result.profile,
    }).catch(() => {});

    // Screening is evidence for a person to review, never an enforcement
    // decision. Queue stronger results with room for reviewer disagreement.
    if (!isEngine && result.summary?.requiresHumanReview) {
      const requestedAt = Date.now();
      await db.ref(`fairPlayReviewQueue/${jobId}`).set({
        jobId, ownerUid: uid, status: 'pending', createdAt: requestedAt,
        score: result.summary.score, scoreRange: result.summary.scoreRange,
        confidence: result.summary.confidence, signals: result.summary.signals,
        reviewerNotes: '', reviewerDecision: '',
      }).catch(() => {});
      await reportRef.update({ humanReview: { status: 'pending', requestedAt } }).catch(() => {});
    }

    const headline = !isEngine && result.summary
      ? `${result.summary.riskLevel} · score ${result.summary.score}/100`
      : 'Review complete.';
    await _pushNotification(uid, {
      type: 'anticheat.done',
      title: 'Anticheat review complete',
      body: headline,
      link: `/anticheat/report/${jobId}`,
      reportId: jobId,
    });
  } catch (err) {
    console.error('Background anticheat job failed:', err);
    if (/cancelled|not ready|timed out|out of memory|abort/i.test(String(err?.message || err))) {
      try { resetServerEngine(); } catch (_) {}
    }
    await reportRef.update({
      status: 'error',
      error: err.message || 'Anticheat analysis failed.',
      completedAt: Date.now(),
    }).catch(() => {});
    await _pushNotification(uid, {
      type: 'anticheat.error',
      title: 'Anticheat review failed',
      body: err.message || 'Anticheat analysis failed.',
      link: `/anticheat/report/${jobId}`,
      reportId: jobId,
    });
  }
}

// POST /api/anticheat/submit — charge quota, write a fresh report entry
// with status:'running', then hand the heavy work to _runAnticheatJob via
// setImmediate so the HTTP response is fast. The user gets a notification
// when it finishes and can revisit the result at the saved URL.
exports.submit = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });

  if (_moduleLoadError) return json(500, { error: `Anticheat module load failed: ${_moduleLoadError.message || String(_moduleLoadError)}` });

  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'Invalid JSON body.' }); }

  // Background-job trigger also drives the global stale-data cleanup so
  // abuse logs and trackers get pruned even on silent users.
  _pruneStaleDataGlobal().catch(() => {});

  // Auth first — we need uid for the report path AND the quota charge.
  let user;
  try {
    user = await requireUser({
      httpMethod: event.httpMethod,
      headers: event.headers || {},
      body: event.body,
    });
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || 'Unauthorized.', code: err.code });
  }

  // Background anticheat is a Max-only feature. Gate BEFORE validating PGNs or
  // charging quota so a non-Max user is rejected without burning a weekly slot.
  const plan = activePlan(user._profile);
  if (!isPaidOrAbove(plan.plan, 'max')) {
    return json(402, {
      error: 'Background anticheat reviews are a Max feature. Upgrade to Max to run anticheat without keeping this tab open.',
      code: 'upgrade_required',
      plan: { plan: plan.plan, name: plan.name },
    });
  }

  // Validate PGNs BEFORE charging quota so a malformed payload doesn't burn
  // a weekly slot. (Reuses the same loader the legacy handler uses.)
  let preloadedPgns = [];
  try {
    preloadedPgns = await loadPgns(payload);
    if (!preloadedPgns.length) return json(400, { error: 'No games found.' });
  } catch (err) {
    return json(400, { error: err.message || 'Could not load games.' });
  }

  // Concurrency cap FIRST: each job holds the shared engine queue for up to
  // ~1h, so a stacked request must be rejected before it spends any of the
  // user's weekly quota. (This used to run after requireQuota + the report
  // record write, so a rejected request still burned games and left a stale
  // "running" report behind.)
  const runningForUidEarly = [..._runningAnticheatJobs.values()].filter((u) => u === user.uid).length;
  if (runningForUidEarly >= MAX_ANTICHEAT_JOBS_PER_UID) {
    return json(429, {
      error: `You already have ${runningForUidEarly} background review${runningForUidEarly === 1 ? '' : 's'} running. Wait for one to finish first.`,
      code: 'too_many_jobs',
    });
  }

  // Charge the per-game quota up front. Free users hard-block here; Boost
  // and Max get a weekly per-game claim. Any charge that's later abandoned
  // (e.g. user navigated away mid-submit) stays spent — matches the
  // legacy handler's behaviour.
  let quotaState;
  try {
    quotaState = await requireQuota(event, 'anticheat', { amount: preloadedPgns.length });
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message, code: err.code, quota: err.quota, plan: err.plan });
  }

  const jobId = (cryptoNode.randomUUID && cryptoNode.randomUUID())
    || `job_${Date.now()}_${cryptoNode.randomBytes(8).toString('hex')}`;
  const startedAt = Date.now();
  const expiresAt = startedAt + (3 * 24 * 60 * 60 * 1000); // 3-day TTL
  const reportRecord = {
    status: 'running',
    mode: payload.mode === 'engine' ? 'engine' : 'legacy',
    source: String(payload.source || 'pgn'),
    sourceMeta: {
      username: payload.username ? String(payload.username).trim() : '',
      limit: preloadedPgns.length,
    },
    startedAt,
    completedAt: null,
    expiresAt,
    quota: quotaState.quota,
    plan: quotaState.plan,
    error: null,
    summary: null,
    games: null,
    gamesAnalyzed: null,
    gamesSkipped: null,
    subjectsAnalyzed: null,
    engineResults: null,
    profile: ANTICHEAT_PROFILE,
  };

  try {
    const { db } = initAdmin();
    await db.ref(`anticheatReports/${user.uid}/${jobId}`).set(reportRecord);
  } catch (err) {
    console.error('[anticheat/submit] report-write failed:', err && err.message ? err.message : err);
    return json(500, { error: 'Could not start the background review.', code: 'storage_error', detail: (err && err.message) ? String(err.message).slice(0, 300) : undefined });
  }

  // Per-user background-job concurrency cap: each job fetches external PGNs
  // and holds the shared engine queue for up to ~1h. Without a cap, one Max
  // account could stack many jobs and starve everyone else.
  const runningForUid = [..._runningAnticheatJobs.values()].filter((u) => u === user.uid).length;
  if (runningForUid >= MAX_ANTICHEAT_JOBS_PER_UID) {
    return json(429, {
      error: `You already have ${runningForUid} background review${runningForUid === 1 ? '' : 's'} running. Wait for one to finish first.`,
      code: 'too_many_jobs',
    });
  }

  // Pass the already-loaded PGNs into the job — previously the job re-fetched
  // them from lichess/chess.com a second time (double external fetch).
  _runningAnticheatJobs.set(jobId, user.uid);
  setImmediate(() => {
    _runAnticheatJob(jobId, payload, user.uid, quotaState.quota, quotaState.plan, preloadedPgns)
      .catch((err) => {
        console.error('Background anticheat job crashed:', err);
      })
      .finally(() => {
        _runningAnticheatJobs.delete(jobId);
      });
  });

  return json(200, {
    jobId,
    status: 'running',
    startedAt,
    expiresAt,
    quota: quotaState.quota,
    plan: quotaState.plan,
  });
};

// GET /api/anticheat/list — list every saved report (running/error/done)
// for the current user as lightweight metadata, newest first. Serves the
// anticheat page's "Saved reviews" section. Full game data is intentionally
// omitted — the report page fetches it on demand via /status?jobId=….
exports.list = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Use GET.' });

  let user;
  try {
    user = await requireUser({
      httpMethod: event.httpMethod,
      headers: event.headers || {},
      queryStringParameters: event.queryStringParameters,
    });
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || 'Unauthorized.', code: err.code });
  }

  try {
    const { db } = initAdmin();
    const snap = await db.ref(`anticheatReports/${user.uid}`).once('value');
    const reports = [];
    if (snap.exists()) {
      snap.forEach((c) => {
        const v = c.val() || {};
        reports.push({
          jobId: c.key,
          status: v.status === 'done' ? 'done' : (v.status === 'error' ? 'error' : 'running'),
          startedAt: Number(v.startedAt) || 0,
          completedAt: v.completedAt ? Number(v.completedAt) : null,
          summary: v.summary && v.summary.riskLevel
            ? { riskLevel: String(v.summary.riskLevel), score: v.summary.score }
            : null,
          error: v.error ? String(v.error) : null,
          gamesAnalyzed: v.gamesAnalyzed != null ? Number(v.gamesAnalyzed) : null,
          subjectsAnalyzed: v.subjectsAnalyzed != null ? Number(v.subjectsAnalyzed) : null,
          gamesTotal: v.gamesTotal != null ? Number(v.gamesTotal) : null,
          limit: v.limit != null ? Number(v.limit) : null,
        });
      });
    }
    reports.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    return json(200, { reports });
  } catch (err) {
    return json(500, { error: err.message || 'Could not load anticheat reports.' });
  }
};

// GET /api/anticheat/status?jobId=… — read the saved report. Used by the
// `/anticheat/report/<jobId>` page on load AND by the bell on click.
exports.status = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Use GET.' });

  let user;
  try {
    user = await requireUser({
      httpMethod: event.httpMethod,
      headers: event.headers || {},
      queryStringParameters: event.queryStringParameters,
    });
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || 'Unauthorized.', code: err.code });
  }

  const jobId = String((event.queryStringParameters && event.queryStringParameters.jobId) || '').trim();
  if (!jobId) return json(400, { error: 'jobId query parameter is required.' });

  try {
    const { db } = initAdmin();
    const snap = await db.ref(`anticheatReports/${user.uid}/${jobId}`).once('value');
    if (!snap.exists()) return json(404, { error: 'Report not found. It may have expired (3-day TTL).' });
    return json(200, { jobId, ...snap.val() });
  } catch (err) {
    return json(500, { error: err.message || 'Could not load the report.' });
  }
};

// Pure scoring hooks used by deterministic regression tests. They do not load
// games, consume quota, or touch the database.
exports._test = { sideMetrics, scoreMetrics, moveTimesFromPgn, timeControlClass, correlation };
