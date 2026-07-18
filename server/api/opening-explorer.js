// Opening explorer proxy — GET /api/opening-explorer?play=<uci,...>
//
// Looks up the opening name + White/Draw/Black stats for a played move sequence
// via the Lichess Masters explorer (server-side to avoid browser CORS and to
// keep a single SSRF-whitelisted egress). Public, no auth — it's reference data.
// Used by the review UI's opening card. The Coach `lichess_opening` tool calls
// the shared lib directly rather than this endpoint.

const { lookupOpening, normalizePlay } = require('./_lib/lichess-explorer');

const json = (statusCode, body, cache) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': cache || 'public, max-age=86400',
  },
  body: JSON.stringify(body),
});

exports.handler = async (event = {}) => {
  if ((event.httpMethod || 'GET') === 'OPTIONS') return json(200, {}, 'no-store');
  if ((event.httpMethod || 'GET') !== 'GET') return json(405, { error: 'Use GET.' }, 'no-store');

  const params = event.queryStringParameters || {};
  const play = normalizePlay(params.play);
  if (!play) return json(400, { error: 'Missing or invalid "play" (comma-separated UCI moves).' }, 'no-store');

  try {
    const result = await lookupOpening(play);
    if (result.error) return json(502, result, 'no-store');
    return json(200, result);
  } catch (err) {
    return json(502, { error: 'Opening lookup failed.' }, 'no-store');
  }
};
