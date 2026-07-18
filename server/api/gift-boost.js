const { giftBoost, json } = require('./_lib/user-service');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
  try {
    return await giftBoost(event);
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || 'Could not gift Boost.' });
  }
};
