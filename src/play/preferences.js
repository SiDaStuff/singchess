// Play inherits the site's appearance on first use; its game controls are isolated.
export const PLAY_BOARD_THEMES = Object.freeze([
  { value: 'classic', label: 'Classic' }, { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' }, { value: 'slate', label: 'Slate' },
  { value: 'walnut', label: 'Walnut' }, { value: 'rose', label: 'Rose' },
]);
export const PLAY_PIECE_SETS = Object.freeze([
  { value: 'cburnett', label: 'Classic' }, { value: 'merida', label: 'Merida' },
  { value: 'chessnut', label: 'Chessnut' }, { value: 'celtic', label: 'Celtic' },
  { value: 'fantasy', label: 'Fantasy' }, { value: 'firi', label: 'Firi' },
  { value: 'kiwen-suwi', label: 'Kiwen Suwi' }, { value: 'rhosgfx', label: 'Rhosgfx' },
  { value: 'spatial', label: 'Spatial' },
]);
export const DEFAULT_PLAY_PREFERENCES = Object.freeze({
  boardTheme: 'classic', pieceTheme: 'cburnett', sounds: true, volume: .45,
  animations: true, legalMoves: true, coordinates: true, autoQueen: false,
  premoves: true, multiPremoves: false, touchConfirm: false, reviewOrientation: 'white',
});
const STORAGE_KEY = 'sidastuff.playPreferences';
export function normalizePlayPreferences(input = {}) {
  const result = { ...DEFAULT_PLAY_PREFERENCES };
  for (const key of ['sounds', 'animations', 'legalMoves', 'coordinates', 'autoQueen', 'premoves', 'multiPremoves', 'touchConfirm']) {
    if (typeof input[key] === 'boolean') result[key] = input[key];
  }
  if (PLAY_BOARD_THEMES.some(theme => theme.value === input.boardTheme)) result.boardTheme = input.boardTheme;
  if (PLAY_PIECE_SETS.some(theme => theme.value === input.pieceTheme)) result.pieceTheme = input.pieceTheme;
  if (Number.isFinite(input.volume)) result.volume = Math.max(0, Math.min(1, input.volume));
  if (input.reviewOrientation === 'black') result.reviewOrientation = 'black';
  return result;
}
export function loadPlayPreferences(storage) {
  try {
    storage ??= globalThis.localStorage;
    const engine = JSON.parse(storage?.getItem('sidastuff.engineSettings') || '{}');
    const appearance = JSON.parse(storage?.getItem('sidastuff.appearanceSettings') || '{}');
    const native = { ...engine, ...appearance };
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || '{}');
    const shared = JSON.parse(storage?.getItem('sidastuff.usability') || '{}');
    // The live board is the same board the rest of the app uses. Appearance is
    // therefore always sourced from the shared appearance settings; Play only
    // owns game-specific controls such as premoves, sounds, and confirmation.
    return normalizePlayPreferences({ ...saved, ...shared, coordinates: typeof shared.coordinates === 'string' ? shared.coordinates !== 'none' : saved.coordinates, boardTheme: native.boardTheme,
      pieceTheme: native.pieceTheme, animations: native.pieceAnimations });
  } catch { return { ...DEFAULT_PLAY_PREFERENCES }; }
}
export function savePlayPreferences(patch, storage) {
  const preferences = normalizePlayPreferences({ ...loadPlayPreferences(storage), ...patch });
  try { storage ??= globalThis.localStorage; storage?.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch { /* Private storage may be unavailable. */ }
  return preferences;
}
