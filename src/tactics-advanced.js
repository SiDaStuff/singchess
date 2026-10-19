// Additional teaching concepts backed by exact positions and legally replayed
// continuations. A shown line is an example unless every legal defense is tested.
(function registerAdvancedTactics(scope) {
  'use strict';
  const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const opposite = color => color === 'w' ? 'b' : 'w';
  const key = fen => fen.split(/\s+/).slice(0, 4).join(' ');
  const point = at => [at.charCodeAt(0) - 97, Number(at[1]) - 1];
  const square = (file, rank) => file >= 0 && file < 8 && rank >= 0 && rank < 8 ? String.fromCharCode(97 + file) + (rank + 1) : null;
  const arrow = (from, to, role, label) => ({ from, to, role, label });
  const highlight = (at, role, label) => ({ square: at, role, label });
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
    if (!(piece.type === 'q' && (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) || piece.type === 'r' && (dx === 0 || dy === 0) || piece.type === 'b' && Math.abs(dx) === Math.abs(dy))) return false;
    const sx = Math.sign(dx), sy = Math.sign(dy);
    for (let x = fx + sx, y = fy + sy; x !== tx || y !== ty; x += sx, y += sy) if (board.get(square(x, y))) return false;
    return true;
  }
  function legal(board, color, coach) {
    const cacheKey = `${key(board.fen())}:${color}`;
    if (coach.legalCache?.has(cacheKey)) return coach.legalCache.get(cacheKey);
    const moves = coach._asTurn(board, color)?.moves({ verbose: true }) || [];
    coach.legalCache?.set(cacheKey, moves);
    return moves;
  }
  function replay(after, continuation, coach) {
    const source = continuation?.moves || [];
    if (!source.length || source.length > 40) return null;
    const board = coach._board(after.fen()), moves = [];
    for (const token of source) {
      const beforeFen = board.fen();
      if (token.beforeFen && key(token.beforeFen) !== key(beforeFen)) return null;
      const move = board.move({ from: token.from, to: token.to, promotion: token.promotion });
      if (!move || token.fen && key(token.fen) !== key(board.fen())) return null;
      moves.push({ ...move, beforeFen, fen: board.fen() });
    }
    return { board, moves };
  }
  function pawnPassed(board, at, color) {
    const [file, rank] = point(at);
    return !pieces(board, opposite(color)).some(piece => piece.type === 'p' && Math.abs(point(piece.square)[0] - file) <= 1 && (color === 'w' ? point(piece.square)[1] > rank : point(piece.square)[1] < rank));
  }
  function pawnSpace(board, color) {
    const controlled = new Set();
    for (const pawn of pieces(board, color).filter(piece => piece.type === 'p')) {
      const [file, rank] = point(pawn.square), nextRank = rank + (color === 'w' ? 1 : -1);
      if (color === 'w' ? nextRank < 4 : nextRank > 3) continue;
      for (const dx of [-1, 1]) { const at = square(file + dx, nextRank); if (at) controlled.add(at); }
    }
    return controlled;
  }
  function extract({ before, after, move, phase = 'played', continuation, coach }) {
    if (!before || !after || !move || !coach || after.in_checkmate() || after.in_stalemate()) return [];
    const facts = [], color = move.color, enemy = opposite(color), recorded = replay(after, continuation, coach), line = recorded?.moves || [];
    const fact = (type, label, text, annotations, lesson, detail, verification = 'board-verified') => facts.push(coach._fact(type, label, text, after, phase, annotations, lesson, detail, verification));
    const own = pieces(after, color), enemyPieces = pieces(after, enemy);

    // A check before a capture that was already legal is a concrete change in
    // move order. Do not pretend a previous capture occurred without history.
    const followup = line[1];
    if (move.san.endsWith('+') && followup?.color === color && followup.captured) {
      const target = before.get(followup.to);
      const immediate = target?.color === enemy && legal(before, color, coach).find(candidate => candidate.to === followup.to && candidate.captured === target.type);
      const stillThere = after.get(followup.to);
      if (immediate && stillThere?.type === target.type && stillThere.color === enemy && line[0].from !== followup.to) {
        fact('zwischenzug', 'Check before a capture', `${move.san} checks first. After ${line[0].san}, ${followup.san} takes the ${NAMES[target.type]} on ${followup.to}; ${immediate.san} was already available in the original position.`,
          { arrows: [arrow(move.from, move.to, 'suggestion', 'Intermediate check')], highlights: [highlight(followup.to, 'tactic', 'Capture delayed until after the check')] },
          'Before an obvious capture, examine checks that may change the order of the exchanges.', 'Legal immediate capture, intermediate check, and complete legal recorded continuation. This demonstrates a move order, not that every reply loses material.', 'line-verified');
      }
    }

    const first = line[0];
    if (move.captured && first?.color === enemy && first.captured === move.piece && first.to === move.to) {
      const previouslyCapturable = legal(before, enemy, coach).find(candidate => candidate.to === move.from && candidate.captured === move.piece);
      if (previouslyCapturable) fact('desperado', 'Capture before the offered piece falls', `${move.san} takes the ${NAMES[move.captured]} before ${first.san} captures your ${NAMES[move.piece]} in the line. The piece was already vulnerable to ${previouslyCapturable.san} in the original position.`,
        { arrows: [arrow(first.from, first.to, 'threat', 'Recorded capture of the offered piece')], highlights: [highlight(move.to, 'tactic', 'Captured something before being taken')] },
        'If a piece is under attack, compare capturing something first with retreating. Calculate the whole exchange.', 'Legally capturable original piece if the opponent had the turn, played capture, and recorded legal acceptance. This does not prove that losing the piece was unavoidable.', 'line-verified');
    }

    if (move.piece === 'p' && move.captured === 'p' && !pawnPassed(before, move.from, color) && pawnPassed(after, move.to, color)) {
      let at = move.to, promotion = null;
      for (const reply of line) {
        const capturedAt = reply.flags.includes('e') ? reply.to[0] + reply.from[1] : reply.to;
        if (reply.color === enemy && reply.captured === 'p' && capturedAt === at) break;
        if (reply.color === color && reply.from === at && reply.piece === 'p') { at = reply.to; if (reply.promotion) { promotion = reply; break; } }
      }
      if (promotion) fact('pawn-breakthrough', 'Pawn capture opens a promotion route', `${move.san} clears an opposing pawn and creates a passed pawn on ${move.to}. The same pawn promotes with ${promotion.san} in the recorded line.`,
        { arrows: [arrow(move.from, move.to, 'suggestion', 'Pawn breakthrough')], highlights: [highlight(move.to, 'suggestion', 'New passed pawn')] },
        'A pawn capture may clear a promotion route. Track the same pawn and check every opposing reply.', 'New passed pawn and complete legal continuation promoting that same pawn. Other defenses still have to be compared.', 'line-verified');
    }

    if (move.piece === 'p') {
      const oldSpace = pawnSpace(before, color), newSpace = pawnSpace(after, color);
      const gained = [...newSpace].filter(at => !oldSpace.has(at));
      if (newSpace.size > oldSpace.size && gained.length) fact('space-expansion', 'More pawn control in the opponent’s half', `${move.san} adds pawn control of ${gained.join(' and ')} in the opponent’s half. Your pawns now attack ${newSpace.size} such squares, up from ${oldSpace.size}.`,
        { arrows: gained.map(at => arrow(move.to, at, 'tactic', 'New pawn-controlled square')), highlights: gained.map(at => highlight(at, 'suggestion', 'Additional pawn control')) },
        'Space is useful when your pieces can use it. Check the pawn’s safety and the squares behind it.', 'Exact before-and-after pawn attack geometry. This measures pawn control, not an overall advantage.');
    }

    // The engine line can verify a tempo when the attacked piece actually
    // spends its reply moving away. Do not infer that retreat is compulsory.
    if (first?.color === enemy && !/[+#]$/.test(move.san) && !first.captured && !/[+#]$/.test(first.san) && first.from !== first.to) {
      const target = after.get(first.from);
      if (target && target.type !== 'p' && target.type !== 'k' && coach._legalCapture(after, move.to, first.from, color) && !attacks(before, move.from, first.from)) {
        fact('tempo-gain', 'The attacked piece retreats in the line', `${move.san} attacks the ${NAMES[target.type]} on ${first.from}. In the recorded reply, ${first.san} moves it away.`,
          { arrows: [arrow(move.to, first.from, 'tactic', 'New attack'), arrow(first.from, first.to, 'defense', 'Recorded retreat')], highlights: [highlight(first.from, 'threat', 'Attacked piece')] },
          'Developing with an attack can gain time when the opponent must attend to the threat. Verify the actual reply.', 'New legal attack and legal recorded non-capturing retreat without check. A counterattack or capture may be possible in another line.', 'line-verified');
      }
    }

    if (first?.color === enemy && first.captured) {
      const capturedAt = first.flags.includes('e') ? first.to[0] + first.from[1] : first.to;
      const target = after.get(capturedAt);
      const supporters = target?.color === color ? own.filter(piece => piece.square !== capturedAt && attacks(after, piece.square, capturedAt)) : [];
      const responseBoard = coach._board(first.fen);
      const recaptures = legal(responseBoard, color, coach).filter(reply => reply.to === first.to && reply.captured);
      if (supporters.length && !recaptures.length) fact('insufficient-defense', 'An apparent defender cannot recapture', `${first.san} takes the ${NAMES[target.type]} on ${capturedAt}. Although ${supporters.map(piece => `the ${NAMES[piece.type]} on ${piece.square}`).join(' and ')} points at that square, no immediate recapture on ${first.to} is legal afterward.`,
        { arrows: [arrow(first.from, first.to, 'threat', 'Recorded legal capture'), ...supporters.map(piece => arrow(piece.square, capturedAt, 'defense', 'Geometric support; recapture is not legal'))], highlights: [highlight(capturedAt, 'threat', 'Target lacks a legal recapture'), ...supporters.map(piece => highlight(piece.square, 'defense', 'Apparent defender'))] },
        'Count legal recaptures, not just pieces pointing at a square. Check pins and checks after the capture.', 'Legal engine capture and exhaustive current legal-move list with no immediate recapture', 'line-verified');
    }

    // Only call a line a mating net when the ending really is mate and every
    // current legal defense has been exhaustively checked. The small branch
    // cap bounds browser work; larger positions remain unlabelled.
    if (recorded?.board.in_checkmate() && recorded.board.turn() === enemy) {
      const defenses = legal(after, enemy, coach);
      if (defenses.length > 0 && defenses.length <= 6) {
        const proof = [];
        for (const defense of defenses) {
          const branch = coach._board(after.fen()); branch.move(defense);
          const mate = legal(branch, color, coach).find(candidate => candidate.san.endsWith('#'));
          if (!mate) { proof.length = 0; break; }
          proof.push({ defense, mate });
        }
        if (proof.length === defenses.length) fact('mating-net', 'Every legal reply allows mate next turn', proof.length === 1
          ? `${proof[0].defense.san} is the only legal reply to ${move.san}, after which ${proof[0].mate.san} is checkmate.`
          : `After ${move.san}, all ${proof.length} legal replies permit checkmate on your next turn. For example, ${proof[0].defense.san} ${proof[0].mate.san}.`,
          { highlights: enemyPieces.filter(piece => piece.type === 'k').map(king => highlight(king.square, 'threat', 'Every legal reply allows checkmate')) },
          'A mating net must cover every legal defense, including captures and checks.', 'Exhaustively enumerated all current legal defenses and found a legal immediate mate after each', 'all-defenses-verified');
      }
    }

    if (recorded?.board.in_threefold_repetition() && line.some(reply => reply.san.endsWith('+'))) {
      const checkingColor = [color, enemy].find(candidate => line.filter(reply => reply.color === candidate).every(reply => reply.san.endsWith('+')));
      if (checkingColor) fact('repetition-checks', 'Repeated checks in a drawing line', `${checkingColor === 'w' ? 'White' : 'Black'} keeps giving check, and the recorded line repeats the same position three times. It meets this app’s threefold-repetition condition.`,
        { highlights: pieces(after, opposite(checkingColor)).filter(piece => piece.type === 'k').map(king => highlight(king.square, 'tactic', 'King in the repeated-check line')) },
        'Repeated checks can offer a drawing resource, but verify repetition and test whether the opponent can leave the checking line.', 'Full legal continuation replayed with chess.js threefold-repetition verification. This finite line does not prove that the checks are unavoidable against other defenses.', 'line-verified');
    }

    // Remove a concrete checkmate-in-one threat. No claim about longer mates
    // or overall king safety follows from this bounded comparison.
    if (!after.in_check()) {
      const possibleBefore = legal(before, enemy, coach).filter(candidate => candidate.san.endsWith('#'));
      if (possibleBefore.length && !legal(after, enemy, coach).some(candidate => candidate.san.endsWith('#'))) {
        fact('prophylaxis', 'Stops the immediate mating options', `${move.san} stops the immediate threat of ${possibleBefore[0].san}. The opponent now has no legal checkmate in one.`,
          { arrows: [arrow(move.from, move.to, 'defense', 'Move removes all immediate mating options')], highlights: [highlight(move.to, 'defense', 'Preventive move')] },
          'Before your plan, look for the opponent’s immediate mate. A preventive move must stop every mating option.', 'All legal opponent moves compared before and after, giving the opponent the hypothetical turn in the old position; all immediate mates removed. Longer attacks are not ruled out.');
      }
    }

    if (move.piece === 'r' && point(move.to)[1] === (color === 'w' ? 6 : 1) && !pieces(after).some(piece => piece.type === 'q')) {
      const targets = enemyPieces.filter(piece => piece.type === 'p' && coach._legalCapture(after, move.to, piece.square, color));
      if (targets.length) fact('endgame-rook-activity', 'Rook attacks pawns on the seventh rank', `The rook reaches ${move.to} and attacks ${targets.map(piece => `the pawn on ${piece.square}`).join(' and ')}. There are no queens on the board.`,
        { arrows: targets.map(piece => arrow(move.to, piece.square, 'tactic', 'Legal pawn capture')), highlights: [highlight(move.to, 'suggestion', 'Active rook')] },
        'An active rook can attack pawns from the seventh rank. Compare those targets with your own king and pawn safety.', 'Seventh-rank rook placement and exact legal pawn-capture options. The pawns may still be defended.');
    }
    return facts;
  }
  scope.TacticsAdvanced = { extract };
})(typeof window !== 'undefined' ? window : globalThis);
