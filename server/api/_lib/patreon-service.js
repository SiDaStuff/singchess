const crypto = require('crypto');
const { fetchCompat } = require('./fetch-compat');
const { initAdmin, patchProfile } = require('./user-service');

const TOKEN_URL = 'https://www.patreon.com/api/oauth2/token';
const IDENTITY_URL = 'https://www.patreon.com/api/oauth2/v2/identity';

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing ${name} environment variable.`);
  return value;
}

function patreonClient() {
  return {
    clientId: requiredEnv('PATREON_CLIENT_ID'),
    clientSecret: requiredEnv('PATREON_CLIENT_SECRET'),
    redirectUri: requiredEnv('PATREON_REDIRECT_URI'),
  };
}

function randomState() {
  return crypto.randomBytes(18).toString('hex');
}

function formBody(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

async function exchangeAuthCodeForToken(code) {
  const { clientId, clientSecret, redirectUri } = patreonClient();
  const body = formBody({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  const res = await fetchCompat(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error_description || json?.error || `Patreon token exchange failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = patreonClient();
  const body = formBody({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetchCompat(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error_description || json?.error || `Patreon token refresh failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

async function fetchIdentity(accessToken) {
  const url = `${IDENTITY_URL}?include=memberships.currently_entitled_tiers`
    + `&fields%5Buser%5D=email,full_name,vanity`
    + `&fields%5Bmember%5D=patron_status,last_charge_status,currently_entitled_amount_cents`
    + `&fields%5Btier%5D=title,amount_cents`;
  const res = await fetchCompat(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.errors?.[0]?.detail || json?.error || `Patreon identity request failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

function isActiveMembership(member = {}) {
  const attrs = member.attributes || {};
  const patronStatus = String(attrs.patron_status || '').toLowerCase();
  const lastCharge = String(attrs.last_charge_status || '').toLowerCase();
  const entitled = Number(attrs.currently_entitled_amount_cents || 0);
  const activeStatus = patronStatus.includes('active');
  const notDeclined = lastCharge !== 'declined';
  return activeStatus && notDeclined && entitled > 0;
}

function parseBoostFromIdentity(identityJson) {
  const included = Array.isArray(identityJson?.included) ? identityJson.included : [];
  const memberships = included.filter((x) => x && x.type === 'member');
  const activeMember = memberships.find(isActiveMembership) || null;
  const tiers = included
    .filter((x) => x && x.type === 'tier')
    .map((tier) => ({
      id: tier.id,
      title: String(tier.attributes?.title || ''),
      amount_cents: Number(tier.attributes?.amount_cents || 0),
    }));
  return {
    isBoost: !!activeMember,
    patronStatus: String(activeMember?.attributes?.patron_status || ''),
    lastChargeStatus: String(activeMember?.attributes?.last_charge_status || ''),
    entitledAmountCents: Number(activeMember?.attributes?.currently_entitled_amount_cents || 0),
    tiers,
  };
}

async function storePatreonForUid(uid, tokenJson, identityJson) {
  const now = Date.now();
  const boost = parseBoostFromIdentity(identityJson);
  const accessToken = String(tokenJson.access_token || '');
  const refreshToken = String(tokenJson.refresh_token || '');
  const expiresIn = Math.max(0, Number(tokenJson.expires_in) || 0);

  const patch = {
    patreon: {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: expiresIn ? now + (expiresIn * 1000) : 0,
      lastCheckedAt: now,
      boost: {
        isBoost: boost.isBoost,
        patronStatus: boost.patronStatus,
        lastChargeStatus: boost.lastChargeStatus,
        entitledAmountCents: boost.entitledAmountCents,
        tiers: boost.tiers,
      },
    },
    subscription: boost.isBoost
      ? { plan: 'boost', theme: 'purple', provider: 'patreon', checkedAt: now, expiresAt: now + (36 * 60 * 60 * 1000) }
      : { plan: 'free', provider: 'patreon', checkedAt: now, expiresAt: now + (36 * 60 * 60 * 1000) },
  };

  await patchProfile(uid, patch);
  return boost;
}

async function saveOAuthState(uid, state, returnTo) {
  const { db, admin } = initAdmin();
  await db.ref(`oauthStates/patreon/${state}`).set({
    uid,
    returnTo: String(returnTo || '/boost').slice(0, 120),
    createdAt: admin.database.ServerValue.TIMESTAMP,
  });
}

async function consumeOAuthState(state) {
  const { db } = initAdmin();
  const ref = db.ref(`oauthStates/patreon/${state}`);
  const snap = await ref.once('value');
  const value = snap.val() || null;
  await ref.remove().catch(() => {});
  return value;
}

function authorizeUrl(state) {
  const { clientId, redirectUri } = patreonClient();
  const scope = encodeURIComponent('identity identity.memberships');
  return `https://www.patreon.com/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${encodeURIComponent(state)}`;
}

async function ensurePatreonFresh(uid, profile = {}, { maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  const now = Date.now();
  const patreon = profile.patreon || {};
  const lastCheckedAt = Number(patreon.lastCheckedAt) || 0;
  if (lastCheckedAt && (now - lastCheckedAt) < maxAgeMs) return { refreshed: false };

  const refreshToken = String(patreon.refreshToken || '').trim();
  if (!refreshToken) return { refreshed: false, error: 'missing_refresh_token' };

  const tokenJson = await refreshAccessToken(refreshToken);
  const identityJson = await fetchIdentity(String(tokenJson.access_token || ''));
  const boost = await storePatreonForUid(uid, tokenJson, identityJson);
  return { refreshed: true, boost };
}

module.exports = {
  randomState,
  saveOAuthState,
  consumeOAuthState,
  authorizeUrl,
  exchangeAuthCodeForToken,
  fetchIdentity,
  storePatreonForUid,
  ensurePatreonFresh,
};

