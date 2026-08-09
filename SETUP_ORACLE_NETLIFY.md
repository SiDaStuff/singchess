# Complete Setup Guide — Netlify Frontend + Oracle VM Backend

> **Architecture:** Static frontend SPA served by **Netlify** (CDN + auto HTTPS),
> calling a **Node API + Stockfish** backend on an **Oracle Cloud VM** behind nginx.

```
   ┌──────────────┐         ┌─────────────────────────────────┐
   │   Browser     │ ──HTTPS─▶│  Netlify (frontend only)         │
   │              │         │  chess.singdevelopments.com      │
   └──────────────┘         │  serves dist/ (Vite build)       │
          │                  └─────────────────────────────────┘
          │   fetch('https://chess.sidastuff.com/api/...')
          │   (VITE_API_URL baked into the bundle at build time)
          ▼
   ┌──────────────────────────────────────────────────────┐
   │  Oracle VM                                           │
   │                                                       │
   │  Internet → [Cloudflare] → nginx :443 → Node :3000    │
   │                              (TLS)        (PM2 cluster) │
   │                                           │            │
   │                                  Firebase Admin SDK    │
   │                                  Stockfish (native)    │
   └───────────────────────────────────────────────────────┘
```

| Piece | Host | Domain | Serves |
|-------|------|--------|--------|
| Frontend SPA | Netlify | `chess.singdevelopments.com` | `dist/` (static files only) |
| Backend API | Oracle VM | `chess.sidastuff.com` | `/api/*`, `/vendor/*`, `/health` only |

**Why split?** The backend needs a persistent Node process, a native Stockfish
binary, and long-lived SSE connections (game reviews run for minutes) — none of
which serverless/CDN hosting supports well. Netlify is perfect for the static SPA
and gives global CDN + free auto-renewing TLS. The Oracle "Always Free" ARM shape
(Ampere A1, up to 4 cores / 24GB RAM) is plenty for this and costs nothing.

---

## Part 1 — Prerequisites & Accounts

You need:

1. **A domain name** with DNS control (e.g. `sidastuff.com`). You'll create two
   subdomains: `chess.singdevelopments.com` (Netlify) and
   `chess.sidastuff.com` (Oracle).
2. **A Netlify account** (free tier is fine — this is a static site).
3. **An Oracle Cloud account** (free tier works; the Always Free Ampere A1 shape
   is recommended). Create a VM instance — see Part 2.
4. **A Firebase project** with Authentication + Realtime Database enabled.
5. **API keys** for at least one LLM provider (Cerebras / Groq / Mistral / llm7.io)
   for the AI Coach to work. At least one is required; more = better failover.
6. **reCAPTCHA v3** keys (optional but recommended for signup spam protection).

### Firebase setup (if not already done)

1. Go to <https://console.firebase.google.com> → **Create project**.
2. **Build → Authentication → Get started** → enable **Email/Password** (and
   Google if you want social login). Note the **Web API key** — this goes in the
   client (`src/app.js` → `_firebaseConfig`) via the `apiKey` field.
3. **Build → Realtime Database → Create database** (start in production mode;
   rule lockdown is fine — the server uses the Admin SDK which bypasses rules).
   Note the database URL: `https://<project>-default-rtdb.firebaseio.com`.
4. **Project settings → Service accounts → Generate new private key**. This JSON
   is `SERVICE_ACCOUNT` in the server `.env`. **Treat it like a root password.**
5. Copy the `apiKey`, `authDomain`, `databaseURL`, `projectId`, `storageBucket`,
   `messagingSenderId`, `appId`, `measurementId` into `src/app.js`
   `_firebaseConfig()` (they're already there if you migrated; just verify them).

---

## Part 2 — Provision the Oracle VM

### 2.1 Create the instance

1. Oracle Cloud Console → **Compute → Instances → Create instance**.
2. **Shape:** Ampere A1 Flex (Always Free eligible). 2–4 OCPUs, 12–24 GB RAM is
   ideal for Stockfish. (A micro shape works for testing but is too weak for
   reviews with many positions.)
3. **Image:** Canonical Ubuntu 22.04 (or 24.04) minimal.
4. **SSH key:** Add your public key (generate one with `ssh-keygen -t ed25519`
   if you don't have one). Save the private key — you'll need it.
5. **Create.** Note the public IP.

### 2.2 Open firewall ports

Oracle uses TWO layers of firewall — you must open both:

**A. Oracle Cloud Security List (VCN):**
- Networking → Virtual Cloud Networks → your VCN → Security Lists →
  Default Security List → **Add Ingress Rules**:
  - Source `0.0.0.0/0`, IP Protocol TCP, Destination Port **80** (HTTP, for cert)
  - Source `0.0.0.0/0`, IP Protocol TCP, Destination Port **443** (HTTPS)

**B. OS firewall (iptables — Ubuntu images ship with a restrictive ruleset):**
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```
If `netfilter-persistent` isn't installed: `sudo apt install -y iptables-persistent`.

### 2.3 Point the DNS

In your DNS provider, create an **A record**:
```
chess.sidastuff.com   A   <oracle-vm-public-ip>   TTL 3600
```
If you're using Cloudflare in front (proxy on, orange cloud), see Part 5 for the
Cloudflare-specific notes — it changes TLS termination.

### 2.4 SSH in & install everything

```bash
ssh ubuntu@<oracle-vm-public-ip>
# (the default user on Oracle Ubuntu images is 'ubuntu'; use your key)

# ── System basics ──────────────────────────────────────────────────
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nginx ufw curl ca-certificates gnupg

# ── Node.js 20 LTS (via NodeSource — Ubuntu's apt node is too old) ──
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should print v20.x

# ── Build tools for the Stockfish ARM source compile (first-run only) ─
# The native binary is downloaded as a prebuilt for x64; on the Ampere ARM
# shape it builds from source on first boot (needs g++/make/wget). x64 VMs
# can skip this — they download a prebuilt.
sudo apt install -y g++ make wget

# ── zstd (fast, low-memory puzzle DB decompression) ──────────────────
# `npm run puzzles:build` decompresses the multi-GB Lichess puzzle CSV. The
# build script prefers the system `zstd` CLI (streams with tiny memory and
# handles any compression level) and only falls back to the pure-JS fzstd
# path if `zstd` is missing. Install it to avoid OOM kills on small VMs.
sudo apt install -y zstd

# ── PM2 (process manager — keeps Node alive + restarts on crash) ────
sudo npm install -g pm2
# Make PM2 start on boot (follow the command it prints):
pm2 startup systemd
pm2 install pm2-logrotate   # rotates logs so they don't fill the disk
```

---

## Part 3 — Deploy the Backend on the VM

### 3.1 Get the code

```bash
cd ~
git clone <your-repo-url> chess-review
cd chess-review
```

(Replace `<your-repo-url>` with your GitHub/GitLab URL. If the repo is private,
set up a deploy key or use an HTTPS URL with a personal access token.)

### 3.2 Install dependencies + build assets

```bash
npm ci                          # install exact versions from package-lock.json

# One-time asset prebuilds (required on a fresh checkout):
npm run puzzles:build           # builds the puzzle DB (Lichess CSV → SQLite)
npm run build:puzzles           # alias of the above
# Piece PNGs (only if you changed piece art — skip if the repo includes them)
# npm run build:pieces

# Stockfish WASM assets for the /vendor endpoint (browser worker downloads these)
npm run stockfish:copy
```

> **Note on the puzzle DB:** `npm run puzzles:build` downloads a ~multi-GB Lichess
> puzzle CSV and compiles it to `server/data/puzzles.db` (both gitignored). This
> needs a few GB of disk + takes several minutes the first time. If your VM disk
> is small you can build it locally and `scp` the `puzzles.db` file up.
>
> **If the build dies with just `Killed`** (no error message) during
> "Decompressing puzzle database...", that's the Linux OOM killer — the old
> decompressor loaded the whole multi-GB file into RAM. The script now streams
> the decompression with bounded memory. Make sure `zstd` is installed
> (`sudo apt install -y zstd`) so it uses the fast CLI path; otherwise it falls
> back to the pure-JS fzstd streamer. Then re-run `npm run puzzles:build`.

### 3.3 Create the production `.env`

The server reads **only the repo-root `.env`** (`server/index.cjs` loads it via
dotenv). Do NOT create `server/.env`.

```bash
cp .env.example .env
nano .env      # fill in real values (see below)
```

**Required values:**

| Variable | Value |
|----------|-------|
| `SERVICE_ACCOUNT` | The full JSON from Firebase (single line, `\n` escaped). See `.env.example` format. |
| `REALTIME_DATABASE_URL` | `https://<project>-default-rtdb.firebaseio.com` |
| `LICHESS_TOKEN` | A Lichess API token (optional — only for higher rate limits on opening explorer) |
| `LLM_API_KEY` | llm7.io key (fast-tier primary). At least one LLM key is required for Coach. |
| `CEREBRAS_API_KEY` | Cerebras key (optional — adds failover) |
| `GROQ_API_KEY` | Groq key (optional — adds failover) |
| `MISTRAL_API_KEY` | Mistral key (optional — adds failover) |
| `RECAPTCHA_SECRET` | reCAPTCHA v3 server secret |
| `VITE_RECAPTCHA_SITE_KEY` | reCAPTCHA v3 browser site key |
| `RECAPTCHA_DISABLED` | Leave **empty** in production (the `.env.example` shows `1` for local dev only) |
| `SERVER_STOCKFISH_THREADS` | Optional: set to `3` (leave unset for auto = cores-1) |

> **Security:** `chmod 600 .env`. Better yet, use Oracle's secret manager / systemd
> environment to inject `SERVICE_ACCOUNT` and the LLM keys at boot instead of a
> file on disk. But a 600 `.env` owned by `ubuntu` is acceptable to start.

### 3.4 Grant yourself admin (Firebase custom claim)

Admin access is driven by the `admin: true` custom claim. Until you set it,
**no one has admin powers**:

```bash
node scripts/set-admin-claim.cjs           # prompts for your email
# or:
node scripts/set-admin-claim.cjs you@example.com
```

The user must sign out and back in for the claim to take effect.

### 3.5 Start the server with PM2

```bash
pm2 start ecosystem.config.cjs --env production
pm2 logs chess-review          # watch it boot — you should see:
#   "Stockfish native UCI ready (Stockfish 18, 3 thread(s), 128MB hash, pid=...)"
#   "API server listening at http://localhost:3000"

pm2 save                       # save the process list
```

If you see "Stockfish native UCI ready", the native binary auto-downloaded (x64)
or compiled (ARM64) successfully. If it failed, check `pm2 logs` — the
`stockfish-binary.js` resolver logs exactly which step broke.

**Smoke test from the VM itself:**
```bash
curl http://localhost:3000/health    # → {"ok":true}
```

### 3.6 Configure nginx (TLS + reverse proxy)

```bash
# ── Get a TLS certificate (Let's Encrypt via certbot) ──────────────
sudo apt install -y certbot python3-certbot-nginx

# Install the site config (the file is in your repo):
sudo cp ~/chess-review/chess.sidastuff.com.nginx.conf \
         /etc/nginx/sites-available/chess.sidastuff.com
sudo ln -sf /etc/nginx/sites-available/chess.sidastuff.com \
            /etc/nginx/sites-enabled/chess.sidastuff.com
# Remove the default site so it doesn't conflict:
sudo rm -f /etc/nginx/sites-enabled/default

# Get the cert (nginx plugin auto-edits the config for TLS):
sudo certbot --nginx -d chess.sidastuff.com \
  --redirect --agree-tos -m you@example.com --no-eff-email

sudo nginx -t && sudo systemctl reload nginx
```

> **Important about the nginx config in the repo:** `chess.sidastuff.com.nginx.conf`
> already contains the full `/etc/letsencrypt/live/...` cert paths and the
> **sticky-routing** upstream block (`hash $cookie_sid_device consistent`) that the
> AI Coach needs. After certbot runs, verify `sudo nginx -t` passes — certbot
> should have written the cert files to the paths the config already references.
> If certbot used a different path, adjust the `ssl_certificate` lines.

**Smoke test from outside:**
```bash
curl https://chess.sidastuff.com/health    # → {"ok":true}
curl -I https://chess.sidastuff.com/api/public-stats   # → 200, CORS headers present
```

### 3.7 PM2 boot persistence (so it survives reboots)

```bash
pm2 save                              # saves current process list
# The pm2 startup command from Part 2.4 should already be set; verify:
systemctl status pm2-ubuntu           # should be active/enabled
# If not, re-run: pm2 startup systemd (and follow the printed sudo command)
```

---

## Part 4 — Deploy the Frontend on Netlify

### 4.1 Connect the repo

1. <https://app.netlify.com> → **Add new site → Import from Git**.
2. Pick your repo.
3. Settings auto-fill from `netlify.toml` (already in the repo):
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
   - **Environment:** `VITE_API_URL=https://chess.sidastuff.com` (set in
     `netlify.toml` `[build.environment]`, override in the UI if needed)
4. **Deploy.** First build downloads the puzzle DB? **No** — `npm run build`
   only runs Vite (`vite build` + copies the stockfish worker). The puzzle DB is
   only built on the server (Part 3.2).

### 4.2 Set the custom domain

1. Netlify dashboard → your site → **Domain management → Add domain**.
2. Enter `chess.singdevelopments.com`.
3. Netlify gives you a CNAME (or Netlify DNS nameservers). Add to your DNS:
   ```
   chess.singdevelopments.com   CNAME   <netlify-subdomain>.netlify.app
   ```
4. Netlify auto-provisions a Let's Encrypt cert once DNS resolves. Verify the
   green lock at `https://chess.singdevelopments.com`.

### 4.3 Verify the CORS allowlist

The backend (`server/index.cjs`) must allow the Netlify origin. Check the
`allowedOrigins` set in `server/index.cjs`:

```js
const allowedOrigins = new Set([
  'https://chess.sidastuff.com',
  'https://chess.singdevelopments.com',   // ← THIS ONE (Netlify)
  // localhost entries...
]);
```

This is **already in the repo** — but if you use a different Netlify domain,
update it and redeploy the backend. The `/vendor/*` Stockfish WASM endpoint also
needs the correct CORS origin in nginx (`chess.sidastuff.com.nginx.conf`) — it's
already set to `https://chess.singdevelopments.com`.

---

## Part 5 — Optional: Cloudflare in front of the backend

The nginx config already has the Cloudflare `set_real_ip_from` ranges baked in,
so Cloudflare "just works" if you proxy `chess.sidastuff.com` through it. If you
do:

1. Cloudflare DNS: `chess.sidastuff.com` → **A record** → Oracle IP, **orange cloud** (proxied).
2. Cloudflare SSL/TLS: set to **Full (strict)** (not Flexible — Flexible breaks SSE).
3. **Rules → Configuration Rules** (or Page Rules): for `chess.sidastuff.com/api/*`,
   set:
   - **Browser Cache TTL:** Respect Existing
   - **Always Use HTTPS:** On
   - **Caching Level:** Bypass (so Cloudflare doesn't cache API responses or buffer SSE)
4. The nginx Cloudflare real-IP ranges in the config let rate limiting work with
   the real client IP behind the proxy.

If you are NOT using Cloudflare, the real-IP ranges are harmless (they just don't
match anything) — leave them.

---

## Part 6 — Verification checklist

Run through this after both halves are deployed:

- [ ] `https://chess.singdevelopments.com` loads the SPA (no console errors).
- [ ] DevTools → Network: every `/api/...` call goes to
      `https://chess.sidastuff.com` and returns 200 (no CORS errors).
- [ ] Sign up / sign in works (Firebase Auth round-trips).
- [ ] `https://chess.sidastuff.com/health` → `{"ok":true}`.
- [ ] Load a PGN in `/review` → the engine analyzes moves (Stockfish WASM loads
      from `chess.sidastuff.com/vendor/...` cross-origin — check no WASM MIME errors).
- [ ] Opening explorer card shows name + W/D/B (proves `/api/opening-explorer` works).
- [ ] `/coach` works end-to-end: send a message, it streams, browser tools
      (stockfish/game_review) resolve without a 60s hang.
- [ ] As admin: `/account` shows the admin panel (gift-boost, ban, dashboard).
- [ ] `pm2 status` shows `chess-review` online; `pm2 logs` shows no errors.
- [ ] `sudo nginx -t` passes; TLS cert valid for `chess.sidastuff.com`.

---

## Part 7 — Updating / redeploying

### Backend (Oracle VM)

```bash
cd ~/chess-review
git pull
npm ci                      # if package-lock.json changed
# rebuild assets ONLY if puzzles/piece art changed:
# npm run puzzles:build && npm run stockfish:copy
pm2 reload chess-review     # zero-downtime reload (cluster mode)
```

If `server/api/_lib/llm-service.js` or any `.env` value changed, a full restart
is safer: `pm2 restart chess-review`.

If the Stockfish source/Binary was updated upstream, delete the cache to force
re-download/compile:
```bash
rm -rf server/vendor/stockfish-native/*
pm2 restart chess-review
```

### Frontend (Netlify)

Push to your main branch → Netlify auto-builds + deploys. Or trigger a manual
deploy in the dashboard. No backend restart is needed for frontend changes.

---

## Part 8 — Troubleshooting

**`curl https://chess.sidastuff.com/health` times out / connection refused:**
- Oracle Security List: ports 80/443 open? (Part 2.2A)
- iptables: ports 80/443 accepted? (Part 2.2B)
- nginx running? `sudo systemctl status nginx`
- Node running? `pm2 status`
- Wrong: the instance is up but listening on 127.0.0.1 only (should be 0.0.0.0:3000).

**CORS errors in the browser console:**
- Confirm `chess.singdevelopments.com` is in `allowedOrigins` in `server/index.cjs`.
- Confirm nginx isn't stripping the `Access-Control-Allow-Origin` response header
  on `/vendor/` or `/api/` responses.

**SSE streams (coach, review) cut off after 60 seconds:**
- nginx `proxy_read_timeout` is too low. The repo config sets it to 600s per SSE
  endpoint — make sure your installed config matches and you've `nginx -s reload`.
- Cloudflare in front: set SSL to **Full (strict)**, NOT Flexible.

**Coach tool calls time out at 60s (the "thinking forever" bug):**
- The sticky-routing upstream (`hash $cookie_sid_device consistent`) isn't taking
  effect. After editing nginx, you must `sudo nginx -s reload`.
- Single-instance dev (`npm start`, no PM2, no nginx) won't have this bug — it's
  production cluster-only. Check `pm2 status` shows 2 instances.

**`Stockfish native UCI ready` never appears in pm2 logs:**
- ARM shape: `g++ make wget` installed? (the source compile needs them). Check the
  resolver log line above the failure — it says exactly which step failed.
- x64 shape: the GitHub download may be rate-limited. Retry
  `rm -rf server/vendor/stockfish-native/* && pm2 restart chess-review`.
- Escape hatch: `SERVER_STOCKFISH_BINARY=/path/to/your/stockfish` in `.env`
  points at a prebuilt binary you've placed on the VM.

**`No LLM provider configured` error on coach chat:**
- At least one of `LLM_API_KEY`/`CEREBRAS_API_KEY`/`GROQ_API_KEY`/`MISTRAL_API_KEY`
  must be set in `.env`. Restart PM2 after editing.

**Firebase Auth errors (`auth/internal-error`, `admin SDK not configured`):**
- `SERVICE_ACCOUNT` in `.env` malformed (the JSON must be one line with `\n`-escaped
  newlines inside the private key). Test: `node -e "console.log(require('./server/api/_lib/user-service').initAdmin())"`.

**Puzzle endpoint returns 500 / puzzles don't load:**
- `npm run puzzles:build` was never run, or `puzzles.db` is missing. Verify
  `server/data/puzzles.db` exists and is non-empty (`ls -lh server/data/`).

---

## Part 9 — File reference (what each config does)

| File | Where it lives | Purpose |
|------|----------------|---------|
| `netlify.toml` | repo root (Netlify reads it) | Frontend build settings + SPA redirect + headers |
| `vite.config.js` | repo root (dev + build) | Vite dev proxy `/api` → localhost:3000; WASM MIME fix |
| `index.html` | repo root (Vite entry) | SPA shell + CDN script tags (Firebase, chess.js, etc.) |
| `.env` (root) | **VM only, gitignored** | All server secrets (Firebase SA, LLM keys, reCAPTCHA) + `VITE_API_URL` for local dev |
| `.env.example` | repo root (committed) | Template showing every variable; no secrets |
| `ecosystem.config.cjs` | repo root | PM2 process config: 2 cluster instances, `SERVE_STATIC=0`, `TRUST_PROXY=1` |
| `chess.sidastuff.com.nginx.conf` | repo root → copied to `/etc/nginx/sites-available/` on VM | TLS, reverse proxy to :3000, SSE no-buffer, sticky routing, CORS |
| `server/index.cjs` | repo root | Express server: CORS allowlist, rate limits, /api routes, (/vendor, /health) |

**The two env-var intersections to remember:**
1. **`VITE_API_URL`** is read **at build time by Vite** and baked into the JS
   bundle. It's set on Netlify (in `netlify.toml`) to the Oracle backend URL. It
   does NOT need to exist on the VM at all.
2. **`SERVICE_ACCOUNT` + LLM keys** are read **at runtime on the VM** by Node.
   They NEVER touch Netlify — the frontend never needs them (it talks to Firebase
   directly with the client `apiKey`, which is safe to expose).
