const { FINISHED, fail, id, validateControl } = require('./play-service');

function streamHeaders(res) {
  res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  res.flushHeaders?.();
}
function write(res, event) {
  if (res.destroyed || res.writableEnded) return;
  if (res.writableLength > 262144) { res.destroy(); return; }
  // SSE comments keep proxies and browsers from buffering an otherwise idle
  // game. Named messages are unnecessary: every payload has its own type.
  res.write(event == null ? ': keep-alive\n\n' : `data: ${JSON.stringify(event)}\n\n`);
}
async function readNDJSON(body, onEvent, onHeartbeat = () => {}) {
  let buffer = ''; const decoder = new TextDecoder();
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length > 1048576) throw fail(502, 'The live game response exceeded its safe size.');
    for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1); onHeartbeat();
      if (line) await onEvent(JSON.parse(line));
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) await onEvent(JSON.parse(buffer));
}

// One provider stream per account/channel, shared by every browser tab. Deploy one
// Node worker (see PLAY-DEPLOYMENT.md); Lichess permits one account event stream.
class PlayStreamHub {
  constructor(service, uid, channel, connection) {
    this.service = service; this.uid = uid; this.channel = channel; this.connection = connection;
    this.listeners = new Set(); this.stopped = false; this.ready = false; this.full = null; this.finished = false;
    this.heartbeat = setInterval(() => this.broadcast(null), 15000); this.heartbeat.unref?.();
  }
  subscribe(req, res) {
    clearTimeout(this.idle); streamHeaders(res); this.listeners.add(res);
    if (this.full) write(res, this.full);
    if (this.ready) write(res, { type: 'connection', status: 'connected' });
    const lifetime = setTimeout(() => res.end(), 25 * 60000); lifetime.unref?.();
    res.once('close', () => {
      clearTimeout(lifetime); this.listeners.delete(res);
      if (!this.listeners.size) { this.idle = setTimeout(() => this.stop(), 5000); this.idle.unref?.(); }
    });
    if (!this.running) this.running = this.run();
  }
  broadcast(event) { for (const res of this.listeners) write(res, event); }
  refresh() {
    this.ready = false; this.full = null;
    this.broadcast({ type: 'connection', status: 'reconnecting', retryAfter: 1 });
    this.controller?.abort();
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true; this.ready = false; this.controller?.abort();
    clearInterval(this.heartbeat); clearTimeout(this.idle); clearTimeout(this.retryTimer);
    this.retryResolve?.();
    for (const res of this.listeners) res.end(); this.listeners.clear();
    if (this.service.hubs.get(`${this.uid}:${this.channel}`) === this) this.service.hubs.delete(`${this.uid}:${this.channel}`);
  }
  async run() {
    let retries = 0;
    while (!this.stopped) {
      this.controller = new AbortController(); this.ready = false;
      let lastData = Date.now();
      const watchdog = setInterval(() => { if (Date.now() - lastData > 45000) this.controller.abort(); }, 10000);
      watchdog.unref?.();
      try {
        const path = this.channel === 'events' ? '/api/stream/event' : `/api/board/game/stream/${id(this.channel.slice(5))}`;
        const response = await this.service.request(path, { token: this.connection.token, signal: this.controller.signal, stream: true, accept: 'application/x-ndjson' });
        this.ready = true; retries = 0; lastData = Date.now(); this.broadcast({ type: 'connection', status: 'connected' });
        await readNDJSON(response.body, async event => {
          // fullId contains the private player URL suffix. Board clients use
          // public game IDs and authenticated actions, so never relay that key.
          if (event.game?.fullId) { const { fullId, ...game } = event.game; event = { ...event, game }; }
          await this.service.observe(this.uid, this.channel, event, this.connection);
          if (event.type === 'gameFull') this.full = event;
          if (event.type === 'gameState' && this.full) this.full = { ...this.full, state: event };
          const state = event.type === 'gameFull' ? event.state : event.type === 'gameState' ? event : null;
          if (state && FINISHED.has(state.status)) this.finished = true;
          this.broadcast(event);
        }, () => { lastData = Date.now(); });
        if (this.finished) { this.stop(); return; }
        if (!this.stopped) throw fail(502, 'The live connection was interrupted.', 'play_stream_interrupted');
      } catch (error) {
        this.ready = false;
        if (this.stopped) return;
        if ([400, 401, 403, 404].includes(error.statusCode)) {
          this.broadcast({ type: 'error', code: error.code || 'play_stream_unavailable', error: error.message }); this.stop(); return;
        }
        const retryAfter = error.retryAfter || Math.min(30, 2 ** Math.min(retries++, 5));
        this.broadcast({ type: 'connection', status: 'reconnecting', retryAfter });
        await new Promise(resolve => { this.retryResolve = resolve; this.retryTimer = setTimeout(resolve, retryAfter * 1000); this.retryTimer.unref?.(); });
      } finally { clearInterval(watchdog); }
    }
  }
}

async function subscribe(service, uid, channel, req, res) {
  const connection = await service.connection(uid);
  if (channel !== 'events') id(channel.slice(5));
  const key = `${uid}:${channel}`;
  let hub = service.hubs.get(key);
  if (!hub || hub.stopped) { hub = new PlayStreamHub(service, uid, channel, connection); service.hubs.set(key, hub); }
  if (channel.startsWith('game:') && hub.full) {
    const gameId = channel.slice(5); const saved = await service.value(`games/${uid}/${gameId}`);
    const ply = (saved?.state?.moves || '').split(' ').filter(Boolean).length;
    const reservation = await service.value(`moves/${uid}/${gameId}/${ply}`);
    // A new browser subscription alone must never unlock an uncertain request:
    // discard the cached snapshot and fetch a real new provider gameFull first.
    if (reservation?.status === 'uncertain' && !(saved?.syncedAt > reservation.settledAt)) hub.refresh();
  }
  if (hub.listeners.size >= 6) throw fail(429, 'Too many Play tabs are open. Close another tab.', 'play_too_many_streams');
  hub.subscribe(req, res);
}

async function seek(service, uid, body, req, res) {
  const { control, rated, color } = validateControl(body);
  const connection = await service.connection(uid);
  if (!service.hubs.get(`${uid}:events`)?.ready) throw fail(409, 'Wait for the live connection before searching.', 'play_events_required');
  if ((await service.active(uid, connection, true)).length) throw fail(409, 'Resume your active game first.', 'play_active_game');
  const lease = service.ref(`seeks/${uid}`); const owner = require('node:crypto').randomBytes(16).toString('hex');
  const claim = await lease.transaction(value => value && value.expiresAt > service.now() ? undefined : { owner, expiresAt: service.now() + 60000 });
  if (!claim.committed) throw fail(409, 'You already have an active search.', 'play_seek_exists');
  const controller = new AbortController(); service.seekControllers.set(uid, controller);
  const close = () => controller.abort(); res.once('close', close);
  if (res.destroyed || res.writableEnded) controller.abort();
  const refresh = setInterval(() => lease.transaction(value => value?.owner === owner ? { owner, expiresAt: service.now() + 60000 } : undefined).catch(close), 15000);
  refresh.unref?.(); let heartbeat;
  try {
    const upstream = await service.request('/api/board/seek', { token: connection.token, method: 'POST',
      body: { time: control.time, increment: control.increment, rated, color, variant: 'standard' }, stream: true, signal: controller.signal, accept: 'application/x-ndjson' });
    streamHeaders(res); write(res, { type: 'search', status: 'searching', time: control.time, increment: control.increment, rated });
    heartbeat = setInterval(() => write(res, null), 15000); heartbeat.unref?.();
    // Lichess sends blank heartbeats only. EOF is not proof of a found game.
    for await (const _chunk of upstream.body) { if (controller.signal.aborted) break; }
    if (!controller.signal.aborted) { await service.ref(`active/${uid}`).remove(); write(res, { type: 'search', status: 'closed' }); }
    res.end();
  } catch (error) {
    if (controller.signal.aborted) { if (!res.writableEnded) res.end(); }
    else if (res.headersSent) { write(res, { type: 'error', code: error.code || 'play_search_failed', error: error.message }); res.end(); }
    else throw error;
  } finally {
    clearInterval(refresh); clearInterval(heartbeat); res.removeListener('close', close); controller.abort();
    if (service.seekControllers.get(uid) === controller) service.seekControllers.delete(uid);
    await lease.transaction(value => value?.owner === owner ? null : undefined);
  }
}

module.exports = { PlayStreamHub, subscribe, seek, readNDJSON, streamHeaders };
