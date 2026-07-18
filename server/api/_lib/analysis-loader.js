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
    window: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(`${source}\nmodule.exports = { MoveAnalyzer, MoveClassification };`, sandbox, {
    filename: 'chess-core.js',
  });
  return sandbox.module.exports;
}

module.exports = { loadAnalyzer, loadChess };
