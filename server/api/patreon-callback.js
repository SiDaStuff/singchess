const { json } = require('./_lib/user-service');
const {
  consumeOAuthState,
  exchangeAuthCodeForToken,
  fetchIdentity,
  storePatreonForUid,
} = require('./_lib/patreon-service');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Use GET.' });
  try {
    const query = event.queryStringParameters || {};
    const code = String(query.code || '').trim();
    const state = String(query.state || '').trim();
    if (!code || !state) return json(400, { error: 'Missing code or state.' });

    const stateRow = await consumeOAuthState(state);
    if (!stateRow?.uid) return json(400, { error: 'Patreon connect link expired. Try again.' });

    const tokenJson = await exchangeAuthCodeForToken(code);
    const identityJson = await fetchIdentity(String(tokenJson.access_token || ''));
    await storePatreonForUid(stateRow.uid, tokenJson, identityJson);

    const returnTo = String(stateRow.returnTo || '/boost').trim() || '/boost';
    return {
      statusCode: 302,
      headers: {
        Location: `${returnTo}${returnTo.includes('?') ? '&' : '?'}patreon=connected`,
        'Cache-Control': 'no-store',
      },
      body: '',
    };
  } catch (err) {
    return json(500, { error: err.message || 'Patreon callback failed.' });
  }
};

