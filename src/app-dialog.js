(function () {
  function normalizeOptions(options = {}) {
    return {
      icon: options.icon || 'info',
      title: options.title || '',
      html: options.html,
      text: options.text || options.message || '',
      input: options.input,
      inputValue: options.inputValue,
      inputPlaceholder: options.inputPlaceholder,
      inputAttributes: options.inputAttributes,
      inputValidator: options.inputValidator,
      showConfirmButton: options.showConfirmButton !== false,
      confirmButtonText: options.confirmButtonText || 'OK',
      showCancelButton: !!options.showCancelButton,
      cancelButtonText: options.cancelButtonText || 'Cancel',
      showDenyButton: !!options.showDenyButton,
      denyButtonText: options.denyButtonText || 'No',
      reverseButtons: options.reverseButtons !== false,
      allowOutsideClick: options.allowOutsideClick !== false,
      allowEscapeKey: options.allowEscapeKey !== false,
      preConfirm: options.preConfirm,
      didOpen: options.didOpen,
      didClose: options.didClose,
      footer: options.footer,
      customClass: options.customClass,
    };
  }

  async function open(options = {}) {
    if (window.Swal?.fire) {
      return window.Swal.fire(normalizeOptions(options));
    }

    const message = [options.title, options.text || options.message || ''].filter(Boolean).join('\n');
    if (options.input === 'text') {
      const value = window.prompt(message, options.inputValue || '');
      return { isConfirmed: value !== null, isDismissed: value === null, value };
    }
    const confirmed = !options.showCancelButton || window.confirm(message);
    return { isConfirmed: confirmed, isDismissed: !confirmed };
  }

  function close() {
    if (window.Swal?.close) window.Swal.close();
  }

  window.AppDialog = { open, close };
})();
