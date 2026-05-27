(function () {
  const checkoutUrl = 'https://www.patreon.com/checkout/SingChess?rid=28690501';

  const firebaseConfig = {
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
    return window.firebase;
  }

  const elStatus = document.getElementById('boost-status');
  const elSignedOut = document.getElementById('boost-signed-out');
  const elSignedIn = document.getElementById('boost-signed-in');
  const elPlan = document.getElementById('boost-plan');
  const elExpires = document.getElementById('boost-expires');
  const elBtnCheckout = document.getElementById('btn-boost-checkout');
  const elBtnConnect = document.getElementById('btn-boost-connect');

  function setStatus(text, kind = '') {
    if (!elStatus) return;
    elStatus.textContent = text || '';
    elStatus.className = `account-status ${kind}`.trim();
  }

  async function authHeaders(user, extra = {}) {
    const token = await user?.getIdToken?.();
    return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
  }

  async function loadMe(user) {
    const res = await fetch('/api/users/me', { headers: await authHeaders(user), cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error || `Account API responded with ${res.status}`);
    return json;
  }

  function renderBoostState(user, me) {
    if (elSignedOut) elSignedOut.hidden = !!user;
    if (elSignedIn) elSignedIn.hidden = !user;

    if (!user || !me) return;
    const plan = me.plan || { plan: 'free', name: 'Free' };
    if (elPlan) elPlan.textContent = plan.name || 'Free';

    if (plan.plan === 'boost') {
      if (elBtnCheckout) elBtnCheckout.hidden = true;
      if (elBtnConnect) elBtnConnect.hidden = true;
      if (elExpires) {
        const when = plan.expiresAt ? new Date(plan.expiresAt).toLocaleString() : '';
        elExpires.textContent = when ? `Verified through Patreon. Next check: within 24h. Expires: ${when}` : 'Verified through Patreon.';
      }
      setStatus('Boost is active on your account.', 'success');
      return;
    }

    if (elBtnCheckout) {
      elBtnCheckout.hidden = false;
      elBtnCheckout.href = checkoutUrl;
    }
    if (elBtnConnect) elBtnConnect.hidden = false;
    if (elExpires) elExpires.textContent = '';
    setStatus('After checkout, connect Patreon to activate Boost on your account.', '');
  }

  async function startConnect(user) {
    const token = await user.getIdToken();
    const returnTo = '/boost';
    window.location.assign(`/api/patreon/connect?token=${encodeURIComponent(token)}&return=${encodeURIComponent(returnTo)}`);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const firebase = ensureFirebase();
    if (!firebase?.auth) {
      setStatus('Firebase auth did not load. Boost activation is unavailable.', 'error');
      return;
    }

    elBtnConnect?.addEventListener('click', async () => {
      const user = firebase.auth().currentUser;
      if (!user) {
        window.location.assign('/signin.html');
        return;
      }
      await startConnect(user);
    });

    firebase.auth().onAuthStateChanged(async (user) => {
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
  });
})();

