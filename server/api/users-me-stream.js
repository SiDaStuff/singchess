const { requireUser } = require('./_lib/user-service');
const {
  setUserPresence,
  touchUserPresence,
  clearUserPresence,
  getPendingWarning,
  markWarningDelivered,
} = require('./_lib/presence-service');

function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data || {})}\n\n`);
}

function makeEvent(req) {
  return {
    httpMethod: req.method,
    headers: req.headers || {},
    queryStringParameters: Object.keys(req.query || {}).length ? req.query : undefined,
    path: req.path,
    rawUrl: req.originalUrl,
  };
}

async function pushWarningIfNeeded(res, uid) {
  const warning = await getPendingWarning(uid);
  if (!warning) return;
  sseWrite(res, 'warning', warning);
  await markWarningDelivered(uid);
}

exports.streamHandler = async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const event = makeEvent(req);
  let user;
  try {
    user = await requireUser(event);
  } catch (err) {
    sseWrite(res, err.statusCode === 403 ? 'disabled' : 'error', {
      error: err.message || 'Unauthorized.',
      code: err.code || err.statusCode || 401,
      reason: err.reason || '',
    });
    res.end();
    return;
  }

  let closed = false;
  const stopStream = () => {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    clearUserPresence(user.uid).catch(() => {});
    if (!res.finished) res.end();
  };

  const sendHeartbeat = () => {
    if (res.destroyed) return stopStream();
    sseWrite(res, 'heartbeat', { timestamp: Date.now() });
    touchUserPresence(user.uid).catch(() => {});
  };

  const checkStatus = async () => {
    if (res.destroyed) return stopStream();
    try {
      const activeUser = await requireUser(event);
      sseWrite(res, 'status', { message: 'active' });
      await pushWarningIfNeeded(res, activeUser.uid);
    } catch (err) {
      sseWrite(res, 'disabled', {
        error: err.message || 'Account disabled.',
        code: err.code || err.statusCode || 403,
        reason: err.reason || '',
      });
      stopStream();
    }
  };

  try {
    const profile = await require('./_lib/user-service').getProfile(user.uid, user);
    await setUserPresence(user.uid, {
      email: user.email,
      username: profile.username || user.name,
    });
  } catch (_err) {
    await setUserPresence(user.uid, { email: user.email, username: user.name });
  }

  sseWrite(res, 'status', { message: 'connected', email: user.email });
  await pushWarningIfNeeded(res, user.uid);

  const interval = setInterval(() => {
    sendHeartbeat();
    checkStatus();
  }, 20000);

  req.on('close', stopStream);
};
