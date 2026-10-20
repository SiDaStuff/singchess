import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:4173';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true });
let checks = 0;
const check = (value, label) => { assert.ok(value, label); console.log(`PASS ${label}`); checks++; };
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 } });
    const requests = [], errors = [];
    context.on('request', request => requests.push(request.url()));
    await context.route('**/api/**', route => route.fulfill({ json: { stats: {} } }));
    await context.route(url => url.origin !== new URL(base).origin && !['blob:', 'data:'].includes(url.protocol), route => route.abort());
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(base);
    await page.waitForFunction(() => window.app?.authState?.initialized && window.RoutePages);
    check(await page.locator('h1').first().innerText() === 'Review a game', `${width}: Home is present before feature navigation`);
    check(await page.evaluate(() => document.querySelectorAll('*').length < 800), `${width}: inactive page controls stay outside the live DOM`);
    check(!requests.some(url => /coach-chat-|dialog-runtime-|markdown-runtime-|admin-profile-/.test(url)), `${width}: Home does not download unused feature controllers`);
    check(!requests.some(url => /\.wasm|\/__\/auth\//.test(url)), `${width}: Home avoids Stockfish and the popup auth iframe`);
    const inlined = await page.locator('link[data-inline-css]').evaluateAll(nodes => nodes.map(node => node.href));
    check(!requests.some(url => inlined.includes(url)), `${width}: inlined critical CSS is not downloaded again`);
    check(!requests.some(url => /\/pieces\/(celtic|fantasy|merida|spatial)\//.test(url)), `${width}: hidden appearance previews do not download other piece sets`);
    check(response.headers()['content-security-policy']?.includes("'strict-dynamic'"), `${width}: strict CSP is served`);
    check(await page.evaluate(() => {
      const node = document.createElement('div');
      node.innerHTML = '<img src="/assets/icon.svg" onerror="alert(1)"><script>alert(1)</script>';
      return !node.querySelector('script') && !node.querySelector('[onerror]');
    }), `${width}: Trusted Types removes executable HTML`);
    await page.evaluate(() => window.app._navigateTo('/settings'));
    await page.locator('#settings-usability').waitFor({ state: 'visible' });
    await page.locator('[data-qol-setting="sounds"]').uncheck();
    await page.evaluate(() => window.app._navigateTo('/play'));
    await page.waitForFunction(() => window.Play?.qolInstalled);
    check(await page.evaluate(() => !window.Play.sounds.preferences.sounds), `${width}: lazy Play inherits the saved sound setting`);
    await page.evaluate(() => { window.QualityOfLife.save({ volume: .2 }); window.app._navigateTo('/settings'); });
    check(await page.locator('[data-qol-setting="volume"]').inputValue() === '0.2', `${width}: cached settings refresh after a Play preference change`);
    await page.evaluate(() => window.app._navigateTo('/coach'));
    await page.waitForFunction(() => !!window.marked && !!document.getElementById('coach-chat-locked'));
    check(await page.locator('#coach-chat-locked').isVisible(), `${width}: lazy Coach opens under CSP`);
    await page.goto(base + '/coach');
    await page.waitForFunction(() => window.app?.authState?.initialized && !!window.marked);
    check(page.url() === base + '/coach', `${width}: cold Coach uses one document without a redirect stub`);
    check(errors.length === 0, `${width}: no startup or lazy-module errors (${errors.join('; ')})`);
    await context.close();
  }
  const page = await browser.newPage();
  for (const resource of ['/llms.txt', '/.well-known/ard.json', '/.well-known/ai-catalog.json', '/ai-catalog.json', '/privacy.md', '/terms.md', '/sitemap.xml']) {
    const response = await page.request.get(base + resource);
    const content = await response.text();
    check(response.ok() && !content.includes('<!DOCTYPE html>'), `${resource}: serves its own public document`);
    if (resource.endsWith('.json')) {
      const { entries } = JSON.parse(content);
      check(entries.length && entries.every(entry => entry.identifier.startsWith('urn:air:') && entry.displayName && entry.type && entry.url && !entry.data), `${resource}: valid ARD entries`);
    }
  }
  const noScript = await browser.newContext({ javaScriptEnabled: false });
  const home = await noScript.newPage(); await home.goto(base);
  check(await home.getByRole('heading', { name: 'Review a game' }).isVisible(), 'Home content paints without JavaScript');
  await noScript.close();
  console.log(`${checks} loading, discovery, and security checks passed.`);
} finally { await browser.close(); }
