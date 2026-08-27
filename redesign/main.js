// =============================================================================
// main.js — Sing Chess redesign preview entrypoint
//
// Wires together: sidebar/header/board partials → Chessboard → Tabs → Drawer.
// Demonstrates the clean Chessboard API with the starting position + a few
// mock analysis signals (eval, moves, graph). The theme & piece-set pickers
// in the settings demo panel prove settings-parity: changing them writes the
// SAME localStorage keys the existing app reads, so this is drop-in ready.
// =============================================================================

import './styles/globals.css';
import './styles/app-shell.css';

import Chessboard from './components/Chessboard.js';
import initTabs from './components/Tabs.js';
import initDrawer from './components/Drawer.js';
import { loadPartial } from './components/partials.js';
import { mountSettingsDemo } from './components/settings-demo.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// A middlegame-ish position to show off pieces + a sample best-move arrow.
const DEMO_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1';

async function boot() {
  // 1) Mount HTML partials
  await Promise.all([
    loadPartial('Sidebar.html', 'sc-sidebar'),
    loadPartial('Header.html', 'sc-mobile-header'),
    loadPartial('BoardWrapper.html', 'board-wrapper-mount'),
  ]);

  // 2) Build the board (clean API surface)
  const board = new Chessboard({
    container: 'sc-board',
    arrowsLayer: 'sc-board-arrows',
  });
  board.setPosition(DEMO_FEN, { lastMove: { from: 'f3', to: 'f3' } }); // no last-move tint here
  board.highlightLastMove('c4', 'f3');
  // Demo best-move arrow e2-e4 (marker included by Chessboard.drawArrows)
  board.drawArrows([{ from: 'e2', to: 'e4' }]);

  // 3) Mobile chrome
  initTabs();
  initDrawer();

  // 4) Show mobile chrome only on small screens (CSS handles hiding; here we
  //    merely un-hide the elements once mounted).
  const mq = window.matchMedia('(max-width: 767px)');
  const revealMobile = () => {
    const show = mq.matches;
    document.getElementById('sc-mobile-header').hidden = !show;
    document.getElementById('sc-mobile-tabs').hidden = !show;
  };
  revealMobile();
  mq.addEventListener('change', revealMobile);

  // 5) Wire the now-present board-controls + header action buttons
  wireBoardControls(board);

  // 6) Sidebar active-state click handling (lightweight; mirrors SPA router)
  wireNavLinks();

  // 7) Settings demo: theme + piece pickers driven by the board API
  mountSettingsDemo(board);

  // 8) Mock analysis signals
  renderMockAnalysis();
}

function wireBoardControls(board) {
  document.querySelectorAll('[data-board-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.boardAction;
      switch (action) {
        case 'flip':
          board.flip();
          break;
        case 'first':
        case 'prev':
        case 'next':
        case 'last':
          // In the preview, these are no-ops beyond a tiny visual nudge.
          btn.animate(
            [{ transform: 'scale(1)' }, { transform: 'scale(0.92)' }, { transform: 'scale(1)' }],
            { duration: 160, easing: 'cubic-bezier(0.22,1,0.36,1)' }
          );
          break;
        case 'play':
          btn.classList.toggle('is-playing');
          break;
      }
    });
  });
}

function wireNavLinks() {
  document.querySelectorAll('[data-route]').forEach((link) => {
    link.addEventListener('click', (e) => {
      // Prevent hard navigation in the preview shell.
      e.preventDefault();
      const nav = link.dataset.nav;
      document.querySelectorAll('.sc-nav-link').forEach((n) => n.classList.remove('is-active'));
      link.classList.add('is-active');
      if (nav) console.debug('[redesign] navigate →', link.dataset.route, '(', nav, ')');
    });
  });
}

function renderMockAnalysis() {
  // Eval
  const score = 0.6;
  document.getElementById('eval-score').textContent =
    score > 0 ? `+${score.toFixed(1)}` : score.toFixed(1);
  document.getElementById('eval-bar').style.setProperty('--w', `${50 + score * 12}%`);

  // Moves
  const moves = [
    ['e4', 'e5'],
    ['Nf3', 'Nc6'],
    ['Bb5', 'a6'],
    ['Ba4', 'Nf6'],
  ];
  const list = document.getElementById('move-list');
  list.innerHTML = '';
  moves.forEach(([w, b], i) => {
    const num = document.createElement('li');
    num.className = 'move-num';
    num.textContent = `${i + 1}.`;
    const wCell = document.createElement('li');
    wCell.className = 'move-cell';
    wCell.innerHTML = `<span class="quality-dot" style="background:var(--color-best)"></span>${w}`;
    const bCell = document.createElement('li');
    bCell.className = 'move-cell';
    bCell.innerHTML = `<span class="quality-dot" style="background:var(--color-mistake)"></span>${b || ''}`;
    list.append(num, wCell, bCell);
  });

  // Accuracy
  document.querySelector('#accuracy-row .accuracy-stat:first-child .stat-num').textContent = '92.4%';
  document.querySelector('#accuracy-row .accuracy-stat:last-child .stat-num').textContent = '1';

  // Graph
  drawMockGraph();
}

function drawMockGraph() {
  const svg = document.getElementById('eval-graph');
  if (!svg) return;
  const pts = [0.1, -0.3, 0.4, 0.8, 0.2, -0.5, 0.6, 0.9, 0.4, 0.7];
  const w = 320;
  const h = 120;
  const pad = 8;
  const dx = (w - pad * 2) / (pts.length - 1);
  const yFor = (v) => h / 2 - (v / 1.5) * (h / 2 - pad);
  const line = pts
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(pad + i * dx).toFixed(1)} ${yFor(v).toFixed(1)}`)
    .join(' ');
  svg.innerHTML = `
    <rect x="0" y="${h / 2 - 0.5}" width="${w}" height="1" fill="var(--color-border)" />
    <path d="${line}" fill="none" stroke="var(--color-ink-700)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  `;
}

boot().catch((err) => console.error('[redesign] boot failed:', err));
