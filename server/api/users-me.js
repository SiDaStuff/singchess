const { getMe, json } = require('./_lib/user-service');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Use GET.' });
  try {
    return json(200, await getMe(event));
  } catch (err) {
    return json(err.statusCode || 500, {
      error: err.message || 'Could not load account.',
      code: err.code,
      reason: err.reason,
    });
  }
};
