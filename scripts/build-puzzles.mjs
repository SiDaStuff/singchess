/**
 * Download the Lichess puzzle CSV and import it into indexed application SQLite tables.
 */
import 'dotenv/config';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { once } from 'events';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { createInterface } from 'readline';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const chessModule = require('chess.js');
const Chess = chessModule.Chess || chessModule;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'server', 'data');
const zstPath = path.join(dataDir, 'lichess_db_puzzle.csv.zst');
const csvPath = path.join(dataDir, 'lichess_db_puzzle.csv');

const PUZZLE_URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
const MAX_ROWS = Number(process.env.PUZZLE_MAX_ROWS || process.env.PUZZLE_DB_MAX_ROWS || 0) || Infinity;
const SKIP_DOWNLOAD = process.env.SKIP_PUZZLE_DOWNLOAD === '1';

mkdirSync(dataDir, { recursive: true });

function relative(filePath) {
  return path.relative(rootDir, filePath).replace(/\\/g, '/');
}

function safeUnlink(filePath) {
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch (_err) {
    // Ignore stale temporary files that another process may have already removed.
  }
}

function requestDownload(url, targetPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'http:' ? http : https;
    const req = transport.get(parsed, (res) => {
      const status = Number(res.statusCode) || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirectCount < 5) {
        res.resume();
        const redirected = new URL(res.headers.location, parsed).toString();
        requestDownload(redirected, targetPath, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (status < 200 || status >= 300) {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (body.length < 2048) body += chunk;
        });
        res.on('end', () => reject(new Error(`Download failed: HTTP ${status}${body ? ` ${body}` : ''}`)));
        return;
      }

      pipeline(res, createWriteStream(targetPath)).then(resolve, reject);
    });
    req.on('error', reject);
  });
}

async function downloadFile(url, targetPath) {
  const tempPath = `${targetPath}.download`;
  safeUnlink(tempPath);
  await requestDownload(url, tempPath);
  renameSync(tempPath, targetPath);
}

async function downloadPuzzleArchive() {
  if (SKIP_DOWNLOAD && existsSync(zstPath)) {
    console.log('Using existing puzzle archive without downloading.');
    return;
  }
  if (SKIP_DOWNLOAD && existsSync(csvPath)) {
    console.log('SKIP_PUZZLE_DOWNLOAD=1 and CSV present; skipping download.');
    return;
  }

  if (existsSync(zstPath)) {
    const ageDays = (Date.now() - statSync(zstPath).mtimeMs) / (1000 * 60 * 60 * 24);
    if (ageDays < 14) {
      console.log(`Using cached ${relative(zstPath)} (${ageDays.toFixed(1)} days old).`);
      return;
    }
  }

  console.log(`Downloading ${PUZZLE_URL} ...`);
  await downloadFile(PUZZLE_URL, zstPath);
  console.log(`Saved ${relative(zstPath)}`);
}

async function decompressArchive() {
  if (SKIP_DOWNLOAD && existsSync(csvPath)) return;
  const needsDecompress = !existsSync(csvPath)
    || (existsSync(zstPath) && statSync(zstPath).mtimeMs > statSync(csvPath).mtimeMs);

  if (!needsDecompress) {
    console.log(`Using cached ${relative(csvPath)}`);
    return;
  }

  if (!existsSync(zstPath)) {
    throw new Error('Missing lichess_db_puzzle.csv.zst. Run without SKIP_PUZZLE_DOWNLOAD first.');
  }

  console.log('Decompressing puzzle database (this can take a few minutes)...');
  const csvSize = await decompressZstdStreaming(zstPath, csvPath);
  console.log(`Wrote ${relative(csvPath)} (${(csvSize / 1e6).toFixed(1)} MB)`);
}

/**
 * Decompress a .zst archive to a file using bounded memory.
 *
 * The Lichess puzzle CSV is several GB when decompressed, so we must NOT load
 * the whole thing into RAM (that gets the process OOM-killed on small VMs).
 *
 * Strategy:
 *   1. Prefer the system `zstd` CLI when available (Linux VMs). It streams with
 *      minimal memory and handles any compression level/window size.
 *   2. Otherwise fall back to fzstd's streaming Decompress API (pure JS, works
 *      on Windows). Note fzstd only supports backreference distances up to 32MB,
 *      so it may fail on archives compressed with a very large window — the CLI
 *      path avoids that limitation.
 *
 * Returns the decompressed size in bytes.
 */
async function decompressZstdStreaming(zstPath, outPath) {
  const tmpPath = `${outPath}.decompressing`;
  safeUnlink(tmpPath);

  // 1) System `zstd` CLI (best: streaming, any compression level, tiny memory).
  const zstdBin = await resolveExecutable('zstd');
  if (zstdBin) {
    const { spawn } = await import('child_process');
    const out = createWriteStream(tmpPath);
    let written = 0;
    let lastLog = Date.now();
    await new Promise((resolve, reject) => {
      const child = spawn(zstdBin, ['-d', '-c', zstPath], { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      let exitCode = null;
      let stdoutEnded = false;
      let outFinished = false;
      let settled = false;

      const finish = () => {
        if (settled) return;
        if (!stdoutEnded || !outFinished || exitCode === null) return;
        settled = true;
        if (exitCode === 0) resolve();
        else reject(new Error(`zstd exited with code ${exitCode}: ${err.trim()}`));
      };

      child.stdout.on('data', (c) => {
        written += c.length;
        const now = Date.now();
        if (now - lastLog > 5000) {
          lastLog = now;
          console.log(`  decompressed ${(written / 1e6).toFixed(1)} MB...`);
        }
      });
      child.stdout.pipe(out);
      child.stderr.on('data', (c) => { err += c; });
      out.on('error', reject);
      child.on('error', reject);
      // stdout fully drained → end the write stream.
      child.stdout.on('end', () => {
        stdoutEnded = true;
        out.end();
      });
      // Write stream flushed → mark done.
      out.on('finish', () => {
        outFinished = true;
        finish();
      });
      // Process exited → capture the real exit code.
      child.on('close', (code) => {
        exitCode = code;
        finish();
      });
    });
    renameSync(tmpPath, outPath);
    return statSync(outPath).size;
  }

  // 2) fzstd streaming fallback (pure JS, bounded memory).
  const { Decompress } = await import('fzstd');
  const out = createWriteStream(tmpPath);
  let written = 0;
  let lastLog = Date.now();
  const stream = new Decompress((chunk, isLast) => {
    if (chunk && chunk.length) {
      out.write(Buffer.from(chunk));
      written += chunk.length;
      const now = Date.now();
      if (now - lastLog > 5000) {
        lastLog = now;
        console.log(`  decompressed ${(written / 1e6).toFixed(1)} MB...`);
      }
    }
    if (isLast) out.end();
  });
  for await (const chunk of createReadStream(zstPath)) {
    stream.push(chunk);
    if (out.writableNeedDrain) await once(out, 'drain');
  }
  stream.push(new Uint8Array(0), true);
  await once(out, 'finish');
  renameSync(tmpPath, outPath);
  return written;
}

/** Resolve an executable on PATH, or null if not found. */
async function resolveExecutable(name) {
  const { spawnSync } = await import('child_process');
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'where' : 'which';
  const res = spawnSync(cmd, [name], { stdio: 'ignore' });
  return res.status === 0 ? name : null;
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

  let chess;
  try {
    chess = new Chess(row.FEN);
  } catch (_err) {
    return null;
  }

  const setup = chess.move({
    from: moves[0].slice(0, 2),
    to: moves[0].slice(2, 4),
    promotion: moves[0][4],
  }, { sloppy: true });
  if (!setup) return null;

  const solution = moves.slice(1);
  if (!solution.length) return null;

  return {
    id: String(row.PuzzleId || '').trim(),
    fen: chess.fen(),
    solution,
    rating: Number(row.Rating) || 1500,
    ratingDeviation: Number(row.RatingDeviation) || 0,
    popularity: Number(row.Popularity) || 0,
    plays: Number(row.NbPlays) || 0,
    themes: String(row.Themes || '').trim().split(/\s+/).filter(Boolean),
    gameUrl: String(row.GameUrl || ''),
    openingTags: String(row.OpeningTags || ''),
  };
}

async function main() {
  if (process.env.SKIP_PUZZLE_BUILD === '1') return;
  const { PuzzleStore } = require('../server/api/_lib/sql-puzzles.js');
  const db = new PuzzleStore(path.resolve(process.env.SQLITE_DATABASE_PATH || path.join(dataDir, 'application.sqlite')));
  const legacy = path.join(dataDir, 'puzzles', 'manifest.json');
  let imported = 0;
  try {
    if (process.argv.includes('--chunks')) {
      const manifest = JSON.parse(readFileSync(legacy, 'utf8'));
      for (const chunk of manifest.chunks) {
        const file = path.resolve(path.dirname(legacy), chunk.file);
        if (path.dirname(file) !== path.dirname(legacy)) throw new Error('Invalid puzzle chunk path.');
        const data = JSON.parse(readFileSync(file, 'utf8'));
        const rows = Array.isArray(data) ? data : data.puzzles;
        for (let i = 0; i < rows.length; i += 1000) {
          db.importBatch(rows.slice(i, i + 1000));
          imported += Math.min(1000, rows.length - i);
        }
      }
    } else {
      await downloadPuzzleArchive();
      await decompressArchive();
      let columns = null;
      let batch = [];
      let retained = 0;
      const resume = process.argv.includes('--resume');
      const existing = db.sql.prepare('SELECT 1 FROM puzzles WHERE id=?');
      const lines = createInterface({ input: createReadStream(csvPath, { encoding: 'utf8' }), crlfDelay: Infinity });
      console.log('Importing validated puzzles into SQLite...');
      for await (const line of lines) {
        if (!line.trim()) continue;
        if (!columns) { columns = parseCsvLine(line); continue; }
        const fields = parseCsvLine(line);
        if (resume && existing.get(fields[columns.indexOf('PuzzleId')])) {
          retained++; imported++;
          if (retained % 500000 === 0) console.log(`  ${retained.toLocaleString()} existing puzzles retained...`);
          if (imported >= MAX_ROWS) break;
          continue;
        }
        const puzzle = puzzleFromRow(columns, fields);
        if (!puzzle?.id) continue;
        batch.push(puzzle);
        imported++;
        if (batch.length >= 1000) { db.importBatch(batch); batch = []; }
        if (imported % 100000 === 0) console.log(`  ${imported.toLocaleString()} puzzles imported...`);
        if (imported >= MAX_ROWS) break;
      }
      if (batch.length) db.importBatch(batch);
    }
    if (!imported) throw new Error('No valid puzzles found; existing corpus retained.');
    db.sql.prepare('INSERT OR REPLACE INTO puzzle_meta VALUES (?,?)').run('lastImport', JSON.stringify({ imported, completedAt: new Date().toISOString(), source: 'Lichess' }));
    db.sql.pragma('optimize');
    console.log(`SQL puzzles ready: ${imported.toLocaleString()} imported. Existing user data preserved.`);
  } finally { db.close(); }
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
