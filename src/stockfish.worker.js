/**
 * Stockfish Web Worker Wrapper
 *
 * Loads the pre-built Emscripten Stockfish module (niklasf/stockfish.js single
 * threaded build) inside a Web Worker so the UI thread stays responsive.
 *
 * Communication with the main thread:
 * - outbound: self.postMessage({ type, payload })
 * - inbound: self.onmessage = ({ data: { type, payload } }) => ...
 *
 * CRITICAL: stockfish.js's IIFE defines `print: function(stdout){postMessage(stdout)}`
 * and Emscripten captures that into a local `out` var synchronously during
 * importScripts. We therefore wrap `self.postMessage` BEFORE importScripts so
 * engine stdout is routed through handleStdout (which feeds messageHandlers AND
 * forwards structured messages to the main thread). Overriding `engine.print`
 * after importScripts is too late — Emscripten already captured the original.
 */
let engine = null;
let engineReady = false;
let messageHandlers = [];
let initPromise = null;
let scriptOnMessage = null;

// Save the original postMessage before we wrap it. This must happen at module
// load time, BEFORE any importScripts call.
const originalPostMessage = self.postMessage.bind(self);

function sendToMain(type, payload) {
  // Call the ORIGINAL postMessage (saved before wrapping) to avoid recursion.
  originalPostMessage({ type, payload });
}

function dbg(msg) {
  // Surface worker diagnostics in the browser console as well.
  try { console.log('[stockfish-worker]', msg); } catch (_) {}
  // Also send a structured DEBUG message to the main thread.
  try { originalPostMessage({ type: 'DEBUG', payload: String(msg) }); } catch (_) {}
}

function handleStdout(line) {
  if (typeof line !== 'string') line = String(line);
  // Split multi-line stdout (Emscripten sometimes batches) and process each line.
  const lines = line.split('\n');
  for (const l of lines) {
    const trimmed = l.trim();
    if (!trimmed) continue;
    dbg('stdout: ' + trimmed);
    sendToMain('UCI_MESSAGE', trimmed);
    messageHandlers.forEach((fn) => {
      try { fn(trimmed); } catch (err) {
        dbg('message handler threw: ' + (err && err.message ? err.message : err));
      }
    });
  }
}

// Track if any stdout has been received (for timeout detection). The wrapped
// self.postMessage sets this when the engine prints anything; initStockfish's
// outputMonitor consults it to tell a silent WASM hang from a healthy boot.
let _hasReceivedOutput = false;
self.postMessage = function _wrappedPostMessage(data) {
  if (typeof data === 'string') {
    _hasReceivedOutput = true;
    handleStdout(data);
    return;
  }
  originalPostMessage(data);
};

function waitForKeyword(keyword, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const detach = () => {
      messageHandlers = messageHandlers.filter((fn) => fn !== handler);
    };
    const timer = setTimeout(() => {
      detach();
      reject(new Error(`Timed out waiting for ${keyword}`));
    }, timeoutMs);
    const handler = (line) => {
      if (line.includes(keyword)) {
        clearTimeout(timer);
        detach();
        resolve(line);
      }
    };
    messageHandlers.push(handler);
  });
}

function dispatchToEngine(cmd) {
  if (!scriptOnMessage) throw new Error('Engine router not ready');
  scriptOnMessage({ data: cmd });
}

// Persistent engine cache. The Stockfish WASM is large (7MB lite / 108MB full)
// and otherwise re-downloads on every page load. We cache it via the Cache API
// keyed by its URL (the path encodes the build version), so subsequent loads
// are instant. On a cache miss we stream the response body and report
// byte-accurate progress to the main thread for the Loading Engine overlay.
const ENGINE_CACHE_NAME = 'stockfish-engine-v3';
const blobUrls = [];

function reportDownloadProgress(kind, received, total, cached) {
  sendToMain('PROGRESS', { kind, received, total, cached });
}

// Fetch `url`, caching the response. Returns an ArrayBuffer of the body.
// Streams + reports progress on a cache miss; serves instantly on a hit.
async function fetchWithCache(url, kind) {
  let cache = null;
  try {
    cache = await caches.open(ENGINE_CACHE_NAME);
    const cached = await cache.match(url);
    if (cached) {
      dbg(`${kind} cache hit: ${url}`);
      const buf = await cached.arrayBuffer();
      reportDownloadProgress(kind, buf.byteLength, buf.byteLength, true);
      return buf;
    }
  } catch (err) {
    dbg(`${kind} cache open failed (${err.message}); fetching directly`);
  }

  dbg(`${kind} cache miss, fetching: ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${kind} fetch failed: ${response.status}`);
  const total = Number(response.headers.get('Content-Length')) || 0;

  // Stream the body so we can report byte progress and cache the full result.
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    reportDownloadProgress(kind, received, total, false);
  }
  const buf = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.length;
  }
  // Persist for next load (best-effort; ignore quota/privacy errors).
  if (cache) {
    try {
      const cachedResponse = new Response(buf.slice().buffer, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      });
      await cache.put(url, cachedResponse);
    } catch (err) {
      dbg(`${kind} cache put failed (${err.message})`);
    }
  }
  return buf.buffer;
}

/**
 * Allowed origins for fetching the Stockfish JS/WASM assets. The fetched script
 * is always converted to a same-origin blob: URL before being passed to
 * importScripts(), so this validation also protects against CodeQL's
 * client-side URL-redirection warning.
 */
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://chess.sidastuff.com',
]);

function isAllowedEngineUrl(url) {
  try {
    const parsed = new URL(url, self.location.href);
    // Blob URLs we create ourselves are inherently same-origin and safe.
    if (parsed.protocol === 'blob:') return true;
    return ALLOWED_ORIGINS.has(parsed.origin);
  } catch (_) {
    return false;
  }
}

/**
 * Patch the Stockfish glue so it resolves the WASM URL via our overrides and
 * (when possible) uses a cached binary instead of re-fetching through its
 * streaming loader.
 */
function patchStockfishJs(jsText) {
  // The stockfish code: u=decodeURIComponent(e[0]||location.origin+...)
  // Replace the fallback expression with one that checks our override first.
  jsText = jsText.replace(
    /(u=decodeURIComponent\(e\[0\]\|\|)(location\.origin\+location\.pathname\.replace\([^)]+\))(\))/,
    '$1self.__stockfishWasmUrl||$2$3'
  );
  return jsText;
}

async function fetchEngineScript(url) {
  if (!isAllowedEngineUrl(url)) {
    throw new Error('Engine script URL is not from an allowed origin');
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Engine script fetch failed: ${response.status}`);
  return response.arrayBuffer();
}

async function initStockfish(config) {
  const { jsPath, wasmPath, threads, hash } = config;
  if (!jsPath || !wasmPath) {
    throw new Error('Missing jsPath or wasmPath in Stockfish config');
  }
  if (!isAllowedEngineUrl(jsPath)) {
    throw new Error('Engine script URL is not from an allowed origin');
  }
  if (!isAllowedEngineUrl(wasmPath)) {
    throw new Error('Engine WASM URL is not from an allowed origin');
  }

  const locateFile = (file) => {
    if (file.endsWith('.wasm')) return wasmPath;
    if (file.endsWith('.wasm.map')) return wasmPath + '.map';
    return jsPath;
  };

  dbg('initStockfish start, jsPath=' + jsPath + ' wasmPath=' + wasmPath);

  // Pre-fetch the engine JS + WASM through the persistent cache, reporting
  // download progress. The JS is loaded via a Blob URL (importScripts needs a
  // URL); the stockfish script's locateFile computes the wrong WASM path from
  // the blob URL, so we patch it to use self.__stockfishWasmUrl instead.
  let jsBlobUrl = null;
  let wasmBinary = null;
  let jsBuf = null;

  if (typeof caches !== 'undefined' && caches.open) {
    try {
      [jsBuf, wasmBinary] = await Promise.all([
        fetchWithCache(jsPath, 'js'),
        fetchWithCache(wasmPath, 'wasm').then((buf) => new Uint8Array(buf)),
      ]);
      dbg('engine JS + WASM fetched from cache');
    } catch (err) {
      dbg('cache fetch failed (' + err.message + '); falling back to direct fetch');
      jsBuf = null;
      wasmBinary = null;
    }
  }

  // If cache failed or is unavailable, fetch the JS directly. The WASM will be
  // loaded by the stockfish glue from wasmPath, which is validated below.
  if (!jsBuf) {
    try {
      jsBuf = await fetchEngineScript(jsPath);
    } catch (err) {
      dbg('direct JS fetch failed: ' + err.message);
      throw err;
    }
  }

  // Always load the engine JS from a same-origin blob: URL. This prevents
  // CodeQL's client-side URL-redirection warning and isolates the engine from
  // the configurable jsPath at importScripts time.
  let jsText = patchStockfishJs(new TextDecoder().decode(jsBuf));
  const jsBlob = new Blob([new TextEncoder().encode(jsText)], { type: 'text/javascript' });
  jsBlobUrl = URL.createObjectURL(jsBlob);
  blobUrls.push(jsBlobUrl);

  // Pre-seed Module with locateFile and the cached WASM bytes (if any).
  // If we have the binary already, override Emscripten's instantiateWasm so it
  // uses the cached bytes directly instead of re-fetching via streaming. This
  // avoids MIME-type failures when the server/Vite serve .wasm as octet-stream.
  self.Module = { locateFile };
  if (wasmBinary) {
    self.Module.wasmBinary = wasmBinary;
    self.Module.instantiateWasm = (imports, successCallback) => {
      try {
        WebAssembly.instantiate(wasmBinary, imports).then((output) => {
          successCallback(output.instance, output.module);
        }, (err) => {
          dbg('WASM instantiation rejected: ' + (err && err.message ? err.message : String(err)));
          throw err;
        });
        return self.Module.exports;
      } catch (err) {
        dbg('instantiateWasm threw: ' + (err && err.message ? err.message : String(err)));
        throw err;
      }
    };
  }
  // Stockfish JS derives the WASM URL from self.location (location-based
  // fallback); set this override so the patched script uses our correct
  // wasmPath instead of the blob/worker URL path.
  self.__stockfishWasmUrl = wasmPath;

  // Track if we've received any engine output — if not, the WASM likely failed.
  // _hasReceivedOutput is set by the wrapped self.postMessage (line ~64) when
  // the engine prints anything. Previously a local `anyOutput` flag was
  // declared here but never set true, so this monitor could never distinguish
  // a silent hang from a healthy boot.
  const outputMonitor = setTimeout(() => {
    if (!_hasReceivedOutput && !engineReady) {
      dbg('No engine output received — WASM may have failed to load');
      sendToMain('ERROR', 'Stockfish WASM failed to load. Check browser console for details.');
    }
  }, 15000);

  try {
    // Temporarily clear self.onmessage so the stockfish IIFE installs its own
    // command-queue router (the stockfish script does `onmessage = onmessage || fn`,
    // and if our topLevelOnMessage is already set, the stockfish handler is never
    // installed). We save the stockfish handler afterwards at line ~286.
    self.onmessage = null;
    // importScripts only ever receives a same-origin blob: URL we created,
    // never the configurable jsPath directly.
    importScripts(jsBlobUrl);
  } catch (err) {
    dbg('importScripts threw: ' + (err && err.message ? err.message : String(err)));
    clearTimeout(outputMonitor);
    // Do NOT sendToMain('ERROR') here — the outer topLevelOnMessage catch is
    // the single owner of ERROR reporting. Throwing lets it surface one clean
    // error instead of a duplicated chain.
    throw new Error('Failed to load Stockfish JS: ' + (err && err.message ? err.message : String(err)));
  }
  dbg('importScripts returned');
  engine = self.Module;
  if (!engine) {
    dbg('engine is null after importScripts');
    clearTimeout(outputMonitor);
    throw new Error('Stockfish module not found after loading script');
  }
  dbg('engine keys: ' + Object.keys(engine).slice(0, 20).join(','));

  // The IIFE installed its own onmessage (the command queue router), because we
  // cleared self.onmessage before importScripts (line ~268). Save it so we can
  // dispatch UCI commands to the engine, then restore our top-level handler so
  // main-thread messages come back to us.
  scriptOnMessage = self.onmessage;
  self.onmessage = topLevelOnMessage;
  dbg('saved scriptOnMessage=' + (typeof scriptOnMessage));

  // CRITICAL: dispatchToEngine() is SYNCHRONOUS when postRun has already fired
  // (the IIFE's queue router calls Module.ccall directly, which runs the engine
  // command inline and emits all output through print→postMessage→handleStdout
  // BEFORE dispatchToEngine returns). So we must register the response handler
  // BEFORE dispatching the command, or the response lines will be consumed by
  // handleStdout with no handler to catch them.

  // Output tracking is handled by the wrapped self.postMessage (_hasReceivedOutput).

  dbg('registering uciok handler + dispatching uci');
  const uciOkPromise = waitForKeyword('uciok', 60000);
  dispatchToEngine('uci');
  
  // Monitor: if no output at all after dispatch, the engine is dead
  let uciReceived = false;
  const uciMonitor = setTimeout(() => {
    if (!uciReceived && !engineReady) {
      dbg('No UCI output — engine may have failed');
    }
  }, 20000);
  
  try {
    await uciOkPromise;
    clearTimeout(uciMonitor);
    uciReceived = true;
  } catch (err) {
    clearTimeout(uciMonitor);
    clearTimeout(outputMonitor);
    dbg('uciok wait failed: ' + err.message);
    throw new Error('Stockfish failed UCI handshake: ' + err.message);
  }

  dbg('got uciok');
  dbg('sending isready');
  const readyOkPromise = waitForKeyword('readyok', 60000);
  dispatchToEngine('isready');
  try {
    await readyOkPromise;
  } catch (err) {
    clearTimeout(outputMonitor);
    dbg('readyok wait failed: ' + err.message);
    throw new Error('Stockfish failed isready handshake: ' + err.message);
  }
  clearTimeout(outputMonitor);
  dbg('got readyok, engine ready');
  engineReady = true;
}

const topLevelOnMessage = async (e) => {
  const { type, payload } = e.data || {};
  try {
    switch (type) {
      case 'INIT': {
        if (initPromise) return;
        initPromise = (async () => { await initStockfish(payload); })();
        try {
          await initPromise;
          sendToMain('READY');
        } catch (err) {
          sendToMain('ERROR', err && err.message ? err.message : String(err));
        }
        break;
      }

      case 'SEND': {
        if (!engine) throw new Error('Engine not initialized');
        dispatchToEngine(payload);
        break;
      }

      case 'TERMINATE': {
        engine = null;
        engineReady = false;
        initPromise = null;
        scriptOnMessage = null;
        messageHandlers = [];
        break;
      }
    }
  } catch (err) {
    sendToMain('ERROR', err && err.message ? err.message : String(err));
  }
};

self.onmessage = topLevelOnMessage;
