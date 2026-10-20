// Feature chunks may arrive after DOMContentLoaded. Preserve registration order
// without making a late navigation depend on an event that already fired.
export function onReady(callback) {
  const run = () => setTimeout(callback, 0);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
}
