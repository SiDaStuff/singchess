// Unit tests for the coach's adaptive FEN repair + move-text replay logic.
// Extracts isValidFen / repairFen / fenFromMoveText from src/coach-chat.js and
// exercises them in a Node vm sandbox (chess.js provides the Chess global).
// Run: node scripts/test-fen-repair.cjs
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(rootDir, 'src', 'coach-chat.js'), 'utf8');
const start = src.indexOf('function isValidFen');
const end = src.indexOf('async function runStockfishTool');
if (start < 0 || end < 0) {
  console.error('Could not locate the repair functions in src/coach-chat.js');
  process.exit(1);
}
const section = src.slice(start, end);
const { Chess } = require(path.join(rootDir, 'node_modules', 'chess.js'));
const sandbox = { window: { Chess }, console };
vm.runInNewContext(`${section}\n__r = { isValidFen, repairFen, fenFromMoveText };`, sandbox);
const t = sandbox.__r;

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: got=${JSON.stringify(got).slice(0, 90)} want=${JSON.stringify(want).slice(0, 60)}`}`);
};

// A valid FEN must pass through untouched.
const good = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
check('valid unchanged', t.repairFen(good), good);
// Missing halfmove/fullmove counters.
check('3-field', t.isValidFen(t.repairFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq')), true);
// Placement-only FEN (side to move inferred).
check('placement-only', t.isValidFen(t.repairFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')), true);
// One short rank (7 files on rank 7) — padded to 8.
const shortRank = t.repairFen('rnbqkbnr/ppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
check('short-rank valid', t.isValidFen(shortRank), true);
// Quotes / fences stripped.
check('quoted', t.isValidFen(t.repairFen(`"${good}"`)), true);
// Garbage must stay rejected (no silent nonsense position).
check('garbage', t.repairFen('hello world this is not a fen'), null);
// SAN move-text reconstruction.
check('replay 1.e4 e5 2.Nf3 Nc6 3.Bb5',
  t.fenFromMoveText('1. e4 e5 2. Nf3 Nc6 3. Bb5'),
  'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3');
// Junk-laden move text still produces a position.
check('junk replay produces fen', !!t.fenFromMoveText('1. e4 {best} e5 2. Nf3 $1 Nc6 3. Bb5 a6 and so on'), true);
// Result marker terminates the replay.
check('result stop', t.fenFromMoveText('1. d4 d5 2. c4 1-0'),
  'rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq c3 0 2');

console.log(fails ? `${fails} FAILURE(S)` : 'ALL PASS');
process.exit(fails ? 1 : 0);
