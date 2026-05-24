import type { StorageBackend } from "./backend.js";
import type { Database } from "./types.js";

export class DatabaseStore {
  constructor(private readonly backend: StorageBackend) {}

  get backendName(): string {
    return this.backend.name;
  }

  async read(): Promise<Database> {
    return this.backend.readDatabase();
  }

  async write(db: Database): Promise<void> {
    await this.backend.writeDatabase(db);
  }

  async update<T>(mutator: (db: Database) => T | Promise<T>): Promise<T> {
    const db = await this.read();
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
