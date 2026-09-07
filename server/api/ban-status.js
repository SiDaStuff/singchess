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
    // Fail CLOSED on backend errors. Previously any error (e.g. a Firebase
    // outage) returned banned:false, which transiently "unbanned" every banned
    // account client-side. Return 5xx so the client can distinguish "not
    // banned" from "couldn't check" (unknown emails still return banned:false
    // via getBanStatus above — this branch is only for unexpected failures).
    console.error('ban-status failed:', err && err.message ? err.message : err);
    return json(503, { error: 'Ban check temporarily unavailable. Try again.' });
  }
};
