import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:4173';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true });
let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; console.log(`PASS ${label}`); };
await fs.mkdir('artifacts/coach', { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    let messages = 0;
    const day = new Date().toISOString().slice(0, 10);
    const plan = { plan: 'max', name: 'Max', limits: { coachTokensPerDay: 100000, serverReviewsPerDay: null, anticheatGamesPerWeek: 100 } };
    const profile = { username: 'qa-coach', savedUsernames: {}, puzzleRating: 1500 };
    const usage = { coachUsagePercent: 98, coachAvailable: true, day };
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/coach/chat') {
        messages++;
        usage.coachUsagePercent = messages === 1 ? 99 : 100;
        usage.coachAvailable = messages === 1;
        const events = messages === 1 ? [
          ['init', { pid: 123 }], ['token', { text: 'Start with a short tactics session and review the patterns you miss.' }], ['done', { usage }],
        ] : [['error', { error: 'Your daily AI Coach allowance is used. It resets at midnight UTC.', code: 'quota_exceeded', usage }]];
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body: events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('') });
      }
      if (url.pathname.startsWith('/api/')) {
        if (['/api/play/active', '/api/play/status'].includes(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, connected: false, activeGames: [] }) });
        const payload = url.pathname === '/api/users/me' ? { profile, plan, usage, limits: plan.limits, isAdmin: false } : { error: 'Isolated QA endpoint' };
        return route.fulfill({ status: payload.error ? 503 : 200, contentType: 'application/json', body: JSON.stringify(payload) });
      }
      if (url.origin !== new URL(base).origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base);
    await page.waitForFunction(() => window.app?.authState?.initialized && window.CoachChat);
    await page.evaluate(({ profile, plan, usage }) => {
      const app = window.app;
      app.authState.user = { uid: 'qa-coach', getIdToken: async () => 'isolated-qa-token' };
      Object.assign(app.authState, { profile, plan, usage, limits: plan.limits });
      app._syncAccountUi();
      app._navigateTo('/coach');
    }, { profile, plan, usage });
    await page.locator('#coach-chat-textarea').waitFor({ state: 'visible' });
    const text = page.locator('.coach-usage-text');
    await page.waitForFunction(() => document.querySelector('.coach-usage-text')?.textContent.includes('98%'));
    check(await text.innerText() === '98% of daily Coach allowance used', `${width}: initial usage is a percentage`);
    check(await page.locator('#coach-usage-bar').getAttribute('aria-valuenow') === '98', `${width}: accessible meter uses percentage units`);
    check(await page.locator('.coach-boundary-note').isVisible(), `${width}: cross-chat abuse reporting notice is visible`);
    await page.locator('#coach-chat-textarea').fill('Help me build a tactics study routine.');
    await page.locator('#btn-coach-send').click();
    await page.waitForFunction(() => document.querySelector('.coach-usage-text')?.textContent.includes('99%'));
    check((await page.locator('#coach-chat-messages').innerText()).includes('short tactics session'), `${width}: normal chat works with percentage-only usage payloads`);
    await page.locator('#coach-chat-textarea').fill('What should I study next?');
    await page.locator('#btn-coach-send').click();
    await page.waitForFunction(() => document.querySelector('.coach-usage-text')?.textContent.includes('100%'));
    check((await page.locator('#coach-chat-messages').innerText()).includes('midnight UTC'), `${width}: exhausted allowance shows a readable error and updates usage`);
    check(!/100,000|98,961|tokens used|Coach tokens/i.test(await page.locator('body').innerText()), `${width}: actual token counts stay out of visible UI`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: Coach has no horizontal overflow`);
    await page.screenshot({ path: `artifacts/coach/coach-${width}.png`, fullPage: true });
    await page.evaluate(() => window.app._navigateTo('/account'));
    await page.waitForTimeout(100);
    check((await page.locator('body').innerText()).includes('100% used today'), `${width}: account usage also shows percentage`);
    check(errors.length === 0, `${width}: no runtime errors (${errors.join(', ')})`);
    await context.close();
  }
} finally { await browser.close(); }
console.log(`${checks} Coach UI checks passed.`);
