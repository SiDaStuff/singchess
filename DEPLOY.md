# Production deployment — SiDaStuff Chess Review

## Architecture

Two separate deployments:

| Component | Where | URL | Purpose |
|-----------|-------|-----|---------|
| Frontend | Netlify | `chess.singdevelopments.com` | SPA (Vite build, `dist/`) |
| Backend | Self-hosted | `chess.sidastuff.com` | Node API server behind nginx |

The frontend calls the backend at `https://chess.sidastuff.com/api/*` via the
compile-time `VITE_API_URL` env var. SSE streams go cross-origin without issue
(fetch + ReadableStream work fine cross-origin).

---

## Frontend (Netlify)

1. In Netlify dashboard, connect the repo. Set:
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
   - **Environment variable**: `VITE_API_URL=https://chess.sidastuff.com`

   Or manually each deploy:
   ```bash
   VITE_API_URL=https://chess.sidastuff.com npm run build
   ```

2. The `netlify.toml` in the repo handles SPA fallback (`/*` → `index.html`)
   and the build config.

3. The custom domain `chess.singdevelopments.com` must be connected in
   Netlify's Domain Management.

---

## Backend (self-hosted at chess.sidastuff.com)

### 0. Rotate secrets (first deploy / after any leak)

Two divergent `.env` files existed with two different Firebase service accounts.
The server reads **only the repo-root `.env`**. Consolidate to one:

1. Rotate every key: Firebase service account (Console → Service accounts →
   generate a new one), and each LLM provider key (Cerebras / Groq / Mistral /
   llm7.io). Old keys in any old `.env` must be revoked.
2. Put the new values in the **root `.env`** (copy `.env.example` → `.env`).
   Preferably inject `SERVICE_ACCOUNT` and the LLM keys via your host's secret
   store rather than a file on disk.
3. There must be exactly ONE `.env` (root). Delete `server/.env` if it reappears.

### 1. Build (on the server, once per release)

```bash
npm ci
# Asset prebuilds (puzzle DB + piece PNGs + stockfish WASM). Required ONCE, and
# again whenever src/puzzles or piece art changes:
npm run puzzles:build
npm run pieces:build
# Vite build (outputs dist/) + copies the stockfish worker into dist/.
npm run build
```

`npm run build` already runs `prebuild` (`stockfish:copy`). The puzzle/piece
builds are NOT in `prebuild` — run them explicitly after `npm ci` on a fresh
checkout, and whenever their sources change.

### 2. Grant yourself admin (custom claims)

Admin is driven by the Firebase `admin: true` custom claim. Until you set the
claim, **no one is admin**.

```bash
node scripts/set-admin-claim.cjs           # prompts for username/email
# or:
node scripts/set-admin-claim.cjs you@example.com
```

The user must sign out and back in for the claim to take effect.

### 3. Run

```bash
pm2 start ecosystem.config.cjs --env production
# or directly:
TRUST_PROXY=1 SERVE_STATIC=0 NODE_ENV=production npm start
```

`SERVE_STATIC=0` — the backend does NOT serve frontend files (Netlify handles
that). API-only mode.

Health check: `curl https://chess.sidastuff.com/health` → `{"ok":true}`.

### 4. nginx — SSE settings (CRITICAL)

The Coach chat, server review, and anticheat endpoints stream over SSE and can
run for minutes (a deep review or a multi-round tool loop). Without these
settings the proxy **silently kills the connection at 60s**:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # SSE / long requests — do not buffer, allow 10 min:
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}
```

Since `SERVE_STATIC=0` is used, the `/` location does NOT need API-related
settings — it would be proxied to Netlify or 404.

### 5. Post-deploy smoke test

- `https://chess.singdevelopments.com` loads the SPA.
- Navigate to `/coach`, sign in — the coach works.
- Load a game in `/review` — the opening card fetches `/api/opening-explorer`
  and shows name + W/D/B stats.
- As admin: `/account` shows the admin panel (gift-boost, ban-user, dashboard).
- DevTools Network tab: all API calls go to `https://chess.sidastuff.com/api/...`.

### Known dev-only cruft (safe to leave)

- `src/stockfish.worker.js` logs every engine stdout line to browser console.
- `dist/*.html` route shims are stale pre-SPA leftovers; the SPA fallback in
  `netlify.toml` makes them unnecessary.