const { requireUser, initAdmin } = require('./_lib/user-service');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  try {
    const actor = await requireUser(event);
    if (!actor.admin) return json(403, { error: 'Admin only.' });
    const { db } = initAdmin();
    if (event.httpMethod === 'GET') {
      const snap = await db.ref('fairPlayReviewQueue').once('value');
      const reviews = Object.values(snap.val() || {}).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const labelled = reviews.filter((review) => ['agree', 'disagree', 'inconclusive'].includes(review.reviewerDecision));
      const decisive = labelled.filter((review) => review.reviewerDecision !== 'inconclusive');
      const disagreements = decisive.filter((review) => review.reviewerDecision === 'disagree').length;
      return json(200, { reviews, calibration: {
        labelled: labelled.length, decisive: decisive.length,
        disagreementRate: decisive.length ? disagreements / decisive.length : null,
        note: 'Use reviewer disagreement and score bands to recalibrate screening thresholds; never train on unreviewed scores.',
      } });
    }
    if (event.httpMethod === 'PATCH' || event.httpMethod === 'POST') {
      let body = {}; try { body = JSON.parse(event.body || '{}'); } catch {}
      const jobId = String(body.jobId || '').trim();
      const decision = String(body.decision || '').toLowerCase();
      if (!jobId || !['agree', 'disagree', 'inconclusive'].includes(decision)) return json(400, { error: 'Valid jobId and decision are required.' });
      const ref = db.ref(`fairPlayReviewQueue/${jobId}`);
      const snap = await ref.once('value');
      if (!snap.exists()) return json(404, { error: 'Review item not found.' });
      const item = snap.val();
      const review = { status: 'reviewed', reviewerDecision: decision, reviewerNotes: String(body.notes || '').slice(0, 2000), reviewedAt: Date.now(), reviewerUid: actor.uid };
      await ref.update(review);
      if (item.ownerUid) await db.ref(`anticheatReports/${item.ownerUid}/${jobId}/humanReview`).set(review);
      return json(200, { saved: true, review });
    }
    return json(405, { error: 'Use GET or PATCH.' });
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || 'Could not manage fair-play review.', code: err.code });
  }
};
