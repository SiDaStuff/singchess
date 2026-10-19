import { PlayApi } from './api.js';
import { TIME_CONTROLS, isFinished, gameId, reconstructGame, resultFor, completedPgn } from './state.js';
import { LiveGameInput } from './live-game-input.js';
import { PlayClockPair } from './clock.js';
import { loadPlayPreferences, savePlayPreferences } from './preferences.js';
import './play.css';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = name => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
const INITIAL = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const TERMINAL_EVENTS = new Set(['challengeCanceled', 'challengeDeclined']);

export class PlayExperience {
  constructor(app, root) {
    this.app = app; this.root = root; this.api = new PlayApi(app);
    this.preferences = loadPlayPreferences(); this.control = TIME_CONTROLS.find(c => c.time === 10 && !c.increment); this.rated = false;
    try { const saved = JSON.parse(localStorage.getItem('sing.play.setup') || '{}'); this.control = TIME_CONTROLS.find(c => c.time === saved.time && c.increment === saved.increment) || this.control; this.rated = saved.rated === true; } catch {}
    this.profile = null; this.reviewStats = null; this.activeGames = []; this.recentGames = []; this.connected = false; this.full = null; this.state = null; this.identity = ''; this.sessionVersion = 0; this.activityRevision = 0;
    this.gameController = null; this.eventController = null; this.seekController = null; this.pending = null; this.challenge = null; this.gameConnection = 'connecting'; this.refreshTask = null;
    this.mount();
    this.sounds = app.boardSounds; this.sounds.setPreferences(this.preferences);
    this.board = new LiveGameInput(new window.ChessBoard('play-chess-board'), { preferences: this.preferences, onMove: uci => this.sendMove(uci), onFeedback: text => this.message(text), onPremoveChange: move => { this.$('premove').hidden = !move; } });
    this.board.setPosition(INITIAL, { interactive: false, playerColor: 'white' });
    this.clocks = new PlayClockPair({ whiteElement: this.$('clock-white'), blackElement: this.$('clock-black'), onLowTime: color => { if (color === this.color) this.sounds.play('lowTime'); } });
    this.renderSetup();
    root.addEventListener('click', event => this.click(event));
    root.addEventListener('change', event => this.change(event));
    root.addEventListener('pointerdown', () => this.sounds.unlock(), { passive: true });
    root.addEventListener('keydown', () => this.sounds.unlock(), { passive: true });
    this.$('friend-form').addEventListener('submit', event => { event.preventDefault(); this.run(() => this.challengeFriend()); });
    window.addEventListener('linked-auth', () => this.authChanged());
    window.addEventListener('play:auth', () => { this.authChanged(); this.run(() => this.route()); });
    window.addEventListener('play:route', () => { this.authChanged(); this.run(() => this.route()); });
    window.addEventListener('app:route', event => {
      if (!event.detail?.route?.startsWith('/play')) {
        this.root.classList.remove('play-focus');
        // Keep one stream for a game that is still being played so clocks and
        // turn notifications stay current. Idle lobby streams can be released.
        if (!this.full || isFinished(this.state?.status)) this.closeStreams();
        else for (const key of ['eventController', 'seekController']) { this[key]?.abort(); this[key] = null; }
        this.eventReady = false;
      }
    });
    window.addEventListener('online', () => { this.reconnectNow(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.connected) { this.reconnectNow(); this.run(() => this.refresh()); } });
    this.refreshTimer = setInterval(() => { if (!document.hidden && this.connected && (!this.full || isFinished(this.state?.status))) this.run(() => this.refresh()); }, 60000);
    this.authChanged(); this.run(() => this.route());
    window.Play = this;
  }
  $(name) { return this.root.querySelector(`[data-play="${name}"]`); }
  mount() {
    this.root.innerHTML = `
      <div class="play-heading"><div><h1>Play <span class="beta-badge">BETA</span></h1></div><div class="play-heading-actions"><span class="play-provider">Via <a href="https://lichess.org" target="_blank" rel="noopener noreferrer">Lichess ↗</a></span><button type="button" class="icon-button btn-secondary" data-action="settings" aria-label="Game settings">${icon('tune')}</button></div></div>
      <div class="play-notice" data-play="notice" role="status" aria-live="polite" hidden></div>
      <div class="play-layout">
        <div class="play-arena">
          <div class="play-player" data-play="player-top"><span class="play-avatar">${icon('person')}</span><div><strong data-play="name-top">Opponent</strong><span data-play="detail-top">No active game</span></div><div class="play-clock" data-play="clock-black" aria-label="Black clock">10:00</div></div>
          <div class="board-wrapper"><div id="play-chess-board" data-play="board" class="chess-board"></div><div class="play-board-loading" data-play="board-loading" hidden><span class="spinner"></span><span>Connecting to your game…</span></div></div>
          <div class="play-player" data-play="player-bottom"><span class="play-avatar play-avatar-self">${icon('person')}</span><div><strong data-play="name-bottom">You</strong><span data-play="detail-bottom">Choose a time control</span></div><div class="play-clock" data-play="clock-white" aria-label="White clock">10:00</div></div>
          <div class="play-board-toolbar"><span class="play-connection" data-play="connection"><span class="status-dot"></span> Ready to play</span><div><button type="button" class="btn btn-ghost btn-small" data-action="cancel-premove" data-play="premove" hidden>Cancel premove</button><button type="button" class="icon-button btn-ghost" data-action="flip" aria-label="Flip board" title="Flip board">${icon('swap_vert')}</button><button type="button" class="icon-button btn-ghost" data-action="focus" aria-label="Toggle focus mode" title="Focus mode">${icon('fullscreen')}</button></div></div>
        </div>
        <aside class="play-side">
          <section class="play-setup card" data-play="lobby"><div class="play-section-head"><h2>New game</h2></div>
            <div data-play="account" class="play-account"></div>
            <fieldset class="play-time-controls"><legend>Time control</legend>${['Bullet', 'Blitz', 'Rapid', 'Classical'].map(group => `<div class="play-time-group"><span>${group}</span><div>${TIME_CONTROLS.filter(c => c.group === group).map(c => `<button type="button" data-control="${c.time}+${c.increment}" aria-pressed="false" ${c.mode === 'unavailable' ? 'disabled title="Bullet is unavailable"' : ''}>${c.time}<small> + ${c.increment}</small></button>`).join('')}</div></div>`).join('')}</fieldset>
            <p class="play-control-note" data-play="control-note"></p>
            <div class="play-rated" role="group" aria-label="Game type"><button type="button" data-rated="false">Casual</button><button type="button" data-rated="true">Rated</button></div>
            <button type="button" class="btn btn-primary play-start" data-play="start" data-action="start">${icon('play_arrow')} <span data-play="start-label">Find match</span><span data-play="start-control">10 + 0</span></button>
            <div class="play-search" data-play="search" hidden><span class="spinner"></span><div><strong data-play="search-title">Finding your game</strong><small data-play="search-detail"></small></div><button type="button" class="btn btn-ghost btn-small" data-action="cancel-search">Cancel</button></div>
            <details class="play-friend" data-play="friend"><summary>Challenge a friend</summary><form data-play="friend-form"><label class="field"><span class="field-label">Lichess username</span><input class="input-select" data-play="friend-name" autocomplete="off" maxlength="30" pattern="[A-Za-z0-9_-]{2,30}" placeholder="Your friend’s username" required></label><label class="field"><span class="field-label">Your pieces</span><select class="input-select" data-play="friend-color"><option value="random">Random</option><option value="white">White</option><option value="black">Black</option></select></label><button type="submit" class="btn btn-secondary" data-play="challenge-button">Send challenge</button></form><div data-play="outgoing" class="play-outgoing" hidden></div></details>
            <p class="play-small-note">Blitz supports friend challenges. Choose rapid or classical for matchmaking.</p>
          </section>
          <section class="play-live card" data-play="live" hidden><div class="play-section-head"><h2 data-play="live-title">Your game</h2><span class="play-live-pill" data-play="live-pill">LIVE</span></div><p class="play-game-caption" data-play="game-caption"></p><p class="play-turn" data-play="turn" role="status"></p><div class="play-material" data-play="material"></div><div class="play-moves" data-play="moves" aria-label="Game moves"></div><div class="play-draw-offer" data-play="draw-offer" hidden><strong>Your opponent offers a draw</strong><button type="button" class="btn btn-secondary btn-small" data-action="accept-draw">Accept</button><button type="button" class="btn btn-ghost btn-small" data-action="decline-draw">Decline</button></div><div data-play="game-actions" class="play-game-actions"><button type="button" class="btn btn-secondary btn-small" data-action="offer-draw">Offer draw</button><button type="button" class="btn btn-ghost btn-small" data-action="resign">Resign</button><button type="button" class="btn btn-ghost btn-small" data-play="abort-button" data-action="abort" hidden>Abort</button></div><div class="play-confirm" data-play="confirm" hidden><span data-play="confirm-text"></span><button type="button" class="btn btn-secondary btn-small" data-action="confirm-action">Confirm</button><button type="button" class="btn btn-ghost btn-small" data-action="dismiss-confirm">Cancel</button></div><p class="play-fairplay-note">${icon('shield')} Analysis becomes available after the game.</p><a href="/play" data-route="/play" class="btn-link" data-action="lobby">Back to Play</a></section>
          <section class="play-results card" data-play="results" hidden aria-live="polite"><span class="play-result-icon" data-play="result-icon">${icon('emoji_events')}</span><span class="eyebrow">GAME COMPLETE</span><h2 data-play="result-title"></h2><p data-play="result-reason"></p><div class="play-result-opponent" data-play="result-opponent"></div><div class="play-result-facts" data-play="result-facts"></div><button type="button" class="btn btn-primary play-review" data-action="review">${icon('analytics')} Review Game</button><button type="button" class="btn btn-secondary" data-action="again">${icon('replay')} Play Again</button><div class="play-result-links"><a data-play="lichess-link" target="_blank" rel="noopener noreferrer">View on Lichess ↗</a><button type="button" class="btn-link" data-action="download">Download PGN</button></div><button type="button" class="btn btn-ghost" data-action="lobby">Return to Play</button></section>
          <section class="play-invitations card" data-play="invitations" hidden><h3>Friend challenges</h3><div data-play="invitation-list"></div></section>
        </aside>
      </div>
      <div class="play-history" data-play="history"><section class="card play-active"><div class="card-header"><h2>Active games</h2><button type="button" class="btn-link" data-action="refresh">Refresh</button></div><div data-play="active-list"></div></section><section class="card play-recent"><div class="card-header"><h2>Recent games</h2></div><div data-play="recent-list"></div></section></div>
      <dialog class="play-settings" data-play="settings"><div class="card-header"><h2>Game settings</h2><button type="button" class="icon-button btn-ghost" data-action="close-settings" aria-label="Close settings">${icon('close')}</button></div><div data-play="settings-fields"></div><p class="play-small-note">Hold Shift when promoting to choose a piece with auto-queen enabled. Right-drag to draw an arrow; right-click to mark a square.</p></dialog>`;
    this.renderSetup(); this.renderAccount(); this.renderHistory();
  }
  message(text, error = false) {
    clearTimeout(this.noticeTimer);
    const el = this.$('notice'); el.textContent = text || ''; el.hidden = !text; el.classList.toggle('error', error);
    if (text) this.noticeTimer = setTimeout(() => { if (el.textContent === text) { el.textContent = ''; el.hidden = true; el.classList.remove('error'); } }, 8000);
  }
  async run(fn) { try { return await fn(); } catch (error) { if (error.name !== 'AbortError') this.message(error.message, true); } }
  async route() {
    if (!location.pathname.startsWith('/play')) return;
    this.preferences = loadPlayPreferences();
    this.board.setPreferences(this.preferences);
    this.sounds.setPreferences(this.preferences);
    this.board.renderer._updatePieces();
    const query = new URLSearchParams(location.search);
    if (location.pathname === '/play/callback' || window.__PLAY_OAUTH_CALLBACK) {
      const callback = window.__PLAY_OAUTH_CALLBACK || Object.fromEntries(query);
      if (!this.app.authState.initialized) return;
      if (!this.app.authState.user) { this.message('Sign in to the Sing Chess account you used to connect, then return to this page.', true); return; }
      if (callback.error) { delete window.__PLAY_OAUTH_CALLBACK; history.replaceState({}, '', '/play'); this.message('Lichess connection was cancelled. You can connect again at any time.'); return; }
      const { code, state } = callback;
      if (code && state && !this.callbackPending) {
        this.callbackPending = true; this.message('Finishing your Lichess connection…');
        try { await this.api.post('/oauth/callback', { code, state }); history.replaceState({}, '', '/play'); this.message('Lichess account connected.'); await this.refresh(); }
        catch (error) { history.replaceState({}, '', '/play'); throw error; }
        finally { delete window.__PLAY_OAUTH_CALLBACK; this.callbackPending = false; }
      }
    } else if (this.app.authState.user) await this.refresh();
    const resume = query.get('game');
    if (resume && /^[A-Za-z0-9]{8}$/.test(resume) && this.connected) await this.resume(resume);
    else if (this.full && !isFinished(this.state?.status) && this.connected && !this.gameController) await this.resume(this.full.id);
  }
  authChanged() {
    const next = this.app.authState.user?.uid || '';
    if (next === this.identity) { this.renderAccount(); return; }
    this.identity = next; this.sessionVersion++; this.closeStreams(); this.refreshTask = null; this.profile = null; this.connected = false; this.activeGames = []; this.recentGames = []; this.full = null; this.state = null; this.pending = null; this.completionData = {};
    this.board?.setPosition(INITIAL, { interactive: false, playerColor: 'white' }); this.clocks?.stop(); this.eventReady = false; this.showLobby(); this.renderAccount(); this.renderHistory();
    if (next && location.pathname.startsWith('/play')) this.run(() => this.route());
  }
  async refresh() {
    if (!this.app.authState.user) return;
    if (this.refreshTask) return this.refreshTask;
    const version = this.sessionVersion, activity = this.activityRevision;
    this.refreshTask = (async () => {
      const data = await this.api.request('/status'); if (version !== this.sessionVersion) return;
      this.configured = data.configured; this.connected = data.connected; this.profile = data.profile; this.reviewStats = data.reviewStats || null;
      this.recentGames = data.recentGames || [];
      if (activity === this.activityRevision) {
        this.activeGames = data.activeGames || [];
        window.PlayFairPlay?.observeStatus?.(data);
        if (!window.PlayFairPlay?.observeStatus) window.PlayFairPlay?.setActiveGames(this.activeGames);
      }
      this.renderAccount(); this.renderHistory();
      if (data.connected && location.pathname.startsWith('/play') && !this.eventController) this.listenEvents();
      if (!data.connected) { this.eventController?.abort(); this.eventController = null; }
    })().catch(error => {
      if (version === this.sessionVersion && [401, 403].includes(error.status)) {
        this.connected = false; this.eventController?.abort(); this.eventController = null; this.eventReady = false; this.gameConnection = 'disconnected';
        if (this.full && !isFinished(this.state?.status)) { this.board.setPosition(this.position.chess.fen(), { interactive: false, pending: true }); this.updateConnection(); }
        this.renderAccount();
      }
      throw error;
    }).finally(() => { if (version === this.sessionVersion) this.refreshTask = null; });
    return this.refreshTask;
  }
  renderAccount() {
    const el = this.$('account');
    if (!this.app.authState.user) el.innerHTML = `<div><strong>Sign in required</strong><p>Sign in before connecting Lichess.</p></div><a class="btn btn-secondary btn-small" href="/login" data-route="/login">Sign in</a>`;
    else if (!this.connected) el.innerHTML = `<div><strong>Lichess is not connected</strong><p>Connect your account to play online.</p></div><button type="button" class="btn btn-secondary btn-small" data-action="connect">Connect Lichess</button>`;
    else {
      const p = this.profile || {}, perfs = p.perfs || {}, stats = this.reviewStats || {};
      el.innerHTML = `<div class="play-account-top"><span class="play-avatar play-avatar-self">${icon('person')}</span><div><a href="https://lichess.org/@/${encodeURIComponent(p.username || p.id || '')}" target="_blank" rel="noopener noreferrer"><strong>${escape(p.title ? `${p.title} ` : '')}${escape(p.username || p.id)}</strong> ↗</a><small><span class="status-dot"></span> Connected</small></div><button type="button" class="btn-link" data-action="disconnect">Disconnect</button></div><div class="play-ratings">${['bullet', 'blitz', 'rapid', 'classical'].map(key => `<span>${key}<strong>${perfs[key]?.games ? `${escape(perfs[key].rating)}${perfs[key].prov ? '?' : ''}` : '—'}</strong></span>`).join('')}</div>${p.count?.all != null ? `<p class="play-profile-stat">${Number(p.count.all).toLocaleString()} games · ${Number(p.count.win || 0).toLocaleString()} wins</p>` : ''}`;
      const ratings = Object.entries(perfs).filter(([, perf]) => Number.isFinite(Number(perf?.rating)))
        .sort((a, b) => Number(b[1].games || 0) - Number(a[1].games || 0));
      const ratingGrid = el.querySelector('.play-ratings');
      if (ratingGrid) ratingGrid.innerHTML = ratings.map(([key, perf]) => `<span>${escape(key)}<strong>${escape(perf.rating)}${perf.prov ? '?' : ''}</strong><small>${Number(perf.games || 0).toLocaleString()} games</small></span>`).join('');
      el.querySelector('.play-profile-stat')?.remove();
      const seconds = Number(p.playTime?.total || 0);
      el.insertAdjacentHTML('beforeend', `${p.count ? `<div class="play-profile-stats"><span><strong>${Number(p.count.all || 0).toLocaleString()}</strong> games</span><span><strong>${Number(p.count.win || 0).toLocaleString()}</strong> wins</span><span><strong>${Number(p.count.loss || 0).toLocaleString()}</strong> losses</span><span><strong>${Number(p.count.draw || 0).toLocaleString()}</strong> draws</span>${seconds ? `<span><strong>${Math.round(seconds / 3600).toLocaleString()}</strong> hours</span>` : ''}</div>` : ''}${stats.gamesReviewed ? `<div class="play-profile-stats play-review-stats"><span><strong>${Number(stats.brilliant || 0).toLocaleString()}</strong> brilliant</span><span><strong>${Number(stats.great || 0).toLocaleString()}</strong> great</span><span><strong>${Number(stats.best || 0).toLocaleString()}</strong> best</span><span><strong>${Number(stats.movesReviewed || 0).toLocaleString()}</strong> reviewed moves</span></div>` : ''}`);
    }
    this.renderSetup();
  }
  renderSetup() {
    if (!this.$('start')) return;
    for (const el of this.root.querySelectorAll('[data-control]')) el.setAttribute('aria-pressed', String(el.dataset.control === `${this.control.time}+${this.control.increment}`));
    for (const el of this.root.querySelectorAll('[data-rated]')) el.setAttribute('aria-pressed', String(el.dataset.rated === String(this.rated)));
    this.$('control-note').textContent = this.control.mode === 'challenge' ? 'Blitz is available through a friend challenge.' : `${this.control.group} · ${this.control.time} minutes${this.control.increment ? ` + ${this.control.increment} seconds per move` : ' per side'}`;
    this.$('start-control').textContent = `${this.control.time} + ${this.control.increment}`;
    this.$('start-label').textContent = this.control.mode === 'challenge' ? 'Challenge a friend' : 'Find match';
    this.$('start').disabled = Boolean(this.seekController || this.challenge || this.control.mode === 'unavailable');
    this.$('challenge-button').disabled = Boolean(!this.connected || this.seekController || this.challenge || this.control.mode === 'unavailable');
    if (!this.full || isFinished(this.state?.status) && !this.$('lobby').hidden) this.clocks?.sync({ white: this.control.time * 60000, black: this.control.time * 60000, running: null });
  }
  renderHistory() {
    this.$('active-list').innerHTML = this.activeGames.length ? this.activeGames.map(game => `<button type="button" class="play-game-row" data-resume="${escape(gameId(game))}"><span class="play-active-dot"></span><span><strong>vs ${escape(game.opponent?.username || game.opponent?.name || 'Opponent')}</strong><small>${escape(game.speed || game.perf || 'Online game')} · ${game.isMyTurn ? 'Your move' : 'In progress'}</small></span><span class="play-resume-label">Resume ${icon('arrow_forward')}</span></button>`).join('') : `<p class="play-empty">${this.connected ? 'No active games.' : 'Connect Lichess to view active games.'}</p>`;
    const records = this.recentGames.length ? this.recentGames : this.savedGames();
    this.$('recent-list').innerHTML = records.length ? records.slice(0, 8).map(game => {
      const white = game.players?.white || game.white, black = game.players?.black || game.black;
      const whiteName = white?.user?.name || white?.name || white?.username || (typeof white === 'string' ? white : 'White');
      const blackName = black?.user?.name || black?.name || black?.username || (typeof black === 'string' ? black : 'Black');
      const isWhite = game.playerColor ? game.playerColor === 'white' : (white?.user?.id || white?.id || whiteName).toLowerCase() === (this.profile?.id || this.profile?.username || '').toLowerCase();
      const title = `vs ${isWhite ? blackName : whiteName}`;
      const status = game.status || game.state?.status;
      const result = game.winner ? game.winner === (isWhite ? 'white' : 'black') ? 'Won' : 'Lost' : ['aborted', 'noStart'].includes(status) ? 'Ended' : 'Draw';
      return `<button type="button" class="play-game-row" data-review-game="${escape(gameId(game))}"><span class="play-history-result ${result.toLowerCase()}">${result === 'Won' ? '+' : result === 'Lost' ? '−' : '='}</span><span><strong>${escape(title)}</strong><small>${escape(game.speed || game.perf || 'Chess')} · ${escape(result)}</small></span><span class="play-review-label">Review ${icon('arrow_forward')}</span></button>`;
    }).join('') : `<p class="play-empty">${this.connected ? 'No completed games yet. Start a game above.' : 'Connect Lichess to load recent games.'}</p>`;
  }
  saveSetup() { try { localStorage.setItem('sing.play.setup', JSON.stringify({ time: this.control.time, increment: this.control.increment, rated: this.rated })); } catch {} }
  async click(event) {
    const control = event.target.closest('[data-control]');
    if (control && !control.disabled && !this.seekController && !this.challenge) { this.control = TIME_CONTROLS.find(c => `${c.time}+${c.increment}` === control.dataset.control); this.saveSetup(); this.renderSetup(); return; }
    const rated = event.target.closest('[data-rated]');
    if (rated && !this.seekController && !this.challenge) { this.rated = rated.dataset.rated === 'true'; this.saveSetup(); this.renderSetup(); return; }
    const resume = event.target.closest('[data-resume]'); if (resume) return this.run(() => this.resume(resume.dataset.resume));
    const recent = event.target.closest('[data-review-game]'); if (recent) return this.run(() => this.review(recent.dataset.reviewGame));
    const invitation = event.target.closest('[data-invitation]'); if (invitation) return this.run(async () => { await this.api.post(`/challenge/${encodeURIComponent(invitation.dataset.invitation)}/${invitation.dataset.response}`); invitation.closest('.play-invitation')?.remove(); });
    const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
    if (button.dataset.action === 'lobby') event.preventDefault();
    await this.run(async () => {
      switch (button.dataset.action) {
        case 'connect': {
          if (!this.app.authState.user) return this.app._navigateTo('/login');
          button.disabled = true;
          try { const { url } = await this.api.post('/oauth/start'); const parsed = new URL(url); if (parsed.origin !== 'https://lichess.org' || parsed.pathname !== '/oauth') throw new Error('Invalid authorization URL.'); location.assign(url); } finally { button.disabled = false; } break;
        }
        case 'disconnect': if (this.activeGames.length || (this.full && !isFinished(this.state?.status))) { this.message('Finish your active game before disconnecting.'); break; } await this.api.post('/disconnect'); this.closeStreams(); this.connected = false; this.profile = null; this.renderAccount(); this.run(() => this.refresh()); break;
        case 'start': await this.start(); break;
        case 'cancel-search': await this.cancelSearch(); break;
        case 'refresh': await this.refresh(); break;
        case 'flip': this.board.flip(); this.updatePlayers(); break;
        case 'focus': this.root.classList.toggle('play-focus'); document.body.classList.toggle('play-focus-mode', this.root.classList.contains('play-focus')); break;
        case 'cancel-premove': this.board.cancelPremove(); break;
        case 'settings': this.renderSettings(); this.$('settings').showModal(); break;
        case 'close-settings': this.$('settings').close(); break;
        case 'resign': case 'abort': case 'offer-draw': this.confirmAction = button.dataset.action === 'offer-draw' ? 'draw-yes' : button.dataset.action; this.$('confirm-text').textContent = { resign: 'Resign this game?', abort: 'Abort this game?', 'draw-yes': 'Offer a draw?' }[this.confirmAction]; this.$('confirm').hidden = false; break;
        case 'dismiss-confirm': this.$('confirm').hidden = true; this.confirmAction = null; break;
        case 'confirm-action': { const action = this.confirmAction; this.confirmAction = null; this.$('confirm').hidden = true; if (action) { await this.gameAction(action); this.message(action === 'draw-yes' ? 'Draw offered.' : 'Waiting for the game to update…'); } break; }
        case 'accept-draw': await this.gameAction('draw-yes'); break;
        case 'decline-draw': await this.gameAction('draw-no'); this.$('draw-offer').hidden = true; break;
        case 'review': await this.review(this.full.id); break;
        case 'download': this.downloadPgn(); break;
        case 'again': {
          if (this.full?.clock) { const time = this.full.clock.initial / 60000, increment = this.full.clock.increment / 1000; this.control = TIME_CONTROLS.find(c => c.time === time && c.increment === increment) || this.control; this.rated = Boolean(this.full.rated); }
          const mode = this.control.mode; this.showLobby(); this.full = null; this.state = null; this.renderSetup(); await this.refresh(); if (mode === 'seek') await this.start(); else { this.$('friend').open = true; this.message('Choose a friend to play this blitz time control again.'); } break;
        }
        case 'lobby': this.showLobby(); this.run(() => this.refresh()); break;
      }
    });
  }
  async start() {
    if (!this.app.authState.user) return this.app._navigateTo('/login');
    if (!this.connected) { this.message('Connect your Lichess account to start playing.'); this.$('account').querySelector('button')?.focus(); return; }
    if (this.activeGames.length) return this.resume(gameId(this.activeGames[0]));
    if (this.control.mode === 'challenge') { this.$('friend').open = true; this.$('friend-name').focus(); return; }
    if (this.control.mode !== 'seek' || this.seekController || this.challenge) return;
    if (this.startPending) return;
    this.startPending = true;
    try { await this.waitForEvents(); } finally { this.startPending = false; }
    if (this.seekController || this.activeGames.length) return;
    const controller = new AbortController(); this.seekController = controller; this.message('');
    this.$('search').hidden = false; this.$('search-title').textContent = 'Finding your game'; this.$('search-detail').textContent = `${this.control.time} + ${this.control.increment} · ${this.rated ? 'Rated' : 'Casual'} ${this.control.group}`; this.renderSetup();
    try {
      await this.api.stream('/seek', event => { if (event.type === 'error' || event.error) throw new Error(event.error || 'Matchmaking stopped. Please try again.'); if (event.game) this.handleEvent({ type: 'gameStart', game: event.game }); }, { signal: controller.signal, body: { time: this.control.time, increment: this.control.increment, rated: this.rated, color: 'random' } });
      if (!controller.signal.aborted && !this.full) { await this.refresh(); if (this.activeGames.length) await this.resume(gameId(this.activeGames[0])); else this.message('The search ended. You can search again.'); }
    } finally { if (this.seekController === controller) { this.seekController = null; this.$('search').hidden = true; this.renderSetup(); } }
  }
  async cancelSearch() {
    this.seekController?.abort(); this.seekController = null;
    if (this.challenge) { const id = this.challenge.id; await this.api.post(`/challenge/${encodeURIComponent(id)}/cancel`); this.challenge = null; }
    this.$('search').hidden = true; this.$('outgoing').hidden = true; this.renderSetup(); this.message('Search cancelled.');
  }
  async challengeFriend() {
    if (!this.connected || this.seekController || this.challenge) return;
    const username = this.$('friend-name').value.trim(); if (!/^[A-Za-z0-9_-]{2,30}$/.test(username)) throw new Error('Enter a valid Lichess username.');
    this.$('challenge-button').disabled = true;
    try { const result = await this.api.post('/challenge', { username, time: this.control.time, increment: this.control.increment, rated: this.rated, color: this.$('friend-color').value }); this.challenge = result.challenge || result; this.$('outgoing').hidden = false; this.$('outgoing').innerHTML = `<p>Challenge sent to <strong>${escape(username)}</strong>.</p><button type="button" class="btn-link" data-action="cancel-search">Cancel challenge</button>`; } finally { this.renderSetup(); }
  }
  async listenEvents() {
    const controller = new AbortController(); this.eventController = controller; let delay = 1000;
    while (!controller.signal.aborted && this.connected) {
      try { await this.api.stream('/events', event => { if (!controller.signal.aborted && this.eventController === controller) this.handleEvent(event); }, { signal: controller.signal }); delay = 1000; }
      catch (error) { if (controller.signal.aborted) break; if ([401, 403].includes(error.status)) { this.message('Your account connection expired. Connect Lichess again to continue.', true); this.connected = false; this.renderAccount(); break; } delay = error.status === 429 ? Math.max(60000, error.retryAfter * 1000) : Math.min(delay * 2, 30000); }
      if (this.eventController === controller) this.eventReady = false;
      if (!controller.signal.aborted) await this.delay(delay, controller.signal);
    }
    if (this.eventController === controller) this.eventController = null;
  }
  handleEvent(event) {
    if (event.type === 'connection') {
      this.eventReady = event.status === 'connected';
      if (this.eventReady) { for (const resolve of this.eventWaiters || []) resolve(); this.eventWaiters?.clear(); }
    } else if (event.type === 'error') {
      const error = new Error(event.error || 'The online connection was interrupted.');
      error.status = event.code === 'play_authorization_expired' ? 401 : undefined;
      throw error;
    } else if (event.type === 'gameStart') {
      const game = event.game; if (!gameId(game)) return;
      this.activityRevision++;
      this.activeGames = [...this.activeGames.filter(g => gameId(g) !== gameId(game)), game]; window.PlayFairPlay?.setActiveGames(this.activeGames); this.renderHistory();
      if (!this.full || isFinished(this.state?.status) || this.$('lobby').hidden === false) this.run(() => this.resume(gameId(game)));
    } else if (event.type === 'gameFinish') {
      // Only a terminal game stream or authoritative status snapshot releases the guard.
      this.run(async () => { await this.refresh(); if (this.full?.id === gameId(event.game) && !isFinished(this.state?.status)) this.reconnectNow(); });
    } else if (event.type === 'challenge' && event.challenge?.challenger?.id !== this.profile?.id) {
      const c = event.challenge, clock = c.timeControl;
      if (c.variant?.key && c.variant.key !== 'standard') return;
      if (c.speed === 'bullet' || c.speed === 'ultraBullet' || !clock?.limit) return;
      this.$('invitations').hidden = false;
      if (this.root.querySelector(`[data-challenge-id="${CSS.escape(c.id)}"]`)) return;
      this.$('invitation-list').insertAdjacentHTML('beforeend', `<div class="play-invitation" data-challenge-id="${escape(c.id)}"><p><strong>${escape(c.challenger?.name || c.challenger?.id)}</strong> · ${Math.round(clock.limit / 60)} + ${Number(clock.increment || 0)} · ${c.rated ? 'Rated' : 'Casual'}</p><button type="button" class="btn btn-primary btn-small" data-invitation="${escape(c.id)}" data-response="accept">Accept</button><button type="button" class="btn btn-ghost btn-small" data-invitation="${escape(c.id)}" data-response="decline">Decline</button></div>`);
    } else if (TERMINAL_EVENTS.has(event.type)) {
      const id = event.challenge?.id; if (id) this.root.querySelector(`[data-challenge-id="${CSS.escape(id)}"]`)?.remove();
      if (id && id === this.challenge?.id) { this.challenge = null; this.$('outgoing').hidden = true; this.renderSetup(); this.message(event.type === 'challengeDeclined' ? 'Your friend declined the challenge.' : 'Challenge cancelled.'); }
    }
  }
  async resume(id) {
    if (!/^[A-Za-z0-9]{8}$/.test(id || '')) throw new Error('Invalid game.');
    if (this.full?.id === id && this.gameController && !this.gameController.signal.aborted) { isFinished(this.state?.status) ? this.renderResult() : this.showGame(); return; }
    const preserve = this.full?.id === id && Boolean(this.position);
    this.gameController?.abort(); this.seekController?.abort(); this.seekController = null; this.challenge = null; this.pending = null;
    clearTimeout(this.pendingTimer);
    this.gameConnection = preserve ? 'reconnecting' : 'connecting';
    if (preserve) this.board.setPosition(this.position.chess.fen(), { lastMove: this.position.lastMove, playerColor: this.color, interactive: false, pending: true });
    else { this.full = null; this.state = null; this.position = null; this.board.setPosition(INITIAL, { interactive: false }); this.clocks.stop(); this.$('moves').replaceChildren(); }
    this.$('board-loading').hidden = preserve; this.$('turn').textContent = preserve ? 'Reconnecting…' : 'Connecting…'; this.$('search').hidden = true; this.$('outgoing').hidden = true;
    if (preserve && isFinished(this.state?.status)) this.renderResult(); else this.showGame();
    this.updateConnection();
    const controller = new AbortController(); this.gameController = controller; this.currentGameId = id; let delay = 1000;
    this.run(async () => {
      try { while (!controller.signal.aborted && this.gameController === controller) {
        try {
          await this.api.stream(`/game/${id}/stream`, event => {
            if (controller.signal.aborted || this.gameController !== controller) return;
            if (event.type === 'gameFull') {
              this.board.restoreAuthoritative?.();
              if (event.variant?.key && event.variant.key !== 'standard') { const error = new Error('This game uses a variant. Continue it on Lichess.'); error.status = 400; throw error; }
              const firstPosition = this.full?.id !== id;
              this.full = event; this.full.id = id; this.color = event.white?.id?.toLowerCase() === this.profile?.id?.toLowerCase() ? 'white' : 'black';
              if (firstPosition) this.board.setOrientation(this.color);
              this.gameConnection = 'connected'; this.applyState(event.state);
            }
            else if (event.type === 'gameState' && this.full) { this.gameConnection = 'connected'; this.applyState(event); }
            else if (event.type === 'connection') { this.gameConnection = event.status; this.updateConnection(); }
            else if (event.type === 'error') {
              const error = new Error(event.error || 'The game connection was interrupted.'); error.code = event.code;
              // The backend closes its hub for these provider errors. Keep the
              // position visible and let the player reconnect explicitly.
              error.status = event.code === 'play_authorization_expired' ? 401 : event.code === 'play_action_forbidden' ? 403 : 400;
              throw error;
            }
          }, { signal: controller.signal });
          if (controller.signal.aborted || this.gameController !== controller) break;
          if (isFinished(this.state?.status)) break; delay = 1000;
        } catch (error) {
          if (controller.signal.aborted || this.gameController !== controller) break;
          if ([400, 401, 403, 404, 409].includes(error.status)) { this.message([401, 403].includes(error.status) ? 'Reconnect your Lichess account to resume this game.' : error.message || 'This game is unavailable. Refresh your active games.', true); this.gameConnection = 'disconnected'; this.updateConnection(); this.$('board-loading').hidden = true; break; }
          delay = error.status === 429 ? Math.max(60000, error.retryAfter * 1000) : Math.min(delay * 2, 30000);
        }
        if (!controller.signal.aborted && this.gameController === controller) { this.gameConnection = 'reconnecting'; this.board.setPending(true); this.updateConnection(); await this.delay(delay, controller.signal); }
      } } finally { if (this.gameController === controller) this.gameController = null; }
    });
  }
  applyState(state) {
    const previous = this.state, previousPly = this.position?.ply;
    if (previous && ['moves', 'status', 'winner', 'wtime', 'btime', 'wdraw', 'bdraw'].every(key => previous[key] === state[key])) { this.$('board-loading').hidden = true; this.updateConnection(); return; }
    const position = reconstructGame(this.full, state); this.state = state; this.position = position;
    if (this.pending && (position.ply > this.pending.ply || isFinished(state.status))) { this.pending = null; clearTimeout(this.pendingTimer); }
    this.$('board-loading').hidden = true;
    const finished = isFinished(state.status);
    if (!finished && !this.activeGames.some(g => gameId(g) === this.full.id)) { this.activityRevision++; this.activeGames.push({ gameId: this.full.id, color: this.color, opponent: this.full[this.color === 'white' ? 'black' : 'white'] }); window.PlayFairPlay?.setActiveGames(this.activeGames); }
    this.board.setPosition(position.chess.fen(), { lastMove: position.lastMove, playerColor: this.color, interactive: !finished && this.gameConnection === 'connected', pending: Boolean(this.pending) });
    this.clocks.sync({ white: state.wtime, black: state.btime, running: !finished && position.ply >= 2 ? position.chess.turn() === 'w' ? 'white' : 'black' : null });
    if (previous && position.ply > previousPly && !finished) { const move = position.moves.at(-1); this.sounds.play(move.promotion ? 'promotion' : position.chess.in_check() ? 'check' : /[kq]/.test(move.flags) ? 'castle' : move.captured ? 'capture' : 'move'); }
    else if (!previous && !finished) { this.sounds.play('start'); this.message(''); }
    this.updatePlayers(); this.updateConnection(); if (previous?.moves !== state.moves) this.renderMoves();
    this.$('game-caption').textContent = `${this.full.clock ? `${Math.round(this.full.clock.initial / 60000)} + ${Math.round(this.full.clock.increment / 1000)}` : 'Chess'} · ${this.full.rated ? 'Rated' : 'Casual'} · ${this.full.perf?.name || this.full.speed || 'Standard'}`;
    this.$('turn').textContent = finished ? resultFor(this.full, state, this.color).reason : position.chess.turn() === this.color[0] ? 'Your move' : 'Opponent’s move';
    this.$('game-actions').hidden = finished; this.$('abort-button').hidden = position.ply >= 2; this.$('draw-offer').hidden = finished || !state[this.color === 'white' ? 'bdraw' : 'wdraw'];
    if (finished) {
      const wasFinished = isFinished(previous?.status);
      this.activityRevision++; this.activeGames = this.activeGames.filter(g => gameId(g) !== this.full.id); window.PlayFairPlay?.setActiveGames(this.activeGames);
      this.board.cancelPremove(); this.$('confirm').hidden = true;
      if (!wasFinished) { this.sounds.play('end'); this.cacheGame(); this.run(() => this.enrichResult(this.full.id)); }
      this.renderResult(); this.run(() => this.refresh());
    }
  }
  updatePlayers() {
    if (!this.full) return;
    const flipped = this.board.orientation === 'black' || this.board.orientation === 'b';
    const bottom = flipped ? 'black' : 'white', top = bottom === 'white' ? 'black' : 'white';
    for (const [place, color] of [['top', top], ['bottom', bottom]]) {
      const player = this.full[color] || {};
      this.$(`name-${place}`).textContent = `${player.title ? `${player.title} ` : ''}${player.name || player.id || color}${color === this.color ? ' (you)' : ''}`;
      this.$(`detail-${place}`).textContent = `${player.rating || 'Unrated'}${player.provisional ? '?' : ''} · ${color === 'white' ? 'White' : 'Black'}`;
      this.$(`player-${place}`).append(this.$(`clock-${color}`));
    }
  }
  updateConnection() {
    const el = this.$('connection'), connected = this.gameConnection === 'connected';
    el.innerHTML = `<span class="status-dot ${connected ? '' : 'play-dot-offline'}"></span> ${isFinished(this.state?.status) ? 'Game complete' : connected ? 'Connected' : this.gameConnection === 'connecting' ? 'Connecting…' : this.gameConnection === 'disconnected' ? 'Disconnected · resume to reconnect' : 'Reconnecting…'}`;
    if (this.full && !isFinished(this.state?.status)) this.board.setPosition(this.position.chess.fen(), { playerColor: this.color, lastMove: this.position.lastMove, interactive: connected, pending: Boolean(this.pending) || !connected });
  }
  renderMoves() {
    const moves = this.position.moves;
    this.$('moves').innerHTML = moves.map((move, i) => `${i % 2 === 0 ? `<span class="play-move-number">${Math.floor(i / 2) + 1}.</span>` : ''}<span class="play-move ${i === moves.length - 1 ? 'is-last' : ''}">${escape(move.san)}</span>`).join('');
    this.$('moves').scrollTop = this.$('moves').scrollHeight;
    const totals = { w: 0, b: 0 }, values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    for (const row of this.position.chess.board()) for (const piece of row) if (piece) totals[piece.color] += values[piece.type];
    const diff = totals.w - totals.b;
    this.$('material').textContent = diff ? `${diff > 0 ? 'White' : 'Black'} +${Math.abs(diff)} material` : 'Material is equal';
  }
  async sendMove(move) {
    if (!this.full || this.pending || isFinished(this.state?.status) || this.gameConnection !== 'connected') { this.board.setPending(Boolean(this.pending)); return; }
    const id = this.full.id, ply = this.position.ply, token = { move, ply }; this.pending = token;
    this.board.showOptimisticMove(move); this.board.setPending(true); this.$('turn').textContent = 'Opponent’s move';
    try {
      await this.api.post(`/game/${id}/move`, { move, ply });
      if (this.pending === token) this.pendingTimer = setTimeout(() => { if (this.pending === token) { this.message('Confirming your move…'); this.gameController?.abort(); this.gameController = null; this.run(() => this.resume(id)); } }, 7000);
    } catch (error) {
      if (this.pending !== token || this.full?.id !== id) return;
      // A network failure may follow an accepted move. Fetch a fresh full state before another submission.
      this.message(error.message, true); this.pending = null; this.board.restoreAuthoritative(); this.gameController?.abort(); this.gameController = null; await this.resume(id);
    }
  }
  async gameAction(action) { if (!this.full || isFinished(this.state?.status)) return; await this.api.post(`/game/${this.full.id}/action`, { action }); }
  renderResult() {
    const firstDisplay = this.$('results').hidden;
    const result = resultFor(this.full, this.state, this.color), opponent = this.full[this.color === 'white' ? 'black' : 'white'];
    this.$('live').hidden = true; this.$('lobby').hidden = true; this.$('results').hidden = false; this.$('history').hidden = true; this.root.classList.add('play-has-result');
    this.$('result-title').textContent = result.outcome; this.$('result-reason').textContent = result.reason;
    this.$('result-icon').innerHTML = icon(result.outcome === 'Victory' ? 'emoji_events' : result.outcome === 'Draw' ? 'handshake' : 'sports_score');
    this.$('result-opponent').textContent = `vs ${opponent?.name || opponent?.id || 'Opponent'}${opponent?.rating ? ` · ${opponent.rating}` : ''}`;
    const game = this.completionData?.[this.full.id]?.game, ratingDiff = game?.players?.[this.color]?.ratingDiff;
    const duration = game?.lastMoveAt && game?.createdAt ? Math.max(0, Math.round((game.lastMoveAt - game.createdAt) / 60000)) : null;
    this.$('result-facts').textContent = `${this.$('game-caption').textContent}${Number.isFinite(ratingDiff) ? ` · ${ratingDiff > 0 ? '+' : ''}${ratingDiff} rating` : ''}${duration !== null ? ` · ${duration < 1 ? 'Under 1 min' : `${duration} min`}` : ''}`;
    this.$('lichess-link').href = `https://lichess.org/${this.full.id}`;
    if (firstDisplay && window.matchMedia('(max-width: 740px)').matches) requestAnimationFrame(() => this.$('results').scrollIntoView({ block: 'nearest', behavior: 'instant' }));
  }
  showGame() { this.$('lobby').hidden = true; this.$('live').hidden = false; this.$('results').hidden = true; this.$('history').hidden = true; this.root.classList.add('play-in-game'); this.root.classList.remove('play-has-result'); }
  showLobby() {
    this.$('lobby').hidden = false; this.$('live').hidden = true; this.$('results').hidden = true; this.$('history').hidden = false; this.root.classList.remove('play-in-game', 'play-has-result');
    if (!this.full || isFinished(this.state?.status)) { this.gameController?.abort(); this.gameController = null; this.clocks?.stop(); this.board?.setPosition(INITIAL, { interactive: false }); this.$('name-top').textContent = 'Opponent'; this.$('detail-top').textContent = 'No active game'; this.$('name-bottom').textContent = this.profile?.username || 'You'; this.$('detail-bottom').textContent = 'Choose a time control'; this.$('connection').innerHTML = '<span class="status-dot"></span> Ready'; }
    this.renderSetup();
  }
  savedGames() { try { return JSON.parse(localStorage.getItem(`sing.play.games.${this.identity}`) || '[]'); } catch { return []; } }
  cacheGame() {
    try { const records = this.savedGames().filter(game => game.id !== this.full.id); records.unshift({ ...this.full, playerColor: this.color, state: this.state, status: this.state.status, winner: this.state.winner, pgn: completedPgn(this.full, this.state), savedAt: Date.now() }); localStorage.setItem(`sing.play.games.${this.identity}`, JSON.stringify(records.slice(0, 20))); } catch {}
  }
  async enrichResult(id) {
    const identity = this.identity;
    const data = await this.api.request(`/game/${id}/pgn`);
    if (identity !== this.identity) return;
    this.completionData ||= {}; this.completionData[id] = data;
    try {
      const records = this.savedGames(), record = records.find(game => game.id === id);
      if (record && data.pgn) { record.pgn = data.pgn; record.export = data.game; localStorage.setItem(`sing.play.games.${identity}`, JSON.stringify(records)); }
    } catch {}
    if (this.full?.id === id && isFinished(this.state?.status) && !this.$('results').hidden) this.renderResult();
  }
  async review(id) {
    let pgn, orientation = this.preferences.reviewOrientation;
    if (this.full?.id === id) { if (!isFinished(this.state?.status)) throw new Error('Review is available after the game ends.'); pgn = this.completionData?.[id]?.pgn || this.savedGames().find(game => game.id === id)?.pgn || completedPgn(this.full, this.state); }
    else pgn = this.savedGames().find(game => game.id === id)?.pgn;
    if (!pgn) { this.message('Opening your game…'); const data = await this.api.request(`/game/${encodeURIComponent(id)}/pgn`); pgn = data.pgn; }
    if (!pgn) throw new Error('The completed game could not be loaded. Please try again.');
    await this.app.openPlayReview({ pgn, gameId: id, orientation }); this.message('');
  }
  downloadPgn() {
    if (!this.full || !isFinished(this.state?.status)) return;
    const url = URL.createObjectURL(new Blob([completedPgn(this.full, this.state)], { type: 'application/x-chess-pgn' })); const a = document.createElement('a'); a.href = url; a.download = `play-${this.full.id}.pgn`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  renderSettings() {
    const select = (key, label, options) => `<label class="field"><span class="field-label">${label}</span><select class="input-select" data-preference="${key}">${options.map(([value, name]) => `<option value="${escape(value)}" ${this.preferences[key] === value ? 'selected' : ''}>${escape(name)}</option>`).join('')}</select></label>`;
    this.$('settings-fields').innerHTML = `<p class="play-small-note">Board and piece appearance use your main Appearance settings.</p>${select('reviewOrientation', 'Review orientation', [['white', 'White'], ['black', 'Black']])}${[['sounds', 'Game sounds'], ['legalMoves', 'Legal move highlights'], ['coordinates', 'Board coordinates'], ['autoQueen', 'Auto-queen'], ['premoves', 'Premoves'], ['touchConfirm', 'Confirm touch moves']].map(([key, name]) => `<label class="checkbox-row"><input type="checkbox" data-preference="${key}" ${this.preferences[key] ? 'checked' : ''}>${name}</label>`).join('')}<label class="field"><span class="field-label">Sound volume</span><input type="range" min="0" max="1" step="0.05" value="${this.preferences.volume}" data-preference="volume" aria-label="Sound volume"></label>`;
  }
  change(event) {
    const key = event.target.dataset.preference; if (!key) return;
    const value = event.target.type === 'checkbox' ? event.target.checked : key === 'volume' ? Number(event.target.value) : event.target.value;
    this.preferences = { ...this.preferences, [key]: value }; savePlayPreferences(this.preferences); this.board.setPreferences(this.preferences); this.sounds.setPreferences(this.preferences);
  }
  delay(ms, signal) { return new Promise(resolve => { if (signal.aborted) return resolve(); const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); }; const timer = setTimeout(finish, ms); signal.addEventListener('abort', finish, { once: true }); }); }
  async waitForEvents() {
    if (this.eventReady) return;
    if (!this.eventController) this.listenEvents();
    this.message('Connecting to online play…');
    await new Promise((resolve, reject) => {
      this.eventWaiters ||= new Set();
      const done = () => { clearTimeout(timer); this.eventWaiters.delete(done); resolve(); };
      const timer = setTimeout(() => { this.eventWaiters.delete(done); reject(new Error('The online connection is not ready. Please try again.')); }, 15000);
      this.eventWaiters.add(done);
    });
    this.message('');
  }
  reconnectNow() { if (this.full && !isFinished(this.state?.status)) { const id = this.full.id; this.gameController?.abort(); this.gameController = null; this.run(() => this.resume(id)); } }
  closeStreams() { for (const key of ['gameController', 'eventController', 'seekController']) { this[key]?.abort(); this[key] = null; } clearTimeout(this.pendingTimer); clearTimeout(this.noticeTimer); this.message(''); }
  destroy() { this.closeStreams(); clearInterval(this.refreshTimer); this.clocks.destroy(); this.board.destroy(); }
}

document.addEventListener('DOMContentLoaded', () => { const root = document.getElementById('play-page'); if (root && window.app) new PlayExperience(window.app, root); });
