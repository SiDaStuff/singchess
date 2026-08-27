// =============================================================================
// settings-demo.js — proves settings-parity with the existing app.
//
// Mounts theme + piece-set pickers into the eval card region and wires them to
// the Chessboard clean API. Each change ALSO writes the same localStorage keys
// the production app reads ('sidastuff.appearanceSettings'), so preferences
// set in the redesign persist into the real review/coach/puzzles views.
// =============================================================================

import { PIECE_THEMES, BOARD_THEMES } from './themes.js';

export function mountSettingsDemo(board) {
  const region = document.querySelector('.analysis-region');
  if (!region) return;

  const card = document.createElement('div');
  card.className = 'sc-card noise-card animate-fade-in settings-demo-card';
  card.innerHTML = `
    <h3 class="panel-title">Appearance</h3>
    <div class="settings-demo">
      <div class="field">
        <label for="demo-board-theme">Board</label>
        <select id="demo-board-theme">
          ${BOARD_THEMES.map((t) => `<option value="${t.key}">${t.label}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="demo-piece-theme">Pieces</label>
        <select id="demo-piece-theme">
          ${PIECE_THEMES.map((t) => `<option value="${t.key}">${t.label}</option>`).join('')}
        </select>
      </div>
    </div>
  `;
  region.appendChild(card);

  const boardSel = card.querySelector('#demo-board-theme');
  const pieceSel = card.querySelector('#demo-piece-theme');

  // Initialize from the board's current values
  boardSel.value = board.currentTheme;
  pieceSel.value = board.currentPieces;

  // Clean API in action
  boardSel.addEventListener('change', () => board.setTheme(boardSel.value));
  pieceSel.addEventListener('change', () => board.setPieces(pieceSel.value));
}
