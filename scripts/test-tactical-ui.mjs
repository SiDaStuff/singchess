// Real review UI with curated legal positions; APIs and external requests are
// isolated. This never changes user accounts, Firebase or production games.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { Chess } = require('chess.js');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:4173';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const fen = '8/3q4/4k3/8/8/3N4/8/4K3 w - - 0 1';
const played = new Chess(fen); assert.ok(played.move('Nc5+'));
const result = { fen, fenAfter: played.fen(), moveSan: 'Nc5+', moveUci: 'd3c5', moveIndex: 0, moveNumber: 1,
  isWhite: true, classificationKey: 'BEST', evalBefore: 100, evalAfter: 100, cpLoss: 0,
  bestMove: 'd3c5', bestMoveSan: 'Nc5+', bestMovePvSan: 'Nc5+ Kd6 Nxd7 Kxd7',
  opponentBestMove: 'e6d6', opponentPvSan: 'Kd6 Nxd7 Kxd7' };
const pgn = `[Event "Teaching fixture"]\n[SetUp "1"]\n[FEN "${fen}"]\n[Result "*"]\n\n1. Nc5+ Kd6 2. Nxd7 Kxd7 *`;
const browser = await chromium.launch({ headless: true });
let checks = 0;
const check = (ok, text) => { assert.ok(ok, text); checks++; console.log(`PASS ${text}`); };
await fs.mkdir('artifacts/tactical-coach', { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1040 }, reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: { error: 'Isolated fixture' } });
      if (url.origin !== new URL(base).origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => window.app?.authState?.initialized && window.TacticalCoachUI && window.TacticsCoach);
    await page.evaluate(({ pgn, result }) => {
      const app = window.app;
      app.authState.user = { uid: 'qa-tactical', getIdToken: async () => 'isolated' };
      app._navigateTo('/review', { skipImport: true }); app._loadPgnText(pgn);
      app.analysisResults = [{ ...result, classification: window.MoveClassification.BEST }];
      app._goToMove(0); app.elLiveEval.hidden = false;
    }, { pgn, result });
    const state = () => page.evaluate(() => ({ fen: window.app.chess.fen(), index: window.app.currentMoveIndex,
      history: window.app.chess.history(), interactive: window.app.board.interactive, position: window.app.board.position,
      annotations: window.app.board.coachAnnotations }));
    const baseline = await state();
    const panel = page.locator('#tactical-coach-panel');
    check(await panel.isVisible() && await panel.innerText().then(t => t.includes('What should I learn?')), `${width}: structured teaching panel is visible`);
    const fork = panel.getByRole('button', { name: 'Fork / double attack', exact: true }).first();
    await fork.hover();
    check(await page.evaluate(() => window.app.board.coachAnnotations.arrows.some(a => a.from === 'c5' && a.to === 'd7') && window.app.board.coachAnnotations.arrows.some(a => a.from === 'c5' && a.to === 'e6')), `${width}: fork insight shows both verified attack arrows`);
    check(await page.evaluate(() => window.app.elMoveBadge.style.visibility === 'hidden'), `${width}: fact preview hides played-move badge`);
    await page.mouse.move(0, 0);
    check(JSON.stringify(await state()) === JSON.stringify(baseline), `${width}: leaving insight restores exact review state`);
    const start = panel.getByRole('button', { name: 'Show me why', exact: true });
    await start.click();
    check(await page.evaluate(() => window.app.board.position.d3 === 'wN' && window.TacticalCoachUI.getState().index === 0), `${width}: demonstration begins before the reviewed move`);
    check(await page.locator('.coach-board-dock').isVisible(), `${width}: compact teaching controls stay with the board`);
    check((await state()).fen === baseline.fen && (await state()).history.join() === baseline.history.join(), `${width}: demonstration keeps game history untouched`);
    const next = panel.getByRole('button', { name: 'Next step', exact: true });
    await next.click();
    check(await page.evaluate(() => window.app.board.position.c5 === 'wN' && window.app.board.coachAnnotations.arrows.some(a => a.from === 'c5' && a.to === 'd7')), `${width}: next step plays knight move and synchronizes fork annotations`);
    check(await panel.locator('.coach-step-explanation').innerText().then(t => t.includes('queen') && t.includes('king')), `${width}: step explanation names the two targets`);
    await page.locator('#btn-flip').click();
    check(await page.evaluate(() => window.app.board.flipped && window.app.board.position.c5 === 'wN' && window.TacticalCoachUI.getState().index === 1), `${width}: flipping preserves the current teaching step`);
    check(await page.locator('.coach-highlight[data-square="d7"] rect').first().getAttribute('x') === '404', `${width}: highlighted square uses flipped board coordinates`);
    await panel.locator('input[type="range"]').evaluate(el => { el.value = '0.35'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    check(await page.evaluate(() => window.app.board.coachAnnotations.opacity === .35), `${width}: opacity control changes the actual board markings`);
    await next.focus(); await page.keyboard.press('Enter');
    check(await page.evaluate(() => window.app.board.position.d6 === 'bK' && window.TacticalCoachUI.getState().index === 2), `${width}: keyboard next step shows the recorded defensive reply`);
    check(await page.locator('.coach-annotation-overlay[data-explanation-id]').evaluate(el => getComputedStyle(el).pointerEvents === 'none'), `${width}: annotations do not intercept board input`);
    await panel.getByRole('button', { name: 'Restart', exact: true }).click();
    const play = panel.getByRole('button', { name: 'Play demonstration', exact: true });
    await play.click(); await page.waitForTimeout(1750);
    check(await page.evaluate(() => window.TacticalCoachUI.getState().index === 1 && window.TacticalCoachUI.getState().playing), `${width}: playback advances the verified variation`);
    await panel.getByRole('button', { name: 'Pause demonstration', exact: true }).click();
    const paused = await page.evaluate(() => window.TacticalCoachUI.getState().index);
    await page.waitForTimeout(1750);
    check(await page.evaluate(index => window.TacticalCoachUI.getState().index === index && !window.TacticalCoachUI.getState().playing, paused), `${width}: pause stops progression`);
    const boardRect = await page.locator('#chess-board').boundingBox();
    check(boardRect.y >= 0 && boardRect.y + boardRect.height <= 1040, `${width}: demonstration board remains visible while using the explanation panel`);
    await page.screenshot({ path: `artifacts/tactical-coach/demonstration-${width}.png`, fullPage: true });
    await panel.getByRole('button', { name: 'Return to reviewed move', exact: true }).click();
    check(JSON.stringify(await state()) === JSON.stringify(baseline), `${width}: return restores pieces, annotations, legal input and history`);
    await start.click(); await next.click(); await next.click();
    await page.evaluate(() => window.app._goToMove(1));
    check(await page.evaluate(() => window.app.currentMoveIndex === 1 && window.app.board.position.d6 === 'bK' && !window.TacticalCoachUI.getState().playing && !window.app.board.coachAnnotations), `${width}: navigation clears the old demonstration and marks`);
    await page.evaluate(() => window.app._goToMove(0));
    // A missed fork supplies a different played branch and a verified engine
    // alternative. Switching branches must start from their own source FEN.
    await page.evaluate(({ fen, result }) => {
      const app = window.app;
      app._loadPgnText(`[SetUp "1"]\n[FEN "${fen}"]\n\n1. Nf4+ Kd6 2. Ne2 Kc5 *`);
      const board = new window.Chess(fen); board.move('Nf4+');
      app.analysisResults = [{ ...result, moveSan: 'Nf4+', moveUci: 'd3f4', fenAfter: board.fen(),
        classificationKey: 'MISTAKE', classification: window.MoveClassification.MISTAKE, cpLoss: 200,
        opponentPvSan: 'Kd6 Ne2 Kc5' }];
      app._goToMove(0); app.elLiveEval.hidden = false;
    }, { fen, result });
    const alternative = panel.getByRole('button', { name: 'Nc5+', exact: true });
    await alternative.hover();
    check(await page.evaluate(() => window.app.board.position.c5 === 'wN' && !window.app.board.position.f4), `${width}: better-move preview starts from the pre-move position`);
    await page.mouse.move(0, 0);
    await panel.locator('select').selectOption('best'); await start.click(); await next.click();
    check(await page.evaluate(() => window.app.board.position.c5 === 'wN' && window.TacticalCoachUI.getState().variationId === 'best'), `${width}: engine branch is playable independently`);
    await panel.locator('select').selectOption('played'); await next.click();
    check(await page.evaluate(() => window.app.board.position.f4 === 'wN' && !window.app.board.position.c5), `${width}: changing demonstration branch restores its correct starting position`);
    await page.keyboard.press('Escape');
    check(await page.evaluate(() => !window.TacticalCoachUI.getState().variationId && window.app.board.position.f4 === 'wN'), `${width}: Escape returns from an alternative demonstration`);
    await start.click(); await play.click();
    await page.evaluate(() => window.app._navigateTo('/settings'));
    await page.waitForTimeout(1700);
    check(await page.evaluate(() => !window.TacticalCoachUI.getState().playing && !window.app.board.coachAnnotations), `${width}: route change cancels playback before stale steps render`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && !errors.length, `${width}: responsive teaching UI has no overflow or runtime errors (${errors.join('; ')})`);
    await context.close();
  }
  console.log(`${checks} tactical teaching browser checks passed.`);
} finally { await browser.close(); }
