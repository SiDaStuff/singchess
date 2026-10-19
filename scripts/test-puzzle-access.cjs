const assert = require('node:assert/strict');

// Exercise the public handler without account credentials, a running server,
// or writes to either the puzzle library or account database.
const servicePath = require.resolve('../server/api/_lib/user-service');
const puzzlePath = require.resolve('../server/api/_lib/puzzle-db');
const handlerPath = require.resolve('../server/api/get-puzzle');
const originals = [servicePath, puzzlePath, handlerPath].map(path => [path, require.cache[path]]);
const payload = { puzzle: { id: 'guest-puzzle', solution: ['e2e4'] } };
let allowed = true, ready = true, credentialsError, authenticatedCalls = 0, publicCalls = 0, nextOptions;
require.cache[servicePath] = { exports: {
  requireFeature: async (event, feature) => {
    authenticatedCalls++; assert.equal(feature, 'puzzles');
    if (credentialsError) throw credentialsError;
  },
  getFeatureControls: async () => { publicCalls++; return { features: { puzzles: allowed } }; },
} };
require.cache[puzzlePath] = { exports: {
  isReady: () => ready,
  getDailyPuzzle: async () => payload,
  getNextPuzzle: async options => { nextOptions = options; return payload; },
} };

(async () => {
  try {
    const { handler } = require(handlerPath);
    const request = (type = 'next', headers = {}) => handler({ httpMethod: 'GET', headers, queryStringParameters: { type, theme: 'mix', difficulty: 'normal', target: '1500' } });
    for (const type of ['next', 'daily']) {
      const response = await request(type);
      assert.equal(response.statusCode, 200, `${type} puzzles work signed out`);
      assert.deepEqual(JSON.parse(response.body).data, payload);
    }
    assert.equal(authenticatedCalls, 0);
    assert.equal(publicCalls, 2, 'guests respect global feature controls');
    assert.equal(nextOptions.target, 1500);
    assert.equal((await request('next', { Authorization: 'Bearer valid' })).statusCode, 200);
    assert.equal(authenticatedCalls, 1);
    for (const [statusCode, code] of [[401, 'auth/id-token-expired'], [403, 'account_closed'], [403, 'feature_disabled']]) {
      credentialsError = Object.assign(new Error(code), { statusCode, code });
      const response = await request('next', { authorization: 'Bearer restricted' });
      assert.equal(response.statusCode, statusCode, code);
      assert.equal(JSON.parse(response.body).code, code);
      assert.equal(publicCalls, 2, 'supplied credentials never fall back to guest access');
    }
    credentialsError = undefined; allowed = false;
    assert.equal((await request()).statusCode, 403, 'global disable applies to guests');
    allowed = true; ready = false;
    const missing = await request();
    assert.equal(missing.statusCode, 503);
    assert.equal(JSON.parse(missing.body).code, 'puzzle_db_missing');
    assert.equal((await handler({ httpMethod: 'OPTIONS', headers: {} })).statusCode, 200);
    assert.equal((await request('next', { origin: 'https://untrusted.example' })).statusCode, 403);
    console.log('PASS guest daily/next puzzles, authenticated restrictions, global feature switch, unavailable library, preflight and origin checks');
  } finally {
    for (const [path, cached] of originals) { if (cached) require.cache[path] = cached; else delete require.cache[path]; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
