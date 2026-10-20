import { Chess } from 'chess.js';
import { normalizePlayPreferences } from './preferences.js';

const FILES = 'abcdefgh';
const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const colorCode = color => color === 'black' || color === 'b' ? 'b' : 'w';

/** Online rules adapter for the same ChessBoard used in Review and puzzles.
 * Owns no board renderer, piece layer, pointer handling, or square styling. */
export class LiveGameInput {
  constructor(renderer, { onMove, onFeedback, onPremoveChange, preferences = {}, playerColor = 'white' } = {}) {
    this.renderer = renderer;
    this.container = renderer.wrapper;
    this.preferences = normalizePlayPreferences(preferences);
    this.onMove = onMove; this.onFeedback = onFeedback; this.onPremoveChange = onPremoveChange;
    this.playerColor = colorCode(playerColor);
    this.chess = new Chess(); this.fen = null; this.pending = false; this.interactive = false;
    this.premoves = [];
    this.status = document.createElement('span'); this.status.className = 'sr-only';
    this.status.setAttribute('role', 'status'); this.container.append(this.status);
    renderer._getLegalMovesFrom = square => this._canSelect(square) ? this._targets(square) : [];
    renderer._selectSquare = square => this._activate(square, this.inputOptions);
    renderer.onMove = (from, to) => this._tryMove(from, to, this.inputOptions);
    this.inputOptions = {};
    renderer._addDestroyableListener(renderer.container, 'pointerdown', event => {
      this.inputOptions = { touch: event.pointerType === 'touch', forcePromotion: event.shiftKey };
    }, true);
    renderer._addDestroyableListener(renderer.container, 'keydown', event => {
      this.inputOptions = { forcePromotion: event.shiftKey };
      if (event.key === 'Escape') { this.cancelPremove(); this._select(null); this._closeDialog(true); }
    }, true);
    this.setPreferences(this.preferences);
  }
  get selected() { return this.renderer.selectedSquare; }
  get premove() { return this.premoves[0] || null; }
  get planning() { return this.chess.turn() !== this.playerColor || !!this.optimisticFen || this.premoves.length > 0; }
  get inputChess() { return this.queuePosition || this.chess; }
  rebuildQueuePosition() {
    const position = new Chess(this.optimisticFen || this.fen || this.chess.fen());
    for (const move of this.premoves) {
      const piece = position.get(move.from); if (!piece) continue;
      position.remove(move.from); position.remove(move.to);
      position.put({ color: piece.color, type: move.promotion || piece.type }, move.to);
      if (piece.type === 'k' && Math.abs(move.to.charCodeAt(0) - move.from.charCodeAt(0)) === 2) {
        const kingside = move.to[0] > move.from[0], rank = move.to[1], rook = position.get((kingside ? 'h' : 'a') + rank);
        if (rook) { position.remove((kingside ? 'h' : 'a') + rank); position.put(rook, (kingside ? 'f' : 'd') + rank); }
      }
    }
    this.queuePosition = position;
  }
  get orientation() { return this.renderer.flipped ? 'b' : 'w'; }
  get squares() { return new Map([...this.renderer.container.querySelectorAll('[data-square]')].map(cell => [cell.dataset.square, cell])); }
  _announce(message) { this.status.textContent = message; this.onFeedback?.(message); }
  _clearGesture() { this.renderer.cancelDrag?.(); }
  _select(square) {
    this.renderer.selectedSquare = square;
    this.renderer.legalMoves = square ? this._targets(square) : [];
    this._paint();
  }
  _paint() {
    this.renderer.interactive = this.interactive && (!this.pending || !!this.optimisticFen && this.preferences.premoves) && !this.dialog;
    const lastFrom = typeof this.lastMove === 'string' ? this.lastMove.slice(0, 2) : this.lastMove?.from;
    const lastTo = typeof this.lastMove === 'string' ? this.lastMove.slice(2, 4) : this.lastMove?.to;
    this.renderer.setHighlights([
      ...[lastFrom, lastTo].filter(Boolean).map(square => ({ square, type: 'highlight' })),
      ...this.premoves.flatMap(move => [move.from, move.to]).map(square => ({ square, type: 'highlight', color: '#5095d476' })),
    ]);
  }
  setPosition(fen, options = {}) {
    const next = new Chess();
    if (!next.load(fen)) { this._announce('The game position could not be loaded. Reconnecting...'); return false; }
    const changed = this.fen !== next.fen();
    const colorChanged = options.playerColor !== undefined && colorCode(options.playerColor) !== this.playerColor;
    if (options.playerColor !== undefined) this.playerColor = colorCode(options.playerColor);
    if (options.interactive !== undefined) this.interactive = Boolean(options.interactive);
    if (options.pending !== undefined) this.pending = Boolean(options.pending);
    else if (changed) this.pending = false;
    if (changed || !this.interactive || colorChanged) {
      this._clearGesture(); this._closeDialog(); this._select(null);
    }
    if (!this.interactive || colorChanged) this.cancelPremove();
    this.chess = next; this.fen = next.fen();
    this.lastMove = options.lastMove ?? (changed ? null : this.lastMove);
    this.renderer.setChessInstance(next);
    if (changed || options.forceRender) {
      if (window.QualityOfLife?.preferences().clearArrows !== false) { this.renderer.clearUserArrows(); this.renderer.clearInvertedSquares(); }
      this.renderer.animateNextUpdate(); this.renderer.setPositionFromFen(this.fen);
      this.optimisticFen = null;
    }
    this.renderer.checkSquare = next.in_check() ? Object.keys(this.renderer.position).find(square => this.renderer.position[square] === next.turn() + 'K') : null;
    this.rebuildQueuePosition();
    this._paint();
    if (changed && this.interactive && !this.pending && next.turn() === this.playerColor && this.premove) {
      const move = this.premoves.shift(); this.rebuildQueuePosition(); this.onPremoveChange?.(this.premove); this._paint();
      if (this._legalMove(move.from, move.to, move.promotion)) this._submit(move.from + move.to + (move.promotion || ''));
      else { this.cancelPremove(); this.status.textContent = 'Premove cancelled.'; }
    }
    return true;
  }
  setPending(value) { this.pending = Boolean(value); this._paint(); }
  showOptimisticMove(uci) {
    const preview = new Chess(this.fen);
    const move = preview.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) });
    if (!move) return false;
    this.optimisticFen = preview.fen();
    this.rebuildQueuePosition();
    this.renderer.setChessInstance(preview);
    this.renderer.skipNextSlide();
    this.renderer.setPositionFromFen(this.optimisticFen);
    this.lastMove = uci;
    this._paint();
    return true;
  }
  restoreAuthoritative() {
    if (!this.optimisticFen) return;
    this.optimisticFen = null;
    this.rebuildQueuePosition();
    this.renderer.setChessInstance(this.chess);
    this.renderer.setPositionFromFen(this.fen);
    this._paint();
  }
  setOrientation(color) { if (colorCode(color) !== this.orientation) this.flip(); }
  flip() { this._clearGesture(); this._closeDialog(); this.renderer.flip(); this._paint(); }
  setPreferences(patch) {
    this.preferences = normalizePlayPreferences({ ...this.preferences, ...patch });
    if (!this.preferences.premoves) this.cancelPremove();
    this.container.classList.toggle('hide-legal-moves', !this.preferences.legalMoves);
    this.container.classList.toggle('hide-coordinates', !this.preferences.coordinates);
    this._paint();
  }
  _canSelect(square) {
    return this.interactive && !this.renderer.drawMode && (!this.pending || !!this.optimisticFen && this.preferences.premoves) && this.inputChess.get(square)?.color === this.playerColor &&
      (!this.planning || this.preferences.premoves);
  }
  _legalMove(from, to, promotion) {
    return this.chess.moves({ square: from, verbose: true }).find(move => move.to === to && (!move.promotion || move.promotion === (promotion || 'q')));
  }
  _premoveTargets(from) {
    const piece = this.inputChess.get(from);
    if (!piece || piece.color !== this.playerColor) return [];
    const x = FILES.indexOf(from[0]), y = Number(from[1]), result = [];
    const add = (dx, dy) => {
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || tx > 7 || ty < 1 || ty > 8) return false;
      const square = FILES[tx] + ty, target = this.inputChess.get(square);
      // A friendly piece may move away during the opponent's turn. Keep that
      // square selectable as a premove destination, then validate it when the
      // authoritative position arrives.
      result.push(square); return !target;
    };
    if (piece.type === 'p') {
      const step = piece.color === 'w' ? 1 : -1;
      const forward = FILES[x] + (y + step);
      if (add(0, step) && y === (piece.color === 'w' ? 2 : 7)) add(0, 2 * step);
      add(-1, step); add(1, step);
    } else if (piece.type === 'n') {
      for (const [dx, dy] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) add(dx, dy);
    } else if (piece.type === 'k') {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) add(dx, dy);
      if (from === (piece.color === 'w' ? 'e1' : 'e8')) {
        if (this.inputChess.get('h' + y)?.type === 'r') add(2, 0);
        if (this.inputChess.get('a' + y)?.type === 'r') add(-2, 0);
      }
    } else {
      const directions = piece.type === 'b' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : piece.type === 'r' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of directions) for (let distance = 1; distance < 8; distance++) if (!add(dx * distance, dy * distance)) break;
    }
    return result;
  }
  _targets(from) {
    return !this.planning ? this.chess.moves({ square: from, verbose: true }).map(move => move.to) : this._premoveTargets(from);
  }
  _activate(square, options = {}) {
    if (!this.interactive || this.pending && !this.optimisticFen || this.dialog) return;
    if (this.selected && this.selected !== square) {
      if (this._targets(this.selected).includes(square)) { this._tryMove(this.selected, square, options); return; }
      if (!this._canSelect(square)) { this._illegal(square); this._select(null); return; }
    }
    if (this._canSelect(square)) { if (!this.preferences.multiPremoves) this.cancelPremove(); this._select(this.selected === square ? null : square); }
    else { this.cancelPremove(); this._select(null); }
  }
  _illegal(square) {
    const cell = this.squares.get(square);
    cell?.classList.add('is-illegal');
    clearTimeout(this.illegalTimer);
    this.illegalTimer = setTimeout(() => cell?.classList.remove('is-illegal'), 220);
    this._announce('That move is not legal.');
  }
  _tryMove(from, to, { forcePromotion = false, touch = false } = {}) {
    this.inputOptions = { ...this.inputOptions, to };
    if (!this._canSelect(from) || this.dialog) return;
    if (!this._targets(from).includes(to)) { this._illegal(to); this._select(null); return; }
    const piece = this.inputChess.get(from), promotes = piece?.type === 'p' && (to[1] === '1' || to[1] === '8');
    const finish = promotion => {
      this._select(null);
      if (this.planning) {
        if (!this.preferences.multiPremoves) this.premoves = [];
        if (this.premoves.length >= 10) return;
        this.premoves.push({ from, to, ...(promotion ? { promotion } : {}) }); this.rebuildQueuePosition();
        this.onPremoveChange?.({ ...this.premove }); this._paint();
        this.status.textContent = `${this.premoves.length} premove${this.premoves.length === 1 ? '' : 's'} queued. Escape cancels.`;
      } else if (touch && this.preferences.touchConfirm) this._confirm(from, to, promotion);
      else this._submit(from + to + (promotion || ''));
    };
    if (promotes && (!this.preferences.autoQueen || forcePromotion)) this._promotion(piece.color, finish);
    else finish(promotes ? 'q' : undefined);
  }
  _submit(uci) {
    if (this.pending || !this.interactive || this.chess.turn() !== this.playerColor || !this._legalMove(uci.slice(0, 2), uci.slice(2, 4), uci[4])) return;
    this.pending = true; this._paint();
    this.status.textContent = 'Sending move...';
    try { this.onMove?.(uci); }
    catch { this.pending = false; this._paint(); this._announce('The move could not be sent. Please try again.'); }
  }
  cancelPremove() {
    if (!this.premove) return;
    this.premoves = []; this.rebuildQueuePosition(); this.onPremoveChange?.(null); this._paint();
  }

  _openDialog(label) {
    this._closeDialog(); this._clearGesture();
    const overlay = document.createElement('div'); overlay.className = 'play-board-dialog';
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', label);
    const panel = document.createElement('div'); panel.className = 'play-board-dialog-panel';
    const title = document.createElement('strong'); title.textContent = label; panel.append(title); overlay.append(panel);
    this.dialog = overlay; this.container.append(overlay); this._paint();
    overlay.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this._closeDialog(true); }
      if (event.key === 'Tab') {
        const buttons = [...overlay.querySelectorAll('button')], first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    overlay.addEventListener('pointerdown', event => {
      // Clicking the dimmed backdrop (outside the panel) dismisses the dialog.
      if (event.target === overlay) this._closeDialog(true);
      else event.stopPropagation();
    });
    return panel;
  }
  _closeDialog(refocus = false) {
    this.dialog?.remove(); this.dialog = null; this._paint();
    if (refocus) this.renderer.container.focus({ preventScroll: true });
  }
  _promotion(color, finish) {
    const panel = this._openDialog('Choose promotion');
    const square = this.inputOptions?.to || this.selected;
    if (square) {
      this.dialog.dataset.promotionSquare = square;
      const target = this.renderer.container.querySelector(`[data-square="${square}"]`), bounds = target?.getBoundingClientRect(), wrapper = this.container.getBoundingClientRect();
      if (bounds) { panel.style.left = Math.min(Math.max(0, bounds.left - wrapper.left - 100), Math.max(0, wrapper.width - 260)) + 'px'; panel.style.top = Math.min(Math.max(0, bounds.top - wrapper.top), Math.max(0, wrapper.height - 160)) + 'px'; }
    }
    const choices = document.createElement('div'); choices.className = 'play-promotion-choices';
    for (const type of ['q', 'r', 'b', 'n']) {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-label', `Promote to ${NAMES[type]}`);
      const image = document.createElement('img'); image.src = globalThis.getPieceSvgUri(color + type.toUpperCase()); image.alt = ''; button.append(image);
      button.addEventListener('click', () => { this._closeDialog(true); finish(type); }); choices.append(button);
    }
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.className = 'play-dialog-cancel';
    cancel.addEventListener('click', () => this._closeDialog(true));
    panel.append(choices, cancel); choices.firstChild.focus();
  }
  _confirm(from, to, promotion) {
    const submit = () => this._submit(from + to + (promotion || ''));
    if (window.Swal?.fire) {
      this._closeDialog(true);
      window.Swal.fire({
        icon: 'question',
        title: `Play ${from} to ${to}?`,
        showCancelButton: true,
        confirmButtonText: 'Play move',
        cancelButtonText: 'Cancel',
        allowOutsideClick: true,
        reverseButtons: false,
      }).then(result => { if (result.isConfirmed && this.container.isConnected) submit(); this._paint(); });
      return;
    }
    const panel = this._openDialog(`Play ${from} to ${to}?`);
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = 'Play move';
    confirm.addEventListener('click', () => { this._closeDialog(true); submit(); });
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this._closeDialog(true)); panel.append(confirm, cancel); confirm.focus();
  }
  destroy() {
    clearTimeout(this.illegalTimer); this._closeDialog(); this.status.remove();
    this.renderer.destroy(); this.renderer.container.replaceChildren();
  }
}
