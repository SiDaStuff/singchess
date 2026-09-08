// AI Coach chat controller. Owns the /coach chat experience: localStorage
// multi-chat persistence + sidebar, Markdown rendering of assistant replies,
// SSE streaming through the backend (/api/coach/chat), and the browser-side
// Stockfish tool. Exposed as window.CoachChat; app.js mounts it on /coach entry.
//
// localStorage layout (per-browser, keyed off the signed-in uid):
//   sidastuff.coachChats.<uid> = [ { id, title, createdAt, messages: [{role, content, ts}] } ]
// The active chat id: sidastuff.coachActiveChat.<uid>.
// History sent to the backend on each request (the backend no longer persists).

(function () {
  // No Fast/Strong model preference anymore — the coach uses a single model
  // (gpt-oss-120b, with a gpt-oss-20b fallback on the server).

  const state = {
    app: null,            // the ChessReviewApp instance (for auth + engine)
    mounted: false,
    uid: null,
    chats: [],            // [{id, title, createdAt, messages:[]}]
    activeId: null,
    streaming: false,
    abortController: null,
    chatPid: null,        // backend instance pid for the active SSE (affinity backstop)
  };

  // ── DOM refs (resolved on mount) ─────────────────────────────────────
  const el = {};
  function $(id) { return document.getElementById(id); }
  function resolveEls() {
    [
      'coach-chat-card', 'coach-chat-locked', 'coach-chat-body', 'coach-chat-messages',
      'coach-typing', 'coach-typing-text', 'coach-chat-form', 'coach-chat-textarea',
      'btn-coach-send', 'btn-coach-stop', 'coach-sidebar-list', 'btn-coach-new-chat',
      'btn-coach-play-bot', 'btn-coach-sidebar-toggle', 'coach-chat-subtitle', 'coach-usage-bar',
    ].forEach((id) => { el[id] = $(id); });
  }

  // ── localStorage (scoped per uid) ────────────────────────────────────
  function lsChatsKey() { return `sidastuff.coachChats.${state.uid}`; }
  function lsActiveKey() { return `sidastuff.coachActiveChat.${state.uid}`; }
  function loadChats() {
    if (!state.uid) return;
    try { state.chats = JSON.parse(localStorage.getItem(lsChatsKey()) || '[]'); }
    catch (_) { state.chats = []; }
    if (!Array.isArray(state.chats)) state.chats = [];
    state.activeId = localStorage.getItem(lsActiveKey()) || (state.chats[0] && state.chats[0].id) || null;
  }
  function saveChats() {
    if (!state.uid) return;
    try { localStorage.setItem(lsChatsKey(), JSON.stringify(state.chats)); } catch (_) {}
    if (state.activeId) { try { localStorage.setItem(lsActiveKey(), state.activeId); } catch (_) {} }
  }
  function activeChat() { return state.chats.find((c) => c.id === state.activeId) || null; }
  function newId() { return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function createChat() {
    const chat = { id: newId(), title: 'New chat', createdAt: Date.now(), messages: [] };
    state.chats.unshift(chat);
    state.activeId = chat.id;
    saveChats();
    renderSidebar();
    renderMessages();
    focusInput();
  }

  // Create a new chat preloaded with a reviewed game's context + the overview
  // the user just generated as the first assistant message. The reviewContext
  // is stored on the chat so every subsequent send() forwards it to the server
  // (the coach answers follow-ups about the game without re-running a review).
  function startWithContext({ reviewContext, firstAssistant }) {
    const chat = { id: newId(), title: 'Reviewed game', createdAt: Date.now(), messages: [], reviewContext: reviewContext || null };
    if (firstAssistant) chat.messages.push({ role: 'assistant', content: String(firstAssistant), ts: Date.now() });
    state.chats.unshift(chat);
    state.activeId = chat.id;
    saveChats();
    renderSidebar();
    renderMessages();
    focusInput();
  }
  function selectChat(id) {
    if (state.streaming) return;
    state.activeId = id;
    saveChats();
    renderSidebar();
    renderMessages();
    // On mobile, collapse sidebar after selecting a chat
    if (window.innerWidth <= 720) el['coach-chat-card']?.classList.add('sidebar-collapsed');
  }
  function deleteChat(id) {
    // Guard: deleting the active chat mid-stream orphans send()'s closure and
    // renderMessages wipes the live bubble. Block while streaming (the sibling
    // selectChat + new-chat paths already guard the same way).
    if (state.streaming) return;
    state.chats = state.chats.filter((c) => c.id !== id);
    if (state.activeId === id) state.activeId = state.chats[0] ? state.chats[0].id : null;
    const hadChats = state.chats.length > 0;
    if (!state.chats.length) { createChat(); }
    saveChats();
    renderSidebar();
    renderMessages();
    // Restore keyboard focus after the deleted row is removed from the DOM —
    // otherwise focus falls to <body>. Move it to "New chat" (always present).
    const newChatBtn = el['btn-coach-new-chat'];
    if (newChatBtn && typeof newChatBtn.focus === 'function') newChatBtn.focus();
  }

  // ── Rendering ────────────────────────────────────────────────────────
  function renderSidebar() {
    if (!el['coach-sidebar-list']) return;
    if (!state.chats.length) {
      el['coach-sidebar-list'].innerHTML = '<div class="coach-sidebar-empty">No chats yet.</div>';
      return;
    }
    el['coach-sidebar-list'].innerHTML = '';
    state.chats.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'coach-chat-item' + (c.id === state.activeId ? ' active' : '');
      row.innerHTML = `<span class="coach-chat-item-title"></span>
        <button type="button" class="coach-chat-item-del" aria-label="Delete chat"><span class="material-symbols-outlined">delete</span></button>`;
      row.querySelector('.coach-chat-item-title').textContent = c.title || 'New chat';
      row.addEventListener('click', () => selectChat(c.id));
      row.querySelector('.coach-chat-item-del').addEventListener('click', (e) => { e.stopPropagation(); deleteChat(c.id); });
      el['coach-sidebar-list'].appendChild(row);
    });
  }

  function renderMessages() {
    const box = el['coach-chat-messages'];
    if (!box) return;
    box.innerHTML = '';
    const chat = activeChat();
    if (!chat || !chat.messages.length) {
      // Empty conversation: a centered welcome hint (NOT a saved message — it
      // is a placeholder the user dismisses by sending their first message).
      const empty = document.createElement('div');
      empty.className = 'coach-empty';
      empty.innerHTML = `
        <span class="material-symbols-outlined coach-empty-icon">school</span>
        <h3>Ask the Coach</h3>
        <p>Get help with openings, positions (paste a FEN), a game (paste a PGN to open the review system), or a study plan. The Coach verifies its answers with Stockfish and web search.</p>
        <div class="coach-empty-suggest"></div>`;
      const suggest = empty.querySelector('.coach-empty-suggest');
      const ideas = ['Explain the Italian Game', 'What should I study as a 900 player?', 'Is 1.e4 e5 2.Nf3 Nc6 3.Bc4 good for White?'];
      ideas.forEach((idea) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn btn-secondary coach-empty-chip'; b.textContent = idea;
        b.addEventListener('click', () => { const ta = el['coach-chat-textarea']; if (ta) { ta.value = idea; send(); } });
        suggest.appendChild(b);
      });
      box.appendChild(empty);
    } else {
      chat.messages.forEach((m) => box.appendChild(buildBubble(m.role, m.content)));
    }
    if (el['coach-chat-subtitle'] && chat) el['coach-chat-subtitle'].textContent = chat.title || 'AI coach';
    scrollMessages();
    // Re-apply the conversation lock for the now-active chat (textarea/send/
    // notice must follow the selected chat, not the previously-shown one).
    applyLockedState();
  }

  function buildBubble(role, content) {
    const div = document.createElement('div');
    if (role === 'error') {
      div.className = 'coach-bubble coach-bubble-error';
      div.textContent = content;
    } else {
      div.className = `coach-bubble ${role}`;
      // User messages: raw text (preserve whitespace). Assistant: rendered Markdown.
      if (role === 'assistant') div.innerHTML = renderMarkdown(content || '');
      else { div.textContent = content; }
    }
    return div;
  }

  // Markdown -> sanitized HTML. Falls back to escaped text if libs missing.
  function renderMarkdown(md) {
    const text = String(md || '');
    // Extract ```board FEN``` blocks into placeholders so marked doesn't escape
    // the board HTML. We swap them back in AFTER marked + DOMPurify run.
    const boards = [];
    const withoutBoards = text.replace(/```board\n([\s\S]*?)```/g, (_, fen) => {
      const idx = boards.length;
      boards.push(renderBoardEmbed(fen.trim()));
      return `\n\n@@BOARD_${idx}@@\n\n`;
    });
    let html;
    try {
      if (window.marked && window.DOMPurify) {
        html = window.marked.parse(withoutBoards, { breaks: true, gfm: true });
        html = window.DOMPurify.sanitize(html, {
          ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):)/i,
          USE_PROFILES: { html: true, svg: true, svgFilters: true },
        });
      } else {
        html = escapeHtml(withoutBoards).replace(/\n/g, '<br>');
      }
    } catch (_) {
      html = escapeHtml(text).replace(/\n/g, '<br>');
    }
    // Swap board placeholders back in (they're already-sanitized SVG HTML).
    html = html.replace(/@@BOARD_(\d+)@@/g, (_, i) => boards[Number(i)] || '');
    return html;
  }

  // Render a small static chess board from a FEN. Emits the SAME markup the real
  // review board uses (.chess-board / .square.light|.dark / .square .piece /
  // .coord-label) so it reuses the real piece art (window.getPieceSvgUri: PNG
  // primary, inline-SVG fallback), the active board theme (--sq-light/--sq-dark),
  // and the a-h / 1-8 coordinate labels — just downsized via the wrapper. No
  // interactive machinery (no ChessBoard instance): safe to innerHTML repeatedly
  // during streaming. White at bottom (matches the unflipped review board).
  function renderBoardEmbed(fen) {
    try {
      const placement = fen.split(' ')[0];
      const rows = placement.split('/');
      if (rows.length !== 8) return `<div class="coach-board-error">Invalid FEN</div>`;
      // grid: 8 ranks, r=0 is rank 8 (top); each row's squares left→right a→h.
      let squares = '';
      for (let r = 0; r < 8; r++) {
        let col = 0;
        const chars = rows[r];
        for (const ch of chars) {
          let skip = 0;
          if (ch >= '1' && ch <= '8') {
            skip = parseInt(ch, 10);
          }
          if (skip) {
            for (let i = 0; i < skip; i++) { squares += squareHtml(r, col, null); col++; }
          } else {
            const color = ch === ch.toUpperCase() ? 'w' : 'b';
            squares += squareHtml(r, col, color + ch.toUpperCase());
            col++;
          }
        }
        // FEN rows must total 8 files; guard against malformed rows.
        while (col < 8) { squares += squareHtml(r, col, null); col++; }
      }
      return `<div class="coach-board-embed"><div class="chess-board">${squares}</div></div>`;
    } catch (_) { return `<div class="coach-board-error">Invalid FEN</div>`; }
  }

  // One board square for renderBoardEmbed. r=0..7 top→bottom (rank 8→1),
  // c=0..7 left→right (file a→h). Mirrors board.js _render(): file label on the
  // bottom visual row (r===7), rank label on the left visual column (c===0).
  function squareHtml(r, c, piece) {
    const rank = 8 - r;
    const file = String.fromCharCode(97 + c);
    const isLight = (c + (rank - 1)) % 2 === 1; // matches board.js (a1 dark)
    const sq = file + rank;
    let html = `<div class="square ${isLight ? 'light' : 'dark'}" data-square="${sq}">`;
    if (r === 7) html += `<span class="coord-label coord-file">${file}</span>`;
    if (c === 0) html += `<span class="coord-label coord-rank">${rank}</span>`;
    if (piece) {
      const uri = (window.getPieceSvgUri && window.getPieceSvgUri(piece)) || '';
      html += `<img class="piece" src="${uri}" draggable="false" alt="">`;
    }
    html += `</div>`;
    return html;
  }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function scrollMessages() {
    const box = el['coach-chat-messages'];
    if (box) box.scrollTop = box.scrollHeight;
  }
  function focusInput() { el['coach-chat-textarea']?.focus(); }

  // ── Streaming send ───────────────────────────────────────────────────
  async function send() {
    if (state.streaming) return;
    if (isLocked()) return;
    const app = state.app;
    // NOTE: no heavy-action gate here. Starting a coach chat no longer blocks
    // on (or gets blocked by) a running review — every chat message is charged
    // against the daily token quota server-side, which is the real limiter.
    const ta = el['coach-chat-textarea'];
    const text = String(ta?.value || '').trim();
    if (!text) return;

    let chat = activeChat();
    if (!chat) { createChat(); chat = activeChat(); }
    chat.messages.push({ role: 'user', content: text, ts: Date.now() });
    if (chat.messages.filter((m) => m.role === 'user').length === 1) {
      chat.title = text.slice(0, 40);
    }
    saveChats();
    renderSidebar();
    el['coach-chat-messages'].appendChild(buildBubble('user', text));
    if (ta) { ta.value = ''; autoGrow(); }
    scrollMessages();

    state.streaming = true;
    applyLockedState(); // disable the textarea + send while the reply streams
    // Screen readers: mark the live region busy so intermediate markdown
    // re-renders aren't announced as complete messages.
    if (el['coach-chat-messages']) el['coach-chat-messages'].setAttribute('aria-busy', 'true');
    if (app && typeof app._setBusyAction === 'function') app._setBusyAction('coach');
    el['coach-chat-card']?.querySelector('.coach-chat-main')?.classList.add('busy');
    el['btn-coach-send'] && (el['btn-coach-send'].disabled = true);
    el['btn-coach-send'] && (el['btn-coach-send'].hidden = true);
    el['btn-coach-stop'] && (el['btn-coach-stop'].hidden = false);

    const skeleton = appendSkeleton();
    showTyping('Coach is thinking…');

    const controller = new AbortController();
    state.abortController = controller;
    // NO fixed 180s abort timer. The old timer aborted the stream mid-tool-run
    // (a long Stockfish verification or web search can legitimately take a
    // couple of minutes), surfacing as "Coach timed out — please try again."
    // Real stalls are bounded server-side (LLM stream-stall watchdog, 60s
    // browser-tool timeout, heartbeat-driven connection keepalive), and the
    // user always has the Stop button for genuine runaway replies.

    let assistantEl = null;
    let assistantText = '';
    // Live "thinking" view: reasoning models stream their chain of thought in
    // a separate channel. Show it in the typing indicator (so the coach ALWAYS
    // looks active — never a dead spinner) and as a dimmed collapsible note
    // above the reply bubble.
    let reasoningEl = null;
    let reasoningText = '';
    let reasoningRenderPending = false;
    const showReasoning = (t) => {
      reasoningText += t;
      skeleton?.remove();
      hideTyping();
      if (!reasoningEl) {
        reasoningEl = document.createElement('div');
        reasoningEl.className = 'coach-reasoning';
        reasoningEl.innerHTML = '<div class="coach-reasoning-head"><span class="material-symbols-outlined">psychology</span><span>Coach is reasoning…</span></div><div class="coach-reasoning-body"></div>';
        el['coach-chat-messages']?.appendChild(reasoningEl);
      }
      // The typing indicator comes back on top of the reasoning block so the
      // stream never looks idle while reasoning tokens arrive.
      showTyping('Thinking…');
      if (!reasoningRenderPending) {
        reasoningRenderPending = true;
        setTimeout(() => {
          reasoningRenderPending = false;
          const body = reasoningEl && reasoningEl.querySelector('.coach-reasoning-body');
          if (body) {
            body.textContent = reasoningText.slice(-600); // tail — keeps DOM cheap
            scrollMessages();
          }
        }, 120);
      }
    };

    try {
      // Send the conversation history (client-owned).
      const history = chat.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }));
      const response = await window.apiFetch('/api/coach/chat', {
        method: 'POST',
        headers: await state.app._authHeaders({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
        signal: controller.signal,
        cache: 'no-store',
        body: JSON.stringify({ message: text, history, reviewContext: chat.reviewContext || undefined }),
      });
      if (!response.ok) {
        let msg = `Coach error (${response.status}).`;
        try { const j = await response.json(); msg = j.error || msg; } catch (_) {}
        throw new Error(msg);
      }
      // Speed: throttled markdown render. Rendering the WHOLE markdown on every
      // SSE token is O(n²) and janks on long replies — cap it to ~4 frames/s
      // (every ~60ms) while the reply streams; the final full render happens in
      // onDone so the finished bubble is always exact.
      let pendingRender = null;
      const scheduleRender = () => {
        if (pendingRender) return;
        pendingRender = setTimeout(() => {
          pendingRender = null;
          if (assistantEl) {
            assistantEl.innerHTML = renderMarkdown(assistantText);
            scrollMessages();
          }
        }, 60);
      };
      await readStream(response, {
        onInit: (data) => { if (data && data.pid) state.chatPid = data.pid; },
        onReasoning: showReasoning,
        onToken: (t) => {
          // First answer token: collapse the reasoning view and start the reply.
          if (reasoningEl) {
            reasoningEl.classList.add('done');
            const body = reasoningEl.querySelector('.coach-reasoning-body');
            if (body) body.textContent = ''; // hide chain-of-thought once the real answer starts
            reasoningEl = null; // don't touch it again this stream
            skeleton?.remove();
            hideTyping();
          }
          if (!assistantEl) { skeleton?.remove(); hideTyping(); assistantEl = buildBubble('assistant', ''); assistantEl.classList.add('streaming'); el['coach-chat-messages'].appendChild(assistantEl); }
          assistantText += t;
          scheduleRender();
        },
        onToolCall: (call) => { reasoningEl && reasoningEl.classList.add('done'); handleBrowserTool(call); },
        onToolStatus: ({ label }) => showTyping(label),
        onToolResultVisible: ({ name, summary, games }) => {
          hideTyping();
          if (name === 'fetch_games' && Array.isArray(games) && games.length) {
            appendGameCards(name, summary, games);
          } else {
            appendToolCard(name, summary);
          }
        },
        onDone: (data) => {
          if (pendingRender) { clearTimeout(pendingRender); pendingRender = null; }
          skeleton?.remove();
          hideTyping();
          if (el['coach-chat-messages']) el['coach-chat-messages'].setAttribute('aria-busy', 'false');
          if (assistantEl) { assistantEl.innerHTML = renderMarkdown(assistantText); assistantEl.classList.remove('streaming'); }
          const cleaned = assistantText || '';
          if (!cleaned) { appendBubble('error', 'No response.'); }
          else {
            chat.messages.push({ role: 'assistant', content: cleaned, ts: Date.now() });
            saveChats();
          }
          // Refresh the token-usage bar after every message. The server charges
          // BEFORE emitting `done` and returns the fresh total in the event, so
          // apply it directly; fall back to a server re-fetch if it's missing.
          refreshUsage(data && data.usage);
        },
      });
    } catch (err) {
      skeleton?.remove();
      if (el['coach-chat-messages']) el['coach-chat-messages'].setAttribute('aria-busy', 'false');
      hideTyping();
      if (err && err.name === 'AbortError') {
        // Abort only comes from the user clicking Stop now (the fixed timer is
        // gone). Save whatever streamed so far as a partial reply.
        if (assistantText) {
          chat.messages.push({ role: 'assistant', content: assistantText + '\n\n_(stopped)_', ts: Date.now() });
          saveChats();
          if (assistantEl) { assistantEl.classList.remove('streaming'); assistantEl.innerHTML = renderMarkdown(assistantText + '\n\n_(stopped)_'); }
        } else {
          appendBubble('error', 'Coach stopped before replying.');
          assistantEl?.remove();
        }
      } else {
        if (assistantEl) assistantEl.classList.remove('streaming');
        const msg = err && err.message && err.message.length < 200 ? err.message : 'Coach is unavailable right now. Please try again.';
        if (assistantText) {
          // Preserve the partial reply that already streamed, then note the
          // error (mirrors the abort path — don't wipe content the user saw).
          chat.messages.push({ role: 'assistant', content: assistantText + '\n\n_(response cut off)_', ts: Date.now() });
          saveChats();
          if (assistantEl) assistantEl.innerHTML = renderMarkdown(assistantText + '\n\n_(response cut off)_');
          appendBubble('error', msg);
        } else {
          appendBubble('error', msg);
          assistantEl?.remove();
        }
      }
    } finally {
      state.streaming = false;
      state.abortController = null;
      applyLockedState(); // re-enable the textarea/send now that streaming ended
      if (app && typeof app._setBusyAction === 'function') app._setBusyAction(null);
      el['coach-chat-card']?.querySelector('.coach-chat-main')?.classList.remove('busy');
      el['btn-coach-send'] && (el['btn-coach-send'].disabled = false);
      el['btn-coach-send'] && (el['btn-coach-send'].hidden = false);
      el['btn-coach-stop'] && (el['btn-coach-stop'].hidden = true);
      focusInput();
    }
  }

  async function readStream(response, h) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop();
      for (const raw of events) {
        const lines = raw.split('\n');
        let event = 'message';
        const dataLines = [];
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        let data = {};
        try { data = JSON.parse(dataLines.join('\n')); } catch (_) { continue; }
        if (event === 'token' && h.onToken) h.onToken(data.text || '');
        else if (event === 'reasoning' && h.onReasoning) h.onReasoning(data.text || '');
        else if (event === 'init' && h.onInit) h.onInit(data);
        else if (event === 'tool_call' && h.onToolCall) h.onToolCall(data);
        else if (event === 'tool_status' && h.onToolStatus) h.onToolStatus(data);
        else if (event === 'tool_result_visible' && h.onToolResultVisible) h.onToolResultVisible(data);
        else if (event === 'done' && h.onDone) h.onDone(data);
        else if (event === 'error') throw new Error(data.error || 'Coach stream error.');
        // init + heartbeat ignored (client owns history now)
      }
    }
  }

  // Browser-side tools. The server emits a tool_call SSE event; the client
  // executes the tool (it's the only place these can run — engine, DOM, nav)
  // and POSTs the result back to /api/coach/tool-result so the parked SSE
  // resumes and the coach can react to the outcome.
  async function handleBrowserTool({ id, name, args }) {
    try {
      if (name === 'stockfish') return await runStockfishTool(id, args);
      if (name === 'game_review') return await runGameReviewTool(id, args);
      if (name === 'ask_question') return await runAskQuestionTool(id, args);
      if (name === 'end_conversation') return await runEndConversationTool(id, args);
      if (name === 'show_board') return await runShowBoardTool(id, args);
      throw new Error('Unsupported browser tool.');
    } catch (err) {
      await postToolResult(id, { error: err.message || 'Browser tool failed.' });
    }
  }

  // Validate a FEN string well enough to reject obviously-malformed input
  // before handing it to Stockfish. Stockfish will accept some illegal-looking
  // positions but GARBAGE input silently returns depth:0/bestMove:'' — which
  // the coach could mistake for a real "0.00" eval. Rejecting early sends a
  // clear error back to the LLM instead of a false-positive zero eval.
  function isValidFen(fen) {
    if (typeof fen !== 'string') return false;
    const f = fen.trim();
    if (!f) return false;
    const parts = f.split(/\s+/);
    if (parts.length < 1 || parts.length > 6) return false;
    const placement = parts[0];
    // NOTE: the class MUST include "/" — FEN ranks are slash-separated. The
    // original regex omitted it, so this validator rejected EVERY valid FEN
    // and the stockfish tool failed with "Invalid FEN" on every call.
    if (!/^[pnbrqkPNBRQK1-8/]+$/.test(placement)) return false;
    const rows = placement.split('/');
    if (rows.length !== 8) return false;
    for (const row of rows) {
      let len = 0, sawKing = false, kings = 0;
      for (const ch of row) {
        if (ch >= '1' && ch <= '8') { len += parseInt(ch, 10); }
        else { len += 1; if (ch === 'k' || ch === 'K') kings++; }
      }
      if (len !== 8) return false;            // each rank must sum to 8 files
      if (kings > 1) return false;             // can't have 2 kings on one rank
    }
    // Side-to-move (part 1) must be 'w' or 'b' if present.
    if (parts[1] && parts[1] !== 'w' && parts[1] !== 'b') return false;
    return true;
  }

  // ── Adaptive FEN repair ─────────────────────────────────────────────
  // LLMs produce slightly-wrong FENs constantly (missing counters, a rank
  // with 7 or 9 files, swapped castling flags). Instead of bouncing "Invalid
  // FEN" back at the model (which then often retries the same junk), try a
  // ladder of cheap repairs first and return the best parse.
  // Returns the repaired FEN string, or null when nothing sensible parsed.
  function repairFen(raw) {
    let fen = String(raw || '').trim();
    // Strip wrapping quotes/code fences/prose the model sometimes adds.
    fen = fen.replace(/^["'`\s]*(?:fen:?)?/i, '').replace(/["'`\s]*$/, '');
    const parts = fen.split(/\s+/);
    if (!parts[0]) return null;
    const placement = parts[0];

    const validPlacement = (p) => {
      if (!/^[pnbrqkPNBRQK1-8/]+$/.test(p)) return false; // "/" required (rank separators)
      const rows = p.split('/');
      if (rows.length !== 8) return false;
      for (const row of rows) {
        let len = 0, kings = 0;
        for (const ch of row) {
          if (ch >= '1' && ch <= '8') len += parseInt(ch, 10);
          else { len += 1; if (ch === 'k' || ch === 'K') kings++; }
        }
        if (len !== 8 || kings > 1) return false;
      }
      return true;
    };

    // Repair 1: trim/pad each rank to exactly 8 files (handles off-by-one
    // hallucinations: a rank with 7 or 9 files). Left-to-right file order is
    // preserved; shortage is padded with an empty-square digit on the rank's
    // empty side (right), overflow trims a trailing digit.
    let fixedRows = null;
    if (/^[pnbrqkPNBRQK1-8/]+$/.test(placement)) {
      const rows = placement.split('/');
      if (rows.length === 8) {
        const adjusted = rows.map((row) => {
          let len = 0; let out = '';
          const digits = [];
          for (const ch of row) {
            if (ch >= '1' && ch <= '8') { len += parseInt(ch, 10); digits.push(ch); }
            else { out += ch; len += 1; }
          }
          if (len === 8) return out || '8';
          if (len < 8) {
            // Pad the gap: prefer appending after the LAST digit run (empty
            // squares usually trail the pieces on a rank). Merge with an
            // adjacent digit when possible to keep the FEN tidy.
            const gap = 8 - len;
            const lastDigit = digits.length ? digits[digits.length - 1] : null;
            if (lastDigit && Number(lastDigit) + gap <= 8) {
              const merged = String(Number(lastDigit) + gap);
              // Replace the last occurrence of that digit in the output.
              const at = out.lastIndexOf(lastDigit);
              return out.slice(0, at) + merged + out.slice(at + lastDigit.length);
            }
            return (out || '') + String(gap);
          }
          // len > 8: shrink the LAST digit by the overflow (drop it if it hits 0).
          const overflow = len - 8;
          for (let i = digits.length - 1; i >= 0; i -= 1) {
            const n = Number(digits[i]);
            if (n > overflow) {
              const shrunk = String(n - overflow);
              const at = out.lastIndexOf(digits[i]);
              return out.slice(0, at) + shrunk + out.slice(at + digits[i].length);
            }
          }
          // Nothing shrinkable (all pieces + 1s): drop trailing pieces.
          return out.slice(0, 8);
        });
        const candidate = adjusted.join('/');
        if (validPlacement(candidate)) fixedRows = candidate;
      }
    }

    // Repair 2: normalize the trailing fields. Accept 1-, 2-, 3-, 4-field
    // FENs; default castling '-' (or keep given), en passant '-', counters 0/1.
    const side = (parts[1] === 'w' || parts[1] === 'b') ? parts[1] : null;
    const base = fixedRows !== null ? fixedRows : (validPlacement(placement) ? placement : null);
    if (!base) return null;
    if (!side && parts.length < 2) {
      // Placement-only FEN: assume White to move (most common LLM intent when
      // they omit it; if wrong the eval is still for a legal position).
      return `${base} w - - 0 1`;
    }
    if (!side) return null;
    const castling = (parts[2] && /^K?Q?k?q?$/.test(parts[2]) && parts[2] !== '-') ? parts[2] : '-';
    const ep = (parts[3] && /^(-|[a-h][36])$/.test(parts[3])) ? parts[3] : '-';
    const half = Number.isFinite(Number(parts[4])) ? Math.max(0, Number(parts[4])) : 0;
    const full = Number.isFinite(Number(parts[5])) ? Math.max(1, Number(parts[5])) : 1;
    const repaired = `${base} ${side} ${castling} ${ep} ${half} ${full}`;
    // Only accept if chess.js can actually load it (legal side-to-move,
    // kings present, etc.). Try both sides if the given side is impossible.
    const ChessCtor = window.Chess || (window.chess && window.chess.Chess);
    if (!ChessCtor) return isValidFen(repaired) ? repaired : null;
    const probe = new ChessCtor();
    if (probe.load(repaired)) return repaired;
    const flipped = `${base} ${side === 'w' ? 'b' : 'w'} ${castling} ${ep} ${half} ${full}`;
    const probe2 = new ChessCtor();
    if (probe2.load(flipped)) return flipped;
    return null;
  }

  // ── PGN → FEN fallback ──────────────────────────────────────────────
  // When the model sends the POSITION as moves instead of a FEN (or its FEN is
  // beyond repair but it also gave a moves list), replay the SAN tokens
  // tolerantly: skip comments, NAGs ($1), stray punctuation, move numbers,
  // and stop at the first result marker. Returns the final FEN or null.
  function fenFromMoveText(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    const ChessCtor = window.Chess || (window.chess && window.chess.Chess);
    if (!ChessCtor) return null;
    const cleaned = String(text)
      .replace(/\{[^}]*\}/g, ' ')        // {} comments
      .replace(/;[^\n]*/g, ' ')          // ; line comments
      .replace(/\([^()]*\)/g, ' ')       // () variations (one level)
      .replace(/\$\d+/g, ' ');           // NAGs
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    const board = new ChessCtor();
    for (const tok of tokens) {
      if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) break; // result marker = end
      if (/^\d+\.+$/.test(tok)) continue;                 // bare move number
      const san = tok.replace(/^\d+\.+/, '');             // strip "1." prefix
      if (!san || san === '...') continue;
      let mv = null;
      try { mv = board.move(san, { sloppy: true }); } catch (_) {}
      if (!mv) {
        // One repair attempt: strip common annotation suffixes (+, #, !, ?).
        const stripped = san.replace(/[+#!?]+$/, '');
        if (stripped && stripped !== san) {
          try { mv = board.move(stripped, { sloppy: true }); } catch (_) {}
        }
      }
      // Unparsable move: skip it rather than fail the whole line — a skipped
      // move yields an approximate position, which is far more useful to the
      // user than "Invalid FEN". (The result notes it's approximate.)
    }
    return board.fen ? board.fen() : null;
  }

  // Post a browser-tool result back to the server so the parked SSE stream
  // resumes. Retry a couple of times on transient network failure — otherwise a
  // one-off blip strands the Coach on "thinking…" for the full 60s tool timeout.
  // Returns the parsed server response { ok, note } so callers can detect a
  // 'not_found' (wrong cluster instance) and react honestly.
  async function postToolResult(callId, result) {
    const body = JSON.stringify({ callId, result, chatPid: state.chatPid || null });
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await window.apiFetch('/api/coach/tool-result', {
          method: 'POST',
          headers: await state.app._authHeaders({ 'Content-Type': 'application/json' }),
          cache: 'no-store',
          body,
        });
        let data = {};
        try { data = await res.json(); } catch (_) {}
        return data;
      } catch (_) {
        if (attempt >= 3) return { ok: false, note: 'network error' };
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
    return { ok: false };
  }

  async function runStockfishTool(id, args) {
    let fen = String(args?.fen || '').trim();
    // Optional move-text fallback the model can supply instead of a FEN.
    const movesText = String(args?.moves || args?.pgn || '').trim();
    let repairedNote = null;

    if (!fen && !movesText) { await postToolResult(id, { error: 'No FEN provided.' }); return; }

    if (fen) {
      if (!isValidFen(fen)) {
        // Adaptive repair instead of a hard failure: the model's FEN is often
        // *almost* right (missing counters, one bad rank, swapped flags).
        const repaired = repairFen(fen);
        if (repaired) {
          repairedNote = `FEN was repaired before analysis (original: ${fen.slice(0, 80)}).`;
          fen = repaired;
        } else if (movesText) {
          // Last resort: replay the move text.
          const fromMoves = fenFromMoveText(movesText);
          if (fromMoves) {
            fen = fromMoves;
            repairedNote = 'FEN was unparseable; position rebuilt from the provided move list (approximate).';
          }
        }
        if (!isValidFen(fen)) {
          // Genuinely unusable. Tell the model WHY and how to recover — never
          // a silent score:0 the model could cite as "+0.00".
          await postToolResult(id, {
            error: `Invalid FEN ("${fen.slice(0, 100)}"). Retry ONCE with a corrected FEN: 8 ranks separated by "/", digits 1-8 for empty squares, side to move "w" or "b". If you have the move list instead, pass it via the "moves" argument.`,
          });
          return;
        }
      }
    } else {
      // No FEN given but a move list was: rebuild the position from moves.
      const fromMoves = fenFromMoveText(movesText);
      if (!fromMoves) {
        await postToolResult(id, { error: 'Could not parse the move list into a position. Pass a valid FEN, or SAN moves like "1. e4 e5 2. Nf3".' });
        return;
      }
      fen = fromMoves;
    }

    const app = state.app;
    if (!app.engine?.ready && app._initEngine) await app._initEngine();
    if (!app.engine?.ready) {
      await postToolResult(id, { error: 'Stockfish engine is not ready yet. Wait for it to load and try again.' });
      return;
    }

    // Use iterative deepening — no fixed depth cap. Show progress on each
    // depth increase so the user sees the engine working.
    showTyping('Analyzing position…');
    let lastDepth = 0;
    const result = await app.engine.evaluateInfinite(fen, 20000, (info) => {
      if (info.depth > lastDepth) {
        lastDepth = info.depth;
        showTyping(`Depth ${info.depth}${info.score !== undefined ? ` (${info.scoreType === 'mate' ? `#${info.score}` : (info.score / 100).toFixed(2)})` : ''}…`);
      }
    });
    if (repairedNote) result.repaired = repairedNote;

    // Guard against a useless/empty result. A timed-out search returns
    // { score: 0, scoreType: 'cp', bestMove: '', depth: 0, timedOut: true }.
    // Feeding that to the LLM risks it citing "+0.00, position is balanced" as
    // a real eval. Instead, flag it as a timeout so the system prompt's ERROR
    // HANDLING rule kicks in (honest "I couldn't verify that").
    if (result && result.timedOut && !result.bestMove) {
      await postToolResult(id, { error: 'Stockfish analysis timed out before producing a result. No verified evaluation is available.' });
      return;
    }
    await postToolResult(id, result);
  }

  // game_review: open the game in the review system directly (no confirmation
  // popup — the user asked for it, so just do it). Loads the PGN + navigates.
  async function runGameReviewTool(id, args) {
    const pgn = String(args?.pgn || '').trim();
    if (!pgn) { await postToolResult(id, { opened: false, error: 'No PGN provided.' }); return; }
    try {
      const app = state.app;
      app._navigateTo('/review', { disableRestore: true, skipImport: true });
      // Give the review route a tick to mount, then load the PGN into it.
      setTimeout(() => { try { app._loadPgnText(pgn); } catch (e) { console.warn('PGN load failed', e); } }, 60);
      appendToolCard('game_review', 'Opened in the review system.');
      await postToolResult(id, { opened: true });
    } catch (e) {
      await postToolResult(id, { opened: false, error: e.message || 'Could not open review.' });
    }
  }

  // ask_question: render inline multiple-choice buttons in the chat; the user's
  // choice is posted back as the tool result.
  async function runAskQuestionTool(id, args) {
    const question = String(args?.question || '').trim();
    const options = Array.isArray(args?.options) ? args.options.map((o) => String(o)).filter(Boolean) : [];
    if (!options.length) { await postToolResult(id, { answer: '' }); return; }
    hideTyping();
    const box = el['coach-chat-messages']; if (!box) { await postToolResult(id, { answer: '' }); return; }
    const card = document.createElement('div');
    card.className = 'coach-question-card';
    if (question) { const q = document.createElement('div'); q.className = 'coach-question-text'; q.textContent = question; card.appendChild(q); }
    const btns = document.createElement('div'); btns.className = 'coach-question-options';
    card.appendChild(btns);
    box.appendChild(card); scrollMessages();
    return new Promise((resolve) => {
      let settled = false;
      options.forEach((opt) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn btn-secondary coach-question-option'; b.textContent = opt;
        b.addEventListener('click', async () => {
          if (settled) return; settled = true;
          btns.querySelectorAll('button').forEach((x) => (x.disabled = true));
          b.classList.add('selected');
          await postToolResult(id, { answer: opt });
          resolve();
        });
        btns.appendChild(b);
      });
    });
  }

  // end_conversation: lock THIS chat so the user can't send further. The lock
  // persists in localStorage; this is the response to ToS/abuse attempts.
  async function runEndConversationTool(id, args) {
    lockActiveChat();
    appendToolCard('end_conversation', String(args?.reason || 'Conversation ended.'));
    await postToolResult(id, { ended: true });
  }

  // show_board: render a static board embed in the chat from a FEN.
  async function runShowBoardTool(id, args) {
    const fen = String(args?.fen || '').trim();
    if (!fen) { await postToolResult(id, { error: 'No FEN provided.' }); return; }
    if (!isValidFen(fen)) {
      appendToolCard('show_board', 'Invalid FEN — no board shown.');
      await postToolResult(id, { error: 'Invalid FEN. No board could be rendered.' });
      return;
    }
    hideTyping();
    const box = el['coach-chat-messages']; if (!box) { await postToolResult(id, { shown: false }); return; }
    const card = document.createElement('div');
    card.className = 'coach-tool-card coach-board-inline';
    card.innerHTML = `<span class="material-symbols-outlined">grid_on</span><span>Position:</span>`;
    const boardDiv = document.createElement('div');
    boardDiv.innerHTML = renderBoardEmbed(fen);
    card.appendChild(boardDiv);
    box.appendChild(card); scrollMessages();
    await postToolResult(id, { shown: true });
  }

  // SweetAlert popup promise -> boolean isConfirmed.
  function confirmPopup(opts) {
    if (window.Swal && window.Swal.fire) {
      return window.Swal.fire(opts).then((r) => !!r.isConfirmed).catch(() => false);
    }
    return Promise.resolve(window.confirm(opts.title + '\n' + (opts.text || '')));
  }

  // ── UI helpers ───────────────────────────────────────────────────────
  function appendBubble(role, content) { const b = buildBubble(role, content); el['coach-chat-messages']?.appendChild(b); scrollMessages(); return b; }
  function appendSkeleton() {
    const box = el['coach-chat-messages']; if (!box) return null;
    const d = document.createElement('div'); d.className = 'coach-skeleton-bubble';
    box.appendChild(d); scrollMessages(); return d;
  }
  function appendToolCard(name, summary) {
    if (!el['coach-chat-messages'] || !summary) return;
    const d = document.createElement('div'); d.className = 'coach-tool-card';
    const icon = name === 'stockfish' ? 'memory'
      : name === 'web_search' ? 'travel_explore'
      : name === 'game_review' ? 'analytics'
      : name === 'ask_question' ? 'quiz'
      : name === 'end_conversation' ? 'block'
      : name === 'lichess_opening' ? 'menu_book'
      : name === 'lichess_player' ? 'person_search'
      : name === 'fetch_games' ? 'history'
      : 'build';
    d.innerHTML = `<span class="material-symbols-outlined">${icon}</span><span>${escapeHtml(summary)}</span>`;
    el['coach-chat-messages'].appendChild(d); scrollMessages();
  }

  // fetch_games result: a tool card plus one clickable card per game, each
  // opening the game in the review system (same flow as the game_review tool).
  function appendGameCards(name, summary, games) {
    appendToolCard(name, summary);
    const box = el['coach-chat-messages'];
    if (!box) return;
    for (const g of games.slice(0, 15)) {
      const card = document.createElement('div');
      card.className = 'coach-tool-card coach-game-card';
      const white = String(g.white || '?');
      const black = String(g.black || '?');
      const outcome = String(g.outcome || '');
      const icon = outcome === 'win' ? 'check_circle' : outcome === 'loss' ? 'cancel' : 'horizontal_rule';
      const title = `${white} vs ${black}`;
      const meta = [g.opening, g.date, outcome].filter(Boolean).join(' · ');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary btn-sm';
      btn.textContent = 'Review';
      btn.addEventListener('click', () => {
        try {
          const app = state.app;
          if (!g.pgn) return;
          app._navigateTo('/review', { disableRestore: true, skipImport: true });
          setTimeout(() => { try { app._loadPgnText(g.pgn); } catch (e) { console.warn('PGN load failed', e); } }, 60);
        } catch (e) { console.warn('Could not open review', e); }
      });
      const text = document.createElement('span');
      text.innerHTML = `<span class="material-symbols-outlined">${icon}</span><span><strong>${escapeHtml(title)}</strong><br><small>${escapeHtml(meta)}</small></span>`;
      card.appendChild(text);
      card.appendChild(btn);
      box.appendChild(card);
    }
    scrollMessages();
  }
  // ── "Thinking" indicator ───────────────────────────────────────────────
// A visible, reason-aware indicator while the coach is working: a spinner icon
// plus animated dots that cycle while the model reasons or calls tools. The
// label is updated to reflect what the coach is actually doing (verifying with
// Stockfish, searching the web, thinking) so it's never just a dead "…".
  let thinkingTimer = null;
  let dotsTimer = null;
  let dotsCount = 0;
  const TYPING_BASE_LABELS = {
    coach: 'Coach is thinking',
    stockfish: 'Checking with Stockfish',
    search: 'Searching the web',
    lichess: 'Checking Lichess',
    plan: 'Checking your plan',
  };

  function showTyping(label) {
    const textEl = el['coach-typing-text'];
    const dotsEl = el['coach-typing-dots'];
    if (el['coach-typing']) el['coach-typing'].hidden = false;
    // Update the base label text (keep the animated dots span as its child).
    if (textEl) {
      let base = label
        || (TYPING_BASE_LABELS[label] ? TYPING_BASE_LABELS[label] : null)
        || 'Coach is thinking';
      // Strip a trailing ellipsis / dots from the incoming label — the animated
      // dots span owns the ellipsis, so we don't double up ("thinking……").
      base = String(base).replace(/(?:\.\.\.|…|\s+)$/g, '');
      // Only replace the label text node, never the dots span.
      textEl.firstChild && (textEl.firstChild.textContent = base);
    }
    if (dotsEl) {
      // Cycle dots 0 → … → ……
      dotsCount = 0;
      clearInterval(dotsTimer);
      dotsTimer = setInterval(() => {
        dotsCount = (dotsCount + 1) % 4;
        dotsEl.textContent = '.'.repeat(dotsCount);
      }, 350);
    }
  }

  function hideTyping() {
    clearInterval(dotsTimer); dotsTimer = null;
    const dotsEl = el['coach-typing-dots'];
    if (dotsEl) dotsEl.textContent = '';
    if (el['coach-typing']) el['coach-typing'].hidden = true;
  }
  function autoGrow() { const ta = el['coach-chat-textarea']; if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; }

  // Stop/abort the in-flight stream (user clicked the Stop button).
  function stop() {
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }
  }

  // ── Gate + mount ────────────────────────────────────────────────────
  function renderGate() {
    if (!el['coach-chat-locked'] || !el['coach-chat-body']) return;
    // Coach is available to all signed-in users (free = small token allowance,
    // boost = more, max = most). Only show the locked panel for guests
    // (not signed in). While auth is resolving, hide both.
    if (!state.app || state.app.authState.initialized === false) {
      el['coach-chat-locked'].hidden = true; el['coach-chat-body'].hidden = true; return;
    }
    const signedIn = !!state.app.authState.user;
    el['coach-chat-locked'].hidden = signedIn;   // hide upsell when logged in
    el['coach-chat-body'].hidden = !signedIn;     // show chat when logged in
    if (signedIn) focusInput();
    applyLockedState();
    renderUsageBar();
  }

  // ── Usage bar (token quota per tier) ─────────────────────────────────
  function renderUsageBar() {
    if (!el['coach-usage-bar']) return;
    const usage = state.app?.authState?.usage;
    const plan = state.app?.authState?.plan?.plan || 'free';
    if (!usage || usage.coachTokens === undefined) { el['coach-usage-bar'].hidden = true; return; }
    const used = Number(usage.coachTokens) || 0;
    const limit = usage.coachTokenLimit || (plan === 'max' ? 100000 : plan === 'boost' ? 20000 : 5000);
    el['coach-usage-bar'].hidden = false;
    const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    const elFill = el['coach-usage-bar'].querySelector('.coach-usage-fill');
    const elText = el['coach-usage-bar'].querySelector('.coach-usage-text');
    if (elFill) elFill.style.width = pct + '%';
    if (elText) elText.textContent = `${used.toLocaleString()} / ${limit.toLocaleString()} tokens used today`;
  }

  // Update the token usage bar after each message. The `done` SSE event carries
  // the fresh total (the server charges before emitting it), so apply it to
  // authState.usage directly — no round-trip. If the payload is absent (older
  // server), fall back to re-fetching the profile. Also re-renders the account
  // page's Coach tokens row if it's currently mounted.
  function refreshUsage(serverUsage) {
    const app = state.app;
    if (!app || !app.authState) return;
    if (serverUsage && (serverUsage.coachTokens !== undefined || serverUsage.coachTokenLimit !== undefined)) {
      app.authState.usage = {
        ...(app.authState.usage || {}),
        ...(serverUsage.coachTokens !== undefined ? { coachTokens: serverUsage.coachTokens } : {}),
        ...(serverUsage.coachTokenLimit !== undefined ? { coachTokenLimit: serverUsage.coachTokenLimit } : {}),
      };
      renderUsageBar();
      // Keep the account page row in sync if the account panel is showing.
      if (typeof app._renderAccountUsageBars === 'function') {
        app._renderAccountUsageBars(app.authState.plan || { plan: 'free' }, app.authState.usage || {}, app.authState.limits || {});
      }
      return;
    }
    if (typeof app._refreshMe === 'function') {
      app._refreshMe().then(() => renderUsageBar()).catch(() => {});
    } else {
      renderUsageBar();
    }
  }

  // ── Conversation lock (end_conversation tool) ────────────────────────
  // A locked chat can no longer be sent to. The flag persists on the chat in
  // localStorage so it survives reload. The textarea + send button are disabled
  // and a small notice is shown.
  function isLocked() { const c = activeChat(); return !!(c && c.locked); }
  function lockActiveChat() {
    const c = activeChat();
    if (c && !c.locked) { c.locked = true; saveChats(); }
    applyLockedState();
  }
  function applyLockedState() {
    const ta = el['coach-chat-textarea'];
    const send = el['btn-coach-send'];
    const app = state.app;
    const reviewRunning = app && typeof app._isBusyWithHeavyAction === 'function' && app.busyAction === 'review';
    const locked = isLocked();
    if (ta) {
      // Disable during streaming too, so typing "silently dies" on Enter isn't
      // possible — the user can't send a second message until the first finishes.
      ta.disabled = locked || reviewRunning || state.streaming;
      if (locked) ta.placeholder = 'This conversation has been ended.';
      else if (reviewRunning) ta.placeholder = 'A game review is running. Wait for it to finish.';
      else if (state.streaming) ta.placeholder = 'Waiting for the coach to finish…';
      else ta.placeholder = 'Ask the coach anything about chess…';
    }
    if (send) send.disabled = locked || state.streaming || reviewRunning;
    // Toggle a notice bubble if needed.
    const box = el['coach-chat-messages']; if (!box) return;
    let notice = box.querySelector('.coach-locked-notice');
    if (locked && !notice) {
      notice = document.createElement('div'); notice.className = 'coach-bubble coach-bubble-error coach-locked-notice';
      notice.textContent = 'This conversation has been ended by the coach.';
      box.appendChild(notice); scrollMessages();
    } else if (!locked && notice) {
      notice.remove();
    }
  }

  function bindEvents() {
    document.addEventListener('chessreview:busyaction', () => applyLockedState());
    el['coach-chat-form']?.addEventListener('submit', (e) => { e.preventDefault(); send(); });
    el['coach-chat-textarea']?.addEventListener('input', autoGrow);
    el['coach-chat-textarea']?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    el['btn-coach-new-chat']?.addEventListener('click', () => { if (!state.streaming) { createChat(); } });
    el['btn-coach-stop']?.addEventListener('click', () => { stop(); });
    // Play the bot: delegate to the app's coach game setup modal.
    el['btn-coach-play-bot']?.addEventListener('click', () => {
      if (state.app && state.app._showCoachSetupModal) state.app._showCoachSetupModal();
    });
    el['btn-coach-sidebar-toggle']?.addEventListener('click', () => {
      el['coach-chat-card']?.classList.toggle('sidebar-collapsed');
    });
    // On mobile the history sidebar is an overlay drawer. Clicking the dimmed
    // area behind it (or pressing Escape) closes the drawer. Listen on the
    // shell so clicks that land on the dim overlay (which sits over the main
    // pane) are caught even though the main pane itself is pointer-events:none.
    // Ignore clicks on the toggle button itself (its own handler opens/closes).
    el['coach-chat-card']?.addEventListener('click', (e) => {
      const card = el['coach-chat-card'];
      if (!card) return;
      const isMobile = window.innerWidth <= 720;
      const open = !card.classList.contains('sidebar-collapsed');
      // Only close when the drawer is open AND the click is outside the sidebar
      // AND not on the toggle button (which manages its own state).
      if (isMobile && open && !e.target.closest('.coach-sidebar') && !e.target.closest('#btn-coach-sidebar-toggle')) {
        card.classList.add('sidebar-collapsed');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const card = el['coach-chat-card'];
      if (card && window.innerWidth <= 720 && !card.classList.contains('sidebar-collapsed')) {
        card.classList.add('sidebar-collapsed');
      }
    });
  }

  // Load (or reload) the persisted chats for a uid into state + render them.
  // Idempotent: safe to call repeatedly once auth has resolved (fixes the
  // reload-loses-history bug — mount() may run before Firebase auth resolves,
  // so we must reload when the uid first becomes known).
  function loadForUid(uid) {
    if (!uid) { state.uid = null; return; }
    if (uid !== state.uid) {
      state.uid = uid;
      state.chats = []; state.activeId = null;
      loadChats();
    }
    if (!state.chats.length) createChat();
    renderSidebar();
    // Don't wipe the live streaming bubble if an onAuth re-render fires mid-stream.
    if (!state.streaming) renderMessages();
    applyLockedState();
  }

  // Called by app.js when /coach is entered.
  function mount(app) {
    state.app = app;
    if (!el['coach-chat-card']) resolveEls(); // resolve once
    if (!state.mounted) { bindEvents(); state.mounted = true; }
    // Collapse sidebar on mobile by default
    if (window.innerWidth <= 720) el['coach-chat-card']?.classList.add('sidebar-collapsed');
    renderGate();
    const uid = app.authState && app.authState.user && app.authState.user.uid;
    loadForUid(uid);
    // Hand-off from the review page: if a seed is stashed, open a new chat
    // preloaded with the reviewed game's context + the generated overview.
    if (app._pendingCoachSeed) {
      const seed = app._pendingCoachSeed;
      app._pendingCoachSeed = null;
      try { startWithContext(seed); } catch (_) {}
    }
    // Auto-scroll the chat section into view.
    setTimeout(() => { el['coach-chat-card']?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
  }

  // Called by app.js when auth resolves (post-reload, the uid arrives here).
  function onAuth(app) {
    state.app = app;
    renderGate();
    const uid = app.authState && app.authState.user && app.authState.user.uid;
    loadForUid(uid);
  }

  window.CoachChat = { mount, onAuth, renderGate, send, stop };
})();
