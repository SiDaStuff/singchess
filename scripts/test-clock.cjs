// PGN clock parsing must be available to the browser controller across modules.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/chess-core.js'), 'utf8'), context);
const { parseClock, parseBaseClock, moveTimesFromPgn } = context.window;
assert.equal(typeof parseClock, 'function', 'clock helper is exposed to the UI');
assert.equal(typeof moveTimesFromPgn, 'function', 'move time helper is exposed to the UI');
assert.equal(parseClock('0:00'), 0, 'zero clock is real data');
assert.equal(parseClock('0:04:51'), 291);
assert.equal(parseClock('1:02:03.5'), 3723.5);
assert.equal(parseClock('invalid'), null);
assert.equal(parseBaseClock({ TimeControl: '300' }), 300);
assert.equal(parseBaseClock({ TimeControl: '300+5' }), 300);
assert.equal(parseBaseClock({ TimeControl: '-' }), null);
const pgn = '1. e4 {[%clk 0:04:58]} e5 {[%clk 0:04:57]} 2. Nf3 {[%clk 0:04:54]} Nc6 {[%clk 0:04:51]}';
assert.deepEqual(Array.from(moveTimesFromPgn(pgn, 4, { TimeControl: '300' })), [2, 3, 4, 6]);
assert.deepEqual(Array.from(moveTimesFromPgn(pgn, 4, { TimeControl: '300+5' })), [7, 8, 9, 11]);
assert.deepEqual(Array.from(moveTimesFromPgn('1. e4 e5', 2, { TimeControl: '300' })), [], 'unannotated games do not invent move times');
console.log('PASS PGN clock module integration, zero, fractional, base-only, increment and missing-clock cases');
