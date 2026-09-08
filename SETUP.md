# Sing CHESS — Fresh Machine Setup

Complete guide to going from a bare machine to a running dev environment (and
production deployment). Node 20 LTS required (20.x tested; Netlify pins
`NODE_VERSION = "20"`).

---

## 1. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | **20 LTS** | Includes `npm`. `node -v` to check. |
| npm | 10+ | Ships with Node 20. |
| Git | any | For cloning. |
| PM2 | latest | Production only: `npm install -g pm2`. |
| nginx | 1.22+ | Production only (API reverse proxy). |

> **Windows note:** the Stockfish native engine auto-downloads prebuilt
> binaries on win32/x64. On **linux/arm64** it *compiles from source* on first
> use — you need `sudo apt install -y g++ make wget curl` **before** starting
> the server.

---

## 2. Clone & install

```bash
git clone <your-repo-url> chess-review
cd chess-review
npm install
```

This installs everything for **both** the frontend (Vite, Tailwind) and the
server (express, firebase-admin, chess.js, …). The server's own
`server/package.json` mirrors its runtime deps so a standalone `server/` deploy
works too (a normal root install already covers it via hoisting).

---

## 3. Configure environment (`.env`)

```bash
cp .env.example .env
```

Open `.env` **at the repo root** (the server loads the root file — never
`server/.env`). Minimum required for local dev:

```ini
# Firebase Admin SDK — REQUIRED (auth, profiles, quota: everything needs it)
# Firebase Console → Project settings → Service accounts → Generate new key,
# then paste the whole JSON as ONE line (escape newlines as \n).
SERVICE_ACCOUNT={"type":"service_account",...}
REALTIME_DATABASE_URL=https://<project>-default-rtdb.firebaseio.com

# AI Coach — at least one LLM key
NVIDIA_API_KEY=nvapi-...            # required for the Coach

# Local dev convenience: skip reCAPTCHA server checks
RECAPTCHA_DISABLED=1
VITE_RECAPTCHA_SITE_KEY=            # only needed if you test captcha locally
```

Optional but useful:

```ini
LICHESS_TOKEN=lip_...               # higher lichess API rate limits
VITE_API_URL=http://localhost:3000  # default; where Vite proxies /api
# SERVER_ENGINE_POOL=1              # parallel review engines (1–4), small VMs keep 1
# ANALYSIS_WALL_CLOCK_MS=600000     # per-review wall-clock cap (default 10 min)
# EXA_API_KEY=...                   # enables coach real-time web search tool
```

> ⚠️ **Never commit `.env`.** It is gitignored — keep it that way. It holds
> the Firebase *private key*.

---

## 4. Download assets (gitignored, must be regenerated)

```bash
# Stockfish WASM for the browser worker + server fallback (~5 MB total).
# Downloads the npm tarball into public/vendor/stockfish/ and copies to
# server/vendor/stockfish/. Required — the engine will not load without it.
npm run stockfish:copy
```

Chess piece SVGs (`public/assets/pieces/cburnett/`) **are git-tracked** — no
action needed. Only if they're ever missing:

```bash
npm run pieces:build   # downloads piece PNGs (chess.com CDN)
```

### Puzzle database (optional for dev)

Local puzzles come from a SQLite DB built from the Lichess puzzle dump —
**not** in git (multi-GB). Without it, daily/local puzzles show
*"Local puzzle chunks are not built yet"* (Lichess-random puzzles still work).

```bash
npm run puzzles:build
# Useful knobs:
PUZZLE_MAX_ROWS=200000 npm run puzzles:build   # cap the import for a quick dev DB
```

---

## 5. Run it (development)

Two processes, two terminals:

```bash
# Terminal 1 — API server on :3000
npm start              # = node server/index.cjs

# Terminal 2 — Vite dev server on :5173 (proxies /api → :3000)
npm run dev
```

Open **http://localhost:5173**. Editing `src/**` hot-reloads; the dev proxy
target follows `VITE_API_URL` (default `http://localhost:3000`).

The first server start also auto-provisions the **native Stockfish binary**
into `server/vendor/stockfish-native/` (download on x64, source build on
arm64). Watch the log for `uciok` — that means the engine is ready.

### Sanity checks

```bash
curl http://localhost:3000/health            # {"ok":true}
curl -X POST http://localhost:3000/api/public-stats \
  -H "Content-Type: application/json" -d '{"event":"puzzle_solved"}'
# → 401 {"error":"Login required."}   (stats writes are auth-gated)
```

---

## 6. Production build & deploy

### Frontend (Netlify)

```bash
npm run build     # vite build → dist/ + copies stockfish.worker.js
npm run preview   # optional local check of the built bundle
```

`netlify.toml` handles the rest (publish `dist/`, security headers,
`VITE_API_URL`, `VITE_RECAPTCHA_SITE_KEY` at build time). Push to deploy.

### API server (VM behind nginx)

```bash
npm install
npm run build          # only if this box also serves dist/ (see SERVE_STATIC)
pm2 start ecosystem.config.cjs --env production
pm2 save
```

`ecosystem.config.cjs` defaults: **2 cluster instances**, `TRUST_PROXY=1`,
`SERVE_STATIC=0` (API-only; Netlify serves the SPA). Override instances with
`PM2_INSTANCES=N`.

**Stale process gotcha:** if PM2 logs say
`Cannot find module .../server/index.js`, the process list predates the
`.cjs` rename → `pm2 delete all && pm2 start ecosystem.config.cjs --env production && pm2 save`.

### nginx

```bash
sudo cp mastermind.singdevelopments.com.nginx.conf /etc/nginx/sites-available/mastermind.singdevelopments.com
sudo mkdir -p /etc/nginx/snippets
sudo cp server/data/security-headers.conf /etc/nginx/snippets/
# then fix the include paths inside the conf to /etc/nginx/snippets/security-headers.conf
sudo ln -s /etc/nginx/sites-available/mastermind.singdevelopments.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

`server/data/security-headers.conf` **must ship with the site conf** — every
location that defines its own `add_header` (vendor, SSE) includes it, because
nginx drops inherited headers in that case.

### Firebase rules

The rules in `database.rules.json` lock down client writes (profiles, stats,
abuse reports are server-only via the Admin SDK). Deploy after cloning:

```bash
firebase deploy --only database
```

---

## 7. Android build (optional — Capacitor)

```bash
npm install
npx cap add android      # first time only (android/ is normally git-tracked)
npm run build
npx cap sync android
npx cap open android     # opens Android Studio → build APK
```

App id: `com.singdev.chess`. The app points at `VITE_API_URL` — set it to the
production API before `cap sync`.

---

## 8. Troubleshooting

| Symptom | Fix |
|---------|-----|
| *"Timed out waiting for readyok/uciok"* | Stockfish assets missing → `npm run stockfish:copy`; check `server/vendor/` exists. |
| *"Local puzzle chunks are not built yet"* | Expected without the DB → `npm run puzzles:build` (or use Lichess-random puzzles). |
| WASM MIME error in browser console | nginx should serve `.wasm` as `application/wasm`; Vite dev has a plugin that fixes this locally. |
| Coach says *"LLM not configured"* | `NVIDIA_API_KEY` missing in root `.env`; restart server after editing. |
| Reviews stuck at "queued" forever | Another heavy action holds your lock → restart server (`pm2 reload chess-review`); locks are in-process by design. |
| `EADDRINUSE :3000` | Another instance is running → `pm2 list` / `npx kill-port 3000`. |
| Rate limits count every user as one IP | `TRUST_PROXY=1` not set (must be set behind nginx/Cloudflare). |

---

## Quick reference

```bash
npm run dev            # Vite dev server (:5173)
npm start              # API server (:3000)
npm run build          # production bundle → dist/
npm run stockfish:copy # (re)download engine WASM assets
npm run puzzles:build  # build local puzzle DB from Lichess dump
pm2 start ecosystem.config.cjs --env production   # production API
```
