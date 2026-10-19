export function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

export function friendlyAuthError(error) {
  const messages = {
    'auth/invalid-email': 'Enter a valid email address, such as name@example.com.',
    'auth/missing-email': 'Enter your email address.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/user-not-found': 'Email or password is incorrect.',
    'auth/missing-password': 'Enter your password.',
    'auth/weak-password': 'Choose a stronger password with at least 6 characters.',
    'auth/email-already-in-use': 'An account already exists for that email. Sign in or reset your password.',
    'auth/too-many-requests': 'Too many attempts. Please wait a few minutes before trying again.',
    'auth/network-request-failed': 'Could not connect. Check your connection and try again.',
    'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow popups for this site and try again.',
    'auth/popup-closed-by-user': 'The sign-in window was closed. Try again when you are ready.',
    'auth/cancelled-popup-request': 'A sign-in window is already open. Finish signing in there.',
    'auth/account-exists-with-different-credential': 'This email uses another sign-in method. Use the method you originally chose.',
    'auth/unauthorized-domain': 'Google sign-in is unavailable on this website address. Please contact support.',
    'auth/operation-not-allowed': 'This sign-in method is currently unavailable.',
    'auth/invalid-action-code': 'This reset link is invalid or has already been used. Request a new link.',
    'auth/expired-action-code': 'This reset link has expired. Request a new link.',
    'auth/requires-recent-login': 'Sign in again before changing this account setting.',
    'auth/user-disabled': 'This account is disabled. Please contact support.',
    'auth/id-token-expired': 'Your session expired. Please sign in again.',
    'auth/id-token-revoked': 'Your session expired. Please sign in again.',
    'origin_not_allowed': 'The account service does not allow this website address. Please contact support.',
  };
  const code = String(error?.code || '');
  if (messages[code]) return messages[code];
  if (error?.name === 'AbortError') return 'The request took too long. Please try again.';
  if (error?.statusCode >= 500) return 'The account service is temporarily unavailable. Please try again.';
  if (code.startsWith('auth/') || /^Firebase:/i.test(error?.message || '')) return 'Unable to complete sign-in. Please try again or contact support.';
  return error?.message || 'Unable to complete sign-in. Please try again.';
}
