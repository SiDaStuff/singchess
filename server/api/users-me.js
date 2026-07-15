const { getMe, patchProfile, requireUser, json } = require('./_lib/user-service');

exports.handler = async (event) => {
  try {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return json(200, {});
    }
    if (event.httpMethod === 'POST') {
      const user = await requireUser(event);
      const body = JSON.parse(event.body || '{}');
      const profile = body.profile && typeof body.profile === 'object' ? body.profile : body;
      await patchProfile(user.uid, profile);
      return json(200, await getMe(event));
    }
    if (event.httpMethod !== 'GET') return json(405, { error: 'Use GET or POST.' });
    return json(200, await getMe(event));
  } catch (err) {
    return json(err.statusCode || 500, {
      error: err.message || 'Could not load account.',
      code: err.code,
      reason: err.reason,
    });
  }
};
