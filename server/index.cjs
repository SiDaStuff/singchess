// Express wrapper that invokes existing server API handlers
const express = require('express');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
try {
  // Read the repo-root .env (same file Vite reads). Previously this pointed at
  // server/.env, which doesn't exist — server-only secrets like GROQ_API_KEY
  // would never have loaded. Fall back to server/.env if the root is absent.
  const rootEnv = path.resolve(__dirname, '..', '.env');
  require('dotenv').config({ path: fs.existsSync(rootEnv) ? rootEnv : path.resolve(__dirname, '.env') });
} catch (e) {
  // ignore if dotenv not installed
}

const analyzeFn = require('./api/analyze.js');
const anticheatFn = require('./api/anticheat.js');
const getPuzzleFn = require('./api/get-puzzle.js');
const recentGamesFn = require('./api/recent-games.js');
const recordPuzzleAttemptFn = require('./api/record-puzzle-attempt.js');
const puzzleSolveFn = require('./api/puzzle-solve.js');
const usersMeFn = require('./api/users-me.js');
const profileFn = require('./api/profile.js');
const giftBoostFn = require('./api/gift-boost.js');
const adminPlansFn = require('./api/admin-plans.js');
const contactFn = require('./api/contact.js');
const publicStatsFn = require('./api/public-stats.js');
const adminBanUserFn = require('./api/admin-ban-user.js');
const usersMeStreamFn = require('./api/users-me-stream.js');
const banStatusFn = require('./api/ban-status.js');
const adminDashboardFn = require('./api/admin-dashboard.js');
const siteVisitFn = require('./api/site-visit.js');
const coachChatFn = require('./api/coach-chat.js');
const coachToolResultFn = require('./api/coach-tool-result.js');
const openingExplorerFn = require('./api/opening-explorer.js');

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE_URL = process.env.API_BASE_URL || '';
const publicDir = path.resolve(__dirname, '../public');
const distDir = path.resolve(__dirname, '../dist');
const serveStatic = process.env.SERVE_STATIC !== '0';
const isDev = process.env.NODE_ENV === 'development' || process.env.CHESS_REVIEW_DEV_SERVER === '1';
const allowedOrigins = new Set(['https://chess.sidastuff.com', 'https://chess.singdevelopments.com']);
// Localhost origins are always safe to allow: browsers never send Origin:localhost
// to a real production domain, and they're necessary for direct :3000 access
// during dev, health checks, or local preview of the production build.
['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173']
  .forEach((origin) => allowedOrigins.add(origin));
if (isDev) {
  // Extra dev-only origins (e.g. HTTPS localtunnel / ngrok) can go here.
}
const rateBuckets = new Map();

function originAllowed(origin, host) {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  // Security: Only allow explicitly configured origins, not any matching hostname
  // The previous logic allowed any origin with matching hostname which is unsafe
  return false;
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (originAllowed(origin, req.headers.host) && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Trust the left-most X-Forwarded-For entry only when explicitly behind a
// trusted proxy (TRUST_PROXY=1). Otherwise use the raw socket address —
// blindly trusting XFF lets an attacker rotate the header to bypass every
// rate limit and bloat the buckets Map (one entry per spoofed value).
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || isDev;

function clientKey(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') {
      const first = xff.split(',')[0].trim();
      if (first) return first;
    }
  }
  return req.socket?.remoteAddress || 'unknown';
}

function rateLimit({ windowMs, max, label }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${label}:${clientKey(req)}`;
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      _maybePruneRateBuckets(now);
      return next();
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
    }
    return next();
  };
}

// Periodically drop expired buckets so the Map can't grow without bound.
// Runs at most every 60s, triggered by rate-limit traffic (no timer needed).
let _lastBucketPrune = 0;
function _maybePruneRateBuckets(now) {
  if (now - _lastBucketPrune < 60000) return;
  _lastBucketPrune = now;
  for (const [k, b] of rateBuckets) {
    if (b.resetAt <= now) rateBuckets.delete(k);
  }
}

app.use(morgan('tiny'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Security headers ─────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Strict Transport Security (1 year)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return next();
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    applyCors(req, res);
    if (!originAllowed(req.headers.origin, req.headers.host)) {
      return res.status(403).json({ error: 'Origin is not allowed.' });
    }
  }
  return next();
});

function makeEvent(req) {
  return {
    httpMethod: req.method,
    headers: req.headers || {},
    body: (req.body === undefined || req.body === null) ? undefined : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)),
    queryStringParameters: Object.keys(req.query || {}).length ? req.query : undefined,
    path: req.path,
    rawUrl: req.originalUrl,
  };
}

function forwardResult(res, result) {
  if (!result) {
    res.sendStatus(204);
    return;
  }
  if (result.headers) {
    try {
      const headers = { ...result.headers };
      if (headers['Access-Control-Allow-Origin'] === '*') delete headers['Access-Control-Allow-Origin'];
      if (headers['access-control-allow-origin'] === '*') delete headers['access-control-allow-origin'];
      res.set(headers);
    } catch (e) {}
  }
  const status = result.statusCode || 200;
  const body = result.body;
  if (typeof body === 'string' && res.get('Content-Type') && res.get('Content-Type').includes('application/json')) {
    try {
      const parsed = JSON.parse(body);
      return res.status(status).json(parsed);
    } catch (e) {
      // fall through
    }
  }
  if (typeof body === 'string') return res.status(status).send(body);
  return res.status(status).json(body);
}

function wrapHandler(fn) {
  return async (req, res) => {
    try {
      const event = makeEvent(req);
      const result = await fn.handler(event, {});
      forwardResult(res, result);
    } catch (err) {
      console.error('Handler error:', err);
      res.status(500).json({ error: err.message || 'Server error' });
    }
  };
}

// Allow CORS preflight for APIs
app.options('/api/*', (req, res) => {
  res.sendStatus(200);
});

const gentleApiLimit = rateLimit({ windowMs: 60 * 1000, max: 180, label: 'api' });
const analysisLimit = rateLimit({ windowMs: 60 * 1000, max: 12, label: 'analysis' });
const writeLimit = rateLimit({ windowMs: 60 * 1000, max: 45, label: 'write' });

app.use('/api', gentleApiLimit);
app.post('/api/analyze', analysisLimit, wrapHandler(analyzeFn));
app.post('/api/analyze/stream', analysisLimit, analyzeFn.streamHandler);
app.post('/api/anticheat', analysisLimit, wrapHandler(anticheatFn));
app.post('/api/anticheat/stream', analysisLimit, anticheatFn.streamHandler);
app.get('/api/puzzle', wrapHandler(getPuzzleFn));
app.get('/api/recent-games', wrapHandler(recentGamesFn));
app.get('/api/opening-explorer', wrapHandler(openingExplorerFn));
app.get('/api/public-stats', wrapHandler(publicStatsFn));
app.post('/api/public-stats', writeLimit, wrapHandler(publicStatsFn));
app.post('/api/puzzle/solve', writeLimit, wrapHandler(puzzleSolveFn));
app.post('/api/record-puzzle-attempt', writeLimit, wrapHandler(recordPuzzleAttemptFn));
app.post('/api/auth/ban-status', writeLimit, wrapHandler(banStatusFn));
app.get('/api/users/me', wrapHandler(usersMeFn));
app.get('/api/profile/:username', profileFn.expressHandler);
app.get('/api/profile', wrapHandler(profileFn));
app.post('/api/users/me', writeLimit, wrapHandler(usersMeFn));
app.get('/api/users/me/stream', usersMeStreamFn.streamHandler);
app.post('/api/coach/chat', writeLimit, coachChatFn.streamHandler);
app.post('/api/coach/tool-result', writeLimit, wrapHandler(coachToolResultFn));
app.post('/api/admin/gift-boost', writeLimit, wrapHandler(giftBoostFn));
app.post('/api/admin/remove-subscription', writeLimit, wrapHandler(adminPlansFn.removeSubscriptionHandler));
app.post('/api/admin/ban-user', writeLimit, wrapHandler(adminBanUserFn));
app.get('/api/admin/support', wrapHandler(adminPlansFn.supportListHandler));
app.post('/api/admin/support/delete', writeLimit, wrapHandler(adminPlansFn.supportDeleteHandler));
app.post('/api/contact', writeLimit, wrapHandler(contactFn));
app.post('/api/site/visit', writeLimit, wrapHandler(siteVisitFn));
app.get('/api/admin/dashboard', wrapHandler(adminDashboardFn));
app.post('/api/admin/dashboard', writeLimit, wrapHandler(adminDashboardFn));

app.get('/health', (req, res) => res.json({ ok: true }));

if (serveStatic) {
  const staticDir = isDev || !fs.existsSync(distDir) ? publicDir : distDir;
  // Serve the server-vendored Stockfish WASM files at /vendor/ so the browser
  // worker can load them from the backend (even when the frontend is on Netlify
  // and the static assets are served elsewhere). Files live in
  // server/vendor/stockfish/ after a successful npm run stockfish:copy on the
  // host. Must include CORS headers because the frontend is on a different
  // origin (chess.singdevelopments.com) when deployed to Netlify.
  const vendorDir = path.resolve(__dirname, 'vendor');
  if (fs.existsSync(vendorDir)) {
    app.use('/vendor', (req, res, next) => {
      const origin = req.headers.origin;
      if (origin && originAllowed(origin, req.headers.host)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      // Override the default Cache-Control for WASM files (express.static sets
      // 1h by default; wasm files are immutable once downloaded).
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      next();
    });
    // Ensure WASM files are served with the correct MIME type (Express's built-in
    // mime types may not include application/wasm in older versions, causing
    // WebAssembly.instantiateStreaming to fail with "Incorrect response MIME type").
    express.static.mime.define({ 'application/wasm': ['wasm'] });
    app.use('/vendor', express.static(vendorDir, {
      etag: true,
      maxAge: '1h',
      setHeaders(res, filePath) {
        // Explicit WASM MIME guard — some Express/mime versions still map .wasm
        // to application/octet-stream, which breaks instantiateStreaming.
        if (path.extname(filePath).toLowerCase() === '.wasm') {
          res.setHeader('Content-Type', 'application/wasm');
        }
      },
    }));
  }
  const staticIndexPath = path.join(staticDir, 'index.html');
  const apiConfigScript = API_BASE_URL
    ? `<script>window.__API_CONFIG={baseUrl:'${API_BASE_URL.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'}</script>`
    : '';

  // Cache the API-config-injected index.html so we don't fs.readFileSync it on
  // every homepage request (the previous version blocked the event loop each hit).
  let cachedIndexHtml = null;
  let cachedIndexHtmlPath = null;

  app.use((req, res, next) => {
    if (apiConfigScript && req.path === '/') {
      const sendFile = res.sendFile.bind(res);
      res.sendFile = (filePath, opts, cb) => {
        if (typeof filePath === 'string' && filePath.endsWith('index.html')) {
          try {
            if (cachedIndexHtmlPath !== filePath || cachedIndexHtml === null) {
              const original = fs.readFileSync(filePath, 'utf8');
              cachedIndexHtml = original.replace('</head>', apiConfigScript + '</head>');
              cachedIndexHtmlPath = filePath;
            }
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(cachedIndexHtml);
          } catch (err) {
            return sendFile(filePath, opts, cb);
          }
        }
        return sendFile(filePath, opts, cb);
      };
    }
    next();
  });

  app.use(express.static(staticDir, {
    etag: true,
    maxAge: isDev ? 0 : '1h',
    setHeaders(res, filePath) {
      if (path.basename(filePath) === 'index.html') {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  }));

  // Rate-limit SPA catch-all to avoid filesystem DoS from unauthenticated requests
  const spaLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' },
  });
  app.get('*', spaLimiter, (req, res, next) => {
    if (req.path.startsWith('/api/') || path.extname(req.path)) return next();
    res.set('Cache-Control', 'no-store');
    return res.sendFile(staticIndexPath);
  });
}

app.listen(PORT, () => {
  const mode = serveStatic ? 'web/API' : 'API';
  console.log(`${mode} server listening at http://localhost:${PORT}`);
});
