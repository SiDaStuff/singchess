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
  const MODEL_PREF_KEY = 'sidastuff.coachModel'; // 'fast' | 'strong'

  const state = {
    app: null,            // the ChessReviewApp instance (for auth + engine)
    mounted: false,
    uid: null,
    model: 'fast',
    chats: [],            // [{id, title, createdAt, messages:[]}]
    activeId: null,
    streaming: false,
    abortController: null,
  };

  // ── DOM refs (resolved on mount) ─────────────────────────────────────
  const el = {};
  function $(id) { return document.getElementById(id); }
  function resolveEls() {
    [
      'coach-chat-card', 'coach-chat-locked', 'coach-chat-body', 'coach-chat-messages',
      'coach-typing', 'coach-typing-text', 'coach-chat-form', 'coach-chat-textarea',
      'btn-coach-send', 'btn-coach-stop', 'coach-sidebar-list', 'btn-coach-new-chat',
      'btn-coach-play-bot', 'coach-chat-subtitle', 'coach-usage-bar',
    ].forEach((id) => { el[id] = $(id); });
    el.modelSegs = document.querySelectorAll('.coach-model-seg');
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
  function selectChat(id) {
    if (state.streaming) return;
    state.activeId = id;
    saveChats();
    renderSidebar();
    renderMessages();
    if (window.innerWidth <= 900) el['coach-chat-card']?.classList.remove('sidebar-open');
  }
  function deleteChat(id) {
    // Guard: deleting the active chat mid-stream orphans send()'s closure and
    // renderMessages wipes the live bubble. Block while streaming (the sibling
    // selectChat + new-chat paths already guard the same way).
    if (state.streaming) return;
    state.chats = state.chats.filter((c) => c.id !== id);
    if (state.activeId === id) state.activeId = state.chats[0] ? state.chats[0].id : null;
    if (!state.chats.length) { createChat(); return; }
    saveChats();
    renderSidebar();
    renderMessages();
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
    el['coach-chat-card']?.querySelector('.coach-chat-main')?.classList.add('busy');
    el['btn-coach-send'] && (el['btn-coach-send'].disabled = true);
    el['btn-coach-send'] && (el['btn-coach-send'].hidden = true);
    el['btn-coach-stop'] && (el['btn-coach-stop'].hidden = false);

    const skeleton = appendSkeleton();
    showTyping('Coach is thinking…');

    const controller = new AbortController();
    state.abortController = controller;
    const timeout = setTimeout(() => controller.abort(), 180000);

    let assistantEl = null;
    let assistantText = '';

    try {
      // Send the conversation history (client-owned) + the model tier.
      const history = chat.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }));
      const response = await window.apiFetch('/api/coach/chat', {
        method: 'POST',
        headers: await state.app._authHeaders({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
        signal: controller.signal,
        cache: 'no-store',
        body: JSON.stringify({ message: text, model: state.model, history }),
      });
      if (!response.ok) {
        let msg = `Coach error (${response.status}).`;
        try { const j = await response.json(); msg = j.error || msg; } catch (_) {}
        throw new Error(msg);
      }
      await readStream(response, {
        onToken: (t) => {
          if (!assistantEl) { skeleton?.remove(); hideTyping(); assistantEl = buildBubble('assistant', ''); assistantEl.classList.add('streaming'); el['coach-chat-messages'].appendChild(assistantEl); }
          assistantText += t;
          // Re-render markdown progressively (cheap for short replies).
          assistantEl.innerHTML = renderMarkdown(assistantText);
          scrollMessages();
        },
        onToolCall: (call) => handleBrowserTool(call),
        onToolStatus: ({ label }) => showTyping(label),
        onToolResultVisible: ({ name, summary }) => { hideTyping(); appendToolCard(name, summary); },
        onDone: (data) => {
          skeleton?.remove();
          hideTyping();
          if (assistantEl) assistantEl.classList.remove('streaming');
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
      hideTyping();
      if (err && err.name === 'AbortError') {
        // User clicked Stop (save partial) vs 180s timeout (show error).
        // We distinguish by checking whether the timeout already fired.
        if (assistantText) {
          // Save what we got so far as a partial reply.
          chat.messages.push({ role: 'assistant', content: assistantText + '\n\n_(stopped)_', ts: Date.now() });
          saveChats();
          if (assistantEl) { assistantEl.classList.remove('streaming'); assistantEl.innerHTML = renderMarkdown(assistantText + '\n\n_(stopped)_'); }
        } else {
          appendBubble('error', 'Coach timed out — please try again.');
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
      clearTimeout(timeout);
      state.streaming = false;
      state.abortController = null;
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
      if (name === 'puzzle') return await runPuzzleTool(id, args);
      throw new Error('Unsupported browser tool.');
    } catch (err) {
      await postToolResult(id, { error: err.message || 'Browser tool failed.' });
    }
  }

  // Post a browser-tool result back to the server so the parked SSE stream
  // resumes. Retry a couple of times on transient network failure — otherwise a
  // one-off blip strands the Coach on "thinking…" for the full 60s tool timeout.
  async function postToolResult(callId, result) {
    const body = JSON.stringify({ callId, result });
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await window.apiFetch('/api/coach/tool-result', {
          method: 'POST',
          headers: await state.app._authHeaders({ 'Content-Type': 'application/json' }),
          cache: 'no-store',
          body,
        });
        return;
      } catch (_) {
        if (attempt >= 3) return;
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }

  async function runStockfishTool(id, args) {
    showTyping('Analyzing the position…');
    const fen = String(args?.fen || '').trim();
    const depth = Math.max(8, Math.min(24, Number(args?.depth) || 18));
    if (!fen) throw new Error('No FEN provided.');
    const app = state.app;
    if (!app.engine?.ready && app._initEngine) await app._initEngine();
    if (!app.engine?.ready) throw new Error('Stockfish is not ready yet.');
    const result = await app.engine.evaluate(fen, depth, Math.min(20000, depth * 1200));
    await postToolResult(id, result);
  }

  // game_review: ask the user (popup) whether to open the game in the review
  // system; if yes, load the PGN + navigate to /review.
  async function runGameReviewTool(id, args) {
    const pgn = String(args?.pgn || '').trim();
    const label = String(args?.summary || args?.label || 'Open this game in the review system?');
    if (!pgn) { await postToolResult(id, { opened: false, error: 'No PGN provided.' }); return; }
    const confirmed = await confirmPopup({
      icon: 'info',
      title: 'Review this game?',
      text: label,
      confirmButtonText: 'Open review',
      cancelButtonText: 'Not now',
      showCancelButton: true,
    });
    if (!confirmed) { await postToolResult(id, { opened: false }); return; }
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

  // puzzle: open a SweetAlert popup with a position for the user to solve.
  async function runPuzzleTool(id, args) {
    const fen = String(args?.fen || '').trim();
    const title = String(args?.title || 'Solve this position');
    const instruction = String(args?.instruction || args?.text || 'Find the best move.');
    const solution = String(args?.solution || '').trim();
    if (!fen) { await postToolResult(id, { solved: false, error: 'No FEN provided.' }); return; }
    const boardHtml = renderBoardEmbed(fen);
    // Show the puzzle popup; user can reveal the solution or close. AWAIT the
    // popup so we only post the tool result + the tool card AFTER the user has
    // actually interacted (previously the card showed "done" before they moved,
    // and a dismissed popup left the LLM blocked until the 60s timeout).
    if (window.Swal && window.Swal.fire) {
      let result;
      try { result = await window.Swal.fire({
        title,
        html: `<div class="coach-puzzle-popup">${boardHtml}</div><p style="margin-top:12px;font-size:0.9rem;color:var(--text-secondary);">${escapeHtml(instruction)}</p>`,
        confirmButtonText: solution ? 'Reveal solution' : 'Got it',
        showCancelButton: true,
        cancelButtonText: 'Close',
        showDenyButton: !!solution,
        denyButtonText: 'I solved it!',
      }); } catch (_) { result = { isDismissed: true }; }
      let outcome;
      if (result.isDenied) { outcome = { solved: true }; }
      else if (result.isConfirmed && solution) {
        outcome = { revealed: true };
        window.Swal.fire({ title: 'Solution', text: solution, icon: 'info' });
      } else { outcome = { closed: true }; }
      await postToolResult(id, outcome);
      appendToolCard('puzzle', `${title} — ${outcome.solved ? 'solved' : outcome.revealed ? 'solution revealed' : 'closed'}`);
    } else {
      window.confirm(title + '\n' + instruction);
      await postToolResult(id, { closed: true });
      appendToolCard('puzzle', `${title} — closed`);
    }
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
      : 'build';
    d.innerHTML = `<span class="material-symbols-outlined">${icon}</span><span>${escapeHtml(summary)}</span>`;
    el['coach-chat-messages'].appendChild(d); scrollMessages();
  }
  function showTyping(label) { el['coach-typing-text'] && (el['coach-typing-text'].textContent = label || 'Coach is thinking…'); el['coach-typing'] && (el['coach-typing'].hidden = false); }
  function hideTyping() { el['coach-typing'] && (el['coach-typing'].hidden = true); }
  function autoGrow() { const ta = el['coach-chat-textarea']; if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; }

  // Stop/abort the in-flight stream (user clicked the Stop button).
  function stop() {
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }
  }

  // ── Model toggle ─────────────────────────────────────────────────────
  // The Strong model is a Boost+ perk. Free users are locked to Fast — both in
  // the UI (the Strong button is disabled) and at the send site. The server
  // independently enforces this, so the lock here is UX, not security.
  function canUseStrong() {
    const app = state.app;
    return !!(app && typeof app._isPaidOrAbove === 'function' && app._isPaidOrAbove('boost'));
  }
  function setModel(m) {
    if (m !== 'fast' && m !== 'strong') return;
    if (m === 'strong' && !canUseStrong()) {
      // Free user can't pick Strong: bounce back to Fast and nudge them.
      applyModelToggle();
      flashStrongLocked();
      return;
    }
    state.model = m;
    applyModelToggle();
    try { localStorage.setItem(MODEL_PREF_KEY, m); } catch (_) {}
    // Also persist onto the server profile prefs (app helper).
    if (state.app) {
      const prefs = { ...((state.app.authState && state.app.authState.profile && state.app.authState.profile.coachMode) || {}), model: m };
      state.app.authState.profile = { ...(state.app.authState.profile || {}), coachMode: prefs };
      state.app._saveUserProfile && state.app._saveUserProfile(state.app.authState.profile).catch(() => {});
    }
  }
  // Reflect the active model + Strong availability on the toggle buttons. The
  // Strong button is disabled (and badged) for free users so it reads as locked.
  function applyModelToggle() {
    el.modelSegs?.forEach((b) => {
      const isStrong = b.dataset.model === 'strong';
      const allowed = !isStrong || canUseStrong();
      b.setAttribute('aria-pressed', String(b.dataset.model === state.model));
      b.disabled = !allowed;
      b.classList.toggle('locked', !allowed);
      b.title = allowed ? '' : 'Strong model is a Boost feature';
    });
  }
  function flashStrongLocked() {
    const box = el['coach-chat-messages'];
    if (!box) return;
    const notice = document.createElement('div');
    notice.className = 'coach-bubble coach-bubble-error coach-strong-locked-notice';
    notice.textContent = 'The Strong model is a Boost feature — upgrade on the Plans page to use it.';
    box.appendChild(notice); scrollMessages();
    setTimeout(() => notice.remove(), 4000);
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
    applyModelToggle(); // Strong lock state depends on the resolved plan
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
    const locked = isLocked();
    if (ta) { ta.disabled = locked; if (locked) ta.placeholder = 'This conversation has been ended.'; else ta.placeholder = 'Ask the coach anything about chess…'; }
    if (send) send.disabled = locked || state.streaming;
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
    el['coach-chat-form']?.addEventListener('submit', (e) => { e.preventDefault(); send(); });
    el['coach-chat-textarea']?.addEventListener('input', autoGrow);
    el['coach-chat-textarea']?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    el['btn-coach-new-chat']?.addEventListener('click', () => { if (!state.streaming) { createChat(); } });
    el['btn-coach-stop']?.addEventListener('click', () => { stop(); });
    // Play the bot: delegate to the app's coach game setup modal.
    el['btn-coach-play-bot']?.addEventListener('click', () => {
      if (state.app && state.app._showCoachSetupModal) state.app._showCoachSetupModal();
    });
    el.modelSegs?.forEach((b) => b.addEventListener('click', () => setModel(b.dataset.model)));
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
    // model preference
    try { state.model = localStorage.getItem(MODEL_PREF_KEY) || (app.authState && app.authState.profile && app.authState.profile.coachMode && app.authState.profile.coachMode.model) || 'fast'; } catch (_) { state.model = 'fast'; }
    if (state.model !== 'strong') state.model = 'fast';
    // Strong is a Boost+ perk: downgrade a free user's persisted 'strong' pref.
    if (state.model === 'strong' && !canUseStrong()) state.model = 'fast';
    applyModelToggle();
    renderGate();
    const uid = app.authState && app.authState.user && app.authState.user.uid;
    loadForUid(uid);
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
