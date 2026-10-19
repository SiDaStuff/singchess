const puzzleDb = require('./_lib/puzzle-db');
const { requireFeature, getFeatureControls } = require('./_lib/user-service');

function allowedOrigin(origin) {
  if (!origin) return '';
  const isDev = process.env.NODE_ENV === 'development' || process.env.CHESS_REVIEW_DEV_SERVER === '1';
  // Netlify frontend (production SPA).
  if (origin === 'https://chess.singdevelopments.com') return origin;
  // Backend VM (mastermind) — same-origin API calls.
  if (origin === 'https://mastermind.singdevelopments.com') return origin;
  if (isDev && /^http:\/\/(localhost|127\.0\.0\.1):(3000|5173|4173)$/.test(origin)) return origin;
  return '';
}

function corsHeaders(event) {
  const origin = allowedOrigin(event?.headers?.origin || event?.headers?.Origin);
  return {
    'Content-Type': 'application/json',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function dbUnavailableResponse(headers) {
  return {
    statusCode: 503,
    headers,
    body: JSON.stringify({
      error: 'Puzzles are temporarily unavailable. Try again later.',
      code: 'puzzle_db_missing',
    }),
  };
}

exports.handler = async (event) => {
  const headers = corsHeaders(event);

  if (event.httpMethod === 'OPTIONS') {
    if ((event.headers?.origin || event.headers?.Origin) && !headers['Access-Control-Allow-Origin']) {
      return { statusCode: 403, headers, body: '' };
    }
    return { statusCode: 200, headers, body: '' };
  }

  if ((event.headers?.origin || event.headers?.Origin) && !headers['Access-Control-Allow-Origin']) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'Origin is not allowed.' }),
    };
  }

  try {
    // Puzzle reads are public. Supplied credentials must still pass account
    // and feature checks; an expired token must never silently become a guest.
    if (event.headers?.authorization || event.headers?.Authorization) {
      await requireFeature(event, 'puzzles');
    } else {
      const { features } = await getFeatureControls();
      if (!features.puzzles) throw Object.assign(new Error('Puzzles are currently disabled.'), { statusCode: 403, code: 'feature_disabled' });
    }
    if (!puzzleDb.isReady()) {
      return dbUnavailableResponse(headers);
    }

    const { type, theme, difficulty, target, exclude } = event.queryStringParameters || {};
    // Note: per-user "already attempted" tracking is owned by the client
    // (puzzleMode.attemptedPuzzleIds). The server is stateless across requests
    // for daily puzzles (deterministic by date), so no attemptedIds set is
    // seeded here — the previous 409 "already attempted" guard was dead code.

    if (event.httpMethod === 'GET' && type === 'daily') {
      const payload = await puzzleDb.getDailyPuzzle({ attemptedIds: new Set() });
      if (!payload) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({ error: 'Could not find a daily puzzle right now.' }),
        };
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ data: payload, source: 'Daily puzzle' }),
      };
    }

    if (event.httpMethod === 'GET' && type === 'next') {
      // Per-user "already attempted" tracking is owned by the client
      // (puzzleMode.attemptedPuzzleIds). The server is stateless here, so no
      // attemptedIds set is passed — getNextPuzzle defaults to an empty set.
      const payload = await puzzleDb.getNextPuzzle({
        theme: theme || 'mix',
        difficulty: difficulty || 'normal',
        target: target ? Number(target) : 1500,
        exclude: exclude || '',
      });
      if (!payload) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({ error: 'Could not find an unattempted puzzle right now. Try another theme or difficulty.' }),
        };
      }
      const themeLabel = theme === 'mix' ? 'mixed' : String(theme || 'mixed').replace(/([a-z])([A-Z])/g, '$1 $2');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          data: payload,
          source: `${themeLabel} training puzzle`,
        }),
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid request' }),
    };
  } catch (err) {
    if (!err.statusCode || err.statusCode >= 500) console.error('Puzzle API error:', err);
    return {
      statusCode: err.statusCode || 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Server error', ...(err.code ? { code: err.code } : {}) }),
    };
  }
};
