/**
 * In-progress background game review ("review while you play").
 *
 * When a user enables the Play background-review toggle, each move they play is
 * analyzed on the server as it arrives, so by the time the game finishes the
 * full review is already computed. Results are stored under
 * `liveReviewPrivate/{uid}/{gameId}/...`:
 *
 *   meta { enabled, ready, initialFen, ... }      toggle + completion state
 *   results { list: [ {move, fen, cp}, ... ] }     one entry per analyzed ply
 *   seen { analyzedPly: N }                        how many plies are analyzed
 *
 * `ready` stays false during the game and flips true the instant it finishes.
 * The client only reads the review once `ready` is true — the game is never
 * unlockable while in progress.
 *
 * Cost is bounded:
 *   • Each position is analyzed exactly once (incremental — total work is
 *     O(moves), never O(moves²)).
 *   • A per-user in-process lock prevents two moves from spinning two engines.
 *   • If an interactive review is active (sharing the process-wide Stockfish),
 *     the live job yields rather than stealing CPU.
 *   • Only Max-plan users with the private toggle on qualify.
 *
 * Separate from max-auto-review.js, which polls a linked Lichess account's
 * *completed* games.
 */
const { ServerStockfishEngine } = require('./stockfish-engine');
const { loadChess, loadAnalyzer } = require('./analysis-loader');
const { isInteractiveReviewRunning } = require('./review-coordination');
const users = require('./user-service');

const MAX_PLIES = 160;
const REVIEW_PROFILE = { mode: 'depth+movetime', depth: 10, movetimeMs: 120, multiPv: 2, timeoutMs: 2500 };
const ENG_DEADLINE_MS = 30000;
// Per-user in-process lock so we never run two live engines for one player.
const userLocks = new Map();

/** Build the full FEN-per-ply list for a move list, from initialFen (or startpos). */
function fensForMoves(movesUci, initialFen) {
  const Chess = loadChess();
  const replay = initialFen && initialFen !== 'startpos' ? new Chess(initialFen) : new Chess();
  const fens = [];
  for (const uci of movesUci) {
    fens.push(replay.fen());
    const move = replay.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) }, { sloppy: true });
    if (!move) break;
  }
  return fens;
}

/**
 * Attempt to (incrementally) review the current position of a played game.
 * Fire-and-forget: never throws into the game stream.
 */
async function maybeReviewMove({ db, uid, gameId, movesUci, finished, getProfile = users.getProfile, createEngine = () => new ServerStockfishEngine() } = {}) {
  let metaRef = null;
  try {
    if (!db || !uid || !gameId) return;
    const moves = String(movesUci || '').trim().split(/\s+/).filter(Boolean);
    if (!moves.length || moves.length > MAX_PLIES) return;

    metaRef = db.ref(`liveReviewPrivate/${uid}/${gameId}/meta`);
    const meta = (await metaRef.once('value')).val() || {};
    if (!meta.enabled) return; // toggle off (or absent) → skip
    if (userLocks.get(uid)) return; // previous pass still running → covered later

    // Max-plan gate (best-effort; a stale profile just means "deferred").
    const profile = await getProfile(uid);
    if (!profile || users.activePlan(profile).plan !== 'max') { await metaRef.update({ enabled: false, reason: 'plan' }); return; }

    userLocks.set(uid, { gameId, at: Date.now() });
    try {
      const seen = (Number((await db.ref(`liveReviewPrivate/${uid}/${gameId}/seen`).once('value')).val()?.analyzedPly) || 0);
      const fens = fensForMoves(moves, meta.initialFen);
      // Only analyze plies after what we've already done.
      const todo = fens.slice(seen);
      if (!todo.length) { if (finished) await finalize(metaRef, db, uid, gameId); return; }

      const { MoveAnalyzer } = loadAnalyzer();
      const analyzer = new MoveAnalyzer();
      analyzer.setReviewProfile(REVIEW_PROFILE);
      const engine = createEngine();
      engine.threads = 1; engine.hashMb = 32;
      const deadline = Date.now() + ENG_DEADLINE_MS;
      try {
        await engine.init();
        const guard = method => (...args) => {
          if (Date.now() > deadline || isInteractiveReviewRunning()) throw new Error('Live review deferred for server capacity.');
          return engine[method](...args);
        };
        const bounded = { newGame: guard('newGame'), evaluateMultiPV: guard('evaluateMultiPV'), evaluate: guard('evaluate') };
        const evals = await analyzer.evaluatePositions(todo, bounded, null, { totalPositions: todo.length });
        // Append the newly analyzed plies to the stored list (keyed by ply index).
        const stored = (await db.ref(`liveReviewPrivate/${uid}/${gameId}/results`).once('value')).val() || {};
        const list = Array.isArray(stored.list) ? stored.list.slice() : [];
        for (let i = 0; i < todo.length && i < evals.length; i++) {
          const idx = seen + i;
          list[idx] = { fen: todo[i], cp: evals[i]?.cp ?? null };
        }
        // Full review assembly happens on completion; store the raw eval list now.
        await db.ref(`liveReviewPrivate/${uid}/${gameId}/results`).update({ list });
        await db.ref(`liveReviewPrivate/${uid}/${gameId}/seen`).set({ analyzedPly: seen + evals.length });
      } finally { engine.destroy(); }
      if (finished) await finalize(metaRef, db, uid, gameId);
    } finally { userLocks.delete(uid); }
  } catch (error) {
    if (error?.message?.includes('deferred')) return;
    try { await metaRef?.update({ error: String(error.message).slice(0, 120) }); } catch {}
  }
}

// Mark the stored review ready (the game is over — safe to unlock reading).
async function finalize(metaRef, db, uid, gameId) {
  await metaRef.update({ enabled: false, status: 'idle', ready: true, finishedAt: Date.now() });
}

module.exports = { maybeReviewMove, fensForMoves };