const { initAdmin, json, requireUser } = require('./_lib/user-service');

// POST /api/contact — saves a contact/support message to Firebase support/{id}.
// Auth is OPTIONAL: capture uid/email if the user is signed in, but allow
// anonymous (logged-out) submissions too. Rate-limited per-IP by the Express
// middleware (writeLimit) registered on the route.
exports.handler = async (event = {}) => {
  try {
    if (event.httpMethod === 'OPTIONS') return json(200, {});
    if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });

    let payload = {};
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (_err) {
      return json(400, { error: 'Invalid JSON body.' });
    }

    const email = String(payload.email || '').trim().toLowerCase();
    const reason = String(payload.reason || 'general').trim().slice(0, 40);
    const message = String(payload.message || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'A valid email is required.' });
    if (message.length < 5) return json(400, { error: 'Please enter a message (at least a few words).' });

    // Capture the signed-in uid/email if a valid token is present (optional).
    let uid = null;
    try {
      const user = await requireUser(event);
      if (user?.uid) uid = user.uid;
    } catch (_err) { /* anonymous submission */ }

    const { admin: firebaseAdmin, db: database } = initAdmin();
    const ref = database.ref('support').push();
    await ref.set({
      email,
      reason,
      message: message.slice(0, 4000),
      uid,
      createdAt: firebaseAdmin.database.ServerValue.TIMESTAMP,
      resolved: false,
    });

    return json(200, { success: true, id: ref.key });
  } catch (err) {
    return json(500, { error: 'Could not send message right now.' });
  }
};
