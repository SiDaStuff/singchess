// Isolated browser/API fixtures: never connects to Lichess or starts a real game.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5173';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const pgn = '[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n[TimeControl "600+0"]\n\n1. e4 e5 2. Nf3 1-0';
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; console.log(`PASS ${message}`); };
const browser = await chromium.launch({ headless: true });
await fs.mkdir('artifacts/play', { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    let connected = true, active = false, finished = false, state = { type: 'gameState', moves: '', status: 'started', wtime: 600000, btime: 600000 }, seeks = 0, movePosts = [], callbackPosts = 0;
    const eventClients = new Set(), gameClients = new Set(), allResponses = new Set();
    const full = () => ({ type: 'gameFull', id: 'abcd1234', initialFen: 'startpos', variant: { key: 'standard' }, rated: false, speed: 'rapid', perf: { name: 'Rapid' }, clock: { initial: 600000, increment: 0 }, white: { id: 'alice', name: 'Alice', rating: 1600 }, black: { id: 'bob', name: 'Bob', rating: 1635 }, state });
    const profile = { id: 'alice', username: 'Alice', perfs: { rapid: { rating: 1600, games: 20 }, blitz: { rating: 1700, games: 30 } }, count: { all: 50, win: 23 } };
    const activeGames = () => active && !finished ? [{ gameId: 'abcd1234', color: 'white', speed: 'rapid', opponent: { username: 'Bob', rating: 1635 }, isMyTurn: true }] : [];
    const send = (clients, event) => { for (const res of clients) if (!res.destroyed) res.write('data: ' + JSON.stringify(event) + '\n\n'); };
    const server = http.createServer(async (req, res) => {
      res.setHeader('access-control-allow-origin', '*'); res.setHeader('access-control-allow-headers', 'authorization,content-type,accept,x-sid-device-id'); res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      allResponses.add(res); res.on('close', () => allResponses.delete(res));
      const chunks = []; for await (const chunk of req) chunks.push(chunk); const text = Buffer.concat(chunks).toString(); const body = text ? JSON.parse(text) : {};
      const url = new URL(req.url, 'http://localhost');
      const json = payload => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(payload)); };
      const stream = (set, event) => { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }); set.add(res); res.on('close', () => set.delete(res)); res.write('data: ' + JSON.stringify(event) + '\n\n'); };
      if (url.pathname === '/api/play/status' || url.pathname === '/api/play/active') return json({ configured: true, connected, profile, reviewStats: { gamesReviewed: 3, movesReviewed: 120, brilliant: 4, great: 7, best: 36 }, activeGames: activeGames(), recentGames: [] });
      if (url.pathname === '/api/play/events') return stream(eventClients, { type: 'connection', status: 'connected' });
      if (url.pathname === '/api/play/seek') { seeks++; assert.equal(body.rated, false); return stream(new Set(), { type: 'search', status: 'searching' }); }
      if (url.pathname === '/api/play/challenge') { assert.equal(body.time, 3); assert.equal(body.username, 'Friend'); return json({ challenge: { id: 'chal1234' } }); }
      if (url.pathname === '/api/play/challenge/chal1234/cancel') return json({ ok: true });
      if (url.pathname === '/api/play/game/abcd1234/stream') return stream(gameClients, full());
      if (url.pathname === '/api/play/game/abcd1234/move') { movePosts.push(body); state = { ...state, moves: [state.moves, body.move].filter(Boolean).join(' '), wtime: 598000 }; json({ ok: true }); setTimeout(() => send(gameClients, state), 250); return; }
      if (url.pathname === '/api/play/game/abcd1234/pgn') return json({ pgn, game: { id: 'abcd1234', createdAt: 1000000, lastMoveAt: 1120000, players: { white: { ratingDiff: 7 } }, status: 'resign' } });
      if (url.pathname === '/api/play/oauth/start') return json({ url: 'https://lichess.org/oauth?state=isolated' });
      if (url.pathname === '/api/play/oauth/callback') { callbackPosts++; assert.equal(body.code, 'fixture_code'); assert.equal(body.state, 'fixture_state'); connected = true; return json({ connected: true }); }
      if (url.pathname === '/api/play/disconnect') { connected = false; return json({ connected: false }); }
      res.statusCode = 503; json({ error: 'Isolated QA endpoint' });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const fixture = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    const errors = [], page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/play/')) return route.continue({ url: fixture + url.pathname + url.search });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Isolated QA endpoint"}' });
      if (url.origin !== new URL(base).origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort();
      return route.continue();
    });
    try {
      await page.goto(base + '/play'); await page.waitForFunction(() => window.Play && window.app.authState.initialized);
      check(await page.locator('#play-page h1').innerText().then(text => text.includes('Play') && text.includes('BETA')), `${width}: Play BETA route and native navigation`);
      check(await page.locator('[data-control="1+0"]').isDisabled(), `${width}: unsupported Bullet cannot be selected`);
      check(await page.locator('[data-play="account"]').innerText().then(text => text.includes('Sign in')), `${width}: account connection is explicit`);
      await page.evaluate(() => { const app = window.app; app.authState.user = { uid: 'qa-play', getIdToken: async () => 'isolated' }; app.authState.initialized = true; window.dispatchEvent(new CustomEvent('play:auth')); });
      await page.waitForFunction(() => window.Play.connected && window.Play.eventReady);
      check(await page.locator('[data-play="account"]').innerText().then(text => text.includes('Alice') && text.includes('1600')), `${width}: actual account and ratings render`);
      check(await page.locator('[data-play="account"]').innerText().then(text => text.includes('4\nbrilliant') && text.includes('120\nreviewed moves')), `${width}: connected account shows reviewed move statistics`);
      await page.locator('[data-action="settings"]').click(); await page.locator('[data-preference="coordinates"]').uncheck(); await page.locator('[data-action="close-settings"]').click();
      check(await page.evaluate(() => !window.Play.board.preferences.coordinates && !JSON.parse(localStorage.getItem('sidastuff.playPreferences')).coordinates), `${width}: settings persist`);
      await page.locator('[data-control="3+2"]').click(); await page.locator('[data-play="start"]').click();
      check(await page.locator('[data-play="friend"]').getAttribute('open') !== null && seeks === 0, `${width}: blitz uses direct challenges without a public seek`);
      await page.locator('[data-play="friend-name"]').fill('Friend'); await page.locator('[data-play="challenge-button"]').click();
      await page.waitForFunction(() => window.Play.challenge?.id === 'chal1234'); check(await page.locator('[data-play="outgoing"]').innerText().then(text => text.includes('Friend')), `${width}: real challenge request and cancellation`);
      await page.locator('[data-play="outgoing"] [data-action="cancel-search"]').click();
      await page.locator('[data-control="10+0"]').click(); await page.locator('[data-play="start"]').click({ noWaitAfter: true });
      await page.waitForFunction(() => !!window.Play.seekController);
      check(seeks === 1 && await page.locator('[data-play="search"]').isVisible(), `${width}: casual matchmaking opens a real cancellable request`);
      await page.locator('[data-play="search"] [data-action="cancel-search"]').click(); await page.waitForFunction(() => !window.Play.seekController);
      active = true; send(eventClients, { type: 'gameStart', game: activeGames()[0] });
      await page.waitForFunction(() => window.Play.full?.id === 'abcd1234' && window.Play.gameConnection === 'connected');
      check(await page.evaluate(() => window.PlayFairPlay.isBlocked() && window.Play.board.interactive), `${width}: live game activates board and fair-play guard`);
      const square = name => page.locator(`[data-play="board"] [data-square="${name}"]`);
      await square('e2').click(); await square('e4').click();
      check(await square('e4').locator('.piece').count() === 1 && await page.evaluate(() => window.Play.position?.ply === 0), `${width}: submitted move appears before SSE confirmation`);
      await page.waitForFunction(() => window.Play.position?.ply === 1);
      check(movePosts.length === 1 && movePosts[0].move === 'e2e4' && movePosts[0].ply === 0, `${width}: click-to-move submits once and applies server confirmation`);
      state = { ...state, moves: 'e2e4 e7e5', btime: 597000 }; send(gameClients, state); await page.waitForFunction(() => window.Play.position?.ply === 2);
      check(await page.locator('[data-play="clock-white"]').getAttribute('data-running') === 'true', `${width}: server clocks interpolate on the running side`);
      const beforeDuplicate = await page.evaluate(() => window.Play.clocks.clock.values().white);
      await page.waitForTimeout(150); send(gameClients, { ...state }); await page.waitForTimeout(150);
      check(await page.evaluate(before => window.Play.clocks.clock.values().white < before - 200, beforeDuplicate), `${width}: duplicate game state never adds time to the clock`);
      const preReconnect = await page.evaluate(() => window.Play.board.fen);
      await page.evaluate(() => window.Play.reconnectNow());
      check(await page.evaluate(fen => window.Play.board.fen === fen, preReconnect), `${width}: reconnect preserves the displayed position`);
      await page.waitForFunction(() => window.Play.gameConnection === 'connected');
      await page.evaluate(() => window.app._navigateTo('/review', { skipImport: true }));
      check(await page.locator('#play-fairplay-notice').isVisible(), `${width}: analysis stays locked after navigation`);
      await page.evaluate(() => window.app._navigateTo('/play')); await page.waitForTimeout(100);
      await page.evaluate(() => window.Play.showGame());
      await square('g1').click(); await square('f3').click(); await page.waitForFunction(() => window.Play.position?.ply === 3);
      finished = true; active = false; state = { ...state, status: 'resign', winner: 'white' }; send(gameClients, state);
      await page.waitForFunction(() => !document.querySelector('[data-play="results"]').hidden);
      check(await page.locator('[data-play="result-title"]').innerText() === 'Victory', `${width}: terminal server state immediately shows results`);
      check(await page.evaluate(() => window.Play.board.chess.get('f3')?.type === 'n' && !window.Play.board.interactive), `${width}: final board remains visible and cannot send moves`);
      check(await page.locator('[data-action="review"]').isVisible(), `${width}: Review Game is the prominent result action`);
      await page.waitForFunction(() => document.querySelector('[data-play="result-facts"]').textContent.includes('+7 rating'));
      check(await page.locator('[data-play="result-facts"]').innerText().then(text => text.includes('2 min')), `${width}: provider rating change and duration are shown when available`);
      await page.screenshot({ path: `artifacts/play/results-${width}.png`, fullPage: true });
      // Keep actual import/navigation, skip the expensive multi-move engine pass in this UI fixture.
      await page.evaluate(() => { window.app._startReview = async () => { window.__reviewRequested = true; }; });
      await page.locator('[data-action="review"]').click(); await page.waitForFunction(() => window.app.gameMoves.length === 3);
      check(await page.evaluate(() => window.app.gameHeaders.White === 'Alice' && window.app.gameHeaders.Result === '1-0'), `${width}: completed real PGN enters the existing review system`);
      await page.evaluate(() => { window.app._goToMove(0); }); check(await page.evaluate(() => window.app.currentMoveIndex === 0), `${width}: review navigation uses the original review workspace`);
      await page.evaluate(() => window.app._navigateTo('/play')); await page.evaluate(() => window.Play.showLobby());
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: Play fits the viewport`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `artifacts/play/lobby-${width}.png`, fullPage: true });
      if (width === 1440) {
        await page.evaluate(() => { window.app._navigateTo('/play/callback'); history.replaceState({}, '', '/play/callback?code=fixture_code&state=fixture_state'); window.dispatchEvent(new CustomEvent('play:route')); });
        await page.waitForFunction(() => location.pathname === '/play' && !location.search);
        check(callbackPosts === 1, 'OAuth callback submits code/state once and removes them from the URL');
        const callbackPage = await context.newPage();
        await callbackPage.goto(base + '/play/callback?code=fixture_code&state=fixture_state');
        await callbackPage.waitForFunction(() => window.Play && window.app.authState.initialized);
        check(await callbackPage.evaluate(() => !location.search && window.__PLAY_OAUTH_CALLBACK?.code === 'fixture_code' && !JSON.stringify(window.dataLayer || []).includes('fixture_code')), 'Cold OAuth callback strips credentials before analytics and waits for authentication');
        await callbackPage.evaluate(() => { window.app.authState.user = { uid: 'qa-play', getIdToken: async () => 'isolated' }; window.dispatchEvent(new CustomEvent('play:auth')); });
        await callbackPage.waitForFunction(() => location.pathname === '/play' && !window.__PLAY_OAUTH_CALLBACK);
        check(callbackPosts === 2, 'Cold OAuth callback exchanges tab-memory credentials once after sign-in');
        await callbackPage.close();
      }
      check(errors.length === 0, `${width}: no browser runtime errors (${errors.join(', ')})`);
    } finally { await context.close(); for (const res of allResponses) res.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
} finally { await browser.close(); }
console.log(`${checks} Play browser integration checks passed. No real games were created.`);
