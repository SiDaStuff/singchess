const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let resolved;

function usable(filename) {
  try {
    const directory = path.dirname(filename);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
    if (fs.existsSync(filename)) fs.accessSync(filename, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function databaseFilename() {
  if (resolved) return resolved;
  const configured = String(process.env.SQLITE_DATABASE_PATH || '').trim();
  const preferred = path.resolve(configured || path.join(__dirname, '../../data/application.sqlite'));
  if (usable(preferred)) return (resolved = preferred);

  const fallback = path.join(os.homedir(), '.singchess', 'application.sqlite');
  if (!usable(fallback)) throw new Error(`SQLite database directory is not writable: ${path.dirname(preferred)}`);
  console.warn(`[database] Cannot write configured SQLite path; using ${fallback}. Fix SQLITE_DATABASE_PATH permissions to restore the preferred location.`);
  return (resolved = fallback);
}

module.exports = { databaseFilename };
