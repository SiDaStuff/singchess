// Isolated board regression: no server, credentials, or user data are used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const source = await fs.readFile(new URL('../src/board.js', import.meta.url), 'utf8');
const styles = await fs.readFile(new URL('../src/ui/board.css', import.meta.url), 'utf8');
const chessSource = await fs.readFile(require.resolve('chess.js'), 'utf8');
const browser = await chromium.launch({ headless: true });
let checks = 0;
const check = (value, name) => { assert.ok(value, name); checks++; console.log(`PASS ${name}`); };
try {
  for (const width of [1024, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: 'reduce' });
    await page.setContent(`<style>${styles}\nbody{margin:0}.board-wrapper{width:min(480px,100vw)}</style><div class="board-wrapper"><div id="board" class="chess-board"></div></div>`);
    await page.addScriptTag({ content: chessSource });
    await page.evaluate(() => {
      window.getPieceSvgUri = () => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>');
    });
    await page.addScriptTag({ content: source });
    const results = await page.evaluate(() => {
      const results = [], verify = (condition, name) => results.push([Boolean(condition), name]);
      const board = new ChessBoard('board'), chess = new Chess();
      window.board = board;
      board.setChessInstance(chess); board.setPositionFromFen(chess.fen());
      const makeAnnotations = fen => ({ fen, explanationId: 'lesson-1', opacity: .7,
        arrows: [
          { from: 'e2', to: 'e4', role: 'suggestion', label: 'Suggested pawn advance' },
          { from: 'd8', to: 'h4', role: 'threat', label: 'Queen threat' },
          { from: 'c1', to: 'g5', role: 'tactic', label: 'Pin line' },
          { from: 'g1', to: 'f3', role: 'defense', label: 'Defend the center' },
        ], highlights: [{ square: 'e2', role: 'suggestion', label: 'Pawn being discussed' }],
      });
      const annotation = makeAnnotations(chess.fen());
      board.addUserArrow('d2', 'd4'); board.setBestMoveArrow('b1c3');
      verify(board.setCoachAnnotations(annotation), 'matching FEN accepts annotations');
      verify(board.coachAnnotationLayer.querySelectorAll('.coach-arrow').length === 4 && board.coachAnnotationLayer.querySelectorAll('.coach-highlight').length === 1, 'all four roles and square highlights render');
      verify(board.userArrows.length === 1 && board.bestMoveArrow.from === 'b1', 'coach layer preserves player drawings and best move');
      verify(board.coachAnnotationLayer.getAttribute('aria-label').includes('Suggested pawn advance') && board.getCoachAnnotationDescription().includes('Defense'), 'annotation descriptions are accessible');
      verify(board.coachAnnotationLayer.querySelector(':scope > g').getAttribute('opacity') === '0.7' && board.coachAnnotationLayer.querySelector('.coach-arrow').getAttribute('opacity') === '0.88', 'global and individual opacity controls are independent');
      const firstLine = board.coachAnnotationLayer.querySelector('.coach-arrow line');
      const originalPoint = [Number(firstLine.getAttribute('x1')), Number(firstLine.getAttribute('y1'))];
      board.flip();
      const flippedLine = board.coachAnnotationLayer.querySelector('.coach-arrow line');
      verify(Number(flippedLine.getAttribute('x1')) === 800 - originalPoint[0] && Number(flippedLine.getAttribute('y1')) === 800 - originalPoint[1], 'flip mirrors coach arrows without removing annotations');
      const square = board.container.querySelector('[data-square="e2"]'), rect = square.getBoundingClientRect();
      verify(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).closest('[data-square]') === square, 'overlay allows pointer input to reach the board');
      board.flip();
      const fields = chess.fen().split(' ');
      const changedClock = [...fields.slice(0, 4), '13', '22'].join(' ');
      verify(board.setCoachAnnotations(makeAnnotations(changedClock)), 'move counters do not invalidate the same chess position');
      verify(!board.setCoachAnnotations(makeAnnotations(fields[0])) && !board.coachAnnotations, 'placement-only data is rejected when full FEN is known');
      fields[1] = 'b';
      verify(!board.setCoachAnnotations(makeAnnotations(fields.join(' '))) && board.coachAnnotationLayer.style.display === 'none', 'wrong side to move clears stale annotations');
      fields[1] = 'w'; fields[2] = '-';
      verify(!board.setCoachAnnotations(makeAnnotations(fields.join(' '))), 'castling-right mismatch is rejected');
      fields[2] = 'KQkq'; fields[3] = 'e3';
      verify(!board.setCoachAnnotations(makeAnnotations(fields.join(' '))), 'en-passant mismatch is rejected');
      const unsafe = makeAnnotations(chess.fen()); unsafe.highlights[0].label = '<img src=x onerror=alert(1)>';
      board.setCoachAnnotations(unsafe);
      verify(!board.coachAnnotationLayer.querySelector('img') && board.coachAnnotationLayer.querySelector('title').textContent.includes('<img'), 'annotation labels remain text');
      const invalidItems = makeAnnotations(chess.fen());
      invalidItems.arrows.push({ from: 'z9', to: 'e4', role: 'threat' }, { from: 'a1', to: 'a2', role: 'unknown' });
      invalidItems.highlights.push({ square: 'a9', role: 'suggestion' });
      board.setCoachAnnotations(invalidItems);
      verify(board.coachAnnotations.arrows.length === 4 && board.coachAnnotations.highlights.length === 1, 'invalid square and role entries are filtered');
      board.clearCoachAnnotations();
      verify(board.userArrows.length === 1 && board.bestMoveArrow.to === 'c3', 'clearing coach markings retains other arrows');
      board.setCoachAnnotations(annotation);
      board.setHighlights([{ square: 'a1', type: 'highlight' }]);
      board.interactive = true; board.selectedSquare = 'e2'; board.legalMoves = ['e3', 'e4'];
      const baseline = JSON.stringify({ position: board.position, annotations: board.coachAnnotations, user: board.userArrows, best: board.bestMoveArrow, highlights: board.highlights });
      const firstPreview = new Chess(); firstPreview.move('e4');
      const restore = board.previewPosition(firstPreview, { from: 'e2', to: 'e4', annotations: makeAnnotations(firstPreview.fen()) });
      verify(!board.interactive && !board.selectedSquare && board.legalMoves.length === 0 && board.coachAnnotations.fen === firstPreview.fen(), 'preview draws its own annotations and disables play');
      const secondPreview = new Chess(); secondPreview.move('d4');
      restore.update(secondPreview, { from: 'd2', to: 'd4', annotations: makeAnnotations(secondPreview.fen()) });
      const repeated = board.previewPosition(firstPreview, { square: 'e4' });
      verify(repeated === restore && !board.coachAnnotations, 'continuous and nested previews keep one true review baseline');
      repeated();
      verify(JSON.stringify({ position: board.position, annotations: board.coachAnnotations, user: board.userArrows, best: board.bestMoveArrow, highlights: board.highlights }) === baseline && board.interactive && board.selectedSquare === 'e2' && board.legalMoves.includes('e4'), 'restore returns exact review markings and legal interaction');
      verify(!restore.update(firstPreview, { square: 'e4' }), 'expired preview handles cannot change the board');
      let committed = null;
      board.onMove = (from, to) => { committed = chess.move({ from, to }); board.setPositionFromFen(chess.fen()); };
      board._onSquareClick('e4');
      verify(committed?.san === 'e4' && chess.history().length === 1, 'legal moves still commit after annotation preview restores');
      verify(!board.coachAnnotations && board.coachAnnotationLayer.style.display === 'none', 'position change automatically removes stale coach markings');
      const staleLayer = board.coachAnnotationLayer;
      board.destroy();
      verify(!staleLayer.isConnected && !document.querySelector('.coach-annotation-overlay'), 'destroy removes the coach overlay');
      return results;
    });
    results.forEach(([value, name]) => check(value, `${width}px: ${name}`));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const animatedResults = await page.evaluate(async () => {
      const results = [], verify = (condition, name) => results.push([Boolean(condition), name]);
      const wait = () => new Promise(resolve => setTimeout(resolve, 110));
      const board = new ChessBoard('board'), baseline = new Chess();
      board.enableAnimations(true);
      document.body.style.setProperty('--piece-slide-duration', '.03s');
      board.setChessInstance(baseline); board.setPositionFromFen(baseline.fen());
      const e4 = new Chess(); e4.move('e4');
      let restore = board.previewPosition(e4, { from: 'e2', to: 'e4', animate: true });
      verify(board._slideElement?.isConnected && board.position.e4 === 'wP', 'explicit demo step starts the existing move animation');
      restore();
      await wait();
      verify(!board._slideElement && board.position.e2 === 'wP' && !board.container.querySelector('[data-square="e4"] .piece'), 'restore cancels the slide without a stale timer repaint');
      restore = board.previewPosition(e4, { from: 'e2', to: 'e4', animate: true });
      const d4 = new Chess(); d4.move('d4');
      board.setPositionFromFen(d4.fen());
      await wait();
      verify(!board._slideElement && board.position.d4 === 'wP' && board.container.querySelector('[data-square="d4"] .piece') && !board.container.querySelector('[data-square="e4"] .piece'), 'navigation cancels pending motion and keeps the new position');
      restore();
      board.enableAnimations(false);
      restore = board.previewPosition(e4, { from: 'e2', to: 'e4', animate: true });
      verify(!board._slideElement && board.container.querySelector('[data-square="e4"] .piece'), 'saved animation preference disables demo motion');
      restore();
      board.enableAnimations(true);
      const castle = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
      board.setChessInstance(castle); board.setPositionFromFen(castle.fen());
      const castleAfter = new Chess(castle.fen()); castleAfter.move('O-O');
      restore = board.previewPosition(castleAfter, { from: 'e1', to: 'g1', animate: true,
        annotations: { fen: castleAfter.fen(), explanationId: 'castle', arrows: [{ from: 'h1', to: 'f1', role: 'defense', label: 'The rook also moves' }] } });
      verify(board._slideElement?.isConnected && board.position.f1 === 'wR' && board.container.querySelector('[data-square="f1"] .piece') && !board.container.querySelector('[data-square="h1"] .piece'), 'castling rook reaches its correct square during king animation');
      board.flip();
      await wait();
      verify(!board._slideElement && board.coachAnnotations?.explanationId === 'castle' && board.position.g1 === 'wK' && board.container.querySelector('[data-square="g1"] .piece')?.style.opacity !== '0', 'flip cancels motion while preserving demo position and annotations');
      restore();
      board.flip();
      const promotion = new Chess('7k/P7/8/8/8/8/8/K7 w - - 0 1');
      board.setChessInstance(promotion); board.setPositionFromFen(promotion.fen());
      const promotionAfter = new Chess(promotion.fen()); promotionAfter.move('a8=Q+');
      restore = board.previewPosition(promotionAfter, { from: 'a7', to: 'a8', animate: true });
      verify(board._slideElement?.isConnected && board.position.a8 === 'wQ' && !board.container.querySelector('[data-square="a7"] .piece'), 'promotion animates the pawn and commits the promoted queen');
      await wait();
      verify(!board._slideElement && board.container.querySelector('[data-square="a8"] .piece')?.getAttribute('alt') === 'White queen' && board.container.querySelector('[data-square="a8"] .piece')?.style.opacity !== '0', 'promotion finishes with the correct visible piece');
      restore();
      board.setChessInstance(baseline); board.setPositionFromFen(baseline.fen());
      window.__animationRestore = board.previewPosition(e4, { from: 'e2', to: 'e4' });
      verify(!board._slideElement, 'hover previews stay instant when animations are enabled');
      window.__animationRestore();
      window.__animationBoard = board;
      return results;
    });
    animatedResults.forEach(([value, name]) => check(value, `${width}px: ${name}`));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    check(await page.evaluate(() => {
      const board = window.__animationBoard, target = new Chess(); target.move('e4');
      const restore = board.previewPosition(target, { from: 'e2', to: 'e4', animate: true });
      const reduced = !board._slideElement && board.container.querySelector('[data-square="e4"] .piece');
      restore(); board.destroy();
      return Boolean(reduced);
    }), `${width}px: reduced motion disables demo movement`);
    await page.close();
  }
  console.log(`${checks} board annotation checks passed.`);
} finally { await browser.close(); }
