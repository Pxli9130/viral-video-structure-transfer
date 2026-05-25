import type { StorageAdapter } from "@vvst/shared";
import type { StorageBackend } from "./backend.js";
import { COLLECTIONS, type CollectionName, type Database } from "./types.js";

function assertCollection(collection: string): CollectionName {
  if ((COLLECTIONS as readonly string[]).includes(collection)) {
    return collection as CollectionName;
  }
  throw new Error(`Unknown storage collection: ${collection}`);
}

export class CollectionStorageAdapter implements StorageAdapter {
  readonly name = "CollectionStorageAdapter";

  constructor(private readonly backend: StorageBackend) {}

  async read<T>(collection: string): Promise<T[]> {
    const key = assertCollection(collection);
    const db = await this.backend.readDatabase();
    return [...((db as Record<CollectionName, unknown[]>)[key] as T[])];
  }

  async upsert<T extends { id: string }>(collection: string, value: T): Promise<T> {
    const key = assertCollection(collection);
    const db = await this.backend.readDatabase();
    const current = ((db as Record<CollectionName, unknown[]>)[key] ?? []) as T[];
    (db as Record<CollectionName, unknown[]>)[key] = [
      ...current.filter((item) => item.id !== value.id),
      value
    ];
    await this.backend.writeDatabase(db as Database);
    return value;
  }

  async remove(collection: string, id: string): Promise<void> {
    const key = assertCollection(collection);
    const db = await this.backend.readDatabase();
    const current = ((db as Record<CollectionName, unknown[]>)[key] ?? []) as Array<{ id?: string }>;
    (db as Record<CollectionName, unknown[]>)[key] = current.filter((item) => item.id !== id);
    await this.backend.writeDatabase(db as Database);
  }
}
