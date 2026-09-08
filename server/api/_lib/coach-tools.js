// Tool definitions for the AI Coach and server-side tool implementations.
//
// Tool routing:
//   - stockfish        -> BROWSER (the user's engine runs this.engine.evaluate).
//   - game_review      -> BROWSER (asks the user, then loads the PGN into the review system).
//   - show_board       -> BROWSER (renders a static board embed in chat from a FEN).
//   - ask_question     -> BROWSER (inline multiple-choice question to the user).
//   - end_conversation -> BROWSER (locks this chat — response to ToS/abuse).
//   - web_search       -> SERVER  (Wikipedia + DuckDuckGo, no API key).
//   - exa_search       -> SERVER  (real-time web via Exa, requires EXA_API_KEY).
//   - coach_games      -> SERVER  (reads the signed-in user's profile).

const { fetchCompat } = require('./fetch-compat');
const { lookupOpening } = require('./lichess-explorer');
const { activePlan } = require('./user-service');

// Tool names that must execute in the browser. The chat handler emits a
// `tool_call` SSE event for these and waits for the browser to POST the result.
const BROWSER_TOOLS = new Set(['stockfish', 'game_review', 'show_board', 'ask_question', 'end_conversation']);

// Tool availability: the exa_search tool is only listed when the operator has
// configured EXA_API_KEY. Without it, the model would call it and just get an
// "not configured" error every time, which is noise. The helper is read at
// chat start so a server restart picks up the env change.
function exaSearchAvailable() {
  return !!String(process.env.EXA_API_KEY || '').trim();
}

// OpenAI-compatible function-tool schemas shown to the LLM. exa_search is
// appended only when the operator has set EXA_API_KEY — its description is
// crafted so the model prefers it over web_search for any time-sensitive or
// "what's the latest" question.
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'stockfish',
      description: 'Evaluate a chess position with the Stockfish engine running in the user\'s browser. Use this tool to verify ANY claim about a specific position: evaluations, best moves, tactical lines, or whether a move is good/bad. ALWAYS call it before answering when the user asks about a position, a specific move, or its quality. Never answer such questions from memory. Returns score (side-to-move perspective — POSITIVE = good for the side to move), best move (UCI), principal variation, and depth reached. If the result has an "error" field, an empty bestMove, or depth 0, the eval FAILED — do NOT report it as a real evaluation; tell the user you could not verify it. Minor FEN defects are repaired automatically. If you only have the move sequence (no FEN), pass the SAN moves via "moves" and the position will be reconstructed.',
      parameters: {
        type: 'object',
        properties: {
          fen: { type: 'string', description: 'FEN of the position to evaluate, including side to move.' },
          moves: { type: 'string', description: 'Optional fallback: the game moves in SAN (e.g. "1. e4 e5 2. Nf3 Nc6"), used to reconstruct the position when your FEN fails validation.' },
          depth: { type: 'integer', minimum: 8, maximum: 24, description: 'Search depth. 12-14 quick check, 18-22 for claims.', default: 18 },
        },
        required: ['fen'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'game_review',
      description: 'Offer to open a full game in the site\'s dedicated review system (which does a deep Stockfish analysis of every move). Call this when the user wants a GAME reviewed/analyzed — do NOT review games move-by-move in the chat yourself. Pass the game as PGN and a short label. The user gets a popup to confirm; the result says whether they opened it.',
      parameters: {
        type: 'object',
        properties: {
          pgn: { type: 'string', description: 'The full game in PGN format (headers + moves).' },
          summary: { type: 'string', description: 'A short label shown in the confirm popup, e.g. "Review your game vs vineetsharma36".' },
        },
        required: ['pgn'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_board',
      description: 'Show a small static chess board embed in the chat so the user can see a position visually. Use this when you want to illustrate a specific position from a FEN — it renders a board inline. You can also show boards inline in your text by writing a fenced code block with language "board" containing the FEN.',
      parameters: {
        type: 'object',
        properties: {
          fen: { type: 'string', description: 'FEN of the position to display.' },
        },
        required: ['fen'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_question',
      description: 'Ask the user a multiple-choice clarifying question, rendered as inline buttons in the chat. Use when you need a choice to proceed (e.g. which opening to study, what time control, which side). The user\'s selection is returned as the answer.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to ask.' },
          options: { type: 'array', items: { type: 'string' }, description: '2-5 clickable choices.', minItems: 2, maxItems: 5 },
        },
        required: ['question', 'options'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'end_conversation',
      description: 'End and lock THIS conversation so the user can no longer send messages in it. Use ONLY when the user is attempting to violate the Terms of Service or Privacy Policy, request harmful/illegal content, or is abusive. Use sparingly; this is permanent for the chat. A short reason is shown.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Brief reason shown to the user (e.g. "Conversation ended due to policy violation.").' },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search public sources (Wikipedia + DuckDuckGo) for chess facts: opening theory, players, titles, events, rules. Use to verify external factual claims before stating them.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
          top_k: { type: 'integer', minimum: 1, maximum: 5, default: 3 },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'coach_games',
      description: 'Read the signed-in user\'s saved chess context: saved usernames (Lichess/Chess.com) and preferences. Use to personalize advice or to know whose games to discuss.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lichess_opening',
      description: 'Look up the opening name (ECO + name) and master-game statistics for a sequence of moves using the Lichess Masters opening explorer at https://explorer.lichess.org/masters. Use whenever the user asks "what opening is this", to name a position/line, or to give White/Draw/Black expectations for a line. Pass ONLY UCI move strings, not FEN. Example: ["e2e4","e7e5","g1f3","b8c6","f1c4"]. Always cite the opening name and the W/D/B percentages.',
      parameters: {
        type: 'object',
        properties: {
          moves: { type: 'array', items: { type: 'string' }, description: 'Moves played so far in UCI notation (from-square + to-square + optional promo piece), e.g. ["e2e4","d7d5"]. Empty array = the starting position. Do not pass SAN or FEN here.' },
        },
        required: ['moves'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lichess_player',
      description: 'Look up a Lichess player\'s public profile by username: title (GM/IM/etc.), per-mode ratings (bullet/blitz/rapid/classical), country, FIDE id, play time, and patron status. Use when the user asks about a specific Lichess player. Never invent ratings — only report what this returns.',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Lichess username (case-insensitive).' },
        },
        required: ['username'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'user_plan_stats',
      description: 'Look up the signed-in user\'s current plan (Free/Boost/Max), limits, and remaining quota for server reviews, anticheat games, and coach tokens. Use when the user asks about their subscription, limits, or how much they have left.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_games',
      description: 'Fetch recent games of a Lichess or Chess.com player and open them in the chat as reviewable PGNs. Pass source \'lichess\' or \'chesscom\' and a username (omit username to use the signed-in user\'s saved username for that source). Returns per-game metadata (opponents, results, openings, links) plus the FULL PGN list — summarize the games in prose; the user gets clickable cards to open any game in the review system.',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['lichess', 'chesscom'], description: 'Which site to fetch from.' },
          username: { type: 'string', description: 'Site username. Omit to use the signed-in user\'s saved username for that source.' },
          limit: { type: 'integer', minimum: 1, maximum: 15, default: 5, description: 'How many recent games (newest first).' },
        },
        required: ['source'],
      },
    },
  },
  // Exa is gated on EXA_API_KEY — the chat handler filters the list before
  // sending, so this entry is only reached when the env var is set.
  {
    type: 'function',
    function: {
      name: 'exa_search',
      description: 'Real-time web search via Exa (Neural Search). Use for time-sensitive questions: recent tournaments, current ratings, the latest news, a player\'s recent results, or anything that may have changed since training. Prefer this over web_search for any "latest", "current", "recent", or "news" question. Returns up to 10 results with title, URL, published date, and a short snippet. Always cite the source URL.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
          num_results: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
          recency_days: { type: 'integer', minimum: 1, maximum: 365, description: 'Only include results published in the past N days. Use for "latest" / "recent" questions.' },
        },
        required: ['query'],
      },
    },
  },
];

// Returns the list of tool schemas for the current run. Filters EXA in/out
// based on the server's env config so the model never sees a tool it can't
// actually run. Today the EXA tool definition is always present in
// TOOL_DEFINITIONS for module-shape stability; this filter exists so the
// chat handler doesn't have to know about EXA env coupling directly.
function getToolDefinitions() {
  // TOOL_DEFINITIONS already includes the EXA schema; gate it on the env var
  // here so an unconfigured server doesn't waste a tool slot on it.
  if (exaSearchAvailable()) return TOOL_DEFINITIONS;
  return TOOL_DEFINITIONS.filter((t) => t && t.function && t.function.name !== 'exa_search');
}

// Run a SERVER-side tool. Returns a JSON-serialisable result.
async function runServerTool(name, args, user) {
  switch (name) {
    case 'web_search': return runWebSearch(args || {});
    case 'exa_search': return runExaSearch(args || {});
    case 'coach_games': return runCoachGames(user);
    case 'lichess_opening': return runLichessOpening(args || {});
    case 'lichess_player': return runLichessPlayer(args || {});
    case 'user_plan_stats': return runUserPlanStats(user);
    case 'fetch_games': return runFetchGames(args || {}, user);
    default: return { error: `Unknown tool: ${name}` };
  }
}

// fetch_games: pull recent games for a Lichess/Chess.com account — either an
// explicit username or the signed-in user's saved username for that source.
// Returns compact per-game metadata the model can discuss, plus the PGN list
// which the client renders as clickable "open in review" cards.
async function runFetchGames({ source, username, limit }, user) {
  const src = String(source || '').trim().toLowerCase() === 'chesscom' ? 'chesscom' : 'lichess';
  const k = Math.max(1, Math.min(15, Math.trunc(Number(limit) || 5)));

  // Resolve the username: explicit arg wins, else the user's saved one.
  let name = String(username || '').trim();
  if (!name) {
    const saved = (user && user._profile && user._profile.savedUsernames) || {};
    name = String(saved[src] || '').trim();
    if (!name) {
      return {
        error: `No username given and no saved ${src === 'chesscom' ? 'Chess.com' : 'Lichess'} username on this account. Ask the user which username to fetch, or have them save one in Settings.`,
        code: 'no_username',
      };
    }
  }
  if (!/^[a-zA-Z0-9._-]{1,40}$/.test(name)) return { error: 'Invalid username (alphanumeric, dots, underscores, hyphens; 1-40 chars).' };

  // Reuse the same fetchers the /api/recent-games proxy uses (parallel month
  // walks + timeouts for chess.com, PGN export for lichess).
  const { lichessGames, chessComGames, sortRecent } = require('../recent-games');
  let games;
  try {
    games = src === 'chesscom'
      ? await chessComGames(name, k)
      : await lichessGames(name, k);
  } catch (e) {
    const msg = String(e && e.message) || 'fetch failed';
    return { error: `Could not fetch ${src === 'chesscom' ? 'Chess.com' : 'Lichess'} games for ${name}: ${msg}` };
  }
  games = sortRecent(games).slice(0, k);
  if (!games.length) return { error: `No recent games found for ${name} on ${src === 'chesscom' ? 'Chess.com' : 'Lichess'}.` };

  // Compact metadata for the model + PGN payload for the client cards. PGNs
  // are capped (the model summarizes from metadata; full PGNs go to the UI).
  const games_out = games.map(({ pgn, headers }, i) => {
    const white = headers.White || '?';
    const black = headers.Black || '?';
    const result = headers.Result || '*';
    const date = headers.UTCDate || headers.Date || '';
    const opening = headers.Opening || headers.ECO || '';
    const tc = headers.TimeControl || headers.TimeClass || '';
    return {
      index: i + 1,
      white,
      black,
      result,
      date,
      opening,
      timeControl: tc,
      // Result from the Fetched player's perspective for quick talk tracks.
      outcome: result === '1-0'
        ? (white.toLowerCase() === name.toLowerCase() ? 'win' : 'loss')
        : result === '0-1'
          ? (black.toLowerCase() === name.toLowerCase() ? 'win' : 'loss')
          : 'draw',
      pgn: String(pgn || '').slice(0, 8000),
    };
  });

  const first = games_out[0] || {};
  const summary = `Fetched ${games_out.length} recent game${games_out.length === 1 ? '' : 's'} for ${name} (${src === 'chesscom' ? 'Chess.com' : 'Lichess'}). Most recent: ${first.white} vs ${first.black} (${first.outcome}${first.opening ? `, ${first.opening}` : ''}).`;
  return { source: src, username: name, count: games_out.length, summary, games: games_out, pgnCards: true };
}

// Lichess Masters opening explorer (shared with /api/opening-explorer). The
// model passes UCI moves; we join them into the `play` sequence the explorer
// expects and return a concise opening + W/D/B summary it can paraphrase.
async function runLichessOpening({ moves }) {
  const list = Array.isArray(moves) ? moves : [];
  const play = list.map((m) => String(m || '').trim()).filter((t) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(t)).join(',');
  if (!play && list.length) return { error: 'Moves must be UCI (e.g. "e2e4").' };
  const result = await lookupOpening(play);
  if (result.error) return result;
  const o = result.opening;
  return {
    opening: o ? `${o.name}${o.eco ? ` (${o.eco})` : ''}` : null,
    summary: o
      ? `${o.name}${o.eco ? ` (${o.eco})` : ''} — master games: White ${result.whitePct}% / Draw ${result.drawsPct}% / Black ${result.blackPct}% (${result.total.toLocaleString()} games)`
      : `No named opening for this position. Master games from here: White ${result.whitePct}% / Draw ${result.drawsPct}% / Black ${result.blackPct}% (${result.total.toLocaleString()} games)`,
    whitePct: result.whitePct, drawsPct: result.drawsPct, blackPct: result.blackPct, total: result.total,
  };
}

// Public Lichess player profile. Returns a slim, prose-friendly summary plus
// the key fields; the model paraphrases rather than echoing raw JSON.
async function runLichessPlayer({ username }) {
  const user = String(username || '').trim();
  if (!user) return { error: 'No username provided.' };
  const url = `https://lichess.org/api/user/${encodeURIComponent(user)}?trophies=false&profile=true&rank=true`;
  let res;
  try {
    res = await fetchCompat(url, { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; SingChess/1.0; +https://lichess.org)' } });
  } catch (_) {
    return { error: 'Could not reach Lichess.' };
  }
  if (!res || res.status === 404) return { error: `No Lichess user named "${user}".` };
  if (!res.ok) return { error: `Lichess returned ${res ? res.status : 'no response'}.` };
  const data = await res.json().catch(() => null);
  if (!data) return { error: 'Bad response from Lichess.' };

  const perfNames = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', correspondence: 'Correspondence', puzzle: 'Puzzle' };
  const perfs = data.perfs || {};
  const ratings = [];
  for (const [key, label] of Object.entries(perfNames)) {
    const p = perfs[key];
    if (p && p.games > 0) ratings.push(`${label} ${p.rating}`);
  }
  const parts = [];
  parts.push(`${data.username}${data.title ? ` (${data.title})` : ''}`);
  if (ratings.length) parts.push(`ratings: ${ratings.join(', ')}`);
  if (data.profile && data.profile.country) parts.push(`country: ${data.profile.country}`);
  if (data.playTime && data.playTime && Number(data.playTime.total)) {
    const hrs = Math.round(Number(data.playTime.total) / 3600);
    parts.push(`~${hrs.toLocaleString()}h played`);
  }
  if (data.patron) parts.push('Lichess Patron');
  return {
    username: data.username,
    title: data.title || null,
    url: data.url || `https://lichess.org/@/${data.username}`,
    perfs: Object.fromEntries(Object.entries(perfNames).filter(([k]) => perfs[k]).map(([k, label]) => [label.toLowerCase(), perfs[k].rating])),
    country: (data.profile && data.profile.country) || null,
    summary: parts.join(' · ') + '.',
  };
}

// Wikipedia search API (no key) + DuckDuckGo Instant Answer API (no key).
async function runWebSearch({ query, top_k }) {
  const q = String(query || '').trim();
  const k = Math.max(1, Math.min(5, Number(top_k) || 3));
  if (!q) return { error: 'Empty query.' };

  const results = [];

  // Wikipedia opensearch-style search.
  try {
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(q)}&srlimit=${k}&origin=*`;
    const wikiRes = await fetchCompat(wikiUrl, { method: 'GET' });
    if (wikiRes && wikiRes.ok) {
      const wiki = await wikiRes.json().catch(() => null);
      const hits = wiki && wiki.query && wiki.query.search;
      if (Array.isArray(hits)) {
        for (const h of hits.slice(0, k)) {
          results.push({
            source: 'wikipedia',
            title: h.title,
            snippet: stripHtml(h.snippet || ''),
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(h.title).replace(/ /g, '_'))}`,
          });
        }
      }
    }
  } catch (_) { /* one source failing is fine */ }

  // DuckDuckGo Instant Answer API.
  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
    const ddgRes = await fetchCompat(ddgUrl, { method: 'GET' });
    if (ddgRes && ddgRes.ok) {
      const ddg = await ddgRes.json().catch(() => null);
      if (ddg) {
        if (ddg.AbstractText) {
          results.push({ source: 'duckduckgo', title: ddg.Heading || q, snippet: ddg.AbstractText, url: ddg.AbstractURL || '' });
        }
        const related = Array.isArray(ddg.RelatedTopics) ? ddg.RelatedTopics : [];
        for (const t of related) {
          if (results.length >= k + 3) break;
          if (t && t.Text && t.FirstURL) {
            results.push({ source: 'duckduckgo', title: t.Text.split(' - ')[0], snippet: t.Text, url: t.FirstURL });
          }
        }
      }
    }
  } catch (_) { /* ignore */ }

  if (!results.length) return { query: q, results: [], note: 'No results found.' };
  return { query: q, results: results.slice(0, k + 2) };
}

// Exa (https://exa.ai) neural search. Requires the EXA_API_KEY env var on
// the server. When unset the runServerTool case above returns a clean
// "not configured" error so the model never bricks on it.
//
// We pass `useAutoprompt: true` so Exa can rephrase chess-natural-language
// queries into search-engine-friendly terms — e.g. "who won the Candidates
// 2026" → tournament results.
async function runExaSearch({ query, num_results, recency_days }) {
  const apiKey = String(process.env.EXA_API_KEY || '').trim();
  if (!apiKey) return { error: 'Exa search is not configured on this server.' };
  const q = String(query || '').trim();
  if (!q) return { error: 'Empty query.' };
  const k = Math.min(10, Math.max(1, Math.trunc(Number(num_results) || 5)));

  const body = { query: q, numResults: k, useAutoprompt: true };
  const recency = Math.trunc(Number(recency_days));
  if (Number.isFinite(recency) && recency > 0 && recency <= 365) {
    // Exa accepts an ISO date for the lower bound on published date.
    body.startPublishedDate = new Date(Date.now() - recency * 24 * 60 * 60 * 1000).toISOString();
  }

  let res;
  try {
    res = await fetchCompat('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      timeoutMs: 12000,
    });
  } catch (e) {
    return { error: `Could not reach Exa: ${e && e.message ? e.message : 'network error'}` };
  }
  if (!res || !res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch (_) { detail = ''; }
    return { error: `Exa returned ${res ? res.status : 'no response'}: ${detail.slice(0, 200)}` };
  }
  let json = null;
  try { json = await res.json(); } catch (_) { return { error: 'Exa returned a non-JSON body.' }; }
  const raw = Array.isArray(json && json.results) ? json.results : [];
  const results = raw.slice(0, k).map((r) => {
    const highlight = Array.isArray(r.highlights) ? r.highlights.join(' ') : '';
    const text = typeof r.text === 'string' ? r.text : '';
    const snippet = (highlight || text).slice(0, 400);
    return {
      source: 'exa',
      title: String(r.title || '').slice(0, 200),
      url: String(r.url || '').slice(0, 400),
      publishedDate: r.publishedDate || null,
      author: r.author || null,
      snippet,
    };
  }).filter((r) => r.title && r.url);
  if (!results.length) return { query: q, results: [], note: 'No results found.' };
  return { query: q, results, note: null };
}

// Returns a concise, prose-friendly summary of the user's chess context. The
// shape is intentionally short and human-readable so the model paraphrases it
// rather than echoing raw JSON to the user.
function runCoachGames(user) {
  const profile = (user && user._profile) || {};
  const usernames = Array.isArray(profile.savedUsernames) ? profile.savedUsernames : [];
  const rating = profile.puzzleRating || null;
  const parts = [];
  if (usernames.length) parts.push(`Saved usernames: ${usernames.slice(0, 10).join(', ')}.`);
  else parts.push('No saved Lichess/Chess.com usernames on file.');
  if (rating) parts.push(`Puzzle rating: ${rating}.`);
  return { summary: parts.join(' '), usernames: usernames.slice(0, 10), puzzleRating: rating };
}

// Look up the user's current plan and usage. Returns a short prose summary plus
// the structured numbers so the model can answer "how many reviews do I have left"
// accurately.
async function runUserPlanStats(user) {
  if (!user || !user.uid) return { error: 'Not signed in.' };
  const { initAdmin, usageDay, usageWeek } = require('./user-service');
  const { admin: firebaseAdmin, db: database } = initAdmin();
  const profile = user._profile || {};
  const plan = activePlan(profile);
  const day = usageDay();
  const week = usageWeek();
  const [usageSnap, weekSnap] = await Promise.all([
    database.ref(`users/${user.uid}/usage/${day}`).once('value'),
    database.ref(`users/${user.uid}/usage/week/${week}/anticheatGames`).once('value'),
  ]);
  const usage = usageSnap.val() || {};
  const reviews = Math.max(0, Number(usage.serverReviews) || 0);
  const coachTokens = Math.max(0, Number(usage.coachTokens) || 0);
  const anticheat = Math.max(0, Number(weekSnap.val()) || 0);
  const limits = plan.limits || {};
  const reviewLimit = limits.serverReviewsPerDay;
  const anticheatLimit = limits.anticheatGamesPerWeek;
  const coachLimit = limits.coachTokensPerDay;

  const parts = [`Plan: ${plan.name}.`];
  if (reviewLimit === null || reviewLimit === undefined) parts.push('Server reviews: unlimited.');
  else parts.push(`Server reviews today: ${reviews} / ${reviewLimit} used.`);
  if (anticheatLimit) parts.push(`Anticheat this week: ${anticheat} / ${anticheatLimit} used.`);
  else parts.push('Anticheat: not included.');
  parts.push(`Coach tokens today: ${coachTokens.toLocaleString()} / ${coachLimit ? coachLimit.toLocaleString() : 'unlimited'} used.`);
  if (plan.expiresAt) parts.push(`Plan expires: ${new Date(plan.expiresAt).toLocaleDateString()}.`);

  return {
    summary: parts.join(' '),
    plan: plan.name,
    limits: {
      serverReviewsPerDay: reviewLimit,
      anticheatGamesPerWeek: anticheatLimit,
      coachTokensPerDay: coachLimit,
    },
    usage: {
      serverReviews: reviews,
      anticheatGames: anticheat,
      coachTokens,
      day,
      week,
    },
  };
}

function stripHtml(s) {
  // Repeat until no more tags remain — `/<[^>]*>/g` strips <script> but
  // nesting like <<script>script> survives one pass.
  let v = String(s || '');
  for (let i = 0; i < 10; i++) {
    const next = v.replace(/<[^>]*>/g, '');
    if (next === v) break;
    v = next;
  }
  return v.replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
}

module.exports = {
  BROWSER_TOOLS,
  TOOL_DEFINITIONS,
  getToolDefinitions,
  exaSearchAvailable,
  runServerTool,
  runWebSearch,
  runExaSearch,
  runCoachGames,
  runLichessOpening,
  runLichessPlayer,
  runFetchGames,
};
