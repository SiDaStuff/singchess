const path = require('path');
const fs = require('fs');

const CHUNK_DIR = path.join(__dirname, '../../data/puzzles');
const MANIFEST_PATH = path.join(CHUNK_DIR, 'manifest.json');
const CHUNK_CACHE_LIMIT = Math.max(1, Number(process.env.PUZZLE_CHUNK_CACHE_LIMIT || 4) || 4);

let manifest = null;
let manifestError = null;
const chunkCache = new Map();

function loadManifest() {
  if (manifest) return manifest;
  if (manifestError && fs.existsSync(MANIFEST_PATH)) manifestError = null;
  if (manifestError) return null;
  if (!fs.existsSync(MANIFEST_PATH)) {
    manifestError = new Error(`Puzzle chunks missing. Run npm run build:puzzles to create ${path.basename(MANIFEST_PATH)}.`);
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    if (!Array.isArray(parsed.chunks) || parsed.chunks.length === 0) {
      throw new Error('Puzzle manifest has no chunks.');
    }
    manifest = parsed;
    return manifest;
  } catch (err) {
    manifestError = err;
    return null;
  }
}

function isReady() {
  const loaded = loadManifest();
  return !!loaded && loaded.chunks.every((chunk) => fs.existsSync(path.join(CHUNK_DIR, chunk.file)));
}

function loadChunk(chunk) {
  const cacheKey = chunk.file;
  if (chunkCache.has(cacheKey)) {
    const cached = chunkCache.get(cacheKey);
    chunkCache.delete(cacheKey);
    chunkCache.set(cacheKey, cached);
    return cached;
  }

  const filePath = path.join(CHUNK_DIR, chunk.file);
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const puzzles = Array.isArray(parsed) ? parsed : (parsed.puzzles || []);
  chunkCache.set(cacheKey, puzzles);

  while (chunkCache.size > CHUNK_CACHE_LIMIT) {
    const oldest = chunkCache.keys().next().value;
    chunkCache.delete(oldest);
  }

  return puzzles;
}

function ratingWindow(target, difficulty = 'normal') {
  const t = Number(target) || 1500;
  const windows = {
    easiest: [t - 500, t - 250],
    easier: [t - 320, t - 120],
    normal: [t - 150, t + 150],
    harder: [t + 120, t + 320],
    hardest: [t + 250, t + 550],
  };
  const [min, max] = windows[difficulty] || windows.normal;
  return { min: Math.max(400, min), max: Math.min(3200, max) };
}

function normalizeTheme(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function themeTokens(theme) {
  const key = String(theme || 'mix').trim();
  if (!key || key === 'mix') return [];
  return [...new Set([
    normalizeTheme(key),
    normalizeTheme(key.replace(/([A-Z])/g, ' $1')),
    normalizeTheme(key.replace(/_/g, ' ')),
  ].filter(Boolean))];
}

function hasTheme(themes, tokens) {
  if (!tokens.length) return true;
  return (themes || []).some((theme) => {
    const normalized = normalizeTheme(theme);
    return tokens.some((token) => normalized.includes(token) || token.includes(normalized));
  });
}

function chunkHasTheme(chunk, tokens) {
  if (!tokens.length) return true;
  const counts = chunk.themeCounts || {};
  return Object.keys(counts).some((theme) => hasTheme([theme], tokens));
}

function overlapsRating(chunk, min, max) {
  return Number(chunk.maxRating) >= min && Number(chunk.minRating) <= max;
}

function shuffled(items) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function candidateChunks({ min, max, target, theme }) {
  const data = loadManifest();
  if (!data) throw manifestError || new Error('Puzzle chunks are not available.');

  const tokens = themeTokens(theme);
  const ratingMatches = data.chunks.filter((chunk) => overlapsRating(chunk, min, max));
  const themeMatches = tokens.length ? ratingMatches.filter((chunk) => chunkHasTheme(chunk, tokens)) : ratingMatches;
  const list = themeMatches.length ? themeMatches : ratingMatches;
  const ratingTarget = Number(target) || Math.round((min + max) / 2);

  return shuffled(list).sort((a, b) => {
    const ac = (Number(a.minRating) + Number(a.maxRating)) / 2;
    const bc = (Number(b.minRating) + Number(b.maxRating)) / 2;
    return Math.abs(ac - ratingTarget) - Math.abs(bc - ratingTarget);
  });
}

function puzzleMatches(puzzle, query) {
  if (!puzzle) return false;
  if (Number(puzzle.rating) < query.min || Number(puzzle.rating) > query.max) return false;
  if (query.excludeId && puzzle.id === query.excludeId) return false;
  if (query.attemptedIds?.has(puzzle.id)) return false;
  if (!hasTheme(puzzle.themes, query.themeTokens)) return false;
  return true;
}

function pickWeighted(matches, target) {
  if (!matches.length) return null;
  const ratingTarget = Number(target) || 1500;
  matches.sort((a, b) => {
    const ratingDelta = Math.abs(Number(a.rating) - ratingTarget) - Math.abs(Number(b.rating) - ratingTarget);
    if (ratingDelta !== 0) return ratingDelta;
    return (Number(b.popularity) || 0) - (Number(a.popularity) || 0);
  });
  const pool = matches.slice(0, Math.min(40, matches.length));
  return pool[Math.floor(Math.random() * pool.length)] || null;
}

function findPuzzle(query, options = {}) {
  const chunks = candidateChunks(query);
  const maxChunks = Math.max(1, Number(options.maxChunks || 12) || 12);
  const maxMatches = Math.max(1, Number(options.maxMatches || 90) || 90);
  const matches = [];

  for (const chunk of chunks.slice(0, maxChunks)) {
    const puzzles = loadChunk(chunk);
    for (const puzzle of puzzles) {
      if (puzzleMatches(puzzle, query)) {
        matches.push(puzzle);
        if (matches.length >= maxMatches) return pickWeighted(matches, query.target);
      }
    }
  }

  return pickWeighted(matches, query.target);
}

function findDailyPuzzle(query) {
  const chunks = candidateChunks(query);
  const matches = [];

  for (const chunk of chunks.slice(0, 10)) {
    const puzzles = loadChunk(chunk);
    for (const puzzle of puzzles) {
      if (puzzleMatches(puzzle, query)) {
        matches.push(puzzle);
        if (matches.length >= 160) break;
      }
    }
    if (matches.length >= 160) break;
  }

  matches.sort((a, b) => {
    const aScore = (Number(a.popularity) || 0) * 7 + (Number(a.plays) || 0);
    const bScore = (Number(b.popularity) || 0) * 7 + (Number(b.plays) || 0);
    return bScore - aScore;
  });
  return matches;
}

function rowToPayload(row) {
  if (!row) return null;
  return {
    puzzle: {
      id: row.id,
      fen: row.fen,
      solution: Array.isArray(row.solution) ? row.solution.slice() : [],
      rating: row.rating,
      themes: Array.isArray(row.themes) ? row.themes.slice() : [],
      popularity: row.popularity,
      plays: row.plays,
      gameUrl: row.gameUrl,
    },
    game: {
      pgn: '',
      players: [
        { color: 'white', name: 'White', rating: null },
        { color: 'black', name: 'Black', rating: null },
      ],
    },
  };
}

async function getPuzzleById(id) {
  const target = String(id || '').trim();
  if (!target || !isReady()) return null;
  const data = loadManifest();
  for (const chunk of data.chunks) {
    const puzzles = loadChunk(chunk);
    const found = puzzles.find((puzzle) => String(puzzle.id || '') === target);
    if (found) return rowToPayload(found);
  }
  return null;
}

async function getNextPuzzle({ theme = 'mix', difficulty = 'normal', target = 1500, exclude = '', attemptedIds = new Set() }) {
  if (!isReady()) throw manifestError || new Error('Puzzle chunks are not available.');

  const { min, max } = ratingWindow(target, difficulty);
  const query = {
    min,
    max,
    target: Number(target) || 1500,
    excludeId: String(exclude || '').trim(),
    attemptedIds,
    themeTokens: themeTokens(theme),
    theme,
  };

  let picked = findPuzzle(query);
  if (!picked && query.attemptedIds?.size) {
    picked = findPuzzle({ ...query, attemptedIds: new Set() }, { maxChunks: 16, maxMatches: 120 });
  }
  if (!picked && query.themeTokens.length) {
    picked = findPuzzle({ ...query, themeTokens: [], theme: 'mix' }, { maxChunks: 16, maxMatches: 120 });
  }

  return rowToPayload(picked);
}

async function getDailyPuzzle({ attemptedIds = new Set(), date = new Date() }) {
  if (!isReady()) throw manifestError || new Error('Puzzle chunks are not available.');

  const dayKey = date.toISOString().slice(0, 10);
  const hash = [...dayKey].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const target = 1200 + (hash % 1400);
  const query = {
    min: target - 80,
    max: target + 80,
    target,
    excludeId: '',
    attemptedIds,
    themeTokens: [],
    theme: 'mix',
  };

  let matches = findDailyPuzzle(query);
  if (!matches.length && attemptedIds.size) {
    matches = findDailyPuzzle({ ...query, attemptedIds: new Set() });
  }
  const index = hash % Math.max(1, matches.length);
  return rowToPayload(matches[index] || matches[0]);
}

module.exports = {
  CHUNK_DIR,
  MANIFEST_PATH,
  getPuzzleById,
  getNextPuzzle,
  getDailyPuzzle,
  isReady,
  ratingWindow,
  rowToPayload,
};
