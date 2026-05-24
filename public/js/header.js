(function () {
  const links = [
    ['/', 'Home'],
    ['/review.html', 'Review'],
    ['/coach.html', 'Coach'],
    ['/puzzles.html', 'Puzzles'],
    ['/anticheat.html', 'Anticheat'],
    ['/boost.html', 'Boost'],
    ['/account.html', 'Account'],
    ['/settings.html', 'Settings'],
  ];

  function activeHref() {
    const path = window.location.pathname || '/';
    return path;
  }

  let accountLink = null;

  function renderHeader() {
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
        ${links.map(([href, label]) => `<a href="${href}" class="${current === href ? 'active' : ''}" ${href === '/account.html' ? 'id="header-account-link"' : ''}>${label}</a>`).join('')}
      </nav>
    `;
    const placeholder = document.querySelector('[data-site-header]');
    if (placeholder) placeholder.replaceWith(nav);
    else document.body.insertBefore(nav, document.body.firstChild);
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
