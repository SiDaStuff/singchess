/**
 * PM2 ecosystem configuration for chess-review.
 * - Runs the Node server (server/index.cjs): API + serves the built frontend.
 * - 2 instances in cluster mode by default (PM2_INSTANCES to override).
 * - Environment is loaded from the REPO-ROOT .env (server/index.cjs calls
 *   dotenv on it) — NOT server/.env. Put all secrets (SERVICE_ACCOUNT, LLM
 *   keys) in the root .env, or better, inject them via your host's secret store.
 *
 * Deploy: pm2 start ecosystem.config.cjs --env production
 *
 * NOTE: The server file is `server/index.cjs` (NOT index.js). The root
 * package.json has `"type": "module"`, so a `.js` server file would be treated
 * as ESM and break — that's why it's `.cjs`. If PM2 ever errors with
 * "Cannot find module .../server/index.js", the process list is stale (it was
 * started before the rename). Fix with: `pm2 delete all && pm2 start
 * ecosystem.config.cjs --env production && pm2 save`.
 */
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'chess-review',
      script: path.join(__dirname, 'server', 'index.cjs'),
      cwd: path.join(__dirname),
      instances: process.env.PM2_INSTANCES || 2,
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
        // Behind nginx/Cloudflare: trust X-Forwarded-For so per-IP rate limits
        // key off the real client, not the proxy.
        TRUST_PROXY: '1',
        // API-ONLY mode: Netlify serves the frontend SPA, the Oracle VM serves
        // ONLY /api/* + /vendor/* + /health. Do NOT serve dist/ from here.
        SERVE_STATIC: '0',
      },
      env_production: {
        NODE_ENV: 'production',
        TRUST_PROXY: '1',
        SERVE_STATIC: '0',
      },
    },
  ],
};
