const crypto = require('crypto');
const https = require('https');

// Keep-alive agent: RTDB REST calls previously opened a FRESH TCP+TLS
// connection per request (default globalAgent historically had keepAlive off
// for https). Every first-of-burst request then paid DNS + TCP + TLS from
// scratch — on a flaky resolver/IPv6 path that's a multi-second stall that
// showed up as 5s+ latency on /api/public-stats. The agent caps sockets so
// bursts reuse a small warm pool instead of stacking handshakes.
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 8,
  // Prefer IPv4 first: Node tries addresses in DNS order (RTDB answers AAAA
  // first), and a broken/black-holed IPv6 path costs a full SYN timeout per
  // fresh connection. autoSelectFamily (happy eyeballs) already races
  // families per connection; this hint further avoids bad paths.
  family: 0,
});

let cachedToken = null;

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function parseServiceAccount() {
  const raw = process.env.service_account
    || process.env.SERVICE_ACCOUNT
    || process.env.FIREBASE_SERVICE_ACCOUNT
    || '';
  if (!raw) throw new Error('Missing service_account environment variable.');

  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Firebase service account is missing client_email or private_key.');
  }
  return {
    ...parsed,
    private_key: String(parsed.private_key).replace(/\\n/g, '\n'),
  };
}

function databaseUrl() {
  const raw = process.env.realtime_database_url
    || process.env.REALTIME_DATABASE_URL
    || process.env.FIREBASE_DATABASE_URL
    || '';
  return raw.replace(/\/+$/, '');
}

function requestJson(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { agent: keepAliveAgent, ...options }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = data ? JSON.parse(data) : null;
        } catch (_err) {
          reject(new Error('Firebase backup returned invalid JSON.'));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = new Error(json?.error_description || json?.error || data || `HTTP ${res.statusCode}`);
          error.statusCode = res.statusCode;
          error.headers = res.headers;
          reject(error);
          return;
        }
        resolve({ json, headers: res.headers, statusCode: res.statusCode });
      });
    });
    req.on('response', res => {
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('Firebase backup response was interrupted.')));
    });
    req.on('error', reject);
    const deadline = setTimeout(() => req.destroy(new Error('Firebase backup request timed out')), 20000);
    deadline.unref();
    req.on('close', () => clearTimeout(deadline));
    // Bound every REST call: an unbounded hang here held API responses open
    // indefinitely (morgan showed multi-second/never-ending requests).
    req.setTimeout(15000, () => req.destroy(new Error('Firebase REST request timed out')));
    if (body) req.write(body);
    req.end();
  });
}

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.token;
  }

  const serviceAccount = parseServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(unsigned)
    .sign(serviceAccount.private_key, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const assertion = `${unsigned}.${signature}`;
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }).toString();

  const response = await requestJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);

  cachedToken = {
    token: response.json.access_token,
    expiresAt: Date.now() + ((response.json.expires_in || 3600) * 1000),
  };
  return cachedToken.token;
}

async function firebaseRequest(path, options = {}, body = null) {
  const root = databaseUrl();
  if (!root) throw new Error('Missing realtime_database_url environment variable.');
  const token = await accessToken();
  const separator = path.includes('?') ? '&' : '?';
  return requestJson(`${root}${path}${separator}access_token=${encodeURIComponent(token)}`, options, body);
}

function remotePath(path) {
  return '/' + String(path || '').split('/').filter(Boolean).map(encodeURIComponent).join('/') + '.json';
}
async function read(path) {
  return (await firebaseRequest(remotePath(path), { method: 'GET' })).json;
}
async function writeBatch(updates) {
  const body = JSON.stringify(updates);
  await firebaseRequest('/.json', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, body);
}
module.exports = { read, writeBatch };
