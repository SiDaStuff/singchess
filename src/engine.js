const ENGINE_CATALOG = Object.freeze({
  browser: {
    label: 'Browser',
    modules: [
      {
        key: 'lite-single',
        label: 'Stockfish 18 Lite',
        engineLabel: 'Stockfish 18 Lite',
        jsPath: '/vendor/stockfish/stockfish-18-lite-single.js',
        wasmPath: '/vendor/stockfish/stockfish-18-lite-single.wasm',
        hash: 256,
        threads: 1,
        supportsThreads: false,
        downloadLabel: '7mb download',
      },
      {
        key: 'full-single',
        label: 'Stockfish 18',
        engineLabel: 'Stockfish 18',
        jsPath: '/vendor/stockfish/stockfish-18-single.js',
        wasmPath: '/vendor/stockfish/stockfish-18-single.wasm',
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

class UciEngine {
  constructor(moduleConfig) {
    this.moduleConfig = moduleConfig;
    this.ready = false;
    this.messageQueue = [];
    this.activeSearch = null;
    this.operationChain = Promise.resolve();
  }

  async evaluate(fen, depth = 18, timeoutMs = 20000) {
    return this._runExclusive(() => this._evaluate(fen, depth, timeoutMs));
  }

  async _evaluate(fen, depth = 18, timeoutMs = 20000) {
    if (!this.ready) throw new Error('Engine not ready');

    this._cancelActiveSearch();
    this._safeStop();
    // Defensive: ensure MultiPV=1 for a single-PV search. A prior
    // evaluateMultiPV resets MultiPV on finish, but if that reset threw
    // (crashed worker) we'd otherwise run this search at MultiPV=N and get
    // N lines the single-PV handler ignores. Don't depend on the prior reset.
    try { this._send('setoption name MultiPV value 1'); } catch (_) {}
    await this._waitForReady(timeoutMs);

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
        this._removeMessageHandler(handler);
        if (this.activeSearch?.handler === handler) {
          this.activeSearch = null;
        }
        resolve({
          score: bestInfo ? bestInfo.score : 0,
          scoreType: bestInfo ? bestInfo.scoreType : 'cp',
          bestMove,
          pv: bestInfo ? bestInfo.pv : '',
          depth: bestInfo ? bestInfo.depth : 0,
          timedOut: !bestMove,
        });
      };

      const handler = (msg) => {
        if (msg.startsWith('info') && msg.includes('depth')) {
          const info = this._parseInfo(msg);
          if (info && info.depth) {
            bestInfo = info;
          }
        }

        if (msg.startsWith('bestmove')) {
          finish(msg.split(' ')[1] || '');
        }
      };

      timer = setTimeout(() => {
        this._safeStop();
        hardTimer = setTimeout(() => finish(bestInfo?.pv?.split(/\s+/).filter(Boolean)[0] || ''), 900);
        if (this.activeSearch?.handler === handler) this.activeSearch.hardTimer = hardTimer;
      }, timeoutMs);

      this._addMessageHandler(handler);
      this.activeSearch = { handler, timer, hardTimer, reject };
      this._send(`position fen ${fen}`);
      this._send(`go depth ${depth}`);
    });
  }

  async evaluateMultiPV(fen, depth = 18, numPV = 3, timeoutMs = 20000) {
    return this._runExclusive(() => this._evaluateMultiPV(fen, depth, numPV, timeoutMs));
  }

  async _evaluateMultiPV(fen, depth = 18, numPV = 3, timeoutMs = 20000) {
    if (!this.ready) throw new Error('Engine not ready');

    this._cancelActiveSearch();
    this._safeStop();
    this._send(`setoption name MultiPV value ${numPV}`);
    await this._waitForReady(timeoutMs);

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
        this._removeMessageHandler(handler);
        if (this.activeSearch?.handler === handler) {
          this.activeSearch = null;
        }

        const results = [];
        for (let i = 1; i <= numPV; i += 1) {
          if (pvResults[i]) {
            results.push(pvResults[i]);
          }
        }

        // Restore MultiPV=1 for the next single-PV search BEFORE resolving.
        // _evaluate also sets MultiPV=1 itself (defensive), so the contract no
        // longer depends on this call succeeding — but doing it first means a
        // healthy engine never runs the next search at the old MultiPV=N.
        try {
          this._send('setoption name MultiPV value 1');
        } catch (err) {
          console.warn('Could not reset MultiPV after multipv search:', err?.message || err);
        }

        resolve({
          lines: results,
          bestMove: bestMove || results[0]?.pv?.split(/\s+/).filter(Boolean)[0] || '',
          timedOut: !bestMove,
        });
      };

      const handler = (msg) => {
        if (msg.startsWith('info') && msg.includes('depth') && msg.includes(' pv ')) {
          const info = this._parseInfo(msg);
          if (info && info.multipv) {
            const existing = pvResults[info.multipv];
            if (!existing || (info.depth || 0) >= (existing.depth || 0)) {
              pvResults[info.multipv] = info;
            }
          }
        }

        if (msg.startsWith('bestmove')) {
          finish(msg.split(' ')[1] || '');
        }
      };

      timer = setTimeout(() => {
        this._safeStop();
        hardTimer = setTimeout(() => finish(), 900);
        if (this.activeSearch?.handler === handler) this.activeSearch.hardTimer = hardTimer;
      }, timeoutMs);

      this._addMessageHandler(handler);
      this.activeSearch = { handler, timer, hardTimer, reject };
      this._send(`position fen ${fen}`);
      this._send(`go depth ${depth}`);
    });
  }

  _runExclusive(task) {
    const run = this.operationChain.catch(() => {}).then(task);
    this.operationChain = run.catch(() => {});
    return run;
  }

  _safeStop() {
    try {
      this._send('stop');
    } catch (error) {
      this._failActiveSearch(error);
    }
  }

  interrupt() {
    this._cancelActiveSearch();
    this._safeStop();
  }

  _cancelActiveSearch() {
    if (!this.activeSearch) return;
    const { handler, timer, hardTimer, reject } = this.activeSearch;
    if (timer) clearTimeout(timer);
    if (hardTimer) clearTimeout(hardTimer);
    this._removeMessageHandler(handler);
    this.activeSearch = null;
    if (reject) reject(new Error('Search cancelled'));
  }

  _parseInfo(line) {
    const result = {};

    const depthMatch = line.match(/\bdepth (\d+)/);
    if (depthMatch) result.depth = parseInt(depthMatch[1], 10);

    const seldepthMatch = line.match(/\bseldepth (\d+)/);
    if (seldepthMatch) result.seldepth = parseInt(seldepthMatch[1], 10);

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

    const nodesMatch = line.match(/\bnodes (\d+)/);
    if (nodesMatch) result.nodes = parseInt(nodesMatch[1], 10);

    const npsMatch = line.match(/\bnps (\d+)/);
    if (npsMatch) result.nps = parseInt(npsMatch[1], 10);

    return result;
  }

  stop() {
    this._safeStop();
  }

  _waitFor(keyword, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._removeMessageHandler(handler);
        reject(new Error(`Timed out waiting for ${keyword}`));
      }, timeoutMs);
      const handler = (msg) => {
        if (msg.includes(keyword)) {
          clearTimeout(timer);
          this._removeMessageHandler(handler);
          resolve(msg);
        }
      };
      this._addMessageHandler(handler);
    });
  }

  // isready/readyok handshake with one retry. The fixed 3s cap in the original
  // code rejected before a busy WASM engine ever answered on slow machines;
  // scale the wait with the caller's budget and retry once after re-sending
  // isready, which recovers from a dropped/slow first ack.
  async _waitForReady(timeoutMs = 8000) {
    const budget = Math.max(3000, Math.min(timeoutMs, 8000));
    const attempt = (ms) => {
      const wait = this._waitFor('readyok', ms);
      this._send('isready');
      return wait;
    };
    try {
      await attempt(Math.round(budget / 2));
    } catch (_firstErr) {
      await attempt(budget);
    }
  }

  _addMessageHandler(handler) {
    this.messageQueue.push(handler);
  }

  _removeMessageHandler(handler) {
    const idx = this.messageQueue.indexOf(handler);
    if (idx !== -1) this.messageQueue.splice(idx, 1);
  }

  _handleTransportMessage(msg) {
    this.messageQueue.forEach((fn) => {
      try { fn(msg); } catch (err) {
        // Surface handler failures instead of swallowing them silently — a
        // throwing handler usually means a search/promise bug we want to find.
        console.warn('Engine message handler threw:', err?.message || err);
      }
    });
  }

  _failActiveSearch(error) {
    if (this.activeSearch?.reject) {
      this.activeSearch.reject(error);
      this.activeSearch = null;
    }
  }

  async configure() {
    // Default configuration - can be overridden by subclasses
    return Promise.resolve();
  }

  async newGame() {
    // Stop any in-flight search before resetting. UCI requires `stop` before
    // `ucinewgame`; otherwise the engine may emit a late `bestmove` for the
    // previous position AFTER ucinewgame is processed, which would resolve a
    // stale search handler. This mirrors the search-start sequence.
    this._cancelActiveSearch();
    this._safeStop();
    // ucinewgame resets engine hash/state; readyok confirms it has been applied.
    this._send('ucinewgame');
    await this._waitForReady(8000);
  }
}

class BrowserStockfishEngine extends UciEngine {
  constructor(moduleConfig) {
    super(moduleConfig);
    this.worker = null;
    this.crashedError = null;
    this._hash = moduleConfig.hash || 32;
    this._threads = moduleConfig.threads || 1;
  }

  async configure() {
    // The niklasf/stockfish.js single-threaded WASM build defaults to
    // Hash=16 MB and Threads=1. Sending setoption Hash to a value ABOVE 16
    // can cause the WASM engine to silently abort when it tries to allocate
    // the memory, producing intermittent "Timed out waiting for readyok"
    // errors. We only set Hash when it's within the engine's supported range
    // (≤16). Threads must be 1 on this build.
    const safeHash = Math.min(this._hash || 16, 16);
    if (safeHash !== 16) {
      this._send('setoption name Hash value ' + safeHash);
    }
    // Threads is always 1 on the single-threaded build.
    // Generous timeout (15s) for WASM under load.
    const waitForReady = this._waitFor('readyok', 15000);
    this._send('isready');
    await waitForReady;
  }

  _workerUrl() {
    return new URL('/src/stockfish.worker.js', window.location.origin).href;
  }

  async init() {
    return new Promise((resolve, reject) => {
      let settled = false;
      let initTimer = null;

      const fail = (error) => {
        if (settled) return;
        settled = true;
        if (initTimer) clearTimeout(initTimer);
        reject(error);
      };

      try {
        this.worker = new Worker(this._workerUrl());
      } catch (error) {
        fail(error);
        return;
      }

      this.worker.onmessage = (event) => {
        const { type, payload } = event.data;
        if (type === 'UCI_MESSAGE') {
          this._handleTransportMessage(payload);
        } else if (type === 'READY') {
          if (initTimer) clearTimeout(initTimer);
          settled = true;
          // The worker has already completed the uciok/readyok handshake.
          // Mark the engine ready and apply main-thread-side option defaults
          // (MultiPV, Hash, Threads) so evaluate()/evaluateMultiPV() work.
          this.ready = true;
          this.configure().then(() => resolve()).catch((err) => reject(err));
        } else if (type === 'ERROR') {
          fail(new Error(payload));
        } else if (type === 'PROGRESS') {
          // Download-progress signal from the cached fetch in the worker.
          if (typeof this.onDownloadProgress === 'function') {
            try { this.onDownloadProgress(payload || {}); } catch (_) {}
          }
        }
      };

      this.worker.onerror = (event) => {
        const error = new Error(event?.message || 'Browser Stockfish crashed');
        this.crashedError = error;
        this.ready = false;
        this._failActiveSearch(error);
        fail(error);
      };

      this.worker.onmessageerror = () => {
        const error = new Error('Browser Stockfish sent an unreadable message');
        this.crashedError = error;
        this.ready = false;
        this._failActiveSearch(error);
        fail(error);
      };

      this._send({
        type: 'INIT',
        payload: {
          jsPath: this.moduleConfig.jsPath,
          wasmPath: this.moduleConfig.wasmPath,
          threads: this.moduleConfig.threads || 1,
          hash: this.moduleConfig.hash || 32,
        }
      });

      initTimer = setTimeout(() => fail(new Error('Browser engine timed out during init')), 120000);
    });
  }

  _send(cmd) {
    if (this.crashedError) {
      throw this.crashedError;
    }
    if (this.worker) {
      const payload = typeof cmd === 'string' ? { type: 'SEND', payload: cmd } : cmd;
      this.worker.postMessage(payload);
    }
  }

  destroy() {
    this._cancelActiveSearch();
    this.ready = false;
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'TERMINATE' });
      } catch (_error) {
        // Ignore shutdown errors on browser workers.
      }
      this.worker.terminate();
      this.worker = null;
    }
  }
}

// Process-wide singleton guard. The WASM Stockfish engine must be instantiated
// only once per page: a second instance re-runs the expensive JS/WASM init and,
// on some builds, collides. Callers swap modules by destroy()-ing the current
// engine before creating a new one. See project memory:
// stockfish-second-init-crashes-process / stockfish-npm-package-constraints.
let _activeBrowserEngine = null;

function createEngineController({ source, module }) {
  const moduleConfig = getEngineModuleConfig(source, module);
  // Singleton guard: reuse a healthy, ready engine across calls. BUT a previous
  // engine whose init() failed or that crashed is NOT safe to reuse — reusing
  // it defeated the module-failover retry in _initEngine (the dead instance was
  // returned forever). Treat never-ready / crashed engines as releasable: tear
  // them down and create a fresh one so the fallback module actually loads.
  if (_activeBrowserEngine && !_activeBrowserEngine._released) {
    const alive = _activeBrowserEngine.ready && !_activeBrowserEngine.crashedError;
    if (alive) {
      console.warn('createEngineController: a healthy browser engine is already active. Reusing the existing instance.');
      return _activeBrowserEngine;
    }
    console.warn('createEngineController: previous engine is not healthy (failed init or crashed). Replacing it.');
    try { _activeBrowserEngine.destroy(); } catch (_) {}
    _activeBrowserEngine = null;
  }
  const engine = new BrowserStockfishEngine(moduleConfig);
  _activeBrowserEngine = engine;
  const originalDestroy = engine.destroy.bind(engine);
  engine.destroy = (...args) => {
    const result = originalDestroy(...args);
    engine._released = true;
    if (_activeBrowserEngine === engine) _activeBrowserEngine = null;
    return result;
  };
  return engine;
}

window.ENGINE_CATALOG = ENGINE_CATALOG;
window.REVIEW_PROFILES = REVIEW_PROFILES;
window.REVIEW_STRENGTH_TIERS = REVIEW_STRENGTH_TIERS;
window.getEngineModules = getEngineModules;
window.getEngineModuleConfig = getEngineModuleConfig;
window.getReviewProfileConfig = getReviewProfileConfig;
window.getReviewStrengthTier = getReviewStrengthTier;
window.UciEngine = UciEngine;
window.BrowserStockfishEngine = BrowserStockfishEngine;
window.createEngineController = createEngineController;
