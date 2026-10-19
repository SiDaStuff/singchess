import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { explanationReferences } from '../src/ui/move-explanation.js';
const require = createRequire(import.meta.url);
const { Chess } = require('chess.js');
const game = new Chess();
assert.ok(game.load_pgn(fs.readFileSync(new URL('./fixtures/explanation-game.pgn', import.meta.url), 'utf8')));
const replay = new Chess(), positions = [];
for (const san of game.history()) { positions.push(replay.fen()); replay.move(san); }
const text = 'Rf3 is a mistake. After this move, Rd6 maintains a pin — the pawn on f6 shields the king on g6 from the rook on d6. Better was h1=Q.';
const parts = explanationReferences(text, { fen: positions[79], moveSan: 'Rf3' }, Chess);
assert.equal(parts.map(p => p.text).join(''), text, 'interactive rendering preserves the exact prose');
const move = san => parts.find(p => p.kind === 'move' && p.text === san);
assert.equal(new Chess(move('Rd6').fen).get('d6').color, 'w', 'opponent reply is previewed after Rf3');
assert.equal(new Chess(move('Rd6').fen).get('f3').color, 'b');
const pawn = parts.find(p => p.kind === 'square' && p.square === 'f6');
assert.equal(new Chess(pawn.fen).get('f6').type, 'p', 'named pawn uses the reply position');
assert.equal(new Chess(move('h1=Q').fen).get('h1').type, 'q', 'promotion preview uses the alternative branch');
assert.equal(new Chess(move('h1=Q').fen).get('g3').type, 'r', 'alternative does not include played Rf3');
const mate = explanationReferences('Kd1 allows h1=Q#, which is checkmate. Better was Kb1.', { fen: positions[86], moveSan: 'Kd1' }, Chess);
const mateMove = mate.find(p => p.text === 'h1=Q#');
assert.ok(mateMove.mate && mateMove.check);
assert.ok(new Chess(mateMove.fen).in_checkmate());
const alternative = mate.find(p => p.text === 'Kb1');
assert.equal(new Chess(alternative.fen).get('b1').type, 'k');
assert.equal(new Chess(alternative.fen).get('h2').type, 'p', 'return to before Kd1 for Kb1');
assert.equal(explanationReferences('Nothing supported', { fen: 'invalid' }, Chess)[0].text, 'Nothing supported');
const opera = new Chess();
assert.ok(opera.load_pgn(fs.readFileSync(new URL('./fixtures/opera-game.pgn', import.meta.url), 'utf8')));
const operaBoard = new Chess(), operaPositions = [];
for (const san of opera.history()) { operaPositions.push(operaBoard.fen()); operaBoard.move(san); }
const tradeText = 'cxb5 captures the knight on b5. After the played move, the engine line is Bxb5+ Nbd7 O-O-O. Better was Qb4+. Compare the engine line Qb4+ Qxb4 Bxb4+ c3 cxb5 Bxb5+. Qxb4 captures the queen on b4; Bxb4+ captures the queen on b4.';
const trades = explanationReferences(tradeText, { fen: operaPositions[19], moveSan: 'cxb5' }, Chess);
assert.equal(trades.map(p => p.text).join(''), tradeText);
const capturedKnight = trades.find(p => p.kind === 'square' && p.square === 'b5');
assert.equal(new Chess(capturedKnight.fen).get('b5').type, 'n', 'captured-piece reference shows the knight before capture');
for (const san of ['Qxb4', 'Bxb4+']) {
  const mentions = trades.filter(p => p.kind === 'move' && p.text === san);
  assert.equal(mentions.length, 2, 'both line and consequence moves are interactive');
  assert.equal(mentions[0].fen, mentions[1].fen, 'repeated capture explanation uses its actual variation position');
}
const duplicateCapture = explanationReferences('Rxd7. After the played move, the engine line is Nxd7 Bxe7 Bxe7 Bxd7+ Kxd7. Bxe7 captures the queen on e7.', { fen: operaPositions[24], moveSan: 'Rxd7' }, Chess);
const sameSan = duplicateCapture.filter(p => p.kind === 'move' && p.text === 'Bxe7');
assert.equal(sameSan.length, 3);
assert.equal(new Chess(sameSan[0].fen).get('e7').color, 'w');
assert.equal(new Chess(sameSan[1].fen).get('e7').color, 'b');
assert.equal(sameSan[2].fen, sameSan[0].fen, 'capture consequence identifies the correct actor even when both bishops play Bxe7');
console.log('PASS explanation references: correct reply boards, squares, alternative branches and checkmate');
