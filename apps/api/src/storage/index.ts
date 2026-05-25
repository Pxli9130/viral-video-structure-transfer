import path from "node:path";
import { JsonStorageBackend } from "./jsonBackend.js";
import { DatabaseStore } from "./store.js";
import type { StorageBackend } from "./backend.js";

export { DatabaseStore } from "./store.js";
export { CollectionStorageAdapter } from "./collectionAdapter.js";
export { JsonStorageBackend } from "./jsonBackend.js";
export type { StorageBackend } from "./backend.js";
export type { CollectionName, Database } from "./types.js";
export { COLLECTIONS, emptyDatabase } from "./types.js";

export interface StorageFactoryOptions {
  backend?: string;
  storageRoot: string;
}

export async function buildStorageBackend(opts: StorageFactoryOptions): Promise<StorageBackend> {
  const backend = (opts.backend ?? "json").toLowerCase();
  if (backend === "sqlite") {
    const { SqliteStorageBackend } = await import("./sqliteBackend.js");
    return new SqliteStorageBackend({ dbPath: path.join(opts.storageRoot, "db", "app.sqlite") });
  }
  return new JsonStorageBackend({ dbPath: path.join(opts.storageRoot, "db", "app.json") });
}

export async function buildDatabaseStore(opts: StorageFactoryOptions): Promise<DatabaseStore> {
  const backend = await buildStorageBackend(opts);
  return new DatabaseStore(backend);
}
