// Engine context regressions. All searches and APIs are local deterministic
// fixtures; no account credentials, database, native engine, or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Chess } = require('chess.js');
const root = path.resolve(__dirname, '..');
const appContext = { Chess, console, window: { Chess }, document: { addEventListener() {}, hidden: false }, setTimeout, clearTimeout };
vm.createContext(appContext);
vm.runInContext(fs.readFileSync(path.join(root, 'src/chess-core.js'), 'utf8'), appContext);
const appSource = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8').replace(/^import .*;\r?\n/gm, '');
vm.runInContext(`${appSource}\nwindow.ChessReviewApp = ChessReviewApp;`, appContext);
const { MoveAnalyzer, ChessReviewApp } = appContext.window;
let count = 0;
async function test(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
function fixture(fen, san) {
  const board = new Chess(fen);
  const move = board.move(san);
  assert.ok(move, `${san} fixture is legal`);
  const app = Object.create(ChessReviewApp.prototype);
  Object.assign(app, { analyzer: new MoveAnalyzer(), chess: board, currentMoveIndex: 0, liveMoveResults: [], gameHeaders: {}, _getReviewProfile: () => ({ depth: 12, multiPv: 2, timeoutMs: 2000 }) });
  return { app, context: { fenBefore: fen, fenAfter: board.fen(), moveObj: move, moveIndex: 0 } };
}
function line(score, pv) { return { score, scoreType: 'cp', pv, depth: 12 }; }
function engineFor(context, before, after) {
  return { ready: true, interrupt() {}, async evaluate(fen) { const best = (fen === context.fenBefore ? before : after)[0]; return { ...best, bestMove: best.pv.split(' ')[0] }; }, async evaluateMultiPV(fen) { return { lines: fen === context.fenBefore ? before : after }; } };
}

(async () => {
  await test('review sorting selects Black lowest White eval, without mutating input', () => {
    const app = Object.create(ChessReviewApp.prototype);
    const lines = [{ cp: -40, move: 'c7c5' }, { cp: -80, move: 'e7e5' }];
    assert.equal(app._orderWhiteAbsoluteLines(lines, false)[0].move, 'e7e5');
    assert.equal(app._orderWhiteAbsoluteLines(lines, true)[0].move, 'c7c5');
    assert.equal(lines[0].move, 'c7c5');
    assert.equal(app._lineDropForSide({ cp: 80 }, { cp: 40 }, false), 40);
  });
  await test('live Black move and strongest White reply retain correct score signs', async () => {
    const initial = new Chess(); initial.move('e4');
    const { app, context } = fixture(initial.fen(), 'e5');
    const before = [line(40, 'c7c5 g1f3'), line(80, 'e7e5 g1f3')];
    const after = [line(-130, 'b1c3 b8c6'), line(-80, 'g1f3 b8c6')];
    app.engine = engineFor(context, before, after);
    app._searchToDepth = async fen => ({ multi: await app.engine.evaluateMultiPV(fen), depthReached: 12 });
    app._verifyPositionEval = async () => null;
    const result = await app._analyzeMoveAtDepth(context, 12, 2, 2000);
    assert.equal(result.bestMove, 'e7e5'); assert.equal(result.opponentBestMove, 'g1f3');
    assert.equal(result.evalBefore, -80); assert.equal(result.evalAfter, -80);
    assert.equal(result.opponentPv, 'g1f3 b8c6');
    assert.equal(app.liveMoveResults.length, 0, 'computation has no cache side effect');
  });
  await test('live White move picks strongest Black defense rather than weakest', async () => {
    const { app, context } = fixture(new Chess().fen(), 'e4');
    const before = [line(20, 'd2d4 d7d5'), line(30, 'e2e4 e7e5')];
    const after = [line(-70, 'c7c5 g1f3'), line(-30, 'e7e5 g1f3')];
    app.engine = engineFor(context, before, after);
    app._searchToDepth = async fen => ({ multi: await app.engine.evaluateMultiPV(fen), depthReached: 12 });
    app._verifyPositionEval = async () => null;
    const result = await app._analyzeMoveAtDepth(context, 12, 2, 2000);
    assert.equal(result.bestMove, 'e2e4'); assert.equal(result.opponentBestMove, 'e7e5');
    assert.equal(result.evalAfter, 30); assert.equal(result.cpLoss, 0);
  });
  await test('subline results preserve both legal UCI continuations and Black choice', async () => {
    const initial = new Chess(); initial.move('e4');
    const { app, context } = fixture(initial.fen(), 'e5');
    app.engine = engineFor(context, [line(40, 'c7c5 g1f3'), line(80, 'e7e5 g1f3')], [line(-130, 'b1c3 b8c6'), line(-80, 'g1f3 b8c6')]);
    const result = await app._buildSubLineResult({ ...context, depth: 12, multiPv: 2, timeoutMs: 2000 });
    assert.equal(result.bestMove, 'e7e5'); assert.equal(result.opponentBestMove, 'g1f3');
    assert.equal(result.bestMovePv, 'e7e5 g1f3'); assert.equal(result.opponentPv, 'g1f3 b8c6');
    assert.equal(app.analyzer.matchesExplanationPosition(result, context.fenAfter), true);
  });
  await test('navigating during a live search prevents stale cache and UI writes', async () => {
    const { app, context } = fixture(new Chess().fen(), 'e4');
    let release;
    const waiting = new Promise(resolve => { release = resolve; });
    app.puzzleMode = { active: false }; app.engine = { ready: true, interrupt() {} };
    app.engineSettings = {}; app.liveEvalToken = 0; app.liveDepthToken = 0;
    app.board = { setLoading() {} }; app._updateLiveEvalPanel = () => {};
    app._analyzeMoveAtDepth = async () => { await waiting; return { moveIndex: 0, fen: context.fenBefore, fenAfter: context.fenAfter }; };
    const request = app._requestLiveEvaluation('Testing', context);
    app.chess.move('e5'); release();
    assert.equal(await request, undefined);
    assert.equal(app.liveMoveResults.length, 0);
  });

  const serverContext = { console, exports: {}, process: { env: {} }, setTimeout, clearTimeout,
    require: name => name === 'crypto' ? require('node:crypto') : name.endsWith('stockfish-engine') ? { detectThreadCount: () => 1 } : {} };
  vm.createContext(serverContext);
  vm.runInContext(`${fs.readFileSync(path.join(root, 'server/api/analyze.js'), 'utf8')}\nglobalThis.internals = { cachedEngineAdapter, _evaluateProgressiveReview };`, serverContext);
  await test('server cache separates search mode, movetime budget and timeout', async () => {
    let searches = 0;
    const adapter = serverContext.internals.cachedEngineAdapter({ ready: true, async evaluateMultiPV() { return { count: ++searches }; }, async evaluate() { return { count: ++searches }; } });
    const query = (budget, timeout = 4000, mode = 'depth+movetime') => adapter.evaluateMultiPV('fixture-fen', 12, 2, timeout, { mode, movetimeMs: budget });
    assert.equal((await query(150)).count, 1); assert.equal((await query(150)).count, 1);
    assert.equal((await query(600)).count, 2); assert.equal((await query(600, 8000)).count, 3);
    assert.equal((await query(600, 8000, 'movetime')).count, 4);
    const cp = await adapter.evaluate('fixture-fen', 12, 4000, { mode: 'depth+movetime', movetimeMs: 150 });
    assert.equal(cp.count, 5);
  });
  await test('progressive server reviews retain final post-game eval and side-relative scores', async () => {
    const analyzer = new MoveAnalyzer();
    analyzer.evaluatePositionsPooled = async positions => positions.map(fen => ({ cp: fen.split(' ')[1] === 'w' ? 45 : 80, bestMove: '', lines: [] }));
    const positions = analyzer._positionsForMoves(['e4', 'e5', 'Nf3']);
    const spec = { depth: 12, multiPv: 2, timeoutMs: 4000 };
    const evals = await serverContext.internals._evaluateProgressiveReview({ analyzer, engines: [], moves: ['e4', 'e5', 'Nf3'], baseProfile: { quickScan: spec, mid: spec, deep: spec } });
    assert.equal(evals.length, positions.length);
    assert.equal(evals[1].cp, 80); assert.equal(evals.at(-1).cp, 80);
    assert.equal(analyzer.whiteAbsCp(evals[1].cp, positions[1]), -80);
  });
  await test('server analyzer loads the shared tactics module in its chess realm', () => {
    const loaded = require('../server/api/_lib/analysis-loader').loadAnalyzer();
    assert.equal(typeof loaded.MoveAnalyzer, 'function');
    assert.equal(typeof loaded.TacticsCoach, 'function');
    const coach = new loaded.TacticsCoach(Chess);
    assert.ok(coach);
  });
  console.log(`Analysis context checks passed: ${count}`);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
