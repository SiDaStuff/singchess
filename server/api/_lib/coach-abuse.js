const crypto = require('node:crypto');
const { initAdmin } = require('./user-service');
const WINDOW = 24 * 60 * 60 * 1000;
const CATEGORIES = new Set(['harassment', 'policy_violation', 'off_topic']);

// Only server-authenticated messages are evidence. Client history and model-supplied
// account identifiers cannot accuse another account. No automatic account bans.
async function recordCoachConcern(args, user, context, database, now = Date.now()) {
  if (!user?.uid || !context?.requestId || !context?.text) return { error: 'Missing trusted message context.' };
  const category = String(args?.category || '');
  const evidence = String(args?.evidence || '').trim().slice(0, 500);
  const reason = String(args?.reason || '').trim().slice(0, 300);
  const confidence = Number(args?.confidence);
  if (!CATEGORIES.has(category) || !Number.isFinite(confidence) || confidence < 0.9 || confidence > 1 || !reason || evidence.length < 8 || !context.text.includes(evidence)) {
    return { error: 'Concern must have high confidence and an exact quote from the current user message.' };
  }
  const db = database || initAdmin().db;
  // Recover all abuse state before the atomic root update; both records and flags
  // are durable and included in the normal Firebase backup outbox.
  const reportId = `coach_${crypto.createHash('sha256').update(`${user.uid}:${context.requestId}`).digest('hex').slice(0, 32)}`;
  let outcome = { recorded: false };
  await db.ref('abuse').transaction(root => {
    const data = root || {};
    data.coach ||= {};
    const state = data.coach[user.uid] ||= {};
    const prior = Object.values(state.events || {}).filter(e => e.at > now - WINDOW);
    if (prior.some(e => e.requestId === context.requestId)) { outcome = { recorded: true, duplicate: true }; return; }
    const at = Math.max(now, (Number(state.lastSeenAt) || 0) + 1);
    const event = { requestId: context.requestId, category, evidence, reason, at };
    const events = [...prior, event].slice(-20);
    state.events = Object.fromEntries(events.map(e => [e.requestId, e]));
    state.lastSeenAt = at;
    const relevant = events.filter(e => e.at > (state.lastReportedAt || 0) &&
      (category === 'off_topic' ? e.category === 'off_topic' : e.category !== 'off_topic'));
    const threshold = category === 'off_topic' ? 5 : 3;
    outcome = { recorded: true, warning: true, reported: false,
      message: 'Please keep this conversation respectful and focused on chess. Repeated misuse may be reported for administrator review.' };
    // Bound automated reporting, while allowing new incidents after dismissal.
    if (relevant.length >= threshold && at - (state.lastReportedAt || 0) >= 15 * 60 * 1000) {
      const reportReason = category === 'off_topic' ? 'Repeated non-chess misuse of AI Coach after redirection' : 'Repeated AI Coach harassment or policy violations';
      data.reports ||= {};
      data.reports[reportId] = { flaggedUid: user.uid, flaggedEmail: user.email || '', reporterUid: 'system:coach',
        reporterEmail: 'AI Coach', source: 'coach', reason: reportReason,
        details: relevant.map(e => `${e.category}: ${e.reason}\nUser: ${e.evidence}`).join('\n\n').slice(0, 2400),
        reportedAt: at, dismissed: false };
      data.flagged ||= {};
      data.flagged[user.uid] = aggregateFlag(data.flagged[user.uid], { reason: reportReason, reporter: 'AI Coach', email: user.email, now: at });
      state.lastReportedAt = at;
      outcome.reported = true;
    }
    return data;
  });
  return outcome;
}
function aggregateFlag(current, { reason, reporter, email, now = Date.now() }) {
  const data = { ...(current || {}) };
  if (data.dismissedAt) {
    data.count = 0; data.reasons = []; data.flaggedBy = []; data.firstReportedAt = now;
  }
  data.count = (Number(data.count) || 0) + 1;
  data.reasons = [...(Array.isArray(data.reasons) ? data.reasons : []), reason].slice(-20);
  data.flaggedBy = [...(Array.isArray(data.flaggedBy) ? data.flaggedBy : []), reporter].slice(-20);
  data.firstReportedAt ||= now;
  data.lastReportedAt = Math.max(now, (Number(data.dismissedAt) || 0) + 1);
  if (email) data.flaggedEmail = email;
  // Dismissal applies to past incidents. The audit remains in abuse/actions.
  delete data.dismissedAt;
  delete data.dismissedBy;
  return data;
}
module.exports = { recordCoachConcern, aggregateFlag };
