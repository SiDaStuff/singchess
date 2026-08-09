const https = require('https');

// ── reCAPTCHA v3 server-side verification ─────────────────────────────────
//
// Calls https://www.google.com/recaptcha/api/siteverify with the shared secret
// and the token the browser generated. Uses native https.request rather than
// fetch-compat because (a) Google isn't in the SSRF allowlist (the URL is not
// user-controlled here, but we want a clean separation), and (b) the call has
// tight latency expectations on signup, and https.request is fastest.
//
// Honors RECAPTCHA_DISABLED=1 as a dev escape hatch — returns ok without any
// network call. DO NOT set this in production.
//
// Score threshold: Google recommends 0.5 as a safe starting point for v3;
// adjust in one place below if traffic patterns warrant it.

const SCORE_THRESHOLD = 0.5;
const VERIFY_HOST = 'www.google.com';
const VERIFY_PATH = '/recaptcha/api/siteverify';
const REQUEST_TIMEOUT_MS = 3000;

function readSecret() {
  return process.env.RECAPTCHA_SECRET || '';
}

function isDisabled() {
  return process.env.RECAPTCHA_DISABLED === '1';
}

function postForm(params) {
  const body = params
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'POST',
      host: VERIFY_HOST,
      path: VERIFY_PATH,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: REQUEST_TIMEOUT_MS,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (_e) { parsed = null; }
        resolve({ statusCode: res.statusCode, json: parsed });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`reCAPTCHA verify timed out after ${REQUEST_TIMEOUT_MS}ms`)));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Verify a reCAPTCHA v3 token.
// Returns { ok, score, action, errorCodes } — the caller decides what to do.
// Never throws; treat transport errors as not-ok so the caller can reject.
async function verify(token, expectedAction) {
  if (isDisabled()) {
    return { ok: true, score: 1, action: expectedAction || '', errorCodes: [], disabled: true };
  }
  const trimmed = String(token || '').trim();
  if (!trimmed) return { ok: false, score: 0, action: '', errorCodes: ['missing-input-response'] };

  const secret = readSecret();
  if (!secret) {
    // No secret configured = treat as disabled. Returning false would lock
    // everyone out the moment a deploy forgets the env var.
    return { ok: true, score: 1, action: expectedAction || '', errorCodes: [], disabled: true };
  }

  let res;
  try {
    res = await postForm([
      ['secret', secret],
      ['response', trimmed],
    ]);
  } catch (err) {
    return { ok: false, score: 0, action: '', errorCodes: ['network-error'] };
  }

  const body = res.json || {};
  const success = body.success === true;
  const action = typeof body.action === 'string' ? body.action : '';
  const score = Number.isFinite(body.score) ? body.score : 0;
  const errorCodes = Array.isArray(body['error-codes']) ? body['error-codes'] : [];

  const actionMatches = expectedAction ? action === expectedAction : true;
  const scoreOk = success && score >= SCORE_THRESHOLD;
  const ok = scoreOk && actionMatches;

  return { ok, score, action, errorCodes };
}

module.exports = { verify, SCORE_THRESHOLD };
