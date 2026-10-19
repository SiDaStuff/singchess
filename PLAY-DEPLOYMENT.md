# Play BETA deployment and verification

Play uses Firebase sign-in for app identity and the official Lichess Board API for human play. The existing Node/Express VM supports the persistent NDJSON streams; Netlify continues to serve the static Vite application. Do not deploy these routes as short-lived serverless functions.

## Required server configuration

1. Generate a 32-byte key once: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Save it as server-only `PLAY_TOKEN_ENCRYPTION_KEY`. Keep it stable across restarts and retain a protected backup. Changing or losing the key requires each connected player to reconnect before analysis is unlocked. Never prefix this setting with `VITE_`.
2. Set `PLAY_LICHESS_CLIENT_ID=chess.singdevelopments.com`. Lichess supports public clients; no client secret is required. Production uses **https://chess.singdevelopments.com/play/callback**. Start the local API with `npm run dev:server`; it sets `NODE_ENV=development` and `CHESS_REVIEW_DEV_SERVER=1`, which makes OAuth return to **http://localhost:5173/play/callback**. Set `PLAY_LICHESS_DEV_REDIRECT_URI=http://127.0.0.1:5173/play/callback` if that is the Vite origin you opened; only localhost HTTP URLs are accepted for this development override. The SPA reads the callback once, waits for Firebase sign-in, posts `{code,state}` with its Firebase Bearer token to the API, then removes callback parameters from the address bar.
3. Run **one Node worker**: `PM2_INSTANCES=1`. The supplied ecosystem default is now one. Each worker multiplexes a single account stream across tabs. Lichess allows only one account event stream per access token; adding workers requires a shared external stream broker first. All data is durable in the existing SQLite database and encrypted Firebase backup path `playPrivate`. Firebase's default-deny rules keep this path unavailable to clients.
4. Apply the supplied `/api/play/` location in the VM nginx configuration. Preserve HTTP/1.1, `proxy_buffering off`, `proxy_cache off`, empty upstream `Connection`, and long read/send timeouts. Apply equivalent settings in every central ingress proxy/CDN that sits in front of the VM. Exclude these endpoints from response caching, compression that batches response chunks, and short function timeouts. Server responses include `Cache-Control: no-store, no-transform` and `X-Accel-Buffering: no`.
5. Keep Firebase Admin credentials, database storage, HTTPS and the existing origin allowlist in place. All Play API calls require Firebase Authorization headers. Lichess credentials use AES-256-GCM with app-account-bound authenticated data. They are never placed in query parameters, responses or Vite variables. OAuth codes/state are also redacted in server URL logs.

Changing the worker count in an existing PM2 deployment requires applying the ecosystem configuration, not only restarting old workers. Follow the host's normal deployment procedure. Validate nginx with `nginx -t` before reloading. No production deployment was performed during implementation.

## Official API limits implemented

The [official Board API restrictions](https://lichess.org/api#tag/Board) allow random public seeks for Rapid, Classical and Correspondence. Direct challenges additionally permit Blitz. Bullet cannot be played with this human Board API. The UI lists all requested presets; the backend independently rejects unsupported requests.

| Presets | Public matchmaking | Friend challenge |
| --- | --- | --- |
| 1+0, 2+1 | Unavailable | Unavailable |
| 3+0, 3+2, 5+0, 5+3 | Unavailable | Supported |
| 10+0, 10+5, 15+10 | Supported | Supported |
| 30+0, 30+20 | Supported | Supported |

Play currently supports standard chess. Incoming Bullet or variant challenges are rejected before accepting. Direct realtime challenges expire after approximately 20 seconds unless accepted; Play uses the documented ordinary challenge endpoint. A seek stays active only while its HTTP request remains open. Canceling or leaving the search aborts that exact upstream request. The [official seek documentation](https://lichess.org/api#tag/Board/operation/apiBoardSeek) explicitly distinguishes a stream closing from confirmation of a game: Play waits for `gameStart` or the active-games endpoint.

OAuth requests only `board:play challenge:read challenge:write`. Authorization uses S256 PKCE and an encrypted, app-user-bound, one-use state/verifier with a ten-minute expiry. Lichess access tokens have no refresh-token mechanism; expiration/revocation prompts account reconnection. Disconnecting while a game is active is prohibited. If authorization has expired, reconnect the same Lichess account so the server can verify game status before unlinking.

## API and stream behavior

All routes below are under `/api/play` and require Firebase Bearer authentication, including the callback POST. Browser streams use `fetch` and a reader rather than token-bearing EventSource URLs.

- `GET /status`: `{configured,connected,profile,activeGames,recentGames,timeControls}`. `GET /active` is a lighter active-game check. Active state is cached for four seconds and invalidated by official events. Provider failures remain errors, never invented empty active lists. A missing encryption key returns an unconfigured state only for accounts without stored connections.
- `POST /oauth/start`: `{url}`; `POST /oauth/callback` accepts `{code,state}` and returns `{connected,profile}`. `POST /disconnect` revokes the provider token before removing the connection.
- `GET /events`: shared account NDJSON. `GET /game/:id/stream`: shared game NDJSON with authoritative `gameFull`, `gameState`, and other documented game events. On reconnect, cached full state is updated with the latest game state. The server retries interruptions with bounded backoff; EOF alone is never a game result. Browser subscriptions rotate every 25 minutes to refresh Firebase authentication.
- Stream connection records are `{type:"connection",status:"connected"}` or `{type:"connection",status:"reconnecting",retryAfter}`. Fatal errors are `{type:"error",error,code}`. Empty lines are keepalives. Readiness does not imply the first game position has arrived.
- `POST /seek` accepts `{time,increment,rated,color}` with minutes/seconds and keeps NDJSON open. It requires a ready account event stream first. It emits `{type:"search",status:"searching"}` and eventually `status:"closed"`; only a real official game event/active game enters play. Cancellation aborts the request. Atomic seek leases prevent duplicate searches.
- `POST /challenge` accepts the same controls plus `username`, returning `{challenge}`. `POST /challenge/:id/accept`, `/decline`, `/cancel` use documented challenge endpoints.
- `POST /game/:id/move` accepts `{move:"e7e8q",ply:42}`. `ply` is the current authoritative UCI move count before the new move. The server validates ownership, turn, legality, promotion, position and a live stream, and atomically reserves that ply. An uncertain network submission is never automatically retried. A new deliberate manual attempt is allowed only after a real upstream `gameFull` synchronized after the failed request settled confirms the same current ply. Reopening the game subscription forces upstream resynchronization when needed; cached snapshots and ordinary gameState/clock updates cannot unlock it. Pending/accepted reservations never unlock at the same ply, and concurrent manual attempts claim one generation atomically.
- `POST /game/:id/action` accepts `action` of `abort`, `resign`, `draw-yes`, `draw-no`, `takeback-yes` or `takeback-no`.
- `GET /game/:id/pgn` returns `{pgn,game}` only after official completed status and ownership are checked. Completed exports are durably cached per app account and remain retrievable after disconnection. Upstream evaluations/opening hints are excluded; existing review analyzes the PGN after completion.

Ordinary provider requests are serialized through complete response-body consumption; persistent streams are excluded. Provider 429s impose a shared minimum 60-second cooldown and return `Retry-After`. Automatic stream reconnects respect that cooldown. Browser tabs share upstream streams and receive authoritative snapshots; private `fullId` player-URL suffixes are removed. Clients must still reconcile move submissions, interpolate clocks from event timestamps, and request fresh data after suspension. Account-changing actions serialize per app user, and disconnect refuses live searches or pending outgoing challenges as well as active games.

## Fair play

Express checks authenticated linked-account active games before `/api/analyze`, `/api/anticheat`, `/api/coach` (including tool-result), and `/api/opening-explorer`. New active games return HTTP 409 with `code:"play_fair_play"`. Linked provider errors fail closed. In-flight responses are checked every five seconds and closed if active play starts. The frontend also suspends browser WASM analysis, coaching, evaluations and suggestions across routes/tabs. Normal legal-move feedback, player-created annotations and standard controls remain available.

The guard covers this app and its authenticated account. It cannot prevent users from accessing unrelated external engines or another account/device; no such claim is made. Completed PGN remains available, while starting a review still requires the active-game guard to be clear.

## Verification completed and real-account checklist

The full existing `npm test` suite passes. Its automatic-review fixture now explicitly enables the admin-controlled beta it tests; the production default remains disabled. `npm run build` produces the production bundle. The build retains Vite's existing large-main-chunk advisory.

Play instantiates the same `src/board.js` ChessBoard component used by Review, puzzles, and coach games. `src/play/live-game-input.js` supplies online move rules without a separate renderer or pointer implementation. All game features share the synthesized effects in `src/board-sounds.js`.

Run `npm run test:play` for isolated API/state, review/fair-play and board/clock suites. The browser board suite covers pointer dragging, touch, keyboard, promotion/underpromotion, premoves and cancellation at desktop and 320px widths. Run the local Vite server (`npm run dev -- --host 127.0.0.1`), then `npm run test:ui:play` for the complete account-to-results-to-review fixture at 1440, 390 and 320px. It uses a local streaming API server and blocks external services. Screenshots are written to `artifacts/play/`. No automated test initiates real rated or casual games.

The callback removes code/state from the address bar in the document head before analytics initializes, retaining them only in tab memory until authenticated exchange. The callback also uses no-store and no-referrer headers. Completed moves produce a real PGN immediately; the official completed export later enriches rating/duration and PGN clock metadata when available. This keeps Review Game available without waiting for an export request.

Run `node scripts/test-play-api.cjs`. It uses an in-memory SQL store, local HTTP server and mocked official responses only. It covers PKCE challenge/exchange, callback expiry/replay/wrong app identity, encrypted tokens, account isolation, all preset restrictions, challenge unit conversion, incoming unsupported challenges, event/game stream sharing, chunked NDJSON, reconnect after EOF, promotion notation, legal/illegal/duplicate/turn-safe moves, seek lifecycle/cancellation, fair-play restrictions, post-completion PGN, cached PGN after unlinking, missing/changed keys, and 429 backoff. It initiates no real matches.

Before declaring production verified, use a real account in a controlled **casual** game with a consenting friend:

1. Deploy frontend, VM backend and stream proxy configuration; connect from `chess.singdevelopments.com`, cancel authorization once, then complete it. Confirm a refresh retains connection and tokens are absent from browser storage/network responses.
2. Confirm real ratings, recent games, incoming/outgoing friend challenge, challenge expiry/cancel, and an explicitly chosen Rapid casual seek/cancel. Automated tests must never create rated games.
3. Play on desktop and touch devices, including captures, both castling sides, underpromotion and a premove. Verify clocks under increment, tab suspension and network interruption. Refresh and resume; open a second tab and confirm both share live state.
4. During the live game, navigate to review, Coach and puzzles and confirm assistance remains blocked. Verify backend analysis requests also reject. Test authorization revocation and reconnect without losing the live-game restriction.
5. Finish via mate, resignation, draw and timeout as practical. Confirm final clocks/result and rating changes when actually supplied, then Review Game, download PGN, navigate all moves and explore alternatives. Disconnect and reopen the legitimately stored review.

Real OAuth consent, production ingress streaming, actual provider pairing and real-account game lifecycle require deployment/account verification and were not claimed verified by local fixtures.
