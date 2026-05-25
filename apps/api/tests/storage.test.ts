import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JsonStorageBackend } from "../src/storage/jsonBackend.js";
import { SqliteStorageBackend } from "../src/storage/sqliteBackend.js";
import { DatabaseStore } from "../src/storage/store.js";
import { emptyDatabase } from "../src/storage/types.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.resolve(moduleDir, "tmp-storage");

beforeAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function sampleDb() {
  const db = emptyDatabase();
  db.projects.push({
    id: "p1",
    name: "demo",
    vertical: "b2b_marketing_mg",
    aspectRatio: "9:16",
    targetDurationSec: 15,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z"
  });
  db.jobs.push({
    id: "j1",
    type: "analysis",
    status: "completed",
    progress: 100,
    steps: [{ name: "x", status: "completed" }],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z"
  });
  return db;
}

describe("StorageBackend contracts (Json + SQLite parity)", () => {
  it("JsonStorageBackend round-trips projects/jobs", async () => {
    const backend = new JsonStorageBackend({ dbPath: path.join(tmpRoot, "json", "app.json") });
    const store = new DatabaseStore(backend);
    await store.write(sampleDb());
    const read = await store.read();
    expect(read.projects).toHaveLength(1);
    expect(read.jobs).toHaveLength(1);
    expect(read.projects[0].id).toBe("p1");
  });

  it("DatabaseStore implements collection StorageAdapter read/upsert/remove", async () => {
    const backend = new JsonStorageBackend({ dbPath: path.join(tmpRoot, "adapter", "app.json") });
    const store = new DatabaseStore(backend);
    const project = sampleDb().projects[0];
    await store.upsert("projects", project);
    const projects = await store.read<typeof project>("projects");
    expect(projects.map((item) => item.id)).toEqual(["p1"]);

    await store.upsert("projects", { ...project, name: "updated" });
    const updated = await store.read<typeof project>("projects");
    expect(updated).toHaveLength(1);
    expect(updated[0].name).toBe("updated");

    await store.remove("projects", "p1");
    expect(await store.read<typeof project>("projects")).toHaveLength(0);
  });

  it("SqliteStorageBackend round-trips projects/jobs and clears removed ids", async () => {
    const backend = new SqliteStorageBackend({ dbPath: path.join(tmpRoot, "sqlite", "app.sqlite") });
    const store = new DatabaseStore(backend);
    await store.write(sampleDb());
    const read = await store.read();
    expect(read.projects).toHaveLength(1);
    expect(read.jobs).toHaveLength(1);

    // delete the project, then re-read
    const next = sampleDb();
    next.projects = [];
    await store.write(next);
    const afterDelete = await store.read();
    expect(afterDelete.projects).toHaveLength(0);
    expect(afterDelete.jobs).toHaveLength(1);
    await store.close();
  });
});
