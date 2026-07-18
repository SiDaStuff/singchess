// Tool definitions for the AI Coach and server-side tool implementations.
//
// Tool routing:
//   - stockfish        -> BROWSER (the user's engine runs this.engine.evaluate).
//   - game_review      -> BROWSER (asks the user, then loads the PGN into the review system).
//   - show_board       -> BROWSER (renders a static board embed in chat from a FEN).
//   - puzzle           -> BROWSER (opens a popup with a position for the user to solve).
//   - ask_question     -> BROWSER (inline multiple-choice question to the user).
//   - end_conversation -> BROWSER (locks this chat — response to ToS/abuse).
//   - web_search       -> SERVER  (Wikipedia + DuckDuckGo, no API key).
//   - coach_games      -> SERVER  (reads the signed-in user's profile).

const { fetchCompat } = require('./fetch-compat');
const { lookupOpening } = require('./lichess-explorer');

// Tool names that must execute in the browser. The chat handler emits a
// `tool_call` SSE event for these and waits for the browser to POST the result.
const BROWSER_TOOLS = new Set(['stockfish', 'game_review', 'show_board', 'puzzle', 'ask_question', 'end_conversation']);

// OpenAI-compatible function-tool schemas shown to the LLM.
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'stockfish',
      description: 'Evaluate a chess position with the Stockfish engine running in the user\'s browser. Use to verify evaluations, best moves, and tactical claims about a SPECIFIC position. Returns score (side-to-move perspective), best move (UCI), principal variation, and depth reached.',
      parameters: {
        type: 'object',
        properties: {
          fen: { type: 'string', description: 'FEN of the position to evaluate, including side to move.' },
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
      name: 'puzzle',
      description: 'Open a popup with a chess position for the user to solve. Use this to give the user a tactical puzzle or practice position. The popup shows the board, an instruction, and optionally a revealable solution.',
      parameters: {
        type: 'object',
        properties: {
          fen: { type: 'string', description: 'FEN of the puzzle position.' },
          title: { type: 'string', description: 'Popup title, e.g. "Mate in 2".' },
          instruction: { type: 'string', description: 'What the user should do, e.g. "White to move and win."' },
          solution: { type: 'string', description: 'The solution (revealed on request), e.g. "1.Qxh7#"' },
        },
        required: ['fen', 'instruction'],
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
      description: 'Look up the opening name (ECO + name) and master-game statistics for a sequence of moves, using the Lichess Masters opening explorer. Use whenever the user asks "what opening is this", to name a position/line, or to give White/Draw/Black expectations for a line. Pass the moves as UCI strings (e.g. ["e2e4","e7e5","g1f3","b8c6","f1c4"]). Always cite the opening name and the W/D/B percentages.',
      parameters: {
        type: 'object',
        properties: {
          moves: { type: 'array', items: { type: 'string' }, description: 'Moves played so far in UCI notation (from-square + to-square + optional promo), e.g. ["e2e4","d7d5"]. Empty array = the starting position.' },
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
];

// Run a SERVER-side tool. Returns a JSON-serialisable result.
async function runServerTool(name, args, user) {
  switch (name) {
    case 'web_search': return runWebSearch(args || {});
    case 'coach_games': return runCoachGames(user);
    case 'lichess_opening': return runLichessOpening(args || {});
    case 'lichess_player': return runLichessPlayer(args || {});
    default: return { error: `Unknown tool: ${name}` };
  }
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
    res = await fetchCompat(url, { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; SiDaStuffChess/1.0; +https://lichess.org)' } });
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

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
}

module.exports = {
  BROWSER_TOOLS,
  TOOL_DEFINITIONS,
  runServerTool,
  runWebSearch,
  runCoachGames,
  runLichessOpening,
  runLichessPlayer,
};
