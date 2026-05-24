const { getProfile, patchProfile, requireUser, json } = require('./_lib/user-service');

function calculateRatingDelta(puzzleRating, userRating, won) {
  const expected = 1 / (1 + Math.pow(10, (puzzleRating - userRating) / 400));
  return Math.round(24 * ((won ? 1 : 0) - expected));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });

  try {
    const authUser = await requireUser(event);
    const body = JSON.parse(event.body || '{}');
    const userId = String(body.userId || '').trim();
    const puzzleRating = Math.max(100, Math.min(Number(body.puzzleRating) || 1500, 4000));
    const won = !!body.won;

    if (!userId || body.won === undefined) {
      return json(400, { error: 'Missing required fields: userId, won' });
    }
    if (userId !== authUser.uid) return json(403, { error: 'Cannot update another user.' });

    const profile = await getProfile(authUser.uid, authUser);
    const currentRating = Math.max(100, Number(profile.puzzleRating) || 1500);
    const stats = {
      solved: Math.max(0, Number(profile.puzzleStats?.solved) || 0),
      attempted: Math.max(0, Number(profile.puzzleStats?.attempted) || 0),
      streak: Math.max(0, Number(profile.puzzleStats?.streak) || 0),
    };

    const delta = calculateRatingDelta(puzzleRating, currentRating, won);
    const ratingAfter = Math.max(100, currentRating + delta);
    const nextStats = {
      attempted: stats.attempted + 1,
      solved: stats.solved + (won ? 1 : 0),
      streak: won ? stats.streak + 1 : 0,
    };

    await patchProfile(authUser.uid, { puzzleRating: ratingAfter, puzzleStats: nextStats });

    return json(200, { success: true, delta, ratingAfter, stats: nextStats });
  } catch (err) {
    console.error('Puzzle solve API error:', err);
    return json(err.statusCode || 500, { error: err.message || 'Could not update puzzle rating.' });
  }
};
