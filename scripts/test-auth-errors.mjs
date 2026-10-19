import assert from 'node:assert/strict';
import { friendlyAuthError, validEmail } from '../src/auth-errors.js';
assert.equal(validEmail('player@example.com'), true);
for (const email of ['', 'player', '@example.com', 'player@', 'a b@example.com', 'one@example.com@two.com']) assert.equal(validEmail(email), false);
for (const code of ['auth/invalid-email', 'auth/weak-password', 'auth/popup-blocked', 'auth/expired-action-code', 'auth/network-request-failed', 'auth/unauthorized-domain', 'auth/invalid-credential']) {
  const message = friendlyAuthError({ code, message: `Firebase: raw message (${code}).` });
  assert.ok(message && !message.includes('Firebase:') && !message.includes('auth/'));
}
assert.match(friendlyAuthError({ code: 'auth/invalid-email' }), /valid email address/);
assert.match(friendlyAuthError({ statusCode: 503, message: 'SQLite driver failed' }), /temporarily unavailable/);
assert.match(friendlyAuthError({ code: 'origin_not_allowed' }), /website address/);
assert.equal(friendlyAuthError({ code: 'auth/unknown-new-code', message: 'Firebase: internal details' }).includes('internal details'), false);
console.log('PASS readable auth errors, valid-email checks, popup/reset messages and safe unknown-error fallback');
