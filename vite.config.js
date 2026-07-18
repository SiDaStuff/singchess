import { defineConfig, loadEnv } from 'vite';

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
  };
});
