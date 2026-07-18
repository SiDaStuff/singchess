const { getProfile, patchProfile, requireUser, json } = require('./_lib/user-service');

function calculateRatingDelta(puzzleRating, userRating, won) {
  const expected = 1 / (1 + Math.pow(10, (puzzleRating - userRating) / 400));
  return Math.round(24 * ((won ? 1 : 0) - expected));
}

// Maximum rating delta per solve to prevent rating manipulation
const MAX_DELTA = 24;
const MIN_RATING = 100;
const MAX_RATING = 4000;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });

  try {
    const authUser = await requireUser(event);
    const body = JSON.parse(event.body || '{}');

    // Validate required fields
    const userId = String(body.userId || '').trim();
    const won = body.won === true; // Must be exactly true, not truthy
    const puzzleId = String(body.puzzleId || '').trim();
    const puzzleRating = Math.max(MIN_RATING, Math.min(MAX_RATING, Number(body.puzzleRating) || 1500));

    if (!userId || body.won === undefined) {
      return json(400, { error: 'Missing required fields: userId, won' });
    }
    if (!puzzleId) {
      return json(400, { error: 'puzzleId is required.' });
    }
    // Sanitize puzzleId to prevent injection
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(puzzleId)) {
      return json(400, { error: 'Invalid puzzleId format.' });
    }
    if (userId !== authUser.uid) return json(403, { error: 'Cannot update another user.' });
    // won must be a boolean
    if (typeof body.won !== 'boolean') return json(400, { error: 'won must be a boolean.' });

    const profile = await getProfile(authUser.uid, authUser);
    const currentRating = Math.max(MIN_RATING, Number(profile.puzzleRating) || 1500);
    const stats = {
      solved: Math.max(0, Number(profile.puzzleStats?.solved) || 0),
      attempted: Math.max(0, Number(profile.puzzleStats?.attempted) || 0),
      streak: Math.max(0, Number(profile.puzzleStats?.streak) || 0),
    };

    const delta = calculateRatingDelta(puzzleRating, currentRating, won);
    // Clamp delta to prevent extreme swings
    const clampedDelta = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, delta));
    const ratingAfter = Math.max(MIN_RATING, Math.min(MAX_RATING, currentRating + clampedDelta));
    const nextStats = {
      attempted: stats.attempted + 1,
      solved: stats.solved + (won ? 1 : 0),
      streak: won ? stats.streak + 1 : 0,
    };

    await patchProfile(authUser.uid, { puzzleRating: ratingAfter, puzzleStats: nextStats });

    return json(200, { success: true, delta: clampedDelta, ratingAfter, stats: nextStats });
  } catch (err) {
    console.error('Puzzle solve API error:', err);
    return json(err.statusCode || 500, { error: err.message || 'Could not update puzzle rating.' });
  }
};
