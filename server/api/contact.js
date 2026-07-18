const { initAdmin, json, requireUser } = require('./_lib/user-service');

// Extract the originating IP for per-IP rate limiting (respects XFF only when
// the server is behind a trusted proxy — see TRUST_PROXY in server/index.cjs).
function clientIp(event) {
  const h = event.headers || {};
  return String(h['x-forwarded-for'] || h['x-real-ip'] || '').split(',')[0].trim() || 'unknown';
}

// POST /api/contact — saves a contact/support message to Firebase support/{id}.
//
// Signed-in users: their verified JWT email is the sender (trusted). Anonymous
// submissions are allowed but (a) capped to 3/day per IP and (b) stored with an
// `anonymous: true` flag so the admin inbox never displays an attacker-supplied
// email as if it were a verified sender (no impersonation). A body `email` from
// an anonymous submitter is stored as an optional `contactEmail` hint only.
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

    const reason = String(payload.reason || 'general').trim().slice(0, 40);
    const message = String(payload.message || '').trim();
    if (message.length < 5) return json(400, { error: 'Please enter a message (at least a few words).' });

    // Resolve the sender: prefer a verified signed-in user; fall back to anonymous.
    let uid = null;
    let senderEmail = '';
    let anonymous = true;
    try {
      const user = await requireUser(event);
      if (user?.uid) { uid = user.uid; senderEmail = user.email || ''; anonymous = false; }
    } catch (_err) { /* anonymous submission */ }

    if (anonymous) {
      // Per-IP daily cap on anonymous contact to prevent inbox/DB flooding.
      const { tryClaimRateLimit } = require('./_lib/firebase-stats');
      const allowed = await tryClaimRateLimit('contact_anon', clientIp(event), 24 * 60 * 60 * 1000).catch(() => true);
      if (!allowed) return json(429, { error: 'You\'ve sent a few messages already today. Please try again tomorrow.' });
    }

    // An anonymous submitter's body email is an unverified hint only — never the
    // trusted sender. Validate it lightly if present.
    const contactEmail = anonymous ? String(payload.email || '').trim().toLowerCase() : '';
    if (contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
      return json(400, { error: 'A valid email is required.' });
    }

    const { admin: firebaseAdmin, db: database } = initAdmin();
    const ref = database.ref('support').push();
    await ref.set({
      email: senderEmail || (contactEmail || ''),
      anonymous,
      contactEmail: anonymous ? contactEmail : '',
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
