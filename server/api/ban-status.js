const { getBanStatus, requireUser, json } = require('./_lib/user-service');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
  try {
    const result = await getBanStatus(event);
    // The ban reason may contain admin-authored text; only reveal it to the
    // actual account owner (authenticated). Unauthenticated callers (the
    // pre-login "am I banned?" check) only get banned: true/false — this also
    // closes the email-enumeration oracle (unknown emails return banned:false).
    let isOwner = false;
    try {
      const user = await requireUser(event);
      // Owner if the authenticated user's email matches the one being checked.
      const body = JSON.parse(event.body || '{}');
      isOwner = !!user.email && user.email === String(body.email || '').trim().toLowerCase();
    } catch (_err) { /* not authenticated */ }
    if (!isOwner) return json(200, { banned: !!result.banned });
    return json(200, result);
  } catch (_err) {
    return json(200, { banned: false });
  }
};
