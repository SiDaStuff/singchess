/**
 * PM2 ecosystem configuration for chess-review
 * - Runs the Node server from server/index.js
 * - Keeps 2 instances in cluster mode by default (adjustable via env)
 * - Loads environment variables from server/.env
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
        NODE_ENV: 'production'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};
