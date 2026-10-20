import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const digest = source => `sha256-${createHash('sha256').update(source).digest('base64')}`;

// External script hosts the app legitimately loads as <script src> elements
// (auth/CDN/analytics). Kept in sync with src/ui/trusted-types.js scriptHosts.
// These belong in script-src-elem: strict-dynamic only governs script-src and
// does NOT cover direct <script src> elements that third-party libs inject
// (e.g. Google's auth client loading https://apis.google.com/js/api.js).
const SCRIPT_ELEM_HOSTS = [
  'https://www.googletagmanager.com',
  'https://static.cloudflareinsights.com',
  'https://apis.google.com',
  'https://www.gstatic.com',
  'https://www.google.com',
  'https://singchess-sd.firebaseapp.com',
].join(' ');

export function siteOutputPlugin() {
  let backend;
  return {
    name: 'site-output', enforce: 'post',
    configResolved(config) { backend = config.env.VITE_API_URL || ''; },
    writeBundle(options) {
      const directory = options.dir || 'dist';
      const indexPath = path.join(directory, 'index.html');
      // Rollup appends sourceMappingURL after generateBundle. Hash the final
      // emitted bytes, and normalize HTML newlines as the browser does.
      let html = fs.readFileSync(indexPath, 'utf8').replace(/\r\n?/g, '\n');
      const hashes = [];
      // A previous build may have injected an import map. Strip it (and any
      // other import map) so stale hashed entries can't block module loads.
      html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/g, '');
      html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/g, (tag, attrs, body) => {
        const file = attrs.match(/src="\/([^"]+)"/)?.[1];
        if (file) {
          const integrity = digest(fs.readFileSync(path.join(directory, file)));
          hashes.push(`'${integrity}'`);
          return `<script${attrs.replace(/\s+integrity="[^"]*"/, '')} integrity="${integrity}">${body}</script>`;
        }
        if (body.trim()) hashes.push(`'${digest(body)}'`);
        return tag;
      });
      const policyPath = path.join(directory, 'security-policy.json');
      const { policy: draft, workerPolicy } = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
      const scriptHashes = [...new Set(hashes)].join(' ');
      const policy = draft
        .replace(/script-src [^;]+/, `script-src ${scriptHashes} 'sha256-5A3NWzXjNO0S6Fhf43TKDvk4Zo+rKWmsxGnzPlrbBiE=' 'strict-dynamic' 'wasm-unsafe-eval'`)
        .replace(/script-src-elem [^;]+/, `script-src-elem ${scriptHashes} 'sha256-5A3NWzXjNO0S6Fhf43TKDvk4Zo+rKWmsxGnzPlrbBiE=' 'self' ${SCRIPT_ELEM_HOSTS}`);
      fs.writeFileSync(indexPath, html);
      fs.writeFileSync(policyPath, JSON.stringify({ policy, workerPolicy }));
      fs.writeFileSync(path.join(directory, '_headers'), `/*\n  Content-Security-Policy: ${policy}\n  Link: </llms.txt>; rel="describedby"; type="text/markdown"\n/src/stockfish.worker.js\n  Content-Security-Policy: ${workerPolicy}\n`);
    },
    configurePreviewServer(server) {
      let security;
      server.middlewares.use((req, res, next) => {
        if (!security || !req.url?.startsWith('/assets/')) security = JSON.parse(fs.readFileSync('dist/security-policy.json', 'utf8'));
        res.setHeader('Content-Security-Policy', req.url?.startsWith('/src/stockfish.worker.js') ? security.workerPolicy : security.policy);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        if (/^\/assets\/[^/]+-[\w-]{8,}\.(js|css|woff2?|map)$/.test(req.url?.split('?')[0] || '')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        next();
      });
    },
    generateBundle(_options, bundle) {
      const entry = bundle['index.html'];
      if (!entry) return;
      let html = String(entry.source);
      // Home's critical CSS is small enough to inline. Other feature styles
      // remain in independently cached chunks, outside the first paint path.
      html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, tag => {
        const href = tag.match(/href="\/([^"]+)"/)?.[1], asset = bundle[href];
        // Vite's lazy-import helper checks for a stylesheet link before
        // requesting shared CSS. A disabled marker records the inlined sheet
        // without downloading or applying a second copy later in startup.
        return asset && href.endsWith('.css') ? `<style>${asset.source}</style><link rel="stylesheet" href="/${href}" disabled data-inline-css>` : tag;
      });
      const hashes = [];
      html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/g, (tag, attrs, body) => {
        const path = attrs.match(/src="\/([^"]+)"/)?.[1];
        if (path && bundle[path]?.type === 'chunk') {
          const integrity = digest(bundle[path].code); hashes.push(`'${integrity}'`);
          return `<script${attrs} integrity="${integrity}">${body}</script>`;
        }
        if (!path && body.trim()) hashes.push(`'${digest(body)}'`);
        return tag;
      });
      entry.source = html;
      // The application stylesheet (and its Inter font) is loaded after the
      // static home shell becomes interactive. Do not put that font back on
      // the first-load critical path with a preload hint.
      const origins = new Set(['https://mastermind.singdevelopments.com', 'https://chess.singdevelopments.com']);
      try { if (backend) origins.add(new URL(backend).origin); } catch {}
      const policy = [
        "default-src 'self'",
        `script-src ${hashes.join(' ')} 'sha256-5A3NWzXjNO0S6Fhf43TKDvk4Zo+rKWmsxGnzPlrbBiE=' 'strict-dynamic' 'wasm-unsafe-eval'`,
        `script-src-elem ${hashes.join(' ')} 'sha256-5A3NWzXjNO0S6Fhf43TKDvk4Zo+rKWmsxGnzPlrbBiE=' 'self' ${SCRIPT_ELEM_HOSTS}`,
        "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:", "font-src 'self'",
        `connect-src 'self' ${[...origins].join(' ')} https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebaseapp.com https://lichess.org https://*.lichess.org https://api.chess.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://www.google.com https://www.gstatic.com`,
        "frame-src https://*.firebaseapp.com",
        "worker-src 'self' blob:", "media-src 'self' blob:", "object-src 'none'", "base-uri 'none'",
        "form-action 'self'", "frame-ancestors 'none'",
        "require-trusted-types-for 'script'", "trusted-types default dompurify chess-templates index-script-url goog#html gapi#gapi",
      ].join('; ');
      this.emitFile({ type: 'asset', fileName: '_headers', source: `/*\n  Content-Security-Policy: ${policy}\n  Link: </llms.txt>; rel="describedby"; type="text/markdown"\n` });
      // The isolated worker imports only blobs created from its validated
      // Stockfish build. It has no DOM sinks and needs its own script policy.
      const workerPolicy = `default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; connect-src 'self' ${[...origins].join(' ')}; worker-src 'self' blob:; require-trusted-types-for 'script'; trusted-types singchess-worker-script`;
      this.emitFile({ type: 'asset', fileName: 'security-policy.json', source: JSON.stringify({ policy, workerPolicy }) });
      const catalog = fs.readFileSync('public/.well-known/ard.json', 'utf8');
      for (const fileName of ['ai-catalog.json', '.well-known/ai-catalog.json']) this.emitFile({ type: 'asset', fileName, source: catalog });
      const pages = fs.readFileSync('src/ui/templates/pages.html', 'utf8');
      for (const name of ['privacy', 'terms']) {
        const section = pages.match(new RegExp(`<section[^>]*id="page-${name}"[\\s\\S]*?<\\/section>`))?.[0] || '';
        const article = section.match(/<article[^>]*>([\s\S]*?)<\/article>/)?.[1] || '';
        const markdown = article.replace(/<h2>(.*?)<\/h2>/g, '\n## $1\n')
          .replace(/<li>/g, '\n- ').replace(/<\/p>/g, '\n\n').replace(/<strong>(.*?)<\/strong>/g, '**$1**')
          .replace(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g, '[$2]($1)').replace(/<[^>]*>/g, '')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/^[ \t]+/gm, '').replace(/\n{3,}/g, '\n\n').trim();
        const date = section.match(/Last updated: ([^<]+)/)?.[1] || '';
        this.emitFile({ type: 'asset', fileName: `${name}.md`, source: `# ${name === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}\n\nLast updated: ${date}\n\n${markdown}\n` });
      }
    },
  };
}
