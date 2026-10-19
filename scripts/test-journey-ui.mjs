// Local fixtures only: no accounts, payments, or production requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5173';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true });
let checks = 0;
const check = (ok, name) => { assert.ok(ok, name); checks++; console.log('PASS ' + name); };
await fs.mkdir('artifacts/journey', { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Isolated test endpoint"}' });
      if (url.origin !== new URL(base).origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage(), errors = []; page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    await page.goto(base); await page.waitForFunction(() => window.app?.authState.initialized && document.querySelector('#training-journey-home:not([hidden])'));
    check((await page.locator('.sidebar-upgrade').getAttribute('href')).includes('/signup?'), `${width}: guests get signup before upgrade in the sidebar`);
    check(await page.locator('#training-journey-home').getByRole('link', { name: 'Create free account' }).isVisible(), `${width}: home explains the free account benefits`);
    if (width === 390) await page.screenshot({ path: 'artifacts/journey/guest-home.png', fullPage: true });
    await page.evaluate(() => { window.app.authState.initialized = false; window.dispatchEvent(new Event('linked-auth')); });
    check(!await page.locator('#training-journey-home').isVisible(), `${width}: prompts stay hidden while auth resolves`);
    await page.evaluate(() => {
      window.app.authState.initialized = true;
      window.app.puzzleMode.rating = 1734;
      localStorage.setItem('sidastuff.appearanceSettings', JSON.stringify({ boardTheme: 'blue', pieceTheme: 'cburnett' }));
      window.dispatchEvent(new Event('linked-auth'));
    });
    await page.locator('#training-journey-home').getByRole('link', { name: 'Create free account' }).click();
    check(new URL(page.url()).searchParams.get('src') === 'home' && await page.locator('#onboard-step-4').isVisible(), `${width}: contextual signup preserves query parameters and opens the form`);
    check(!await page.locator('.onboard-wizard-progress').isVisible() && !await page.locator('#onboard-step-label').textContent().then(text => text.includes('Step 4')), `${width}: quick signup does not pretend optional steps are complete`);
    check(await page.evaluate(() => { window.app._persistOnboardingChoices(); return window.app.puzzleMode.rating === 1734 && window.app._onboardingAppearance().boardTheme === 'blue'; }), `${width}: quick signup keeps earned rating and chosen appearance`);
    await page.getByRole('button', { name: 'Personalize your setup' }).click();
    check(await page.locator('#onboard-step-1').isVisible() && await page.locator('.onboard-wizard-progress').isVisible(), `${width}: optional setup remains accessible`);
    await page.evaluate(() => window.app._navigateTo('/signup?src=review&quick=1'));
    check(await page.locator('#signup-subtitle').textContent().then(text => text.includes('move explanations')) && new URL(page.url()).searchParams.get('src') === 'review', `${width}: same-route signup context updates correctly`);
    await page.evaluate(() => {
      const app = window.app; app._requestLiveEvaluation = async () => {};
      app._navigateTo('/review', { skipImport: true }); app._loadGame(['e4', 'e5', 'Nf3'], { White: 'Alice', Black: 'Bob', Result: '*' });
      app.analysisResults = app.gameMoves.map((san, index) => ({ moveSan: san, move: san, moveIndex: index, isWhite: index % 2 === 0, cpLoss: 0, evalBefore: 0, evalAfter: 0, bestMove: 'g1f3', classificationKey: 'GOOD', classification: window.MoveClassification.GOOD }));
      app._showReviewSummary();
    });
    check(await page.locator('#training-journey-review').getByRole('link', { name: 'Create free account' }).isVisible(), `${width}: finishing a review produces a contextual free-account prompt`);
    await page.locator('#training-journey-review').getByRole('button', { name: 'Not now' }).click();
    await page.evaluate(() => window.app._showReviewSummary());
    check(!await page.locator('#training-journey-review').isVisible(), `${width}: dismissed prompts stay dismissed on rerender`);
    await page.evaluate(() => window.app._navigateTo('/puzzles'));
    await page.waitForFunction(() => window.app.puzzleMode.active && !window.app.puzzleMode.loading);
    await page.evaluate(() => {
      const app = window.app;
      app._setupPuzzle({ puzzle: { id: 'journey-mate', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', solution: ['h5f7'], rating: 1200, themes: ['mateIn1'] } }, 'Test puzzle');
    });
    check(!await page.locator('#training-journey-puzzle').isVisible(), `${width}: signup does not interrupt an unsolved puzzle`);
    await page.evaluate(() => window.app._handleBoardMove('h5', 'f7'));
    await page.waitForFunction(() => window.app.puzzleMode.solved);
    check(await page.locator('#training-journey-puzzle').isVisible(), `${width}: solving a puzzle invites saving progress`);
    await page.evaluate(() => {
      const app = window.app;
      app.authState.user = { uid: 'journey-new', getIdToken: async () => 'isolated' };
      app.authState.initialized = true;
      app.authState.profile = { username: 'NewPlayer', onboardingComplete: true, puzzleStats: { solved: 0 } };
      app.authState.plan = { plan: 'free' }; app.authState.me = { plan: { plan: 'free' }, features: { coach: true, serverReviews: true } };
      app.authState.usage = { serverReviews: 0, coachUsagePercent: 0 }; app.authState.limits = { serverReviewsPerDay: 3 };
      app._navigateTo('/account');
    });
    check(await page.locator('#training-journey-account > .journey-proof').textContent().then(text => text.includes('1 of 3')) && !await page.locator('#training-journey-account .journey-next').isVisible(), `${width}: a new account gets honest training steps before an upgrade prompt`);
    check(await page.evaluate(() => !localStorage.getItem('sidastuff.trainingJourney.journey-new')), `${width}: guest activity is not attributed to another account`);
    await page.evaluate(() => { const app = window.app; app.authState.usage.serverReviews = 2; app._renderAccountUsageBars(app.authState.plan, app.authState.usage, app.authState.limits); });
    check(await page.locator('#training-journey-account .journey-next').getByRole('link', { name: 'Compare Boost' }).isVisible() && await page.locator('#training-journey-account .journey-next .journey-proof').textContent().then(text => text.startsWith('2 of 3')), `${width}: upgrade proof uses actual account allowance`);
    if (width === 390) await page.locator('#training-journey-account').screenshot({ path: 'artifacts/journey/boost-offer.png' });
    await page.locator('#training-journey-account .journey-next').getByRole('link', { name: 'Compare Boost' }).click();
    check(await page.locator('.plan-tier-boost').evaluate(node => node.classList.contains('journey-recommended')) && new URL(page.url()).searchParams.get('focus') === 'boost', `${width}: plan comparison carries the reason and highlights the selected tier`);
    check(!await page.locator('#plan-free-signup').isVisible(), `${width}: signed-in users are not asked to sign up again`);
    await page.evaluate(() => {
      const app = window.app; app.authState.plan = { plan: 'boost' }; app.authState.me.plan = app.authState.plan;
      app.authState.usage = { coachUsagePercent: 85 }; app._navigateTo('/coach');
    });
    check(await page.locator('#training-journey-coach').getByRole('link', { name: 'Compare Max' }).isVisible(), `${width}: Boost users get Max only when Coach capacity is relevant`);
    await page.evaluate(() => { const app = window.app; app.authState.plan = { plan: 'max' }; app.authState.me.plan = app.authState.plan; app._renderAccountUsageBars(app.authState.plan, app.authState.usage, app.authState.limits); });
    check(!await page.locator('#training-journey-coach').isVisible(), `${width}: Max subscribers see no upgrade prompt`);
    await page.evaluate(() => {
      const app = window.app; app.authState.me = null; app.authState.plan = { plan: 'free' }; app._navigateTo('/account');
    });
    check(!await page.locator('#training-journey-account .journey-next').isVisible() && await page.locator('.sidebar-upgrade strong').textContent() === 'Your chess account', `${width}: unavailable subscription data never creates a Free upsell`);
    await page.evaluate(() => {
      window.PlayFairPlay.isBlocked = () => true;
      window.dispatchEvent(new CustomEvent('play:fairplay', { detail: { blocked: true } }));
    });
    check(!await page.locator('#training-journey-account').isVisible() && !await page.locator('.sidebar-upgrade').isVisible(), `${width}: active-game protection suppresses promotional prompts`);
    await page.evaluate(() => { window.PlayFairPlay.isBlocked = () => false; window.dispatchEvent(new CustomEvent('play:fairplay', { detail: { blocked: false } })); });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: journey controls fit the viewport`);
    await page.screenshot({ path: `artifacts/journey/account-${width}.png`, fullPage: true });
    check(!errors.length, `${width}: no runtime errors (${errors.join('; ')})`);
    await context.close();
  }
} finally { await browser.close(); }
console.log(`${checks} training journey browser checks passed.`);
