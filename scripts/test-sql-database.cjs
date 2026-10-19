const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqlDatabase } = require('../server/api/_lib/sql-database');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-sql-'));
const filename = path.join(folder, 'test.sqlite');
const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
const remote = { users: { alice: { profile: { username: 'Alice', subscription: { plan: 'max' }, puzzleRating: 1800 }, usage: { today: { reviews: 2 } } } }, publicStats: { gamesAnalyzed: 7, siteVisitorsTotal: 10 } };
let reads = 0, fail = false, time = 100000;
const writes = [];
const backup = {
  read: async scope => { reads++; if (fail) throw new Error('Injected outage'); return clone(scope.split('/').filter(Boolean).reduce((v, key) => v?.[key], remote)); },
  writeBatch: async patch => { if (fail) throw new Error('Injected outage'); writes.push(clone(patch)); },
};
let db = new SqlDatabase({ filename, backup, now: () => time, startBackup: false, logger: { warn() {} } });
async function main() {
  assert.equal((await db.ref('users/alice/profile').get()).val().puzzleRating, 1800);
  assert.equal(reads, 1, 'cold read restores Firebase data');
  assert.equal((await db.ref('users/alice/profile/subscription').get()).val().plan, 'max');
  assert.equal(reads, 1, 'warm nested reads are SQL-only');
  await db.ref('users/alice/profile').update({ puzzleRating: 1900, updatedAt: { '.sv': 'timestamp' } });
  assert.equal((await db.ref('users/alice/profile').get()).val().updatedAt, time);
  const snapshot = await db.ref('users/alice/profile').get();
  assert.equal(snapshot.child('subscription/plan').val(), 'max');
  assert.ok(snapshot.exists() && snapshot.numChildren() === 4);
  await db.ref('users/alice/profile/puzzleRating').remove();
  assert.equal((await db.ref('users/alice/profile/puzzleRating').get()).val(), null);
  assert.equal(reads, 1, 'tombstones prevent deleted data from resurrecting');
  const user = (await db.ref('users/alice').get()).val();
  assert.equal(user.profile.updatedAt, time);
  assert.equal(user.profile.puzzleRating, undefined, 'parent recovery preserves SQL deletion');
  assert.equal(user.usage.today.reviews, 2, 'parent recovery fills missing siblings');
  const empty = db.ref('missing/item');
  await empty.get(); const negativeReads = reads;
  await empty.get(); assert.equal(reads, negativeReads, 'negative recovery cached');

  await db.ref('reports').update({ a: { createdAt: 1, kind: 'game' }, b: { createdAt: 2, kind: 'puzzle' }, c: { createdAt: 3, kind: 'game' } });
  const order = await db.ref('reports').orderByChild('createdAt').startAt(2).limitToLast(2).get();
  const keys = []; order.forEach(child => keys.push(child.key)); assert.deepEqual(keys, ['b', 'c']);
  assert.deepEqual(Object.keys((await db.ref('reports').orderByChild('kind').equalTo('game').get()).val()), ['a', 'c']);
  assert.deepEqual(Object.keys((await db.ref('reports').orderByChild('createdAt').endAt(2).limitToFirst(1).get()).val()), ['a']);
  await db.ref('arrays').set({ plies: [1, 2, { san: 'e4' }], empty: [] });
  assert.deepEqual((await db.ref('arrays/plies').get()).val(), [1, 2, { san: 'e4' }]);
  assert.equal((await db.ref('arrays/empty').get()).val(), null);
  await assert.rejects(db.ref('bad').set({ number: NaN }));
  await assert.rejects(db.ref().update({ 'overlap/x': 1, overlap: 2 }));
  assert.equal((await db.ref('bad').get()).val(), null);

  const other = new SqlDatabase({ filename, backup, now: () => time, startBackup: false });
  await db.ref('counter').set(0);
  await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? db : other).ref('counter').transaction(n => n + 1)));
  assert.equal((await other.ref('counter').get()).val(), 40, 'shared-worker transactions never lose increments');
  const abort = await other.ref('counter').transaction(() => undefined);
  assert.equal(abort.committed, false); assert.equal(abort.snapshot.val(), 40);
  const beforeInvalid = db.status().pendingBackupWrites;
  await assert.rejects(db.ref('counter').transaction(async value => value + 1));
  assert.equal(db.status().pendingBackupWrites, beforeInvalid, 'invalid mutation rolls back');
  other.close();
  const pending = db.status().pendingBackupWrites;
  assert.throws(() => db.importInitialSnapshot({ counter: 0 }), /local writes/, 'migration cannot replace committed SQL writes');
  db.close();
  db = new SqlDatabase({ filename, backup, now: () => time, startBackup: false, logger: { warn() {} } });
  assert.equal(db.status().pendingBackupWrites, pending, 'backup queue survives restart');
  fail = true;
  await db.flushBackup(); assert.equal(db.status().pendingBackupWrites, pending, 'backup outage keeps committed writes');
  assert.equal((await db.ref('counter').get()).val(), 40, 'known SQL reads work during backup outage');
  await assert.rejects(db.ref('never-loaded').get(), error => error.statusCode === 503);
  assert.equal(db.known('never-loaded'), false, 'failed backup reads do not mark data absent');
  fail = false; time += 6000;
  await db.flushBackup({ limit: 1000 });
  assert.equal(db.status().pendingBackupWrites, 0);
  assert.equal(Object.values(writes.at(-1))[0], 40, 'backup replays committed values in order');

  const notified = [];
  const query = db.ref('notifications').orderByChild('createdAt').startAt(1);
  const listener = query.on('child_added', snap => notified.push(snap.key));
  const ref = db.ref('notifications').push(); await ref.set({ createdAt: 10, title: 'Ready' });
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.deepEqual(notified, [ref.key], 'local SSE listener observes new notifications');
  db.ref('notifications').off('child_added', listener);
  assert.equal(db.listeners.size, 0, 'base-reference unsubscribe clears query listener');

  // Existing public counters now share SQL transactions and preserve visitors.
  const users = require('../server/api/_lib/user-service'); const original = users.initAdmin;
  users.initAdmin = () => ({ db });
  const stats = require('../server/api/_lib/firebase-stats');
  const counters = await stats.incrementPublicStats({ gamesAnalyzed: 2 });
  assert.equal(counters.gamesAnalyzed, 9); assert.equal(counters.siteVisitorsTotal, 10);
  assert.equal(await stats.claimUniqueBrilliantMoves(['same', 'same']), 1);
  assert.equal(await stats.claimUniqueBrilliantMoves(['same']), 0);
  assert.equal(await stats.tryClaimRateLimit('test', 'ip'), true);
  assert.equal(await stats.tryClaimRateLimit('test', 'ip'), false);
  users.initAdmin = original;
  console.log('PASS SQL recovery, missing records, deletion safety, typed queries, atomic counters, restart durability, ordered backup retries, notifications and public-stat integration');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  db.close();
  // Only remove the resolved test directory created under the OS temp root.
  if (path.dirname(folder) === path.resolve(os.tmpdir()) && path.basename(folder).startsWith('chess-sql-')) fs.rmSync(folder, { recursive: true, force: true });
});
