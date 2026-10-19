const assert = require('node:assert/strict');
const { PuzzleStore, ratingWindow } = require('../server/api/_lib/sql-puzzles');
const Chess = require('chess.js').Chess;
const store = new PuzzleStore(':memory:');
try {
  assert.equal(store.isReady(), false);
  const fen = new Chess().fen();
  store.importBatch([
    { id: 'fork-1', fen, solution: ['e2e4', 'e7e5'], rating: 1490, themes: ['fork', 'short'], popularity: 90, plays: 500 },
    { id: 'fork-2', fen, solution: ['d2d4', 'd7d5'], rating: 1510, themes: ['fork'], popularity: 95, plays: 600 },
    { id: 'mate', fen, solution: ['e2e4'], rating: 1500, themes: ['mateIn2'], popularity: 99, plays: 700 },
    { id: 'hard', fen, solution: ['e2e4'], rating: 1800, themes: ['fork'], popularity: 99, plays: 700 },
  ]);
  assert.equal(store.isReady(), true);
  assert.equal(store.getPuzzleById('missing'), null);
  assert.deepEqual(store.getPuzzleById('fork-1').puzzle.solution, ['e2e4', 'e7e5']);
  assert.equal(store.getNextPuzzle({ theme: 'fork', exclude: 'fork-1', attemptedIds: new Set(['mate']) }).puzzle.id, 'fork-2');
  assert.equal(store.getNextPuzzle({ theme: 'mate in 2' }).puzzle.id, 'mate');
  assert.equal(store.getNextPuzzle({ theme: 'fork', difficulty: 'hardest' }).puzzle.id, 'hard');
  assert.ok(store.getNextPuzzle({ theme: "';DROP TABLE puzzles;--" }));
  assert.ok(store.getNextPuzzle({ attemptedIds: new Set(['fork-1', 'fork-2', 'mate', 'hard']) }), 'allow repeats only when exhausted');
  assert.deepEqual(ratingWindow(400, 'easiest'), { min: 400, max: 400 });
  assert.deepEqual(ratingWindow(3200, 'hardest'), { min: 3200, max: 3200 });
  const date = new Date('2026-10-14T12:00:00Z');
  // Seed a nearby public daily candidate for this day's deterministic target.
  for (let rating = 1100; rating <= 2700; rating += 100) store.importBatch([{ id: `daily-${rating}`, fen, solution: ['e2e4'], rating, themes: ['mix'] }]);
  const daily = store.getDailyPuzzle({ date });
  assert.ok(daily);
  store.importBatch([{ id: 'new-popular', fen, solution: ['e2e4'], rating: daily.puzzle.rating, themes: ['fork'], popularity: 100, plays: 999999 }]);
  assert.equal(store.getDailyPuzzle({ date }).puzzle.id, daily.puzzle.id, 'daily remains stable after corpus updates');
  store.importBatch([{ id: 'fork-1', fen, solution: ['e2e4'], rating: 1490, themes: ['pin'] }]);
  assert.equal(store.sql.prepare("SELECT COUNT(*) n FROM puzzle_themes WHERE id='fork-1' AND theme='fork'").get().n, 0, 'upsert replaces old themes');
  const plan = store.sql.prepare('EXPLAIN QUERY PLAN SELECT id FROM puzzle_themes WHERE theme=? AND rating BETWEEN ? AND ? ORDER BY rating LIMIT 80').all('fork', 1400, 1600);
  assert.ok(plan.some(row => /SEARCH.*INDEX/.test(row.detail)), 'theme and rating use an index');
  console.log('PASS SQL puzzle ID/theme/rating lookup, exclusions, exhaustion fallback, daily stability, safe input and upserts');
} finally { store.close(); }
