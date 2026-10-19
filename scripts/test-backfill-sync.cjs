// Verifies syncFromBackup imports only missing nodes and never clobbers local writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqlDatabase } = require('../server/api/_lib/sql-database');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-sync-'));
const filename = path.join(folder, 'test.sqlite');
const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
const remote = {
  users: {
    alice: { profile: { username: 'Alice' }, attemptedPuzzles: { p1: 111, p2: 222 } },
    bob: { profile: { username: 'Bob' } },
  },
  abuse: { cookieIndex: { abc: { firstSeen: 1 } } },
};
const backup = {
  read: async scope => clone(scope.split('/').filter(Boolean).reduce((v, key) => v?.[key], remote)),
  writeBatch: async () => assert.fail('sync must never write to Firebase'),
};
const db = new SqlDatabase({ filename, backup, startBackup: false, logger: { log() {}, warn() {} } });
async function main() {
  // Seed local state: alice exists with a local-only rating (must survive),
  // and a tombstone for abuse (deleted locally — must not resurrect).
  await db.ref('users/alice/profile').update({ username: 'Alice', puzzleRating: 1900 });
  await db.ref('abuse').remove();
  const result = await db.syncFromBackup('');
  assert.equal(result.imported > 0, true, 'imports missing nodes');
  // Local write preserved, remote sibling imported:
  const alice = (await db.ref('users/alice/profile').get()).val();
  assert.equal(alice.puzzleRating, 1900, 'local value wins');
  assert.equal(alice.username, 'Alice');
  assert.deepEqual((await db.ref('users/alice/attemptedPuzzles').get()).val(), { p1: 111, p2: 222 }, 'missing sibling imported');
  // New user imported:
  assert.equal((await db.ref('users/bob/profile/username').get()).val(), 'Bob', 'new remote user imported');
  // Tombstone respected:
  assert.equal((await db.ref('abuse').get()).val(), null, 'local deletion wins over remote data');
  // Idempotent: second run imports nothing.
  const again = await db.syncFromBackup('');
  assert.equal(again.imported, 0, 'second sync imports nothing');
  // Outage is non-fatal.
  backup.read = async () => { throw new Error('Injected outage'); };
  const failed = await db.syncFromBackup('users');
  assert.equal(failed.imported, 0);
  console.log('PASS syncFromBackup: missing-node import, local-write preservation, tombstones, idempotency, outage safety');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
