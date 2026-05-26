(function () {
  let root = null;
  let resolver = null;

  function ensureRoot() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'app-dialog-root';
    root.className = 'app-dialog-root';
    root.hidden = true;
    root.innerHTML = `
      <div class="app-dialog-backdrop" data-dialog-dismiss></div>
      <div class="app-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
        <div class="app-dialog-header">
          <span class="app-dialog-icon material-symbols-outlined" id="app-dialog-icon" aria-hidden="true"></span>
          <h2 class="app-dialog-title" id="app-dialog-title"></h2>
          <button type="button" class="app-dialog-close material-symbols-outlined" data-dialog-dismiss aria-label="Close">close</button>
        </div>
        <div class="app-dialog-body" id="app-dialog-body"></div>
        <div class="app-dialog-actions" id="app-dialog-actions"></div>
      </div>`;
    document.body.appendChild(root);
    root.querySelectorAll('[data-dialog-dismiss]').forEach((el) => {
      el.addEventListener('click', () => {
        if (el.classList.contains('app-dialog-backdrop') && root.dataset.allowOutside === 'false') return;
        close({ isDismissed: true });
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && root && !root.hidden) close({ isDismissed: true });
    });
    return root;
  }

  function iconName(kind) {
    const map = {
      success: 'check_circle',
      error: 'error',
      warning: 'warning',
      info: 'info',
      question: 'help',
    };
    return map[kind] || 'info';
  }

  function close(result = { isDismissed: true }) {
    if (!root) return;
    root.hidden = true;
    document.body.classList.remove('app-dialog-open');
    if (resolver) {
      const fn = resolver;
      resolver = null;
      fn(result);
    }
  }

  function open(options = {}) {
    const el = ensureRoot();
    el.dataset.allowOutside = options.allowOutsideClick === false ? 'false' : 'true';
    el.classList.toggle('app-dialog-form', !!options.form);
    el.classList.toggle(`app-dialog-${options.icon || 'info'}`, true);

    const titleEl = el.querySelector('#app-dialog-title');
    const bodyEl = el.querySelector('#app-dialog-body');
    const actionsEl = el.querySelector('#app-dialog-actions');
    const iconEl = el.querySelector('#app-dialog-icon');

    titleEl.textContent = options.title || '';
    iconEl.textContent = iconName(options.icon);
    bodyEl.innerHTML = options.html || '';
    if (!options.html && (options.text || options.message)) {
      bodyEl.innerHTML = `<p class="app-dialog-text">${options.text || options.message}</p>`;
    }

    actionsEl.innerHTML = '';
    const buttons = [];
    if (options.showDenyButton) {
      buttons.push({ id: 'deny', label: options.denyButtonText || 'No', kind: 'secondary', result: { isDenied: true } });
    }
    if (options.showCancelButton) {
      buttons.push({ id: 'cancel', label: options.cancelButtonText || 'Cancel', kind: 'secondary', result: { isDismissed: true } });
    }
    buttons.push({
      id: 'confirm',
      label: options.confirmButtonText || 'OK',
      kind: 'primary',
      result: { isConfirmed: true },
    });

    const reverse = options.reverseButtons !== false;
    (reverse ? buttons.reverse() : buttons).forEach((btn) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `btn ${btn.kind === 'primary' ? 'btn-primary' : 'btn-secondary'} app-dialog-btn`;
      button.textContent = btn.label;
      button.addEventListener('click', async () => {
        if (btn.id === 'confirm' && typeof options.preConfirm === 'function') {
          const ok = await options.preConfirm();
          if (ok === false) return;
        }
        close(btn.result);
      });
      actionsEl.appendChild(button);
    });

    el.hidden = false;
    document.body.classList.add('app-dialog-open');
    if (typeof options.didOpen === 'function') options.didOpen();

    const focusTarget = actionsEl.querySelector('.btn-primary') || actionsEl.querySelector('.btn');
    focusTarget?.focus();

    return new Promise((resolve) => {
      resolver = resolve;
    });
  }

  window.AppDialog = { open, close };
})();
