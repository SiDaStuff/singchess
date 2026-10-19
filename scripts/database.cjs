// Local migration/backup operations. No credentials or record values are logged.
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const { SqlDatabase } = require('../server/api/_lib/sql-database');
const db = new SqlDatabase({ filename: process.env.SQLITE_DATABASE_PATH ? path.resolve(process.env.SQLITE_DATABASE_PATH) : undefined,
  backup: require('../server/api/_lib/firebase-backup'), startBackup: false });
async function main() {
  const command = process.argv[2] || 'status';
  if (command === 'migrate') {
    const writes = db.sql.prepare("SELECT value FROM store_meta WHERE key='local_writes'").get().value;
    if (!writes && !db.status().pendingBackupWrites) db.importInitialSnapshot(await db.backup.read(''));
    else await db.hydrate('');
  }
  else if (command === 'recover') {
    const result = await db.syncFromBackup('');
    console.log(JSON.stringify(result));
    if (result.error) process.exitCode = 1;
  }
  else if (command === 'sync') await db.flushBackup({ limit: 1000 });
  else if (command === 'backup') {
    const folder = path.resolve(__dirname, '../server/data/sql-backups');
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    const destination = path.join(folder, `${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
    if (fs.existsSync(destination)) throw new Error('Backup filename already exists. Retry in a moment.');
    await db.sql.backup(destination);
    try { fs.chmodSync(destination, 0o600); } catch (_) {}
    console.log('Consistent local SQL backup saved in server/data/sql-backups.');
  } else if (command !== 'status') throw new Error('Use status, migrate, recover, sync, or backup.');
  console.log(JSON.stringify({ ...db.status(), storedNodes: db.sql.prepare('SELECT COUNT(*) AS n FROM nodes').get().n }));
  if (command === 'sync' && db.status().pendingBackupWrites) process.exitCode = 1;
}
main().catch(error => { console.error('Database operation failed:', error.statusCode || error.code || error.name); process.exitCode = 1; }).finally(() => db.close());
