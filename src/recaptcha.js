(function () {
  // reCAPTCHA v3 client wrapper. Lazy-loads Google's api.js script on first
  // call to executeRecaptcha() and caches the loader promise so subsequent
  // calls share one script tag.
  //
  // Public API:
  //   window.recaptchaLib.executeRecaptcha(action) -> Promise<string>
  //     Resolves with a fresh v3 token for `action` ("signup", "contact", …).
  //     Rejects if no site key is configured or the script fails to load.
  //   window.recaptchaLib.getSiteKey() -> string|null
  //
  // Server-side `RECAPTCHA_DISABLED=1` bypasses verification entirely, so this
  // loader is still safe to call in dev — the server will accept whatever
  // token (or none) the client sends. Calling without a site key rejects
  // immediately, which surfaces as a clean error in the form.

  const RECAPTCHA_SRC = 'https://www.google.com/recaptcha/api.js';
  let loaderPromise = null;

  function getSiteKey() {
    try {
      const v = import.meta.env && import.meta.env.VITE_RECAPTCHA_SITE_KEY;
      const key = v ? String(v).trim() : '';
      return key || null;
    } catch (_e) {
      return null;
    }
  }

  function loadRecaptcha() {
    if (window.grecaptcha && window.grecaptcha.execute) return Promise.resolve();
    if (loaderPromise) return loaderPromise;
    loaderPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src^="${RECAPTCHA_SRC}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('reCAPTCHA script failed to load')));
        return;
      }
      const siteKey = getSiteKey();
      if (!siteKey) {
        loaderPromise = null;
        reject(new Error('reCAPTCHA site key not configured'));
        return;
      }
      const script = document.createElement('script');
      script.src = `${RECAPTCHA_SRC}?render=${encodeURIComponent(siteKey)}`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loaderPromise = null;
        reject(new Error('reCAPTCHA script failed to load'));
      };
      document.head.appendChild(script);
    });
    return loaderPromise;
  }

  async function executeRecaptcha(action) {
    const siteKey = getSiteKey();
    if (!siteKey) throw new Error('reCAPTCHA site key not configured');
    await loadRecaptcha();
    if (!window.grecaptcha || !window.grecaptcha.execute) {
      throw new Error('reCAPTCHA not available');
    }
    const safeAction = String(action || '').slice(0, 64);
    return new Promise((resolve, reject) => {
      try {
        window.grecaptcha.ready(() => {
          window.grecaptcha.execute(siteKey, { action: safeAction })
            .then(resolve)
            .catch((err) => reject(err instanceof Error ? err : new Error(String(err || 'reCAPTCHA execute failed'))));
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err || 'reCAPTCHA execute failed')));
      }
    });
  }

  window.recaptchaLib = { executeRecaptcha, getSiteKey };
})();