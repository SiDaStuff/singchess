let admin = null;
try {
  admin = require('firebase-admin');
} catch (_err) {
  admin = null;
}

let appReady = false;
let db = null;

const ADMIN_EMAIL = 'sidamailbox@gmail.com';
const FREE_LIMITS = Object.freeze({
  anticheatRunsPerDay: 1,
  serverReviewsPerDay: 3,
});

function parseServiceAccount() {
  const raw = process.env.service_account
    || process.env.SERVICE_ACCOUNT
    || process.env.FIREBASE_SERVICE_ACCOUNT
    || '';
  if (!raw) return null;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (parsed.private_key) parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
  return parsed;
}

function databaseUrl() {
  return (process.env.realtime_database_url
    || process.env.REALTIME_DATABASE_URL
    || process.env.FIREBASE_DATABASE_URL
    || '').replace(/\/+$/, '');
}

function initAdmin() {
  if (!admin) throw new Error('Firebase Admin SDK is unavailable.');
  if (!appReady) {
    if (!admin.apps?.length) {
      const serviceAccount = parseServiceAccount();
      if (!serviceAccount) throw new Error('Firebase service account is not configured.');
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: databaseUrl(),
      });
    }
    appReady = true;
  }
  if (!db) db = admin.database();
  return { admin, db };
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function authHeader(headers = {}) {
  return headers.authorization || headers.Authorization || '';
}

function authToken(event) {
  const headerAuth = String(authHeader(event.headers || ''));
  const headerMatch = headerAuth.match(/^Bearer\s+(.+)$/i);
  if (headerMatch) return headerMatch[1];
  const query = event.queryStringParameters || {};
  return String(query.token || query.idToken || '').trim();
}

async function getUserRecord(uid) {
  const { admin: firebaseAdmin } = initAdmin();
  return firebaseAdmin.auth().getUser(uid);
}

function banError(reason = '') {
  const suffix = reason ? ` Reason: ${reason}` : '';
  const error = new Error(`Account banned.${suffix}`);
  error.statusCode = 403;
  error.code = 'account_banned';
  error.reason = reason || '';
  return error;
}

async function getBanForUid(uid) {
  const { db: database } = initAdmin();
  const snap = await database.ref(`users/${uid}/profile/ban`).once('value');
  return snap.val() || {};
}

async function requireUser(event) {
  const token = authToken(event);
  if (!token) {
    const error = new Error('Login required.');
    error.statusCode = 401;
    throw error;
  }
  const { admin: firebaseAdmin } = initAdmin();
  const decoded = await firebaseAdmin.auth().verifyIdToken(token);
  const userRecord = await firebaseAdmin.auth().getUser(decoded.uid);
  const ban = await getBanForUid(decoded.uid).catch(() => ({}));
  if (userRecord.disabled || ban.disabled) {
    throw banError(String(ban.reason || '').trim());
  }
  return {
    uid: decoded.uid,
    email: String(decoded.email || '').toLowerCase(),
    name: decoded.name || decoded.email || 'Player',
    disabled: false,
  };
}

async function getBanStatus(event) {
  const body = JSON.parse(event.body || '{}');
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { banned: false };
  const { admin: firebaseAdmin } = initAdmin();
  let target;
  try {
    target = await firebaseAdmin.auth().getUserByEmail(email);
  } catch (_err) {
    return { banned: false };
  }
  const ban = await getBanForUid(target.uid).catch(() => ({}));
  if (!target.disabled && !ban.disabled) return { banned: false };
  return {
    banned: true,
    reason: String(ban.reason || '').trim(),
  };
}

function defaultProfile(user) {
  return {
    uid: user.uid,
    username: user.name || (user.email ? user.email.split('@')[0] : 'Player'),
    email: user.email || '',
    puzzleRating: 1500,
    puzzleStats: { solved: 0, attempted: 0, streak: 0 },
    subscription: { plan: 'free' },
    usage: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function activePlan(profile = {}) {
  const sub = profile.subscription || {};
  if (String(sub.plan || '').toLowerCase() === 'boost' && Number(sub.expiresAt || 0) > Date.now()) {
    return {
      plan: 'boost',
      name: 'Boost',
      expiresAt: Number(sub.expiresAt),
      theme: 'purple',
    };
  }
  return { plan: 'free', name: 'Free', limits: FREE_LIMITS };
}

async function maybeRefreshPatreon(uid, profile) {
  const provider = String(profile?.subscription?.provider || '').toLowerCase();
  const hasPatreon = !!profile?.patreon;
  if (provider !== 'patreon' && !hasPatreon) return { refreshed: false };

  const lastCheckedAt = Number(profile?.patreon?.lastCheckedAt) || 0;
  const maxAgeMs = 24 * 60 * 60 * 1000;
  if (lastCheckedAt && (Date.now() - lastCheckedAt) < maxAgeMs) return { refreshed: false };

  try {
    const { ensurePatreonFresh } = require('./patreon-service');
    return await ensurePatreonFresh(uid, profile, { maxAgeMs });
  } catch (err) {
    return { refreshed: false, error: err.message || 'patreon_refresh_failed' };
  }
}

function usageDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

async function getProfile(uid, user = null) {
  const { db: database } = initAdmin();
  const ref = database.ref(`users/${uid}/profile`);
  const snap = await ref.once('value');
  const base = user ? defaultProfile(user) : {};
  const profile = { ...base, ...(snap.val() || {}) };
  profile.puzzleStats = { ...(base.puzzleStats || {}), ...(profile.puzzleStats || {}) };
  delete profile.attemptedPuzzleIds;
  delete profile.solvedPuzzleIds;
  profile.subscription = profile.subscription || { plan: 'free' };
  profile.uid = uid;
  if (user) {
    profile.email = user.email || profile.email || '';
    if (!profile.username) profile.username = user.name || profile.email.split('@')[0] || 'Player';
  }
  if (!snap.exists() && user) await ref.set(profile);
  return profile;
}

async function patchProfile(uid, update) {
  const { db: database } = initAdmin();
  await database.ref(`users/${uid}/profile`).update({ ...update, updatedAt: admin.database.ServerValue.TIMESTAMP });
}

async function getMe(event) {
  const user = await requireUser(event);
  const { db: database } = initAdmin();
  const day = usageDay();
  const profileRef = database.ref(`users/${user.uid}/profile`);
  const usageRef = database.ref(`users/${user.uid}/usage/${day}`);
  const [profileSnap, usageSnap] = await Promise.all([
    profileRef.once('value'),
    usageRef.once('value'),
  ]);

  const profile = {
    ...defaultProfile(user),
    ...(profileSnap.val() || {}),
  };
  profile.puzzleStats = { ...defaultProfile(user).puzzleStats, ...(profile.puzzleStats || {}) };
  delete profile.attemptedPuzzleIds;
  delete profile.solvedPuzzleIds;
  profile.subscription = profile.subscription || { plan: 'free' };
  profile.uid = user.uid;

  if (!profileSnap.exists()) {
    await profileRef.set(profile);
  }

  // Patreon Boost is refreshed at most once per 24 hours (cached).
  await maybeRefreshPatreon(user.uid, profile);

  const plan = activePlan(profile);
  const warning = profile.warning || null;
  const pendingWarning = warning?.message && !warning.delivered
    ? {
      message: String(warning.message),
      warnedAt: Number(warning.warnedAt) || 0,
      warnedBy: String(warning.warnedBy || ''),
    }
    : null;
  return {
    user,
    profile,
    plan,
    usage: usageSnap.val() || {},
    limits: FREE_LIMITS,
    day,
    isAdmin: user.email === ADMIN_EMAIL,
    pendingWarning,
  };
}

async function claimUsage(uid, kind, limit) {
  const { db: database } = initAdmin();
  const day = usageDay();
  const ref = database.ref(`users/${uid}/usage/${day}/${kind}`);
  const result = await ref.transaction((current) => {
    const value = Math.max(0, Number(current) || 0);
    if (value >= limit) return;
    return value + 1;
  }, undefined, false);
  return {
    allowed: result.committed,
    count: Number(result.snapshot.val()) || 0,
    limit,
    day,
  };
}

async function requireQuota(event, kind) {
  const me = await getMe(event);
  if (me.plan.plan === 'boost') return { ...me, quota: { allowed: true, unlimited: true } };
  const limit = kind === 'anticheat' ? FREE_LIMITS.anticheatRunsPerDay : FREE_LIMITS.serverReviewsPerDay;
  const claim = await claimUsage(me.user.uid, kind, limit);
  if (!claim.allowed) {
    const error = new Error(kind === 'anticheat'
      ? 'Free plan includes 1 server anticheat run per day. Upgrade to Boost or wait for the daily reset.'
      : 'Free plan includes 3 server game reviews per day. Further reviews should run in the browser until usage resets.');
    error.statusCode = 402;
    error.code = 'quota_exceeded';
    error.quota = claim;
    error.plan = me.plan;
    throw error;
  }
  return { ...me, quota: claim };
}

async function giftBoost(event) {
  const actor = await requireUser(event);
  if (actor.email !== ADMIN_EMAIL) return json(403, { error: 'Admin only.' });
  const body = JSON.parse(event.body || '{}');
  const email = String(body.email || '').trim().toLowerCase();
  const days = Math.max(1, Math.min(Math.trunc(Number(body.days) || 0), 366));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'Valid recipient email is required.' });
  if (!days) return json(400, { error: 'Boost duration must be 1 to 366 days.' });
  const { admin: firebaseAdmin, db: database } = initAdmin();
  let target;
  try {
    target = await firebaseAdmin.auth().getUserByEmail(email);
  } catch (_err) {
    return json(404, { error: 'No account exists for that email.' });
  }
  const expiresAt = Date.now() + (days * 24 * 60 * 60 * 1000);
  await database.ref(`users/${target.uid}/profile/subscription`).set({
    plan: 'boost',
    theme: 'purple',
    giftedBy: actor.email,
    giftedAt: admin.database.ServerValue.TIMESTAMP,
    expiresAt,
  });
  return json(200, { success: true, email, plan: 'Boost', theme: 'purple', expiresAt });
}

async function banUser(event) {
  const actor = await requireUser(event);
  if (actor.email !== ADMIN_EMAIL) return json(403, { error: 'Admin only.' });
  const body = JSON.parse(event.body || '{}');
  const email = String(body.email || '').trim().toLowerCase();
  const reason = String(body.reason || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'Valid recipient email is required.' });
  if (!reason) return json(400, { error: 'Ban reason is required.' });
  const { admin: firebaseAdmin, db: database } = initAdmin();
  let target;
  try {
    target = await firebaseAdmin.auth().getUserByEmail(email);
  } catch (_err) {
    return json(404, { error: 'No account exists for that email.' });
  }
  await firebaseAdmin.auth().updateUser(target.uid, { disabled: true });
  await database.ref(`users/${target.uid}/profile/ban`).set({
    disabled: true,
    reason,
    bannedBy: actor.email,
    bannedAt: admin.database.ServerValue.TIMESTAMP,
  });
  return json(200, { success: true, email, disabled: true, reason });
}

async function unbanUser(event) {
  const actor = await requireUser(event);
  if (actor.email !== ADMIN_EMAIL) return json(403, { error: 'Admin only.' });
  const body = JSON.parse(event.body || '{}');
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'Valid recipient email is required.' });
  const { admin: firebaseAdmin, db: database } = initAdmin();
  let target;
  try {
    target = await firebaseAdmin.auth().getUserByEmail(email);
  } catch (_err) {
    return json(404, { error: 'No account exists for that email.' });
  }
  await firebaseAdmin.auth().updateUser(target.uid, { disabled: false });
  await database.ref(`users/${target.uid}/profile/ban`).set({
    disabled: false,
    unbannedBy: actor.email,
    unbannedAt: admin.database.ServerValue.TIMESTAMP,
  });
  return json(200, { success: true, email, disabled: false });
}

module.exports = {
  ADMIN_EMAIL,
  FREE_LIMITS,
  activePlan,
  getMe,
  getProfile,
  giftBoost,
  getBanStatus,
  banUser,
  unbanUser,
  initAdmin,
  json,
  patchProfile,
  requireQuota,
  requireUser,
};
