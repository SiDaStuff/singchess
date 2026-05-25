const { banUser, unbanUser, json } = require('./_lib/user-service');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
  try {
    const body = JSON.parse(event.body || '{}');
    const action = String(body.action || '').trim().toLowerCase();
    if (action === 'unban') {
      return await unbanUser(event);
    }
    if (action === 'ban') {
      return await banUser(event);
    }
    return json(400, { error: 'Unknown action. Use "ban" or "unban".' });
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || 'Could not update user ban state.' });
  }
};
