// Browser-only preference and study data. Never export credentials or account data.
export const QOL_KEY = 'sidastuff.usability';
export const DEFAULTS = Object.freeze({
  rememberPage: true, warnLeaving: true, sidebarCollapsed: false,
  sounds: true, volume: .45, animationMs: 180, coordinates: 'inside',
  legalMoves: true, lastMove: true, clearArrows: true, autoQueen: false,
  contrast: 'normal', palette: 'default', reducedMotion: false, fontSize: 12,
  boardSize: 640, panelWidth: 420, firstMistake: true, notifications: false,
  tenths: true, multiPremoves: false, puzzleTheme: 'mix', puzzleDifficulty: 'normal',
});
export function normalizePreferences(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  const result = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (typeof DEFAULTS[key] === 'boolean' && typeof input[key] === 'boolean') result[key] = input[key];
  }
  for (const [key, min, max] of [['volume', 0, 1], ['animationMs', 0, 700], ['fontSize', 11, 22], ['boardSize', 280, 960], ['panelWidth', 290, 750]]) {
    if (Number.isFinite(input[key])) result[key] = Math.max(min, Math.min(max, input[key]));
  }
  for (const [key, allowed] of Object.entries({ coordinates: ['none', 'inside', 'outside'], contrast: ['normal', 'high'], palette: ['default', 'blue-orange', 'purple-gold'], puzzleTheme: ['mix', 'mate', 'fork', 'pin', 'endgame'], puzzleDifficulty: ['easier', 'normal', 'harder'] })) {
    if (allowed.includes(input[key])) result[key] = input[key];
  }
  return result;
}
export function readJson(key, fallback = null, storage = globalThis.localStorage) {
  try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; }
}
export function writeJson(key, value, storage = globalThis.localStorage) {
  try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export const PREFERENCE_KEYS = [QOL_KEY, 'sidastuff.appearanceSettings', 'sidastuff.engineSettings', 'sidastuff.playPreferences', 'sing.play.setup', 'sidastuff.collapsedPanels', 'sidastuff.orientation.review', 'sidastuff.orientation.play', 'sidastuff.coachSidebarCollapsed', 'openingSource', 'openingFilters'];
export function exportPreferences(storage = globalThis.localStorage) {
  return { version: 1, preferences: Object.fromEntries(PREFERENCE_KEYS.map(key => [key, storage.getItem(key)]).filter(([, value]) => value !== null)) };
}
export function importPreferences(data, storage = globalThis.localStorage) {
  if (data?.version !== 1 || !data.preferences || typeof data.preferences !== 'object') throw new Error('Invalid settings file.');
  const entries = Object.entries(data.preferences);
  if (entries.some(([key, value]) => !PREFERENCE_KEYS.includes(key) || typeof value !== 'string' || value.length > 50000)) throw new Error('The settings file contains unsupported data.');
  // Validate every entry before changing storage.
  const prepared = entries.map(([key, value]) => {
    if (key === 'openingSource') { if (!['lichess', 'masters'].includes(value)) throw new Error('Invalid opening source.'); return [key, value]; }
    const parsed = JSON.parse(value);
    const booleanKey = key.startsWith('sidastuff.orientation.') || key === 'sidastuff.coachSidebarCollapsed';
    if (booleanKey ? typeof parsed !== 'boolean' : !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid preference value.');
    return [key, key === QOL_KEY ? JSON.stringify(normalizePreferences(parsed)) : value];
  });
  const before = prepared.map(([key]) => [key, storage.getItem(key)]);
  try { for (const [key, value] of prepared) storage.setItem(key, value); }
  catch (error) {
    for (const [key, value] of before) { try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch {} }
    throw error;
  }
}
export function studyKey(moves = [], initialFen = '') { return JSON.stringify([initialFen, moves]); }
export function classifyReview(result) {
  const kind = String(result?.classificationKey || result?.classification?.key || result?.classification?.name || result?.classification || '').toLowerCase();
  if (['blunder', 'mistake', 'inaccuracy'].includes(kind)) return kind;
  if (kind.includes('miss')) return 'missed';
  return 'other';
}
export function matchingMoves(results = [], filter = 'all') {
  return results.flatMap((result, index) => filter === 'all' || classifyReview(result) === filter ? [index] : []);
}
export function nextMistake(results, current, direction = 1) {
  const indices = results.flatMap((result, index) => classifyReview(result) !== 'other' ? [index] : []);
  return direction > 0 ? indices.find(index => index > current) ?? indices[0] : indices.slice().reverse().find(index => index < current) ?? indices.at(-1);
}
export function schedulePuzzle(previous = {}, solved, now = Date.now()) {
  const repetitions = solved ? (previous.repetitions || 0) + 1 : 0;
  const days = solved ? Math.min(30, 2 ** Math.min(repetitions, 5)) : 0;
  return { repetitions, due: now + (solved ? days * 86400000 : 600000), updatedAt: now };
}
export function annotatedPgn({ headers = {}, moves = [], results = [], variations = {}, notes = {}, initialFen }, Chess) {
  const game = new Chess(initialFen || undefined);
  const clean = value => String(value ?? '').replace(/[{}]/g, '').replace(/[\r\n]+/g, ' ');
  const fields = { ...headers };
  if (initialFen && initialFen !== new Chess().fen()) { fields.SetUp = '1'; fields.FEN = initialFen; }
  const output = Object.entries(fields).filter(([key, value]) => /^[A-Za-z0-9_]+$/.test(key) && value != null).map(([key, value]) => `[${key} "${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ')}"]`);
  const tokens = [];
  if (notes[-1]?.text) tokens.push(`{${clean(notes[-1].text)}}`);
  for (let index = 0; index < moves.length; index++) {
    const before = game.fen(), turn = game.turn(), number = before.split(' ')[5];
    const move = game.move(moves[index], { sloppy: true }); if (!move) break;
    if (turn === 'w' || index === 0) tokens.push(number + (turn === 'w' ? '.' : '...'));
    tokens.push(move.san);
    const result = results[index], comments = [notes[index]?.text];
    if (result) {
      if (result.classification) comments.push(result.classification?.name || result.classification);
      if (Number.isFinite(result.evalAfter)) comments.push(`[%eval ${(result.evalAfter / 100).toFixed(2)}]`);
    }
    if (comments.filter(Boolean).length) tokens.push(`{${comments.filter(Boolean).map(clean).join(' ')}}`);
    const lines = [];
    if (result?.bestMove && result.bestMove !== result.moveUci) lines.push([[result.bestMove], before]);
    // A PGN RAV is an alternative to the move immediately before it. The
    // workspace stores a branch under the move BEFORE that alternative.
    for (const variation of variations[index - 1] || []) if (variation.moves?.length) lines.push([variation.moves, before]);
    if (index === moves.length - 1) for (const variation of variations[index] || []) if (variation.moves?.length) lines.push([[move.san, ...variation.moves], before]);
    for (const [line, branchFen] of lines) {
      const branch = new Chess(branchFen), branchTokens = [];
      for (const candidate of line) {
        const fen = branch.fen().split(' ');
        let played;
        try { played = branch.move(/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(candidate) ? { from: candidate.slice(0, 2), to: candidate.slice(2, 4), promotion: candidate[4] } : candidate, { sloppy: true }); } catch {}
        if (!played) break;
        if (fen[1] === 'w' || !branchTokens.length) branchTokens.push(fen[5] + (fen[1] === 'w' ? '.' : '...'));
        branchTokens.push(played.san);
      }
      if (branchTokens.length) tokens.push(`(${branchTokens.join(' ')})`);
    }
  }
  tokens.push(['1-0', '0-1', '1/2-1/2'].includes(headers.Result) ? headers.Result : '*');
  return output.join('\n') + '\n\n' + tokens.join(' ');
}
