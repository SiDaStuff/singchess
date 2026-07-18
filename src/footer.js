(function () {
  function renderFooter() {
    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML = `
      <span>SiDaStuff Chess</span>
      <nav aria-label="Footer navigation">
        <a href="/plans">Plans</a>
        <a href="/settings">Settings</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/contact">Contact</a>
      </nav>
    `;
    const placeholder = document.querySelector('[data-site-footer]');
    if (placeholder) placeholder.replaceWith(footer);
    else document.body.appendChild(footer);
  }

  document.addEventListener('DOMContentLoaded', renderFooter);
})();
