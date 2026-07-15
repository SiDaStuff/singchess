const fs = require('fs');
const path = require('path');

// stockfish@18 exposes a single `initEngine(enginePath, cb)` helper that
// resolves to an engine object with `sendCommand(cmd)` and a `listener`
// callback for UCI output.  `enginePath` may be one of the keywords:
// "lite-single" (fastest, ~7MB), "single" (full single-threaded),
// "lite" (lite multi-threaded), or "full" (full multi-threaded, strongest).
//
// "Fastest to smartest to newest": the server defaults to the full
// single-threaded build (Stockfish 18, strongest single-threaded) for
// high-quality analysis that is still fast.  When a request asks for the
// strongest available engine (preferFull), we use the full multi-threaded
// build ("full").  Set SERVER_STOCKFISH_ENGINE to "single", "lite", "full",
// or "lite-single" to force a specific build for non-preferFull requests.
function resolveEngineKeyword(preferFull = false) {
  if (preferFull) return 'full';
  const envEngine = String(process.env.SERVER_STOCKFISH_ENGINE || '').toLowerCase();
  if (envEngine === 'lite' || envEngine === 'single' || envEngine === 'full' || envEngine === 'lite-single') {
    return envEngine;
  }
  return 'single';
}

// Choose the Stockfish build keyword for the server. Server review runs at a
// FIXED depth, and at fixed depth the lite-single build is the FASTEST choice:
// the fuller "single"/"full" builds are stronger but only because they search
// far more nodes per ply, which makes them ~3x slower to reach a given depth
// (measured). lite-single also loads reliably in Node; the multithreaded builds
// additionally collide when instantiated more than once in a process.
//
// We therefore default to 'lite-single'. SERVER_STOCKFISH_ENGINE overrides
// ('single' | 'full' | 'lite' | 'lite-single') for operators who want to trade
// speed for node-depth strength. preferFull (boost/strong reviews) selects the
// fuller build via the env-equivalent path below only when explicitly enabled.
function resolveEngineKeywordForServer(preferFull = false) {
  const envEngine = String(process.env.SERVER_STOCKFISH_ENGINE || '').toLowerCase();
  // Explicit env override always wins.
  if (envEngine === 'single' || envEngine === 'full' || envEngine === 'lite' || envEngine === 'lite-single') {
    return envEngine === 'lite' ? 'lite-single' : envEngine;
  }
  // preferFull (boost "stronger" reviews) opts into the multithreaded full
  // build only if the operator has not configured a faster default. At fixed
  // depth this is slower, so we keep lite-single unless explicitly requested
  // via SERVER_STOCKFISH_ENGINE. Boost still gets a higher DEPTH from the
  // strong review profile, which is where the extra strength comes from.
  if (preferFull) return 'lite-single';
  return 'lite-single';
}

// Auto-detect a thread count for the engine. Clamp to [1, 8] and leave a core
// free for the event loop. SERVER_STOCKFISH_THREADS overrides.
function detectThreadCount() {
  const env = parseInt(String(process.env.SERVER_STOCKFISH_THREADS || '').trim(), 10);
  if (Number.isFinite(env) && env > 0) return Math.min(env, 8);
  const os = require('os');
  const cores = Math.max(1, os.cpus?.length || 1);
  return Math.max(1, Math.min(cores - 1, 4));
}

// The multithreaded "single"/"full" WASM builds can use a large Hash; the
// "lite-single" single-threaded build caps it at 16 MB (larger values can make
// it silently abort during allocation).
function supportsLargeHash(keyword) {
  return keyword === 'single' || keyword === 'full';
}

function loadInitEngine() {
  // The npm `stockfish` package (v18) exports `initEngine` from its main
  // entry.  We resolve it through the package so the engine files under
  // `node_modules/stockfish/bin/` are located automatically.
  try {
    const stockfish = require('stockfish');
    if (typeof stockfish === 'function') return stockfish;
    if (stockfish && typeof stockfish.initEngine === 'function') return stockfish.initEngine;
  } catch (_err) {
    // Fall through to the manual loader below.
  }
  // Fallback: locate the package's index.js directly.
  const candidates = [
    path.resolve(process.cwd(), 'node_modules/stockfish/index.js'),
    path.resolve(__dirname, '../../node_modules/stockfish/index.js'),
    path.resolve(__dirname, '../../../node_modules/stockfish/index.js'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error('Cannot find the stockfish npm package (v18+). Run `npm install stockfish@18`.');
  }
  const moduleExports = require(found);
  return typeof moduleExports === 'function' ? moduleExports : moduleExports.initEngine;
}

class ServerStockfishEngine {
  constructor(options = {}) {
    this.engine = null;
    this.ready = false;
    this.handlers = [];
    this.history = [];
    this.activeSearch = null;
    this.currentMultiPv = 1;
    this.preferFull = !!options.preferFull;
    // Threads to apply at configure() time. Auto-detected by default; the
    // single-threaded builds ignore values > 1.
    this.threads = Math.max(1, Math.floor(Number(options.threads)) || detectThreadCount());
    this.keyword = null;
    // Default no-op sender; replaced in init() once the engine is loaded.
    this._send = () => {};
    // Operation queue for serializing engine commands
    this._operationChain = Promise.resolve();
  }

    async init() {
      const initEngine = loadInitEngine();
      const keyword = resolveEngineKeywordForServer(this.preferFull);

      // stockfish@18: initEngine(keyword) returns a Promise that resolves to
      // an engine object once the WASM binary is loaded and ready.  UCI
      // output is delivered through `engine.listener`; commands are sent
      // through `engine.sendCommand(cmd)`.
      let engine;
      try {
        engine = await initEngine(keyword);
      } catch (err) {
        // The multithreaded builds should load in Node, but if the host
        // environment can't (missing worker/WASM support), fall back to the
        // reliable single-threaded lite build before giving up.
        if (keyword !== 'lite-single') {
          console.warn(`Stockfish "${keyword}" failed to load (${err.message}); falling back to lite-single.`);
          try {
            engine = await initEngine('lite-single');
            this.keyword = 'lite-single';
          } catch (fbErr) {
            throw new Error(`Stockfish engine "${keyword}" failed to load: ${err.message}`);
          }
        } else {
          throw new Error(`Stockfish engine "${keyword}" failed to load: ${err.message}`);
        }
      }
      if (!engine || typeof engine.sendCommand !== 'function') {
        throw new Error(`Stockfish engine "${keyword}" did not produce a usable engine object.`);
      }
      this.keyword = this.keyword || keyword;

      this.engine = engine;

      // Route all UCI output into the line handler.  stockfish@18 calls
      // `engine.listener(line)` for every line the engine prints.
      engine.listener = (line) => this._handleLine(line);

      // Send UCI commands through the package's sendCommand helper, which
      // handles the single-threaded vs multi-threaded routing internally.
      this._send = (command) => engine.sendCommand(command);

      // Run UCI init synchronously so the engine is truly ready before
      // any analysis request can use it.  Without this, getServerEngine()
      // returns the engine immediately and the 8 s timeout fires with
      // "Server engine is still warming up."
      try {
        await this._uci();
        await this.configure();
        console.log(`Stockfish ${engine.getVersion ? engine.getVersion() : '18'} (${this.keyword}, ${this.threads} thread(s)) UCI initialization completed`);
        this.ready = true;
      } catch (initError) {
        console.warn('Stockfish UCI initialization failed (non-critical):', initError.message);
        // Mark ready anyway so the engine can still attempt searches;
        // individual evaluate() calls will fail on their own if the
        // engine is truly broken.
        this.ready = true;
      }
  }

  _runExclusive(task) {
    const run = this._operationChain.catch(() => {}).then(task);
    this._operationChain = run.catch(() => {});
    return run;
  }



  _handleLine(payload) {    for (const raw of String(payload || '').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      this.history.push(line);
      if (this.history.length > 80) this.history.shift();
      for (const handler of [...this.handlers]) handler(line);
    }
  }

  _waitFor(token, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const handler = (line) => {
        if (!line.includes(token)) return;
        clearTimeout(timer);
        this._removeHandler(handler);
        resolve(line);
      };

      timer = setTimeout(() => {
        this._removeHandler(handler);
        reject(new Error(`Timed out waiting for ${token}`));
      }, timeoutMs);

      this._addHandler(handler);
    });
  }

  _addHandler(handler) {
    this.handlers.push(handler);
  }

  _removeHandler(handler) {
    this.handlers = this.handlers.filter((entry) => entry !== handler);
  }

  async _uci() {
    const wait = this._waitFor('uciok', 30000);
    this._send('uci');
    await wait;
  }

  async configure() {
    this._cancelActiveSearch();
    this._send('stop');
    this._send('setoption name MultiPV value 1');
    // The multithreaded "single"/"full" builds support Threads>1 and a large
    // Hash; the lite-single build must stay at Threads=1 and Hash<=16MB
    // (larger values make it silently abort during allocation).
    const largeHash = supportsLargeHash(this.keyword);
    if (largeHash) {
      this._send(`setoption name Threads value ${this.threads}`);
      this._send('setoption name Hash value 128');
    } else {
      this._send('setoption name Threads value 1');
    }
    this.currentMultiPv = 1;
    const wait = this._waitFor('readyok', 15000);
    this._send('isready');
    await wait;
  }

  async newGame() {
    this._cancelActiveSearch();
    this._send('stop');
    this._send('ucinewgame');
    const wait = this._waitFor('readyok', 12000);
    this._send('isready');
    await wait;
  }

    async _ensureMultiPv(numPV = 1) {
      const next = Math.max(1, Math.floor(Number(numPV) || 1));
      if (this.currentMultiPv === next) return;
      this._send(`setoption name MultiPV value ${next}`);
      this.currentMultiPv = next;
      const wait = this._waitFor('readyok', 3000);
      this._send('isready');
      await wait;
    }

    async evaluate(fen, depth = 18, timeoutMs = 6000) {
      if (!this.ready) throw new Error('Engine not ready');
      return this._runExclusive(() => this._evaluate(fen, depth, timeoutMs));
    }

    async _evaluate(fen, depth = 18, timeoutMs = 6000) {
      this._cancelActiveSearch();
      this._send('stop');
      await this._ensureMultiPv(1);

    return new Promise((resolve, reject) => {
      let bestInfo = null;
      let timer = null;
      let hardTimer = null;
      let settled = false;

      const finish = (bestMove = '') => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (hardTimer) clearTimeout(hardTimer);
        this._removeHandler(handler);
        if (this.activeSearch?.handler === handler) this.activeSearch = null;
        resolve({
          score: bestInfo ? bestInfo.score : 0,
          scoreType: bestInfo ? bestInfo.scoreType : 'cp',
          bestMove,
          pv: bestInfo ? bestInfo.pv : '',
          depth: bestInfo ? bestInfo.depth : 0,
          timedOut: !bestMove,
        });
      };

      const handler = (line) => {
        if (line.startsWith('info') && line.includes('depth')) {
          const info = this._parseInfo(line);
          if (info.depth) bestInfo = info;
        }

        if (line.startsWith('bestmove')) {
          finish(line.split(' ')[1] || '');
        }
      };

      timer = setTimeout(() => {
        this._send('stop');
        hardTimer = setTimeout(() => finish(bestInfo?.pv?.split(/\s+/).filter(Boolean)[0] || ''), 900);
        if (this.activeSearch?.handler === handler) this.activeSearch.hardTimer = hardTimer;
      }, timeoutMs);
      this._addHandler(handler);
      this.activeSearch = { handler, timer, hardTimer, reject };
      this._send(`position fen ${fen}`);
      this._send(`go depth ${depth}`);
    });
  }

    async evaluateMultiPV(fen, depth = 18, numPV = 3, timeoutMs = 6000) {
      if (!this.ready) throw new Error('Engine not ready');
      return this._runExclusive(() => this._evaluateMultiPV(fen, depth, numPV, timeoutMs));
    }

    async _evaluateMultiPV(fen, depth = 18, numPV = 3, timeoutMs = 6000) {
      this._cancelActiveSearch();
      this._send('stop');
      await this._ensureMultiPv(numPV);

    return new Promise((resolve, reject) => {
      const pvResults = {};
      let timer = null;
      let hardTimer = null;
      let settled = false;

      const finish = (bestMove = '') => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (hardTimer) clearTimeout(hardTimer);
        this._removeHandler(handler);
        if (this.activeSearch?.handler === handler) this.activeSearch = null;
        const lines = [];
        for (let i = 1; i <= numPV; i += 1) {
          if (pvResults[i]) lines.push(pvResults[i]);
        }
        resolve({
          lines,
          bestMove: bestMove || lines[0]?.pv?.split(/\s+/).filter(Boolean)[0] || '',
          timedOut: !bestMove,
        });
      };

      const handler = (line) => {
        if (line.startsWith('info') && line.includes('depth') && line.includes(' pv ')) {
          const info = this._parseInfo(line);
          if (info.multipv) {
            const existing = pvResults[info.multipv];
            if (!existing || (info.depth || 0) >= (existing.depth || 0)) {
              pvResults[info.multipv] = info;
            }
          }
        }

        if (line.startsWith('bestmove')) {
          finish(line.split(' ')[1] || '');
        }
      };

      timer = setTimeout(() => {
        this._send('stop');
        hardTimer = setTimeout(() => finish(), 900);
        if (this.activeSearch?.handler === handler) this.activeSearch.hardTimer = hardTimer;
      }, timeoutMs);
      this._addHandler(handler);
      this.activeSearch = { handler, timer, hardTimer, reject };
      this._send(`position fen ${fen}`);
      this._send(`go depth ${depth}`);
    });
  }

  _cancelActiveSearch() {
    if (!this.activeSearch) return;
    const { handler, timer, hardTimer, reject } = this.activeSearch;
    if (timer) clearTimeout(timer);
    if (hardTimer) clearTimeout(hardTimer);
    this._removeHandler(handler);
    this.activeSearch = null;
    if (reject) reject(new Error('Search cancelled'));
  }

  _parseInfo(line) {
    const result = {};
    const depthMatch = line.match(/\bdepth (\d+)/);
    if (depthMatch) result.depth = parseInt(depthMatch[1], 10);
    const multipvMatch = line.match(/\bmultipv (\d+)/);
    if (multipvMatch) result.multipv = parseInt(multipvMatch[1], 10);
    const cpMatch = line.match(/\bscore cp (-?\d+)/);
    const mateMatch = line.match(/\bscore mate (-?\d+)/);
    if (cpMatch) {
      result.score = parseInt(cpMatch[1], 10);
      result.scoreType = 'cp';
    } else if (mateMatch) {
      result.score = parseInt(mateMatch[1], 10);
      result.scoreType = 'mate';
    }
    const pvMatch = line.match(/\bpv (.+)$/);
    if (pvMatch) result.pv = pvMatch[1].trim();
    return result;
  }

  destroy() {
    this._cancelActiveSearch();
    if (this.engine) {
      try {
        this._send('quit');
      } catch (_err) {
        // Ignore shutdown failures in serverless teardown.
      }
    }
    this.ready = false;
  }
}

// ── Process-wide singleton ──────────────────────────────────────────────
// The `stockfish` npm package (v18) is a HARD singleton per Node process:
// its Emscripten glue registers `process.on("uncaughtException")` handlers
// that re-throw anything that isn't an ExitStatus. A second `initEngine()`
// call (1) rejects with "INIT_ENGINE(...) is not a function" (the factory is
// mutated to a non-function after first use) AND (2) re-runs
// WebAssembly.instantiate(), which fails with
// "LinkError: Import #17 module="a" function="s" ..." → Aborted() → an
// uncaught WebAssembly.RuntimeError → the process dies.
//
// There is therefore exactly ONE engine per process, shared by every call
// site (analyze.js, anticheat.js). `preferFull` is accepted for API
// compatibility but ignored: resolveEngineKeywordForServer() already
// returns 'lite-single' for all paths (the multithreaded builds are ~3x
// SLOWER at the fixed depths this server uses and also collide on a second
// init). This module is the single owner of that one instance.
let _singletonEngine = null;
let _singletonInit = null;
let _singletonFailed = false;

async function getServerEngine(_preferFull = false) {
  // Once the very first init has failed, the package is poisoned in-process:
  // any further initEngine() call would crash the process. Fail fast and let
  // PM2 restart the process to recover.
  if (_singletonFailed) {
    throw new Error('Stockfish engine unavailable; process restart required.');
  }
  if (_singletonInit) {
    await _singletonInit;
    return _singletonEngine;
  }
  const engine = new ServerStockfishEngine({});
  _singletonEngine = engine;
  _singletonInit = engine.init().catch((err) => {
    _singletonFailed = true;
    _singletonEngine = null;
    _singletonInit = null;
    throw err;
  });
  try {
    await _singletonInit;
  } catch (err) {
    // _singletonInit already rejected and flipped _singletonFailed above;
    // re-surface the original error to this caller.
    throw err;
  }
  return _singletonEngine;
}

// Non-destructive "reset": clear the hash / transposition table via a UCI
// newGame() so the next search starts clean. We deliberately do NOT destroy
// and recreate the engine — that would call initEngine() a second time and
// crash the process. Best-effort: a reset failure must never propagate.
function resetServerEngine(_preferFull = false) {
  const engine = _singletonEngine;
  if (!engine || !engine.ready) return;
  try {
    engine.newGame();
  } catch (_err) {
    // Ignore: a failed hash clear is not fatal to the next search.
  }
}

module.exports = { ServerStockfishEngine, getServerEngine, resetServerEngine };
