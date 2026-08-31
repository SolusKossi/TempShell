import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.ts';

/**
 * One SQLite file per tool. Uses node:sqlite so there is no native module to
 * compile, which matters on a 1 vCPU box.
 *
 * WAL plus synchronous=NORMAL is the combination that makes SQLite fast. The
 * default rollback journal makes readers and writers block each other and
 * fsyncs on every commit, which is where SQLite's slow reputation comes from.
 */
export function openDb(name: string): DatabaseSync {
  mkdirSync(config.dataDir, { recursive: true });
  const db = new DatabaseSync(join(config.dataDir, `${name}.db`));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

/**
 * Migrations run in order and are recorded, so applying them is idempotent.
 * Deliberately plain SQL: if this ever needs to become Postgres, the change is
 * contained to the store files rather than spread through the app.
 */
export function migrate(db: DatabaseSync, migrations: string[]): void {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const applied = new Set(
    db.prepare('SELECT id FROM _migrations').all().map((r) => Number((r as { id: number }).id)),
  );
  for (const [index, sql] of migrations.entries()) {
    if (applied.has(index)) continue;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)').run(index, Date.now());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${index} failed: ${String(error)}`);
    }
  }
}
