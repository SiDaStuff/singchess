const users = require('./_lib/user-service');
const { requireUser, initAdmin, json } = users;
const { LIMITS, eligible, playIdentity } = require('./_lib/max-auto-review');
const linked = require('./_lib/linked-chess-service');

exports.handler = async event => {
  try {
    const user = await requireUser(event);
    const db = initAdmin().db;
    const ref = db.ref(`maxAutoReviewPrivate/accounts/${user.uid}`);
    const controls = await users.getFeatureControls(user.uid);
    const available = process.env.MAX_AUTO_REVIEW_ENABLED !== '0' && controls.features.reviewBackground;
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Provide a JSON object.' });
      if (typeof body.enabled !== 'boolean') return json(400, { error: 'enabled must be a boolean.' });
      const identity = await playIdentity(db, user.uid);
      if (body.enabled && !eligible(user._profile, identity)) return json(403, { error: 'An active Max subscription and a Lichess account connected in Play are required.' });
      if (body.enabled && !available) return json(503, { error: 'Background reviews are disabled by an administrator.' });
      const seed = body.enabled ? await linked.fetchSource('lichess', identity.username || identity.id) : null;
      const now = Date.now();
      const change = await ref.transaction(value => {
        if (value?.changedAt && now - value.changedAt < 60000) return;
        return { ...value, ...(seed ? { initialized: true, signature: `play:${String(identity.id || identity.username).toLowerCase()}`, seen: (seed.games || []).filter(linked.complete).map(linked.gameKey) } : {}), enabled: body.enabled, changedAt: now, nextPollAt: body.enabled ? now : Number.MAX_SAFE_INTEGER, status: body.enabled ? 'watching' : 'paused' };
      });
      if (!change.committed) return json(429, { error: 'Please wait a minute before changing this setting again.' });
    } else if (event.httpMethod !== 'GET') return json(405, { error: 'Use GET or POST.' });
    const id = event.queryStringParameters?.id;
    if (id) {
      if (!/^[a-f0-9]{64}$/.test(id)) return json(400, { error: 'Invalid review id.' });
      const review = (await db.ref(`maxAutoReviewPrivate/reviews/${user.uid}/${id}`).once('value')).val();
      return review ? json(200, { review }) : json(404, { error: 'Review not found.' });
    }
    const [stateSnap, workerSnap, reviewsSnap, identity] = await Promise.all([
      ref.once('value'),
      db.ref('maxAutoReviewPrivate/worker').once('value'),
      db.ref(`maxAutoReviewPrivate/reviews/${user.uid}`).orderByChild('createdAt').limitToLast(20).once('value'),
      playIdentity(db, user.uid),
    ]);
    const state = stateSnap.val() || {};
    const worker = workerSnap.val() || {};
    const reviews = reviewsSnap.val() || {};
    return json(200, { beta: true, available, eligible: available && eligible(user._profile, identity), enabled: Boolean(available && state.enabled && eligible(user._profile, identity)), status: available ? state.status || 'paused' : 'maintenance', lastCheckedAt: state.lastCheckedAt || null, workerLastTickAt: worker.lastTickAt || null, nextCheckAt: state.enabled ? state.nextPollAt || null : null, limits: LIMITS, usedToday: state.day === new Date().toISOString().slice(0, 10) ? state.count || 0 : 0, reviews: Object.values(reviews).sort((a, b) => b.createdAt - a.createdAt).map(({ review, pgn, ...metadata }) => metadata) });
  } catch (error) { return json(error instanceof SyntaxError ? 400 : error.statusCode || 500, { error: error instanceof SyntaxError ? 'Invalid JSON.' : error.statusCode ? error.message : 'Auto-review unavailable. Please try again.' }); }
};
