const { fetchCompat } = require('./_lib/fetch-compat');

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=30',
  },
  body: JSON.stringify(body),
});

const CHESSCOM_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; SiDaStuffChess/1.0; +https://lichess.org)',
};

function splitPgnGames(text) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const games = normalized
    .split(/\n\s*\n(?=\s*\[[A-Za-z0-9_]+\s+")/g)
    .map((game) => game.trim())
    .filter(Boolean);
  return games.length ? games : [normalized];
}

function readHeaders(pgn) {
  const headers = {};
  for (const match of String(pgn || '').matchAll(/^\s*\[([A-Za-z0-9_]+)\s+"([^"]*)"\]\s*$/gm)) {
    headers[match[1]] = match[2];
  }
  return headers;
}

function timestamp(headers) {
  const numeric = Number(headers.EndTime || headers.end_time || headers.createdAt || headers.lastMoveAt || 0);
  if (numeric > 0) return numeric > 100000000000 ? numeric / 1000 : numeric;
  const date = headers.Date || headers.UTCDate || headers.date || '';
  const time = headers.UTCTime || headers.Time || headers.time || '00:00:00';
  const parsed = Date.parse(`${String(date).replace(/\./g, '-')}T${time}Z`);
  return Number.isFinite(parsed) ? parsed / 1000 : 0;
}

function sortRecent(games) {
  return games.slice().sort((a, b) => timestamp(b.headers || b) - timestamp(a.headers || a));
}

function chessComError(status) {
  if (status === 403) {
    return new Error('Chess.com blocked this request. Try again later, paste a PGN instead, or load games from your browser.');
  }
  if (status === 404) {
    return new Error('Chess.com player not found. Check the username and try again.');
  }
  return new Error(`Chess.com responded with ${status}`);
}

async function lichessGames(username, limit) {
  const params = new URLSearchParams({
    max: String(limit),
    moves: 'true',
    clocks: 'true',
    opening: 'true',
    finished: 'true',
    sort: 'dateDesc',
  });
  const response = await fetchCompat(`https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params.toString()}`, {
    headers: { Accept: 'application/x-chess-pgn' },
  });
  if (!response.ok) throw new Error(`Lichess responded with ${response.status}`);
  const text = await response.text();
  return splitPgnGames(text).map((pgn) => {
    const headers = readHeaders(pgn);
    return { pgn, headers };
  });
}

async function chessComGames(username, limit) {
  const archiveResponse = await fetchCompat(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`, {
    headers: CHESSCOM_HEADERS,
  });
  if (!archiveResponse.ok) throw chessComError(archiveResponse.status);
  const archiveData = await archiveResponse.json();
  const archives = Array.isArray(archiveData.archives) ? archiveData.archives.slice().reverse() : [];
  const games = [];

  for (const monthUrl of archives) {
    if (games.length >= Math.max(limit, 20)) break;
    const monthResponse = await fetchCompat(monthUrl, { headers: CHESSCOM_HEADERS });
    if (!monthResponse.ok) continue;
    const monthData = await monthResponse.json();
    for (const game of Array.isArray(monthData.games) ? monthData.games : []) {
      if (!game.pgn) continue;
      const headers = {
        ...readHeaders(game.pgn),
        EndTime: game.end_time,
        TimeControl: game.time_control,
        TimeClass: game.time_class,
        Rated: game.rated,
        Url: game.url,
      };
      games.push({ pgn: game.pgn, headers });
    }
  }

  return games;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  const source = event.queryStringParameters?.source;
  const rawUsername = event.queryStringParameters?.username;
  const username = String(rawUsername || '').trim();
  const limit = Math.max(1, Math.min(Number(event.queryStringParameters?.limit) || 10, 20));

  // Validate source
  if (!['lichess', 'chesscom'].includes(source)) {
    return json(400, { error: 'source must be lichess or chesscom.' });
  }
  // Validate username: alphanumeric, dots, underscores, hyphens only, 1-40 chars
  if (!username || !/^[a-zA-Z0-9._-]{1,40}$/.test(username)) {
    return json(400, { error: 'Valid username is required (alphanumeric, dots, underscores, hyphens; 1-40 chars).' });
  }

  try {
    const games = source === 'chesscom'
      ? await chessComGames(username, limit)
      : await lichessGames(username, limit);
    return json(200, { games: sortRecent(games).slice(0, limit) });
  } catch (err) {
    console.error('recent-games failed:', err);
    const message = err.message || 'Could not load recent games.';
    const statusCode = message.includes('blocked') ? 503 : 500;
    return json(statusCode, { error: message, code: statusCode === 503 ? 'upstream_blocked' : 'fetch_failed' });
  }
};
