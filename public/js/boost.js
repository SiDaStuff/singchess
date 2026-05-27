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

  const elStatus = document.getElementById('boost-status');
  const elStatusContainer = document.getElementById('boost-status-container');
  const elAuthRequired = document.getElementById('boost-auth-required');
  const elContent = document.getElementById('boost-content');
  const elStatusCard = document.getElementById('boost-status-card');
  const elStatusTitle = document.getElementById('boost-status-title');
  const elStatusText = document.getElementById('boost-status-text');
  const elCtaText = document.getElementById('boost-cta-text');
  const elBtnCheckoutMonthly = document.getElementById('btn-boost-checkout-monthly');
  const elBtnCheckoutCta = document.getElementById('btn-boost-checkout-cta');
  const elBtnConnect = document.getElementById('btn-boost-connect');

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
    const res = await fetch('/api/users/me', { headers: await authHeaders(user), cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error || `Account API responded with ${res.status}`);
    return json;
  }

  function renderBoostState(user, me) {
    // Hide all sections by default
    if (elAuthRequired) elAuthRequired.hidden = !!user;
    if (elContent) elContent.hidden = !user;
    if (elStatusContainer) elStatusContainer.hidden = true;

    if (!user || !me) return;

    const plan = me.plan || { plan: 'free', name: 'Free' };

    // User has active Boost
    if (plan.plan === 'boost') {
      if (elStatusContainer) elStatusContainer.hidden = false;
      if (elContent) elContent.hidden = true;
      if (elStatusTitle) elStatusTitle.textContent = 'Boost is Active!';
      if (elStatusText) {
        const expiresAt = plan.expiresAt ? new Date(plan.expiresAt).toLocaleDateString() : '';
        elStatusText.textContent = expiresAt 
          ? `Your premium features are active until ${expiresAt}. Enjoy unlimited analysis!`
          : 'Your premium features are ready to go!';
      }
      setStatus('', '');
      return;
    }

    // User is free, show checkout options
    if (elBtnCheckoutMonthly) {
      elBtnCheckoutMonthly.hidden = false;
      elBtnCheckoutMonthly.href = checkoutUrl;
    }
    if (elBtnCheckoutCta) {
      elBtnCheckoutCta.hidden = false;
      elBtnCheckoutCta.href = checkoutUrl;
    }
    if (elBtnConnect) elBtnConnect.hidden = false;
    
    if (elCtaText) elCtaText.textContent = 'Start your free trial today with no credit card required';
    setStatus('', '');
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

    // Track checkout button clicks for confetti celebration
    const checkoutButtons = [elBtnCheckoutMonthly, elBtnCheckoutYearly, elBtnCheckoutCta];
    checkoutButtons.forEach(btn => {
      if (btn) {
        btn.addEventListener('click', (e) => {
          // Give users a fun celebration before leaving
          setTimeout(() => {
            confetti.celebrate(200);
          }, 200);
        });
      }
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

