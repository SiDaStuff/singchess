// Express wrapper that invokes existing server API handlers
const express = require('express');
// NOTE: express-rate-limit is intentionally NOT used — a hand-rolled limiter
// (makeRateLimiter below) covers every route. Don't re-add the import.
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
const signupVerifyFn = require('./api/signup-verify.js');
const publicStatsFn = require('./api/public-stats.js');
const adminBanUserFn = require('./api/admin-ban-user.js');
const usersMeStreamFn = require('./api/users-me-stream.js');
const banStatusFn = require('./api/ban-status.js');
const adminDashboardFn = require('./api/admin-dashboard.js');
const siteVisitFn = require('./api/site-visit.js');
const coachChatFn = require('./api/coach-chat.js');
const coachOverviewFn = require('./api/coach-overview.js');
const coachToolResultFn = require('./api/coach-tool-result.js');
const openingExplorerFn = require('./api/opening-explorer.js');
const adminAbuseReportFn = require('./api/admin-abuse-report.js');
const notificationsFn = require('./api/notifications.js');

function generateDeviceId() {
  const bytes = require('crypto').randomBytes(16);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function deviceCookieMiddleware(req, res, next) {
  const cookie = require('cookie');
  const parsed = cookie.parse(req.headers.cookie || '');
  let deviceId = parsed.sid_device;
  if (!deviceId || !/^[0-9a-f]{32}$/i.test(deviceId)) {
    deviceId = generateDeviceId();
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const cookieOptions = [
      'sid_device=' + deviceId,
      'Max-Age=31536000',
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      isSecure ? 'Secure' : '',
    ].filter(Boolean).join('; ');
    res.setHeader('Set-Cookie', cookieOptions);
  }
  req.sidDeviceId = deviceId;
  next();
}

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

// Trust the client IP only when explicitly behind a trusted proxy
// (TRUST_PROXY=1). Otherwise use the raw socket address — blindly trusting
// XFF lets an attacker rotate the header to bypass every rate limit and
// bloat the buckets Map (one entry per spoofed value).
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || isDev;

function clientKey(req) {
  if (TRUST_PROXY) {
    // nginx ($proxy_add_x_forwarded_for) APPENDS the real client IP to any
    // client-supplied XFF entries, so the FIRST entry is attacker-controlled
    // (rotating it handed out a fresh rate-limit bucket per request). Prefer
    // the proxy-set x-real-ip, else the LAST XFF entry (the one our own proxy
    // appended), else fall back to the socket address.
    const realIp = req.headers['x-real-ip'];
    if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') {
      const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
  }
  return req.socket?.remoteAddress || 'unknown';
}

function makeRateLimiter({ windowMs, max, label }) {
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
app.use(deviceCookieMiddleware);
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
    sidDeviceId: req.sidDeviceId || '',
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

// Validate that a handler module exports a callable .handler before the
// request reaches the route, so a missing/mis-named export surfaces as a
// 500 rather than a "fn.handler is not a function" stack trace in the logs.
function wrapHandler(fn) {
  if (!fn || typeof fn.handler !== 'function') {
    return (req, res) => {
      console.error('wrapHandler: module has no .handler export');
      res.status(500).json({ error: 'Server handler misconfigured.' });
    };
  }
  return (req, res, next) => {
    Promise.resolve()
      .then(() => {
        const event = makeEvent(req);
        return fn.handler(event, {});
      })
      .then((result) => {
        if (res.headersSent) return;
        forwardResult(res, result);
      })
      .catch((err) => {
        // Defer to the Express error handler so a single catch + format path
        // (the global error-handler below) covers both sync throws and async
        // rejections — no "unhandled promise rejection" noise.
        next(err);
      });
  };
}

// Global Express error handler — registered below AFTER all routes.

// Allow CORS preflight for APIs
app.options('/api/*', (req, res) => {
  res.sendStatus(200);
});

const gentleApiLimit = makeRateLimiter({ windowMs: 60 * 1000, max: 180, label: 'api' });
const analysisLimit = makeRateLimiter({ windowMs: 60 * 1000, max: 12, label: 'analysis' });
const writeLimit = makeRateLimiter({ windowMs: 60 * 1000, max: 45, label: 'write' });
// Coach chat can issue a burst of small requests during a normal conversation
// (streaming chunks, tool calls, follow-ups). Give it its own bucket so it
// doesn't share the tight writeLimit with mutations like puzzle solves.
const coachLimit = makeRateLimiter({ windowMs: 60 * 1000, max: 120, label: 'coach' });

app.use('/api', gentleApiLimit);
app.post('/api/analyze', analysisLimit, wrapHandler(analyzeFn));
app.post('/api/analyze/stream', analysisLimit, analyzeFn.streamHandler);
app.post('/api/anticheat', analysisLimit, wrapHandler(anticheatFn));
app.post('/api/anticheat/stream', analysisLimit, anticheatFn.streamHandler);
app.post('/api/anticheat/submit', analysisLimit, wrapHandler({ handler: anticheatFn.submit }));
app.get('/api/anticheat/status', wrapHandler({ handler: anticheatFn.status }));
app.get('/api/anticheat/list', wrapHandler({ handler: anticheatFn.list }));
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
app.post('/api/coach/chat', coachLimit, coachChatFn.streamHandler);
app.post('/api/coach/overview', coachLimit, coachOverviewFn.streamHandler);
app.post('/api/coach/tool-result', coachLimit, wrapHandler(coachToolResultFn));
app.post('/api/admin/gift-boost', writeLimit, wrapHandler(giftBoostFn));
app.post('/api/admin/remove-subscription', writeLimit, wrapHandler(adminPlansFn.removeSubscriptionHandler));
app.post('/api/admin/ban-user', writeLimit, wrapHandler(adminBanUserFn));
app.get('/api/admin/support', wrapHandler(adminPlansFn.supportListHandler));
app.post('/api/admin/support/delete', writeLimit, wrapHandler(adminPlansFn.supportDeleteHandler));
app.post('/api/contact', writeLimit, wrapHandler(contactFn));
app.post('/api/signup-verify', writeLimit, wrapHandler(signupVerifyFn));
app.post('/api/site/visit', writeLimit, wrapHandler(siteVisitFn));
app.get('/api/admin/dashboard', wrapHandler(adminDashboardFn));
app.post('/api/admin/dashboard', writeLimit, wrapHandler(adminDashboardFn));
app.post('/api/report-abuse', writeLimit, wrapHandler(adminAbuseReportFn));
app.get('/api/admin/abuse', wrapHandler(adminAbuseReportFn));
app.post('/api/admin/abuse', writeLimit, wrapHandler(adminAbuseReportFn));
app.post('/api/admin/abuse/notes', writeLimit, wrapHandler(adminAbuseReportFn));
// Notifications: list / mark-all-read / per-id mark-read. The per-id route
// accepts any subpath under /api/notifications/<id>/read so the bell can deep-
// link to it without registering a new route per notification.
app.get('/api/notifications', wrapHandler(notificationsFn));
app.post('/api/notifications/mark-all-read', writeLimit, wrapHandler(notificationsFn));
app.post(/^\/api\/notifications\/[^/]+\/read\/?$/i, writeLimit, wrapHandler(notificationsFn));
// Delete a single notification: DELETE /api/notifications/<id>
app.delete(/^\/api\/notifications\/[^/]+$/i, writeLimit, wrapHandler(notificationsFn));

app.get('/health', (req, res) => res.json({ ok: true }));

// ── Serve the server-vendored Stockfish WASM files at /vendor/ ────────
// The browser worker loads these from the backend origin even when the
// frontend SPA is on Netlify (chess.singdevelopments.com) and the backend is
// API-only (SERVE_STATIC=0). So this MUST be registered regardless of
// serveStatic. Files live in server/vendor/stockfish/ after a successful
// `npm run stockfish:copy` on the host. CORS headers are required because the
// frontend is on a different origin.
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

if (serveStatic) {
  const staticDir = isDev || !fs.existsSync(distDir) ? publicDir : distDir;
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
      if (path.extname(filePath).toLowerCase() === '.svg') {
        res.setHeader('Content-Type', 'image/svg+xml');
      }
    },
  }));

  // Rate-limit SPA catch-all to avoid filesystem DoS from unauthenticated requests
  const spaLimiter = makeRateLimiter({
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

// Global Express error handler — MUST be last (before app.listen). Catches
// anything thrown or next(err)'d by a route/middleware, formats a clean JSON
// 500, and logs ONCE (method + path + message) instead of the full Express
// route chain flooding the logs.
app.use((err, req, res, _next) => {
  const status = err && err.statusCode ? err.statusCode : 500;
  const msg = (err && err.message) || 'Server error';
  console.error('[server] request error:', req.method, req.path, '-', msg);
  if (!res.headersSent) {
    res.status(status).json({ error: msg });
  }
});

app.listen(PORT, () => {
  const mode = serveStatic ? 'web/API' : 'API';
  console.log(`${mode} server listening at http://localhost:${PORT}`);
});
