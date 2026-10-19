const crypto = require('node:crypto');
const database = () => require('./user-service').initAdmin().db;
function normalizeStats(raw = {}) {
  const hasMovesAnalyzed = Object.prototype.hasOwnProperty.call(raw, 'movesAnalyzed');
  return {
    gamesAnalyzed: Math.max(0, Number(raw.gamesAnalyzed) || 0),
    movesAnalyzed: Math.max(0, Number(hasMovesAnalyzed ? raw.movesAnalyzed : raw.gamesAnalyzed) || 0),
    coachGamesPlayed: Math.max(0, Number(raw.coachGamesPlayed) || 0),
    brilliantMoves: Math.max(0, Number(raw.brilliantMoves) || 0),
    puzzlesSolved: Math.max(0, Number(raw.puzzlesSolved) || 0),
    siteVisitorsTotal: Math.max(0, Number(raw.siteVisitorsTotal) || 0),
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

async function getPublicStats() {
  return normalizeStats((await database().ref('publicStats').once('value')).val() || {});
}
async function incrementPublicStats(delta = {}) {
  const names = ['gamesAnalyzed', 'movesAnalyzed', 'coachGamesPlayed', 'brilliantMoves', 'puzzlesSolved', 'siteVisitorsTotal'];
  const change = await database().ref('publicStats').transaction(value => {
    const next = normalizeStats(value || {});
    for (const name of names) next[name] += Math.max(0, Number(delta[name]) || 0);
    next.updatedAt = Date.now();
    return next;
  });
  return change.snapshot.val();
}
const incrementSiteVisitors = (delta = 1) => incrementPublicStats({ siteVisitorsTotal: delta });
async function claimUniqueBrilliantMoves(rawKeys = []) {
  let claimed = 0;
  for (const key of new Set((Array.isArray(rawKeys) ? rawKeys : []).map(value => String(value || '').trim()).filter(Boolean))) {
    const hash = crypto.createHash('sha256').update(`brilliant-move:v1:${key}`).digest('hex');
    const result = await database().ref(`publicStatsBrilliantMoves/${hash}`).transaction(value => value == null ? Date.now() : undefined);
    if (result.committed) claimed++;
  }
  return claimed;
}
async function tryClaimRateLimit(bucket, rawIp, windowMs = 300000) {
  const cleanBucket = String(bucket || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
  if (!cleanBucket) return false;
  const hash = crypto.createHash('sha256').update(`client-ip:v1:${String(rawIp || 'unknown')}`).digest('hex');
  const window = Math.floor(Date.now() / Math.max(1000, windowMs));
  return (await database().ref(`publicStatsRateLimits/${cleanBucket}/${hash}_${window}`).transaction(value => value == null ? Date.now() : undefined)).committed;
}
module.exports = { getPublicStats, incrementPublicStats, incrementSiteVisitors, claimUniqueBrilliantMoves, tryClaimRateLimit };