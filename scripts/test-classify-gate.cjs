// Verify the classifyMove consistency gate: a move flagged isBestMove with a
// huge cpLoss must NOT get BEST (fall through to the error ladder).
// Run: node scripts/test-classify-gate.cjs
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sandbox = {
  window: {},
  console,
};
// chess-core needs a Chess constructor on window (from chess.js).
const { Chess } = require(path.join(root, 'node_modules', 'chess.js'));
sandbox.Chess = Chess;
sandbox.window.Chess = Chess;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'src', 'chess-core.js'), 'utf8'), sandbox);

const analyzer = new sandbox.window.MoveAnalyzer();
const { MoveClassification } = sandbox.window;

// Helper: build minimal moveData.
function classify(over = {}) {
  return analyzer.classifyMove({
    movePly: 7,
    moveSan: 'Qxa6',
    moveUci: 'a4a6',
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    numLegalMoves: 30,
    isCheckmate: false,
    isPieceSacrifice: false,
    playerEdgeBefore: 0.1,
    playerEdgeAfter: -0.6,
    cpLoss: 0,
    isBestMove: true,
    gapToSecond: 10,
    scoreBefore: 30,
    scoreAfter: -560,
    phase: 'middlegame',
    playerRating: 1500,
    timeControl: '600',
    opponentJustBlundered: false,
    isInBook: false,
    ...over,
  });
}

let fails = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) fails += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got=${got && got.key} want=${want && want.key}`);
};

// 1. isBestMove + tiny cpLoss → BEST (normal case unchanged).
check('best+smallLoss=BEST', classify({ cpLoss: 5 }), MoveClassification.BEST);

// 2. THE BUG: isBestMove + 660cp cpLoss (Qxa6 trap) → must be BLUNDER, not BEST.
check('best+660loss=BLUNDER', classify({ cpLoss: 660 }), MoveClassification.BLUNDER);

// 3. isBestMove + 300cp loss → BLUNDER.
check('best+300loss=BLUNDER', classify({ cpLoss: 310 }), MoveClassification.BLUNDER);

// 4. isBestMove + 150cp loss → MISTAKE.
check('best+150loss=MISTAKE', classify({ cpLoss: 150 }), MoveClassification.MISTAKE);

// 5. Only legal move + huge cpLoss → still BEST (forced moves are exempt).
check('forced+hugeLoss=BEST', classify({ numLegalMoves: 1, cpLoss: 900 }), MoveClassification.BEST);

// 6. Checkmate delivered + huge cpLoss → still BRILLIANT (checked earlier anyway).
check('mate+sac=BRILLIANT', classify({ isCheckmate: true, isPieceSacrifice: true, cpLoss: 900 }), MoveClassification.BRILLIANT);

// 7. Non-best move, small loss → EXCELLENT/GOOD unchanged.
check('nonbest+tinyLoss', classify({ isBestMove: false, cpLoss: 20 }), MoveClassification.EXCELLENT);

process.exit(fails ? 1 : 0);
