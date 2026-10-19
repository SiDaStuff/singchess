import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
let checks = 0;
const check = (value, name) => { assert.ok(value, name); checks++; console.log('PASS ' + name); };
await fs.mkdir('artifacts/qol', { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Isolated test endpoint"}' });
      if (url.origin !== new URL(base).origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage(), errors = []; page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    await page.goto(base + '/review'); await page.waitForFunction(() => window.QualityOfLife && window.app.authState.initialized);
    await page.evaluate(() => { window.app._requestLiveEvaluation = async () => {}; window.app._navigateTo('/review', { skipImport: true }); });
    await page.keyboard.press('Control+k');
    check(await page.locator('#qol-command-palette').isVisible(), `${width}: keyboard command palette opens`);
    await page.getByRole('searchbox', { name: 'Search commands' }).fill('settings');
    await page.locator('.qol-command-list button').first().click();
    await page.waitForURL('**/settings');
    check(await page.locator('#settings-usability').isVisible(), `${width}: usability settings are available`);
    check(await page.locator('.qol-resizer, .qol-edge-resizer').count() === 0 && await page.locator('[data-qol-setting="boardSize"]').count() === 0, `${width}: window resize sliders are removed`);
    await page.locator('[data-qol-setting="coordinates"]').selectOption('outside');
    await page.locator('[data-qol-setting="contrast"]').selectOption('high');
    check(await page.evaluate(() => document.body.dataset.coordinates === 'outside' && document.body.dataset.contrast === 'high'), `${width}: accessibility settings apply immediately`);
    await page.locator('[data-qol-setting="sounds"]').uncheck();
    check(await page.evaluate(() => !window.app.boardSounds.preferences.sounds && !window.Play.sounds.preferences.sounds), `${width}: one sound setting controls Review and Play`);
    await page.locator('[data-qol-setting="multiPremoves"]').check();
    check(await page.evaluate(() => window.Play.board.preferences.multiPremoves), `${width}: queue setting reaches live input`);
    await page.evaluate(() => window.app._navigateTo('/review', { skipImport: true }));
    await page.evaluate(() => {
      const app = window.app; app._loadGame(['e4', 'e5', 'Nf3'], { White: 'Alice', Black: 'Bob', Result: '*' });
      app._goToMove(1); window.QualityOfLife.updateReviewTools();
    });
    await page.locator('.qol-review-tools').getByRole('button', { name: 'Bookmark', exact: true }).click();
    await page.getByRole('textbox', { name: 'Private position note' }).fill('Develop the knights.');
    check(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('sidastuff.positionNotes.guest')))[0]['1'].bookmarked), `${width}: bookmarks and private notes persist`);
    check(await page.locator('.qol-review-tools [role="group"]').count() === 2 && await page.locator('.qol-review-tools > .qol-actions').count() === 0, `${width}: review controls have named navigation and study groups`);
    check(await page.locator('.qol-review-tools button:not(:has(.material-symbols-outlined))').count() === 0, `${width}: review actions include icons and text`);
    await page.evaluate(() => {
      window.QualityOfLife.save({ contrast: 'normal', coordinates: 'inside' });
      document.body.dataset.boardTheme = 'classic';
    });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#chess-board .square.light:not(.highlight):not(.selected)')).backgroundColor === 'rgb(247, 241, 228)');
    const colors = await page.evaluate(() => ['light', 'dark'].map(color => getComputedStyle(document.querySelector(`#chess-board .square.${color}:not(.highlight):not(.selected)`)).backgroundColor));
    check(colors.join('|') === 'rgb(247, 241, 228)|rgb(184, 141, 88)', `${width}: Classic uses the cream and brown shown in its preview (${colors.join(', ')})`);
    for (const [id, tab] of [['live-eval', 'feedback'], ['move-list-container', 'moves'], ['eval-graph-card', 'graph']]) {
      await page.locator(`#analysis-tab-${tab}`).click();
      const toggle = page.locator(`#${id} > .qol-panel-toolbar button`);
      await toggle.click();
      check(await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false', `${width}: ${id} keeps its expand control visible`);
      await toggle.click();
      check(await toggle.getAttribute('aria-expanded') === 'true' && !await page.locator(`#${id}`).evaluate(node => node.classList.contains('qol-collapsed')), `${width}: ${id} reopens`);
    }
    await page.locator('#analysis-tab-moves').click();
    await page.locator('#move-list-container > .qol-panel-toolbar button').click();
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sidastuff.collapsedPanels'));
      localStorage.setItem('sidastuff.collapsedPanels', JSON.stringify({ ...saved, 'puzzle-card': true, 'coach-card': true }));
    });
    await page.evaluate(() => window.app._navigateTo('/settings'));
    await page.evaluate(() => window.app._navigateTo('/review', { skipImport: true }));
    check(await page.evaluate(() => window.app.gameMoves.join() === 'e4,e5,Nf3' && window.app.currentMoveIndex === 1), `${width}: navigation preserves review moves and cursor`);
    await page.reload(); await page.waitForFunction(() => window.QualityOfLife && window.app.authState.initialized);
    await page.waitForFunction(() => window.app.gameMoves.length === 3);
    check(await page.evaluate(() => window.app.currentMoveIndex === 1), `${width}: refresh restores the saved review cursor`);
    await page.locator('#analysis-tab-moves').click();
    const restoredToggle = page.locator('#move-list-container > .qol-panel-toolbar button');
    check(await restoredToggle.isVisible() && await restoredToggle.getAttribute('aria-expanded') === 'false', `${width}: a saved collapsed panel can still be reopened`);
    await page.locator('.qol-review-tools summary').filter({ hasText: 'View and session' }).click();
    await page.getByRole('button', { name: 'Expand all panels', exact: true }).click();
    check(await page.locator('.qol-collapsed').count() === 0 && await page.locator('#puzzle-card .qol-collapse-panel').count() === 0, `${width}: recovery expands panels and old puzzle collapse settings are ignored`);
    check(await page.evaluate(() => {
      const app = window.app;
      return ['BRILLIANT', 'GREAT'].every((key, index) => {
        app.analysisResults ||= [];
        app.analysisResults[index] = { classificationKey: key, classification: window.MoveClassification[key] };
        app._showMoveBadge(window.MoveClassification[key], 'e4');
        return !app.authState.user && getComputedStyle(app.elMoveBadge).display !== 'none'
          && !!app._createMoveCell(index, app.gameMoves[index]).querySelector('.move-icon');
      });
    }), `${width}: signed-out players see Brilliant and Great on the board and move list`);
    await page.evaluate(() => {
      const app = window.app; app._requestLiveEvaluation = async () => {};
      app.analysisResults = app.gameMoves.map((san, index) => ({ moveSan: san, move: san, moveIndex: index, isWhite: index % 2 === 0, cpLoss: index === 1 ? 200 : 0, evalBefore: 0, evalAfter: 0, bestMove: index === 1 ? 'b8c6' : index === 0 ? 'd2d4' : 'g1f3', classificationKey: index === 1 ? 'MISTAKE' : 'GOOD', classification: window.MoveClassification[index === 1 ? 'MISTAKE' : 'GOOD'] }));
      app._renderMoveList(); window.QualityOfLife.updateReviewTools();
    });
    await page.getByRole('combobox', { name: 'Filter reviewed moves' }).selectOption('mistake');
    check(await page.locator('.move-cell:visible').count() === 1, `${width}: review filter shows only matching moves`);
    await page.locator('.qol-review-tools').getByRole('button', { name: 'Next mistake', exact: true }).click();
    check(await page.evaluate(() => window.app.currentMoveIndex === 1), `${width}: next-mistake navigation uses classifications`);
    await page.locator('.qol-review-tools summary').filter({ hasText: 'Played move / best move' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.qol-comparison .chess-board').length === 2);
    check(await page.locator('.qol-comparison .chess-board').count() === 2, `${width}: comparison uses two actual shared boards`);
    await page.keyboard.press('Escape');
    await page.locator('.qol-review-tools').getByRole('button', { name: 'Focus', exact: true }).click();
    check(await page.evaluate(() => document.body.classList.contains('qol-focus')), `${width}: focus mode is reversible`);
    await page.getByRole('button', { name: 'Exit focus mode (Z)', exact: true }).click();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: controls fit the viewport`);
    await page.screenshot({ path: `artifacts/qol/review-${width}.png`, fullPage: true });
    await page.evaluate(() => { window.app._showReviewSummary(); });
    check(await page.evaluate(() => JSON.parse(localStorage.getItem('sidastuff.reviewCache.guest'))[0].results.length === 3), `${width}: completed review results are cached`);
    await page.evaluate(() => { window.app._loadGame(['e4', 'e5', 'Nf3'], { White: 'Alice', Black: 'Bob', Result: '*' }); });
    check(await page.evaluate(() => window.app.analysisResults?.length === 3 && window.app.subLines instanceof Map && window.app.analysisResults[1].classification === window.MoveClassification.MISTAKE), `${width}: cached results restore classifications and variations without engine work`);
    await page.evaluate(() => {
      window.app.authState.user = { uid: 'other-account', getIdToken: async () => 'isolated-test' };
      window.dispatchEvent(new Event('linked-auth'));
    });
    check(await page.getByRole('textbox', { name: 'Private position note' }).inputValue() === '' && await page.evaluate(() => !localStorage.getItem('sidastuff.positionNotes.other-account')), `${width}: account changes do not expose previous notes`);
    check(errors.length === 0, `${width}: no runtime errors (${errors.join('; ')})`);
    await context.close();
  }
} finally { await browser.close(); }
console.log(`${checks} quality-of-life browser checks passed.`);
