import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'node_modules', 'firebase-admin');
const targetDir = path.join(rootDir, 'server', 'vendor', 'firebase-admin');

if (!existsSync(sourceDir)) {
  console.warn(`firebase-admin package assets not found at ${sourceDir}. Nothing to copy.`);
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true, force: true, errorOnExist: false });

console.log(`Copied firebase-admin assets to ${path.relative(rootDir, targetDir)}`);
