import { promises as fs } from "node:fs";
import path from "node:path";
import type { Asset, Project, Vertical, AspectRatio, AssetRole, SourcePolicy, AssetType } from "@vvst/shared";
import { nowIso } from "@vvst/shared";
import type { StorageBackend } from "./backend.js";
import { COLLECTIONS, emptyDatabase, type Database } from "./types.js";

const VERTICALS: Vertical[] = ["b2b_marketing_mg", "vlog", "talking_head", "beat_cut", "short_drama", "ecommerce"];
const ASPECT_RATIOS: AspectRatio[] = ["9:16", "16:9", "1:1"];
const ASSET_ROLES: AssetRole[] = [
  "example_video",
  "source_video",
  "user_image",
  "user_text",
  "generated_card",
  "generated_background",
  "render_output"
];
const SOURCE_POLICIES: SourcePolicy[] = ["user_authorized", "open_download_or_user_uploaded", "demo_only", "unknown"];

function pickEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeProject(raw: any): Project {
  return {
    id: String(raw.id),
    name: String(raw.name ?? "Demo Structure Transfer Project"),
    vertical: pickEnum<Vertical>(raw.vertical, VERTICALS, "b2b_marketing_mg"),
    aspectRatio: pickEnum<AspectRatio>(raw.aspectRatio, ASPECT_RATIOS, "9:16"),
    targetDurationSec: toNumber(raw.targetDurationSec ?? (raw.targetDurationMs ? raw.targetDurationMs / 1000 : 15), 15),
    createdAt: String(raw.createdAt ?? nowIso()),
    updatedAt: String(raw.updatedAt ?? nowIso())
  };
}

function normalizeAsset(raw: any): Asset {
  return {
    id: String(raw.id),
    projectId: String(raw.projectId),
    role: pickEnum<AssetRole>(raw.role ?? "user_text", ASSET_ROLES, "user_text"),
    type: (raw.type ?? "text") as AssetType,
    filename: String(raw.filename ?? raw.originalName ?? "asset"),
    path: raw.path,
    mimeType: raw.mimeType ?? raw.metadata?.mimetype,
    sourcePolicy: pickEnum<SourcePolicy>(raw.sourcePolicy ?? "unknown", SOURCE_POLICIES, "unknown"),
    text: raw.text,
    metadata: raw.metadata,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    status: raw.status ?? "ready",
    createdAt: String(raw.createdAt ?? nowIso())
  };
}

export class JsonStorageBackend implements StorageBackend {
  readonly name = "JsonStorageBackend";

  constructor(private readonly opts: { dbPath: string }) {}

  async readDatabase(): Promise<Database> {
    await fs.mkdir(path.dirname(this.opts.dbPath), { recursive: true });
    try {
      const raw = JSON.parse(await fs.readFile(this.opts.dbPath, "utf8")) as Partial<Database>;
      return {
        projects: (raw.projects ?? []).map(normalizeProject),
        assets: (raw.assets ?? []).map(normalizeAsset),
        jobs: raw.jobs ?? [],
        analyses: raw.analyses ?? [],
        templates: raw.templates ?? [],
        atoms: raw.atoms ?? (raw.templates ?? []).flatMap((record: any) => record.template?.structureAtoms ?? []),
        generations: raw.generations ?? [],
        renders: raw.renders ?? []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const db = emptyDatabase();
        await this.writeDatabase(db);
        return db;
      }
      throw error;
    }
  }

  async writeDatabase(db: Database): Promise<void> {
    await fs.mkdir(path.dirname(this.opts.dbPath), { recursive: true });
    const ordered: Database = COLLECTIONS.reduce((acc, key) => {
      (acc as any)[key] = (db as any)[key] ?? [];
      return acc;
    }, emptyDatabase());
    await fs.writeFile(this.opts.dbPath, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
  }
}
