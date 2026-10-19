const users = require('./_lib/user-service');

function targetUid(body, firebaseAdmin) {
  const uid = String(body.uid || '').trim();
  if (uid) return Promise.resolve(uid);
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    const error = new Error('A target uid or valid email is required.');
    error.statusCode = 400;
    return Promise.reject(error);
  }
  return firebaseAdmin.auth().getUserByEmail(email).then(record => record.uid)
    .catch(error => {
      if (error.code === 'auth/user-not-found') {
        const notFound = new Error('No account exists for that email.');
        notFound.statusCode = 404;
        throw notFound;
      }
      throw error;
    });
}

function validUid(uid) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(uid);
}

async function forceUsername(db, firebaseAdmin, uid, username) {
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
    const error = new Error('Username must be 3–40 characters: letters, numbers, . _ - only.');
    error.statusCode = 400;
    throw error;
  }
  const key = username.toLowerCase();
  const owner = (await db.ref(`usernames/${key}`).once('value')).val();
  if (owner && owner !== uid) {
    const error = new Error('That username is already in use.');
    error.statusCode = 409;
    throw error;
  }
  const profileRef = db.ref(`users/${uid}/profile`);
  const profile = (await profileRef.once('value')).val() || {};
  const oldKey = String(profile.username || '').trim().toLowerCase();
  const updates = {
    [`users/${uid}/profile/username`]: username,
    [`users/${uid}/profile/lastUsernameChangeAt`]: firebaseAdmin.database.ServerValue.TIMESTAMP,
    [`users/${uid}/profile/updatedAt`]: firebaseAdmin.database.ServerValue.TIMESTAMP,
    [`usernames/${key}`]: uid,
  };
  if (oldKey && oldKey !== key) updates[`usernames/${oldKey}`] = null;
  await db.ref().update(updates);
}

async function resetUsage(db, uid, feature) {
  const allowed = new Set(['serverReviews', 'manualImports', 'anticheatGames', 'coachTokens', 'puzzles']);
  if (feature && !allowed.has(feature)) {
    const error = new Error('Unsupported usage category.');
    error.statusCode = 400;
    throw error;
  }
  const usage = (await db.ref(`users/${uid}/usage`).once('value')).val() || {};
  const updates = {};
  for (const [bucket, value] of Object.entries(usage)) {
    if (!value || typeof value !== 'object' || bucket === 'week') continue;
    for (const key of Object.keys(value)) {
      if (!feature || key === feature) updates[`users/${uid}/usage/${bucket}/${key}`] = null;
    }
  }
  if (usage.week && typeof usage.week === 'object') {
    for (const [week, value] of Object.entries(usage.week)) {
      if (!value || typeof value !== 'object') continue;
      for (const key of Object.keys(value)) {
        if (!feature || key === feature) updates[`users/${uid}/usage/week/${week}/${key}`] = null;
      }
    }
  }
  if (Object.keys(updates).length) await db.ref().update(updates);
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return users.json(200, {});
  if (event.httpMethod !== 'POST') return users.json(405, { error: 'Use POST.' });
  try {
    const actor = await users.requireUser(event);
    if (!actor.admin) return users.json(403, { error: 'Admin only.' });
    const body = JSON.parse(event.body || '{}');
    const { admin: firebaseAdmin, db } = users.initAdmin();
    const action = String(body.action || '').trim();

    if (action === 'set-global-feature') {
      if (!users.FEATURE_NAMES.includes(body.feature) || typeof body.enabled !== 'boolean') {
        return users.json(400, { error: 'A valid feature and boolean enabled value are required.' });
      }
      await db.ref(`adminControls/features/${body.feature}`).set(body.enabled);
      return users.json(200, { success: true, feature: body.feature, enabled: body.enabled });
    }

    const uid = await targetUid(body, firebaseAdmin);
    if (!validUid(uid)) return users.json(400, { error: 'Invalid account identifier.' });
    if (action === 'set-feature') {
      if (!users.FEATURE_NAMES.includes(body.feature) || (body.enabled !== null && typeof body.enabled !== 'boolean')) {
        return users.json(400, { error: 'A valid feature and boolean or null enabled value are required.' });
      }
      await db.ref(`users/${uid}/profile/featureOverrides/${body.feature}`).set(body.enabled);
      return users.json(200, { success: true, uid, feature: body.feature, enabled: body.enabled });
    }
    if (action === 'reset-usage') {
      await resetUsage(db, uid, body.feature ? String(body.feature) : '');
      return users.json(200, { success: true, uid, feature: body.feature || 'all' });
    }
    if (action === 'force-username') {
      const username = String(body.username || '').trim();
      await forceUsername(db, firebaseAdmin, uid, username);
      return users.json(200, { success: true, uid, username });
    }
    return users.json(400, { error: 'Unknown administrator action.' });
  } catch (error) {
    return users.json(error instanceof SyntaxError ? 400 : error.statusCode || 500, {
      error: error instanceof SyntaxError ? 'Invalid JSON.' : error.message || 'Could not update administrator controls.',
    });
  }
};
