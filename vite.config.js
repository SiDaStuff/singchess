import { defineConfig, loadEnv } from 'vite';

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
    plugins: [wasmMimePlugin()],
  };
});
