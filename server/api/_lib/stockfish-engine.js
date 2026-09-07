const { spawn } = require('child_process');
const { resolveStockfishBinary } = require('./stockfish-binary');

// Native Stockfish engine for the server, run as a persistent UCI child process.
//
// This replaces the former in-process WASM singleton (`stockfish` npm package).
// The lite-single WASM build is ASYNCIFY and corrupted its own heap under
// concurrency → "RuntimeError: memory access out of bounds" → dead Node
// process, with no in-process recovery (a poisoned WASM instance required a
// PM2 restart). The native binary is isolated: a crash no longer kills Node,
// and the singleton can respawn the child itself.
//
// Transport: one long-lived `stockfish` child per Node instance, fed UCI over
// stdin/stdout. No per-call spawn cost — optimized for fast repeated calls
// (game review, anticheat over many positions). Browser stays on WASM.
//
// The UCI protocol layer below (handlers, _waitFor, evaluate/evaluateMultiPV
// promise bodies, _parseInfo) is transport-agnostic: it only depends on
// this._send(cmd) and this._handleLine(line). Only the spawn/stdio plumbing
// differs from the old WASM version.
//
// One UCI stream = one search at a time, so evaluate/evaluateMultiPV/newGame
// are serialized on _operationChain (see _runExclusive). Interleaving two `go`
// commands on a single stream would corrupt it.

// Auto-detect a thread count for the engine.
//
// The engine is the process-wide singleton owned by THIS Node instance, and
// PM2 runs N cluster instances (ecosystem.config.cjs defaults PM2_INSTANCES=2),
// each spawning its OWN Stockfish child. Searches serialize per child
// (`_operationChain`: one `go` at a time), so instances can overlap.
//
// This box is a small VM: ~4 vCPU and the SAME host runs the Node backend, HTTP
// serving, and puzzle builds. Stockfish must NOT crowd the rest out — it only
// gets a slice of the cores, sized conservatively:
//
//   threads = min( floor(cores / instances), 2 )
//
//   - `floor(cores/instances)` keeps per-instance threads proportional to the
//     machine's fair share of REAL cores.
//   - the hard cap of 2 is the safety net for bursty shared hosts. Two search
//     threads (2 per instance × 2 PM2 instances = 4 at peak across the box) is
//     enough parallelism for the 200–2000ms review budgets without starving the
//     Node event loop or puzzle builds. Reviews are latency-bound at these
//     budgets; past ~2 threads a hybrid/shared vCPU returns diminishing returns
//     and only adds thread-sync overhead.
//
// SERVER_STOCKFISH_THREADS overrides the whole thing (clamped [1, 8]) — set it
// on a beefier dedicated box (e.g. =4) where Stockfish can have more. The boot
// log prints the effective count so the operator can verify.
function detectThreadCount() {
  const env = parseInt(String(process.env.SERVER_STOCKFISH_THREADS || '').trim(), 10);
  if (Number.isFinite(env) && env > 0) return Math.max(1, Math.min(env, 8));
  const os = require('os');
  // NOTE: `os.cpus?.length` would read the FUNCTION's `.length` (arity), not the
  // core count — `os.cpus()` must be CALLED. Missing this `()` silently returns
  // 1 thread on any real host.
  const cores = Math.max(1, os.cpus?.().length || 1);
  // PM2 cluster count — each instance owns its own Stockfish child.
  const instances = Math.max(1, parseInt(String(process.env.PM2_INSTANCES || '1').trim(), 10) || 1);
  const perInstance = Math.max(1, Math.floor(cores / instances));
  // Safety cap: this is a shared 4-vCPU VM (backend + puzzle builds + HTTP).
  return Math.max(1, Math.min(perInstance, 2));
}

// Hash size (MB) for the native engine. The native binary handles large hashes
// fine; 128MB is a good default for analysis. SERVER_STOCKFISH_HASH overrides.
function resolveHashMb() {
  const env = parseInt(String(process.env.SERVER_STOCKFISH_HASH || '').trim(), 10);
  if (Number.isFinite(env) && env > 0) return Math.min(env, 4096);
  return 128;
}

class ServerStockfishEngine {
  constructor(_options = {}) {
    this.child = null;
    this.ready = false;
    this.handlers = [];
    this.history = [];
    this.activeSearch = null;
    this.currentMultiPv = 1;
    // Threads/Hash applied at configure() time.
    this.threads = detectThreadCount();
    this.hashMb = resolveHashMb();
    // Default no-op sender; replaced in _startChild() once the child is up.
    this._send = () => {
      throw new Error('Stockfish child is not running');
    };
    this._operationChain = Promise.resolve();
    this._stderrBuf = [];
    this._destroyed = false;
    this._needsRespawn = false;
  }

  async init() {
    await this._startChild();
    try {
      await this._uci();
      await this.configure();
      const version = await this._getVersion().catch(() => 'unknown');
      console.log(
        `Stockfish native UCI ready (${version}, ${this.threads} thread(s), ${this.hashMb}MB hash, pid=${this.child?.pid})`
      );
      this.ready = true;
    } catch (err) {
      this.destroy();
      throw new Error(`Native Stockfish init failed: ${err.message}`);
    }
  }

  // Spawn the native binary and wire its stdio to the UCI line handler.
  async _startChild() {
    const exePath = await resolveStockfishBinary();
    const child = spawn(exePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.child = child;
    this._destroyed = false;

    // Line-buffer stdout → dispatch each complete UCI line to handlers.
    let pending = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      pending += chunk;
      let idx;
      while ((idx = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, idx).replace(/\r$/, '');
        pending = pending.slice(idx + 1);
        if (line.length) this._handleLine(line);
      }
    });

    // Keep a short stderr ring for crash diagnostics; never feed to the UCI parser.
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      this._stderrBuf.push(chunk);
      if (this._stderrBuf.length > 40) this._stderrBuf.shift();
    });

    child.on('error', (err) => this._onChildGone(err, null, null));
    child.on('exit', (code, signal) => this._onChildGone(null, code, signal));

    // Route UCI commands to the child's stdin.
    this._send = (command) => {
      if (!child.stdin || child.stdin.destroyed) {
        throw new Error('Stockfish child stdin is not writable');
      }
      child.stdin.write(command + '\n');
    };
  }

  _runExclusive(task) {
    const run = this._operationChain.catch(() => {}).then(task);
    this._operationChain = run.catch(() => {});
    return run;
  }

  _handleLine(payload) {
    for (const raw of String(payload || '').split('\n')) {
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

  async _getVersion() {
    // Stockfish prints "id name Stockfish <version>" after `uci`. Grab it from
    // recent history so we don't run an extra round-trip.
    const line = [...this.history].reverse().find((l) => l.startsWith('id name'));
    if (line) return line.replace(/^id name\s+/i, '').trim();
    return 'unknown';
  }

  async configure() {
    this._cancelActiveSearch();
    this._send('stop');
    // Explicitly pin the full-strength NNUE nets (SF 18's defaults, but pinning
    // makes a config regress fail loudly instead of silently degrading to a
    // weaker/no net — the net is what gives the search real strength per node).
    // `EvalFile` = large net (125MiB), `EvalFileSmall` = the 6MiB net used once
    // the large net is loaded for incremental evals.
    this._send('setoption name EvalFile value nn-c288c895ea92.nnue');
    this._send('setoption name EvalFileSmall value nn-37f18f62d772.nnue');
    this._send('setoption name Ponder value false');
    this._send('setoption name MultiPV value 1');
    this._send(`setoption name Threads value ${this.threads}`);
    this._send(`setoption name Hash value ${this.hashMb}`);
    this.currentMultiPv = 1;
    const wait = this._waitFor('readyok', 15000);
    this._send('isready');
    await wait;
  }

  // newGame() MUST run inside _operationChain, exactly like evaluate()/
  // evaluateMultiPV(). Even though we left WASM behind, there is still only one
  // UCI stream: ucinewgame/isready written while another request's `go` is in
  // flight would interleave on the stream and corrupt the in-flight search's
  // bestmove. Serializing newGame against all searches guarantees no command
  // ever reaches the engine while a search is running.
  async newGame() {
    return this._runExclusive(async () => {
      this._cancelActiveSearch();
      this._send('stop');
      this._send('ucinewgame');
      const wait = this._waitFor('readyok', 12000);
      this._send('isready');
      await wait;
    });
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

  // Resolve the UCI `go` command and the safety timeout from the search mode.
  //   - mode 'depth' (default): `go depth N`, timeoutMs is a hard safety cap
  //     that sends `stop` if the engine runs long.
  //   - mode 'movetime':        `go movetime N`, where N is the search budget
  //     (ms). The engine self-limits, but we keep timeoutMs as a safety cap
  //     (movetime + buffer) in case the engine ignores its limit or wedges.
  //   - mode 'depth+movetime':  `go depth N movetime M` — searches to depth N
  //     but stops early if movetime M is exceeded. Used for the two-pass review
  //     (quick-scan at moderate depth with a tight ceiling, deep re-analysis at
  //     high depth with a generous ceiling).
  _goCommand(mode, depth, movetimeMs, timeoutMs) {
    const safeDepth = Math.max(1, Math.floor(depth) || 1);
    if (mode === 'movetime') {
      const budget = Math.max(10, Math.floor(Number(movetimeMs) || 0));
      const safety = Math.max(budget + 5000, Number(timeoutMs) || budget + 5000);
      return { go: `go movetime ${budget}`, safety };
    }
    if (mode === 'depth+movetime') {
      const budget = Math.max(10, Math.floor(Number(movetimeMs) || 0));
      const safety = Math.max(budget + 5000, Number(timeoutMs) || budget + 5000);
      return { go: `go depth ${safeDepth} movetime ${budget}`, safety };
    }
    return { go: `go depth ${safeDepth}`, safety: Number(timeoutMs) || 6000 };
  }

  async evaluate(fen, depth = 18, timeoutMs = 6000, options = {}) {
    if (!this.ready) throw new Error('Engine not ready');
    return this._runExclusive(() => this._evaluate(fen, depth, timeoutMs, options));
  }

  async _evaluate(fen, depth = 18, timeoutMs = 6000, options = {}) {
    this._cancelActiveSearch();
    this._send('stop');
    await this._ensureMultiPv(1);
    const { go, safety } = this._goCommand(options.mode, depth, options.movetimeMs, timeoutMs);

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
      }, safety);
      this._addHandler(handler);
      this.activeSearch = { handler, timer, hardTimer, reject };
      this._send(`position fen ${fen}`);
      this._send(go);
    });
  }

  async evaluateMultiPV(fen, depth = 18, numPV = 3, timeoutMs = 6000, options = {}) {
    if (!this.ready) throw new Error('Engine not ready');
    return this._runExclusive(() => this._evaluateMultiPV(fen, depth, numPV, timeoutMs, options));
  }

  async _evaluateMultiPV(fen, depth = 18, numPV = 3, timeoutMs = 6000, options = {}) {
    this._cancelActiveSearch();
    this._send('stop');
    await this._ensureMultiPv(numPV);
    const { go, safety } = this._goCommand(options.mode, depth, options.movetimeMs, timeoutMs);

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
      }, safety);
      this._addHandler(handler);
      this.activeSearch = { handler, timer, hardTimer, reject };
      this._send(`position fen ${fen}`);
      this._send(go);
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

  // Unexpected child exit: mark not-ready, reject any in-flight search, and
  // flag for respawn. Unlike the WASM singleton, this is recoverable in-process
  // — the next getServerEngine() call respawns and re-inits the same instance.
  _onChildGone(err, code, signal) {
    if (this._destroyed) return; // intentional shutdown path
    const stderrTail = (this._stderrBuf || []).join('').slice(-2000);
    console.error(
      `Stockfish native child exited unexpectedly (code=${code}, signal=${signal}` +
        (err ? `, err=${err.message}` : '') + `); stderr tail:\n${stderrTail}`
    );
    this.ready = false;
    this.child = null;
    this._send = () => {
      throw new Error('Stockfish child is not running');
    };
    // Reject any in-flight search so its caller's timeout/queue fires.
    this._cancelActiveSearch();
    this._needsRespawn = true;
  }

  destroy() {
    this._destroyed = true;
    this._cancelActiveSearch();
    const child = this.child;
    if (child) {
      try {
        child.stdin.end('quit\n');
      } catch (_) {
        // ignore
      }
      // Give it 2s to exit on `quit`, then SIGTERM, then SIGKILL. Timers are
      // unref()'d so they never keep the event loop alive during teardown.
      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch (_) {}
        const forceTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch (_) {}
        }, 1500);
        forceTimer.unref();
      }, 2000);
      killTimer.unref();
    }
    this.child = null;
    this.ready = false;
    this._send = () => {
      throw new Error('Stockfish child is not running');
    };
  }
}

// ── Process-wide singleton ──────────────────────────────────────────────
// The engine is a process-wide singleton shared by all call sites
// (analyze.js, anticheat.js). PM2 runs N cluster instances, each owning its own
// child process. This module is the single owner of that one instance.
//
// Recovery model (a real improvement over the WASM version):
//   - Unsupported OS  → permanent poison (_unsupportedOs); fail fast forever.
//   - Transient fail  → (download/spawn/probe) null _singletonInit so the NEXT
//                       caller retries init() on the same instance.
//   - Child crash     → _needsRespawn=true; next getServerEngine() respawns +
//                       re-inits the same instance in-process.
let _singletonEngine = null;
let _singletonInit = null;
let _unsupportedOs = false;

async function getServerEngine(_preferFull = false) {
  // preferFull is accepted for API compatibility and ignored: the native binary
  // is always the strongest single build (AVX2, multi-threaded).
  if (_unsupportedOs) {
    throw new Error('Native Stockfish is not supported on this platform (win32/x64 or linux/x64 AVX2 required).');
  }

  // Existing healthy instance.
  if (_singletonEngine && _singletonEngine.ready) return _singletonEngine;

  // An init/respawn is already in flight: await it rather than starting a
  // second spawn. `_singletonInit` is nulled once it settles (below), so its
  // mere presence means "work in progress".
  if (_singletonInit) {
    await _singletonInit;
    if (_singletonEngine && _singletonEngine.ready) return _singletonEngine;
    // Init settled but engine still not ready (e.g. it threw and was marked
    // for retry). Fall through to the (re)spawn branch.
  }

  const engine = _singletonEngine || new ServerStockfishEngine({});
  _singletonEngine = engine;

  // (Re)spawn / first init. Covers both the very first call and recovery after
  // a child crash (_needsRespawn) or a transient init failure.
  _singletonInit = engine
    .init()
    .then(() => {
      engine._needsRespawn = false;
    })
    .catch((err) => {
      const msg = String(err?.message || err);
      if (/Unsupported platform/.test(msg)) {
        // Permanent: no amount of retrying changes process.platform.
        _unsupportedOs = true;
        _singletonEngine = null;
      } else {
        // Transient (download/spawn/probe/crash): keep the instance and flag it
        // so the next caller retries init().
        engine._needsRespawn = true;
      }
      throw err;
    })
    .finally(() => {
      // Clear the in-flight marker once settled so a later caller can retry or
      // respawn. (Doesn't affect a concurrent awaiter — they hold the promise.)
      _singletonInit = null;
    });

  await _singletonInit;
  return _singletonEngine;
}

// Non-destructive "reset": clear the hash / transposition table via a UCI
// newGame() so the next search starts clean. We deliberately do NOT destroy and
// recreate the child. Best-effort: a reset failure must never propagate. The
// preferFull arg is accepted for API compatibility and ignored.
function resetServerEngine(_preferFull = false) {
  const engine = _singletonEngine;
  if (!engine || !engine.ready) return;
  try {
    engine.newGame();
  } catch (_err) {
    // Ignore: a failed hash clear is not fatal to the next search.
  }
}

// Register one process-level teardown so PM2 reloads/sigterms don't leak the
// child. Guarded so re-requires don't double-register.
if (!process._stockfishTeardownRegistered) {
  process._stockfishTeardownRegistered = true;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, () => {
      try {
        if (_singletonEngine) _singletonEngine.destroy();
      } catch (_) {
        // ignore
      }
    });
  }
}

module.exports = { ServerStockfishEngine, getServerEngine, resetServerEngine, detectThreadCount };
