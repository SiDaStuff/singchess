// =============================================================================
// Drawer.js — Sing Chess redesign
//
// Mobile slide-out sidebar. Under 768px the sidebar is off-canvas and a
// #sc-menu-trigger button (in Header.html) opens it as a drawer with a scrim
// backdrop. Above 768px the sidebar is a fixed column and this module is inert.
//
// Accessibility: toggles aria-expanded on the trigger, traps nothing (the
// scrim + Escape is enough for a nav drawer). Closes on scrim click, Escape,
// or nav-link click.
// =============================================================================

import { matchesMobile } from './media.js';

/** @returns {boolean} true when the drawer should be active (< 768px) */
function isMobile() {
  return matchesMobile();
}

function setExpanded(open) {
  const trigger = document.getElementById('sc-menu-trigger');
  const sidebar = document.getElementById('sc-sidebar');
  const scrim = document.getElementById('sc-scrim');
  if (!sidebar || !scrim) return;

  document.body.classList.toggle('drawer-open', open);
  sidebar.classList.toggle('is-open', open);
  if (trigger) trigger.setAttribute('aria-expanded', String(open));
  scrim.hidden = !open;
}

export default function initDrawer() {
  const trigger = document.getElementById('sc-menu-trigger');
  const scrim = document.getElementById('sc-scrim');
  const sidebar = document.getElementById('sc-sidebar');
  if (!trigger || !scrim || !sidebar) return;

  trigger.addEventListener('click', () => {
    const open = document.body.classList.contains('drawer-open');
    setExpanded(!open);
  });

  scrim.addEventListener('click', () => setExpanded(false));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) {
      setExpanded(false);
    }
  });

  // Close after navigating
  sidebar.addEventListener('click', (e) => {
    if (e.target.closest('[data-route]')) setExpanded(false);
  });

  // If we cross the desktop/mobile boundary while open, reset.
  window.addEventListener('resize', () => {
    if (!isMobile()) setExpanded(false);
  }, { passive: true });
}

export { setExpanded };
