const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync, spawn } = require('child_process');

// Native Stockfish binary resolver for the SERVER engine.
//
// The server engine (stockfish-engine.js) used to run the `stockfish` npm
// package as an in-process WASM singleton. The lite-single WASM build is
// ASYNCIFY and corrupts its heap under concurrency, killing the Node process.
// This module replaces that with the OFFICIAL native Stockfish binary, run as
// a persistent child process by the engine class.
//
// Browser stays on WASM — this is server-only. The `stockfish` npm dependency
// in package.json is intentionally KEPT: scripts/copy-stockfish.mjs still
// downloads browser WASM assets from the npm registry for src/stockfish.worker.js.
//
// Resolution strategy:
//   1. OS/arch detection → pick an acquisition mode:
//        - win32/x64, linux/x64 → official sf_18 prebuilt AVX2 binary (download).
//        - linux/arm64          → BUILD FROM SOURCE (Stockfish ships no Ubuntu
//                                 ARM64 prebuilt; only Windows/Android have ARM
//                                 builds). Requires g++, make, and wget|curl on
//                                 the host. Result is a genuine native ARM64 SF.
//        - anything else        → clear error (no fallback).
//   2. If a cached binary + `.probe-ok` sentinel exist under
//      server/vendor/stockfish-native/, return it instantly (warm boot).
//   3. Otherwise acquire (download OR build) → extract/make → chmod (linux) →
//      health-probe (uciok). On probe failure, fall back to the cached binary
//      once, then re-acquire exactly once before throwing.
//
// Downloads use raw https (NOT server/api/_lib/fetch-compat.js): that wrapper
// is SSRF-guarded for user-driven calls and its allowlist excludes GitHub. This
// is operator-controlled bootstrap code, mirroring scripts/copy-stockfish.mjs.

const RELEASE_TAG = 'sf_18';
const VENDOR_DIR = path.resolve(__dirname, '..', '..', 'vendor', 'stockfish-native');
const PROBE_OK_FILE = '.probe-ok';
const DOWNLOAD_TIMEOUT_MS = 90_000;
const PROBE_TIMEOUT_MS = 8_000;
// Source build: ARCH for aarch64. Stockfish's Makefile supports ARCH=armv8
// (the canonical 64-bit ARM target); explicit beats ARCH=native for a
// deterministic build. `make build` auto-runs the `net` target, which calls
// scripts/net.sh to fetch the NNUE .nnue (needs wget OR curl).
const SOURCE_TARBALL_URL = `https://github.com/official-stockfish/Stockfish/archive/refs/tags/${RELEASE_TAG}.tar.gz`;
const SOURCE_BUILD_ARCH = 'armv8';
const BUILD_TIMEOUT_MS = 20 * 60 * 1000; // 20 min headroom for a cold compile

// Map the host platform to an acquisition descriptor.
//   kind 'prebuilt' → download the official sf_18 binary asset.
//   kind 'source'   → build from the sf_18 source tarball (no prebuilt exists).
// NOTE: the prebuilt Linux asset is named "ubuntu" and ships as an UNCOMPRESSED
// .tar (NOT .tar.gz). The Windows asset is a .zip. There is no Ubuntu ARM64
// prebuilt — arm64/linux builds from source instead.
function detectAsset() {
  const { platform, arch } = process;
  if (platform === 'win32' && arch === 'x64') {
    const name = 'stockfish-windows-x86-64-avx2';
    return {
      kind: 'prebuilt',
      os: 'windows',
      url: `https://github.com/official-stockfish/Stockfish/releases/download/${RELEASE_TAG}/${name}.zip`,
      extractedExeName: `${name}.exe`,
    };
  }
  if (platform === 'linux' && arch === 'x64') {
    const name = 'stockfish-ubuntu-x86-64-avx2';
    return {
      kind: 'prebuilt',
      os: 'linux',
      url: `https://github.com/official-stockfish/Stockfish/releases/download/${RELEASE_TAG}/${name}.tar`,
      extractedExeName: name,
    };
  }
  if (platform === 'linux' && arch === 'arm64') {
    // No official Ubuntu ARM64 binary — build Stockfish 18 from source.
    return {
      kind: 'source',
      os: 'linux',
      url: SOURCE_TARBALL_URL,
      arch: SOURCE_BUILD_ARCH,
      extractedExeName: 'stockfish', // `make` produces ./src/stockfish (no extension)
    };
  }
  throw new Error(
    `Unsupported platform for native Stockfish: ${platform}/${arch}. ` +
      'Supported: win32/x64, linux/x64 (AVX2), linux/arm64 (built from source).'
  );
}

// https.get + createWriteStream with manual redirect handling. GitHub release
// downloads 302 from github.com to objects.githubusercontent.com, so we must
// follow redirects ourselves. Mirrors scripts/copy-stockfish.mjs.
function downloadToFile(url, target, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        if (redirects >= 6) {
          reject(new Error(`Too many redirects downloading ${url}`));
          return;
        }
        resolve(downloadToFile(new URL(response.headers.location, url).toString(), target, redirects + 1));
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`Failed ${url}: HTTP ${status}`));
        return;
      }
      const file = fs.createWriteStream(target);
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    request.setTimeout(DOWNLOAD_TIMEOUT_MS, () =>
      request.destroy(new Error(`Timed out downloading ${url}`))
    );
    request.on('error', reject);
  });
}

// Atomic download: write to a per-pid temp file then rename. Two PM2 instances
// may both download on cold boot; rename is atomic on the same filesystem and
// the bytes are identical, so last-writer-wins is harmless.
function atomicDownload(url, target) {
  const tmp = `${target}.tmp.${process.pid}`;
  return downloadToFile(url, tmp).then(() => {
    fs.renameSync(tmp, target);
    sweepStaleTemps(path.dirname(target));
  });
}

// fs.rmSync(recursive) can transiently fail on Windows when a just-exited
// child still holds a file handle (EBUSY/ENOTEMPTY/EPERM). Retry a few times
// so a wipe-and-redownload recovery doesn't leave a half-deleted directory.
function rmSyncWithRetry(target) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = err && err.code;
      if (!['ENOTEMPTY', 'EBUSY', 'EPERM', 'EACCES'].includes(code) || attempt === 4) {
        // Not a retryable Windows lock error (or out of retries): rethrow so the
        // caller surfaces it instead of proceeding against a corrupt dir.
        throw err;
      }
    }
  }
}

// Remove .tmp.* leftovers from prior crashed downloads (older than ~1h).
function sweepStaleTemps(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_) {
    return;
  }
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.includes('.tmp.')) continue;
    const full = path.join(dir, entry);
    try {
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs > 60 * 60 * 1000) fs.unlinkSync(full);
    } catch (_) {
      // best-effort
    }
  }
}

// Extract an archive. Three shapes:
//   - Windows .zip    → PowerShell Expand-Archive (always present on Win10/11).
//                       We deliberately do NOT use `tar` here: which `tar` Node
//                       resolves depends on PATH, and GNU tar (Git Bash/MSYS)
//                       cannot read .zip ("This does not look like a tar
//                       archive"). PowerShell is the reliable Windows path.
//   - Linux .tar      → `tar -xf` (uncompressed; the prebuilt ubuntu asset).
//   - Linux .tar.gz   → `tar -xzf` (gzipped; the sf_18 source tarball).
function extractArchive(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (process.platform === 'win32') {
    const command = `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destDir}' -Force`;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
      stdio: 'pipe',
      windowsHide: true,
    });
    return;
  }
  const gzipped = /\.t?gz$/i.test(archivePath) || /\.tar\.gz$/i.test(archivePath);
  execFileSync('tar', [gzipped ? '-xzf' : '-xf', archivePath, '-C', destDir], { stdio: 'pipe' });
}

// Locate the executable inside the extracted tree without hardcoding the
// nested `stockfish/` folder (survives upstream renames). Prefer an exact name
// match anywhere under rootDir; fall back to the largest file whose base name
// starts with `stockfish`.
function findExecutable(rootDir, expectedName) {
  const candidates = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        candidates.push(full);
      }
    }
  };
  walk(rootDir);

  const exact = candidates.find((p) => path.basename(p) === expectedName);
  if (exact) return exact;

  const stockfishLike = candidates
    .filter((p) => {
      const base = path.basename(p).toLowerCase();
      if (!base.startsWith('stockfish')) return false;
      // On Windows only accept .exe; on Linux skip obvious docs/READMEs.
      return process.platform === 'win32' ? base.endsWith('.exe') : !/\.(txt|md|markdown|wasm|js)$/.test(base);
    })
    .map((p) => ({ p, size: safeSize(p) }))
    .sort((a, b) => b.size - a.size);
  if (stockfishLike.length) return stockfishLike[0].p;

  throw new Error(`Could not find Stockfish executable "${expectedName}" inside ${rootDir}.`);
}

function safeSize(p) {
  try {
    return fs.statSync(p).size;
  } catch (_) {
    return 0;
  }
}

// Health probe: run the binary, send `uci`, confirm it prints `uciok`. Catches
// corrupt/wrong-arch downloads (e.g. non-AVX2 host → SIGILL) before the engine
// tries to use the binary.
function probeBinary(exePath, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    let child;
    try {
      child = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (_) {
      resolve(false);
      return;
    }
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (!child.killed) child.stdin.end('quit\n');
      } catch (_) {}
      try {
        child.kill();
      } catch (_) {}
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      if (buf.includes('uciok')) done(true);
    });
    child.on('error', () => done(false));
    child.on('exit', () => done(buf.includes('uciok')));
    try {
      child.stdin.write('uci\n');
    } catch (_) {
      done(false);
    }
  });
}

// Full acquire: download (or build) → extract/make → locate → chmod → probe.
async function acquire(asset, archivePath, extractDir, exePath) {
  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  if (asset.kind === 'source') {
    await buildFromSource(asset, archivePath, extractDir, exePath);
  } else {
    await atomicDownload(asset.url, archivePath);
    // Fresh extraction into a clean dir so stale files don't linger.
    fs.rmSync(extractDir, { recursive: true, force: true });
    extractArchive(archivePath, extractDir);
    const resolved = findExecutable(extractDir, asset.extractedExeName);
    // Move the executable into its final stable path so consumers always read
    // from VENDOR_DIR/<extractedExeName>, regardless of the archive layout.
    if (resolved !== exePath) {
      fs.copyFileSync(resolved, exePath);
    }
    if (asset.os === 'linux') {
      fs.chmodSync(exePath, 0o755);
    }
    const ok = await probeBinary(exePath);
    if (!ok) {
      throw new Error(`Stockfish binary failed its uciok health probe at ${exePath}`);
    }
  }
  return exePath;
}

// Verify the host has the toolchain needed to build Stockfish from source:
// g++, make, and wget OR curl (the `net` target fetches the NNUE file).
// Throws a single, actionable error listing exactly what to install.
function checkBuildTools() {
  const missing = [];
  const required = ['g++', 'make'];
  for (const tool of required) {
    if (!commandExists(tool)) missing.push(tool);
  }
  const hasNetFetcher = commandExists('wget') || commandExists('curl');
  if (!hasNetFetcher) missing.push('wget or curl');
  if (missing.length) {
    throw new Error(
      'Cannot build Stockfish from source: missing build tools (' +
        missing.join(', ') +
        '). On Debian/Ubuntu run: sudo apt update && sudo apt install -y g++ make wget curl'
    );
  }
}

// `command -v <tool>` in a shell. Synchronous, no shell injection (args are
// literals). Returns true if the tool is on PATH.
function commandExists(tool) {
  try {
    execFileSync('sh', ['-c', `command -v ${tool}`], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

// Build Stockfish from the sf_18 source tarball (the ARM64/Linux path — no
// official prebuilt exists). Steps:
//   1. check toolchain (g++, make, wget|curl).
//   2. download + extract the source tarball (.tar.gz → tar -xzf).
//   3. locate the src/ dir (it nests under Stockfish-<tag>/).
//   4. `make build ARCH=<arch> -jN` (also fetches the NNUE net via net.sh).
//   5. copy the produced ./src/stockfish to exePath, chmod +x, probe.
// The compile takes ~1-2 min on a typical ARM core; the timeout is generous.
async function buildFromSource(asset, archivePath, extractDir, exePath) {
  checkBuildTools();

  await atomicDownload(asset.url, archivePath);
  fs.rmSync(extractDir, { recursive: true, force: true });
  extractArchive(archivePath, extractDir);

  // Source extracts to Stockfish-<tag>/src/. Don't hardcode the version dir;
  // match the basename so it works across path separators.
  const srcDir = findDirContaining(extractDir, 'Makefile', (d) => path.basename(d) === 'src');
  if (!srcDir) {
    throw new Error('Stockfish source archive did not contain a src/Makefile.');
  }

  // Parallelism for the compile: leave one core for the event loop.
  const os = require('os');
  const jobs = Math.max(1, (os.cpus()?.length || 1) - 1);
  console.log(
    `Building Stockfish from source (ARCH=${asset.arch}, -j${jobs}) in ${srcDir}... ` +
      'this runs once (~1-2 min).'
  );
  // `make build` runs the `net` target (NNUE download) then config-sanity then
  // compiles. Capture stderr so a toolchain failure surfaces in the thrown error.
  let buildErr = null;
  try {
    execFileSync(
      'make',
      ['build', `ARCH=${asset.arch}`, `-j${jobs}`],
      { cwd: srcDir, stdio: 'pipe', timeout: BUILD_TIMEOUT_MS }
    );
  } catch (err) {
    buildErr = err;
  }

  if (buildErr) {
    const stderr = buildErr.stderr ? buildErr.stderr.toString().slice(-3000) : '';
    throw new Error(
      `Stockfish source build failed (${asset.arch}): ${buildErr.message}` +
        (stderr ? `\n--- build stderr (tail) ---\n${stderr}` : '')
    );
  }

  // The build produces ./src/stockfish (no extension). Locate + stage it.
  const built = path.join(srcDir, 'stockfish');
  if (!fs.existsSync(built)) {
    // Fallback: scan in case the output name differs.
    const found = findExecutable(srcDir, 'stockfish');
    fs.copyFileSync(found, exePath);
  } else {
    fs.copyFileSync(built, exePath);
  }
  fs.chmodSync(exePath, 0o755);

  const ok = await probeBinary(exePath);
  if (!ok) {
    throw new Error(`Stockfish source build succeeded but the binary failed its uciok probe at ${exePath}`);
  }
  return exePath;
}

// Find the first directory under root (recursively) that contains a child file
// named childName and (optionally) matches predicate(dirPath). Used to locate
// src/ inside the versioned Stockfish-<tag>/ tree without hardcoding the tag.
function findDirContaining(root, childName, predicate) {
  let result = null;
  const walk = (dir) => {
    if (result) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    const hasChild = entries.some((e) => e.isFile() && e.name === childName);
    if (hasChild && (!predicate || predicate(dir))) {
      result = dir;
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      if (result) return;
    }
  };
  walk(root);
  return result;
}

// Public entry: resolve a working native Stockfish binary path, downloading or
// building as needed. Throws on unsupported OS or unrecoverable failure.
async function resolveStockfishBinary() {
  // Operator escape hatch: if SERVER_STOCKFISH_BINARY points at a working
  // binary, probe it and use it directly, skipping all download/build logic.
  // Useful on hosts without the prebuilt (e.g. a manually-compiled ARM64
  // build) or for pinning a specific binary. Probed on every boot; a bad path
  // falls through to the normal acquire flow.
  const override = String(process.env.SERVER_STOCKFISH_BINARY || '').trim();
  if (override && fs.existsSync(override)) {
    if (await probeBinary(override).catch(() => false)) {
      return override;
    }
    console.warn(
      `SERVER_STOCKFISH_BINARY=${override} exists but failed its uciok probe; ` +
        'falling back to automatic acquire.'
    );
  }

  const asset = detectAsset(); // throws on unsupported OS
  const exePath = path.join(VENDOR_DIR, asset.extractedExeName);
  const probeOkPath = path.join(VENDOR_DIR, PROBE_OK_FILE);
  const archivePath = path.join(VENDOR_DIR, path.basename(new URL(asset.url).pathname));
  const extractDir = path.join(VENDOR_DIR, 'extract');

  // Fast path: cached + already probed.
  if (fs.existsSync(exePath) && fs.existsSync(probeOkPath)) {
    return exePath;
  }

  try {
    await acquire(asset, archivePath, extractDir, exePath);
    fs.writeFileSync(probeOkPath, String(Date.now()));
    return exePath;
  } catch (firstErr) {
    // Cached binary present but probe failed this boot: try the cache once
    // before re-downloading.
    if (fs.existsSync(exePath) && (await probeBinary(exePath).catch(() => false))) {
      fs.writeFileSync(probeOkPath, String(Date.now()));
      return exePath;
    }
    // Probe failed against the cache (or no cache): wipe and re-download once.
    // rmSync can transiently fail on Windows (EBUSY/ENOTEMPTY/EPERM) when a
    // just-killed probe process's file handle hasn't been released yet; retry.
    rmSyncWithRetry(VENDOR_DIR);
    try {
      await acquire(asset, archivePath, extractDir, exePath);
      fs.writeFileSync(probeOkPath, String(Date.now()));
      return exePath;
    } catch (secondErr) {
      throw new Error(
        `Could not obtain a working native Stockfish binary: ${secondErr.message} ` +
          `(initial attempt: ${firstErr.message})`
      );
    }
  }
}

module.exports = {
  resolveStockfishBinary,
  detectAsset, // exported for tests
  probeBinary, // exported for tests
  checkBuildTools, // exported for tests
  findDirContaining, // exported for tests
};
