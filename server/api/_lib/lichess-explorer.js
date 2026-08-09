// Lichess Masters opening explorer wrapper.
//
// Proxies the public endpoint https://explorer.lichess.org/masters (no API key)
// to look up the opening name + White/Draw/Black game counts for a played move
// sequence. Shared by the review UI (via /api/opening-explorer) and the Coach
// `lichess_opening` tool so the two never drift in shape.
//
// `play` is a comma-separated UCI sequence (e.g. "e2e4,e7e5,g1f3,b8c6,f1c4") —
// the format the explorer expects. We return a slim object; the raw move list
// and top games are dropped (we don't need them).

const { fetchCompat } = require('./fetch-compat');

const EXPLORER_HOST = process.env.LICHESS_EXPLORER_HOST || 'explorer.lichess.org';
const USER_AGENT = 'Mozilla/5.0 (compatible; SingChess/1.0; +https://lichess.org)';
const LICHESS_TOKEN = process.env.LICHESS_TOKEN || '';
// Per-request timeout for the upstream Lichess fetch so a hung explorer host
// degrades gracefully (empty data) instead of hanging the caller/UI.
const EXPLORER_TIMEOUT_MS = 10_000;

// Opening phase depth cap. The Masters explorer only names the opening within
// roughly the first 16 plies — beyond that the name is fixed and Lichess may
// reject very long `play` sequences. Cap here (defense in depth: the client
// already caps at 16, but the endpoint/tool may be called directly).
const MAX_OPENING_PLY = 16;

// Documented Lichess explorer filter enums. We validate + clamp incoming
// filter params to these so a caller can never inject an arbitrary value.
const VALID_SPEEDS = new Set(['ultraBullet', 'bullet', 'blitz', 'rapid', 'classical', 'correspondence']);
const VALID_RATINGS = new Set([0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500]);

function cleanFilter(raw, validSet, parser = (x) => x) {
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const v = parser(part.trim());
    if (validSet.has(v)) out.push(v);
  }
  return out;
}

// Validate and normalize a play sequence: each token must look like a UCI move
// (4-5 chars: 2 file/rank from-square + 2 to-square + optional promo piece).
// Explicitly rejects FEN strings (which contain spaces or slashes) so a bug in
// a caller can never send a full position to the masters endpoint.
function normalizePlay(play) {
  const raw = String(play || '').trim();
  if (!raw) return '';
  // FEN guard: a FEN contains spaces and/or slashes and must never be sent as `play`.
  if (raw.includes(' ') || raw.includes('/')) return '';
  const tokens = raw.split(',').map((t) => t.trim()).filter(Boolean);
  const clean = [];
  for (const t of tokens) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(t)) return ''; // reject anything malformed
    clean.push(t);
  }
  // Cap to the opening phase (see MAX_OPENING_PLY). Truncate rather than reject
  // so a caller passing a full game still gets the opening name.
  return clean.slice(0, MAX_OPENING_PLY).join(',');
}

// Empty (graceful "no data") result returned when the explorer has nothing or
// the query is unparseable — keeps the shape uniform so callers don't crash.
function emptyResult() {
  return { opening: null, white: 0, draws: 0, black: 0, total: 0, whitePct: 0, drawsPct: 0, blackPct: 0 };
}

// Fetch a single explorer variant (masters or lichess) and normalize its counts
// into {white, draws, black, total, pct}. Reused by lookupOpening.
async function fetchVariant(path, extraQuery) {
  const url = `https://${EXPLORER_HOST}${path}?moves=0&topGames=0${extraQuery}`;
  const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };
  if (LICHESS_TOKEN) headers.Authorization = `Bearer ${LICHESS_TOKEN}`;
  let res;
  try {
    res = await fetchCompat(url, { method: 'GET', headers, timeoutMs: EXPLORER_TIMEOUT_MS });
  } catch (_) {
    return { error: 'Could not reach the Lichess explorer.' };
  }
  if (!res || !res.ok) return emptyResult();
  const data = await res.json().catch(() => null);
  if (!data) return emptyResult();
  const total = Math.max(1, (Number(data.white) || 0) + (Number(data.draws) || 0) + (Number(data.black) || 0));
  return {
    white: Number(data.white) || 0,
    draws: Number(data.draws) || 0,
    black: Number(data.black) || 0,
    total,
    whitePct: Math.round(((Number(data.white) || 0) / total) * 100),
    drawsPct: Math.round(((Number(data.draws) || 0) / total) * 100),
    blackPct: Math.round(((Number(data.black) || 0) / total) * 100),
  };
}

// Look up an opening by played UCI moves.
//   options.variant  — 'masters' (default: master games, names the opening) or
//                      'lichess' (all-player rated games; filterable).
//   options.speeds   — comma list of speeds (lichess variant only).
//   options.ratings  — comma list of rating groups (lichess variant only).
// Returns { opening, white, draws, black, total, whitePct, drawsPct, blackPct }
// or { error } on transport failure. The opening NAME always comes from the
// Masters explorer (the /lichess endpoint doesn't name openings); the game
// COUNTS come from the chosen variant.
async function lookupOpening(uciPlay, options = {}) {
  const play = normalizePlay(uciPlay);
  if (!play) return { ...emptyResult() };
  const variant = options.variant === 'lichess' ? 'lichess' : 'masters';
  const playParam = `&play=${encodeURIComponent(play)}`;

  if (variant === 'lichess') {
    const speeds = cleanFilter(options.speeds, VALID_SPEEDS);
    const ratings = cleanFilter(options.ratings, VALID_RATINGS, (x) => parseInt(x, 10));
    const extra = `${playParam}` +
      (speeds.length ? `&speeds=${encodeURIComponent(speeds.join(','))}` : '') +
      (ratings.length ? `&ratings=${encodeURIComponent(ratings.join(','))}` : '');
    const stats = await fetchVariant('/lichess', extra);
    if (stats.error) return { ...emptyResult(), error: stats.error };
    // Name the opening from Masters (the /lichess endpoint doesn't name openings).
    const opening = await mastersName(playParam);
    return {
      opening,
      white: stats.white, draws: stats.draws, black: stats.black,
      total: stats.total, whitePct: stats.whitePct, drawsPct: stats.drawsPct, blackPct: stats.blackPct,
      variant: 'lichess',
    };
  }

  // masters: one call gives both name + counts.
  const stats = await fetchVariant('/masters', playParam);
  if (stats.error) return { ...emptyResult(), error: stats.error };
  const opening = await mastersName(playParam);
  return {
    opening,
    white: stats.white, draws: stats.draws, black: stats.black,
    total: stats.total, whitePct: stats.whitePct, drawsPct: stats.drawsPct, blackPct: stats.blackPct,
    variant: 'masters',
  };
}

// Fetch just the opening {eco,name} from the Masters explorer. Kept separate so
// the /lichess variant can borrow the name without re-deriving counts.
async function mastersName(playParam) {
  const url = `https://${EXPLORER_HOST}/masters?moves=0&topGames=0${playParam}`;
  const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };
  if (LICHESS_TOKEN) headers.Authorization = `Bearer ${LICHESS_TOKEN}`;
  let res;
  try {
    res = await fetchCompat(url, { method: 'GET', headers, timeoutMs: EXPLORER_TIMEOUT_MS });
  } catch (_) {
    return null;
  }
  if (!res || !res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data || !data.opening) return null;
  return { eco: data.opening.eco || '', name: data.opening.name || '' };
}

module.exports = { lookupOpening, normalizePlay, MAX_OPENING_PLY, VALID_SPEEDS, VALID_RATINGS };
