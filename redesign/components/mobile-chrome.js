// =============================================================================
// mobile-chrome.js — review-view bottom tab bar (mobile)
//
// For phones (≤1024px), the review column previously stacked Feedback / Moves /
// Graph into one long scroll. This adds a fixed bottom tab bar so the user can
// switch between the three core analysis sections with a thumb, revealing one
// at a time.
//
// How it knows it's in the review view WITHOUT touching the 12k-line app.js:
// the "Move Feedback" card (#live-eval) is `hidden` in the HTML and app.js
// un-hides it once a game is loaded into review mode. So the bar is shown only
// while (viewport ≤1024px) AND (#live-eval is visible).
//
// Visibility is a pure CSS concern (body classes + the [hidden] attribute);
// this module only reflects state. The .sc-tabbar markup lives in index.html
// (#sc-mobile-tabs). State is driven by:
//   • body.sc-mobile-tabs-shown        → bar is on (mobile + review active)
//   • body.mobile-tab-<feedback|moves|graph> → which panel is revealed
// =============================================================================

const TABS = ['feedback', 'moves', 'graph'];
const MOBILE_MQ = '(max-width: 1024px)';

export default function initMobileChrome() {
  const bar = document.getElementById('sc-mobile-tabs');
  if (!bar) return;
  const liveEval = document.getElementById('live-eval');
  const mq = window.matchMedia(MOBILE_MQ);

  /** The review flow is active only while the Move-Feedback card is shown. */
  function isReviewActive() {
    return !!liveEval && liveEval.hidden === false;
  }

  let current = 'feedback';
  // Each tab owns its analysis panel(s). `inert` on non-active panels keeps
  // their content out of the tab order on mobile.
  const PANEL_MAP = {
    feedback: [document.getElementById('live-eval')],
    moves: [document.getElementById('move-list-container')],
    graph: [document.getElementById('eval-graph-card')],
  };

  function setTab(tab) {
    if (!TABS.includes(tab)) return;
    current = tab;
    // Only one is-active tab + one mobile-tab-<x> body class at a time.
    const wasKeyboard = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('sc-tab');
    bar.querySelectorAll('.sc-tab').forEach((b) => {
      const active = b.dataset.tab === tab;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
      b.setAttribute('tabindex', active ? '0' : '-1');
    });
    document.body.classList.forEach((c) => {
      if (c.startsWith('mobile-tab-')) document.body.classList.remove(c);
    });
    document.body.classList.add(`mobile-tab-${tab}`);
    // Only the active panel is interactive; keep the others out of the tab order
    // so a keyboard user can't tab into content they can't see.
    PANEL_MAP[tab]?.forEach((panel) => { if (panel) panel.inert = false; });
    Object.keys(PANEL_MAP).forEach((k) => {
      if (k === tab) return;
      PANEL_MAP[k]?.forEach((panel) => { if (panel) panel.inert = true; });
    });
    // Keep keyboard focus moving with the arrow-key roving selection.
    if (wasKeyboard) {
      const activeBtn = bar.querySelector('.sc-tab[aria-selected="true"]');
      if (activeBtn) activeBtn.focus();
    }
  }

  function apply() {
    const show = mq.matches && isReviewActive();
    bar.hidden = !show;
    document.body.classList.toggle('sc-mobile-tabs-shown', show);
    // Default to Feedback whenever the bar appears, so state never goes stale
    // after a desktop↔mobile resize or a route round-trip.
    if (show) setTab(current);
  }

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('.sc-tab');
    if (!btn) return;
    setTab(btn.dataset.tab);
  });

  // Roving tabindex + arrow-key navigation so the tab bar is keyboard-usable.
  bar.addEventListener('keydown', (e) => {
    if (!e.target.classList?.contains('sc-tab')) return;
    const idx = TABS.indexOf(e.target.dataset.tab);
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next]);
  });

  // Reflect changes the app drives (leaving/entering review) and viewport.
  if (liveEval) {
    const obs = new MutationObserver(() => apply());
    obs.observe(liveEval, { attributes: true, attributeFilter: ['hidden'] });
  }
  mq.addEventListener('change', () => apply());
  window.addEventListener('popstate', () => apply());
  // Lightweight poll as a fallback for any DOM rebuilds the observer misses.
  // (Runs for the SPA's lifetime; each check is a single style/attribute read.)
  setInterval(() => apply(), 1200);

  apply();
}