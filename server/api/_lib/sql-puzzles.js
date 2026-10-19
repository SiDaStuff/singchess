// Public corpus uses indexed SQL tables, separate from backed-up user attempts.
const Sqlite = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');
const normalizeTheme = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function ratingWindow(target, difficulty = 'normal') {
  const t = Math.max(400, Math.min(3200, Number(target) || 1500));
  const offsets = { easiest: [-500, -250], easier: [-320, -120], normal: [-150, 150], harder: [120, 320], hardest: [250, 550] };
  const [a, b] = offsets[difficulty] || offsets.normal;
  return { min: Math.max(400, Math.min(3200, t + a)), max: Math.max(400, Math.min(3200, t + b)) };
}
function rowToPayload(row) {
  if (!row) return null;
  return { puzzle: { id: row.id, fen: row.fen, solution: typeof row.solution === 'string' ? JSON.parse(row.solution) : row.solution,
    rating: row.rating, themes: typeof row.themes === 'string' ? JSON.parse(row.themes) : row.themes,
    popularity: row.popularity, plays: row.plays, gameUrl: row.gameUrl },
    game: { pgn: '', players: [{ color: 'white', name: 'White', rating: null }, { color: 'black', name: 'Black', rating: null }] } };
}
class PuzzleStore {
  constructor(filename) {
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.sql = new Sqlite(filename, { timeout: 10000 });
    this.sql.pragma('journal_mode = WAL');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS puzzles (
      id TEXT PRIMARY KEY, fen TEXT NOT NULL, solution TEXT NOT NULL, rating INTEGER NOT NULL,
      themes TEXT NOT NULL, popularity INTEGER NOT NULL, plays INTEGER NOT NULL, gameUrl TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS puzzles_rating ON puzzles(rating, popularity DESC, id);
      CREATE TABLE IF NOT EXISTS puzzle_themes (theme TEXT NOT NULL, rating INTEGER NOT NULL, id TEXT NOT NULL,
        PRIMARY KEY(theme, rating, id));
      CREATE INDEX IF NOT EXISTS puzzle_themes_id ON puzzle_themes(id);
      CREATE TABLE IF NOT EXISTS puzzle_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS puzzle_daily (day TEXT PRIMARY KEY, id TEXT NOT NULL);`);
    this.put = this.sql.prepare(`INSERT INTO puzzles VALUES (@id,@fen,@solution,@rating,@themes,@popularity,@plays,@gameUrl)
      ON CONFLICT(id) DO UPDATE SET fen=excluded.fen,solution=excluded.solution,rating=excluded.rating,
      themes=excluded.themes,popularity=excluded.popularity,plays=excluded.plays,gameUrl=excluded.gameUrl`);
    this.putTheme = this.sql.prepare('INSERT OR IGNORE INTO puzzle_themes VALUES (?,?,?)');
    this.clearThemes = this.sql.prepare('DELETE FROM puzzle_themes WHERE id=?');
    this.importBatch = this.sql.transaction(rows => {
      for (const p of rows) {
        this.put.run({ id: p.id, fen: p.fen, solution: JSON.stringify(p.solution), rating: p.rating,
          themes: JSON.stringify(p.themes || []), popularity: p.popularity || 0, plays: p.plays || 0, gameUrl: p.gameUrl || '' });
        this.clearThemes.run(p.id);
        for (const theme of new Set((p.themes || []).map(normalizeTheme))) this.putTheme.run(theme, p.rating, p.id);
      }
    });
    this.queries = new Map();
  }
  isReady() { return !!this.sql.prepare('SELECT 1 FROM puzzles LIMIT 1').get(); }
  getPuzzleById(id) { return rowToPayload(this.sql.prepare('SELECT * FROM puzzles WHERE id=?').get(String(id || ''))); }
  candidates({ min, max, target, theme = 'mix', exclude = '', attemptedIds = new Set() }) {
    const key = normalizeTheme(theme);
    const exclusions = [String(exclude), JSON.stringify([...attemptedIds])];
    const themed = key && key !== 'mix';
    const table = themed ? 'puzzle_themes t' : 'puzzles p';
    const id = themed ? 't.id' : 'p.id';
    const selection = themed ? 't.id,t.rating,0 AS popularity' : 'p.id,p.rating,p.popularity';
    const rating = themed ? 't.rating' : 'p.rating';
    const filter = themed ? 't.theme=? AND ' : '';
    const rows = [];
    // Two bounded index walks instead of sorting millions of rows by abs(rating-target).
    for (const direction of ['ASC', 'DESC']) {
      // Combine bounds explicitly. Redundant BETWEEN + >= predicates can make
      // SQLite walk thousands of lower ratings before applying the latter.
      const start = direction === 'ASC' ? Math.max(min, Math.ceil(target)) : min;
      const end = direction === 'DESC' ? Math.min(max, Math.ceil(target) - 1) : max;
      if (start > end) continue;
      const params = [start, end, ...exclusions];
      const cacheKey = `${themed}:${direction}`;
      if (!this.queries.has(cacheKey)) {
        const tieOrder = themed ? `t.id ${direction}`
          : `p.popularity ${direction === 'ASC' ? 'DESC' : 'ASC'}, p.id ${direction}`;
        this.queries.set(cacheKey, this.sql.prepare(`SELECT ${selection} FROM ${table} WHERE ${filter}${rating} BETWEEN ? AND ?
          AND ${id}<>? AND ${id} NOT IN (SELECT value FROM json_each(?))
          ORDER BY ${rating} ${direction}, ${tieOrder} LIMIT 80`));
      }
      rows.push(...this.queries.get(cacheKey).all(...(themed ? [key, ...params] : params)));
    }
    rows.sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target) || b.popularity - a.popularity || a.id.localeCompare(b.id));
    return rows;
  }
  getNextPuzzle({ theme = 'mix', difficulty = 'normal', target = 1500, exclude = '', attemptedIds = new Set() } = {}) {
    const window = ratingWindow(target, difficulty);
    // Vary the sample inside the chosen difficulty band so a long session does
    // not keep drawing from the same handful of IDs at one exact rating.
    const center = window.min + Math.floor(Math.random() * (window.max - window.min + 1));
    const query = { ...window, target: center, theme, exclude, attemptedIds };
    let rows = this.candidates(query);
    if (!rows.length && attemptedIds.size) rows = this.candidates({ ...query, attemptedIds: new Set() });
    if (!rows.length && theme !== 'mix') rows = this.candidates({ ...query, theme: 'mix' });
    const pool = rows.slice(0, 40);
    const picked = pool[Math.floor(Math.random() * pool.length)];
    return picked ? this.getPuzzleById(picked.id) : null;
  }
  getDailyPuzzle({ date = new Date(), attemptedIds = new Set() } = {}) {
    const day = date.toISOString().slice(0, 10);
    let saved = this.sql.prepare('SELECT id FROM puzzle_daily WHERE day=?').get(day);
    if (!saved) {
      const hash = [...day].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 0) >>> 0;
      const target = 1200 + hash % 1400;
      const rows = this.candidates({ min: target - 150, max: target + 150, target });
      const pick = rows[hash % Math.max(1, rows.length)];
      if (!pick) return null;
      this.sql.prepare('INSERT OR IGNORE INTO puzzle_daily VALUES (?,?)').run(day, pick.id);
      saved = this.sql.prepare('SELECT id FROM puzzle_daily WHERE day=?').get(day);
    }
    if (attemptedIds.has(saved.id)) return this.getNextPuzzle({ attemptedIds });
    return this.getPuzzleById(saved.id);
  }
  close() { this.sql.close(); }
}
let singleton;
function store() {
  return singleton ||= new PuzzleStore(path.resolve(process.env.SQLITE_DATABASE_PATH || path.join(__dirname, '../../data/application.sqlite')));
}
module.exports = { PuzzleStore, ratingWindow, rowToPayload, normalizeTheme,
  isReady: () => store().isReady(), getPuzzleById: id => store().getPuzzleById(id),
  getNextPuzzle: query => store().getNextPuzzle(query), getDailyPuzzle: query => store().getDailyPuzzle(query) };
