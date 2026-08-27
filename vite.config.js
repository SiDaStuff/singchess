import { defineConfig, loadEnv } from 'vite';
import path from 'path';
import fs from 'fs';
import tailwindcss from '@tailwindcss/vite';

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
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: mode === 'development',
      rollupOptions: {
        input: './index.html',
      },
    },
    optimizeDeps: {
      entries: ['./index.html'],
    },
    plugins: [tailwindcss(), wasmMimePlugin(), servePublicSvgPlugin()],
  };
});
