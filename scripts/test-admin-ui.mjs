import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:4173';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true });
let checks = 0;
const check = (ok, message) => { assert.ok(ok, message); checks++; console.log(`PASS ${message}`); };
await fs.mkdir('artifacts/admin', { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    const notes = [{ id: 'n1', text: 'Prior appeal checked', author: 'admin', createdAt: 123 }];
    let queries = 0, mutations = 0;
    const detail = {
      account: { uid: 'target', username: 'FastKnight', email: 'player@example.test', emailVerified: true },
      plan: { name: 'Max' }, ban: { banned: true, reason: 'Repeated harassment', bannedBy: 'moderator', bannedAt: 123 },
      profile: { puzzleRating: 1800, puzzleStats: { solved: 42, attempted: 50 }, gameStats: { games: 123, accuracy: 74 } },
      stats: { puzzleRating: 1800, puzzleStats: { solved: 42, attempted: 50 }, today: { coachUsagePercent: 98 },
        storedStats: {}, recordedUsageTotals: { serverReviews: 12 }, savedReviews: 3, anticheatReports: 1, thisWeek: {}, recentUsage: [] },
      linkedAccounts: { chesscom: 'linked-player' }, notes, reports: [{ reason: 'Harassment', details: '<script>bad</script>', reportedAt: 123 }], actions: [], flags: { reportCount: 3 },
      automaticReviews: { status: 'Enabled' },
    };
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/admin/profile') {
        queries++;
        const query = url.searchParams.get('query');
        if (query === 'missing') return route.fulfill({ status: 404, json: { error: 'No account found.' } });
        if (query === 'twin') return route.fulfill({ status: 409, json: { error: 'Select an account.', matches: [{ uid: 'target', username: 'FastKnight', email: 'player@example.test' }] } });
        return route.fulfill({ json: { detail } });
      }
      if (url.pathname === '/api/admin/abuse/notes') {
        mutations++;
        const body = route.request().postDataJSON();
        if (body.action === 'add') notes.push({ id: 'n2', text: body.text, author: 'admin', createdAt: 124 });
        if (body.action === 'edit') notes.find(n => n.id === body.noteId).text = body.text;
        if (body.action === 'remove') notes.splice(notes.findIndex(n => n.id === body.noteId), 1);
        return route.fulfill({ json: { success: true } });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: { error: 'Isolated endpoint' } });
      if (url.origin !== new URL(base).origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base);
    await page.waitForFunction(() => window.app?.authState.initialized && window.AdminProfileUI);
    await page.evaluate(() => {
      const app = window.app;
      app.authState.user = { uid: 'admin-test', email: 'qa@example.test', getIdToken: async () => 'isolated' };
      app.authState.isAdmin = false; app._syncAccountUi(); app._navigateTo('/account');
    });
    check(await page.locator('#admin-profile-panel').isHidden(), `${width}: profile lookup is hidden for non-admin users`);
    await page.evaluate(() => { window.app.authState.isAdmin = true; window.app._syncAccountUi(); });
    const search = page.locator('#admin-profile-query');
    await search.fill('FastKnight');
    check(queries === 0, `${width}: typing does not send repeated lookup requests`);
    await page.locator('#admin-profile-search button').click();
    await page.locator('#admin-profile-result h3').waitFor();
    const result = page.locator('#admin-profile-result');
    check((await result.innerText()).includes('Repeated harassment') && (await result.innerText()).includes('moderator'), `${width}: ban reason and administrator are visible`);
    check((await result.innerText()).includes('42') && (await result.innerText()).includes('1800') && (await result.innerText()).includes('98% used'), `${width}: statistics and percentage usage are visible`);
    check((await result.innerText()).includes('Prior appeal checked'), `${width}: existing administrator notes are visible`);
    await page.locator('#admin-profile-note').fill('Follow up on appeal');
    await page.locator('#admin-profile-note-form button').click();
    await page.waitForFunction(() => document.getElementById('admin-profile-result').textContent.includes('Follow up on appeal'));
    check(mutations === 1, `${width}: adding a note persists and refreshes the inspected account`);
    page.once('dialog', dialog => dialog.accept('Updated appeal note'));
    await page.locator('[data-id="n2"] [data-note-action="edit"]').click();
    await page.waitForFunction(() => document.getElementById('admin-profile-result').textContent.includes('Updated appeal note'));
    check(mutations === 2, `${width}: editing a note preserves the account context`);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-id="n2"] [data-note-action="remove"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-id="n2"]'));
    check(mutations === 3, `${width}: removing a note refreshes the inspected account`);
    await page.locator('#admin-profile-manage').click();
    check(await page.locator('#spa-ban-user-email').inputValue() === 'player@example.test', `${width}: restriction controls target the inspected account`);
    await search.fill('twin'); await page.locator('#admin-profile-search button').click();
    await page.locator('[data-match]').waitFor(); await page.locator('[data-match]').click();
    await page.locator('#admin-profile-result h3').waitFor();
    check(await result.innerText().then(t => t.includes('FastKnight')), `${width}: ambiguous username selection loads the chosen profile`);
    await page.screenshot({ path: `artifacts/admin/profile-${width}.png`, fullPage: true });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: admin profile fits viewport without horizontal overflow`);
    await search.fill('missing'); await page.locator('#admin-profile-search button').click();
    await page.waitForFunction(() => document.getElementById('admin-profile-status').textContent.includes('No account found'));
    check(await result.innerText() === '', `${width}: failed lookup clears stale account details`);
    await search.fill('FastKnight'); await page.locator('#admin-profile-search button').click();
    await page.locator('#admin-profile-result h3').waitFor();
    await page.evaluate(() => { window.app.authState.isAdmin = false; window.app._syncAdminControlsVisibility(); });
    check(await result.innerText() === '' && await search.inputValue() === '' && await page.locator('#admin-profile-panel').isHidden(), `${width}: losing administrator access clears private details`);
    check(!errors.length, `${width}: no browser runtime errors (${errors.join("; ")})`);
    await context.close();
  }
  console.log(`${checks} administrator browser checks passed.`);
} finally { await browser.close(); }
