const puzzleDb = require('./_lib/puzzle-db');

function safePuzzleId(id) {
  return String(id || '').replace(/[.#$\[\]/]/g, '_');
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
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
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
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
