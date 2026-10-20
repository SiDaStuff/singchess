const { json } = require('./_lib/user-service');

// POST /api/signup-verify — pre-flight check before Firebase account creation.
//
// Firebase creates users client-side (firebase.auth().createUserWithEmailAndPassword),
// so we can't intercept the actual create. This endpoint still rejects an invalid
// email before the client makes the Firebase call. Commodity-bot abuse is bound
// by the in-memory writeLimit (45/min/IP) mounted in server/index.cjs.
//
// We deliberately do NOT add a longer-window per-IP bucket here: the
// rate-limit primitive in firebase-stats is "1 attempt per window per IP"
// (ETag-based first-claim-wins), which would lock a fat-fingered legit user
// out for an hour.
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
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json(400, { error: 'A valid email is required.' });
    }

    return json(200, { ok: true });
  } catch (err) {
    return json(500, { error: 'Could not verify signup right now.' });
  }
};