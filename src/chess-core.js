// Move Analysis and Classification Module
// Provides game-review style classification, summaries, and coach guidance.

// Classification scheme (10 classes), in order from best to worst.
// Each entry carries the canonical short description used across the UI.
const MoveClassification = Object.freeze({
  BRILLIANT: { key: 'BRILLIANT', name: 'Brilliant', symbol: '!!', color: '#1ac4a3', icon: '!!', iconType: 'text', description: 'The best move — and a hard one to find!' },
  GREAT: { key: 'GREAT', name: 'Great', symbol: '!', color: '#709bc3', icon: '!', iconType: 'text', description: 'A move that altered the course of the game!' },
  BEST: { key: 'BEST', name: 'Best', symbol: '★', color: '#81b849', icon: 'star', iconType: 'material', description: "The chess engine's top choice" },
  EXCELLENT: { key: 'EXCELLENT', name: 'Excellent', symbol: '👍', color: '#8cb758', icon: 'thumb_up', iconType: 'material', description: 'Almost as good as the Best move' },
  GOOD: { key: 'GOOD', name: 'Good', symbol: '✓', color: '#93b772', icon: 'check', iconType: 'material', description: 'A decent move, but not the best' },
  BOOK: { key: 'BOOK', name: 'Book', symbol: '📖', color: '#bf9b80', icon: 'menu_book', iconType: 'material', description: 'A conventional opening move' },
  INACCURACY: { key: 'INACCURACY', name: 'Inaccuracy', symbol: '?!', color: '#f6d96b', icon: '?!', iconType: 'text', description: 'A weak move' },
  MISTAKE: { key: 'MISTAKE', name: 'Mistake', symbol: '?', color: '#ffa24d', icon: '?', iconType: 'text', description: 'A bad move that immediately worsens your position' },
  MISS: { key: 'MISS', name: 'Miss', symbol: 'X', color: '#ff7461', icon: 'X', iconType: 'text', description: 'A move that missed a tactical opportunity or a chance to punish the opponent' },
  BLUNDER: { key: 'BLUNDER', name: 'Blunder', symbol: '??', color: '#ff3c2d', icon: '??', iconType: 'text', description: 'A very bad move that also loses material or the game' },
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
  'INACCURACY',
  'MISTAKE',
  'MISS',
  'BLUNDER',
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
	// accuracy is now win-probability based (chess.com-style: clean ~95-99,
	// typical ~80-92, shaky ~70-80), so the anticheat thresholds sit lower than
	// under the old compressed scale where play clustered in the 90s.
	score += Math.max(0, Math.min(38, (accuracy - 72) * 1.9));
	score += Math.max(0, Math.min(18, (42 - acpl) * 0.45));
	score += Math.max(0, Math.min(16, (bestRate - 55) * 0.45));
	score += Math.max(0, Math.min(12, (winRate - 65) * 0.35));
	score += Math.max(0, Math.min(10, (18 - mistakeRate) * 0.35));
	score += Math.max(0, Math.min(16, (fastBestRate - 35) * 0.35)) * timeCoverage;
	score += Math.max(0, Math.min(8, (fastCriticalRate - 8) * 0.7)) * timeCoverage;
	if (games >= 4 && accuracy >= 90 && accuracyStd <= 5) score += 8;
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
    // Cache for board maps to avoid creating Chess instances repeatedly
    this._boardMapCache = new Map();
    this._boardMapCacheMaxSize = 50;
  }

  _getBoardMap(fen) {
    let board = this._boardMapCache.get(fen);
    if (!board) {
      const chess = new Chess(fen);
      board = {};
      for (const file of 'abcdefgh') {
        for (const rank of '12345678') {
          const square = file + rank;
          const piece = chess.get(square);
          if (piece) board[square] = piece;
        }
      }
      // Limit cache size
      if (this._boardMapCache.size >= this._boardMapCacheMaxSize) {
        const firstKey = this._boardMapCache.keys().next().value;
        this._boardMapCache.delete(firstKey);
      }
      this._boardMapCache.set(fen, board);
    }
    return board;
  }

  _boardMap(fen) {
    return this._getBoardMap(fen);
  }

  _pieceAt(fen, square) {
    const board = this._getBoardMap(fen);
    return board[square] || null;
  }

  explain(payload) {
    const moveInfo = this._moveInfo(payload);
    const key = this.analyzer.getClassificationKey(payload.classification);
    const san = moveInfo.san || payload.moveSan || 'This move';

    if (['INACCURACY', 'MISTAKE', 'BLUNDER', 'MISS'].includes(key)) {
      return this._explainErrorMove(payload, moveInfo, key, san);
    }
    return this._explainGoodMove(payload, moveInfo, key, san);
  }

  _explainErrorMove(payload, moveInfo, key, san) {
    const label = {
      INACCURACY: 'an inaccuracy',
      MISTAKE: 'a mistake',
      MISS: 'a miss',
      BLUNDER: 'a blunder',
    }[key] || 'an error';

    const betterSan = payload.bestMoveSan;
    const betterIsDifferent = betterSan
      && !payload.isBestMove
      && !this.analyzer._sameMoveSan(betterSan, san);
    const betterReason = betterIsDifferent
      ? this.analyzer._bestMoveReason(payload.fenBefore, payload.bestMove)
      : '';

    if (key === 'MISS') {
      if (payload.opponentJustBlundered && betterIsDifferent && betterReason) {
        return `${san} is a miss. After their slip, ${betterSan} ${betterReason}.`;
      }
      if (betterIsDifferent && betterReason) {
        return `${san} is a miss — you overlooked that ${betterSan} ${betterReason}.`;
      }
      if (betterIsDifferent) {
        return `${san} is a miss. ${betterSan} would have kept the advantage.`;
      }
      return `${san} is a miss that lets a stronger continuation slip away.`;
    }

    const mateConsequence = this._mateConsequence(payload);
    if (mateConsequence) {
      const priorNote = this._priorMoveNote(payload);
      const lead = priorNote
        ? `${san} is ${label} — ${priorNote}, ${mateConsequence}`
        : `${san} is ${label}: ${mateConsequence}`;
      const line = this._winningLineSnippet(payload);
      const better = betterIsDifferent
        ? this._suggestBetterMove(payload, betterSan, betterReason, mateConsequence)
        : '';
      const text = this._joinSentences([lead, line, better]);
      return this._withErrorPun(text, key);
    }

    const playedNote = this._playedMoveNote(payload, moveInfo);
    const opponentReply = this._describeOpponentReply(payload);
    const severity = this._severityClause(payload.cpLoss, payload.expectedLoss, key);
    const swing = this._evalSwingClause(payload);

    // If the move itself is checkmate but classified as an error (rare edge case),
    // explain it naturally rather than mechanically.
    if (san.endsWith('#')) {
      return this._explainErrorCheckmate(payload, moveInfo, key, san, betterSan, betterReason, betterIsDifferent);
    }

    // Compose a lead sentence. Prefer concrete specifics (opponent's punishing
    // reply, or what the played move tried to do) over a bare "is a blunder".
    let lead = '';
    if (opponentReply && playedNote) {
      lead = `${san} is ${label}: ${playedNote}, but ${opponentReply}`;
    } else if (opponentReply) {
      lead = `${san} is ${label} — ${opponentReply}`;
    } else if (playedNote) {
      lead = `${san} is ${label}: ${playedNote}`;
    } else {
      lead = `${san} is ${label}`;
    }
    // The concrete eval-swing clause ("the evaluation collapses from +2.0 to
    // −1.5") folds into the lead sentence; the generic severity clause is a
    // last resort when no concrete swing is available.
    if (swing && !opponentReply) {
      lead = `${lead} — ${swing}`;
    } else if (severity && !opponentReply) {
      lead = `${lead}, and ${severity}`;
    }

    const better = betterIsDifferent
      ? this._suggestBetterMove(payload, betterSan, betterReason)
      : '';

    const text = this._joinSentences([lead, better]);
    return this._withErrorPun(text, key);
  }

  // Natural-language explanation for a checkmate move that's somehow classified as an error.
  _explainErrorCheckmate(payload, moveInfo, key, san, betterSan, betterReason, betterIsDifferent) {
    const label = {
      INACCURACY: 'an inaccuracy',
      MISTAKE: 'a mistake',
      BLUNDER: 'a blunder',
    }[key] || 'an error';
    const piece = moveInfo.piece ? this.pieceNames[moveInfo.piece] || 'piece' : 'piece';
    const to = moveInfo.to || '';

    let text = `${san} is checkmate, but it's classified as ${label}. `;
    if (payload.cpLoss >= 300 || key === 'BLUNDER') {
      text += `The position collapses after this — the king may be mated, but the material cost or positional damage is too high.`;
    } else if (payload.cpLoss >= 120) {
      text += `It weakens the position significantly despite the checkmate.`;
    } else {
      text += `There's a more precise way to finish the game.`;
    }

    if (betterIsDifferent && betterReason) {
      text += ` ${this._capitalize(betterSan + ' ' + betterReason)}`;
    } else if (betterIsDifferent) {
      text += ` ${betterSan} would have been the more precise finish.`;
    }

    return text;
  }

  // Adds a brief, empathetic note so blunders/mistakes don't feel purely
  // punitive.
  _withErrorPun(text, key) {
    if (!text) return text;
    if (key === 'BLUNDER') {
      const notes = [
        ' Tough position — even strong players miss this.',
        ' A costly mistake, but part of the learning process.',
      ];
      return text + this._pick(notes);
    }
    if (key === 'MISTAKE') {
      const notes = [
        ' A slip that can happen under time pressure.',
        ' Worth filing away for next time.',
      ];
      return text + this._pick(notes);
    }
    return text;
  }

  _pick(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return '';
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Join sentence fragments into a single readable paragraph. Each fragment is
  // normalized to end with a single period, empties are dropped, and consecutive
  // fragments are separated by one space. Lets the explainers assemble detail
  // (assessment, eval swing, punishment line, better move) without stapling
  // punctuation together by hand.
  _joinSentences(parts) {
    return parts
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .map((part) => part.replace(/[.!?]+$/, '').trim())
      .join('. ') + (parts.some((p) => String(p || '').trim()) ? '.' : '');
  }

  // Short, human eval-swing clause for a blunder/mistake: "the evaluation
  // collapses from +2.0 to −1.5". Returns '' when there's no meaningful swing
  // to describe (or when mate is already the subject, to avoid redundancy).
  _evalSwingClause(payload) {
    const before = payload.playerEdgeBefore;
    const after = payload.playerEdgeAfter;
    if (typeof before !== 'number' || typeof after !== 'number') return '';
    if (Math.abs(before) >= 9900 || Math.abs(after) >= 9900) return '';
    const drop = before - after;
    if (drop < 80) return '';
    const fmt = (cp) => {
      const pawns = cp / 100;
      return (pawns >= 0 ? '+' : '') + pawns.toFixed(1);
    };
    const verb = drop >= 300 ? 'collapses' : drop >= 120 ? 'drops sharply' : 'slips';
    return `the evaluation ${verb} from ${fmt(before)} to ${fmt(after)}`;
  }

  _opponentMateDistance(playerEdgeAfter) {
    if (typeof playerEdgeAfter !== 'number' || playerEdgeAfter > -9900) return null;
    return Math.max(0, Math.ceil((10000 + playerEdgeAfter) / 10));
  }

  _formatMateThreat(threat) {
    if (!threat) return '';
    const move = threat.moveSan || '';
    if (threat.in === 1) {
      return move ? `${move} is mate on the spot` : 'your king gets mated';
    }
    if (threat.in === 2) {
      return move ? `${move} forces mate in 2` : 'there is a forced mate in 2';
    }
    return move ? `${move} launches a winning attack` : 'the attack is decisive';
  }

  _mateConsequence(payload) {
    const threat = payload.mateThreat
      || (payload.fenAfter ? this.analyzer._mateThreat(payload.fenAfter) : null);
    if (threat) return this._formatMateThreat(threat);

    const mateDistance = this._opponentMateDistance(payload.playerEdgeAfter);
    if (mateDistance !== null) {
      const replySan = payload.opponentBestMoveSan || '';
      if (mateDistance === 0) return replySan ? `${replySan} is mate` : 'you get mated';
      if (mateDistance === 1) return replySan ? `${replySan} is mate` : 'there is a forced mate';
      return replySan
        ? `${replySan} forces mate in ${mateDistance}`
        : `there is a forced mate in ${mateDistance}`;
    }

    if (payload.opponentBestMove && payload.fenAfter) {
      const sequel = this._mateAfterReply(payload.fenAfter, payload.opponentBestMove);
      if (sequel) return sequel;
    }

    return '';
  }

  _mateAfterReply(fenAfter, opponentUci) {
    if (!fenAfter || !opponentUci || opponentUci.length < 4) return '';

    const chess = new Chess(fenAfter);
    const reply = chess.move({
      from: opponentUci.slice(0, 2),
      to: opponentUci.slice(2, 4),
      promotion: opponentUci[4],
    });
    if (!reply) return '';

    const mateNext = this.analyzer._immediateMateMove(chess.fen());
    if (mateNext) {
      return `${reply.san} allows ${mateNext.san}, which is mate`;
    }

    const threat = this.analyzer._mateThreat(chess.fen());
    if (threat?.in === 1) return `${reply.san} leads to mate in 1`;
    if (threat?.in === 2) return `${reply.san} forces mate in 2`;

    return '';
  }

  // Lowercase subordinate clause (no leading capital, no trailing comma) describing
  // the opponent's preceding move, so it splices cleanly after an em-dash:
  // "Nxd7 is a blunder — after Bxd7+ intensified the attack, ...". Returning a
  // capitalized "After ..." here used to produce "Nxd7 is a blunder After ...".
  _priorMoveNote(payload) {
    if (payload.opponentJustBlundered && payload.priorOpponentMoveSan) {
      return `after their slip with ${payload.priorOpponentMoveSan}`;
    }
    if (payload.priorOpponentMoveSan && payload.priorOpponentThreat) {
      return `after ${payload.priorOpponentMoveSan} intensified the attack`;
    }
    return '';
  }

  _winningLineSnippet(payload) {
    const pv = payload.opponentPvSan || '';
    if (!pv) return '';
    const moves = pv.split(/\s+/).filter(Boolean).slice(0, 4);
    if (moves.length < 2) return '';
    return `The line runs ${moves.join(' ')}.`;
  }

  _suggestBetterMove(payload, betterSan, betterReason, mateConsequence = '') {
    if (!betterSan) return '';
    if (mateConsequence && /^K/.test(betterSan)) {
      return `Better was ${betterSan}, tucking the king to safety.`;
    }
    if (mateConsequence && (!betterReason || betterReason === 'improves the position')) {
      return `Better was ${betterSan} to stop the mating attack.`;
    }
    if (betterReason && betterReason !== 'improves the position') {
      return `Better was ${betterSan}, which ${betterReason}.`;
    }
    return `The engine preferred ${betterSan}.`;
  }

  _explainGoodMove(payload, moveInfo, key, san) {
    if (key === 'BRILLIANT') {
      return this._explainBrilliant(payload, moveInfo, san);
    }

    if (key === 'GREAT') {
      return this._explainGreat(payload, moveInfo, san);
    }

    // Checkmate gets its own treatment — no mechanical templates or puns.
    if (san.endsWith('#')) {
      return this._explainCheckmate(payload, moveInfo, san);
    }

    const insight = this._pickMoveInsight(payload, moveInfo);
    const enriched = insight || this._positionalFallback(payload, moveInfo);
    const isInForcedMateBefore = payload.playerEdgeBefore <= -9000;
    const gainClause = this._gainClause(payload);

    if (key === 'BOOK') {
      const openingName = payload.openingName || '';
      return openingName
        ? `${san} is standard theory in the ${openingName} — a well-trodden move that has stood the test of time.`
        : `${san} is a standard book move that follows well-established opening principles.`;
    }

    if (key === 'BEST') {
      if (isInForcedMateBefore) {
        return `${san} is the most resilient defense — it delays the forced mate as long as possible in a difficult position.`;
      }
      if (enriched) {
        return this._composeBestMove(san, enriched, payload, moveInfo);
      }
      return this._composeGoodLead(san, 'the engine\'s top choice and the strongest continuation here', gainClause);
    }

    if (key === 'EXCELLENT') {
      const reason = enriched
        ? `${this._cleanInsight(enriched)}, nearly as strong as the engine's first choice`
        : 'keeps pace with the best continuation';
      return this._composeGoodLead(san, `an excellent move — ${reason}`, gainClause);
    }

    if (key === 'GOOD') {
      const precise = payload.bestMoveSan
        && !this.analyzer._sameMoveSan(payload.bestMoveSan, san);
      if (precise) {
        const reason = enriched
          ? this._cleanInsight(enriched)
          : '';
        return reason
          ? `${san} is a reasonable move, though ${payload.bestMoveSan} was marginally more precise — ${reason}.`
          : `${san} is a reasonable move, though ${payload.bestMoveSan} was slightly stronger here.`;
      }
      const reason = enriched ? this._cleanInsight(enriched) : '';
      return reason
        ? `${san} is a solid choice that maintains a good position — ${reason}.`
        : `${san} is a solid move that maintains the balance of the position.`;
    }

    return enriched
      ? `${san} is a useful move here — ${this._cleanInsight(enriched)}`
      : `${san} is a reasonable move that keeps the game on track.`;
  }

  // Compose a good-move sentence from its assessment clause and an optional eval-
  // gain clause, folding the gain into the same sentence so it reads as prose
  // rather than a status readout: "Nf3 is an excellent move — it bears on the
  // center, and the evaluation climbs from +0.3 to +1.2."
  _composeGoodLead(san, assessment, gainClause) {
    if (gainClause) {
      return `${san} is ${assessment}, and ${gainClause}.`;
    }
    return `${san} is ${assessment}.`;
  }

  // Short clause describing a favorable eval gain for a good move, e.g.
  // "it nudges the evaluation from +0.4 to +0.9". Returns '' for non-meaningful
  // swings (including mate positions) so good-move prose stays concrete.
  _gainClause(payload) {
    const before = payload.playerEdgeBefore;
    const after = payload.playerEdgeAfter;
    if (typeof before !== 'number' || typeof after !== 'number') return '';
    if (Math.abs(before) >= 9900 || Math.abs(after) >= 9900) return '';
    const gain = after - before;
    if (gain < 60) return '';
    const fmt = (cp) => {
      const pawns = cp / 100;
      return (pawns >= 0 ? '+' : '') + pawns.toFixed(1);
    };
    const verb = gain >= 250 ? 'jumps' : gain >= 120 ? 'climbs' : 'nudges';
    return `the evaluation ${verb} from ${fmt(before)} to ${fmt(after)}`;
  }

  // Natural-language checkmate explanation — no templates, no puns.
  _explainCheckmate(payload, moveInfo, san) {
    const piece = moveInfo.piece ? this.pieceNames[moveInfo.piece] || 'piece' : 'piece';
    const to = moveInfo.to || '';
    const colorName = moveInfo.color === 'w' ? 'White' : 'Black';

    // Check if it's a capture mate
    if (moveInfo.captured) {
      const captured = this.pieceNames[moveInfo.captured] || 'piece';
      return `${san} is checkmate. By capturing the ${captured} on ${to}, ${colorName} delivers a mating blow — the enemy king has no escape.`;
    }

    // Check if it's a sacrifice mate (piece was not captured before)
    const sacResult = this.analyzer.checkSacrifice(new Chess(payload.fenBefore), san);
    if (sacResult.isPieceSacrifice) {
      return `${san} is checkmate — a powerful sacrifice on ${to} leaves the king completely paralyzed with no legal response.`;
    }

    // Standard checkmate
    return `${san} is checkmate. ${colorName} delivers the finishing blow on ${to}, and the king has nowhere to run.`;
  }

  // Compose a natural BEST move explanation: the assessment, the tactical or
  // positional reason, and — when the move meaningfully improved the position —
  // the eval shift. Folded into one flowing paragraph rather than a bare clause.
  _composeBestMove(san, insight, payload, moveInfo) {
    const gainClause = this._gainClause(payload);
    const reason = this._cleanInsight(insight);
    if (gainClause) {
      return `${san} is the engine's top choice — ${reason}, and ${gainClause}.`;
    }
    return `${san} is the engine's top choice — ${reason}.`;
  }

  _explainGreat(payload, move, san) {
    const insight = this._pickMoveInsight(payload, move) || this._positionalFallback(payload, move);
    const direction = payload.playerEdgeBefore <= -300
      ? 'pulls the position back from the brink and dramatically shifts the momentum'
      : payload.playerEdgeBefore >= 300
        ? 'turns an already favorable position into a crushing one'
        : 'swings what was a balanced game firmly in your favor';
    return insight
      ? `${san} is a great move that ${direction}. ${this._capitalize(insight)}`
      : `${san} is a great move that ${direction}.`;
  }

  _explainBrilliant(payload, moveInfo, san) {
    const drawResource = this.analyzer._acceptedOfferDrawResource(payload.fenBefore, payload.moveSan);
    if (drawResource) {
      return `${san} is brilliant — it offers material, but if the opponent captures, the resulting position leads to a forced draw.`;
    }

    const mateTrap = this.analyzer._mateTrapSacrifice(payload.fenBefore, payload.moveSan);
    if (mateTrap) {
      const bait = mateTrap.captureSan || 'the piece';
      const finish = mateTrap.mateSan ? `, checkmate follows with ${mateTrap.mateSan}` : ', checkmate follows';
      return `${san} is a brilliant trap — if the opponent takes the bait with ${bait}${finish}.`;
    }

    const offer = this.analyzer._materialOfferAfterMove(payload.fenBefore, payload.moveSan);
    if (offer) {
      const offered = this.pieceNames[offer.captured] || 'piece';
      return `${san} is a brilliant sacrifice — the ${offered} is offered as bait to fuel a decisive attack that the opponent will struggle to defend.`;
    }

    const insight = this._pickMoveInsight(payload, moveInfo);
    return insight
      ? `${san} is a brilliant move — one of those sharp, hard-to-find ideas that can easily be missed at the board. ${this._capitalize(insight)}`
      : `${san} is a brilliant find — a deep and creative idea that most players would overlook, even with time to think.`;
  }

  _pickMoveInsight(payload, move) {
    const tactical = this._tacticLessonsForMove(payload, move)
      .map((lesson) => this._simplifyLesson(lesson))
      .filter(Boolean);
    if (tactical.length > 0) return tactical[0];

    const tacticalStatements = this._tacticalStatements(payload, move)
      .map((lesson) => this._simplifyLesson(lesson))
      .filter(Boolean);
    if (tacticalStatements.length > 0) return tacticalStatements[0];

    const strategic = this._strategicStatements(payload, move)
      .map((lesson) => this._simplifyLesson(lesson))
      .filter(Boolean);
    return strategic[0] || '';
  }

  // Positional/move-descriptor description used when tactical and strategic
  // detectors are silent, so every move still gets a substantive explanation.
  _positionalFallback(payload, move) {
    if (!move) return '';
    const san = move.san || payload.moveSan || '';
    const piece = this.pieceNames[move.piece] || 'piece';

    if (san.endsWith('#')) return 'it delivers checkmate, ending the game on the spot.';
    if (san.endsWith('+')) return 'it forces a reply with check, keeping the opponent on the defensive.';

    if (move.flags?.includes('k') || move.flags?.includes('q')) {
      const side = move.flags?.includes('k') ? 'kingside' : 'queenside';
      return `it castles ${side}, tucking the king to safety and bringing a rook toward the center.`;
    }

    if (move.captured) {
      return `it captures the ${this.pieceNames[move.captured] || 'piece'} on ${move.to}, reducing the opponent's material.`;
    }

    if (move.piece && this.center.has(move.to)) {
      return `the ${piece} takes up a strong central position, increasing its influence over the board.`;
    }
    if (move.piece && this.extendedCenter.has(move.to)) {
      return `the ${piece} supports central influence from ${move.to}.`;
    }

    if (move.piece === 'p') {
      const ply = payload.movePly || 0;
      if (ply <= 6) return 'this pawn move shapes the pawn structure and fights for the center.';
      return 'this pawn move adjusts the structure and asserts control over key squares.';
    }

    if (move.piece === 'n') {
      const edge = /^[ah]/.test(move.to);
      return edge
        ? `the knight moves to ${move.to} on the edge of the board, where it typically has less influence.`
        : `the knight moves to ${move.to}, improving its activity and expanding its scope.`;
    }

    if (move.piece === 'b') {
      return `the bishop moves to ${move.to}, controlling important diagonals across the board.`;
    }

    if (move.piece === 'r') {
      return `the rook moves to ${move.to}, improving its position and contesting open files and ranks.`;
    }

    if (move.piece === 'q') {
      return `the queen takes up an active position on ${move.to}, adding significant pressure to the position.`;
    }

    if (move.piece === 'k') {
      return `the king moves to ${move.to}, improving its safety.`;
    }

    return `it has improved the ${piece}'s placement on ${move.to}.`;
  }

  _playedMoveNote(payload, move) {
    const san = move.san || payload.moveSan || '';
    if (san.endsWith('#')) return 'it delivers checkmate';
    if (san.endsWith('+')) return 'it gives check without a real follow-up';
    if (move.captured) {
      return `it captures the ${this.pieceNames[move.captured] || 'piece'} on ${move.to}`;
    }

    const tactic = this._tacticLessonsForMove(payload, move)[0];
    if (tactic) return this._simplifyLesson(tactic);

    if (move.piece && move.piece !== 'p' && this._isBackRank(move.from, move.color) && !this._isBackRank(move.to, move.color)) {
      return `it develops the ${this.pieceNames[move.piece] || 'piece'}`;
    }

    return '';
  }

  _severityClause(cpLoss, expectedLoss, key) {
    if (key === 'INACCURACY' && (cpLoss || 0) < 40) return '';
    if ((cpLoss || 0) >= 300 || key === 'BLUNDER') {
      return 'the evaluation collapses';
    }
    if ((cpLoss || 0) >= 120) {
      return 'the position gets much worse';
    }
    if (typeof expectedLoss === 'number' && expectedLoss >= 0.2) {
      return 'your winning chances drop sharply';
    }
    if ((cpLoss || 0) >= 50) {
      return 'it weakens the position';
    }
    return '';
  }

  _simplifyLesson(text) {
    if (!text) return '';
    return text
      .replace(/^This move /i, 'it ')
      .replace(/^This is /i, 'it is ')
      .replace(/^Tactical theme: /i, '')
      .replace(/^It /, 'it ')
      .trim();
  }

  _capitalize(text) {
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // Lowercase a leading capital so a clause splices cleanly mid-sentence
  // ("...top choice — the knight bears on the center"). Leaves proper nouns
  // like "White"/"Black" untouched only if they're not at the very start.
  _lowerFirst(text) {
    if (!text) return '';
    return text.charAt(0).toLowerCase() + text.slice(1);
  }

  // Prepare an insight/lesson fragment for splicing mid-sentence: lowercase the
  // leading capital and strip a trailing period (the detectors emit full
  // sentences like "The knight bears on the center."; we add our own
  // punctuation). Color words ("White"/"Black") keep their capital.
  _cleanInsight(text) {
    const cleaned = String(text || '').replace(/[.!?]+$/, '').trim();
    if (/^(White|Black)\b/.test(cleaned)) return cleaned;
    return this._lowerFirst(cleaned);
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
    const centerAttacks = attacks.filter((sq) => this.center.has(sq));
    // Only claim central control when the piece genuinely bears on the center:
    // it must attack at least two central squares, or attack a central square
    // that is occupied by an enemy piece (real pressure, not an empty far square).
    const centerEnemy = centerAttacks.find((sq) => {
      const p = this._pieceAt(payload.fenAfter, sq);
      return p && p.color !== move.color;
    });
    if (centerAttacks.length >= 2 || centerEnemy) {
      statements.push(`The ${piece} bears on the center.`);
    }

    if (move.piece === 'p' && this._opensHomeDiagonal(payload.fenBefore, move)) {
      statements.push('This pawn move opens a diagonal for a bishop or queen.');
    }

    return statements;
  }

  _tacticalStatements(payload, move) {
    const statements = [];
    const piece = this.pieceNames[move.piece] || 'piece';
    const tacticLessons = this._tacticLessonsForMove(payload, move);
    statements.push(...tacticLessons);

    if (move.captured) {
      statements.push(`It captures a ${this.pieceNames[move.captured] || 'piece'} on ${move.to}.`);
    }
    if (/[+#]$/.test(move.san || '')) {
      statements.push((move.san || '').endsWith('#') ? 'It finishes with checkmate.' : 'It gives check and forces a reply.');
    }

    // Collect squares already covered by a named tactic (fork/pin/skewer/etc.)
    // so we don't also report generic "pressure" on the same unit.
    const tacticSquares = new Set(
      tacticLessons
        .map((lesson) => {
          const match = lesson.match(/on ([a-h][1-8])/);
          return match ? match[1] : null;
        })
        .filter(Boolean)
    );

    const attacks = this._attacksFrom(payload.fenAfter, move.to, move.color, move.piece);
    const pressured = attacks
      .map((square) => ({ square, piece: this._pieceAt(payload.fenAfter, square) }))
      .filter((entry) => entry.piece && entry.piece.color !== move.color && entry.piece.type !== 'k')
      .filter((entry) => !tacticSquares.has(entry.square))
      // Real pressure: the target is at least as valuable as the attacker, or it
      // is genuinely loose (undefended). A defended pawn harassed by a bishop
      // is not "pressure."
      .filter((entry) => this.pieceValues[entry.piece.type] >= this.pieceValues[move.piece] || !this._isDefended(payload.fenAfter, entry.square, entry.piece.color));

    if (pressured.length > 0 && !move.captured) {
      const target = pressured[0];
      statements.push(`The ${piece} eyes the ${this.pieceNames[target.piece.type]} on ${target.square}.`);
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
      return `${prefix} creates a fork — it delivers check while simultaneously attacking the ${this.pieceNames[target.piece.type]} on ${target.square}.`;
    }

    if (targets.length >= 2) {
      const first = targets[0];
      const second = targets[1];
      return `${prefix} creates a fork — the ${this.pieceNames[type] || 'piece'} attacks both the ${this.pieceNames[first.piece.type]} on ${first.square} and the ${this.pieceNames[second.piece.type]} on ${second.square}.`;
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
            return `${prefix} creates a pin — the ${frontName} on ${front.square} is pinned to the king on ${targetSquare}, and cannot move without exposing the king.`;
          }

          if (backValue > frontValue && backValue >= 5) {
            return `${prefix} creates a relative pin — moving the ${frontName} on ${front.square} would expose the more valuable ${backName} on ${targetSquare}.`;
          }

          if ((front.piece.type === 'k' || frontValue > backValue) && frontValue >= 5) {
            if (front.piece.type === 'k') {
              return `${prefix} creates a skewer — the king on ${front.square} must move, exposing the ${backName} on ${targetSquare} to capture.`;
            }
            return `${prefix} creates a skewer — once the ${frontName} on ${front.square} is forced to move, the ${backName} on ${targetSquare} will be vulnerable.`;
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
          return `This is a discovered attack — moving the ${this.pieceNames[move.piece] || 'piece'} has revealed the ${this.pieceNames[piece.type]} on ${from}, which now threatens the ${this.pieceNames[target.piece.type]} on ${target.square}.`;
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
    return `removing the defender — by taking the ${this.pieceNames[capturedDefender.type] || 'piece'}, the ${this.pieceNames[target.piece.type]} on ${target.square} is left without protection and can be picked off next.`;
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
    return "creating back-rank pressure — the opponent's king is confined to the back rank with no flight square, making it highly vulnerable to a rook or queen check along the back rank.";
  }

  _loosePieceLesson(fen, square, color, type) {
    const target = this._attackedEnemyPieces(fen, square, color, type)
      .filter((entry) => entry.piece.type !== 'k' && (this.pieceValues[entry.piece.type] || 0) >= 3)
      .find((entry) => !this._isDefended(fen, entry.square, entry.piece.color));
    if (!target) return '';
    return `the opponent's ${this.pieceNames[target.piece.type]} on ${target.square} is left undefended, and this move puts immediate pressure on it.`;
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
		      return `${reply.san} is checkmate`;
		    }

    const boardThreat = this.analyzer._mateThreat(payload.fenAfter);
    if (boardThreat && this.analyzer._sameMoveSan(boardThreat.moveSan, reply.san)) {
      return this._formatMateThreat(boardThreat);
    }

    const mateSequel = this._mateAfterReply(payload.fenAfter, replyMove);
    if (mateSequel) return mateSequel;

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
      threats.push(`attacks your queen on ${queenTarget.square}`);
    } else if (highValueTarget && (this.pieceValues[highValueTarget.piece.type] || 0) >= 3) {
      threats.push(`attacks your ${this.pieceNames[highValueTarget.piece.type]} on ${highValueTarget.square}`);
    } else if (reply.captured) {
      threats.push(`wins your ${this.pieceNames[reply.captured] || 'piece'} on ${reply.to}`);
    }

		    if (check && highValueTarget && reply.piece === 'q') {
		      return `${reply.san} forks your king and ${this.pieceNames[highValueTarget.piece.type]} on ${highValueTarget.square}`;
		    }

		    if (check && highValueTarget) {
		      return `${reply.san} forks your king and ${this.pieceNames[highValueTarget.piece.type]} on ${highValueTarget.square}`;
		    }

    const replyLineTactic = this._lineTacticLesson(replyFen, reply.to, reply.color, reply.piece, reply.san);
    if (replyLineTactic) return this._simplifyLesson(replyLineTactic.replace(/^The reply /, ''));

		    if (threats.length > 0) {
		      return `${reply.san} ${threats.join(' and ')}`;
		    }

    const playerGaveCheck = /\+$/.test(payload.moveSan || '') && !/#$/.test(payload.moveSan || '');
    if (playerGaveCheck && reply.piece === 'k') {
      const colorName = reply.color === 'w' ? 'White' : 'Black';
      return `${colorName} sidesteps the check with ${reply.san}`;
    }

    return '';
  }

  _replyTradeContext(payload, reply) {
    if (!reply?.captured || !payload?.fenBefore) return '';
    if (this.analyzer._mateThreat(payload.fenAfter)) return '';

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

    const afterTrade = new Chess(payload.fenAfter);
    const recap = afterTrade.move(reply.san);
    if (recap) {
      const mateNext = this.analyzer._immediateMateMove(afterTrade.fen());
      if (mateNext) return '';
      const threat = this.analyzer._mateThreat(afterTrade.fen());
      if (threat) return '';
    }

    const capturedValue = this.pieceValues[playerMove.captured] || 0;
    const recapturedValue = this.pieceValues[reply.captured] || 0;
    const won = this.pieceNames[playerMove.captured] || 'piece';
    const lost = this.pieceNames[reply.captured] || 'piece';

    if (capturedValue >= recapturedValue) {
      return `${reply.san} trades your ${lost} for their ${won}, but the resulting position is still worse`;
    }

    return `${reply.san} recaptures and you lose material in the exchange`;
  }

  _isBackRank(square, color) {
    return !!square && square[1] === (color === 'w' ? '1' : '8');
  }

  _pieceAt(fen, square) {
    // Use cached board map to avoid creating new Chess instance
    const board = this._boardMap(fen);
    return board[square] || null;
  }

	  _isDefended(fen, square, color) {
	    const board = this._boardMap(fen);
	    // Check every same-color piece to see if it guards the target square.
	    // Note: _attacksFrom() excludes same-color occupied squares (it only
	    // reports enemy targets), so it CANNOT be used to detect defenders.
	    // Instead we use chess.js move generation: a piece defends a square
	    // if it could legally move there (pseudo-legal is sufficient for
	    // non-king pieces).
	    for (const [from, piece] of Object.entries(board)) {
	      if (piece.color !== color || from === square) continue;
	      if (this._guardsSquare(fen, from, piece, square, color)) return true;
	    }
	    return false;
	  }

  _guardsSquare(fen, from, piece, targetSq, color) {
    // Determine if a piece on `from` of `type/color` can move/attack `targetSq`,
    // INCLUDING squares occupied by same-color pieces (for defense detection).
    const file = from.charCodeAt(0) - 97;
    const rank = parseInt(from[1], 10) - 1;
    const tf = targetSq.charCodeAt(0) - 97;
    const tr = parseInt(targetSq[1], 10) - 1;
    const df = tf - file;
    const dr = tr - rank;

    if (piece.type === 'p') {
      const dir = color === 'w' ? 1 : -1;
      return Math.abs(df) === 1 && dr === dir;
    }
    if (piece.type === 'n') {
      const adf = Math.abs(df), adr = Math.abs(dr);
      return (adf === 1 && adr === 2) || (adf === 2 && adr === 1);
    }
    if (piece.type === 'k') {
      return Math.abs(df) <= 1 && Math.abs(dr) <= 1 && (df !== 0 || dr !== 0);
    }
    // Sliding pieces: bishop, rook, queen
    const isDiag = Math.abs(df) === Math.abs(dr) && df !== 0;
    const isStraight = (df === 0 || dr === 0) && (df !== 0 || dr !== 0);
    if (piece.type === 'b' && !isDiag) return false;
    if (piece.type === 'r' && !isStraight) return false;
    if (piece.type === 'q' && !isDiag && !isStraight) return false;
    // Check path is clear (target square can be own piece for defense purposes)
    const sf = Math.sign(df), sr = Math.sign(dr);
    const board = this._boardMap(fen);
    for (let f = file + sf, r = rank + sr; f !== tf || r !== tr; f += sf, r += sr) {
      if (board[String.fromCharCode(97 + f) + (r + 1)]) return false;
    }
    return true;
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
    this.analysisDepth = 18;
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

  normalizeScore(score, scoreType, _isWhiteToMove) {
    // Stockfish reports `score cp`/`score mate` from the perspective of the
    // side to move (verified empirically against the installed Stockfish 18
    // build). scoreToCp normalizes mate scores; the caller converts the
    // side-relative value to White-absolute via whiteAbsCp() using the FEN.
    return this.scoreToCp(score, scoreType);
  }

  // Convert a side-to-move-relative centipawn score (as reported by Stockfish
  // for the position `fen`) to a White-absolute score. Positive = good for
  // White. Result-level evals (evalBefore/evalAfter) and the eval bar/graph
  // all consume White-absolute values.
  whiteAbsCp(sideRelCp, fen) {
    return fen.split(' ')[1] === 'b' ? -sideRelCp : sideRelCp;
  }

  formatScore(cpScore) {
    if (cpScore >= 9900) {
      const mateMoves = Math.ceil((10000 - cpScore) / 10);
      return mateMoves <= 0 ? '#' : `M${mateMoves}`;
    }
    if (cpScore <= -9900) {
      const mateMoves = Math.ceil((10000 + cpScore) / 10);
      return mateMoves <= 0 ? '#' : `-M${mateMoves}`;
    }
    const pawns = cpScore / 100;
    return (pawns >= 0 ? '+' : '') + pawns.toFixed(1);
  }

  // Format an EVAL SWING (a delta between two scores). Deltas of two mate
  // scores can be ~±20000, which formatScore() would mis-render as a bogus
  // negative mate count ("-M-20"). Clamp the delta to the normal cp band so a
  // swing always reads as a sensible pawn/cp value, and flag decisive swings.
  formatSwing(cpDelta) {
    const d = Number(cpDelta) || 0;
    const clamped = Math.max(-2000, Math.min(2000, d));
    const pawns = clamped / 100;
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

  // Variant for White-absolute scores: the best move is the one with the
  // highest White-absolute eval from the mover's perspective, so the gap is
  // always (mover's best) - (mover's second). Convert to mover-perspective
  // via isWhitePlaying here so callers can pass white-absolute line evals.
  _gapToSecondWhite(firstWhiteAbs, secondWhiteAbs, isWhitePlaying) {
    if (secondWhiteAbs === null || typeof secondWhiteAbs === 'undefined') return Infinity;
    const a = isWhitePlaying ? firstWhiteAbs : -firstWhiteAbs;
    const b = isWhitePlaying ? secondWhiteAbs : -secondWhiteAbs;
    return Math.max(0, a - b);
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

  _bestMoveReason(fen, bestMoveUci) {
    if (!fen || !bestMoveUci || bestMoveUci.length < 4) return '';

    const chess = new Chess(fen);
    const move = chess.move({
      from: bestMoveUci.substring(0, 2),
      to: bestMoveUci.substring(2, 4),
      promotion: bestMoveUci.length > 4 ? bestMoveUci[4] : undefined,
    });

    if (!move) return '';

    if (/#$/.test(move.san)) return 'delivers checkmate';
    if (move.captured) return `wins the ${this._pieceName(move.captured)} on ${move.to}`;
    if (move.promotion) return 'promotes the pawn';
    if (/\+$/.test(move.san)) return 'keeps the initiative with a check';
    return 'improves the position';
  }

  _describeBestMove(fen, bestMoveUci, bestMoveSan) {
    const reason = this._bestMoveReason(fen, bestMoveUci);
    if (!reason) return bestMoveSan || '';

    const chess = new Chess(fen);
    const move = chess.move({
      from: bestMoveUci.substring(0, 2),
      to: bestMoveUci.substring(2, 4),
      promotion: bestMoveUci.length > 4 ? bestMoveUci[4] : undefined,
    });
    const san = move?.san || bestMoveSan || '';

    if (reason === 'improves the position') return `play ${san}`;
    return `${reason} with ${san}`;
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

    const kingMoves = legalMoves.filter((move) => move.piece === 'k');
    if (kingMoves.length > 1) return '';

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

  // Material balance from the side-to-move's perspective, in pawn units.
  // Positive = the player to move is up material; negative = down material.
  // Unlike the engine eval (which already prices in compensation), this is a
  // raw board count — used to tell "down material but winning attack" (Opera
  // Game 13.Rxd7, where White is a point down yet has a mating combination
  // scored +5) apart from "already up material and coasting", so a genuine
  // combinative sacrifice can still be Brilliant even when the eval is high.
  _playerMaterialEdge(fen) {
    if (!fen) return 0;
    const chess = new Chess(fen);
    const board = chess.board();
    const value = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    const sideToMove = fen.split(' ')[1] === 'b' ? 'b' : 'w';
    let edge = 0;
    for (const row of board) {
      for (const piece of row) {
        if (!piece) continue;
        const v = value[piece.type] || 0;
        edge += piece.color === sideToMove ? v : -v;
      }
    }
    return edge;
  }

  classifyMove(moveData) {
    const {
      movePly,
      moveSan,
      fenBefore,
      numLegalMoves,
      isCheckmate,
      isPieceSacrifice,
      playerEdgeBefore,
      playerEdgeAfter,
      cpLoss,
      isBestMove,
      gapToSecond,
      opponentJustBlundered,
    } = moveData;

    // Fixed thresholds, same for all ratings/time controls. cpLoss is in
    // centipawns from the player's perspective (0 = top move, larger = worse).
    const INACCURACY_CP = 50;
    const MISTAKE_CP = 100;
    const BLUNDER_CP = 300;
    const MATE_EDGE = -9000;            // "being mated" evaluation band
    const wasBeingMated = playerEdgeBefore <= MATE_EDGE;
    const opponentMateAfter = this._opponentImmediateMateAfter(fenBefore, moveSan);
    const losesMaterialOrGame = !!opponentMateAfter
      || playerEdgeAfter <= MATE_EDGE
      || this._opponentMaterialTacticAfter(fenBefore, moveSan);

    // BRILLIANT — the best move that is also a genuine piece sacrifice
    // (hard to find). Not a routine capture trade, not from an already-won
    // position, and the sac doesn't just throw the eval away. Checkmate
    // delivered by a piece sacrifice is also Brilliant.
    if (isCheckmate && isPieceSacrifice) return MoveClassification.BRILLIANT;

    // "Not already easily winning" gate. The player must not already be
    // comfortably ahead by engine eval (playerEdgeBefore < NOT_WINNING_CP),
    // UNLESS they are down material on the board — that's the Opera Game
    // case: White is a point of material down yet has a mating combination the
    // engine scores at +5. A human eye sees "not winning" (behind on
    // material), so a sacrifice there is still Brilliant even though the eval
    // is high. Forced-mate-for-the-player evals (>= MATE_WIN_EDGE) also pass.
    const isWinningMateBefore = playerEdgeBefore >= 9000;
    const playerMaterialDown = this._playerMaterialEdge(fenBefore) < 0;
    const notAlreadyWinning = isWinningMateBefore
      || playerEdgeBefore < 300
      || (playerMaterialDown && playerEdgeBefore < 900);
    // A genuine sacrifice must lead somewhere good: forced mate, or an eval
    // that's clearly winning after the move (so a mere salvage of an already
    // hanging piece in a lost position can't qualify).
    const sacLeadsToWin = isWinningMateBefore || playerEdgeAfter >= 150;
    if (isBestMove
      && isPieceSacrifice
      && !wasBeingMated
      && !opponentMateAfter
      && notAlreadyWinning
      && sacLeadsToWin
      && playerEdgeAfter >= playerEdgeBefore - 60) {
      return MoveClassification.BRILLIANT;
    }

    // BOOK — a conventional opening move (no real cost). Evaluated before
    // the error classes so the opening is never penalized for search noise.
    if (movePly <= this.bookPly && cpLoss <= 10 && !opponentJustBlundered) {
      return MoveClassification.BOOK;
    }

    // BEST — the engine's actual top choice, a forced/only legal move, or a
    // delivering checkmate. A best move is never an error, even if the
    // after-position eval drifted on a depth mismatch. Before settling on
    // BEST, check whether a best move deserves the GREAT upgrade (it uniquely
    // swung the game outcome).
    const isBestOrForced = isCheckmate || numLegalMoves === 1 || isBestMove || cpLoss === 0;
    if (isBestOrForced) {
      const beforeExpected = this.expectedPoints(playerEdgeBefore);
      const afterExpected = this.expectedPoints(playerEdgeAfter);
      // GREAT — the best move was clearly the only good move (large gap to the
      // second line) AND it changed the game outcome: equal→winning, or a
      // rescue from a worse spot. Strict and rare.
      const drawingToWinning = beforeExpected >= 0.45 && beforeExpected <= 0.65 && afterExpected >= 0.72;
      const rescue = beforeExpected <= 0.40 && afterExpected >= 0.55;
      if (isBestMove
        && gapToSecond >= 120
        && (drawingToWinning || rescue)) {
        return MoveClassification.GREAT;
      }
      return MoveClassification.BEST;
    }

    // MISS — a (non-best) move that let a tactical chance to punish slip
    // away: the opponent had just blundered and the player failed to take the
    // winning/equalizing line.
    if (opponentJustBlundered && playerEdgeBefore >= 150 && cpLoss >= 60) {
      return MoveClassification.MISS;
    }

    // Fixed cpLoss ladder — BLUNDER / MISTAKE / INACCURACY. A move can't be a
    // Blunder for "losing the game" if the position was already lost.
    const blunderForMaterialOrGame = losesMaterialOrGame && cpLoss >= 200;
    if (cpLoss >= BLUNDER_CP || blunderForMaterialOrGame) {
      return wasBeingMated ? MoveClassification.MISTAKE : MoveClassification.BLUNDER;
    }
    if (cpLoss >= MISTAKE_CP) {
      return MoveClassification.MISTAKE;
    }
    if (cpLoss >= INACCURACY_CP) {
      return MoveClassification.INACCURACY;
    }

    // Remaining small-loss, non-best moves: EXCELLENT (near-best) or GOOD
    // (decent but clearly not best).
    if (cpLoss <= 30) return MoveClassification.EXCELLENT;
    return MoveClassification.GOOD;
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
    const movedVal = pieceValue[moveObj.piece] || 0;
    const capturedVal = moveObj.captured ? (pieceValue[moveObj.captured] || 0) : 0;

    // A piece sacrifice (per the user's rule): a piece worth >= 3 takes less
    // than its own value AND is left hanging on that square to an enemy piece
    // of strictly LOWER value ("allow it to be taken" — e.g. a rook the enemy
    // knight/pawn can grab, a knight a pawn can grab).
    //   movedVal > capturedVal  -> excludes EQUAL trades (3-for-3, 5-for-5) and
    //                              captures where you took the bigger piece, so
    //                              routine even trades are never a sacrifice.
    //   attackerVal < movedVal  -> the moved piece is genuinely hanging to a
    //                              weaker attacker, not merely recapturable.
    // We deliberately do NOT check whether you can recapture back: that
    // recapture (or the mate/compensation that follows) is vouched for by the
    // eval gates in classifyMove. The old code bailed out whenever a recapture
    // was available, which wrongly suppressed genuine combinative sacrifices
    // like 13.Rxd7 (rook takes knight, recapturable by a knight).
    let isPieceSacrifice = false;
    if (movedVal >= 3 && movedVal > capturedVal) {
      const enemyCaptures = chess.moves({ verbose: true })
        .filter((m) => m.to === moveObj.to && m.captured === moveObj.piece);
      for (const cap of enemyCaptures) {
        if ((pieceValue[cap.piece] || 0) < movedVal) { isPieceSacrifice = true; break; }
      }
    }

    chess.undo();
    return { isSacrifice: isPieceSacrifice, isPieceSacrifice };
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
	    if (legal.length > 40) return null;
	    const start = Date.now();
	    const attackingMoves = legal
	      .filter((move) => /[+#]/.test(move.san || '') || move.captured || move.promotion)
	      .sort((a, b) => {
	        const aCheck = /\+/.test(a.san || '') ? 1 : 0;
	        const bCheck = /\+/.test(b.san || '') ? 1 : 0;
	        if (bCheck !== aCheck) return bCheck - aCheck;
	        return (b.captured ? 1 : 0) - (a.captured ? 1 : 0);
	      })
	      .slice(0, 18);
	    for (const attack of attackingMoves) {
	      if (Date.now() - start > 16) return null;
	      const playedAttack = board.move(attack.san);
	      if (!playedAttack) continue;
	      const replies = board.moves({ verbose: true }).slice(0, 28);
	      let forced = replies.length > 0;
	      for (const reply of replies.slice(0, 56)) {
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

  _coachingText(payload) {
    const coachText = this.coach?.explain(payload);
    if (coachText) return coachText;

    const key = this.getClassificationKey(payload.classification);
    const san = payload.moveSan || 'This move';
    return `${san} is classified as ${MoveClassification[key]?.name?.toLowerCase() || 'worth reviewing'}.`;
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
    this._consecutiveEmptyEvals = 0;
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
      // Circuit breaker: if the engine is wedged (every position returns an
      // empty best move), abort instead of producing a full game of 0-eval
      // "BEST" moves that reads as a fake 100%-accuracy review. After a few
      // consecutive empty results, throw so the caller surfaces a real error.
      if (!best || !best.move) {
        this._consecutiveEmptyEvals = (this._consecutiveEmptyEvals || 0) + 1;
        if (this._consecutiveEmptyEvals >= 3) {
          throw new Error('Stockfish stopped returning moves. The review was aborted — try again, or switch engine in Settings.');
        }
      } else {
        this._consecutiveEmptyEvals = 0;
      }
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

    return evals;
  }

  // Build the eval object for a single position against a single engine.
  // Shared by the serial and pooled paths so they produce identical results.
  async _evaluateOnePosition(fen, engine) {
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
    // Circuit breaker (pooled path): abort if the engine keeps returning empty
    // moves, so a wedged engine can't yield a fake 100%-accuracy review.
    if (!best || !best.move) {
      this._consecutiveEmptyEvals = (this._consecutiveEmptyEvals || 0) + 1;
      if (this._consecutiveEmptyEvals >= 3) {
        throw new Error('Stockfish stopped returning moves. The review was aborted — try again, or switch engine in Settings.');
      }
    } else {
      this._consecutiveEmptyEvals = 0;
    }
    return {
      cp: best ? best.cp : 0,
      bestMove: best ? best.move : '',
      pv: best ? best.pvUci : '',
      pvSan: best ? best.pvSan : '',
      depth: best ? best.depth : 0,
      lines,
    };
  }

  // Evaluate positions concurrently across a pool of engines. Results are
  // returned in position order. Each engine handles one search at a time
  // (it serializes internally via _runExclusive), so with N engines up to N
  // positions are analyzed in parallel. `onProgress(completed, total)` fires
  // by completed count (not index) since completion order is nondeterministic.
  async evaluatePositionsPooled(positions, engines, onProgress, options = {}) {
    const pool = (engines && engines.length ? engines : [engines]).filter(Boolean);
    const total = options.totalPositions || positions.length;
    const offset = options.offset || 0;
    const cache = new Map();
    const results = new Array(positions.length);

    // Reset every engine once so each starts from a clean transposition table.
    if (options.newGame !== false) {
      await Promise.all(pool.map((engine) => engine.newGame()));
    }

    let completed = 0;
    let nextIndex = 0;
    const cacheKeyFor = (fen) => `${fen}|${this.analysisDepth}|${this.multiPvCount}|${this.fallbackTimeoutMs}`;

    const worker = async (engine) => {
      while (true) {
        const i = nextIndex;
        nextIndex += 1;
        if (i >= positions.length) return;

        const fen = positions[i];
        const key = cacheKeyFor(fen);
        let result;
        if (cache.has(key)) {
          result = cache.get(key);
        } else {
          result = await this._evaluateOnePosition(fen, engine);
          cache.set(key, result);
        }
        results[i] = result;
        completed += 1;
        if (onProgress) onProgress(completed, total);
      }
    };

    // Launch one worker per engine; they pull from the shared index counter.
    await Promise.all(pool.map((engine) => worker(engine)));
    return results;
  }

  async analyzeGame(moves, engine, onProgress, options = {}) {
    const positions = this._positionsForMoves(moves, options.initialFen);
    let evals;
    // When the caller supplies an engine pool (server), analyze positions
    // concurrently. The pooled onProgress fires (completed, total); adapt it
    // to the (index, total, message) shape the serial path uses.
    if (Array.isArray(options.engines) && options.engines.length) {
      const pooledProgress = onProgress
        ? (completed, total) => onProgress(Math.min(completed, total) - 1, total, `Analyzing ${completed}/${total}`)
        : null;
      evals = await this.evaluatePositionsPooled(positions, options.engines, pooledProgress, {
        totalPositions: positions.length,
        newGame: options.newGame,
      });
    } else {
      evals = await this.evaluatePositions(positions, engine, onProgress, {
        ...options,
        totalPositions: positions.length,
      });
    }
    const results = [];
    const opening = this.detectOpening(moves);
    const positionChess = options.initialFen ? new Chess(options.initialFen) : new Chess();

    for (let i = 0; i < moves.length; i++) {
      const fen = positions[i];
      const fenAfter = positions[i + 1];
      const movePly = i + 1;
      const moveNumber = Math.floor(i / 2) + 1;
      const isWhitePlaying = positionChess.turn() === 'w';
      const legalMoves = positionChess.moves({ verbose: true });
      const numLegalMoves = legalMoves.length;

      const moveObj = positionChess.move(moves[i], { sloppy: true });
      const movePlayedUci = moveObj ? (moveObj.from + moveObj.to + (moveObj.promotion || '')) : '';
      const movePlayedSan = moveObj ? moveObj.san : moves[i];

      const sacCheckBoard = new Chess(fen);
      const sacResult = moveObj
        ? this.checkSacrifice(sacCheckBoard, moves[i])
        : { isSacrifice: false, isPieceSacrifice: false };

      const posAfter = new Chess(fenAfter);
      const isCheckmate = posAfter.in_checkmate();

      // Result-level evals are stored White-absolute (positive = good for
      // White). evals[i].cp / evals[i].lines[].cp are Stockfish side-to-move-
      // relative scores, so convert via the FEN's side-to-move field.
      const scoreBefore = this.whiteAbsCp(evals[i].cp, fen);

      // scoreAfter is the eval of the position AFTER the played move, i.e. the
      // next position's eval (evals[i+1]). evals[i].lines[0].cp is the eval of
      // position i itself (the before-move position), NOT the result of the
      // move — using it made evalAfter collapse onto evalBefore, so swings and
      // cpLoss always read as ~0. Only the final move of the game has no
      // evals[i+1]; there we fall back to the best line's eval of position i.
      let scoreAfter;
      if (isCheckmate) {
        scoreAfter = isWhitePlaying ? 10000 : -10000;
      } else if (evals[i + 1]) {
        scoreAfter = this.whiteAbsCp(evals[i + 1].cp, fenAfter);
      } else {
        const bestLineCp = evals[i]?.lines?.[0]?.cp ?? evals[i].cp;
        scoreAfter = this.whiteAbsCp(bestLineCp, fen);
      }

      // Mate propagation: if the position BEFORE the move was a forced mate
      // (|scoreBefore| in the mate band) and the played move is the engine's
      // top choice, the position after is still a forced mate for the same
      // side — a shallow child eval (evals[i+1]) that lost the mate at fixed
      // depth should NOT flip the eval to a normal cp and make the review read
      // as if the mating player suddenly lost their advantage. Keep scoreAfter
      // in the mate band (mate distance may shift by one ply, which is fine).
      const bestMoveHere = evals[i].bestMove;
      if (!isCheckmate && Math.abs(scoreBefore) >= 9900 && movePlayedUci === bestMoveHere) {
        const sign = scoreBefore >= 0 ? 1 : -1;
        // Only override if the child eval disagrees in sign/magnitude (i.e. it
        // lost the mate). If the child also sees a mate, trust the child.
        if (sign > 0 ? scoreAfter < 9900 : scoreAfter > -9900) {
          scoreAfter = sign > 0 ? Math.max(scoreAfter, 9990) : Math.min(scoreAfter, -9990);
        }
      }

      const bestMove = evals[i].bestMove;
      const bestMoveSan = this.uciToSan(fen, bestMove);
      const opponentBestMove = evals[i + 1]?.bestMove || '';
      const opponentBestMoveSan = opponentBestMove ? this.uciToSan(fenAfter, opponentBestMove) : '';
	      const cpLoss = this._cpLoss(scoreBefore, scoreAfter, isWhitePlaying);
	      const phase = this._phaseFromFen(fen, movePly);

      // gapToSecond measures how much better the top move is than the next
      // option for the mover. Compute it on White-absolute line evals so the
      // direction is consistent for both colors.
      const firstLineCp = evals[i].lines[0]
        ? this.whiteAbsCp(evals[i].lines[0].cp, fen)
        : scoreBefore;
      const secondLine = evals[i].lines.length > 1 ? evals[i].lines[1] : null;
      const secondLineCp = secondLine ? this.whiteAbsCp(secondLine.cp, fen) : null;
      const gapToSecond = this._gapToSecondWhite(firstLineCp, secondLineCp, isWhitePlaying);

	      const playerEdgeBefore = isWhitePlaying ? scoreBefore : -scoreBefore;
	      const playerEdgeAfter = isWhitePlaying ? scoreAfter : -scoreAfter;
	      const playerRating = this._ratingForColor(options.headers, isWhitePlaying);
	      const timeControl = options.headers?.TimeControl || options.headers?.Time || '';
	      const expectedLoss = this.expectedPointLoss(playerEdgeBefore, playerEdgeAfter, playerRating);
	      const isBestMove = movePlayedUci === bestMove;
	      const opponentJustBlundered = i > 0 && ['BLUNDER', 'MISTAKE'].includes(results[i - 1].classificationKey);
		      const mateThreat = options.skipMateThreat ? null : this._mateThreat(fenAfter);
      const priorOpponentMoveSan = i >= 1 ? results[i - 1].moveSan : '';
      const priorOpponentResult = i >= 1 ? results[i - 1] : null;
      const priorOpponentThreat = !!priorOpponentResult && (
        ['BRILLIANT', 'GREAT', 'BEST'].includes(priorOpponentResult.classificationKey)
        || Math.abs(priorOpponentResult.swing || 0) >= 120
      );
      const opponentPvSan = evals[i + 1]?.pvSan || '';

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
        eval: this.whiteAbsCp(line.cp, fen),
        evalText: this.formatScore(this.whiteAbsCp(line.cp, fen)),
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
          playerEdgeBefore,
          playerEdgeAfter,
          opponentJustBlundered,
          priorOpponentMoveSan,
          priorOpponentThreat,
          mateThreat,
          opponentPvSan,
          fenBefore: fen,
          fenAfter,
          openingName: opening ? (opening.ecoName || opening.name || '') : '',
        }),
      });
    }

	    results.opening = opening;
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

	  async resultsFromEvals(moves, positions, evals, opening = null, options = {}) {
	    const originalEvaluatePositions = this.evaluatePositions;
	    const originalDetectOpening = this.detectOpening;
	    this.evaluatePositions = async () => evals;
	    if (opening) this.detectOpening = () => opening;
	    try {
	      return await this.analyzeGame(moves, null, null, {
	        ...options,
	        initialFen: options.initialFen,
	      });
	    } finally {
	      this.evaluatePositions = originalEvaluatePositions;
	      this.detectOpening = originalDetectOpening;
	    }
	  }

	  calculateAccuracy(moveResults, color) {
    const colorMoves = moveResults.filter((m) => (color === 'white' && m.isWhite) || (color === 'black' && !m.isWhite));
    // Book moves are memorized, not played, so they are excluded from the
    // accuracy average (the old weight-92 inclusion inflated scores).
    const played = colorMoves.filter((m) => m.classification !== MoveClassification.BOOK);
    if (played.length === 0) return 100;
    return this._winProbAccuracy(played);
  }

  // chess.com CAPS2-style accuracy. The mean per-move win-probability loss is
  // converted to a 0-100 score via chess.com's published transform. Key choices
  // that make it land like the CAPS2 reference (most scores 50-95, no 99.9 for
  // imperfect play, no demoralizing single digits at the low end):
  //  - the transform is applied to the MEAN loss (transform-of-mean), not the
  //    mean of per-move transforms. Averaging per-move transforms reads too
  //    high (Jensen), so imperfect games hit 99 — the old CAPS1 complaint.
  //  - win-probability is computed with a FIXED winning-chance logistic constant
  //    (0.00368208) from White-absolute centipawn edges, NOT the rating-scaled
  //    expectedLoss used elsewhere. CAPS2 "compares against the top engine
  //    recommendations" and must be rating-independent.
  // `moves` are pre-filtered by the caller (color + non-book); each carries
  // playerEdgeBefore/playerEdgeAfter in White-absolute centipawns.
  _winProbAccuracy(moves) {
    if (!moves || moves.length === 0) return 100;
    const WIN_CHANCE_K = 0.00368208;
    const winPercent = (edgeCp) => {
      if (edgeCp >= 9900) return 100;
      if (edgeCp <= -9900) return 0;
      return 100 / (1 + Math.exp(-WIN_CHANCE_K * edgeCp));
    };
    let totalLoss = 0;
    let counted = 0;
    for (const move of moves) {
      const before = typeof move.playerEdgeBefore === 'number' ? move.playerEdgeBefore : 0;
      const after = typeof move.playerEdgeAfter === 'number' ? move.playerEdgeAfter : before;
      const drop = winPercent(before) - winPercent(after);
      totalLoss += drop > 0 ? drop : 0;
      counted++;
    }
    if (counted === 0) return 100;
    const meanLoss = totalLoss / counted;
    const accuracy = 103.1668 * Math.exp(-0.04354 * meanLoss) - 3.1669;
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
      if (m.classification === MoveClassification.BOOK) {
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
	      // Phase accuracy uses the same win-probability transform as the
	      // headline number (see _winProbAccuracy), so the breakdown agrees with
	      // the accuracy ring. Book moves are excluded, matching calculateAccuracy.
	      const played = phaseMoves.filter((m) => m.classification !== MoveClassification.BOOK);
	      const accuracy = played.length > 0 ? this._winProbAccuracy(played) : 0;

      result[phase] = {
        moves: phaseMoves.length,
        acpl: Math.round(acpl),
        accuracy,
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

window.MoveClassification = MoveClassification;
window.OPENING_BOOK = OPENING_BOOK;
window.CLASSIFICATION_ORDER = CLASSIFICATION_ORDER;
window.MoveAnalyzer = MoveAnalyzer;
window.clamp = clamp;
