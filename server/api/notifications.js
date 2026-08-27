// Notification management.
//
// Endpoints:
//   GET  /api/notifications          — list the latest 20 + unread count
//   POST /api/notifications/mark-all-read — mark every unread notification as read
//   POST /api/notifications/<id>/read     — mark one notification as read
//
// All routes are auth-required. Writes are best-effort — a Firebase write
// failure must NOT block the user's read state on the client (the client
// already optimistically updates).

const { requireUser, initAdmin, json } = require('./_lib/user-service');

function sanitizeId(id) {
  // Notification ids are Firebase push IDs (alphanumeric + -_) — strip anything
  // else to avoid traversal. Reject empty results.
  const clean = String(id || '').replace(/[^A-Za-z0-9_-]/g, '');
  return clean;
}

async function listNotifications(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Use GET.' });
  let user;
  try { user = await requireUser(event); }
  catch (err) { return json(err.statusCode || 500, { error: err.message, code: err.code }); }
  try {
    const { db } = initAdmin();
    const snap = await db.ref(`users/${user.uid}/notifications`).orderByChild('createdAt').limitToLast(20).once('value');
    const list = [];
    let unread = 0;
    snap.forEach((c) => {
      const v = c.val() || {};
      const item = {
        id: c.key,
        type: String(v.type || ''),
        title: String(v.title || ''),
        body: String(v.body || ''),
        link: String(v.link || ''),
        reportId: v.reportId ? String(v.reportId) : null,
        read: v.read === true,
        createdAt: Number(v.createdAt) || 0,
      };
      if (!item.read) unread += 1;
      list.push(item);
    });
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return json(200, { list, unread });
  } catch (err) {
    return json(500, { error: err.message || 'Could not load notifications.' });
  }
}

async function markOneRead(event) {
  // Path is /api/notifications/<id>/read — pulled from the URL rather than the
  // query string so it lines up cleanly with the deep-link routes the bell emits.
  const rawPath = String(event.path || event.rawUrl || '');
  const m = rawPath.match(/\/api\/notifications\/([^/]+)\/read\/?$/i);
  const id = m ? sanitizeId(m[1]) : '';
  if (!id) return json(400, { error: 'Notification id is required.' });
  let user;
  try { user = await requireUser(event); }
  catch (err) { return json(err.statusCode || 500, { error: err.message, code: err.code }); }
  try {
    const { db } = initAdmin();
    // Only update read:true — don't replace other fields in case the notification
    // is still being finalized by the background job.
    await db.ref(`users/${user.uid}/notifications/${id}/read`).set(true);
    return json(200, { success: true, id });
  } catch (err) {
    return json(500, { error: err.message || 'Could not mark notification as read.' });
  }
}

async function markAllRead(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
  let user;
  try { user = await requireUser(event); }
  catch (err) { return json(err.statusCode || 500, { error: err.message, code: err.code }); }
  try {
    const { db } = initAdmin();
    const updates = {};
    const snap = await db.ref(`users/${user.uid}/notifications`).once('value');
    snap.forEach((c) => {
      const v = c.val() || {};
      if (v.read !== true) updates[`users/${user.uid}/notifications/${c.key}/read`] = true;
    });
    if (Object.keys(updates).length) await db.ref().update(updates);
    return json(200, { success: true, updated: Object.keys(updates).length });
  } catch (err) {
    return json(500, { error: err.message || 'Could not mark notifications as read.' });
  }
}

async function deleteOne(event) {
  // Path is /api/notifications/<id> — deletes a single notification.
  const rawPath = String(event.path || event.rawUrl || '');
  const m = rawPath.match(/\/api\/notifications\/([^/]+)\/?$/i);
  const id = m ? sanitizeId(m[1]) : '';
  if (!id) return json(400, { error: 'Notification id is required.' });
  let user;
  try { user = await requireUser(event); }
  catch (err) { return json(err.statusCode || 500, { error: err.message, code: err.code }); }
  try {
    const { db } = initAdmin();
    await db.ref(`users/${user.uid}/notifications/${id}`).remove();
    return json(200, { success: true, id });
  } catch (err) {
    return json(500, { error: err.message || 'Could not delete notification.' });
  }
}

exports.handler = async (event) => {
  const path = String(event.path || event.rawUrl || '');
  if (path.includes('/notifications/mark-all-read')) return markAllRead(event);
  if (/\/notifications\/[^/]+\/read\/?$/i.test(path)) return markOneRead(event);
  if (event.httpMethod === 'DELETE') return deleteOne(event);
  return listNotifications(event);
};