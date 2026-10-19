// This guard belongs to the whole application, not the Play route. Its active
// game latch survives refreshes, navigation and tab suspension. Only a real
// provider update may release that latch; a failed request never does.
export function createFairPlayGuard(host) {
  const storageKey = 'singchess.play.activeGames';
  const engines = new Set();
  let app = null, games = [], verified = false, connected = null;
  let checkedAt = 0, pending = null, revision = 0, account = null;
  const readGames = (value) => {
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return Array.from(new Set((Array.isArray(parsed) ? parsed : [])
        .map(game => typeof game === 'string' ? game : game?.gameId || game?.id || game?.fullId?.slice(0, 8))
        .filter(id => typeof id === 'string' && /^[a-zA-Z0-9]{8,12}$/.test(id))));
    } catch (_) { return []; }
  };
  try { games = readGames(host.localStorage?.getItem(storageKey)); } catch (_) {}

  const isBlocked = () => games.length > 0 || !verified;
  const snapshot = () => ({ blocked: isBlocked(), activeGames: games.slice(), verified,
    reason: games.length ? 'live-game' : !verified ? 'verification' : null });
  function publish() {
    const detail = snapshot();
    if (detail.blocked) {
      for (const engine of engines) engine.interrupt?.();
    }
    app?._applyPlayFairPlay?.(detail);
    host.dispatchEvent?.(new host.CustomEvent('play:fairplay', { detail }));
  }
  function persist() {
    try {
      if (games.length) host.localStorage?.setItem(storageKey, JSON.stringify(games));
      else host.localStorage?.removeItem(storageKey);
    } catch (_) { /* In-memory protection still applies if storage is full. */ }
  }
  function setActiveGames(value) {
    games = readGames(value);
    if (games.length) connected = true;
    verified = true;
    checkedAt = Date.now();
    revision++;
    persist();
    publish();
  }
  function observeStatus(status) {
    if (!status || !Array.isArray(status.activeGames)) return;
    connected = !!status.connected;
    setActiveGames(status.activeGames);
  }
  async function verify({ force = false } = {}) {
    if (!app || app.authState?.initialized === false) return !isBlocked();
    const user = app.authState?.user;
    if (!user) {
      // Signing out cannot release a known unfinished game.
      verified = true;
      publish();
      return !isBlocked();
    }
    if (pending) return pending;
    if (!force && verified && Date.now() - checkedAt < 10000) return !isBlocked();
    const startRevision = revision, uid = user.uid;
    pending = (async () => {
      try {
        const token = await user.getIdToken();
        const response = await host.apiFetch('/api/play/active', {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', timeoutMs: 10000,
        });
        if (!response.ok) throw new Error('Play status unavailable');
        const status = await response.json();
        if (!Array.isArray(status.activeGames)) throw new Error('Invalid Play status');
        // A game-start/finish event received during this request is newer.
        if (startRevision === revision && uid === app.authState?.user?.uid) observeStatus(status);
      } catch (_) {
        if (startRevision === revision && uid === app.authState?.user?.uid) {
          // A previously verified disconnected account needs no provider to
          // review its stored PGN. Linked or unknown accounts fail closed.
          if (connected !== false || games.length) verified = false;
          checkedAt = Date.now();
          publish();
        }
      } finally { pending = null; }
      return !isBlocked();
    })();
    return pending;
  }
  async function assertCanAnalyze() {
    if (await verify()) return true;
    const error = new Error(games.length
      ? 'Analysis is paused until your online game ends.'
      : 'Reconnect to Play to verify that your online games have finished.');
    error.code = 'live_game_fair_play';
    throw error;
  }
  function onAuth() {
    const uid = app?.authState?.user?.uid || null;
    if (uid !== account) { account = uid; verified = false; connected = null; checkedAt = 0; revision++; }
    return verify({ force: true });
  }
  function attachApp(value) {
    app = value;
    publish();
  }
  function registerEngine(engine) {
    engines.add(engine);
    return () => engines.delete(engine);
  }
  host.addEventListener?.('storage', event => {
    if (event.key !== storageKey) return;
    // A cleared cross-tab latch is checked with the server before unlocking.
    const updated = readGames(event.newValue);
    if (updated.length) games = updated;
    verified = false;
    revision++;
    publish();
    void verify({ force: true });
  });
  const recheck = () => {
    if (app?.authState?.initialized !== false) void verify({ force: true });
  };
  host.addEventListener?.('focus', recheck);
  host.document?.addEventListener('visibilitychange', () => {
    if (host.document.visibilityState === 'visible') recheck();
  });
  const timer = host.setInterval?.(() => {
    if (connected && host.document?.visibilityState !== 'hidden') recheck();
  }, 15000);
  return { isBlocked, snapshot, setActiveGames, observeStatus, verify, assertCanAnalyze,
    onAuth, attachApp, registerEngine, destroy() { host.clearInterval?.(timer); engines.clear(); } };
}

if (typeof window !== 'undefined') window.PlayFairPlay = createFairPlayGuard(window);
