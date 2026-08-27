// =============================================================================
// Chessboard.js — Sing Chess redesign
//
// A self-contained, dependency-free chessboard built with CSS grid.
// Reads the EXISTING appearance settings so users keep their saved themes:
//   • localStorage 'sidastuff.appearanceSettings' (+ fallback 'sidastuff.engineSettings')
//   • body[data-board-theme] = classic | green | blue | slate | walnut | rose
//   • body[data-piece-theme] = cburnett | celtic | chessnut | fantasy | firi |
//                              kiwen-suwi | merida | rhosgfx | spatial
//   • pieces served from /assets/pieces/{set}/{color}{piece}.svg
//
// CLEAN PUBLIC API (exactly what the brief requires):
//   setTheme(theme)     – board square theme key
//   setPieces(pieceSet) – pieces asset folder key
//   flip()              – toggle orientation
//   highlight(squares)  – [{square, type}] tinted overlays; [] clears
//   drawArrows(arrows)  – [{from, to, color?}] SVG arrows; [] clears
//
// Plus convenience: setPosition(fen), destroy(), onMove callback.
// =============================================================================

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const APPEARANCE_KEY = 'sidastuff.appearanceSettings';
const ENGINE_KEY = 'sidastuff.engineSettings';

const PIECE_ASSET_THEMES = new Set([
  'cburnett', 'celtic', 'chessnut', 'fantasy', 'firi',
  'kiwen-suwi', 'merida', 'rhosgfx', 'spatial',
]);

/** Read saved appearance settings (appearance wins over engine). */
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

/** Persist a partial appearance update. */
function writeSavedAppearance(patch) {
  const next = { ...readSavedAppearance(), ...patch };
  try { window.localStorage?.setItem(APPEARANCE_KEY, JSON.stringify(next)); } catch (_) { /* ignore */ }
}

/** Chessboard — full grid-based board component. */
export default class Chessboard {
  /**
   * @param {object}  opts
   * @param {string}  opts.container        id (or element) of the grid container
   * @param {string}  opts.arrowsLayer      id (or element) of the SVG overlay
   * @param {string}  [opts.theme]          board theme (default: from settings)
   * @param {string}  [opts.pieces]         piece set (default: from settings)
   * @param {boolean} [opts.orientation]    true = black at bottom
   * @param {boolean} [opts.coordinates]    show file/rank coordinates
   */
  constructor({
    container,
    arrowsLayer,
    theme,
    pieces,
    orientation = false,
    coordinates = true,
  } = {}) {
    this.el = typeof container === 'string' ? document.getElementById(container) : container;
    this.arrowsEl = typeof arrowsLayer === 'string' ? document.getElementById(arrowsLayer) : arrowsLayer;
    if (!this.el) throw new Error(`Chessboard: container "${container}" not found`);
    if (!this.arrowsEl) throw new Error(`Chessboard: arrowsLayer "${arrowsLayer}" not found`);

    // Apply saved settings to <body> so the CSS vars in globals.css resolve.
    const saved = readSavedAppearance();
    this.currentTheme = theme || saved.boardTheme || 'classic';
    this.currentPieces = pieces || saved.pieceTheme || 'cburnett';
    this.flipped = !!orientation;
    this.showCoordinates = coordinates;

    this.position = {};          // { e4: 'wP', ... }
    this.squareEls = new Map();  // 'e4' -> element
    this.highlights = [];        // [{square, type, cssClass}]
    this.lastMove = null;        // {from, to}
    this.selected = null;        // square string
    this.checkSquare = null;
    this._arrows = [];

    this.onMove = null;          // callback(from, to, promotion?)
    this.interactive = false;

    this._renderGrid();
    this.setTheme(this.currentTheme);
    this.setPieces(this.currentPieces);
    this._bindInteraction();

    this.updateViewBox();
    this._onResize = () => {
      this.updateViewBox();
      this._renderArrows();
    };
    window.addEventListener('resize', this._onResize, { passive: true });
  }

  // ──────────────────────────────────────────────────────────────────────
  //  RENDERING
  // ──────────────────────────────────────────────────────────────────────

  /** Build the 8x8 grid once. Order depends on orientation. */
  _renderGrid() {
    this.el.innerHTML = '';
    this.el.classList.add('sc-board');
    this.squareEls.clear();

    for (const sq of this._squaresInOrder()) {
      const isLight = this._isLight(sq);
      const cell = document.createElement('div');
      cell.className = `sc-square ${isLight ? 'light' : 'dark'}`;
      cell.dataset.square = sq;

      if (this.showCoordinates) {
        const [file, rank] = [sq[0], sq[1]];
        const atFileEdge = this.flipped ? file === 'h' : file === 'a';
        const atRankEdge = this.flipped ? rank === '1' : rank === '8';
        if (atFileEdge) {
          const c = document.createElement('span');
          c.className = 'sc-coord file';
          c.textContent = file;
          cell.appendChild(c);
        }
        if (atRankEdge) {
          const c = document.createElement('span');
          c.className = 'sc-coord rank';
          c.textContent = rank;
          cell.appendChild(c);
        }
      }

      this.el.appendChild(cell);
      this.squareEls.set(sq, cell);
    }
  }

  /** All 64 squares in visual order (row-major from the top of the board). */
  _squaresInOrder() {
    const ranks = this.flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
    const files = this.flipped ? [...FILES].reverse() : FILES;
    const out = [];
    for (const r of ranks) for (const f of files) out.push(`${f}${r}`);
    return out;
  }

  _isLight(sq) {
    const fileIdx = FILES.indexOf(sq[0]);
    const rank = parseInt(sq[1], 10);
    return (fileIdx + rank) % 2 === 1;
  }

  /** Place / clear pieces based on this.position. */
  _renderPieces() {
    for (const [sq, cell] of this.squareEls) {
      // keep coords, drop stale piece + hint
      cell.querySelectorAll('.sc-piece, .sc-hint').forEach((n) => n.remove());
      const code = this.position[sq];
      if (code) {
        const img = document.createElement('img');
        img.className = 'sc-piece';
        img.src = this._pieceUri(code);
        img.alt = this._pieceName(code);
        img.draggable = false;
        cell.appendChild(img);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  PUBLIC API — setTheme / setPieces / flip / highlight / drawArrows
  // ──────────────────────────────────────────────────────────────────────

  /** Apply a board theme. Writes body[data-board-theme] so globals.css picks
   *  up the --color-sq-* vars. */
  setTheme(theme) {
    const value = theme || 'classic';
    this.currentTheme = value;
    document.documentElement.dataset.boardTheme = value;
    document.body.dataset.boardTheme = value;

    // Keep the legacy .board-theme-* class in sync (existing settings logic).
    [document.documentElement, document.body].forEach((node) => {
      node.className = node.className.replace(/board-theme-\w+/g, '').replace(/\s+/g, ' ').trim();
    });
    document.body.classList.add('board-theme-' + value);
    // Persist so the rest of the app stays in sync.
    writeSavedAppearance({ boardTheme: value });
    this.updateViewBox();
    return this;
  }

  /** Apply a piece set. Writes body[data-piece-theme]. */
  setPieces(pieceSet) {
    const value = PIECE_ASSET_THEMES.has(pieceSet) ? pieceSet : 'cburnett';
    this.currentPieces = value;
    document.documentElement.dataset.pieceTheme = value;
    document.body.dataset.pieceTheme = value;

    [document.documentElement, document.body].forEach((node) => {
      node.className = node.className.replace(/piece-theme-\w+/g, '').replace(/\s+/g, ' ').trim();
    });
    document.body.classList.add('piece-theme-' + value);
    writeSavedAppearance({ pieceTheme: value });
    this._renderPieces();
    return this;
  }

  /** Flip orientation (black <-> white at bottom). */
  flip() {
    this.flipped = !this.flipped;
    this._renderGrid();
    this._renderPieces();
    this._applyOverlays();
    this._renderArrows();
    return this;
  }

  /**
   * Highlight squares. Accepts an array of:
   *   - strings: 'e4'
   *   - objects: { square: 'e4', type: 'last'|'check'|'selected'|'hint' }
   * Pass [] to clear all highlights.
   */
  highlight(squares = []) {
    this.highlights = squares.map((s) =>
      typeof s === 'string' ? { square: s, type: 'highlight' } : s
    );
    this._applyOverlays();
    return this;
  }

  /**
   * Draw arrows over the board. Accepts an array of:
   *   { from: 'e2', to: 'e4', color?: '#1c1e25' }
   * Pass [] to clear all arrows.
   */
  drawArrows(arrows = []) {
    this._arrows = arrows.filter((a) => a && a.from && a.to);
    this._renderArrows();
    return this;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  CONVENIENCE — used by the preview but generally useful
  // ──────────────────────────────────────────────────────────────────────

  /** Set a position from FEN. Animations optional (off by default). */
  setPosition(fen, { lastMove = null } = {}) {
    this.position = this._parseFen(fen);
    this.lastMove = lastMove;
    this._renderPieces();
    this._applyOverlays();
    return this;
  }

  highlightLastMove(from, to) {
    this.lastMove = { from, to };
    this._applyOverlays();
    return this;
  }

  setInteractive(v) { this.interactive = !!v; return this; }
  destroy() {
    window.removeEventListener('resize', this._onResize);
    this.el.innerHTML = '';
    this.squareEls.clear();
  }

  /** Keep the SVG overlay coordinate system square. */
  updateViewBox() {
    const r = this.el.getBoundingClientRect();
    const w = Math.round(r.width) || 8;
    this.arrowsEl.setAttribute('viewBox', `0 0 ${w} ${w}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  INTERNAL — overlays + arrows
  // ──────────────────────────────────────────────────────────────────────

  _applyOverlays() {
    // Clear all overlay classes + hint nodes
    for (const [, cell] of this.squareEls) {
      cell.classList.remove('highlight', 'last-move', 'selected', 'check');
      cell.querySelectorAll('.sc-hint').forEach((n) => n.remove());
    }

    // last move
    if (this.lastMove) {
      [this.lastMove.from, this.lastMove.to].forEach((sq) => {
        const cell = this.squareEls.get(sq);
        if (cell) {
          cell.classList.add('last-move');
          if (cell.classList.contains('dark')) cell.classList.add('dark');
        }
      });
    }

    // explicit highlights
    for (const h of this.highlights) {
      const cell = this.squareEls.get(h.square);
      if (!cell) continue;
      switch (h.type) {
        case 'selected':
          cell.classList.add('selected');
          break;
        case 'check':
          cell.classList.add('check');
          break;
        case 'hint':
          cell.classList.add('selected');
          const hint = document.createElement('span');
          hint.className = this.position[h.square] ? 'sc-hint capture' : 'sc-hint move';
          cell.appendChild(hint);
          break;
        case 'last':
          cell.classList.add('last-move');
          break;
        default:
          cell.classList.add('highlight');
      }
    }
  }

  _renderArrows() {
    this.arrowsEl.innerHTML = '';
    if (!this._arrows.length) return;
    const cellSize = (this.arrowsEl.viewBox.baseVal.width || 8) / 8;

    // Build the marker
    const defs = this._svgEl('defs');
    const marker = this._svgEl('marker', {
      id: 'sc-arrow-head',
      markerWidth: '3.2',
      markerHeight: '3.2',
      refX: '1.6',
      refY: '1.6',
      orient: 'auto',
    });
    const triangle = this._svgEl('path', {
      d: 'M0,0 L3.2,1.6 L0,3.2 z',
    });
    marker.appendChild(triangle);
    defs.appendChild(marker);
    this.arrowsEl.appendChild(defs);

    for (const a of this._arrows) {
      const color = a.color || getComputedStyle(document.documentElement)
        .getPropertyValue('--annotation-arrow-color').trim() || '#1c1e25';
      const { x: x1, y: y1 } = this._squareCenter(a.from, cellSize);
      const { x: x2, y: y2 } = this._squareCenter(a.to, cellSize);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const shorten = cellSize * 0.55; // pull arrowhead just inside the target square
      const ex = x2 - Math.cos(angle) * shorten;
      const ey = y2 - Math.sin(angle) * shorten;
      const line = this._svgEl('line', {
        x1: x1.toFixed(3),
        y1: y1.toFixed(3),
        x2: ex.toFixed(3),
        y2: ey.toFixed(3),
        stroke: color,
        'stroke-width': (cellSize * 0.22).toFixed(3),
        'stroke-linecap': 'round',
        'marker-end': 'url(#sc-arrow-head)',
      });
      // Color the arrowhead too
      triangle.setAttribute('fill', color);
      this.arrowsEl.appendChild(line);
    }
  }

  _squareCenter(sq, cellSize) {
    const [file, rank] = [FILES.indexOf(sq[0]), parseInt(sq[1], 10)];
    const col = this.flipped ? 7 - file : file;
    const row = this.flipped ? rank - 1 : 8 - rank;
    return { x: (col + 0.5) * cellSize, y: (row + 0.5) * cellSize };
  }

  _svgEl(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  INTERNAL — pieces + FEN
  // ──────────────────────────────────────────────────────────────────────

  _pieceUri(code) {
    const set = this.currentPieces || 'cburnett';
    return `/assets/pieces/${set}/${code[0]}${code[1].toLowerCase()}.svg`;
  }

  _pieceName(code) {
    const names = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };
    return `${code[0] === 'w' ? 'white' : 'black'} ${names[code[1]] || 'piece'}`;
  }

  _parseFen(fen) {
    const out = {};
    const rows = (fen?.split(' ')[0] || '').split('/');
    for (let r = 0; r < 8 && r < rows.length; r++) {
      let col = 0;
      for (const ch of rows[r]) {
        if (ch >= '1' && ch <= '8') col += parseInt(ch, 10);
        else {
          const color = ch === ch.toUpperCase() ? 'w' : 'b';
          out[`${FILES[col]}${8 - r}`] = color + ch.toUpperCase();
          col++;
        }
      }
    }
    return out;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  INTERACTION — simple click-to-move (no full move validation; callers
  //  pass chess.js rules via onMove). Good enough for the redesign demo and
  //  for analysis where the host app validates moves.
  // ──────────────────────────────────────────────────────────────────────
  _bindInteraction() {
    if (this._bound) return;
    this._bound = true;
    this.el.addEventListener('click', (e) => {
      if (!this.interactive) return;
      const cell = e.target.closest('.sc-square');
      if (!cell) return;
      const sq = cell.dataset.square;

      if (!this.selected) {
        // Selecting a non-empty square
        if (this.position[sq]) {
          this.selected = sq;
          this.highlight([{ square: sq, type: 'selected' }]);
        }
        return;
      }

      // Clicking the same square deselects
      if (sq === this.selected) {
        this.selected = null;
        this.highlight([]);
        return;
      }

      // Attempt a move
      const from = this.selected;
      this.selected = null;
      this.highlight([]);
      if (typeof this.onMove === 'function') {
        this.onMove(from, sq);
      }
    });
  }
}

// Expose globally so non-module code can use it too.
window.Chessboard = Chessboard;
