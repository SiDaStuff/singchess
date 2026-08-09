/**
 * Per-user heavy-action mutual exclusion lock.
 *
 * Game reviews (/api/analyze) and coach chat (/api/coach/chat) are both long
 * running and resource intensive. We block a user from running two of these
 * actions at once, even if the frontend check is bypassed or a second client
 * makes the request.
 */

const heavyLocks = new Map(); // uid -> 'review' | 'coach'

function lockKey(uid) {
  return uid || '__anonymous__';
}

function isHeavyActionBusy(uid) {
  return heavyLocks.has(lockKey(uid));
}

function getBusyAction(uid) {
  return heavyLocks.get(lockKey(uid)) || null;
}

/**
 * Try to acquire the heavy-action lock for a user. Returns true if acquired,
 * false if another heavy action is already running.
 */
function acquireHeavyAction(uid, action) {
  const key = lockKey(uid);
  if (heavyLocks.has(key)) return false;
  heavyLocks.set(key, action);
  return true;
}

/**
 * Release the heavy-action lock for a user. Idempotent.
 */
function releaseHeavyAction(uid) {
  heavyLocks.delete(lockKey(uid));
}

module.exports = {
  isHeavyActionBusy,
  getBusyAction,
  acquireHeavyAction,
  releaseHeavyAction,
};
