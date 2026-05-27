(function () {
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

  function browserMeetsRequirements() {
    try {
      const storageKey = '__chess_feature_test__';
      window.localStorage.setItem(storageKey, '1');
      window.localStorage.removeItem(storageKey);
    } catch (_err) {
      return false;
    }
    return !!(window.WebAssembly && window.Worker && window.fetch && window.Promise && window.URL);
  }

  function ensureFirebase() {
    if (!window.firebase?.initializeApp) return null;
    if (!window.firebase.apps?.length) window.firebase.initializeApp(firebaseConfig);
    return window.firebase;
  }

  function friendlyAuthError(err) {
    const code = String(err?.code || '');
    if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(code)) {
      return 'Email or password is incorrect.';
    }
    if (code === 'auth/email-already-in-use') return 'An account already exists for that email.';
    if (code === 'auth/too-many-requests') return 'Too many attempts. Try again later.';
    return err?.message || 'Authentication failed.';
  }

  function banMessage(reason = '') {
    return reason ? `Account banned. Reason: ${reason}` : 'Account banned.';
  }

  async function lookupBanReason(email) {
    if (!email) return '';
    try {
      const response = await fetch('/api/auth/ban-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ email }),
      });
      const result = await response.json().catch(() => null);
      return result?.banned ? String(result.reason || '').trim() : '';
    } catch (_err) {
      return '';
    }
  }

  function showWarningPopup(message) {
    const text = String(message || '').trim();
    if (!text) return;
    if (window.AppDialog?.open) {
      window.AppDialog.open({
        icon: 'warning',
        title: 'Message from admin',
        text,
        confirmButtonText: 'OK',
        allowOutsideClick: false,
      });
      return;
    }
    window.alert(text);
  }

  function setStatus(message, kind = '') {
    const el = document.getElementById('page-status');
    if (!el) return;
    el.textContent = message || '';
    el.className = `account-status ${kind}`.trim();
  }

  function showLoading(message = 'Loading...') {
    const overlay = document.getElementById('app-loading-overlay');
    const text = document.getElementById('app-loading-text');
    if (text) text.textContent = message;
    if (overlay) overlay.style.display = 'flex';
  }

  function hideLoading() {
    const overlay = document.getElementById('app-loading-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  async function authHeaders(user, extra = {}) {
    const token = await user?.getIdToken?.();
    return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
  }

  let accountStatusSource = null;

  function stopAccountStatusStream() {
    if (accountStatusSource) {
      accountStatusSource.close();
      accountStatusSource = null;
    }
  }

  async function startAccountStatusStream(user) {
    stopAccountStatusStream();
    if (!user || !window.EventSource) return;
    try {
      const token = await user.getIdToken();
      const source = new EventSource(`/api/users/me/stream?token=${encodeURIComponent(token)}`);
      accountStatusSource = source;
      source.addEventListener('disabled', async (event) => {
        const payload = event.data ? JSON.parse(event.data) : {};
        setStatus(payload.reason ? banMessage(payload.reason) : (payload.error || 'Account disabled. Signing out.'), 'error');
        stopAccountStatusStream();
        const firebase = ensureFirebase();
        if (firebase?.auth) await firebase.auth().signOut();
        window.location.replace(`/signin.html?banned=1${payload.reason ? `&reason=${encodeURIComponent(payload.reason)}` : ''}`);
      });
      source.addEventListener('warning', (event) => {
        try {
          const payload = event.data ? JSON.parse(event.data) : {};
          showWarningPopup(payload.message || '');
        } catch (_err) {}
      });
      source.addEventListener('error', () => {
        if (source.readyState === EventSource.CLOSED) stopAccountStatusStream();
      });
    } catch (_err) {
      stopAccountStatusStream();
    }
  }

  async function loadMe(user) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/api/users/me', {
        headers: await authHeaders(user),
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        if (response.status === 403) {
          const message = result?.reason ? banMessage(result.reason) : (result?.error || 'Account disabled. Signing out.');
          setStatus(message, 'error');
          const firebase = ensureFirebase();
          if (firebase?.auth) await firebase.auth().signOut();
          window.location.replace(`/signin.html?banned=1${result?.reason ? `&reason=${encodeURIComponent(result.reason)}` : ''}`);
        }
        throw new Error(result?.error || `Account API responded with ${response.status}`);
      }
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  function renderAccount(user, me) {
    const signedOut = document.getElementById('account-signed-out-page');
    const signedIn = document.getElementById('account-signed-in-page');
    if (signedOut) signedOut.hidden = !!user;
    if (signedIn) signedIn.hidden = !user;
    if (!user || !me) return;

    const profile = me.profile || {};
    const plan = me.plan || { name: 'Free', plan: 'free' };
    const stats = profile.puzzleStats || {};
    const usage = me.usage || {};
    const limits = me.limits || {};
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    setText('account-display-name', profile.username || user.displayName || 'Player');
    setText('account-email-label', user.email || profile.email || '');
    setText('account-plan', plan.name || 'Free');
    setText('account-puzzle-rating', Math.round(Number(profile.puzzleRating) || 1500));
    setText('account-puzzles-solved', Math.max(0, Number(stats.solved) || 0));
    setText('account-puzzles-attempted', Math.max(0, Number(stats.attempted) || 0));
    setText('account-usage', plan.plan === 'boost'
      ? 'Boost includes unlimited server reviews and anticheat runs.'
      : `Today: ${Math.max(0, Number(usage.anticheat) || 0)}/${limits.anticheatRunsPerDay || 1} anticheat, ${Math.max(0, Number(usage.serverReviews) || 0)}/${limits.serverReviewsPerDay || 3} server reviews.`);
    const boostCta = document.getElementById('account-boost-cta');
    if (boostCta) boostCta.style.display = plan.plan === 'free' ? 'block' : 'none';

    const adminPanel = document.getElementById('admin-boost-panel');
    if (adminPanel) adminPanel.hidden = !me.isAdmin;
    const banPanel = document.getElementById('admin-ban-panel');
    if (banPanel) banPanel.hidden = !me.isAdmin;
    const dashboardPanel = document.getElementById('admin-dashboard-panel');
    if (dashboardPanel) dashboardPanel.hidden = !me.isAdmin;
    const warnPanel = document.getElementById('admin-warn-panel');
    if (warnPanel) warnPanel.hidden = !me.isAdmin;
    if (me.isAdmin) loadAdminDashboard(user);
    if (me.pendingWarning) showWarningPopup(me.pendingWarning.message);
  }

  function renderOnlineUsers(users = []) {
    const list = document.getElementById('admin-online-list');
    if (!list) return;
    if (!users.length) {
      list.innerHTML = '<p class="admin-online-empty">No users connected.</p>';
      return;
    }
    list.innerHTML = users.map((entry) => `
      <div class="admin-online-row">
        <strong>${escapeHtml(entry.username || entry.email || 'Player')}</strong>
        <span>${escapeHtml(entry.email || '')}</span>
      </div>`).join('');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function loadAdminDashboard(user) {
    try {
      const response = await fetch('/api/admin/dashboard', {
        headers: await authHeaders(user),
        cache: 'no-store',
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || `Dashboard failed with ${response.status}`);
      const onlineCount = document.getElementById('admin-online-count');
      const totalVisitors = document.getElementById('admin-total-visitors');
      if (onlineCount) onlineCount.textContent = String(result.onlineCount || 0);
      if (totalVisitors) totalVisitors.textContent = String(result.totalVisitors || 0);
      renderOnlineUsers(result.onlineUsers || []);
    } catch (err) {
      setStatus(err.message || 'Could not load admin dashboard.', 'error');
    }
  }

  async function warnUser() {
    const firebase = ensureFirebase();
    const user = firebase?.auth?.().currentUser;
    if (!user) return setStatus('Sign in as admin first.', 'error');
    const email = (document.getElementById('warn-user-email')?.value || '').trim();
    const message = (document.getElementById('warn-user-message')?.value || '').trim();
    if (!email) return setStatus('Enter the user email.', 'error');
    if (!message || message.length > 500) return setStatus('Enter a warning message (max 500 characters).', 'error');
    showLoading('Sending warning...');
    try {
      const response = await fetch('/api/admin/warn-user', {
        method: 'POST',
        headers: await authHeaders(user, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ email, message }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || `Warning failed with ${response.status}`);
      setStatus(`Warning queued for ${result.email}.`, 'success');
      document.getElementById('warn-user-message').value = '';
    } catch (err) {
      setStatus(err.message || 'Warning failed.', 'error');
    } finally {
      hideLoading();
    }
  }

  async function emailAuth(mode) {
    const firebase = ensureFirebase();
    if (!firebase?.auth) {
      setStatus('Firebase auth is unavailable.', 'error');
      return;
    }
    const email = (document.getElementById('email')?.value || '').trim();
    const password = document.getElementById('password')?.value || '';
    if (!email || !password) {
      setStatus('Fill in the required account fields.', 'error');
      return;
    }
    showLoading(mode === 'signup' ? 'Creating account...' : 'Signing in...');
    try {
      if (mode === 'signup') {
        const credential = await firebase.auth().createUserWithEmailAndPassword(email, password);
        const displayName = email.split('@')[0] || 'Player';
        await credential.user.updateProfile({ displayName });
      } else {
        await firebase.auth().signInWithEmailAndPassword(email, password);
      }
      setStatus('Signed in.', 'success');
      window.location.assign('/account.html');
    } catch (err) {
      if (String(err?.code || '') === 'auth/user-disabled') {
        setStatus(banMessage(await lookupBanReason(email)), 'error');
      } else {
        setStatus(friendlyAuthError(err), 'error');
      }
    } finally {
      hideLoading();
    }
  }

  async function resetPassword() {
    const firebase = ensureFirebase();
    const email = (document.getElementById('reset-email')?.value || document.getElementById('email')?.value || '').trim();
    if (!firebase?.auth) return setStatus('Firebase auth is unavailable.', 'error');
    if (!email) return setStatus('Enter your email first.', 'error');
    showLoading('Sending reset email...');
    try {
      await firebase.auth().sendPasswordResetEmail(email);
      setStatus('Password reset email sent.', 'success');
    } catch (err) {
      setStatus(friendlyAuthError(err), 'error');
    } finally {
      hideLoading();
    }
  }

  async function googleAuth() {
    const firebase = ensureFirebase();
    if (!firebase?.auth?.GoogleAuthProvider) {
      setStatus('Google sign-in is unavailable.', 'error');
      return;
    }
    showLoading('Signing in...');
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await firebase.auth().signInWithPopup(provider);
      window.location.assign('/account.html');
    } catch (err) {
      if (String(err?.code || '') === 'auth/user-disabled') {
        setStatus(banMessage(await lookupBanReason(err?.email || '')), 'error');
      } else {
        setStatus(friendlyAuthError(err), 'error');
      }
    } finally {
      hideLoading();
    }
  }

  async function signOut() {
    const firebase = ensureFirebase();
    await firebase?.auth?.().signOut();
    window.location.assign('/signin.html');
  }

  function clearCache() {
    try {
      const keys = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (typeof key === 'string' && key.startsWith('sidastuff.')) keys.push(key);
      }
      keys.forEach((key) => window.localStorage.removeItem(key));
      setStatus('Local settings and puzzle cache were cleared.', 'success');
    } catch (err) {
      setStatus(err.message || 'Unable to clear local cache.', 'error');
    }
  }

  async function giftBoost() {
    const firebase = ensureFirebase();
    const user = firebase?.auth?.().currentUser;
    if (!user) return setStatus('Sign in as admin first.', 'error');
    const email = (document.getElementById('gift-boost-email')?.value || '').trim();
    const days = Math.max(1, Math.min(parseInt(document.getElementById('gift-boost-days')?.value || '30', 10) || 30, 366));
    showLoading('Gifting Boost...');
    try {
      const response = await fetch('/api/admin/gift-boost', {
        method: 'POST',
        headers: await authHeaders(user, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ email, days }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || `Gift failed with ${response.status}`);
      setStatus(`Boost gifted to ${result.email}.`, 'success');
    } catch (err) {
      setStatus(err.message || 'Gift failed.', 'error');
    } finally {
      hideLoading();
    }
  }

  async function manageBanUser(action) {
    const firebase = ensureFirebase();
    const user = firebase?.auth?.().currentUser;
    if (!user) return setStatus('Sign in as admin first.', 'error');
    const email = (document.getElementById('ban-user-email')?.value || '').trim();
    const reason = (document.getElementById('ban-user-reason')?.value || '').trim();
    if (!email) return setStatus('Enter the user email.', 'error');
    if (action === 'ban' && !reason) return setStatus('Enter a reason for the ban.', 'error');
    showLoading(action === 'ban' ? 'Banning user...' : 'Unbanning user...');
    try {
      const response = await fetch('/api/admin/ban-user', {
        method: 'POST',
        headers: await authHeaders(user, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action, email, reason }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || `Request failed with ${response.status}`);
      setStatus(`${action === 'ban' ? 'Banned' : 'Unbanned'} ${result.email}.`, 'success');
    } catch (err) {
      setStatus(err.message || 'Ban action failed.', 'error');
    } finally {
      hideLoading();
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    const oobCode = params.get('oobCode');
    if (params.get('banned') === '1') {
      setStatus(banMessage(params.get('reason') || ''), 'error');
    }

    if (!browserMeetsRequirements() && !/incompatible-browser\.html$/i.test(window.location.pathname)) {
      window.location.replace('/incompatible-browser.html');
      return;
    }

    const page = document.body.dataset.page || '';
    const firebase = ensureFirebase();
    document.getElementById('btn-email-auth')?.addEventListener('click', () => emailAuth(page));
    document.getElementById('btn-reset-password')?.addEventListener('click', async () => {
      // If a reset code is present, confirm new password flow; otherwise send reset email
      if (mode === 'resetPassword' && oobCode) return confirmPasswordResetFlow(oobCode);
      return resetPassword();
    });
    document.getElementById('btn-google-auth')?.addEventListener('click', googleAuth);
    document.getElementById('btn-signout')?.addEventListener('click', signOut);
    document.getElementById('btn-clear-cache')?.addEventListener('click', clearCache);
    document.getElementById('btn-gift-boost')?.addEventListener('click', giftBoost);
    document.getElementById('btn-ban-user')?.addEventListener('click', () => manageBanUser('ban'));
    document.getElementById('btn-unban-user')?.addEventListener('click', () => manageBanUser('unban'));
    document.getElementById('btn-warn-user')?.addEventListener('click', warnUser);
    document.getElementById('btn-refresh-admin-dashboard')?.addEventListener('click', async () => {
      const firebase = ensureFirebase();
      const user = firebase?.auth?.().currentUser;
      if (user) await loadAdminDashboard(user);
    });

    let accountLoadingFallback = null;
    if (page === 'account') {
      showLoading('Loading profile...');
      accountLoadingFallback = setTimeout(hideLoading, 12000);
    }
    if (!firebase?.auth) {
      hideLoading();
      setStatus('Firebase auth did not load. Account features are unavailable.', 'error');
      return;
    }

    // If this is a reset link, verify the code and show the new-password UI
    if (mode === 'resetPassword' && params.get('oobCode')) {
      (async () => {
        const code = params.get('oobCode');
        showLoading('Verifying reset link...');
        try {
          const email = await firebase.auth().verifyPasswordResetCode(code);
          hideLoading();
          document.getElementById('reset-email').value = email;
          document.getElementById('reset-email').disabled = true;
          const newArea = document.getElementById('reset-new-password-area');
          if (newArea) newArea.style.display = 'block';
          const btn = document.getElementById('btn-reset-password');
          if (btn) btn.textContent = 'Set New Password';
        } catch (err) {
          hideLoading();
          setStatus('Reset link is invalid or expired. Request a new password reset.', 'error');
        }
      })();
    }
    firebase.auth().onAuthStateChanged(async (user) => {
      if (accountLoadingFallback) clearTimeout(accountLoadingFallback);
      if (!user) {
        stopAccountStatusStream();
        if (page === 'account') renderAccount(null, null);
        hideLoading();
        if (typeof window.updateHeaderAuth === 'function') window.updateHeaderAuth(user);
        return;
      }
      startAccountStatusStream(user);
      if (page !== 'account') {
        hideLoading();
        if (typeof window.updateHeaderAuth === 'function') window.updateHeaderAuth(user);
        return;
      }
      try {
        renderAccount(user, await loadMe(user));
      } catch (err) {
        setStatus(err.message || 'Could not load account.', 'error');
      } finally {
        hideLoading();
        if (typeof window.updateHeaderAuth === 'function') window.updateHeaderAuth(user);
      }
    });
  });

  async function confirmPasswordResetFlow(code) {
    const firebase = ensureFirebase();
    if (!firebase?.auth) return setStatus('Firebase auth is unavailable.', 'error');
    const newPassword = (document.getElementById('reset-new-password')?.value || '').trim();
    const confirm = (document.getElementById('reset-confirm-password')?.value || '').trim();
    if (!newPassword || newPassword.length < 6) return setStatus('Password must be at least 6 characters.', 'error');
    if (newPassword !== confirm) return setStatus('Passwords do not match.', 'error');
    showLoading('Updating password...');
    try {
      await firebase.auth().confirmPasswordReset(code, newPassword);
      setStatus('Password updated. You may now sign in.', 'success');
      setTimeout(() => window.location.assign('/signin.html'), 1500);
    } catch (err) {
      setStatus(friendlyAuthError(err), 'error');
    } finally {
      hideLoading();
    }
  }
})();
