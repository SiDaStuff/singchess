import { structuredLesson, renderTacticalLesson } from './tactical-coach.js';
import './tactical-coach.css';

// References carry their own legal position. Previews never mutate app.chess.
function buildExplanationReferences(text, result, Chess) {
  const before = new Chess();
  if (!before.load(result.fenBefore || result.fen || '')) return [{ text }];
  const played = before.move(result.moveSan || result.move);
  if (!played) return [{ text }];
  const fenBefore = result.fenBefore || result.fen;
  const fenAfter = before.fen();
  let current = fenBefore;
  const parts = [];
  const mentionedMoves = new Map();
  const types = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q' };
  let lastMoveReference = null;
  const pattern = /\b(?:O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=[QRBN])?)[+#]?\b[+#]?/g;
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    const token = match[0], prefix = text.slice(end, match.index);
    const preceding = text.slice(Math.max(0, match.index - 100), match.index);
    parts.push({ text: prefix });
    // Explicit sentence labels start a new branch, not a continuation of the
    // last move mentioned. This avoids previewing the engine alternative as
    // though it were the opponent's reply.
    if (/(?:Better was|engine preferred|engine selected|Compare the engine line)\s*$/i.test(preceding)) current = fenBefore;
    else if (/(?:After the played move, the engine line is|The line runs|In the engine continuation,)\s*$/i.test(preceding)) current = fenAfter;
    const squareMention = /^[a-h][1-8]$/.test(token)
      && /(?:\b(?:on|from|to|along|square|squares|at)|[a-h][1-8]\s+(?:and|or)|[–—])\s*$/i.test(preceding);
    let move = null, board = null, moveBefore = '';
    const repeatedConsequence = /^\s+(?:captures|promotes|is checkmate)\b/.test(text.slice(match.index + token.length));
    if (repeatedConsequence && mentionedMoves.has(token)) {
      const captured = /^\s+captures (?:the |your )?(pawn|knight|bishop|rook|queen)\b/.exec(text.slice(match.index + token.length));
      const candidates = mentionedMoves.get(token);
      const reference = candidates.filter(item => !captured || item.captured === types[captured[1]]).at(-1);
      if (reference) {
        current = reference.fen;
        lastMoveReference = reference;
        parts.push({ ...reference });
        end = match.index + token.length;
        continue;
      }
    }
    if (!squareMention) {
      const candidates = [current, fenAfter, fenBefore].filter((fen, i, arr) => arr.indexOf(fen) === i);
      for (const fen of candidates) {
        const candidate = new Chess(fen);
        const legal = candidate.moves({ verbose: true }).find(m => m.san === token);
        if (!legal) continue;
        candidate.move(legal);
        board = candidate; move = legal; moveBefore = fen; break;
      }
    }
    if (move) {
      current = board.fen();
      const reference = { text: token, kind: 'move', fen: current, beforeFen: moveBefore, captured: move.captured, from: move.from, to: move.to, check: board.in_check(), mate: board.in_checkmate() };
      if (!mentionedMoves.has(token)) mentionedMoves.set(token, []);
      mentionedMoves.get(token).push(reference);
      lastMoveReference = reference;
      parts.push(reference);
    } else if (/^[a-h][1-8]$/.test(token)) {
      const captureMention = /captures (?:the |your )?(pawn|knight|bishop|rook|queen) on\s*$/i.exec(preceding);
      const capturedPosition = captureMention && lastMoveReference?.to === token
        && lastMoveReference.captured === types[captureMention[1].toLowerCase()] ? lastMoveReference.beforeFen : current;
      parts.push({ text: token, kind: 'square', fen: capturedPosition, square: token });
    } else parts.push({ text: token });
    end = match.index + token.length;
  }
  parts.push({ text: text.slice(end) });
  return parts;
}

const referenceCaches = new WeakMap();
export function explanationReferences(text, result, Chess) {
  let cache = referenceCaches.get(Chess);
  if (!cache) { cache = new Map(); referenceCaches.set(Chess, cache); }
  const key = `${result.fenBefore || result.fen}\n${result.moveSan || result.move}\n${text}`;
  if (!cache.has(key)) {
    cache.set(key, buildExplanationReferences(text, result, Chess));
    if (cache.size > 96) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

if (typeof window !== 'undefined') {
  let restore = null, active = null, badge = null, activeKey = '', persistent = false;
  function clear() {
    restore?.(); restore = null;
    if (badge) { badge.element.style.visibility = badge.visibility; badge = null; }
    active?.setAttribute('aria-pressed', 'false'); active = null; activeKey = ''; persistent = false;
    document.getElementById('explanation-preview-status')?.replaceChildren();
    window.TacticalCoachUI?.onPreviewCleared();
  }
  function preview(button, reference, keep = false) {
    const app = window.app;
    if (!app?.board || app.isAnalyzing || (!keep && persistent)) return false;
    const key = `${reference.fen}|${reference.annotations?.explanationId || ''}|${reference.annotations?.opacity ?? ''}`;
    if (active === button && activeKey === key) return true;
    const board = new window.Chess();
    if (!board.load(reference.fen || '')) return false;
    const checkArrows = [];
    let kingSquare = null;
    if (board.in_check()) {
      for (const file of 'abcdefgh') for (const rank of '12345678') {
        const piece = board.get(file + rank);
        if (piece?.type === 'k' && piece.color === board.turn()) kingSquare = file + rank;
      }
      for (const file of 'abcdefgh') for (const rank of '12345678') {
        const from = file + rank, piece = board.get(from);
        if (piece && piece.color !== board.turn()
          && app.analyzer.coach._attacksFrom(board.fen(), from, piece.color, piece.type).includes(kingSquare)) {
          checkArrows.push({ from, to: kingSquare, color: '#ef7770' });
        }
      }
    }
    const target = { ...reference, kingSquare, checkArrows };
    // One baseline per hover session. Jump directly between branch positions;
    // restoring between references would flash the original board every time.
    if (restore) restore.update(board, target);
    else {
      if (app.elMoveBadge) {
        badge = { element: app.elMoveBadge, visibility: app.elMoveBadge.style.visibility };
        badge.element.style.visibility = 'hidden';
      }
      restore = app.board.previewPosition(board, target);
    }
    active?.setAttribute('aria-pressed', 'false');
    active = button; activeKey = key; persistent = keep; button.setAttribute('aria-pressed', 'true');
    const status = document.getElementById('explanation-preview-status');
    if (status) status.textContent = reference.kind === 'square' ? `Highlighting ${reference.square}${reference.square === kingSquare ? ' — king in check' : ''}`
      : `Previewing ${reference.text}${reference.mate ? ' — checkmate' : reference.check ? ' — check' : ''}. Your review position is unchanged.`;
    return true;
  }
  function render(container, text, result) {
    clear(); container.replaceChildren();
    const model = container.id === 'insight-coach' ? structuredLesson(result) : null;
    appendReferences(container, model?.explanation || text, result);
    const positionKey = fen => String(fen || '').split(/\s+/).slice(0, 4).join(' ');
    const variations = model ? model.variations.filter(v => v.id !== 'played' && v.source !== 'board' && v.moves?.length)
      .map(v => ({ text: `${positionKey(v.startFen) === positionKey(model.fenBefore) ? 'Compare the engine line' : 'After the played move, the engine line is'} ${v.moves.map(move => move.san).join(' ')}.` }))
      : window.app?.analyzer?.explanationVariations?.(result) || [];
    if (variations.length) {
      const details = document.createElement('details'); details.className = 'explanation-variations';
      const summary = document.createElement('summary'); summary.textContent = 'Explore the engine continuations'; details.append(summary);
      let populated = false;
      details.addEventListener('toggle', () => {
        if (!details.open || populated) return;
        populated = true;
        for (const variation of variations) {
          const paragraph = document.createElement('p'); appendReferences(paragraph, variation.text, result); details.append(paragraph);
        }
      });
      container.append(details);
    }
    bindExit(container);
    if (container.id === 'insight-coach') renderTacticalLesson(document.getElementById('tactical-coach-panel'), model, result);
  }
  function appendReferences(container, text, result) {
    const references = explanationReferences(text, result, window.Chess);
    for (const reference of references) {
      if (!reference.kind) { container.append(document.createTextNode(reference.text)); continue; }
      const button = document.createElement('button');
      button.type = 'button'; button.className = `explanation-reference explanation-${reference.kind}`;
      button.textContent = reference.text; button.setAttribute('aria-pressed', 'false');
      button.title = reference.kind === 'move' ? `Preview ${reference.text} on the board` : `Highlight ${reference.square} on the board`;
      button.setAttribute('aria-label', button.title);
      button.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') preview(button, reference); });
      // Keep the last preview across spaces and wrapped lines within the
      // explanation. The container's pointerleave restores the review board.
      button.addEventListener('focus', () => preview(button, reference));
      button.addEventListener('blur', event => {
        if (active === button && !event.relatedTarget?.closest('.explanation-reference')) clear();
      });
      button.addEventListener('click', () => {
        // A touch click focuses first. Keep its preview until another tap,
        // an outside tap, Escape, navigation, or focus moving away.
        if (active !== button) preview(button, reference);
      });
      container.append(button);
    }
  }
  function bindExit(container) {
    if (!container.dataset.previewExitBound) {
      container.dataset.previewExitBound = '1';
      container.addEventListener('pointerleave', event => {
        if (!persistent && event.pointerType !== 'touch' && container.contains(active)) clear();
      });
    }
  }
  window.MoveExplanationUI = { render, clear,
    hoverPosition: (reference, button) => preview(button, reference),
    showPosition: (reference, button) => preview(button, reference, true),
  };
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.explanation-reference, .coach-demonstration, .coach-board-dock, #btn-flip')) clear(); }, true);
  document.addEventListener('focusin', event => {
    if (active && !event.target.closest('.explanation-reference, .coach-demonstration, .coach-board-dock, #btn-flip')) clear();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') clear(); }, true);
  window.addEventListener('blur', clear);
  document.addEventListener('app-navigate', clear);
}
