import { defineConfig, loadEnv } from 'vite';
import path from 'path';
import fs from 'fs';
import { Chess } from 'chess.js';
import { siteOutputPlugin } from './build/site-output.js';

function homeHtmlPlugin() {
  return {
    name: 'home-html',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const game = new Chess();
        for (const move of ['e4','e5','Nf3','d6','d4','Bg4','dxe5','Bxf3','Qxf3','dxe5','Bc4','Nf6','Qb3','Qe7','Nc3','c6','Bg5','b5']) game.move(move);
        let squares = '';
        for (let rank = 8; rank > 0; rank--) for (let file = 0; file < 8; file++) {
          const square = String.fromCharCode(97 + file) + rank, piece = game.get(square);
          squares += `<div class="square ${(rank + file) % 2 ? 'dark' : 'light'}" aria-hidden="true">${piece ? `<img class="piece" width="64" height="64" src="/assets/pieces/cburnett/${piece.color}${piece.type.toUpperCase()}.svg" alt="" decoding="async">` : ''}</div>`;
        }
        const home = fs.readFileSync('src/ui/templates/home.html', 'utf8').replace('aria-label="Study position"></div>', `aria-label="Study position">${squares}</div>`);
        return html.replace('<div data-template="home"></div>', home);
      },
    },
  };
}

/**
 * Force Vite's dev server to serve .wasm files with the MIME type required by
 * WebAssembly.instantiateStreaming(). Vite usually gets this right, but older
 * versions or Windows paths can return application/octet-stream and break the
 * Stockfish worker load.
 */
function wasmMimePlugin() {
  return {
    name: 'wasm-mime',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.toLowerCase().endsWith('.wasm')) {
          res.setHeader('Content-Type', 'application/wasm');
        }
        next();
      });
    },
  };
}

/**
 * Vite's dev server intercepts .svg files for its own asset handling, which
 * prevents SVGs in the public/ directory from being served as static files.
 * This middleware serves SVG files from the public directory directly before
 * Vite's SPA fallback can intercept them.
 */
function servePublicSvgPlugin() {
  return {
    name: 'serve-public-svg',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        if (url.startsWith('/assets/pieces/') && url.endsWith('.svg')) {
          const filePath = path.resolve('public', url.replace(/^\//, ''));
          if (fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'image/svg+xml');
            res.setHeader('Cache-Control', 'max-age=3600');
            return res.end(fs.readFileSync(filePath));
          }
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const apiTarget = loadEnv(mode, process.cwd(), '').VITE_API_URL || 'http://localhost:3000';
  return {
    root: '.',
    publicDir: 'public',
    server: {
      port: 5173,
      headers: { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' },
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' } },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      // Source maps are not needed by the browser and add ~2 MB to every
      // production deploy. Keep the public CDN focused on runtime assets.
      sourcemap: false,
      target: 'es2022',
      modulePreload: false,
      rollupOptions: {
        input: './index.html',
        output: {
          // Preserve dynamic feature boundaries instead of one eager vendor.
        },
      },
    },
    optimizeDeps: {
      entries: ['./index.html'],
    },
    plugins: [homeHtmlPlugin(), wasmMimePlugin(), servePublicSvgPlugin(), siteOutputPlugin()],
  };
});
