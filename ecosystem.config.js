/**
 * PM2 ecosystem configuration for chess-review.
 * - Runs the Node server (server/index.cjs): API + serves the built frontend.
 * - 2 instances in cluster mode by default (PM2_INSTANCES to override).
 * - Environment is loaded from the REPO-ROOT .env (server/index.cjs calls
 *   dotenv on it) — NOT server/.env. Put all secrets (SERVICE_ACCOUNT, LLM
 *   keys) in the root .env, or better, inject them via your host's secret store.
 *
 * Deploy: pm2 start ecosystem.config.js --env production
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
        // key off the real client, not the proxy. Set SERVE_STATIC=0 if a
        // separate web server serves the built frontend.
        TRUST_PROXY: '1',
        SERVE_STATIC: '1',
      },
      env_production: {
        NODE_ENV: 'production',
        TRUST_PROXY: '1',
        SERVE_STATIC: '1',
      },
    },
  ],
};
