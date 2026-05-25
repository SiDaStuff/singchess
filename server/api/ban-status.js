const { getBanStatus, json } = require('./_lib/user-service');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
  try {
    return json(200, await getBanStatus(event));
  } catch (_err) {
    return json(200, { banned: false });
  }
};
