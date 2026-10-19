// Local authoritative store. The reference facade keeps existing API contracts
// while reads, queries and atomic counters execute in SQLite, not Firebase.
const Sqlite = require('better-sqlite3');
const fs = require('node:fs');
const pathModule = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const copy = value => value == null ? null : JSON.parse(JSON.stringify(value));
const join = (a, b) => [a, b].filter(Boolean).join('/');
const parent = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
function pathName(value = '') {
  const path = String(value).replace(/^\/+|\/+$/g, '');
  if (path === '.info/serverTimeOffset') return path;
  if (path.split('/').some(key => !key || /[.#$\[\]\u0000-\u001f\u007f]/.test(key))) {
    if (!path) return '';
    throw new Error('Invalid database path.');
  }
  return path;
}
function canonical(value, now) {
  if (value === undefined) throw new Error('Database values cannot be undefined.');
  if (value === null) return null;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('Database numbers must be finite.'); return value; }
  if (['boolean', 'string'].includes(typeof value)) return value;
  if (typeof value !== 'object') throw new Error('Invalid database value.');
  if (value['.sv'] === 'timestamp') return now;
  const output = Array.isArray(value) ? [] : Object.create(null);
  for (const [key, child] of Object.entries(value)) {
    pathName(key);
    const next = canonical(child, now);
    if (next !== null) output[key] = next;
  }
  return Object.keys(output).length ? output : null;
}
function sortValue(value) {
  if (value == null) return [0, 0, ''];
  if (value === false) return [1, 0, ''];
  if (value === true) return [2, 0, ''];
  if (typeof value === 'number') return [3, value, ''];
  if (typeof value === 'string') return [4, 0, value];
  return [5, 0, ''];
}

class Snapshot {
  constructor(ref, value, entries) { this.ref = ref; this.key = ref.key; this.value = value; this.entries = entries; }
  val() { return copy(this.value); }
  exists() { return this.value !== null && this.value !== undefined; }
  child(path) {
    const value = pathName(path).split('/').filter(Boolean).reduce((v, key) => v?.[key], this.value) ?? null;
    return new Snapshot(this.ref.child(path), value);
  }
  hasChild(path) { return this.child(path).exists(); }
  numChildren() { return this.value && typeof this.value === 'object' ? Object.keys(this.value).length : 0; }
  forEach(fn) {
    for (const [key, value] of this.entries || Object.entries(this.value || {})) {
      if (fn(new Snapshot(this.ref.child(key), value)) === true) return true;
    }
    return false;
  }
}

class Reference {
  constructor(database, path = '', query = {}) { this.database = database; this.path = pathName(path); this.query = query; this.key = this.path.split('/').at(-1) || null; }
  child(path) { return new Reference(this.database, join(this.path, pathName(path))); }
  async once(event = 'value') {
    if (event !== 'value') throw new Error('Use a value snapshot for one-time reads.');
    return this.database.read(this);
  }
  get() { return this.once('value'); }
  set(value) { return this.database.write({ [this.path]: value }); }
  update(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return Promise.reject(new Error('Provide an update object.'));
    return this.database.write(Object.fromEntries(Object.entries(patch).map(([key, value]) => [join(this.path, pathName(key)), value])));
  }
  remove() { return this.set(null); }
  transaction(fn, completion) { return this.database.mutate(this, fn).then(result => { completion?.(null, result.committed, result.snapshot); return result; }); }
  push() { return this.child(Date.now().toString(36).padStart(10, '0') + crypto.randomBytes(10).toString('hex')); }
  _query(patch) { return new Reference(this.database, this.path, { ...this.query, ...patch }); }
  orderByChild(field) { return this._query({ order: 'child', field: pathName(field) }); }
  orderByKey() { return this._query({ order: 'key' }); }
  orderByValue() { return this._query({ order: 'value' }); }
  startAt(value) { return this._query({ start: value }); }
  endAt(value) { return this._query({ end: value }); }
  equalTo(value) { return this._query({ start: value, end: value }); }
  limitToFirst(limit) { return this._query({ limit: this._limit(limit), last: false }); }
  limitToLast(limit) { return this._query({ limit: this._limit(limit), last: true }); }
  _limit(value) { if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid query limit.'); return value; }
  on(event, fn, error) { return this.database.listen(this, event, fn, error); }
  off(event, fn) { this.database.unlisten(this.path, event, fn); }
}

class SqlDatabase {
  constructor({ filename, backup, now = Date.now, backupIntervalMs = 5000, logger = console, startBackup = true } = {}) {
    this.filename = filename || pathModule.resolve(__dirname, '../../data/application.sqlite');
    if (this.filename !== ':memory:') fs.mkdirSync(pathModule.dirname(this.filename), { recursive: true, mode: 0o700 });
    this.sql = new Sqlite(this.filename, { timeout: 10000 });
    if (this.filename !== ':memory:') { try { fs.chmodSync(this.filename, 0o600); } catch (_) {} }
    this.sql.pragma('journal_mode = WAL');
    this.sql.pragma('synchronous = FULL');
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS nodes(path TEXT PRIMARY KEY, parent TEXT NOT NULL, key TEXT NOT NULL,
        kind INTEGER NOT NULL, value TEXT, number_value REAL NOT NULL DEFAULT 0, text_value TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS nodes_parent ON nodes(parent, key);
      CREATE INDEX IF NOT EXISTS nodes_sort ON nodes(parent, kind, number_value, text_value, key);
      CREATE TABLE IF NOT EXISTS coverage(path TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS backup_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0, error_code TEXT);
      CREATE TABLE IF NOT EXISTS backup_lock(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT, expires_at INTEGER NOT NULL);
      INSERT OR IGNORE INTO backup_lock VALUES(1, NULL, 0);
      CREATE TABLE IF NOT EXISTS store_meta(key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      INSERT OR IGNORE INTO store_meta VALUES('local_writes', 0);
      PRAGMA user_version = 1;
    `);
    this.backup = backup; this.now = now; this.logger = logger;
    this.prepared = new Map(); this.hydrations = new Map(); this.listeners = new Set(); this.closed = false;
    if (startBackup && backup) {
      this.timer = setInterval(() => this.flushBackup().catch(() => {}), backupIntervalMs);
      this.timer.unref();
    }
  }
  statement(sql) { if (!this.prepared.has(sql)) this.prepared.set(sql, this.sql.prepare(sql)); return this.prepared.get(sql); }
  ref(path = '') { return new Reference(this, path); }
  known(path) {
    for (let scope = path; ; scope = parent(scope)) {
      if (this.statement('SELECT 1 FROM coverage WHERE path=?').get(scope)) return true;
      if (!scope) return false;
    }
  }
  local(path) {
    if (path === '.info/serverTimeOffset') return 0;
    const root = this.statement('SELECT * FROM nodes WHERE path=?').get(path);
    if (!root) return null;
    if (root.kind < 5) return JSON.parse(root.value);
    const value = root.kind === 6 ? [] : Object.create(null);
    const prefix = path ? path + '/' : '';
    const rows = this.statement('SELECT * FROM nodes WHERE path>=? AND path<? ORDER BY length(path), path').all(prefix, path ? path + '0' : '\uffff');
    for (const row of rows) {
      if (row.path === path) continue;
      const keys = row.path.slice(prefix.length).split('/');
      let container = value;
      for (const key of keys.slice(0, -1)) container = container[key];
      container[keys.at(-1)] = row.kind === 6 ? [] : row.kind === 5 ? Object.create(null) : JSON.parse(row.value);
    }
    return Object.keys(value).length ? value : null;
  }
  put(path, value, mark = true) {
    const prefix = path ? path + '/' : '';
    this.statement('DELETE FROM nodes WHERE path=? OR (path>=? AND path<?)').run(path, prefix, path ? path + '0' : '\uffff');
    this.statement('DELETE FROM coverage WHERE path=? OR (path>=? AND path<?)').run(path, prefix, path ? path + '0' : '\uffff');
    const insert = this.statement('INSERT INTO nodes(path,parent,key,kind,value,number_value,text_value) VALUES(?,?,?,?,?,?,?)');
    const walk = (scope, data) => {
      const [rank, numeric, string] = sortValue(data);
      insert.run(scope, parent(scope), scope.split('/').at(-1) || '', Array.isArray(data) ? 6 : rank, rank < 5 ? JSON.stringify(data) : null, numeric, string);
      if (rank === 5) for (const [key, child] of Object.entries(data)) walk(join(scope, key), child);
    };
    if (value !== null) {
      for (let scope = parent(path); path; scope = parent(scope)) {
        this.statement(`INSERT INTO nodes(path,parent,key,kind) VALUES(?,?,?,5)
          ON CONFLICT(path) DO UPDATE SET kind=CASE WHEN kind>=5 THEN kind ELSE 5 END,value=NULL,number_value=0,text_value=''`).run(scope, parent(scope), scope.split('/').at(-1) || '');
        if (!scope) break;
      }
      walk(path, value);
    } else {
      for (let scope = parent(path); scope; scope = parent(scope)) {
        if (this.statement('SELECT 1 FROM nodes WHERE parent=? AND path<>? LIMIT 1').get(scope, scope)) break;
        this.statement('DELETE FROM nodes WHERE path=?').run(scope);
      }
    }
    if (mark) this.statement('INSERT OR IGNORE INTO coverage(path) VALUES(?)').run(path);
  }
  async hydrate(path) {
    if (path === '.info/serverTimeOffset' || this.known(path)) return;
    if (!this.backup) throw Object.assign(new Error('Backup is unavailable for missing data.'), { statusCode: 503 });
    if (this.hydrations.has(path)) return this.hydrations.get(path);
    const operation = (async () => {
      let data;
      try { data = canonical(await this.backup.read(path), this.now()); }
      catch (error) { throw Object.assign(new Error('Could not recover missing data from the backup. Please retry.'), { statusCode: 503, cause: error }); }
      this.sql.transaction(() => {
        if (this.known(path)) return;
        const prefix = path ? path + '/' : '';
        const scopes = this.statement('SELECT path FROM coverage WHERE path>=? AND path<? ORDER BY length(path)').all(prefix, path ? path + '0' : '\uffff');
        const overlays = [];
        for (const item of scopes) if (!overlays.some(entry => item.path.startsWith(entry.path + '/'))) overlays.push({ path: item.path, value: this.local(item.path) });
        this.put(path, data);
        for (const item of overlays) this.put(item.path, item.value);
      }).immediate();
    })().finally(() => this.hydrations.delete(path));
    this.hydrations.set(path, operation); return operation;
  }
  async read(ref) {
    await this.hydrate(ref.path);
    const q = ref.query;
    if (!Object.keys(q).length) return new Snapshot(ref, this.local(ref.path));
    let sql = `SELECT c.key,c.path FROM nodes c LEFT JOIN nodes s ON s.path=${q.order === 'child' ? "c.path || '/' || ?" : 'c.path'} WHERE c.parent=? AND c.path<>?`;
    const args = q.order === 'child' ? [q.field, ref.path, ref.path] : [ref.path, ref.path];
    const rank = 'CASE WHEN s.kind>=5 THEN 5 ELSE COALESCE(s.kind,0) END';
    const tuple = q.order === 'key' || !q.order ? '(4,0,c.key)' : `(${rank},COALESCE(s.number_value,0),COALESCE(s.text_value,''))`;
    for (const [field, operator] of [['start', '>='], ['end', '<=']]) if (q[field] !== undefined) { sql += ` AND ${tuple} ${operator} (?,?,?)`; args.push(...sortValue(q[field])); }
    const direction = q.last ? 'DESC' : 'ASC';
    sql += q.order === 'key' || !q.order ? ` ORDER BY c.key ${direction}` : ` ORDER BY ${rank} ${direction},s.number_value ${direction},s.text_value ${direction},c.key ${direction}`;
    if (q.limit) { sql += ' LIMIT ?'; args.push(q.limit); }
    const rows = this.statement(sql).all(...args);
    if (q.last) rows.reverse();
    const entries = rows.map(row => [row.key, this.local(row.path)]);
    return new Snapshot(ref, entries.length ? Object.fromEntries(entries) : null, entries);
  }
  async write(updates) {
    const keys = Object.keys(updates).map(pathName).sort();
    if (keys.some(key => !key || key.startsWith('.info'))) throw new Error('Use child paths for database updates.');
    for (let i = 1; i < keys.length; i++) if (keys[i].startsWith(keys[i - 1] + '/')) throw new Error('Update paths cannot overlap.');
    this.sql.transaction(() => {
      const normalized = Object.fromEntries(keys.map(key => [key, canonical(updates[key], this.now())]));
      const changed = Object.fromEntries(Object.entries(normalized).filter(([key, value]) =>
        !this.statement('SELECT 1 FROM coverage WHERE path=?').get(key) || !isDeepStrictEqual(canonical(this.local(key), this.now()), value)));
      for (const [key, value] of Object.entries(changed)) this.put(key, value);
      if (Object.keys(changed).length) this.statement('INSERT INTO backup_outbox(payload) VALUES(?)').run(JSON.stringify(changed));
      if (Object.keys(changed).length) this.statement("UPDATE store_meta SET value=value+1 WHERE key='local_writes'").run();
    }).immediate();
  }
  async mutate(ref, fn) {
    await this.hydrate(ref.path);
    return this.sql.transaction(() => {
      const before = this.local(ref.path);
      const value = fn(copy(before));
      if (value?.then) throw new Error('Database transaction callbacks must be synchronous.');
      if (value === undefined) return { committed: false, snapshot: new Snapshot(ref, this.local(ref.path)) };
      const next = canonical(value, this.now());
      if (this.statement('SELECT 1 FROM coverage WHERE path=?').get(ref.path) && isDeepStrictEqual(canonical(before, this.now()), next)) {
        return { committed: true, snapshot: new Snapshot(ref, before) };
      }
      this.put(ref.path, next);
      this.statement('INSERT INTO backup_outbox(payload) VALUES(?)').run(JSON.stringify({ [ref.path]: next }));
      this.statement("UPDATE store_meta SET value=value+1 WHERE key='local_writes'").run();
      return { committed: true, snapshot: new Snapshot(ref, next) };
    }).immediate();
  }
  // Anti-entropy: pull data that exists in the Firebase backup but is missing
  // locally. The lazy per-path hydrate() above only fires once per never-seen
  // path — after the initial import marked the root as covered, subtrees
  // written to Firebase by OTHER writers (legacy Netlify functions, the
  // pre-cutover backend, console edits) never arrived. This compares the
  // remote subtree against local nodes and imports only the missing leaves.
  // Local-authoritative values always win: existing SQL nodes are untouched,
  // and this never queues backup_outbox entries (no echo back to Firebase).
  async syncFromBackup(path = '', { maxNodes = 50000 } = {}) {
    if (!this.backup) return { imported: 0, skipped: true };
    path = pathName(path);
    if (path === '.info/serverTimeOffset') return { imported: 0 };
    const rootNode = this.statement('SELECT kind FROM nodes WHERE path=?').get(path);
    if (path && rootNode && rootNode.kind < 5) return { imported: 0, skipped: true };
    if (path && !this.local(path) && this.statement('SELECT 1 FROM coverage WHERE path=?').get(path)) {
      return { imported: 0, skipped: true }; // explicit deletion/negative authoritative scope
    }
    let data;
    try { data = canonical(await this.backup.read(path), this.now()); }
    catch (error) {
      this.logger?.warn?.(`[database] Firebase sync of "${path || 'root'}" failed: ${error.statusCode || error.code || 'error'}`);
      return { imported: 0, error: true };
    }
    if (data === null) return { imported: 0 };
    // Flatten the remote subtree to leaf paths (objects recurse; empty objects
    // become their own node so they don't disappear).
    const leaves = [];
    const walk = (value, prefix) => {
      if (leaves.length >= maxNodes) return;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const keys = Object.keys(value);
        if (!keys.length) { leaves.push([prefix, value]); return; }
        for (const key of keys) walk(value[key], prefix ? `${prefix}/${key}` : key);
      } else leaves.push([prefix, value]);
    };
    walk(data, path);
    let imported = 0;
    const importChunk = this.sql.transaction(chunk => {
      const has = this.statement('SELECT 1 FROM nodes WHERE path=? LIMIT 1');
      const insert = this.statement('INSERT INTO nodes(path,parent,key,kind,value,number_value,text_value) VALUES(?,?,?,?,?,?,?)');
      const ensureParents = leafPath => {
        for (let scope = parent(leafPath); ; scope = parent(scope)) {
          if (!scope || this.statement('SELECT 1 FROM nodes WHERE path=?').get(scope)) break;
          this.statement(`INSERT INTO nodes(path,parent,key,kind) VALUES(?,?,?,5)
            ON CONFLICT(path) DO UPDATE SET kind=CASE WHEN kind>=5 THEN kind ELSE 5 END,value=NULL,number_value=0,text_value=''`)
            .run(scope, parent(scope), scope.split('/').at(-1) || '');
          if (!scope) break;
        }
      };
      for (const [leafPath, value] of chunk) {
        if (has.get(leafPath)) {
          const kind = this.statement('SELECT kind FROM nodes WHERE path=?').get(leafPath).kind;
          // Repair an empty container left by an older missing-only array import.
          if (!(Array.isArray(value) && kind === 6 && !this.local(leafPath))) continue;
        }
        // Never resurrect over a tombstone/coverage marker — local deletes win.
        // Check the leaf AND every ancestor strictly below the sync root
        // (the root itself is covered by the initial import and must not
        // block everything).
        let tombstoned = false;
        for (let scope = leafPath; scope && scope !== path; scope = parent(scope)) {
          if (this.statement('SELECT 1 FROM coverage WHERE path=?').get(scope)) { tombstoned = true; break; }
          if (scope !== leafPath) {
            const node = this.statement('SELECT kind FROM nodes WHERE path=?').get(scope);
            if (node && node.kind < 5) { tombstoned = true; break; }
          }
        }
        if (tombstoned) continue;
        if (Array.isArray(value)) {
          const prefix = leafPath + '/';
          if (this.statement('SELECT 1 FROM coverage WHERE path>=? AND path<? LIMIT 1').get(prefix, leafPath + '0')) continue;
          this.put(leafPath, value, false);
          imported += value.length + 1;
          continue;
        }
        const [rank, numeric, string] = sortValue(value);
        ensureParents(leafPath);
        insert.run(leafPath, parent(leafPath), leafPath.split('/').at(-1) || '',
          Array.isArray(value) ? 6 : rank, rank < 5 ? JSON.stringify(value) : null, numeric, string);
        imported++;
      }
    });
    for (let offset = 0; offset < leaves.length; offset += 500) {
      importChunk.immediate(leaves.slice(offset, offset + 500));
      if (offset + 500 < leaves.length) await new Promise(resolve => setImmediate(resolve));
    }
    if (imported) this.logger?.log?.(`[database] Firebase sync imported ${imported} missing nodes under "${path || 'root'}".`);
    return { imported };
  }
  async flushBackup({ limit = 100 } = {}) {
    if (!this.backup || this.flushing || this.closed) return;
    this.flushing = true;
    const owner = crypto.randomUUID(); let locked = false;
    try {
      locked = this.sql.transaction(() => this.statement('UPDATE backup_lock SET owner=?,expires_at=? WHERE id=1 AND expires_at<=?').run(owner, this.now() + 120000, this.now()).changes === 1).immediate();
      if (!locked) return;
      for (let i = 0; i < limit && !this.closed; i++) {
        const row = this.statement('SELECT * FROM backup_outbox ORDER BY id LIMIT 1').get();
        if (!row || row.retry_at > this.now()) break;
        this.statement('UPDATE backup_lock SET expires_at=? WHERE id=1 AND owner=?').run(this.now() + 120000, owner);
        try {
          await this.backup.writeBatch(JSON.parse(row.payload));
          this.statement('DELETE FROM backup_outbox WHERE id=?').run(row.id);
        } catch (error) {
          this.statement('UPDATE backup_outbox SET attempts=attempts+1,retry_at=?,error_code=? WHERE id=?').run(this.now() + Math.min(300000, 5000 * 2 ** Math.min(row.attempts, 6)), String(error.statusCode || error.code || 'backup_unavailable'), row.id);
          this.logger.warn('[database] Backup delayed; committed SQL data and pending writes retained.');
          break;
        }
      }
    } finally {
      if (locked && !this.closed) this.statement('UPDATE backup_lock SET owner=NULL,expires_at=0 WHERE id=1 AND owner=?').run(owner);
      this.flushing = false;
    }
  }
  status() { return { backend: 'sqlite', pendingBackupWrites: this.statement('SELECT COUNT(*) AS n FROM backup_outbox').get().n, recoveredScopes: this.statement('SELECT COUNT(*) AS n FROM coverage').get().n }; }  importInitialSnapshot(value) {
    this.sql.transaction(() => {
      if (this.statement("SELECT value FROM store_meta WHERE key='local_writes'").get().value
        || this.status().pendingBackupWrites) throw new Error('SQL already has local writes. Use missing-data recovery rather than replacing it.');
      this.put('', canonical(value, this.now()));
    }).immediate();
  }
  listen(ref, event, fn, error) {
    if (!['value', 'child_added'].includes(event)) throw new Error('Unsupported database listener.');
    const item = { path: ref.path, event, fn, seen: new Set(), busy: false, stopped: false };
    const poll = async () => {
      if (item.busy || item.stopped) return;
      item.busy = true;
      try {
        const snap = await this.read(ref);
        if (item.stopped) return;
        if (event === 'value') { const json = JSON.stringify(snap.val()); if (json !== item.last) { item.last = json; fn(snap); } }
        else snap.forEach(child => { if (!item.seen.has(child.key)) { item.seen.add(child.key); fn(child); } });
      } catch (err) { error?.(err); } finally { item.busy = false; }
    };
    item.timer = setInterval(poll, 1000); item.timer.unref(); this.listeners.add(item); poll(); return fn;
  }
  unlisten(path, event, fn) { for (const item of this.listeners) if (item.path === path && (!event || item.event === event) && (!fn || item.fn === fn)) { item.stopped = true; clearInterval(item.timer); this.listeners.delete(item); } }
  close() { clearInterval(this.timer); for (const item of this.listeners) this.unlisten(item.path); this.closed = true; this.sql.close(); }
}

module.exports = { SqlDatabase, Snapshot, pathName };
