const assert = require('node:assert/strict');
const { SqlDatabase } = require('../server/api/_lib/sql-database');
const { createBackupRecovery } = require('../server/api/_lib/backup-recovery');
const db = new SqlDatabase({ filename: ':memory:', startBackup: false, backup: { read: async () => null } });
async function main() {
  db.importInitialSnapshot({});
  await db.ref('profile').set({ name: 'Knight', nested: { n: 1 } });
  const pending = db.status().pendingBackupWrites;
  for (let i = 0; i < 10; i++) {
    await db.ref('profile').set({ nested: { n: 1 }, name: 'Knight' });
    const result = await db.ref('profile').transaction(value => value);
    assert.equal(result.committed, true);
    assert.equal(result.snapshot.val().nested.n, 1);
  }
  assert.equal(db.status().pendingBackupWrites, pending, 'unchanged structured writes and transactions produce no backup work');
  await db.ref('profile').update({ name: 'Bishop' });
  assert.equal(db.status().pendingBackupWrites, pending + 1, 'actual edits remain durable');
  await db.ref('deleted').remove();
  const deleted = db.status().pendingBackupWrites;
  await db.ref('deleted').remove();
  assert.equal(db.status().pendingBackupWrites, deleted, 'repeated deletion is a no-op');

  let time = 1000, calls = 0, release;
  const gated = new Promise(resolve => { release = resolve; });
  const recoverDb = { sql: db.sql, syncFromBackup: async () => { calls++; await gated; return { imported: 0 }; } };
  const pass = createBackupRecovery(recoverDb, { now: () => time });
  const otherWorker = createBackupRecovery(recoverDb, { now: () => time });
  const running = pass();
  assert.equal((await pass()).skipped, true);
  assert.equal((await otherWorker()).skipped, true, 'shared SQL lease prevents duplicate worker scans');
  assert.equal(calls, 1);
  release(); await running;
  assert.equal((await otherWorker()).skipped, true, 'completed scans remain throttled');
  time += 600001; await otherWorker(); assert.equal(calls, 2);

  const remote = Object.fromEntries(Array.from({ length: 1400 }, (_, i) => [`entry${i}`, i]));
  db.backup = { read: async () => remote };
  let yielded = false;
  setImmediate(() => { yielded = true; });
  const restored = await db.syncFromBackup('recovered');
  assert.equal(restored.imported, 1400);
  assert.equal(yielded, true, 'large missing-data imports yield to other requests');
  assert.equal(db.status().pendingBackupWrites, deleted, 'backup recovery never echoes back to Firebase');

  const service = require('../server/api/_lib/user-service');
  service.initAdmin = () => ({ db });
  const abuse = require('../server/api/admin-abuse-report');
  const event = { headers: { 'x-forwarded-for': '192.0.2.1', 'user-agent': 'test', 'accept-language': 'en' }, sidDeviceId: 'device-1' };
  const changes = await Promise.all(Array.from({ length: 12 }, () => abuse.trackLoginFingerprint('qa-perf', event)));
  assert.equal(changes.filter(Boolean).length, 1, 'concurrent requests record the same fingerprint once');
  assert.equal(await abuse.trackLoginFingerprint('qa-perf', event), false);
  assert.equal(await abuse.trackLoginFingerprint('qa-perf', { ...event, sidDeviceId: 'device-2' }), true, 'new device fingerprints are not throttled');
  console.log('PASS no-op write suppression, durable edits/deletions, shared recovery lease, yielding imports and concurrent fingerprint throttling');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
