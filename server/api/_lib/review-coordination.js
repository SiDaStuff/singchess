/**
 * Shared coordination between interactive (foreground) reviews and long-running
 * background jobs that share the process-wide Stockfish engine.
 *
 * Background anticheat reviews (server/api/anticheat.js) run for many minutes
 * and keep the shared singleton engine busy. When a user starts a normal game
 * review at the same time, both compete for the engine and the foreground
 * review feels sluggish. There is no safe way to interrupt the native engine
 * mid-search, so we solve it cooperatively:
 *
 *   • analyze.js calls beginInteractiveReview() while a review is running and
 *     endInteractiveReview() when it finishes. (Hooked into its withAnalysisSlot
 *     wrapper, which wraps every interactive review.)
 *   • The background anticheat job calls waitForInteractiveReviewIdle() between
 *     games and simply waits while a foreground review is in flight, then keeps
 *     going once it clears. Nothing is lost — progress is persisted per game.
 *
 * The two sides never touch — the flag is just a process-wide counter.
 */

let interactiveReviews = 0;

/** Mark that an interactive (foreground) review is now using the engine. */
function beginInteractiveReview() {
  interactiveReviews += 1;
}

/** Mark that an interactive review has finished. Idempotent. */
function endInteractiveReview() {
  interactiveReviews = Math.max(0, interactiveReviews - 1);
}

/** True while at least one interactive review is running. */
function isInteractiveReviewRunning() {
  return interactiveReviews > 0;
}

/**
 * Resolve once no interactive review is running, or after `timeoutMs` elapses
 * (whichever comes first). Never rejects — a very long review must not be able
 * to block a background job forever; the job's own overall timeout still guards
 * it. Polls cheaply rather than hooking begin/end so it also catches reviews
 * that started before this wait began.
 *
 * @param {object}   [opts]
 * @param {number}   [opts.pollMs]    polling interval
 * @param {number}   [opts.timeoutMs] hard cap on how long to wait
 * @returns {Promise<boolean>} true if reviews are now idle, false if timed out
 */
function waitForInteractiveReviewIdle({ pollMs = 500, timeoutMs = 5 * 60 * 1000 } = {}) {
  if (interactiveReviews <= 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (interactiveReviews <= 0 || Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve(interactiveReviews <= 0);
      }
    }, pollMs);
  });
}

module.exports = {
  beginInteractiveReview,
  endInteractiveReview,
  isInteractiveReviewRunning,
  waitForInteractiveReviewIdle,
};