const { randomUUID } = require('node:crypto');
// One bounded recovery pass per interval across all workers on this SQL file.
function createBackupRecovery(db, { now = Date.now, intervalMs = 600000 } = {}) {
  db.sql.exec(`CREATE TABLE IF NOT EXISTS recovery_lease (
    id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT, expires_at INTEGER NOT NULL, next_at INTEGER NOT NULL);
    INSERT OR IGNORE INTO recovery_lease VALUES(1,NULL,0,0);`);
  let running = false;
  return async () => {
    if (running) return { skipped: true };
    const owner = randomUUID(), at = now();
    const claim = db.sql.prepare('UPDATE recovery_lease SET owner=?,expires_at=? WHERE id=1 AND expires_at<=? AND next_at<=?')
      .run(owner, at + 120000, at, at).changes;
    if (!claim) return { skipped: true };
    running = true;
    const heartbeat = setInterval(() => {
      if (!db.closed) db.sql.prepare('UPDATE recovery_lease SET expires_at=? WHERE id=1 AND owner=?').run(now() + 120000, owner);
    }, 30000);
    heartbeat.unref();
    let success = false;
    try {
      const result = await db.syncFromBackup('', { maxNodes: 250000 });
      success = !result.error;
      return result;
    } finally {
      clearInterval(heartbeat); running = false;
      if (!db.closed) db.sql.prepare('UPDATE recovery_lease SET owner=NULL,expires_at=0,next_at=? WHERE id=1 AND owner=?')
        .run(now() + (success ? intervalMs : 60000), owner);
    }
  };
}
module.exports = { createBackupRecovery };
