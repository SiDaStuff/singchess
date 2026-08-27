// =============================================================================
// Sing Chess — Chessboard adapter / public API
//
// A thin, framework-free adapter over the existing `ChessBoard` renderer
// (src/board.js). It exposes a clean, settings-friendly API so the existing
// appearance settings (board theme, piece theme, orientation, highlights,
// arrows) can drive the board without touching the renderer's internals.
//
// WHY an adapter instead of a rewrite:
//   • src/board.js is battle-tested and its DOM/CSS contract is coupled to the
//     settings system (body[data-board-theme], body[data-piece-theme], CSS vars).
//   • The board invariant must hold: `.board-wrapper > #chess-board` chain and
//     the sibling overlays (coords, skeleton, badge) stay untouched.
//   • This module only ADDS a clean surface on top; it never rewrites squares.
//
// The adapter reads saved appearance settings from
// `localStorage['sidastuff.appearanceSettings']` (the same key src/app.js
// writes), so existing settings wire in automatically with zero migration.
// =============================================================================

const APPEARANCE_KEY = 'sidastuff.appearanceSettings';
const ENGINE_KEY = 'sidastuff.engineSettings';

/** Read saved appearance settings (appearanceSettings wins over engineSettings). */
function readSavedAppearance() {
  let appearance = {};
  let engine = {};
  try {
    const a = window.localStorage?.getItem(APPEARANCE_KEY);
    if (a) appearance = JSON.parse(a) || {};
  } catch (_) { /* ignore */ }
  try {
    const e = window.localStorage?.getItem(ENGINE_KEY);
    if (e) engine = JSON.parse(e) || {};
  } catch (_) { /* ignore */ }
  return { ...engine, ...appearance };
}

/** Apply a board theme to <body> (mirrors src/app.js `_applyAppearanceSettings`). */
function applyBoardTheme(theme) {
  const value = theme || 'classic';
  document.body.dataset.boardTheme = value;
  document.querySelectorAll('[class*="board-theme-"]').forEach((el) => {
    el.classList.forEach((cls) => {
      if (cls.startsWith('board-theme-')) el.classList.remove(cls);
    });
  });
  if (value !== 'default') document.body.classList.add('board-theme-' + value);
}

/** Apply a piece theme to <body> (mirrors src/app.js _applyAppearanceSettings). */
function applyPieceTheme(style) {
  const normalized = style || 'cburnett';
  document.body.dataset.pieceTheme = normalized;
  document.querySelectorAll('[class*="piece-theme-"]').forEach((el) => {
    el.classList.forEach((cls) => {
      if (cls.startsWith('piece-theme-')) el.classList.remove(cls);
    });
  });
  document.body.classList.add('piece-theme-' + normalized);
}

/**
 * Create a board instance with the given options.
 *
 * @param {object} options
 * @param {string} options.container  - id of the board container (default 'chess-board')
 * @param {string} [options.theme]    - board theme key (classic/green/blue/slate/walnut/rose)
 * @param {string} [options.pieces]   - piece set key (cburnett/celtic/chessnut/…)
 * @param {boolean} [options.orientation] - true = flipped (black at bottom)
 * @returns {object} the wrapped board instance + adapter helpers
 */
export function initBoard({ container = 'chess-board', theme, pieces, orientation } = {}) {
  const saved = readSavedAppearance();

  // Apply theme + pieces to <body> so the renderer + CSS pick them up.
  applyBoardTheme(theme || saved.boardTheme || 'default');
  applyPieceTheme(pieces || saved.pieceTheme || 'cburnett');

  // The existing renderer reads settings itself on construction, but we apply
  // them here too so the adapter is self-contained and order-independent.
  const board = new window.ChessBoard(container);

  if (typeof orientation === 'boolean' && orientation !== board.flipped) {
    board.flip();
  }

  return {
    // --- core renderer passthrough -----------------------------------------
    board,
    setPositionFromFen: (fen) => board.setPositionFromFen(fen),
    setChessInstance: (chess) => board.setChessInstance(chess),
    flip: () => board.flip(),
    enableAnimations: (on) => board.enableAnimations(on),
    skipNextSlide: () => board.skipNextSlide(),
    animateNextUpdate: () => board.animateNextUpdate(),
    setLoading: (sq, msg) => board.setLoading(sq, msg),
    setLoadingProgress: (pct, label) => board.setLoadingProgress(pct, label),
    clearLoading: () => board.clearLoading(),
    destroy: () => board.destroy(),

    // --- theme / pieces (settings hooks) ----------------------------------
    updateTheme: (t) => { applyBoardTheme(t); return board; },
    setPieces: (s) => { applyPieceTheme(s); return board; },
    flipOrientation: () => board.flip(),

    // --- highlights / arrows / overlays -----------------------------------
    applyHighlights: (highlights) => board.setHighlights(highlights),
    clearHighlights: () => board.setHighlights([]),
    applyArrows: (arrows) => {
      board.clearUserArrows();
      (arrows || []).forEach((a) => board.addUserArrow(a.from, a.to, a.options));
      return board;
    },
    clearArrows: () => board.clearUserArrows(),
    setBestMoveArrow: (uci, options) => board.setBestMoveArrow(uci, options),
    clearBestMoveArrow: () => board.clearBestMoveArrow(),
    toggleInvertedSquare: (sq) => board.toggleInvertedSquare(sq),
    clearInvertedSquares: () => board.clearInvertedSquares(),

    // --- interaction hooks ------------------------------------------------
    set onMove(fn) { board.onMove = fn; },
    set onFlip(fn) { board.onFlip = fn; },
    set interactive(v) { board.interactive = v; },
  };
}

// Expose a global so the existing (non-module) app code can call it too.
window.SingChessBoard = { initBoard, applyBoardTheme, applyPieceTheme };