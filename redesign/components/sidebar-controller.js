// =============================================================================
// sidebar.js — make the fixed .sc-sidebar fully functional.
//
// The production app ships a fixed .sc-sidebar (src/ui/styles.css) but has no
// JS to open it on mobile (its hamburger drives the old .apple-nav drawer).
// This module:
//   • Desktop (>1024px): nothing to do — the sidebar is fixed and content is
//     offset by the overlay CSS.
//   • Mobile (≤1024px): the hamburger (#apple-nav-toggle) opens the sidebar as
//     a slide-out drawer; the redundant .apple-nav is hidden by CSS.
//   • Closes on scrim tap, Escape, or any nav-link tap.
// =============================================================================

const MOBILE_MQ = '(max-width: 1024px)';

function isMobile() {
  return window.matchMedia(MOBILE_MQ).matches;
}

function setOpen(open) {
  const sidebar = document.getElementById('sc-sidebar');
  const scrim = document.getElementById('sc-scrim');
  const toggle = document.getElementById('apple-nav-toggle');
  if (!sidebar) return;

  sidebar.classList.toggle('is-open', open);
  document.body.classList.toggle('sc-sidebar-open', open);
  // The scrim's visibility is driven by .is-open (opacity + pointer-events),
  // not the hidden attribute.
  if (scrim) {
    scrim.classList.toggle('is-open', open);
    scrim.hidden = !open;
  }
  if (toggle) toggle.setAttribute('aria-expanded', String(open));
}

// Open the sidebar programmatically (used by the header bell shortcut to reach
// the sidebar Notifications section).
export function openSidebar() {
  setOpen(true);
}

export default function initSidebar() {
  // Let the vanilla-JS app (which doesn't import this module) open the drawer,
  // e.g. the header bell shortcut to the sidebar Notifications section.
  if (typeof window !== 'undefined') window.openSidebar = openSidebar;

  const toggle = document.getElementById('apple-nav-toggle');
  const scrim = document.getElementById('sc-scrim');
  const sidebar = document.getElementById('sc-sidebar');
  if (!toggle || !sidebar) return;

  // The production app.js also binds this toggle to open .apple-nav. We
  // override that by capturing the click first and stopping propagation so
  // only the sidebar drawer opens.
  toggle.addEventListener('click', (e) => {
    if (!isMobile()) return;
    e.preventDefault();
    e.stopPropagation();
    const open = !sidebar.classList.contains('is-open');
    setOpen(open);
  }, true); // capture phase so we run before app.js's handler

  if (scrim) {
    scrim.addEventListener('click', () => setOpen(false));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('is-open')) {
      setOpen(false);
    }
  });

  // Close after navigating.
  sidebar.addEventListener('click', (e) => {
    if (e.target.closest('[data-route]')) setOpen(false);
  });

  // Reset when crossing the desktop/mobile boundary.
  window.addEventListener('resize', () => {
    if (!isMobile()) setOpen(false);
  }, { passive: true });
}