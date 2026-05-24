// Express wrapper that invokes existing server API handlers
const express = require('express');
const morgan = require('morgan');
const path = require('path');
// Load environment from server/.env (if present)
try {
  require('dotenv').config({ path: path.resolve(__dirname, '.env') });
} catch (e) {
  // ignore if dotenv not installed
}

const analyzeFn = require('./api/analyze.js');
const anticheatFn = require('./api/anticheat.js');
const getPuzzleFn = require('./api/get-puzzle.js');
const publicStatsFn = require('./api/public-stats.js');
const recentGamesFn = require('./api/recent-games.js');
const recordPuzzleAttemptFn = require('./api/record-puzzle-attempt.js');
const puzzleSolveFn = require('./api/puzzle-solve.js');
const usersMeFn = require('./api/users-me.js');
const giftBoostFn = require('./api/gift-boost.js');

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.resolve(__dirname, '../public');
const serveStatic = process.env.SERVE_STATIC !== '0';
const isDev = process.env.NODE_ENV === 'development' || process.env.CHESS_REVIEW_DEV_SERVER === '1';

app.use(morgan('tiny'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

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
      res.set(result.headers);
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
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.sendStatus(200);
});

app.post('/api/analyze', wrapHandler(analyzeFn));
app.post('/api/analyze/stream', analyzeFn.streamHandler);
app.post('/api/anticheat', wrapHandler(anticheatFn));
app.post('/api/anticheat/stream', anticheatFn.streamHandler);
app.get('/api/puzzle', wrapHandler(getPuzzleFn));
app.get('/api/recent-games', wrapHandler(recentGamesFn));
app.get('/api/public-stats', wrapHandler(publicStatsFn));
app.post('/api/public-stats', wrapHandler(publicStatsFn));
app.post('/api/puzzle/solve', wrapHandler(puzzleSolveFn));
app.post('/api/record-puzzle-attempt', wrapHandler(recordPuzzleAttemptFn));
app.get('/api/users/me', wrapHandler(usersMeFn));
app.post('/api/admin/gift-boost', wrapHandler(giftBoostFn));

app.get('/health', (req, res) => res.json({ ok: true }));

if (serveStatic) {
  app.use(express.static(publicDir, {
    etag: true,
    maxAge: isDev ? 0 : '10m',
    setHeaders(res, filePath) {
      if (isDev || path.basename(filePath) === 'index.html') {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  }));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || path.extname(req.path)) return next();
    const htmlPath = path.join(publicDir, `${req.path.replace(/^\/+/, '')}.html`);
    if (req.path !== '/' && require('fs').existsSync(htmlPath)) {
      res.set('Cache-Control', 'no-store');
      return res.sendFile(htmlPath);
    }
    res.set('Cache-Control', 'no-store');
    return res.sendFile(path.join(publicDir, 'index.html'));
  });
}

app.listen(PORT, () => {
  const mode = serveStatic ? 'web/API' : 'API';
  console.log(`${mode} server listening at http://localhost:${PORT}`);
});
