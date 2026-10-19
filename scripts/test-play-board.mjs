// Isolated board/clock regressions. No Lichess account, network or live matches.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { PlayClock, PlayClockPair, formatPlayClock } from '../src/play/clock.js';
import { loadPlayPreferences, savePlayPreferences } from '../src/play/preferences.js';
import { BoardSounds } from '../src/board-sounds.js';
import { isFinished } from '../src/play/state.js';

let checks = 0;
const check = (condition, name) => { assert.ok(condition, name); checks++; console.log(`PASS ${name}`); };
let now = 1000;
const clock = new PlayClock({ now: () => now });
clock.sync({ white: 60000, black: 65000, running: 'white' });
now += 1234;
check(clock.values().white === 58766 && clock.values().black === 65000, 'only the authoritative running clock interpolates');
now += 120000;
check(clock.values().white === 0 && clock.values().running === 'white', 'local zero never invents a game-over event');
clock.sync({ white: 12000, black: 63000, running: 'black' });
now += 3000;
check(clock.values().white === 12000 && clock.values().black === 60000, 'server corrections replace local estimates');
clock.stop(); now += 30000;
check(clock.values().black === 60000 && clock.values().running === null, 'completed clocks remain stopped');
check(!clock.sync({ white: NaN, black: 12, running: 'white' }), 'invalid clock updates are rejected');
check(formatPlayClock(10000) === '0:10' && formatPlayClock(9999) === '0:09.9' && formatPlayClock(-3) === '0:00.0', 'clock formatting covers tenths and zero');
let warnings = 0;
const pair = new PlayClockPair({ now: () => now, onLowTime: () => warnings++ });
pair.sync({ white: 14000, black: 60000, running: 'white' });
pair.sync({ white: 14500, black: 60000, running: 'white' });
check(warnings === 1, 'increments and repeat events do not repeat low-time warnings');
pair.destroy();
const entries = new Map([['sidastuff.appearanceSettings', JSON.stringify({ boardTheme: 'walnut', pieceTheme: 'merida', pieceAnimations: false })]]);
const storage = { getItem: key => entries.get(key) || null, setItem: (key, value) => entries.set(key, value) };
check(loadPlayPreferences(storage).pieceTheme === 'merida' && !loadPlayPreferences(storage).animations, 'Play inherits existing appearance preferences');
savePlayPreferences({ volume: 2, boardTheme: 'unsafe', premoves: false }, storage);
check(loadPlayPreferences(storage).volume === 1 && !loadPlayPreferences(storage).premoves && loadPlayPreferences(storage).boardTheme === 'walnut', 'game preferences persist without overriding shared appearance');
const silent = new BoardSounds();
check(!silent.play('move') && !silent.context, 'sound respects autoplay until a user gesture');
silent.destroy();

// Exercise the actual stream lifecycle without mounting the app or contacting a
// provider. Delayed old-stream callbacks must never touch a newly selected game.
const experienceSource = await fs.readFile(new URL('../src/play/index.js', import.meta.url), 'utf8');
const classSource = experienceSource.slice(experienceSource.indexOf('export class PlayExperience'), experienceSource.indexOf('\ndocument.addEventListener')).replace('export class', 'class');
const Experience = new Function('isFinished', 'INITIAL', `${classSource}; return PlayExperience;`)(isFinished, new (createRequire(import.meta.url)('chess.js').Chess)().fen());
const experience = Object.create(Experience.prototype), streams = [], jobs = [], frames = [], elements = new Map();
let stops = 0, orientations = 0;
experience.$ = name => {
  if (!elements.has(name)) elements.set(name, { hidden: false, textContent: '', replaceChildren() {} });
  return elements.get(name);
};
experience.board = { setPosition: (fen, options) => frames.push({ fen, options }), setPending() {}, setOrientation: () => orientations++ };
experience.clocks = { stop: () => stops++ };
experience.profile = { id: 'self' }; experience.color = 'white';
experience.showGame = () => {}; experience.renderResult = () => {}; experience.updateConnection = () => {};
experience.message = text => { experience.lastMessage = text; };
experience.applyState = state => { experience.state = state; };
experience.run = fn => { const promise = fn(); jobs.push(promise); return promise; };
experience.api = { stream: (path, onEvent, { signal }) => new Promise((resolve, reject) => {
  streams.push({ path, resolve, emit: event => { try { onEvent(event); } catch (error) { reject(error); } } });
  signal.addEventListener('abort', resolve, { once: true });
}) };
experience.full = { id: 'aaaaaaaa' }; experience.state = { status: 'started' };
const Chess = createRequire(import.meta.url)('chess.js').Chess, retained = new Chess(); retained.move('e4');
experience.position = { chess: retained, lastMove: 'e2e4' };
await experience.resume('aaaaaaaa');
check(experience.full.id === 'aaaaaaaa' && frames.at(-1).fen === retained.fen() && !frames.at(-1).options.interactive && stops === 0, 'reconnecting preserves the last board and running clock estimates');
streams[0].emit({ type: 'gameFull', white: { id: 'self' }, state: { status: 'started' } });
check(orientations === 0, 'reconnecting preserves a manually flipped board');
await experience.resume('bbbbbbbb');
streams[0].emit({ type: 'gameFull', white: { id: 'old-player' }, state: { status: 'mate' } });
check(experience.full === null, 'late full state from an old controller cannot replace a new game');
streams[1].emit({ type: 'gameFull', white: { id: 'self' }, state: { status: 'started' } });
streams[0].emit({ type: 'gameState', status: 'mate' });
check(experience.full.id === 'bbbbbbbb' && experience.state.status === 'started', 'late terminal state from an old game is ignored');
streams[1].emit({ type: 'error', code: 'play_authorization_expired', error: 'Expired' });
await jobs.at(-1);
check(experience.gameController === null && experience.gameConnection === 'disconnected' && experience.full.id === 'bbbbbbbb', 'terminal authorization errors release the stream controller and retain the position');
experience.position = { chess: retained, lastMove: 'e2e4' };
await experience.resume('bbbbbbbb');
check(streams.length === 3, 'Resume opens a fresh stream after a fatal provider error');
streams[2].emit({ type: 'gameFull', white: { id: 'self' }, state: { status: 'mate' } }); streams[2].resolve();
await Promise.all(jobs);
check(experience.gameController === null && experience.full.id === 'bbbbbbbb' && experience.state.status === 'mate', 'completed stream releases resources and retains final game data');

const require = createRequire(import.meta.url);
const [boardSource, inputSource, prefSource, css, playCss, chessSource] = await Promise.all([
  fs.readFile(new URL('../src/board.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/play/live-game-input.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/play/preferences.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/ui/board.css', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/play/play.css', import.meta.url), 'utf8'),
  fs.readFile(require.resolve('chess.js'), 'utf8'),
]);
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [640, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, hasTouch: true, reducedMotion: 'reduce' });
    await page.route('https://play-board.test/assets/pieces/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (!/^\/assets\/pieces\/[a-z-]+\/[wb][KQRBNP]\.svg$/.test(pathname)) return route.abort();
      await route.fulfill({ contentType: 'image/svg+xml', body: await fs.readFile(new URL(`../public${pathname}`, import.meta.url)) });
    });
    await page.setContent(`<base href="https://play-board.test/"><style>${css}\n${playCss}\nbody{margin:0;--sq-light:#e5dcc5;--sq-dark:#8c9a75}.board-wrapper{width:min(520px,100vw)}</style><div class="board-wrapper"><div id="board" class="chess-board"></div></div>`);
    await page.addScriptTag({ content: chessSource });
    await page.addScriptTag({ content: prefSource.replace(/^export /gm, '') });
    await page.addScriptTag({ content: 'window.getPieceSvgUri = piece => `/assets/pieces/cburnett/${piece}.svg`;' });
    await page.addScriptTag({ content: boardSource });
    await page.addScriptTag({ content: inputSource.replace(/^import .*;\r?\n/gm, '').replace('export class LiveGameInput', 'window.LiveGameInput = class LiveGameInput') });
    await page.evaluate(() => {
      window.moves = []; window.premoves = [];
      window.board = new LiveGameInput(new ChessBoard('board'), { onMove: move => moves.push(move), onPremoveChange: move => premoves.push(move) });
      board.setPosition(new Chess().fen(), { interactive: true, playerColor: 'white' });
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.piece')].length === 32 && [...document.querySelectorAll('.piece')].every(image => image.naturalWidth > 0));
    check(await page.evaluate(() => board.renderer instanceof ChessBoard && !document.querySelector('.play-chessboard')), `${width}px: Play uses the actual Review ChessBoard`);
    check(await page.locator('.piece').count() === 32, `${width}px: existing vector pieces load at full resolution`);
    await page.screenshot({ path: new URL(`../artifacts/play-board-${width}.png`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
    const center = async square => page.locator(`[data-square="${square}"]`).evaluate(element => {
      const bounds = element.getBoundingClientRect(); return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    });
    const click = async square => { const { x, y } = await center(square); await page.mouse.click(x, y); };
    await click('e2');
    check(await page.locator('[data-square="e4"]').evaluate(element => !!element.querySelector('.legal-dot')), `${width}px: click selection shows legal destinations`);
    await click('e4');
    check(await page.evaluate(() => moves.join() === 'e2e4' && board.chess.get('e2')?.type === 'p' && !board.chess.get('e4')), `${width}px: click emits one UCI intent while server position stays authoritative`);
    await click('e2'); await click('e4');
    check(await page.evaluate(() => moves.length === 1), `${width}px: pending move prevents duplicate submissions`);
    await page.evaluate(() => {
      const chess = new Chess(); chess.move('e4');
      board.setPosition(chess.fen(), { interactive: true, lastMove: 'e2e4' });
    });
    await click('g1'); await click('f3');
    check(await page.evaluate(() => board.premove?.from === 'g1' && moves.length === 1), `${width}px: opponent turn queues a premove`);
    await page.keyboard.press('Escape');
    check(await page.evaluate(() => !board.premove && moves.length === 1), `${width}px: Escape cancels a premove selected with the pointer`);
    await click('g1'); await click('e2');
    check(await page.evaluate(() => board.premove?.from === 'g1' && board.premove?.to === 'e2'), `${width}px: premove can target a square currently occupied by a friendly piece`);
    await page.keyboard.press('Escape');
    await click('g1'); await click('f3');
    await page.evaluate(() => board.setPosition(board.fen, { interactive: true }));
    check(await page.evaluate(() => moves.length === 1 && board.premove?.to === 'f3'), `${width}px: duplicate stream event does not dispatch a premove`);
    await page.evaluate(() => {
      const chess = new Chess(); chess.move('e4'); chess.move('e5');
      board.setPosition(chess.fen(), { interactive: true, lastMove: 'e7e5' });
      board.setPosition(chess.fen(), { interactive: true, lastMove: 'e7e5' });
    });
    check(await page.evaluate(() => moves.join() === 'e2e4,g1f3' && !board.premove), `${width}px: legal premove dispatches once after authoritative opponent move`);
    await page.evaluate(() => {
      moves.length = 0;
      board.setPosition('k4r2/8/8/8/8/8/8/4K1N1 b - - 0 1', { interactive: true });
      board._activate('g1'); board._activate('f3');
      const chess = new Chess(board.fen); chess.move({ from: 'f8', to: 'f1' });
      board.setPosition(chess.fen(), { interactive: true });
    });
    check(await page.evaluate(() => !moves.length && !board.premove), `${width}px: premove is revalidated and cancelled silently when it becomes illegal`);
    await page.evaluate(() => {
      board.setPosition(new Chess().fen(), { interactive: true });
      const chess = new Chess(); chess.move('e4');
      board.setPosition(chess.fen(), { interactive: true });
      board._activate('g1'); board._activate('f3');
      board.setPosition(chess.fen(), { interactive: false });
      chess.move('e5'); board.setPosition(chess.fen(), { interactive: false });
    });
    check(await page.evaluate(() => !moves.length && !board.premove), `${width}px: disabling play cancels premoves before game completion or disconnect`);
    await page.evaluate(() => board.setPosition('7k/P7/8/8/8/8/8/K7 w - - 0 1', { interactive: true }));
    await click('a7'); await click('a8');
    check(await page.locator('[role="dialog"]').count() === 1 && await page.evaluate(() => moves.length === 0), `${width}px: promotion waits for an explicit choice`);
    await page.getByRole('button', { name: 'Promote to knight' }).click();
    check(await page.evaluate(() => moves.join() === 'a7a8n' && board.chess.get('a7')?.type === 'p'), `${width}px: underpromotion sends correct UCI without changing server position`);
    await page.evaluate(() => {
      moves.length = 0; board.setPending(false); board.setPreferences({ autoQueen: true });
      board._activate('a7'); board._activate('a8', { forcePromotion: true });
    });
    check(await page.locator('[role="dialog"]').count() === 1, `${width}px: autoqueen still permits promotion choice with Shift`);
    await page.evaluate(() => board.setPosition(board.fen, { interactive: false }));
    check(await page.locator('[role="dialog"]').count() === 0, `${width}px: disconnect closes a promotion chooser before it can submit`);
    await page.evaluate(() => board.setPosition(board.fen, { interactive: true }));
    await page.evaluate(() => { board._select(null); board._activate('a7'); board._activate('a8'); });
    check(await page.evaluate(() => moves.join() === 'a7a8q'), `${width}px: autoqueen sends a queen promotion`);
    await page.evaluate(() => { moves.length = 0; board.setPosition(new Chess().fen(), { interactive: true }); });
    const start = await center('d2'), end = await center('d4');
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    check(await page.locator('.drag-piece').count() === 1 && await page.evaluate(() => board.renderer.container.querySelector('[data-square="d2"]').classList.contains('dragging')), `${width}px: pointer drag follows cursor using a separate captured piece`);
    await page.mouse.up();
    check(await page.evaluate(() => moves.join() === 'd2d4' && !document.querySelector('.drag-piece')), `${width}px: pointer release sends move and clears drag image`);
    await page.evaluate(() => { moves.length = 0; board.setPending(false); board._select(null); board.setPreferences({ touchConfirm: true }); });
    const e2 = await center('e2'), e4 = await center('e4');
    await page.touchscreen.tap(e2.x, e2.y); await page.touchscreen.tap(e4.x, e4.y);
    check(await page.locator('[role="dialog"]').count() === 1 && await page.evaluate(() => moves.length === 0), `${width}px: optional touch confirmation prevents an accidental move`);
    await page.getByRole('button', { name: 'Play move' }).click();
    check(await page.evaluate(() => moves.join() === 'e2e4'), `${width}px: confirmed touch move is submitted`);
    const arrowFrom = await center('c1'), arrowTo = await center('g5');
    await page.mouse.move(arrowFrom.x, arrowFrom.y); await page.mouse.down({ button: 'right' });
    await page.mouse.move(arrowTo.x, arrowTo.y); await page.mouse.up({ button: 'right' });
    check(await page.evaluate(() => board.renderer.userArrows.some(arrow => arrow.from === 'c1' && arrow.to === 'g5') && board.renderer.arrowLayer.querySelectorAll('path').length > 0), `${width}px: manual right-drag arrow renders`);
    const beforeFlip = await page.locator('[data-square="a1"]').boundingBox();
    await page.evaluate(() => board.flip());
    const afterFlip = await page.locator('[data-square="a1"]').boundingBox();
    check(afterFlip.x > beforeFlip.x && afterFlip.y < beforeFlip.y && await page.evaluate(() => board.renderer.userArrows.some(arrow => arrow.from === 'c1' && arrow.to === 'g5')), `${width}px: flipping mirrors squares and preserves manual arrows`);
    await page.evaluate(() => { board.flip(); board.setPending(false); board._select(null); board.squares.get('e2').focus(); });
    await page.keyboard.press('Enter'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
    check(await page.evaluate(() => moves.length === 2 && moves.at(-1) === 'e2e4'), `${width}px: keyboard can select, navigate and submit a legal move`);
    check(await page.evaluate(() => { const fen = board.fen; return !board.setPosition('invalid') && board.fen === fen; }), `${width}px: malformed stream position preserves the valid board`);
    await page.evaluate(() => {
      moves.length = 0; board.cancelPremove(); board.setPreferences({ multiPremoves: true, touchConfirm: false });
      const chess = new Chess(); chess.move('e4'); board.setPosition(chess.fen(), { interactive: true, pending: false });
      board._activate('g1'); board._activate('f3'); board._activate('f3'); board._activate('g5');
    });
    check(await page.evaluate(() => board.premoves.length === 2 && !moves.length), `${width}px: multiple premoves queue against the planned position`);
    await page.evaluate(() => {
      const chess = new Chess(); chess.move('e4'); chess.move('e5');
      board.setPosition(chess.fen(), { interactive: true, pending: false });
      board.setPosition(chess.fen(), { interactive: true, pending: true });
    });
    check(await page.evaluate(() => moves.join() === 'g1f3' && board.premoves.length === 1), `${width}px: only the first queued premove submits per opponent move`);
    await page.evaluate(() => {
      const chess = new Chess(); for (const san of ['e4', 'e5', 'Nf3']) chess.move(san);
      board.setPosition(chess.fen(), { interactive: true, pending: false });
      chess.move('Nc6'); board.setPosition(chess.fen(), { interactive: true, pending: false });
    });
    check(await page.evaluate(() => moves.join() === 'g1f3,f3g5' && !board.premoves.length), `${width}px: queued follow-up is revalidated and submits on the next turn`);
    await page.evaluate(() => board.destroy());
    check(await page.locator('.piece').count() === 0 && await page.locator('.drag-piece').count() === 0, `${width}px: destroying the board releases DOM overlays`);
    await page.close();
  }
} finally { await browser.close(); }
console.log(`Play board, clocks and preferences: ${checks} checks passed.`);
