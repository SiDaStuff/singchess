// Chess Board UI Module
class ChessBoard {
	  constructor(containerId) {
	    this.container = document.getElementById(containerId);
	    this._applySavedVisualSettings();
	    this.wrapper = this.container?.parentElement || null;
    this.flipped = false;
    this.position = {};  // { 'e1': 'wK', ... }
    this.highlights = []; // [{ square, type }]
    this.bestMoveArrow = null;
    this.userArrows = [];
    this.invertedSquares = new Set();
    this.annotationPointer = null;
    this.selectedSquare = null;
    this.legalMoves = [];
    this.onMove = null; // callback(from, to)
    this.onFlip = null;
    this.interactive = false;
    this.dragPiece = null;
    this.dragFrom = null;
    this.pendingDrag = null;
    this.dragPointerId = null;
    this._suppressNextClick = false;
    this._onResize = () => {
      this._updateArrows();
      this._updateLoadingOverlay();
    };
    this.loadingSquare = null;
    this.loadingMessage = '';

    this._render();
    this._setupAnnotations();
    this._setupDrag();
	    window.addEventListener('resize', this._onResize, { passive: true });
	  }

		  _applySavedVisualSettings() {
		    try {
		      const raw = window.localStorage?.getItem('sidastuff.engineSettings');
		      const settings = raw ? JSON.parse(raw) : {};
		      document.body.dataset.boardTheme = settings.boardTheme || 'classic';
		      document.body.dataset.pieceTheme = settings.pieceTheme || 'classic';
		      document.body.style.setProperty('--annotation-arrow-color', settings.annotationArrowColor || '#d88a1d');
		      document.body.style.setProperty('--annotation-highlight-color', this._annotationHighlightColor(settings.annotationHighlightColor));
		    } catch (_) {
		      document.body.dataset.boardTheme = 'classic';
		      document.body.dataset.pieceTheme = 'classic';
		      document.body.style.setProperty('--annotation-arrow-color', '#d88a1d');
		      document.body.style.setProperty('--annotation-highlight-color', 'rgba(210, 38, 38, 0.38)');
		    }
		  }

		  _annotationHighlightColor(value) {
		    const raw = String(value || '#d22626').trim();
		    const match = raw.match(/^#?([0-9a-f]{6})$/i);
		    if (!match) return raw || 'rgba(210, 38, 38, 0.38)';
		    const hex = match[1];
		    const red = parseInt(hex.slice(0, 2), 16);
		    const green = parseInt(hex.slice(2, 4), 16);
		    const blue = parseInt(hex.slice(4, 6), 16);
		    return `rgba(${red}, ${green}, ${blue}, 0.38)`;
		  }

  // Set position from FEN
	  setPositionFromFen(fen) {
	    const previous = this.position || {};
	    const next = {};
	    const placement = fen.split(' ')[0];
	    const rows = placement.split('/');
	    for (let r = 0; r < 8; r++) {
      let col = 0;
      for (const ch of rows[r]) {
        if (ch >= '1' && ch <= '8') {
          col += parseInt(ch);
	        } else {
	          const color = ch === ch.toUpperCase() ? 'w' : 'b';
	          const piece = color + ch.toUpperCase();
	          const file = String.fromCharCode(97 + col);
	          const rank = 8 - r;
	          next[file + rank] = piece;
	          col++;
	        }
	      }
	    }
	    const previousSquares = Object.keys(previous);
	    this.changedSquares = previousSquares.length
	      ? Object.keys({ ...previous, ...next }).filter((sq) => previous[sq] !== next[sq])
	      : [];
	    this.position = next;
	    this._updatePieces();
	  }

  // Update board display
  _render() {
    this.container.innerHTML = '';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const r = this.flipped ? row : 7 - row;
        const c = this.flipped ? 7 - col : col;
        const file = String.fromCharCode(97 + c);
        const rank = r + 1;
        const sq = file + rank;
        const isLight = (c + r) % 2 === 1;

        const div = document.createElement('div');
        div.className = `square ${isLight ? 'light' : 'dark'}`;
        div.dataset.square = sq;

        // Coordinate labels
        if (col === 0) {
          // Show rank on leftmost squares (but it's row 0 visually = top)
        }
        if (this.flipped ? row === 0 : row === 7) {
          const fileLabel = document.createElement('span');
          fileLabel.className = 'coord-label coord-file';
          fileLabel.textContent = file;
          div.appendChild(fileLabel);
        }
        if (this.flipped ? col === 7 : col === 0) {
          const rankLabel = document.createElement('span');
          rankLabel.className = 'coord-label coord-rank';
          rankLabel.textContent = rank;
          div.appendChild(rankLabel);
        }

        // Click handling
        div.addEventListener('click', (e) => this._onSquareClick(sq, e));

        this.container.appendChild(div);
      }
    }
    this._ensureArrowLayer();
    this._updatePieces();
    this._updateHighlights();
    this._updateArrows();
    this._updateLoadingOverlay();
  }

  _updatePieces() {
    const squares = this.container.querySelectorAll('.square');
    squares.forEach(sqEl => {
      const sq = sqEl.dataset.square;
      // Remove existing piece image
      const existing = sqEl.querySelector('.piece');
      if (existing) existing.remove();

	      const piece = this.position[sq];
		      if (piece) {
		        const img = document.createElement('img');
		        img.className = 'piece';
		        if (this.changedSquares?.includes(sq)) img.classList.add('piece-arrive');
		        img.src = getPieceSvgUri(piece);
		        img.onerror = () => {
		          const fallback = typeof getPieceFallbackSvgUri === 'function' ? getPieceFallbackSvgUri(piece) : '';
		          if (fallback && img.src !== fallback) img.src = fallback;
		        };
		        img.draggable = false;
		        sqEl.appendChild(img);
		      }
	    });
	    this.changedSquares = [];
	  }

	  _updateHighlights() {
	    const squares = this.container.querySelectorAll('.square');
		    squares.forEach(sqEl => {
			      sqEl.classList.remove('highlight', 'selected', 'best-from', 'best-to', 'has-piece', 'inverted');
	      sqEl.style.removeProperty('--move-highlight-color');
	      sqEl.style.removeProperty('--move-highlight-ring');
	      // Remove legal dots
	      const dot = sqEl.querySelector('.legal-dot');
	      if (dot) dot.remove();
	      const hud = sqEl.querySelector('.selected-piece-hud');
	      if (hud) hud.remove();
	    });

	    // Apply highlights
		    this.invertedSquares.forEach((square) => {
		      const sqEl = this.container.querySelector(`[data-square="${square}"]`);
		      if (sqEl) sqEl.classList.add('inverted');
		    });

		    this.highlights.forEach(h => {
	      const sqEl = this.container.querySelector(`[data-square="${h.square}"]`);
	      if (sqEl) {
	        sqEl.classList.add(h.type);
	        if (h.color) sqEl.style.setProperty('--move-highlight-color', h.color);
	        if (h.ringColor) sqEl.style.setProperty('--move-highlight-ring', h.ringColor);
	      }
	    });

    // Selected square
	    if (this.selectedSquare) {
	      const sqEl = this.container.querySelector(`[data-square="${this.selectedSquare}"]`);
	      if (sqEl) {
	        sqEl.classList.add('selected');
	        const piece = this.position[this.selectedSquare];
	        if (piece) {
	          const hud = document.createElement('div');
	          hud.className = 'selected-piece-hud';
	          hud.textContent = this._pieceHudLabel(piece);
	          sqEl.appendChild(hud);
	        }
	      }
	    }

    // Legal move indicators
    this.legalMoves.forEach(sq => {
      const sqEl = this.container.querySelector(`[data-square="${sq}"]`);
      if (sqEl) {
        const dot = document.createElement('div');
        dot.className = 'legal-dot';
        if (this.position[sq]) {
          sqEl.classList.add('has-piece');
        }
        sqEl.appendChild(dot);
      }
    });
  }

  setHighlights(highlights) {
    this.highlights = highlights;
    this._updateHighlights();
  }

  setBestMoveArrow(uciMove, options = {}) {
    if (!uciMove || uciMove.length < 4) {
      this.bestMoveArrow = null;
      this._updateArrows();
      return;
    }

    this.bestMoveArrow = {
      from: uciMove.substring(0, 2),
      to: uciMove.substring(2, 4),
      color: options.color || '#96BC4B',
    };
    this._updateArrows();
  }

  clearBestMoveArrow() {
    this.bestMoveArrow = null;
    this._updateArrows();
  }

	  addUserArrow(from, to, options = {}) {
	    if (!from || !to || from === to) return;
	    this.userArrows.push({
	      from,
	      to,
	      color: options.color || this._annotationArrowColor(),
	    });
	    this._updateArrows();
	  }

  clearUserArrows() {
    if (this.userArrows.length === 0) return;
    this.userArrows = [];
    this._updateArrows();
  }

  setLoading(square = null, message = 'Loading') {
    this.loadingSquare = square || null;
    this.loadingMessage = message || 'Loading';
    this._updateLoadingOverlay();
  }

  clearLoading() {
    this.loadingSquare = null;
    this.loadingMessage = '';
    this._updateLoadingOverlay();
  }

  flip() {
    this.flipped = !this.flipped;
    this._render();
    if (this.onFlip) this.onFlip(this.flipped);
  }

	  _onSquareClick(sq) {
	    if (!this.interactive) return;
	    if (this._suppressNextClick) {
	      this._suppressNextClick = false;
	      return;
	    }
	    this.clearInvertedSquares();
	    this._selectSquare(sq);
	  }

	  _selectSquare(sq) {
	    if (this.selectedSquare) {
	      if (this.legalMoves.includes(sq)) {
	        // Make the move
        if (this.onMove) this.onMove(this.selectedSquare, sq);
        this.selectedSquare = null;
        this.legalMoves = [];
      } else if (this.position[sq] && sq !== this.selectedSquare) {
        // Select different piece
        this.selectedSquare = sq;
        this.legalMoves = this._getLegalMovesFrom(sq);
      } else {
        this.selectedSquare = null;
        this.legalMoves = [];
      }
    } else {
      if (this.position[sq]) {
        this.selectedSquare = sq;
        this.legalMoves = this._getLegalMovesFrom(sq);
	      }
	    }
	    this._updateHighlights();
	  }

	  toggleInvertedSquare(sq) {
	    if (!sq) return;
	    if (this.invertedSquares.has(sq)) this.invertedSquares.delete(sq);
	    else this.invertedSquares.add(sq);
	    this._updateHighlights();
	  }

	  clearInvertedSquares() {
	    if (!this.invertedSquares.size) return;
	    this.invertedSquares.clear();
	    this._updateHighlights();
	  }

	  _annotationArrowColor() {
	    try {
	      const value = getComputedStyle(document.body).getPropertyValue('--annotation-arrow-color').trim();
	      return value || '#d88a1d';
	    } catch (_error) {
	      return '#d88a1d';
	    }
	  }

	  _pieceHudLabel(piece) {
	    const color = piece?.[0] === 'w' ? 'W' : 'B';
	    const names = { K: 'K', Q: 'Q', R: 'R', B: 'B', N: 'N', P: 'P' };
	    return `${color}${names[piece?.[1]] || ''}`;
	  }

  _getLegalMovesFrom(sq) {
    if (!this._chessInstance) return [];
    const moves = this._chessInstance.moves({ square: sq, verbose: true });
    return moves.map(m => m.to);
  }

  setChessInstance(chess) {
    this._chessInstance = chess;
  }

  _ensureArrowLayer() {
    if (!this.wrapper) return;
    if (this.arrowLayer && this.arrowLayer.parentElement === this.wrapper) return;

    if (this.arrowLayer) {
      this.arrowLayer.remove();
    }

    this.arrowLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.arrowLayer.classList.add('board-overlay');
    this.arrowLayer.setAttribute('aria-hidden', 'true');
    this.arrowLayer.setAttribute('focusable', 'false');
    this.wrapper.appendChild(this.arrowLayer);
  }

  _ensureLoadingOverlay() {
    if (!this.wrapper) return null;
    if (this.loadingOverlay && this.loadingOverlay.parentElement === this.wrapper) {
      return this.loadingOverlay;
    }

    if (this.loadingOverlay) {
      this.loadingOverlay.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'board-loading-overlay';
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML = `
      <img class="board-loading-spinner" src="./assets/spinner.png" alt="">
      <span class="board-loading-text"></span>
    `;
    this.wrapper.appendChild(overlay);
    this.loadingOverlay = overlay;
    return overlay;
  }

  _squareCenter(sq) {
    if (!this.wrapper) return null;
    const sqEl = this.container.querySelector(`[data-square="${sq}"]`);
    if (!sqEl) return null;

    const wrapperRect = this.wrapper.getBoundingClientRect();
    const sqRect = sqEl.getBoundingClientRect();
    return {
      x: sqRect.left - wrapperRect.left + sqRect.width / 2,
      y: sqRect.top - wrapperRect.top + sqRect.height / 2,
    };
  }

  _updateArrows() {
    if (!this.arrowLayer || !this.wrapper) return;

    const width = this.wrapper.clientWidth;
    const height = this.wrapper.clientHeight;
    if (!width || !height) return;

    this.arrowLayer.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.arrowLayer.setAttribute('width', width);
    this.arrowLayer.setAttribute('height', height);
	    this.arrowLayer.innerHTML = `
	      <defs>
	        <marker id="best-move-arrowhead" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto" markerUnits="strokeWidth">
	          <path d="M 0 0 L 7 3.5 L 0 7 z" fill="${this.bestMoveArrow?.color || '#96BC4B'}"></path>
	        </marker>
	        <marker id="user-arrowhead" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto" markerUnits="strokeWidth">
	          <path d="M 0 0 L 7 3.5 L 0 7 z" fill="${this._annotationArrowColor()}"></path>
	        </marker>
	      </defs>
	    `;

    for (const arrow of this.userArrows) {
      this._appendArrowElement(arrow, 'user-arrowhead', 0.78, 5);
    }

    if (!this.bestMoveArrow) return;
    this._appendArrowElement(this.bestMoveArrow, 'best-move-arrowhead', 0.55, 4);
  }

  _appendArrowElement(arrow, markerId, opacity = 0.6, strokeWidth = 4) {
    if (!arrow || !this.arrowLayer) return;

    const from = this._squareCenter(arrow.from);
    const to = this._squareCenter(arrow.to);
    if (!from || !to) return;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const endTrim = Math.min(18, distance * 0.22);
    const startTrim = Math.min(14, distance * 0.16);
    const startX = from.x + (dx / distance) * startTrim;
    const startY = from.y + (dy / distance) * startTrim;
    const endX = to.x - (dx / distance) * endTrim;
    const endY = to.y - (dy / distance) * endTrim;

    this.arrowLayer.innerHTML += `
      <line
        x1="${startX}"
        y1="${startY}"
        x2="${endX}"
        y2="${endY}"
        stroke="${arrow.color}"
        stroke-width="${strokeWidth}"
        stroke-linecap="round"
        stroke-linejoin="round"
        marker-end="url(#${markerId})"
        opacity="${opacity}"
      ></line>
      <circle cx="${from.x}" cy="${from.y}" r="3" fill="${arrow.color}" opacity="${opacity}"></circle>
    `;
  }

  _updateLoadingOverlay() {
    if (!this.wrapper) return;
    const overlay = this._ensureLoadingOverlay();
    if (!overlay) return;

    if (!this.loadingMessage) {
      overlay.classList.remove('active', 'on-square');
      return;
    }

    const text = overlay.querySelector('.board-loading-text');
    if (text) text.textContent = this.loadingMessage;

    overlay.classList.add('active');
    overlay.classList.toggle('on-square', !!this.loadingSquare);

    const target = this.loadingSquare ? this._squareCenter(this.loadingSquare) : null;
    if (target) {
      overlay.style.left = `${target.x}px`;
      overlay.style.top = `${target.y}px`;
    } else {
      overlay.style.left = '50%';
      overlay.style.top = '50%';
    }
  }

  // Drag and drop
  _setupDrag() {
    let dragImg = null;
    let dragFromSq = null;
    let offsetX = 0, offsetY = 0;
    let startX = 0;
    let startY = 0;
    const dragThreshold = 6;

    const getSquareFromPoint = (x, y) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      const sqEl = el.closest('.square');
      return sqEl ? sqEl.dataset.square : null;
    };

    const beginDrag = (sq, piece, sqEl, clientX, clientY) => {
      dragFromSq = sq;
      this.selectedSquare = sq;
      this.legalMoves = this._getLegalMovesFrom(sq);
      this._updateHighlights();

	      dragImg = document.createElement('img');
	      dragImg.src = getPieceSvgUri(piece);
	      dragImg.onerror = () => {
	        const fallback = typeof getPieceFallbackSvgUri === 'function' ? getPieceFallbackSvgUri(piece) : '';
	        if (fallback && dragImg.src !== fallback) dragImg.src = fallback;
	      };
	      dragImg.className = 'drag-piece';
      const sqRect = sqEl.getBoundingClientRect();
      const size = sqRect.width * 1.06;
      dragImg.style.width = size + 'px';
      dragImg.style.height = size + 'px';
      offsetX = size / 2;
      offsetY = size / 2;
      dragImg.style.left = (clientX - offsetX) + 'px';
      dragImg.style.top = (clientY - offsetY) + 'px';
      document.body.appendChild(dragImg);
      sqEl.classList.add('dragging');
    };

    const cleanupDrag = (event) => {
      if (!dragImg && !this.pendingDrag) return;

      const activePointerId = this.dragPointerId;
      const wasDragging = !!dragImg;
      if (dragImg) {
        dragImg.remove();
        dragImg = null;
      }

      if (dragFromSq) {
        const fromEl = this.container.querySelector(`[data-square="${dragFromSq}"]`);
        if (fromEl) fromEl.classList.remove('dragging');
      }

	      if (wasDragging && event) {
	        this._suppressNextClick = true;
	        setTimeout(() => {
	          this._suppressNextClick = false;
	        }, 0);
        const toSq = getSquareFromPoint(event.clientX, event.clientY);
        if (toSq && dragFromSq && this.legalMoves.includes(toSq)) {
          if (this.onMove) this.onMove(dragFromSq, toSq);
	          this.selectedSquare = null;
	          this.legalMoves = [];
	        }
	      } else if (event && this.pendingDrag?.sq) {
	        this._suppressNextClick = true;
	        setTimeout(() => {
	          this._suppressNextClick = false;
	        }, 0);
	        this._selectSquare(this.pendingDrag.sq);
	      }

      this.pendingDrag = null;
      this.dragPointerId = null;
      dragFromSq = null;
      this._updateHighlights();
      if (activePointerId !== null) {
        try {
          this.container.releasePointerCapture?.(activePointerId);
        } catch (_error) {
          // Ignore release errors on browsers that do not fully support capture.
        }
      }
    };

    this.container.addEventListener('pointerdown', (e) => {
      if (!this.interactive) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const sqEl = e.target.closest('.square');
      if (!sqEl) return;
      const sq = sqEl.dataset.square;
      const piece = this.position[sq];
      if (!piece) return;

      this.pendingDrag = { sq, piece, sqEl, pointerId: e.pointerId };
      this.dragPointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      this._suppressNextClick = false;
      this.container.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });

    document.addEventListener('pointermove', (e) => {
      if (this.dragPointerId !== e.pointerId) return;
      if (!this.pendingDrag) return;
      if (!dragImg) {
        const distance = Math.hypot(e.clientX - startX, e.clientY - startY);
        if (distance < dragThreshold) return;
        beginDrag(this.pendingDrag.sq, this.pendingDrag.piece, this.pendingDrag.sqEl, e.clientX, e.clientY);
      }
      if (!dragImg) return;
      e.preventDefault();
      dragImg.style.left = (e.clientX - offsetX) + 'px';
      dragImg.style.top = (e.clientY - offsetY) + 'px';
    });

    document.addEventListener('pointerup', (e) => {
      if (this.dragPointerId !== e.pointerId) return;
      cleanupDrag(e);
    });

    document.addEventListener('pointercancel', (e) => {
      if (this.dragPointerId !== e.pointerId) return;
      cleanupDrag(e);
    });
  }

  _setupAnnotations() {
    const squareFromEvent = (event) => {
      const target = document.elementFromPoint(event.clientX, event.clientY) || event.target;
      const sqEl = target.closest?.('.square');
      return sqEl ? sqEl.dataset.square : null;
    };

    this.container.addEventListener('contextmenu', (event) => {
      if (event.target.closest('.square')) event.preventDefault();
    });

    this.container.addEventListener('pointerdown', (event) => {
      const sq = squareFromEvent(event);
      if (!sq) return;

	      if (event.pointerType === 'mouse' && event.button === 2) {
	        this.annotationPointer = {
	          id: event.pointerId,
	          from: sq,
	        };
        this.container.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        return;
      }

	      if (event.button === 0) {
	        this.clearUserArrows();
	        this.clearInvertedSquares();
	      }
    });

    this.container.addEventListener('pointermove', (event) => {
      if (!this.annotationPointer || this.annotationPointer.id !== event.pointerId) return;
      this.annotationPointer.moved = true;
      event.preventDefault();
    });

    this.container.addEventListener('pointerup', (event) => {
      if (!this.annotationPointer || this.annotationPointer.id !== event.pointerId) return;
	      const from = this.annotationPointer.from;
	      const to = squareFromEvent(event);
	      if (to && from !== to) this.addUserArrow(from, to);
	      else if (to && from === to) this.toggleInvertedSquare(to);
      this.annotationPointer = null;
      try {
        this.container.releasePointerCapture?.(event.pointerId);
      } catch (_error) {
        // Ignore release errors on browsers that do not fully support capture.
      }
      event.preventDefault();
    });

    document.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (!this.wrapper || this.wrapper.contains(event.target)) return;
      this.clearUserArrows();
    });
  }
}
