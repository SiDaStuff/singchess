const assert = require('node:assert/strict');
const { analyze, createWorker, eligible, LIMITS } = require('../server/api/_lib/max-auto-review');
const { gameKey, fetchSource, loadLinked } = require('../server/api/_lib/linked-chess-service');

class MemoryDB {
  constructor(seed = {}) { this.data = seed; }
  ref(path) {
    const database = this, parts = path.split('/').filter(Boolean);
    const get = () => parts.reduce((value, key) => value?.[key], database.data) ?? null;
    const set = value => {
      let parent = database.data;
      for (const key of parts.slice(0, -1)) parent = parent[key] ||= {};
      if (value === null) delete parent[parts.at(-1)]; else parent[parts.at(-1)] = structuredClone(value);
    };
    let order, end = Infinity, limit = Infinity, last = false;
    const ref = {
      async set(value) { set(value); }, async remove() { set(null); },
      async update(patch) { set({ ...get(), ...patch }); },
      async transaction(fn) { const value = fn(get()); if (value !== undefined) set(value); return { committed: value !== undefined, snapshot: { val: () => get() } }; },
      orderByChild(key) { order = key; return ref; }, endAt(value) { end = value; return ref; },
      limitToFirst(value) { limit = value; return ref; },
      limitToLast(value) { limit = value; last = true; return ref; },
      async once() {
        let value = get();
        if (order && value) {
          const sorted = Object.entries(value).filter(([, data]) => (data[order] ?? 0) <= end).sort((a, b) => (a[1][order] ?? 0) - (b[1][order] ?? 0));
          value = Object.fromEntries(last ? sorted.slice(-limit) : sorted.slice(0, limit));
        }
        return { val: () => structuredClone(value) };
      },
    };
    return ref;
  }
}

async function main() {
  const profile = { subscription: { plan: 'max', expiresAt: Date.now() + 86400000 }, savedUsernames: { lichess: 'qa-player' } };
  assert.equal(eligible(profile), true);
  for (const invalid of [{ ...profile, subscription: { plan: 'boost', expiresAt: Date.now() + 100000 } }, { ...profile, savedUsernames: {} }, { ...profile, ban: { disabled: true } }, { ...profile, subscription: { plan: 'max', expiresAt: 1 } }]) assert.equal(eligible(invalid), false);
  const game = { source: 'lichess', username: 'qa-player', white: 'qa-player', black: 'opponent', headers: { Result: '1-0', Site: 'https://lichess.org/abc12345' }, pgn: '[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0' };
  // Run the REAL analyzer through the background adapter. Empty MultiPV
  // responses exercise its single-PV fallback (also used at terminal boards).
  let fallbackCalls = 0, destroyed = false;
  const fallbackEngine = {
    init: async () => {}, newGame: async () => {},
    evaluateMultiPV: async () => ({ lines: [] }),
    evaluate: async fen => {
      fallbackCalls++;
      const board = new (require('chess.js').Chess)(fen);
      const move = board.moves({ verbose: true })[0];
      const bestMove = move ? move.from + move.to + (move.promotion || '') : '';
      return { score: 0, scoreType: 'cp', bestMove, pv: bestMove, depth: 12 };
    },
    destroy: () => { destroyed = true; },
  };
  const backgroundReview = await analyze(game, { createEngine: () => fallbackEngine });
  assert.equal(backgroundReview.results.length, 4);
  assert.equal(fallbackCalls, 5, 'background engine adapter exposes single-PV fallback');
  assert.equal(destroyed, true, 'background engine always cleaned up');
  assert.equal(gameKey(game), gameKey({ ...game, pgn: game.pgn + ' ', username: 'QA-PLAYER' }));
  const db = new MemoryDB(); let time = Date.now(), calls = 0, reviewed = 0, notices = 0;
  let games = [game];
  const worker = createWorker({ db, now: () => time, getProfile: async () => profile, loadLinked: async () => ({ linked: [{ games }] }), reviewGame: async () => { reviewed++; return { results: [], whiteAccuracy: 95 }; }, notify: async () => { notices++; } });
  await db.ref('maxAutoReviewPrivate/accounts/qa').set({ enabled: true, nextPollAt: 0 });
  await worker.tick(); assert.equal(reviewed, 0, 'enrollment seeds history');
  assert.equal((await db.ref('maxAutoReviewPrivate/worker').once('value')).val().lastTickAt, time);
  assert.equal((await db.ref('maxAutoReviewPrivate/accounts/qa').once('value')).val().lastCheckedAt, time);
  const next = { ...game, headers: { Result: '1-0', Site: 'https://lichess.org/newgame1' } };
  games = [next, game, { ...game, headers: { Result: '*', Site: 'https://lichess.org/ongoing1' } }];
  time += 60001; await worker.tick();
  assert.equal(reviewed, 1); assert.equal(notices, 1);
  time += 60001; await worker.tick(); assert.equal(reviewed, 1, 'deduplicates completed games');
  await db.ref('maxAutoReviewPrivate/accounts/qa').update({ count: LIMITS.gamesPerDay, day: new Date(time).toISOString().slice(0, 10), nextPollAt: 0 });
  games = [{ ...next, headers: { Result: '1-0', Site: 'https://lichess.org/gamecap1' } }];
  await worker.tick(); assert.equal(reviewed, 1, 'server-owned daily cap');
  await db.ref('maxAutoReviewPrivate/lease').set({ owner: 'another-process', expiresAt: time + 10000 });
  time += 1; await worker.tick(); assert.equal(reviewed, 1, 'shared process lease');
  await db.ref('maxAutoReviewPrivate/lease').remove();
  profile.ban = { disabled: true }; time += 60001; await worker.tick();
  assert.equal((await db.ref('maxAutoReviewPrivate/accounts/qa').once('value')).val().enabled, false, 'ban disables worker');
  delete profile.ban;

  const cachedDb = new MemoryDB();
  const options = { database: cachedDb, now: time, fetchSourceFn: async () => { calls++; return { source: 'lichess', username: 'qa-player', games: [], puzzleRating: 1750, ratingKind: 'current' }; } };
  await loadLinked({ _profile: profile }, options); await loadLinked({ _profile: profile }, options);
  assert.equal(calls, 1, 'refresh cache prevents upstream abuse');
  await loadLinked({ _profile: profile }, { ...options, now: time + 60001 }); assert.equal(calls, 2);
  let simultaneous = 0, peak = 0;
  const fetcher = async url => {
    simultaneous++; peak = Math.max(peak, simultaneous);
    await Promise.resolve(); simultaneous--;
    const payload = url.endsWith('/stats') ? { tactics: { highest: { rating: 2200 }, lowest: { rating: 1200 } } }
      : url.endsWith('/archives') ? { archives: ['https://api.chess.com/pub/player/qa/games/2026/10'] }
      : { games: [{ pgn: game.pgn, end_time: time / 1000, url: 'https://www.chess.com/game/live/123' }] };
    return { ok: true, json: async () => payload };
  };
  const chesscom = await fetchSource('chesscom', 'qa', fetcher);
  assert.equal(chesscom.puzzleRating, 2200); assert.equal(chesscom.ratingKind, 'peak'); assert.equal(peak, 1, 'provider calls are serial');
  const emptyDb = new MemoryDB(); let firstGames = [], firstReviews = 0;
  const emptyWorker = createWorker({ db: emptyDb, now: () => time, getProfile: async () => profile, loadLinked: async () => ({ linked: [{ games: firstGames }] }), reviewGame: async () => { firstReviews++; return { results: [] }; }, notify: async () => {} });
  await emptyDb.ref('maxAutoReviewPrivate/accounts/first').set({ enabled: true, nextPollAt: 0 });
  await emptyWorker.tick();
  firstGames = [game]; time += 60001; await emptyWorker.tick();
  assert.equal(firstReviews, 1, 'empty initial history must not skip the first new game');

  const retryDb = new MemoryDB(); let attempts = 0;
  await retryDb.ref('maxAutoReviewPrivate/accounts/retry').set({ enabled: true, initialized: true, signature: require('../server/api/_lib/linked-chess-service').signature(profile.savedUsernames), seen: [], nextPollAt: 0 });
  const retryWorker = createWorker({ db: retryDb, now: () => time, getProfile: async () => profile, loadLinked: async () => ({ linked: [{ games: [game] }] }), reviewGame: async () => { if (++attempts === 1) throw new Error('Injected engine failure'); return { results: [] }; }, notify: async () => {} });
  await retryWorker.tick();
  const retryState = (await retryDb.ref('maxAutoReviewPrivate/accounts/retry').once('value')).val();
  assert.equal(retryState.status, 'retrying'); assert.equal(retryState.count, 1);
  assert.equal(retryState.nextPollAt, time + 300000);
  time += 60000; await retryWorker.tick(); assert.equal(attempts, 1, 'failed review backs off');
  time += 240001; await retryWorker.tick();
  assert.equal(attempts, 2, 'same unseen game is retried');
  assert.equal((await retryDb.ref('maxAutoReviewPrivate/accounts/retry').once('value')).val().status, 'watching');
  assert.ok((await retryDb.ref(`maxAutoReviewPrivate/reviews/retry/${gameKey(game)}`).once('value')).val());

  const users = require('../server/api/_lib/user-service');
  const service = require('../server/api/_lib/linked-chess-service');
  // Opt-in API fixtures must explicitly enable the admin-controlled beta.
  await emptyDb.ref('adminControls/features').set({ reviewBackground: true });
  const originals = { requireUser: users.requireUser, initAdmin: users.initAdmin, patchProfile: users.patchProfile, loadLinked: service.loadLinked };
  let currentProfile = profile, patched;
  users.requireUser = async event => { if (!event.headers?.authorization) throw Object.assign(new Error('Login required.'), { statusCode: 401 }); return { uid: 'api-qa', _profile: currentProfile }; };
  users.initAdmin = () => ({ db: emptyDb });
  users.patchProfile = async (uid, update) => { patched = { uid, update }; };
  service.loadLinked = async () => ({ linked: [{ source: 'lichess', username: 'qa-player', puzzleRating: 1780, ratingKind: 'current', latest: game, games: [game] }] });
  const autoApi = require('../server/api/max-auto-review');
  const linkApi = require('../server/api/linked-chess');
  const event = body => ({ httpMethod: 'POST', headers: { authorization: 'Bearer isolated' }, body: JSON.stringify(body) });
  assert.equal((await autoApi.handler({ httpMethod: 'GET' })).statusCode, 401);
  assert.equal((await autoApi.handler({ ...event({}), body: '{broken' })).statusCode, 400);
  assert.equal((await linkApi.handler(event(null))).statusCode, 400);
  const disabledSetting = process.env.MAX_AUTO_REVIEW_ENABLED;
  process.env.MAX_AUTO_REVIEW_ENABLED = '0';
  assert.equal((await autoApi.handler(event({ enabled: true }))).statusCode, 503);
  process.env.MAX_AUTO_REVIEW_ENABLED = '1';
  currentProfile = { ...profile, subscription: {} };
  assert.equal((await autoApi.handler(event({ enabled: true }))).statusCode, 403);
  currentProfile = profile;
  assert.equal((await autoApi.handler(event({ enabled: true, uid: 'other-user' }))).statusCode, 200);
  assert.equal((await autoApi.handler(event({ enabled: false }))).statusCode, 429, 'opt-in cooldown cannot be bypassed');
  assert.equal((await autoApi.handler({ ...event({}), httpMethod: 'GET', queryStringParameters: { id: '../other-user' } })).statusCode, 400);
  assert.equal((await autoApi.handler({ ...event({}), httpMethod: 'GET', queryStringParameters: { id: 'a'.repeat(64) } })).statusCode, 404);
  assert.equal((await linkApi.handler(event({ action: 'import-rating', source: 'lichess' }))).statusCode, 200);
  assert.deepEqual(patched, { uid: 'api-qa', update: { puzzleRating: 1780 } });
  assert.equal((await linkApi.handler(event({ action: 'import-rating', source: 'lichess' }))).statusCode, 429);
  const context = await require('../server/api/_lib/coach-tools').runCoachGames({ uid: 'api-qa', _profile: profile });
  assert.ok(context.usernames.includes('lichess: qa-player'));
  assert.equal(context.linkedAccounts[0].puzzleRating, 1780);
  Object.assign(users, { requireUser: originals.requireUser, initAdmin: originals.initAdmin, patchProfile: originals.patchProfile });
  service.loadLinked = originals.loadLinked;
  if (disabledSetting === undefined) delete process.env.MAX_AUTO_REVIEW_ENABLED; else process.env.MAX_AUTO_REVIEW_ENABLED = disabledSetting;
  console.log('PASS Max gating, cursor, completed-only games, deduplication, quota, shared lease, bans, provider caching and rating semantics');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
