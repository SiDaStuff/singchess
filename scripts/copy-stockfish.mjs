import { cpSync, existsSync, mkdirSync, rmSync, createWriteStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'public', 'vendor', 'stockfish');
const targetDirFn = path.join(rootDir, 'server', 'vendor', 'stockfish');

// Stockfish 16+ single-threaded WASM builds used by both the browser worker
// (src/stockfish.worker.js) and the server engine (server/api/_lib/stockfish-engine.js).
// These files are large and therefore gitignored; download them on demand so a
// fresh checkout can build and run without manual asset drops.
const STOCKFISH_FILES = [
  { name: 'stockfish-18-lite-single.js', url: 'https://github.com/niklasf/stockfish.wasm/releases/download/sf-18/stockfish-18-lite-single.js' },
  { name: 'stockfish-18-lite-single.wasm', url: 'https://github.com/niklasf/stockfish.wasm/releases/download/sf-18/stockfish-18-lite-single.wasm' },
  { name: 'stockfish-18-single.js', url: 'https://github.com/niklasf/stockfish.wasm/releases/download/sf-18/stockfish-18-single.js' },
  { name: 'stockfish-18-single.wasm', url: 'https://github.com/niklasf/stockfish.wasm/releases/download/sf-18/stockfish-18-single.wasm' },
];

function download(url, target, redirects = 0) {
  return new Promise((resolveDownload, rejectDownload) => {
    const request = https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirects >= 6) {
          rejectDownload(new Error(`Too many redirects for ${url}`));
          return;
        }
        resolveDownload(download(new URL(response.headers.location, url).toString(), target, redirects + 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        rejectDownload(new Error(`Failed ${url}: HTTP ${response.statusCode}`));
        return;
      }
      const file = createWriteStream(target);
      response.pipe(file);
      file.on('finish', () => file.close(resolveDownload));
      file.on('error', rejectDownload);
    });
    request.setTimeout(60000, () => request.destroy(new Error(`Timed out downloading ${url}`)));
    request.on('error', rejectDownload);
  });
}

// Self-heal: if the browser vendor dir is missing (fresh checkout, gitignored
// assets), download the Stockfish WASM builds into public/vendor/stockfish.
async function ensureBrowserAssets() {
  const missing = STOCKFISH_FILES.filter((f) => !existsSync(path.join(sourceDir, f.name)));
  if (!missing.length) return;
  mkdirSync(sourceDir, { recursive: true });
  console.log(`Downloading ${missing.length} Stockfish asset(s) into ${path.relative(rootDir, sourceDir)}...`);
  for (const file of missing) {
    const target = path.join(sourceDir, file.name);
    process.stdout.write(`  ${file.name} ... `);
    try {
      await download(file.url, target);
      console.log('done');
    } catch (err) {
      console.log('FAILED');
      throw new Error(`Could not download ${file.name}: ${err.message}\nPlace it manually at ${target}.`);
    }
  }
}

await ensureBrowserAssets();

if (!existsSync(sourceDir)) {
  throw new Error(`Stockfish browser assets not found at ${sourceDir}.`);
}

// Copy the Vite-owned browser assets into the server vendor folder so the
// backend can use the same strongest available engine files when deployed.
try {
  mkdirSync(targetDirFn, { recursive: true });
  rmSync(targetDirFn, { recursive: true, force: true });
  mkdirSync(targetDirFn, { recursive: true });
  cpSync(sourceDir, targetDirFn, { recursive: true, force: true, errorOnExist: false });
  console.log(`Copied Stockfish browser assets to ${path.relative(rootDir, targetDirFn)}`);
} catch (err) {
  console.warn(`Could not copy Stockfish to functions vendor folder: ${err && err.message ? err.message : err}`);
}
console.log(`Stockfish assets available at ${path.relative(rootDir, sourceDir)} and copied to ${path.relative(rootDir, targetDirFn)}`);
