const { requireUser, json } = require('./_lib/user-service');

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
    sseWrite(res, 'error', { error: err.message || 'Unauthorized.', code: err.statusCode || 401 });
    res.end();
    return;
  }

  let closed = false;
  const stopStream = () => {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    if (!res.finished) res.end();
  };

  const sendHeartbeat = () => {
    if (res.destroyed) return stopStream();
    sseWrite(res, 'heartbeat', { timestamp: Date.now() });
  };

  const checkStatus = async () => {
    if (res.destroyed) return stopStream();
    try {
      await requireUser(event);
      sseWrite(res, 'status', { message: 'active' });
    } catch (err) {
      sseWrite(res, 'disabled', { error: err.message || 'Account disabled.', code: err.statusCode || 403 });
      stopStream();
    }
  };

  sseWrite(res, 'status', { message: 'connected', email: user.email });
  const interval = setInterval(() => {
    sendHeartbeat();
    checkStatus();
  }, 20000);

  req.on('close', stopStream);
};
