// Official Lichess Board API integration. Provider credentials never leave this module.
const crypto = require('node:crypto');
const { Chess } = require('chess.js');
const users = require('./user-service');

const ORIGIN = 'https://lichess.org';
const REDIRECT = 'https://chess.singdevelopments.com/play/callback';
const DEV_REDIRECT = 'http://localhost:5173/play/callback';
const SCOPES = 'board:play challenge:read challenge:write';
const CONTROLS = Object.freeze([
  [1, 0, 'Bullet', false, false], [2, 1, 'Bullet', false, false],
  [3, 0, 'Blitz', false, true], [3, 2, 'Blitz', false, true],
  [5, 0, 'Blitz', false, true], [5, 3, 'Blitz', false, true],
  [10, 0, 'Rapid', true, true], [10, 5, 'Rapid', true, true],
  [15, 10, 'Rapid', true, true], [30, 0, 'Classical', true, true],
  [30, 20, 'Classical', true, true],
].map(([time, increment, category, matchmaking, challenge]) => ({
  id: `${time}+${increment}`, time, increment, category, matchmaking, challenge,
})));
const FINISHED = new Set(['mate', 'resign', 'stalemate', 'timeout', 'draw', 'outoftime', 'cheat', 'noStart', 'unknownFinish', 'variantEnd', 'aborted']);
const fail = (statusCode, message, code = 'play_error', extra = {}) => Object.assign(new Error(message), { statusCode, code, ...extra });
const lower = value => String(value || '').toLowerCase();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const id = value => /^[a-zA-Z0-9]{8}$/.test(String(value || '')) ? String(value) : (() => { throw fail(400, 'Invalid game ID.'); })();
const profile = account => ({ id: account.id, username: account.username, title: account.title || '', patron: !!account.patron,
  perfs: account.perfs || {}, count: account.count || {}, playTime: account.playTime || {}, createdAt: account.createdAt || null,
  url: `${ORIGIN}/@/${encodeURIComponent(account.username || account.id)}` });
function playUci(chess, uci) {
  const from = uci.slice(0, 2); let to = uci.slice(2, 4);
  const piece = chess.get(from), target = chess.get(to);
  // Standard castling may arrive in Lichess's king-to-rook UCI notation.
  if (piece?.type === 'k' && target?.type === 'r' && piece.color === target.color) to = `${to[0] > from[0] ? 'g' : 'c'}${from[1]}`;
  return chess.move({ from, to, ...(uci[4] ? { promotion: uci[4] } : {}) });
}

function validateControl(body, kind = 'matchmaking') {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'Provide game settings.');
  const control = CONTROLS.find(item => item.time === body.time && item.increment === body.increment);
  if (!control || !control[kind]) throw fail(400, kind === 'matchmaking' ? 'Public matchmaking supports Rapid and Classical. Challenge a friend for Blitz.' : 'The Board API supports friend challenges from Blitz upwards.', 'unsupported_time_control');
  if (typeof body.rated !== 'boolean') throw fail(400, 'Choose rated or casual.');
  const color = body.color || 'random';
  if (!['white', 'black', 'random'].includes(color)) throw fail(400, 'Invalid color.');
  return { control, rated: body.rated, color };
}

class PlayService {
  constructor({ userService = users, fetchImpl = (...args) => fetch(...args), env = process.env, now = Date.now } = {}) {
    this.users = userService; this.fetch = fetchImpl; this.env = env; this.now = now;
    this.activePending = new Map(); this.hubs = new Map(); this.seekControllers = new Map();
    this.accountActions = new Set();
    this.rateLimitedUntil = 0;
    this.requestTail = Promise.resolve();
  }
  database() { return this.users.initAdmin().db; }
  async exclusive(uid, action) {
    if (this.accountActions.has(uid)) throw fail(409, 'Finish or cancel your current Play request first.', 'play_action_busy');
    this.accountActions.add(uid);
    try { return await action(); } finally { this.accountActions.delete(uid); }
  }
  ref(path) { return this.database().ref(`playPrivate/${path}`); }
  async value(path) { return (await this.ref(path).get()).val(); }
  key() {
    const raw = this.env.PLAY_TOKEN_ENCRYPTION_KEY || '';
    const key = /^[A-Za-z0-9+/]{43}=$/.test(raw) ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
    if (key.length !== 32) throw fail(503, 'Play account connection is not configured yet.', 'play_not_configured');
    return key;
  }
  configured() { try { this.key(); return true; } catch (_) { return false; } }
  redirectUri() {
    const development = this.env.NODE_ENV === 'development' || this.env.CHESS_REVIEW_DEV_SERVER === '1';
    if (!development) return REDIRECT;
    const configured = this.env.PLAY_LICHESS_DEV_REDIRECT_URI || DEV_REDIRECT;
    try {
      const url = new URL(configured);
      if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error();
      url.pathname = '/play/callback'; url.search = ''; url.hash = '';
      return url.href;
    } catch (_) {
      throw fail(503, 'The development Play redirect must be an http://localhost or http://127.0.0.1 URL.', 'play_not_configured');
    }
  }
  seal(value, context) {
    const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(Buffer.from(context));
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
  }
  unseal(value, context) {
    try {
      const [iv, tag, data] = value.split('.').map(part => Buffer.from(part, 'base64'));
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key(), iv);
      decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
    } catch (_) { throw fail(503, 'The Play connection needs attention. Please reconnect your account.', 'play_credential_unavailable'); }
  }
  async connection(uid, required = true) {
    const saved = await this.value(`connections/${uid}`);
    if (!saved && required) throw fail(409, 'Connect your Lichess account to play.', 'play_not_connected');
    if (!saved) return null;
    if (saved.revoked || (saved.expiresAt && saved.expiresAt < this.now())) throw fail(401, 'Reconnect your Lichess account.', 'play_authorization_expired');
    return { ...saved, token: this.unseal(saved.credential, `token:${uid}`).token };
  }
  async request(path, { token, method = 'GET', body, signal, accept = 'application/json', stream = false } = {}) {
    const options = { token, method, body, signal, accept, stream };
    if (stream) return this.performRequest(path, options);
    // Lichess asks clients to serialize ordinary requests. Keep the lease until
    // the complete response body has arrived, with persistent streams excluded.
    const previous = this.requestTail;
    let release; this.requestTail = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      const response = await this.performRequest(path, options);
      const data = response.status === 204 ? null : await response.arrayBuffer();
      if (data && data.byteLength > 2097152) throw fail(502, 'The Lichess response exceeded its safe size.');
      return new Response(data, { status: response.status, headers: response.headers });
    } finally { release(); }
  }
  async performRequest(path, { token, method = 'GET', body, signal, accept = 'application/json', stream = false } = {}) {
    if (this.rateLimitedUntil > this.now()) throw fail(429, 'Lichess is limiting requests. Please wait before trying again.', 'play_rate_limited',
      { retryAfter: Math.ceil((this.rateLimitedUntil - this.now()) / 1000) });
    const timeout = stream ? null : AbortSignal.timeout(20000);
    const response = await this.fetch(`${ORIGIN}${path}`, {
      method, signal: signal && timeout ? AbortSignal.any([signal, timeout]) : signal || timeout,
      headers: { Accept: accept, ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), 'User-Agent': 'SingChessPlay/1.0 (chess.singdevelopments.com)' },
      ...(body ? { body: new URLSearchParams(body).toString() } : {}),
    });
    if (!response.ok) {
      const retryAfter = Math.max(1, Math.min(600, Number(response.headers.get('retry-after')) || 60));
      let message = '';
      try { const text = await response.text(); const json = JSON.parse(text); message = String(json.error || json.error_description || '').slice(0, 300); } catch (_) {}
      if (response.status === 429) {
        this.rateLimitedUntil = this.now() + Math.max(60, retryAfter) * 1000;
        throw fail(429, 'Lichess is limiting requests. Please wait before trying again.', 'play_rate_limited', { retryAfter: Math.max(60, retryAfter) });
      }
      if (response.status === 401) throw fail(401, 'Your Lichess authorization expired. Reconnect your account.', 'play_authorization_expired');
      if (response.status === 403) throw fail(403, message || 'Lichess did not permit this action.', 'play_action_forbidden');
      throw fail(response.status >= 500 ? 502 : response.status, message || 'Lichess could not complete this request.', 'play_provider_error');
    }
    return response;
  }
  async json(path, options) { const res = await this.request(path, options); return res.status === 204 ? { ok: true } : res.json(); }
  async startOAuth(uid) {
    this.key();
    const redirectUri = this.redirectUri();
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    // One bounded, encrypted pending authorization per app account; starting again invalidates the old tab.
    await this.ref(`oauth/${uid}`).set({ stateHash: hash(state), expiresAt: this.now() + 600000, redirectUri,
      secret: this.seal({ verifier }, `oauth:${uid}`) });
    const query = new URLSearchParams({ response_type: 'code', client_id: this.env.PLAY_LICHESS_CLIENT_ID || 'chess.singdevelopments.com',
      redirect_uri: redirectUri, scope: SCOPES, state, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    return { url: `${ORIGIN}/oauth?${query}` };
  }
  async finishOAuth(uid, body) {
    if (!/^[A-Za-z0-9_]{1,512}$/.test(body.code || '') || !/^[A-Za-z0-9_-]{43}$/.test(body.state || '')) throw fail(400, 'Invalid account connection response.', 'invalid_oauth_callback');
    let pending;
    const claim = await this.ref(`oauth/${uid}`).transaction(value => {
      if (!value || value.expiresAt < this.now() || value.stateHash !== hash(body.state)) return undefined;
      pending = value; return null;
    });
    if (!claim.committed || !pending) throw fail(400, 'Account connection expired or was already used. Please connect again.', 'invalid_oauth_state');
    const { verifier } = this.unseal(pending.secret, `oauth:${uid}`);
    const redirectUri = pending.redirectUri || this.redirectUri();
    const token = await this.json('/api/token', { method: 'POST', body: { grant_type: 'authorization_code', code: body.code,
      code_verifier: verifier, redirect_uri: redirectUri, client_id: this.env.PLAY_LICHESS_CLIENT_ID || 'chess.singdevelopments.com' } });
    if (typeof token.access_token !== 'string' || !token.access_token) throw fail(502, 'Lichess did not return an authorization.');
    const account = await this.json('/api/account', { token: token.access_token });
    if (!/^[a-z0-9_-]{2,40}$/.test(account.id || '') || account.title === 'BOT' || account.disabled) {
      await this.json('/api/token', { method: 'DELETE', token: token.access_token }).catch(() => {});
      throw fail(400, 'Play needs a normal, active Lichess account.', 'invalid_lichess_account');
    }
    const previous = await this.value(`connections/${uid}`);
    const saved = await this.connection(uid, false).catch(() => null);
    // Expired/revoked/corrupted credentials must not allow changing identities
    // before the old account's live-game binding is safely disconnected.
    if (previous && previous.profile?.id !== account.id) {
      await this.json('/api/token', { method: 'DELETE', token: token.access_token }).catch(() => {});
      throw fail(409, 'Disconnect your current account before connecting another.', 'play_already_connected');
    }
    const owner = await this.ref(`identities/${account.id}`).transaction(value => value && value !== uid ? undefined : uid);
    if (!owner.committed) {
      await this.json('/api/token', { method: 'DELETE', token: token.access_token }).catch(() => {});
      throw fail(409, 'This Lichess account is already connected to another app account.', 'play_identity_in_use');
    }
    this.closeUserStreams(uid);
    await this.ref(`connections/${uid}`).set({ credential: this.seal({ token: token.access_token }, `token:${uid}`),
      profile: profile(account), profileUpdatedAt: this.now(), connectedAt: this.now(), expiresAt: this.now() + Math.max(60, Number(token.expires_in) || 31536000) * 1000 });
    if (saved?.token && saved.token !== token.access_token) await this.json('/api/token', { method: 'DELETE', token: saved.token }).catch(() => {});
    await this.ref(`active/${uid}`).remove();
    return { connected: true, profile: profile(account) };
  }
  async refreshActive(uid, connection) {
    if (this.activePending.has(uid)) return this.activePending.get(uid);
    const pending = (async () => {
      const data = await this.json('/api/account/playing?nb=50', { token: connection.token });
      if (!Array.isArray(data.nowPlaying)) throw fail(502, 'Could not verify your active games.', 'play_state_unavailable');
      const games = data.nowPlaying.map(game => { const { fullId, ...publicGame } = game; return publicGame; });
      await this.ref(`active/${uid}`).set({ checkedAt: this.now(), games });
      return games;
    })();
    this.activePending.set(uid, pending);
    try { return await pending; } finally { this.activePending.delete(uid); }
  }
  async active(uid, connection = null, force = false, staleWhileRevalidate = false) {
    connection ||= await this.connection(uid, false);
    if (!connection) return [];
    const cached = await this.value(`active/${uid}`);
    if (!force && cached && cached.checkedAt > this.now() - 4000) return cached.games || [];
    if (!force && staleWhileRevalidate && cached) {
      void this.refreshActive(uid, connection).catch(() => {});
      return cached.games || [];
    }
    return this.refreshActive(uid, connection);
  }
  async assertAnalysisAllowed(uid) {
    const connection = await this.connection(uid, false);
    if (!connection) return;
    if ((await this.active(uid, connection)).length) throw fail(409, 'Analysis and coaching are paused while an online game is active.', 'play_fair_play');
  }
  async status(uid, onlyActive = false) {
    if (!this.configured()) {
      if (await this.value(`connections/${uid}`)) throw fail(503, 'Your Play connection needs server attention. Analysis remains paused.', 'play_credential_unavailable');
      return { configured: false, connected: false, activeGames: [], recentGames: [], timeControls: CONTROLS };
    }
    const connection = await this.connection(uid, false);
    if (!connection) return { configured: true, connected: false, activeGames: [], recentGames: [], timeControls: CONTROLS };
    const activeGames = await this.active(uid, connection, false, onlyActive);
    if (onlyActive) return { connected: true, activeGames };
    if (!connection.profileUpdatedAt || connection.profileUpdatedAt < this.now() - 60000) {
      const account = await this.json('/api/account', { token: connection.token });
      connection.profile = profile(account);
      await this.ref(`connections/${uid}`).update({ profile: connection.profile, profileUpdatedAt: this.now() });
    }
    let cache = await this.value(`recent/${uid}`);
    let recentError = false;
    if (!cache || cache.checkedAt < this.now() - 60000) {
      try {
        const response = await this.request(`/api/games/user/${encodeURIComponent(connection.profile.id)}?max=12&finished=true&ongoing=false&evals=false&opening=false&clocks=false&moves=false`,
          { token: connection.token, accept: 'application/x-ndjson' });
        const games = (await response.text()).split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
        cache = { checkedAt: this.now(), games }; await this.ref(`recent/${uid}`).set(cache);
      } catch (error) { if (error.statusCode === 401) throw error; recentError = true; }
    }
    const storedReviews = (await this.database().ref(`maxAutoReviewPrivate/reviews/${uid}`).once('value')).val() || {};
    const reviewStats = { gamesReviewed: 0, movesReviewed: 0, brilliant: 0, great: 0, best: 0 };
    for (const item of Object.values(storedReviews)) {
      const results = Array.isArray(item?.review?.results) ? item.review.results : [];
      reviewStats.gamesReviewed += 1; reviewStats.movesReviewed += results.length;
      for (const result of results) {
        const key = String(result?.classificationKey || result?.classification?.key || result?.classification?.name || result?.classification || '').toLowerCase();
        if (key === 'brilliant') reviewStats.brilliant += 1;
        else if (key === 'great') reviewStats.great += 1;
        else if (key === 'best') reviewStats.best += 1;
      }
    }
    return { configured: true, connected: true, profile: connection.profile, reviewStats, activeGames, recentGames: cache?.games || [], recentError, timeControls: CONTROLS };
  }
  async disconnect(uid) {
    const connection = await this.connection(uid, false);
    if (!connection) return { connected: false };
    const seek = await this.value(`seeks/${uid}`);
    if (seek?.expiresAt > this.now()) throw fail(409, 'Cancel your current search before disconnecting.', 'play_search_active');
    const challenges = await this.value(`outgoing/${uid}`);
    if (Object.values(challenges || {}).some(challenge => challenge.expiresAt > this.now())) throw fail(409, 'Cancel your pending friend challenge before disconnecting.', 'play_challenge_active');
    if ((await this.active(uid, connection, true)).length) throw fail(409, 'Finish your active games before disconnecting.', 'play_active_game');
    // Revoke first. A provider outage must not silently discard the fair-play binding.
    try { await this.json('/api/token', { method: 'DELETE', token: connection.token }); }
    catch (error) { if (error.code !== 'play_authorization_expired') throw error; }
    this.closeUserStreams(uid);
    await this.ref(`connections/${uid}`).remove(); await this.ref(`identities/${connection.profile.id}`).remove();
    await this.ref(`active/${uid}`).remove(); await this.ref(`recent/${uid}`).remove();
    return { connected: false };
  }
  closeUserStreams(uid) {
    for (const [key, hub] of this.hubs) if (key.startsWith(`${uid}:`)) { hub.stop(); this.hubs.delete(key); }
    this.seekControllers.get(uid)?.abort(); this.seekControllers.delete(uid);
  }
  async observe(uid, channel, event, connection) {
    if (channel === 'events' && ['gameStart', 'gameFinish'].includes(event.type)) {
      // Invalidate even a fresh active-game cache before subsequent analysis requests.
      if (event.type === 'gameStart') {
        const previous = await this.value(`active/${uid}`);
        const games = (previous?.games || []).filter(game => (game.gameId || game.id) !== event.game?.id);
        if (event.game?.id) games.push({ ...event.game, gameId: event.game.id });
        await this.ref(`active/${uid}`).set({ checkedAt: this.now(), games });
      } else await this.ref(`active/${uid}`).remove();
      if (event.type === 'gameFinish') await this.ref(`recent/${uid}`).remove();
      if (event.game?.id) await this.ref(`outgoing/${uid}/${id(event.game.id)}`).remove();
    }
    if (channel === 'events' && ['challengeCanceled', 'challengeDeclined'].includes(event.type) && event.challenge?.id) await this.ref(`outgoing/${uid}/${id(event.challenge.id)}`).remove();
    if (!channel.startsWith('game:')) return;
    const gameId = id(channel.slice(5));
    if (event.type === 'gameFull') {
      const player = [event.white?.id, event.black?.id].some(value => lower(value) === lower(connection.profile.id));
      if (!player) throw fail(403, 'You can only play your own games.', 'play_game_forbidden');
      if (event.variant?.key !== 'standard') throw fail(400, 'Play currently supports standard chess.', 'play_variant_unsupported');
      await this.ref(`games/${uid}/${gameId}`).set({ full: event, state: event.state, updatedAt: this.now(), syncedAt: this.now() });
    } else if (event.type === 'gameState') {
      await this.ref(`games/${uid}/${gameId}`).update({ state: event, updatedAt: this.now() });
    }
    const state = event.type === 'gameFull' ? event.state : event.type === 'gameState' ? event : null;
    if (state && FINISHED.has(state.status)) { await this.ref(`active/${uid}`).remove(); await this.ref(`recent/${uid}`).remove(); }
  }
  async savedGame(uid, gameId) {
    const saved = await this.value(`games/${uid}/${id(gameId)}`);
    if (!saved?.full || !saved?.state) throw fail(409, 'Reconnect to the game before making a move.', 'play_state_unavailable');
    return saved;
  }
  async move(uid, gameId, body) {
    gameId = id(gameId);
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(body.move || '') || !Number.isSafeInteger(body.ply) || body.ply < 0 || body.ply > 10000) throw fail(400, 'Provide a legal move and its current move number.', 'invalid_move');
    const connection = await this.connection(uid);
    const { full, state, syncedAt } = await this.savedGame(uid, gameId);
    if (FINISHED.has(state.status)) throw fail(409, 'This game has finished.', 'play_game_finished');
    if (!this.hubs.get(`${uid}:game:${gameId}`)?.ready) throw fail(409, 'Reconnect to synchronize the position.', 'play_state_unavailable');
    const moves = (state.moves || '').split(' ').filter(Boolean);
    if (moves.length !== body.ply) throw fail(409, 'The board has changed. Synchronize before moving.', 'play_stale_position');
    const chess = full.initialFen && full.initialFen !== 'startpos' ? new Chess(full.initialFen) : new Chess();
    for (const uci of moves) if (!playUci(chess, uci)) throw fail(409, 'The game position could not be synchronized.', 'play_state_unavailable');
    const player = chess.turn() === 'w' ? full.white : full.black;
    if (lower(player?.id) !== lower(connection.profile.id)) throw fail(409, 'Wait for your turn.', 'play_not_your_turn');
    if (!playUci(chess, body.move)) throw fail(400, 'That move is not legal in this position.', 'invalid_move');
    // Atomic per-ply reservation shared by PM2 workers: uncertain network outcomes are never automatically retried.
    const lock = this.ref(`moves/${uid}/${gameId}/${body.ply}`);
    const generation = crypto.randomBytes(16).toString('hex');
    const claim = await lock.transaction(value => {
      const resynchronized = value?.status === 'uncertain' && value.settledAt && syncedAt > value.settledAt;
      if (value && value.status !== 'rejected' && !resynchronized) return undefined;
      return { move: body.move, at: this.now(), status: 'pending', generation };
    });
    if (!claim.committed) throw fail(409, 'A move was already submitted. Wait for the game to synchronize.', 'play_duplicate_move');
    try {
      const result = await this.json(`/api/board/game/${gameId}/move/${body.move}`, { token: connection.token, method: 'POST' });
      await lock.transaction(value => value?.generation === generation ? { ...value, status: 'accepted', settledAt: this.now() } : undefined); return result;
    } catch (error) {
      await lock.transaction(value => value?.generation === generation ? { ...value,
        status: error.statusCode >= 400 && error.statusCode < 500 ? 'rejected' : 'uncertain', settledAt: this.now() } : undefined); throw error;
    }
  }
  async action(uid, gameId, body) {
    const actions = { resign: 'resign', abort: 'abort', 'draw-yes': 'draw/yes', 'draw-no': 'draw/no', 'takeback-yes': 'takeback/yes', 'takeback-no': 'takeback/no' };
    if (!actions[body.action]) throw fail(400, 'Invalid game action.');
    const connection = await this.connection(uid); const { full, state } = await this.savedGame(uid, gameId);
    if (![full.white?.id, full.black?.id].some(value => lower(value) === lower(connection.profile.id))) throw fail(403, 'You can only control your own games.');
    if (FINISHED.has(state.status)) throw fail(409, 'This game has finished.', 'play_game_finished');
    return this.json(`/api/board/game/${id(gameId)}/${actions[body.action]}`, { token: connection.token, method: 'POST' });
  }
  async challenge(uid, body) {
    const { control, rated, color } = validateControl(body, 'challenge');
    if (!/^[A-Za-z0-9_-]{2,30}$/.test(body.username || '')) throw fail(400, 'Enter a valid Lichess username.');
    const connection = await this.connection(uid);
    if ((await this.active(uid, connection, true)).length) throw fail(409, 'Finish your active game first.', 'play_active_game');
    const result = await this.json(`/api/challenge/${encodeURIComponent(body.username)}`, { method: 'POST', token: connection.token,
      body: { 'clock.limit': control.time * 60, 'clock.increment': control.increment, rated, color, variant: 'standard' } });
    const normalized = result.challenge ? result : { challenge: result };
    await this.ref(`outgoing/${uid}/${id(normalized.challenge.id)}`).set({ expiresAt: this.now() + 30000 });
    return normalized;
  }
  async challengeAction(uid, challengeId, action) {
    if (!['accept', 'decline', 'cancel'].includes(action)) throw fail(400, 'Invalid challenge action.');
    const connection = await this.connection(uid);
    if (action === 'accept') {
      const all = await this.json('/api/challenge', { token: connection.token });
      const challenge = (all.in || []).find(item => item.id === challengeId);
      if (!challenge) throw fail(404, 'This challenge is no longer available.');
      const estimate = (challenge.timeControl?.limit || 0) + 40 * (challenge.timeControl?.increment || 0);
      if (challenge.variant?.key !== 'standard' || challenge.timeControl?.type !== 'clock' || estimate < 180) throw fail(400, 'This challenge is not supported by Play.', 'unsupported_time_control');
      if ((await this.active(uid, connection, true)).length) throw fail(409, 'Finish your active game first.', 'play_active_game');
    }
    const result = await this.json(`/api/challenge/${id(challengeId)}/${action}`, { token: connection.token, method: 'POST' });
    await this.ref(`outgoing/${uid}/${id(challengeId)}`).remove(); return result;
  }
  async pgn(uid, gameId) {
    gameId = id(gameId);
    const cached = await this.value(`completed/${uid}/${gameId}`);
    if (cached) return cached;
    const connection = await this.connection(uid);
    const game = await this.json(`/game/export/${gameId}?pgnInJson=true&clocks=true&evals=false&opening=false`, { token: connection.token });
    if (!FINISHED.has(game.status)) throw fail(409, 'Review is available after the game finishes.', 'play_game_active');
    if (![game.players?.white?.user?.id, game.players?.black?.user?.id].some(value => lower(value) === lower(connection.profile.id))) throw fail(403, 'You can only import your own Play games.');
    if (typeof game.pgn !== 'string' || !game.pgn.trim()) throw fail(502, 'The completed game is not available yet. Please try again.');
    const result = { pgn: game.pgn, game }; await this.ref(`completed/${uid}/${gameId}`).set(result); return result;
  }
}

module.exports = { PlayService, CONTROLS, FINISHED, REDIRECT, DEV_REDIRECT, validateControl, playUci, fail, id };
