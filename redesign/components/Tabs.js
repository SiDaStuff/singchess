// =============================================================================
// Tabs.js — Sing Chess redesign
//
// Mobile bottom-tab switching. Mirrors the proven approach from the existing
// mobile layout: toggles body classes (mobile-tab-moves, -graph, -insights)
// that CSS uses to reveal/hide the matching analysis panel. Default tab is
// "feedback" (no class = feedback visible).
//
// On desktop (≥768px) the tabs are hidden and every panel is stacked.
// =============================================================================

const TAB_BODY_CLASSES = {
  feedback: null,        // default — no class needed
  moves: 'mobile-tab-moves',
  graph: 'mobile-tab-graph',
  insights: 'mobile-tab-insights',
};

/** @param {string} tab */
function applyTab(tab) {
  const cls = TAB_BODY_CLASSES[tab];
  document.body.classList.remove(
    'mobile-tab-moves',
    'mobile-tab-graph',
    'mobile-tab-insights'
  );
  if (cls) document.body.classList.add(cls);

  document.querySelectorAll('.sc-tab').forEach((btn) => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  document.body.dataset.mobileTab = tab;
}

export default function initTabs({ selector = '#sc-mobile-tabs' } = {}) {
  const bar = document.querySelector(selector);
  if (!bar) return;

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('.sc-tab');
    if (!btn || !btn.dataset.tab) return;
    applyTab(btn.dataset.tab);
  });

  // Set default tab without a class (feedback)
  const initial = [...bar.querySelectorAll('.sc-tab.is-active')][0]?.dataset.tab || 'feedback';
  applyTab(initial);
}
