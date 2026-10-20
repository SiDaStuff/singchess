import './ui/runtime-libraries.js';
import './ui/trusted-types.js';
import './ui/critical.css';

// Home is already in the HTML and can paint while controllers download.
const application = import('./application.js');
let ready = false;
const controlsReady = new Promise(resolve => window.addEventListener('app:ready', () => { ready = true; resolve(); }, { once: true }));
application.catch(error => {
  console.error('Application could not load:', error);
  document.getElementById('app-load-error')?.removeAttribute('hidden');
});
document.addEventListener('click', event => {
  if (ready || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const control = event.target.closest('button, a[data-route]');
  if (!control) return;
  event.preventDefault(); event.stopImmediatePropagation();
  application.then(() => controlsReady).then(() => { if (control.isConnected) control.click(); });
}, true);
