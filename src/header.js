(function () {
  const links = [
    ['/', 'Home'],
    ['/review', 'Review'],
    ['/coach', 'Coach'],
    ['/puzzles', 'Puzzles'],
    ['/anticheat', 'Anticheat'],
    ['/plans', 'Plans'],
    ['/account', 'Account'],
    ['/settings', 'Settings'],
  ];

  function activeHref() {
    const path = window.location.pathname || '/';
    return path;
  }

  let accountLink = null;

  function renderHeader() {
    // The SPA shell already provides its own app header. Only inject the legacy
    // site-header when the page explicitly opts in via [data-site-header] (used by
    // standalone redirect shells or external integrations).
    const placeholder = document.querySelector('[data-site-header]');
    if (!placeholder) return;
    const current = activeHref();
    const nav = document.createElement('header');
    nav.className = 'site-header';
    nav.innerHTML = `
      <a class="site-brand" href="/">
        <img src="./assets/logo.png" alt="">
        <span>SiDaStuff Chess</span>
      </a>
      <button class="site-menu-toggle" type="button" aria-expanded="false" aria-controls="site-menu">Menu</button>
      <nav class="site-menu" id="site-menu" aria-label="Site navigation">
        ${links.map(([href, label]) => `<a href="${href}" class="${current === href || current === `${href}.html` ? 'active' : ''}" ${href === '/account' ? 'id="header-account-link"' : ''}>${label}</a>`).join('')}
      </nav>
    `;
    placeholder.replaceWith(nav);
    nav.querySelector('.site-menu-toggle')?.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      nav.querySelector('.site-menu-toggle')?.setAttribute('aria-expanded', String(open));
    });
    document.body.classList.add('site-header-enabled');
    accountLink = document.getElementById('header-account-link');
  }

  window.updateHeaderAuth = function (user) {
    if (!accountLink) accountLink = document.getElementById('header-account-link');
    if (accountLink) {
      accountLink.textContent = user ? (user.displayName || user.email?.split('@')[0] || 'Account') : 'Account';
    }
  };

  document.addEventListener('DOMContentLoaded', renderHeader);
})();
