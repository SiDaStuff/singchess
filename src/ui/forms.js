// Email/password forms share the same keyboard behavior as native forms,
// while the existing controller continues to own validation and requests.
document.addEventListener('DOMContentLoaded', () => {
  const groups = [
    [['login-email', 'login-password'], 'btn-login-submit'],
    [['signup-username', 'signup-email', 'signup-password'], 'btn-signup-submit'],
    [['auth-email', 'auth-password'], 'btn-auth-submit'],
    [['reset-email', 'reset-new-password', 'reset-confirm-password'], 'btn-reset-password'],
  ];
  for (const [fields, action] of groups) {
    for (const id of fields) {
      document.getElementById(id)?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.isComposing || event.defaultPrevented) return;
        const button = document.getElementById(action);
        if (!button || button.disabled) return;
        event.preventDefault();
        button.click();
      });
    }
  }
});
