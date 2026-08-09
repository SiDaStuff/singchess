const { json } = require('./_lib/user-service');
const { verify: verifyRecaptcha } = require('./_lib/recaptcha');

// POST /api/signup-verify — gate account creation behind a reCAPTCHA check.
//
// Firebase creates users client-side (firebase.auth().createUserWithEmailAndPassword),
// so we can't intercept the actual create. We CAN however reject the client
// before it makes the Firebase call — that's enough to stop commodity bots. A
// determined attacker who repackages the client can skip this, but the in-memory
// writeLimit (45/min/IP) mounted in server/index.cjs and reCAPTCHA's scoring
// still bound their damage.
//
// We deliberately do NOT add a longer-window per-IP bucket here: the
// rate-limit primitive in firebase-stats is "1 attempt per window per IP"
// (ETag-based first-claim-wins), which would lock a fat-fingered legit user
// out for an hour. The combination of writeLimit + reCAPTCHA score is the gate.
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

    const recaptchaToken = String(payload.recaptchaToken || '');
    const result = await verifyRecaptcha(recaptchaToken, 'signup');
    if (!result.ok) {
      return json(400, { error: 'Captcha verification failed.' });
    }

    return json(200, { ok: true });
  } catch (err) {
    return json(500, { error: 'Could not verify signup right now.' });
  }
};