// Isolated tests: no Firebase credentials, production writes or LLM requests.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const servicePath = require.resolve('../server/api/_lib/user-service');
const serviceRequire = createRequire(servicePath);
const { SqlDatabase } = require('../server/api/_lib/sql-database');
const database = new SqlDatabase({ filename: ':memory:', startBackup: false, backup: { read: async () => null } });
const substitute = (id, exports) => { require.cache[id] = { id, filename: id, loaded: true, exports }; };
const admin = { apps: [{}], database: { ServerValue: { TIMESTAMP: { '.sv': 'timestamp' } } },
  auth: () => ({ getUserByEmail: async email => ({ uid: 'chatter', email }) }) };
substitute(serviceRequire.resolve('firebase-admin'), admin);
substitute(require.resolve('../server/api/_lib/sql-database'), { SqlDatabase: class { constructor() { return database; } } });
const service = require(servicePath);
const { publicCoachUsage, completionCost, compactHistory } = require('../server/api/_lib/coach-budget');
const { recordCoachConcern } = require('../server/api/_lib/coach-abuse');
const user = { uid: 'chatter', email: 'qa@example.test' };
const evidence = 'A current message being tested for repeated harassment.';
const concern = { category: 'harassment', confidence: 0.99, evidence, reason: 'Direct targeted harassment in a test fixture.' };
const context = id => ({ requestId: `request-${id}`, text: evidence });
async function main() {
  await database.ref('users').set({ chatter: { profile: { username: 'qa' } } });
  const day = service.usageDay();
  await database.ref(`users/chatter/usage/${day}/coachTokens`).set(98961);
  const first = await service.reserveCoachTokens(user.uid, 3000, 100000, { partial: true });
  assert.deepEqual(first, { allowed: true, total: 100000, amount: 1039, day });
  assert.equal((await service.reserveCoachTokens(user.uid, 3000, 100000, { partial: true })).allowed, false);
  assert.equal((await service.reconcileCoachTokens(user.uid, -939, day)).total, 99061);
  const concurrent = await Promise.all(Array.from({ length: 4 }, () => service.reserveCoachTokens(user.uid, 600, 100000, { partial: true })));
  assert.equal(concurrent.reduce((sum, r) => sum + r.amount, 0), 939, 'concurrent streams cannot exceed the remaining allowance');
  assert.equal(concurrent.filter(r => r.allowed).length, 2);
  assert.equal((await service.reserveCoachTokens('disabled', 100, 0, { partial: true })).allowed, false);
  await database.ref('users/chatter/usage/1999-01-01/coachTokens').set(3000);
  await service.reconcileCoachTokens(user.uid, -2900, '1999-01-01');
  assert.equal((await database.ref('users/chatter/usage/1999-01-01/coachTokens').get()).val(), 100);
  assert.equal((await database.ref(`users/chatter/usage/${day}/coachTokens`).get()).val(), 100000, 'late settlement stays in the reservation day');
  assert.deepEqual(publicCoachUsage(98961, 100000, day), { coachUsagePercent: 98, coachAvailable: true, day });
  assert.equal(publicCoachUsage(99999, 100000).coachUsagePercent, 99);
  assert.equal(publicCoachUsage(100000, 100000).coachAvailable, false);
  assert.equal(JSON.stringify(publicCoachUsage(98961, 100000)).includes('98961'), false);
  assert.equal(completionCost({ usage: { prompt_tokens: 10000, completion_tokens: 25 } }), 25, 'repeated context is not charged to the daily allowance');
  assert.equal(completionCost({ usage: { completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 30 } } }), 30);
  assert.equal(compactHistory([{ role: 'user', content: 'current' }], 'current').length, 1);
  const compact = compactHistory(Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(4000) })), 'current');
  assert.ok(compact.reduce((n, m) => n + m.content.length, 0) <= 10007);

  const now = Date.now();
  for (const invalid of [{ ...concern, evidence: 'Invented quoted evidence' }, { ...concern, confidence: undefined }, { ...concern, category: 'unrecognized' }]) {
    assert.ok((await recordCoachConcern(invalid, user, context('invalid'), database, now)).error);
  }
  assert.ok((await recordCoachConcern(concern, user, { ...context('1'), text: 'A normal chess question' }, database, now)).error);
  assert.equal((await recordCoachConcern(concern, user, context('1'), database, now)).reported, false);
  assert.equal((await recordCoachConcern(concern, user, context('1'), database, now + 1)).duplicate, true);
  assert.equal((await recordCoachConcern(concern, user, context('2'), database, now + 2)).reported, false);
  assert.equal((await recordCoachConcern({ ...concern, uid: 'victim' }, user, context('3'), database, now + 3)).reported, true);
  assert.equal((await database.ref('abuse/flagged/victim').get()).exists(), false, 'model cannot report another UID');
  assert.equal((await database.ref('users/chatter/profile/ban').get()).exists(), false, 'AI reports never ban accounts');
  assert.equal(Object.keys((await database.ref('abuse/reports').get()).val()).length, 1);
  substitute(servicePath, { ...service, requireUser: async () => ({ uid: 'reporter', email: 'admin@example.test', admin: true }) });
  const abuse = require('../server/api/admin-abuse-report');
  const dismiss = await abuse.handleAbuseAction({ body: JSON.stringify({ uid: user.uid, action: 'dismiss' }) });
  assert.equal(dismiss.statusCode, 200);
  assert.equal(JSON.parse((await abuse.listFlaggedAccounts({})).body).total, 0);
  // New incidents cross chats/process calls; dismissed evidence does not count again.
  const later = now + 16 * 60 * 1000;
  await Promise.all([4, 5, 6].map(i => recordCoachConcern(concern, user, context(i), database, later + i)));
  assert.equal(JSON.parse((await abuse.listFlaggedAccounts({})).body).total, 1, 'new repeated incidents reflag dismissed account');
  assert.equal((await database.ref('abuse/flagged/chatter/dismissedAt').get()).exists(), false);
  assert.equal((await database.ref('abuse/flagged/chatter/count').get()).val(), 1, 'new active incident excludes dismissed report count');
  await abuse.handleAbuseAction({ body: JSON.stringify({ uid: user.uid, action: 'dismiss' }) });
  const manual = await abuse.reportAbuse({ httpMethod: 'POST', headers: { 'x-forwarded-for': '192.0.2.10' }, body: JSON.stringify({
    flaggedEmail: user.email, reason: 'New independently reported incident', details: 'Explicit test evidence.',
  }) });
  assert.equal(manual.statusCode, 200);
  assert.equal(JSON.parse((await abuse.listFlaggedAccounts({})).body).total, 1, 'fresh manual report also reactivates dismissed account');
  const ips = (await database.ref('abuse/ipIndex').get()).val();
  assert.ok(Object.values(ips).every(entry => !entry.uids?.chatter), 'reporter fingerprint is never assigned to the accused');
  await database.ref('users/chatter/profile/subscription').set({ plan: 'max' });
  await database.ref(`users/chatter/usage/${day}`).update({ coachTokens: 592, serverReviews: 3 });
  const usageFlag = JSON.parse((await abuse.listFlaggedAccounts({})).body).flagged.find(entry => entry.uid === user.uid);
  assert.equal(usageFlag.usageScore, 0, '592 Coach units plus 3 reviews are not 595 API requests');
  assert.ok(!usageFlag.usageDetails.some(detail => /API activity|calls today/.test(detail)));
  const offUser = { uid: 'offtopic', email: 'offtopic@example.test' };
  for (let i = 0; i < 5; i++) assert.equal((await recordCoachConcern({ ...concern, category: 'off_topic' }, offUser, context(`off-${i}`), database, now + i)).reported, i === 4);
  assert.equal((await recordCoachConcern(concern, { uid: 'expired' }, context('old'), database, now - 2 * 86400000)).reported, false);
  assert.equal((await recordCoachConcern(concern, { uid: 'expired' }, context('new'), database, now)).reported, false, 'expired warnings cannot trigger a report');

  const llm = require('../server/api/_lib/llm-service');
  const tools = require('../server/api/_lib/coach-tools');
  const calls = [];
  llm.chatCompletion = async options => { calls.push(options); return {}; };
  let rounds = 0;
  llm.streamDeltas = async (_, emit) => {
    rounds++;
    if (rounds === 1) return { content: '', toolCalls: [{ id: 'misuse', name: 'report_coach_misuse', args: concern }], usage: { prompt_tokens: 10000, completion_tokens: 10 } };
    emit('Let us return to chess.');
    return { content: 'Let us return to chess.', toolCalls: [], usage: { prompt_tokens: 12000, completion_tokens: 20 } };
  };
  tools.runServerTool = async (name, args, currentUser, trusted) => {
    assert.equal(trusted.text, evidence);
    return recordCoachConcern(args, currentUser, trusted, database, later + 20);
  };
  const chat = require('../server/api/coach-chat');
  const tokenUsage = { prompt: 0, completion: 0 };
  await chat.runConversation({ res: { write() {} }, llmMessages: chat.buildLlmMessages([], evidence), user,
    context: context('loop'), tokenUsage, outputBudget: 1039, closedRef: () => false,
    onToken() {}, onToolCall() {}, onToolStatus() {}, onToolResultVisible() {} });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].maxTokens, 1039);
  assert.equal(calls[1].maxTokens, 1029, 'all tool rounds share one output budget');
  assert.equal(tokenUsage.completion, 30);
  assert.equal(tokenUsage.prompt, 22000, 'provider input usage remains separately observable');
  console.log('PASS near-limit and concurrent allowances, midnight settlement, output-only accounting, compact context, percentage-only payloads, trusted evidence, cross-chat warnings, dismissal and repeat reports, bounded tool loops');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => database.close());
