// Engine catalog + review profile data and pure lookup helpers.
//
// Kept OUT of engine.js (the lazy Stockfish controller chunk) so the eager
// application bundle can read the catalog synchronously at boot — the app
// constructor populates the engine-module radios on /settings via
// getEngineModules. engine.js is only `import()`ed on demand (loadEngine in
// application.js), so anything defined there is NOT available when
// `new ChessReviewApp()` runs. This module is tiny and side-effect free
// (just window.* re-exports), so it costs nothing to load eagerly.
//
// engine.js imports from here and re-exports nothing new; the old window.*
// names below are preserved for backward compatibility with lazy chunks and
// test scripts that read them after the engine chunk loads.

const ENGINE_CATALOG = Object.freeze({
  browser: {
    label: 'Browser',
    modules: [
      {
        key: 'lite-single',
        label: 'Stockfish 18 Lite WASM',
        engineLabel: 'Stockfish 18 Lite WASM',
        jsPath: window.__API_BASE + '/vendor/stockfish/stockfish-18-lite-single.js',
        wasmPath: window.__API_BASE + '/vendor/stockfish/stockfish-18-lite-single.wasm',
        hash: 256,
        threads: 1,
        supportsThreads: false,
        downloadLabel: '7mb download',
      },
      {
        key: 'full-single',
        label: 'Stockfish 18 Full WASM',
        engineLabel: 'Stockfish 18 Full WASM',
        jsPath: window.__API_BASE + '/vendor/stockfish/stockfish-18-single.js',
        wasmPath: window.__API_BASE + '/vendor/stockfish/stockfish-18-single.wasm',
        hash: 512,
        threads: 1,
        supportsThreads: false,
        downloadLabel: '108mb download',
      },
    ],
  },
});

const REVIEW_PROFILES = Object.freeze({
  depth10: { key: 'depth10', label: 'Depth 10', depth: 10, multiPv: 2, timeoutMs: 8000, battleDepth: 8 },
  depth14: { key: 'depth14', label: 'Depth 14', depth: 14, multiPv: 3, timeoutMs: 12000, battleDepth: 10 },
  depth18: { key: 'depth18', label: 'Depth 18', depth: 18, multiPv: 3, timeoutMs: 15000, battleDepth: 12 },
  depth22: { key: 'depth22', label: 'Depth 22', depth: 22, multiPv: 4, timeoutMs: 18000, battleDepth: 14 },
  depth26: { key: 'depth26', label: 'Depth 26', depth: 26, multiPv: 5, timeoutMs: 22000, battleDepth: 16 },
});

// Review strength tiers — the primary user-facing strength control. Each tier
// is a (depth, time cap) pair: depth guarantees cross-move consistency (so
// cpLoss/eval swings/accuracy stay meaningful and reviews are reproducible),
// while the time cap bounds worst-case latency. The cap must be generous enough
// for the lite engine to actually reach the listed depth on tactical positions
// — a too-tight cap times out mid-search and returns shallower, noisier scores
// (which reads as "wrong" cp). Measured on lite-single: depth 12 ≈0.2s, depth
// 14 ≈0.3s, depth 18 ≈0.9s on typical positions, but tactical ones take several
// times longer, hence the headroom below.
//
//   Quick     — fast feedback (≈3s/move cap)
//   Standard  — good depth, acceptable wait (≈4.5s/move cap) — DEFAULT
//   Thorough  — deeper, for paying users + anticheat (≈8s/move cap)
//
// Advanced users can override depth/time per-review (see _getReviewProfile in
// app.js). These tiers drive full reviews + server analysis + anticheat ONLY;
// the live/coach iterative-deepening eval is unaffected (it uses REVIEW_PROFILES).
const REVIEW_STRENGTH_TIERS = Object.freeze({
  quick: { key: 'quick', label: 'Quick (≈3s/move)', depth: 12, timeoutMs: 3000, multiPv: 2 },
  standard: { key: 'standard', label: 'Standard (≈4.5s/move)', depth: 14, timeoutMs: 4500, multiPv: 3 },
  thorough: { key: 'thorough', label: 'Thorough (≈8s/move)', depth: 18, timeoutMs: 8000, multiPv: 4 },
});

function getEngineModules(source) {
  return ENGINE_CATALOG[source]?.modules || ENGINE_CATALOG.browser.modules;
}

function getEngineModuleConfig(source, moduleKey) {
  const modules = getEngineModules(source);
  return modules.find((entry) => entry.key === moduleKey) || modules[0];
}

function getReviewProfileConfig(profileKey) {
  return REVIEW_PROFILES[profileKey] || REVIEW_PROFILES.depth14;
}

function getReviewStrengthTier(tierKey) {
  return REVIEW_STRENGTH_TIERS[tierKey] || REVIEW_STRENGTH_TIERS.standard;
}

export {
  ENGINE_CATALOG,
  REVIEW_PROFILES,
  REVIEW_STRENGTH_TIERS,
  getEngineModules,
  getEngineModuleConfig,
  getReviewProfileConfig,
  getReviewStrengthTier,
};

// Preserve the historical window.* API. Previously these were set when the
// statically-imported engine.js executed; lazy chunks (boost, coach, play,
// tactics) and test scripts still read them off window. Kept here so they are
// available from boot regardless of when (or whether) the engine chunk loads.
window.ENGINE_CATALOG = ENGINE_CATALOG;
window.REVIEW_PROFILES = REVIEW_PROFILES;
window.REVIEW_STRENGTH_TIERS = REVIEW_STRENGTH_TIERS;
window.getEngineModules = getEngineModules;
window.getEngineModuleConfig = getEngineModuleConfig;
window.getReviewProfileConfig = getReviewProfileConfig;
window.getReviewStrengthTier = getReviewStrengthTier;