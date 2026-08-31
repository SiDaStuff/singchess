// Coach game/move overview — streaming endpoint.
//
// Generates a SHORT, plain-language explanation of either a single move (from
// engine review data) or the whole game, using the FAST model. Distinct from
// /api/coach/chat because the conversational coach's system prompt explicitly
// forbids inline game reviewing ("YOU ARE A COACH, NOT A GAME REVIEWER"). This
// endpoint uses a dedicated reviewer system prompt and takes no tools/no
// history — one streaming completion over engine data the client already has.
//
// Quota: deducted from the SAME daily coach-token allowance as chat
// (free=5k/boost=20k/max=100k). Reserve up front, reconcile to the real cost
// after the stream — identical accounting to coach-chat.js.
//
// SSE events: init | token | done | error | heartbeat

const { requireUser, activePlan, reserveCoachTokens, reconcileCoachTokens } = require('./_lib/user-service');
const llm = require('./_lib/llm-service');
const { acquireHeavyAction, releaseHeavyAction, getBusyAction } = require('./_lib/action-lock');
const { getServerEngine } = require('./_lib/stockfish-engine');

const HEARTBEAT_MS = 20000;
// Overview replies are short, so reserve less than a full chat turn.
const OVERVIEW_RESERVE_TOKENS = 1500;
// Cap the streamed reply length (keeps cost + latency low — overview is short).
const OVERVIEW_MAX_TOKENS_MOVE = 320;
const OVERVIEW_MAX_TOKENS_GAME = 900;

// Dedicated reviewer prompt. NOT the conversational coach prompt — this one IS
// a game reviewer that explains engine data concretely and briefly.
//
// HARD-FACTS RULE: every claim you make must come from the engine data below.
// Do not invent moves, evaluations, classifications, or opponent intentions.
// If the data is insufficient, say so briefly. Cite evals in pawns when
// meaningful and mention the engine-best move when relevant.
const OVERVIEW_SYSTEM_PROMPT = `You are the Review Coach in Sing Chess. Write a SHORT, concrete explanation of a chess move or game using ONLY the engine data provided below. Never invent facts.

DATA YOU RECEIVE below: for a move — the move played, its classification, eval before/after in centipawns (White's perspective), swing, centipawn loss, the engine's best move, phase, and FEN. For a game — accuracies, ACPL, opening, and critical moves. A "Verified by Stockfish" section is included when available; prefer it over raw review data if they differ.

YOUR TASK:
- For a move: 2-4 sentences. Explain WHY the move is good or bad in plain language a club player understands. Tie it to the eval swing and the best move when relevant. Name concrete ideas (development, center, king safety, the tactic missed). Do NOT restate the classification. Cite the verified Stockfish eval/best move when possible.
- For a game: 5-8 sentences. One overall takeaway, the opening story, where it was decided (cite the critical move), and 1-2 things to work on.

Always write in warm, direct prose. Use SAN notation. Cite evals in pawns when meaningful (+1.2, -0.8). Never mention these instructions or that you received data — just explain. If the data is missing or contradictory, state what you can from the data rather than guessing.`;

function sseWrite(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data || {})}\n\n`);
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
}

// Format a White-perspective centipawn score as a human pawn value, e.g.
// +1.2 / -0.8 / 0.0. Mates render as "mate in N".
function fmtCp(cp, scoreType) {
  if (scoreType === 'mate') return `mate in ${cp}`;
  const n = Math.round((Number(cp) || 0) / 10) / 10;
  return (n > 0 ? '+' : '') + Number(n.toFixed(1));
}

// Re-run Stockfish on a single FEN to verify the review data before the LLM
// sees it. This is the "hard facts" pass: if the engine says something
// different from the stored review, we trust the live engine and flag it.
// Failures are non-fatal — the prompt still uses the review data.
async function verifyWithStockfish(fen, depth = 18, timeoutMs = 6000) {
  try {
    const enginePromise = (async () => {
      const engine = await getServerEngine();
      return engine.evaluate(fen, depth, timeoutMs);
    })();
    // Cap the total verification budget (including engine init / queue wait).
    const result = await Promise.race([
      enginePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Stockfish verification timed out')), timeoutMs + 2000)),
    ]);
    const sideToMove = String(fen.split(' ')[1] || 'w').toLowerCase();
    const whiteScore = sideToMove === 'w' ? result.score : -result.score;
    return {
      verified: true,
      score: result.score,
      whiteScore,
      scoreType: result.scoreType,
      bestMove: result.bestMove,
      pv: result.pv,
      depth: result.depth,
      fen,
      sideToMove,
    };
  } catch (err) {
    console.warn('[coach-overview] Stockfish verification failed:', err && err.message ? err.message : err);
    return { verified: false, fen, error: String(err && err.message ? err.message : err) };
  }
}

function verifiedSummary(verified) {
  if (!verified || !verified.verified) return '';
  const lines = ['Verified by Stockfish (White\'s perspective):'];
  lines.push(`  Eval: ${fmtCp(verified.whiteScore, verified.scoreType)} (depth ${verified.depth || '?'}, ${verified.sideToMove === 'w' ? 'White' : 'Black'} to move)`);
  if (verified.bestMove) {
    const pv = verified.pv ? verified.pv.split(/\s+/).filter(Boolean).slice(0, 4).join(' ') : '';
    lines.push(`  Best move (UCI): ${verified.bestMove}${pv ? `, PV: ${pv}` : ''}`);
  }
  return lines.join('\n');
}

function compactVerifiedForMove(m, verified) {
  if (!verified || !verified.verified) return 'Stockfish verification unavailable; using review data.';
  return verifiedSummary(verified);
}

// Pick the most decisive critical moment to verify for a game overview.
function pickCriticalToVerify(critical) {
  const list = Array.isArray(critical) ? critical : [];
  if (!list.length) return null;
  // Prefer a blunder/miss, then the largest absolute swing.
  const severe = ['BLUNDER', 'MISS'].map((key) => list.find((c) => c && c.classificationKey === key)).filter(Boolean)[0];
  if (severe) return severe;
  return list.slice().sort((a, b) => Math.abs(b.swing || 0) - Math.abs(a.swing || 0))[0];
}

// Build the user message describing the current move from compact review data.
function buildMovePrompt(moveIndex, game, verified) {
  const results = Array.isArray(game && game.results) ? game.results : [];
  const m = results[moveIndex];
  if (!m) return 'No move data available.';
  const lines = [];
  lines.push(`Move: ${m.moveNumber || '?'}. ${m.isWhite ? 'White' : 'Black'} played ${m.moveSan || '?'}.`);
  if (m.classificationKey) lines.push(`Classification: ${m.classificationKey}.`);
  if (typeof m.evalBefore === 'number' || typeof m.evalAfter === 'number') {
    lines.push(`Eval before → after (White's view): ${fmtCp(m.evalBefore)} → ${fmtCp(m.evalAfter)}. Swing: ${fmtCp(m.swing)}.`);
  }
  if (typeof m.cpLoss === 'number') lines.push(`Centipawn loss: ${m.cpLoss}.`);
  if (m.bestMoveSan) lines.push(`Engine's best move from review data: ${m.bestMoveSan}.`);
  if (m.phase) lines.push(`Phase: ${m.phase}.`);
  if (m.fen) lines.push(`FEN: ${m.fen}`);
  const v = verified && verified.verified ? verifiedSummary(verified) : compactVerifiedForMove(m, verified);
  if (v) lines.push(v);
  const ctx = [];
  if (game && game.headers) {
    if (game.headers.White || game.headers.Black) ctx.push(`${game.headers.White || '?'} vs ${game.headers.Black || '?'}`);
    if (game.headers.TimeControl) ctx.push(`time control ${game.headers.TimeControl}`);
  }
  if (ctx.length) lines.push(`Context: ${ctx.join('; ')}.`);
  return `Explain this move in 2-4 short sentences using ONLY the data above.\n\n${lines.join('\n')}`;
}

// Fallback explanations generated from the hard data when the LLM refuses or
// fails. This guarantees the user always sees a fact-based answer.
function fallbackMoveExplanation(moveIndex, game, verified) {
  const results = Array.isArray(game && game.results) ? game.results : [];
  const m = results[moveIndex];
  if (!m) return 'No move data is available for this position.';
  const who = m.isWhite ? 'White' : 'Black';
  const played = m.moveSan || '?';
  const classification = m.classificationKey || 'UNKNOWN';
  const evalBefore = typeof m.evalBefore === 'number' ? fmtCp(m.evalBefore) : null;
  const evalAfter = typeof m.evalAfter === 'number' ? fmtCp(m.evalAfter) : null;
  const swing = typeof m.swing === 'number' ? fmtCp(m.swing) : null;
  const best = m.bestMoveSan || (verified && verified.verified ? verified.bestMove : '');
  const bestIsUci = !m.bestMoveSan && verified && verified.verified;
  const verifiedEval = verified && verified.verified ? ` Stockfish d${verified.depth} confirms ${fmtCp(verified.whiteScore, verified.scoreType)} with best ${verified.bestMove}.` : '';

  let explanation = `${who} played ${played}. The review calls this ${classification}.`;
  if (evalBefore && evalAfter) {
    explanation += ` The eval went from ${evalBefore} to ${evalAfter}${swing ? ` (swing ${swing})` : ''}.`;
  }
  if (best) {
    explanation += ` Best was ${best}${bestIsUci ? ' (UCI notation)' : ''}.${verifiedEval}`;
  } else if (verifiedEval) {
    explanation += verifiedEval;
  }

  if (['BLUNDER', 'MISTAKE', 'MISS'].includes(classification)) {
    explanation += ` This is a clear inaccuracy; compare the played move with the engine's recommendation.`;
  } else if (['BRILLIANT', 'GREAT', 'BEST'].includes(classification)) {
    explanation += ` This is a strong move that matches or improves the engine's top choice.`;
  } else {
    explanation += ` The move is acceptable but not the engine's top pick.`;
  }
  return explanation;
}

function fallbackGameExplanation(game, verifiedCritical) {
  const g = game || {};
  const h = g.headers || {};
  const parts = [];
  if (h.White || h.Black) parts.push(`${h.White || '?'} vs ${h.Black || '?'}`);
  if (g.opening && (g.opening.name || g.opening.ecoName)) parts.push(`opened with ${g.opening.name || g.opening.ecoName}`);
  const whiteAcc = typeof g.whiteAccuracy === 'number' ? `White accuracy ${Math.round(g.whiteAccuracy)}%` : '';
  const blackAcc = typeof g.blackAccuracy === 'number' ? `Black accuracy ${Math.round(g.blackAccuracy)}%` : '';
  if (whiteAcc || blackAcc) parts.push([whiteAcc, blackAcc].filter(Boolean).join(' / '));
  const acpl = [];
  if (typeof g.whiteAcpl === 'number') acpl.push(`White ACPL ${Math.round(g.whiteAcpl)}`);
  if (typeof g.blackAcpl === 'number') acpl.push(`Black ACPL ${Math.round(g.blackAcpl)}`);
  if (acpl.length) parts.push(acpl.join(' / '));

  const critical = Array.isArray(g.criticalMoments) ? g.criticalMoments.slice(0, 6) : [];
  if (critical.length) {
    const c = critical[0];
    const who = c.isWhite ? 'White' : 'Black';
    parts.push(`the decisive moment was ${who} ${c.moveSan} (${c.classificationKey || '?'}) at move ${c.moveNumber || '?'}`);
  }
  if (verifiedCritical && verifiedCritical.verified) {
    parts.push(`Stockfish d${verifiedCritical.depth} gives ${fmtCp(verifiedCritical.whiteScore, verifiedCritical.scoreType)} with best ${verifiedCritical.bestMove}`);
  }

  let text = 'Quick take: ' + parts.join(' · ') + '.';
  const thingsToWorkOn = [];
  const worse = [];
  if (typeof g.whiteAcpl === 'number' && typeof g.blackAcpl === 'number') {
    if (g.whiteAcpl > g.blackAcpl + 10) worse.push('White');
    if (g.blackAcpl > g.whiteAcpl + 10) worse.push('Black');
  }
  if (worse.length) thingsToWorkOn.push(`${worse.join(' and ')} made more costly mistakes — focus on tactics and avoiding one-move blunders.`);
  if (critical.length && !thingsToWorkOn.length) thingsToWorkOn.push('Study the critical moment shown above; a single move swung the evaluation.');
  if (thingsToWorkOn.length) text += ` Work on: ${thingsToWorkOn.join(' ')}`;
  return text;
}

// Build the user message summarizing the whole game from compact review data.
function buildGamePrompt(game, verifiedCritical) {
  const g = game || {};
  const lines = [];
  const h = g.headers || {};
  if (h.White || h.Black) lines.push(`Game: ${h.White || '?'} vs ${h.Black || '?'}.`);
  if (h.TimeControl) lines.push(`Time control: ${h.TimeControl}.`);
  if (g.opening && (g.opening.name || g.opening.ecoName)) lines.push(`Opening: ${g.opening.name || g.opening.ecoName}.`);
  if (typeof g.whiteAccuracy === 'number') lines.push(`White accuracy: ${Math.round(g.whiteAccuracy)}%.`);
  if (typeof g.blackAccuracy === 'number') lines.push(`Black accuracy: ${Math.round(g.blackAccuracy)}%.`);
  if (typeof g.whiteAcpl === 'number') lines.push(`White ACPL: ${Math.round(g.whiteAcpl)}.`);
  if (typeof g.blackAcpl === 'number') lines.push(`Black ACPL: ${Math.round(g.blackAcpl)}.`);
  const critical = Array.isArray(g.criticalMoments) ? g.criticalMoments.slice(0, 6) : [];
  for (const c of critical) {
    if (!c) continue;
    const who = c.isWhite ? 'White' : 'Black';
    lines.push(`Key move ${c.moveNumber || '?'}: ${who} ${c.moveSan || '?'} — ${c.classificationKey || '?'}, swing ${fmtCp(c.swing)}, loss ${c.cpLoss}${c.bestMoveSan ? `, best was ${c.bestMoveSan}` : ''}.`);
  }
  if (verifiedCritical && verifiedCritical.verified) {
    lines.push('');
    lines.push(verifiedSummary(verifiedCritical));
  }
  return `Summarize this game in 5-8 sentences using ONLY the data above: one overall takeaway, the opening story, where it was decided, and 1-2 things to work on.\n\n${lines.join('\n')}`;
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

  const plan = activePlan(user._profile || {});
  const tokenLimit = (plan.limits && plan.limits.coachTokensPerDay) || 0;

  const payload = parseBody(req);
  const scope = payload.scope === 'game' ? 'game' : 'move';
  const game = payload.game && typeof payload.game === 'object' ? payload.game : null;
  const moveIndex = Math.max(0, Math.min(Math.floor(Number(payload.moveIndex)) || 0, 1000));
  if (!game) {
    sseWrite(res, 'error', { error: 'Missing game data.', code: 'bad_request' });
    res.end();
    return;
  }

  // Heavy-action lock: don't run an overview while a review is mid-flight for
  // the same user (and vice versa) — defense in depth on the frontend gate.
  if (!acquireHeavyAction(user.uid, 'coach')) {
    const busy = getBusyAction(user.uid);
    sseWrite(res, 'error', {
      error: busy === 'review'
        ? 'A game review is running. Please wait for it to finish before asking the coach.'
        : 'You already have a coach request running. Please wait for it to finish.',
      code: 'heavy_action_busy',
    });
    res.end();
    return;
  }

  // Reserve worst-case cost up front (atomic, so parallel requests can't all
  // pass on a stale read). Refunded to the real cost after the stream.
  const reserveAmount = OVERVIEW_RESERVE_TOKENS;
  let reservedTotal;
  try {
    const r = await reserveCoachTokens(user.uid, reserveAmount, tokenLimit);
    if (!r.allowed) {
      releaseHeavyAction(user.uid);
      sseWrite(res, 'error', {
        error: "You've used all your daily Coach tokens. They reset at midnight UTC — or upgrade for more.",
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

  let closed = false;
  req.on('close', () => { closed = true; });
  const heartbeat = setInterval(() => { if (!closed) sseWrite(res, 'heartbeat', { ts: Date.now() }); }, HEARTBEAT_MS);
  const stopHeartbeat = () => clearInterval(heartbeat);

  try {
    // Hard-facts verification: run Stockfish on the relevant FEN so the LLM is
    // grounded in a live engine evaluation, not just cached review data. If the
    // engine is unavailable, we still proceed with the review data (which is
    // also Stockfish-derived), but the prompt notes the absence.
    sseWrite(res, 'init', { scope, ts: Date.now(), verified: false });
    let verified = null;
    let verifiedCritical = null;
    if (scope === 'move') {
      const m = (game.results || [])[moveIndex];
      if (m && m.fen) {
        verified = await verifyWithStockfish(m.fen, 18, 7000);
      }
    } else {
      const toVerify = pickCriticalToVerify(game.criticalMoments);
      if (toVerify && toVerify.fen) {
        verifiedCritical = await verifyWithStockfish(toVerify.fen, 18, 7000);
      }
    }

    const userContent = scope === 'game' ? buildGamePrompt(game, verifiedCritical) : buildMovePrompt(moveIndex, game, verified);
    const llmMessages = [
      { role: 'system', content: OVERVIEW_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ];

    const maxTokens = scope === 'game' ? OVERVIEW_MAX_TOKENS_GAME : OVERVIEW_MAX_TOKENS_MOVE;
    const streamRes = await llm.chatCompletion({
      messages: llmMessages,
      stream: true,
      maxTokens,
      temperature: 0.4,
    });

    let assistantText = '';
    const result = await llm.streamDeltas(streamRes, (t) => {
      if (closed) return;
      assistantText += t;
      sseWrite(res, 'token', { text: t });
    });
    // Guard against an empty reply: some providers occasionally return a 200
    // with finish_reason=stop but ZERO content tokens. Instead of sending an
    // empty_reply error and hoping the client retries, emit a fact-based fallback
    // explanation built from the verified/review data so the user always sees a
    // grounded answer.
    if (!assistantText.trim()) {
      console.warn(`[coach-overview] LLM returned empty content (finish_reason=${result?.finishReason || 'unknown'}); using fallback`);
      const fallback = scope === 'game'
        ? fallbackGameExplanation(game, verifiedCritical)
        : fallbackMoveExplanation(moveIndex, game, verified);
      if (!closed) sseWrite(res, 'token', { text: fallback });
      assistantText = fallback;
    } else if (result && result.finishReason === 'length') {
      // Model was cut off by maxTokens — content is usable but may be
      // truncated mid-sentence. Append an ellipsis so it ends cleanly
      // instead of looking broken.
      const trimmed = assistantText.trim();
      if (!/[.!?…]$/.test(trimmed)) {
        const ellipsis = '…';
        assistantText += ellipsis;
        if (!closed) sseWrite(res, 'token', { text: ellipsis });
      }
    }

    // Reconcile to the real cost (prefer provider usage; fall back to char est).
    const usage = result && result.usage;
    const realInput = Number(usage && usage.prompt_tokens) || Number(usage && usage.prompt) || 0;
    const realOutput = Number(usage && usage.completion_tokens) || Number(usage && usage.completion) || 0;
    const inputTokens = realInput || Math.ceil(JSON.stringify(llmMessages).length / 4);
    const outputTokens = realOutput || Math.ceil(assistantText.length / 4);
    const totalTokens = inputTokens + outputTokens;
    const delta = totalTokens - reserveAmount;
    let chargedTotal = reservedTotal;
    try {
      if (delta !== 0) {
        const rec = await reconcileCoachTokens(user.uid, delta);
        chargedTotal = rec.total;
      }
    } catch (err) {
      console.error('[coach-overview] token reconcile failed:', err && err.message ? err.message : err);
      chargedTotal = reservedTotal;
    }

    sseWrite(res, 'done', { ts: Date.now(), usage: { coachTokens: chargedTotal, coachTokenLimit: tokenLimit } });
  } catch (err) {
    console.error('coach-overview error:', err && err.stack ? err.stack : err);
    // Refund the reservation — the user never got the reply.
    if (user && user.uid) {
      try { await reconcileCoachTokens(user.uid, -reserveAmount); } catch (_) {}
    }
    sseWrite(res, 'error', { error: err.message || 'Overview failed.', code: err.code || 'server_error' });
  } finally {
    releaseHeavyAction(user && user.uid);
    stopHeartbeat();
    if (!res.writableEnded) res.end();
  }
};
