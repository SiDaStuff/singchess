/**
 * Browser regression checks for the working chess UI.
 * Start Vite first, then run: node scripts/test-ui.mjs
 * Requires optional playwright-core (or PLAYWRIGHT_MODULE pointing to it).
 * All application API traffic is isolated: public stats use a fixture and
 * other API requests receive an intentional 503. No authentication, payment,
 * contact, analytics, or production data is written by this harness.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core'));
} catch {
  console.error('Install playwright-core for browser QA, or set PLAYWRIGHT_MODULE to an existing installation.');
  process.exit(1);
}

const baseUrl = process.env.UI_TEST_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/ui');
const widths = process.argv.includes('--quick') ? [1440, 390] : [1440, 1024, 390, 320];
const routes = ['/', '/review', '/settings', '/login', '/signup', '/account', '/coach',
  '/puzzles', '/anticheat', '/plans', '/contact', '/privacy', '/terms', '/auth',
  '/profile/qa-missing-player', '/anticheat/report/qa-missing-report', '/404'];
const report = { baseUrl, isolatedApis: true, localEngineAssets: true, widths, checks: [], screens: [], runtimeErrors: [], apiRequests: [], engineAssets: [] };
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });

async function check(name, action) {
  try {
    await action();
    report.checks.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({ name, passed: false, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

async function navigate(page, route, options = {}) {
  await page.evaluate(({ route, options }) => window.app._navigateTo(route, options), { route, options });
  await page.waitForTimeout(220);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function snapshot(page, name, width) {
  await page.evaluate(() => window.scrollTo(0, 0));
  if (await page.locator('#chess-board').isVisible()) await renderedBoardMatches(page);
  await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true, animations: 'disabled', caret: 'hide' });
  const measurements = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const overflowing = [...document.querySelectorAll('main *, #app *, .modal-overlay *')]
      .filter(el => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const outside = rect.width && rect.height && style.visibility !== 'hidden' && style.display !== 'none'
          && rect.right > viewport + 2 && rect.left >= 0;
        if (!outside) return false;
        // Content beyond a deliberate horizontal scroller is reachable by
        // scrolling; it does not count as clipped page content.
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
          const parentStyle = getComputedStyle(parent);
          const parentRect = parent.getBoundingClientRect();
          if (['auto', 'scroll'].includes(parentStyle.overflowX)
            && parent.scrollWidth > parent.clientWidth
            && parentRect.left >= 0 && parentRect.right <= viewport + 2) return false;
        }
        return true;
      }).slice(0, 12).map(el => ({ tag: el.tagName, id: el.id, class: el.className,
        right: Math.round(el.getBoundingClientRect().right) }));
    const board = document.getElementById('chess-board');
    const rect = board?.getBoundingClientRect();
    const evaluationBar = document.getElementById('eval-bar')?.getBoundingClientRect();
    const heading = [...document.querySelectorAll('h1, h2')].find(el => el.getBoundingClientRect().height > 0);
    return { viewport, scrollWidth: document.documentElement.scrollWidth, overflowing,
      heading: heading?.textContent.trim(), board: rect?.width ? { width: rect.width, height: rect.height } : null,
      evaluationBarHeight: evaluationBar?.width ? evaluationBar.height : null };
  });
  report.screens.push({ name, width, ...measurements });
  assert.ok(measurements.scrollWidth <= width + 2, `Page overflows horizontally (${measurements.scrollWidth}px at ${width}px)`);
  assert.ok(!measurements.overflowing.length, `Clipped content: ${JSON.stringify(measurements.overflowing)}`);
  if (measurements.board) {
    assert.ok(Math.abs(measurements.board.width - measurements.board.height) < 2, 'Chessboard must remain square');
    if (measurements.evaluationBarHeight) assert.ok(Math.abs(measurements.evaluationBarHeight - measurements.board.height) < 3, 'Evaluation bar must follow the board height');
  }
}

async function renderedBoardMatches(page) {
  const result = await page.evaluate(() => {
    const names = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };
    const mismatches = [];
    for (const square of document.querySelectorAll('#chess-board [data-square]')) {
      const expected = window.app.board.position[square.dataset.square];
      const images = [...square.querySelectorAll('img.piece')];
      if (images.length !== (expected ? 1 : 0)) mismatches.push(`${square.dataset.square}: expected ${expected || 'empty'}, found ${images.length} pieces`);
      if (expected && images[0]) {
        const label = `${expected[0] === 'w' ? 'White' : 'Black'} ${names[expected[1].toUpperCase()]}`;
        if (images[0].alt !== label) mismatches.push(`${square.dataset.square}: wrong piece description ${images[0].alt}`);
        if (!images[0].complete || images[0].naturalWidth === 0) mismatches.push(`${square.dataset.square}: piece image did not load`);
      }
    }
    return { squares: document.querySelectorAll('#chess-board [data-square]').length, mismatches };
  });
  assert.equal(result.squares, 64);
  assert.deepEqual(result.mismatches, [], `Rendered pieces must match the legal position: ${result.mismatches.join(', ')}`);
}

try {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 960 },
      reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/api/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      report.apiRequests.push({ path: pathname, method: request.method() });
      await route.fulfill({ status: pathname === '/api/public-stats' ? 200 : 503,
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
        contentType: 'application/json', body: JSON.stringify(pathname === '/api/public-stats'
          ? { stats: { movesAnalyzed: 14280, puzzlesSolved: 9821, coachGamesPlayed: 1540 } }
          : { error: 'The local QA API is unavailable. Please try again.' }) });
    });
    // Production API configuration can point vendor URLs to a remote backend.
    // Serve the repository's real Stockfish JS/WASM bytes for isolated QA.
    await context.route(url => url.pathname.startsWith('/vendor/stockfish/'), async route => {
      const filename = path.basename(new URL(route.request().url()).pathname);
      const localFile = path.resolve('public/vendor/stockfish', filename);
      report.engineAssets.push(filename);
      await route.fulfill({ path: localFile, contentType: filename.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
        headers: { 'access-control-allow-origin': '*' } });
    });
    await context.route(url => /google-analytics\.com|googletagmanager\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firebaseio\.com/.test(url.hostname), route => route.abort());
    await context.addInitScript(() => localStorage.setItem('sidastuff.engineSettings', JSON.stringify({
      source: 'browser', module: 'lite-single', analysisLocation: 'browser', reviewStrength: 'quick', liveDeepening: false, forcedDepth: 10,
    })));
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.runtimeErrors.push({ width, route: page.url(), message: error.message }));
    page.on('dialog', dialog => dialog.dismiss());
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.app?._navigateTo === 'function', null, { timeout: 20000 });
    await check(`${width}px real browser engine initialization`, async () => {
      await page.waitForFunction(() => window.app.engine?.ready, null, { timeout: 30000 });
    });

    for (const route of routes) {
      await check(`${width}px ${route} layout`, async () => {
        await navigate(page, route);
        const name = route === '/' ? 'home' : route.slice(1).replaceAll('/', '-');
        await snapshot(page, name, width);
        if (route === '/review') await page.keyboard.press('Escape');
      });
    }

    await check(`${width}px sample import and move navigation`, async () => {
      await navigate(page, '/');
      await page.locator('#btn-home-sample').click();
      await page.waitForFunction(() => window.app.gameMoves.length > 10);
      assert.equal(new URL(page.url()).pathname, '/review');
      assert.ok(await page.locator('#sc-sidebar [data-nav="review"]').evaluate(el => el.classList.contains('active')));
      await page.waitForFunction(() => document.getElementById('loading-overlay').hidden);
      assert.ok(await page.locator('#chess-board').isVisible(), 'Imported game board is visible');
      const total = await page.evaluate(() => window.app.gameMoves.length);
      await page.locator('#btn-last').click();
      assert.equal(await page.evaluate(() => window.app.currentMoveIndex), total - 1);
      await page.locator('#btn-first').click();
      assert.equal(await page.evaluate(() => window.app.currentMoveIndex), -1);
      await page.locator('#btn-next').click();
      assert.equal(await page.evaluate(() => window.app.currentMoveIndex), 0);
      await page.locator('#btn-prev').click();
      assert.equal(await page.evaluate(() => window.app.currentMoveIndex), -1);
      await page.locator('#btn-next').focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => window.app.currentMoveIndex), 0);
      const flipped = await page.evaluate(() => window.app.board.flipped);
      await page.locator('#btn-flip').click();
      assert.equal(await page.evaluate(() => window.app.board.flipped), !flipped);
      await page.locator('#btn-flip').click();
      await snapshot(page, 'sample-review', width);
      await renderedBoardMatches(page);
    });

    await check(`${width}px import tabs, close and focus`, async () => {
      await page.locator('#btn-import-game').click();
      const modal = page.locator('#pgn-modal');
      assert.ok(await modal.isVisible());
      await modal.locator('[data-import-tab="lichess"]').click();
      assert.ok(await modal.locator('#import-username-lichess').isVisible());
      await modal.locator('[data-import-tab="chesscom"]').click();
      assert.ok(await modal.locator('#import-username-chesscom').isVisible());
      await modal.locator('[data-import-tab="pgn"]').click();
      assert.ok(await modal.locator('#pgn-input').isVisible());
      await page.keyboard.press('Escape');
      assert.ok(!(await modal.isVisible()));
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-import-game');
      await page.locator('#btn-import-game').click();
      await modal.locator('#modal-close').click();
      assert.ok(!(await modal.isVisible()));
    });

    await check(`${width}px analysis tabs and keyboard focus`, async () => {
      const tabs = page.locator('#analysis-tabs');
      await tabs.locator('[data-panel="moves"]').click();
      assert.ok(await page.locator('#move-list-container').isVisible());
      assert.ok(!(await page.locator('#eval-graph-card').isVisible()));
      const move = await page.evaluate(() => window.app.currentMoveIndex);
      await page.keyboard.press('ArrowRight');
      assert.equal(await tabs.locator('[data-panel="graph"]').getAttribute('aria-selected'), 'true');
      assert.equal(await page.evaluate(() => window.app.currentMoveIndex), move, 'Switching tabs must preserve board position');
      assert.ok(await page.locator('#eval-graph-card').isVisible());
      await tabs.locator('[data-panel="feedback"]').click();
      await page.locator('#chess-board [data-square="e2"]').focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.square), 'f2');
      assert.equal(await page.evaluate(() => window.app.currentMoveIndex), move, 'Moving square focus must preserve board position');
    });

    await check(`${width}px illegal and legal chess moves`, async () => {
      await page.locator('#btn-first').click();
      const initial = await page.evaluate(() => window.app.chess.fen());
      await page.locator('#chess-board [data-square="e2"]').click();
      await page.locator('#chess-board [data-square="e5"]').click();
      assert.equal(await page.evaluate(() => window.app.chess.fen()), initial, 'Illegal pawn move rejected');
      await page.locator('#chess-board [data-square="e2"]').click();
      await page.locator('#chess-board [data-square="e4"]').click();
      await page.waitForFunction(() => window.app.chess.get('e4')?.type === 'p');
      assert.equal(await page.evaluate(() => window.app.chess.turn()), 'b');
      await renderedBoardMatches(page);
    });

    await check(`${width}px PGN starting position and underpromotion`, async () => {
      await page.locator('#btn-import-game').click();
      await page.locator('#pgn-modal [data-import-tab="pgn"]').click();
      await page.locator('#pgn-input').fill('[SetUp "1"]\n[FEN "7k/8/P7/8/8/8/8/7K w - - 0 1"]\n[Result "*"]\n\n1. a7 Kh7 *');
      await page.locator('#btn-pgn-load').click();
      await page.waitForFunction(() => window.app.gameMoves.length === 2);
      await page.locator('#btn-last').click();
      await page.locator('#chess-board [data-square="a7"]').click();
      await page.locator('#chess-board [data-square="a8"]').click();
      assert.ok(await page.locator('#promotion-modal').isVisible());
      await snapshot(page, 'promotion', width);
      await page.locator('#promotion-options [data-piece="n"]').click();
      await page.waitForFunction(() => window.app.chess.get('a8')?.type === 'n');
      assert.ok(!(await page.locator('#promotion-modal').isVisible()));
    });

    await check(`${width}px imported clocks, captures and flipped players`, async () => {
      for (const control of ['300', '300+0']) {
        await page.locator('#btn-import-game').click();
        await page.locator('#pgn-modal [data-import-tab="pgn"]').click();
        await page.locator('#pgn-input').fill(`[White "White QA"]\n[Black "Black QA"]\n[TimeControl "${control}"]\n[Result "*"]\n\n1. e4 {[%clk 0:04:59]} d5 {[%clk 0:04:57]} 2. exd5 {[%clk 0:04:54]} Qxd5 {[%clk 0:04:51]} *`);
        await page.locator('#btn-pgn-load').click();
        await page.waitForFunction(() => window.app.gameMoves.length === 4);
        await page.locator('#btn-last').click();
        if (await page.evaluate(() => window.app.board.flipped)) await page.locator('#btn-flip').click();
        assert.equal(await page.locator('#captured-top .captured-piece').count(), 1);
        assert.equal(await page.locator('#captured-bottom .captured-piece').count(), 1);
        assert.match(await page.locator('#player-top-clock').innerText(), /4:51/);
        assert.match(await page.locator('#player-bottom-clock').innerText(), /4:54/);
        await page.locator('#btn-flip').click();
        assert.match(await page.locator('#player-top-clock').innerText(), /4:54/);
        assert.match(await page.locator('#player-bottom-clock').innerText(), /4:51/);
      }
      await snapshot(page, 'clocks-captures', width);
    });

    await check(`${width}px browser Stockfish game review`, async () => {
      await page.locator('#btn-import-game').click();
      await page.locator('#pgn-modal [data-import-tab="pgn"]').click();
      await page.locator('#pgn-input').fill('[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *');
      await page.locator('#btn-pgn-load').click();
      await page.waitForFunction(() => window.app.engine?.ready);
      await page.locator('#btn-review').click();
      await page.waitForFunction(() => !window.app.isAnalyzing && window.app.analysisResults?.length === 4, null, { timeout: 60000 });
      assert.ok(await page.locator('#review-summary').isVisible());
      assert.ok(!(await page.locator('#review-progress-step').isVisible()), 'Completed reviews clear their progress message');
      assert.ok(await page.evaluate(() => window.app.analysisResults.every(move => !!move.classificationKey)));
      await snapshot(page, 'review-complete', width);
    });

    await check(`${width}px appearance preview and persistence`, async () => {
      await navigate(page, '/settings');
      for (const link of await page.locator('.settings-nav a').all()) {
        await link.scrollIntoViewIfNeeded();
        await link.click({ trial: true });
        const bounds = await link.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 2, 'Every settings category is reachable inside its scroller');
      }
      await page.locator('label:has(input[name="settings-board-theme"][value="green"])').click();
      assert.ok(await page.locator('input[name="settings-board-theme"][value="green"]').isChecked());
      assert.ok(await page.locator('#appearance-board-preview').isVisible());
      await page.locator('#btn-save-appearance-settings').click();
      await page.waitForFunction(() => typeof window.app?._navigateTo === 'function');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sidastuff.appearanceSettings')).boardTheme), 'green');
      await snapshot(page, 'settings-green', width);
    });

    await check(`${width}px signup wizard navigation`, async () => {
      await navigate(page, '/signup');
      await page.locator('#btn-onboard-next-1').click();
      assert.ok(await page.locator('#onboard-step-2').isVisible());
      await page.locator('#btn-onboard-next-2').click();
      assert.ok(await page.locator('#onboard-step-3').isVisible());
      await page.locator('#onboard-lichess-username').fill('test-player');
      await page.locator('#btn-onboard-next-3').click();
      assert.ok(await page.locator('#signup-email').isVisible());
      await snapshot(page, 'signup-account', width);
      await page.locator('#btn-onboard-back-4').click();
      await page.locator('#btn-onboard-back-3').click();
      await page.locator('#btn-onboard-back-2').click();
      assert.ok(await page.locator('#onboard-step-1').isVisible());
    });

    await check(`${width}px sign-in and contact validation`, async () => {
      await navigate(page, '/login');
      await page.locator('#btn-login-submit').click();
      assert.ok(await page.locator('#login-status').innerText(), 'Incomplete credentials show form feedback');
      assert.ok(await page.locator('#page-login').isVisible(), 'Validation keeps the sign-in form open');
      await page.locator('#login-password').focus();
      await page.keyboard.press('Enter');
      assert.ok(await page.locator('#login-status').innerText(), 'Enter submits the same validation');
      assert.ok(await page.locator('#page-login').isVisible());
      await page.locator('#btn-login-forgot-password').click();
      assert.match(await page.locator('#login-status').innerText(), /email/i);
      await navigate(page, '/contact');
      await page.locator('#btn-contact-submit').click();
      assert.match(await page.locator('#contact-status').innerText(), /email/i);
      await page.locator('#contact-email').fill('qa@example.test');
      await page.locator('#btn-contact-submit').click();
      assert.match(await page.locator('#contact-status').innerText(), /message/i);
    });

    await check(`${width}px coach history and game setup dialog`, async () => {
      await navigate(page, '/coach');
      assert.ok(await page.locator('#coach-chat-locked').isVisible(), 'Signed-out coach explains account access');
      const toggle = page.locator('#btn-coach-sidebar-toggle');
      const expanded = await toggle.getAttribute('aria-expanded');
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), String(expanded !== 'true'));
      if (width <= 720) {
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        await page.keyboard.press('Escape');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      }
      await page.locator('#btn-coach-play-bot').click();
      await page.locator('.swal2-popup').waitFor({ state: 'visible' });
      assert.ok(await page.locator('.swal2-popup').isVisible(), 'Coach setup retains its interactive form');
      assert.ok(await page.locator('input[name="swal-coach-diff"]').count() > 0);
      await snapshot(page, 'coach-setup', width);
      await page.keyboard.press('Escape');
      await page.locator('.swal2-popup').waitFor({ state: 'hidden' });
      assert.ok(!(await page.locator('.swal2-popup').isVisible()));
    });

    if (width === 1440 || width === 390) {
      await check(`${width}px real browser bot reply`, async () => {
        await page.locator('#btn-coach-play-bot').click();
        await page.locator('.swal2-confirm').click();
        await page.waitForFunction(() => window.app.coachMode.active && window.app.engine?.ready && window.app.gameMoves.length === 0);
        await page.locator('#chess-board [data-square="e2"]').click();
        await page.locator('#chess-board [data-square="e4"]').click();
        await page.waitForFunction(() => window.app.gameMoves.length >= 2 && !window.app.coachMode.thinking, null, { timeout: 30000 });
        assert.equal(await page.evaluate(() => window.app.chess.turn()), 'w');
        assert.ok(!(await page.locator('#page-coach').isVisible()), 'Bot game replaces the coach chat page');
        await snapshot(page, 'bot-reply', width);
      });
    }

    await check(`${width}px deep link, reload and browser history`, async () => {
      await page.goto(`${baseUrl}/settings`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window.app?._navigateTo === 'function');
      assert.ok(await page.locator('#page-settings').isVisible());
      assert.ok(await page.locator('input[name="settings-board-theme"][value="green"]').isChecked(), 'Appearance survives reload');
      await navigate(page, '/login');
      await page.goBack();
      assert.ok(await page.locator('#page-settings').isVisible());
      await page.goForward();
      assert.ok(await page.locator('#page-login').isVisible());
    });

    if (await page.locator('#apple-nav-toggle').isVisible()) {
      await check(`${width}px mobile navigation and Escape`, async () => {
        await page.locator('#apple-nav-toggle').click();
        assert.equal(await page.locator('#apple-nav-toggle').getAttribute('aria-expanded'), 'true');
        const sidebar = page.locator('#sc-sidebar');
        await sidebar.locator('[data-nav="puzzles"]').click();
        assert.equal(await page.locator('#apple-nav-toggle').getAttribute('aria-expanded'), 'false');
        assert.ok(await page.locator('#puzzle-card').isVisible());
        await page.locator('#apple-nav-toggle').click();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#apple-nav-toggle').getAttribute('aria-expanded'), 'false');
      });
    }
    await context.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
}

const failed = report.checks.filter(check => !check.passed);
console.log(`${report.checks.length - failed.length}/${report.checks.length} checks passed; ${report.runtimeErrors.length} runtime errors.`);
console.log(`Screenshots and report: ${output}`);
if (failed.length || report.runtimeErrors.length) process.exitCode = 1;
