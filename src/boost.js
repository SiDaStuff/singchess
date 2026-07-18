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

  function ensureFirebase() {
    if (!window.firebase?.initializeApp) return null;
    if (!window.firebase.apps?.length) window.firebase.initializeApp(firebaseConfig);
    // Set Firebase auth persistence to maintain session across page reloads
    try {
      window.firebase.auth().setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
    } catch (err) {
      console.warn('Could not set Firebase auth persistence:', err);
    }
    return window.firebase;
  }

  // Confetti animation setup
  class ConfettiGenerator {
    constructor(canvasId) {
      this.canvas = document.getElementById(canvasId);
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      this.particles = [];
      this.animationId = null;
      this.resizeCanvas();
      window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
      if (!this.canvas) return;
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    }

    createParticles(count = 150) {
      const colors = ['#9d4edd', '#c77dff', '#e0aaff', '#9d4edd', '#c77dff'];
      const shapes = ['circle', 'square', 'confetti'];
      
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: Math.random() * this.canvas.width,
          y: Math.random() * this.canvas.height - this.canvas.height,
          vx: (Math.random() - 0.5) * 8,
          vy: Math.random() * 4 + 6,
          size: Math.random() * 8 + 4,
          color: colors[Math.floor(Math.random() * colors.length)],
          shape: shapes[Math.floor(Math.random() * shapes.length)],
          rotation: Math.random() * Math.PI * 2,
          rotationVelocity: (Math.random() - 0.5) * 0.2,
          life: 1,
          decay: Math.random() * 0.015 + 0.015,
        });
      }
    }

    draw() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];

        // Update position
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.2; // gravity
        p.rotation += p.rotationVelocity;
        p.life -= p.decay;

        if (p.life <= 0) {
          this.particles.splice(i, 1);
          continue;
        }

        // Draw particle
        this.ctx.save();
        this.ctx.globalAlpha = p.life;
        this.ctx.translate(p.x, p.y);
        this.ctx.rotate(p.rotation);

        this.ctx.fillStyle = p.color;

        if (p.shape === 'circle') {
          this.ctx.beginPath();
          this.ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          this.ctx.fill();
        } else if (p.shape === 'square') {
          this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        } else {
          // confetti shape (thin rectangle)
          this.ctx.fillRect(-p.size / 3, -p.size / 2, (p.size * 2) / 3, p.size);
        }

        this.ctx.restore();
      }

      if (this.particles.length > 0) {
        this.animationId = requestAnimationFrame(() => this.draw());
      } else {
        this.stop();
      }
    }

    celebrate(count = 150) {
      // Guard against a second celebrate() while a loop is already running —
      // previously it would start a parallel requestAnimationFrame chain and
      // orphan the first (this.animationId only tracks the newest), leaking it.
      if (this.animationId) this.stop();
      this.createParticles(count);
      this.draw();
    }

    stop() {
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
    }
  }

  const confetti = new ConfettiGenerator('confetti-canvas');

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
    // The pricing tiers are always visible — even to signed-out visitors — so
    // the upgrade page is informative on every visit.
    if (elAuthRequired) elAuthRequired.hidden = true;
    if (elContent) elContent.hidden = false;
    if (elStatusContainer) elStatusContainer.hidden = true;

    // Mark the user's current tier on each pricing card.
    const plan = (user && me) ? (me.plan || { plan: 'free', name: 'Free' }) : { plan: 'free' };
    ['free', 'boost', 'max'].forEach((key) => {
      const el = document.getElementById(`plan-tier-current-${key}`);
      if (el) el.hidden = plan.plan !== key;
    });

    if (!user || !me) return;

    if (plan.plan === 'boost' || plan.plan === 'max') {
      if (elStatusContainer) elStatusContainer.hidden = false;
      if (elStatusTitle) elStatusTitle.textContent = `${plan.name} is Active!`;
      if (elStatusText) {
        const expiresAt = plan.expiresAt ? new Date(plan.expiresAt).toLocaleDateString() : '';
        elStatusText.textContent = expiresAt
          ? `Your ${plan.name} features are active until ${expiresAt}. Enjoy!`
          : `Your ${plan.name} features are ready to go!`;
      }
      setStatus('', '');
      return;
    }

    // Free user: the pricing tiers (#spa-boost-content) are visible by default.
    if (elBtnAccount) elBtnAccount.hidden = false;
    setStatus('', '');
  }

  // Waitlist intent capture — stores the email locally so we can notify the
  // user when Boost opens. No payment, no server billing dependency.
  let waitlistBound = false;
  function setupWaitlist() {
    const emailInput = document.getElementById('spa-boost-notify-email');
    const btn = document.getElementById('spa-btn-boost-notify');
    const statusEl = document.getElementById('spa-boost-notify-status');
    if (!btn || !emailInput) return;

    // Prefill a previously-saved email so returning visitors see their spot reserved.
    try {
      const saved = window.localStorage.getItem('sidastuff.boost.waitlist');
      if (saved) {
        emailInput.value = saved;
        if (statusEl) {
          statusEl.textContent = "You're on the list — we'll email you when Boost opens.";
          statusEl.className = 'account-status success';
        }
      }
    } catch (_) {}

    if (waitlistBound) return;
    waitlistBound = true;
    btn.addEventListener('click', () => {
      const email = (emailInput.value || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        if (statusEl) {
          statusEl.textContent = 'Enter a valid email to reserve your spot.';
          statusEl.className = 'account-status error';
        }
        return;
      }
      try { window.localStorage.setItem('sidastuff.boost.waitlist', email); } catch (_) {}
      if (statusEl) {
        statusEl.textContent = "You're on the list — we'll email you when Boost opens.";
        statusEl.className = 'account-status success';
      }
      btn.disabled = true;
      btn.querySelector('.btn-label').textContent = 'Reserved ✓';
    });
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
    if (!user) renderBoostState(null, null);
  }

  // Expose for the SPA shell to call when the boost panel becomes visible.
  window.SidaBoost = { render };
})();

