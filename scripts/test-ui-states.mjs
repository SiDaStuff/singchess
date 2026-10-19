/**
 * Signed-in frontend regression checks with synthetic users and local fixtures.
 * Run against an existing dev/preview server:
 *   UI_TEST_URL=http://127.0.0.1:4173 node scripts/test-ui-states.mjs
 *
 * Every API request is fulfilled by this harness; every external network
 * request is blocked. Firebase receives no credentials. Account fixtures are
 * assigned to the frontend controller after its real signed-out initialization.
 * Coach tests use only browser-local persisted fixtures and never send a chat.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const baseUrl = process.env.UI_TEST_URL || 'http://127.0.0.1:4173';
const localOrigin = new URL(baseUrl).origin;
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname), 'QA requires a localhost server');
const widths = process.argv.includes('--quick') ? [1440, 320] : [1440, 390, 320];
const output = path.resolve('artifacts/ui-states');
const report = { baseUrl, isolatedApis: true, syntheticAuth: true, widths,
  checks: [], screens: [], runtimeErrors: [], apiRequests: [], blockedExternalRequests: [] };
await fs.mkdir(output, { recursive: true });

const uid = 'qa-browser-local-user';
const username = 'GrandmasterOfTheVeryLongEndgameRoom1234567'.slice(0, 40);
const email = 'playerwithaverylongvalidemailaddress1234567890@averylongchessdevelopmentdomain.example';
const fixtureProfile = { uid, username, email, onboardingComplete: true,
  puzzleRating: 2097, puzzleStats: { solved: 98765, attempted: 109876, streak: 137 },
  createdAt: Date.UTC(2025, 0, 15), savedUsernames: { lichess: '', chesscom: '' } };
function accountFixture(plan = 'boost', isAdmin = false) {
  return { profile: fixtureProfile, plan: { plan, name: plan === 'boost' ? 'Boost' : plan === 'max' ? 'Max' : 'Free' },
    usage: { serverReviews: 3, anticheatGames: plan === 'max' ? 101 : 24, coachTokens: 19456,
      coachTokenLimit: plan === 'max' ? 100000 : plan === 'boost' ? 20000 : 5000 },
    limits: { serverReviewsPerDay: plan === 'free' ? 3 : null,
      anticheatGamesPerWeek: plan === 'max' ? 100 : plan === 'boost' ? 25 : 0,
      coachTokensPerDay: plan === 'max' ? 100000 : plan === 'boost' ? 20000 : 5000 },
    isAdmin, usernameCooldown: { canChangeAt: Date.now() + 2 * 86400000 } };
}

const supportFixture = { messages: [{ id: 'qa-support-1', uid: 'qa-other-local-user', email,
  reason: 'bug', createdAt: Date.UTC(2026, 8, 15),
  message: 'The board looked unusual after flipping. ' + 'LongUnbrokenDiagnosticText'.repeat(7)
    + '\n<script>window.__qaUnsafeScript = true</script>' }] };
const abuseFixture = { flagged: [{ uid: 'qa-flagged-user', email, plan: 'boost', usageScore: 19.7,
  usageLevel: 'high', reportCount: 31, banned: false, multiAccountCount: 2,
  reasons: ['Repeated automated requests', 'A reported message with <script>unsafe text</script>'],
  usageDetails: ['DiagnosticDetail'.repeat(12)], notes: [{ id: 'qa-note-1', text: 'A local-only moderation fixture. '
    + 'UnbrokenNote'.repeat(15), author: 'localmoderatorwithaverylongname@example.test', updatedAt: Date.UTC(2026, 8, 16) }] }] };

const initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const chats = [
  { id: 'qa-opening-chat', title: 'The Italian Game and a thoughtful plan for the middlegame', createdAt: 1,
    messages: [{ role: 'user', content: 'Please explain this position. <img src=x onerror="window.__qaUnsafeScript=true">', ts: 1 },
      { role: 'assistant', content: '## A clear opening plan\n\nDevelop your pieces and keep your king safe.\n\n'
        + '```board\n' + initialFen + '\n```\n\n'
        + '| Move | Purpose |\n|---|---|\n| `Nf3` | Develop with tempo |\n| `Bc4` | Watch f7 |\n\n'
        + '> Look for the next useful move.\n\n- Develop a knight.\n- Castle when it is safe.\n\n'
        + '[A deliberately long source label that stays readable](https://example.test/chess-study)\n\n'
        + '```pgn\n1. e4 e5 2. Nf3 Nc6 3. Bc4\n```', ts: 2 }] },
  { id: 'qa-locked-chat', title: 'A finished study session', locked: true, createdAt: 3,
    messages: [{ role: 'assistant', content: 'This study session is complete. Start a new conversation for your next position.', ts: 3 }] },
  { id: 'qa-delete-chat', title: 'A practice chat to delete with the keyboard', createdAt: 4,
    messages: [{ role: 'user', content: 'A browser-local note that may be deleted.', ts: 4 }] },
];

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

async function setAccount(page, me) {
  await page.evaluate(({ me, uid, email }) => {
    const app = window.app;
    Object.assign(app.authState, { initialized: true, user: { uid, email,
      displayName: me.profile.username, getIdToken: async () => 'qa-only-synthetic-token' },
    profile: me.profile, me, plan: me.plan, usage: me.usage, limits: me.limits,
    isAdmin: me.isAdmin, usernameCooldown: me.usernameCooldown });
    app._syncAccountUi();
  }, { me, uid, email });
}

async function navigate(page, route) {
  await page.evaluate(route => window.app._navigateTo(route, { disableRestore: true }), route);
  await page.waitForTimeout(250);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function snapshot(page, name, width) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, `${name}-${width}.png`),
    fullPage: true, animations: 'disabled', caret: 'hide' });
  const dimensions = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const overflowing = [...document.querySelectorAll('#app *')].filter(el => {
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none'
        || rect.right <= viewport + 2 || rect.left < 0) return false;
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent), parentRect = parent.getBoundingClientRect();
        if (['auto', 'scroll'].includes(parentStyle.overflowX)
          && parent.scrollWidth > parent.clientWidth
          && parentRect.left >= 0 && parentRect.right <= viewport + 2) return false;
      }
      return true;
    }).map(el => ({ tag: el.tagName, id: el.id, class: el.className,
      right: Math.round(el.getBoundingClientRect().right) })).slice(0, 12);
    return { viewport, scrollWidth: document.documentElement.scrollWidth, overflowing };
  });
  report.screens.push({ name, width, ...dimensions });
  assert.ok(dimensions.scrollWidth <= width + 2, `Horizontal overflow: ${dimensions.scrollWidth}px at ${width}px`);
  assert.equal(dimensions.overflowing.length, 0, `Clipped descendants: ${JSON.stringify(dimensions.overflowing)}`);
}

const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });

try {
  for (const width of widths) {
    let currentAccount = accountFixture();
    const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 960 },
      reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) {
        report.apiRequests.push({ width, path: url.pathname, method: request.method(), fixture: true });
        let body = { error: 'This action is blocked by isolated local QA.' }, status = 503;
        if (request.method() === 'GET') {
          if (url.pathname === '/api/users/me') { body = currentAccount; status = 200; }
          else if (url.pathname === '/api/admin/support') { body = supportFixture; status = 200; }
          else if (url.pathname === '/api/admin/abuse') { body = abuseFixture; status = 200; }
          else if (url.pathname.startsWith('/api/profile/')) { body = { profile: { ...fixtureProfile, plan: currentAccount.plan.plan } }; status = 200; }
          else if (url.pathname === '/api/public-stats') { body = { stats: { movesAnalyzed: 1000, puzzlesSolved: 2000, coachGamesPlayed: 300 } }; status = 200; }
          else if (url.pathname === '/api/anticheat/reports') { body = { reports: [] }; status = 200; }
        }
        return route.fulfill({ status, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) });
      }
      if (url.origin !== localOrigin) {
        report.blockedExternalRequests.push({ width, host: url.hostname, path: url.pathname, method: request.method() });
        return route.abort();
      }
      return route.continue();
    });
    await context.addInitScript(() => {
      localStorage.setItem('sidastuff.engineSettings', JSON.stringify({ source: 'browser',
        module: 'lite-single', reviewStrength: 'quick', liveDeepening: false, forcedDepth: 10 }));
      // The production status stream is never started by our synthetic login.
      // Also prevent a future controller change from opening outbound sockets.
      window.WebSocket = class {
        constructor() { throw new Error('WebSockets are disabled by isolated local QA.'); }
      };
      window.EventSource = class {
        constructor() { throw new Error('Event streams are disabled by isolated local QA.'); }
      };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.runtimeErrors.push({ width, url: page.url(), message: error.message }));
    page.on('dialog', dialog => dialog.dismiss());
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.app?._navigateTo === 'function', null, { timeout: 20000 });
    await page.waitForFunction(() => window.app.authState.initialized, null, { timeout: 20000 });
    await page.waitForFunction(() => document.getElementById('loading-overlay').hidden);

    await check(`${width}px signed-in account preserves long identity and quotas`, async () => {
      await setAccount(page, currentAccount);
      await navigate(page, '/account');
      await page.locator('#account-signed-in-page').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#spa-account-display-name').innerText(), username);
      assert.equal(await page.locator('#spa-account-email-label').innerText(), email);
      assert.equal(await page.locator('#spa-account-puzzle-rating').innerText(), '2097');
      assert.equal(await page.locator('#spa-account-puzzles-solved').innerText(), '98765');
      assert.equal(await page.locator('#spa-account-usage-section .usage-bar').count(), 3);
      assert.ok(await page.locator('#spa-btn-save-username').isDisabled(), 'Username cooldown is enforced');
      assert.ok(!(await page.locator('#spa-admin-support-panel').isVisible()), 'Regular users cannot see admin panels');
      await snapshot(page, 'account-signed-in', width);
    });

    await check(`${width}px account public-profile navigation and owner controls`, async () => {
      await page.locator('#btn-account-view-profile').click();
      await page.locator('#profile-content').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#profile-username').innerText(), username);
      assert.equal(await page.locator('#profile-rating').innerText(), '2097');
      assert.ok(await page.locator('#profile-owner-actions').isVisible());
      const avatar = await page.locator('#profile-avatar').boundingBox();
      assert.ok(avatar && Math.abs(avatar.width - avatar.height) < 2, 'Long usernames must preserve the square avatar');
      await snapshot(page, 'profile-owner', width);
    });

    await check(`${width}px admin read panels render escaped messages and notes`, async () => {
      currentAccount = accountFixture('max', true);
      await setAccount(page, currentAccount);
      await navigate(page, '/account');
      await page.locator('#spa-admin-support-panel').waitFor({ state: 'visible' });
      assert.ok(await page.locator('#spa-admin-boost-panel').isVisible());
      assert.ok(await page.locator('#admin-ban-panel').isVisible());
      await page.locator('#spa-btn-refresh-support').click();
      await page.locator('#spa-admin-support-list .admin-support-item').waitFor({ state: 'visible' });
      await page.locator('#spa-btn-refresh-abuse').click();
      await page.locator('#spa-admin-abuse-list .admin-abuse-item').waitFor({ state: 'visible' });
      assert.ok((await page.locator('.admin-support-msg').innerText()).includes('<script>'));
      assert.equal(await page.evaluate(() => window.__qaUnsafeScript), undefined);
      assert.equal(await page.locator('#spa-admin-support-list script, #spa-admin-abuse-list script').count(), 0);
      const gauges = await page.locator('#spa-account-usage-section .usage-bar-track').evaluateAll(tracks =>
        tracks.map(track => track.firstElementChild.getBoundingClientRect().width <= track.getBoundingClientRect().width + 1));
      assert.ok(gauges.every(Boolean), 'Quota bars clamp to available width');
      await snapshot(page, 'account-admin', width);
    });

    await check(`${width}px Free account reveals useful upgrade states`, async () => {
      currentAccount = accountFixture('free', false);
      await setAccount(page, currentAccount);
      await page.evaluate(() => window.app._renderSpaAccount());
      assert.equal(await page.locator('#spa-account-plan').innerText(), 'Free');
      assert.ok((await page.locator('#spa-account-usage-section').innerText()).includes('3 / 3'));
      assert.ok(await page.locator('#btn-account-to-plans').isVisible());
      assert.ok(!(await page.locator('#spa-admin-support-panel').isVisible()));
      await snapshot(page, 'account-free', width);
    });

    await check(`${width}px persisted Coach Markdown and chessboard render safely`, async () => {
      currentAccount = accountFixture('boost');
      await setAccount(page, currentAccount);
      await page.evaluate(({ uid, chats }) => {
        localStorage.setItem(`sidastuff.coachChats.${uid}`, JSON.stringify(chats));
        localStorage.setItem(`sidastuff.coachActiveChat.${uid}`, chats[0].id);
      }, { uid, chats });
      await navigate(page, '/coach');
      await page.locator('#coach-chat-form').waitFor({ state: 'visible' });
      assert.ok(await page.locator('#coach-chat-textarea').isEnabled());
      assert.equal(await page.locator('.coach-board-embed .square').count(), 64);
      assert.equal(await page.locator('.coach-board-embed .piece').count(), 32);
      assert.equal(await page.locator('.coach-bubble.user img').count(), 0);
      assert.equal(await page.locator('.coach-markdown table').count(), 1);
      assert.equal(await page.evaluate(() => window.__qaUnsafeScript), undefined);
      const board = await page.locator('.coach-board-embed').boundingBox();
      assert.ok(board && Math.abs(board.width - board.height) < 2, 'Embedded board stays square');
      const innerBoard = await page.locator('.coach-board-embed .chess-board').boundingBox();
      assert.ok(innerBoard && Math.abs(innerBoard.width - board.width) < 3 && Math.abs(innerBoard.height - board.height) < 3,
        `Embedded board must stay inside its wrapper: ${JSON.stringify({ board, innerBoard })}`);
      assert.ok(Math.abs(innerBoard.x - board.x) < 2 && Math.abs(innerBoard.y - board.y) < 2,
        'Embedded board must be positioned inside its wrapper');
      const square = await page.locator('.coach-board-embed .square').first().boundingBox();
      assert.ok(square && Math.abs(square.width - square.height) < 2 && Math.abs(square.width * 8 - innerBoard.width) < 3,
        'Embedded squares must be one eighth of the embedded board');
      const imagesLoaded = await page.locator('.coach-board-embed .piece').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0));
      assert.ok(imagesLoaded, 'Every embedded chess piece asset loaded');
      await page.locator('#coach-chat-messages').evaluate(el => { el.scrollTop = 0; });
      await snapshot(page, 'coach-persisted', width);
    });

    await check(`${width}px Coach history toggles and selects locked chats by keyboard`, async () => {
      const toggle = page.locator('#btn-coach-sidebar-toggle');
      if (await toggle.getAttribute('aria-expanded') === 'true') {
        await toggle.focus(); await page.keyboard.press('Space');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        assert.ok(!(await page.locator('#coach-sidebar').isVisible()));
      }
      await toggle.focus(); await page.keyboard.press('Space');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      assert.ok(await page.locator('#coach-sidebar').isVisible());
      const locked = page.locator('.coach-chat-item-title').filter({ hasText: chats[1].title });
      await locked.focus(); await page.keyboard.press('Enter');
      assert.ok(await page.locator('#coach-chat-textarea').isDisabled());
      assert.ok(await page.locator('#btn-coach-send').isDisabled());
      assert.ok(await page.locator('.coach-locked-notice').isVisible());
      if (width <= 720) assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await snapshot(page, 'coach-locked', width);
    });

    await check(`${width}px Coach history keyboard delete preserves the active conversation`, async () => {
      const toggle = page.locator('#btn-coach-sidebar-toggle');
      if (await toggle.getAttribute('aria-expanded') === 'false') { await toggle.focus(); await page.keyboard.press('Space'); }
      await page.locator('.coach-chat-item-title').filter({ hasText: chats[0].title }).focus();
      await page.keyboard.press('Enter');
      assert.ok(await page.locator('#coach-chat-textarea').isEnabled());
      if (await toggle.getAttribute('aria-expanded') === 'false') { await toggle.focus(); await page.keyboard.press('Space'); }
      await page.getByRole('button', { name: `Delete ${chats[2].title}`, exact: true }).focus();
      await page.keyboard.press('Space');
      const saved = await page.evaluate(uid => JSON.parse(localStorage.getItem(`sidastuff.coachChats.${uid}`)), uid);
      assert.equal(saved.length, 2);
      assert.ok(saved.some(chat => chat.id === chats[0].id && chat.messages.length === 2));
      assert.ok(!saved.some(chat => chat.id === chats[2].id));
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-coach-new-chat');
      assert.equal(await page.locator('.coach-chat-item-title[aria-pressed="true"]').innerText(), chats[0].title);
      await snapshot(page, 'coach-history', width);
    });

    await check(`${width}px sign-out hides Coach history without deleting saved chats`, async () => {
      const before = await page.evaluate(uid => localStorage.getItem(`sidastuff.coachChats.${uid}`), uid);
      await page.evaluate(() => {
        Object.assign(window.app.authState, { user: null, initialized: true, profile: null, me: null,
          usage: {}, limits: {}, plan: { plan: 'free', name: 'Free' }, isAdmin: false });
        window.app._syncAccountUi();
        window.CoachChat.onAuth(window.app);
      });
      assert.ok(!(await page.locator('#coach-chat-form').isVisible()));
      assert.ok(await page.locator('#btn-coach-new-chat').isDisabled());
      assert.equal(await page.locator('.coach-chat-item').count(), 0);
      assert.equal(await page.evaluate(uid => localStorage.getItem(`sidastuff.coachChats.${uid}`), uid), before);
      await snapshot(page, 'coach-signed-out', width);
      await setAccount(page, currentAccount);
      await page.evaluate(() => window.CoachChat.onAuth(window.app));
      assert.equal(await page.locator('.coach-chat-item').count(), 2);
      assert.equal(await page.locator('.coach-board-embed .square').count(), 64);
      assert.equal(await page.evaluate(uid => localStorage.getItem(`sidastuff.coachChats.${uid}`), uid), before);
      assert.ok(await page.locator('#coach-chat-textarea').isEnabled());
    });

    await check(`${width}px QA attempted no account mutations or Coach network sends`, async () => {
      const requests = report.apiRequests.filter(request => request.width === width);
      assert.ok(requests.every(request => request.method === 'GET'), JSON.stringify(requests.filter(request => request.method !== 'GET')));
      assert.ok(!requests.some(request => request.path.startsWith('/api/coach')));
      assert.ok(!report.runtimeErrors.some(error => error.width === width), JSON.stringify(report.runtimeErrors.filter(error => error.width === width)));
    });
    await context.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
}

const failures = report.checks.filter(check => !check.passed);
console.log(`${report.checks.length - failures.length}/${report.checks.length} isolated state checks passed. Report: artifacts/ui-states/report.json`);
if (failures.length) process.exitCode = 1;
