import type { StorageAdapter } from "@vvst/shared";
import type { StorageBackend } from "./backend.js";
import { CollectionStorageAdapter } from "./collectionAdapter.js";
import type { Database } from "./types.js";

export class DatabaseStore implements StorageAdapter {
  readonly name = "DatabaseStore";
  private readonly collections: CollectionStorageAdapter;

  constructor(private readonly backend: StorageBackend) {
    this.collections = new CollectionStorageAdapter(backend);
  }

  get backendName(): string {
    return this.backend.name;
  }

  read(): Promise<Database>;
  read<T>(collection: string): Promise<T[]>;
  async read<T>(collection?: string): Promise<Database | T[]> {
    if (collection) return this.collections.read<T>(collection);
    return this.backend.readDatabase();
  }

  async write(db: Database): Promise<void> {
    await this.backend.writeDatabase(db);
  }

  async upsert<T extends { id: string }>(collection: string, value: T): Promise<T> {
    return this.collections.upsert(collection, value);
  }

  async remove(collection: string, id: string): Promise<void> {
    await this.collections.remove(collection, id);
  }

  async update<T>(mutator: (db: Database) => T | Promise<T>): Promise<T> {
    const db = await this.backend.readDatabase();
    const result = await mutator(db);
    await this.write(db);
    return result;
  }

  async close(): Promise<void> {
    if (this.backend.close) {
      await this.backend.close();
    }
  }
}
