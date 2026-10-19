// Chess Board UI Module
class ChessBoard {
	  constructor(containerId) {
	    this.container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
	    this._applySavedVisualSettings();
	    this.wrapper = this.container?.parentElement || null;
    this.flipped = false;
    this.position = {};  // { 'e1': 'wK', ... }
    this.highlights = []; // [{ square, type }]
    this.bestMoveArrow = null;
    this.userArrows = [];
    // Coach explanations own a declarative layer. They never mutate player
    // drawings, legal-move dots, or the app's best-move arrow.
    this.coachAnnotations = null;
    this._displayedFen = null;
    this._previewState = null;
    this.invertedSquares = new Set();
    this.annotationPointer = null;
    this.selectedSquare = null;
    this.legalMoves = [];
    this.checkSquare = null; // set by the app when a side is in check
    this.onMove = null; // callback(from, to)
    this.onFlip = null;
    this.interactive = false;
    this.dragPiece = null;
    this.dragFrom = null;
    this.pendingDrag = null;
    this.dragPointerId = null;
    this._suppressNextClick = false;
    this._prefersTap = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    this._onResize = () => {
      this._updateArrows();
      this._updateCoachAnnotations();
      this._updateLoadingOverlay();
    };
    this.loadingSquare = null;
    this.loadingMessage = '';
    this.loadingProgress = null;

    // Track document/window listeners added during setup so destroy() can
    // detach them. MUST be initialized before _setupAnnotations/_setupDrag,
    // which call _addDestroyableListener() during construction.
    this._destroyableListeners = [];

    this._render();
    this._bindContainerKeyboard();
    this._setupAnnotations();
    this._setupDrag();
	    window.addEventListener('resize', this._onResize, { passive: true });
	    ChessBoard.instances ||= new Set(); ChessBoard.instances.add(this);
	  }

  _addDestroyableListener(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this._destroyableListeners.push({ target, type, handler, options });
  }

  // Container-level keydown: first arrival via Tab lands on a1 (or the current
  // focused square). Registered exactly ONCE — _render() clears the container's
  // innerHTML (removing the per-square listeners along with the squares) but the
  // container itself persists, so a listener bound there per-render would stack.
  _bindContainerKeyboard() {
    this._addDestroyableListener(this.container, 'keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target !== this.container) return; // cell keydowns handle their own
      e.preventDefault();
      const first = this.container.querySelector('[data-square="a1"]') || this.container.querySelector('[data-square]');
      if (first) first.focus();
    });
  }

  destroy() {
    ChessBoard.instances?.delete(this);
    this.cancelDrag?.();
    this._cancelSlide();
    if (this._onResize) {
      window.removeEventListener('resize', this._onResize);
      this._onResize = null;
    }
    this._destroyableListeners.forEach(({ target, type, handler, options }) => {
      try { target.removeEventListener(type, handler, options); } catch (_err) {}
    });
    this._destroyableListeners = [];
    // Release the in-flight drag image if a destroy happens mid-gesture.
    const dragImg = document.querySelector('.drag-piece');
    if (dragImg) dragImg.remove();
    // Drop wrapper-level overlays (arrow SVG layer, loading overlay). They are
    // appended to the WRAPPER, not the container that _render() clears, so
    // without this they survive destroy() and stack under the next board that
    // reuses the same wrapper.
    try { this.arrowLayer?.remove(); } catch (_err) {}
    try { this.coachAnnotationLayer?.remove(); } catch (_err) {}
    try { this.loadingOverlay?.remove(); } catch (_err) {}
    this.arrowLayer = null;
    this.coachAnnotationLayer = null;
    this.coachAnnotations = null;
    if (this._previewState) this._previewState.restored = true;
    this._previewState = null;
    this.loadingOverlay = null;
  }

		  _applySavedVisualSettings() {
		    try {
		      const raw = window.localStorage?.getItem('sidastuff.engineSettings');
      const engineSettings = raw ? JSON.parse(raw) : {};
      const appearanceRaw = window.localStorage?.getItem('sidastuff.appearanceSettings');
      const appearanceSettings = appearanceRaw ? JSON.parse(appearanceRaw) : {};
      
      // Merge settings, with appearanceSettings taking precedence
      const settings = { ...engineSettings, ...appearanceSettings };
			      document.body.dataset.boardTheme = settings.boardTheme || 'classic';
			      document.body.dataset.pieceTheme = settings.pieceTheme || 'cburnett';
			      document.body.dataset.pieceAnimations = settings.pieceAnimations ? 'on' : 'off';
			      // The real animation toggle is the body class (CSS reads
			      // body.no-piece-animations, not the dataset above). Apply it at
			      // construction so the saved preference is honored on load.
			      this.enableAnimations(settings.pieceAnimations !== false);
			      document.body.style.setProperty('--annotation-arrow-color', settings.arrowColor || settings.annotationArrowColor || '#d88a1d');
			      document.body.style.setProperty('--annotation-highlight-color', this._annotationHighlightColor(settings.highlightColor || settings.annotationHighlightColor));
			    } catch (_) {
			      document.body.dataset.boardTheme = 'classic';
			      document.body.dataset.pieceTheme = 'cburnett';
			      document.body.dataset.pieceAnimations = 'off';
			      this.enableAnimations(false);
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
        if (this._displayedFen && this._displayedFen !== fen && window.QualityOfLife?.preferences().clearArrows !== false) {
          this.clearUserArrows(); this.clearInvertedSquares();
        }
        if (this._slideElement) {
          this._cancelSlide();
          this._updatePieces();
        }
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

	    // Detect a piece move for slide animation
	    let slideFrom = null;
	    let slideTo = null;
	    let slidePiece = null;
	    if (!document.body.classList.contains('no-piece-animations') && previousSquares.length > 0) {
	      for (const sq of this.changedSquares) {
	        if (previous[sq] && !next[sq]) {
	          const pieceType = previous[sq];
	          for (const otherSq of this.changedSquares) {
	            const promotes = pieceType[1] === 'P' &&
                  (pieceType[0] === 'w' ? otherSq[1] === '8' : otherSq[1] === '1') &&
                  next[otherSq]?.[0] === pieceType[0] && /^[QRBN]$/.test(next[otherSq]?.[1] || '');
	            if (otherSq !== sq && (next[otherSq] === pieceType || promotes)) {
	              slideFrom = sq;
	              slideTo = otherSq;
	              slidePiece = pieceType;
	              break;
	            }
	          }
	          if (slideFrom) break;
	        }
	      }
	    }

	    this.position = next;
        this._displayedFen = String(fen).trim();
        if (this.coachAnnotations && !this._coachFenMatches(this.coachAnnotations.fen)) {
          this.clearCoachAnnotations();
        }

	    if (this._skipNextSlide) {
	      this._skipNextSlide = false;
	      this._updatePieces();
	    } else if (this._animateNext && slideFrom && slideTo && slidePiece) {
	      this._animateNext = false;
	      this._animateSlide(slideFrom, slideTo, slidePiece);
	    } else {
	      this._animateNext = false;
	      this._updatePieces();
	    }
	  }

	  _cancelSlide() {
        clearTimeout(this._slideTimeout);
        this._slideElement?.remove();
        this._slideElement = null;
        this._slideTimeout = null;
      }

	  _animateSlide(fromSq, toSq, piece) {
	    if (document.body.classList.contains('no-piece-animations') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          this._updatePieces();
          return;
        }
	    if (!this.wrapper) { this._updatePieces(); return; }

	    const fromEl = this.container.querySelector(`[data-square="${fromSq}"]`);
	    const toEl = this.container.querySelector(`[data-square="${toSq}"]`);
	    if (!fromEl || !toEl) { this._updatePieces(); return; }

	    const wrapperRect = this.wrapper.getBoundingClientRect();
	    const fromRect = fromEl.getBoundingClientRect();
	    const toRect = toEl.getBoundingClientRect();

	    const startLeft = fromRect.left - wrapperRect.left;
	    const startTop = fromRect.top - wrapperRect.top;
	    const endLeft = toRect.left - wrapperRect.left;
	    const endTop = toRect.top - wrapperRect.top;

        // Commit captures, the castling rook, and promotion immediately. Only
        // the sliding piece is hidden at its destination until the motion ends.
        this._updatePieces();
        const destinationPiece = toEl.querySelector('.piece');
        if (destinationPiece) destinationPiece.style.opacity = '0';

	    const slideEl = document.createElement('div');
	    slideEl.className = 'piece-slide';
	    const img = document.createElement('img');
	    img.src = getPieceSvgUri(piece);
	    img.draggable = false;
	    img.alt = '';
	    slideEl.appendChild(img);

	    slideEl.style.left = startLeft + 'px';
	    slideEl.style.top = startTop + 'px';
	    slideEl.style.width = fromRect.width + 'px';
	    slideEl.style.height = fromRect.height + 'px';
	    this.wrapper.appendChild(slideEl);
        this._slideElement = slideEl;

	    slideEl.offsetHeight;

	    slideEl.style.left = endLeft + 'px';
	    slideEl.style.top = endTop + 'px';

	    const durationMs = parseFloat(getComputedStyle(document.body).getPropertyValue('--piece-slide-duration')) * 1000 || 500;
	    this._slideTimeout = setTimeout(() => {
          if (this._slideElement !== slideEl) return;
	      slideEl.remove();
          this._slideElement = null;
          this._slideTimeout = null;
	      this._updatePieces();
	    }, durationMs + 50);
	  }

  // Update board display
  _render() {
    this._cancelSlide();
    // Make the board a semantic, keyboard-navigable grid for assistive tech and
    // keyboard users alike (WCAG 2.1.1 / 2.1.2 / 4.1.2).
    this.container.setAttribute('role', 'grid');
    this.container.setAttribute('aria-label', 'Chess board');
    // Single tab stop for the whole board (roving tabindex on the cells below).
    this.container.setAttribute('tabindex', '0');
    // NOTE: the Enter/Space → focus-a1 keydown handler used to live here, but
    // _render() runs on every flip and it piled up a fresh anonymous listener
    // each time. It now registers ONCE in the constructor via
    // _addDestroyableListener (see _bindContainerKeyboard).
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
        div.setAttribute('role', 'gridcell');
        // Roving tabindex (WCAG-friendly): instead of 64 tab stops, the board
        // container is ONE tab stop; arrow keys move focus between squares via
        // _onSquareKeyDown. The first square (a1) is focusable programmatically
        // so arrow navigation always has an entry point.
        div.setAttribute('tabindex', sq === 'a1' ? '0' : '-1');
        div.setAttribute('aria-label', `Square ${file}${rank}`);
        div.addEventListener('keydown', (e) => this._onSquareKeyDown(sq, e));

        // Coordinate labels
        if (col === 0) {
          // Show rank on leftmost squares (but it's row 0 visually = top)
        }
        if (row === 7) {
          const fileLabel = document.createElement('span');
          fileLabel.className = 'coord-label coord-file';
          fileLabel.textContent = file;
          div.appendChild(fileLabel);
        }
        if (col === 0) {
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
    this._ensureCoachAnnotationLayer();
    this._updatePieces();
    this._updateHighlights();
    this._updateArrows();
    this._updateCoachAnnotations();
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
		        // Accessible name for the piece so a screen reader enumerates the
		        // board ("White knight on g1"). The sharing/screenshot PNG is
		        // decorative; the individual SVG gets its own name.
		        img.alt = this._describePiece(piece);
		        img.setAttribute('role', 'img');
		        img.setAttribute('aria-label', this._describePiece(piece));
		        sqEl.appendChild(img);
		        // Reflect the piece in the square's accessible name too, so arrow-key
		        // navigation announces "White knight on g1".
		        sqEl.setAttribute('aria-label', `${this._describePiece(piece)} on ${sq}`);
		      } else if (sqEl) {
		        sqEl.setAttribute('aria-label', `Square ${sq}`);
		      }
	    });
	    this.changedSquares = [];
	  }

	  _updateHighlights() {
	    const squares = this.container.querySelectorAll('.square');
		    squares.forEach(sqEl => {
			      sqEl.classList.remove('highlight', 'selected', 'best-from', 'best-to', 'has-piece', 'inverted', 'in-check');
	      sqEl.style.removeProperty('--move-highlight-color');
	      sqEl.style.removeProperty('--move-highlight-ring');
	      // Remove legal dots
	      const dot = sqEl.querySelector('.legal-dot');
	      if (dot) dot.remove();
	    });

	    // King in check — a red square so the threat is visible at a glance even
    // without sound, and for review/puzzle playback.
    if (this.checkSquare) {
      const checkEl = this.container.querySelector(`[data-square="${this.checkSquare}"]`);
      if (checkEl) checkEl.classList.add('in-check');
    }

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
	      if (sqEl) sqEl.classList.add('selected');
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
    // Defensive: callers (and future callers) may pass null/undefined when
    // clearing. Without the default, _updateHighlights throws on
    // this.highlights.forEach. Normalize to an empty array.
    this.highlights = Array.isArray(highlights) ? highlights : [];
    this._updateHighlights();
  }

  setBestMoveArrow(uciMove, options = {}) {
    if (window.PlayFairPlay?.isBlocked()) { this.clearBestMoveArrow(); return; }
    if (!uciMove || uciMove.length < 4) {
      this.bestMoveArrow = null;
      this._updateArrows();
      return;
    }

    this.bestMoveArrow = {
      from: uciMove.substring(0, 2),
      to: uciMove.substring(2, 4),
      color: options.color || '#77c75d',
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

  // The first four FEN fields identify a playable position. Half-move clocks
  // and full-move numbers do not affect an explanation's board markings.
  _coachFenMatches(fen) {
    if (typeof fen !== 'string' || !this._displayedFen) return false;
    const supplied = fen.trim().split(/\s+/);
    const displayed = this._displayedFen.trim().split(/\s+/);
    if (supplied[0] !== displayed[0]) return false;
    if (displayed.length >= 4) {
      return supplied.length >= 4 && supplied.slice(0, 4).join(' ') === displayed.slice(0, 4).join(' ');
    }
    return supplied.length === 1;
  }

  _coachOpacity(value, fallback = 1) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
  }

  setCoachAnnotations(annotation) {
    if (window.PlayFairPlay?.isBlocked()) { this.clearCoachAnnotations(); return false; }
    if (!annotation || !this._coachFenMatches(annotation.fen)) {
      this.clearCoachAnnotations();
      return false;
    }
    const roles = new Set(['suggestion', 'threat', 'tactic', 'defense']);
    const square = value => typeof value === 'string' && /^[a-h][1-8]$/.test(value);
    const label = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
    const arrows = (Array.isArray(annotation.arrows) ? annotation.arrows : []).slice(0, 32)
      .filter(item => item && square(item.from) && square(item.to) && item.from !== item.to && roles.has(item.role))
      .map(item => ({ from: item.from, to: item.to, role: item.role, label: label(item.label), opacity: this._coachOpacity(item.opacity, .88) }));
    const highlights = (Array.isArray(annotation.highlights) ? annotation.highlights : []).slice(0, 32)
      .filter(item => item && square(item.square) && roles.has(item.role))
      .map(item => ({ square: item.square, role: item.role, label: label(item.label), opacity: this._coachOpacity(item.opacity, .9) }));
    this.coachAnnotations = arrows.length || highlights.length ? {
      fen: String(annotation.fen).trim(),
      explanationId: String(annotation.explanationId || '').slice(0, 200),
      opacity: this._coachOpacity(annotation.opacity), arrows, highlights,
    } : null;
    this._ensureCoachAnnotationLayer();
    this._updateCoachAnnotations();
    return true;
  }

  clearCoachAnnotations() {
    this.coachAnnotations = null;
    this._updateCoachAnnotations();
  }

  getCoachAnnotationDescription() {
    if (!this.coachAnnotations) return '';
    const names = { suggestion: 'Suggested move', threat: 'Threat', tactic: 'Tactical idea', defense: 'Defense' };
    const describe = item => `${names[item.role]}: ${item.square || `${item.from} to ${item.to}`}${item.label ? `; ${item.label}` : ''}.`;
    return [...this.coachAnnotations.highlights, ...this.coachAnnotations.arrows].map(describe).join(' ');
  }

  _ensureCoachAnnotationLayer() {
    if (!this.wrapper) return;
    if (this.coachAnnotationLayer?.parentElement === this.wrapper) return;
    this.coachAnnotationLayer?.remove();
    ChessBoard._coachLayerSequence = (ChessBoard._coachLayerSequence || 0) + 1;
    this._coachLayerId = `coach-annotations-${ChessBoard._coachLayerSequence}`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('coach-annotation-overlay');
    svg.setAttribute('viewBox', '0 0 800 800');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('focusable', 'false');
    svg.style.pointerEvents = 'none';
    svg.style.display = 'none';
    this.coachAnnotationLayer = svg;
    this.wrapper.appendChild(svg);
  }

  _updateCoachAnnotations() {
    const layer = this.coachAnnotationLayer;
    if (!layer) return;
    layer.replaceChildren();
    const annotation = this.coachAnnotations;
    if (!annotation || !this._coachFenMatches(annotation.fen)) {
      this.coachAnnotations = null;
      layer.style.display = 'none';
      layer.removeAttribute('aria-label');
      layer.removeAttribute('data-explanation-id');
      return;
    }
    layer.style.display = 'block';
    layer.setAttribute('data-explanation-id', annotation.explanationId);
    layer.setAttribute('aria-label', this.getCoachAnnotationDescription());
    const colors = { suggestion: '#69d89a', threat: '#ef7972', tactic: '#eec85a', defense: '#76b7f0' };
    const make = (name, attrs = {}, text = null) => {
      const element = document.createElementNS('http://www.w3.org/2000/svg', name);
      Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
      if (text !== null) element.textContent = text;
      return element;
    };
    const point = square => {
      const file = square.charCodeAt(0) - 97;
      const rank = Number(square[1]) - 1;
      return { x: (this.flipped ? 7 - file : file) * 100 + 50, y: (this.flipped ? rank : 7 - rank) * 100 + 50 };
    };
    const description = make('desc', {}, this.getCoachAnnotationDescription());
    const definitions = make('defs');
    Object.entries(colors).forEach(([role, color]) => {
      const marker = make('marker', { id: `${this._coachLayerId}-${role}`, markerWidth: 5, markerHeight: 5, refX: 4, refY: 2.5, orient: 'auto', markerUnits: 'strokeWidth' });
      marker.appendChild(make('path', { d: 'M 0 0 L 5 2.5 L 0 5 Z', fill: color }));
      definitions.appendChild(marker);
    });
    const group = make('g', { opacity: annotation.opacity });
    annotation.highlights.forEach(item => {
      const center = point(item.square);
      const color = colors[item.role];
      const mark = make('g', { class: `coach-highlight coach-annotation-${item.role}`, opacity: item.opacity, 'data-square': item.square });
      mark.appendChild(make('title', {}, item.label || `${item.role}: ${item.square}`));
      mark.appendChild(make('rect', { x: center.x - 46, y: center.y - 46, width: 92, height: 92, rx: 7, fill: color, 'fill-opacity': .2, stroke: color, 'stroke-width': 4 }));
      group.appendChild(mark);
    });
    annotation.arrows.forEach(item => {
      const from = point(item.from), to = point(item.to);
      const dx = to.x - from.x, dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      const color = colors[item.role];
      const mark = make('g', { class: `coach-arrow coach-annotation-${item.role}`, opacity: item.opacity, 'data-from': item.from, 'data-to': item.to });
      mark.appendChild(make('title', {}, item.label || `${item.role}: ${item.from} to ${item.to}`));
      mark.appendChild(make('line', {
        x1: from.x + dx / length * 13, y1: from.y + dy / length * 13,
        x2: to.x - dx / length * 19, y2: to.y - dy / length * 19,
        stroke: color, 'stroke-width': 7, 'stroke-linecap': 'round',
        'marker-end': `url(#${this._coachLayerId}-${item.role})`,
      }));
      mark.appendChild(make('circle', { cx: from.x, cy: from.y, r: 6, fill: color }));
      group.appendChild(mark);
    });
    layer.append(description, definitions, group);
  }

  setLoading(square = null, message = 'Loading') {
    this.loadingSquare = square || null;
    this.loadingMessage = message || 'Loading';
    this._updateLoadingOverlay();
  }

  // Set the on-board loading overlay's progress bar. Pass a number 0–100 to
  // show/update it (optionally overriding the label), or null/undefined to
  // hide the bar (used by clearLoading).
  setLoadingProgress(percent, label = null) {
    this.loadingProgress = (typeof percent === 'number' && Number.isFinite(percent)) ? percent : null;
    if (label !== null) this.loadingMessage = label;
    this._updateLoadingOverlay();
  }

  clearLoading() {
    this.loadingSquare = null;
    this.loadingMessage = '';
    this.loadingProgress = null;
    this._updateLoadingOverlay();
  }

  flip() {
    this.flipped = !this.flipped;
    this._render();
    if (this.onFlip) this.onFlip(this.flipped);
  }

  // Toggle piece-move animations. The CSS hook is the body class
  // "no-piece-animations" (see style.css: `body.no-piece-animations .piece {
  // animation: none !important }`), not the data-pieceAnimations attribute, so
  // this method owns the real toggle. Called from app.js settings apply.
  enableAnimations(enabled) {
    document.body.classList.toggle('no-piece-animations', !enabled);
  }

  // Skip slide animation for the next position update. Used after drag-and-drop
  // moves so the piece doesn't slide from the old square — it already moved.
  skipNextSlide() {
    this._skipNextSlide = true;
  }

  // Request slide animation for the next position update. Used when navigating
  // moves via arrow keys or prev/next buttons. All other updates (puzzle moves,
  // coach moves, game load, etc.) are instant.
  animateNextUpdate() {
    this._animateNext = true;
  }


	  _onSquareClick(sq) {
	    if (!this.interactive) return;
	    if (this._suppressNextClick) {
	      this._suppressNextClick = false;
	      return;
	    }
	    if (window.QualityOfLife?.preferences().clearArrows !== false) this.clearInvertedSquares();
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

	  
  // Human-readable name for a piece code ("wK" → "White king"). Used as the
  // accessible label on piece images and squares.
  _describePiece(piece) {
    if (!piece || typeof piece !== 'string' || piece.length < 2) return 'chess piece';
    const color = piece[0] === 'b' ? 'Black' : 'White';
    const names = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
    return `${color} ${names[piece[1].toLowerCase()] || 'piece'}`;
  }

  // Keyboard play: arrows move focus between squares, Enter/Space reuse the same
  // select→commit flow as a mouse click. Keyboard input only works when the
  // board is interactive (not during a passive review/puzzle playback).
  _onSquareKeyDown(sq, e) {
    if (!this.interactive || (e.ctrlKey || e.metaKey || e.altKey)) return;
    const key = e.key;
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault();
      const next = this._squareByKey(sq, key);
      if (next) {
        const el = this.container.querySelector(`[data-square="${next}"]`);
        if (el) el.focus();
      }
      return;
    }
    if (key === 'Enter' || key === ' ') {
      e.preventDefault();
      this._onSquareClick(sq);
      // Keep focus on the originating cell so subsequent arrows/Enter keep working
      // even after the board redraws.
      const el = this.container.querySelector(`[data-square="${sq}"]`);
      if (el && document.activeElement !== el) setTimeout(() => el.focus(), 0);
      return;
    }
  }

  // Arrow-key → adjacent square, respecting the visual flip. Keys are relative to
  // the picture on screen (Up visually = toward rank 8 / rank 1 for white/black).
  _squareByKey(sq, key) {
    const f = sq.charCodeAt(0) - 97;      // 0..7 file (a..h)
    const rn = parseInt(sq[1], 10);       // 1..8 rank
    let nf = f, nr = rn;
    // Chess-conventional navigation, independent of the visual flip: arrow keys
    // move in file/rank space (Left → a-file side, Up → rank 8 side). This is
    // non-ambiguous for chess players and stable whether or not the board flips.
    if (key === 'ArrowLeft') nf = f - 1;
    else if (key === 'ArrowRight') nf = f + 1;
    else if (key === 'ArrowUp') nr = rn + 1;
    else if (key === 'ArrowDown') nr = rn - 1;
    else return null;
    if (nf < 0 || nf > 7 || nr < 1 || nr > 8) return null;
    return String.fromCharCode(97 + nf) + nr;
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

  _getLegalMovesFrom(sq) {
    if (!this._chessInstance) return [];
    const moves = this._chessInstance.moves({ square: sq, verbose: true });
    return moves.map(m => m.to);
  }

  setChessInstance(chess) {
    this._chessInstance = chess;
  }

  previewPosition(chess, reference) {
    // A new reference may arrive without the caller first leaving the previous
    // one. Reuse the original review snapshot instead of capturing that preview.
    if (this._previewState && !this._previewState.restored) {
      this._previewState.restore.update(chess, reference);
      return this._previewState.restore;
    }
    const saved = {
      position: { ...this.position }, highlights: this.highlights,
      bestMoveArrow: this.bestMoveArrow, userArrows: this.userArrows,
      displayedFen: this._displayedFen, coachAnnotations: this.coachAnnotations,
      checkSquare: this.checkSquare, interactive: this.interactive,
      selectedSquare: this.selectedSquare, legalMoves: this.legalMoves,
      invertedSquares: this.invertedSquares,
      chess: this._chessInstance,
    };
    const state = { restored: false, restore: null };
    const update = (position, target = {}) => {
      if (state.restored || !position || typeof position.fen !== 'function') return false;
      target = target && typeof target === 'object' ? target : {};
      this.interactive = false;
      this.selectedSquare = null; this.legalMoves = [];
      this.invertedSquares = new Set();
      this.setChessInstance(position);
      this.checkSquare = target.kingSquare || null;
      this.userArrows = target.checkArrows || [];
      this._animateNext = target.animate === true;
      this._skipNextSlide = !this._animateNext;
      this.setPositionFromFen(position.fen());
      this.setHighlights(target.square ? [{ square: target.square, type: 'highlight' }]
        : [{ square: target.from, type: 'highlight' }, { square: target.to, type: 'highlight' }]);
      this.setBestMoveArrow(target.from ? target.from + target.to : null, { color: '#61b8df' });
      if (target.annotations) this.setCoachAnnotations(target.annotations);
      else this.clearCoachAnnotations();
      return true;
    };
    const restore = () => {
      if (state.restored) return;
      state.restored = true;
      if (this._previewState === state) this._previewState = null;
      this._cancelSlide();
      this.position = saved.position; this.highlights = saved.highlights;
      this.bestMoveArrow = saved.bestMoveArrow; this.userArrows = saved.userArrows;
      this._displayedFen = saved.displayedFen;
      this.coachAnnotations = saved.coachAnnotations;
      this.checkSquare = saved.checkSquare; this.interactive = saved.interactive;
      this.selectedSquare = saved.selectedSquare; this.legalMoves = saved.legalMoves;
      this.invertedSquares = saved.invertedSquares;
      this.setChessInstance(saved.chess);
      this._updatePieces(); this._updateHighlights(); this._updateArrows();
      this._updateCoachAnnotations();
    };
    restore.update = update;
    state.restore = restore;
    this._previewState = state;
    update(chess, reference);
    return restore;
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
      <span class="board-loading-spinner material-symbols-outlined" aria-hidden="true">progress_activity</span>
      <span class="board-loading-text"></span>
      <div class="board-loading-progress"><div class="board-loading-progress-fill"></div></div>
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
	          <path d="M 0 0 L 7 3.5 L 0 7 z" fill="${this.bestMoveArrow?.color || '#77c75d'}"></path>
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

    // Progress bar: visible only when a numeric progress has been set.
    const fill = overlay.querySelector('.board-loading-progress-fill');
    const bar = overlay.querySelector('.board-loading-progress');
    if (bar && fill) {
      const hasProgress = (typeof this.loadingProgress === 'number' && Number.isFinite(this.loadingProgress));
      bar.classList.toggle('active', hasProgress);
      fill.style.width = hasProgress ? `${Math.max(0, Math.min(100, this.loadingProgress))}%` : '0%';
    }

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

        const toSq = getSquareFromPoint(event.clientX, event.clientY);
        if (toSq && dragFromSq && this.legalMoves.includes(toSq)) {
          if (this.onMove) this.onMove(dragFromSq, toSq);
	          this.selectedSquare = null;
	          this.legalMoves = [];
	        }
	      } else if (event && this.pendingDrag?.sq) {
	        this._suppressNextClick = true;

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

    this.cancelDrag = () => cleanupDrag();
    this._addDestroyableListener(this.container,'pointerdown', (e) => {
      if (!this.interactive) return;
      this._suppressNextClick = false;
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

    this._addDestroyableListener(document, 'pointermove', (e) => {
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

    this._addDestroyableListener(document, 'pointerup', (e) => {
      if (this.dragPointerId !== e.pointerId) return;
      cleanupDrag(e);
    });

    this._addDestroyableListener(document, 'pointercancel', (e) => {
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

    this._addDestroyableListener(this.container,'contextmenu', (event) => {
      if (event.target.closest('.square')) event.preventDefault();
    });

    this._addDestroyableListener(this.container,'pointerdown', (event) => {
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

	      if (event.button === 0 && window.QualityOfLife?.preferences().clearArrows !== false) {
	        this.clearUserArrows();
	        this.clearInvertedSquares();
	      }
    });

    this._addDestroyableListener(this.container,'pointermove', (event) => {
      if (!this.annotationPointer || this.annotationPointer.id !== event.pointerId) return;
      this.annotationPointer.moved = true;
      event.preventDefault();
    });

    this._addDestroyableListener(this.container,'pointerup', (event) => {
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

    this._addDestroyableListener(document, 'pointerdown', (event) => {
      if (event.button !== 0) return;
      if (!this.wrapper || this.wrapper.contains(event.target)) return;
      this.clearUserArrows();
    });
  }
}

window.ChessBoard = ChessBoard;
