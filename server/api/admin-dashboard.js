const { getAdminDashboard, warnUserByEmail } = require('./_lib/presence-service');
const { json } = require('./_lib/user-service');

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return json(200, {});
    if (event.httpMethod === 'GET') {
      return await getAdminDashboard(event);
    }
    if (event.httpMethod === 'POST') {
      return await warnUserByEmail(event);
    }
    return json(405, { error: 'Use GET or POST.' });
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || 'Admin request failed.' });
  }
};
