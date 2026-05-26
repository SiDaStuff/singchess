const { recordSiteVisit } = require('./_lib/presence-service');
const { json } = require('./_lib/user-service');

function clientIp(event) {
  return String(
    event.headers['x-forwarded-for']
    || event.headers['x-real-ip']
    || ''
  ).split(',')[0].trim() || 'unknown';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
  try {
    const stats = await recordSiteVisit(clientIp(event));
    return json(200, {
      counted: !!stats,
      totalVisitors: stats?.siteVisitorsTotal || null,
    });
  } catch (err) {
    console.error('Site visit tracking failed:', err);
    return json(200, { counted: false });
  }
};
