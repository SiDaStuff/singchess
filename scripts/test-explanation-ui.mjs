// Real application UI; all APIs and external requests are isolated.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
const require = createRequire(import.meta.url);
const { Chess } = require('chess.js');
const { loadAnalyzer } = require('../server/api/_lib/analysis-loader');
const analyzer = new (loadAnalyzer().MoveAnalyzer)();
const pgn = await fs.readFile(new URL('./fixtures/explanation-game.pgn', import.meta.url), 'utf8');
const chess = new Chess(); assert.ok(chess.load_pgn(pgn));
const replay = new Chess(), positions = [];
for (const san of chess.history()) { positions.push(replay.fen()); replay.move(san); }
const fixture = (index, san, extra = {}) => {
  const board = new Chess(positions[index]); board.move(san);
  return { moveIndex: index, moveNumber: Math.floor(index / 2) + 1, moveSan: san, isWhite: index % 2 === 0,
    fen: positions[index], fenAfter: board.fen(), classificationKey: 'MISTAKE',
    evalBefore: -400, evalAfter: -400, cpLoss: 120, ...extra };
};
const rookResult = fixture(79, 'Rf3', { bestMoveSan: 'h1=Q', bestMove: 'h2h1q', opponentBestMove: 'c6d6' });
const mateResult = fixture(86, 'Kd1', { classificationKey: 'EXCELLENT', cpLoss: 0, bestMoveSan: 'Kb1' });
const operaPgn = await fs.readFile(new URL('./fixtures/opera-game.pgn', import.meta.url), 'utf8');
const opera = new Chess(); opera.load_pgn(operaPgn);
const operaReplay = new Chess(), operaPositions = [];
for (const move of opera.history()) { operaPositions.push(operaReplay.fen()); operaReplay.move(move); }
const operaFixture = (index, moveSan, classificationKey, extra) => {
  const board = new Chess(operaPositions[index]); board.move(moveSan);
  return { moveIndex: index, moveNumber: Math.floor(index / 2) + 1, isWhite: index % 2 === 0,
    moveSan, classificationKey, fen: operaPositions[index], fenAfter: board.fen(), evalBefore: 100, evalAfter: 100, cpLoss: 100, ...extra };
};
const operaTrade = operaFixture(19, 'cxb5', 'MISTAKE', { bestMoveSan: 'Qb4+', bestMove: 'e7b4', opponentBestMove: 'c4b5',
  opponentPvSan: 'Bxb5+ Nbd7 O-O-O Qe6 Bxf6 gxf6', bestMovePvSan: 'Qb4+ Qxb4 Bxb4+ c3 cxb5 Bxb5+' });
const operaSacrifice = operaFixture(24, 'Rxd7', 'BRILLIANT', { opponentPvSan: 'Nxd7 Bxe7 Bxe7 Bxd7+ Kxd7' });
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:4173';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true });
let count = 0;
const check = (condition, message) => { assert.ok(condition, message); count++; console.log(`PASS ${message}`); };
await fs.mkdir('artifacts/explanations', { recursive: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width < 500, reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Isolated test"}' });
      if (url.origin !== new URL(base).origin && !['data:', 'blob:'].includes(url.protocol)) return route.abort();
      return route.continue();
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => window.app?.authState.initialized && window.MoveExplanationUI);
    await page.evaluate(({ pgn, result }) => {
      const app = window.app;
      app.authState.user = { uid: 'qa-explanation', getIdToken: async () => 'isolated' };
      app._navigateTo('/review', { skipImport: true }); app._loadPgnText(pgn);
      app.analysisResults = [];
      app.analysisResults[result.moveIndex] = { ...result, classification: window.MoveClassification[result.classificationKey] };
      app._goToMove(result.moveIndex);
      app.elLiveEval.hidden = false;
    }, { pgn, result: rookResult });
    const state = () => page.evaluate(() => ({ fen: window.app.chess.fen(), index: window.app.currentMoveIndex, board: window.app.board.position, highlights: window.app.board.highlights, arrows: window.app.board.userArrows, best: window.app.board.bestMoveArrow, history: window.app.chess.history() }));
    const original = await state();
    const reply = page.locator('#insight-coach button').filter({ hasText: /^Rd6$/ }).first();
    await reply.hover();
    check(await page.evaluate(() => window.app.elMoveBadge.style.visibility === 'hidden'), `${width}: main move badge is hidden during preview`);
    check(await page.evaluate(() => window.app.board.position.d6 === 'wR' && window.app.board.position.f3 === 'bR'), `${width}: reply hover shows Rd6 after Rf3`);
    check((await state()).fen === original.fen, `${width}: preview never mutates game state`);
    await page.evaluate(() => {
      const board = window.app.board;
      window.__previewFrames = [];
      window.__originalUpdatePieces = board._updatePieces;
      board._updatePieces = function () { window.__previewFrames.push(JSON.stringify(this.position)); return window.__originalUpdatePieces.call(this); };
    });
    const gap = await reply.evaluate(el => {
      const range = document.createRange();
      range.setStart(el.nextSibling, 1); range.setEnd(el.nextSibling, 2);
      const rect = range.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.mouse.move(gap.x, gap.y);
    await page.waitForTimeout(230);
    check(await page.evaluate(() => window.app.board.position.d6 === 'wR'), `${width}: prose gaps preserve the current preview`);
    const adjacentPawn = page.locator('#insight-coach button').filter({ hasText: /^f6$/ }).first();
    await adjacentPawn.hover();
    await reply.focus(); await adjacentPawn.focus();
    check(await page.evaluate(position => !window.__previewFrames.includes(JSON.stringify(position)), original.board), `${width}: switching references never renders the original board`);
    check((await state()).fen === original.fen && (await state()).index === original.index, `${width}: continuous browsing preserves review state`);
    await page.evaluate(() => { window.app.board._updatePieces = window.__originalUpdatePieces; });
    await page.mouse.move(0, 0);
    check(JSON.stringify(await state()) === JSON.stringify(original), `${width}: unhover restores pieces, arrows, highlights and history`);
    check(await page.evaluate(() => window.app.elMoveBadge.style.visibility !== 'hidden'), `${width}: main move badge is restored after preview`);
    const pawn = page.locator('#insight-coach button').filter({ hasText: /^f6$/ }).first();
    await pawn.hover();
    check(await page.locator('#chess-board [data-square="f6"]').evaluate(el => el.classList.contains('highlight')), `${width}: pawn reference highlights f6`);
    await page.mouse.move(0, 0);
    await reply.focus();
    check(await page.evaluate(() => window.app.board.position.d6 === 'wR'), `${width}: keyboard focus previews move`);
    await page.keyboard.press('Escape');
    check(JSON.stringify(await state()) === JSON.stringify(original), `${width}: Escape restores board`);
    if (width < 500) await reply.tap(); else await reply.click();
    check(await page.evaluate(() => window.app.board.position.d6 === 'wR'), `${width}: click or tap activates preview`);
    if (width < 500) await page.locator('#workspace-title').tap(); else await page.locator('#workspace-title').click();
    check(JSON.stringify(await state()) === JSON.stringify(original), `${width}: outside click or tap restores board`);
    await reply.hover();
    await page.evaluate(() => window.app._goToMove(78));
    await page.mouse.move(0, 0);
    check(await page.evaluate(() => window.app.currentMoveIndex === 78 && window.app.board.position.g3 === 'bR'), `${width}: navigation during preview keeps the new position`);
    await page.evaluate(result => {
      window.app.analysisResults[result.moveIndex] = { ...result, classification: window.MoveClassification.EXCELLENT };
      window.app._goToMove(result.moveIndex);
    }, mateResult);
    check(await page.locator('#insight-coach').innerText().then(text => text.includes('h1=Q#') && !text.includes('excellent') && !text.includes('0.00')), `${width}: real Kd1 position has mate explanation`);
    check(await page.locator('#insight-class').innerText().then(text => text.toLowerCase() === 'mate in 1'), `${width}: verified mate threat replaces stale Excellent badge`);
    const mate = page.locator('#insight-coach button').filter({ hasText: /^h1=Q#$/ });
    await mate.hover();
    check(await page.evaluate(() => window.app.board.position.h1 === 'bQ' && window.app.board.checkSquare === 'd1' && window.app.board.userArrows.some(a => a.from === 'h1' && a.to === 'd1')), `${width}: checkmate preview shows queen, checked king and attack arrow`);
    check(await page.locator('#explanation-preview-status').innerText().then(text => text.includes('checkmate')), `${width}: checkmate is explicitly announced`);
    await page.mouse.move(0, 0);
    const badge = await page.evaluate(() => window.app._makeAnticheatReviewRow({ status: 'running', gamesAnalyzed: 0, gamesTotal: 0 }));
    check(badge.includes('In progress') && !badge.includes('Completed'), `${width}: unknown-total running report never shows completed`);
    await page.evaluate(({ pgn, trade, sacrifice }) => {
      const app = window.app; app._loadPgnText(pgn); app.analysisResults = [];
      for (const result of [trade, sacrifice]) app.analysisResults[result.moveIndex] = { ...result, classification: window.MoveClassification[result.classificationKey] };
      app._goToMove(trade.moveIndex);
    }, { pgn: operaPgn, trade: operaTrade, sacrifice: operaSacrifice });
    check(await page.locator('#insight-coach').innerText().then(text => text.includes('gain of 2 material points') && !text.includes('resulting position is still worse')), `${width}: Opera trade explains material and continuation`);
    const lineMove = san => page.locator('#insight-coach button').filter({ hasText: new RegExp(`^${san.replace(/[+]/g, '\\+')}$`) }).first();
    await page.locator('#insight-coach .explanation-variations summary').click();
    await page.waitForFunction(() => document.querySelector('#insight-coach .explanation-variations p'));
    await lineMove('Bxb5+').hover(); await lineMove('Nbd7').hover(); await lineMove('O-O-O').hover();
    check(await page.evaluate(() => window.app.board.position.c1 === 'wK' && window.app.board.position.d1 === 'wR' && window.app.board.position.d7 === 'bN' && window.app.currentMoveIndex === 19), `${width}: sequential line previews include castling without changing cursor`);
    const queenCapture = page.locator('#insight-coach button').filter({ hasText: /^Bxb4\+$/ }).last();
    await queenCapture.hover();
    check(await page.evaluate(() => window.app.board.position.b4 === 'bB'), `${width}: repeated queen-capture reference uses the correct branch`);
    await page.evaluate(() => window.app._goToMove(24));
    check(await page.locator('#insight-coach').innerText().then(text => text.includes('after Nxd7, Bxe7 captures the queen on e7') && !text.includes('bait')), `${width}: brilliant sacrifice explains the compensation`);
    await page.locator('#insight-coach button').filter({ hasText: /^Bxe7$/ }).last().hover();
    check(await page.evaluate(() => window.app.board.position.e7 === 'wB'), `${width}: sacrifice capture explanation identifies the right bishop`);
    await page.mouse.move(0, 0);
    await page.evaluate(result => window.app._renderMoveInsights({ ...result, classification: window.MoveClassification.MISTAKE }), rookResult);
    check(await page.locator('#insight-empty').innerText().then(text => text.includes('does not match this position')), `${width}: mismatched saved analysis is rejected`);
    check(await page.locator('#insight-content').isHidden(), `${width}: mismatched move advice is hidden`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: interactive prose fits viewport`);
    check(!errors.length, `${width}: no runtime errors (${errors.join("; ")})`);
    await page.screenshot({ path: `artifacts/explanations/review-${width}.png`, fullPage: true });
    await context.close();
  }
  console.log(`${count} explanation browser checks passed.`);
} finally { await browser.close(); }
