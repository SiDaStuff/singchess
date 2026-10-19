import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:4173';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true });
let checks = 0;
const check = (ok, name) => { assert.ok(ok, name); checks++; console.log(`PASS ${name}`); };
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 } });
    let response = { code: 'origin_not_allowed', error: 'Origin is not allowed.' }, writes = 0;
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) {
        if (route.request().method() === 'POST') writes++;
        return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify(response) });
      }
      if (url.origin !== new URL(base).origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const initial = await page.goto(base);
    check(initial.headers()['cross-origin-opener-policy'] === 'same-origin-allow-popups', `${width}: popup-compatible frontend header`);
    await page.waitForFunction(() => window.app?.authState.initialized);
    await page.evaluate(() => {
      const app = window.app; app._navigateTo('/login');
      window.__authCalls = 0; window.__banCalls = 0;
      const providerAuth = {
        signInWithEmailAndPassword: async () => { window.__authCalls++; throw { code: 'auth/network-request-failed', message: 'Firebase: internal error' }; },
        sendPasswordResetEmail: async () => { window.__authCalls++; throw { code: 'auth/invalid-email', message: 'Firebase: raw error' }; },
        signInWithPopup: async () => ({ user: { uid: 'auth-qa', email: 'qa@example.com', getIdToken: async () => 'isolated' } }),
      };
      const auth = () => providerAuth; auth.GoogleAuthProvider = class {};
      app._ensureFirebase = () => ({ auth });
      app._handleBannedSession = async () => { window.__banCalls++; };
    });
    await page.evaluate(async () => {
      try { await window.app._handleEmailAuth({ email: 'broken-address', password: 'sample123', statusEl: window.app.elLoginStatus }); } catch (_) {}
    });
    check(await page.locator('#login-status').innerText().then(text => text.includes('valid email address') && !text.includes('Firebase')), `${width}: malformed sign-in email gets readable feedback`);
    check(await page.evaluate(() => window.__authCalls === 0), `${width}: invalid email is rejected before provider call`);
    await page.evaluate(async () => {
      try { await window.app._handleEmailAuth({ email: 'qa@example.com', password: 'sample123', statusEl: window.app.elLoginStatus }); } catch (_) {}
    });
    check(await page.locator('#login-status').innerText().then(text => text.includes('Check your connection') && !text.includes('auth/')), `${width}: SDK network error is readable`);
    await page.fill('#login-email', 'still-invalid');
    await page.evaluate(() => window.app._handleLoginPageForgotPassword());
    check(await page.locator('#login-status').innerText().then(text => text.includes('valid email address')), `${width}: password-reset validates email`);
    const beforeGoogle = writes;
    await page.evaluate(() => window.app._handleGoogleAuth());
    check(await page.locator('#account-status').textContent().then(text => text.includes('website address')), `${width}: failed Google profile request exposes useful configuration message`);
    check(await page.evaluate(() => window.__banCalls === 0) && writes === beforeGoogle, `${width}: origin rejection neither signs out as banned nor writes a default profile`);
    response = { code: 'account_closed', reason: 'Fixture restriction', error: 'Account Closed.' };
    await page.evaluate(() => window.app._loadUserProfile({ uid: 'auth-qa', email: 'qa@example.com' }));
    check(await page.evaluate(() => window.__banCalls === 1), `${width}: actual account restrictions remain enforced`);
    check(!errors.length, `${width}: no runtime errors`);
    await context.close();
  }
  console.log(`${checks} authentication browser checks passed.`);
} finally { await browser.close(); }
