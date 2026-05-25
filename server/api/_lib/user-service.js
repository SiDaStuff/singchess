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

async function requireUser(event) {
  const match = String(authHeader(event.headers || '')).match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const error = new Error('Login required.');
    error.statusCode = 401;
    throw error;
  }
  const { admin: firebaseAdmin } = initAdmin();
  const decoded = await firebaseAdmin.auth().verifyIdToken(match[1]);
  return {
    uid: decoded.uid,
    email: String(decoded.email || '').toLowerCase(),
    name: decoded.name || decoded.email || 'Player',
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

  const plan = activePlan(profile);
  return {
    user,
    profile,
    plan,
    usage: usageSnap.val() || {},
    limits: FREE_LIMITS,
    day,
    isAdmin: user.email === ADMIN_EMAIL,
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

module.exports = {
  ADMIN_EMAIL,
  FREE_LIMITS,
  activePlan,
  getMe,
  getProfile,
  giftBoost,
  initAdmin,
  json,
  patchProfile,
  requireQuota,
  requireUser,
};
