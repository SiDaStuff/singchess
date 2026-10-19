// Curated deterministic facts. No Stockfish process, network or user data.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const { Chess } = require('chess.js');
const context = { window: { Chess }, Chess, console };
vm.createContext(context);
for (const file of ['chess-core.js', 'tactics-coach.js', 'tactics-advanced.js']) {
  const location = path.join(__dirname, '../src', file);
  if (fs.existsSync(location)) vm.runInContext(fs.readFileSync(location, 'utf8'), context, { filename: file });
}
const analyzer = new context.window.MoveAnalyzer();
const coach = new context.window.TacticsCoach(analyzer, Chess);
let failures = 0, checks = 0;
function check(name, fn) {
  try { fn(); checks++; console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}
function lesson(fen, move, extra = {}) {
  return coach.analyze({ fen, moveSan: move, classificationKey: 'GOOD', isWhite: fen.split(' ')[1] === 'w', ...extra });
}
function motif(model, type, phase = 'played') {
  return [...model.motifs, ...model.threats, ...(model.better?.motifs || [])].find(fact => fact.type === type && fact.phase === phase);
}
function verifyCoordinates(model) {
  for (const fact of [...model.motifs, ...model.threats, ...(model.better?.motifs || [])]) {
    assert.ok(new Chess().load(fact.fen));
    for (const item of fact.arrows) { assert.match(item.from, /^[a-h][1-8]$/); assert.match(item.to, /^[a-h][1-8]$/); assert.notEqual(item.from, item.to); assert.ok(['suggestion', 'threat', 'tactic', 'defense'].includes(item.role)); }
    for (const item of fact.highlights) assert.match(item.square, /^[a-h][1-8]$/);
  }
  for (const variation of model.variations) {
    const board = new Chess(variation.startFen);
    for (const move of variation.moves) {
      assert.equal(board.fen(), move.beforeFen);
      assert.equal(move.forced, board.moves().length === 1);
      assert.ok(board.move(move.san));
      assert.equal(board.fen(), move.fen);
    }
    for (const step of variation.steps) assert.ok(new Chess().load(step.fen));
  }
}
check('a knight fork gives exact targets without promising a forced win', () => {
  const model = lesson('4k1r1/8/8/3N4/8/8/8/K7 w - - 0 1', 'Nf6+');
  const fact = motif(model, 'fork'); assert.ok(fact);
  assert.equal(fact.arrows.length, 2);
  assert.ok(fact.arrows.some(item => item.from === 'f6' && item.to === 'e8'));
  assert.ok(fact.arrows.some(item => item.from === 'f6' && item.to === 'g8'));
  assert.match(fact.verification.detail, /does not by itself prove/);
  const demo = model.variations.find(variation => variation.id === 'played');
  assert.equal(demo.steps[0].fen, model.fenBefore);
  assert.equal(demo.steps[1].fen, model.fenAfter);
  assert.ok(demo.steps[1].arrows.some(item => item.from === 'f6' && item.to === 'g8'));
  verifyCoordinates(model);
});
check('absolute pin names the pinned knight and king', () => {
  const model = lesson('4k3/8/2n5/8/B7/8/8/4K3 w - - 0 1', 'Bb5');
  const pin = motif(model, 'absolute-pin'); assert.ok(pin);
  assert.match(pin.explanation, /knight on c6.*king on e8/);
  assert.ok(pin.arrows.some(item => item.from === 'b5' && item.to === 'c6'));
  const after = new Chess(model.fenAfter);
  assert.equal(after.moves({ verbose: true }).filter(move => move.from === 'c6').length, 0);
  verifyCoordinates(model);
});
check('a file-pinned pawn can still advance on the pin line', () => {
  const model = lesson('4q1k1/8/8/8/8/8/3P4/3K4 b - - 0 1', 'Qd8');
  assert.match(motif(model, 'absolute-pin').explanation, /can still play d3/);
  assert.ok(new Chess(model.fenAfter).moves().includes('d3'));
});
check('relative pin has a verified legal exposing move and no forced-loss claim', () => {
  const model = lesson('4q1k1/8/2n5/8/B7/8/8/K7 w - - 0 1', 'Bb5');
  const pin = motif(model, 'relative-pin'); assert.ok(pin);
  assert.match(pin.explanation, /knight on c6.*queen on e8/);
  assert.match(pin.verification.detail, /not automatically losing/);
  verifyCoordinates(model);
});
check('a pawn that can only keep blocking a file is not called relatively pinned', () => {
  const model = lesson('4q1k1/8/8/8/8/8/3P4/3Q2K1 b - - 0 1', 'Qd8');
  assert.equal(motif(model, 'relative-pin'), undefined);
});
check('friendly blockers prevent pin recognition', () => {
  const model = lesson('4k3/3N4/2n5/8/B7/8/8/4K3 w - - 0 1', 'Bb5');
  assert.equal(motif(model, 'absolute-pin'), undefined);
});
check('a king and rook skewer is an alignment with a legal example, not guaranteed material', () => {
  const model = lesson('r7/8/k7/8/8/8/8/4R2K w - - 0 1', 'Ra1+');
  const skewer = motif(model, 'skewer'); assert.ok(skewer);
  assert.match(skewer.explanation, /king on a6.*rook on a8/);
  assert.match(skewer.verification.detail, /does not prove that every defense loses/);
  verifyCoordinates(model);
});
check('discovered attack clears the exact blocking square', () => {
  const model = lesson('7k/8/8/4q3/8/2N5/1B6/K7 w - - 0 1', 'Ne4');
  const discovery = motif(model, 'discovered-attack'); assert.ok(discovery);
  assert.ok(discovery.arrows.some(item => item.from === 'b2' && item.to === 'e5'));
  assert.ok(discovery.highlights.some(item => item.square === 'c3'));
  verifyCoordinates(model);
});
check('discovered and double check can coexist', () => {
  const model = lesson('4k3/8/8/8/8/8/4B3/4R2K w - - 0 1', 'Bb5+');
  assert.ok(motif(model, 'discovered-check'));
  const doubleCheck = motif(model, 'double-check'); assert.ok(doubleCheck);
  assert.equal(doubleCheck.arrows.length, 2);
  assert.ok(doubleCheck.arrows.every(item => item.to === 'e8'));
  verifyCoordinates(model);
});
check('removing a defender names the piece it actually defended', () => {
  const model = lesson('7k/6b1/4N3/8/3r4/2B5/8/K7 w - - 0 1', 'Nxg7');
  const removal = motif(model, 'removing-defender'); assert.ok(removal);
  assert.match(removal.explanation, /bishop.*rook on d4/);
  assert.match(removal.verification.detail, /opponent has a turn to respond/);
  verifyCoordinates(model);
});
check('back-rank mate is verified as terminal, not inferred from an evaluation', () => {
  const model = lesson('6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', 'Re8#');
  assert.ok(motif(model, 'checkmate'));
  assert.ok(motif(model, 'back-rank-mate'));
  assert.equal(model.move.mate, true);
  assert.equal(model.threats.length, 0);
  verifyCoordinates(model);
});
check('smothered mate requires the king surrounded by its own pieces', () => {
  const model = lesson('6rk/6pp/3N4/8/8/8/8/K7 w - - 0 1', 'Nf7#');
  assert.ok(motif(model, 'smothered-mate'));
  assert.ok(new Chess(model.fenAfter).in_checkmate());
  verifyCoordinates(model);
});
check('ordinary knight development has a factual explanation and playable move', () => {
  const model = lesson(new Chess().fen(), 'Nf3');
  assert.ok(motif(model, 'development'));
  assert.equal(motif(model, 'fork'), undefined);
  assert.equal(model.variations[0].moves.length, 1);
  assert.equal(model.variations[0].source, 'board');
  assert.equal(model.explanation, analyzer.explainResult({ fen: new Chess().fen(), moveSan: 'Nf3', classificationKey: 'GOOD', isWhite: true }));
});
check('the engine alternative gets a legal single-move demo without a supplied PV', () => {
  const model = lesson(new Chess().fen(), 'a3', { bestMoveSan: 'Nf3', cpLoss: 10 });
  assert.equal(model.better.move.san, 'Nf3');
  assert.ok(model.better.motifs.some(fact => fact.type === 'development'));
  const alternative = model.variations.find(variation => variation.id === 'best');
  assert.equal(alternative.moves.length, 1);
  assert.equal(alternative.source, 'board');
  verifyCoordinates(model);
});
check('a missed fork is shown in the alternative, not attributed to the played move', () => {
  const model = lesson('4k1r1/8/8/3N4/8/8/8/K7 w - - 0 1', 'Nb4', { classificationKey: 'MISS', bestMoveSan: 'Nf6+', bestMovePvSan: 'Nf6+ Kf7 Nxg8 Kxg8' });
  assert.equal(motif(model, 'fork'), undefined);
  assert.ok(motif(model, 'fork', 'alternative'));
  assert.equal(model.variations.find(variation => variation.id === 'best').moves.length, 4);
  verifyCoordinates(model);
});
check('a fork that is answered by a pawn capture is not described as winning', () => {
  const model = lesson('4k1r1/4p3/8/3N4/8/8/8/K7 w - - 0 1', 'Nf6+', { classificationKey: 'BLUNDER', opponentPvSan: 'exf6' });
  const fork = motif(model, 'fork'); assert.ok(fork);
  assert.match(fork.explanation, /exf6.*capturing the attacker/);
  assert.doesNotMatch(fork.explanation, /wins|forced|decisive/);
  assert.ok(model.threats.some(fact => fact.type === 'hanging-piece' && fact.arrows.some(item => item.from === 'e7' && item.to === 'f6')));
  verifyCoordinates(model);
});
check('only wholly legal, distinct MultiPV branches become demonstrations', () => {
  const model = lesson(new Chess().fen(), 'a3', {
    bestMoveSan: 'e4', bestMovePvSan: 'e4 e5 Nf3',
    alternatives: [
      { move: 'e2e4', pvSan: 'e4 e5 Nf3' },
      { move: 'd2d4', pv: 'd2d4 d7d5 c2c4' },
      { move: 'e2e4', pvSan: 'e4 e5 e5' },
    ],
  });
  assert.equal(model.variations.filter(variation => variation.source === 'multi-pv').length, 1);
  assert.equal(model.variations.find(variation => variation.source === 'multi-pv').moves[0].san, 'd4');
  assert.equal(model.verification.rejectedVariations.length, 1);
  verifyCoordinates(model);
});
check('legacy commentary receives only legal moves and complete verified lines', () => {
  let supplied;
  const isolated = new context.window.TacticsCoach({ explainResult(input) { supplied = input; return 'Verified commentary'; } }, Chess);
  const model = isolated.analyze({ fen: new Chess().fen(), moveSan: 'Nf3', moveUci: 'e2e4', bestMoveSan: 'Qd8', bestMovePvSan: 'e4 e5 e5', opponentBestMove: 'a1a8', opponentPvSan: 'd5 e5 dxe4' });
  assert.equal(model.explanation, 'Verified commentary');
  assert.equal(supplied.moveUci, 'g1f3');
  assert.equal(supplied.bestMoveSan, '');
  assert.equal(supplied.bestMovePvSan, '');
  assert.equal(supplied.opponentBestMove, '');
  assert.equal(supplied.opponentPvSan, '');
});
check('new doubled pawns are concrete facts, not automatic strategic losses', () => {
  const model = lesson('7k/8/8/8/8/1n6/PP6/6K1 w - - 0 1', 'axb3');
  const doubled = motif(model, 'doubled-pawns'); assert.ok(doubled);
  assert.ok(doubled.highlights.some(item => item.square === 'b2'));
  assert.ok(doubled.highlights.some(item => item.square === 'b3'));
  assert.doesNotMatch(doubled.explanation, /losing|bad move/);
  assert.ok(motif(model, 'passed-pawn'));
  verifyCoordinates(model);
});
check('a supported knight outpost identifies its actual pawn defender', () => {
  const model = lesson('7k/8/8/8/8/1N2P3/8/K7 w - - 0 1', 'Nd4');
  const outpost = motif(model, 'outpost'); assert.ok(outpost);
  assert.ok(outpost.arrows.some(item => item.from === 'e3' && item.to === 'd4'));
  assert.ok(motif(model, 'weak-square'));
  verifyCoordinates(model);
});
check('a knight square opposing pawns can challenge is not called an outpost or weak square', () => {
  const model = lesson('7k/2p5/8/8/8/1N2P3/8/K7 w - - 0 1', 'Nd4');
  assert.equal(motif(model, 'outpost'), undefined); assert.equal(motif(model, 'weak-square'), undefined);
});
check('a blocked x-ray needs a full legal continuation that actually opens the line', () => {
  const fen = 'k3q3/8/8/4B3/8/8/8/4R2K w - - 0 1';
  const model = lesson(fen, 'Re2', { opponentPvSan: 'Ka7 Bd4' });
  const xray = motif(model, 'x-ray'); assert.ok(xray);
  assert.match(xray.explanation, /bishop on e5 currently blocks.*Bd4\+ opens/);
  assert.ok(xray.arrows.some(item => item.from === 'e2' && item.to === 'e5'));
  assert.ok(xray.arrows.some(item => item.from === 'e5' && item.to === 'e8'));
  assert.equal(motif(lesson(fen, 'Re2'), 'x-ray'), undefined);
  verifyCoordinates(model);
});
check('a trapped knight has no direct move, while rescues by other pieces are not ruled out', () => {
  const model = lesson('7k/8/8/3b4/8/6P1/1P3P2/K6N w - - 0 1', 'b3');
  const trap = motif(model, 'trapped-piece'); assert.ok(trap);
  assert.match(trap.explanation, /knight on h1.*no legal move/);
  assert.match(trap.verification.detail, /Other-piece rescues.*not ruled out/);
  assert.ok(trap.arrows.some(item => item.from === 'd5' && item.to === 'h1'));
  verifyCoordinates(model);
});
check('one safe knight retreat prevents a trapped-piece claim', () => {
  const model = lesson('7k/8/8/3b4/8/6P1/1P6/K6N w - - 0 1', 'b3');
  assert.equal(motif(model, 'trapped-piece'), undefined);
});
check('back-rank weakness needs an actual legal back-rank mating move', () => {
  const vulnerable = lesson('4r1k1/8/8/8/8/8/P4PPP/6K1 w - - 0 1', 'a3');
  const threat = motif(vulnerable, 'back-rank-weakness'); assert.ok(threat);
  assert.match(threat.explanation, /Re1#/);
  const escape = lesson('4r1k1/8/8/8/8/7P/P4PP1/6K1 w - - 0 1', 'a3');
  assert.equal(motif(escape, 'back-rank-weakness'), undefined);
  verifyCoordinates(vulnerable); verifyCoordinates(escape);
});
check('a rook file is open or semi-open only according to the actual pawns', () => {
  const semi = lesson('6k1/4p3/8/8/8/8/8/R5K1 w - - 0 1', 'Re1');
  assert.ok(motif(semi, 'semi-open-file')); assert.equal(motif(semi, 'open-file'), undefined);
  const blocked = lesson('6k1/4p3/8/8/8/8/4P3/R5K1 w - - 0 1', 'Re1');
  assert.equal(motif(blocked, 'semi-open-file'), undefined); assert.equal(motif(blocked, 'open-file'), undefined);
  verifyCoordinates(semi); verifyCoordinates(blocked);
});
check('promotion facts describe the actual promoted piece and checking position', () => {
  const model = lesson('k7/6P1/8/8/8/8/8/7K w - - 0 1', 'g8=Q+');
  assert.ok(motif(model, 'promotion')); assert.equal(new Chess(model.fenAfter).get('g8').type, 'q');
  assert.equal(model.move.check, true); verifyCoordinates(model);
});
check('stalemate is a draw only when the legal after-position is terminal without check', () => {
  const model = lesson('7k/5K2/6Q1/8/8/8/8/8 w - - 0 1', 'Qf5');
  assert.ok(motif(model, 'stalemate')); assert.equal(model.move.check, false);
  assert.ok(new Chess(model.fenAfter).in_stalemate()); verifyCoordinates(model);
});
check('an illegal PV suffix rejects the whole engine variation', () => {
  const model = lesson(new Chess().fen(), 'e4', { bestMoveSan: 'e4', bestMovePv: 'e2e4 e7e5 e4e5' });
  assert.equal(model.verification.rejectedVariations.length, 1);
  assert.equal(model.variations.filter(variation => variation.source === 'best').length, 0);
  assert.equal(model.variations[0].moves.length, 1);
});
check('stale opponent PV first move is rejected against its recorded recommendation', () => {
  const model = lesson(new Chess().fen(), 'e4', { opponentBestMove: 'e7e5', opponentPv: 'c7c5 g1f3' });
  assert.equal(model.verification.rejectedVariations.length, 1);
  assert.match(model.verification.rejectedVariations[0].reason, /different move/);
  assert.equal(model.variations.find(variation => variation.id === 'reply'), undefined);
});
check('a check with multiple legal replies is never called forced', () => {
  const model = lesson('r6k/8/8/8/8/8/8/4K3 w - - 0 1', 'Kf1', { opponentPv: 'Ra1+ Ke2' });
  const reply = model.variations.find(variation => variation.id === 'reply');
  assert.ok(reply);
  assert.ok(reply.moves[1].legalMoveCount > 1);
  assert.equal(reply.moves[1].forced, false);
  verifyCoordinates(model);
});
check('forced means exactly one legal move, including a forced king response', () => {
  const model = lesson('r7/8/8/8/8/2k5/8/K7 w - - 0 1', 'Kb1');
  assert.equal(model.move.legalMoveCount, 1);
  assert.equal(model.move.forced, true);
});
check('Morphy’s rook sacrifice provides acceptance and the exact mating follow-up', () => {
  const board = new Chess();
  for (const san of 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8'.split(' ')) assert.ok(board.move(san));
  const model = lesson(board.fen(), 'Rxd7', { classificationKey: 'BRILLIANT', opponentPvSan: 'Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#' });
  const sacrifice = motif(model, 'sacrifice'); assert.ok(sacrifice);
  assert.match(sacrifice.explanation, /Rxd7 captures it/);
  assert.match(sacrifice.explanation, /Rd8#, checkmate/);
  assert.match(sacrifice.verification.detail, /not proof that the opponent must accept/);
  assert.equal(model.variations.find(variation => variation.id === 'played').moves.length, 9);
  verifyCoordinates(model);
});
check('an offered rook losing five and recovering four has no proven compensated sacrifice', () => {
  const model = lesson('1q5k/3np3/8/8/8/8/8/R2Q3K w - - 0 1', 'Ra7', { classificationKey: 'BRILLIANT', opponentPvSan: 'Qxa7 Qxd7 Kh7 Qxe7+' });
  assert.equal(model.verification.rejectedVariations.length, 0);
  assert.equal(motif(model, 'sacrifice'), undefined);
  assert.ok(motif(model, 'hanging-piece'));
});
check('later friendly losses in the full PV cannot be ignored as compensation', () => {
  const model = lesson('1q5k/3np3/8/8/8/8/8/R2Q3K w - - 0 1', 'Ra7', { classificationKey: 'BRILLIANT', opponentPvSan: 'Qxa7 Qxd7 Kh7 Qxe7+ Qxe7' });
  assert.equal(model.verification.rejectedVariations.length, 0);
  assert.equal(motif(model, 'sacrifice'), undefined);
});
check('immediate legal mate threats outrank a flattering saved move grade', () => {
  const board = new Chess();
  assert.ok(board.load_pgn(fs.readFileSync(path.join(__dirname, 'fixtures/explanation-game.pgn'), 'utf8')));
  const moves = board.history(), replay = new Chess();
  for (const san of moves.slice(0, 86)) assert.ok(replay.move(san));
  const model = lesson(replay.fen(), 'Kd1', { classificationKey: 'EXCELLENT' });
  const threat = model.threats.find(fact => fact.type === 'mate-threat');
  assert.ok(threat); assert.match(threat.explanation, /h1=Q#/);
  verifyCoordinates(model);
});
check('the cache is immutable and includes changed engine payload fields', () => {
  const result = { fen: new Chess().fen(), moveSan: 'Nf3', bestMoveSan: 'e4', cpLoss: 20, evalBefore: 35, evalAfter: 15 };
  const first = coach.analyze(result), same = coach.analyze({ ...result });
  assert.equal(first, same); assert.ok(Object.isFrozen(first)); assert.ok(Object.isFrozen(first.variations[0].steps));
  const changed = coach.analyze({ ...result, cpLoss: 40, evalAfter: -5 });
  assert.notEqual(first, changed); assert.equal(changed.evaluation.loss, 40);
  assert.equal(result.cpLoss, 20);
});
check('the complete legal UCI line survives a shortened consistent SAN prefix', () => {
  const model = lesson(new Chess().fen(), 'a3', { bestMove: 'e2e4', bestMoveSan: 'e4', bestMovePvSan: 'e4 e5', bestMovePv: 'e2e4 e7e5 g1f3 b8c6 f1b5' });
  const best = model.variations.find(variation => variation.id === 'best');
  assert.equal(best.moves.length, 5); assert.equal(best.moves[4].san, 'Bb5');
  verifyCoordinates(model);
});
check('contradictory SAN and UCI PVs are rejected even when each is legal', () => {
  const model = lesson(new Chess().fen(), 'a3', { bestMoveSan: 'e4', bestMovePvSan: 'e4 e5 Nf3', bestMovePv: 'e2e4 c7c5 g1f3' });
  assert.ok(model.verification.rejectedVariations.some(item => /different branches/.test(item.reason)));
  assert.equal(model.variations.find(variation => variation.id === 'best').source, 'board');
});
check('no-move placeholders count as missing aliases rather than contradictions', () => {
  const model = lesson(new Chess().fen(), 'a3', { bestMoveSan: '--', bestMove: 'e2e4', bestMovePv: 'e2e4 e7e5', opponentBestMoveSan: '--', opponentBestMove: 'e7e5', opponentPv: 'e7e5 e2e4' });
  assert.equal(model.verification.rejectedVariations.length, 0);
  assert.equal(model.better.move.san, 'e4');
});
check('player evaluation derives from the legal mover rather than stale side metadata', () => {
  const model = lesson(new Chess().fen(), 'a3', { isWhite: false, evalBefore: 100, evalAfter: 0, playerEdgeBefore: -100, playerEdgeAfter: 0, classificationKey: 'BLUNDER', cpLoss: 100 });
  assert.equal(model.evaluation.playerBefore, 100); assert.equal(model.evaluation.playerAfter, 0);
  assert.doesNotMatch(model.explanation, /from -1\.0 to/);
});
check('a stale saved after-FEN is ignored and disclosed without inventing facts', () => {
  const model = lesson(new Chess().fen(), 'Nf3', { fenAfter: '6k1/8/8/8/8/8/8/6K1 b - - 0 1' });
  assert.match(model.verification.reasons[0], /stale/);
  assert.equal(new Chess(model.fenAfter).get('f3').type, 'n');
});
check('invalid positions and illegal played moves expose no demonstrations', () => {
  for (const model of [lesson('invalid', 'Qd8'), lesson(new Chess().fen(), 'Qd8'), lesson('8/8/8/8/8/8/P7/K7 w - - 0 1', 'a3'), lesson('4k3/8/8/8/8/8/8/4R2K w - - 0 1', 'Ra1')]) {
    assert.equal(model.verification.status, 'invalid'); assert.equal(model.variations.length, 0); assert.equal(model.motifs.length, 0);
  }
});
console.log(`Tactical coaching: ${checks} passed; ${failures} failed.`);
if (failures) process.exitCode = 1;
