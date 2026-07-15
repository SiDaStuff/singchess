# SiDaStuff Chess

A vanilla-JavaScript single-page application for reviewing chess games, playing
an AI coach, solving puzzles, and running server-side anti-cheat analysis.
Powered by Stockfish 18 (in the browser and on the server).

> **Stack note:** The frontend is plain ES modules (no framework). `react`,
> `react-dom`, `react-router-dom`, and `@vitejs/plugin-react` were removed —
> they were unused leftovers from an abandoned migration. Vite is retained only
> as the dev server and production bundler.

## Project structure

```
chess-review/
├── index.html              # App shell + all section markup (entry HTML)
├── src/                    # Frontend (vanilla JS, ES modules)
│   ├── main.js             # Module entry — imports the others in order
│   ├── app.js              # ChessReviewApp class: routing, review, puzzles, coach, auth
│   ├── board.js            # ChessBoard rendering + drag/click/annotations
│   ├── engine.js           # Browser Stockfish controller (Web Worker bridge)
│   ├── stockfish.worker.js # Web Worker that loads the Stockfish WASM
│   ├── chess-core.js       # MoveAnalyzer + scoring/normalization helpers
│   ├── boost.js            # Boost status/waitlist UI
│   ├── header.js, footer.js, app-dialog.js, pieces.js
├── public/                 # Static assets copied verbatim into dist/
│   ├── css/style.css       # All styles
│   ├── assets/             # Logo, piece PNGs, platform icons
│   ├── vendor/stockfish/   # Stockfish WASM builds (gitignored — self-healed on build)
│   └── *.html              # Legacy redirect shims for old deep links
├── server/                 # Express backend
│   ├── index.cjs           # API + static prod server (PM2 entry)
│   ├── dev.js              # Sets dev env and requires index.cjs
│   ├── api/                # Route handlers (analyze, anticheat, puzzle, users, patreon, ...)
│   └── _lib/               # firebase, stockfish-engine, user-service, puzzle-db, ...
├── scripts/                # Build helpers (pieces, stockfish, puzzles)
└── vite.config.js          # Dev server proxy + build config
```

## Getting started

```bash
npm install
npm run dev        # Vite dev server on :5173, proxies /api to :3000
```

The frontend talks to the Express backend. In dev you usually run both:

```bash
npm start          # Express API + static server on :3000 (in another terminal)
npm run dev        # Vite dev server on :5173 (proxies /api -> :3000)
```

## Production

```bash
npm run build     # prebuild: downloads Stockfish if missing, copies it to server/vendor
                  # build:   vite build -> dist/ (+ copies stockfish.worker.js)
npm start         # serves dist/ (or public/ if dist is absent) + the /api routes
```

The server picks `dist/` when it exists, otherwise falls back to `public/`.
Static SPA fallback: any extensionless path serves `index.html`, so deep links
(`/review`, `/puzzles`, `/boost`, ...) resolve client-side.

### Required build artifacts (gitignored, self-healed)

- `public/vendor/stockfish/` — Stockfish WASM builds. `npm run build`
  auto-downloads them via `scripts/copy-stockfish.mjs` if absent.
- `public/assets/pieces/` — piece PNGs. Run `npm run pieces:build` once.
- `server/data/puzzles.db` — puzzle database. Run `npm run puzzles:build`
  (needs the Lichess puzzle CSV in `server/data/`). Without it the puzzle API
  returns `503 puzzle_db_missing` and the UI falls back to a built-in puzzle.

## Environment variables (`server/.env`)

See `server/.env.example`. Key ones:

- `SERVICE_ACCOUNT`, `REALTIME_DATABASE_URL`, `REALTIME_DATABASE_SECRET` — Firebase admin.
- `API_BASE_URL` — injected into the served HTML as `window.__API_CONFIG.baseUrl`.
- `PATREON_CLIENT_ID`, `PATREON_CLIENT_SECRET`, `PATREON_REDIRECT_URI` — OAuth for Boost (server-side only).
- `SERVER_STOCKFISH_ENGINE` — `lite-single` (default, fastest at fixed depth) | `single` | `full`.

## Deployment (PM2)

```bash
npm run build
pm2 start ecosystem.config.js
```

`ecosystem.config.js` runs `server/index.cjs` in cluster mode (2 instances by default).

## Notes

- The backend API at `/api/*` is preserved; auth is Firebase (client SDK + admin token verification).
- Server reviews/anticheat require a logged-in user (per-UID daily quota: 3 server reviews, 1 anticheat). Browser reviews need no account.
- Stockfish scores are side-to-move-relative; consumers normalize via `whiteAbsCp` (see `src/chess-core.js`).
