const { requireUser, initAdmin } = require('./_lib/user-service');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function cleanChats(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 50).map((chat) => ({
    id: String(chat?.id || '').slice(0, 80),
    title: String(chat?.title || 'New chat').slice(0, 80),
    createdAt: Number(chat?.createdAt) || Date.now(),
    updatedAt: Number(chat?.updatedAt) || Number(chat?.createdAt) || Date.now(),
    pinned: !!chat?.pinned,
    archived: !!chat?.archived,
    locked: !!chat?.locked,
    mode: ['ask', 'position', 'study', 'opening'].includes(chat?.mode) ? chat.mode : 'ask',
    detail: ['quick', 'standard', 'detailed'].includes(chat?.detail) ? chat.detail : 'standard',
    positionContext: chat?.positionContext && typeof chat.positionContext === 'object' ? chat.positionContext : null,
    reviewContext: chat?.reviewContext && typeof chat.reviewContext === 'object' ? chat.reviewContext : null,
    messages: Array.isArray(chat?.messages) ? chat.messages.slice(-100).map((message) => ({
      role: ['user', 'assistant', 'error'].includes(message?.role) ? message.role : 'user',
      content: String(message?.content || '').slice(0, 12000),
      ts: Number(message?.ts) || Date.now(),
      feedback: ['up', 'down'].includes(message?.feedback) ? message.feedback : undefined,
    })) : [],
  })).filter((chat) => chat.id);
}

exports.handler = async (event) => {
  try {
    const user = await requireUser(event);
    const { db } = initAdmin();
    const ref = db.ref(`users/${user.uid}/coachConversations`);
    if (event.httpMethod === 'GET') {
      const snap = await ref.once('value');
      return json(200, { chats: cleanChats(snap.val()?.chats), preferences: snap.val()?.preferences || {}, updatedAt: Number(snap.val()?.updatedAt) || 0 });
    }
    if (event.httpMethod === 'PUT' || event.httpMethod === 'POST') {
      let body = {}; try { body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {}); } catch {}
      const chats = cleanChats(body.chats);
      const updatedAt = Date.now();
      const preferences = body.preferences && typeof body.preferences === 'object' ? {
        rating: String(body.preferences.rating || '').slice(0, 20),
        openings: String(body.preferences.openings || '').slice(0, 300),
        style: String(body.preferences.style || '').slice(0, 40),
      } : {};
      await ref.set({ chats, preferences, updatedAt });
      return json(200, { saved: true, updatedAt, count: chats.length });
    }
    return json(405, { error: 'Use GET or POST.' });
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || 'Could not sync Coach conversations.', code: err.code });
  }
};
