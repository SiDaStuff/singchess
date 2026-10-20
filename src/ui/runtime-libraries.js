// Stable compat interfaces for the retained service and game controllers.
let dialogs;
window.Swal = {
  async fire(...args) {
    const runtime = await (dialogs ||= import('./dialog-runtime.js').then(runtime => { window.Swal = runtime.default; return runtime; }));
    return runtime.default.fire(...args);
  },
  showLoading(...args) { dialogs?.then(runtime => runtime.default.showLoading(...args)); },
  close(...args) { dialogs?.then(runtime => runtime.default.close(...args)); },
};
window.loadChessMarkdown = () => import('./markdown-runtime.js');
