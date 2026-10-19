// Exercises the actual GET handler and JSON serialization with a real SQL
// reference/timer and isolated Firebase Auth/backup fixtures.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const servicePath = require.resolve('../server/api/_lib/user-service');
const serviceRequire = createRequire(servicePath);
const { SqlDatabase } = require('../server/api/_lib/sql-database');
const profile = { username: 'stored-player', email: 'qa@example.test', puzzleRating: 1875,
  savedUsernames: { chesscom: 'qa-chess', lichess: 'qa-lichess' }, puzzleStats: { solved: 42, attempted: 50 },
  subscription: { plan: 'max', expiresAt: Date.now() + 86400000 },
  engineSettings: { source: 'browser' } };
const remote = { users: { 'backup-only': { profile, savedReviews: [{ id: 'review-1', pgn: '1. e4 e5 *' }] } } };
let profileReads = 0;
let outage = false;
const database = new SqlDatabase({ filename: ':memory:', backupIntervalMs: 60000, backup: {
  read: async path => {
    if (outage) throw Object.assign(new Error('Injected backup outage'), { statusCode: 503 });
    if (path.endsWith('/profile')) profileReads++;
    return path.split('/').filter(Boolean).reduce((value, key) => value?.[key], remote) ?? null;
  }, writeBatch: async () => {},
}, logger: { warn() {}, log() {} } });
const substitute = (id, exports) => { require.cache[id] = { id, filename: id, loaded: true, exports }; };
substitute(serviceRequire.resolve('firebase-admin'), { apps: [{}], database: { ServerValue: { TIMESTAMP: { '.sv': 'timestamp' } } }, auth: () => ({
  verifyIdToken: async uid => ({ uid, email: 'qa@example.test', name: 'QA' }),
}) });
substitute(require.resolve('../server/api/_lib/sql-database'), { SqlDatabase: class { constructor() { return database; } } });
substitute(require.resolve('../server/api/admin-abuse-report'), { trackLoginFingerprint: async () => {}, checkMultiAccount: async () => {} });
const service = require(servicePath);
const api = require('../server/api/users-me');
const event = uid => ({ httpMethod: 'GET', headers: { authorization: `Bearer ${uid}` } });
async function main() {
  database.importInitialSnapshot({ users: { existing: { profile }, closed: { profile: { ...profile, ban: { disabled: true } } } } });
  const internal = await service.requireUser(event('existing'));
  assert.throws(() => JSON.stringify(internal._profileSnap), /circular/i, 'reproduces the internal SQL timer serialization failure');
  const existing = await api.handler(event('existing'));
  assert.equal(existing.statusCode, 200, existing.body);
  const decoded = JSON.parse(existing.body);
  assert.equal(decoded.profile.username, profile.username);
  assert.equal(decoded.profile.puzzleRating, 1875);
  assert.deepEqual(decoded.profile.savedUsernames, profile.savedUsernames);
  assert.equal(decoded.plan.plan, 'max');
  assert.equal(decoded.user.uid, 'existing');
  assert.equal(decoded.user._profileSnap, undefined);
  assert.equal(decoded.user._profile, undefined);
  assert.equal(decoded.usage.coachTokens, undefined);
  assert.equal(decoded.usage.coachUsagePercent, 0);
  assert.equal(existing.body.includes('backup_outbox'), false);
  const preferences = { anticheatComplete: false, browserPush: true, browserPushGranted: true };
  const save = await api.handler({ ...event('existing'), httpMethod: 'POST', body: JSON.stringify({ profile: { notificationSettings: preferences } }) });
  assert.equal(save.statusCode, 200, save.body);
  assert.deepEqual(JSON.parse(save.body).profile.notificationSettings, preferences);
  assert.deepEqual(JSON.parse((await api.handler(event('existing'))).body).profile.notificationSettings, preferences, 'notification preferences survive a fresh profile read');
  assert.equal((await database.ref('users/existing/profile').get()).val().puzzleRating, 1875, 'saving notifications preserves unrelated profile data');
  const settingsDenied = await api.handler({ ...event('closed'), httpMethod: 'POST', body: JSON.stringify({ profile: { notificationSettings: preferences } }) });
  assert.equal(settingsDenied.statusCode, 403, 'banned accounts cannot save preferences');
  // The original root snapshot predates this account; recover only missing data.
  const fallback = await api.handler(event('backup-only'));
  assert.equal(fallback.statusCode, 200, fallback.body);
  assert.equal(JSON.parse(fallback.body).profile.username, 'stored-player');
  assert.deepEqual((await database.ref('users/backup-only/savedReviews').get()).val(), remote.users['backup-only'].savedReviews, 'array data survives backup recovery');
  const before = profileReads;
  await api.handler(event('backup-only'));
  assert.equal(profileReads, before, 'warm profiles stay in SQL');
  await database.ref('users/backup-only/profile/puzzleRating').set(2000);
  await database.syncFromBackup('users/backup-only');
  assert.equal((await database.ref('users/backup-only/profile/puzzleRating').get()).val(), 2000, 'local edits remain authoritative');
  await database.ref('users/deleted').remove();
  remote.users.deleted = { profile };
  await database.syncFromBackup('users/deleted');
  assert.equal((await database.ref('users/deleted').get()).exists(), false, 'recovery cannot resurrect explicitly deleted users');
  const closed = await api.handler(event('closed'));
  assert.equal(closed.statusCode, 403);
  assert.equal(JSON.parse(closed.body).code, 'account_closed');
  outage = true;
  const unavailable = await api.handler(event('unknown-during-outage'));
  assert.equal(unavailable.statusCode, 503);
  assert.equal(JSON.parse(unavailable.body).code, 'profile_recovery_failed');
  assert.equal((await database.ref('users/unknown-during-outage/profile').get()).exists(), false, 'backup failure never fabricates an empty saved profile');
  await new Promise(resolve => setTimeout(resolve, 30)); // drain fixture cleanup tasks
  console.log('PASS complete profile GET serialization, saved data/plan, missing-user Firebase recovery, arrays, SQL edits/deletions, warm reads, bans and safe outage handling');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => database.close());
