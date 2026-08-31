// AI Coach chat — streaming endpoint.
//
// Streams an LLM reply (Cerebras, OpenAI-compatible) to the browser over SSE,
// with a tool-use loop: the model can call tools (stockfish runs in the
// browser; web_search/coach_games run server-side). Reuses the SSE pattern
// from analyze.js streamHandler + users-me-stream.js.
//
// Max-users-only. API keys stay server-side (llm-service.js: Cerebras primary, Groq fallback).
//
// SSE events: init | token | tool_call | tool_status | tool_result_visible | done | error | heartbeat

const { requireUser, activePlan, initAdmin, usageDay, reserveCoachTokens, reconcileCoachTokens } = require('./_lib/user-service');
const llm = require('./_lib/llm-service');
const { TOOL_DEFINITIONS, getToolDefinitions, BROWSER_TOOLS, runServerTool } = require('./_lib/coach-tools');
const { acquireHeavyAction, releaseHeavyAction, getBusyAction } = require('./_lib/action-lock');

const LLM_HISTORY_LIMIT = 20;    // prior turns sent to the LLM (client caps this too)
const MAX_TOOL_ROUNDS = 5;       // cap agentic loops
const HEARTBEAT_MS = 20000;
// Per-uid concurrency + burst limits (in-process; defense-in-depth alongside
// the per-IP Express limit and the daily token cap). Stops one user spamming
// parallel streams to burn quota fast or starve the LLM pool.
const COACH_MAX_CONCURRENT_PER_UID = 2;
const COACH_MAX_PER_MIN_PER_UID = 12;
const coachInFlight = new Map(); // uid -> count of active streams
const coachRecent = new Map();   // uid -> [timestamps]
function coachAllowUid(uid) {
  if (!uid) return true;
  const now = Date.now();
  const win = 60000;
  const recent = (coachRecent.get(uid) || []).filter((t) => now - t < win);
  if (recent.length >= COACH_MAX_PER_MIN_PER_UID) { coachRecent.set(uid, recent); return false; }
  const inFlight = coachInFlight.get(uid) || 0;
  if (inFlight >= COACH_MAX_CONCURRENT_PER_UID) { coachRecent.set(uid, recent); return false; }
  recent.push(now); coachRecent.set(uid, recent);
  coachInFlight.set(uid, inFlight + 1);
  return true;
}
function coachReleaseUid(uid) {
  if (!uid) return;
  const inFlight = coachInFlight.get(uid) || 0;
  const next = Math.max(0, inFlight - 1);
  // Free the Map slots once a uid has no active streams and no recent bursts —
  // otherwise coachInFlight/coachRecent hold stale zero/empty entries forever
  // (one per distinct uid seen over the process lifetime).
  if (next === 0) coachInFlight.delete(uid);
  else coachInFlight.set(uid, next);
  const now = Date.now();
  const win = 60000;
  const recent = (coachRecent.get(uid) || []).filter((t) => now - t < win);
  if (recent.length === 0) coachRecent.delete(uid);
  else coachRecent.set(uid, recent);
}
// No Fast/Strong tiers anymore — a single model is used for every coach
// message (see llm-service.js: gpt-oss-120b, falling back to gpt-oss-20b).
// Quota cost is flat per message.
const COACH_TIER_MULTIPLIER = 1;
// Worst-case token cost reserved up front per request (before the real cost is
// known). Sized to comfortably cover a max-length reply + a tool-loop turn, so
// the atomic pre-reserve can't under-count a real request. Any over-reservation
// is refunded after the stream via reconcile.
const COACH_RESERVE = Math.round(3000 * COACH_TIER_MULTIPLIER);

function sseWrite(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data || {})}\n\n`);
}

// Pending browser-tool results: callId -> { resolve, timer }.
// Shared across the process (one Node process, multiple in-flight chats).
const pendingToolCalls = new Map();

// Bind each pending call to the uid that owns the conversation. Only that user
// may resolve it — otherwise any signed-in user on this process could POST a
// crafted tool result and inject content into (and burn the quota of) another
// user's in-flight Coach conversation.
function registerToolCall(callId, uid) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingToolCalls.has(callId)) {
        pendingToolCalls.delete(callId);
        reject(new Error('Browser tool timed out.'));
      }
    }, 60000);
    pendingToolCalls.set(callId, { uid: uid || null, resolve, timer });
  });
}

// Resolve a pending call. Returns 'resolved' on success, 'not_found' if no such
// call exists, or 'forbidden' if the caller is not the owning uid. Never
// resolves a call the caller doesn't own.
function resolveToolCall(callId, result, uid) {
  const entry = pendingToolCalls.get(callId);
  if (!entry) return 'not_found';
  if (entry.uid && uid && entry.uid !== uid) return 'forbidden';
  clearTimeout(entry.timer);
  pendingToolCalls.delete(callId);
  entry.resolve(result);
  return 'resolved';
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
}

exports.streamHandler = async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  let user;
  try {
    user = await requireUser({ headers: req.headers || {} });
  } catch (err) {
    sseWrite(res, 'error', { error: err.message || 'Login required.', code: err.code || 'unauthorized' });
    res.end();
    return;
  }

  // Per-user rate limit (in addition to per-IP): cap concurrent streams and
  // bursts so one account can't hog the LLM pool or race the quota.
  if (!coachAllowUid(user.uid)) {
    sseWrite(res, 'error', { error: 'Too many Coach requests at once. Please slow down.', code: 'rate_limited' });
    res.end();
    return;
  }

  // All signed-in users can use the coach. Token allowance is tier-based:
  // free=5k/day, boost=20k/day, max=100k/day.
  const plan = activePlan(user._profile || {});
  const tokenLimit = (plan.limits && plan.limits.coachTokensPerDay) || 0;

  const payload = parseBody(req);
  const text = String(payload.message || '').slice(0, 4000).trim();
  if (!text) {
    sseWrite(res, 'error', { error: 'Empty message.', code: 'bad_request' });
    res.end();
    return;
  }

  // Heavy-action lock: block coach chat while a game review is running for the
  // same user (and vice versa). This is backend defense in depth on top of the
  // frontend mutual-exclusion popup.
  if (!acquireHeavyAction(user.uid, 'coach')) {
    const busy = getBusyAction(user.uid);
    sseWrite(res, 'error', {
      error: busy === 'review'
        ? 'A game review is running. Please wait for it to finish before using the coach.'
        : 'You already have a coach chat running. Please wait for it to finish.',
      code: 'heavy_action_busy',
    });
    res.end();
    return;
  }

  // Atomic quota gate: reserve a worst-case cost up front (transactional, so N
  // parallel requests can't all pass the gate on the same stale read and run up
  // the LLM bill past the cap). The over-reservation is refunded after the
  // stream once the real cost is known. `reserveTotal` is the post-reserve total.
  const reserveAmount = COACH_RESERVE;
  let reservedTotal;
  try {
    const r = await reserveCoachTokens(user.uid, reserveAmount, tokenLimit);
    if (!r.allowed) {
      releaseHeavyAction(user.uid);
      sseWrite(res, 'error', {
        error: 'You\'ve used all your daily Coach tokens. They reset at midnight UTC — or upgrade for more.',
        code: 'quota_exceeded',
        plan,
        usage: { coachTokens: r.total, coachTokenLimit: tokenLimit },
      });
      res.end();
      return;
    }
    reservedTotal = r.total;
  } catch (err) {
    releaseHeavyAction(user.uid);
    sseWrite(res, 'error', { error: 'Could not verify token quota. Please try again.', code: 'quota_check_failed' });
    res.end();
    return;
  }

  // Chat history is client-owned (localStorage). The browser sends the prior
  // turns in `payload.history`; we do NOT load/persist anything server-side
  // (keeps multi-chat state in the user's browser where the sidebar lives).
  const clientHistory = Array.isArray(payload.history) ? payload.history : [];

  let closed = false;
  req.on('close', () => { closed = true; });

  // Cooperative instance affinity: stamp the process pid on the init event so
  // the client can include it in /api/coach/tool-result. The sticky-routing in
  // nginx (hash on sid_device cookie) should already keep both on the same
  // instance; this pid is a backstop — when tool-result reports a pid mismatch
  // we can log it (and the client can retry), rather than timing out silently.
  sseWrite(res, 'init', { pid: process.pid, ts: Date.now() });

  const heartbeat = setInterval(() => { if (!closed) sseWrite(res, 'heartbeat', { ts: Date.now() }); }, HEARTBEAT_MS);
  const stopHeartbeat = () => clearInterval(heartbeat);

  try {
    // Build the LLM message list (system + last N client-supplied messages +
    // this one). The client already includes the current `text` in history, so
    // buildLlmMessages dedupes to avoid sending it twice.
    const llmMessages = buildLlmMessages(clientHistory, text, payload.reviewContext);

    // Run the tool loop, then stream the final answer.
    let assistantText = '';
    const conv = await runConversation({
      res, llmMessages, user, closedRef: () => closed,
      onToken: (t) => { assistantText += t; sseWrite(res, 'token', { text: t }); },
      onToolCall: (call) => sseWrite(res, 'tool_call', call),
      onToolStatus: (status) => sseWrite(res, 'tool_status', status),
      onToolResultVisible: (vis) => sseWrite(res, 'tool_result_visible', vis),
    });

    // Reconcile the charge to the REAL cost. We reserved a worst-case cost up
    // front (reserveAmount); now apply the signed delta = realCost - reserved.
    // Prefers REAL provider token counts (these include reasoning/"thinking"
    // tokens it bills but never streams); falls back to a char estimate
    // (~4 chars/token) when a provider omits usage. Scaled by the tier multiplier
    // (Strong = 2×). Done BEFORE `done` so the client's usage bar is authoritative.
    const usage = conv && conv.tokenUsage;
    const realInput = Number(usage && usage.prompt) || 0;
    const realOutput = Number(usage && usage.completion) || 0;
    const inputTokens = realInput || Math.ceil(JSON.stringify(llmMessages).length / 4);
    const outputTokens = realOutput || Math.ceil(assistantText.length / 4);
    const totalTokens = Math.round((inputTokens + outputTokens) * COACH_TIER_MULTIPLIER);
    const delta = totalTokens - reserveAmount; // negative → refund the over-reservation
    let chargedTotal = reservedTotal;
    try {
      if (delta !== 0) {
        const rec = await reconcileCoachTokens(user.uid, delta);
        chargedTotal = rec.total;
      }
    } catch (err) {
      // Don't swallow: log so a failed reconcile is visible. The reserve already
      // happened, so the user is at most over-charged by the (bounded) reserve —
      // never under-charged. Surface the reserved total to the client.
      console.error('[coach] token reconcile failed:', err && err.message ? err.message : err);
      chargedTotal = reservedTotal;
    }

    // `done` now means stream AND charge complete — carries the fresh usage so
    // the client can update its bar without a separate round-trip.
    sseWrite(res, 'done', { ts: Date.now(), usage: { coachTokens: chargedTotal, coachTokenLimit: tokenLimit } });
  } catch (err) {
    console.error('coach-chat error:', err && err.stack ? err.stack : err);
    // The stream failed before reconciliation — refund the up-front reservation
    // so the user isn't charged for a reply they never got. Best-effort: a
    // failed refund leaves them over-charged by the (bounded) reserve, not zero.
    if (user && user.uid) {
      try { await reconcileCoachTokens(user.uid, -reserveAmount); }
      catch (_) {}
    }
    sseWrite(res, 'error', { error: err.message || 'Coach chat failed.', code: err.code || 'server_error' });
  } finally {
    releaseHeavyAction(user && user.uid);
    coachReleaseUid(user && user.uid);
    stopHeartbeat();
    if (!res.writableEnded) res.end();
  }
};

function buildLlmMessages(history, currentText, reviewContext) {
  const recent = history.slice(-LLM_HISTORY_LIMIT);
  const msgs = [{ role: 'system', content: llm.SYSTEM_PROMPT }];
  // Optional review seed: when the chat was opened from a game review, the
  // client sends the reviewed game's compact data so the coach can answer
  // follow-up questions about it WITHOUT re-running a full review (the coach
  // is otherwise forbidden from reviewing games inline). Injected as a second
  // system message so it applies to every turn in the chat. The model MUST
  // still verify position/move claims with the stockfish tool rather than
  // relying only on this summary.
  if (reviewContext && typeof reviewContext === 'object') {
    msgs.push({ role: 'system', content: `The user opened this chat from a reviewed game. Here is the engine review data you can reference (evals are White's perspective, in centipawns unless noted). Do NOT invent facts from this data — when the user asks about a position, move, or evaluation, use the stockfish tool to verify before answering.\n\n${JSON.stringify(reviewContext).slice(0, 8000)}` });
  }
  for (const m of recent) {
    if (m.role === 'user' || m.role === 'assistant') {
      msgs.push({ role: m.role, content: String(m.content || '') });
    }
  }
  // The client includes the current message at the end of `history`; only
  // append it again if it isn't already the last message (avoid double-send).
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'user' || last.content !== currentText) {
    msgs.push({ role: 'user', content: currentText });
  }
  return msgs;
}

// Tool loop: each round STREAMS the model turn (real time-to-first-token). If
// the model emits tool_calls, execute them and loop; otherwise the content was
// already streamed live to the user. maxTokens is generous so a normal detailed
// reply isn't truncated mid-sentence (Strong gets more headroom).
//
// Guards against the "No response." failure mode: (a) every token is counted in
// `emitted` via the `emit` wrapper, and (b) a guaranteed non-empty fallback is
// streamed if nothing was emitted, so the client always receives ≥1 token.
async function runConversation({ res, llmMessages, user, closedRef, onToken, onToolCall, onToolStatus, onToolResultVisible }) {
  // Wrap onToken so we know whether ANY content was streamed across all rounds.
  let emitted = '';
  const emit = (t) => { if (t) { emitted += t; onToken(t); } };
  const maxTokens = 3072;
  // Accumulate real token usage across rounds (for charging thinking tokens).
  const tokenUsage = { prompt: 0, completion: 0 };
  const trackUsage = (u) => {
    if (!u) return;
    // prompt_tokens is the same growing context each round; take the max seen.
    const p = Number(u.prompt_tokens) || 0;
    if (p > tokenUsage.prompt) tokenUsage.prompt = p;
    // completion accumulates across rounds (incl. reasoning/thinking tokens a
    // provider may report under completion_tokens_details.reasoning_tokens).
    const c = Number(u.completion_tokens) || 0;
    const reasoning = Number(u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0;
    tokenUsage.completion += Math.max(c, reasoning);
  };

  // Dedupe runaway web_search loops: if the model keeps re-issuing the SAME
  // query round after round (instead of answering), short-circuit it and force
  // the final-answer path so the user isn't left on "No response."
  let lastSearchQuery = null;
  let searchRepeatCount = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (closedRef()) throw new Error('Client disconnected.');

    // Stream this turn WITH tools available. We accumulate content (piped live
    // to emit) and tool_calls (assembled from deltas) in parallel.
    const streamRes = await llm.chatCompletion({
      messages: llmMessages, tools: getToolDefinitions(), toolChoice: 'auto',
      stream: true, maxTokens, temperature: 0.3,
    });
    const result = await llm.streamDeltas(streamRes, emit);
    trackUsage(result && result.usage);
    const finalText = (result && result.content) || '';

    if (!result.toolCalls.length) {
      // No tool call: content already streamed live. Record it for history.
      if (finalText) llmMessages.push({ role: 'assistant', content: finalText });
      if (!emitted.trim()) emit(fallbackReply()); // never leave the client empty
      return { tokenUsage };
    }

    // The model called one or more tools. Record the assistant turn (with the
    // OpenAI tool_calls shape, incl. the id used below as tool_call_id).
    llmMessages.push({
      role: 'assistant',
      content: finalText || null,
      tool_calls: result.toolCalls.map((c) => ({
        id: c.id, type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      })),
    });

    // Detect a stuck single-tool web_search loop and break out early.
    const onlySearch = result.toolCalls.length === 1 && result.toolCalls[0].name === 'web_search';
    if (onlySearch) {
      const q = String(result.toolCalls[0].args && result.toolCalls[0].args.query || '').trim().toLowerCase();
      if (q && q === lastSearchQuery) {
        searchRepeatCount += 1;
        if (searchRepeatCount >= 2) {
          // Feed back a "stop searching" result for the tool_call_id, then force
          // the final answer instead of re-running the identical search.
          const c = result.toolCalls[0];
          const callId = c.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          llmMessages.push({ role: 'tool', tool_call_id: c.id || callId, name: 'web_search', content: JSON.stringify({ query: q, results: [], note: 'Already searched for this — answer from the results above.' }) });
          break;
        }
      } else {
        lastSearchQuery = q; searchRepeatCount = q ? 1 : 0;
      }
    } else {
      lastSearchQuery = null; searchRepeatCount = 0;
    }

    // Execute each tool call.
    for (const call of result.toolCalls) {
      const callId = call.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      if (BROWSER_TOOLS.has(call.name)) {
        onToolCall({ id: callId, name: call.name, args: call.args });
        let toolResult;
        try { toolResult = await registerToolCall(callId, user.uid); }
        catch (e) { toolResult = { error: e.message || 'Browser tool failed.' }; }
        const summary = summariseBrowserResult(call.name, toolResult);
        if (summary) onToolResultVisible({ id: callId, name: call.name, summary });
        llmMessages.push({ role: 'tool', tool_call_id: call.id || callId, name: call.name, content: JSON.stringify(toolResult) });
      } else {
        onToolStatus({ id: callId, name: call.name, label: toolLabel(call.name) });
        let toolResult;
        try { toolResult = await runServerTool(call.name, call.args, user); }
        catch (e) { toolResult = { error: e.message || 'Tool failed.' }; }
        onToolResultVisible({ id: callId, name: call.name, summary: toolResultSummary(call.name, toolResult) });
        llmMessages.push({ role: 'tool', tool_call_id: call.id || callId, name: call.name, content: JSON.stringify(toolResult) });
      }
    }
    // Loop back: the model now has tool results and streams its next turn.
  }

  // Either the loop produced content and broke (normal) or we exhausted rounds
  // without a clean stop. Force one streamed answer with no tools available,
  // nudging the model to answer from what it already knows.
  llmMessages.push({ role: 'system', content: 'Answer the user now in plain prose using the information you already have. Do not call any more tools.' });
  const finalRes = await llm.chatCompletion({
    messages: llmMessages, stream: true, temperature: 0.4, maxTokens,
  });
  const finalStream = await llm.streamDeltas(finalRes, emit);
  trackUsage(finalStream && finalStream.usage);

  // Last-resort guarantee: if nothing was streamed across all rounds AND the
  // forced answer, emit a short honest message so the client never shows
  // "No response." This flows through onToken once (streamed + charged once).
  if (!emitted.trim()) emit(fallbackReply());
  return { tokenUsage };
}

// Canned reply used only when the model emitted no content at all. Kept short,
// warm, and chess-scoped (consistent with the SYSTEM_PROMPT), and it steers the
// user toward something the coach can actually help with.
function fallbackReply() {
  return "I couldn't verify an answer with Stockfish or the available tools, so I don't want to guess. Could you rephrase, or ask me something specific — like an opening to explain, a position to evaluate (paste a FEN), or a game to review (paste a PGN)?";
}

function toolLabel(name) {
  if (name === 'web_search') return 'Searching the web…';
  if (name === 'exa_search') return 'Searching the web (Exa)…';
  if (name === 'coach_games') return 'Reading your chess profile…';
  if (name === 'stockfish') return 'Analyzing the position…';
  if (name === 'lichess_opening') return 'Looking up the opening…';
  if (name === 'lichess_player') return 'Looking up the player…';
  return 'Working…';
}

// Human-readable summary of a BROWSER tool result for the visible tool card.
// Returns null when the client already renders its own affordance (game_review
// popup, ask_question buttons) so we don't duplicate; returns a summary for
// stockfish (eval), or an error string when a browser tool failed/timed out so
// the UI isn't left on a stuck "Analyzing…" spinner.
function summariseBrowserResult(name, result) {
  if (result && result.error) return `${name} failed: ${result.error}`;
  if (name === 'stockfish') {
    if (!result) return null;
    // An empty/failed result (no bestMove + depth 0) is NOT a real eval — never
    // display "+0.00" as though the engine clears the position. Surface an honest
    // "no result" so the user (and the visible tool card) isn't misled.
    if (!result.bestMove && (!result.depth || result.depth === 0)) {
      return 'Stockfish returned no result (possibly timed out).';
    }
    const mate = result.scoreType === 'mate' ? `M${result.score}` : `${(result.score / 100).toFixed(2)}`;
    return `Stockfish d${result.depth || '?'}: ${mate} (side to move) — best ${result.bestMove || '?'}`;
  }
  // game_review / ask_question / end_conversation render their own UI client-side.
  return null;
}

// Human-readable summary of a SERVER tool result for the visible tool card.
// Never dumps raw JSON — the SYSTEM_PROMPT forbids echoing raw tool data, and
// the UI's own tool card must honor that too.
function toolResultSummary(name, result) {
  if (!result) return 'no data';
  if (result.error) return result.error;
  if (name === 'coach_games') return result.summary || 'No chess profile on file.';
  if (name === 'lichess_opening') return result.summary || (result.opening || 'No opening data.');
  if (name === 'lichess_player') return result.summary || (result.username || 'No player data.');
  if (name === 'web_search') {
    const rs = Array.isArray(result.results) ? result.results : [];
    if (!rs.length) return result.note || 'No results found.';
    const titles = rs.slice(0, 3).map((r) => r.title).filter(Boolean).join('; ');
    return `Found ${rs.length}: ${titles}`;
  }
  if (name === 'exa_search') {
    const rs = Array.isArray(result.results) ? result.results : [];
    if (!rs.length) return result.note || 'No results found.';
    const titles = rs.slice(0, 3).map((r) => r.title).filter(Boolean).join('; ');
    return `Found ${rs.length}: ${titles}`;
  }
  // Fallback (shouldn't happen for known tools): a short, non-JSON hint.
  return typeof result === 'string' ? result.slice(0, 120) : 'Done.';
}

// Exported for coach-tool-result.js (plain POST endpoint resolves a parked call).
exports.resolveToolCall = resolveToolCall;
exports.isBrowserToolCallPending = (callId) => pendingToolCalls.has(callId);
