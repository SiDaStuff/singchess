// Standalone smoke test for the native Stockfish engine.
// Run: node scripts/test-native-engine.cjs
//
// Exercises: resolveStockfishBinary (download/extract/probe on first run),
// getServerEngine singleton, evaluate (single-PV), evaluateMultiPV, newGame,
// and in-process respawn recovery after killing the child. CommonJS so it can
// require() the server module directly.
//
// Platform notes:
//   win32/x64, linux/x64 → downloads the official sf_18 prebuilt on first run.
//   linux/arm64          → BUILDS from source on first run (needs g++, make,
//                           wget|curl: `sudo apt install -y g++ make wget curl`).
//                           The one-time compile (~1-2 min) is cached after.
const assert = require('assert');
const path = require('path');
const { getServerEngine, ServerStockfishEngine } = require('../server/api/_lib/stockfish-engine');
const { resolveStockfishBinary, detectAsset } = require('../server/api/_lib/stockfish-binary');

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 0. detectAsset should resolve on a supported host (throws clearly otherwise).
  const asset = detectAsset();
  const how = asset.kind === 'source' ? 'BUILD FROM SOURCE' : 'download';
  console.log(`[1/5] Detected asset: ${asset.os}/${process.arch} → ${how} ${path.basename(asset.url)}`);

  // 1. resolveStockfishBinary downloads + probes on first run, caches after.
  console.log('[2/5] Resolving native binary (downloads on first run)...');
  const exePath = await resolveStockfishBinary();
  console.log(`      Binary ready at ${exePath}`);

  // 2. Singleton + single-PV evaluate.
  console.log('[3/5] getServerEngine + evaluate (single-PV, depth 18)...');
  const engine = await getServerEngine();
  assert.ok(engine.ready, 'engine should be ready');
  const single = await engine.evaluate(START_FEN, 18, 8000);
  assert.ok(['cp', 'mate'].includes(single.scoreType), `scoreType was ${single.scoreType}`);
  assert.ok(typeof single.bestMove === 'string' && single.bestMove.length >= 4, `bad bestMove: ${single.bestMove}`);
  assert.equal(typeof single.pv, 'string');
  assert.ok(single.depth >= 1, `depth too low: ${single.depth}`);
  assert.equal(single.timedOut, false);
  console.log(`      bestMove=${single.bestMove} score=${single.score}(${single.scoreType}) depth=${single.depth}`);

  // 3. Multi-PV.
  console.log('[4/5] evaluateMultiPV (depth 14, 3 lines)...');
  const multi = await engine.evaluateMultiPV(START_FEN, 14, 3, 8000);
  assert.ok(Array.isArray(multi.lines) && multi.lines.length >= 1 && multi.lines.length <= 3);
  assert.ok(multi.lines.every((l) => l.multipv >= 1 && l.multipv <= 3));
  console.log(`      got ${multi.lines.length} line(s); top pv0=${multi.lines[0].pv.split(/\s+/)[0]}`);

  // 4. newGame (serialized reset).
  await engine.newGame();
  console.log('      newGame OK');

  // 5. In-process respawn recovery: kill the child, confirm getServerEngine
  //    respawns the SAME instance and re-inits.
  console.log('[5/5] Crash recovery: killing child, expecting respawn...');
  const childPidBefore = engine.child?.pid;
  assert.ok(childPidBefore, 'expected a live child before kill');
  try {
    engine.child.kill('SIGKILL');
  } catch (_) {}
  await sleep(300); // let the exit handler fire
  assert.equal(engine.ready, false, 'engine should be not-ready right after crash');
  const engine2 = await getServerEngine();
  assert.strictEqual(engine2, engine, 'getServerEngine must return the same singleton instance');
  assert.ok(engine.ready, 'singleton should be ready again after respawn');
  const childPidAfter = engine.child?.pid;
  assert.ok(childPidAfter && childPidAfter !== childPidBefore, 'expected a NEW child pid after respawn');
  // Confirm it actually searches after respawn.
  const after = await engine.evaluate(START_FEN, 12, 8000);
  assert.ok(after.bestMove.length >= 4, 'evaluate must work after respawn');
  console.log(`      respawned (pid ${childPidBefore} → ${childPidAfter}); post-respawn bestMove=${after.bestMove}`);

  // Cleanup.
  engine.destroy();

  // Also sanity-check that a second ServerStockfishEngine instance can be
  // constructed and torn down independently (no global state from the class).
  const standalone = new ServerStockfishEngine();
  await standalone.init();
  assert.ok(standalone.ready);
  const s = await standalone.evaluate(START_FEN, 10, 6000);
  assert.ok(s.bestMove.length >= 4);
  standalone.destroy();

  console.log('\nALL CHECKS PASSED');
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err);
  process.exit(1);
});
