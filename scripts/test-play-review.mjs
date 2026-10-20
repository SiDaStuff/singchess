// Deterministic Play integration checks. No provider account or real game is
// used; active games and OAuth-authenticated status responses are fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { Chess } from 'chess.js';
import { createFairPlayGuard } from '../src/play/fair-play.js';

let checks = 0;
const test = async (name, run) => { await run(); checks++; console.log(`PASS ${name}`); };
class CustomEvent extends Event { constructor(type, options = {}) { super(type); this.detail = options.detail; } }
function fixture(saved = []) {
  const host = new EventTarget(), data = new Map();
  if (saved.length) data.set('singchess.play.activeGames', JSON.stringify(saved));
  host.CustomEvent = CustomEvent;
  host.localStorage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  host.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const states = [], app = { authState: { initialized: true, user: null }, _applyPlayFairPlay: state => states.push(state) };
  const guard = createFairPlayGuard(host);
  guard.attachApp(app);
  return { host, app, guard, data, states };
}
const signedIn = app => { app.authState.user = { uid: 'fixture-user', getIdToken: async () => 'fixture-token' }; };
const response = status => ({ ok: true, json: async () => status });

await test('guest analysis unlocks only after initial authentication resolves', async () => {
  const { app, guard } = fixture();
  app.authState.initialized = false;
  assert.equal(await guard.verify(), false);
  app.authState.initialized = true;
  assert.equal(await guard.onAuth(), true);
  assert.equal(guard.isBlocked(), false);
});
await test('unfinished game latch survives refresh and signing out', async () => {
  const { guard } = fixture(['abcdefgh']);
  assert.equal(guard.isBlocked(), true);
  assert.equal(await guard.verify(), false);
  await assert.rejects(guard.assertCanAnalyze(), error => error.code === 'live_game_fair_play');
});
await test('active-game verification carries account authentication and coalesces requests', async () => {
  const { guard, host, app } = fixture(); signedIn(app);
  let requests = 0, resolve;
  host.apiFetch = async (path, options) => {
    requests++;
    assert.equal(path, '/api/play/active');
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    return new Promise(done => { resolve = done; });
  };
  const first = guard.verify({ force: true }), second = guard.verify({ force: true });
  await Promise.resolve();
  assert.equal(requests, 1);
  resolve(response({ connected: true, activeGames: [{ gameId: 'abcdefgh' }] }));
  assert.equal(await first, false); assert.equal(await second, false);
  assert.deepEqual(guard.snapshot().activeGames, ['abcdefgh']);
});
await test('stream interruptions and failed status checks retain fair-play protection', async () => {
  const { guard, host, app } = fixture(['abcdefgh']); signedIn(app);
  host.apiFetch = async () => { throw new Error('network offline'); };
  assert.equal(await guard.verify({ force: true }), false);
  assert.deepEqual(guard.snapshot().activeGames, ['abcdefgh']);
  assert.equal(guard.snapshot().verified, false);
});
await test('stored PGN review remains available after an account was disconnected', async () => {
  const { guard, host, app } = fixture(); signedIn(app);
  guard.observeStatus({ connected: false, activeGames: [] });
  host.apiFetch = async () => { throw new Error('provider unavailable'); };
  assert.equal(await guard.verify({ force: true }), true);
  assert.equal(guard.isBlocked(), false);
});
await test('authoritative completion releases the latch and preserves unrelated saved data', async () => {
  const { guard, host, app, data } = fixture(['abcdefgh']); signedIn(app);
  data.set('sidastuff.coachChats.fixture-user', 'saved chat');
  host.apiFetch = async () => response({ connected: true, activeGames: [] });
  assert.equal(await guard.verify({ force: true }), true);
  assert.equal(data.has('singchess.play.activeGames'), false);
  assert.equal(data.get('sidastuff.coachChats.fixture-user'), 'saved chat');
});
await test('a delayed empty status cannot overwrite a newer game-start event', async () => {
  const { guard, host, app } = fixture(); signedIn(app);
  let resolve;
  host.apiFetch = () => new Promise(done => { resolve = done; });
  const pending = guard.verify({ force: true }); await Promise.resolve();
  guard.setActiveGames([{ id: 'newgame1' }]);
  resolve(response({ connected: true, activeGames: [] }));
  assert.equal(await pending, false);
  assert.deepEqual(guard.snapshot().activeGames, ['newgame1']);
});
await test('cross-tab game events pause engines before requesting fresh provider state', async () => {
  const { guard, host, app } = fixture(); signedIn(app);
  guard.observeStatus({ connected: true, activeGames: [] });
  let interrupted = 0;
  guard.registerEngine({ interrupt() { interrupted++; } });
  host.apiFetch = async () => response({ connected: true, activeGames: [{ id: 'abcdefgh' }] });
  const event = new Event('storage');
  Object.assign(event, { key: 'singchess.play.activeGames', newValue: '["abcdefgh"]' });
  host.dispatchEvent(event);
  assert.equal(guard.isBlocked(), true); assert.ok(interrupted > 0);
  await guard.verify();
  assert.equal(guard.isBlocked(), true);
});

const appSource = (await fs.readFile(new URL('../src/app.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const engineSource = (await fs.readFile(new URL('../src/engine.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const bodyClasses = new Set(['play-focus-mode']);
const host = Object.assign(new EventTarget(), { CustomEvent, location: { pathname: '/play' },
  history: { pushState() {}, replaceState() {} }, __API_BASE: '' });
const context = { Chess, console, window: host, CustomEvent, setTimeout, clearTimeout, onReady() {},
  document: { title: '', addEventListener() {}, body: { dataset: {}, classList: { remove: name => bodyClasses.delete(name) } } } };
vm.createContext(context);
vm.runInContext(await fs.readFile(new URL('../src/chess-core.js', import.meta.url), 'utf8'), context);
vm.runInContext(`${appSource}\nwindow.ChessReviewApp = ChessReviewApp;`, context);
vm.runInContext(engineSource, context);
const App = host.ChessReviewApp;

await test('Play and OAuth callback are recognized routes with their own page', () => {
  const app = Object.create(App.prototype), shown = [], events = [];
  Object.assign(app, { liveEvalToken: 0, liveDepthToken: 0,
    _closeMobileNav() {}, _trackPageView() {}, _stopReviewPlayback() {}, _enterInAppLayout() {},
    _showRoutePage: name => shown.push(name), _updateNavActiveState() {} });
  host.addEventListener('play:route', event => events.push(event.detail.route));
  assert.equal(app._isKnownAppRoute('/play'), true);
  assert.equal(app._isKnownAppRoute('/play/callback'), true);
  app._applyRoute('/play/callback', { skipHistory: true });
  assert.deepEqual(shown, ['play']); assert.deepEqual(events, ['/play/callback']);
  app._applyRoute('/settings', { skipHistory: true });
  assert.equal(bodyClasses.has('play-focus-mode'), false);
});
const pgn = '[Event "Play game"]\n[Site "https://lichess.org/abcdefgh"]\n[White "Player"]\n[Black "Opponent"]\n[Result "1-0"]\n[TimeControl "600+5"]\n\n1. e4 {[%clk 0:10:04]} e5 {[%clk 0:10:03]} 2. Nf3 {[%clk 0:10:06]} Nc6 {[%clk 0:10:05]} 3. Bb5 {[%clk 0:10:08]} a6 {[%clk 0:10:07]} 1-0';
await test('real PGN import retains the entire game, players, result and clocks', () => {
  const app = Object.create(App.prototype);
  let loaded;
  app._loadGame = (moves, headers) => { loaded = { moves, headers }; };
  app._loadPgnText(pgn);
  assert.deepEqual(Array.from(loaded.moves), ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
  assert.equal(loaded.headers.White, 'Player'); assert.equal(loaded.headers.Black, 'Opponent');
  assert.equal(loaded.headers.Result, '1-0'); assert.equal(loaded.headers.TimeControl, '600+5');
  assert.deepEqual(Array.from(loaded.headers._gameClockHistory), [1, 2, 3, 3, 3, 3]);
  assert.equal(loaded.headers._initialClocks.white, 600);
  assert.equal(loaded.headers._gameClockRemainingHistory.at(-1).white, 608);
  assert.equal(loaded.headers._gameClockRemainingHistory.at(-1).black, 607);
});
await test('completed Play review uses existing import, orientation and engine review', async () => {
  const app = Object.create(App.prototype), calls = [];
  Object.assign(app, { authState: { user: null }, engineSettings: { analysisLocation: 'browser' }, engine: { ready: true },
    _navigateTo: (route, options) => calls.push(['route', route, options.skipImport]),
    _loadPgnText(value) { calls.push(['pgn', value]); this.gameMoves = new Chess().load_pgn(value) ? ['e4'] : []; },
    _setBoardOrientationForColor: color => calls.push(['orientation', color]), _hidePgnModal() {},
    _goToMove: index => calls.push(['move', index]), _startReview: async () => calls.push(['review']) });
  assert.equal(await app.openPlayReview({ pgn, gameId: 'abcdefgh', orientation: 'black' }), true);
  assert.deepEqual(calls[0], ['route', '/review', true]);
  assert.ok(calls.some(call => call[0] === 'orientation' && call[1] === 'b'));
  assert.ok(calls.some(call => call[0] === 'review'));
  const before = calls.length;
  await assert.rejects(app.openPlayReview({ pgn: pgn.replaceAll('1-0', '*') }), /after the game has finished/);
  assert.equal(calls.length, before, 'unfinished PGN cannot replace a loaded review');
});
await test('review cursor reaches every imported move and returns to the start', () => {
  const app = Object.create(App.prototype), chess = new Chess(); chess.load_pgn(pgn);
  Object.assign(app, { gameMoves: chess.history(), initialFen: new Chess().fen(), currentMoveIndex: -1,
    activeLine: { kind: 'main', index: -1 }, liveEvalToken: 0, liveMoveResults: [],
    board: { setChessInstance() {}, animateNextUpdate() {}, setHighlights() {}, clearBestMoveArrow() {} },
    elMoveBadge: { style: {} }, _moveHighlightsForSquares: () => [], _isCoachMoveIndex: () => false,
    _mixColor: () => '#000' });
  for (const method of ['_updateBoard', '_cancelLiveDeepening', '_renderIdleEngineInfo', '_resetInsightPanel',
    '_playMoveSound', '_requestLiveEvaluation', '_updateLiveEvalPanel', '_updateGameStatus', '_updateActiveMoveInList',
    '_updateCurrentMoveIndicator', '_updateClockDisplays', '_saveGameState']) app[method] = () => {};
  const expected = new Chess();
  for (let index = 0; index < app.gameMoves.length; index++) {
    expected.move(app.gameMoves[index]); app._goToMove(index);
    assert.equal(app.currentMoveIndex, index); assert.equal(app.chess.fen(), expected.fen());
  }
  app._goToMove(-1); assert.equal(app.chess.fen(), new Chess().fen());
});
await test('an aborted zero-move game imports without inventing moves or starting analysis', async () => {
  const app = Object.create(App.prototype), aborted = new Chess();
  aborted.header('Event', 'Casual game', 'Result', '*', 'Termination', 'aborted');
  const serialized = aborted.pgn();
  Object.assign(app, { _navigateTo() {}, _setBoardOrientationForColor() {}, _hidePgnModal() {}, _goToMove() {},
    _loadGame(moves, headers) { this.gameMoves = moves; this.gameHeaders = headers; },
    _startReview() { throw new Error('Empty games need no engine analysis'); } });
  assert.equal(await app.openPlayReview({ pgn: serialized, gameId: 'abcdefgh' }), true);
  assert.equal(app.gameMoves.length, 0); assert.equal(app.gameHeaders.Termination, 'aborted');
});
await test('all browser engine search modes reject while a live game is latched', async () => {
  const { guard } = fixture(['abcdefgh']); host.PlayFairPlay = guard;
  const engine = new host.UciEngine({}); engine.ready = true;
  for (const method of ['evaluate', 'evaluateMultiPV', 'evaluateInfinite']) {
    await assert.rejects(engine[method](new Chess().fen()), error => error.code === 'live_game_fair_play');
  }
  let sent = false;
  const browser = new host.BrowserStockfishEngine({}); browser.worker = { postMessage() { sent = true; } };
  assert.throws(() => browser._send('go infinite'), /Analysis is paused/);
  assert.equal(sent, false); assert.equal(browser._searchRunning, false);
  assert.equal(guard.isBlocked(), true);
});
await test('live game blocks review, hints and coach without altering local game moves', async () => {
  const app = Object.create(App.prototype), moves = ['e4', 'e5'];
  app.gameMoves = moves;
  await app._startReview(); await app._handleCoachHint(); await app._startCoachGame();
  app._showPuzzleHint(); app._exploreLineFromCurrentMove();
  assert.deepEqual(app.gameMoves, moves);
  assert.deepEqual(Array.from(app._moveHighlightsForResult({ moveUci: 'e2e4' })), []);
});
console.log(`Play review and fair-play checks passed: ${checks}`);
