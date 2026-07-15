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
    // Rate limit: max 1 site visit per IP per 10 seconds
    const ip = clientIp(event);
    const cacheKey = `site_visit:${ip}`;
    const now = Date.now();
    // Use a simple in-memory rate limit (acceptable for low-traffic site visits)
    if (siteVisitRateLimit.has(cacheKey)) {
      const last = siteVisitRateLimit.get(cacheKey);
      if (now - last < 10000) {
        return json(200, { counted: false, rateLimited: true });
      }
    }
    siteVisitRateLimit.set(cacheKey, now);
    // Clean old entries periodically
    if (siteVisitRateLimit.size > 10000) {
      const cutoff = now - 60000;
      for (const [k, v] of siteVisitRateLimit) {
        if (v < cutoff) siteVisitRateLimit.delete(k);
      }
    }

    const stats = await recordSiteVisit(ip);
    return json(200, {
      counted: !!stats,
      totalVisitors: stats?.siteVisitorsTotal || null,
    });
  } catch (err) {
    console.error('Site visit tracking failed:', err);
    return json(200, { counted: false });
  }
};

// In-memory rate limit store for site visits
const siteVisitRateLimit = new Map();
