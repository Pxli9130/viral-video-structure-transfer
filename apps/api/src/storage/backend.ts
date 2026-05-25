import type { Database } from "./types.js";

export interface StorageBackend {
  readonly name: string;
  readDatabase(): Promise<Database>;
  writeDatabase(db: Database): Promise<void>;
  close?(): Promise<void>;
}
