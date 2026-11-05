// Isolated checks for the in-progress background review (server/api/_lib/live-review.js).
// Uses an in-memory DB stub and a fake engine — no Stockfish binary, no network,
// no Firebase credentials, no real game.
const assert = require('node:assert/strict');

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
    const ref = {
      async set(value) { set(value); }, async remove() { set(null); },
      async update(patch) { set({ ...get(), ...patch }); },
      async transaction(fn) { const value = fn(get()); if (value !== undefined) set(value); return { committed: value !== undefined, snapshot: { val: () => get() } }; },
      orderByChild() { return ref; }, endAt() { return ref; }, limitToFirst() { return ref; }, limitToLast() { return ref; },
      async once() { return { val: () => structuredClone(get()) }; },
    };
    return ref;
  }
}

function makeEngine(evalsByCall = []) {
  const calls = [];
  return {
    calls, threads: 1, hashMb: 32,
    async init() {},
    async newGame() {},
    async evaluateMultiPV(fen, depth, multiPv, timeout, opts) { calls.push(fen); const cp = evalsByCall.shift() ?? 10; return { cp, lines: [{ score: cp, scoreType: 'cp', pv: 'e2e4', depth: 10, uci: 'e2e4' }], bestMove: 'e2e4' }; },
    async evaluate(fen) { calls.push(fen); const cp = evalsByCall.shift() ?? 10; return { score: cp, scoreType: 'cp', pv: 'e2e4', bestMove: 'e2e4', depth: 10 }; },
    destroy() {},
  };
}

const maxProfile = { subscription: { plan: 'max', expiresAt: Date.now() + 100000 } };
const { maybeReviewMove } = require('../server/api/_lib/live-review');

(async () => {
  let checks = 0;
  const check = (name, fn) => { fn(); checks++; console.log(`PASS ${name}`); };

  const moves = ['e2e4', 'e7e5', 'g1f3', 'b8c6'];

  // 1. Toggle off → nothing stored.
  await (async () => {
    const db = new MemoryDB();
    const engine = makeEngine();
    await maybeReviewMove({ db, uid: 'u1', gameId: 'g1', movesUci: moves.join(' '), finished: false, getProfile: () => maxProfile, createEngine: () => engine });
    check('disabled toggle analyzes nothing', () => assert.equal(engine.calls.length, 0));
  })();

  // 2. Non-Max → toggle disabled, no analysis.
  await (async () => {
    const db = new MemoryDB({ liveReviewPrivate: { u2: { g2: { meta: { enabled: true } } } } });
    const engine = makeEngine();
    await maybeReviewMove({ db, uid: 'u2', gameId: 'g2', movesUci: moves.join(' '), finished: false, getProfile: () => ({ plan: 'free' }), createEngine: () => engine });
    const meta = (await db.ref('liveReviewPrivate/u2/g2/meta').once('value')).val();
    check('non-Max disables the toggle without analyzing', () => { assert.equal(meta.enabled, false); assert.equal(engine.calls.length, 0); });
  })();

  // 3. Enabled + Max → analyzes the new plies, ready flips at finish.
  await (async () => {
    const db = new MemoryDB({ liveReviewPrivate: { u3: { g3: { meta: { enabled: true, initialFen: null } } } } });
    const engine = makeEngine(Array(moves.length).fill(12));
    // First: 2 moves played, game still on.
    await maybeReviewMove({ db, uid: 'u3', gameId: 'g3', movesUci: moves.slice(0, 2).join(' '), finished: false, getProfile: () => maxProfile, createEngine: () => engine });
    check('first pass analyzes the first 2 plies', () => assert.equal(engine.calls.length, 2));
    let seen = (await db.ref('liveReviewPrivate/u3/g3/seen').once('value')).val();
    check('seen ply advances to 2', () => assert.equal(seen.analyzedPly, 2));
    let results = (await db.ref('liveReviewPrivate/u3/g3/results').once('value')).val();
    check('results store cp per ply', () => { assert.equal(results.list.length, 2); assert.equal(results.list[0].cp, 12); });
    // Game now finishes with 4 moves → analyzes only the 2 new plies.
    await maybeReviewMove({ db, uid: 'u3', gameId: 'g3', movesUci: moves.join(' '), finished: true, getProfile: () => maxProfile, createEngine: () => engine });
    check('completion analyzes only the new plies, not all 4', () => assert.equal(engine.calls.length, 4));
    seen = (await db.ref('liveReviewPrivate/u3/g3/seen').once('value')).val();
    results = (await db.ref('liveReviewPrivate/u3/g3/results').once('value')).val();
    check('seen ply advances to 4 and results are complete', () => { assert.equal(seen.analyzedPly, 4); assert.equal(results.list.length, 4); });
    const meta = (await db.ref('liveReviewPrivate/u3/g3/meta').once('value')).val();
    check('review is marked ready once the game finishes', () => assert.equal(meta.ready, true));
  })();

  // 4. A second live pass skipped while a previous pass is still running (lock).
  await (async () => {
    const db = new MemoryDB({ liveReviewPrivate: { u4: { g4: { meta: { enabled: true } } } } });
    let engineUnderLock;
    const engines = [];
    const create = () => { const e = makeEngine([15]); engines.push(e); return e; };
    // We can't easily hold the lock from here; just assert idempotency: a repeat
    // call after completion with no new plies doesn't re-run the engine.
    await maybeReviewMove({ db, uid: 'u4', gameId: 'g4', movesUci: 'e2e4', finished: true, getProfile: () => maxProfile, createEngine: create });
    const callsBefore = engines.reduce((n, e) => n + e.calls.length, 0);
    await maybeReviewMove({ db, uid: 'u4', gameId: 'g4', movesUci: 'e2e4', finished: true, getProfile: () => maxProfile, createEngine: create });
    const callsAfter = engines.reduce((n, e) => n + e.calls.length, 0);
    check('repeat completion with no new plies does not re-analyze', () => assert.equal(callsAfter, callsBefore));
  })();

  console.log(`${checks} live-review checks passed.`);
})().catch(err => { console.error(err); process.exit(1); });