document.addEventListener('DOMContentLoaded', () => {
  const app = window.app;
  if (!app?._authHeaders) return;
  const escape = value => app._escapeHtml(String(value ?? ''));
  let data = { linked: [] }, automatic = null, identity = '', generation = 0, pending = null, autoVersion = 0;
  const roots = [];
  for (const target of [document.querySelector('.settings-content'), document.getElementById('account-signed-in-page')]) {
    if (!target) continue;
    const root = document.createElement('section');
    const inAccount = target.id === 'account-signed-in-page';
    root.className = inAccount ? 'linked-hub account-connections' : 'linked-hub card settings-section';
    root.id = inAccount ? 'account-connections' : 'settings-connections';
    root.innerHTML = '<div class="page-card-head"><h2>Connected accounts</h2><p>Import public games and ratings by username. Connect Lichess in Play to play online.</p></div><div data-accounts></div><p class="account-status" role="status" aria-live="polite" data-status></p><div data-automatic></div>';
    const after = target.querySelector(inAccount ? '.account-details-panel' : '#settings-board');
    if (after) after.after(root); else target.append(root);
    if (!inAccount) {
      const navLink = document.createElement('a'); navLink.href = '#settings-connections'; navLink.textContent = 'Connected accounts';
      document.querySelector('.settings-nav')?.append(navLink);
    }
    roots.push(root);
  }
  const home = document.createElement('div');
  home.className = 'home-linked-summary';
  document.querySelector('.home-workspace')?.before(home);
  const status = message => roots.forEach(root => { root.querySelector('[data-status]').textContent = message; });
  function automaticMessage() {
    if (!automatic) return 'Loading automatic-review status…';
    if (automatic.available === false) return 'The beta is paused on the server.';
    if (!automatic.enabled) return 'Enable automatic reviews before your next Play game finishes. Existing games are not reviewed automatically.';
    const checked = automatic.lastCheckedAt ? ` Last checked ${new Date(automatic.lastCheckedAt).toLocaleTimeString()}.` : '';
    if (automatic.status === 'retrying') return `The last attempt failed. The server will retry${automatic.nextCheckAt ? ` after ${new Date(automatic.nextCheckAt).toLocaleTimeString()}` : ' shortly'}.${checked}`;
    if (automatic.status === 'reviewing') return `The server is analyzing a completed game.${checked}`;
    if (automatic.status === 'daily_limit') return `Today's 12 review attempts have been used. Reviews resume after midnight UTC.${checked}`;
    if (automatic.nextCheckAt && automatic.nextCheckAt < Date.now() - 4 * 60000
      && (!automatic.workerLastTickAt || automatic.workerLastTickAt < Date.now() - 4 * 60000)) {
      return `Automatic reviews are delayed. Try again later or contact support.${checked}`;
    }
    return `Watching your connected Lichess Play account for completed games.${checked}`;
  }
  async function request(path, body) {
    const uid = app.authState.user?.uid, version = generation;
    if (!uid) throw new Error('Sign in to connect your chess accounts.');
    const response = await window.apiFetch(path, { headers: await app._authHeaders({ 'Content-Type': 'application/json' }), method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store' });
    const result = await response.json();
    if (uid !== app.authState.user?.uid || generation !== version) throw new Error('Account changed. Please try again.');
    if (!response.ok) throw new Error(result.error || 'Could not sync your chess accounts.');
    return result;
  }
  function render() {
    const saved = app.authState.savedUsernames || {};
    for (const root of roots) {
      root.hidden = !app.authState.user;
      root.querySelector('[data-accounts]').innerHTML = ['lichess', 'chesscom'].map(source => {
        const account = data.linked.find(entry => entry.source === source);
        const name = saved[source] || '';
        return `<div class="linked-account" data-source="${source}"><div class="linked-account-head"><strong>${source === 'lichess' ? 'Lichess' : 'Chess.com'}</strong><span>${name ? 'Linked public profile' : 'Not linked'}</span></div><label class="field"><span class="field-label">Username</span><input class="input-select" data-username value="${escape(name)}" maxlength="40" autocomplete="off" placeholder="Your username"></label><div class="linked-actions"><button class="btn btn-secondary" type="button" data-action="link">${name ? 'Update link' : 'Link account'}</button>${name ? '<button class="btn btn-ghost" type="button" data-action="unlink">Unlink</button><button class="btn btn-secondary" type="button" data-action="games">Recent games</button>' : ''}</div>${account?.error ? `<p class="account-status error">${escape(account.error)}</p>` : ''}${account?.ratings ? `<div class="linked-ratings">${Object.entries(account.ratings).filter(([, rating]) => rating).map(([mode, rating]) => `<span>${escape(mode)} <strong>${rating}</strong></span>`).join('')}</div>` : ''}${account?.puzzleRating ? `<div class="linked-rating-import"><span>Puzzle ${account.ratingKind === 'peak' ? 'peak' : 'rating'} <strong>${account.puzzleRating}</strong></span><button class="btn btn-secondary btn-small" type="button" data-action="import-rating">Use for training</button></div>${account.ratingKind === 'peak' ? '<p class="linked-note">Chess.com publishes a puzzle peak, not a current puzzle rating.</p>' : ''}` : ''}</div>`;
      }).join('');
      root.querySelector('[data-automatic]').innerHTML = `<div class="auto-review-beta"><div class="card-header"><h3>Automatic reviews <span class="beta-badge">MAX BETA</span></h3><span>${escape(automatic?.status || 'paused').replaceAll('_', ' ')}</span></div><p>New completed games played through your connected Lichess Play account appear here with a server review. Up to 12 games per UTC day, 160 half-moves per game.</p><label class="checkbox-row"><input type="checkbox" data-auto-toggle ${automatic?.enabled ? 'checked' : ''} ${automatic?.eligible ? '' : 'disabled'}> Review new Play games automatically</label>${automatic?.eligible ? `<small>${automatic.usedToday || 0} / 12 review attempts used today</small>` : `<a class="btn-link" href="/play" data-route="/play">${automatic?.available === false ? 'Beta paused for maintenance' : 'Requires Max and Lichess connected in Play'}</a>`}<div class="auto-review-list">${(automatic?.reviews || []).map(review => `<button type="button" class="import-result" data-review="${escape(review.id)}"><span>${escape(review.white)} vs ${escape(review.black)}<small>Lichess · ${new Date(review.createdAt).toLocaleDateString()}</small></span><span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></button>`).join('') || ''}</div><p class="linked-note" role="status" data-auto-status>${escape(automaticMessage())}</p></div>`;
    }
    home.hidden = !app.authState.user;
    home.innerHTML = `<span class="eyebrow">YOUR LINKED CHESS</span>${data.linked.map(entry => `<button type="button" class="btn btn-secondary btn-small" data-home-source="${entry.source}">${entry.source === 'chesscom' ? 'Chess.com' : 'Lichess'} · ${escape(entry.username)} <span aria-hidden="true">↗</span></button>`).join('')}<a class="btn-link" href="/settings" data-route="/settings">${data.linked.length ? 'Manage links' : 'Connect your accounts'}</a>`;
  }
  function publish(result) {
    data = result;
    const latest = result.linked.flatMap(entry => entry.latest ? [entry.latest] : []).sort((a, b) => {
      const date = game => Number(game.headers?.EndTime) || Date.parse(`${(game.headers?.UTCDate || game.headers?.Date || '').replaceAll('.', '-')}T${game.headers?.UTCTime || '00:00:00'}Z`) / 1000 || 0;
      return date(b) - date(a);
    })[0];
    if (latest) window.dispatchEvent(new CustomEvent('linked-study-game', { detail: latest }));
    else window.dispatchEvent(new Event('linked-study-reset'));
    window.dispatchEvent(new CustomEvent('linked-chess-data', { detail: result }));
    render();
  }
  async function refresh() {
    if (!app.authState.user || pending) return pending;
    const version = generation;
    const automaticVersion = autoVersion;
    pending = (async () => {
      try {
        const [linkedResult, automaticResult] = await Promise.allSettled([request('/api/linked-chess'), request('/api/max-auto-review')]);
        if (version !== generation) return;
        if (linkedResult.status === 'fulfilled') publish(linkedResult.value);
        else status(linkedResult.reason.message);
        // A slow background GET must not overwrite a successful opt-in POST.
        if (automaticVersion === autoVersion) {
          if (automaticResult.status === 'fulfilled') automatic = automaticResult.value;
          else status(automaticResult.reason.message);
        }
        render();
      } catch (error) { if (version === generation) status(error.message); }
      finally { if (version === generation) pending = null; }
    })();
    return pending;
  }
  function openGame(record) {
    app._navigateTo('/review', { skipImport: true });
    app._loadPgnText(record.pgn);
    const name = String(record.username || '').toLowerCase();
    const white = String(app.gameHeaders.White || '').toLowerCase();
    const black = String(app.gameHeaders.Black || '').toLowerCase();
    if (name && (name === white || name === black)) app._setBoardOrientationForColor(name === black ? 'b' : 'w');
  }
  function showGames(source) {
    const account = data.linked.find(entry => entry.source === source);
    if (!account?.games?.length) return app._quickLoadSavedUsername(source);
    app._navigateTo('/review', { skipImport: true });
    app._showPgnModal();
    app._importUsername = account.username;
    app._renderImportResults(account.games);
    app._setImportStatus(`Latest ${account.games.length} completed games for ${account.username}. Select a game to review.`, 'success');
  }
  async function openReview(id) {
    const { review: record } = await request(`/api/max-auto-review?id=${encodeURIComponent(id)}`);
    openGame(record);
    app.analysisResults = app._serverAnalysisResultsFromData(record.review);
    app._showReviewSummary();
    app._renderMoveList();
    app._renderCriticalMoments();
    app._goToMove(0);
  }
  for (const root of roots) {
    root.addEventListener('click', async event => {
      const button = event.target.closest('[data-action], [data-review]');
      if (!button || button.disabled) return;
      const row = button.closest('[data-source]'), source = row?.dataset.source;
      button.disabled = true;
      try {
        if (button.dataset.review) { await openReview(button.dataset.review); return; }
        if (button.dataset.action === 'games') { await showGames(source); return; }
        const result = await request('/api/linked-chess', { action: button.dataset.action, source, username: row.querySelector('[data-username]').value.trim() });
        if (button.dataset.action === 'import-rating') {
          await app._refreshMe();
          app._applyProfileToPuzzleMode(app.authState.profile);
          app._syncAccountUi();
          status('Puzzle rating imported for training.');
        } else {
          const saved = { ...app.authState.profile.savedUsernames, [source]: button.dataset.action === 'unlink' ? '' : row.querySelector('[data-username]').value.trim() };
          app.authState.profile.savedUsernames = saved;
          app._loadSavedUsernames();
          app._renderSavedUsernameBar();
          app._renderHomeQuickLoad();
          status(button.dataset.action === 'unlink' ? 'Account unlinked.' : 'Account connected. Your coach can reference these games.');
        }
        publish(result);
        await refresh();
      } catch (error) { status(error.message); }
      finally { button.disabled = false; }
    });
    root.addEventListener('change', async event => {
      if (!event.target.matches('[data-auto-toggle]')) return;
      const toggle = event.target;
      autoVersion += 1;
      toggle.disabled = true;
      try { automatic = await request('/api/max-auto-review', { enabled: toggle.checked }); render(); }
      catch (error) { toggle.checked = !toggle.checked; status(error.message); }
      finally { toggle.disabled = !automatic?.eligible; }
    });
  }
  home.addEventListener('click', event => {
    const button = event.target.closest('[data-home-source]');
    if (button) showGames(button.dataset.homeSource);
  });
  const auth = () => {
    const next = `${app.authState.user?.uid || ''}:${JSON.stringify(app.authState.savedUsernames || {})}`;
    if (next === identity) return;
    identity = next; generation += 1; pending = null; data = { linked: [] }; automatic = null;
    window.dispatchEvent(new Event('linked-study-reset'));
    render();
    if (app.authState.user) refresh();
  };
  window.addEventListener('linked-auth', auth);
  window.addEventListener('focus', () => { if (app.authState.user) refresh(); });
  setInterval(() => { if (!document.hidden && app.authState.user) refresh(); }, 60000);
  document.addEventListener('click', event => {
    const anchor = event.target.closest('a[href]');
    if (!anchor || event.ctrlKey || event.metaKey || anchor.target === '_blank') return;
    const url = new URL(anchor.href, location.href);
    const id = url.searchParams.get('auto-review');
    if (url.origin === location.origin && /^[a-f0-9]{64}$/.test(id || '')) {
      event.preventDefault();
      openReview(id).catch(error => status(error.message));
    }
  });
  window.LinkedChessHub = { refresh, openReview, openGame, showGames, hasGames: source => Boolean(data.linked.find(entry => entry.source === source)?.games?.length) };
  auth();
});
