// Exercise the real Settings controls with isolated accounts and API fixtures.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:4173';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true });
let checks = 0;
const check = (ok, text) => { assert.ok(ok, text); checks++; console.log(`PASS ${text}`); };
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    let saved = { anticheatComplete: true, browserPush: false, browserPushGranted: false }, writes = 0, fail = false, obsolete = 0;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/settings/notification-settings') obsolete++;
      if (url.pathname === '/api/users/me') {
        if (route.request().method() === 'POST') {
          writes++;
          await new Promise(resolve => setTimeout(resolve, 120));
          if (fail) return route.fulfill({ status: 503, json: { error: 'Preferences are temporarily unavailable.' } });
          assert.ok(route.request().headers().authorization);
          saved = route.request().postDataJSON().profile.notificationSettings;
        }
        return route.fulfill({ json: { profile: { uid: 'qa-notify', username: 'qa-notify', puzzleRating: 1875, notificationSettings: saved }, plan: { plan: 'free' }, usage: {}, limits: {} } });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: { error: 'Isolated fixture' } });
      if (url.origin !== new URL(base).origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => window.app?.authState?.initialized);
    await page.evaluate(() => window.app._renderNotificationPanel([{ id: 'generic', type: 'auto_review', title: 'Notification', body: 'Alice vs Bob', read: false }], 1));
    check(await page.locator('.notification-item-title').innerText() === 'Game review ready', `${width}: generic notification titles are replaced with useful text`);
    await page.evaluate(() => window.app._navigateTo('/settings'));
    const button = page.locator('#btn-save-notify-settings'), status = page.locator('#notify-settings-status');
    await button.click();
    check((await status.innerText()).includes('Sign in') && writes === 0, `${width}: signed-out saves explain sign-in requirement`);
    await page.evaluate(() => {
      window.__permissionCalls = 0;
      window.Notification = class { static permission = 'default'; static async requestPermission() { window.__permissionCalls++; this.permission = 'granted'; return 'granted'; } };
      const app = window.app;
      app.authState.user = { uid: 'qa-notify', getIdToken: async () => 'isolated' };
      app.authState.profile = { puzzleRating: 1875, notificationSettings: { anticheatComplete: true, browserPush: false } };
      app._loadNotificationSettingsIntoUi();
    });
    await page.locator('#settings-notify-anticheat').uncheck();
    await page.locator('#settings-notify-push').check();
    await button.click();
    check(await button.isDisabled(), `${width}: saving prevents duplicate submissions`);
    await page.evaluate(() => window.app._saveNotificationSettings());
    await page.waitForFunction(() => document.getElementById('notify-settings-status').textContent === 'Saved.');
    check(writes === 1 && obsolete === 0, `${width}: save uses the registered profile API exactly once`);
    check(saved.anticheatComplete === false && saved.browserPush && saved.browserPushGranted, `${width}: saved preferences reflect browser permission`);
    check(await page.evaluate(() => window.__permissionCalls === 1 && window.app.authState.profile.puzzleRating === 1875), `${width}: permission is requested and unrelated stats stay intact`);
    await page.evaluate(async () => {
      const app = window.app;
      app.authState.profile = await app._loadUserProfile(app.authState.user, { strict: true });
      app._loadNotificationSettingsIntoUi();
    });
    check(!await page.locator('#settings-notify-anticheat').isChecked() && await page.locator('#settings-notify-push').isChecked(), `${width}: preferences survive a fresh profile load`);
    await page.evaluate(() => { window.Notification.permission = 'denied'; });
    await button.click();
    await page.waitForFunction(() => document.getElementById('notify-settings-status').textContent.includes('blocked'));
    check(!saved.browserPush && !saved.browserPushGranted && !await page.locator('#settings-notify-push').isChecked(), `${width}: blocked permission is not reported as granted`);
    fail = true;
    const before = JSON.stringify(saved);
    await page.locator('#settings-notify-anticheat').check();
    await button.click();
    await page.waitForFunction(() => document.getElementById('notify-settings-status').textContent.includes('temporarily unavailable'));
    check(JSON.stringify(saved) === before && !await button.isDisabled(), `${width}: save failure is readable and can be retried without losing saved values`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && !errors.length, `${width}: settings fit viewport with no runtime errors (${errors.join('; ')})`);
    await context.close();
  }
  console.log(`${checks} notification settings browser checks passed.`);
} finally { await browser.close(); }
