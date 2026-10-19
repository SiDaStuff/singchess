// Curated counterexamples run offline against the actual teaching pipeline.
// Every fixture uses real chess.js legality; no engine scores prove a tactic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Chess } = require('chess.js');
const context = { window: { Chess }, Chess, console };
vm.createContext(context);
for (const name of ['chess-core.js', 'tactics-coach.js', 'tactics-advanced.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', name), 'utf8'), context, { filename: name });
}
const coach = new context.window.TacticsCoach(new context.window.MoveAnalyzer(), Chess);
let checks = 0, failures = 0;
const check = (name, run) => {
  try { run(); checks++; console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
};
const lesson = (fen, moveSan, extra = {}) => {
  const before = new Chess(fen), after = new Chess(fen);
  assert.ok(after.move(moveSan), 'Fixture move is legal');
  const result = coach.analyze({ fen: before.fen(), moveSan, isWhite: before.turn() === 'w', classificationKey: 'GOOD', ...extra });
  assert.equal(result.verification.status, 'verified');
  return result;
};
const facts = model => [...model.motifs, ...model.threats, ...(model.better?.motifs || [])];
const has = (model, type, phase) => facts(model).find(fact => fact.type === type && (!phase || fact.phase === phase));

check('a rook pinned to its own king cannot legally fork sideways targets', () => {
  const model = lesson('k3r3/8/8/8/8/1q5n/4R3/4K3 w - - 0 1', 'Re3');
  const after = new Chess(model.fenAfter), hypothetical = after.fen().split(' ');
  hypothetical[1] = 'w';
  const actor = new Chess(hypothetical.join(' '));
  assert.equal(actor.moves().includes('Rxb3'), false);
  assert.equal(actor.moves().includes('Rxh3'), false);
  assert.equal(has(model, 'fork', 'played'), undefined);
});

check('an absolutely file-pinned pawn can advance but cannot capture off its pin line', () => {
  const model = lesson('4q1k1/8/8/8/8/2b5/3P4/3K4 b - - 0 1', 'Qd8');
  const after = new Chess(model.fenAfter), pin = has(model, 'absolute-pin', 'played');
  assert.ok(pin); assert.ok(after.moves().includes('d3')); assert.ok(after.moves().includes('d4'));
  assert.equal(after.moves().includes('dxc3'), false);
  assert.match(pin.explanation, /d3/);
  assert.doesNotMatch(pin.explanation, /pawn cannot move|pawn is unable to move/i);
});

check('a relatively aligned pawn with no exposing legal move has no relative-pin claim', () => {
  const model = lesson('4q1k1/8/8/8/8/8/3P4/3Q2K1 b - - 0 1', 'Qd8');
  assert.equal(has(model, 'relative-pin', 'played'), undefined);
  assert.ok(new Chess(model.fenAfter).moves().includes('d3'));
});

check('a defended knight with a legal queen recapture is not called hanging', () => {
  const model = lesson('6k1/8/8/8/8/q7/1N6/1R4K1 w - - 0 1', 'Kh1', { opponentPvSan: 'Qxb2 Rxb2' });
  const after = new Chess(model.fenAfter); assert.ok(after.move('Qxb2')); assert.ok(after.move('Rxb2'));
  const targetFact = model.threats.find(fact => fact.phase === 'played' && fact.explanation.includes('knight on b2'));
  assert.ok(targetFact); assert.equal(targetFact.type, 'capture-available');
  assert.equal(has(model, 'insufficient-defense', 'played'), undefined);
});

check('capturing the attacking queen is a countercapture rather than a tempo retreat', () => {
  const model = lesson('6k1/8/8/8/8/q7/1N6/1R4K1 w - - 0 1', 'Kh1', { opponentPvSan: 'Qxb2 Rxb2' });
  assert.equal(has(model, 'tempo-gain', 'reply'), undefined);
});

check('geometric support by a pinned rook does not prove a legal recapture', () => {
  const model = lesson('6k1/8/8/8/8/q7/1N6/rR4K1 w - - 0 1', 'Kh1', { opponentPvSan: 'Qxb2' });
  const after = new Chess(model.fenAfter); assert.ok(after.move('Qxb2'));
  assert.equal(after.moves().includes('Rxb2'), false);
  const unsupported = has(model, 'insufficient-defense', 'played');
  assert.ok(unsupported); assert.match(unsupported.explanation, /no (?:legal immediate recapture|immediate recapture on [a-h][1-8] is legal)/);
});

check('a king in front of a rook is a skewer with an actual legal exposing king move', () => {
  const model = lesson('r7/8/k7/8/8/8/8/4R2K w - - 0 1', 'Ra1+');
  const skewer = has(model, 'skewer', 'played'); assert.ok(skewer);
  assert.match(skewer.explanation, /king on a6.*rook on a8/);
  const after = new Chess(model.fenAfter);
  assert.ok(after.in_check());
  const legalExample = after.moves({ verbose: true }).find(move => {
    if (move.from !== 'a6') return false;
    const branch = new Chess(after.fen()); branch.move(move);
    return Boolean(branch.move('Rxa8'));
  });
  assert.ok(legalExample);
  assert.doesNotMatch(skewer.explanation, /forced win|guaranteed|wins the rook by force/i);
});

check('stalemate remains a draw even when the saved grade praises the move', () => {
  const model = lesson('7k/5K2/8/6Q1/8/8/8/8 w - - 0 1', 'Qg6', { classificationKey: 'BRILLIANT' });
  assert.ok(new Chess(model.fenAfter).in_stalemate());
  assert.ok(has(model, 'stalemate', 'played'));
  assert.equal(has(model, 'checkmate'), undefined);
  assert.equal(has(model, 'mating-net'), undefined);
  assert.equal(model.threats.length, 0);
});

check('an illegal engine line suffix rejects all of its tactical evidence', () => {
  const model = lesson(new Chess().fen(), 'e4', { opponentPvSan: 'e5 Nf3 e5' });
  assert.ok(model.verification.rejectedVariations.length);
  assert.equal(model.variations.some(variation => variation.id === 'reply'), false);
  assert.equal(model.variations.find(variation => variation.id === 'played').moves.length, 1);
  assert.equal(model.threats.some(fact => fact.phase === 'reply'), false);
});

check('false check and mate punctuation is normalized to the legal canonical SAN', () => {
  const model = lesson(new Chess().fen(), 'e4', { opponentPvSan: 'e5# Nf3+' });
  const line = model.variations.find(variation => variation.id === 'reply'); assert.ok(line);
  assert.deepEqual(Array.from(line.moves, move => move.san), ['e5', 'Nf3']);
  assert.ok(line.moves.every(move => !move.check && !move.mate));
  assert.equal(has(model, 'checkmate'), undefined);
});

check('consistent changed best defense invalidates cache without mutating the prior lesson', () => {
  const fen = new Chess().fen();
  const initial = { opponentBestMove: 'e7e5', opponentBestMoveSan: 'e5', opponentPvSan: 'e5 Nf3' };
  const first = lesson(fen, 'e4', initial);
  const changed = lesson(fen, 'e4', { opponentBestMove: 'c7c5', opponentBestMoveSan: 'c5', opponentPvSan: 'c5 Nf3' });
  assert.notEqual(first, changed);
  assert.equal(first.variations.find(variation => variation.id === 'reply').moves[0].san, 'e5');
  assert.equal(changed.variations.find(variation => variation.id === 'reply').moves[0].san, 'c5');
  assert.ok(Object.isFrozen(first));
});

check('changed raw best defense cannot be masked by a stale SAN alias in cache', () => {
  const fen = new Chess().fen();
  const initial = { opponentBestMove: 'e7e5', opponentBestMoveSan: 'e5', opponentPvSan: 'e5 Nf3' };
  const first = lesson(fen, 'e4', initial);
  const changed = lesson(fen, 'e4', { ...initial, opponentBestMove: 'c7c5' });
  assert.notEqual(first, changed);
  const line = changed.variations.find(variation => variation.id === 'reply');
  assert.ok(!line || line.moves[0].san === 'c5', 'Contradictory old e5 cannot remain the strongest recorded reply');
});

check('changed raw own recommendation cannot be masked by a stale SAN alias', () => {
  const fen = new Chess().fen();
  const initial = { bestMove: 'e2e4', bestMoveSan: 'e4', bestMovePvSan: 'e4 e5' };
  const first = lesson(fen, 'a3', initial);
  const changed = lesson(fen, 'a3', { ...initial, bestMove: 'd2d4' });
  assert.notEqual(first, changed);
  assert.ok(!changed.better || changed.better.move.san === 'd4', 'Contradictory old e4 cannot remain the recommended move');
});

console.log(`Adversarial tactical checks: ${checks} passed; ${failures} failed.`);
if (failures) process.exitCode = 1;
