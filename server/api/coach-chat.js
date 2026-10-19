// AI Coach chat — streaming endpoint.
//
// NVIDIA-hosted inference; chess tools run in the browser or authenticated server.
// Available to every signed-in plan with a daily generated-output allowance.
//
// SSE events: init | token | tool_call | tool_status | tool_result_visible | done | error | heartbeat

const { requireFeature, activePlan, initAdmin, usageDay, reserveCoachTokens, reconcileCoachTokens } = require('./_lib/user-service');
const llm = require('./_lib/llm-service');
const { completionCost, compactHistory, publicCoachUsage } = require('./_lib/coach-budget');
const { randomUUID } = require('node:crypto');
const { TOOL_DEFINITIONS, getToolDefinitions, BROWSER_TOOLS, runServerTool } = require('./_lib/coach-tools');
// action-lock is intentionally NOT used here: coach chat never acquires the
// heavy-action lock (chatting during a review is allowed) and must never
// release it either — a release here would free a lock held by the user's
// running review and let a second review start on the shared engine.

const MAX_TOOL_ROUNDS = 5;       // cap agentic loops
const HEARTBEAT_MS = 20000;
// Per-uid concurrency + burst limits (in-process; defense-in-depth alongside
// the per-IP Express limit and the daily token cap). Stops one user spamming
// parallel streams to burn quota fast or starve the LLM pool.
//
// These are deliberately GENEROUS: a single coach message is one SSE stream,
// but a message that triggers several tool rounds (stockfish + web_search +
// fetch_games) can open a few streams back-to-back, and the user may send
// several messages in a row. The daily token cap is the real abuse limiter;
// this only guards against pathological parallel spam.
const COACH_MAX_CONCURRENT_PER_UID = 4;
const COACH_MAX_PER_MIN_PER_UID = 40;
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
// Reserve one bounded output budget for the complete tool loop; unused output
// is refunded. Prompts/history never consume the user's daily Coach allowance.
const COACH_RESERVE = 3000;

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
    user = await requireFeature({ headers: req.headers || {} }, 'coach');
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
    // coachAllowUid already incremented the in-flight counter — release it.
    coachReleaseUid(user.uid);
    sseWrite(res, 'error', { error: 'Empty message.', code: 'bad_request' });
    res.end();
    return;
  }

  // Heavy-action lock REMOVED (2026-09): chatting while a review runs is now
  // allowed. The old lock produced "You already have a coach chat running."
  // dead-ends for a feature that is fully metered anyway — every message
  // reserves + reconciles coach tokens against the daily plan cap below,
  // which is the real abuse limiter. (Client gate removed to match.)

  // Partial reservations keep the remaining allowance usable; all provider
  // rounds share this grant so concurrent streams cannot exceed the daily cap.
  let reserveAmount = COACH_RESERVE;
  let reservedTotal;
  let reservationDay;
  try {
    const r = await reserveCoachTokens(user.uid, reserveAmount, tokenLimit, { partial: true });
    if (!r.allowed) {
      coachReleaseUid(user.uid);
      sseWrite(res, 'error', {
        error: 'You\'ve used your daily AI Coach allowance. They reset at midnight UTC — or upgrade for more.',
        code: 'quota_exceeded',
        plan,
        usage: publicCoachUsage(r.total, tokenLimit, r.day),
      });
      res.end();
      return;
    }
    reservedTotal = r.total;
    reserveAmount = r.amount;
    reservationDay = r.day;
  } catch (err) {
    coachReleaseUid(user.uid);
    sseWrite(res, 'error', { error: 'Could not verify Coach allowance. Please try again.', code: 'quota_check_failed' });
    res.end();
    return;
  }

  // Chat history is client-owned (localStorage). The browser sends the prior
  // turns in `payload.history`; we do NOT load/persist anything server-side
  // (keeps multi-chat state in the user's browser where the sidebar lives).
  // Hard-cap what we accept: 50 turns × 4000 chars each (matching the per-message
  // cap). buildLlmMessages further bounds the history sent to the provider.
  // Previously the raw client array flowed through unchecked — the 2MB body
  // limit allowed ~500k tokens in one request, blowing the daily cap in a
  // single message.
  const clientHistory = Array.isArray(payload.history)
    ? payload.history.slice(-50).map((m) => ({
        role: m && m.role === 'assistant' ? 'assistant' : 'user',
        content: String((m && m.content) || '').slice(0, 4000),
      }))
    : [];

  let closed = false;
  res.on('close', () => { closed = true; });

  // Cooperative instance affinity: stamp the process pid on the init event so
  // the client can include it in /api/coach/tool-result. The sticky-routing in
  // nginx (hash on sid_device cookie) should already keep both on the same
  // instance; this pid is a backstop — when tool-result reports a pid mismatch
  // we can log it (and the client can retry), rather than timing out silently.
  sseWrite(res, 'init', { pid: process.pid, ts: Date.now() });

  const heartbeat = setInterval(() => { if (!closed) sseWrite(res, 'heartbeat', { ts: Date.now() }); }, HEARTBEAT_MS);
  const stopHeartbeat = () => clearInterval(heartbeat);

  const tokenUsage = { prompt: 0, completion: 0 };
  const context = { text, requestId: randomUUID() };
  try {
    // Build the LLM message list (system + last N client-supplied messages +
    // this one). The client already includes the current `text` in history, so
    // buildLlmMessages dedupes to avoid sending it twice.
    const llmMessages = buildLlmMessages(clientHistory, text, payload.reviewContext);

    // Run the tool loop, then stream the final answer.
    let assistantText = '';
    await runConversation({
      res, llmMessages, user, context, tokenUsage, outputBudget: reserveAmount, closedRef: () => closed,
      onToken: (t) => { assistantText += t; sseWrite(res, 'token', { text: t }); },
      onToolCall: (call) => sseWrite(res, 'tool_call', call),
      onToolStatus: (status) => sseWrite(res, 'tool_status', status),
      onToolResultVisible: (vis) => sseWrite(res, 'tool_result_visible', vis),
    });

    // Settle generated output, including provider reasoning, against the
    // original reservation day. Input tokens remain provider accounting only.
    const totalTokens = Math.min(reserveAmount, tokenUsage.completion);
    const delta = totalTokens - reserveAmount; // negative → refund the over-reservation
    let chargedTotal = reservedTotal;
    try {
      if (delta !== 0) {
        const rec = await reconcileCoachTokens(user.uid, delta, reservationDay);
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
    sseWrite(res, 'done', { ts: Date.now(), usage: publicCoachUsage(chargedTotal, tokenLimit, reservationDay) });
  } catch (err) {
    console.error('coach-chat error:', err && err.stack ? err.stack : err);
    // The stream failed before reconciliation — refund the up-front reservation
    // so the user isn't charged for a reply they never got. Best-effort: a
    // failed refund leaves them over-charged by the (bounded) reserve, not zero.
    if (user && user.uid) {
      try { await reconcileCoachTokens(user.uid, Math.min(reserveAmount, tokenUsage.completion + (tokenUsage.pending || 0)) - reserveAmount, reservationDay); }
      catch (_) {}
    }
    sseWrite(res, 'error', { error: err.message || 'Coach chat failed.', code: err.code || 'server_error' });
  } finally {
    // NOTE: no releaseHeavyAction here — chat never acquires the lock (chatting
    // during a review is allowed), and releasing would delete a lock held by
    // this user's RUNNING review, defeating the one-review-at-a-time guarantee.
    coachReleaseUid(user && user.uid);
    stopHeartbeat();
    if (!res.writableEnded) res.end();
  }
};

function buildLlmMessages(history, currentText, reviewContext) {
  const recent = compactHistory(history, currentText);
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
// already streamed live to the user. Every round shares the reserved output budget.
//
// Guards against the "No response." failure mode: (a) every token is counted in
// `emitted` via the `emit` wrapper, and (b) a guaranteed non-empty fallback is
// streamed if nothing was emitted, so the client always receives ≥1 token.
async function runConversation({ res, llmMessages, user, context, tokenUsage, outputBudget, closedRef, onToken, onToolCall, onToolStatus, onToolResultVisible }) {
  // Wrap onToken so we know whether ANY content was streamed across all rounds.
  let emitted = '';
  let pendingCharacters = 0;
  const countPartial = t => { pendingCharacters += String(t || '').length; tokenUsage.pending = Math.ceil(pendingCharacters / 4); };
  const emit = (t) => { if (t) { countPartial(t); emitted += t; onToken(t); } };
  const nextBudget = () => Math.min(3072, Math.max(0, outputBudget - tokenUsage.completion));
  const trackUsage = (result, reasoning) => {
    tokenUsage.prompt += Number(result?.usage?.prompt_tokens) || 0;
    tokenUsage.completion += completionCost(result, reasoning);
    tokenUsage.pending = 0;
    pendingCharacters = 0;
  };

  // Dedupe runaway web_search loops: if the model keeps re-issuing the SAME
  // query round after round (instead of answering), short-circuit it and force
  // the final-answer path so the user isn't left on "No response."
  let lastSearchQuery = null;
  let searchRepeatCount = 0;

  // Dedupe runaway stockfish loops: if the model keeps re-issuing the SAME
  // invalid FEN round after round (instead of answering), short-circuit it and
  // force the final-answer path. The browser tool returns an error for a bad
  // FEN, but some models stubbornly retry the identical malformed position
  // instead of giving up — which burns the whole tool budget on a loop the user
  // sees as repeated "Invalid FEN" cards. We also cap the total number of
  // consecutive stockfish calls so a model that keeps trying DIFFERENT (still
  // failing) positions can't spin forever either.
  let lastStockfishFen = null;
  let stockfishRepeatCount = 0;
  let stockfishConsecutive = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (closedRef()) throw new Error('Client disconnected.');
    if (!nextBudget()) break;
    let roundReasoning = '';

    // Stream this turn WITH tools available. We accumulate content (piped live
    // to emit) and tool_calls (assembled from deltas) in parallel. Reasoning
    // deltas (chain of thought from reasoning models) stream as `reasoning`
    // SSE events — visible to the user as live "thinking" text, never stored
    // as reply content.
    const streamRes = await llm.chatCompletion({
      messages: llmMessages, tools: getToolDefinitions(), toolChoice: 'auto',
      stream: true, maxTokens: nextBudget(), temperature: 0.3,
    });
    const result = await llm.streamDeltas(streamRes, emit, {
      onReasoning: (t) => { roundReasoning += t; countPartial(t); if (!closedRef()) sseWrite(res, 'reasoning', { text: t }); },
    });
    trackUsage(result, roundReasoning);
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

    // Detect a stuck single-tool stockfish loop and break out early. Two
    // triggers: (a) the SAME FEN re-issued repeatedly, or (b) too many
    // consecutive stockfish calls in a row (the model is stuck trying to
    // analyze instead of answering). Feed back a "stop analyzing" result so
    // the model sees the position is unusable and moves on to a real answer.
    const onlyStockfish = result.toolCalls.length === 1 && result.toolCalls[0].name === 'stockfish';
    if (onlyStockfish) {
      stockfishConsecutive += 1;
      const fen = String(result.toolCalls[0].args && result.toolCalls[0].args.fen || '').trim();
      let stuck = false;
      if (fen && fen === lastStockfishFen) {
        stockfishRepeatCount += 1;
        if (stockfishRepeatCount >= 2) stuck = true;
      } else {
        lastStockfishFen = fen; stockfishRepeatCount = fen ? 1 : 0;
      }
      // Cap consecutive stockfish calls (even with different FENs) so a model
      // that keeps trying to analyze instead of answering can't spin forever.
      if (stockfishConsecutive >= 3) stuck = true;
      if (stuck) {
        const c = result.toolCalls[0];
        const callId = c.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        llmMessages.push({ role: 'tool', tool_call_id: c.id || callId, name: 'stockfish', content: JSON.stringify({ error: 'This position could not be analyzed (invalid FEN). Do not retry this position — answer the user directly without the stockfish tool.' }) });
        break;
      }
    } else {
      lastStockfishFen = null; stockfishRepeatCount = 0; stockfishConsecutive = 0;
    }

    // Execute each tool call.
    for (const call of result.toolCalls) {
      const callId = call.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      if (BROWSER_TOOLS.has(call.name)) {
        onToolCall({ id: callId, name: call.name, args: call.args });
        let toolResult;
        try {
          // Race the parked call against the client disconnect: if the user
          // closed the tab, don't hold this conversation (and its engine/LLM
          // loop) for the full 60s tool timeout — fail the tool immediately.
          // registerToolCall's entry stays parked until its own timer or a
          // (now impossible) late result resolves it — harmless either way.
          toolResult = await Promise.race([
            registerToolCall(callId, user.uid),
            new Promise((_, reject) => {
              const check = setInterval(() => {
                if (closedRef()) {
                  clearInterval(check);
                  reject(new Error('Client disconnected while waiting for the browser tool.'));
                }
              }, 1000);
              // Defensive cleanup so the interval can't outlive the race.
              setTimeout(() => clearInterval(check), 62000).unref?.();
            }),
          ]);
        }
        catch (e) { toolResult = { error: e.message || 'Browser tool failed.' }; }
        const summary = summariseBrowserResult(call.name, toolResult);
        if (summary) onToolResultVisible({ id: callId, name: call.name, summary });
        llmMessages.push({ role: 'tool', tool_call_id: call.id || callId, name: call.name, content: JSON.stringify(toolResult) });
      } else {
        onToolStatus({ id: callId, name: call.name, label: toolLabel(call.name) });
        let toolResult;
        try { toolResult = await runServerTool(call.name, call.args, user, context); }
        catch (e) { toolResult = { error: e.message || 'Tool failed.' }; }
        // fetch_games carries the per-game PGNs so the client can render
        // clickable "Review" cards — piggyback them on the visible event.
        const visibleExtra = (call.name === 'fetch_games' && Array.isArray(toolResult && toolResult.games))
          ? { games: toolResult.games.map(({ pgn, white, black, outcome, date, opening }) => ({ pgn, white, black, outcome, date, opening })) }
          : {};
        onToolResultVisible({ id: callId, name: call.name, summary: toolResultSummary(call.name, toolResult), ...visibleExtra });
        llmMessages.push({ role: 'tool', tool_call_id: call.id || callId, name: call.name, content: JSON.stringify(toolResult) });
      }
    }
    // Loop back: the model now has tool results and streams its next turn.
  }

  // Either the loop produced content and broke (normal) or we exhausted rounds
  // without a clean stop. Force one streamed answer with no tools available,
  // nudging the model to answer from what it already knows.
  if (!nextBudget()) {
    if (!emitted.trim()) emit('Your remaining daily Coach allowance was used on this request. It resets at midnight UTC.');
    return { tokenUsage };
  }
  let roundReasoning = '';
  llmMessages.push({ role: 'system', content: 'Answer the user now in plain prose using the information you already have. Do not call any more tools.' });
  const finalRes = await llm.chatCompletion({
    messages: llmMessages, stream: true, temperature: 0.4, maxTokens: nextBudget(),
  });
  const finalStream = await llm.streamDeltas(finalRes, emit, {
    onReasoning: (t) => { roundReasoning += t; countPartial(t); if (!closedRef()) sseWrite(res, 'reasoning', { text: t }); },
  });
  trackUsage(finalStream, roundReasoning);

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
  if (name === 'report_coach_misuse') return 'Checking chat boundaries';
  if (name === 'coach_games') return 'Reading your chess profile…';
  if (name === 'stockfish') return 'Analyzing the position…';
  if (name === 'lichess_opening') return 'Looking up the opening…';
  if (name === 'lichess_player') return 'Looking up the player…';
  if (name === 'fetch_games') return 'Fetching recent games…';
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
  if (name === 'report_coach_misuse') return result.reported ? 'Repeated misuse reported for administrator review.' : 'Reminder: keep Coach chats respectful and focused on chess.';
  if (name === 'coach_games') return result.summary || 'No chess profile on file.';
  if (name === 'lichess_opening') return result.summary || (result.opening || 'No opening data.');
  if (name === 'lichess_player') return result.summary || (result.username || 'No player data.');
  if (name === 'fetch_games') return result.summary || (result.error ? result.error : 'No games fetched.');
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
exports.buildLlmMessages = buildLlmMessages;
exports.runConversation = runConversation;
exports.resolveToolCall = resolveToolCall;
exports.isBrowserToolCallPending = (callId) => pendingToolCalls.has(callId);
