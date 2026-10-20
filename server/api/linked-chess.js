const users = require('./_lib/user-service');
const linked = require('./_lib/linked-chess-service');

exports.handler = async event => {
  try {
    const user = await users.requireUser(event);
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      if (!body || typeof body !== 'object' || Array.isArray(body)) return users.json(400, { error: 'Provide a JSON object.' });
      if (!linked.SOURCES.includes(body.source)) return users.json(400, { error: 'Choose Lichess or Chess.com.' });
      const saved = { ...(user._profile.savedUsernames || {}) };
      if (body.action === 'unlink') saved[body.source] = '';
      else if (body.action === 'link') {
        if (!linked.validName(body.username)) return users.json(400, { error: 'Enter a valid username.' });
        const limit = users.initAdmin().db.ref(`linkedChessPrivate/changes/${user.uid}`);
        const now = Date.now();
        const claim = await limit.transaction(value => value > now - 60000 ? undefined : now);
        if (!claim.committed) return users.json(429, { error: 'Please wait a minute before linking another account.' });
        saved[body.source] = body.username.trim();
        const checked = await linked.loadLinked({ ...user, _profile: { ...user._profile, savedUsernames: { [body.source]: saved[body.source] } } });
        if (checked.linked[0]?.error) return users.json(400, { error: checked.linked[0].error });
      } else if (body.action === 'import-rating') {
        const rate = users.initAdmin().db.ref(`linkedChessPrivate/ratingImports/${user.uid}`);
        const now = Date.now();
        const allowed = await rate.transaction(value => value > now - 60000 ? undefined : now);
        if (!allowed.committed) return users.json(429, { error: 'Please wait a minute before importing another rating.' });
        const data = await linked.loadLinked(user);
        const account = data.linked.find(item => item.source === body.source);
        if (!account?.puzzleRating) return users.json(400, { error: 'No public puzzle rating is available for this account.' });
        await users.patchProfile(user.uid, { puzzleRating: Math.max(100, Math.min(4000, Math.round(account.puzzleRating))) });
        return users.json(200, { ...data, ratingImported: true, ratingKind: account.ratingKind });
      } else return users.json(400, { error: 'Unknown action.' });
      await users.patchProfile(user.uid, { savedUsernames: saved });
      user._profile.savedUsernames = saved;
    } else if (event.httpMethod !== 'GET') return users.json(405, { error: 'Use GET or POST.' });
    return users.json(200, await linked.loadLinked(user));
  } catch (error) { return users.json(error instanceof SyntaxError ? 400 : error.statusCode || 500, { error: error instanceof SyntaxError ? 'Invalid JSON.' : error.statusCode ? error.message : 'Account sync is unavailable. Please try again.' }); }
};
