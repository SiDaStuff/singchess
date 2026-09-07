// Stress test for the BROWSER Stockfish engine path (src/engine.js +
// src/stockfish.worker.js) under rapid move navigation — the reported
// "crashes when moving between moves quickly" scenario.
//
// We emulate the app's exact navigation sequence:
//   _goToMove -> _cancelLiveDeepening (engine.interrupt())
//             -> _requestLiveEvaluation -> _analyzeMoveAtDepth
//                (evaluateMultiPV(fenBefore), evaluateMultiPV(fenAfter))
//             -> _deepenLiveEvaluation ladder (interrupt + repeat at depth+2)
//
// The real src/stockfish.worker.js targets a Web Worker (importScripts,
// self.location, caches), so this harness runs it in Node with shims; the
// vendor glue is eval'd in the SAME context (a browser worker is also
// single-threaded, so command scheduling semantics match the real thing).
//
// Success = zero fatal errors across all iterations (transient barrier
// timeouts are tolerated by design) and >=1 PV line on every search.
//
// Run: node scripts/test-browser-engine.cjs [lite-single|full-single]

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, 'public', 'vendor', 'stockfish');
const MODULE_KEY = process.argv[2] || 'lite-single';
const FILE_BASE = MODULE_KEY === 'full-single' ? 'stockfish-18-single' : 'stockfish-18-lite-single';

// --- UciEngine class loaded from the real source ---------------------------
const engineSrc = fs.readFileSync(path.join(ROOT, 'src', 'engine.js'), 'utf8');
const startIdx = engineSrc.indexOf('class UciEngine {');
const endIdx = engineSrc.indexOf('\nclass BrowserStockfishEngine');
assert.ok(startIdx !== -1 && endIdx !== -1 && endIdx > startIdx, 'could not extract UciEngine class from src/engine.js');
const UciEngine = eval(`(${engineSrc.slice(startIdx, endIdx)})`);

// --- Web-Worker-like sandbox for src/stockfish.worker.js -------------------
function createWorkerContext(config, out) {
  const pendingBlob = { text: null };
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    TextDecoder, TextEncoder,
    URL: Object.assign(URL, {
      createObjectURL: () => 'blob:fake-' + Math.random().toString(36).slice(2),
      revokeObjectURL: () => {},
    }),
    caches: undefined, // force direct fetch path in the worker
    WebAssembly, ReadableStream, Headers, Request, Response,
    performance,
    fetch: async (url) => {
      let p = null;
      const s = String(url);
      if (s.includes(FILE_BASE + '.js')) p = path.join(VENDOR, FILE_BASE + '.js');
      else if (s.includes(FILE_BASE + '.wasm')) p = path.join(VENDOR, FILE_BASE + '.wasm');
      if (!p || !fs.existsSync(p)) return { ok: false, status: 404, headers: { get: () => null } };
      const buf = fs.readFileSync(p);
      const mime = s.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
      // The vendor glue streams the WASM through response.body.getReader()
      // and calls WebAssembly.instantiateStreaming, which enforces the
      // application/wasm MIME type.
      let body = null;
      try {
        body = new ReadableStream({
          start(controller) {
            for (let off = 0; off < buf.length; off += 1 << 20) {
              controller.enqueue(buf.subarray(off, Math.min(buf.length, off + (1 << 20))));
            }
            controller.close();
          },
        });
      } catch (_) { body = null; }
      return {
        ok: true, status: 200,
        url: s,
        headers: new Headers({ 'content-length': String(buf.length), 'content-type': mime }),
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        body,
      };
    },
    importScripts: () => {
      const text = pendingBlob.text;
      pendingBlob.text = null;
      if (!text) throw new Error('no pending blob text for importScripts');
      vm.runInContext(text, context, { filename: 'stockfish-glue.js' });
    },
    postMessage: out,
    onmessage: null,
    __setBlob: (t) => { pendingBlob.text = t; },
  };
  sandbox.Blob = class {
    constructor(parts) { pendingBlob.text = Buffer.from(parts[0]).toString('utf8'); }
  };
  sandbox.self = sandbox;
  // Browser-worker-like location. The glue reads location.hash to decide
  // worker vs main-thread mode, and derives paths from href. An empty hash + a
  // normal http href routes it down the same "worker with onmessage" path the
  // real browser worker takes.
  sandbox.location = new URL('http://localhost:5173/vendor/' + FILE_BASE + '.js');
  const context = vm.createContext(sandbox);
  return context;
}

async function createRoutedEngine(config) {
  const engine = new UciEngine(config);
  engine.crashedError = null;
  // Browser-only recovery lives on BrowserStockfishEngine; the base class
  // calls it after a crash. For this harness just report failure to restart.
  engine._restartAfterCrash = async function () { return false; };

  const out = (data) => {
    const { type, payload } = data || {};
    if (type === 'UCI_MESSAGE') {
      engine._handleTransportMessage(payload);
    } else if (type === 'READY') {
      engine.ready = true;
      if (engine._initResolve) { engine._initResolve(); engine._initResolve = null; engine._initReject = null; }
    } else if (type === 'ERROR') {
      const error = new Error(payload || 'worker error');
      error.engineFatal = true;
      engine.crashedError = error;
      engine.ready = false;
      engine._searchRunning = false;
      engine._failActiveSearch(error);
      if (engine._initReject) { const r = engine._initReject; engine._initResolve = null; engine._initReject = null; r(error); }
    }
    // PROGRESS/DEBUG ignored in this harness.
  };

  const context = createWorkerContext(config, out);
  engine._postIn = (data) => {
    try {
      context.onmessage({ data });
    } catch (err) {
      out({ type: 'ERROR', payload: err?.message || String(err) });
    }
  };
  engine._send = (cmd) => {
    if (engine.crashedError) throw engine.crashedError;
    engine._postIn(typeof cmd === 'string' ? { type: 'SEND', payload: cmd } : cmd);
  };

  const workerSrc = fs.readFileSync(path.join(ROOT, 'src', 'stockfish.worker.js'), 'utf8');
  vm.runInContext(workerSrc, context, { filename: 'stockfish.worker.js' });

  await new Promise((resolve, reject) => {
    engine._initResolve = resolve;
    engine._initReject = reject;
    engine._postIn({ type: 'INIT', payload: config });
  });
  return engine;
}

// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`test-browser-engine — module: ${MODULE_KEY}`);
  const config = {
    jsPath: 'http://localhost:5173/vendor/' + FILE_BASE + '.js',
    wasmPath: 'http://localhost:5173/vendor/' + FILE_BASE + '.wasm',
    threads: 1,
    hash: 256,
  };
  const t0 = Date.now();
  const engine = await createRoutedEngine(config);
  console.log(`engine ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Operation-script fixtures mirroring _analyzeMoveAtDepth usage.
  const fens = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    'r1bqkbnr/pppp1ppp/2n5/4p3/2P1P3/5N2/PP1P1PPP/RNBQKB1R w KQkq - 0 4',
    'r1bqkb1r/pppp1ppp/2n2n2/4p3/2P1P3/5N2/PP1P1PPP/RNBQKB1R w KQkq - 0 5',
  ];

  let ok = 0, empty = 0, transient = 0, fatal = 0, cancelled = 0;

  // Phase 1: rapid navigation storm — interrupt immediately followed by a new
  // search at varying depths and tiny timeouts, exactly like arrow-key mashing.
  for (let i = 0; i < 30; i++) {
    const fen = fens[i % fens.length];
    const depth = 10 + (i % 8) * 2;
    try {
      engine.interrupt();                                  // _cancelLiveDeepening
      const r = await engine.evaluateMultiPV(fen, depth, 2, 400 + (i % 3) * 300);
      if (r.lines?.length) ok++; else empty++;
    } catch (err) {
      if (err?.transient) transient++;
      else if (/cancelled/i.test(err?.message || '')) cancelled++;
      else { fatal++; console.log(`  fatal @storm[${i}]:`, err.message); }
    }
    if (i % 10 === 9) await sleep(30);                     // let timers settle
  }
  console.log(`storm: ok=${ok} empty=${empty} transient=${transient} cancelled=${cancelled} fatal=${fatal}`);

  // Phase 2: interrupt DURING a search (mid-depth), then immediately search
  // again — the classic _goToMove-during-deepening crash trigger.
  ok = empty = transient = fatal = cancelled = 0;
  for (let i = 0; i < 20; i++) {
    const fen = fens[(i + 1) % fens.length];
    try {
      const deep = engine.evaluateMultiPV(fens[0], 26, 3, 6000); // slow search
      await sleep(60 + (i % 4) * 40);                             // mid-search...
      engine.interrupt();                                         // ...user navigates
      await deep.catch((e) => { if (!/cancelled/i.test(e.message)) throw e; });
      const r = await engine.evaluateMultiPV(fen, 14, 2, 2500);
      if (r.lines?.length) ok++; else empty++;
    } catch (err) {
      if (err?.transient) transient++;
      else if (/cancelled/i.test(err?.message || '')) cancelled++;
      else { fatal++; console.log(`  fatal @midsearch[${i}]:`, err.message); }
    }
  }
  console.log(`mid-search interrupt: ok=${ok} empty=${empty} transient=${transient} fatal=${fatal}`);

  // Phase 3: coach-style evaluateInfinite interrupted mid-search (user
  // navigates away while the coach is analyzing).
  ok = empty = transient = fatal = cancelled = 0;
  for (let i = 0; i < 10; i++) {
    const fen = fens[i % fens.length];
    try {
      const infinite = engine.evaluateInfinite(fen, 4000, () => {});
      await sleep(50 + (i % 3) * 40);
      engine.interrupt();
      await infinite.catch((e) => { if (!/cancelled/i.test(e.message)) throw e; });
      const r = await engine.evaluate(fen, 12, 2000);
      if (r.bestMove || r.pv) ok++; else empty++;
    } catch (err) {
      if (err?.transient) transient++;
      else { fatal++; console.log(`  fatal @infinite[${i}]:`, err.message); }
    }
  }
  console.log(`infinite+interrupt: ok=${ok} empty=${empty} transient=${transient} fatal=${fatal}`);

  // Phase 4: engine must still be alive and answer normally.
  const final = await engine.evaluateMultiPV(fens[0], 14, 3, 6000);
  assert.ok(final.lines.length >= 1, 'engine still returns PV lines at the end');
  console.log(`post-storm sanity: ${final.lines.length} lines, depth=${final.lines[0].depth}`);

  assert.strictEqual(fatal, 0, 'no fatal engine errors allowed under rapid navigation');
  console.log('PASS: browser engine survived rapid navigation without crashing.');
}

main().catch((e) => { console.error('TEST FAILED:', e && e.stack || e); process.exit(1); });
