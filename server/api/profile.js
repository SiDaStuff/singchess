const { getPublicProfileByUsername, json } = require('./_lib/user-service');

// Public profile lookup. Returns ONLY public-safe fields (no email/uid/tokens).
// GET /api/profile?username=<name>  — query-param form (works with the Netlify-
// style handler signature this server uses; Express passes req.query).
// Honors profile.isPublic (default true); opted-out → 404.
exports.handler = async (event = {}) => {
  try {
    if (event.httpMethod === 'OPTIONS') return json(200, {});
    if ((event.httpMethod || 'GET') !== 'GET') return json(405, { error: 'Use GET.' });
    const username = String(
      event.queryStringParameters?.username
      || event.query?.username
      || event.pathUsername
      || ''
    );
    const profile = await getPublicProfileByUsername(username);
    if (!profile) return json(404, { error: 'Profile not found.' });
    return json(200, { profile });
  } catch (err) {
    return json(500, { error: 'Profile lookup failed.' });
  }
};

// Express adapter: GET /api/profile/:username — pulls the username from the
// route param and invokes the Netlify-style handler above.
exports.expressHandler = async (req, res) => {
  try {
    const username = String(req.params?.username || '');
    const profile = await getPublicProfileByUsername(username);
    if (!profile) return res.status(404).json({ error: 'Profile not found.' });
    return res.json({ profile });
  } catch (err) {
    return res.status(500).json({ error: 'Profile lookup failed.' });
  }
};
