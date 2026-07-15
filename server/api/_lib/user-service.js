let admin = null;
try {
  admin = require('firebase-admin');
} catch (_err) {
  admin = null;
}

let appReady = false;
let db = null;

const ADMIN_EMAIL = 'sidamailbox@gmail.com';

// Plan tier definitions. Each tier carries its own per-feature limits so getMe
// can return plan-aware limits instead of a single hard-coded FREE_LIMITS.
//   - serverReviewsPerDay: null = unlimited (Boost/Max)
//   - anticheatGamesPerWeek: Free = 0 (no anticheat), Boost = 25, Max = 100
// Coach games and puzzles are unlimited for every tier (no quota).
const PLAN_TIERS = Object.freeze({
  free: {
    plan: 'free', name: 'Free', theme: 'default',
    limits: { serverReviewsPerDay: 3, anticheatGamesPerWeek: 0 },
  },
  boost: {
    plan: 'boost', name: 'Boost', theme: 'purple',
    limits: { serverReviewsPerDay: null, anticheatGamesPerWeek: 25 },
  },
  max: {
    plan: 'max', name: 'Max', theme: 'gold',
    limits: { serverReviewsPerDay: null, anticheatGamesPerWeek: 100 },
  },
});
// Back-compat alias for any code that still references FREE_LIMITS.
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

async function getBanForUid(uid, database = null) {
  if (!database) {
    ({ db: database } = initAdmin());
  }
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
  const { admin: firebaseAdmin, db: database } = initAdmin();
  const decoded = await firebaseAdmin.auth().verifyIdToken(token);
  // Read the full profile in one shot — avoids a separate getBanForUid call
  // and lets getMe reuse the result instead of reading again.
  const profileSnap = await database.ref(`users/${decoded.uid}/profile`).once('value');
  const profile = profileSnap.val() || {};
  const ban = profile.ban || {};
  if (ban.disabled === true) {
    throw banError(String(ban.reason || '').trim());
  }
  return {
    uid: decoded.uid,
    email: String(decoded.email || '').toLowerCase(),
    name: decoded.name || decoded.email || 'Player',
    disabled: false,
    _profileSnap: profileSnap,
    _profile: profile,
  };
}

async function getBanStatus(event) {
  const body = JSON.parse(event.body || '{}');
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { banned: false };
  const { admin: firebaseAdmin, db: database } = initAdmin();
  let target;
  try {
    target = await firebaseAdmin.auth().getUserByEmail(email);
  } catch (_err) {
    return { banned: false };
  }
  const ban = await getBanForUid(target.uid, database).catch(() => ({}));
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
  const tierKey = String(sub.plan || '').toLowerCase();
  const active = Number(sub.expiresAt || 0) > Date.now();
  const tier = (tierKey === 'boost' || tierKey === 'max') && active ? PLAN_TIERS[tierKey] : PLAN_TIERS.free;
  const result = {
    plan: tier.plan,
    name: tier.name,
    theme: tier.theme,
    limits: tier.limits,
  };
  if (active && tier !== PLAN_TIERS.free) result.expiresAt = Number(sub.expiresAt);
  return result;
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

// ISO-ish week key (YYYY-Www) based on the ISO week number. Used for the
// weekly anticheat-games quota window. Resets on Monday (ISO weeks start Mon).
function usageWeek(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Best-effort cleanup of usage buckets older than ~7 days. Called fire-and-
// forget from getMe so it never blocks a request. Deletes stale daily buckets
// (usage/{oldDay}) and stale weekly buckets (usage/week/{oldWeek}). Throttled
// per-uid to at most once an hour via a module-level Set.
const _usagePruneSeen = new Map(); // uid -> lastPrunedAt
async function pruneOldUsage(uid) {
  try {
    if (!uid) return;
    const now = Date.now();
    const last = Number(_usagePruneSeen.get(uid)) || 0;
    if (now - last < 60 * 60 * 1000) return; // at most once/hour/uid
    _usagePruneSeen.set(uid, now);
    const { db: database } = initAdmin();
    const usageSnap = await database.ref(`users/${uid}/usage`).once('value');
    if (!usageSnap.exists()) return;
    const cutoff = now - (7 * 24 * 60 * 60 * 1000);
    const updates = {};
    usageSnap.forEach((childSnap) => {
      const key = childSnap.key;
      if (key === 'week') {
        // weekly: delete old week keys (YYYY-Www)
        childSnap.forEach((weekSnap) => {
          if (_weekKeyOlderThan(weekSnap.key, cutoff)) updates[`users/${uid}/usage/week/${weekSnap.key}`] = null;
        });
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
        // daily: delete old YYYY-MM-DD keys
        const t = Date.parse(`${key}T00:00:00Z`);
        if (Number.isFinite(t) && t < cutoff) updates[`users/${uid}/usage/${key}`] = null;
      }
    });
    if (Object.keys(updates).length) await database.ref().update(updates);
  } catch (_err) { /* best-effort */ }
}

// Is a YYYY-Www week key older than cutoff ms? Rough: compare year-week numerically.
function _weekKeyOlderThan(weekKey, cutoffMs) {
  const m = String(weekKey || '').match(/^(\d{4})-W(\d{2})$/);
  if (!m) return false;
  const cutoff = new Date(cutoffMs);
  const cutWeek = Number(usageWeek(cutoff).slice(-2));
  const cutYear = Number(usageWeek(cutoff).slice(0, 4));
  const yr = Number(m[1]); const wk = Number(m[2]);
  if (yr < cutYear) return true;
  if (yr > cutYear) return false;
  return wk < cutWeek;
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

// Keys that clients are allowed to set via the profile PATCH endpoint.
// This prevent privilege escalation (e.g. setting subscription.plan to 'boost').
const ALLOWED_PROFILE_KEYS = new Set([
  'username',
  'puzzleRating',
  'puzzleStats',
  'savedUsernames',
  'appearanceSettings',
  'engineSettings',
  'coachMode',
  'puzzleMode',
  'onboardingComplete',
  'updatedAt',
]);

// Sensitive top-level keys that must never be set by the client.
const FORBIDDEN_PROFILE_KEYS = new Set([
  'subscription',
  'ban',
  'warning',
  'isAdmin',
  'plan',
  'usage',
  'patreon',
  'oauth',
  'email',
  'uid',
]);

async function patchProfile(uid, update) {
  const { admin: firebaseAdmin, db: database } = initAdmin();
  // Sanitize: only allow known-safe keys, strip forbidden keys
  const sanitized = {};
  for (const [key, value] of Object.entries(update || {})) {
    if (FORBIDDEN_PROFILE_KEYS.has(key)) {
      console.warn(`patchProfile: blocked forbidden key "${key}" for uid ${uid}`);
      continue;
    }
    if (!ALLOWED_PROFILE_KEYS.has(key)) {
      console.warn(`patchProfile: blocked unknown key "${key}" for uid ${uid}`);
      continue;
    }
    sanitized[key] = value;
  }
  // Always set updatedAt server-side
  sanitized.updatedAt = firebaseAdmin.database.ServerValue.TIMESTAMP;
  await database.ref(`users/${uid}/profile`).update(sanitized);

  // Maintain a username → uid index so public profiles can be looked up by
  // username without scanning all users. Only claims the index if it's free or
  // already owned by this uid; a collision (taken by another uid) is ignored
  // here (the public endpoint will 404 for the colliding name). Case-insensitive.
  if (typeof sanitized.username === 'string' && sanitized.username.trim()) {
    const key = sanitized.username.trim().toLowerCase().slice(0, 40);
    const indexRef = database.ref(`usernames/${key}`);
    try {
      await indexRef.transaction((currentOwner) => {
        if (!currentOwner) return uid;
        if (currentOwner === uid) return; // no-op, keep value
        return; // taken by someone else — abort (don't overwrite)
      }, undefined, false);
    } catch (_err) { /* index is best-effort; don't fail the profile save */ }
  }
}

// Public profile lookup by username. Uses the usernames/{lowercased} index for
// an O(1) lookup; falls back to a shallow scan if the index is missing (e.g.
// users created before the index existed). Returns ONLY public-safe fields.
// Honors profile.isPublic (default true). Returns null when not found / private.
async function getPublicProfileByUsername(rawUsername) {
  if (!rawUsername) return null;
  const { db: database } = initAdmin();
  const key = String(rawUsername).trim().toLowerCase().slice(0, 40);
  let uid = null;
  try {
    const snap = await database.ref(`usernames/${key}`).once('value');
    uid = snap.val();
  } catch (_err) { uid = null; }

  // Fallback: shallow scan of profiles by username (one-time backfill path).
  if (!uid) {
    try {
      const profilesSnap = await database.ref('users').limitToLast(400).once('value');
      profilesSnap.forEach((childSnap) => {
        const p = childSnap.val()?.profile;
        if (p && String(p.username || '').trim().toLowerCase() === key) {
          uid = childSnap.key;
          return true; // stop iteration
        }
        return false;
      });
    } catch (_err) { /* ignore */ }
  }
  if (!uid) return null;

  const profileSnap = await database.ref(`users/${uid}/profile`).once('value');
  const profile = profileSnap.val() || {};
  if (profile.isPublic === false) return null; // opted out
  const plan = activePlan(profile);
  return {
    username: String(profile.username || 'Player'),
    puzzleRating: Math.round(Number(profile.puzzleRating) || 1500),
    puzzleStats: {
      solved: Math.max(0, Number(profile.puzzleStats?.solved) || 0),
      attempted: Math.max(0, Number(profile.puzzleStats?.attempted) || 0),
      streak: Math.max(0, Number(profile.puzzleStats?.streak) || 0),
    },
    plan: plan.plan, // 'free' | 'boost' | 'max' — for the flair badge only
    createdAt: Number(profile.createdAt) || null,
  };
}

async function getMe(event) {
  const user = await requireUser(event);
  const { db: database } = initAdmin();
  const day = usageDay();
  const week = usageWeek();
  const usageRef = database.ref(`users/${user.uid}/usage/${day}`);
  const weekRef = database.ref(`users/${user.uid}/usage/week/${week}/anticheatGames`);

  // Reuse the profile snapshot already fetched by requireUser
  const profileSnap = user._profileSnap;
  const profile = {
    ...defaultProfile(user),
    ...user._profile,
  };
  profile.puzzleStats = { ...defaultProfile(user).puzzleStats, ...(profile.puzzleStats || {}) };
  delete profile.attemptedPuzzleIds;
  delete profile.solvedPuzzleIds;
  profile.subscription = profile.subscription || { plan: 'free' };
  profile.uid = user.uid;

  // Fetch daily + weekly usage in parallel with everything else
  const [usageSnap, weekSnap] = await Promise.all([
    usageRef.once('value'),
    weekRef.once('value'),
  ]);

  if (!profileSnap.exists()) {
    await profileSnap.ref.set(profile);
  }

  // Patreon Boost is refreshed at most once per 24 hours (cached).
  await maybeRefreshPatreon(user.uid, profile);

  // Best-effort: prune usage buckets older than a week (fire-and-forget).
  pruneOldUsage(user.uid).catch(() => {});

  const plan = activePlan(profile);
  const warning = profile.warning || null;
  const pendingWarning = warning?.message && !warning.delivered
    ? {
      message: String(warning.message),
      warnedAt: Number(warning.warnedAt) || 0,
      warnedBy: String(warning.warnedBy || ''),
    }
    : null;
  // Merge daily + weekly counters into one usage object the client reads:
  //   usage.serverReviews = today's count
  //   usage.anticheatGames = this week's games
  //   usage.week = the week window key (for the reset countdown)
  const usage = {
    ...(usageSnap.val() || {}),
    anticheatGames: Math.max(0, Number(weekSnap.val()) || 0),
    week,
  };
  return {
    user,
    profile,
    plan,
    usage,
    limits: plan.limits || PLAN_TIERS.free.limits,
    day,
    isAdmin: user.email === ADMIN_EMAIL,
    pendingWarning,
  };
}

async function claimUsage(uid, kind, limit, { amount = 1, period = "day" } = {}) {
  const { db: database } = initAdmin();
  const charge = Math.max(1, Math.trunc(Number(amount) || 1));
  const window = period === "week" ? usageWeek() : usageDay();
  const bucket = period === "week" ? `week/${window}` : window;
  const ref = database.ref(`users/${uid}/usage/${bucket}/${kind}`);

  // Retry transaction up to 3 times on failure. Pre-check: if current + charge
  // would exceed the limit, abort (allowed:false) without charging, so a large
  // batch can't overshoot. limit null/undefined = unlimited.
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await ref.transaction((current) => {
        const value = Math.max(0, Number(current) || 0);
        if (limit !== null && limit !== undefined && value + charge > limit) return; // Abort
        return value + charge;
      }, undefined, false); // applyLocally = false

      return {
        allowed: result.committed,
        count: Number(result.snapshot.val()) || 0,
        limit: limit === null || limit === undefined ? null : limit,
        period,
        window,
      };
    } catch (err) {
      // If this is the last attempt, throw the error
      if (attempt === maxRetries - 1) throw err;
      // Wait briefly before retrying (exponential backoff)
      await new Promise((resolve) => setTimeout(resolve, 50 * Math.pow(2, attempt)));
    }
  }
}

async function requireQuota(event, kind, options = {}) {
  const me = await getMe(event);
  const planKey = me.plan.plan; // "free" | "boost" | "max"
  const limits = me.plan.limits || PLAN_TIERS.free.limits;

  if (kind === "serverReviews") {
    // Free: 3/day. Boost/Max: unlimited.
    if (limits.serverReviewsPerDay === null || limits.serverReviewsPerDay === undefined) {
      return { ...me, quota: { allowed: true, unlimited: true, period: "day", window: usageDay() } };
    }
    const claim = await claimUsage(me.user.uid, "serverReviews", limits.serverReviewsPerDay, { period: "day" });
    if (!claim.allowed) {
      const error = new Error("You've reached your daily limit for server game reviews. Get unlimited server-side analysis by upgrading to Boost!");
      error.statusCode = 402;
      error.code = "quota_exceeded";
      error.quota = claim;
      error.plan = me.plan;
      throw error;
    }
    return { ...me, quota: claim };
  }

  if (kind === "anticheat") {
    // Free: no anticheat at all — hard block with an upgrade-required code.
    if (!limits.anticheatGamesPerWeek) {
      const error = new Error("Anticheat analysis is a Boost feature. Upgrade to unlock server-side cheat detection.");
      error.statusCode = 402;
      error.code = "upgrade_required";
      error.quota = { allowed: false, count: 0, limit: 0, period: "week", window: usageWeek() };
      error.plan = me.plan;
      throw error;
    }
    // Boost/Max: weekly per-game quota. options.amount = games to charge.
    const amount = Math.max(1, Math.trunc(Number(options.amount) || 1));
    const claim = await claimUsage(me.user.uid, "anticheatGames", limits.anticheatGamesPerWeek, { amount, period: "week" });
    if (!claim.allowed) {
      const error = new Error(planKey === "boost"
        ? "You've reached your weekly anticheat limit (25 games). Upgrade to Max for 100 games/week."
        : "You've reached your weekly anticheat limit (100 games). It resets Monday.");
      error.statusCode = 402;
      error.code = "quota_exceeded";
      error.quota = claim;
      error.plan = me.plan;
      throw error;
    }
    return { ...me, quota: claim };
  }

  // Unknown kind: allow (defensive default).
  return { ...me, quota: { allowed: true, unlimited: true } };
}

async function giftBoost(event) {
  const actor = await requireUser(event);
  if (actor.email !== ADMIN_EMAIL) return json(403, { error: 'Admin only.' });
  const body = JSON.parse(event.body || '{}');
  const email = String(body.email || '').trim().toLowerCase();
  const days = Math.max(1, Math.min(Math.trunc(Number(body.days) || 0), 366));
  // Optional plan: 'boost' (default, back-compat) or 'max'. Admin-grantable only.
  const requestedPlan = String(body.plan || 'boost').toLowerCase() === 'max' ? 'max' : 'boost';
  const tier = PLAN_TIERS[requestedPlan];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'Valid recipient email is required.' });
  if (!days) return json(400, { error: `${tier.name} duration must be 1 to 366 days.` });
  const { admin: firebaseAdmin, db: database } = initAdmin();
  let target;
  try {
    target = await firebaseAdmin.auth().getUserByEmail(email);
  } catch (_err) {
    return json(404, { error: 'No account exists for that email.' });
  }
  const expiresAt = Date.now() + (days * 24 * 60 * 60 * 1000);
  await database.ref(`users/${target.uid}/profile/subscription`).set({
    plan: tier.plan,
    theme: tier.theme,
    giftedBy: actor.email,
    giftedAt: firebaseAdmin.database.ServerValue.TIMESTAMP,
    expiresAt,
  });
  return json(200, { success: true, email, plan: tier.name, theme: tier.theme, expiresAt });
}

// Admin-only: clear a user's subscription back to free.
async function removeSubscription(event) {
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
  await database.ref(`users/${target.uid}/profile/subscription`).set({
    plan: 'free',
    removedBy: actor.email,
    removedAt: firebaseAdmin.database.ServerValue.TIMESTAMP,
  });
  return json(200, { success: true, email, plan: 'free' });
}

// Admin-only: list recent support/contact messages for the dashboard.
async function getSupportMessages(limit = 50) {
  const { db: database } = initAdmin();
  const snap = await database.ref('support').orderByChild('createdAt').limitToLast(limit).once('value');
  const out = [];
  snap.forEach((childSnap) => {
    const v = childSnap.val();
    if (v) out.push({ id: childSnap.key, ...v });
  });
  return out.reverse(); // newest first
}

// Admin-only: delete a single support message by id.
async function deleteSupportMessage(event) {
  const actor = await requireUser(event);
  if (actor.email !== ADMIN_EMAIL) return json(403, { error: 'Admin only.' });
  const body = JSON.parse(event.body || '{}');
  const id = String(body.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!id) return json(400, { error: 'Message id is required.' });
  const { db: database } = initAdmin();
  await database.ref(`support/${id}`).remove();
  return json(200, { success: true, id });
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
    bannedAt: firebaseAdmin.database.ServerValue.TIMESTAMP,
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
    unbannedAt: firebaseAdmin.database.ServerValue.TIMESTAMP,
  });
  return json(200, { success: true, email, disabled: false });
}

module.exports = {
  ADMIN_EMAIL,
  FREE_LIMITS,
  PLAN_TIERS,
  activePlan,
  getMe,
  getProfile,
  getPublicProfileByUsername,
  giftBoost,
  removeSubscription,
  getSupportMessages,
  deleteSupportMessage,
  getBanStatus,
  banUser,
  unbanUser,
  initAdmin,
  json,
  patchProfile,
  requireQuota,
  requireUser,
  usageDay,
  usageWeek,
};
