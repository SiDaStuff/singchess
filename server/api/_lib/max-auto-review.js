const crypto = require('node:crypto');
const users = require('./user-service');
const linked = require('./linked-chess-service');
const { loadChess, loadAnalyzer } = require('./analysis-loader');
const { ServerStockfishEngine } = require('./stockfish-engine');
const { isInteractiveReviewRunning } = require('./review-coordination');

const LIMITS = Object.freeze({ gamesPerDay: 12, maxPlies: 160, maxPgnBytes: 100000, retainedReviews: 20, pollMs: 60000 });
const eligible = (profile, identity = null) => users.activePlan(profile).plan === 'max' && !profile?.ban?.disabled
  && linked.validName(identity?.username || identity?.id);
async function playIdentity(database, uid) {
  const saved = (await database.ref(`playPrivate/connections/${uid}`).once('value')).val();
  return saved?.profile && linked.validName(saved.profile.username || saved.profile.id) ? saved.profile : null;
}

async function analyze(game, { createEngine = () => new ServerStockfishEngine() } = {}) {
  const Chess = loadChess();
  const chess = new Chess();
  if (!linked.complete(game) || !chess.load_pgn(game.pgn, { sloppy: true })) throw new Error('Only completed, valid games can be reviewed.');
  const moves = chess.history();
  if (!moves.length || moves.length > LIMITS.maxPlies) throw new Error('Game exceeds the beta move limit.');
  const initial = new Chess();
  initial.load_pgn(game.pgn, { sloppy: true });
  while (initial.undo()) {}
  const { MoveAnalyzer } = loadAnalyzer();
  const analyzer = new MoveAnalyzer();
  analyzer.setReviewProfile({ mode: 'depth+movetime', depth: 12, movetimeMs: 150, multiPv: 2, timeoutMs: 2500 });
  const engine = createEngine();
  engine.threads = 1;
  engine.hashMb = 32;
  const deadline = Date.now() + 60000;
  try {
    let timedOut = false;
    let timeout;
    const initialization = engine.init().then(() => { if (timedOut) engine.destroy(); });
    try {
      await Promise.race([initialization, new Promise((_, reject) => {
        timeout = setTimeout(() => { timedOut = true; reject(new Error('Background engine initialization timed out.')); }, 15000);
      })]);
    } finally { clearTimeout(timeout); }
    const guard = method => (...args) => {
        if (Date.now() > deadline || isInteractiveReviewRunning()) throw new Error('Background review deferred for server capacity.');
        return engine[method](...args);
    };
    const bounded = {
      newGame: guard('newGame'),
      evaluateMultiPV: guard('evaluateMultiPV'),
      evaluate: guard('evaluate'),
    };
    const results = await analyzer.analyzeGame(moves, bounded, null, { initialFen: initial.fen() });
    const review = { results: Array.from(results) };
    for (const key of ['whiteAccuracy', 'blackAccuracy', 'whiteAcpl', 'blackAcpl', 'whiteCaps', 'blackCaps', 'whiteGameRating', 'blackGameRating', 'phaseSummary', 'opening', 'criticalMoments']) {
      if (results[key] !== undefined) review[key] = results[key];
    }
    return JSON.parse(JSON.stringify(review));
  } finally { engine.destroy(); }
}

function createWorker({ db, getProfile = users.getProfile, getPlayIdentity = playIdentity, loadLinked = null, reviewGame = analyze, now = Date.now, busy = isInteractiveReviewRunning, notify = users._pushNotification, enforceGlobal = false } = {}) {
  let running = false;
  async function tick() {
    if (running || busy()) return;
    running = true;
    let database;
    const owner = crypto.randomUUID();
    const start = now();
    let leaseRef;
    let acquired = false;
    try {
      database = db || users.initAdmin().db;
      if (enforceGlobal && !(await users.getFeatureControls('', database)).features.reviewBackground) return;
      leaseRef = database.ref('maxAutoReviewPrivate/lease');
      const claim = await leaseRef.transaction(value => value?.expiresAt > start ? undefined : { owner, expiresAt: start + 5 * 60000 });
      if (!claim.committed) return;
      acquired = true;
      await database.ref('maxAutoReviewPrivate/worker').update({ lastTickAt: now() });
      const expired = (await database.ref('linkedChessPrivate/cache').orderByChild('expiresAt').endAt(start).limitToFirst(50).once('value')).val() || {};
      for (const key of Object.keys(expired)) {
        await database.ref(`linkedChessPrivate/cache/${key}`).transaction(value => value && value.expiresAt <= start && !(value.leaseUntil > start) ? null : undefined);
      }
      const entries = (await database.ref('maxAutoReviewPrivate/accounts').orderByChild('nextPollAt').endAt(start).limitToFirst(20).once('value')).val() || {};
      for (const [uid, account] of Object.entries(entries)) {
        if (now() - start > 3 * 60000 || busy()) break;
        if (!account.enabled) continue;
        const ref = database.ref(`maxAutoReviewPrivate/accounts/${uid}`);
        try {
          await ref.update({ lastCheckedAt: now() });
          const profile = await getProfile(uid);
          if (enforceGlobal && !(await users.getFeatureControls(uid, database)).features.reviewBackground) {
            await ref.update({ enabled: false, status: 'disabled', nextPollAt: Number.MAX_SAFE_INTEGER });
            continue;
          }
          const identity = await getPlayIdentity(database, uid);
          if (!eligible(profile, identity)) { await ref.update({ enabled: false, status: 'ineligible', nextPollAt: Number.MAX_SAFE_INTEGER }); continue; }
          const sourceAccount = loadLinked
            ? { games: (await loadLinked({ uid, _profile: profile }, { database, identity })).linked.flatMap(entry => entry.games || []) }
            : await linked.fetchSource('lichess', identity.username || identity.id);
          const games = (sourceAccount.games || []).filter(linked.complete);
          const sig = `play:${String(identity.id || identity.username).toLowerCase()}`;
          // Enabling or changing links seeds the cursor, avoiding a surprise
          // backfill of historical games and repeated relink abuse.
          if (account.signature !== sig || !account.initialized) {
            await ref.update({ signature: sig, initialized: true, seen: games.map(linked.gameKey), status: 'watching', nextPollAt: now() + LIMITS.pollMs });
            continue;
          }
          const seen = new Set(account.seen || []);
          const day = new Date(now()).toISOString().slice(0, 10);
          let count = account.day === day ? Number(account.count) || 0 : 0;
          const previous = (await database.ref(`maxAutoReviewPrivate/reviews/${uid}`).once('value')).val() || {};
          for (const game of games.slice().reverse()) {
            const id = linked.gameKey(game);
            if (seen.has(id) || previous[id]) { seen.delete(id); seen.add(id); continue; }
            if (count >= LIMITS.gamesPerDay || busy() || now() - start > 3 * 60000) break;
            if (game.pgn.length > LIMITS.maxPgnBytes) { seen.add(id); continue; }
            const Chess = loadChess();
            const parsed = new Chess();
            if (!parsed.load_pgn(game.pgn, { sloppy: true }) || !parsed.history().length || parsed.history().length > LIMITS.maxPlies) { seen.add(id); continue; }
            // Charge before the engine starts, durably, even if it times out.
            count += 1;
            await ref.update({ day, count, status: 'reviewing', nextPollAt: now() + LIMITS.pollMs });
            const review = await reviewGame(game);
            const current = await getProfile(uid);
            const currentIdentity = await getPlayIdentity(database, uid);
            if (!eligible(current, currentIdentity) || `play:${String(currentIdentity?.id || currentIdentity?.username || '').toLowerCase()}` !== sig || !(await ref.once('value')).val()?.enabled) break;
            await database.ref(`maxAutoReviewPrivate/reviews/${uid}/${id}`).set({ id, source: game.source, username: game.username, white: game.white, black: game.black, pgn: game.pgn, createdAt: now(), review });
            seen.add(id);
            await ref.update({ seen: [...seen].slice(-100) });
            await notify(uid, { type: 'auto_review', title: 'Your game review is ready', body: `${game.white} vs ${game.black}`, link: `/account?auto-review=${id}`, reportId: id });
          }
          const stored = (await database.ref(`maxAutoReviewPrivate/reviews/${uid}`).once('value')).val() || {};
          const stale = Object.values(stored).sort((a, b) => b.createdAt - a.createdAt).slice(LIMITS.retainedReviews);
          for (const item of stale) await database.ref(`maxAutoReviewPrivate/reviews/${uid}/${item.id}`).remove();
          await ref.update({ seen: [...seen].slice(-100), day, count, status: count >= LIMITS.gamesPerDay ? 'daily_limit' : 'watching', nextPollAt: now() + LIMITS.pollMs });
        } catch (error) {
          console.warn('[auto-review] Job deferred:', error.message);
          await ref.update({ status: 'retrying', nextPollAt: now() + 5 * 60000 });
        }
      }
    } finally {
      if (acquired) await leaseRef.transaction(value => value?.owner === owner ? null : undefined);
      running = false;
    }
  }
  return { tick };
}

function startScheduler() {
  if (process.env.MAX_AUTO_REVIEW_ENABLED === '0') return;
  const worker = createWorker({ enforceGlobal: true });
  const timer = setInterval(() => worker.tick().catch(error => console.warn('[auto-review] Scheduler unavailable:', error.message)), LIMITS.pollMs);
  timer.unref();
  return () => clearInterval(timer);
}
module.exports = { LIMITS, eligible, playIdentity, analyze, createWorker, startScheduler };
