const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadChess() {
  const chessModule = require('chess.js');
  return chessModule.Chess || chessModule;
}

function loadAnalyzer() {
  const Chess = loadChess();
  const candidates = [
    path.resolve(__dirname, '../../src/chess-core.js'),
    path.resolve(__dirname, '../../../src/chess-core.js'),
    path.resolve(__dirname, '../../public/js/chess-core.js'),
    path.resolve(__dirname, '../../../public/js/chess-core.js'),
    path.resolve(process.cwd(), 'src/chess-core.js'),
    path.resolve(process.cwd(), '../src/chess-core.js'),
    path.resolve(process.cwd(), 'public/js/chess-core.js'),
    path.resolve(process.cwd(), '../public/js/chess-core.js'),
  ];
  const analysisPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!analysisPath) {
    throw new Error(`Could not find chess-core.js. Checked: ${candidates.join(', ')}`);
  }
  const source = fs.readFileSync(analysisPath, 'utf8');
  const sandbox = {
    Chess,
    console,
    module: { exports: {} },
    exports: {},
    window: { Chess },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${source}\nmodule.exports = { MoveAnalyzer, MoveClassification };`, sandbox, {
    filename: 'chess-core.js',
  });
  // The teaching pipeline is the same deterministic side-effect module used
  // by Vite. Load it in this realm so server and browser consume identical
  // chess rules without importing DOM components or duplicating analysis.
  const tacticsPath = path.join(path.dirname(analysisPath), 'tactics-coach.js');
  if (fs.existsSync(tacticsPath)) {
    vm.runInContext(fs.readFileSync(tacticsPath, 'utf8'), sandbox, { filename: 'tactics-coach.js' });
    sandbox.module.exports.TacticsCoach = sandbox.window.TacticsCoach;
    const advancedPath = path.join(path.dirname(analysisPath), 'tactics-advanced.js');
    if (fs.existsSync(advancedPath)) {
      vm.runInContext(fs.readFileSync(advancedPath, 'utf8'), sandbox, { filename: 'tactics-advanced.js' });
      sandbox.module.exports.TacticsAdvanced = sandbox.window.TacticsAdvanced;
    }
  }
  return sandbox.module.exports;
}

module.exports = { loadAnalyzer, loadChess };
