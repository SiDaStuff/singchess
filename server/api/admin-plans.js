const { removeSubscription, getSupportMessages, deleteSupportMessage, requireUser, json } = require('./_lib/user-service');

// POST /api/admin/remove-subscription — clears a user's subscription to free.
// Exposed as { handler } so it matches the wrapHandler(fn) -> fn.handler convention.
exports.removeSubscriptionHandler = {
  handler: async (event) => {
    if (event.httpMethod === 'OPTIONS') return json(200, {});
    if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
    try {
      return await removeSubscription(event);
    } catch (err) {
      return json(err.statusCode || 500, { error: err.message || 'Could not remove subscription.' });
    }
  },
};

// GET /api/admin/support — list recent contact/support messages (admin only).
exports.supportListHandler = {
  handler: async (event) => {
    if (event.httpMethod === 'OPTIONS') return json(200, {});
    try {
      const user = await requireUser(event);
      if (!user.admin) return json(403, { error: 'Admin only.' });
      const messages = await getSupportMessages(50);
      return json(200, { messages });
    } catch (err) {
      return json(err.statusCode || 500, { error: err.message || 'Could not load support messages.' });
    }
  },
};

// POST /api/admin/support/delete — delete a single support message (admin only).
exports.supportDeleteHandler = {
  handler: async (event) => {
    if (event.httpMethod === 'OPTIONS') return json(200, {});
    if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
    try {
      return await deleteSupportMessage(event);
    } catch (err) {
      return json(err.statusCode || 500, { error: err.message || 'Could not delete message.' });
    }
  },
};
