const { initAdmin, ADMIN_EMAIL, requireUser, json } = require('./user-service');

const PRESENCE_STALE_MS = 90 * 1000;

async function setUserPresence(uid, data = {}) {
  const { db } = initAdmin();
  await db.ref(`presence/${uid}`).set({
    uid,
    email: data.email || '',
    username: data.username || '',
    connectedAt: data.connectedAt || Date.now(),
    lastSeen: Date.now(),
  });
}

async function touchUserPresence(uid) {
  const { db } = initAdmin();
  await db.ref(`presence/${uid}/lastSeen`).set(Date.now());
}

async function clearUserPresence(uid) {
  const { db } = initAdmin();
  await db.ref(`presence/${uid}`).remove();
}

async function listOnlineUsers() {
  const { db } = initAdmin();
  const snap = await db.ref('presence').once('value');
  const now = Date.now();
  const users = [];
  snap.forEach((child) => {
    const val = child.val() || {};
    if (!val.lastSeen || now - Number(val.lastSeen) > PRESENCE_STALE_MS) return;
    users.push({
      uid: child.key,
      email: val.email || '',
      username: val.username || '',
      connectedAt: Number(val.connectedAt) || 0,
      lastSeen: Number(val.lastSeen) || 0,
    });
  });
  users.sort((a, b) => b.lastSeen - a.lastSeen);
  return users;
}

async function setUserWarning(uid, { message, warnedBy }) {
  const { db, admin } = initAdmin();
  await db.ref(`users/${uid}/profile/warning`).set({
    message: String(message || '').trim(),
    warnedBy: warnedBy || '',
    warnedAt: admin.database.ServerValue.TIMESTAMP,
    delivered: false,
  });
}

async function getUserWarning(uid) {
  const { db } = initAdmin();
  const snap = await db.ref(`users/${uid}/profile/warning`).once('value');
  const warning = snap.val() || null;
  if (!warning?.message) return null;
  return warning;
}

async function markWarningDelivered(uid) {
  const { db } = initAdmin();
  const snap = await db.ref(`users/${uid}/profile/warning`).once('value');
  const warning = snap.val();
  if (!warning?.message) return;
  await db.ref(`users/${uid}/profile/warning`).update({ delivered: true });
}

async function clearUserWarning(uid) {
  const { db } = initAdmin();
  await db.ref(`users/${uid}/profile/warning`).remove();
}

async function getPendingWarning(uid) {
  const warning = await getUserWarning(uid);
  if (!warning?.message || warning.delivered) return null;
  return {
    message: String(warning.message),
    warnedAt: Number(warning.warnedAt) || 0,
    warnedBy: String(warning.warnedBy || ''),
  };
}

async function requireAdmin(event) {
  const user = await requireUser(event);
  if (user.email !== ADMIN_EMAIL) {
    const error = new Error('Admin only.');
    error.statusCode = 403;
    throw error;
  }
  return user;
}

async function warnUserByEmail(event) {
  await requireAdmin(event);
  const body = JSON.parse(event.body || '{}');
  const email = String(body.email || '').trim().toLowerCase();
  const message = String(body.message || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'Valid recipient email is required.' });
  if (!message) return json(400, { error: 'Warning message is required.' });
  const { admin: firebaseAdmin } = initAdmin();
  let target;
  try {
    target = await firebaseAdmin.auth().getUserByEmail(email);
  } catch (_err) {
    return json(404, { error: 'No account exists for that email.' });
  }
  const actor = await requireUser(event);
  await setUserWarning(target.uid, { message, warnedBy: actor.email });
  return json(200, { success: true, email, message });
}

async function getAdminDashboard(event) {
  await requireAdmin(event);
  const { db } = initAdmin();
  const [onlineUsers, visitorsSnap] = await Promise.all([
    listOnlineUsers(),
    db.ref('publicStats/siteVisitorsTotal').once('value'),
  ]);
  return json(200, {
    onlineUsers,
    onlineCount: onlineUsers.length,
    totalVisitors: Math.max(0, Number(visitorsSnap.val()) || 0),
  });
}

async function recordSiteVisit(rawIp) {
  const { tryClaimRateLimit, incrementSiteVisitors } = require('./firebase-stats');
  const allowed = await tryClaimRateLimit('site_visit', rawIp, 6 * 60 * 60 * 1000);
  if (!allowed) return null;
  return incrementSiteVisitors(1);
}

module.exports = {
  setUserPresence,
  touchUserPresence,
  clearUserPresence,
  listOnlineUsers,
  getPendingWarning,
  markWarningDelivered,
  warnUserByEmail,
  getAdminDashboard,
  recordSiteVisit,
};
