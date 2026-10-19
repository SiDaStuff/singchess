const express = require('express');
const users = require('./_lib/user-service');
const { PlayService } = require('./_lib/play-service');
const streams = require('./_lib/play-stream');

const service = new PlayService();
function errorResult(res, error) {
  if (res.headersSent) { res.end(); return; }
  if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
  const status = error.statusCode || 502;
  res.status(status).json({ error: error.statusCode ? error.message : 'Play is temporarily unavailable. Please try again.',
    code: error.code && error.statusCode ? error.code : 'play_unavailable', ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) });
}
function createRouter(play = service, userService = users) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    Promise.resolve(userService.requireUser({ headers: req.headers, sidDeviceId: req.sidDeviceId }))
      .then(user => { req.playUser = user; next(); }).catch(error => errorResult(res, error));
  });
  const route = fn => (req, res) => Promise.resolve().then(() => fn(req.playUser.uid, req, res)).catch(error => errorResult(res, error));
  const mutation = fn => route((uid, req, res) => play.exclusive(uid, () => fn(uid, req, res)));
  router.get('/status', route(async (uid, req, res) => res.json(await play.status(uid))));
  router.get('/active', route(async (uid, req, res) => res.json(await play.status(uid, true))));
  router.post('/oauth/start', route(async (uid, req, res) => res.json(await play.startOAuth(uid))));
  router.post('/oauth/callback', mutation(async (uid, req, res) => res.json(await play.finishOAuth(uid, req.body || {}))));
  router.post('/disconnect', mutation(async (uid, req, res) => res.json(await play.disconnect(uid))));
  router.get('/events', route((uid, req, res) => streams.subscribe(play, uid, 'events', req, res)));
  router.post('/seek', mutation((uid, req, res) => streams.seek(play, uid, req.body || {}, req, res)));
  router.post('/challenge', mutation(async (uid, req, res) => res.json(await play.challenge(uid, req.body || {}))));
  router.post('/challenge/:id/:action', mutation(async (uid, req, res) => res.json(await play.challengeAction(uid, req.params.id, req.params.action))));
  router.get('/game/:id/stream', route((uid, req, res) => streams.subscribe(play, uid, `game:${req.params.id}`, req, res)));
  router.post('/game/:id/move', route(async (uid, req, res) => res.json(await play.move(uid, req.params.id, req.body || {}))));
  router.post('/game/:id/action', route(async (uid, req, res) => res.json(await play.action(uid, req.params.id, req.body || {}))));
  router.get('/game/:id/pgn', route(async (uid, req, res) => res.json(await play.pgn(uid, req.params.id))));
  return router;
}

// Kept ahead of every engine/coaching/explorer endpoint. The browser implements
// the same guard for local WASM. Provider failures keep assistance locked.
function fairPlayMiddleware(play = service, userService = users) {
  return async (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    // Some existing read endpoints (opening explorer) are public. Preserve
    // their guest behavior; protected handlers still perform their own auth.
    if (!req.headers.authorization && !req.headers.Authorization) return next();
    let uid;
    try {
      ({ uid } = await userService.requireUser({ headers: req.headers, sidDeviceId: req.sidDeviceId }));
      await play.assertAnalysisAllowed(uid);
    } catch (error) { errorResult(res, error); return; }
    // Stop an in-flight streaming response if a new live game starts elsewhere.
    let checking = false;
    const timer = setInterval(async () => {
      if (checking || res.writableEnded || res.destroyed) return;
      checking = true;
      try { await play.assertAnalysisAllowed(uid); }
      catch (error) {
        if (!res.headersSent) errorResult(res, error);
        else { res.write(`\nevent: error\ndata: ${JSON.stringify({ error: 'Analysis paused during online play.', code: 'play_fair_play' })}\n\n`); res.end(); }
      } finally { checking = false; }
    }, 5000);
    timer.unref?.(); res.once('close', () => clearInterval(timer)); res.once('finish', () => clearInterval(timer));
    next();
  };
}
module.exports = { router: createRouter(), createRouter, service, fairPlayMiddleware, errorResult };
