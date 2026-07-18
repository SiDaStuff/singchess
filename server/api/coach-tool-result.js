// Receives a browser-tool result from the client (the stockfish tool runs in
// the browser via this.engine.evaluate). Resolves the parked SSE stream in
// coach-chat.js so the LLM conversation can continue.

const { requireUser, json } = require('./_lib/user-service');
const coachChat = require('./coach-chat');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
  try {
    // Auth: the resolver must be the SAME user who owns the pending call.
    // resolveToolCall binds callId -> uid, so a signed-in user can only resolve
    // their OWN coach tool calls (no cross-user poisoning/quota theft).
    const user = await requireUser({ headers: event.headers || {} });

    let body = {};
    try { body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {}); }
    catch (_) { return json(400, { error: 'Invalid JSON body.' }); }

    const callId = String(body.callId || '').trim();
    const result = body.result && typeof body.result === 'object' ? body.result : { value: body.result };
    if (!callId) return json(400, { error: 'Missing callId.' });

    const outcome = coachChat.resolveToolCall(callId, result, user.uid);
    if (outcome === 'forbidden') {
      // Tried to resolve another user's call — do NOT resolve it. Return a
      // generic "not found" so the existence/ownership of others' calls isn't
      // leaked, but log it server-side for monitoring.
      console.warn(`[coach] forbidden tool-result resolve: uid=${user.uid} callId=${callId}`);
      return json(404, { ok: false, note: 'No pending tool call for that id (it may have timed out).' });
    }
    if (outcome === 'not_found') {
      return json(200, { ok: false, note: 'No pending tool call for that id (it may have timed out).' });
    }
    return json(200, { ok: true });
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || 'Could not submit tool result.', code: err.code });
  }
};
