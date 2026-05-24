/**
 * Download the Lichess puzzle CSV and compile it into local JSON chunks.
 * Runtime puzzle reads use server/data/puzzles/manifest.json plus chunk-*.json.
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'fs';
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
const chunksDir = path.join(dataDir, 'puzzles');
const nextChunksDir = path.join(dataDir, 'puzzles-next');
const bucketDir = path.join(dataDir, 'puzzle-build-buckets');
const manifestPath = path.join(chunksDir, 'manifest.json');

const PUZZLE_URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
const DEFAULT_CHUNK_BYTES = 25 * 1024 * 1024;
const CHUNK_TARGET_BYTES = Math.max(1024 * 1024, Number(process.env.PUZZLE_JSON_CHUNK_BYTES || DEFAULT_CHUNK_BYTES) || DEFAULT_CHUNK_BYTES);
const MAX_ROWS = Number(process.env.PUZZLE_MAX_ROWS || process.env.PUZZLE_DB_MAX_ROWS || 0) || Infinity;
const SKIP_DOWNLOAD = process.env.SKIP_PUZZLE_DOWNLOAD === '1';
const FORCE_BUILD = process.env.FORCE_PUZZLE_BUILD === '1';

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

  const { decompress } = await import('fzstd');
  console.log('Decompressing puzzle database (this can take a few minutes)...');
  const buffers = [];
  for await (const chunk of createReadStream(zstPath)) {
    buffers.push(chunk);
  }
  const decompressed = Buffer.from(decompress(Buffer.concat(buffers)));
  writeFileSync(csvPath, decompressed);
  console.log(`Wrote ${relative(csvPath)} (${(decompressed.length / 1e6).toFixed(1)} MB)`);
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

function ratingBucket(rating) {
  const bounded = Math.max(400, Math.min(3200, Number(rating) || 1500));
  return Math.floor(bounded / 100) * 100;
}

async function writeStreamText(stream, text) {
  if (!stream.write(text)) await once(stream, 'drain');
}

async function closeStream(stream) {
  stream.end();
  await once(stream, 'finish');
}

function chunkFileName(index) {
  return `chunk-${String(index).padStart(5, '0')}.json`;
}

function chunksAreFresh() {
  if (FORCE_BUILD || !existsSync(csvPath) || !existsSync(manifestPath)) return false;

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const sameLimit = (Number.isFinite(MAX_ROWS) ? MAX_ROWS : null) === (manifest.maxRows || null);
    const sameChunkSize = Number(manifest.chunkTargetBytes) === CHUNK_TARGET_BYTES;
    const hasChunks = Array.isArray(manifest.chunks)
      && manifest.chunks.length > 0
      && manifest.chunks.every((chunk) => existsSync(path.join(chunksDir, chunk.file)));
    return sameLimit
      && sameChunkSize
      && hasChunks
      && statSync(csvPath).mtimeMs <= statSync(manifestPath).mtimeMs;
  } catch (_err) {
    return false;
  }
}

async function bucketCsv() {
  if (!existsSync(csvPath)) {
    throw new Error('CSV missing. Download/decompress failed or was skipped.');
  }

  rmSync(bucketDir, { recursive: true, force: true });
  mkdirSync(bucketDir, { recursive: true });

  const writers = new Map();
  const getWriter = (bucket) => {
    if (!writers.has(bucket)) {
      const filePath = path.join(bucketDir, `${String(bucket).padStart(4, '0')}.ndjson`);
      writers.set(bucket, createWriteStream(filePath, { flags: 'a' }));
    }
    return writers.get(bucket);
  };

  let columns = null;
  let imported = 0;
  let skipped = 0;
  const rl = createInterface({ input: createReadStream(csvPath, { encoding: 'utf8' }), crlfDelay: Infinity });

  console.log('Reading CSV and grouping puzzles by rating...');
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

    await writeStreamText(getWriter(ratingBucket(puzzle.rating)), `${JSON.stringify(puzzle)}\n`);
    imported += 1;
    if (imported % 100000 === 0) console.log(`  ${imported.toLocaleString()} puzzles parsed...`);
    if (imported >= MAX_ROWS) break;
  }

  await Promise.all([...writers.values()].map(closeStream));
  console.log(`Parsed ${imported.toLocaleString()} puzzles (${skipped.toLocaleString()} skipped).`);
  return imported;
}

async function writeJsonChunks(importedCount) {
  rmSync(nextChunksDir, { recursive: true, force: true });
  mkdirSync(nextChunksDir, { recursive: true });

  const header = '{"version":1,"puzzles":[\n';
  const footer = '\n]}\n';
  const separator = ',\n';
  const headerBytes = Buffer.byteLength(header);
  const footerBytes = Buffer.byteLength(footer);
  const separatorBytes = Buffer.byteLength(separator);
  const chunks = [];
  let totalPuzzles = 0;
  let chunkIndex = -1;
  let writer = null;
  let currentBytes = 0;
  let current = null;

  async function startChunk() {
    chunkIndex += 1;
    const file = chunkFileName(chunkIndex);
    writer = createWriteStream(path.join(nextChunksDir, file));
    currentBytes = headerBytes;
    current = {
      id: chunkIndex,
      file,
      count: 0,
      bytes: 0,
      minRating: Infinity,
      maxRating: -Infinity,
      themeCounts: {},
    };
    await writeStreamText(writer, header);
  }

  async function finishChunk() {
    if (!writer || !current) return;
    await writeStreamText(writer, footer);
    currentBytes += footerBytes;
    await closeStream(writer);
    const filePath = path.join(nextChunksDir, current.file);
    current.bytes = statSync(filePath).size;
    current.minRating = Number.isFinite(current.minRating) ? current.minRating : 0;
    current.maxRating = Number.isFinite(current.maxRating) ? current.maxRating : 0;
    chunks.push(current);
    writer = null;
    current = null;
    currentBytes = 0;
  }

  async function addPuzzle(puzzle) {
    const json = JSON.stringify(puzzle);
    const jsonBytes = Buffer.byteLength(json);
    if (!writer) await startChunk();

    const extraBytes = (current.count > 0 ? separatorBytes : 0) + jsonBytes;
    if (current.count > 0 && currentBytes + extraBytes + footerBytes > CHUNK_TARGET_BYTES) {
      await finishChunk();
      await startChunk();
    }

    if (current.count > 0) await writeStreamText(writer, separator);
    await writeStreamText(writer, json);
    currentBytes += (current.count > 0 ? separatorBytes : 0) + jsonBytes;
    current.count += 1;
    current.minRating = Math.min(current.minRating, puzzle.rating);
    current.maxRating = Math.max(current.maxRating, puzzle.rating);
    for (const theme of puzzle.themes || []) {
      current.themeCounts[theme] = (current.themeCounts[theme] || 0) + 1;
    }
    totalPuzzles += 1;
  }

  const bucketFiles = readdirSync(bucketDir)
    .filter((file) => file.endsWith('.ndjson'))
    .sort((a, b) => a.localeCompare(b));

  console.log(`Writing JSON chunks around ${(CHUNK_TARGET_BYTES / (1024 * 1024)).toFixed(1)} MB each...`);
  for (const file of bucketFiles) {
    const rl = createInterface({ input: createReadStream(path.join(bucketDir, file), { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (line.trim()) await addPuzzle(JSON.parse(line));
    }
  }

  await finishChunk();

  const manifest = {
    version: 1,
    format: 'lichess-json-chunks',
    createdAt: new Date().toISOString(),
    source: relative(csvPath),
    chunkTargetBytes: CHUNK_TARGET_BYTES,
    maxRows: Number.isFinite(MAX_ROWS) ? MAX_ROWS : null,
    totalPuzzles,
    chunks,
  };
  writeFileSync(path.join(nextChunksDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  rmSync(chunksDir, { recursive: true, force: true });
  renameSync(nextChunksDir, chunksDir);
  rmSync(bucketDir, { recursive: true, force: true });

  console.log(`Puzzle chunks ready: ${totalPuzzles.toLocaleString()} puzzles in ${chunks.length.toLocaleString()} chunks -> ${relative(chunksDir)}`);
  if (importedCount && importedCount !== totalPuzzles) {
    console.log(`Warning: parsed ${importedCount.toLocaleString()} puzzles but wrote ${totalPuzzles.toLocaleString()}.`);
  }
}

async function buildJsonChunks() {
  if (chunksAreFresh()) {
    console.log(`Using cached ${relative(manifestPath)}`);
    return;
  }

  const importedCount = await bucketCsv();
  await writeJsonChunks(importedCount);
}

async function main() {
  if (process.env.SKIP_PUZZLE_BUILD === '1') {
    console.log('SKIP_PUZZLE_BUILD=1; skipping puzzle chunk build.');
    return;
  }
  await downloadPuzzleArchive();
  await decompressArchive();
  await buildJsonChunks();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
