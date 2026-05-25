import path from "node:path";
import { promises as fs } from "node:fs";
import Database from "better-sqlite3";
import type { StorageBackend } from "./backend.js";
import { COLLECTIONS, emptyDatabase, type Database as DbSnapshot } from "./types.js";

interface Row {
  id: string;
  json: string;
}

export class SqliteStorageBackend implements StorageBackend {
  readonly name = "SqliteStorageBackend";
  private db: InstanceType<typeof Database> | null = null;

  constructor(private readonly opts: { dbPath: string }) {}

  private async ensure(): Promise<InstanceType<typeof Database>> {
    if (this.db) return this.db;
    await fs.mkdir(path.dirname(this.opts.dbPath), { recursive: true });
    const db = new Database(this.opts.dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    for (const collection of COLLECTIONS) {
      db.exec(
        `CREATE TABLE IF NOT EXISTS ${collection} (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`
      );
    }
    this.db = db;
    return db;
  }

  async readDatabase(): Promise<DbSnapshot> {
    const handle = await this.ensure();
    const snapshot = emptyDatabase();
    for (const collection of COLLECTIONS) {
      const rows = handle
        .prepare(`SELECT id, json FROM ${collection}`)
        .all() as Row[];
      (snapshot as any)[collection] = rows.map((row) => JSON.parse(row.json));
    }
    return snapshot;
  }

  async writeDatabase(snapshot: DbSnapshot): Promise<void> {
    const handle = await this.ensure();
    handle.exec("BEGIN");
    try {
      for (const collection of COLLECTIONS) {
        handle.prepare(`DELETE FROM ${collection}`).run();
        const insert = handle.prepare<{ id: string; json: string }>(
          `INSERT INTO ${collection} (id, json, updated_at) VALUES (@id, @json, datetime('now')) ` +
            `ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
        );
        for (const item of (snapshot as any)[collection] as Array<{ id?: string }>) {
          const id = item?.id ?? null;
          if (!id) continue;
          insert.run({ id, json: JSON.stringify(item) });
        }
      }
      handle.exec("COMMIT");
    } catch (error) {
      handle.exec("ROLLBACK");
      throw error;
    }
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }
}
