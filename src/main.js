import './ui/styles.css';
// Redesign overlay — applies the premium all-white look to the working app.
// Loaded AFTER ui/styles.css + public/css/style.css so every redesign rule
// wins the cascade without touching app.js logic or DOM bindings.
import '../redesign/styles/redesign-overlay.css';
import './api-base.js';
import './pieces.js';
import './board.js';
import './ui/board.js';
import './engine.js';
import './chess-core.js';
import './app-dialog.js';
import './boost.js';
import './recaptcha.js';
import './coach-chat.js';
import './header.js';
import './footer.js';
import './app.js';
// Sidebar controller — wires the mobile hamburger to open the fixed
// .sc-sidebar drawer (the production app only drives the old .apple-nav).
// Imported last so it can capture the toggle click before app.js's handler.
import initSidebar from '../redesign/components/sidebar-controller.js';

document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
});