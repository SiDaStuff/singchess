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
const USER_AGENT = 'Mozilla/5.0 (compatible; SiDaStuffChess/1.0; +https://lichess.org)';

// Opening phase depth cap. The Masters explorer only NAMAMES the opening within
// roughly the first 16 plies — beyond that the name is fixed and Lichess may
// reject very long `play` sequences. Cap here (defense in depth: the client
// already caps at 16, but the endpoint/tool may be called directly).
const MAX_OPENING_PLY = 16;

// Validate and normalize a play sequence: each token must look like a UCI move
// (4-5 chars: 2 file/rank from-square + 2 to-square + optional promo piece).
function normalizePlay(play) {
  const raw = String(play || '').trim();
  if (!raw) return '';
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

// Look up an opening by played UCI moves. Returns
//   { opening, white, draws, black, ... } — opening may be null if unnamed
//   { error } — only on transport failure (network down), surfaced as 502
// A Lichess non-ok response or unparseable body is treated as "no opening"
// (empty data) so a deep/odd query degrades to a graceful card-hide, not a 502.
async function lookupOpening(uciPlay) {
  const play = normalizePlay(uciPlay);
  if (!play) return { opening: null, white: 0, draws: 0, black: 0, total: 0, whitePct: 0, drawsPct: 0, blackPct: 0 };
  const url = `https://${EXPLORER_HOST}/masters?play=${encodeURIComponent(play)}&moves=0&topGames=0`;
  let res;
  try {
    res = await fetchCompat(url, { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
  } catch (_) {
    return { error: 'Could not reach the Lichess explorer.' };
  }
  if (!res || !res.ok) {
    // Non-ok from Lichess (e.g. overly long/odd query): treat as no data, not an
    // error — the card simply hides. Only transport failures (caught above) 502.
    return { opening: null, white: 0, draws: 0, black: 0, total: 0, whitePct: 0, drawsPct: 0, blackPct: 0 };
  }
  const data = await res.json().catch(() => null);
  if (!data) return { opening: null, white: 0, draws: 0, black: 0, total: 0, whitePct: 0, drawsPct: 0, blackPct: 0 };
  const opening = data.opening ? { eco: data.opening.eco || '', name: data.opening.name || '' } : null;
  const total = Math.max(1, (Number(data.white) || 0) + (Number(data.draws) || 0) + (Number(data.black) || 0));
  return {
    opening,
    white: Number(data.white) || 0,
    draws: Number(data.draws) || 0,
    black: Number(data.black) || 0,
    total,
    whitePct: Math.round(((Number(data.white) || 0) / total) * 100),
    drawsPct: Math.round(((Number(data.draws) || 0) / total) * 100),
    blackPct: Math.round(((Number(data.black) || 0) / total) * 100),
  };
}

module.exports = { lookupOpening, normalizePlay, MAX_OPENING_PLY };

module.exports = { lookupOpening, normalizePlay };
