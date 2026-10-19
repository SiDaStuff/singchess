const { requireUser, initAdmin, activePlan, usageDay, usageWeek, getFeatureControls, json: baseJson } = require('./_lib/user-service');
const { publicCoachUsage } = require('./_lib/coach-budget');
function json(status, value) {
  const response = baseJson(status, value);
  response.headers = { ...response.headers, 'Cache-Control': 'no-store' };
  return response;
}

function lookupLocal(db, query, field) {
  db.sql.exec(`CREATE INDEX IF NOT EXISTS nodes_profile_lookup
    ON nodes(key,lower(text_value),parent) WHERE kind=4;`);
  return db.sql.prepare(`SELECT parent FROM nodes WHERE kind=4 AND key=? AND lower(text_value)=?
    AND parent LIKE 'users/%/profile' ORDER BY parent LIMIT 6`).all(field, query.toLowerCase())
    .map(row => row.parent.slice(6, -8));
}
function safeStats(value) {
  if (Array.isArray(value)) return value.map(safeStats);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|password|secret|credential/i.test(key)).map(([key, child]) => [key, safeStats(child)]));
  return value;
}
function childCount(db, path) {
  return db.sql.prepare('SELECT COUNT(*) n FROM nodes WHERE parent=? AND path<>?').get(path, path).n;
}
async function loadAdminProfile(db, firebase, uid) {
  let identity = null;
  try { identity = await firebase.auth().getUser(uid); }
  catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
  let profile = (await db.ref(`users/${uid}/profile`).get()).val();
  if (!profile) {
    const recovered = await db.syncFromBackup(`users/${uid}`);
    if (recovered.error) throw Object.assign(new Error('Saved account data could not be recovered. Try again.'), { statusCode: 503 });
    profile = (await db.ref(`users/${uid}/profile`).get()).val() || {};
  }
  if (!identity && !Object.keys(profile).length) return null;
  const [usageSnap, notesSnap, flagsSnap, reportsSnap, actionsSnap, presenceSnap, automaticSnap, statsSnap] = await Promise.all([
    db.ref(`users/${uid}/usage`).get(), db.ref(`abuse/notes/${uid}`).get(), db.ref(`abuse/flagged/${uid}`).get(),
    db.ref('abuse/reports').orderByChild('flaggedUid').equalTo(uid).limitToLast(20).get(),
    db.ref('abuse/actions').orderByChild('targetUid').equalTo(uid).limitToLast(20).get(),
    db.ref(`presence/${uid}`).get(), db.ref(`maxAutoReviewPrivate/accounts/${uid}`).get(), db.ref(`users/${uid}/stats`).get(),
  ]);
  const plan = activePlan(profile), day = usageDay(), week = usageWeek(), usage = usageSnap.val() || {};
  const days = Object.entries(usage).filter(([key, val]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && val && typeof val === 'object');
  const totals = { serverReviews: 0, manualImports: 0, anticheatGames: 0 };
  for (const [, row] of days) for (const key of ['serverReviews', 'manualImports']) totals[key] += Math.max(0, Number(row[key]) || 0);
  for (const row of Object.values(usage.week || {})) totals.anticheatGames += Math.max(0, Number(row.anticheatGames) || 0);
  const ban = profile.ban || {}, banned = identity?.disabled === true || ban.disabled === true;
  const notes = Object.entries(notesSnap.val() || {}).map(([id, note]) => ({ id, ...note })).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  const reports = Object.entries(reportsSnap.val() || {}).map(([id, report]) => ({ id, ...report })).sort((a, b) => b.reportedAt - a.reportedAt);
  const automatic = automaticSnap.val() || {}, presence = presenceSnap.val() || {};
  const featureControls = await getFeatureControls(uid, db);
  return {
    account: { uid, username: profile.username || identity?.displayName || '', email: identity?.email || profile.email || '',
      emailVerified: identity?.emailVerified === true, authAccountMissing: !identity,
      createdAt: identity?.metadata?.creationTime || profile.createdAt || null, lastSignInAt: identity?.metadata?.lastSignInTime || null,
      lastSeenAt: presence.lastSeen || null, online: !!presence.lastSeen && Date.now() - presence.lastSeen < 90000 },
    plan: { plan: plan.plan, name: plan.name, expiresAt: plan.expiresAt || null },
    ban: { ...ban, banned, reason: banned ? (ban.disabled && ban.reason || 'Disabled in authentication; no ban reason is recorded.') : '' },
    profile: safeStats(profile),
    stats: { puzzleRating: profile.puzzleRating ?? null, puzzleStats: safeStats(profile.puzzleStats || {}),
      storedStats: safeStats(statsSnap.val() || {}), recordedUsageTotals: totals,
      savedReviews: childCount(db, `users/${uid}/savedReviews`), anticheatReports: childCount(db, `anticheatReports/${uid}`),
      today: { ...safeStats(usage[day] || {}), ...publicCoachUsage(Number(usage[day]?.coachTokens) || 0, plan.limits.coachTokensPerDay, day) },
      thisWeek: safeStats(usage.week?.[week] || {}),
      recentUsage: days.sort(([a], [b]) => b.localeCompare(a)).slice(0, 30).map(([date, value]) => ({ date, ...safeStats(value) })) },
    linkedAccounts: profile.savedUsernames || {}, notes, reports,
    flags: flagsSnap.val() || null,
    actions: Object.entries(actionsSnap.val() || {}).map(([id, action]) => ({ id, ...action })).sort((a, b) => b.timestamp - a.timestamp),
    automaticReviews: { enabled: automatic.enabled === true, status: automatic.status || (automatic.enabled ? 'Waiting for next completed game' : 'Not enabled'),
      lastCheckedAt: automatic.lastCheckedAt || null, nextPollAt: automatic.nextPollAt || null },
    featureControls,
  };
}
exports.handler = async event => {
  try {
    if (event.httpMethod === 'OPTIONS') return json(200, {});
    if (event.httpMethod !== 'GET') return json(405, { error: 'Use GET.' });
    const actor = await requireUser(event);
    if (!actor.admin) return json(403, { error: 'Administrator access required.' });
    const { db, admin } = initAdmin();
    const args = event.queryStringParameters || {};
    const query = String(args.query || '').trim();
    let uid = String(args.uid || '').trim();
    if (uid && !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) return json(400, { error: 'Invalid account identifier.' });
    if (!uid) {
      if (!query || query.length > 254) return json(400, { error: 'Enter an email address or profile username.' });
      const field = query.includes('@') ? 'email' : 'username';
      if (field === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(query)) return json(400, { error: 'Enter a valid email address.' });
      const candidates = lookupLocal(db, query, field);
      if (field === 'email') {
        try { uid = (await admin.auth().getUserByEmail(query)).uid; }
        catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
      }
      if (!uid && candidates.length > 1) {
        const matches = await Promise.all(candidates.map(async id => {
          const p = (await db.ref(`users/${id}/profile`).get()).val() || {};
          return { uid: id, username: p.username || '', email: p.email || '' };
        }));
        return json(409, { error: 'Several stored profiles match. Select an account.', matches });
      }
      uid ||= candidates[0];
      if (!uid) return json(404, { error: 'No account found for that email or username.' });
    }
    const detail = await loadAdminProfile(db, admin, uid);
    return detail ? json(200, { detail }) : json(404, { error: 'Account not found.' });
  } catch (error) {
    return json(error.statusCode || 503, { error: error.statusCode ? error.message : 'Account lookup is temporarily unavailable.' });
  }
};
exports.lookupLocal = lookupLocal;
exports.loadAdminProfile = loadAdminProfile;
