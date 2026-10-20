import { onReady } from './ready.js';

// Keep bound controls and their state, but remove inactive pages from the live
// DOM. Revisiting a page reuses its nodes and listeners instead of rebuilding.
onReady(() => {
  const app = window.app;
  if (!app) return;
  const pages = [...document.querySelectorAll('#app > .page-panel, #workspace')].map(node => {
    const marker = document.createComment(node.id);
    node.before(marker);
    return { node, marker };
  });
  const restore = () => {
    for (const { node, marker } of pages) if (!node.isConnected) marker.after(node);
  };
  let queued = false;
  const prune = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const workspaceHidden = document.body.classList.contains('menu-active') || document.body.classList.contains('in-app-route');
      for (const { node } of pages) if (node.id === 'workspace' ? workspaceHidden : node.hidden) node.remove();
    });
  };
  // These cross-page operations intentionally update hidden controls too.
  for (const name of ['_applyRoute', '_showRoutePage', '_activateGameLayout', '_syncAccountUi', '_renderSpaAccount',
    '_loadAppearanceSettingsIntoUi', '_applyAppearanceSettings', '_syncAdminControlsVisibility']) {
    const original = app[name].bind(app);
    app[name] = (...args) => {
      restore();
      try {
        const result = original(...args);
        if (name === '_showRoutePage' && args[0] === 'settings') window.QualityOfLife?.applyPreferences();
        return result;
      } finally { prune(); }
    };
  }
  window.RoutePages = { find: id => pages.find(page => page.node.id === id)?.node };
  prune();
  window.dispatchEvent(new CustomEvent('app:ready'));
});
