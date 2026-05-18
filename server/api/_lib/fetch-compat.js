const http = require('http');
const https = require('https');

function fetchCompat(url, options = {}, redirectCount = 0) {
  if (typeof fetch === 'function') return fetch(url, options);
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const transport = parsed.protocol === 'http:' ? http : https;
      const req = transport.request({
        method: options.method || 'GET',
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: parsed.pathname + parsed.search,
        headers: options.headers || {},
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectCount < 4) {
          res.resume();
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
