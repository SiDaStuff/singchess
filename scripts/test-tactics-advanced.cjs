const assert = require('node:assert/strict');
const { loadAnalyzer, loadChess } = require('../server/api/_lib/analysis-loader');
const Chess = loadChess();
const { MoveAnalyzer, TacticsCoach, TacticsAdvanced } = loadAnalyzer();
let passed = 0;
function test(name, run) { run(); passed++; console.log(`PASS ${name}`); }
function fixture(fen, san, pv = '') {
  const coach = new TacticsCoach(new MoveAnalyzer(), Chess), before = new Chess(fen), after = new Chess(fen);
  const move = after.move(san);
  assert.ok(move, `${san} is legal in the fixture`);
  const continuation = pv ? coach._variation(after.fen(), pv, 'fixture', 'Fixture', 'test').value : null;
  if (pv) assert.ok(continuation, `PV is legal: ${pv}`);
  const facts = TacticsAdvanced.extract({ before, after, move, phase: 'played', continuation, coach });
  for (const fact of facts) {
    assert.equal(fact.fen, after.fen());
    for (const arrow of fact.arrows) { assert.match(arrow.from, /^[a-h][1-8]$/); assert.match(arrow.to, /^[a-h][1-8]$/); }
    for (const square of fact.highlights) assert.match(square.square, /^[a-h][1-8]$/);
  }
  return { before, after, move, coach, continuation, facts, get: type => facts.find(fact => fact.type === type) };
}

test('pawn capture creates a passed pawn and the same pawn promotes in the line', () => {
  const data = fixture('7k/pp6/P7/8/8/8/8/7K w - - 0 1', 'axb7', 'Kh7 b8=Q');
  assert.ok(data.get('pawn-breakthrough'));
  assert.match(data.get('pawn-breakthrough').explanation, /same pawn promotes with b8=Q/);
  assert.equal(data.get('pawn-breakthrough').verification.status, 'line-verified');
});
test('a passed pawn without a recorded promotion is not a breakthrough claim', () => {
  assert.equal(fixture('7k/pp6/P7/8/8/8/8/7K w - - 0 1', 'axb7').get('pawn-breakthrough'), undefined);
});
test('a quiet pawn advance explains exact additional space control', () => {
  const data = fixture(new Chess().fen(), 'e4');
  assert.ok(data.get('space-expansion'));
  assert.deepEqual(Array.from(data.get('space-expansion').highlights, item => item.square).sort(), ['d5', 'f5']);
  assert.match(data.get('space-expansion').verification.detail, /not an overall advantage/);
});
test('a quiet king move does not invent space, tempo or a mating net', () => {
  const data = fixture('7k/8/8/8/8/8/P7/7K w - - 0 1', 'Kg1');
  assert.equal(data.get('space-expansion'), undefined);
  assert.equal(data.get('tempo-gain'), undefined);
  assert.equal(data.get('mating-net'), undefined);
});
test('a legal intermediate check precedes a capture that was already available', () => {
  const data = fixture('7k/8/8/8/3r4/2B5/8/R6K w - - 0 1', 'Ra8+', 'Kh7 Bxd4');
  const fact = data.get('zwischenzug');
  assert.ok(fact); assert.match(fact.explanation, /Bxd4\+ was already available/);
  assert.match(fact.verification.detail, /not that every reply loses material/);
});
test('a check without a verified delayed capture does not invent zwischenzug', () => {
  assert.equal(fixture('7k/8/8/8/3r4/2B5/8/R6K w - - 0 1', 'Ra8+', 'Kh7').get('zwischenzug'), undefined);
});
test('a vulnerable rook captures something before recorded acceptance', () => {
  const data = fixture('3r1qk1/8/8/8/3R1b2/8/8/6K1 w - - 0 1', 'Rxf4', 'Qxf4');
  const fact = data.get('desperado');
  assert.ok(fact); assert.match(fact.explanation, /vulnerable to Rxd4/);
  assert.match(fact.verification.detail, /does not prove.*unavoidable/);
});
test('a recorded queen retreat explains a gained tempo without claiming it forced', () => {
  const data = fixture('6k1/8/5q2/8/8/2N5/8/6K1 w - - 0 1', 'Nd5', 'Qd6');
  const fact = data.get('tempo-gain');
  assert.ok(fact); assert.match(fact.explanation, /queen on f6/);
  assert.match(fact.verification.detail, /another line/);
});
test('capturing the attacking queen is a refutation, not a retreat gaining tempo', () => {
  const before = new Chess('6k1/8/8/8/8/q7/1N6/1R4K1 w - - 0 1');
  before.move('Kh1');
  const data = fixture(before.fen(), 'Qxb2', 'Rxb2');
  assert.equal(data.get('tempo-gain'), undefined);
  const model = data.coach.analyze({ fen: '6k1/8/8/8/8/q7/1N6/1R4K1 w - - 0 1', moveSan: 'Kh1', opponentPvSan: 'Qxb2 Rxb2', classificationKey: 'GOOD' });
  assert.equal(model.threats.some(fact => fact.phase === 'reply' && fact.type === 'tempo-gain'), false);
});
test('a queen escape with check is a countercheck, not an ordinary tempo retreat', () => {
  assert.equal(fixture('6k1/8/5q2/8/8/2N5/8/6K1 w - - 0 1', 'Nd5', 'Qd4+').get('tempo-gain'), undefined);
});
test('an apparent rook defender pinned to its king cannot recapture', () => {
  const data = fixture('4r3/8/8/8/5b2/2k2N2/4R3/4K3 w - - 0 1', 'Nd2', 'Bxd2+ Kd1');
  const fact = data.get('insufficient-defense');
  assert.ok(fact); assert.match(fact.explanation, /rook on e2.*no immediate recapture on d2 is legal/);
  assert.ok(fact.arrows.some(arrow => arrow.from === 'e2' && arrow.to === 'd2' && arrow.role === 'defense'));
});
test('an immediate legal recapture prevents an insufficient-defense claim', () => {
  const data = fixture('7k/8/8/8/5b2/5N2/4R3/4K3 w - - 0 1', 'Nd2', 'Bxd2+ Rxd2');
  assert.equal(data.get('insufficient-defense'), undefined);
});
test('a bounded mating net is proved against every current legal defense', () => {
  const data = fixture('7k/8/5KQ1/8/8/8/8/8 w - - 0 1', 'Qh6+', 'Kg8 Qg7#');
  const fact = data.get('mating-net');
  assert.ok(fact); assert.equal(fact.verification.status, 'all-defenses-verified');
  assert.match(fact.explanation, /Kg8 is the only legal reply.*Qg7# is checkmate/);
});
test('legal ordinary engine continuation is not described as a mating net', () => {
  assert.equal(fixture(new Chess().fen(), 'e4', 'e5 Nf3').get('mating-net'), undefined);
});
test('recorded repeated checks verify threefold, without promising perpetual check', () => {
  const data = fixture('7k/8/8/8/8/8/r7/7K w - - 0 1', 'Kg1', 'Ra1+ Kh2 Ra2+ Kg1 Ra1+ Kh2 Ra2+ Kg1');
  const fact = data.get('repetition-checks');
  assert.ok(fact); assert.match(fact.explanation, /repeats the same position three times/);
  assert.match(fact.verification.detail, /does not prove.*unavoidable/);
});
test('twofold repeated checks do not falsely establish a drawing repetition', () => {
  assert.equal(fixture('7k/8/8/8/8/8/r7/7K w - - 0 1', 'Kg1', 'Ra1+ Kh2 Ra2+ Kg1').get('repetition-checks'), undefined);
});
test('a preventive rook move eliminates concrete immediate mate options', () => {
  const data = fixture('7r/8/8/2b5/8/5kb1/7P/R6K w - - 0 1', 'Ra2');
  const fact = data.get('prophylaxis');
  assert.ok(fact); assert.match(fact.explanation, /no legal checkmate in one/);
  assert.match(fact.verification.detail, /Longer attacks are not ruled out/);
});
test('a corrupted continuation is rejected rather than proving a tactic', () => {
  const data = fixture('7k/pp6/P7/8/8/8/8/7K w - - 0 1', 'axb7', 'Kh7 b8=Q');
  const corrupted = { moves: data.continuation.moves.map(item => ({ ...item })) };
  corrupted.moves[1].to = 'c8';
  const facts = TacticsAdvanced.extract({ ...data, phase: 'played', continuation: corrupted });
  assert.equal(facts.some(fact => fact.type === 'pawn-breakthrough'), false);
});
test('an active seventh-rank rook has exact legal pawn targets', () => {
  const data = fixture('6k1/p5p1/8/8/8/8/8/3R3K w - - 0 1', 'Rd7');
  const fact = data.get('endgame-rook-activity');
  assert.ok(fact); assert.match(fact.explanation, /pawn on a7.*pawn on g7/);
  assert.ok(fact.arrows.every(arrow => arrow.from === 'd7' && ['a7', 'g7'].includes(arrow.to)));
});
console.log(`Advanced tactics checks passed: ${passed}`);
