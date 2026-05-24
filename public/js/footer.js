(function () {
  function renderFooter() {
    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML = `
      <span>SiDaStuff Chess</span>
      <nav aria-label="Footer navigation">
        <a href="/boost.html">Boost</a>
        <a href="/settings.html">Settings</a>
      </nav>
    `;
    const placeholder = document.querySelector('[data-site-footer]');
    if (placeholder) placeholder.replaceWith(footer);
    else document.body.appendChild(footer);
  }

  document.addEventListener('DOMContentLoaded', renderFooter);
})();
