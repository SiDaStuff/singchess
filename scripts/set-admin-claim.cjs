#!/usr/bin/env node
// Grant (or revoke) the `admin` Firebase custom claim for a user.
//
// Admin access is now driven by the `admin: true` custom claim (see
// server/api/_lib/user-service.js requireUser), with a legacy hardcoded-email
// fallback. Run this to grant admin to an operator by username or email.
//
// Usage:
//   node scripts/set-admin-claim.js            # prompts for the identifier
//   node scripts/set-admin-claim.js alice      # grant by username or email
//   node scripts/set-admin-claim.js alice --remove   # revoke admin
//
// Reads SERVICE_ACCOUNT + REALTIME_DATABASE_URL from the repo root .env
// (same file the server reads). The change takes effect on the user's NEXT
// sign-in / token refresh (Firebase caches the previous token until it expires
// — typically under an hour; signing out and back in applies it immediately).

const path = require('path');
const fs = require('fs');
const readline = require('readline');

// Load env exactly like server/index.cjs (repo-root .env, falling back to server/.env).
const rootEnv = path.resolve(__dirname, '..', '.env');
try {
  require('dotenv').config({ path: fs.existsSync(rootEnv) ? rootEnv : path.resolve(__dirname, '..', 'server', '.env') });
} catch (_) { /* dotenv optional */ }

function parseServiceAccount() {
  const raw = process.env.service_account || process.env.SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!raw) return null;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (parsed.private_key) parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
  return parsed;
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

(async () => {
  let admin;
  try { admin = require('firebase-admin'); }
  catch (_) { console.error('firebase-admin is not installed. Run: npm install firebase-admin'); process.exit(1); }

  const serviceAccount = parseServiceAccount();
  if (!serviceAccount) {
    console.error('SERVICE_ACCOUNT env var is not set. Make sure your .env contains the Firebase service-account JSON.');
    process.exit(1);
  }
  const databaseURL = (process.env.realtime_database_url || process.env.REALTIME_DATABASE_URL || '').replace(/\/+$/, '');
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: databaseURL || undefined });
  }

  let identifier = process.argv[2];
  if (!identifier || identifier.startsWith('-')) identifier = await ask('Username or email to grant admin: ');
  const remove = process.argv.includes('--remove') || process.argv.includes('-r');
  if (!identifier) { console.error('No identifier provided.'); process.exit(1); }

  // Resolve by email if it looks like one, else look up the username index.
  let user;
  const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(identifier);
  try {
    user = isEmail
      ? await admin.auth().getUserByEmail(identifier)
      : await admin.auth().getUserByPhoneNumber(identifier);
  } catch (_) {
    // Try the username index in RTDB (lowercased key -> uid).
    let uid = null;
    if (databaseURL) {
      try {
        const key = identifier.toLowerCase();
        const snap = await admin.database().ref(`usernames/${key}`).once('value');
        if (snap.exists()) uid = snap.val();
      } catch (_) {}
    }
    if (!uid) {
      console.error(`Could not find a Firebase user for "${identifier}".`);
      console.error('Tip: pass the exact sign-in email, or a username that exists in the usernames/ index.');
      process.exit(1);
    }
    user = await admin.auth().getUser(uid);
  }

  // Merge into existing claims so we don't clobber other custom claims.
  const existing = user.customClaims || {};
  const claims = remove ? { ...existing, admin: false } : { ...existing, admin: true };
  await admin.auth().setCustomUserClaims(user.uid, claims);

  console.log(`\n${remove ? 'Revoked' : 'Granted'} admin claim for:`);
  console.log(`  uid:    ${user.uid}`);
  console.log(`  email:  ${user.email || '(none)'}`);
  if (user.displayName) console.log(`  name:   ${user.displayName}`);
  console.log(`\nThe user must sign out and back in (or wait ~1h for token refresh) for it to take effect.`);
  process.exit(0);
})().catch((err) => {
  console.error('Failed:', err && err.message ? err.message : err);
  process.exit(1);
});
