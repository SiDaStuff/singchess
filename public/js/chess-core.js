// Move Analysis and Classification Module
// Provides game-review style classification, summaries, and coach guidance.

const MoveClassification = Object.freeze({
  BRILLIANT:   { key: 'BRILLIANT',   name: 'Brilliant',   symbol: '!!', color: '#1BACA6', icon: '!!' },
  GREAT:       { key: 'GREAT',       name: 'Great',       symbol: '!',  color: '#5C8BB4', icon: '!' },
  BEST:        { key: 'BEST',        name: 'Best',        symbol: '*',  color: '#96BC4B', icon: 'star', iconType: 'material' },
  EXCELLENT:   { key: 'EXCELLENT',   name: 'Excellent',   symbol: '+',  color: '#96BC4B', icon: 'thumb_up', iconType: 'material' },
  GOOD:        { key: 'GOOD',        name: 'Good',        symbol: '=',  color: '#97AF8B', icon: 'check', iconType: 'material' },
  BOOK:        { key: 'BOOK',        name: 'Book',        symbol: 'Bk', color: '#A88764', icon: 'menu_book', iconType: 'material' },
  FORCED:      { key: 'FORCED',      name: 'Forced',      symbol: '[]', color: '#97AF8B', icon: 'lock', iconType: 'material' },
  INACCURACY:  { key: 'INACCURACY',  name: 'Inaccuracy',  symbol: '?!', color: '#F7C631', icon: '?!' },
  MISTAKE:     { key: 'MISTAKE',     name: 'Mistake',     symbol: '?',  color: '#E68A2E', icon: '?' },
  BLUNDER:     { key: 'BLUNDER',     name: 'Blunder',     symbol: '??', color: '#CA3431', icon: '??' },
  MISS:        { key: 'MISS',        name: 'Miss',        symbol: 'X', color: '#CA3431', icon: 'X' },
});

const OPENING_BOOK = [
  { eco: 'B00', name: 'King Pawn Opening', moves: ['e4'] },
  { eco: 'C20', name: "King's Pawn Game", moves: ['e4', 'e5'] },
  { eco: 'B01', name: 'Scandinavian Defense', moves: ['e4', 'd5'] },
  { eco: 'B06', name: 'Modern Defense', moves: ['e4', 'g6'] },
  { eco: 'B07', name: 'Pirc Defense', moves: ['e4', 'd6'] },
  { eco: 'B12', name: 'Caro-Kann Defense', moves: ['e4', 'c6'] },
  { eco: 'B20', name: 'Sicilian Defense', moves: ['e4', 'c5'] },
  { eco: 'B50', name: 'Sicilian Defense', moves: ['e4', 'c5', 'Nf3', 'd6'] },
  { eco: 'C00', name: 'French Defense', moves: ['e4', 'e6'] },
  { eco: 'C40', name: "King's Knight Opening", moves: ['e4', 'e5', 'Nf3'] },
  { eco: 'C44', name: 'Scotch Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'] },
  { eco: 'C45', name: 'Scotch Game, Schmidt Variation', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4'] },
  { eco: 'C44', name: 'Scotch Gambit', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Bc4'] },
  { eco: 'C50', name: 'Italian Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] },
  { eco: 'C53', name: 'Giuoco Piano', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'] },
  { eco: 'C55', name: 'Two Knights Defense', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'] },
  { eco: 'C60', name: 'Ruy Lopez', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'] },
  { eco: 'C65', name: 'Ruy Lopez, Berlin Defense', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6'] },
  { eco: 'D00', name: "Queen's Pawn Game", moves: ['d4'] },
  { eco: 'D02', name: "Queen's Pawn Game, London System", moves: ['d4', 'd5', 'Bf4'] },
  { eco: 'D06', name: "Queen's Gambit", moves: ['d4', 'd5', 'c4'] },
  { eco: 'D30', name: "Queen's Gambit Declined", moves: ['d4', 'd5', 'c4', 'e6'] },
  { eco: 'D20', name: "Queen's Gambit Accepted", moves: ['d4', 'd5', 'c4', 'dxc4'] },
  { eco: 'D10', name: 'Slav Defense', moves: ['d4', 'd5', 'c4', 'c6'] },
  { eco: 'D70', name: 'Neo-Grunfeld Defense', moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5'] },
  { eco: 'E00', name: 'Catalan Opening', moves: ['d4', 'Nf6', 'c4', 'e6', 'g3'] },
  { eco: 'E10', name: 'Nimzo-Indian Defense', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'] },
  { eco: 'E60', name: "King's Indian Defense", moves: ['d4', 'Nf6', 'c4', 'g6'] },
  { eco: 'E90', name: "King's Indian Defense, Main Line", moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6'] },
  { eco: 'A40', name: 'English Opening', moves: ['c4'] },
  { eco: 'A10', name: 'English Opening, Anglo-Indian', moves: ['c4', 'Nf6'] },
  { eco: 'A00', name: "Bird Opening", moves: ['f4'] },
  { eco: 'A02', name: "Bird Opening, Dutch Variation", moves: ['f4', 'd5'] },
  { eco: 'A04', name: "Reti Opening", moves: ['Nf3'] },
];

const CLASSIFICATION_ORDER = [
  'BRILLIANT',
  'GREAT',
  'BEST',
  'EXCELLENT',
  'GOOD',
  'BOOK',
  'FORCED',
  'INACCURACY',
  'MISTAKE',
  'BLUNDER',
  'MISS',
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Anticheat helpers (moved from server-side implementation)
function resultForSide(headers, side) {
	const result = String(headers.Result || '').trim();
	if (result === '1/2-1/2') return 0.5;
	if (side === 'white') return result === '1-0' ? 1 : 0;
	if (side === 'black') return result === '0-1' ? 1 : 0;
	return 0;
}

function parseClock(raw) {
	const parts = String(raw || '').split(':').map((part) => Number(part));
	if (parts.some((part) => !Number.isFinite(part))) return null;
	if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
	if (parts.length === 2) return (parts[0] * 60) + parts[1];
	return parts[0] || null;
}

function parseIncrement(headers) {
	const tc = String(headers.TimeControl || headers.Time || '');
	const match = tc.match(/^\s*\d+\+(\d+)/);
	return match ? Number(match[1]) || 0 : 0;
}

function parseBaseClock(headers) {
	const tc = String(headers.TimeControl || headers.Time || '');
	const match = tc.match(/^\s*(\d+)\+/);
	return match ? Number(match[1]) || null : null;
}

function moveTimesFromPgn(pgn, movesLength, headers) {
	const clocks = [...String(pgn || '').matchAll(/\[%clk\s+([0-9:.]+)\]/g)]
		.map((match) => parseClock(match[1]))
		.filter((value) => Number.isFinite(value));
	if (clocks.length < movesLength) return [];

	const increment = parseIncrement(headers);
	const baseClock = parseBaseClock(headers);
	const lastClock = { white: baseClock, black: baseClock };
	const times = [];

	for (let i = 0; i < movesLength; i += 1) {
		const side = i % 2 === 0 ? 'white' : 'black';
		const current = clocks[i];
		const previous = Number.isFinite(lastClock[side]) ? lastClock[side] : null;
		const spent = previous === null ? null : Math.max(0, previous - current + increment);
		times.push(Number.isFinite(spent) ? spent : null);
		lastClock[side] = current;
	}

	return times;
}

function safeAverage(values) {
	const clean = values.filter((value) => Number.isFinite(value));
	if (!clean.length) return 0;
	return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function stddev(values) {
	const clean = values.filter((value) => Number.isFinite(value));
	if (clean.length < 2) return 0;
	const avg = safeAverage(clean);
	const variance = safeAverage(clean.map((value) => (value - avg) ** 2));
	return Math.sqrt(variance);
}

function sideMetrics(results, side, times, headers) {
	const isWhite = side === 'white';
	const moves = results.filter((entry) => entry.isWhite === isWhite);
	const strongKeys = new Set(['BRILLIANT', 'GREAT', 'BEST', 'EXCELLENT']);
	const mistakeKeys = new Set(['INACCURACY', 'MISTAKE', 'BLUNDER', 'MISS']);
	const strongMoves = moves.filter((entry) => strongKeys.has(entry.classificationKey));
	const mistakeMoves = moves.filter((entry) => mistakeKeys.has(entry.classificationKey));
	const timedStrong = strongMoves.filter((entry) => {
		const spent = times[entry.moveIndex];
		return Number.isFinite(spent) && spent <= 5 && (entry.cpLoss || 0) <= 8;
	});
	const timedCritical = moves.filter((entry) => {
		const spent = times[entry.moveIndex];
		return Number.isFinite(spent) && spent <= 6 && (entry.isCriticalMoment || Math.abs(entry.swing || 0) >= 120);
	});
	const sideTimes = moves.map((entry) => times[entry.moveIndex]).filter((value) => Number.isFinite(value));
	const accuracy = results.whiteAccuracy !== undefined
		? (isWhite ? results.whiteAccuracy : results.blackAccuracy)
		: 0;
	const averageCpLoss = isWhite ? results.whiteAcpl : results.blackAcpl;
	const win = resultForSide(headers, side);
	const bestRate = moves.length ? (strongMoves.length / moves.length) * 100 : 0;
	const mistakeRate = moves.length ? (mistakeMoves.length / moves.length) * 100 : 0;
	const fastBestRate = strongMoves.length ? (timedStrong.length / strongMoves.length) * 100 : 0;
	const fastCriticalRate = moves.length ? (timedCritical.length / moves.length) * 100 : 0;
	const avgThink = safeAverage(sideTimes);

	return {
		side,
		player: side === 'white' ? headers.White || 'White' : headers.Black || 'Black',
		moves: moves.length,
		accuracy,
		acpl: averageCpLoss,
		win,
		bestRate,
		mistakeRate,
		fastBestRate,
		fastCriticalRate,
		avgThink,
		timeSamples: sideTimes.length,
	};
}

function scoreMetrics(metricsList) {
	const games = metricsList.length;
	const accuracy = safeAverage(metricsList.map((entry) => entry.accuracy));
	const acpl = safeAverage(metricsList.map((entry) => entry.acpl));
	const winRate = games ? safeAverage(metricsList.map((entry) => entry.win)) * 100 : 0;
	const bestRate = safeAverage(metricsList.map((entry) => entry.bestRate));
	const mistakeRate = safeAverage(metricsList.map((entry) => entry.mistakeRate));
	const fastBestRate = safeAverage(metricsList.map((entry) => entry.fastBestRate));
	const fastCriticalRate = safeAverage(metricsList.map((entry) => entry.fastCriticalRate));
	const accuracyStd = stddev(metricsList.map((entry) => entry.accuracy));
	const timeCoverage = safeAverage(metricsList.map((entry) => entry.timeSamples > 0 ? 1 : 0));
	const avgMoves = safeAverage(metricsList.map((entry) => entry.moves));

	let score = 0;
	score += Math.max(0, Math.min(38, (accuracy - 82) * 1.9));
	score += Math.max(0, Math.min(18, (42 - acpl) * 0.45));
	score += Math.max(0, Math.min(16, (bestRate - 55) * 0.45));
	score += Math.max(0, Math.min(12, (winRate - 65) * 0.35));
	score += Math.max(0, Math.min(10, (18 - mistakeRate) * 0.35));
	score += Math.max(0, Math.min(16, (fastBestRate - 35) * 0.35)) * timeCoverage;
	score += Math.max(0, Math.min(8, (fastCriticalRate - 8) * 0.7)) * timeCoverage;
	if (games >= 4 && accuracy >= 88 && accuracyStd <= 5) score += 8;
	if (games < 3) score *= 0.72;
	if (avgMoves < 12) score *= 0.45;

	score = Math.round(Math.max(0, Math.min(98, score)));
	const riskLevel = score >= 70 ? 'High' : score >= 42 ? 'Watch' : 'Low';
	const headline = riskLevel === 'High'
		? 'High review score. Escalate only with human review.'
		: riskLevel === 'Watch'
			? 'Some indicators are unusual.'
			: 'No strong cheating pattern found.';
	const explanation = 'This combines win rate, engine-match style accuracy, ACPL, consistency, and fast strong moves. It is a heuristic, not proof.';

	return {
		score,
		riskLevel,
		headline,
		explanation,
		games,
		winRate,
		accuracy,
		acpl,
		bestRate,
		mistakeRate,
		fastBestRate,
		fastCriticalRate,
	};
}

class BrowserMoveCoach {
  constructor(analyzer) {
    this.analyzer = analyzer;
    this.pieceNames = {
      p: 'pawn',
      n: 'knight',
      b: 'bishop',
      r: 'rook',
      q: 'queen',
      k: 'king',
    };
    this.pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
    this.center = new Set(['d4', 'e4', 'd5', 'e5']);
    this.extendedCenter = new Set(['c3', 'd3', 'e3', 'f3', 'c4', 'd4', 'e4', 'f4', 'c5', 'd5', 'e5', 'f5', 'c6', 'd6', 'e6', 'f6']);
  }

  explain(payload) {
    const moveInfo = this._moveInfo(payload);
    const key = this.analyzer.getClassificationKey(payload.classification);
    const statements = [this._classificationStatement(key, payload, moveInfo)];

	    const bestMoveIdea = this.analyzer._describeBestMove(payload.fenBefore, payload.bestMove, payload.bestMoveSan);
	    const opponentReply = this._describeOpponentReply(payload);
	    const mateTrap = key === 'BRILLIANT'
	      ? this.analyzer._mateTrapSacrifice(payload.fenBefore, payload.moveSan)
	      : null;

	    if (['INACCURACY', 'MISTAKE', 'BLUNDER', 'MISS'].includes(key)) {
	      if (opponentReply) {
	        statements.push(opponentReply);
	      }
      const playedSan = moveInfo.san || payload.moveSan;
      const betterIsDifferent = payload.bestMoveSan
        && !payload.isBestMove
        && !this.analyzer._sameMoveSan(payload.bestMoveSan, playedSan);
      if (betterIsDifferent) {
        const plainBest = bestMoveIdea === `play ${payload.bestMoveSan}` || !bestMoveIdea;
        statements.push(plainBest
          ? `Better was ${payload.bestMoveSan}.`
          : `Better was ${payload.bestMoveSan}: ${bestMoveIdea}.`);
      }
		    } else if (mateTrap) {
		      statements.push(`If ${mateTrap.captureSan} takes the piece, ${mateTrap.mateSan} is checkmate; declining it leaves the pressure.`);
		    } else if (key === 'BRILLIANT') {
		      const drawResource = this.analyzer._acceptedOfferDrawResource(payload.fenBefore, payload.moveSan);
		      if (drawResource) {
		        statements.push(`If ${drawResource.captureSan} accepts the sacrifice, the result is drawn. This is a defensive resource, not an attacking bait.`);
		      }
		      const offer = this.analyzer._materialOfferAfterMove(payload.fenBefore, payload.moveSan);
			      if (offer && !drawResource) {
			        const offered = this.pieceNames[offer.captured] || 'piece';
			        const grab = offer.san ? `${offer.san}` : `a capture on ${offer.to}`;
			        statements.push(`It invites ${grab}, but the ${offered} is bait for the attack.`);
			      }
			      if (/[+#]/.test(moveInfo.san || payload.moveSan || '')) {
			        statements.push('Because it is check, the opponent has to answer your threat before they can untangle.');
			      }
			    } else if (payload.bestMoveSan && payload.bestMoveSan !== moveInfo.san && key !== 'BOOK') {
		      statements.push(`It stays close to the engine's preferred idea, ${payload.bestMoveSan}.`);
		    }

    if (!['INACCURACY', 'MISTAKE', 'BLUNDER', 'MISS'].includes(key)) {
      statements.push(...this._strategicStatements(payload, moveInfo));
      statements.push(...this._tacticalStatements(payload, moveInfo));
    }

    return statements
      .filter(Boolean)
      .filter((statement, index, all) => all.indexOf(statement) === index)
      .slice(0, 4)
      .join(' ');
  }

  _moveInfo(payload) {
    const chess = new Chess(payload.fenBefore);
    const move = payload.moveUci
      ? chess.move({
          from: payload.moveUci.slice(0, 2),
          to: payload.moveUci.slice(2, 4),
          promotion: payload.moveUci[4],
        })
      : chess.move(payload.moveSan, { sloppy: true });

    return move || {
      san: payload.moveSan || payload.move || 'This move',
      color: payload.isWhite ? 'w' : 'b',
      piece: '',
      from: '',
      to: '',
    };
  }

	  _classificationStatement(key, payload, move) {
	    const san = move.san || payload.moveSan || 'This move';
	    if (key === 'BRILLIANT' && this.analyzer._acceptedOfferDrawResource(payload.fenBefore, payload.moveSan)) {
	      return `${san} is brilliant because it is a hard-to-find drawing resource.`;
	    }
	    const epLoss = typeof payload.expectedLoss === 'number'
	      ? Math.round(payload.expectedLoss * 100)
	      : null;
	    const lossText = this.analyzer._formatCpLossText(payload.cpLoss, payload.expectedLoss);
		    const brilliantText = /[+#]/.test(move.san || san)
		      ? 'is brilliant: a forcing check that is hard to find and keeps the attack in your hands'
		      : 'is brilliant: the best move, tricky to find, and usually involving a sacrifice';
		    const descriptions = {
		      BRILLIANT: brilliantText,
	      GREAT: 'is great: it altered the course of the game',
	      BEST: "is best: the engine's top choice",
	      EXCELLENT: 'is excellent: almost as good as the best move',
	      GOOD: 'is good: a decent move, but not the best',
	      BOOK: 'is book: a conventional opening move',
	      FORCED: 'was forced by the position',
	      INACCURACY: 'is an inaccuracy: a weak move',
	      MISTAKE: `is a mistake: a bad move that immediately worsens your position and ${lossText}`,
	      BLUNDER: `is a blunder: a very bad move that loses material or the game and ${lossText}`,
	      MISS: 'is a miss: it missed a tactical opportunity or a chance to punish the opponent',
	    };
    return `${san} ${descriptions[key] || 'is worth reviewing'}.`;
  }

  _strategicStatements(payload, move) {
    const statements = [];
    const piece = this.pieceNames[move.piece] || 'piece';
    const colorName = move.color === 'w' ? 'White' : 'Black';
    const ply = payload.movePly || 0;

    if (ply === 1) statements.push('This move begins the game and sets the pawn structure.');
    if (move.flags?.includes('k') || move.flags?.includes('q')) {
      statements.push(`${colorName} castles, improving king safety and connecting the rooks.`);
    }

    if (ply <= 16 && move.piece && move.piece !== 'p' && this._isBackRank(move.from, move.color) && !this._isBackRank(move.to, move.color)) {
      const edgeNote = move.piece === 'n' && /^[ah]/.test(move.to) ? ', though the knight is heading toward the edge' : '';
      statements.push(`This move develops a ${piece}${edgeNote}.`);
    }

    if (ply <= 12 && move.piece === 'q' && !move.captured && this.extendedCenter.has(move.to)) {
      statements.push('The queen comes out early, which can invite tempi from developing moves.');
    }

    if (ply <= 16 && move.piece === 'p' && ['c3', 'f3', 'c6', 'f6'].includes(move.to)) {
      statements.push('This pawn move can make natural knight development harder.');
    }

    const attacks = this._attacksFrom(payload.fenAfter, move.to, move.color, move.piece);
    if (attacks.some((sq) => this.center.has(sq))) {
      statements.push(`The ${piece} adds useful central control.`);
    } else if (ply <= 16 && move.piece !== 'k' && move.piece !== 'r' && attacks.length > 0 && !attacks.some((sq) => this.extendedCenter.has(sq))) {
      statements.push(`The ${piece} does not do much for the center yet.`);
    }

    if (move.piece === 'p' && this._opensHomeDiagonal(payload.fenBefore, move)) {
      statements.push('This pawn move opens a diagonal for a bishop or queen.');
    }

    return statements;
  }

  _tacticalStatements(payload, move) {
    const statements = [];
    const piece = this.pieceNames[move.piece] || 'piece';
    statements.push(...this._tacticLessonsForMove(payload, move));

    if (move.captured) {
      statements.push(`It captures a ${this.pieceNames[move.captured] || 'piece'} on ${move.to}.`);
    }
    if (/[+#]$/.test(move.san || '')) {
      statements.push((move.san || '').endsWith('#') ? 'It finishes with checkmate.' : 'It gives check and forces a reply.');
    }

    const attacks = this._attacksFrom(payload.fenAfter, move.to, move.color, move.piece);
    const pressured = attacks
      .map((square) => ({ square, piece: this._pieceAt(payload.fenAfter, square) }))
      .filter((entry) => entry.piece && entry.piece.color !== move.color && entry.piece.type !== 'k')
      .filter((entry) => this.pieceValues[entry.piece.type] >= this.pieceValues[move.piece] || !this._isDefended(payload.fenAfter, entry.square, entry.piece.color));

    if (pressured.length > 0 && !move.captured) {
      const target = pressured[0];
      statements.push(`The ${piece} creates pressure on the ${this.pieceNames[target.piece.type]} on ${target.square}.`);
    }

    if (move.piece === 'p') {
      const pawnPressure = attacks
        .map((square) => this._pieceAt(payload.fenAfter, square))
        .some((target) => target && target.color !== move.color && target.type === 'p');
      if (pawnPressure) statements.push('This is also a pawn break, challenging the opponent pawn chain.');
    }

    return statements;
  }

  _tacticLessonsForMove(payload, move) {
    const lessons = [];
    if (!payload.fenAfter || !move?.to || !move.piece) return lessons;

    const fork = this._forkLesson(payload.fenAfter, move.to, move.color, move.piece, 'This move');
    if (fork) lessons.push(fork);

    const lineTactic = this._lineTacticLesson(payload.fenAfter, move.to, move.color, move.piece, 'This move');
    if (lineTactic) lessons.push(lineTactic);

    const discovered = this._discoveredAttackLesson(payload, move);
    if (discovered) lessons.push(discovered);

    const removal = this._removalOfDefenderLesson(payload, move);
    if (removal) lessons.push(removal);

    const backRank = this._backRankLesson(payload.fenAfter, move);
    if (backRank) lessons.push(backRank);

    const loosePiece = this._loosePieceLesson(payload.fenAfter, move.to, move.color, move.piece);
    if (loosePiece) lessons.push(loosePiece);

    return lessons.slice(0, 2);
  }

  _forkLesson(fen, square, color, type, prefix = 'This move') {
    const attacks = this._attackedEnemyPieces(fen, square, color, type);
    const king = attacks.find((entry) => entry.piece.type === 'k');
    const targets = attacks
      .filter((entry) => entry.piece.type !== 'k' && (this.pieceValues[entry.piece.type] || 0) >= 3)
      .sort((a, b) => (this.pieceValues[b.piece.type] || 0) - (this.pieceValues[a.piece.type] || 0));

    if (king && targets.length > 0) {
      const target = targets[0];
      return `${prefix} creates a fork: it checks the king and attacks the ${this.pieceNames[target.piece.type]} on ${target.square}.`;
    }

    if (targets.length >= 2) {
      const first = targets[0];
      const second = targets[1];
      return `${prefix} creates a fork: the ${this.pieceNames[type] || 'piece'} attacks the ${this.pieceNames[first.piece.type]} on ${first.square} and the ${this.pieceNames[second.piece.type]} on ${second.square}.`;
    }

    return '';
  }

  _lineTacticLesson(fen, square, color, type, prefix = 'This move') {
    const directions = this._lineDirections(type);
    if (directions.length === 0) return '';

    const board = this._boardMap(fen);
    const file = square.charCodeAt(0) - 97;
    const rank = parseInt(square[1], 10) - 1;

    for (const [df, dr] of directions) {
      let front = null;
      for (let f = file + df, r = rank + dr; f >= 0 && f <= 7 && r >= 0 && r <= 7; f += df, r += dr) {
        const targetSquare = String.fromCharCode(97 + f) + (r + 1);
        const piece = board[targetSquare];
        if (!piece) continue;

        if (!front) {
          if (piece.color === color) break;
          front = { square: targetSquare, piece };
          continue;
        }

        if (piece.color !== color) {
          const frontName = this.pieceNames[front.piece.type] || 'piece';
          const backName = this.pieceNames[piece.type] || 'piece';
          const frontValue = this.pieceValues[front.piece.type] || 0;
          const backValue = this.pieceValues[piece.type] || 0;

          if (piece.type === 'k') {
            return `${prefix} creates a pin: the ${frontName} on ${front.square} is stuck in front of the king.`;
          }

          if (backValue > frontValue && backValue >= 5) {
            return `${prefix} creates a relative pin: moving the ${frontName} on ${front.square} would expose the ${backName} on ${targetSquare}.`;
          }

          if ((front.piece.type === 'k' || frontValue > backValue) && frontValue >= 5) {
            return `${prefix} creates a skewer: the ${frontName} on ${front.square} must deal with the attack, exposing the ${backName} behind it.`;
          }
        }
        break;
      }
    }

    return '';
  }

  _discoveredAttackLesson(payload, move) {
    if (!payload.fenBefore || !payload.fenAfter || !move?.from) return '';
    const after = this._boardMap(payload.fenAfter);
    for (const [from, piece] of Object.entries(after)) {
      if (piece.color !== move.color || !['b', 'r', 'q'].includes(piece.type) || from === move.to) continue;
      const attacks = this._attackedEnemyPieces(payload.fenAfter, from, piece.color, piece.type)
        .filter((entry) => entry.piece.type !== 'k' && (this.pieceValues[entry.piece.type] || 0) >= 3);
      for (const target of attacks) {
        if (this._squaresBetween(from, target.square).includes(move.from)) {
          return `This is a discovered attack: moving the ${this.pieceNames[move.piece] || 'piece'} opens the ${this.pieceNames[piece.type]} on ${from} toward the ${this.pieceNames[target.piece.type]} on ${target.square}.`;
        }
      }
    }
    return '';
  }

  _removalOfDefenderLesson(payload, move) {
    if (!payload.fenBefore || !payload.fenAfter || !move?.captured || !move.to) return '';
    const before = new Chess(payload.fenBefore);
    const capturedDefender = before.get(move.to);
    if (!capturedDefender) return '';

    const after = this._boardMap(payload.fenAfter);
    const defendedTargets = Object.entries(after)
      .filter(([, piece]) => piece.color === capturedDefender.color && piece.type !== 'k' && (this.pieceValues[piece.type] || 0) >= 3)
      .map(([square, piece]) => ({ square, piece }))
      .filter((entry) => this._attacksFrom(payload.fenBefore, move.to, capturedDefender.color, capturedDefender.type).includes(entry.square))
      .filter((entry) => this._attacksFrom(payload.fenAfter, move.to, move.color, move.piece).includes(entry.square));

    if (defendedTargets.length === 0) return '';
    const target = defendedTargets.sort((a, b) => (this.pieceValues[b.piece.type] || 0) - (this.pieceValues[a.piece.type] || 0))[0];
    return `Tactical theme: removal of the defender. Capturing the ${this.pieceNames[capturedDefender.type] || 'piece'} also weakens the ${this.pieceNames[target.piece.type]} on ${target.square}.`;
  }

  _backRankLesson(fenAfter, move) {
    if (!fenAfter || !/[+#]$/.test(move?.san || '')) return '';
    const board = new Chess(fenAfter);
    if (!board.in_check()) return '';
    const opponent = move.color === 'w' ? 'b' : 'w';
    const kingSquare = this._kingSquare(fenAfter, opponent);
    const homeRank = opponent === 'w' ? '1' : '8';
    if (!kingSquare || kingSquare[1] !== homeRank) return '';

    const kingMoves = board.moves({ verbose: true })
      .filter((candidate) => candidate.piece === 'k');
    if (kingMoves.length > 1) return '';
    return 'Tactical theme: back-rank pressure. The king is stuck near its home rank, so checks become more dangerous.';
  }

  _loosePieceLesson(fen, square, color, type) {
    const target = this._attackedEnemyPieces(fen, square, color, type)
      .filter((entry) => entry.piece.type !== 'k' && (this.pieceValues[entry.piece.type] || 0) >= 3)
      .find((entry) => !this._isDefended(fen, entry.square, entry.piece.color));
    if (!target) return '';
    return `Tactical theme: the ${this.pieceNames[target.piece.type]} on ${target.square} is loose, meaning it is not defended.`;
  }

	  _describeOpponentReply(payload) {
	    const replyMove = payload.opponentBestMove || payload.replyMove;
	    if (!payload.fenAfter || !replyMove || replyMove.length < 4) return '';

	    const chess = new Chess(payload.fenAfter);
	    const reply = chess.move({
	      from: replyMove.slice(0, 2),
	      to: replyMove.slice(2, 4),
	      promotion: replyMove[4],
		    });
		    if (!reply) return '';

		    if ((reply.san || '').endsWith('#')) {
		      return `The immediate problem is ${reply.san}: it is checkmate.`;
		    }

    const tradeContext = this._replyTradeContext(payload, reply);
    if (tradeContext) return tradeContext;
		
		    const replyFen = chess.fen();
	    const attacks = this._attacksFrom(replyFen, reply.to, reply.color, reply.piece);
    const targets = attacks
      .map((square) => ({ square, piece: this._pieceAt(replyFen, square) }))
      .filter((entry) => entry.piece && entry.piece.color !== reply.color);

    const check = /[+#]$/.test(reply.san || '');
    const queenTarget = targets.find((entry) => entry.piece.type === 'q');
    const kingTarget = targets.find((entry) => entry.piece.type === 'k');
    const highValueTarget = targets
      .filter((entry) => entry.piece.type !== 'k')
      .sort((a, b) => (this.pieceValues[b.piece.type] || 0) - (this.pieceValues[a.piece.type] || 0))[0];

    const threats = [];
    if (check || kingTarget) threats.push('gives check');
    if (queenTarget) {
      threats.push(`attacks the queen on ${queenTarget.square}`);
    } else if (highValueTarget && (this.pieceValues[highValueTarget.piece.type] || 0) >= 3) {
      threats.push(`attacks the ${this.pieceNames[highValueTarget.piece.type]} on ${highValueTarget.square}`);
    } else if (reply.captured) {
      threats.push(`wins the ${this.pieceNames[reply.captured] || 'piece'} on ${reply.to}`);
    }

		    if (check && highValueTarget && reply.piece === 'q') {
		      return `The queen can fork you with ${reply.san}: it checks your king and attacks the ${this.pieceNames[highValueTarget.piece.type]} on ${highValueTarget.square}.`;
		    }

		    if (check && highValueTarget) {
		      return `${reply.san} is a fork: it checks your king and attacks the ${this.pieceNames[highValueTarget.piece.type]} on ${highValueTarget.square}.`;
		    }

    const replyLineTactic = this._lineTacticLesson(replyFen, reply.to, reply.color, reply.piece, `The reply ${reply.san}`);
    if (replyLineTactic) return replyLineTactic;

		    if (threats.length === 0) {
		      return `The engine's immediate reply is ${reply.san}.`;
	    }

    return `The immediate problem is ${reply.san}: it ${threats.join(' and ')}.`;
  }

  _replyTradeContext(payload, reply) {
    if (!reply?.captured || !payload?.fenBefore) return '';
    const before = new Chess(payload.fenBefore);
    const playerMove = payload.moveUci
      ? before.move({
          from: payload.moveUci.slice(0, 2),
          to: payload.moveUci.slice(2, 4),
          promotion: payload.moveUci[4],
        })
      : before.move(payload.moveSan, { sloppy: true });
    if (!playerMove?.captured) return '';
    if (reply.to !== playerMove.to || reply.captured !== playerMove.piece) return '';

    const capturedValue = this.pieceValues[playerMove.captured] || 0;
    const recapturedValue = this.pieceValues[reply.captured] || 0;
    const won = this.pieceNames[playerMove.captured] || 'piece';
    const lost = this.pieceNames[reply.captured] || 'piece';

    if (capturedValue >= recapturedValue) {
      return `${reply.san} recaptures your ${lost} on ${reply.to}, so this is a ${won}-for-${lost} trade, not a clean material loss. Tactic lesson: count the full exchange sequence; the issue is that the resulting position is worse than the best line.`;
    }

    return `${reply.san} recaptures your ${lost} on ${reply.to}; after the trade, you come out down material.`;
  }

  _isBackRank(square, color) {
    return !!square && square[1] === (color === 'w' ? '1' : '8');
  }

  _pieceAt(fen, square) {
    const chess = new Chess(fen);
    return chess.get(square);
  }

	  _isDefended(fen, square, color) {
	    const board = this._boardMap(fen);
	    for (const [from, piece] of Object.entries(board)) {
	      if (piece.color !== color || from === square) continue;
	      if (this._attacksFrom(fen, from, piece.color, piece.type).includes(square)) return true;
	    }
	    return false;
	  }

  _attackedEnemyPieces(fen, square, color, type) {
    return this._attacksFrom(fen, square, color, type)
      .map((targetSquare) => ({ square: targetSquare, piece: this._pieceAt(fen, targetSquare) }))
      .filter((entry) => entry.piece && entry.piece.color !== color);
  }

  _lineDirections(type) {
    if (type === 'b') return [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    if (type === 'r') return [[1, 0], [-1, 0], [0, 1], [0, -1]];
    if (type === 'q') return [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
    return [];
  }

  _squaresBetween(from, to) {
    if (!from || !to || from === to) return [];
    const fromFile = from.charCodeAt(0) - 97;
    const fromRank = Number(from[1]) - 1;
    const toFile = to.charCodeAt(0) - 97;
    const toRank = Number(to[1]) - 1;
    const df = Math.sign(toFile - fromFile);
    const dr = Math.sign(toRank - fromRank);

    if (fromFile !== toFile && fromRank !== toRank && Math.abs(toFile - fromFile) !== Math.abs(toRank - fromRank)) {
      return [];
    }

    const squares = [];
    for (let f = fromFile + df, r = fromRank + dr; f !== toFile || r !== toRank; f += df, r += dr) {
      if (f < 0 || f > 7 || r < 0 || r > 7) return [];
      squares.push(String.fromCharCode(97 + f) + (r + 1));
    }
    return squares;
  }

  _kingSquare(fen, color) {
    const chess = new Chess(fen);
    for (const file of 'abcdefgh') {
      for (const rank of '12345678') {
        const square = file + rank;
        const piece = chess.get(square);
        if (piece && piece.type === 'k' && piece.color === color) return square;
      }
    }
    return '';
  }

	  _opensHomeDiagonal(fenBefore, move) {
    if (!move.from || move.piece !== 'p') return false;
    const homeDiagonals = {
      d2: ['c1'],
      e2: ['f1'],
      d7: ['c8'],
      e7: ['f8'],
    };
    const homes = homeDiagonals[move.from];
    if (!homes) return false;
    return homes.some((sq) => {
      const piece = this._pieceAt(fenBefore, sq);
      return piece && (piece.type === 'b' || piece.type === 'q') && piece.color === move.color;
    });
  }

  _boardMap(fen) {
    const chess = new Chess(fen);
    const board = {};
    for (const file of 'abcdefgh') {
      for (const rank of '12345678') {
        const square = file + rank;
        const piece = chess.get(square);
        if (piece) board[square] = piece;
      }
    }
    return board;
  }

  _attacksFrom(fen, square, color, type) {
    if (!square || !type) return [];
    const board = this._boardMap(fen);
    const file = square.charCodeAt(0) - 97;
    const rank = parseInt(square[1], 10) - 1;
    const out = [];
    const add = (f, r) => {
      if (f < 0 || f > 7 || r < 0 || r > 7) return false;
      const target = String.fromCharCode(97 + f) + (r + 1);
      const targetPiece = board[target];
      if (!targetPiece) {
        out.push(target);
        return true;
      }
      if (targetPiece.color !== color) out.push(target);
      return false;
    };
    const slide = (dirs) => {
      for (const [df, dr] of dirs) {
        for (let f = file + df, r = rank + dr; f >= 0 && f <= 7 && r >= 0 && r <= 7; f += df, r += dr) {
          if (!add(f, r)) break;
        }
      }
    };

    if (type === 'p') {
      const dir = color === 'w' ? 1 : -1;
      add(file - 1, rank + dir);
      add(file + 1, rank + dir);
    } else if (type === 'n') {
      [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]].forEach(([df, dr]) => add(file + df, rank + dr));
    } else if (type === 'b') {
      slide([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
    } else if (type === 'r') {
      slide([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    } else if (type === 'q') {
      slide([[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]);
    } else if (type === 'k') {
      [[1, 1], [1, 0], [1, -1], [0, 1], [0, -1], [-1, 1], [-1, 0], [-1, -1]].forEach(([df, dr]) => add(file + df, rank + dr));
    }

    return out;
  }
}

class MoveAnalyzer {
  constructor() {
    this.analysisDepth = 14;
    this.multiPvCount = 3;
    this.fallbackTimeoutMs = 12000;
    this.bookPly = 16;
    this.coach = new BrowserMoveCoach(this);
  }

  setReviewProfile(profile = {}) {
    this.analysisDepth = profile.depth || this.analysisDepth;
    this.multiPvCount = profile.multiPv || this.multiPvCount;
    this.fallbackTimeoutMs = profile.timeoutMs || this.fallbackTimeoutMs;
  }

  scoreToCp(score, scoreType) {
    if (scoreType === 'mate') {
      if (score > 0) return 10000 - (score * 10);
      if (score < 0) return -10000 + (Math.abs(score) * 10);
      return 0;
    }
    return score;
  }

  normalizeScore(score, scoreType, isWhiteToMove) {
    const cp = this.scoreToCp(score, scoreType);
    return isWhiteToMove ? cp : -cp;
  }

  formatScore(cpScore) {
    if (cpScore >= 9900) {
      const mateMoves = Math.ceil((10000 - cpScore) / 10);
      return `M${mateMoves}`;
    }
    if (cpScore <= -9900) {
      const mateMoves = Math.ceil((10000 + cpScore) / 10);
      return `-M${mateMoves}`;
    }
    const pawns = cpScore / 100;
    return (pawns >= 0 ? '+' : '') + pawns.toFixed(1);
  }

	  evalBarPercent(cpScore) {
	    const x = cpScore / 100;
	    const percent = 50 + 50 * (2 / (1 + Math.exp(-0.4 * x)) - 1);
	    return clamp(percent, 2, 98);
	  }

	  expectedPoints(edgeCp, rating = 1200) {
	    if (edgeCp >= 9900) return 1;
	    if (edgeCp <= -9900) return 0;
	    const playerRating = clamp(Number(rating) || 1200, 100, 2800);
	    const scale = clamp(300 - ((playerRating - 1000) * 0.055), 170, 360);
	    return clamp(1 / (1 + Math.exp(-edgeCp / scale)), 0, 1);
	  }

	  expectedPointLoss(playerEdgeBefore, playerEdgeAfter, rating = 1200) {
	    return Math.max(0, this.expectedPoints(playerEdgeBefore, rating) - this.expectedPoints(playerEdgeAfter, rating));
	  }

	  _ratingForColor(headers = {}, isWhite) {
	    const raw = isWhite ? headers.WhiteElo : headers.BlackElo;
	    const rating = parseInt(raw, 10);
	    return Number.isFinite(rating) ? clamp(rating, 100, 2800) : 1200;
	  }

	  _reviewTolerance(playerRating = 1200, timeControl = '') {
	    const rating = clamp(Number(playerRating) || 1200, 100, 2800);
	    let tolerance = rating < 800 ? 1.35 : rating < 1200 ? 1.18 : rating > 2000 ? 0.9 : 1;
	    const tc = String(timeControl || '').toLowerCase();
	    const baseSeconds = parseInt(tc.split('+')[0], 10);
	    if (tc.includes('bullet') || (Number.isFinite(baseSeconds) && baseSeconds > 0 && baseSeconds <= 180)) tolerance += 0.22;
	    else if (tc.includes('blitz') || (Number.isFinite(baseSeconds) && baseSeconds <= 300)) tolerance += 0.12;
	    else if (tc.includes('classical') || (Number.isFinite(baseSeconds) && baseSeconds >= 1800)) tolerance -= 0.06;
	    return clamp(tolerance, 0.82, 1.55);
	  }

  getClassificationKey(classificationObj) {
    for (const key of CLASSIFICATION_ORDER) {
      if (classificationObj === MoveClassification[key]) return key;
    }
    return 'GOOD';
  }

  _cleanSanMove(move) {
    if (!move) return '';
    return move
      .replace(/[+#?!]/g, '')
      .replace(/e\.p\./gi, '')
      .trim();
  }

  detectOpening(moves) {
    if (!Array.isArray(moves) || moves.length === 0) return null;
    const cleanMoves = moves.map((m) => this._cleanSanMove(m));
    let best = null;

    for (const entry of OPENING_BOOK) {
      if (entry.moves.length > cleanMoves.length) continue;
      let matches = true;
      for (let i = 0; i < entry.moves.length; i++) {
        if (cleanMoves[i] !== entry.moves[i]) {
          matches = false;
          break;
        }
      }
      if (matches && (!best || entry.moves.length > best.moves.length)) {
        best = entry;
      }
    }

    if (!best) return null;
    return {
      eco: best.eco,
      name: best.name,
      ply: best.moves.length,
    };
  }

  _cpLoss(bestScoreAfter, playedScoreAfter, isWhitePlaying) {
    const edgeBefore = isWhitePlaying ? bestScoreAfter : -bestScoreAfter;
    const edgeAfter = isWhitePlaying ? playedScoreAfter : -playedScoreAfter;
    const raw = Math.max(0, edgeBefore - edgeAfter);
    return Math.min(raw, 1200);
  }

  _formatCpLossText(cpLoss, expectedLoss) {
    if (typeof expectedLoss === 'number' && expectedLoss >= 0.12) {
      return `drops your expected result by about ${Math.round(expectedLoss * 100)} percentage points`;
    }
    const cp = Math.round(cpLoss || 0);
    if (cp >= 500) return 'severely worsens the position';
    if (cp > 0) return `gives up about ${cp} centipawns`;
    return 'worsens the position';
  }

  _sameMoveSan(a, b) {
    if (!a || !b) return false;
    return String(a).replace(/[+#]/g, '') === String(b).replace(/[+#]/g, '');
  }

  _gapToSecond(bestScore, secondScore, isWhitePlaying) {
    if (secondScore === null || typeof secondScore === 'undefined') return Infinity;
    if (isWhitePlaying) return Math.max(0, bestScore - secondScore);
    return Math.max(0, secondScore - bestScore);
  }

		  _pieceName(pieceType) {
		    const names = {
	      p: 'pawn',
	      n: 'knight',
      b: 'bishop',
      r: 'rook',
      q: 'queen',
      k: 'king',
    };
		    return names[pieceType] || 'piece';
		  }

		  _boardMap(fen) {
		    const chess = new Chess(fen);
		    const board = {};
		    for (const file of 'abcdefgh') {
		      for (const rank of '12345678') {
		        const square = file + rank;
		        const piece = chess.get(square);
		        if (piece) board[square] = piece;
		      }
		    }
		    return board;
		  }

		  _pieceAt(fen, square) {
		    const chess = new Chess(fen);
		    return chess.get(square);
		  }

		  _attacksFrom(fen, square, color, type) {
		    if (!square || !type) return [];
		    const board = this._boardMap(fen);
		    const file = square.charCodeAt(0) - 97;
		    const rank = parseInt(square[1], 10) - 1;
		    const out = [];
		    const add = (f, r) => {
		      if (f < 0 || f > 7 || r < 0 || r > 7) return false;
		      const target = String.fromCharCode(97 + f) + (r + 1);
		      const targetPiece = board[target];
		      if (!targetPiece) {
		        out.push(target);
		        return true;
		      }
		      if (targetPiece.color !== color) out.push(target);
		      return false;
		    };
		    const slide = (dirs) => {
		      for (const [df, dr] of dirs) {
		        for (let f = file + df, r = rank + dr; f >= 0 && f <= 7 && r >= 0 && r <= 7; f += df, r += dr) {
		          if (!add(f, r)) break;
		        }
		      }
		    };

		    if (type === 'p') {
		      const dir = color === 'w' ? 1 : -1;
		      add(file - 1, rank + dir);
		      add(file + 1, rank + dir);
		    } else if (type === 'n') {
		      [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]].forEach(([df, dr]) => add(file + df, rank + dr));
		    } else if (type === 'b') {
		      slide([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
		    } else if (type === 'r') {
		      slide([[1, 0], [-1, 0], [0, 1], [0, -1]]);
		    } else if (type === 'q') {
		      slide([[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]);
		    } else if (type === 'k') {
		      [[1, 1], [1, 0], [1, -1], [0, 1], [0, -1], [-1, 1], [-1, 0], [-1, -1]].forEach(([df, dr]) => add(file + df, rank + dr));
		    }

		    return out;
		  }

		  _isBackRank(square, color) {
		    return !!square && square[1] === (color === 'w' ? '1' : '8');
		  }

  _describeBestMove(fen, bestMoveUci, bestMoveSan) {
    if (!fen || !bestMoveUci || bestMoveUci.length < 4) {
      return bestMoveSan || '';
    }

    const chess = new Chess(fen);
    const move = chess.move({
      from: bestMoveUci.substring(0, 2),
      to: bestMoveUci.substring(2, 4),
      promotion: bestMoveUci.length > 4 ? bestMoveUci[4] : undefined,
    });

    if (!move) {
      return bestMoveSan || '';
    }

    if (/#$/.test(move.san)) {
      return `checkmate the king with ${move.san}`;
    }

    if (move.captured) {
      return `win the ${this._pieceName(move.captured)} on ${move.to} with ${move.san}`;
    }

    if (move.promotion) {
      return `promote to a queen with ${move.san}`;
    }

    if (/\+$/.test(move.san)) {
      return `keep the attack going with ${move.san}`;
    }

    return `play ${move.san}`;
  }

  _describeImmediatePunish(fenAfter) {
    if (!fenAfter) return '';

    const chess = new Chess(fenAfter);
    const legalMoves = chess.moves({ verbose: true });
    if (legalMoves.length === 0) return '';

    const pieceValue = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    let bestCapture = null;
    let bestCaptureScore = -Infinity;

    for (const move of legalMoves) {
      if (/#$/.test(move.san)) {
        return `there is mate on the king with ${move.san}`;
      }

      if (!move.captured) continue;

      const moverVal = pieceValue[move.piece] || 0;
      const capturedVal = pieceValue[move.captured] || 0;
      let score = (capturedVal * 10) - moverVal;
      if (/\+$/.test(move.san)) score += 2;
      if (move.flags.includes('e')) score += 1;

      if (score > bestCaptureScore) {
        bestCaptureScore = score;
        bestCapture = move;
      }
    }

    if (bestCapture) {
      return `the ${this._pieceName(bestCapture.piece)} can take your ${this._pieceName(bestCapture.captured)} on ${bestCapture.to}`;
    }

	    const checkingMove = legalMoves.find((move) => /\+$/.test(move.san));
	    if (checkingMove) {
	      const played = chess.move(checkingMove.san);
	      const replyFen = played ? chess.fen() : '';
	      const attacks = played ? this._attacksFrom(replyFen, played.to, played.color, played.piece) : [];
	      const target = attacks
	        .map((square) => ({ square, piece: this._pieceAt(replyFen, square) }))
	        .filter((entry) => entry.piece && entry.piece.color !== played.color && entry.piece.type !== 'k')
	        .sort((a, b) => (pieceValue[b.piece.type] || 0) - (pieceValue[a.piece.type] || 0))[0];
	      if (played) chess.undo();
	      if (target && checkingMove.piece === 'q') {
	        return `the queen can fork you with ${checkingMove.san}, checking your king and attacking the ${this._pieceName(target.piece.type)} on ${target.square}`;
	      }
	      if (target) {
	        return `${checkingMove.san} is a fork, checking your king and attacking the ${this._pieceName(target.piece.type)} on ${target.square}`;
	      }
	      return `the opponent has the checking move ${checkingMove.san}`;
	    }

    return '';
  }

			  classifyMove(moveData) {
	    const {
	      movePly,
	      moveSan,
	      moveUci,
	      fenBefore,
	      numLegalMoves,
	      isCheckmate,
	      isPieceSacrifice,
	      playerEdgeBefore,
	      playerEdgeAfter,
	      cpLoss,
	      isBestMove,
	      gapToSecond,
	      scoreBefore,
		      scoreAfter,
		      phase,
		      playerRating = 1200,
		      timeControl = '',
		      opponentJustBlundered,
		    } = moveData;
		    const opponentMateAfter = this._opponentImmediateMateAfter(fenBefore, moveSan);
		    const expectedLoss = this.expectedPointLoss(playerEdgeBefore, playerEdgeAfter, playerRating);
			    const beforeExpected = this.expectedPoints(playerEdgeBefore, playerRating);
			    const afterExpected = this.expectedPoints(playerEdgeAfter, playerRating);
			    const tolerance = this._reviewTolerance(playerRating, timeControl);
			    const isInForcedMate = playerEdgeBefore <= -9000;
			    const losingOnOpponentMove = opponentMateAfter
			      || playerEdgeAfter <= -120
			      || afterExpected <= 0.38;
			    const nearlyBest = isBestMove || cpLoss <= 18 || expectedLoss <= 0.012;
		    const positionAfterOk = playerEdgeAfter > -120 && this.expectedPoints(playerEdgeAfter, playerRating) >= 0.38;
		    const wasAlreadyCrushing = this.expectedPoints(playerEdgeBefore, playerRating) >= 0.9 && !opponentJustBlundered;
				    const materialOffer = this._materialOfferAfterMove(fenBefore, moveSan);
				    const kingPressureOffer = !!materialOffer && this._kingPressureMove(fenBefore, moveSan);
				    const goodPieceSacrifice = isPieceSacrifice || !!this._mateTrapSacrifice(fenBefore, moveSan) || kingPressureOffer;
				    const ordinaryCaptureTrade = this._ordinaryCaptureTrade(fenBefore, moveSan);
				    const drawResource = this._acceptedOfferDrawResource(fenBefore, moveSan);
				    const losesMaterialOrGame = !!opponentMateAfter
				      || playerEdgeAfter <= -9000
				      || this._opponentMaterialTacticAfter(fenBefore, moveSan);
		
		    const mateTrap = this._mateTrapSacrifice(fenBefore, moveSan);
			    const bestAttackingOffer = goodPieceSacrifice
			      && nearlyBest
			      && !ordinaryCaptureTrade
			      && !opponentMateAfter
		      && positionAfterOk
		      && !wasAlreadyCrushing
		      && playerEdgeAfter >= playerEdgeBefore - 85
		      && (isBestMove || gapToSecond >= 20 || beforeExpected <= 0.72);
					    if (!ordinaryCaptureTrade && !opponentMateAfter && mateTrap && isBestMove && gapToSecond >= 45 && positionAfterOk && !wasAlreadyCrushing) {
					      return MoveClassification.BRILLIANT;
					    }
	
				    if (!opponentMateAfter
				      && !ordinaryCaptureTrade
				      && kingPressureOffer
				      && isBestMove
				      && gapToSecond >= 60
				      && nearlyBest
			      && positionAfterOk
			      && playerEdgeAfter >= playerEdgeBefore - 70
			      && !wasAlreadyCrushing) {
			      return MoveClassification.BRILLIANT;
			    }

		    if (drawResource
		      && isBestMove
		      && gapToSecond >= 50
		      && !opponentMateAfter
		      && positionAfterOk
		      && !wasAlreadyCrushing
		      && afterExpected >= Math.max(0.48, beforeExpected - 0.02)) {
		      return MoveClassification.BRILLIANT;
		    }

		    const rareBestSacrifice = goodPieceSacrifice
		      && isBestMove
		      && nearlyBest
		      && gapToSecond >= 110
		      && !ordinaryCaptureTrade
		      && playerEdgeAfter >= playerEdgeBefore - 20
	      && positionAfterOk
	      && !wasAlreadyCrushing
	      && !opponentMateAfter;

	    if (rareBestSacrifice) {
	      return MoveClassification.BRILLIANT;
	    }

	    if (bestAttackingOffer && isBestMove && gapToSecond >= 55) {
	      return MoveClassification.BRILLIANT;
	    }

    if (movePly <= this.bookPly && cpLoss <= 20 && !opponentJustBlundered) {
      return MoveClassification.BOOK;
    }

	    if (isCheckmate) {
	      return isPieceSacrifice ? MoveClassification.BRILLIANT : MoveClassification.BEST;
	    }

	    if (numLegalMoves === 1) {
	      return MoveClassification.FORCED;
	    }

		    if (opponentMateAfter) {
		      if (isBestMove) return MoveClassification.MISTAKE;
		      // In forced mate, don't mark as blunder—only as mistake/inaccuracy
		      if (isInForcedMate && playerEdgeAfter <= playerEdgeBefore + 100) return MoveClassification.MISTAKE;
		      return cpLoss >= 120 || playerEdgeAfter <= -9000
		        ? MoveClassification.BLUNDER
		        : MoveClassification.MISTAKE;
		    }

		    const forcedMateContinuation = Math.abs(playerEdgeBefore) >= 9000
		      && Math.abs(playerEdgeAfter) >= 9000
		      && expectedLoss <= 0.01;
		    if (forcedMateContinuation && nearlyBest) {
		      return isBestMove ? MoveClassification.BEST : MoveClassification.EXCELLENT;
		    }

		    const hasWinningOpportunity = playerEdgeBefore >= 220;
		    const droppedWin = hasWinningOpportunity && playerEdgeAfter < 120;
		    const missedPunish = opponentJustBlundered
		      && beforeExpected >= 0.72
		      && afterExpected < 0.65
		      && !nearlyBest
		      && (cpLoss >= 70 || expectedLoss >= 0.05);
	
	    if (missedPunish || (droppedWin && cpLoss >= 100)) {
	      return MoveClassification.MISS;
	    }

	    const effectiveCpLoss = this._classificationCpLoss({
	      cpLoss,
	      phase,
	      playerEdgeBefore,
	      playerEdgeAfter,
	      isCheckmate,
	    });

			    if (expectedLoss > 0.20 * tolerance || effectiveCpLoss >= 320 * tolerance) {
			      if (isInForcedMate) return MoveClassification.MISTAKE;
			      return (losingOnOpponentMove && losesMaterialOrGame) ? MoveClassification.BLUNDER : MoveClassification.MISTAKE;
			    }
			    if (losesMaterialOrGame && (expectedLoss > 0.14 * tolerance || effectiveCpLoss >= 220 * tolerance)) {
			      if (isBestMove) return expectedLoss > 0.18 * tolerance ? MoveClassification.MISTAKE : MoveClassification.INACCURACY;
			      if (isInForcedMate) return MoveClassification.MISTAKE;
			      return MoveClassification.BLUNDER;
			    }
		    if (expectedLoss > 0.10 * tolerance || effectiveCpLoss >= 155 * tolerance) return MoveClassification.MISTAKE;
	    if (expectedLoss > 0.05 * tolerance || effectiveCpLoss >= 70 * tolerance) return MoveClassification.INACCURACY;

		    const wasCloseGame = Math.abs(scoreBefore) < 180;
		    const stillClose = Math.abs(scoreAfter) < 220;
    const uniqueBest = gapToSecond >= 120;

			    if (!ordinaryCaptureTrade
			      && goodPieceSacrifice
			      && isBestMove
			      && gapToSecond >= 90
			      && nearlyBest
		      && !opponentMateAfter
	      && positionAfterOk
	      && !wasAlreadyCrushing
	      && uniqueBest
	      && wasCloseGame && stillClose) {
	      return MoveClassification.BRILLIANT;
	    }
	
		    const rescueOrConversion = beforeExpected <= 0.36 && afterExpected >= 0.48;
		    const courseChangingOnlyMove = nearlyBest
		      && gapToSecond >= 240
		      && !wasAlreadyCrushing
		      && beforeExpected <= 0.40
		      && (opponentJustBlundered || gapToSecond >= 320 || rescueOrConversion);
			    if (isBestMove && !goodPieceSacrifice && (courseChangingOnlyMove || rescueOrConversion)) {
			      return MoveClassification.GREAT;
			    }
	
	    if (isBestMove || expectedLoss <= 0.003 || effectiveCpLoss <= 8) {
	      return MoveClassification.BEST;
	    }
		
	    if (expectedLoss <= 0.02 || effectiveCpLoss <= 28) return MoveClassification.EXCELLENT;
	    return MoveClassification.GOOD;
	  }

		  _classificationCpLoss({ cpLoss, phase, playerEdgeBefore, playerEdgeAfter, isCheckmate }) {
	    if (phase !== 'Endgame' || isCheckmate) return cpLoss;

	    const stayedWinning = playerEdgeBefore >= 300 && playerEdgeAfter >= 220;
	    const stayedClearlyBetter = playerEdgeBefore >= 160 && playerEdgeAfter >= 140;
	    const stayedLost = playerEdgeBefore <= -300 && playerEdgeAfter <= -260;

	    if (stayedWinning) return cpLoss * 0.42;
	    if (stayedClearlyBetter) return cpLoss * 0.68;
	    if (stayedLost) return cpLoss * 0.5;
		    return cpLoss;
		  }

			  _materialOfferAfterMove(fenBefore, moveSan) {
		    if (!fenBefore || !moveSan) return null;
		    const board = new Chess(fenBefore);
		    const moveObj = board.move(moveSan, { sloppy: true });
		    if (!moveObj || board.in_checkmate()) return null;

		    const value = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
		    const captures = board.moves({ verbose: true })
		      .filter((reply) => reply.captured && (value[reply.captured] || 0) >= 3)
		      .map((reply) => ({
		        san: reply.san,
		        to: reply.to,
		        captured: reply.captured,
		        attacker: reply.piece,
		        swing: (value[reply.captured] || 0) - (value[reply.piece] || 0),
		        movedPiece: reply.to === moveObj.to,
		      }))
		      .filter((reply) => reply.swing >= 1)
		      .sort((a, b) => b.swing - a.swing);

			    return captures[0] || null;
			  }

		  _ordinaryCaptureTrade(fenBefore, moveSan) {
		    if (!fenBefore || !moveSan) return false;
		    const board = new Chess(fenBefore);
		    const moveObj = board.move(moveSan, { sloppy: true });
		    if (!moveObj || !moveObj.captured) return false;

		    const value = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
		    const movedValue = value[moveObj.piece] || 0;
		    const capturedValue = value[moveObj.captured] || 0;
		    if (capturedValue < movedValue) return false;

		    const replyCaptures = board.moves({ verbose: true })
		      .filter((reply) => reply.to === moveObj.to && reply.captured === moveObj.piece);
		    return replyCaptures.length > 0 || capturedValue === movedValue;
		  }

		  _acceptedOfferDrawResource(fenBefore, moveSan) {
		    if (!fenBefore || !moveSan) return null;
		    const board = new Chess(fenBefore);
		    const moveObj = board.move(moveSan, { sloppy: true });
		    if (!moveObj || board.in_checkmate()) return null;

		    const value = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
		    const offeredValue = value[moveObj.piece] || 0;
		    if (offeredValue < 3) return null;

		    const acceptingReplies = board.moves({ verbose: true })
		      .filter((reply) => reply.to === moveObj.to && reply.captured === moveObj.piece);

		    for (const reply of acceptingReplies) {
		      const accepted = board.move(reply.san);
		      if (!accepted) continue;
		      const isDraw = board.in_draw()
		        || board.in_stalemate?.()
		        || board.insufficient_material?.()
		        || this._bareKingsOrNoWinningMaterial(board);
		      board.undo();
		      if (isDraw) {
		        return {
		          captureSan: reply.san,
		          capturedPiece: moveObj.piece,
		          square: moveObj.to,
		        };
		      }
		    }

		    return null;
		  }

		  _bareKingsOrNoWinningMaterial(chess) {
		    const pieces = [];
		    for (const row of chess.board()) {
		      for (const piece of row) {
		        if (piece && piece.type !== 'k') pieces.push(piece);
		      }
		    }
		    if (pieces.length === 0) return true;
		    if (pieces.length === 1 && ['b', 'n'].includes(pieces[0].type)) return true;
		    return false;
		  }

			  _opponentMaterialTacticAfter(fenBefore, moveSan) {
		    if (!fenBefore || !moveSan) return false;
		    const board = new Chess(fenBefore);
		    const moveObj = board.move(moveSan, { sloppy: true });
		    if (!moveObj || board.in_checkmate()) return false;

		    const value = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
		    const legalReplies = board.moves({ verbose: true });
		    for (const reply of legalReplies) {
		      if (/#$/.test(reply.san || '')) return true;
		      const equalOrBetterTradeRecapture = moveObj.captured
		        && reply.to === moveObj.to
		        && reply.captured === moveObj.piece
		        && (value[moveObj.captured] || 0) >= (value[reply.captured] || 0);
		      if (equalOrBetterTradeRecapture) continue;
		      if (reply.captured) {
		        const attackerValue = reply.piece === 'k' ? (value[reply.captured] || 0) : (value[reply.piece] || 0);
		        if ((value[reply.captured] || 0) - attackerValue >= 1) return true;
		      }

		      const givesCheck = /[+#]$/.test(reply.san || '');
		      const played = board.move(reply.san);
		      if (!played) continue;
		      const attacks = this._attacksFrom(board.fen(), played.to, played.color, played.piece)
		        .map((square) => ({ square, piece: this._pieceAt(board.fen(), square) }))
		        .filter((entry) => entry.piece && entry.piece.color !== played.color && entry.piece.type !== 'k');
		      board.undo();

		      if (givesCheck && attacks.some((entry) => (value[entry.piece.type] || 0) >= 3)) return true;
		    }
		    return false;
		  }

			  _kingPressureMove(fenBefore, moveSan) {
		    if (!fenBefore || !moveSan) return false;
		    const board = new Chess(fenBefore);
		    const moveObj = board.move(moveSan, { sloppy: true });
		    if (!moveObj) return false;
		    if (/[+#]/.test(moveObj.san || '')) return true;

		    const opponent = moveObj.color === 'w' ? 'b' : 'w';
		    const kingSquare = this._kingSquare(board.fen(), opponent);
		    if (kingSquare && this._squareDistance(moveObj.to, kingSquare) <= 2) return true;

		    const file = moveObj.to[0];
		    const rank = Number(moveObj.to[1]);
		    const kingRank = opponent === 'b' ? 8 : 1;
		    return moveObj.captured && ['f', 'g', 'h'].includes(file) && Math.abs(rank - kingRank) <= 2;
		  }

			  _mateTrapSacrifice(fenBefore, moveSan) {
		    if (!fenBefore || !moveSan) return null;
		    const board = new Chess(fenBefore);
		    const moveObj = board.move(moveSan, { sloppy: true });
		    if (!moveObj) return null;
		    if (this._immediateMateMove(board.fen())) return null;

	    const value = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
	    const movedValue = value[moveObj.piece] || 0;
	    if (movedValue < 3) return null;

	    const target = moveObj.to;
	    const opponentReplies = board.moves({ verbose: true });
	    for (const reply of opponentReplies) {
	      if (reply.to !== target || !reply.captured) continue;

	      const capture = board.move(reply.san);
	      if (!capture) continue;

	      const matingReply = board.moves({ verbose: true }).find((candidate) => {
	        const testMove = board.move(candidate.san);
	        const isMate = !!testMove && board.in_checkmate();
	        if (testMove) board.undo();
	        return isMate;
	      });
	      board.undo();

	      if (matingReply) {
	        return {
	          captureSan: reply.san,
	          mateSan: matingReply.san,
	        };
	      }
	    }

		    return null;
		  }

		  _opponentImmediateMateAfter(fenBefore, moveSan) {
		    if (!fenBefore || !moveSan) return null;
		    const board = new Chess(fenBefore);
		    const moveObj = board.move(moveSan, { sloppy: true });
		    if (!moveObj || board.in_checkmate()) return null;
		    return this._immediateMateMove(board.fen());
		  }

		  _immediateMateMove(fen) {
		    if (!fen) return null;
		    const board = new Chess(fen);
		    const legalMoves = board.moves({ verbose: true });
		    for (const move of legalMoves) {
		      const played = board.move(move.san);
		      const isMate = !!played && board.in_checkmate();
		      if (played) board.undo();
		      if (isMate) return move;
		    }
		    return null;
		  }

  checkSacrifice(chess, moveSan) {
    const moveObj = chess.move(moveSan, { sloppy: true });
    if (!moveObj) return { isSacrifice: false, isPieceSacrifice: false };

    const pieceValue = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    const to = moveObj.to;
    const movingPieceVal = pieceValue[moveObj.piece] || 0;
    const capturedVal = moveObj.captured ? (pieceValue[moveObj.captured] || 0) : 0;

    const opponentMoves = chess.moves({ verbose: true });
    const recaptures = opponentMoves.filter((m) => m.to === to);

    if (recaptures.length === 0 || movingPieceVal <= 1) {
      chess.undo();
      return { isSacrifice: false, isPieceSacrifice: false };
    }

    let isJustATrade = false;
    for (const recap of recaptures) {
      const recapMove = chess.move(recap.san);
      if (recapMove) {
        const ourRecaps = chess.moves({ verbose: true }).filter((m) => m.to === to);
        chess.undo();
        if (ourRecaps.length > 0) {
          isJustATrade = true;
          break;
        }
      }
    }

    chess.undo();

    if (isJustATrade) {
      return { isSacrifice: false, isPieceSacrifice: false };
    }

    if (movingPieceVal > capturedVal + 1) {
      return { isSacrifice: true, isPieceSacrifice: movingPieceVal >= 3 };
    }

    return { isSacrifice: false, isPieceSacrifice: false };
  }

	  _phaseFromFen(fen, movePly) {
	    if (movePly <= this.bookPly) return 'Opening';
	    const chess = new Chess(fen);
    const board = chess.board();

    let nonPawnMaterial = 0;
    let pieces = 0;
    const value = { n: 3, b: 3, r: 5, q: 9 };

    for (const row of board) {
      for (const piece of row) {
        if (!piece) continue;
        if (piece.type !== 'k') pieces += 1;
        if (value[piece.type]) nonPawnMaterial += value[piece.type];
      }
    }

	    if (pieces <= 10 || nonPawnMaterial <= 14) return 'Endgame';
	    return 'Middlegame';
	  }

	  _kingSquare(fen, color) {
	    const chess = new Chess(fen);
	    for (const file of 'abcdefgh') {
	      for (const rank of '12345678') {
	        const square = file + rank;
	        const piece = chess.get(square);
	        if (piece && piece.type === 'k' && piece.color === color) return square;
	      }
	    }
	    return '';
	  }

	  _squareDistance(a, b) {
	    if (!a || !b) return 99;
	    return Math.max(Math.abs(a.charCodeAt(0) - b.charCodeAt(0)), Math.abs(Number(a[1]) - Number(b[1])));
	  }

	  _isPassedPawn(fen, square, color) {
	    const chess = new Chess(fen);
	    const file = square.charCodeAt(0);
	    const rank = Number(square[1]);
	    const dir = color === 'w' ? 1 : -1;
	    for (let df = -1; df <= 1; df += 1) {
	      const f = String.fromCharCode(file + df);
	      if (f < 'a' || f > 'h') continue;
	      for (let r = rank + dir; r >= 1 && r <= 8; r += dir) {
	        const piece = chess.get(f + r);
	        if (piece && piece.type === 'p' && piece.color !== color) return false;
	      }
	    }
	    return true;
	  }

	  _oppositionNote(fen) {
	    const side = fen.split(' ')[1];
	    const whiteKing = this._kingSquare(fen, 'w');
	    const blackKing = this._kingSquare(fen, 'b');
	    if (!whiteKing || !blackKing) return '';
	    const sameFile = whiteKing[0] === blackKing[0];
	    const sameRank = whiteKing[1] === blackKing[1];
	    const distance = this._squareDistance(whiteKing, blackKing);
	    if ((sameFile || sameRank) && distance === 2) {
	      return side === 'w' ? 'Black has the opposition.' : 'White has the opposition.';
	    }
	    return '';
	  }

	  _endgameNotes(fenBefore, fenAfter, moveObj, phase) {
	    if (phase !== 'Endgame' || !moveObj) return [];
	    const notes = [];
	    const center = ['d4', 'e4', 'd5', 'e5'];
	    const ownKingBefore = this._kingSquare(fenBefore, moveObj.color);
	    if (moveObj.piece === 'k') {
	      const beforeDist = Math.min(...center.map((sq) => this._squareDistance(ownKingBefore, sq)));
	      const afterDist = Math.min(...center.map((sq) => this._squareDistance(moveObj.to, sq)));
	      notes.push(afterDist < beforeDist ? 'King activity improved.' : 'Check whether the king can be more active.');
	    }
	    if (moveObj.piece === 'p' && this._isPassedPawn(fenAfter, moveObj.to, moveObj.color)) {
	      notes.push(`The pawn on ${moveObj.to} is passed.`);
	    }
	    if (moveObj.piece === 'r') {
	      const board = new Chess(fenAfter);
	      for (const rank of '12345678') {
	        const sq = moveObj.to[0] + rank;
	        const piece = board.get(sq);
	        if (piece && piece.type === 'p' && this._isPassedPawn(fenAfter, sq, piece.color)) {
	          notes.push('Rook placement matters here: rooks belong behind passed pawns.');
	          break;
	        }
	      }
	    }
	    const opposition = this._oppositionNote(fenAfter);
	    if (opposition) notes.push(opposition);
	    return notes.slice(0, 2);
	  }

	  _planTags({ fenBefore, fenAfter, moveObj, phase, classificationKey, playerEdgeBefore, playerEdgeAfter }) {
	    if (!moveObj) return [];
	    const tags = [];
	    const before = new Chess(fenBefore);
	    if (before.in_check()) tags.push('Defense');
	    if (/[+#]/.test(moveObj.san || '') || classificationKey === 'BRILLIANT' || classificationKey === 'GREAT') tags.push('Attack');
	    if (moveObj.piece !== 'p' && moveObj.piece !== 'k' && this._isBackRank(moveObj.from, moveObj.color)) tags.push('Development');
	    if (moveObj.flags?.includes('k') || moveObj.flags?.includes('q')) tags.push('King safety');
	    if (moveObj.captured) tags.push('Trade');
	    if (moveObj.piece === 'p') {
	      const fileChanged = moveObj.from[0] !== moveObj.to[0];
	      const rank = Number(moveObj.to[1]);
	      const adjacentEnemyPawn = [-1, 1].some((df) => {
	        const file = String.fromCharCode(moveObj.to.charCodeAt(0) + df);
	        if (file < 'a' || file > 'h') return false;
	        const piece = before.get(file + rank);
	        return piece && piece.type === 'p' && piece.color !== moveObj.color;
	      });
	      if (fileChanged || adjacentEnemyPawn) tags.push('Pawn break');
	    }
	    if (phase === 'Endgame') tags.push('Endgame');
	    if (playerEdgeBefore >= 250 && playerEdgeAfter >= 180) tags.push('Conversion');
	    return [...new Set(tags)].slice(0, 4);
	  }

	  _mateThreat(fenAfter) {
	    const mateInOne = this._immediateMateMove(fenAfter);
	    if (mateInOne) return { in: 1, moveSan: mateInOne.san, text: `Opponent has mate in 1: ${mateInOne.san}` };
	    const board = new Chess(fenAfter);
	    const legal = board.moves({ verbose: true });
	    if (legal.length > 32) return null;
	    const start = Date.now();
	    const attackingMoves = legal
	      .filter((move) => /[+#]/.test(move.san || '') || move.captured || move.promotion)
	      .slice(0, 14);
	    for (const attack of attackingMoves) {
	      if (Date.now() - start > 8) return null;
	      const playedAttack = board.move(attack.san);
	      if (!playedAttack) continue;
	      const replies = board.moves({ verbose: true }).slice(0, 24);
	      let forced = replies.length > 0;
	      for (const reply of replies.slice(0, 48)) {
	        const playedReply = board.move(reply.san);
	        const mateNext = playedReply ? this._immediateMateMove(board.fen()) : null;
	        if (playedReply) board.undo();
	        if (!mateNext) {
	          forced = false;
	          break;
	        }
	      }
	      board.undo();
	      if (forced) return { in: 2, moveSan: attack.san, text: `Opponent has a forced mate threat: ${attack.san}` };
	    }
	    return null;
	  }

	  _openingPlan(opening) {
	    const name = String(opening?.name || '').toLowerCase();
	    if (name.includes('ruy lopez')) return 'Keep central tension, castle, and prepare c3/d4 before launching flank play.';
	    if (name.includes('sicilian')) return 'Fight for d4, finish development, and watch queenside/central breaks.';
	    if (name.includes('french')) return 'Resolve the light-squared bishop, attack the pawn chain, and time c5/f6 breaks.';
	    if (name.includes('caro')) return 'Develop the light bishop cleanly, challenge the center, and avoid passive piece placement.';
	    if (name.includes('london')) return 'Build the e3/c3/Nf3 structure, keep the dark bishop active, and choose a central break.';
	    if (name.includes('italian')) return 'Castle, develop smoothly, and decide between c3/d4 center play or kingside pressure.';
	    if (name.includes('queen')) return 'Develop pieces before pawn grabbing, contest the center, and coordinate rooks.';
	    return 'Develop pieces, castle, and connect moves to a clear central plan.';
	  }

	  _openingDrift(moves, opening) {
	    if (!opening) return null;
	    const driftPly = Math.min((opening.ply || 0) + 1, moves.length);
	    if (driftPly <= 0 || driftPly > moves.length) return null;
	    const moveNumber = Math.floor((driftPly - 1) / 2) + 1;
	    return {
	      moveIndex: driftPly - 1,
	      moveLabel: `${moveNumber}${driftPly % 2 === 1 ? '.' : '...'} ${moves[driftPly - 1]}`,
	      text: `Left book after ${opening.name}${opening.eco ? ` (${opening.eco})` : ''}. ${this._openingPlan(opening)}`,
	    };
	  }

	  _trainingQueue(results) {
	    return results
	      .filter((move) => ['MISS', 'BLUNDER', 'MISTAKE'].includes(move.classificationKey) && !move.isCoachMove)
	      .sort((a, b) => b.severityScore - a.severityScore)
	      .slice(0, 10)
	      .map((move) => ({
	        moveIndex: move.moveIndex,
	        fen: move.fen,
	        prompt: `Find a better move than ${move.moveSan}.`,
	        solution: move.bestMoveSan || '',
	        reason: move.coachText || '',
	      }));
	  }

	  _patternStats(results) {
	    const patterns = new Map();
	    const add = (key, text) => patterns.set(key, { text, count: (patterns.get(key)?.count || 0) + 1 });
	    for (const move of results) {
	      if (!['INACCURACY', 'MISTAKE', 'BLUNDER', 'MISS'].includes(move.classificationKey)) continue;
	      if (move.mateThreat) add('mate-threats', 'You often allow direct mate threats.');
	      if ((move.planTags || []).includes('Trade') && move.playerEdgeBefore > 180) add('trading-up', 'You sometimes trade while already attacking or converting.');
	      if ((move.planTags || []).includes('Development') && move.movePly > 16) add('late-development', 'Development problems are lasting past the opening.');
		      if ((move.planTags || []).includes('Pawn break')) add('pawn-breaks', 'Pawn breaks need more calculation before release.');
		      if (move.phase === 'Endgame') add('endgame', 'Endgame technique is costing practical chances.');
		      if (/queen/i.test(move.coachText || '')) add('queen-safety', 'Queen safety is a recurring tactical issue.');
		      if (/fork/i.test(move.coachText || '')) add('forks', 'Forks are deciding several positions: watch for checks that also attack pieces.');
		      if (/pin/i.test(move.coachText || '')) add('pins', 'Pins are recurring: notice pieces that cannot move without exposing something valuable.');
		      if (/skewer/i.test(move.coachText || '')) add('skewers', 'Skewers are appearing: high-value pieces can be driven away from pieces behind them.');
		      if (/discovered attack/i.test(move.coachText || '')) add('discovered-attacks', 'Discovered attacks are important: moving one piece can open a line for another.');
		      if (/loose/i.test(move.coachText || '')) add('loose-pieces', 'Loose pieces are a pattern: undefended pieces become tactical targets.');
		      if (/back-rank/i.test(move.coachText || '')) add('back-rank', 'Back-rank pressure matters: king safety and escape squares need attention.');
		    }
	    return [...patterns.values()].sort((a, b) => b.count - a.count).slice(0, 5);
	  }

	  _reviewNarrative(results, headers = {}) {
	    if (!results.length) return [];
	    const whiteBad = results.filter((m) => m.isWhite && ['MISS', 'BLUNDER', 'MISTAKE'].includes(m.classificationKey));
	    const blackBad = results.filter((m) => !m.isWhite && ['MISS', 'BLUNDER', 'MISTAKE'].includes(m.classificationKey));
	    const whiteName = headers.White || 'White';
	    const blackName = headers.Black || 'Black';
	    const result = headers.Result || '';
	    const title = result === '1-0' ? `${whiteName} won because` : result === '0-1' ? `${blackName} won because` : 'The game turned because';
	    const betterSide = whiteBad.length <= blackBad.length ? whiteName : blackName;
	    const worsePatterns = this._patternStats(results).slice(0, 2).map((p) => p.text.toLowerCase());
	    const critical = results.filter((m) => m.isCriticalMoment).length;
	    return [
	      `${title} ${betterSide} made fewer severe errors in the critical positions.`,
	      critical > 0 ? `${critical} critical moments shaped the result, with misses and blunders carrying the largest swings.` : 'The game was decided more by steady move quality than by one obvious collapse.',
	      worsePatterns.length > 0 ? `Recurring themes: ${worsePatterns.join(' ')}.` : 'Recurring themes: conversion, king safety, and clean development.',
	    ];
	  }

  _coachingText(payload) {
    const coachText = this.coach?.explain(payload);
    if (coachText) return coachText;

    const {
	          classification,
	          cpLoss,
	          expectedLoss,
	          bestMoveSan,
      bestMove,
      moveSan,
      opponentJustBlundered,
      fenBefore,
      fenAfter,
    } = payload;

	    const key = this.getClassificationKey(classification);
	    const bestMoveIdea = this._describeBestMove(fenBefore, bestMove, bestMoveSan);
	    const punishText = this._describeImmediatePunish(fenAfter);
	    const mateTrap = this._mateTrapSacrifice(fenBefore, moveSan);
	
		    if (key === 'BRILLIANT') {
		      const drawResource = this._acceptedOfferDrawResource(fenBefore, moveSan);
		      if (drawResource) {
		        return `${moveSan} is brilliant. If ${drawResource.captureSan} takes the sacrifice, the position is drawn, so this saves the game instead of playing for an attack.`;
		      }
		      if (mateTrap) {
		        return `${moveSan} is brilliant. If ${mateTrap.captureSan} takes the piece, ${mateTrap.mateSan} is checkmate; otherwise the pressure stays.`;
		      }
		      const offer = this._materialOfferAfterMove(fenBefore, moveSan);
		      if (offer) {
		        return `${moveSan} is brilliant. It offers the ${this._pieceName(offer.captured)} on ${offer.to}, but that material is bait while the attack keeps control.`;
		      }
		      return `${moveSan} is brilliant. You found the only real tactical idea and kept the attack alive.`;
		    }
		    if (key === 'GREAT') {
		      return `${moveSan} is great. It altered the course of the game by rescuing a losing position.`;
		    }
	    if (key === 'BEST') {
	      return `${moveSan} is best. It is the engine's top choice.`;
	    }
	    if (key === 'EXCELLENT') {
	      return `${moveSan} is excellent. It is almost as good as the best move.`;
	    }
	    if (key === 'GOOD') {
	      return `${moveSan} is good. It is decent, but ${bestMoveSan || 'the best move'} was cleaner.`;
    }
    if (key === 'BOOK') {
      return `${moveSan} stays in book.`;
    }
    if (key === 'FORCED') {
      return `${moveSan} was forced in this position.`;
    }
	    if (key === 'INACCURACY') {
	      if (punishText) {
	        return `${moveSan} is an inaccuracy, a weak move because ${punishText}. ${bestMoveSan || 'The best move'} kept things under control.`;
	      }
	      return `${moveSan} is an inaccuracy. It is weak, and ${bestMoveSan || 'the best move'} kept a healthier edge.`;
	    }
		    if (key === 'MISTAKE') {
		      if (punishText) {
		        const alt = bestMoveSan && !this._sameMoveSan(bestMoveSan, moveSan) ? ` ${bestMoveSan} was needed here.` : '';
		        return `${moveSan} is a mistake because ${punishText}.${alt}`;
		      }
	      const lossText = this._formatCpLossText(cpLoss, expectedLoss);
	      const alt = bestMoveSan && !this._sameMoveSan(bestMoveSan, moveSan) ? ` ${bestMoveSan} was needed.` : '';
	      return `${moveSan} is a mistake and ${lossText}.${alt}`;
    }
    if (key === 'MISS') {
      if (opponentJustBlundered) {
        if (bestMoveIdea) {
          return `${moveSan} is a miss. You missed the chance to ${bestMoveIdea}.`;
        }
        return `${moveSan} is a miss. ${bestMoveSan || 'The best move'} would have converted the position.`;
      }
      if (bestMoveIdea) {
        return `${moveSan} is a miss because you missed a chance to ${bestMoveIdea}.`;
      }
      return `${moveSan} is a miss. ${bestMoveSan || 'The best move'} would have kept the winning chances alive.`;
    }
		    if (punishText) {
		      const alt = bestMoveSan && !this._sameMoveSan(bestMoveSan, moveSan) ? ` ${bestMoveSan} was critical here.` : '';
		      return `${moveSan} is a blunder because ${punishText}.${alt}`;
		    }
	    const lossText = this._formatCpLossText(cpLoss, expectedLoss);
	    const alt = bestMoveSan && !this._sameMoveSan(bestMoveSan, moveSan) ? ` ${bestMoveSan} was critical here.` : '';
	    return `${moveSan} is a blunder and ${lossText}.${alt}`;
	  }

  _lineToSan(fen, pvUci, maxPlies = 6) {
    if (!pvUci) return '';
    const chess = new Chess(fen);
    const moves = pvUci.split(/\s+/).filter(Boolean).slice(0, maxPlies);
    const sanMoves = [];

    for (const uci of moves) {
      if (uci.length < 4) break;
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      if (!move) break;
      sanMoves.push(move.san);
    }

    return sanMoves.join(' ');
  }

  _orderLinesForSide(lines, isWhiteToMove) {
    const ordered = lines.slice();
    ordered.sort((a, b) => {
      if (isWhiteToMove) return b.cp - a.cp;
      return a.cp - b.cp;
    });
    return ordered;
  }

	  _positionsForMoves(moves, initialFen) {
	    const chess = new Chess();
	    if (initialFen) {
	      chess.load(initialFen);
	    }
	    const positions = [chess.fen()];
	    for (const move of moves) {
	      chess.move(move, { sloppy: true });
	      positions.push(chess.fen());
	    }
	    return positions;
	  }

  async evaluatePositions(positions, engine, onProgress, options = {}) {
    const evals = [];
    const cache = new Map();
    const total = options.totalPositions || positions.length;
    const offset = options.offset || 0;
    if (options.newGame !== false) {
      await engine.newGame();
    }

    for (let i = 0; i < positions.length; i++) {
      const absoluteIndex = offset + i;
      if (onProgress) {
        onProgress(absoluteIndex, total, `Analyzing ${absoluteIndex + 1}/${total}`);
      }

      const fen = positions[i];
      const cacheKey = `${fen}|${this.analysisDepth}|${this.multiPvCount}|${this.fallbackTimeoutMs}`;
      if (cache.has(cacheKey)) {
        evals.push(cache.get(cacheKey));
        continue;
      }

      const isWhiteToMove = fen.split(' ')[1] === 'w';
      const multi = await engine.evaluateMultiPV(fen, this.analysisDepth, this.multiPvCount, this.fallbackTimeoutMs);
      let lines = (multi.lines || []).map((line) => {
        const pvTokens = (line.pv || '').split(/\s+/).filter(Boolean);
        const move = pvTokens.length > 0 ? pvTokens[0] : '';
        const cp = this.normalizeScore(line.score || 0, line.scoreType || 'cp', isWhiteToMove);
        return {
          cp,
          move,
          pvUci: line.pv || '',
          pvSan: this._lineToSan(fen, line.pv || '', 8),
          depth: line.depth || 0,
        };
      }).filter((line) => !!line.move);

      lines = this._orderLinesForSide(lines, isWhiteToMove);

	      if (lines.length === 0) {
	        const fallback = await engine.evaluate(fen, this.analysisDepth, this.fallbackTimeoutMs);
	        const cp = this.normalizeScore(fallback.score, fallback.scoreType, isWhiteToMove);
	        lines.push({
	          cp,
	          move: fallback.bestMove || '',
	          pvUci: fallback.pv || '',
	          pvSan: this._lineToSan(fen, fallback.pv || '', 8),
	          depth: fallback.depth || 0,
	        });
	      }

	      const best = lines[0];
      const result = {
        cp: best ? best.cp : 0,
        bestMove: best ? best.move : '',
        pv: best ? best.pvUci : '',
        pvSan: best ? best.pvSan : '',
        depth: best ? best.depth : 0,
        lines,
      };
      cache.set(cacheKey, result);
      evals.push(result);
    }
      const legalMoves = positionChess.moves({ verbose: true });
      const numLegalMoves = legalMoves.length;

      const moveObj = positionChess.move(moves[i], { sloppy: true });
      const movePlayedUci = moveObj ? (moveObj.from + moveObj.to + (moveObj.promotion || '')) : '';
      const movePlayedSan = moveObj ? moveObj.san : moves[i];

      const sacCheckBoard = new Chess(fen);
      const sacResult = moveObj
        ? this.checkSacrifice(sacCheckBoard, moves[i])
        : { isSacrifice: false, isPieceSacrifice: false };

      const scoreBefore = evals[i].cp;
      const scoreAfterRaw = evals[i + 1].cp;
      const posAfter = new Chess(fenAfter);
      const isCheckmate = posAfter.in_checkmate();
      const scoreAfter = isCheckmate ? (isWhitePlaying ? 10000 : -10000) : scoreAfterRaw;

      const bestMove = evals[i].bestMove;
      const bestMoveSan = this.uciToSan(fen, bestMove);
      const opponentBestMove = evals[i + 1]?.bestMove || '';
      const opponentBestMoveSan = opponentBestMove ? this.uciToSan(fenAfter, opponentBestMove) : '';
	      const cpLoss = this._cpLoss(scoreBefore, scoreAfter, isWhitePlaying);
	      const phase = this._phaseFromFen(fen, movePly);

      const secondLine = evals[i].lines.length > 1 ? evals[i].lines[1] : null;
      const gapToSecond = this._gapToSecond(
        evals[i].lines[0] ? evals[i].lines[0].cp : scoreBefore,
        secondLine ? secondLine.cp : null,
        isWhitePlaying
      );

	      const playerEdgeBefore = isWhitePlaying ? scoreBefore : -scoreBefore;
	      const playerEdgeAfter = isWhitePlaying ? scoreAfter : -scoreAfter;
	      const playerRating = this._ratingForColor(options.headers, isWhitePlaying);
	      const timeControl = options.headers?.TimeControl || options.headers?.Time || '';
	      const expectedLoss = this.expectedPointLoss(playerEdgeBefore, playerEdgeAfter, playerRating);
	      const isBestMove = movePlayedUci === bestMove;
	      const opponentJustBlundered = i > 0 && ['BLUNDER', 'MISTAKE'].includes(results[i - 1].classificationKey);
		      const mateThreat = options.skipMateThreat ? null : this._mateThreat(fenAfter);

      const classification = this.classifyMove({
        movePly,
        moveSan: movePlayedSan,
        moveUci: movePlayedUci,
        fenBefore: fen,
        numLegalMoves,
        isCheckmate,
        isPieceSacrifice: sacResult.isPieceSacrifice,
        playerEdgeBefore,
        playerEdgeAfter,
        cpLoss,
        isBestMove,
        gapToSecond,
	        scoreBefore,
		        scoreAfter,
		        phase,
		        playerRating,
		        timeControl,
		        opponentJustBlundered,
		      });

      const alternatives = evals[i].lines.slice(0, this.multiPvCount).map((line, idx) => ({
        rank: idx + 1,
        moveUci: line.move,
        moveSan: this.uciToSan(fen, line.move),
        eval: line.cp,
        evalText: this.formatScore(line.cp),
        pvSan: line.pvSan,
      }));

	      const classificationKey = this.getClassificationKey(classification);
	      const planTags = this._planTags({
	        fenBefore: fen,
	        fenAfter,
	        moveObj,
	        phase,
	        classificationKey,
	        playerEdgeBefore,
	        playerEdgeAfter,
	      });
	      const endgameNotes = this._endgameNotes(fen, fenAfter, moveObj, phase);
	      const severityScoreMap = {
        BRILLIANT: 1,
        GREAT: 0.8,
        BEST: 0.3,
        EXCELLENT: 0.2,
        GOOD: 0.1,
        BOOK: 0.05,
        FORCED: 0.05,
        INACCURACY: 0.65,
        MISTAKE: 0.9,
        BLUNDER: 1.2,
        MISS: 1.35,
      };
	      const severityScore = (severityScoreMap[classificationKey] || 0.1)
	        + (expectedLoss * 2.2)
	        + (Math.min(cpLoss, 600) / 1500);
	
	      results.push({
        move: moves[i],
        moveSan: movePlayedSan,
        moveUci: movePlayedUci,
        moveIndex: i,
        moveNumber,
        movePly,
        isWhite: isWhitePlaying,
        classification,
        classificationKey,
        evalBefore: scoreBefore,
        evalAfter: scoreAfter,
	        swing: scoreAfter - scoreBefore,
	        cpLoss,
	        expectedLoss,
	        playerRating,
	        playerEdgeBefore,
	        playerEdgeAfter,
	        bestMove,
        bestMoveSan,
        opponentBestMove,
        opponentBestMoveSan,
        bestMovePv: evals[i].pv,
        bestMovePvSan: evals[i].pvSan,
	        alternatives,
	        depth: evals[i].depth,
	        fen,
	        fenAfter,
	        phase,
	        planTags,
	        mateThreat,
	        endgameNotes,
	        isCriticalMoment: expectedLoss >= 0.08 || cpLoss >= 120 || classificationKey === 'MISS' || classificationKey === 'BLUNDER',
        severityScore,
        opponentJustBlundered,
        coachText: this._coachingText({
          classification,
          cpLoss,
          expectedLoss,
          isBestMove,
          bestMoveSan,
          bestMove: evals[i].bestMove,
          opponentBestMove,
          opponentBestMoveSan,
          moveUci: movePlayedUci,
          moveSan: movePlayedSan,
          movePly,
          scoreBefore,
	          scoreAfter,
	          isWhite: isWhitePlaying,
	          playerRating,
	          opponentJustBlundered,
          fenBefore: fen,
          fenAfter,
        }),
      });
    }

	    results.opening = opening;
	    results.openingDrift = this._openingDrift(moves, opening);
	    results.trainingQueue = this._trainingQueue(results);
	    results.patternStats = this._patternStats(results);
	    results.reviewNarrative = this._reviewNarrative(results, options.headers || {});
	    results.criticalMoments = this.getCriticalMoments(results, 8);
    results.whiteAccuracy = this.calculateAccuracy(results, 'white');
    results.blackAccuracy = this.calculateAccuracy(results, 'black');
    results.whiteAcpl = this.calculateAcpl(results, 'white');
    results.blackAcpl = this.calculateAcpl(results, 'black');
    results.whiteCaps = this.calculateCapsScore(results, 'white');
    results.blackCaps = this.calculateCapsScore(results, 'black');
    results.phaseSummary = {
      white: this.summarizeByPhase(results, 'white'),
      black: this.summarizeByPhase(results, 'black'),
    };

    return results;
  }

	  calculateAccuracy(moveResults, color) {
	    const expectedLoss = this.calculateExpectedLoss(moveResults, color);
	    if (expectedLoss !== null) {
	      const evalScore = clamp(100 - (expectedLoss * 220), 0, 100);
	      const bestMoveScore = this._bestMoveAccuracyScore(moveResults, color);
	      return Math.round(clamp((evalScore * 0.65) + (bestMoveScore * 0.35), 0, 100));
	    }
	    const acpl = this.calculateAcpl(moveResults, color);
	    const accuracy = 103.1668 * Math.exp(-0.04354 * acpl) - 3.1669;
	    return Math.round(clamp(accuracy, 0, 100));
	  }

	  _bestMoveAccuracyScore(moveResults, color) {
	    const weights = {
	      BRILLIANT: 100,
	      GREAT: 98,
	      BEST: 96,
	      EXCELLENT: 90,
	      GOOD: 78,
	      BOOK: 92,
	      FORCED: 92,
	      INACCURACY: 58,
	      MISTAKE: 32,
	      BLUNDER: 8,
	      MISS: 14,
	    };
	    const moves = moveResults.filter((m) =>
	      (color === 'white' && m.isWhite) || (color === 'black' && !m.isWhite)
	    );
	    if (moves.length === 0) return 100;
	    return moves.reduce((sum, move) => sum + (weights[move.classificationKey] ?? 78), 0) / moves.length;
	  }

	  calculateExpectedLoss(moveResults, color) {
	    const colorMoves = moveResults.filter((m) =>
	      (color === 'white' && m.isWhite) || (color === 'black' && !m.isWhite)
	    );
	    const scored = colorMoves.filter((m) =>
	      m.classification !== MoveClassification.BOOK
	      && m.classification !== MoveClassification.FORCED
	      && typeof m.expectedLoss === 'number'
	    );
	    if (scored.length === 0) return null;
	    return scored.reduce((sum, move) => sum + clamp(move.expectedLoss, 0, 1), 0) / scored.length;
	  }

  calculateAcpl(moveResults, color) {
    const colorMoves = moveResults.filter((m) =>
      (color === 'white' && m.isWhite) || (color === 'black' && !m.isWhite)
    );

    if (colorMoves.length === 0) return 0;

    let totalCpLoss = 0;
    let count = 0;

    for (const m of colorMoves) {
      if (m.classification === MoveClassification.BOOK || m.classification === MoveClassification.FORCED) {
        continue;
      }
      const cpLoss = typeof m.cpLoss === 'number'
        ? m.cpLoss
        : (m.isWhite ? Math.max(0, m.evalBefore - m.evalAfter) : Math.max(0, m.evalAfter - m.evalBefore));
      totalCpLoss += Math.min(cpLoss, 500);
      count++;
    }

    if (count === 0) return 0;
    return totalCpLoss / count;
  }

  calculateCapsScore(moveResults, color) {
    const weights = {
      BRILLIANT: 1.05,
      GREAT: 1.0,
      BEST: 0.95,
      EXCELLENT: 0.9,
      GOOD: 0.8,
      BOOK: 0.85,
      FORCED: 0.9,
      INACCURACY: 0.55,
      MISTAKE: 0.3,
      BLUNDER: 0.1,
      MISS: 0.05,
    };

    const colorMoves = moveResults.filter((m) =>
      (color === 'white' && m.isWhite) || (color === 'black' && !m.isWhite)
    );
    if (colorMoves.length === 0) return 100;

    let sum = 0;
    for (const move of colorMoves) {
      sum += weights[move.classificationKey] || 0.8;
    }

    return clamp((sum / colorMoves.length) * 100, 0, 100);
  }

  summarizeByPhase(moveResults, color) {
    const phases = ['Opening', 'Middlegame', 'Endgame'];
    const result = {};

    for (const phase of phases) {
      const phaseMoves = moveResults.filter((m) => {
        const colorMatch = (color === 'white' && m.isWhite) || (color === 'black' && !m.isWhite);
        return colorMatch && m.phase === phase;
      });

      if (phaseMoves.length === 0) {
        result[phase] = { moves: 0, accuracy: 0, acpl: 0 };
        continue;
      }

	      const acpl = this.calculateAcpl(phaseMoves, color);
	      const expectedLoss = this.calculateExpectedLoss(phaseMoves, color);
	      const accuracy = expectedLoss !== null
	        ? 100 - (expectedLoss * 220)
	        : 103.1668 * Math.exp(-0.04354 * acpl) - 3.1669;

      result[phase] = {
        moves: phaseMoves.length,
        acpl: Math.round(acpl),
        accuracy: Math.round(clamp(accuracy, 0, 100)),
      };
    }

    return result;
  }

  getCriticalMoments(moveResults, max = 8) {
    const candidates = moveResults
      .filter((m) => m.isCriticalMoment || m.classificationKey === 'BRILLIANT' || m.classificationKey === 'GREAT')
      .slice()
      .sort((a, b) => b.severityScore - a.severityScore);

    return candidates.slice(0, max);
  }

  getTopMistakes(moveResults, color, max = 3) {
      const candidates = moveResults
      .filter((m) => ((color === 'white' && m.isWhite) || (color === 'black' && !m.isWhite)))
      .filter((m) => ['INACCURACY', 'MISTAKE', 'BLUNDER', 'MISS'].includes(m.classificationKey))
      .slice()
      .sort((a, b) => b.cpLoss - a.cpLoss);

    return candidates.slice(0, max);
  }

  countClassifications(moveResults, color) {
    const counts = {};
    const colorMoves = moveResults.filter((m) =>
      (color === 'white' && m.isWhite) || (color === 'black' && !m.isWhite)
    );

    for (const key of CLASSIFICATION_ORDER) {
      counts[key] = 0;
    }

    for (const move of colorMoves) {
      const key = move.classificationKey || this.getClassificationKey(move.classification);
      if (typeof counts[key] === 'number') counts[key] += 1;
    }

    return counts;
  }

  uciToSan(fen, uciMove) {
    if (!uciMove || uciMove.length < 4) return uciMove;
    const chess = new Chess(fen);
    const move = chess.move({
      from: uciMove.substring(0, 2),
      to: uciMove.substring(2, 4),
      promotion: uciMove.length > 4 ? uciMove[4] : undefined,
    });
    return move ? move.san : uciMove;
  }
}
