(function () {
  // Single shared Firebase config (src/firebase-config.js, imported via
  // main.js before this file). Kept as a module-level fallback too.
  const firebaseConfig = (typeof window !== 'undefined' && window.FIREBASE_CONFIG) || {
    apiKey: 'AIzaSyAVG8Awwd2FmVIvhzHTrZ19nhoUowZ1H3M',
    authDomain: 'singchess-sd.firebaseapp.com',
    databaseURL: 'https://singchess-sd-default-rtdb.firebaseio.com',
    projectId: 'singchess-sd',
    storageBucket: 'singchess-sd.firebasestorage.app',
    messagingSenderId: '784279280538',
    appId: '1:784279280538:web:88a78b114e8f997b0fb823',
    measurementId: 'G-TFW7HFWKYP',
  };

  function ensureFirebase() {
    if (!window.firebase?.initializeApp) return null;
    if (!window.firebase.apps?.length) window.firebase.initializeApp(firebaseConfig);
    // Set Firebase auth persistence to maintain session across page reloads
    try {
      window.firebase.auth().setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
    } catch (err) {
      console.warn('Could not set Firebase auth persistence:', err);
    }
    // Initialize Firebase Analytics if available
    try {
      if (window.firebase.analytics) {
        window.firebase.analytics();
      }
    } catch (err) {
      console.warn('Firebase Analytics not available:', err);
    }
    return window.firebase;
  }

  // In the SPA, IDs are prefixed with "spa-" to avoid collisions with the in-menu boost page.
  const elStatus = document.getElementById('spa-boost-status');
  const elStatusContainer = document.getElementById('spa-boost-status-container');
  const elAuthRequired = document.getElementById('spa-boost-auth-required');
  const elContent = document.getElementById('spa-boost-content');
  const elStatusCard = document.getElementById('spa-boost-status-card');
  // HTML renamed this id to `spa-plans-status-title`. Fall back to the old
  // name for any older markup so the activation banner still updates.
  const elStatusTitle = document.getElementById('spa-plans-status-title')
    || document.getElementById('spa-boost-status-title');
  const elStatusText = document.getElementById('spa-boost-status-text');
  const elBtnAccount = document.getElementById('btn-boost-to-account');

  function setStatus(text, kind = '') {
    if (!elStatus) return;
    elStatus.textContent = text || '';
    elStatus.className = `account-status boost-error-status ${kind}`.trim();
  }

  async function authHeaders(user, extra = {}) {
    const token = await user?.getIdToken?.();
    return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
  }

  async function loadMe(user) {
    const res = await window.apiFetch('/api/users/me', { headers: await authHeaders(user), cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error || `Account API responded with ${res.status}`);
    return json;
  }

  function renderBoostState(user, me) {
    // The app's resolved identity wins over a delayed pricing-page auth
    // callback, including sign-out and profile-request failures.
    const account = window.app?.authState;
    if (account?.initialized) {
      user = account.user;
      me = user ? (account.me || me) : null;
    }
    // Signed-out visitors: show a clear path to sign in / create an account,
    // alongside the pricing info. The auth panel was bound but permanently
    // hidden before, so a guest could never act on the upgrade call-to-action.
    if (elAuthRequired) elAuthRequired.hidden = !!user || account?.initialized === false;
    if (elContent) elContent.hidden = false;
    if (elStatusContainer) elStatusContainer.hidden = true;
    const freeSignup = document.getElementById('plan-free-signup');
    if (freeSignup) freeSignup.hidden = !!user || account?.initialized === false;

    // Mark the user's current tier on each pricing card.
    const plan = (user && me) ? (me.plan || { plan: 'free', name: 'Free' }) : { plan: 'free' };
    ['free', 'boost', 'max'].forEach((key) => {
      const el = document.getElementById(`plan-tier-current-${key}`);
      if (el) el.hidden = !user || !me || plan.plan !== key;
    });

    // Don't offer an upgrade-to-itself CTA on the plan the user already owns —
    // a Boost subscriber shouldn't see "Contact us to upgrade" (to Boost) beside
    // their "Your plan" chip on the same card. Both CTAs are re-shown FIRST so
    // a plan change (e.g. Boost lapsed back to Free) doesn't leave its upgrade
    // button hidden from the previous render forever — this function used to
    // only ever hide.
    [document.getElementById('btn-boost-subscribe'), document.getElementById('btn-max-subscribe')]
      .forEach((el) => { if (el) el.hidden = false; });
    if (user && me && (plan.plan === 'boost' || plan.plan === 'max')) {
      const subscribedCta = document.getElementById(plan.plan === 'boost' ? 'btn-boost-subscribe' : 'btn-max-subscribe');
      if (subscribedCta) subscribedCta.hidden = true;
    }

    if (!user || !me) return;

    if (plan.plan === 'boost' || plan.plan === 'max') {
      if (elStatusContainer) elStatusContainer.hidden = false;
      if (elStatusTitle) elStatusTitle.textContent = `${plan.name} is active`;
      if (elStatusText) {
        const expiresAt = plan.expiresAt ? new Date(plan.expiresAt).toLocaleDateString() : '';
        elStatusText.textContent = expiresAt
          ? `Your ${plan.name} features are active until ${expiresAt}.`
          : `Your ${plan.name} features are ready.`;
      }
      setStatus('', '');
      return;
    }

    // Free user: the pricing tiers (#spa-boost-content) are visible by default.
    if (elBtnAccount) elBtnAccount.hidden = false;
    setStatus('', '');
  }

  let authSubscriptionAttached = false;
  let currentAuthUser = null;

  function attachAuthListeners() {
    if (authSubscriptionAttached) return;
    const firebase = ensureFirebase();
    if (!firebase?.auth) {
      setStatus('Firebase auth did not load. Boost activation is unavailable.', 'error');
      return;
    }
    authSubscriptionAttached = true;
    firebase.auth().onAuthStateChanged(async (user) => {
      currentAuthUser = user || null;
      try {
        if (!user) {
          renderBoostState(null, null);
          return;
        }
        const me = await loadMe(user);
        renderBoostState(user, me);
      } catch (err) {
        setStatus(err.message || 'Could not load Boost state.', 'error');
      }
    });
  }

  function render() {
    attachAuthListeners();
    // Trigger an immediate render in case the auth state was already known.
    const firebase = ensureFirebase();
    const user = firebase?.auth?.().currentUser || currentAuthUser;
    if (!user) {
      renderBoostState(null, null);
      return;
    }
    // Signed in: re-fetch /api/users/me on every render. The plan state may
    // have changed since the last onAuthStateChanged fire (plan activated,
    // expired, or admin-granted elsewhere) and this panel used to only ever
    // show the snapshot from page load. Failures fall back to a signed-out
    // render with an error banner rather than stale plan UI.
    loadMe(user)
      .then((me) => renderBoostState(user, me))
      .catch((err) => {
        renderBoostState(null, null);
        setStatus(err.message || 'Could not load Boost state.', 'error');
      });
  }

  // Expose for the SPA shell to call when the boost panel becomes visible.
  window.SidaBoost = { render };
})();
