const { requireUser, json } = require('./_lib/user-service');
const { randomState, saveOAuthState, authorizeUrl } = require('./_lib/patreon-service');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Use GET.' });
  try {
    const user = await requireUser(event);
    const query = event.queryStringParameters || {};
    let returnTo = String(query.return || query.returnTo || '/boost').trim() || '/boost';
    // Prevent open redirects: only allow relative paths starting with /
    // that don't contain // or protocol schemes
    if (!/^[a-zA-Z0-9/_?&=%-]+$/.test(returnTo) || returnTo.includes('//') || returnTo.includes('://')) {
      returnTo = '/boost';
    }
    const state = randomState();
    await saveOAuthState(user.uid, state, returnTo);
    return {
      statusCode: 302,
      headers: {
        Location: authorizeUrl(state),
        'Cache-Control': 'no-store',
      },
      body: '',
    };
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || 'Could not start Patreon connect.' });
  }
};

