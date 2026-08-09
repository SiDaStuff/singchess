// Anti-abuse system: account flagging, abuse detection, and multi-account tracking.
//
// Endpoints:
//   POST /api/report-abuse    — Submit a report (flag) against another account
//   GET  /api/admin/abuse      — Admin-only: list all flagged accounts (deduped)
//   POST /api/admin/abuse      — Admin-only: dismiss report or ban-for-abuse
//
// Data model (Firebase Realtime DB):
//   abuse/reports/<pushId> — individual report submissions
//   abuse/flagged/<flaggedUid> — aggregated: { count, reasons[], flaggedBy[], firstReportedAt, lastReportedAt }
//   abuse/flagged/<flaggedUid>/dismissedAt — set when admin dismisses (hides from queue)
//
// Multi-account detection:
//   abuse/ipIndex/<ipHash> — { uids: { [uid]: lastSeen }, firstSeen }
//   abuse/cookieIndex/<cookieHash> — { uids: { [uid]: lastSeen } }
//   abuse/multiAccount/<primaryUid> — { linkedUids: { [uid]: confidence }, detectedAt, reason }
//
// Usage-based abuse flags are computed live from each user's usage bucket in the
// existing firebase usage/{uid}/{day}/{kind} structure. No separate counter needed.

const crypto = require('crypto');
const cookie = require('cookie');
const { initAdmin, requireUser, json, activePlan, usageDay, usageWeek, planRank } = require('./_lib/user-service');

// ── Helpers ─────────────────────────────────────────────────────────────────

function sha256(str) {
  return crypto.createHash('sha256').update(String(str || '')).digest('hex');
}

function clientFingerprint(event) {
  // Build a deterministic fingerprint from request properties that survive a
  // browser restart or login change. Never stores raw IPs — only hashes.
  const h = event.headers || {};
  const ip = String(h['x-forwarded-for'] || h['x-real-ip'] || '').split(',')[0].trim() || '';
  // User-Agent + Accept-Language give a rough device fingerprint.
  const ua = String(h['user-agent'] || '').trim();
  const lang = String(h['accept-language'] || '').trim();

  // Device cookie from server-set HttpOnly cookie (or explicit event field when
  // the Express wrapper passes it through).
  let deviceId = event.sidDeviceId || '';
  if (!deviceId && h.cookie) {
    try {
      const parsed = cookie.parse(String(h.cookie));
      deviceId = parsed.sid_device || '';
    } catch (_) { /* ignore malformed cookies */ }
  }

  return { rawIp: ip, ipHash: ip ? sha256(ip) : '', cookieHash: deviceId ? sha256(deviceId) : '', deviceId, ua, lang };
}

// Multi-account detection thresholds.
const MULTI_ACCOUNT_CONFIDENCE_HIGH = 0.7; // share IP AND cookie fingerprint
const MULTI_ACCOUNT_CONFIDENCE_MED = 0.4;  // share IP under same UA within 24h
const MULTI_ACCOUNT_LINK_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── Report Submission ────────────────────────────────────────────────────────

// POST /api/report-abuse
// Body: { flaggedEmail, reason, details? }
// Flags another account for abuse. Multiple reports against the same account
// are aggregated. A user cannot flag themselves.
async function reportAbuse(event) {
  try {
    if (event.httpMethod === 'OPTIONS') return json(200, {});
    if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });

    const reporter = await requireUser(event);
    const { db, admin: firebaseAdmin } = initAdmin();

    const body = JSON.parse(event.body || '{}');
    const flaggedEmail = String(body.flaggedEmail || '').trim().toLowerCase();
    const reason = String(body.reason || '').trim().slice(0, 200);
    const details = String(body.details || '').trim().slice(0, 1000);

    if (!flaggedEmail) return json(400, { error: 'Flagged user email is required.' });
    if (!reason) return json(400, { error: 'A reason for the report is required.' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(flaggedEmail)) return json(400, { error: 'Invalid email format.' });

    // Look up the flagged user — must exist.
    let flaggedUser;
    try {
      flaggedUser = await firebaseAdmin.auth().getUserByEmail(flaggedEmail);
    } catch (_err) {
      return json(404, { error: 'No account exists for that email.' });
    }

    // Cannot flag yourself.
    if (flaggedUser.uid === reporter.uid) return json(400, { error: 'You cannot report yourself.' });

    // Per-reporter rate limit: at most 10 flags/hour per reporter.
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const recentSnap = await db.ref('abuse/reports')
      .orderByChild('reporterUid')
      .equalTo(reporter.uid)
      .limitToLast(20)
      .once('value');
    let recentCount = 0;
    if (recentSnap.exists()) {
      recentSnap.forEach((child) => {
        const ts = Number(child.val().reportedAt) || 0;
        if (ts > hourAgo) recentCount++;
      });
    }
    if (recentCount >= 10) {
      return json(429, { error: 'You have submitted too many reports. Please slow down.' });
    }

    // Save the individual report.
    const reportRef = db.ref('abuse/reports').push();
    await reportRef.set({
      reporterUid: reporter.uid,
      reporterEmail: reporter.email,
      flaggedUid: flaggedUser.uid,
      flaggedEmail,
      reason,
      details,
      reportedAt: firebaseAdmin.database.ServerValue.TIMESTAMP,
      dismissed: false,
    });

    // Aggregate into the flagged index.
    const flaggedRef = db.ref(`abuse/flagged/${flaggedUser.uid}`);
    await flaggedRef.transaction((current) => {
      const data = current || { count: 0, reasons: [], flaggedBy: [], firstReportedAt: Date.now(), lastReportedAt: Date.now() };
      if (!Array.isArray(data.reasons)) data.reasons = [];
      if (!Array.isArray(data.flaggedBy)) data.flaggedBy = [];
      data.count = (data.count || 0) + 1;
      data.reasons.push(reason);
      data.flaggedBy.push(reporter.email);
      data.lastReportedAt = Date.now();
      if (!data.firstReportedAt) data.firstReportedAt = Date.now();
      data.flaggedEmail = flaggedEmail;
      return data;
    }, undefined, false);

    // Track fingerprints for multi-account detection (both reporter and flagged).
    const fp = clientFingerprint(event);
    await _recordFingerprints(db, reporter.uid, fp);
    await _recordFingerprints(db, flaggedUser.uid, fp);

    return json(200, { success: true, message: 'Account flagged for review. Thank you.' });
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || 'Could not submit report.' });
  }
}

// ── Admin: List Flagged Accounts ─────────────────────────────────────────────

// GET /api/admin/abuse
// Returns all flagged accounts aggregated, with computed abuse scores.
async function listFlaggedAccounts(event) {
  const actor = await requireUser(event);
  if (!actor.admin) return json(403, { error: 'Admin only.' });

  const { db } = initAdmin();
  const [flaggedSnap, reportsSnap, ipSnap, cookieSnap] = await Promise.all([
    db.ref('abuse/flagged').once('value'),
    db.ref('abuse/reports').orderByChild('reportedAt').limitToLast(500).once('value'),
    db.ref('abuse/ipIndex').once('value'),
    db.ref('abuse/cookieIndex').once('value'),
  ]);

  const flagged = flaggedSnap.val() || {};
  const reports = reportsSnap.val() || {};
  const indexes = { ipIndex: ipSnap.val() || {}, cookieIndex: cookieSnap.val() || {} };

  // Resolve email for each flagged uid.
  const results = [];
  for (const [uid, data] of Object.entries(flagged)) {
    if (data.dismissedAt) continue; // skip dismissed

    // Gather all individual reports for this uid.
    const uidReports = [];
    for (const [rId, r] of Object.entries(reports)) {
      if (r.flaggedUid === uid && !r.dismissed) {
        uidReports.push({
          id: rId,
          reporterEmail: r.reporterEmail,
          reporterUid: r.reporterUid,
          reason: r.reason,
          details: r.details || '',
          reportedAt: Number(r.reportedAt) || 0,
        });
      }
    }

    // Compute abuse score from recent usage.
    const usageScore = await _computeUsageAbuseScore(uid);

    // Compute multi-account links.
    const multiAccountLinks = await _detectLinkedAccounts(uid, indexes);

    // Resolve email and plan.
    let email = data.flaggedEmail || '';
    let plan = 'free';
    let username = '';
    if (!email) {
      try {
        const { admin: firebaseAdmin } = initAdmin();
        const user = await firebaseAdmin.auth().getUser(uid);
        email = user.email || '';
      } catch (_) { /* user may be deleted */ }
    }
    // Try to get plan from profile.
    try {
      const profileSnap = await db.ref(`users/${uid}/profile/subscription`).once('value');
      const sub = profileSnap.val() || {};
      plan = sub.plan || 'free';
      const profileSnap2 = await db.ref(`users/${uid}/profile/username`).once('value');
      username = profileSnap2.val() || '';
    } catch (_) { /* ignore */ }

    // Deduplicate reasons.
    const uniqueReasons = [...new Set(data.reasons || [])];

    // Load admin notes for this account (abuse/notes/<uid>).
    let notes = [];
    try {
      const notesSnap = await db.ref(`abuse/notes/${uid}`).once('value');
      const notesVal = notesSnap.val() || {};
      notes = Object.entries(notesVal)
        .map(([noteId, n]) => ({
          id: noteId,
          text: String(n.text || ''),
          author: String(n.author || ''),
          createdAt: Number(n.createdAt) || 0,
          updatedAt: Number(n.updatedAt) || 0,
        }))
        .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
    } catch (_) { /* notes are best-effort */ }

    results.push({
      uid,
      email,
      username,
      plan,
      reportCount: uidReports.length,
      reasons: uniqueReasons,
      flaggedBy: [...new Set(data.flaggedBy || [])],
      firstReportedAt: Number(data.firstReportedAt) || 0,
      lastReportedAt: Number(data.lastReportedAt) || 0,
      reports: uidReports.sort((a, b) => b.reportedAt - a.reportedAt).slice(0, 20), // last 20
      usageScore: usageScore.score,
      usageLevel: usageScore.level,
      usageDetails: usageScore.details,
      multiAccount: multiAccountLinks,
      multiAccountCount: multiAccountLinks.length,
      notes,
      banned: false, // filled below
    });
  }

  // Check which flagged users are already banned.
  for (const r of results) {
    try {
      const banSnap = await db.ref(`users/${r.uid}/profile/ban`).once('value');
      const ban = banSnap.val() || {};
      if (ban.disabled === true) {
        r.banned = true;
        r.banReason = String(ban.reason || '').trim();
        r.bannedAt = Number(ban.bannedAt) || 0;
      }
    } catch (_) {}
  }

  // Sort: most reports first, then highest usage score.
  results.sort((a, b) => {
    const aScore = a.reportCount + (a.usageScore || 0);
    const bScore = b.reportCount + (b.usageScore || 0);
    return bScore - aScore;
  });

  return json(200, { flagged: results, total: results.length });
}

// ── Fingerprint indexing helpers ─────────────────────────────────────────────

async function _recordFingerprints(db, uid, fp) {
  if (!db || !uid || !fp) return;
  const now = Date.now();
  if (fp.ipHash) {
    await db.ref(`abuse/ipIndex/${fp.ipHash}/uids/${uid}`).set(now);
    await db.ref(`abuse/ipIndex/${fp.ipHash}/firstSeen`).transaction((v) => v || now);
  }
  if (fp.cookieHash) {
    await db.ref(`abuse/cookieIndex/${fp.cookieHash}/uids/${uid}`).set(now);
    await db.ref(`abuse/cookieIndex/${fp.cookieHash}/firstSeen`).transaction((v) => v || now);
  }
}

// ── Compute usage-based abuse score ──────────────────────────────────────────

async function _computeUsageAbuseScore(uid) {
  const { db } = initAdmin();
  const today = usageDay();
  const thisWeek = usageWeek();
  const todayRef = db.ref(`users/${uid}/usage/${today}`);
  const weekRef = db.ref(`users/${uid}/usage/week/${thisWeek}`);
  const profileRef = db.ref(`users/${uid}/profile/subscription`);

  let score = 0;
  const details = [];

  try {
    const [todaySnap, weekSnap, subSnap] = await Promise.all([
      todayRef.once('value'),
      weekRef.once('value'),
      profileRef.once('value'),
    ]);

    const todayUsage = todaySnap.val() || {};
    const weekUsage = weekSnap.val() || {};
    const sub = subSnap.val() || {};
    const plan = String(sub.plan || 'free').toLowerCase();
    const isPaid = plan === 'boost' || plan === 'max';

    // Server reviews per day threshold (plan-aware).
    const serverReviews = Math.max(0, Number(todayUsage.serverReviews) || 0);
    if (plan === 'boost') {
      if (serverReviews > 300) {
        score += 0.8;
        details.push(`Critical daily usage: ${serverReviews} server reviews on Boost`);
      } else if (serverReviews > 150) {
        score += 0.4;
        details.push(`High daily usage: ${serverReviews} server reviews on Boost`);
      }
    } else if (plan === 'max') {
      if (serverReviews > 600) {
        score += 0.6;
        details.push(`Very high daily usage: ${serverReviews} server reviews on Max`);
      } else if (serverReviews > 300) {
        score += 0.3;
        details.push(`High daily usage: ${serverReviews} server reviews on Max`);
      }
    } else if (serverReviews > 15) {
      // Free plan shouldn't have many server reviews unless they found a way around quota.
      score += 0.5;
      details.push(`Free plan with ${serverReviews} server reviews — possible quota bypass`);
    }

    // Anticheat games per week.
    const anticheatGames = Math.max(0, Number(weekUsage.anticheatGames) || 0);
    const anticheatLimit = plan === 'boost' ? 25 : plan === 'max' ? 100 : 0;
    if (anticheatLimit && anticheatGames > anticheatLimit) {
      score += 0.6;
      details.push(`Anticheat quota exceeded: ${anticheatGames}/${anticheatLimit} games this week`);
    } else if (isPaid && anticheatGames > 50) {
      score += 0.3;
      details.push(`High anticheat usage: ${anticheatGames} games this week`);
    }

    // Coach tokens per day relative to plan cap.
    const coachTokens = Math.max(0, Number(todayUsage.coachTokens) || 0);
    const coachLimit = plan === 'boost' ? 20000 : plan === 'max' ? 100000 : 5000;
    if (coachLimit && coachTokens > coachLimit * 1.5) {
      score += 0.4;
      details.push(`Coach tokens far over daily cap: ${coachTokens}/${coachLimit}`);
    } else if (coachLimit && coachTokens > coachLimit * 0.8) {
      score += 0.2;
      details.push(`Coach tokens near daily cap: ${coachTokens}/${coachLimit}`);
    }

    // Check for manual PGN imports (bulk importers).
    const manualImports = Math.max(0, Number(todayUsage.manualImports) || 0);
    if (manualImports > 50) {
      score += 0.3;
      details.push(`Bulk PGN importing: ${manualImports} imports today`);
    } else if (manualImports > 20) {
      score += 0.15;
      details.push(`Elevated PGN importing: ${manualImports} imports today`);
    }

    // Total API calls (sum of everything in today's usage except nested week).
    // NOT gated on plan — a free account making thousands of calls is MORE
    // suspicious (quota bypass), and even paid accounts shouldn't be at 10k+.
    let totalCalls = 0;
    for (const [key, val] of Object.entries(todayUsage)) {
      if (key !== 'week' && typeof val === 'number') totalCalls += val;
    }
    if (totalCalls > 10000) {
      score += 1.2;
      details.push(`Extreme API activity: ${totalCalls} calls today (likely automated/abuse)`);
    } else if (totalCalls > 5000) {
      score += 0.9;
      details.push(`Very high API activity: ${totalCalls} calls today`);
    } else if (totalCalls > 2000) {
      score += 0.6;
      details.push(`High API activity: ${totalCalls} calls today`);
    } else if (totalCalls > 800) {
      score += 0.4;
      details.push(`Elevated API activity: ${totalCalls} calls today`);
    } else if (totalCalls > 300) {
      score += 0.2;
      details.push(`Above-normal API activity: ${totalCalls} calls today`);
    }
  } catch (_) {
    // Best-effort — don't fail the whole request if usage stats are unavailable.
  }

  // Clamp score to [0, 3] and derive a level.
  score = Math.min(3, Math.max(0, score));
  let level = 'none';
  if (score >= 2.0) level = 'high';
  else if (score >= 1.2) level = 'medium';
  else if (score >= 0.5) level = 'low';

  return { score, level, details };
}

// ── Multi-account detection ──────────────────────────────────────────────────

async function _detectLinkedAccounts(uid, indexes) {
  const links = [];
  if (!uid) return links;

  const ipIndex = indexes && indexes.ipIndex ? indexes.ipIndex : (indexes || {});
  const cookieIndex = indexes && indexes.cookieIndex ? indexes.cookieIndex : {};

  const uidIps = [];
  const uidCookies = [];
  for (const [ipHash, data] of Object.entries(ipIndex)) {
    const uids = data.uids || {};
    if (uids[uid]) uidIps.push(ipHash);
  }
  for (const [cookieHash, data] of Object.entries(cookieIndex)) {
    const uids = data.uids || {};
    if (uids[uid]) uidCookies.push(cookieHash);
  }

  const seenUids = new Set();
  seenUids.add(uid);
  const linkMap = new Map();

  function addLink(linkedUid, source, lastSeen) {
    if (seenUids.has(linkedUid)) return;
    seenUids.add(linkedUid);
    const age = Date.now() - Number(lastSeen);
    if (age > MULTI_ACCOUNT_LINK_TTL) return;
    linkMap.set(linkedUid, {
      uid: linkedUid,
      sources: new Set((linkMap.get(linkedUid)?.sources || [])).add(source),
      lastSeen: Math.max(linkMap.get(linkedUid)?.lastSeen || 0, Number(lastSeen)),
      age,
    });
  }

  for (const ipHash of uidIps) {
    const data = ipIndex[ipHash] || {};
    const uids = data.uids || {};
    for (const [linkedUid, lastSeen] of Object.entries(uids)) {
      addLink(linkedUid, 'ip', lastSeen);
    }
  }
  for (const cookieHash of uidCookies) {
    const data = cookieIndex[cookieHash] || {};
    const uids = data.uids || {};
    for (const [linkedUid, lastSeen] of Object.entries(uids)) {
      addLink(linkedUid, 'cookie', lastSeen);
    }
  }

  for (const link of linkMap.values()) {
    const hasIp = link.sources.has('ip');
    const hasCookie = link.sources.has('cookie');
    const age = link.age;
    let confidence = 'low';
    let reason = `Shares IP address (last seen ${age < 86400000 ? 'today' : age < 604800000 ? 'this week' : 'recently'})`;
    if (hasIp && hasCookie) {
      confidence = 'high';
      reason = `Shares IP address and device cookie (last seen ${age < 86400000 ? 'today' : age < 604800000 ? 'this week' : 'recently'})`;
    } else if (hasCookie) {
      confidence = 'medium';
      reason = `Shares device cookie (last seen ${age < 86400000 ? 'today' : age < 604800000 ? 'this week' : 'recently'})`;
    } else if (age < 86400000) {
      confidence = 'medium';
    }
    links.push({
      uid: link.uid,
      confidence,
      reason,
      lastSeen: link.lastSeen,
    });
  }

  return links.sort((a, b) => {
    const rank = { high: 3, medium: 2, low: 1 };
    return (rank[b.confidence] || 0) - (rank[a.confidence] || 0);
  }).slice(0, 10);
}

// ── Admin: Dismiss or Ban ────────────────────────────────────────────────────

// POST /api/admin/abuse
// Body: { action: 'dismiss'|'ban-for-abuse', uid, reason? }
//   dismiss: marks all reports against this uid as dismissed (removes from queue)
//   ban-for-abuse: bans the user with reason "Abuse" + custom reason
async function handleAbuseAction(event) {
  const actor = await requireUser(event);
  if (!actor.admin) return json(403, { error: 'Admin only.' });

  const body = JSON.parse(event.body || '{}');
  const targetUid = String(body.uid || '').trim();
  const action = String(body.action || '').trim().toLowerCase();
  const customReason = String(body.reason || '').trim();

  if (!targetUid) return json(400, { error: 'Target user uid is required.' });
  if (!action || !['dismiss', 'ban-for-abuse'].includes(action)) {
    return json(400, { error: 'Action must be "dismiss" or "ban-for-abuse".' });
  }

  const { db, admin: firebaseAdmin } = initAdmin();

  if (action === 'dismiss') {
    // Mark the aggregated flagged entry as dismissed.
    await db.ref(`abuse/flagged/${targetUid}/dismissedAt`).set(firebaseAdmin.database.ServerValue.TIMESTAMP);
    await db.ref(`abuse/flagged/${targetUid}/dismissedBy`).set(actor.email);

    // Audit log.
    await db.ref('abuse/actions').push().set({
      action: 'dismiss',
      actor: actor.email,
      targetUid,
      timestamp: firebaseAdmin.database.ServerValue.TIMESTAMP,
    });

    // Mark all individual reports as dismissed.
    const reportsSnap = await db.ref('abuse/reports')
      .orderByChild('flaggedUid')
      .equalTo(targetUid)
      .once('value');
    if (reportsSnap.exists()) {
      const updates = {};
      reportsSnap.forEach((child) => {
        updates[`${child.key}/dismissed`] = true;
        updates[`${child.key}/dismissedAt`] = firebaseAdmin.database.ServerValue.TIMESTAMP;
        updates[`${child.key}/dismissedBy`] = actor.email;
      });
      const batch = {};
      for (const [key, val] of Object.entries(updates)) {
        batch[`abuse/reports/${key}`] = val;
      }
      // Write in chunks to avoid oversized updates.
      const chunks = [];
      let current = {};
      let size = 0;
      for (const [k, v] of Object.entries(batch)) {
        current[k] = v;
        size += JSON.stringify([k, v]).length;
        if (size > 8000) { // keep under 16K Firebase limit
          chunks.push(current);
          current = {};
          size = 0;
        }
      }
      if (Object.keys(current).length) chunks.push(current);
      for (const chunk of chunks) {
        await db.ref().update(chunk);
      }
    }

    return json(200, { success: true, action: 'dismissed', uid: targetUid });
  }

  if (action === 'ban-for-abuse') {
    // Build the ban reason.
    const reason = customReason ? `Abuse: ${customReason}` : 'Abuse';

    // Look up the user's Firebase auth record to make sure they exist.
    let targetUser;
    try {
      targetUser = await firebaseAdmin.auth().getUser(targetUid);
    } catch (_err) {
      return json(404, { error: 'No account found for that uid.' });
    }

    // Disable Firebase auth account.
    await firebaseAdmin.auth().updateUser(targetUid, { disabled: true });

    // Set the ban record.
    await db.ref(`users/${targetUid}/profile/ban`).set({
      disabled: true,
      reason,
      bannedBy: actor.email,
      bannedAt: firebaseAdmin.database.ServerValue.TIMESTAMP,
      source: 'abuse_report',
    });

    // Audit log.
    await db.ref('abuse/actions').push().set({
      action: 'ban-for-abuse',
      actor: actor.email,
      targetUid,
      reason,
      timestamp: firebaseAdmin.database.ServerValue.TIMESTAMP,
    });

    return json(200, {
      success: true,
      action: 'banned',
      uid: targetUid,
      email: targetUser.email || '',
      reason,
    });
  }

  return json(400, { error: 'Unknown action.' });
}

// ── Track user fingerprint for multi-account detection ───────────────────────
// Called from other handlers (e.g. on login, game import) to build up the index.
async function trackLoginFingerprint(uid, event) {
  try {
    const { db } = initAdmin();
    const fp = clientFingerprint(event);
    await _recordFingerprints(db, uid, fp);
  } catch (_) { /* best-effort */ }
}

// Flag a user for potential multi-accounting (called when the same IP is
// associated with multiple uids within a short window).
async function checkMultiAccount(uid, event) {
  try {
    const { db } = initAdmin();
    const fp = clientFingerprint(event);
    if (!fp.ipHash && !fp.cookieHash) return null;

    const linkedUids = new Set();
    const sources = [];

    if (fp.ipHash) {
      sources.push('ip');
      const ipSnap = await db.ref(`abuse/ipIndex/${fp.ipHash}/uids`).once('value');
      const uids = ipSnap.val() || {};
      for (const id of Object.keys(uids)) {
        if (id !== uid) linkedUids.add(id);
      }
    }
    if (fp.cookieHash) {
      sources.push('cookie');
      const cookieSnap = await db.ref(`abuse/cookieIndex/${fp.cookieHash}/uids`).once('value');
      const uids = cookieSnap.val() || {};
      for (const id of Object.keys(uids)) {
        if (id !== uid) linkedUids.add(id);
      }
    }

    const linked = Array.from(linkedUids);
    if (linked.length > 0) {
      const confidence = sources.length > 1 ? 'high' : 'medium';
      const now = Date.now();
      for (const linkedUid of linked) {
        await db.ref(`abuse/multiAccount/${uid}/linkedUids/${linkedUid}`).set({
          detectedAt: now,
          confidence,
          sources,
        });
      }
      await db.ref(`abuse/multiAccount/${uid}/detectedAt`).set(now);
      if (fp.ipHash) await db.ref(`abuse/multiAccount/${uid}/ipHash`).set(fp.ipHash);
      if (fp.cookieHash) await db.ref(`abuse/multiAccount/${uid}/cookieHash`).set(fp.cookieHash);

      // Surface this in the admin abuse queue so it's actionable even without a
      // manual report. Only auto-flag on high confidence (shared IP AND cookie)
      // to avoid false positives from shared networks (office/school/cafe).
      if (confidence === 'high') {
        const flaggedRef = db.ref(`abuse/flagged/${uid}`);
        await flaggedRef.transaction((current) => {
          const data = current || { count: 0, reasons: [], flaggedBy: [], firstReportedAt: now, lastReportedAt: now };
          if (!Array.isArray(data.reasons)) data.reasons = [];
          if (!Array.isArray(data.flaggedBy)) data.flaggedBy = [];
          data.count = (data.count || 0) + 1;
          data.reasons.push(`Multi-account: shares IP + device cookie with ${linked.length} account(s)`);
          data.flaggedBy.push('system:multi-account');
          data.lastReportedAt = now;
          if (!data.firstReportedAt) data.firstReportedAt = now;
          data.autoFlagged = true;
          data.autoFlagSource = 'multi-account';
          return data;
        }, undefined, false);
      }

      return { linkedUids: linked, count: linked.length };
    }
    return null;
  } catch (_) {
    return null;
  }
}

// ── Admin notes on accounts ─────────────────────────────────────────────────
// POST /api/admin/abuse/notes
// Body: { action: 'add'|'edit'|'remove', uid, noteId?, text? }
//   add:    create a new note on the account
//   edit:   update an existing note (noteId required)
//   remove: delete an existing note (noteId required)
// Notes are stored at abuse/notes/<uid>/<noteId>.
async function handleAbuseNotes(event) {
  const actor = await requireUser(event);
  if (!actor.admin) return json(403, { error: 'Admin only.' });

  const body = JSON.parse(event.body || '{}');
  const uid = String(body.uid || '').trim();
  const action = String(body.action || '').trim().toLowerCase();
  const noteId = String(body.noteId || '').trim();
  const text = String(body.text || '').trim().slice(0, 2000);

  if (!uid) return json(400, { error: 'Target user uid is required.' });
  if (!['add', 'edit', 'remove'].includes(action)) {
    return json(400, { error: 'Action must be "add", "edit", or "remove".' });
  }
  if ((action === 'add' || action === 'edit') && !text) {
    return json(400, { error: 'Note text is required.' });
  }
  if ((action === 'edit' || action === 'remove') && !noteId) {
    return json(400, { error: 'noteId is required for edit/remove.' });
  }

  const { db, admin: firebaseAdmin } = initAdmin();
  const now = firebaseAdmin.database.ServerValue.TIMESTAMP;

  if (action === 'add') {
    const ref = db.ref(`abuse/notes/${uid}`).push();
    await ref.set({ text, author: actor.email, createdAt: now, updatedAt: now });
    return json(200, { success: true, action: 'added', noteId: ref.key });
  }

  if (action === 'edit') {
    const ref = db.ref(`abuse/notes/${uid}/${noteId}`);
    const snap = await ref.once('value');
    if (!snap.exists()) return json(404, { error: 'Note not found.' });
    await ref.update({ text, updatedAt: now });
    return json(200, { success: true, action: 'edited', noteId });
  }

  // remove
  const ref = db.ref(`abuse/notes/${uid}/${noteId}`);
  const snap = await ref.once('value');
  if (!snap.exists()) return json(404, { error: 'Note not found.' });
  await ref.remove();
  return json(200, { success: true, action: 'removed', noteId });
}

module.exports = {
  reportAbuse,
  listFlaggedAccounts,
  handleAbuseAction,
  handleAbuseNotes,
  trackLoginFingerprint,
  checkMultiAccount,
  handler: async (event) => {
    // Dispatch based on HTTP method and admin path prefix.
    if (event.httpMethod === 'OPTIONS') return json(200, {});
    const path = event.path || event.rawUrl || '';
    const isAdmin = path.includes('/admin/abuse');
    const isNotes = path.includes('/admin/abuse/notes');
    if (event.httpMethod === 'POST' && isNotes) return handleAbuseNotes(event);
    if (event.httpMethod === 'GET' && isAdmin) return listFlaggedAccounts(event);
    if (event.httpMethod === 'POST' && isAdmin) return handleAbuseAction(event);
    if (event.httpMethod === 'POST') return reportAbuse(event);
    return json(405, { error: 'Method not allowed.' });
  },
};