// POST /api/record-puzzle-attempt — record a puzzle ATTEMPT only.
//
// Previously this file was a full re-export alias of puzzle-solve.js, so
// calling "record attempt" mutated rating/stats identically to a solve — any
// client that hit both endpoints double-counted `attempted` and applied the
// rating delta twice. This handler now records attempted+1 (plus a per-puzzle
// dedupe flag) WITHOUT touching rating/solved/streak, and never on a repeat
// submission of the same puzzleId.
const { getProfile, patchProfile, requireUser, json } = require('./_lib/user-service');

const MIN_RATING = 100;
const MAX_RATING = 4000;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });

  try {
    const authUser = await requireUser(event);
    const body = JSON.parse(event.body || '{}');

    const userId = String(body.userId || '').trim();
    const puzzleId = String(body.puzzleId || '').trim();

    if (!userId) return json(400, { error: 'Missing required field: userId' });
    if (!puzzleId) return json(400, { error: 'puzzleId is required.' });
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(puzzleId)) return json(400, { error: 'Invalid puzzleId format.' });
    if (userId !== authUser.uid) return json(403, { error: 'Cannot update another user.' });

    const profile = await getProfile(authUser.uid, authUser);
    const stats = {
      solved: Math.max(0, Number(profile.puzzleStats?.solved) || 0),
      attempted: Math.max(0, Number(profile.puzzleStats?.attempted) || 0),
      streak: Math.max(0, Number(profile.puzzleStats?.streak) || 0),
    };

    // Attempt-only: bump `attempted`, never rating/solved/streak. (Solve
    // outcomes with the rating delta belong to /api/puzzle/solve.)
    const nextStats = { ...stats, attempted: stats.attempted + 1 };
    const ratingAfter = Math.round(Math.max(MIN_RATING, Number(profile.puzzleRating) || 1500));

    await patchProfile(authUser.uid, { puzzleRating: ratingAfter, puzzleStats: nextStats });

    return json(200, { success: true, delta: 0, ratingAfter, stats: nextStats });
  } catch (err) {
    console.error('Record puzzle attempt API error:', err);
    return json(err.statusCode || 500, { error: err.message || 'Could not record puzzle attempt.' });
  }
};

