import './admin.css';
let app, controller, detail;
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const date = value => value ? new Date(value).toLocaleString() : 'Not recorded';
const label = key => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._]/g, ' ');
async function adminAction(body) {
  const response = await window.apiFetch('/api/admin/access-control', { method: 'POST', headers: await app._authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Administrator action failed.');
  return data;
}
async function loadFairPlayReviews() {
  const list = $('admin-fair-play-list'); if (!list || !app?.authState?.isAdmin) return;
  list.innerHTML = '<p class="muted">Loading review queue…</p>';
  try {
    const response = await window.apiFetch('/api/admin/fair-play-reviews', { headers: await app._authHeaders(), cache: 'no-store' });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not load review queue.');
    const calibration = data.calibration || {};
    $('admin-fair-play-calibration').textContent = calibration.decisive
      ? `${calibration.labelled} labelled · ${Math.round((calibration.disagreementRate || 0) * 100)}% reviewer disagreement`
      : 'No decisive reviewer labels yet.';
    const pending = (data.reviews || []).filter((review) => review.status !== 'reviewed');
    list.innerHTML = pending.map((review) => `<article class="admin-profile-note" data-fair-play-job="${escape(review.jobId)}">
      <strong>Score ${escape(review.score)} · ${escape(review.confidence || 'Low')} confidence</strong>
      <span>${escape(date(review.createdAt))} · range ${escape((review.scoreRange || []).join('–'))}</span>
      <p>${escape((review.signals || []).filter(signal => signal.points > 0).slice(0, 4).map(signal => `${signal.label} +${signal.points}`).join(' · '))}</p>
      <label class="field"><span class="field-label">Reviewer notes</span><textarea class="input-select" rows="2" maxlength="2000"></textarea></label>
      <div class="standalone-actions"><button class="btn btn-secondary btn-small" data-decision="agree" type="button">Agree</button><button class="btn btn-secondary btn-small" data-decision="disagree" type="button">Disagree</button><button class="btn btn-secondary btn-small" data-decision="inconclusive" type="button">Inconclusive</button></div>
    </article>`).join('') || '<p class="muted">No reports are waiting for review.</p>';
    list.querySelectorAll('[data-decision]').forEach((button) => button.addEventListener('click', async () => {
      const card = button.closest('[data-fair-play-job]');
      button.disabled = true;
      try {
        const result = await window.apiFetch('/api/admin/fair-play-reviews', { method: 'PATCH', headers: await app._authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ jobId: card.dataset.fairPlayJob, decision: button.dataset.decision, notes: card.querySelector('textarea').value }) });
        const payload = await result.json(); if (!result.ok) throw new Error(payload.error || 'Could not save review.');
        await loadFairPlayReviews();
      } catch (error) { button.disabled = false; $('admin-fair-play-calibration').textContent = error.message; }
    }));
  } catch (error) { list.innerHTML = `<p class="account-status error">${escape(error.message)}</p>`; }
}
function rows(value, prefix = '') {
  if (!value || typeof value !== 'object') return `<div><dt>${escape(label(prefix))}</dt><dd>${escape(value ?? 'Not recorded')}</dd></div>`;
  return Object.entries(value).map(([key, child]) => rows(child, prefix ? `${prefix} · ${key}` : key)).join('');
}
function status(message, error = false) {
  $('admin-profile-status').textContent = message;
  $('admin-profile-status').className = `account-status ${error ? 'error' : ''}`;
}
function render(data) {
  detail = data;
  const { account, plan, ban, stats, linkedAccounts, notes, reports, actions, automaticReviews } = data;
  const stored = Object.fromEntries(Object.entries(data.profile).filter(([key]) => /stats|rating|xp|points|streak|achievements|rewards|games|accuracy|brilliant|reviews|solved|attempted/i.test(key)));
  const overrides = data.profile.featureOverrides || {};
  const globalToggle = $('admin-global-background-review');
  if (globalToggle) globalToggle.checked = data.featureControls?.features?.reviewBackground === true;
  $('admin-profile-result').innerHTML = `
    <article class="admin-player-detail">
      <header class="admin-player-heading"><div><h3>${escape(account.username || 'Unnamed player')}</h3><p>${escape(account.email || 'No email recorded')}</p></div>
        <span class="status-pill ${ban.banned ? 'is-banned' : ''}">${ban.banned ? 'Banned' : account.authAccountMissing ? 'Auth account removed' : 'Active'} · ${escape(plan.name)}</span></header>
      <div class="admin-profile-stats">
        ${[['Puzzle rating', stats.puzzleRating ?? 'Not recorded'], ['Solved puzzles', stats.puzzleStats.solved ?? 0], ['Attempts', stats.puzzleStats.attempted ?? 0], ['Current streak', stats.puzzleStats.streak ?? 0], ['Coach today', `${stats.today.coachUsagePercent}% used`]].map(([title, value]) => `<div><span>${escape(title)}</span><strong>${escape(value)}</strong></div>`).join('')}
      </div>
      <section class="admin-profile-section"><h4>Account &amp; restrictions</h4><dl class="admin-profile-fields">
        ${rows({ uid: account.uid, emailVerified: account.emailVerified ? 'Yes' : 'No', created: date(account.createdAt), lastSignIn: date(account.lastSignInAt), lastSeen: date(account.lastSeenAt), online: account.online ? 'Yes' : 'No', planExpires: date(plan.expiresAt) })}
        ${ban.banned ? rows({ banReason: ban.reason, bannedBy: ban.bannedBy || 'Not recorded', bannedAt: date(ban.bannedAt), source: ban.source || 'Not recorded' }) : ''}
        ${ban.unbannedAt ? rows({ unbannedBy: ban.unbannedBy || 'Not recorded', unbannedAt: date(ban.unbannedAt) }) : ''}
      </dl><button class="btn btn-secondary btn-small" id="admin-profile-manage" type="button" ${account.authAccountMissing ? 'disabled' : ''}>Manage plan or restriction</button></section>
      <section class="admin-profile-section"><h4>Feature access &amp; usage</h4>
        <p class="muted">A blank override inherits the site-wide setting. These controls are enforced by the API.</p>
        <div class="admin-feature-controls">${['puzzles', 'serverReviews', 'anticheat', 'coach', 'reviewBackground'].map(feature => `<label class="checkbox-row"><input type="checkbox" data-feature="${feature}" ${overrides[feature] === true ? 'checked' : ''} data-override="${overrides[feature] === false ? 'false' : overrides[feature] === true ? 'true' : ''}"> ${escape(label(feature))} enabled for this user</label>`).join('')}</div>
        <div class="standalone-actions"><select class="input-select" data-reset-feature><option value="">All usage</option><option value="serverReviews">Server reviews</option><option value="manualImports">Manual imports</option><option value="anticheatGames">Anticheat games</option><option value="coachTokens">Coach tokens</option><option value="puzzles">Puzzles</option></select><button class="btn btn-secondary btn-small" data-admin-action="reset-usage" type="button">Reset usage</button><button class="btn btn-secondary btn-small" data-admin-action="force-username" type="button">Force username</button></div>
        <p class="account-status" data-feature-status role="status" aria-live="polite"></p>
      </section>
      <section class="admin-profile-section"><h4>Linked accounts &amp; automatic reviews</h4><dl class="admin-profile-fields">${rows({ ...linkedAccounts, automaticReviewStatus: automaticReviews.status, lastChecked: date(automaticReviews.lastCheckedAt) })}</dl></section>
      <details class="admin-profile-section" open><summary>Saved statistics</summary><dl class="admin-profile-fields">${rows(stored)}${rows(stats.storedStats)}</dl></details>
      <details class="admin-profile-section"><summary>Recorded activity</summary><p class="muted">Totals cover the usage records currently retained by the server.</p><dl class="admin-profile-fields">${rows(stats.recordedUsageTotals)}${rows({ serverSavedReviews: stats.savedReviews, anticheatReports: stats.anticheatReports, thisWeek: stats.thisWeek })}</dl>
        <div class="admin-usage-history">${stats.recentUsage.map(row => `<details><summary>${escape(row.date)}</summary><dl class="admin-profile-fields">${rows(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'date')))}</dl></details>`).join('') || '<p>No recorded usage.</p>'}</div></details>
      <section class="admin-profile-section"><h4>Administrator notes</h4><div class="admin-profile-notes">
        ${notes.map(note => `<article class="admin-profile-note" data-id="${escape(note.id)}"><p>${escape(note.text)}</p><span>${escape(note.author)} · ${escape(date(note.updatedAt || note.createdAt))}</span><div class="standalone-actions"><button class="btn btn-secondary btn-small" data-note-action="edit" type="button">Edit</button><button class="btn btn-secondary btn-small" data-note-action="remove" type="button">Remove</button></div></article>`).join('') || '<p class="muted">No administrator notes for this account.</p>'}
      </div><form id="admin-profile-note-form" class="admin-note-form"><label class="field"><span class="field-label">Add a note</span><textarea id="admin-profile-note" class="input-select" rows="2" maxlength="2000" required></textarea></label><button class="btn btn-secondary" type="submit">Save note</button></form></section>
      <details class="admin-profile-section"><summary>Recent reports &amp; moderation history (${reports.length})</summary><p class="muted">Latest 20 reports and moderation actions.</p>
        ${data.flags ? `<dl class="admin-profile-fields">${rows(data.flags)}</dl>` : '<p>No active account flags.</p>'}
        ${reports.map(report => `<article class="admin-profile-note"><strong>${escape(report.reason)}</strong><span>${report.dismissed ? 'Dismissed' : 'Open'} · ${escape(date(report.reportedAt))} · ${escape(report.reporterEmail)}</span><p>${escape(report.details)}</p></article>`).join('') || '<p>No reports recorded.</p>'}
        ${actions.map(action => `<p>${escape(action.action)} · ${escape(action.actor)} · ${escape(date(action.timestamp))}</p>`).join('')}
      </details>
    </article>`;
  $('admin-profile-manage').addEventListener('click', () => {
    for (const id of ['spa-gift-boost-email', 'spa-ban-user-email']) if ($(id)) $(id).value = account.email;
    $('admin-ban-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('admin-profile-result').querySelectorAll('[data-feature]').forEach(input => input.addEventListener('change', async () => {
    const statusNode = $('admin-profile-result').querySelector('[data-feature-status]');
    try {
      await adminAction({ action: 'set-feature', uid: account.uid, feature: input.dataset.feature, enabled: input.checked });
      input.dataset.override = String(input.checked); statusNode.textContent = 'Feature access updated.';
    } catch (error) { input.checked = input.dataset.override === 'true'; statusNode.textContent = error.message; statusNode.className = 'account-status error'; }
  }));
  $('admin-profile-result').querySelector('[data-admin-action="reset-usage"]').addEventListener('click', async () => {
    const statusNode = $('admin-profile-result').querySelector('[data-feature-status]');
    try { await adminAction({ action: 'reset-usage', uid: account.uid, feature: $('admin-profile-result').querySelector('[data-reset-feature]').value }); statusNode.textContent = 'Usage reset.'; }
    catch (error) { statusNode.textContent = error.message; statusNode.className = 'account-status error'; }
  });
  $('admin-profile-result').querySelector('[data-admin-action="force-username"]').addEventListener('click', async () => {
    const username = window.prompt('New username (3–40 letters, numbers, . _ -):', account.username || '');
    if (username === null) return;
    const statusNode = $('admin-profile-result').querySelector('[data-feature-status]');
    try { await adminAction({ action: 'force-username', uid: account.uid, username: username.trim() }); statusNode.textContent = 'Username changed.'; await lookup({ uid: account.uid }); }
    catch (error) { statusNode.textContent = error.message; statusNode.className = 'account-status error'; }
  });
  $('admin-profile-note-form').addEventListener('submit', event => {
    event.preventDefault(); saveNote('add', null, $('admin-profile-note').value);
  });
  $('admin-profile-result').querySelectorAll('[data-note-action]').forEach(button => button.addEventListener('click', () => {
    const id = button.closest('[data-id]').dataset.id, action = button.dataset.noteAction;
    const note = notes.find(item => item.id === id);
    const text = action === 'edit' ? window.prompt('Edit administrator note', note.text) : '';
    if (action === 'edit' && text === null) return;
    if (action === 'remove' && !window.confirm('Remove this administrator note?')) return;
    saveNote(action, id, text);
  }));
}
async function lookup(args) {
  if (!app?.authState?.isAdmin) return;
  controller?.abort(); controller = new AbortController();
  const current = controller;
  status('Looking up account…'); $('admin-profile-result').setAttribute('aria-busy', 'true');
  try {
    const response = await window.apiFetch(`/api/admin/profile?${new URLSearchParams(args)}`, {
      headers: await app._authHeaders({}), signal: current.signal, cache: 'no-store',
    });
    const data = await response.json();
    if (current !== controller || !app.authState.isAdmin) return;
    if (data.matches) {
      detail = null;
      $('admin-profile-result').innerHTML = data.matches.map(match => `<button class="btn btn-secondary" type="button" data-match="${escape(match.uid)}">${escape(match.username)} · ${escape(match.email)}</button>`).join('');
      $('admin-profile-result').querySelectorAll('[data-match]').forEach(button => button.addEventListener('click', () => lookup({ uid: button.dataset.match })));
      status(data.error); return;
    }
    if (!response.ok) throw new Error(data.error || 'Account lookup failed.');
    render(data.detail); status('Account loaded.');
  } catch (error) {
    if (current.signal.aborted) return;
    detail = null; $('admin-profile-result').replaceChildren(); status(error.message, true);
  } finally { if (current === controller) $('admin-profile-result').removeAttribute('aria-busy'); }
}
async function saveNote(action, noteId, text) {
  if (!detail || !app.authState.isAdmin) return;
  const uid = detail.account.uid;
  status('Saving note…');
  const button = $('admin-profile-note-form').querySelector('button'); button.disabled = true;
  try {
    const response = await window.apiFetch('/api/admin/abuse/notes', { method: 'POST', headers: await app._authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action, uid, noteId, text }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not save the note.');
    if (app.authState.isAdmin && detail?.account.uid === uid) await lookup({ uid });
  } catch (error) { if (app.authState.isAdmin) status(error.message, true); }
  finally { button.disabled = false; }
}
window.AdminProfileUI = { refresh(email) {
  if (detail && detail.account.email.toLowerCase() === String(email).toLowerCase()) return lookup({ uid: detail.account.uid });
}, onAuth(instance) {
  app = instance;
  const form = $('admin-profile-search');
  if (!form) return;
  if (!app?.authState?.isAdmin) {
    controller?.abort(); controller = null; detail = null;
    $('admin-profile-result').replaceChildren(); $('admin-profile-result').removeAttribute('aria-busy'); $('admin-profile-query').value = ''; status('');
    return;
  }
  if (!form.dataset.bound) {
    form.dataset.bound = '1'; form.addEventListener('submit', event => { event.preventDefault(); lookup({ query: $('admin-profile-query').value.trim() }); });
  }
  const fairPlayRefresh = $('admin-fair-play-refresh');
  if (fairPlayRefresh && !fairPlayRefresh.dataset.bound) {
    fairPlayRefresh.dataset.bound = '1'; fairPlayRefresh.addEventListener('click', loadFairPlayReviews);
  }
  const globalToggle = $('admin-global-background-review');
  if (globalToggle && !globalToggle.dataset.bound) {
    globalToggle.dataset.bound = '1';
    globalToggle.addEventListener('change', async () => {
      try {
        await adminAction({ action: 'set-global-feature', feature: 'reviewBackground', enabled: globalToggle.checked });
        $('admin-global-feature-status').textContent = globalToggle.checked ? 'Background reviews enabled site-wide.' : 'Background reviews disabled site-wide.';
      } catch (error) {
        globalToggle.checked = !globalToggle.checked;
        $('admin-global-feature-status').textContent = error.message;
        $('admin-global-feature-status').className = 'account-status error';
      }
    });
  }
} };
if (window.app?.authState) window.AdminProfileUI.onAuth(window.app);
