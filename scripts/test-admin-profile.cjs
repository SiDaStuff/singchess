const assert = require('node:assert/strict');
const { SqlDatabase } = require('../server/api/_lib/sql-database');
const service = require('../server/api/_lib/user-service');
const db = new SqlDatabase({ filename: ':memory:', startBackup: false, backup: { read: async () => null } });
let privileged = true, lookups = 0;
const auth = {
  getUser: async uid => {
    lookups++;
    if (uid === 'removed') throw Object.assign(new Error(), { code: 'auth/user-not-found' });
    return { uid, email: `${uid}@example.test`, disabled: uid === 'banned', metadata: {} };
  },
  getUserByEmail: async email => {
    lookups++;
    if (email.toLowerCase() === 'banned@example.test') return { uid: 'banned' };
    throw Object.assign(new Error(), { code: 'auth/user-not-found' });
  },
};
service.requireUser = async () => ({ admin: privileged });
service.initAdmin = () => ({ db, admin: { auth: () => auth } });
const api = require('../server/api/admin-profile');
const request = async args => {
  const res = await api.handler({ httpMethod: 'GET', queryStringParameters: args });
  return { status: res.statusCode, ...JSON.parse(res.body) };
};
async function main() {
  const day = service.usageDay();
  db.importInitialSnapshot({
    users: {
      banned: { profile: { username: 'FastKnight', puzzleRating: 1820, puzzleStats: { solved: 42, attempted: 50 },
        subscription: { plan: 'max', expiresAt: Date.now() + 86400000 }, secret: 'PRIVATE',
        ban: { disabled: true, reason: 'Repeated harassment', bannedBy: 'moderator', bannedAt: 123 } },
        usage: { [day]: { coachTokens: 98961, serverReviews: 3, manualImports: 2 } }, savedReviews: [{ id: 'a' }, { id: 'b' }] },
      second: { profile: { username: 'Twin' } }, third: { profile: { username: 'twin' } },
      removed: { profile: { username: 'Archive', email: 'removed@example.test' } },
    },
    abuse: { notes: { banned: { note: { text: 'Verify next appeal', author: 'admin', createdAt: 100 } } },
      flagged: { banned: { reportCount: 3 } },
      reports: { r1: { flaggedUid: 'banned', reason: 'Harassment', reportedAt: 10 }, r2: { flaggedUid: 'second' } },
      actions: { a1: { targetUid: 'banned', action: 'ban', timestamp: 11 } } },
  });
  privileged = false;
  assert.equal((await request({ query: 'FastKnight' })).status, 403);
  assert.equal(lookups, 0, 'non-admin lookup never reads Auth identity');
  privileged = true;
  assert.equal((await request({ query: 'bad@' })).status, 400);
  assert.equal((await request({ query: 'missing' })).status, 404);
  assert.equal((await request({ uid: '../private' })).status, 400);
  const byName = await request({ query: ' fastKNIGHT ' });
  assert.equal(byName.status, 200);
  assert.equal(byName.detail.account.uid, 'banned');
  assert.equal(byName.detail.ban.reason, 'Repeated harassment');
  assert.equal(byName.detail.ban.bannedBy, 'moderator');
  assert.equal(byName.detail.ban.banned, true);
  assert.equal(byName.detail.stats.savedReviews, 2);
  assert.equal(byName.detail.stats.puzzleStats.solved, 42);
  assert.equal(byName.detail.notes[0].text, 'Verify next appeal');
  assert.equal(byName.detail.reports.length, 1);
  assert.equal(byName.detail.actions.length, 1);
  assert.equal(byName.detail.stats.today.coachUsagePercent, 98);
  assert.ok(!JSON.stringify(byName).includes('coachTokens'));
  assert.ok(!JSON.stringify(byName).includes('PRIVATE'));
  assert.equal((await request({ query: 'banned@example.test' })).detail.account.uid, 'banned');
  const duplicate = await request({ query: 'TWIN' });
  assert.equal(duplicate.status, 409); assert.equal(duplicate.matches.length, 2);
  assert.equal((await request({ uid: duplicate.matches[0].uid })).status, 200);
  assert.equal((await request({ query: 'Archive' })).detail.account.authAccountMissing, true);
  assert.equal(db.sql.prepare("EXPLAIN QUERY PLAN SELECT parent FROM nodes WHERE kind=4 AND key='username' AND lower(text_value)='fastknight'").all().some(row => row.detail.includes('nodes_profile_lookup')), true);
  console.log('PASS administrator authorization, indexed username/email lookup, duplicate selection, bans, notes, statistics and private count filtering');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
