const puzzleDb = require('./_lib/puzzle-db');

function safePuzzleId(id) {
  return String(id || '').replace(/[.#$\[\]/]/g, '_');
}

function allowedOrigin(origin) {
  if (!origin) return '';
  const isDev = process.env.NODE_ENV === 'development' || process.env.CHESS_REVIEW_DEV_SERVER === '1';
  if (origin === 'https://chess.sidastuff.com') return origin;
  if (isDev && origin === 'http://localhost:3000') return origin;
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
      error: 'Local puzzle chunks are not built yet. Run npm run build:puzzles on the server.',
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
    if (!puzzleDb.isReady()) {
      return dbUnavailableResponse(headers);
    }

    const { type, theme, difficulty, target, exclude } = event.queryStringParameters || {};
    const attemptedIds = new Set();

    if (event.httpMethod === 'GET' && type === 'daily') {
      const payload = await puzzleDb.getDailyPuzzle({ attemptedIds });
      if (!payload) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({ error: 'Could not find a daily puzzle right now.' }),
        };
      }
      if (attemptedIds.has(safePuzzleId(payload.puzzle?.id))) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({ error: 'You have already attempted today\'s daily puzzle.' }),
        };
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ data: payload, source: 'Daily puzzle' }),
      };
    }

    if (event.httpMethod === 'GET' && type === 'next') {
      const payload = await puzzleDb.getNextPuzzle({
        theme: theme || 'mix',
        difficulty: difficulty || 'normal',
        target: target ? Number(target) : 1500,
        exclude: exclude || '',
        attemptedIds,
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
    console.error('Puzzle API error:', err);
    return {
      statusCode: err.statusCode || 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Server error' }),
    };
  }
};
