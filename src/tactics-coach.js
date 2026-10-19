// Deterministic teaching facts. This module never asks an engine for new work.
// A legal variation demonstrates one continuation; it does not prove that the
// opponent must choose it. Geometry, legality and engine opinion stay separate.
(function registerTacticsCoach(scope) {
  'use strict';
  const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const OPPOSITE = color => color === 'w' ? 'b' : 'w';
  const point = square => [square.charCodeAt(0) - 97, Number(square[1]) - 1];
  const square = (file, rank) => file >= 0 && file < 8 && rank >= 0 && rank < 8 ? String.fromCharCode(97 + file) + (rank + 1) : null;
  const fenKey = fen => String(fen || '').trim().split(/\s+/).slice(0, 4).join(' ');
  const arrow = (from, to, role = 'tactic', label = '') => ({ from, to, role, label });
  const highlight = (at, role = 'tactic', label = '') => ({ square: at, role, label });
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const child of Object.values(value)) freeze(child);
    }
    return value;
  }
  function pieces(board, color) {
    const result = [];
    for (let rank = 0; rank < 8; rank++) for (let file = 0; file < 8; file++) {
      const at = square(file, rank), piece = board.get(at);
      if (piece && (!color || piece.color === color)) result.push({ ...piece, square: at });
    }
    return result;
  }
  function attacks(board, from, to) {
    if (from === to) return false;
    const piece = board.get(from);
    if (!piece) return false;
    const [fx, fy] = point(from), [tx, ty] = point(to), dx = tx - fx, dy = ty - fy;
    if (piece.type === 'p') return Math.abs(dx) === 1 && dy === (piece.color === 'w' ? 1 : -1);
    if (piece.type === 'n') return Math.abs(dx) * Math.abs(dy) === 2;
    if (piece.type === 'k') return Math.max(Math.abs(dx), Math.abs(dy)) === 1;
    const straight = dx === 0 || dy === 0, diagonal = Math.abs(dx) === Math.abs(dy);
    if (!(piece.type === 'q' && (straight || diagonal) || piece.type === 'r' && straight || piece.type === 'b' && diagonal)) return false;
    const sx = Math.sign(dx), sy = Math.sign(dy);
    for (let x = fx + sx, y = fy + sy; x !== tx || y !== ty; x += sx, y += sy) if (board.get(square(x, y))) return false;
    return true;
  }
  function defenders(board, at, color) {
    return pieces(board, color).filter(piece => piece.square !== at && attacks(board, piece.square, at));
  }
  function pawnFiles(board, color) {
    const counts = Array(8).fill(0);
    for (const piece of pieces(board, color)) if (piece.type === 'p') counts[point(piece.square)[0]]++;
    return counts;
  }
  function moveToken(board, token) {
    try {
      if (token && typeof token === 'object') return board.move({ from: token.from, to: token.to, promotion: token.promotion });
      const text = String(token || '').trim();
      return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(text)
        ? board.move({ from: text.slice(0, 2), to: text.slice(2, 4), promotion: text[4] }) : board.move(text);
    } catch { return null; }
  }
  function lineTokens(pv) {
    return Array.isArray(pv) ? pv : typeof pv === 'string' ? pv.trim().split(/\s+/).filter(Boolean) : [];
  }
  class TacticsCoach {
    constructor(analyzer, ChessConstructor = scope.Chess) {
      this.analyzer = analyzer;
      this.Chess = ChessConstructor;
      this.cache = new Map();
      this.cacheLimit = 96;
      this.legalCache = new Map();
    }
    _board(fen) {
      try {
        const layout = String(fen || '').split(' ')[0];
        if ((layout.match(/K/g) || []).length !== 1 || (layout.match(/k/g) || []).length !== 1) return null;
        const ranks = layout.split('/');
        if (/[pP]/.test(ranks[0] || '') || /[pP]/.test(ranks[7] || '')) return null;
        const board = new this.Chess(); return board.load(fen) ? board : null;
      } catch { return null; }
    }
    _asTurn(board, color) {
      if (board.turn() === color) return this._board(board.fen());
      const fields = board.fen().split(' ');
      fields[1] = color;
      // A hypothetical turn cannot retain an en-passant right from another turn.
      fields[3] = '-';
      return this._board(fields.join(' '));
    }
    _legalCapture(board, from, target, color) {
      const piece = board.get(target);
      if (!piece || piece.color === color) return null;
      if (piece.type === 'k') return board.in_check() && board.turn() !== color && attacks(board, from, target) ? { check: true } : null;
      const key = `${fenKey(board.fen())}:${color}`;
      let legal = this.legalCache.get(key);
      if (!legal) {
        legal = this._asTurn(board, color)?.moves({ verbose: true }) || [];
        this.legalCache.set(key, legal);
      }
      return legal.find(move => move.from === from && move.to === target && move.captured) || null;
    }
    _fact(type, label, text, board, phase, annotations = {}, lesson = '', detail = 'Exact board geometry and legal moves', verified = 'board-verified') {
      const at = annotations.highlights?.map(item => item.square).join('-') || annotations.arrows?.map(item => item.from + item.to).join('-') || '';
      return {
        id: `${phase}:${type}:${at}`, type, label, explanation: text,
        verification: { status: verified, detail }, phase, fen: board.fen(),
        arrows: (annotations.arrows || []).filter(item => item.from !== item.to), highlights: annotations.highlights || [], lesson,
      };
    }
    _variation(startFen, pv, id, label, source, expectedFirst) {
      const board = this._board(startFen), tokens = lineTokens(pv);
      if (!board || !tokens.length) return { error: 'No valid starting position or continuation.' };
      if (tokens.length > 40) return { error: 'Continuation exceeds the 40-ply teaching limit.' };
      const moves = [], steps = [{ fen: board.fen(), text: label, arrows: [], highlights: [] }];
      for (let index = 0; index < tokens.length; index++) {
        const beforeFen = board.fen(), legalMoveCount = board.moves().length, moved = moveToken(board, tokens[index]);
        if (!moved) return { error: `Move ${index + 1} is not legal in this continuation.` };
        if (!index && expectedFirst && (moved.from !== expectedFirst.from || moved.to !== expectedFirst.to || (moved.promotion || '') !== (expectedFirst.promotion || ''))) return { error: 'The continuation starts with a different move from its engine recommendation.' };
        const move = { ...moved, beforeFen, fen: board.fen(), check: board.in_check(), mate: board.in_checkmate(), forced: legalMoveCount === 1, legalMoveCount };
        moves.push(move);
        const text = moved.san + (move.mate ? ' is checkmate.' : move.forced ? ' is the only legal move in this position.' : move.check ? ' gives check; the reply is not necessarily forced.' : moved.captured ? ` captures the ${NAMES[moved.captured]} on ${moved.to}.` : ` moves the ${NAMES[moved.piece]} to ${moved.to}.`);
        const highlights = [highlight(moved.to, move.mate || move.check ? 'threat' : 'suggestion', move.mate ? 'Checkmate' : move.check ? 'Checking piece' : moved.san)];
        const arrows = [arrow(moved.from, moved.to, 'suggestion', moved.san)];
        if (move.check) {
          const king = pieces(board, board.turn()).find(piece => piece.type === 'k');
          if (king) {
            highlights.push(highlight(king.square, 'threat', move.mate ? 'King is checkmated' : 'King is in check'));
            for (const attacker of defenders(board, king.square, OPPOSITE(board.turn()))) arrows.push(arrow(attacker.square, king.square, 'threat', 'Check'));
          }
        }
        steps.push({ fen: board.fen(), text, arrows, highlights, move });
      }
      return { value: { id, label, source, verification: { status: source === 'board' ? 'board-verified' : 'legal-continuation', detail: source === 'board' ? 'The recorded move was replayed legally; no engine continuation was supplied.' : 'Every move has been replayed using chess.js. Engine choices are not compulsory replies.' }, startFen, moves, steps } };
    }
    _recommendation(fen, aliases) {
      const supplied = aliases.filter(value => value !== undefined && value !== null && !(typeof value === 'string' && (!value.trim() || /^(?:--?|0000|\(none\))$/.test(value.trim()))));
      let move = null;
      for (const token of supplied) {
        const candidate = moveToken(this._board(fen), token);
        if (!candidate) return { error: 'A recorded recommendation is not legal in this position.' };
        if (move && (move.from !== candidate.from || move.to !== candidate.to || (move.promotion || '') !== (candidate.promotion || ''))) return { error: 'SAN and UCI recommendations name different moves; this engine branch was rejected.' };
        move = candidate;
      }
      return { move };
    }
    _consistentVariation(startFen, pvSan, pvUci, id, label, source, expectedFirst) {
      if (typeof pvSan === 'string' && /^(?:--?|0000|\(none\))$/.test(pvSan.trim())) pvSan = '';
      if (typeof pvUci === 'string' && /^(?:--?|0000|\(none\))$/.test(pvUci.trim())) pvUci = '';
      const san = pvSan ? this._variation(startFen, pvSan, id, label, source, expectedFirst) : null;
      const uci = pvUci ? this._variation(startFen, pvUci, id, label, source, expectedFirst) : null;
      if (san?.error || uci?.error) return { error: san?.error || uci?.error };
      if (san && uci) {
        // The application stores shortened SAN alongside the engine's full UCI
        // line. They must match throughout the SAN prefix, and both entire
        // supplied strings must be legal; a valid prefix cannot hide a bad tail.
        if (san.value.moves.length > uci.value.moves.length || san.value.moves.some((move, index) => {
          const other = uci.value.moves[index];
          return !other || move.from !== other.from || move.to !== other.to || (move.promotion || '') !== (other.promotion || '');
        })) return { error: 'SAN and UCI continuations describe different branches; this engine line was rejected.' };
      }
      return uci || san || { error: 'No continuation was provided.' };
    }
    _linePatterns(before, after, move, phase, continuation) {
      const color = move.color, enemy = OPPOSITE(color), facts = [], afterFen = after.fen();
      const mover = after.get(move.to);
      if (!mover) return facts;
      const targets = pieces(after, enemy).filter(target => ['n', 'b', 'r', 'q', 'k'].includes(target.type) && this._legalCapture(after, move.to, target.square, color));
      const created = targets.some(target => !attacks(before, move.from, target.square));
      if (targets.length >= 2 && created) {
        const names = targets.map(target => `${NAMES[target.type]} on ${target.square}`);
        const refutation = continuation?.moves?.[0];
        const answered = refutation?.color === enemy && refutation.captured && refutation.to === move.to;
        facts.push(this._fact('fork', 'Fork / double attack', `${move.san} attacks the ${names.join(' and the ')} at the same time.${answered ? ` In the engine line, ${refutation.san} answers it by capturing the attacker.` : ''}`, after, phase,
          { arrows: targets.map(target => arrow(move.to, target.square, 'tactic', `Attacks ${NAMES[target.type]}`)), highlights: [highlight(move.to, 'suggestion', 'Double attacker'), ...targets.map(target => highlight(target.square, 'threat', `Attacked ${NAMES[target.type]}`))] }, 'When you attack two targets, check whether your opponent can capture the attacker or answer with check.', 'Both attacks are legal in this position. A capture, check or counterattack may answer them; this does not by itself prove material is won.'));
      }
      const sliders = pieces(after, color).filter(piece => ['q', 'r', 'b'].includes(piece.type));
      for (const slider of sliders) {
        const [file, rank] = point(slider.square);
        for (const [dx, dy] of DIRS) {
          if (slider.type === 'r' && dx && dy || slider.type === 'b' && (!dx || !dy)) continue;
          const hits = [];
          for (let step = 1; step < 8; step++) {
            const at = square(file + dx * step, rank + dy * step);
            if (!at) break;
            const piece = after.get(at);
            if (piece) { hits.push({ ...piece, square: at }); if (hits.length === 2) break; }
          }
          if (hits.length !== 2 || hits.some(hit => hit.color !== enemy)) continue;
          const [front, rear] = hits;
          if (slider.square !== move.to && before.get(move.to)?.color !== color && attacks(before, slider.square, front.square)) continue;
          const annotations = { arrows: [arrow(slider.square, front.square, 'tactic', 'Line attacker'), arrow(front.square, rear.square, 'tactic', 'Piece behind the target')], highlights: [highlight(front.square, 'tactic', 'Front piece'), highlight(rear.square, rear.type === 'k' ? 'threat' : 'tactic', 'Piece behind')] };
          if (front.type !== 'k' && rear.type === 'k' && attacks(after, slider.square, front.square)) {
            const replyBoard = this._asTurn(after, enemy);
            const frontMoves = replyBoard?.moves({ verbose: true }).filter(reply => reply.from === front.square) || [];
            const inline = frontMoves.filter(reply => {
              const trial = this._board(replyBoard.fen()); trial.move(reply);
              return trial.get(slider.square)?.color === color && !attacks(trial, slider.square, rear.square);
            });
            const remains = inline.length ? ` It can still play ${inline.slice(0, 2).map(reply => reply.san).join(' or ')} while keeping its king protected.` : ' It cannot make a legal move that leaves its king exposed along this line.';
            facts.push(this._fact('absolute-pin', 'Pin to the king', `The ${NAMES[slider.type]} on ${slider.square} pins the ${NAMES[front.type]} on ${front.square} to the king on ${rear.square}.${remains}`, after, phase, annotations, 'A pinned piece may move along the pin line or capture the attacker. Check actual legal moves.'));
          } else if (front.type !== 'k' && VALUES[rear.type] > VALUES[front.type]) {
            const replyBoard = this._asTurn(after, enemy);
            const exposes = replyBoard?.moves({ verbose: true }).filter(reply => reply.from === front.square).find(reply => {
              const trial = this._board(replyBoard.fen()); trial.move(reply);
              return trial.get(slider.square)?.color === color && this._legalCapture(trial, slider.square, rear.square, color);
            });
            if (exposes) facts.push(this._fact('relative-pin', 'More valuable piece behind', `The ${NAMES[slider.type]} on ${slider.square} attacks the ${NAMES[front.type]} on ${front.square}, with the more valuable ${NAMES[rear.type]} on ${rear.square} behind it.`, after, phase, annotations, 'Before moving a piece, look along the line behind it for a more valuable target.', `Legal off-line move ${exposes.san} exposes a legal rear-piece capture. Moving the front piece is legal and is not automatically losing.`));
          } else if (VALUES[front.type] > VALUES[rear.type] && this._legalCapture(after, slider.square, front.square, color)) {
            const replyBoard = this._asTurn(after, enemy);
            const exposes = replyBoard?.moves({ verbose: true }).filter(reply => reply.from === front.square).find(reply => {
              const trial = this._board(replyBoard.fen()); trial.move(reply);
              return trial.get(slider.square)?.color === color && this._legalCapture(trial, slider.square, rear.square, color);
            });
            if (exposes) facts.push(this._fact('skewer', 'Skewer alignment', `The ${NAMES[front.type]} on ${front.square} is attacked, with the ${NAMES[rear.type]} on ${rear.square} behind it on the same line.`, after, phase, annotations, 'A skewer attacks the more valuable piece in front. Test captures and counterchecks before assuming the back piece falls.', `After legal ${exposes.san}, the back piece can legally be captured. This example does not prove that every defense loses it.`));
          }
        }
      }
      for (const slider of sliders) {
        if (slider.square === move.to) continue;
        for (const target of pieces(after, enemy)) {
          if (!['n', 'b', 'r', 'q', 'k'].includes(target.type) || !attacks(after, slider.square, target.square) || attacks(before, slider.square, target.square) || !attacksThrough(before, slider.square, move.from, target.square) || !this._legalCapture(after, slider.square, target.square, color)) continue;
          const isCheck = target.type === 'k';
          facts.push(this._fact(isCheck ? 'discovered-check' : 'discovered-attack', isCheck ? 'Discovered check' : 'Discovered attack', `${move.san} clears the line from the ${NAMES[slider.type]} on ${slider.square} to the ${NAMES[target.type]} on ${target.square}.${isCheck ? ' The king is now in check.' : ''}`, after, phase,
            { arrows: [arrow(move.from, move.to, 'suggestion', 'Clears the line'), arrow(slider.square, target.square, isCheck ? 'threat' : 'tactic', 'Opened line')], highlights: [highlight(move.from, 'tactic', 'Cleared square'), highlight(target.square, 'threat', isCheck ? 'Check' : 'Attacked piece')] }, 'Look for a rook, bishop or queen behind the piece you move. Opening its line can create a second threat.'));
        }
      }
      if (after.in_check()) {
        const king = pieces(after, enemy).find(piece => piece.type === 'k');
        const checking = king ? defenders(after, king.square, color) : [];
        if (checking.length > 1) facts.push(this._fact('double-check', 'Double check', `${move.san} gives check from ${checking.map(piece => `the ${NAMES[piece.type]} on ${piece.square}`).join(' and ')}. A single block cannot stop both checks.`, after, phase, { arrows: checking.map(piece => arrow(piece.square, king.square, 'threat', 'Check')), highlights: [highlight(king.square, 'threat', 'Double check')] }, 'In double check, inspect the legal king moves rather than trying to block one attacker.'));
      }
      if (move.captured) this._captureIdeas(before, after, move, phase, continuation, facts);
      this._continuationIdeas(before, after, move, phase, continuation, facts);
      this._xrayIdeas(after, move, phase, continuation, facts);
      if (scope.TacticsAdvanced?.extract) facts.push(...scope.TacticsAdvanced.extract({ before, after, move, phase, continuation, coach: this }));
      // Preserve references to exactly the supplied after-position, including clocks.
      for (const fact of facts) fact.fen = afterFen;
      return facts;
    }
    _captureIdeas(before, after, move, phase, continuation, facts) {
      const enemy = OPPOSITE(move.color), capturedSquare = move.flags.includes('e') ? move.to[0] + move.from[1] : move.to;
      for (const target of pieces(before, enemy)) {
        if (target.square === capturedSquare || target.type === 'k' || !attacks(before, capturedSquare, target.square)) continue;
        const attack = pieces(after, move.color).find(attacker => this._legalCapture(after, attacker.square, target.square, move.color));
        if (!attack || defenders(after, target.square, enemy).length) continue;
        facts.push(this._fact('removing-defender', 'Removing a defender', `${move.san} captures the ${NAMES[move.captured]} that defended the ${NAMES[target.type]} on ${target.square}. The ${NAMES[attack.type]} on ${attack.square} now attacks that undefended piece.`, after, phase,
          { arrows: [arrow(attack.square, target.square, 'threat', 'Now undefended')], highlights: [highlight(capturedSquare, 'tactic', 'Removed defender'), highlight(target.square, 'threat', 'Undefended target')] }, 'When you exchange a defender, identify the exact piece it was protecting and check the opponent’s reply.', 'The defender is captured and the target has no geometric defenders. The capture is legal on the mover’s next turn; the opponent has a turn to respond.'));
      }
    }
    _continuationIdeas(before, after, move, phase, continuation, facts) {
      const line = continuation?.moves || [], color = move.color, enemy = OPPOSITE(color);
      if (!line.length) return;
      const first = line[0], laterCaptures = line.slice(1).filter(reply => reply.color === color && reply.captured);
      if (first.color === enemy && first.captured && first.to === move.to && VALUES[move.piece] > (VALUES[move.captured] || 0)) {
        const terminal = this._board(line[line.length - 1].fen);
        // Include both sides' captures throughout the complete continuation.
        // Merely capturing something back does not establish compensation.
        let materialBalance = VALUES[move.captured] || 0;
        for (const reply of line) {
          const change = (VALUES[reply.captured] || 0) + (reply.promotion ? VALUES[reply.promotion] - VALUES.p : 0);
          materialBalance += reply.color === color ? change : -change;
        }
        const mate = terminal?.in_checkmate() && terminal.turn() === enemy;
        const evidence = mate || materialBalance >= 0;
        if (evidence) {
          const text = `${move.san} offers the ${NAMES[move.piece]} on ${move.to}: ${first.san} captures it in the engine line. ${mate ? `That line ends with ${line[line.length - 1].san}, checkmate.` : `The line then includes ${laterCaptures.slice(0, 3).map(reply => reply.san).join(', ')}, recovering the invested material.`}`;
          facts.push(this._fact('sacrifice', 'Sacrifice with a concrete continuation', text, after, phase, { arrows: [arrow(first.from, first.to, 'threat', 'Shown acceptance')], highlights: [highlight(move.to, 'tactic', 'Offered piece')] }, 'A sacrifice needs a concrete follow-up. Compare acceptance with the engine’s strongest defense.', 'Legal acceptance followed by verified material recovery or checkmate. This is evidence from that continuation, not proof that the opponent must accept.', 'line-verified'));
          const discovered = facts.find(fact => fact.type === 'discovered-attack' || fact.type === 'discovered-check');
          if (discovered) facts.push(this._fact('clearance-sacrifice', 'Clearance sacrifice', `${move.san} both opens the verified line and offers the moving piece. ${first.san} accepts in this continuation.`, after, phase, { arrows: discovered.arrows, highlights: discovered.highlights }, 'Sometimes moving a piece away matters more than keeping it: identify the line it clears.', 'Verified opened line and legal sacrifice acceptance', 'line-verified'));
        }
      }
      if (first.color === enemy) {
        const defender = before.get(first.from);
        if (defender?.color === enemy) {
          const protectedBefore = pieces(before, enemy).filter(target => target.square !== first.from && target.square !== move.to && attacks(before, first.from, target.square));
          for (const target of protectedBefore) {
            if (!attacks(after, first.from, target.square)) continue;
            const later = laterCaptures.find(reply => reply.to === target.square && reply.captured === target.type && this._targetUnmoved(line, reply, target.square));
            if (!later) continue;
            const when = this._board(later.beforeFen);
            if (when && attacks(when, first.to, target.square)) continue;
            facts.push(this._fact('deflection', 'Deflection in the shown line', `${first.san} moves the ${NAMES[defender.type]} away from its defense of ${target.square}. In the engine line, ${later.san} then captures the ${NAMES[target.type]}.`, after, phase, { arrows: [arrow(first.from, first.to, 'threat', 'Defender can leave'), arrow(first.from, target.square, 'defense', 'Current defensive duty')], highlights: [highlight(target.square, 'threat', 'Target in the continuation')] }, 'When a defender moves, check which other targets it leaves behind.', 'Defender relationship before move and legal continuation capture. Other defenses are not ruled out.', 'line-verified'));
            if (protectedBefore.length >= 2 && first.captured && first.to === move.to) facts.push(this._fact('overloaded-defender', 'Two duties for one defender', `The ${NAMES[defender.type]} on ${first.from} defended more than one piece. In this line, ${first.san} answers one capture and ${later.san} takes another target.`, after, phase, { arrows: protectedBefore.map(targetPiece => arrow(first.from, targetPiece.square, 'defense', 'Original defensive duty')), highlights: [highlight(first.from, 'defense', 'Defender with two duties')] }, 'A defender protecting two pieces may struggle to answer two captures. Check the exact order.', 'Two defensive relationships followed by a legal capture sequence. This verifies the sequence, not that every defense fails.', 'line-verified'));
          }
          if (defender.type === 'k' && first.captured && first.to === move.to) {
            const terminal = this._board(line[line.length - 1].fen);
            if (terminal?.in_checkmate() && terminal.turn() === enemy) facts.push(this._fact('decoy', 'King decoy in the shown line', `${first.san} brings the king to ${first.to}; the displayed continuation then ends with ${line[line.length - 1].san}, checkmate.`, after, phase, { arrows: [arrow(first.from, first.to, 'threat', 'King accepts the offer')], highlights: [highlight(first.to, 'threat', 'Decoy destination')] }, 'When a king accepts a sacrifice, replay every check before calling the attack winning.', 'Legal king acceptance and terminal checkmate. Acceptance is not compulsory unless it is the only legal reply.', 'line-verified'));
          }
        }
      }
      for (const defender of pieces(before, enemy).filter(piece => ['r', 'b', 'q'].includes(piece.type))) {
        for (const target of pieces(before, enemy).filter(piece => piece.type !== 'k' && piece.square !== defender.square)) {
          if (!attacks(before, defender.square, target.square) || attacks(after, defender.square, target.square) || !attacksThrough(after, defender.square, move.to, target.square)) continue;
          const capture = laterCaptures.find(reply => reply.to === target.square && reply.captured === target.type && this._targetUnmoved(line, reply, target.square));
          if (capture) facts.push(this._fact('interference', 'Interference with a defender', `${move.san} blocks the line from ${defender.square} to ${target.square}. The displayed continuation includes ${capture.san}, capturing the target after that defense is interrupted.`, after, phase, { arrows: [arrow(defender.square, target.square, 'defense', 'Interrupted defensive line')], highlights: [highlight(move.to, 'tactic', 'Blocking square'), highlight(target.square, 'threat', 'Shown target')] }, 'A piece can defend along a line. Blocking that line may be as useful as capturing the defender.', 'Verified blocked defensive line followed by a legal target capture', 'line-verified'));
        }
      }
    }
    _targetUnmoved(line, capture, at) {
      const index = line.indexOf(capture);
      return index >= 0 && line.slice(0, index).every(reply => reply.from !== at && reply.to !== at);
    }
    _xrayIdeas(after, move, phase, continuation, facts) {
      const line = continuation?.moves || [], color = move.color, enemy = OPPOSITE(color);
      if (!line.length) return;
      for (const slider of pieces(after, color).filter(piece => ['q', 'r', 'b'].includes(piece.type))) {
        const [file, rank] = point(slider.square);
        for (const [dx, dy] of DIRS) {
          if (slider.type === 'r' && dx && dy || slider.type === 'b' && (!dx || !dy)) continue;
          const hits = [];
          for (let step = 1; step < 8; step++) {
            const at = square(file + dx * step, rank + dy * step); if (!at) break;
            const piece = after.get(at);
            if (piece) { hits.push({ ...piece, square: at }); if (hits.length === 2) break; }
          }
          if (hits.length !== 2 || hits[1].color !== enemy || !['n', 'b', 'r', 'q', 'k'].includes(hits[1].type)) continue;
          const [blocker, rear] = hits;
          let sliderAt = slider.square, revealed;
          for (const reply of line) {
            if (reply.from === rear.square || reply.to === rear.square || reply.color === enemy && reply.captured && reply.to === sliderAt) break;
            if (reply.color === color && reply.from === sliderAt) sliderAt = reply.to;
            const position = this._board(reply.fen);
            if (position?.get(sliderAt)?.color !== color || position.get(sliderAt)?.type !== slider.type) break;
            if (this._legalCapture(position, sliderAt, rear.square, color)) { revealed = reply; break; }
          }
          if (!revealed) continue;
          facts.push(this._fact('x-ray', 'X-ray line revealed in the continuation', `The ${NAMES[slider.type]} on ${slider.square} looks toward the ${NAMES[rear.type]} on ${rear.square}, but the ${NAMES[blocker.type]} on ${blocker.square} currently blocks the line. In the engine continuation, ${revealed.san} opens a legal ${rear.type === 'k' ? 'check' : 'attack'} on the rear target.`, after, phase,
            { arrows: [arrow(slider.square, blocker.square, 'tactic', 'Currently blocked line'), arrow(blocker.square, rear.square, 'tactic', 'Latent target behind the blocker')], highlights: [highlight(blocker.square, 'tactic', 'Current blocker'), highlight(rear.square, 'tactic', 'Target reached only after the line opens')] }, 'An x-ray is a future line, not a current capture. Identify the blocker and the legal move that removes it.', 'Exact blocked line and complete legal continuation opening a legal attack; other defenses are not ruled out.', 'line-verified'));
        }
      }
    }
    _positional(before, after, move, phase) {
      const facts = [], color = move.color, enemy = OPPOSITE(color), mover = after.get(move.to);
      if (!mover) return facts;
      const [file, rank] = point(move.to), [fromFile, fromRank] = point(move.from);
      if (move.flags.includes('k') || move.flags.includes('q')) {
        const rookTo = move.flags.includes('k') ? `f${move.to[1]}` : `d${move.to[1]}`;
        facts.push(this._fact('castling', 'King and rook coordinate', `${move.san} castles: the king reaches ${move.to} and the rook reaches ${rookTo}. Whether the king is safer depends on the opponent’s attacks.`, after, phase, { highlights: [highlight(move.to, 'defense', 'Castled king'), highlight(rookTo, 'suggestion', 'Rook after castling')] }, 'After castling, examine the pawn cover and the files your opponent can open.'));
      }
      if (['n', 'b'].includes(move.piece) && fromRank === (color === 'w' ? 0 : 7) && rank !== fromRank) facts.push(this._fact('development', 'Developing a piece', `${move.san} brings the ${NAMES[move.piece]} from the back rank into play on ${move.to}.`, after, phase, { arrows: [arrow(move.from, move.to, 'suggestion', 'Development')], highlights: [highlight(move.to, 'suggestion', 'Developed piece')] }, 'Bring your minor pieces into play, while checking that their new squares are tactically safe.'));
      if (['n', 'b', 'r', 'q'].includes(mover.type)) {
        const central = ['d4', 'e4', 'd5', 'e5'].filter(at => attacks(after, move.to, at) && !attacks(before, move.from, at) && after.get(at)?.color !== color);
        if (central.length) facts.push(this._fact('piece-activity', 'New central influence', `From ${move.to}, the ${NAMES[mover.type]} now attacks ${central.join(' and ')} in the center.`, after, phase, { arrows: central.map(at => arrow(move.to, at, 'suggestion', 'New central attack')), highlights: central.map(at => highlight(at, 'suggestion', 'Newly controlled central square')) }, 'Compare the squares a piece gains with those it gives up when choosing its next square.'));
      }
      if (mover.type === 'r' && !pieces(after, color).some(piece => piece.type === 'p' && point(piece.square)[0] === file)) {
        const enemyPawn = pieces(after, enemy).some(piece => piece.type === 'p' && point(piece.square)[0] === file);
        facts.push(this._fact(enemyPawn ? 'semi-open-file' : 'open-file', enemyPawn ? 'Rook on a semi-open file' : 'Rook on an open file', `The rook on ${move.to} uses the ${move.to[0]}-file, which has ${enemyPawn ? 'no friendly pawn, but does contain an enemy pawn' : 'no pawns from either side'}. Other pieces can still block the file.`, after, phase, { arrows: [arrow(move.to, `${move.to[0]}${color === 'w' ? '8' : '1'}`, 'suggestion', enemyPawn ? 'Semi-open file' : 'Open file')], highlights: [highlight(move.to, 'suggestion', 'Active file')] }, 'Open files give rooks a route into the position; first check the blockers and defended entry squares.'));
      }
      if (mover.type === 'n') {
        const supported = defenders(after, move.to, color).filter(piece => piece.type === 'p');
        const challenge = pieces(after, enemy).some(piece => piece.type === 'p' && Math.abs(point(piece.square)[0] - file) === 1 && (enemy === 'b' ? point(piece.square)[1] > rank : point(piece.square)[1] < rank));
        if (supported.length && !challenge && (color === 'w' ? rank >= 3 : rank <= 4)) {
          facts.push(this._fact('outpost', 'Pawn-supported outpost', `The knight on ${move.to} is defended by the pawn on ${supported[0].square}. Opposing pawns cannot advance to attack this square directly from their current files.`, after, phase, { arrows: [arrow(supported[0].square, move.to, 'defense', 'Pawn support')], highlights: [highlight(move.to, 'suggestion', 'Outpost'), highlight(supported[0].square, 'defense', 'Supporting pawn')] }, 'A useful outpost combines pawn support with a square that opposing pawns cannot easily challenge.', 'Exact friendly pawn support and opposing pawn-file geometry. Pieces or a changed pawn structure can still challenge the knight.'));
          facts.push(this._fact('weak-square', 'Square opposing pawns cannot challenge', `The square ${move.to} cannot be attacked by advancing an opposing pawn on its current file. Your knight occupies it with pawn support from ${supported[0].square}.`, after, phase, { highlights: [highlight(move.to, 'suggestion', 'Pawn-resistant square')] }, 'Look for supported squares that opposing pawns cannot directly challenge, then check the enemy’s piece attacks.', 'Only current pawn files and legal pawn directions are assessed. Exchanges, captures or piece attacks can change the position.'));
        }
      }
      if (move.promotion) facts.push(this._fact('promotion', 'Promotion', `${move.san} promotes the pawn to a ${NAMES[move.promotion]} on ${move.to}.`, after, phase, { arrows: [arrow(move.from, move.to, 'suggestion', 'Promotion')], highlights: [highlight(move.to, 'suggestion', `New ${NAMES[move.promotion]}`)] }, 'Check the promoted piece’s attacks immediately; promotion may give check or mate.'));
      if (mover.type === 'p') {
        const ownFiles = pawnFiles(after, color), oldFiles = pawnFiles(before, color);
        if (ownFiles[file] > 1 && ownFiles[file] > oldFiles[file]) {
          const doubled = pieces(after, color).filter(piece => piece.type === 'p' && point(piece.square)[0] === file);
          facts.push(this._fact('doubled-pawns', 'Doubled pawns', `${move.san} leaves ${ownFiles[file]} friendly pawns on the ${move.to[0]}-file: ${doubled.map(piece => piece.square).join(' and ')}. They cannot defend one another as diagonally adjacent pawns do; an open file or tactical benefit may compensate.`, after, phase, { highlights: doubled.map(piece => highlight(piece.square, 'tactic', 'Pawn on the same file')) }, 'After a pawn capture, compare the structural cost with the material or activity you gain.'));
        }
        if (!ownFiles[file - 1] && !ownFiles[file + 1]) facts.push(this._fact('isolated-pawn', 'Isolated pawn', `The pawn on ${move.to} has no friendly pawn on either adjacent file. It will need piece support if attacked.`, after, phase, { highlights: [highlight(move.to, 'tactic', 'Isolated pawn')] }, 'An isolated pawn can gain space, but pieces must handle its defense.'));
        const opposingAhead = pieces(after, enemy).some(piece => piece.type === 'p' && Math.abs(point(piece.square)[0] - file) <= 1 && (color === 'w' ? point(piece.square)[1] > rank : point(piece.square)[1] < rank));
        if (!opposingAhead) facts.push(this._fact('passed-pawn', 'Passed pawn', `No enemy pawn remains ahead of the pawn on ${move.to} on its file or either adjacent file. It is a passed pawn, though enemy pieces can still stop it.`, after, phase, { arrows: [arrow(move.to, `${move.to[0]}${color === 'w' ? '8' : '1'}`, 'suggestion', 'Promotion route')], highlights: [highlight(move.to, 'suggestion', 'Passed pawn')] }, 'Support a passed pawn and calculate the blockade before racing toward promotion.'));
      }
      const all = pieces(after), kings = all.filter(piece => piece.type === 'k');
      if (mover.type === 'r' && rank === (color === 'w' ? 6 : 1) && !all.some(piece => piece.type === 'q') && all.filter(piece => !['k', 'p'].includes(piece.type)).length <= 6) {
        const pawnTargets = pieces(after, enemy).filter(piece => piece.type === 'p' && point(piece.square)[1] === rank && attacks(after, move.to, piece.square));
        facts.push(this._fact('rook-seventh-rank', 'Rook on the seventh rank', `The rook reaches the opponent’s second rank on ${move.to}.${pawnTargets.length ? ` It attacks ${pawnTargets.map(piece => `the pawn on ${piece.square}`).join(' and ')} from the side.` : ' This puts it behind the opponent’s starting pawn line.'}`, after, phase, { arrows: pawnTargets.map(piece => arrow(move.to, piece.square, 'tactic', 'Sideways pawn attack')), highlights: [highlight(move.to, 'suggestion', 'Seventh-rank rook')] }, 'In rook endings, entry into the seventh rank can attack pawns from the side; check whether the rook can remain there safely.'));
      }
      const ownKing = kings.find(piece => piece.color === color);
      if (ownKing && (move.flags.includes('k') || move.flags.includes('q'))) {
        const [kingFile, kingRank] = point(ownKing.square), coverRank = kingRank + (color === 'w' ? 1 : -1);
        const cover = [-1, 0, 1].map(dx => square(kingFile + dx, coverRank)).filter(at => at && after.get(at)?.type === 'p' && after.get(at)?.color === color);
        if (cover.length) facts.push(this._fact('king-pawn-cover', 'Pawn cover in front of the king', `The king on ${ownKing.square} has friendly pawns directly in front on ${cover.join(', ')}. Their presence is a board fact; open lines and enemy pieces determine the king’s safety.`, after, phase, { highlights: [highlight(ownKing.square, 'defense', 'King'), ...cover.map(at => highlight(at, 'defense', 'Pawn cover'))] }, 'Inspect the pawns in front of your king and the lines that open if one moves.'));
      }
      if (move.piece === 'k' && all.every(piece => ['k', 'p'].includes(piece.type)) && kings.length === 2) {
        const [ax, ay] = point(kings[0].square), [bx, by] = point(kings[1].square);
        if (ax === bx && Math.abs(ay - by) === 2 || ay === by && Math.abs(ax - bx) === 2) facts.push(this._fact('opposition', 'Direct opposition', `The kings on ${kings[0].square} and ${kings[1].square} face one another with one square between them. ${enemy === 'w' ? 'White' : 'Black'} is to move; pawn moves and access around the kings determine whether this opposition is useful.`, after, phase, { arrows: [arrow(kings[0].square, kings[1].square, 'tactic', 'Direct opposition')], highlights: kings.map(king => highlight(king.square, 'tactic', 'Opposing king')) }, 'In pawn endings, compare whose turn it is and whether a spare pawn move changes the opposition.'));
      }
      return facts;
    }
    _terminal(after, move, phase) {
      const facts = [], enemy = after.turn(), king = pieces(after, enemy).find(piece => piece.type === 'k');
      if (after.in_checkmate()) {
        const annotations = { arrows: king ? defenders(after, king.square, move.color).map(piece => arrow(piece.square, king.square, 'threat', 'Checkmate')) : [], highlights: king ? [highlight(king.square, 'threat', 'Checkmated king')] : [] };
        facts.push(this._fact('checkmate', 'Checkmate', `${move.san} is checkmate: the king is in check and there is no legal reply.`, after, phase, annotations, 'To verify mate, check king moves, captures of the checking piece and possible blocks.'));
        if (king) {
          const [kx, ky] = point(king.square), surrounding = DIRS.map(([dx, dy]) => square(kx + dx, ky + dy)).filter(Boolean);
          const checkers = defenders(after, king.square, move.color);
          if (checkers.some(piece => piece.type === 'n') && surrounding.every(at => after.get(at)?.color === enemy)) facts.push(this._fact('smothered-mate', 'Smothered mate', `A knight checks the king on ${king.square}, whose neighboring board squares are occupied by its own pieces. No legal escape remains.`, after, phase, annotations, 'A crowded king can be vulnerable to a knight because a knight’s check cannot be blocked.'));
          if (ky === (enemy === 'w' ? 0 : 7) && checkers.some(piece => ['q', 'r'].includes(piece.type) && point(piece.square)[1] === ky)) facts.push(this._fact('back-rank-mate', 'Back-rank mate', `A rook or queen checks along the king’s back rank. The king on ${king.square} has no legal escape, capture or block.`, after, phase, annotations, 'A back-rank king needs a legal escape square or a defender that can meet the check.'));
        }
      } else if (after.in_stalemate()) facts.push(this._fact('stalemate', 'Stalemate', `${move.san} leaves the opponent with no legal move while the king is not in check. The game is drawn by stalemate.`, after, phase, { highlights: king ? [highlight(king.square, 'defense', 'Not in check')] : [] }, 'Before finishing a winning position, check that your opponent has a move or is actually in check.'));
      else if (after.insufficient_material()) facts.push(this._fact('insufficient-material', 'Insufficient mating material', 'The remaining material is insufficient for checkmate under the chess rules used by this app.', after, phase, {}, 'A material advantage does not always provide enough pieces to give checkmate.'));
      return facts;
    }
    _threats(after, move, phase = 'played') {
      if (after.game_over()) return [];
      const threats = [], color = move.color, replies = after.moves({ verbose: true });
      for (const reply of replies.filter(reply => reply.san.endsWith('#')).slice(0, 3)) {
        threats.push(this._fact('mate-threat', 'Immediate checkmate available', `The opponent can play ${reply.san}, which is checkmate.`, after, phase, { arrows: [arrow(reply.from, reply.to, 'threat', reply.san)], highlights: [highlight(reply.to, 'threat', 'Mating move')] }, 'Before choosing a plan, scan all checks against your king.', 'Legal opponent move has checkmate SAN. It is an available option, not a prediction of the move the opponent will choose.'));
        const position = this._board(after.fen()); position.move(reply);
        const king = pieces(position, color).find(piece => piece.type === 'k'), backRank = color === 'w' ? 0 : 7;
        if (king && point(king.square)[1] === backRank && defenders(position, king.square, OPPOSITE(color)).some(piece => ['r', 'q'].includes(piece.type) && point(piece.square)[1] === backRank)) threats.push(this._fact('back-rank-weakness', 'Back-rank mate is available', `${reply.san} can mate along your king’s back rank. After that check, the king on ${king.square} has no legal escape, block or capture.`, after, phase, { arrows: [arrow(reply.from, reply.to, 'threat', 'Legal back-rank mate')], highlights: [highlight(king.square, 'threat', 'King vulnerable to a legal back-rank mate')] }, 'Create a safe escape square or keep a defender when a rook or queen can enter your back rank.', 'Exact legal mate-in-one reply and terminal back-rank checking line. No longer-term weakness is inferred.'));
      }
      const seen = new Set();
      for (const reply of replies.filter(reply => reply.captured && reply.captured !== 'p').sort((a, b) => VALUES[b.captured] - VALUES[a.captured])) {
        if (seen.has(reply.to)) continue;
        seen.add(reply.to);
        const protection = defenders(after, reply.to, color), target = after.get(reply.to);
        if (!target) continue;
        const isHanging = !protection.length;
        threats.push(this._fact(isHanging ? 'hanging-piece' : 'capture-available', isHanging ? 'Undefended piece can be captured' : 'Legal capture to consider', `The opponent can play ${reply.san}, capturing your ${isHanging ? 'undefended ' : ''}${NAMES[target.type]} on ${reply.to}.${isHanging ? '' : ` Friendly ${protection.map(piece => `${NAMES[piece.type]} on ${piece.square}`).join(', ')} defend that square.`}`, after, phase, { arrows: [arrow(reply.from, reply.to, 'threat', `Legal capture: ${reply.san}`), ...protection.map(piece => arrow(piece.square, reply.to, 'defense', 'Geometric defender'))], highlights: [highlight(reply.to, 'threat', 'Capturable piece'), ...protection.map(piece => highlight(piece.square, 'defense', 'Possible defender'))] }, 'Look for your opponent’s checks and captures before committing to your own attack.', 'The capture is legal. Defenders are geometric support and may themselves be pinned; their presence is not proof of a legal or beneficial recapture.'));
        if (threats.length >= 6) break;
      }
      this._trappedPieces(after, move, phase, replies, threats);
      return threats;
    }
    _trappedPieces(after, move, phase, replies, threats) {
      const color = move.color, ownTurn = this._asTurn(after, color);
      const targets = pieces(after, color).filter(piece => ['n', 'b', 'r', 'q'].includes(piece.type) && replies.some(reply => reply.to === piece.square && reply.captured)).slice(0, 3);
      const escapeMoves = ownTurn?.moves({ verbose: true }) || [];
      for (const target of targets) {
        const favorableNow = replies.some(reply => {
          if (reply.to !== target.square || !reply.captured) return false;
          const position = this._board(after.fen()); position.move(reply);
          const recapture = position.moves({ verbose: true }).some(answer => answer.to === reply.to && answer.captured);
          return VALUES[target.type] - (recapture ? VALUES[reply.piece] : 0) > 0;
        });
        if (!favorableNow) continue;
        const retreats = escapeMoves.filter(reply => reply.from === target.square);
        // Bound work on the browser thread. Unproved large cases are omitted.
        if (retreats.length > 12 || retreats.some(reply => reply.captured === 'k')) continue;
        const examples = [];
        for (const retreat of retreats) {
          const position = this._board(ownTurn.fen()); position.move(retreat);
          const capture = position.moves({ verbose: true }).find(reply => {
            if (reply.to !== retreat.to || reply.captured !== target.type) return false;
            const captured = this._board(position.fen()); captured.move(reply);
            const recapture = captured.moves({ verbose: true }).some(answer => answer.to === reply.to && answer.captured);
            const immediateBalance = VALUES[target.type] - (recapture ? VALUES[reply.piece] : 0) - (VALUES[retreat.captured] || 0);
            return immediateBalance > 0;
          });
          if (!capture) break;
          examples.push({ retreat, capture });
        }
        if (examples.length !== retreats.length) continue;
        threats.push(this._fact('trapped-piece', 'No safe direct retreat', `The ${NAMES[target.type]} on ${target.square} is legally capturable.${retreats.length ? ` All ${retreats.length} legal moves with that piece allow an immediate capture with an unfavorable material balance.` : ' It currently has no legal move of its own.'}`, after, phase, { arrows: replies.filter(reply => reply.to === target.square && reply.captured).slice(0, 2).map(reply => arrow(reply.from, reply.to, 'threat', 'Current legal capture')), highlights: [highlight(target.square, 'threat', 'No safe direct piece retreat')] }, 'A retreat is only safe if it avoids the next capture. Also look for a check, exchange or rescue by another piece.', 'All direct piece moves were checked against legal captures and immediate recaptures, including material gained by an escape capture. Other-piece rescues and longer tactics are not ruled out.', 'direct-escapes-verified'));
      }
    }
    analyze(result = {}) {
      const source = {
        fen: result.fenBefore || result.fen, fenAfter: result.fenAfter, move: result.moveSan || result.move,
        bestMove: result.bestMoveSan || result.bestMove, bestMovePv: result.bestMovePvSan || result.bestMovePv,
        opponentBest: result.opponentBestMoveSan || result.opponentBestMove || result.opponentBestUci,
        opponentPv: result.opponentPvSan || result.opponentPv, alternatives: result.alternatives,
        evalBefore: result.evalBefore, evalAfter: result.evalAfter, cpLoss: result.cpLoss,
        playerEdgeBefore: result.playerEdgeBefore, playerEdgeAfter: result.playerEdgeAfter,
        classification: result.classificationKey || result.classification?.key,
        isWhite: result.isWhite, bestMoveMate: result.bestMoveMate, mateAfter: result.mateAfter,
        rawAliases: {
          bestMoveSan: result.bestMoveSan, bestMove: result.bestMove, bestMoveUci: result.bestMoveUci,
          bestMovePvSan: result.bestMovePvSan, bestMovePv: result.bestMovePv,
          opponentBestMoveSan: result.opponentBestMoveSan, opponentBestMove: result.opponentBestMove,
          opponentBestUci: result.opponentBestUci, opponentBestMoveUci: result.opponentBestMoveUci,
          opponentPvSan: result.opponentPvSan, opponentPv: result.opponentPv,
        },
        textContext: {
          movePly: result.movePly, phase: result.phase, expectedLoss: result.expectedLoss,
          moveUci: result.moveUci, openingName: result.openingName, isPieceSacrifice: result.isPieceSacrifice,
          bestGap: result.bestGap, bestMoveGap: result.bestMoveGap, priorOpponentMoveSan: result.priorOpponentMoveSan,
          priorOpponentThreat: result.priorOpponentThreat, opponentJustBlundered: result.opponentJustBlundered,
          isTerminal: result.isTerminal, mateThreat: result.mateThreat,
        },
      };
      const key = JSON.stringify(source);
      if (this.cache.has(key)) {
        const cached = this.cache.get(key); this.cache.delete(key); this.cache.set(key, cached); return cached;
      }
      this.legalCache.clear();
      const before = this._board(source.fen), verification = { status: 'verified', reasons: [], rejectedVariations: [] };
      const invalid = reason => this._remember(key, {
        id: 'invalid-position', fenBefore: source.fen || '', fenAfter: '', move: null,
        verification: { status: 'invalid', reasons: [reason], rejectedVariations: [] },
        explanation: reason, evaluation: {}, motifs: [], threats: [], better: null,
        lesson: 'Select a move with a valid saved position, or run a fresh review.', variations: [],
      });
      if (!before) return invalid('This position cannot be verified. Run a fresh review.');
      const nonMovingSide = this._asTurn(before, OPPOSITE(before.turn()));
      if (nonMovingSide?.in_check()) return invalid('This saved position leaves the side that just moved in check. Run a fresh review.');
      const beforeFen = before.fen(), after = this._board(beforeFen), legalMoveCount = after.moves().length;
      const move = moveToken(after, source.move);
      if (!move) return invalid('The recorded move is not legal in its saved position. Run a fresh review.');
      const played = { ...move, beforeFen, fen: after.fen(), check: after.in_check(), mate: after.in_checkmate(), forced: legalMoveCount === 1, legalMoveCount };
      if (source.fenAfter && fenKey(source.fenAfter) !== fenKey(after.fen())) verification.reasons.push('A stale stored after-position was ignored; the position was derived from the legal played move.');
      const variations = [], reject = (name, reason) => verification.rejectedVariations.push({ source: name, reason });
      let replyLine = null, bestLine = null, best = null;
      const opponentRecommendation = this._recommendation(after.fen(), [result.opponentBestMoveSan, result.opponentBestMove, result.opponentBestUci, result.opponentBestMoveUci]);
      if (opponentRecommendation.error) reject('opponent', opponentRecommendation.error);
      if (source.opponentPv) {
        if (!opponentRecommendation.error) {
          const replay = this._consistentVariation(after.fen(), result.opponentPvSan, result.opponentPv, 'reply', 'Strongest recorded reply', 'opponent', opponentRecommendation.move);
          if (replay.value) { replyLine = replay.value; variations.push(replyLine); } else reject('opponent', replay.error);
        }
      }
      const recommendation = this._recommendation(beforeFen, [result.bestMoveSan, result.bestMove, result.bestMoveUci]);
      best = recommendation.move;
      if (recommendation.error) reject('best', recommendation.error);
      if (source.bestMovePv) {
        const replay = recommendation.error ? { error: null } : this._consistentVariation(beforeFen, result.bestMovePvSan, result.bestMovePv, 'best', 'Engine’s recommended continuation', 'best', best);
        if (!replay.value) { if (!recommendation.error) reject('best', replay.error || 'Invalid engine recommendation.'); }
        else { bestLine = replay.value; best ||= bestLine.moves[0]; variations.push(bestLine); }
      }
      const lineKeys = new Set(variations.map(variation => variation.startFen + ':' + variation.moves.map(item => item.san).join(' ')));
      for (const [index, alternative] of (Array.isArray(source.alternatives) ? source.alternatives.slice(0, 5) : []).entries()) {
        const pv = alternative?.pvSan || alternative?.pv;
        if (!pv) continue;
        const candidate = this._recommendation(beforeFen, [alternative.moveSan, alternative.moveUci, alternative.move, alternative.bestMove]);
        if (candidate.error) { reject(`multipv-${index + 1}`, candidate.error); continue; }
        const replay = this._consistentVariation(beforeFen, alternative.pvSan, alternative.pv, `multipv-${index + 1}`, `Other engine continuation ${index + 1}`, 'multi-pv', candidate.move);
        if (!replay.value) { reject(`multipv-${index + 1}`, replay.error); continue; }
        const candidateKey = replay.value.startFen + ':' + replay.value.moves.map(item => item.san).join(' ');
        if (!lineKeys.has(candidateKey)) { variations.push(replay.value); lineKeys.add(candidateKey); }
      }
      if (!replyLine && !source.opponentPv && bestLine && bestLine.moves[0].from === move.from && bestLine.moves[0].to === move.to && (bestLine.moves[0].promotion || '') === (move.promotion || '') && bestLine.moves.length > 1) {
        const replay = this._variation(after.fen(), bestLine.moves.slice(1), 'reply', 'Continuation after the played move', 'best-tail');
        if (replay.value) { replyLine = replay.value; variations.unshift(replyLine); }
      }
      // A one-move demonstration is still legal and useful without an engine PV.
      const playedDemo = this._variation(beforeFen, [move], 'played', 'The reviewed move', 'board').value;
      if (playedDemo) variations.unshift(playedDemo);
      const motifs = [
        ...this._terminal(after, move, 'played'),
        ...this._linePatterns(before, after, move, 'played', replyLine),
        ...this._positional(before, after, move, 'played'),
      ];
      const threats = this._threats(after, move);
      if (replyLine?.moves.length) {
        const first = replyLine.moves[0], replyBefore = this._board(first.beforeFen), replyAfter = this._board(first.fen);
        const replyMotifs = [...this._terminal(replyAfter, first, 'reply'), ...this._linePatterns(replyBefore, replyAfter, first, 'reply', { moves: replyLine.moves.slice(1) })];
        for (const motif of replyMotifs) {
          motif.id = 'reply:' + motif.id; motif.explanation = `In the recorded response ${first.san}: ${motif.explanation}`;
          threats.push(motif);
        }
      }
      let better = null;
      if (best && (best.from !== move.from || best.to !== move.to || (best.promotion || '') !== (move.promotion || ''))) {
        const bestBoard = this._board(beforeFen); bestBoard.move(best);
        const following = bestLine ? { moves: bestLine.moves.slice(1) } : null;
        const betterMotifs = [...this._terminal(bestBoard, best, 'alternative'), ...this._linePatterns(before, bestBoard, best, 'alternative', following), ...this._positional(before, bestBoard, best, 'alternative')];
        better = { move: { ...best, beforeFen, fen: bestBoard.fen() }, explanation: `The engine preferred ${best.san}.${betterMotifs.length ? ` ${betterMotifs[0].explanation}` : ` It moves the ${NAMES[best.piece]} from ${best.from} to ${best.to}; inspect the verified continuation to compare the replies.`}`, fen: bestBoard.fen(), motifs: betterMotifs, verification: { status: 'legal-move', detail: bestLine ? 'Recommended move and complete principal variation replayed legally' : 'Move is legal; no complete engine continuation was provided' } };
        if (!bestLine) {
          bestLine = this._variation(beforeFen, [best], 'best', 'Engine’s recommended move', 'board').value;
          if (bestLine) variations.push(bestLine);
        }
      }
      if (playedDemo) {
        playedDemo.steps[0] = { fen: beforeFen, text: `${move.san} moves the ${NAMES[move.piece]} from ${move.from} to ${move.to}.`, arrows: [arrow(move.from, move.to, 'suggestion', move.san)], highlights: [highlight(move.from, 'tactic', 'Moving piece'), highlight(move.to, 'suggestion', 'Destination')] };
        playedDemo.steps[1].arrows.push(...motifs.flatMap(fact => fact.arrows));
        playedDemo.steps[1].highlights.push(...motifs.flatMap(fact => fact.highlights));
        if (motifs.length) playedDemo.steps[1].text = motifs.slice(0, 2).map(fact => fact.explanation).join(' ');
        if (replyLine) {
          playedDemo.steps.push(...replyLine.steps.slice(1));
          playedDemo.moves.push(...replyLine.moves);
          playedDemo.source = 'board-and-engine';
          playedDemo.verification.detail = 'The played move and complete recorded opponent continuation were replayed legally; opponent choices are not compulsory.';
        }
      }
      if (bestLine && better) {
        bestLine.steps[0] = { fen: beforeFen, text: `Compare ${best.san}, the engine’s recommended move.`, arrows: [arrow(best.from, best.to, 'suggestion', best.san)], highlights: [highlight(best.to, 'suggestion', 'Engine recommendation')] };
        bestLine.steps[1].arrows.push(...better.motifs.flatMap(fact => fact.arrows));
        bestLine.steps[1].highlights.push(...better.motifs.flatMap(fact => fact.highlights));
        if (better.motifs.length) bestLine.steps[1].text = better.motifs.slice(0, 2).map(fact => fact.explanation).join(' ');
      }
      let explanation;
      const legalOpponent = opponentRecommendation.error ? null : opponentRecommendation.move || replyLine?.moves[0];
      const sign = move.color === 'w' ? 1 : -1;
      const playerBefore = Number.isFinite(source.evalBefore) ? sign * source.evalBefore : Number.isFinite(source.playerEdgeBefore) && (source.isWhite === undefined || source.isWhite === (move.color === 'w')) ? source.playerEdgeBefore : null;
      const playerAfter = Number.isFinite(source.evalAfter) ? sign * source.evalAfter : Number.isFinite(source.playerEdgeAfter) && (source.isWhite === undefined || source.isWhite === (move.color === 'w')) ? source.playerEdgeAfter : null;
      const toUci = item => item ? item.from + item.to + (item.promotion || '') : '';
      const verifiedExplanationInput = {
        ...result, fenBefore: beforeFen, fen: beforeFen, fenAfter: after.fen(), isWhite: move.color === 'w',
        playerEdgeBefore: playerBefore, playerEdgeAfter: playerAfter,
        moveSan: move.san, moveUci: toUci(move), bestMoveSan: best?.san || '', bestMove: toUci(best),
        bestMovePvSan: bestLine?.source === 'best' ? bestLine.moves.map(item => item.san).join(' ') : '',
        bestMovePv: bestLine?.source === 'best' ? bestLine.moves.map(toUci).join(' ') : '',
        opponentBestMoveSan: legalOpponent?.san || '', opponentBestMove: toUci(legalOpponent),
        opponentPvSan: replyLine?.moves.map(item => item.san).join(' ') || '',
        opponentPv: replyLine?.moves.map(toUci).join(' ') || '',
      };
      try { explanation = this.analyzer?.explainResult?.(verifiedExplanationInput); } catch { /* The structured facts remain usable. */ }
      if (!explanation) explanation = `${move.san} ${move.captured ? `captures the ${NAMES[move.captured]} on ${move.to}` : `moves the ${NAMES[move.piece]} from ${move.from} to ${move.to}`}.${played.mate ? ' This is checkmate.' : played.check ? ' It gives check.' : ''}`;
      const sorted = this._unique(motifs), uniqueThreats = this._unique(threats);
      const lesson = sorted.find(motif => motif.type === 'sacrifice' || motif.type === 'fork' || motif.type === 'checkmate')?.lesson || uniqueThreats.find(fact => fact.type === 'mate-threat' || fact.type === 'hanging-piece')?.lesson || sorted[0]?.lesson || better?.motifs[0]?.lesson || 'Compare the opponent’s checks and captures after your move with those after the engine’s recommendation.';
      const model = {
        id: `${fenKey(beforeFen)}:${move.from}${move.to}${move.promotion || ''}`,
        fenBefore: beforeFen, fenAfter: after.fen(), move: played, verification, explanation,
        evaluation: { before: Number.isFinite(source.evalBefore) ? source.evalBefore : null, after: Number.isFinite(source.evalAfter) ? source.evalAfter : null, loss: Number.isFinite(source.cpLoss) ? source.cpLoss : null, perspective: 'white', playerBefore, playerAfter, classification: source.classification || null },
        motifs: sorted, threats: uniqueThreats, better, lesson, variations,
      };
      return this._remember(key, model);
    }
    _unique(facts) {
      const seen = new Set();
      return facts.filter(fact => { if (seen.has(fact.id)) return false; seen.add(fact.id); return true; });
    }
    _remember(key, model) {
      const immutable = freeze(model);
      this.cache.set(key, immutable);
      while (this.cache.size > this.cacheLimit) this.cache.delete(this.cache.keys().next().value);
      return immutable;
    }
  }
  function attacksThrough(board, from, via, to) {
    const piece = board.get(from);
    if (!piece || from === to || !['q', 'r', 'b'].includes(piece.type)) return false;
    const [fx, fy] = point(from), [vx, vy] = point(via), [tx, ty] = point(to);
    const dx = tx - fx, dy = ty - fy;
    if (piece.type === 'b' && Math.abs(dx) !== Math.abs(dy) || piece.type === 'r' && dx !== 0 && dy !== 0 || piece.type === 'q' && dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy)) return false;
    const sx = Math.sign(dx), sy = Math.sign(dy);
    let found = false;
    for (let x = fx + sx, y = fy + sy; x !== tx || y !== ty; x += sx, y += sy) {
      const at = square(x, y);
      if (!at) return false;
      if (x === vx && y === vy) found = true;
      else if (board.get(at)) return false;
    }
    return found;
  }
  scope.TacticsCoach = TacticsCoach;
})(typeof window !== 'undefined' ? window : globalThis);
