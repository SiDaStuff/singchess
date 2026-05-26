import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const outputDir = resolve(rootDir, 'public/assets/pieces');

const themes = ['classic', 'glass', 'wood', 'neo'];
const pieces = ['wp', 'wn', 'wb', 'wr', 'wq', 'wk', 'bp', 'bn', 'bb', 'br', 'bq', 'bk'];
const baseUrl = 'https://images.chesscomfiles.com/chess-themes/pieces';

function download(url, target, redirects = 0) {
  return new Promise((resolveDownload, rejectDownload) => {
    const request = https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirects >= 4) {
          rejectDownload(new Error(`Too many redirects for ${url}`));
          return;
        }
        resolveDownload(download(new URL(response.headers.location, url).toString(), target, redirects + 1));
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        rejectDownload(new Error(`Failed ${url}: HTTP ${response.statusCode}`));
        return;
      }

      mkdirSync(dirname(target), { recursive: true });
      const file = createWriteStream(target);
      response.pipe(file);
      file.on('finish', () => file.close(resolveDownload));
      file.on('error', rejectDownload);
    });

    request.setTimeout(30000, () => {
      request.destroy(new Error(`Timed out downloading ${url}`));
    });
    request.on('error', rejectDownload);
  });
}

async function main() {
  mkdirSync(outputDir, { recursive: true });
  let copied = 0;

  for (const theme of themes) {
    for (const piece of pieces) {
      const target = resolve(outputDir, theme, `${piece}.png`);
      const url = `${baseUrl}/${theme}/300/${piece}.png`;
      if (!existsSync(target)) {
        await download(url, target);
      }
      copied += 1;
    }
  }

  console.log(`Copied ${copied} chess piece assets to public/assets/pieces`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
