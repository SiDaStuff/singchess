const { fetchCompat } = require('./fetch-compat');
const { lichessGames, sortRecent } = require('../recent-games');
const { initAdmin } = require('./user-service');
const crypto = require('node:crypto');

const SOURCES = ['lichess', 'chesscom'];
const validName = name => typeof name === 'string' && /^[a-zA-Z0-9._-]{1,40}$/.test(name.trim());
const signature = saved => SOURCES.map(source => `${source}:${String(saved?.[source] || '').trim().toLowerCase()}`).join('|');
const gameKey = game => crypto.createHash('sha256').update(`${game.source}:${String(game.username).toLowerCase()}:${game.headers?.Url || (/^https:\/\//.test(game.headers?.Site || '') ? game.headers.Site : game.pgn)}`).digest('hex');
const complete = game => ['1-0', '0-1', '1/2-1/2'].includes(game.headers?.Result);
const headers = { Accept: 'application/json', 'User-Agent': 'SingChess/2.0 (+https://chess.singdevelopments.com/contact)' };

async function jsonFetch(url, fetcher = fetchCompat) {
  const response = await fetcher(url, { headers, timeoutMs: 10000 });
  if (!response.ok) {
    const error = new Error(response.status === 404 ? 'Player not found. Check the username.' : 'Provider unavailable. Please try again later.');
    error.statusCode = response.status === 404 ? 400 : 503;
    throw error;
  }
  return response.json();
}

// Chess.com requests are deliberately serial. Only the two newest archives are
// needed for this bounded account view; never fan out across a user's history.
async function fetchSource(source, username, fetcher = fetchCompat) {
  let games, ratings, puzzleRating, ratingKind;
  if (source === 'chesscom') {
    const base = `https://api.chess.com/pub/player/${encodeURIComponent(username)}`;
    const stats = await jsonFetch(`${base}/stats`, fetcher);
    puzzleRating = Number(stats.tactics?.highest?.rating) || null;
    ratingKind = 'peak';
    ratings = Object.fromEntries(['bullet', 'blitz', 'rapid', 'daily'].map(mode => [mode, Number(stats[`chess_${mode}`]?.last?.rating) || null]));
    const archive = await jsonFetch(`${base}/games/archives`, fetcher);
    games = [];
    for (const url of (archive.archives || []).slice(-2).reverse()) {
      if (!/^https:\/\/api\.chess\.com\/pub\/player\/[a-zA-Z0-9._-]+\/games\/\d{4}\/\d{2}$/.test(url)) continue;
      const month = await jsonFetch(url, fetcher);
      for (const item of month.games || []) {
        if (!item.pgn || item.pgn.length > 100000) continue;
        const parsed = Object.fromEntries([...item.pgn.matchAll(/^\s*\[(\w+)\s+"([^"]*)"\]/gm)].map(match => [match[1], match[2]]));
        games.push({ pgn: item.pgn, headers: { ...parsed, EndTime: item.end_time, Url: item.url } });
      }
      if (games.length >= 5) break;
    }
  } else {
    const profile = await jsonFetch(`https://lichess.org/api/user/${encodeURIComponent(username)}`, fetcher);
    puzzleRating = Number(profile.perfs?.puzzle?.rating) || null;
    ratingKind = 'current';
    ratings = Object.fromEntries(['bullet', 'blitz', 'rapid', 'classical'].map(mode => [mode, Number(profile.perfs?.[mode]?.rating) || null]));
    games = await lichessGames(username, 5);
  }
  games = sortRecent(games).filter(complete).slice(0, 5).map(game => ({ ...game, source, username, white: game.headers.White || 'White', black: game.headers.Black || 'Black' }));
  return { source, username, puzzleRating, ratingKind, ratings, games, latest: games[0] || null, fetchedAt: Date.now() };
}

async function loadLinked(user, { database = initAdmin().db, now = Date.now(), fetchSourceFn = fetchSource, forceRefresh = false } = {}) {
  const saved = user._profile?.savedUsernames || {};
  const linked = [];
  for (const source of SOURCES) {
    if (!validName(saved[source])) continue;
    const username = saved[source].trim();
    const key = crypto.createHash('sha256').update(`${source}:${username.toLowerCase()}`).digest('hex');
    const ref = database.ref(`linkedChessPrivate/cache/${key}`);
    const cached = (await ref.once('value')).val();
    if (!forceRefresh && cached?.data && cached.expiresAt > now) { linked.push(cached.data); continue; }
    const claim = await ref.transaction(current => {
      if (current?.leaseUntil > now || current?.expiresAt > now) return;
      return { ...current, leaseUntil: now + 45000 };
    });
    if (!claim.committed) {
      const state = claim.snapshot.val();
      linked.push(state?.data || { source, username, error: 'Account sync is in progress. Try again shortly.' });
      continue;
    }
    const providerRef = database.ref(`linkedChessPrivate/providers/${source}`);
    const owner = crypto.randomUUID();
    let providerClaimed = false;
    try {
      const slot = await providerRef.transaction(current => current?.expiresAt > now ? undefined : { owner, expiresAt: now + 60000 });
      if (!slot.committed) throw new Error('Provider sync is busy.');
      providerClaimed = true;
      const data = await fetchSourceFn(source, username);
      await ref.set({ data, expiresAt: now + (source === 'chesscom' ? 15 * 60000 : 60000), leaseUntil: 0 });
      linked.push(data);
    } catch (error) {
      const data = { source, username, error: error.statusCode === 400 ? error.message : 'Provider unavailable. Please try again later.' };
      await ref.set({ data, expiresAt: now + 60000, leaseUntil: 0 });
      linked.push(data);
    } finally {
      if (providerClaimed) await providerRef.transaction(current => current?.owner === owner ? null : undefined);
    }
  }
  return { linked, fetchedAt: now };
}

module.exports = { SOURCES, validName, signature, gameKey, complete, fetchSource, loadLinked };
