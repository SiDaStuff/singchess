// Board-grounded commentary regressions. No engine, network, or user data.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const { Chess } = require('chess.js');
const context = { window: { Chess }, Chess, console };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/chess-core.js'), 'utf8'), context);
const analyzer = new context.window.MoveAnalyzer();
const coach = analyzer.coach;
let checks = 0;
let failures = 0;
function check(name, fn) {
  try { fn(); checks++; console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
}
function explanation(fenBefore, moveSan, extra = {}) {
  return coach.explain({ fenBefore, moveSan, classification: context.window.MoveClassification.EXCELLENT, movePly: 30, ...extra });
}
const filePawn = '4q1k1/8/8/8/8/8/3P4/3Q2K1 b - - 0 1';
const capturingPawn = '4q1k1/8/8/8/8/4p3/3P4/3Q2K1 b - - 0 1';
check('Qd8: d3 and d4 keep the file blocked, no relative pin', () => {
  const text = explanation(filePawn, 'Qd8');
  assert.doesNotMatch(text, /pin|expose|significant pressure/);
  assert.match(text, /central squares d5 and d4 from d8/);
});
check('Qd8: a real off-file capture gets a concrete legal continuation', () => {
  const text = explanation(capturingPawn, 'Qd8');
  assert.match(text, /attacks the pawn on d2, with the queen on d1 behind it/);
  assert.match(text, /dxe3 allows Qxd1\+/);
  assert.match(text, /d3 keeps the line blocked/);
  assert.match(text, /does not establish a forced win/);
  assert.doesNotMatch(text, /moving the pawn .*would expose/);
});
check('an existing alignment is maintained, not newly created', () => {
  const text = explanation('6k1/3q4/8/8/8/4p3/3P4/3Q2K1 b - - 0 1', 'Qd8');
  assert.match(text, /keeps pressure on the pawn on d2/);
});
check('a pawn pinned along a file to its king can still advance on that file', () => {
  const text = explanation('4q1k1/8/8/8/8/8/3P4/3K4 b - - 0 1', 'Qd8');
  assert.match(text, /pins the pawn on d2 to the king on d1/);
  assert.match(text, /can still play d3/);
  assert.doesNotMatch(text, /cannot move without/);
  const chess = new Chess('3q2k1/8/8/8/8/8/3P4/3K4 w - - 0 2');
  assert.ok(chess.moves().includes('d3'));
});
check('a queen pinned to its own king cannot legally capture the rear queen', () => {
  assert.equal(coach._lineTacticLesson('2Rqk3/8/8/8/8/4p3/3P4/3Q2K1 w - - 0 1', 'd8', 'b', 'q'), '');
});
check('diagonal relative pin includes a legal pawn advance and capture', () => {
  const text = coach._lineTacticLesson('6k1/8/8/2b5/3P4/4Q3/8/6K1 w - - 0 1', 'c5', 'b', 'b');
  assert.match(text, /relative pin/);
  assert.match(text, /If d5, Bxe3\+ is a legal capture/);
});
check('white rook against black pawn uses the correct move direction', () => {
  const text = coach._lineTacticLesson('3q2k1/3p4/4P3/8/8/8/8/3R2K1 b - - 0 1', 'd1', 'w', 'r');
  assert.match(text, /If dxe6, Rxd8\+ is a legal capture/);
  assert.match(text, /d6 keeps the line blocked/);
});
check('friendly blockers prevent a line tactic', () => {
  assert.equal(coach._lineTacticLesson('3q2k1/8/8/3p4/8/4p3/3P4/3Q2K1 w - - 0 1', 'd8', 'b', 'q'), '');
});
check('an immobile front pawn is not described as exposing the queen', () => {
  assert.equal(coach._lineTacticLesson('3q2k1/8/8/8/8/3p4/3P4/3Q2K1 w - - 0 1', 'd8', 'b', 'q'), '');
});
check('stale supplied post-move FEN does not invent a pin', () => {
  assert.doesNotMatch(explanation(filePawn, 'Qd8', { fenAfter: '3q2k1/8/8/8/8/4p3/3P4/3Q2K1 w - - 0 2' }), /relative pin/);
});
check('invalid position or illegal recorded move produces a clear verification state', () => {
  assert.match(explanation('invalid', 'Qd8'), /cannot be verified/);
  assert.match(explanation(filePawn, 'Qd1'), /not legal/);
});
check('engine comparison is separate, named and quantified', () => {
  const text = explanation(filePawn, 'Qd8', { bestMoveSan: 'Qe7', cpLoss: 20 });
  assert.match(text, /The engine preferred Qe7;.*0\.20 pawns/);
  assert.doesNotMatch(text, /nearly as strong/);
});
check('missing comparison evidence never invents a first-choice comparison', () => {
  assert.doesNotMatch(explanation(filePawn, 'Qd8', { bestMoveSan: 'Qe7' }), /engine preferred|nearly as strong/);
});
check('fallback never asserts that a quiet king move improves safety', () => {
  const text = explanation('6k1/8/8/8/8/8/8/6K1 w - - 0 1', 'Kf1');
  assert.match(text, /king moves from g1 to f1/);
  assert.doesNotMatch(text, /improving its safety/);
});
check('a rear queen can be captured and recaptured: no claim of material won', () => {
  const text = coach._lineTacticLesson('3q2k1/8/8/8/8/4p3/3P4/3QR1K1 w - - 0 1', 'd8', 'b', 'q');
  assert.match(text, /legal capture/);
  assert.match(text, /not a forced win/);
  const chess = new Chess('3q2k1/8/8/8/8/4p3/3P4/3QR1K1 w - - 0 1');
  assert.ok(chess.move('dxe3'));
  assert.ok(chess.move('Qxd1+'));
  assert.ok(chess.move('Rxd1'));
});
check('saved-review text is regenerated from the board without rewriting scores', () => {
  const result = {
    fen: filePawn, moveSan: 'Qd8', isWhite: false, classificationKey: 'EXCELLENT',
    evalBefore: -25, evalAfter: -20, cpLoss: 5,
    coachText: 'Qd8 creates a relative pin — moving the pawn would expose the queen.',
  };
  const original = JSON.stringify(result);
  const text = analyzer.explainResult(result);
  assert.doesNotMatch(text, /relative pin/);
  assert.match(text, /from d8/);
  assert.equal(JSON.stringify(result), original);
});
// Exercise the actual AI prompt builder without an LLM, engine or database.
const overviewContext = {
  module: { exports: {} }, exports: {}, console,
  require: (name) => name === './_lib/analysis-loader'
    ? { loadChess: () => Chess } : {},
};
vm.createContext(overviewContext);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../server/api/coach-overview.js'), 'utf8'), overviewContext);
const buildPrompt = (move) => vm.runInContext('buildMovePrompt', overviewContext)(0, { results: [move] }, null);
check('AI coach receives distinct before/after boards and real legal pawn replies', () => {
  const prompt = buildPrompt({ fen: filePawn, moveSan: 'Qd8', isWhite: false, fenAfter: 'stale supplied board' });
  assert.match(prompt, /FEN BEFORE.*4q1k1/);
  assert.match(prompt, /Derived FEN AFTER.*3q2k1/);
  assert.match(prompt, /Legal opponent replies AFTER.*d3.*d4/);
  assert.doesNotMatch(prompt, /stale supplied board/);
});
check('AI coach is explicitly given a missing-context state for illegal moves', () => {
  assert.match(buildPrompt({ fen: filePawn, moveSan: 'Qd1' }), /Board context could not be verified/);
});
const suppliedGame = new Chess();
assert.ok(suppliedGame.load_pgn(fs.readFileSync(path.join(__dirname, 'fixtures/explanation-game.pgn'), 'utf8')));
const suppliedMoves = suppliedGame.history();
const replay = new Chess(), suppliedPositions = [];
for (const san of suppliedMoves) { suppliedPositions.push(replay.fen()); replay.move(san); }
check('44.Kd1 reports h1=Q# even when saved classification says EXCELLENT', () => {
  const text = explanation(suppliedPositions[86], 'Kd1', { bestMoveSan: 'Kb1', cpLoss: 0 });
  assert.match(text, /allows h1=Q#, which is checkmate/);
  assert.match(text, /Kb1, which avoids this immediate mate/);
  assert.doesNotMatch(text, /excellent|0\.00 pawns|only legal/);
});
check('truly forced check response takes precedence over an excellent grade', () => {
  assert.match(explanation('r7/8/8/8/8/2k5/8/K7 w - - 0 1', 'Kb1'), /only legal move to get out of check/);
});
check('checkmate is never described as a blunder even with stale classification', () => {
  assert.match(explanation(suppliedPositions[87], 'h1=Q#', { classification: context.window.MoveClassification.BLUNDER }), /is checkmate/);
  assert.doesNotMatch(explanation(suppliedPositions[87], 'h1=Q#', { classification: context.window.MoveClassification.BLUNDER }), /blunder|material cost/);
});
check('37.Bb2 explains promotion and the alternative bishop attack on g3', () => {
  const text = explanation(suppliedPositions[72], 'Bb2', {
    classification: context.window.MoveClassification.BLUNDER, playerEdgeBefore: -130, playerEdgeAfter: -400,
    bestMoveSan: 'Bd6', bestMove: 'a3d6', opponentBestMove: 'h3h2',
    opponentPvSan: 'h2 c4+ Kg6 Nd5 h1=Q Bc3',
    bestMovePvSan: 'Bd6 h2 Re7 h1=Q Bxg3 Qa1',
  });
  assert.match(text, /h1=Q, the pawn promotes to a queen/);
  assert.match(text, /rook on g3/);
  const variants = analyzer.explanationVariations({ fen: suppliedPositions[72], moveSan: 'Bb2', bestMovePvSan: 'Bd6 h2 Re7 h1=Q Bxg3 Qa1' });
  assert.ok(variants.some(line => /Bd6 h2 Re7 h1=Q Bxg3/.test(line.text)));
  assert.doesNotMatch(text, /Tough position|Worth filing/);
});
check('40…Rf3 identifies Rd6 as a reply and shows the promotion alternative', () => {
  const text = explanation(suppliedPositions[79], 'Rf3', {
    classification: context.window.MoveClassification.MISTAKE, bestMoveSan: 'h1=Q', bestMove: 'h2h1q', opponentBestMove: 'c6d6',
  });
  assert.match(text, /After this move, Rd6/);
  assert.match(text, /pawn on f6/);
  assert.match(text, /Better was h1=Q/);
});
const opera = new Chess();
assert.ok(opera.load_pgn(fs.readFileSync(path.join(__dirname, 'fixtures/opera-game.pgn'), 'utf8')));
const operaReplay = new Chess(), operaPositions = [];
for (const move of opera.history()) { operaPositions.push(operaReplay.fen()); operaReplay.move(move); }
check('Opera Rxd7 names the offered rook, acceptance and queen compensation', () => {
  const text = explanation(operaPositions[24], 'Rxd7', {
    classification: context.window.MoveClassification.BRILLIANT,
    opponentPvSan: 'Nxd7 Bxe7 Bxe7 Bxd7+ Kxd7',
  });
  assert.match(text, /captures the knight on d7 and offers the rook on d7/);
  assert.match(text, /after Nxd7, Bxe7 captures the queen on e7/);
  assert.doesNotMatch(text, /bait|decisive attack|struggle|creative|hard-to-find/);
});
check('Brilliant sacrifice without a recorded line does not invent compensation', () => {
  const text = explanation(operaPositions[24], 'Rxd7', { classification: context.window.MoveClassification.BRILLIANT });
  assert.match(text, /no continuation was saved/);
  assert.doesNotMatch(text, /decisive|forced win|fuel/);
});
check('Best-line data supplies the sacrifice follow-up when opponent PV is absent', () => {
  const text = explanation(operaPositions[24], 'Rxd7', {
    classification: context.window.MoveClassification.BRILLIANT,
    bestMovePvSan: 'Rxd7 Nxd7 Bxe7 Bxe7 Bxd7+ Kxd7',
  });
  assert.match(text, /after Nxd7, Bxe7 captures the queen on e7/);
  assert.doesNotMatch(text, /no continuation was saved/);
});
check('cxb5 describes the material gain without claiming the exchange itself loses', () => {
  const text = explanation(operaPositions[19], 'cxb5', {
    classification: context.window.MoveClassification.MISTAKE,
    bestMoveSan: 'Qb4+', bestMove: 'e7b4', opponentBestMove: 'c4b5',
    opponentPvSan: 'Bxb5+ Nbd7 O-O-O Qe6 Bxf6 gxf6',
    bestMovePvSan: 'Qb4+ Qxb4 Bxb4+ c3 cxb5 Bxb5+',
  });
  assert.match(text, /gain of 2 material points/);
  assert.match(text, /checks the king on e1 while attacking the queen on b3/);
  assert.match(text, /queen can be captured with Qxb4/);
  assert.doesNotMatch(text, /resulting position is still worse|creates a fork/);
});
check('every nonterminal classification can show a validated continuation', () => {
  for (const key of ['BRILLIANT', 'GREAT', 'BEST', 'EXCELLENT', 'GOOD', 'BOOK', 'INACCURACY', 'MISTAKE', 'BLUNDER', 'MISS']) {
    const text = explanation(operaPositions[19], 'cxb5', {
      classification: context.window.MoveClassification[key],
      opponentPvSan: 'Bxb5+ Nbd7 O-O-O', bestMoveSan: 'Qb4+', bestMove: 'e7b4',
    });
    const variants = analyzer.explanationVariations({ fen: operaPositions[19], moveSan: 'cxb5', opponentPvSan: 'Bxb5+ Nbd7 O-O-O' });
    assert.ok(variants.some(line => /engine line is Bxb5\+ Nbd7 O-O-O/.test(line.text)), key);
    assert.doesNotMatch(text, /After the played move, the engine line is/, key);
    assert.doesNotMatch(text, /deep and creative|crushing one|dramatically shifts|stood the test/, key);
  }
});
check('Bb6 explains the recorded doubled pawns without a hypothetical queen capture', () => {
  const fen = 'rnbqk2r/ppp2ppp/3p1n2/2b5/4N3/2N2Q2/PPP2PPP/R1B1KB1R b KQkq - 0 1';
  const text = explanation(fen, 'Bb6', {
    classification: context.window.MoveClassification.BLUNDER, bestMoveSan: 'Qe7', bestMove: 'd8e7', opponentBestMove: 'c1g5',
    opponentPvSan: 'Bg5 Qe7 Bxf6 gxf6 O-O-O f5 Nd2 Be6',
    bestMovePvSan: 'Qe7 Bd3 Bg4 Qf4 O-O Kf1 Nxe4 Qxe4',
  });
  assert.match(text, /Bg5 attacks the knight on f6, with the queen on d8 behind it/);
  assert.match(text, /Bg5 Qe7 Bxf6 gxf6 leaves your pawns doubled on f7 and f6|Bg5 Qe7 Bxf6 gxf6 leaves your pawns doubled on f6 and f7/);
  assert.match(text, /Better was Qe7\. It pins the knight on e4 to the king on e1/);
  assert.doesNotMatch(text, /Nd7|Bxd8|relative pin|legal capture of that queen|Compare the engine line/);
});
check('analysis must match the displayed position, including legal rights', () => {
  const result = { fen: operaPositions[19], moveSan: 'cxb5' };
  const board = new Chess(result.fen); board.move(result.moveSan);
  assert.ok(analyzer.matchesExplanationPosition(result, board.fen()));
  assert.ok(analyzer.matchesExplanationPosition(result, board.fen().replace(/\d+ \d+$/, '99 99')));
  assert.equal(analyzer.matchesExplanationPosition(result, suppliedPositions[79]), false);
  assert.equal(analyzer.matchesExplanationPosition({ fen: 'invalid', moveSan: 'Bb6' }, board.fen()), false);
  const latest = new Chess();
  assert.ok(latest.load_pgn(fs.readFileSync(path.join(__dirname, 'fixtures/oct14-game.pgn'), 'utf8')));
  assert.ok(!latest.history().includes('Bb6'), 'the submitted game does not contain Bb6');
  assert.ok(latest.in_checkmate());
  assert.equal(analyzer.matchesExplanationPosition(result, latest.fen()), false);
});
console.log(`${checks} move explanation checks passed.`);
process.exitCode = failures ? 1 : 0;
