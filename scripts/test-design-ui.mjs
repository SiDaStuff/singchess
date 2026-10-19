// Rendered UI checks with isolated APIs; no production accounts or games.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5173';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true });
let checks = 0;
const check = (ok, label) => { assert.ok(ok, label); checks++; console.log('PASS ' + label); };
await fs.mkdir('artifacts/design', { recursive: true });
const routes = ['/', '/play', '/review', '/puzzles', '/coach', '/settings', '/account', '/plans', '/contact', '/signup', '/login', '/auth', '/privacy', '/terms', '/404'];
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, colorScheme: 'dark', reducedMotion: 'reduce', hasTouch: width < 600, isMobile: width < 600 });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Isolated QA endpoint"}' });
      if (url.origin !== new URL(base).origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept()); page.setDefaultTimeout(8000);
    await page.goto(base); await page.waitForFunction(() => window.app?.authState.initialized && document.getElementById('training-journey-home'));
    await page.evaluate(() => { window.app._requestLiveEvaluation = async () => {}; });
    check(!await page.locator('#home-stats').isVisible(), `${width}: unavailable statistics show no placeholder counters`);
    await page.route('**/api/public-stats', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"stats":{"gamesAnalyzed":12}}' }));
    await page.evaluate(() => window.app._loadHomeStats());
    check(!await page.locator('#home-stats').isVisible(), `${width}: game counts are never relabeled as moves reviewed`);
    await page.route('**/api/public-stats', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"stats":{"movesAnalyzed":125,"puzzlesSolved":0}}' }));
    await page.evaluate(() => window.app._loadHomeStats());
    check(await page.locator('#home-stat-reviews').textContent() === '125' && await page.locator('#home-stat-puzzles').textContent() === '0' && !await page.locator('#home-stat-coaches').isVisible(), `${width}: only actual returned metrics appear, including a real zero`);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { window.app._applyAppearanceSettings({ colorTheme: theme, boardTheme: 'classic', pieceTheme: 'cburnett' }); }, theme);
      await page.waitForFunction(theme => getComputedStyle(document.body).backgroundColor === (theme === 'light' ? 'rgb(244, 246, 243)' : 'rgb(20, 24, 23)'), theme);
      check(true, `${width} ${theme}: explicit theme works on a dark operating system`);
      for (const route of routes) {
        await page.evaluate(route => window.app._navigateTo(route, { skipImport: true, disableRestore: true }), route);
        await page.waitForTimeout(80);
        const layout = await page.evaluate(() => ({
          width: innerWidth, scroll: document.documentElement.scrollWidth,
          oversized: [...document.querySelectorAll('h1')].filter(node => node.getBoundingClientRect().height && getComputedStyle(node).display !== 'none').some(node => parseFloat(getComputedStyle(node).fontSize) > 33),
          animated: [...document.querySelectorAll('.page-panel,.main-menu')].filter(node => node.getBoundingClientRect().height).some(node => getComputedStyle(node).animationName !== 'none'),
        }));
        check(layout.scroll <= layout.width + 1 && !layout.oversized && !layout.animated, `${width} ${theme} ${route}: layout fits, headings stay compact, no page-entry animation`);
        if (width !== 320 && ['/','/play','/review','/settings','/login','/coach','/plans','/contact'].includes(route)) {
          await page.screenshot({ path: `artifacts/design/${route === '/' ? 'home' : route.slice(1)}-${width}-${theme}.png`, fullPage: true });
        }
      }
      await page.evaluate(() => window.app._navigateTo('/'));
      check(await page.evaluate(() => document.querySelector('#training-journey-home').getBoundingClientRect().top >= document.querySelector('.home-workspace').getBoundingClientRect().bottom), `${width} ${theme}: signup follows the chess workspace`);
      const primary = page.locator('.home-heading .btn-primary'); await primary.hover();
      const ratio = await primary.evaluate(node => {
        const luminance = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
        const style = getComputedStyle(node), a = luminance(style.color), b = luminance(style.backgroundColor);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      });
      check(ratio >= 4.5, `${width} ${theme}: primary hover text meets 4.5:1 contrast`);
    }
    check(!errors.length, `${width}: no browser errors (${errors.join('; ')})`);
    await context.close();
  }
} finally { await browser.close(); }
console.log(`${checks} design checks passed.`);
