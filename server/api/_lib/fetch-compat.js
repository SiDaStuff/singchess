const http = require('http');
const https = require('https');

// ── SSRF protection ──────────────────────────────────────────────────
// Whitelist of allowed hostnames for external API calls.
// This prevents the server from being used to reach internal services,
// cloud metadata endpoints (169.254.169.254), or localhost.
const ALLOWED_HOSTNAMES = new Set([
  'lichess.org',
  'www.lichess.org',
  'api.chess.com',
  'www.chess.com',
  'fonts.googleapis.com',
  'accounts.google.com',
  'oauth2.googleapis.com',
  'content-patreon-production.s3.amazonaws.com',
  'api.patreon.com',
]);

// Check if a hostname is an IP address (v4 or v6)
function isIpAddress(hostname) {
  // IPv4: digits and dots only, 4 groups
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  // IPv6: contains colons
  if (hostname.includes(':')) return true;
  // IPv4-mapped IPv6
  if (hostname.includes('::ffff:')) return true;
  return false;
}

// Check if an IPv4 octet array is private/reserved
function isPrivateIp(octets) {
  const [a, b] = octets;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local / cloud metadata)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8
  if (a === 0) return true;
  return false;
}

function isSafeHostname(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  // Allow explicit whitelisted hostnames
  if (ALLOWED_HOSTNAMES.has(h)) return true;
  // Block all IP addresses (prevents SSRF via numeric IP)
  if (isIpAddress(h)) return false;
  return false; // only whitelisted hostnames are allowed
}

function validateUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('Invalid URL.');
  }
  // Only allow http and https
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are allowed.');
  }
  // Block IP addresses and non-whitelisted hosts
  const hostname = parsed.hostname.toLowerCase();
  if (!isSafeHostname(hostname)) {
    throw new Error('Access to this host is not allowed.');
  }
  return parsed;
}

function fetchCompat(url, options = {}, redirectCount = 0) {
  if (typeof fetch === 'function') return fetch(url, options);
  const parsed = validateUrl(url);
  return new Promise((resolve, reject) => {
    try {
      const transport = parsed.protocol === 'http:' ? http : https;
      const req = transport.request({
        method: options.method || 'GET',
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: parsed.pathname + parsed.search,
        headers: options.headers || {},
      }, (res) => {
        // Handle redirects manually with a safe count limit
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectCount < 4) {
          res.resume();
          // Validate the redirect target to prevent SSRF via redirect
          fetchCompat(new URL(res.headers.location, parsed).toString(), options, redirectCount + 1).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: res.headers,
            text: async () => body,
            json: async () => JSON.parse(body || 'null'),
          });
        });
      });
      req.on('error', reject);
      if (options.body) req.write(options.body);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { fetchCompat };
