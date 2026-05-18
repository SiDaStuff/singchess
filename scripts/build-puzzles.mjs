/**
 * Download Lichess puzzle CSV (zstd) and build a local SQLite database for /api/puzzle.
 * https://database.lichess.org/
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { createInterface } from 'readline';
import { createRequire } from 'module';
import Chess from 'chess.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'server', 'data');
const zstPath = path.join(dataDir, 'lichess_db_puzzle.csv.zst');
const csvPath = path.join(dataDir, 'lichess_db_puzzle.csv');
const dbPath = path.join(dataDir, 'puzzles.db');
const PUZZLE_URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
const MAX_ROWS = Number(process.env.PUZZLE_DB_MAX_ROWS || 0) || Infinity;
const SKIP_DOWNLOAD = process.env.SKIP_PUZZLE_DOWNLOAD === '1';

mkdirSync(dataDir, { recursive: true });

async function downloadPuzzleArchive() {
  if (SKIP_DOWNLOAD && existsSync(csvPath)) {
    console.log('SKIP_PUZZLE_DOWNLOAD=1 and CSV present; skipping download.');
    return;
  }
  if (existsSync(zstPath)) {
    const ageDays = (Date.now() - statSync(zstPath).mtimeMs) / (1000 * 60 * 60 * 24);
    if (ageDays < 14) {
      console.log(`Using cached ${path.relative(rootDir, zstPath)} (${ageDays.toFixed(1)} days old).`);
      return;
    }
  }
  console.log(`Downloading ${PUZZLE_URL} ...`);
  const response = await fetch(PUZZLE_URL);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  await pipeline(response.body, createWriteStream(zstPath));
  console.log(`Saved ${path.relative(rootDir, zstPath)}`);
}

async function decompressArchive() {
  if (SKIP_DOWNLOAD && existsSync(csvPath)) return;
  const needsDecompress = !existsSync(csvPath)
    || (existsSync(zstPath) && statSync(zstPath).mtimeMs > statSync(csvPath).mtimeMs);
  if (!needsDecompress) {
    console.log(`Using cached ${path.relative(rootDir, csvPath)}`);
    return;
  }
  if (!existsSync(zstPath)) {
    throw new Error('Missing lichess_db_puzzle.csv.zst. Run without SKIP_PUZZLE_DOWNLOAD first.');
  }
  const { decompress } = await import('fzstd');
  console.log('Decompressing puzzle database (this can take a few minutes)...');
  const chunks = [];
  for await (const chunk of createReadStream(zstPath)) {
    chunks.push(chunk);
  }
  const decompressed = Buffer.from(decompress(Buffer.concat(chunks)));
  writeFileSync(csvPath, decompressed);
  console.log(`Wrote ${path.relative(rootDir, csvPath)} (${(decompressed.length / 1e6).toFixed(1)} MB)`);
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function puzzleFromRow(columns, values) {
  const row = {};
  columns.forEach((col, idx) => {
    row[col] = values[idx] || '';
  });
  const moves = String(row.Moves || '').trim().split(/\s+/).filter(Boolean);
  if (!row.FEN || moves.length < 2) return null;

  const chess = new Chess(row.FEN);
  const setup = chess.move({
    from: moves[0].slice(0, 2),
    to: moves[0].slice(2, 4),
    promotion: moves[0][4],
  }, { sloppy: true });
  if (!setup) return null;

  const setupFen = chess.fen();
  const solution = moves.slice(1);
  if (!solution.length) return null;

  return {
    id: String(row.PuzzleId || '').trim(),
    fen: String(row.FEN),
    setup_fen: setupFen,
    solution: JSON.stringify(solution),
    rating: Number(row.Rating) || 1500,
    rating_deviation: Number(row.RatingDeviation) || 0,
    popularity: Number(row.Popularity) || 0,
    nb_plays: Number(row.NbPlays) || 0,
    themes: String(row.Themes || '').trim(),
    game_url: String(row.GameUrl || ''),
    opening_tags: String(row.OpeningTags || ''),
  };
}

async function buildSqlite() {
  if (existsSync(dbPath) && existsSync(csvPath) && statSync(csvPath).mtimeMs <= statSync(dbPath).mtimeMs) {
    console.log(`Using cached ${path.relative(rootDir, dbPath)}`);
    return;
  }
  if (!existsSync(csvPath)) {
    throw new Error('CSV missing. Download/decompress failed or was skipped.');
  }

  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(rootDir, 'node_modules', 'sql.js', 'dist', file),
  });
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE puzzles (
      id TEXT PRIMARY KEY,
      fen TEXT NOT NULL,
      setup_fen TEXT NOT NULL,
      solution TEXT NOT NULL,
      rating INTEGER NOT NULL,
      rating_deviation INTEGER NOT NULL DEFAULT 0,
      popularity INTEGER NOT NULL DEFAULT 0,
      nb_plays INTEGER NOT NULL DEFAULT 0,
      themes TEXT NOT NULL DEFAULT '',
      game_url TEXT NOT NULL DEFAULT '',
      opening_tags TEXT NOT NULL DEFAULT ''
    );
  `);
  db.run('CREATE INDEX idx_puzzles_rating ON puzzles(rating);');
  db.run('CREATE INDEX idx_puzzles_popularity ON puzzles(popularity);');

  const insert = db.prepare(`
    INSERT OR IGNORE INTO puzzles
      (id, fen, setup_fen, solution, rating, rating_deviation, popularity, nb_plays, themes, game_url, opening_tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let columns = null;
  let imported = 0;
  let skipped = 0;
  const rl = createInterface({ input: createReadStream(csvPath, { encoding: 'utf8' }), crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!columns) {
      columns = parseCsvLine(line);
      continue;
    }
    const puzzle = puzzleFromRow(columns, parseCsvLine(line));
    if (!puzzle?.id) {
      skipped += 1;
      continue;
    }
    insert.run([
      puzzle.id,
      puzzle.fen,
      puzzle.setup_fen,
      puzzle.solution,
      puzzle.rating,
      puzzle.rating_deviation,
      puzzle.popularity,
      puzzle.nb_plays,
      puzzle.themes,
      puzzle.game_url,
      puzzle.opening_tags,
    ]);
    imported += 1;
    if (imported % 100000 === 0) console.log(`  ${imported.toLocaleString()} puzzles imported...`);
    if (imported >= MAX_ROWS) break;
  }
  insert.free();

  const exported = db.export();
  writeFileSync(dbPath, Buffer.from(exported));
  db.close();
  console.log(`Puzzle DB ready: ${imported.toLocaleString()} puzzles (${skipped.toLocaleString()} skipped) -> ${path.relative(rootDir, dbPath)}`);
}

async function main() {
  if (process.env.SKIP_PUZZLE_BUILD === '1') {
    console.log('SKIP_PUZZLE_BUILD=1; skipping puzzle database build.');
    return;
  }
  await downloadPuzzleArchive();
  await decompressArchive();
  await buildSqlite();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
