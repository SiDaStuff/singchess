import DOMPurify from 'dompurify';

if (window.trustedTypes && !window.trustedTypes.defaultPolicy) {
  window.trustedTypes.createPolicy('default', {
    createHTML: input => DOMPurify.sanitize(input, { RETURN_TRUSTED_TYPE: false, ADD_ATTR: ['target'] }),
    createScriptURL: input => {
      const url = new URL(input, location.href);
      const scriptHosts = ['www.google.com', 'www.gstatic.com', 'www.googletagmanager.com', 'apis.google.com', 'singchess-sd.firebaseapp.com'];
      if (url.origin === location.origin || url.protocol === 'blob:' && url.origin === location.origin
        || url.protocol === 'https:' && scriptHosts.includes(url.hostname)) return url.href;
      throw new TypeError('Untrusted script URL');
    },
  });
}
