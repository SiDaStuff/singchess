import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadAnalyzer, loadChess } = require('../server/api/_lib/analysis-loader');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:4173';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true });
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; console.log(`PASS ${message}`); };
const game = { source: 'lichess', username: 'qa', white: 'qa', black: 'Opponent', headers: { Result: '1-0', UTCDate: '2026.10.13', UTCTime: '12:00:00' }, pgn: '[White "qa"]\n[Black "Opponent"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0' };
const Chess = loadChess(), parsed = new Chess(); parsed.load_pgn(game.pgn);
const { MoveAnalyzer } = loadAnalyzer(); const analyzer = new MoveAnalyzer();
const moves = parsed.history();
const evals = analyzer._positionsForMoves(moves).map(fen => {
  const choice = new Chess(fen).moves({ verbose: true })[0];
  const uci = choice.from + choice.to + (choice.promotion || '');
  return { cp: 0, bestMove: uci, pv: uci, depth: 12, lines: [{ cp: 0, move: uci, pvUci: uci, pvSan: choice.san, depth: 12 }] };
});
const analyzed = await analyzer.analyzeGame(moves, null, null, { evals });
const review = { results: Array.from(analyzed) };
for (const key of ['whiteAccuracy', 'blackAccuracy', 'whiteAcpl', 'blackAcpl', 'whiteCaps', 'blackCaps', 'whiteGameRating', 'blackGameRating', 'phaseSummary', 'criticalMoments']) if (analyzed[key] !== undefined) review[key] = analyzed[key];
const id = 'a'.repeat(64);
await fs.mkdir('artifacts/linked-chess', { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    const profile = { username: 'qa-player', savedUsernames: { lichess: 'qa', chesscom: 'qa-chess' }, puzzleRating: 1500, puzzleStats: {} };
    let enabled = false, posts = [], reviewReady = false, automaticStatus = 'watching';
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) {
        const method = route.request().method();
        const body = method === 'POST' ? route.request().postDataJSON() : null;
        if (body) posts.push({ path: url.pathname, ...body });
        let payload;
        const linked = Object.entries(profile.savedUsernames).filter(([, name]) => name).map(([source, username]) => ({ source, username, puzzleRating: source === 'lichess' ? 1780 : 2345, ratingKind: source === 'lichess' ? 'current' : 'peak', ratings: { blitz: 1650 }, latest: { ...game, source, username, headers: source === 'lichess' ? game.headers : { ...game.headers, UTCDate: '2026.10.12' } }, games: [game] }));
        // The synthetic account has no live game. A 503 here correctly keeps
        // the real fair-play guard locked, so provide an authoritative fixture.
        if (['/api/play/active', '/api/play/status'].includes(url.pathname)) payload = { configured: true, connected: false, activeGames: [] };
        else if (url.pathname === '/api/linked-chess') {
          if (body?.action === 'import-rating') profile.puzzleRating = body.source === 'lichess' ? 1780 : 2345;
          if (body?.action === 'unlink') profile.savedUsernames[body.source] = '';
          payload = { linked: body?.action === 'unlink' ? linked.filter(item => item.source !== body.source) : linked };
        } else if (url.pathname === '/api/max-auto-review') {
          if (body) enabled = body.enabled;
          const metadata = { id, source: 'lichess', username: 'qa', white: 'qa', black: 'Opponent', createdAt: Date.now() };
          payload = url.searchParams.get('id') ? { review: { ...metadata, pgn: game.pgn, review } } : { eligible: Object.values(profile.savedUsernames).some(Boolean), enabled, status: enabled ? automaticStatus : 'paused', lastCheckedAt: Date.now(), workerLastTickAt: Date.now(), nextCheckAt: Date.now() + 300000, usedToday: automaticStatus === 'retrying' ? 1 : 0, reviews: reviewReady ? [metadata] : [] };
        } else if (url.pathname === '/api/users/me') payload = { profile, plan: { plan: 'max', name: 'Max' }, usage: {}, limits: {}, isAdmin: false };
        else payload = { error: 'Isolated QA endpoint' };
        return route.fulfill({ status: payload.error ? 503 : 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(payload) });
      }
      if (url.origin !== new URL(base).origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => window.app?._navigateTo && window.LinkedChessHub && window.app.authState.initialized);
    await page.evaluate(profile => {
      window.app.authState.user = { uid: 'qa-linked', getIdToken: async () => 'isolated-token' };
      window.app.authState.profile = profile;
      window.app.authState.plan = { plan: 'max', name: 'Max' };
      window.app._loadSavedUsernames();
      window.app._syncAccountUi();
    }, profile);
    await page.waitForFunction(() => window.LinkedStudyGame?.username === 'qa');
    check(await page.locator('#home-study-white').innerText() === 'qa', `${width}: study board uses linked latest game`);
    await page.locator('#btn-home-sample').click();
    await page.waitForTimeout(200);
    check(await page.evaluate(() => window.app.gameMoves.length === 4 && window.app.gameHeaders.White === 'qa'), `${width}: study button imports the actual linked PGN`);
    await page.evaluate(() => window.app._navigateTo('/settings'));
    const hub = page.locator('#page-settings .linked-hub');
    await hub.locator('[data-source="lichess"] [data-action="games"]').click();
    check(await page.locator('#import-results').innerText().then(text => text.includes('qa')), `${width}: cached recent games open immediately`);
    await page.locator('#modal-close').click();
    await page.evaluate(() => window.app._navigateTo('/settings'));
    check(await hub.locator('[data-source="chesscom"]').innerText().then(text => text.includes('Puzzle peak')), `${width}: Chess.com peak labeled accurately`);
    await hub.locator('[data-source="lichess"] [data-action="import-rating"]').click();
    await page.waitForFunction(() => window.app.puzzleMode.rating === 1780);
    check(await page.evaluate(() => window.app.authState.profile.puzzleRating === 1780), `${width}: explicit puzzle rating import`);
    const toggle = hub.locator('[data-auto-toggle]');
    await toggle.check();
    await page.waitForFunction(() => document.querySelector('#page-settings .auto-review-beta').textContent.includes('watching'));
    check(enabled && posts.some(post => post.path === '/api/max-auto-review' && post.enabled), `${width}: Max opt-in wired to backend`);
    check(await hub.locator('[data-auto-status]').innerText().then(text => text.includes('Watching your connected Lichess Play account') && !text.includes('Enable automatic reviews')), `${width}: enabled empty list shows watching state`);
    automaticStatus = 'retrying';
    await page.evaluate(() => window.LinkedChessHub.refresh());
    check(await hub.locator('[data-auto-status]').innerText().then(text => text.includes('last attempt failed') && text.includes('server will retry')), `${width}: failed attempt shows retry status`);
    check(await hub.innerText().then(text => text.includes('1 / 12 review attempts')), `${width}: usage is labeled as attempts`);
    automaticStatus = 'watching'; reviewReady = true;
    await page.evaluate(() => window.LinkedChessHub.refresh());
    await hub.locator('[data-review]').first().click();
    await page.waitForFunction(() => window.app.analysisResults?.length === 4);
    check(await page.locator('#review-summary').isVisible(), `${width}: saved auto review opens in real review workspace`);
    await page.evaluate(() => window.app._navigateTo('/settings'));
    await hub.locator('[data-source="lichess"] [data-action="unlink"]').click();
    await page.waitForFunction(() => window.LinkedStudyGame?.source === 'chesscom');
    await hub.locator('[data-source="chesscom"] [data-action="unlink"]').click();
    await page.waitForFunction(() => !window.LinkedStudyGame);
    check(await page.locator('#home-study-white').innerText() === 'Paul Morphy', `${width}: unlink clears private study context`);
    await page.waitForFunction(() => document.querySelector('#page-settings [data-auto-toggle]')?.disabled);
    check(await toggle.isDisabled(), `${width}: beta disables when all accounts are unlinked`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: connected settings fit viewport`);
    await page.screenshot({ path: `artifacts/linked-chess/settings-${width}.png`, fullPage: true });
    check(!errors.length, `${width}: no runtime errors (${errors.join(', ')})`);
    await context.close();
  }
  console.log(`${checks} linked-account browser checks passed.`);
} finally { await browser.close(); }
