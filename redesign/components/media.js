// media.js — small breakpoint helpers used by Tabs.js / Drawer.js
// < 768px is the mobile layout (header + board + tabs + drawer).
export const MOBILE_MQ = '(max-width: 767px)';

export function matchesMobile() {
  return window.matchMedia(MOBILE_MQ).matches;
}
