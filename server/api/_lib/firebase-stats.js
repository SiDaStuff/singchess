const crypto = require('crypto');
const https = require('https');

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
    const req = https.request(url, options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = data ? JSON.parse(data) : null;
        } catch (_err) {
          json = null;
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
    req.on('error', reject);
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

function normalizeStats(raw = {}) {
  const hasMovesAnalyzed = Object.prototype.hasOwnProperty.call(raw, 'movesAnalyzed');
  return {
    gamesAnalyzed: Math.max(0, Number(raw.gamesAnalyzed) || 0),
    movesAnalyzed: Math.max(0, Number(hasMovesAnalyzed ? raw.movesAnalyzed : raw.gamesAnalyzed) || 0),
    coachGamesPlayed: Math.max(0, Number(raw.coachGamesPlayed) || 0),
    brilliantMoves: Math.max(0, Number(raw.brilliantMoves) || 0),
    puzzlesSolved: Math.max(0, Number(raw.puzzlesSolved ?? raw.brilliantMoves) || 0),
    siteVisitorsTotal: Math.max(0, Number(raw.siteVisitorsTotal) || 0),
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

async function incrementSiteVisitors(delta = 1) {
  const amount = Math.max(0, Number(delta) || 0);
  if (!amount) return getPublicStats();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const currentResponse = await firebaseRequest('/publicStats.json', {
      method: 'GET',
      headers: { 'X-Firebase-ETag': 'true' },
    });
    const current = normalizeStats(currentResponse.json || {});
    const next = {
      ...current,
      siteVisitorsTotal: current.siteVisitorsTotal + amount,
      updatedAt: Date.now(),
    };
    const body = JSON.stringify(next);
    try {
      await firebaseRequest('/publicStats.json', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'if-match': currentResponse.headers.etag || '*',
        },
      }, body);
      return next;
    } catch (err) {
      if (err.statusCode !== 412 || attempt === 3) throw err;
    }
  }
  return getPublicStats();
}

async function getPublicStats() {
  const response = await firebaseRequest('/publicStats.json', { method: 'GET' });
  return normalizeStats(response.json || {});
}

async function incrementPublicStats(delta = {}) {
  const cleanDelta = {
    gamesAnalyzed: Math.max(0, Number(delta.gamesAnalyzed) || 0),
    movesAnalyzed: Math.max(0, Number(delta.movesAnalyzed) || 0),
    coachGamesPlayed: Math.max(0, Number(delta.coachGamesPlayed) || 0),
    brilliantMoves: Math.max(0, Number(delta.brilliantMoves) || 0),
    puzzlesSolved: Math.max(0, Number(delta.puzzlesSolved) || 0),
  };
  if (!cleanDelta.gamesAnalyzed && !cleanDelta.movesAnalyzed && !cleanDelta.coachGamesPlayed && !cleanDelta.brilliantMoves && !cleanDelta.puzzlesSolved) {
    return getPublicStats();
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const currentResponse = await firebaseRequest('/publicStats.json', {
      method: 'GET',
      headers: { 'X-Firebase-ETag': 'true' },
    });
    const current = normalizeStats(currentResponse.json || {});
    const next = {
      gamesAnalyzed: current.gamesAnalyzed + cleanDelta.gamesAnalyzed,
      movesAnalyzed: current.movesAnalyzed + cleanDelta.movesAnalyzed,
      coachGamesPlayed: current.coachGamesPlayed + cleanDelta.coachGamesPlayed,
      brilliantMoves: current.brilliantMoves + cleanDelta.brilliantMoves,
      puzzlesSolved: current.puzzlesSolved + cleanDelta.puzzlesSolved,
      updatedAt: Date.now(),
    };
    const body = JSON.stringify(next);
    try {
      await firebaseRequest('/publicStats.json', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'if-match': currentResponse.headers.etag || '*',
        },
      }, body);
      return next;
    } catch (err) {
      if (err.statusCode !== 412 || attempt === 3) throw err;
    }
  }
  return getPublicStats();
}

function brilliantMoveStorageKey(rawKey) {
  const value = String(rawKey || '').trim();
  if (!value) return '';
  return crypto.createHash('sha256').update(`brilliant-move:v1:${value}`).digest('hex');
}

async function claimUniqueBrilliantMoves(rawKeys = []) {
  const keys = [...new Set((Array.isArray(rawKeys) ? rawKeys : [])
    .map(brilliantMoveStorageKey)
    .filter(Boolean))];
  let claimed = 0;

  for (const key of keys) {
    const path = `/publicStatsBrilliantMoves/${key}.json`;
    const currentResponse = await firebaseRequest(path, {
      method: 'GET',
      headers: { 'X-Firebase-ETag': 'true' },
    });
    if (currentResponse.json !== null && currentResponse.json !== undefined) continue;

    const body = JSON.stringify(Date.now());
    try {
      await firebaseRequest(path, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'if-match': currentResponse.headers.etag || 'null_etag',
        },
      }, body);
      claimed += 1;
    } catch (err) {
      if (err.statusCode !== 412) throw err;
    }
  }

  return claimed;
}

function clientIpKey(rawIp) {
  return crypto.createHash('sha256').update(`client-ip:v1:${String(rawIp || 'unknown')}`).digest('hex');
}

async function tryClaimRateLimit(bucket, rawIp, windowMs = 5 * 60 * 1000) {
  const cleanBucket = String(bucket || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
  if (!cleanBucket) return false;
  const key = clientIpKey(rawIp);
  const windowId = Math.floor(Date.now() / Math.max(1000, windowMs));
  const path = `/publicStatsRateLimits/${cleanBucket}/${key}_${windowId}.json`;
  const currentResponse = await firebaseRequest(path, {
    method: 'GET',
    headers: { 'X-Firebase-ETag': 'true' },
  });
  if (currentResponse.json !== null && currentResponse.json !== undefined) return false;

  const body = JSON.stringify(Date.now());
  try {
    await firebaseRequest(path, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'if-match': currentResponse.headers.etag || 'null_etag',
      },
    }, body);
    return true;
  } catch (err) {
    if (err.statusCode === 412) return false;
    throw err;
  }
}

module.exports = {
  getPublicStats,
  incrementPublicStats,
  incrementSiteVisitors,
  claimUniqueBrilliantMoves,
  tryClaimRateLimit,
};
