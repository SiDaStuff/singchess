const {
  getPublicStats,
  incrementPublicStats,
  claimUniqueBrilliantMoves,
} = require('./_lib/firebase-stats');

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': statusCode === 200 ? 'public, max-age=20' : 'no-store',
  },
  body: JSON.stringify(body),
});

function clientIp(event) {
  return String(
    event.headers['x-nf-client-connection-ip']
    || event.headers['client-ip']
    || event.headers['x-forwarded-for']
    || ''
  ).split(',')[0].trim() || 'unknown';
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return json(200, {});
    if (event.httpMethod === 'GET') {
      const stats = await getPublicStats();
      return json(200, { stats });
    }

    if (event.httpMethod === 'POST') {
      let payload = {};
      try {
        payload = JSON.parse(event.body || '{}');
      } catch (_err) {
        return json(400, { error: 'Invalid JSON body.' });
      }

      const eventName = String(payload.event || '');
      // Rate limiting is handled by the in-memory Express middleware on this
      // route (writeLimit) — no longer a firebase rate-limit bucket.
      if (eventName === 'coach_game_started') {
        const stats = await incrementPublicStats({ coachGamesPlayed: 1 });
        return json(200, { stats, counted: true });
      }

      if (eventName === 'puzzle_solved') {
        const stats = await incrementPublicStats({ puzzlesSolved: 1 });
        return json(200, { stats, counted: true });
      }

      if (eventName === 'brilliant_move') {
        const stats = await incrementPublicStats({ brilliantMoves: 1 });
        return json(200, { stats, counted: true });
      }

      // Unknown event — reject to prevent abuse
      return json(400, { error: 'Unknown stats event.' });
    }

    return json(405, { error: 'Use GET or POST.' });
  } catch (err) {
    console.error('Public stats failed:', err);
    return json(500, { error: 'Stats are unavailable.' });
  }
};
