// Isolated official-API fixtures only. This never contacts Lichess or creates games.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { SqlDatabase } = require('../server/api/_lib/sql-database');
const { PlayService, CONTROLS, REDIRECT, DEV_REDIRECT, validateControl } = require('../server/api/_lib/play-service');
const { createRouter, fairPlayMiddleware } = require('../server/api/play');
const { readNDJSON } = require('../server/api/_lib/play-stream');

const database = new SqlDatabase({ filename: ':memory:', startBackup: false });
database.importInitialSnapshot({});
const userService = { initAdmin: () => ({ db: database }), requireUser: async event => {
  const token = event.headers.authorization || '';
  if (!/^Bearer (alice|bob)$/.test(token)) throw Object.assign(new Error('Login required.'), { statusCode: 401 });
  return { uid: token.slice(7) };
} };
const calls = []; let now = 1800000000000; let active = []; let forceRateLimit = false;
let providerMoves = 0; let failNextMove = false; let reconnects = 0; let eventController; const gameControllers = [];
const gameId = 'abcdefgh';
const account = { id: 'aliceplayer', username: 'AlicePlayer', perfs: { rapid: { rating: 1812, games: 42 } }, count: { all: 99 } };
const full = { type: 'gameFull', id: gameId, variant: { key: 'standard' }, speed: 'rapid', rated: false, initialFen: 'startpos',
  white: { id: 'aliceplayer', name: 'AlicePlayer', rating: 1812 }, black: { id: 'opponent', name: 'Opponent', rating: 1800 },
  clock: { initial: 600000, increment: 0 }, state: { type: 'gameState', moves: '', status: 'started', wtime: 600000, btime: 600000 } };
const pgn = '[Event "Fixture"]\n[White "AlicePlayer"]\n[Black "Opponent"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0';
const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const encode = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value) + '\n');
const fetchImpl = async (url, options = {}) => {
  assert.ok(url.startsWith('https://lichess.org/'), 'provider host must be fixed');
  const path = new URL(url).pathname; calls.push({ path, options });
  if (forceRateLimit) return response({ error: 'too many' }, 429, { 'retry-after': '60' });
  if (path === '/api/token' && options.method === 'POST') return response({ access_token: 'fixture_secret_provider_token', expires_in: 31536000 });
  if (path === '/api/token' && options.method === 'DELETE') return new Response(null, { status: 204 });
  if (path === '/api/account') return response(account);
  if (path === '/api/account/playing') return response({ nowPlaying: active });
  if (path.startsWith('/api/games/user/')) return new Response(JSON.stringify({ id: gameId, status: 'mate', players: { white: { user: account } } }) + '\n');
  if (path === '/api/stream/event') {
    reconnects++;
    return new Response(new ReadableStream({ start(controller) { eventController = controller;
      options.signal.addEventListener('abort', () => { try { controller.close(); } catch (_) {} }, { once: true });
    } }));
  }
  if (path === `/api/board/game/stream/${gameId}`) return new Response(new ReadableStream({ start(controller) {
    gameControllers.push(controller); controller.enqueue(encode(full));
    options.signal.addEventListener('abort', () => { try { controller.close(); } catch (_) {} }, { once: true });
  } }));
  if (path.startsWith('/api/board/game/') && path.includes('/move/')) {
    providerMoves++;
    if (failNextMove) { failNextMove = false; throw new TypeError('Injected lost provider response'); }
    return response({ ok: true });
  }
  if (path === `/api/board/game/${gameId}/resign`) return response({ ok: true });
  if (path === '/api/challenge/Friend') return response({ challenge: { id: gameId, url: `https://lichess.org/${gameId}` } });
  if (path === '/api/challenge') return response({ in: [{ id: gameId, variant: { key: 'standard' }, timeControl: { type: 'clock', limit: 60, increment: 0 } }] });
  if (path.startsWith('/api/challenge/')) return response({ ok: true });
  if (path.startsWith('/game/export/')) return response({ id: gameId, status: active.length ? 'started' : 'mate', pgn,
    players: { white: { user: { id: account.id } }, black: { user: { id: 'opponent' } } } });
  if (path === '/api/board/seek') return new Response(new ReadableStream({ start(controller) {
    controller.enqueue(encode('\n'));
    options.signal.addEventListener('abort', () => { try { controller.close(); } catch (_) {} }, { once: true });
  } }));
  throw new Error(`Unexpected mocked request ${options.method || 'GET'} ${path}`);
};
const service = new PlayService({ userService, fetchImpl, env: { PLAY_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64') }, now: () => now });
const app = express(); app.use(express.json()); app.use('/api/play', createRouter(service, userService));
app.post('/assist', fairPlayMiddleware(service, userService), (req, res) => res.json({ allowed: true }));
app.get('/public-explorer', fairPlayMiddleware(service, userService), (req, res) => res.json({ public: true }));
const server = app.listen(0, '127.0.0.1'); let base;
const api = async (path, { method = 'GET', body, uid = 'alice', signal } = {}) => {
  const result = await fetch(`${base}${path.startsWith('/assist') ? path : '/api/play' + path}`, { method, signal,
    headers: { ...(uid ? { authorization: `Bearer ${uid}` } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await result.json(); return { status: result.status, data };
};
const waitFor = async (fn, message) => { for (let i = 0; i < 150; i++) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error(message); };
const openStream = async path => { const controller = new AbortController(); const res = await fetch(base + '/api/play' + path,
  { headers: { authorization: 'Bearer alice' }, signal: controller.signal }); assert.equal(res.status, 200); return { controller, reader: res.body.getReader() }; };

async function main() {
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/public-explorer')).status, 200, 'existing public endpoint preserves guest access');
  assert.equal((await fetch(base + '/public-explorer', { headers: { authorization: 'Bearer invalid' } })).status, 401, 'invalid provided identity is never treated as guest');
  assert.equal((await api('/status', { uid: '' })).status, 401);
  const unlinked = await api('/status'); assert.equal(unlinked.data.connected, false, JSON.stringify(unlinked));
  const devService = new PlayService({ userService, fetchImpl, env: { PLAY_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), NODE_ENV: 'development' }, now: () => now });
  const devStart = await devService.startOAuth('dev-user');
  assert.equal(new URL(devStart.url).searchParams.get('redirect_uri'), DEV_REDIRECT, 'development OAuth returns to the Vite URL');
  const customDevService = new PlayService({ userService, fetchImpl, env: { PLAY_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), CHESS_REVIEW_DEV_SERVER: '1', PLAY_LICHESS_DEV_REDIRECT_URI: 'http://127.0.0.1:4173/ignored' }, now: () => now });
  assert.equal(new URL((await customDevService.startOAuth('preview-user')).url).searchParams.get('redirect_uri'), 'http://127.0.0.1:4173/play/callback', 'development redirect follows the configured Vite origin');
  const unsafeDevService = new PlayService({ userService, fetchImpl, env: { PLAY_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), NODE_ENV: 'development', PLAY_LICHESS_DEV_REDIRECT_URI: 'https://example.com/play/callback' }, now: () => now });
  await assert.rejects(() => unsafeDevService.startOAuth('unsafe-user'), /localhost/);
  const start = await api('/oauth/start', { method: 'POST' }); assert.equal(start.status, 200);
  const authUrl = new URL(start.data.url); assert.equal(authUrl.origin, 'https://lichess.org');
  assert.equal(authUrl.searchParams.get('redirect_uri'), REDIRECT); assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  const state = authUrl.searchParams.get('state'); const pending = await service.value('oauth/alice');
  assert.equal(JSON.stringify(pending).includes(state), false); assert.equal(JSON.stringify(pending).includes('verifier'), false);
  const callback = { state, code: 'fixture_authorization_code' };
  assert.equal((await api('/oauth/callback', { uid: 'bob', method: 'POST', body: callback })).status, 400, 'wrong app identity cannot consume another account state');
  assert.equal((await api('/oauth/callback', { method: 'POST', body: { ...callback, state: 'x'.repeat(43) } })).status, 400);
  const connected = await api('/oauth/callback', { method: 'POST', body: callback }); assert.equal(connected.status, 200);
  assert.equal(connected.data.profile.username, 'AlicePlayer');
  assert.equal((await api('/oauth/callback', { method: 'POST', body: callback })).status, 400, 'callback is single-use');
  const tokenRequest = calls.find(call => call.path === '/api/token' && call.options.method === 'POST');
  const exchange = new URLSearchParams(tokenRequest.options.body);
  assert.equal(crypto.createHash('sha256').update(exchange.get('code_verifier')).digest('base64url'), authUrl.searchParams.get('code_challenge'));
  const stored = await service.value('connections/alice'); assert.equal(JSON.stringify(stored).includes('fixture_secret_provider_token'), false);
  assert.throws(() => service.unseal(stored.credential, 'token:bob'), /attention/, 'ciphertext is bound to app identity');
  let status = await api('/status'); assert.equal(status.data.connected, true); assert.equal(status.data.recentGames.length, 1);
  assert.equal(JSON.stringify(status).includes('fixture_secret_provider_token'), false);
  assert.equal((await api('/status', { uid: 'bob' })).data.connected, false);
  assert.equal(CONTROLS.length, 11);
  for (const control of CONTROLS) {
    const input = { time: control.time, increment: control.increment, rated: false };
    if (control.matchmaking) assert.equal(validateControl(input).control.id, control.id); else assert.throws(() => validateControl(input), /Rapid/);
    if (control.challenge) validateControl(input, 'challenge'); else assert.throws(() => validateControl(input, 'challenge'), /Blitz/);
  }
  assert.throws(() => validateControl({ time: 10, increment: 0, rated: 'true' }), /rated/);
  assert.equal((await api('/challenge', { method: 'POST', body: { username: 'Friend', time: 3, increment: 2, rated: false } })).status, 200);
  const challengeCall = calls.find(call => call.path === '/api/challenge/Friend');
  assert.equal(new URLSearchParams(challengeCall.options.body).get('clock.limit'), '180', 'challenges use seconds');
  assert.equal((await api('/disconnect', { method: 'POST' })).status, 409, 'pending challenge cannot lose its account binding');
  assert.equal((await api('/challenge/' + gameId + '/cancel', { method: 'POST' })).status, 200);
  assert.equal((await api('/challenge/' + gameId + '/accept', { method: 'POST' })).status, 400, 'incoming bullet challenge rejected');
  assert.equal((await api('/seek', { method: 'POST', body: { time: 3, increment: 0, rated: false } })).status, 400);
  assert.equal((await api('/seek', { method: 'POST', body: { time: 10, increment: 0, rated: false } })).status, 409, 'open events before creating a seek');
  assert.equal((await api('/assist', { method: 'POST' })).status, 200);
  active = [{ gameId, color: 'white', fullId: 'private-player-secret', opponent: { username: 'Opponent' } }]; now += 5000;
  const activeStatus = await api('/active'); assert.equal(activeStatus.data.activeGames.length, 1); assert.equal(activeStatus.data.activeGames[0].fullId, undefined);
  assert.equal((await api('/assist', { method: 'POST' })).status, 409, 'server analysis guard follows real active games');
  assert.equal((await api('/disconnect', { method: 'POST' })).status, 409, 'disconnect cannot bypass live-game guard');
  assert.equal((await api(`/game/${gameId}/pgn`)).status, 409, 'live PGN cannot be imported');
  const eventA = await openStream('/events'); const eventB = await openStream('/events');
  assert.equal(reconnects, 1, 'tabs share the single permitted account stream');
  eventController.enqueue(encode({ type: 'gameStart', game: { id: gameId, fullId: 'private-player-suffix' } }));
  await waitFor(async () => (await service.value('active/alice'))?.games?.length, 'gameStart not observed');
  await waitFor(async () => (await service.value('active/alice'))?.games?.some(game => game.id === gameId), 'gameStart cache not replaced');
  assert.equal(JSON.stringify(await service.value('active/alice')).includes('private-player-suffix'), false, 'private player URL credentials never enter relayed status');
  const gameA = await openStream(`/game/${gameId}/stream`); const gameB = await openStream(`/game/${gameId}/stream`);
  await waitFor(async () => (await service.value(`games/alice/${gameId}`))?.state, 'gameFull missing');
  assert.equal(gameControllers.length, 1);
  assert.equal((await api(`/game/${gameId}/move`, { method: 'POST', body: { move: 'e2e5', ply: 0 } })).status, 400);
  assert.equal((await api(`/game/${gameId}/move`, { method: 'POST', body: { move: 'e2e4', ply: 2 } })).status, 409);
  const moves = await Promise.all([1, 2].map(() => api(`/game/${gameId}/move`, { method: 'POST', body: { move: 'e2e4', ply: 0 } })));
  assert.deepEqual(moves.map(move => move.status).sort(), [200, 409]); assert.equal(providerMoves, 1, 'duplicate submission never reaches provider');
  gameControllers[0].enqueue(encode({ type: 'gameState', moves: 'e2e4', status: 'started', wtime: 598000, btime: 600000 }));
  await waitFor(async () => (await service.value(`games/alice/${gameId}`))?.state?.moves === 'e2e4', 'move stream not synchronized');
  assert.equal((await api(`/game/${gameId}/move`, { method: 'POST', body: { move: 'e7e5', ply: 1 } })).status, 409, 'cannot move opponent pieces');
  const connection = await service.connection('alice');
  // Actual promotion legality, including explicit underpromotion, against the API boundary.
  await service.observe('alice', 'game:promote1', { ...full, id: 'promote1', initialFen: '8/P7/8/8/8/8/7k/4K3 w - - 0 1' }, connection);
  service.hubs.set('alice:game:promote1', { ready: true, stop() {} });
  assert.equal((await api('/game/promote1/move', { method: 'POST', body: { move: 'a7a8', ply: 0 } })).status, 400, 'promotion choice is required');
  assert.equal((await api('/game/promote1/move', { method: 'POST', body: { move: 'a7a8n', ply: 0 } })).status, 200, 'underpromotion reaches provider');
  await service.observe('alice', 'game:castling', { ...full, id: 'castling', initialFen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
    state: { ...full.state, moves: 'e1h1 e8a8' } }, connection);
  service.hubs.set('alice:game:castling', { ready: true, stop() {} });
  assert.equal((await api('/game/castling/move', { method: 'POST', body: { move: 'a1a2', ply: 2 } })).status, 200, 'king-to-rook castling history replays before subsequent move');
  await service.observe('alice', 'game:retry123', { ...full, id: 'retry123' }, connection);
  service.hubs.set('alice:game:retry123', { ready: true, stop() {} });
  failNextMove = true;
  const uncertainMove = { method: 'POST', body: { move: 'e2e4', ply: 0 } };
  assert.equal((await api('/game/retry123/move', uncertainMove)).status, 502);
  const beforeRetry = providerMoves; const uncertain = await service.value('moves/alice/retry123/0');
  assert.equal(uncertain.status, 'uncertain');
  assert.equal((await api('/game/retry123/move', uncertainMove)).status, 409, 'uncertain outcome cannot be immediately resubmitted');
  now += 5;
  await service.observe('alice', 'game:retry123', { ...full.state, type: 'gameState' }, connection);
  assert.equal((await api('/game/retry123/move', uncertainMove)).status, 409, 'ordinary gameState/clock correction cannot unlock uncertain request');
  now += 5;
  await service.observe('alice', 'game:retry123', { ...full, id: 'retry123' }, connection);
  const retries = await Promise.all([api('/game/retry123/move', uncertainMove), api('/game/retry123/move', uncertainMove)]);
  assert.deepEqual(retries.map(result => result.status).sort(), [200, 409], 'fresh authoritative gameFull permits one new manual intent');
  assert.equal(providerMoves, beforeRetry + 1, 'concurrent manual retries reserve a single generation');
  assert.notEqual((await service.value('moves/alice/retry123/0')).generation, uncertain.generation);
  eventController.close();
  await waitFor(() => reconnects === 2, 'account stream did not reconnect after EOF');
  gameControllers[0].enqueue(encode({ type: 'gameState', moves: 'e2e4 e7e5 g1f3', status: 'mate', winner: 'white', wtime: 590000, btime: 580000 }));
  gameControllers[0].close(); active = []; now += 5000;
  await waitFor(async () => (await service.value(`games/alice/${gameId}`))?.state?.status === 'mate', 'final game state missing');
  assert.equal((await api('/assist', { method: 'POST' })).status, 200, 'analysis resumes only after official completion');
  const exported = await api(`/game/${gameId}/pgn`); assert.equal(exported.status, 200); assert.equal(exported.data.pgn, pgn);
  // Verify seek cancellation closes the exact upstream request, using casual settings only.
  const seekAbort = new AbortController(); const searching = await fetch(base + '/api/play/seek', { method: 'POST', signal: seekAbort.signal,
    headers: { authorization: 'Bearer alice', 'content-type': 'application/json' }, body: JSON.stringify({ time: 10, increment: 0, rated: false }) });
  assert.equal(searching.status, 200); const seekCall = calls.find(call => call.path === '/api/board/seek');
  assert.equal((await api('/disconnect', { method: 'POST' })).status, 409, 'a live search cannot be disconnected into a pairing race');
  assert.equal(new URLSearchParams(seekCall.options.body).get('time'), '10', 'seeks use minutes');
  seekAbort.abort(); await waitFor(() => seekCall.options.signal.aborted, 'cancel search did not abort upstream');
  await waitFor(async () => !(await service.value('seeks/alice')), 'seek lease not released');
  assert.equal((await api('/disconnect', { method: 'POST' })).status, 200);
  assert.equal((await api(`/game/${gameId}/pgn`)).data.pgn, pgn, 'stored completed PGN works after unlinking');
  assert.equal((await api('/status')).data.connected, false);
  await service.ref('connections/alice').set({ ...stored, expiresAt: now - 1 });
  account.id = 'anotherplayer'; account.username = 'AnotherPlayer';
  const swap = new URL((await service.startOAuth('alice')).url);
  await assert.rejects(service.finishOAuth('alice', { code: 'fixture_new_code', state: swap.searchParams.get('state') }),
    error => error.code === 'play_already_connected', 'expired credentials cannot bypass the old account live-game binding');
  assert.equal((await service.value('connections/alice')).profile.id, 'aliceplayer');
  account.id = 'aliceplayer'; account.username = 'AlicePlayer';
  const renew = new URL((await service.startOAuth('alice')).url);
  assert.equal((await service.finishOAuth('alice', { code: 'fixture_renew_code', state: renew.searchParams.get('state') })).connected, true,
    'expired credential can securely reconnect the same account');
  // Expiry, auth failure and unavailable keys never silently enable assistance.
  const expired = new URL((await service.startOAuth('bob')).url); now += 600001;
  await assert.rejects(service.finishOAuth('bob', { code: 'fixture_code', state: expired.searchParams.get('state') }), /expired/);
  await service.ref('connections/alice').set(stored); service.env.PLAY_TOKEN_ENCRYPTION_KEY = '';
  assert.equal((await api('/status')).status, 503); assert.equal((await api('/assist', { method: 'POST' })).status, 503);
  service.env.PLAY_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  assert.equal((await api('/active')).status, 503, 'changing vault key fails closed');
  forceRateLimit = true;
  await assert.rejects(service.json('/api/account'), error => error.statusCode === 429 && error.retryAfter === 60);
  let inFlight = 0, peak = 0;
  const serial = new PlayService({ userService, env: service.env, fetchImpl: async () => {
    inFlight++; peak = Math.max(peak, inFlight);
    return new Response(new ReadableStream({ start(controller) {
      setTimeout(() => { controller.enqueue(encode('{"ok":true}')); inFlight--; controller.close(); }, 10);
    } }));
  } });
  await Promise.all([serial.json('/one'), serial.json('/two'), serial.json('/three')]);
  assert.equal(peak, 1, 'ordinary API requests serialize through complete body consumption');
  const parsed = []; await readNDJSON(new ReadableStream({ start(controller) {
    controller.enqueue(encode('{"type":"game')); controller.enqueue(encode('State","moves":"e7e8q"}\n\n{"type":"gameState","status":"mate"}')); controller.close();
  } }), event => parsed.push(event));
  assert.equal(parsed[0].moves, 'e7e8q'); assert.equal(parsed[1].status, 'mate', 'split chunks, promotion UCI, blank keepalive and trailing record parsed');
  for (const opened of [eventA, eventB, gameA, gameB]) { opened.controller.abort(); opened.reader.cancel().catch(() => {}); }
  console.log('PASS Play OAuth PKCE, encrypted identity binding, auth isolation, API time restrictions, streams/reconnect, authoritative moves and duplicates, seek cancellation, fair-play, completed PGN and rate limits (mock provider only)');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const hub of service.hubs.values()) hub.stop(); for (const controller of service.seekControllers.values()) controller.abort();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close();
});
