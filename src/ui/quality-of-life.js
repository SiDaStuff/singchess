import { DEFAULTS, QOL_KEY, normalizePreferences, readJson, writeJson, exportPreferences, importPreferences, studyKey, classifyReview, matchingMoves, nextMistake, schedulePuzzle, annotatedPgn } from './qol-state.js';
import { TIME_CONTROLS } from '../play/state.js';
import './quality-of-life.css';
import { onReady } from './ready.js';

const $ = selector => document.querySelector(selector);
const el = (tag, text, attributes = {}) => {
  const node = document.createElement(tag); if (text != null) node.textContent = text;
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
};
const actionIcon = text => ({
  'Previous mistake': 'chevron_left', 'Next mistake': 'chevron_right', Bookmark: 'bookmark_add', 'Remove bookmark': 'bookmark_remove',
  'Copy FEN': 'content_copy', 'Copy PGN': 'content_copy', 'Position link': 'link', 'Annotated PGN': 'download',
  'Ask Coach': 'chat', Focus: 'fullscreen', 'Restore review': 'history', 'Expand all panels': 'unfold_more',
  Commands: 'search', 'Collapse sidebar': 'left_panel_close', 'Expand sidebar': 'left_panel_open',
  Mute: 'volume_off', Unmute: 'volume_up', 'Review due puzzles': 'event_repeat', Close: 'close',
  'Export preferences': 'download', 'Import preferences': 'upload', 'Preview sound': 'volume_up',
}[text] || (text.startsWith('Reset ') ? 'restart_alt' : text.startsWith('Exit focus') ? 'fullscreen_exit' : 'arrow_forward'));
const setButtonLabel = (node, text, icon = actionIcon(text)) => {
  node.replaceChildren(el('span', icon, { class: 'material-symbols-outlined', 'aria-hidden': 'true' }), el('span', text, { class: 'qol-button-label' }));
};
const button = (text, run, title = text) => {
  const node = el('button', null, { type: 'button', class: 'btn btn-secondary btn-small qol-button', title });
  setButtonLabel(node, text);
  node.addEventListener('click', run); return node;
};
const actionGroup = (name, ...controls) => {
  const group = el('div', null, { class: 'qol-control-group', role: 'group', 'aria-label': name });
  group.append(el('h4', name), ...controls); return group;
};
const actionMenu = (name, icon, ...controls) => {
  const menu = el('details', null, { class: 'qol-action-menu' }), summary = el('summary');
  summary.append(el('span', icon, { class: 'material-symbols-outlined', 'aria-hidden': 'true' }), el('span', name));
  const actions = el('div', null, { class: 'qol-menu-actions' }); actions.append(...controls); menu.append(summary, actions); return menu;
};
const blocked = () => !!window.PlayFairPlay?.isBlocked();
const wrap = (target, key, decorate) => { const original = target[key]; if (typeof original === 'function') target[key] = decorate(original.bind(target)); };

export function installQualityOfLife(app) {
  const state = { preferences: normalizePreferences(readJson(QOL_KEY, {})), route: location.pathname, filter: 'all', restoreFocus: null, restoredUid: null, reviewOwner: app.authState.user?.uid || 'guest' };
  const scope = name => `sidastuff.${name}.${app.authState.user?.uid || 'guest'}`;
  const study = () => studyKey(app.gameMoves, app.initialFen);
  const reviewVisible = () => location.pathname === '/review' && !app.puzzleMode.active && !app.coachMode.active;
  const activeGame = () => window.Play?.full && !['mate', 'resign', 'stalemate', 'timeout', 'draw', 'outoftime', 'cheat', 'aborted', 'noStart', 'unknownFinish', 'variantEnd'].includes(window.Play.state?.status);
  const notice = el('div', '', { class: 'qol-toast', role: 'status', 'aria-live': 'polite', hidden: '' }); document.body.append(notice);
  function tell(text, error = false) {
    clearTimeout(state.noticeTimer); notice.textContent = text; notice.hidden = !text; notice.classList.toggle('error', error);
    state.noticeTimer = setTimeout(() => { notice.hidden = true; }, error ? 8000 : 2500);
  }
  const run = action => Promise.resolve().then(action).catch(error => tell(error.message || 'Unable to complete this action.', true));
  function announce(text) { $('#qol-board-status').textContent = text; }
  document.body.append(el('span', '', { id: 'qol-board-status', class: 'sr-only', 'aria-live': 'polite', role: 'status' }));

  function applyPreferences() {
    const p = state.preferences;
    writeJson(QOL_KEY, p);
    const body = document.body;
    body.dataset.coordinates = p.coordinates; body.dataset.contrast = p.contrast; body.dataset.highlightPalette = p.palette;
    body.classList.toggle('qol-hide-legal', !p.legalMoves); body.classList.toggle('qol-hide-last', !p.lastMove);
    body.classList.toggle('qol-reduced-motion', p.reducedMotion); body.classList.toggle('qol-sidebar-collapsed', p.sidebarCollapsed);
    body.style.setProperty('--piece-slide-duration', `${p.animationMs}ms`);
    body.style.setProperty('--qol-font-size', `${p.fontSize}px`);
    body.style.removeProperty('--qol-board-size');
    body.style.removeProperty('--qol-panel-size');
    app.boardSounds?.setPreferences({ sounds: p.sounds, volume: p.volume });
    if (window.Play) {
      Object.assign(window.Play.preferences, { sounds: p.sounds, volume: p.volume, autoQueen: p.autoQueen, legalMoves: p.legalMoves, coordinates: p.coordinates !== 'none', multiPremoves: p.multiPremoves });
      window.Play.board.setPreferences(window.Play.preferences);
      window.Play.clocks.tenths = p.tenths;
    }
    for (const node of document.querySelectorAll('[data-qol-setting]')) {
      const value = p[node.dataset.qolSetting];
      if (node.type === 'checkbox') node.checked = value;
      else node.value = value;
    }
    for (const mute of document.querySelectorAll('[data-qol-mute]')) { setButtonLabel(mute, p.sounds ? 'Mute' : 'Unmute'); mute.setAttribute('aria-pressed', String(!p.sounds)); }
    if ($('#qol-collapse')) setButtonLabel($('#qol-collapse'), p.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
    $('#qol-collapse')?.setAttribute('aria-expanded', String(!p.sidebarCollapsed));
  }
  let syncTimer;
  async function syncPreferences() {
    if (!app.authState.user) return;
    const appearance = { ...readJson('sidastuff.appearanceSettings', {}), usability: state.preferences };
    writeJson('sidastuff.appearanceSettings', appearance);
    try { await app._saveUserProfile({ ...app.authState.profile, appearanceSettings: appearance }, { rethrow: true }); }
    catch { tell('Settings saved on this device. Account sync is unavailable.', true); }
  }
  function save(patch) { state.preferences = normalizePreferences({ ...state.preferences, ...patch }); applyPreferences(); clearTimeout(syncTimer); syncTimer = setTimeout(syncPreferences, 600); }
  function reset(keys) { save(Object.fromEntries(keys.map(key => [key, DEFAULTS[key]]))); }

  const palette = el('dialog', null, { id: 'qol-command-palette', class: 'qol-dialog', 'aria-label': 'Commands and keyboard shortcuts' });
  const search = el('input', null, { type: 'search', placeholder: 'Search commands', 'aria-label': 'Search commands', class: 'input-select' });
  const commandList = el('div', null, { class: 'qol-command-list' });
  const commands = [
    ['Open Play', 'Alt+P', () => app._navigateTo('/play')], ['Open Review', 'Alt+R', () => app._navigateTo('/review', { skipImport: true })],
    ['Open Puzzles', 'Alt+U', () => app._navigateTo('/puzzles')], ['Open Coach', 'Alt+C', () => app._navigateTo('/coach')],
    ['Open Settings', 'Alt+S', () => app._navigateTo('/settings')], ['Flip board', 'F', () => currentBoard().flip()],
    ['Focus mode', 'Z', toggleFocus], ['Next mistake', 'J', () => jumpMistake(1)], ['Previous mistake', 'K', () => jumpMistake(-1)],
    ['Next puzzle', 'N', nextPuzzle], ['Retry puzzle', 'T', () => app._retryCurrentPuzzle()], ['Review due puzzles', '', reviewDuePuzzle],
    ['Bookmark position', 'B', bookmark], ['Copy FEN', '', () => copyFen()], ['Copy PGN', '', () => copyPgn()], ['Copy position link', '', copyLink],
    ['Export annotated PGN', '', downloadAnnotated], ['Ask Coach about this position', '', askPosition],
    ['Mute / unmute', 'M', () => save({ sounds: !state.preferences.sounds })], ['Clear board arrows', 'Escape', clearArrows],
    ['Restore saved review', '', restoreDraft], ['Expand all panels', '', expandAllPanels], ['Export preferences', '', exportSettings], ['Import preferences', '', () => importInput.click()],
  ];
  function currentBoard() { return location.pathname.startsWith('/play') ? window.Play.board.renderer : app.board; }
  function renderCommands() {
    commandList.replaceChildren();
    for (const [label, shortcut, action] of commands.filter(([label]) => label.toLowerCase().includes(search.value.toLowerCase()))) {
      const node = button(label, () => { palette.close(); run(action); }); if (shortcut) node.append(el('kbd', shortcut)); commandList.append(node);
    }
  }
  palette.append(el('h2', 'Commands'), search, commandList, button('Close', () => palette.close())); document.body.append(palette);
  search.addEventListener('input', renderCommands);
  search.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); commandList.querySelector('button')?.focus(); } if (event.key === 'Enter') commandList.querySelector('button')?.click(); });
  const openPalette = () => { renderCommands(); palette.showModal(); search.focus(); };
  const commandsButton = button('Commands', openPalette, 'Commands (Ctrl/Cmd+K)'); commandsButton.id = 'qol-commands'; commandsButton.setAttribute('aria-label', 'Commands'); $('.apple-header-actions')?.prepend(commandsButton);
  const collapse = button('Collapse sidebar', () => save({ sidebarCollapsed: !state.preferences.sidebarCollapsed }), 'Toggle sidebar (Alt+\\)'); collapse.id = 'qol-collapse'; $('.sidebar-footnote')?.before(collapse);

  function toggleFocus() {
    if (location.pathname.startsWith('/play')) { $('[data-action="focus"]')?.click(); return; }
    document.body.classList.toggle('qol-focus'); $('#qol-exit-focus').hidden = !document.body.classList.contains('qol-focus');
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  const exitFocus = button('Exit focus mode (Z)', toggleFocus); exitFocus.id = 'qol-exit-focus'; exitFocus.hidden = true; document.body.append(exitFocus);
  function clearArrows() { for (const board of window.ChessBoard.instances || [app.board, window.Play?.board.renderer]) { board?.clearUserArrows(); board?.clearInvertedSquares(); board?.clearCoachAnnotations(); } }
  function jumpMistake(direction) { if (blocked() || !reviewVisible()) return; const target = nextMistake(app.analysisResults || [], app.currentMoveIndex, direction); if (target != null) app._goToMove(target); }
  function getNotes() { return readJson(scope('positionNotes'), {}); }
  function positionNotes() { return getNotes()[study()] || {}; }
  function bookmark() {
    if (blocked() || !reviewVisible()) return;
    const all = getNotes(), key = study(), index = app.currentMoveIndex;
    all[key] ||= {}; all[key][index] = { ...all[key][index], bookmarked: !all[key][index]?.bookmarked, fen: app.chess.fen() };
    if (!writeJson(scope('positionNotes'), all)) return tell('Unable to save this bookmark.', true);
    updateReviewTools();
  }
  async function copy(text) { if (!text) return; if (!await app._copyTextToClipboard(text)) throw new Error('Clipboard unavailable. Use Export to download.'); tell('Copied.'); }
  function copyFen() { if (!blocked()) return copy(app.chess.fen()); }
  function copyPgn() { if (!blocked()) return copy(app._currentPgn()); }
  function copyLink() { if (!blocked()) { const url = new URL('/review', location.origin); url.hash = 'fen=' + encodeURIComponent(app.chess.fen()); return copy(url.href); } }
  function downloadAnnotated() {
    if (blocked() || !reviewVisible()) return;
    app._downloadFile('annotated-game.pgn', annotatedPgn({ headers: app.gameHeaders, moves: app.gameMoves, results: app.analysisResults || [], variations: Object.fromEntries(app.subLines || []), notes: positionNotes(), initialFen: app.initialFen }, window.Chess));
  }
  function askPosition() {
    if (blocked()) return;
    app._pendingCoachPosition = { fen: app.chess.fen(), move: app.currentMoveIndex + 1 };
    app._navigateTo('/coach');
  }
  let shiftPromotion = false;
  app.board._addDestroyableListener(app.board.container, 'pointerdown', event => { shiftPromotion = event.shiftKey; }, true);
  app.board._addDestroyableListener(app.board.container, 'keydown', event => { shiftPromotion = event.shiftKey; }, true);
  let promotionTarget;
  wrap(app, '_handleBoardMove', original => (from, to, ...args) => { promotionTarget = to; return original(from, to, ...args); });
  wrap(app, '_requestPromotionPiece', original => (...args) => {
    if (state.preferences.autoQueen && !shiftPromotion) return Promise.resolve('q');
    const result = original(...args), modal = app.elPromotionModal?.querySelector('.modal-promotion');
    const bounds = app.board.container.querySelector(`[data-square="${promotionTarget}"]`)?.getBoundingClientRect();
    if (modal && bounds) {
      modal.style.position = 'fixed'; modal.style.width = 'min(280px,90vw)';
      modal.style.left = `${Math.max(8, Math.min(innerWidth - 288, bounds.left - 100))}px`;
      modal.style.top = `${Math.max(8, Math.min(innerHeight - 240, bounds.top))}px`;
    }
    return result;
  });
  function nextPuzzle() { if (blocked() || !app.puzzleMode.active || app.puzzleMode.loading) return; return app._loadNextPuzzle({ difficulty: state.preferences.puzzleDifficulty }); }
  function reviewDuePuzzle() {
    if (blocked()) return;
    const records = Object.values(readJson(scope('puzzleRepetition'), {})).filter(item => item.due <= Date.now()).sort((a, b) => a.due - b.due);
    if (!records.length) return tell('No puzzles due.');
    app._navigateTo('/puzzles'); app._setupPuzzle(records[0].data, 'Puzzle repetition');
    app.puzzleMode.attemptedPuzzleIds?.add(records[0].data.puzzle.id); // practice cannot award rating twice
  }

  const reviewTools = el('section', null, { class: 'card qol-review-tools', 'aria-label': 'Review tools' });
  const filter = el('select', null, { 'aria-label': 'Filter reviewed moves', class: 'input-select' });
  for (const [value, name] of [['all', 'All moves'], ['blunder', 'Blunders'], ['mistake', 'Mistakes'], ['inaccuracy', 'Inaccuracies'], ['missed', 'Missed wins']]) filter.append(el('option', name, { value }));
  filter.addEventListener('change', () => { state.filter = filter.value; filterMoves(); $('#analysis-tab-moves')?.click(); });
  const note = el('textarea', null, { rows: '3', maxlength: '4000', placeholder: 'Private note for this position', 'aria-label': 'Private position note', class: 'input-select' });
  note.addEventListener('input', () => {
    if (blocked()) return;
    const all = getNotes(), key = study(), index = app.currentMoveIndex; all[key] ||= {};
    all[key][index] = { ...all[key][index], text: note.value, fen: app.chess.fen() };
    if (!writeJson(scope('positionNotes'), all)) tell('Unable to save this note.', true);
  });
  const bookmarkButton = button('Bookmark', bookmark, 'Bookmark position (B)');
  const bookmarks = el('div', null, { class: 'qol-bookmarks' });
  const comparison = el('details'); comparison.append(el('summary', 'Played move / best move'));
  const comparisonBody = el('div', null, { class: 'qol-comparison' }); comparison.append(comparisonBody);
  const navigation = el('div', null, { class: 'qol-actions' });
  navigation.append(button('Previous mistake', () => jumpMistake(-1), 'Previous mistake (K)'), button('Next mistake', () => jumpMistake(1), 'Next mistake (J)'));
  const studyActions = el('div', null, { class: 'qol-actions' }); studyActions.append(bookmarkButton, button('Ask Coach', askPosition));
  reviewTools.append(el('h3', 'Review tools'), actionGroup('Navigate', navigation, filter), actionGroup('Notes and bookmarks', studyActions, note, bookmarks),
    actionMenu('Share and export', 'ios_share', button('Copy FEN', () => run(copyFen)), button('Copy PGN', () => run(copyPgn)), button('Position link', () => run(copyLink)), button('Annotated PGN', downloadAnnotated)),
    actionMenu('View and session', 'tune', button('Focus', toggleFocus, 'Focus mode (Z)'), button('Expand all panels', expandAllPanels), button('Restore review', restoreDraft)), comparison);
  $('.analysis-shell')?.append(reviewTools);
  function filterMoves() {
    const matches = new Set(matchingMoves(app.analysisResults || [], state.filter));
    document.querySelectorAll('#move-list .move-cell, .move-list .move-cell').forEach(cell => { cell.hidden = state.filter !== 'all' && !matches.has(Number(cell.dataset.moveIndex)); });
  }
  let comparisonKey;
  function updateReviewTools() {
    reviewTools.hidden = !reviewVisible() || blocked(); if (reviewTools.hidden) return;
    const index = app.currentMoveIndex, entries = positionNotes();
    if (document.activeElement !== note) note.value = entries[index]?.text || '';
    setButtonLabel(bookmarkButton, entries[index]?.bookmarked ? 'Remove bookmark' : 'Bookmark');
    bookmarkButton.setAttribute('aria-pressed', String(!!entries[index]?.bookmarked));
    bookmarks.replaceChildren();
    for (const [move, entry] of Object.entries(entries)) if (entry.bookmarked) bookmarks.append(button(Number(move) < 0 ? 'Start' : `Move ${Math.floor(Number(move) / 2) + 1}${Number(move) % 2 ? '...' : '.'}`, () => app._goToMove(Number(move))));
    filterMoves();
    const key = study() + index + String(app.analysisResults?.[index]?.bestMove);
    if (comparison.open && comparisonKey !== key) { comparisonKey = key; drawComparison(); }
  }
  const comparisonBoards = [];
  function drawComparison() {
    if (blocked()) return;
    comparisonBoards.splice(0).forEach(board => board.destroy()); comparisonBody.replaceChildren();
    const index = app.currentMoveIndex, result = app.analysisResults?.[index];
    if (!result || index < 0) { comparisonBody.append(el('p', 'Select a reviewed move.')); return; }
    const before = new window.Chess(app.initialFen || undefined);
    for (const san of app.gameMoves.slice(0, index)) before.move(san, { sloppy: true });
    for (const [label, candidate] of [['Played', app.gameMoves[index]], ['Best', result.bestMove]]) {
      const position = new window.Chess(before.fen());
      let move; try { move = position.move(/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(candidate || '') ? { from: candidate.slice(0, 2), to: candidate.slice(2, 4), promotion: candidate[4] } : candidate, { sloppy: true }); } catch {}
      if (!move) continue;
      const column = el('div'), wrapper = el('div', null, { class: 'board-wrapper' }), surface = el('div', null, { class: 'chess-board' }); wrapper.append(surface); column.append(el('strong', `${label}: ${move.san}`), wrapper); comparisonBody.append(column);
      const board = new window.ChessBoard(surface); board.setChessInstance(position); board.setPositionFromFen(position.fen()); if (board.flipped !== app.board.flipped) board.flip(); comparisonBoards.push(board);
    }
  }
  comparison.addEventListener('toggle', () => { if (comparison.open) { comparisonKey = null; updateReviewTools(); } });

  // Remembered panel collapse controls operate on the existing DOM.
  const savedCollapse = readJson('sidastuff.collapsedPanels', {}), collapsed = {}, panelToggles = [];
  // Only stable analysis panels can collapse. Their toolbar is always a direct
  // child, so a nested card header can never hide the button that reopens it.
  for (const id of ['live-eval', 'move-list-container', 'eval-graph-card', 'critical-moments']) {
    const card = document.getElementById(id), heading = card?.querySelector('h3, h2'); if (!heading) continue;
    const name = heading.textContent.trim(), toolbar = el('div', null, { class: 'qol-panel-toolbar' });
    heading.classList.add('qol-original-panel-heading');
    const control = button('', () => setCollapsed(!collapsed[id])); control.classList.add('qol-collapse-panel');
    function setCollapsed(value) {
      collapsed[id] = !!value; card.classList.toggle('qol-collapsed', collapsed[id]);
      setButtonLabel(control, collapsed[id] ? 'Expand' : 'Collapse', collapsed[id] ? 'expand_more' : 'expand_less');
      control.setAttribute('aria-label', `${collapsed[id] ? 'Expand' : 'Collapse'} ${name}`);
      control.title = control.getAttribute('aria-label'); control.setAttribute('aria-expanded', String(!collapsed[id]));
      writeJson('sidastuff.collapsedPanels', collapsed);
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
    toolbar.append(el('h3', name), control); card.prepend(toolbar); panelToggles.push(() => setCollapsed(false)); setCollapsed(savedCollapse?.[id] === true);
  }
  function expandAllPanels() { panelToggles.forEach(expand => expand()); }
  const graph = $('#eval-graph');
  let scrubbing = false;
  function scrub(event) {
    if (!reviewVisible() || blocked() || !app.analysisResults?.length) return;
    const bounds = graph.getBoundingClientRect(); const index = Math.max(0, Math.min(app.analysisResults.length - 1, Math.round((event.clientX - bounds.left) / bounds.width * (app.analysisResults.length - 1)))); if (index !== app.currentMoveIndex) app._goToMove(index);
  }
  graph?.addEventListener('pointerdown', event => { scrubbing = true; graph.setPointerCapture(event.pointerId); scrub(event); });
  graph?.addEventListener('pointermove', event => { if (scrubbing) scrub(event); });
  graph?.addEventListener('pointerup', () => { scrubbing = false; }); graph?.addEventListener('pointercancel', () => { scrubbing = false; });
  graph?.setAttribute('tabindex', '0'); graph?.setAttribute('aria-label', 'Evaluation graph. Use left and right arrow keys to select moves.');

  function draft() {
    const metadata = app.analysisResults ? Object.fromEntries(Object.entries(app.analysisResults).filter(([key]) => !/^\d+$/.test(key))) : {};
    return { moves: app.gameMoves, headers: app.gameHeaders, initialFen: app.initialFen, cursor: app.currentMoveIndex, results: app.analysisResults, resultMetadata: metadata, subLines: Array.from(app.subLines || []), savedAt: Date.now() };
  }
  function saveDraft() { if (state.route === '/review' && !app.puzzleMode.active && !blocked() && app.gameMoves.length && state.reviewOwner === (app.authState.user?.uid || 'guest')) writeJson(scope('reviewDraft'), draft()); }
  function cacheReview() {
    if (blocked() || !reviewVisible() || state.reviewOwner !== (app.authState.user?.uid || 'guest') || !app.analysisResults?.length || app.analysisResults.length !== app.gameMoves.length) return;
    const records = readJson(scope('reviewCache'), []), key = study();
    const next = [{ key, profile: app._getReviewProfile(), ...draft() }, ...records.filter(record => record.key !== key)].slice(0, 8);
    while (next.length > 1 && JSON.stringify(next).length > 2500000) next.pop();
    writeJson(scope('reviewCache'), next); saveDraft();
  }
  function showCached(record) {
    if (blocked()) return;
    app.analysisResults = Object.assign(record.results, record.resultMetadata || {});
    for (const result of app.analysisResults) if (window.MoveClassification?.[result.classificationKey]) result.classification = window.MoveClassification[result.classificationKey];
    app.subLines = new Map(record.subLines || []); app._showReviewSummary(); app._renderMoveList(); app._drawEvalGraph(); app._renderCriticalMoments(); app._renderPostReviewEvalPanel();
  }
  function restoreDraft() {
    if (blocked()) return tell('Finish the online game before opening a review.', true);
    const record = readJson(scope('reviewDraft'));
    if (!record?.moves?.length || record.moves.length > 1000 || Date.now() - record.savedAt > 30 * 86400000) return tell('No saved review.');
    app._navigateTo('/review', { skipImport: true, disableRestore: true });
    app._hidePgnModal();
    app._loadGame(record.moves, { ...record.headers, FEN: record.initialFen });
    if (record.results?.length) showCached(record);
    app.currentMoveIndex = -2; app._goToMove(record.cursor ?? -1);
  }
  wrap(app, '_saveGameState', original => (...args) => { const value = original(...args); saveDraft(); return value; });
  wrap(app, '_showReviewSummary', original => (...args) => { const value = original(...args); cacheReview(); updateReviewTools(); return value; });
  wrap(app, '_loadGame', original => (...args) => { state.reviewOwner = app.authState.user?.uid || 'guest'; const value = original(...args); const cached = readJson(scope('reviewCache'), []).find(record => record.key === study()); if (cached && !blocked() && reviewVisible()) showCached(cached); if (reviewVisible()) restoreOrientation(); updateReviewTools(); return value; });
  wrap(app, 'openPlayReview', original => async (...args) => {
    state.openingPlayReview = true;
    try {
      const value = await original(...args);
      const cached = readJson(scope('reviewCache'), []).find(record => record.key === study() && JSON.stringify(record.profile) === JSON.stringify(app._getReviewProfile()));
      if (cached && app.analysisResults?.length) app._pendingPlayReview = null;
      return value;
    } finally { state.openingPlayReview = false; }
  });
  wrap(app, '_startReview', original => async (...args) => {
    if (blocked()) return;
    const cached = readJson(scope('reviewCache'), []).find(record => record.key === study() && JSON.stringify(record.profile) === JSON.stringify(app._getReviewProfile()));
    if (cached && (state.openingPlayReview || !app.analysisResults?.length)) showCached(cached); else await original(...args);
    if (blocked() || !app.analysisResults?.length) return;
    if (state.preferences.firstMistake) { const first = nextMistake(app.analysisResults, -1); if (first != null) app._goToMove(first); }
    cacheReview(); updateReviewTools();
  });
  wrap(app, '_goToMove', original => (...args) => { const value = original(...args); updateReviewTools(); saveDraft(); return value; });
  wrap(app, '_renderMoveList', original => (...args) => { const value = original(...args); filterMoves(); return value; });

  const puzzleTools = $('.puzzle-controls-secondary');
  const duePuzzles = button('Review due puzzles', reviewDuePuzzle); duePuzzles.classList.add('puzzle-action'); puzzleTools?.append(duePuzzles);
  $('#btn-puzzle-next')?.setAttribute('title', 'Next puzzle (N)'); $('#btn-puzzle-retry')?.setAttribute('title', 'Retry puzzle (T)');
  const puzzleExplanation = el('p', '', { class: 'qol-puzzle-explanation', hidden: '' }); puzzleTools?.after(puzzleExplanation);
  wrap(app, '_setupPuzzle', original => (...args) => { const value = original(...args); puzzleExplanation.hidden = true; requestAnimationFrame(() => app.board.container.focus({ preventScroll: true })); return value; });
  wrap(app, '_recordPuzzleAttempt', original => async (solved, ...args) => {
    const data = app.puzzleMode.current, uid = app.authState.user?.uid || 'guest';
    const result = await original(solved, ...args);
    if (data?.puzzle?.id && uid === (app.authState.user?.uid || 'guest')) {
      const records = readJson(scope('puzzleRepetition'), {}), id = data.puzzle.id;
      if (!solved || records[id]) { records[id] = { ...schedulePuzzle(records[id], solved), data }; const sorted = Object.entries(records).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 150); writeJson(scope('puzzleRepetition'), Object.fromEntries(sorted)); }
      if (solved) { puzzleExplanation.textContent = `Solved. Themes: ${(data.puzzle.themes || []).join(', ') || 'Tactics'}. Use Review Puzzle for the move explanation.`; puzzleExplanation.hidden = false; }
    }
    return result;
  });
  wrap(app, '_loadNextPuzzle', original => (options = {}) => { if (app.elPuzzleTheme) app.elPuzzleTheme.value = state.preferences.puzzleTheme; return original({ difficulty: state.preferences.puzzleDifficulty, ...options }); });
  if (app.elPuzzleTheme) app.elPuzzleTheme.addEventListener('change', () => save({ puzzleTheme: app.elPuzzleTheme.value }));

  const importInput = el('input', null, { type: 'file', accept: 'application/json,.json', hidden: '' }); document.body.append(importInput);
  importInput.addEventListener('change', () => run(async () => {
    const file = importInput.files[0]; if (!file) return; if (file.size > 200000) throw new Error('Settings file is too large.');
    importPreferences(JSON.parse(await file.text())); state.preferences = normalizePreferences(readJson(QOL_KEY, {}));
    app._applyAppearanceSettings(); app._loadAppearanceSettingsIntoUi(); applyPreferences(); await syncPreferences(); tell('Settings imported. Reloading.'); importInput.value = ''; saveDraft(); setTimeout(() => location.reload(), 400);
  }));
  function exportSettings() { app._downloadFile('chess-preferences.json', JSON.stringify(exportPreferences(), null, 2)); }
  const settings = el('section', null, { class: 'card settings-section', id: 'settings-usability' }); settings.append(el('h2', 'Controls and accessibility'));
  const fields = [
    ['Navigation', [['rememberPage', 'Restore last page', 'check'], ['warnLeaving', 'Warn before leaving an active game or analysis', 'check'], ['sidebarCollapsed', 'Collapse sidebar', 'check']]],
    ['Board', [['animationMs', 'Animation duration (ms; 0 = instant)', 'range', 0, 700], ['coordinates', 'Coordinates', ['none', 'inside', 'outside']], ['legalMoves', 'Legal move dots', 'check'], ['lastMove', 'Last move highlight', 'check'], ['clearArrows', 'Clear drawings after moves', 'check'], ['autoQueen', 'Auto-queen (Shift chooses a piece)', 'check']]],
    ['Sound', [['sounds', 'Game sounds', 'check'], ['volume', 'Volume', 'range', 0, 1, .05]]],
    ['Accessibility', [['contrast', 'Contrast', ['normal', 'high']], ['palette', 'Highlight colors', ['default', 'blue-orange', 'purple-gold']], ['reducedMotion', 'Reduce motion', 'check'], ['fontSize', 'Move list and explanation text size', 'range', 11, 22]]],
    ['Play', [['multiPremoves', 'Queue multiple premoves', 'check'], ['tenths', 'Clock tenths below 10 seconds', 'check'], ['notifications', 'Notify when a game starts or it is your turn', 'check']]],
    ['Study', [['firstMistake', 'Open completed reviews at first mistake', 'check'], ['puzzleDifficulty', 'Puzzle difficulty', ['easier', 'normal', 'harder']], ['puzzleTheme', 'Puzzle theme', ['mix', 'mate', 'fork', 'pin', 'endgame']]]],
  ];
  for (const [name, items] of fields) {
    const fieldset = el('fieldset'); fieldset.append(el('legend', name));
    for (const [key, label, kind, min, max, step] of items) {
      const row = el('label', null, { class: 'qol-setting' }), labelNode = el('span', label);
      const input = Array.isArray(kind) ? el('select', null, { class: 'input-select' }) : el('input', null, { type: kind === 'check' ? 'checkbox' : 'range' });
      if (Array.isArray(kind)) kind.forEach(value => input.append(el('option', value.replaceAll('-', ' '), { value })));
      if (kind === 'range') { input.min = min; input.max = max; input.step = step || 1; }
      input.dataset.qolSetting = key;
      input.addEventListener('change', () => {
        const value = kind === 'check' ? input.checked : kind === 'range' ? Number(input.value) : input.value;
        if (key === 'notifications' && value) {
          if (!('Notification' in window)) { input.checked = false; return tell('Notifications are unavailable in this browser.', true); }
          Notification.requestPermission().then(permission => { save({ notifications: permission === 'granted' }); if (permission !== 'granted') tell('Notifications were not enabled.'); }); return;
        }
        save({ [key]: value });
      });
      row.append(labelNode, input); fieldset.append(row);
    }
    fieldset.append(button(`Reset ${name.toLowerCase()}`, () => reset(items.map(([key]) => key))));
    if (name === 'Sound') fieldset.append(button('Preview sound', () => { app.boardSounds.unlock().then(() => app.boardSounds.play('move')); }));
    settings.append(fieldset);
  }
  settings.append(actionGroup('Settings file', button('Export preferences', exportSettings), button('Import preferences', () => importInput.click()))); $('#settings-board')?.after(settings);
  // Existing appearance and engine sections get independent reset controls.
  $('#settings-board')?.append(button('Reset board appearance', () => { writeJson('sidastuff.appearanceSettings', { colorTheme: 'system', boardTheme: 'classic', pieceTheme: 'cburnett', pieceAnimations: true }); app._applyAppearanceSettings(); app._loadAppearanceSettingsIntoUi(); syncPreferences(); }));
  $('#btn-save-engine-settings')?.after(button('Reset engine settings', () => run(async () => {
    const defaults = { source: 'browser', module: 'lite-single', reviewStrength: 'standard', advancedEngine: false, customDepth: 16, customTimeMs: 8000, maxTimeOverride: false, strength: 'depth14', depthProfile: 'depth14', liveDeepening: true, forcedDepth: 16, analysisLocation: 'server', serverStrength: 'normal' };
    writeJson('sidastuff.engineSettings', defaults); Object.assign(app.engineSettings, defaults); app._initEngineControls();
    if (app.authState.user) await app._saveUserProfile({ ...app.authState.profile, engineSettings: defaults });
    tell('Engine settings reset. Reloading.'); saveDraft(); setTimeout(() => location.reload(), 400);
  })));

  // Route and scroll restoration never replace the in-memory chess position.
  const scrolls = readJson('sidastuff.routeScrolls', {});
  function snapshotWorkspace() {
    return { uid: app.authState.user?.uid || 'guest', fen: app.chess.fen(), moves: app.gameMoves.slice(), headers: { ...app.gameHeaders }, initialFen: app.initialFen, cursor: app.currentMoveIndex, results: app.analysisResults, subLines: app.subLines, puzzle: { ...app.puzzleMode }, live: app.liveMoveResults, originalMoves: app.originalGameMoves?.slice() };
  }
  function restoreWorkspace(record, puzzle = false) {
    if (!record || record.uid !== (app.authState.user?.uid || 'guest')) return;
    app.gameMoves = record.moves.slice(); app.gameHeaders = { ...record.headers }; app.initialFen = record.initialFen; app.currentMoveIndex = record.cursor;
    app.analysisResults = record.results; app.liveMoveResults = record.live; app.subLines = record.subLines; app.originalGameMoves = record.originalMoves || record.moves.slice();
    app.chess = new window.Chess(record.fen); app.board.setChessInstance(app.chess);
    if (puzzle) app.puzzleMode = { ...record.puzzle, active: true };
    app._updateBoard(); app._renderMoveList(); app._syncActionButtons(); if (puzzle) app._syncPuzzlePanel();
    else if (record.results && !blocked()) showCached({ ...draft(), results: record.results });
  }
  wrap(app, '_enterReviewMode', original => (...args) => { const value = original(...args); restoreWorkspace(state.reviewSession); return value; });
  wrap(app, '_enterPuzzleMode', original => async (...args) => { await original(...args); restoreWorkspace(state.puzzleSession, true); });
  wrap(app, '_applyRoute', original => (path, options = {}) => {
    saveDraft();
    if (state.route === '/review' && !app.puzzleMode.active) state.reviewSession = snapshotWorkspace();
    if (state.route === '/puzzles' && app.puzzleMode.current) state.puzzleSession = snapshotWorkspace();
    scrolls[state.route] = window.scrollY; writeJson('sidastuff.routeScrolls', scrolls);
    if (path === '/review' && state.reviewSession) options = { ...options, skipImport: true };
    if (path !== '/review' || options.skipImport) app._hidePgnModal();
    const value = original(path, options); state.route = location.pathname;
    writeJson('sidastuff.lastPage', state.route);
    document.body.classList.remove('qol-focus'); exitFocus.hidden = true;
    requestAnimationFrame(() => { window.scrollTo(0, scrolls[state.route] || 0); updateReviewTools(); restoreOrientation(); });
    return value;
  });
  wrap(app, '_navigateTo', original => (path, options = {}) => {
    if (state.preferences.warnLeaving && path !== location.pathname && (app.isAnalyzing || activeGame() && location.pathname.startsWith('/play'))) {
      if (!window.confirm(activeGame() ? 'Leave the game screen? Your game will continue.' : 'Leave this analysis? Your review will be saved.')) return;
    }
    return original(path, options);
  });
  function restoreOrientation() {
    const key = location.pathname.startsWith('/play') ? 'play' : 'review'; const flipped = readJson(`sidastuff.orientation.${key}`);
    if (typeof flipped === 'boolean' && currentBoard()?.flipped !== flipped) currentBoard()?.flip();
  }
  for (const [board, key] of [[app.board, 'review'], [window.Play?.board.renderer, 'play']]) if (board) wrap(board, 'flip', original => (...args) => { const value = original(...args); writeJson(`sidastuff.orientation.${key}`, board.flipped); return value; });
  window.addEventListener('beforeunload', event => {
    saveDraft(); scrolls[location.pathname] = scrollY; writeJson('sidastuff.routeScrolls', scrolls);
    if (state.preferences.warnLeaving && (activeGame() || app.isAnalyzing)) { event.preventDefault(); event.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveDraft(); });
  document.addEventListener('keydown', event => {
    const editing = event.target.closest('input, textarea, select, [contenteditable="true"]');
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openPalette(); return; }
    if (editing || event.ctrlKey || event.metaKey || document.querySelector('dialog[open], .swal2-container') || document.body.classList.contains('modal-open')) return;
    const key = event.key.toLowerCase();
    if (event.altKey) {
      const route = { p: '/play', r: '/review', u: '/puzzles', c: '/coach', s: '/settings' }[key];
      if (route) { event.preventDefault(); app._navigateTo(route, { skipImport: true }); }
      if (key === '\\') { event.preventDefault(); save({ sidebarCollapsed: !state.preferences.sidebarCollapsed }); }
      return;
    }
    if (key === 'escape') { clearArrows(); return; }
    const action = { f: () => currentBoard().flip(), z: toggleFocus, j: () => jumpMistake(1), k: () => jumpMistake(-1), b: bookmark, n: nextPuzzle, t: () => app.puzzleMode.active && app._retryCurrentPuzzle(), m: () => save({ sounds: !state.preferences.sounds }) }[key];
    if (action) { event.preventDefault(); run(action); }
  });
  // Native dialogs return focus to their opener, including keyboard activation.
  const nativeShowModal = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function (...args) { this.qolOpener = document.activeElement; return nativeShowModal.apply(this, args); };
  document.addEventListener('close', event => { if (event.target instanceof HTMLDialogElement) event.target.qolOpener?.focus({ preventScroll: true }); }, true);
  for (const [selector, shortcut] of [['#btn-flip', 'F'], ['#btn-first', 'Home'], ['#btn-last', 'End'], ['#btn-prev', 'Left'], ['#btn-next', 'Right'], ['[data-nav="play"]', 'Alt+P'], ['[data-nav="review"]', 'Alt+R'], ['[data-nav="puzzles"]', 'Alt+U'], ['[data-nav="coach"]', 'Alt+C']]) {
    const node = $(selector); if (node) { node.title = `${node.getAttribute('aria-label') || node.textContent.trim()} (${shortcut})`; node.setAttribute('aria-keyshortcuts', shortcut.replace('+', '+')); }
  }

  function authReady() {
    if (!app.authState.initialized) return;
    const uid = app.authState.user?.uid || 'guest'; if (state.restoredUid === uid) return; state.restoredUid = uid;
    if (state.reviewSession?.uid !== uid) state.reviewSession = null;
    if (state.puzzleSession?.uid !== uid) state.puzzleSession = null;
    note.value = ''; updateReviewTools();
    const remote = app.authState.profile?.appearanceSettings;
    if (remote?.usability) { state.preferences = normalizePreferences(remote.usability); writeJson('sidastuff.appearanceSettings', remote); app._applyAppearanceSettings(remote); applyPreferences(); }
    if (reviewVisible() && !app.gameMoves.length && !location.hash) restoreDraft();
  }
  window.addEventListener('linked-auth', authReady); window.addEventListener('play:auth', authReady); window.addEventListener('app-settings-saved', () => { applyPreferences(); syncPreferences(); });
  const previousApiFetch = window.apiFetch;
  window.apiFetch = async (...args) => {
    try { const response = await previousApiFetch(...args); updateHealth(response.status < 500); return response; }
    catch (error) { if (error.name !== 'AbortError') updateHealth(false); throw error; }
  };
  const health = el('span', '', { class: 'qol-health', role: 'status', 'aria-live': 'polite' }); $('.header-location')?.append(health);
  let apiOnline = true;
  function updateHealth(online = apiOnline) {
    apiOnline = online; health.hidden = navigator.onLine && online;
    health.textContent = !navigator.onLine ? 'Offline' : online ? '' : 'Connection unavailable';
  }
  window.addEventListener('online', () => updateHealth()); window.addEventListener('offline', () => updateHealth());
  const engineStatus = $('#engine-status'); if (engineStatus) new MutationObserver(() => updateHealth()).observe(engineStatus, { childList: true, subtree: true, characterData: true });
  const backToGame = button('Back to game', () => app._navigateTo('/play')); backToGame.classList.add('qol-back-game'); backToGame.hidden = true; $('.apple-header-actions')?.prepend(backToGame);
  window.addEventListener('play:fairplay', () => { backToGame.hidden = !blocked(); updateReviewTools(); });
  // Event name is also used by engine/fair-play consumers.
  window.addEventListener('play:fair-play', () => { backToGame.hidden = !blocked(); updateReviewTools(); });
  wrap(app, '_applyPlayFairPlay', original => (...args) => { const result = original(...args); backToGame.hidden = !blocked(); if (blocked()) $('#coach-position-preview')?.close(); updateReviewTools(); return result; });
  installPlayExtras();
  window.addEventListener('play:ready', () => { installPlayExtras(); applyPreferences(); });
  function installPlayExtras() {
    const play = window.Play; if (!play || play.qolInstalled) return;
    play.qolInstalled = true;
    wrap(play.board.renderer, 'flip', original => (...args) => { const value = original(...args); writeJson('sidastuff.orientation.play', play.board.renderer.flipped); return value; });
    wrap(play.board, 'setOrientation', original => color => { const remembered = readJson('sidastuff.orientation.play'); return original(typeof remembered === 'boolean' ? remembered ? 'black' : 'white' : color); });
    const mute = button('Mute', () => save({ sounds: !state.preferences.sounds }), 'Mute game sounds (M)'); mute.dataset.qolMute = '';
    play.root.querySelector('.play-board-toolbar > div')?.prepend(mute);
    const latency = el('span', '', { class: 'qol-health', 'aria-label': 'Last request round trip' }); play.root.querySelector('.play-board-toolbar')?.append(latency);
    const fallback = el('a', 'Open on Lichess', { href: 'https://lichess.org', class: 'btn btn-secondary btn-small', target: '_blank', rel: 'noopener noreferrer', hidden: '' }); play.root.querySelector('.play-board-toolbar')?.append(fallback);
    const previousRequest = play.api.request.bind(play.api);
    play.api.request = async (...args) => {
      const startedAt = performance.now();
      const response = await previousRequest(...args);
      if (!args[1]?.stream) latency.textContent = `${Math.round(performance.now() - startedAt)} ms`;
      return response;
    };
    const searchTime = el('small', '', { class: 'qol-search-time' }); play.$('search').append(searchTime);
    const challengeTime = el('small', '', { class: 'qol-search-time' });
    let searchStarted = 0, challengeStarted = 0;
    wrap(play, 'start', original => async (...args) => { searchStarted = Date.now(); return original(...args); });
    wrap(play, 'challengeFriend', original => async (...args) => { const response = await original(...args); if (play.challenge) { challengeStarted = Date.now(); play.$('outgoing').append(challengeTime); } return response; });
    const elapsed = milliseconds => `${Math.floor(milliseconds / 60000)}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}`;
    // One lightweight UI timer; no game-state polling or provider requests.
    const clockTimer = setInterval(() => {
      if (document.hidden || !location.pathname.startsWith('/play')) return;
      if (play.seekController) searchTime.textContent = `Searching ${elapsed(Date.now() - searchStarted)}`;
      if (play.challenge && challengeStarted) {
        const remaining = Math.max(0, 30000 - (Date.now() - challengeStarted));
        challengeTime.textContent = `Auto-cancel in ${elapsed(remaining)}`;
        if (!remaining) { challengeStarted = 0; run(() => play.cancelSearch()); }
      }
    }, 1000);
    wrap(play, 'destroy', original => (...args) => { clearInterval(clockTimer); return original(...args); });
    const notify = (title, text, tag) => {
      if (state.preferences.notifications && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const notification = new Notification(title, { body: text, tag, icon: '/assets/icon.png' });
          notification.onclick = () => { window.focus(); app._navigateTo('/play'); notification.close(); };
        } catch { /* Notification restrictions must never interrupt the game stream. */ }
      }
    };
    wrap(play, 'handleEvent', original => event => {
      const response = original(event);
      if (event.type === 'gameStart') notify('Game started', 'Your Lichess game has started.', 'chess-game');
      if (['challengeCanceled', 'challengeDeclined'].includes(event.type)) { challengeStarted = 0; challengeTime.textContent = ''; }
      return response;
    });
    let lastTurnPly = -1;
    wrap(play, 'applyState', original => (...args) => {
      const response = original(...args);
      if (play.position?.chess.turn() === play.color?.[0] && play.position.ply !== lastTurnPly && activeGame()) { lastTurnPly = play.position.ply; notify('Your turn', `Move in your game against ${play.full?.[play.color === 'white' ? 'black' : 'white']?.name || 'your opponent'}.`, 'chess-turn'); }
      backToGame.hidden = !activeGame();
      if (play.position?.ply !== state.lastPlayPly) {
        state.lastPlayPly = play.position.ply;
        const status = !activeGame() ? play.$('result-title').textContent : play.position.chess.in_check() ? 'Check.' : '';
        announce(`${play.position.moves.at(-1)?.san || 'Game started'}. ${status} ${play.$('turn').textContent}`);
      }
      return response;
    });
    wrap(play, 'updateConnection', original => (...args) => { const response = original(...args); fallback.hidden = play.gameConnection === 'connected' || !play.full; if (play.full) fallback.href = `https://lichess.org/${play.full.id}`; return response; });
    wrap(play, 'updatePlayers', original => (...args) => {
      const response = original(...args); if (!play.position) return response;
      const captures = { w: [], b: [] }, values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
      for (const move of play.position.moves) if (move.captured) captures[move.color].push(move.captured);
      const advantage = captures.w.reduce((sum, type) => sum + values[type], 0) - captures.b.reduce((sum, type) => sum + values[type], 0);
      for (const [place, color] of [['top', play.board.renderer.flipped ? 'w' : 'b'], ['bottom', play.board.renderer.flipped ? 'b' : 'w']]) {
        const row = play.$(`player-${place}`); let pieces = row.querySelector('.play-captured');
        if (!pieces) { pieces = el('span', null, { class: 'play-captured' }); row.querySelector('div').append(pieces); }
        pieces.replaceChildren();
        for (const type of captures[color]) pieces.append(el('img', null, { src: window.getPieceSvgUri((color === 'w' ? 'b' : 'w') + type.toUpperCase()), alt: `Captured ${type}`, draggable: 'false' }));
        const material = color === 'w' ? advantage : -advantage; if (material > 0) pieces.append(el('span', `+${material}`));
      }
      return response;
    });
    const rematch = button('Rematch', () => run(async () => {
      if (!play.full || activeGame() || play.challenge || play.seekController) return;
      const full = play.full, opponent = full[play.color === 'white' ? 'black' : 'white'];
      const control = TIME_CONTROLS.find(item => item.time === full.clock?.initial / 60000 && item.increment === full.clock?.increment / 1000 && item.mode !== 'unavailable');
      if (!control || !opponent?.id) return tell('This game cannot be rematched here.', true);
      play.control = control; play.rated = !!full.rated; play.showLobby(); play.$('friend-name').value = opponent.id;
      play.$('friend-color').value = play.color === 'white' ? 'black' : 'white'; await play.challengeFriend();
    }));
    play.$('results').querySelector('[data-action="again"]')?.before(rematch);
    // Changing sound in the Play settings also changes the shared sound service.
    play.root.addEventListener('change', event => { if (event.target.dataset.preference === 'sounds') save({ sounds: event.target.checked }); if (event.target.dataset.preference === 'volume') save({ volume: Number(event.target.value) }); });
  }
  applyPreferences(); updateHealth(); updateReviewTools(); authReady();
  if (state.preferences.rememberPage && ['/', '/index'].includes(location.pathname)) {
    const last = readJson('sidastuff.lastPage'); if (['/play', '/review', '/puzzles', '/coach', '/settings'].includes(last)) app._navigateTo(last, { skipImport: true });
  }
  if (location.pathname === '/review' && location.hash.startsWith('#fen=') && !blocked()) {
    try { const fen = decodeURIComponent(location.hash.slice(5)); const position = new window.Chess(); if (position.load(fen)) app._loadGame([], { FEN: fen, SetUp: '1' }); } catch {}
  }
  window.QualityOfLife = { save, applyPreferences, tell, preferences: () => ({ ...state.preferences }), restoreDraft, reviewDuePuzzle, openPalette, updateReviewTools, syncPreferences, scope };
}

onReady(() => { if (window.app) installQualityOfLife(window.app); });
