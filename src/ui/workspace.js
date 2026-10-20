import { onReady } from './ready.js';
// Presentation state belongs here; chess state remains in ChessReviewApp.
onReady(() => {
  const tabs = document.getElementById('analysis-tabs');
  const title = document.getElementById('workspace-title');
  const description = document.getElementById('workspace-description');
  const panels = {
    feedback: document.getElementById('live-eval'),
    moves: document.getElementById('move-list-container'),
    graph: document.getElementById('eval-graph-card'),
  };
  let selected = 'feedback';
  let panelBeforeFairPlay = null;
  const selectPanel = (name, focus = false) => {
    if (window.PlayFairPlay?.isBlocked()) {
      if (panelBeforeFairPlay === null) panelBeforeFairPlay = name;
      name = 'moves';
    } else if (panelBeforeFairPlay !== null) {
      name = panelBeforeFairPlay;
      panelBeforeFairPlay = null;
    }
    if (!panels[name]) return;
    selected = name;
    const review = document.body.dataset.mode === 'review'
      && !document.body.classList.contains('menu-active')
      && !document.body.classList.contains('in-app-route');
    tabs.querySelectorAll('[data-panel]').forEach((button) => {
      const active = button.dataset.panel === name;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    });
    for (const [key, panel] of Object.entries(panels)) {
      const inactive = review && key !== name;
      panel.classList.toggle('tab-inactive', inactive);
      panel.inert = inactive;
    }
    tabs.hidden = !review;
  };
  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-panel]');
    if (button) selectPanel(button.dataset.panel);
  });
  document.getElementById('btn-home-sample').addEventListener('click', () => {
    if (window.LinkedStudyGame?.pgn) {
      window.LinkedChessHub.openGame(window.LinkedStudyGame);
      return;
    }
    window.app._handleImportToolSample('home');
  });
  tabs.addEventListener('keydown', (event) => {
    const names = window.PlayFairPlay?.isBlocked() ? ['moves'] : Object.keys(panels);
    const index = names.indexOf(selected);
    const next = event.key === 'ArrowRight' ? (index + 1) % names.length
      : event.key === 'ArrowLeft' ? (index + names.length - 1) % names.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? names.length - 1 : -1;
    if (next !== -1) { event.preventDefault(); selectPanel(names[next], true); }
  });

  const copy = {
    review: ['Game review', ''],
    puzzle: ['Puzzles', ''],
    coach: ['Practice game', ''],
    anticheat: ['Fair play', ''],
  };
  const labels = { '/play': 'Play · BETA', '/play/callback': 'Play · BETA', '/': 'Home', '/index': 'Home', '/review': 'Game review', '/puzzles': 'Puzzles', '/coach': 'Coach', '/anticheat': 'Fair play', '/settings': 'Settings', '/account': 'Your account', '/signin': 'Sign in', '/login': 'Sign in', '/signup': 'Create account', '/plans': 'Plans', '/boost': 'Plans', '/contact': 'Contact', '/privacy': 'Privacy', '/terms': 'Terms', '/auth': 'Account help', '/404': 'Not found', '/incompatible-browser': 'Unsupported browser' };
  const sync = () => {
    const mode = document.body.dataset.mode;
    const content = copy[mode] || copy.review;
    title.textContent = content[0];
    description.textContent = content[1];
    const label = labels[location.pathname] || (location.pathname.startsWith('/profile/') ? 'Player profile' : location.pathname.startsWith('/anticheat/report/') ? 'Fair play report' : 'Sing Chess');
    document.getElementById('header-breadcrumb').textContent = label;
    // The router owns page titles, including usernames and error-page titles.
    document.querySelectorAll('a[data-nav]').forEach((link) => {
      const planSelected = link.dataset.nav === 'plans' && ['/plans', '/boost'].includes(location.pathname);
      if (link.classList.contains('active') || planSelected) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    selectPanel(selected);
  };
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['data-mode', 'class'] });
  window.addEventListener('popstate', sync);
  document.addEventListener('app-navigate', () => queueMicrotask(sync));
  // Read-only study board uses the same renderer, pieces and rules as the app.
  const study = new window.ChessBoard('home-chess-board');
  const position = new window.Chess();
  const operaMoves = ['e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3', 'Qxf3', 'dxe5', 'Bc4', 'Nf6', 'Qb3', 'Qe7', 'Nc3', 'c6', 'Bg5', 'b5'];
  operaMoves.forEach((move) => position.move(move));
  study.interactive = false;
  study.setChessInstance(position);
  study.setPositionFromFen(position.fen());
  study.setHighlights([{ square: 'b7', type: 'highlight' }, { square: 'b5', type: 'highlight' }]);
  study.container.removeAttribute('tabindex');
  study.container.querySelectorAll('[tabindex]').forEach((cell) => cell.tabIndex = -1);
  window.addEventListener('linked-study-game', (event) => {
    const game = event.detail?.latest || event.detail;
    if (!game?.pgn || !position.load_pgn(game.pgn)) return;
    window.LinkedStudyGame = game;
    const count = position.history().length;
    const target = Math.max(1, Math.floor(count * 0.65));
    while (position.history().length > target) position.undo();
    study.setPositionFromFen(position.fen());
    study.setHighlights([]);
    const white = document.getElementById('home-study-white');
    const black = document.getElementById('home-study-black');
    const caption = document.getElementById('home-study-caption');
    const label = document.getElementById('home-study-label');
    const description = document.getElementById('home-study-description');
    if (white) white.textContent = game.white || 'White';
    if (black) black.textContent = game.black || 'Black';
    if (caption) caption.textContent = `${game.source === 'chesscom' ? 'Chess.com' : 'Lichess'} · Latest game`;
    if (label) label.textContent = 'LINKED GAME';
    if (description) description.textContent = 'A position from your latest public game.';
  });
  window.addEventListener('linked-chess-data', (event) => {
    const entry = event.detail?.linked?.find((item) => Number(item.puzzleRating) > 0);
    const description = document.getElementById('home-study-description');
    if (entry?.puzzleRating && description) {
      description.textContent = `Latest public game · ${entry.source === 'chesscom' ? 'Chess.com' : 'Lichess'} puzzle ${entry.ratingKind === 'peak' ? 'peak' : 'rating'} ${entry.puzzleRating}.`;
    }
  });
  sync();
  window.addEventListener('linked-study-reset', () => {
    window.LinkedStudyGame = null;
    position.reset();
    operaMoves.forEach(move => position.move(move));
    study.setPositionFromFen(position.fen());
    study.setHighlights([]);
    document.getElementById('home-study-white').textContent = 'Paul Morphy';
    document.getElementById('home-study-black').textContent = 'Duke Karl & Count Isouard';
    document.getElementById('home-study-caption').textContent = 'Paris · 1858';
    document.getElementById('home-study-label').textContent = 'THE OPERA GAME';
    document.getElementById('home-study-description').textContent = '17 moves. A classic attacking game.';
  });
});
