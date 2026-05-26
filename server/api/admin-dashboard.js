const { getAdminDashboard, warnUserByEmail } = require('./_lib/presence-service');

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      return await getAdminDashboard(event);
    }
    if (event.httpMethod === 'POST') {
      return await warnUserByEmail(event);
    }
    const { json } = require('./_lib/user-service');
    return json(405, { error: 'Use GET or POST.' });
  } catch (err) {
    const { json } = require('./_lib/user-service');
    return json(err.statusCode || 500, { error: err.message || 'Admin request failed.' });
  }
};
