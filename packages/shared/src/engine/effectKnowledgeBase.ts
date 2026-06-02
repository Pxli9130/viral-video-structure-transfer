// EffectKnowledgeBase — a JSON-manifest-backed registry of known creative effects (built-in now,
// generated later). Lookup is by motif family. Built-in entries are always guaranteed present so the
// pipeline can render a motif effect even with no generated entries and no manifest file on disk.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MotifFamily } from "./creativeEffectSpec.js";

export type EffectSource = "built_in" | "generated";
export type EffectProvider = "gemini" | "local" | "built_in";
export type EffectValidationStatus = "pass" | "pass_with_preview_blocker" | "fail" | "not_required";

export interface EffectKnowledgeEntry {
  id: string;
  motifFamily: MotifFamily;
  effectName: string;
  componentName: string;
  componentPath: string;
  propsSchemaPath?: string;
  source: EffectSource;
  provider?: EffectProvider;
  validationStatus: EffectValidationStatus;
  /**
   * A generated effect is only allowed to run/override its motif's built-in when it has been
   * EXPLICITLY promoted (e.g. `--promote` at apply time). Default/absent === false, so a validated
   * but un-promoted generated effect never shadows a hand-built built-in. Built-ins ignore this flag.
   */
  promoted?: boolean;
  /** True when the component is exposed via `export default` — the static manifest must then use a
   * default import instead of a named one. Default/absent === false (named export). */
  defaultExport?: boolean;
  learnedFromSamples: string[];
  applicableWhen: string[];
  avoidWhen: string[];
  requiredProps: string[];
  createdAt: string;
}

export interface EffectKnowledgeBaseFile {
  version: "effect-kb.v1";
  entries: EffectKnowledgeEntry[];
}

const BUILT_IN_CREATED_AT = "2026-06-02T00:00:00.000Z";
const LIBRARY_DIR = "apps/api/remotion/effects/library";

/** The four built-in effects, one per non-generic motif family. Always guaranteed in a loaded KB. */
export const BUILT_IN_EFFECT_ENTRIES: readonly EffectKnowledgeEntry[] = [
  {
    id: "RibbonPosterSweep",
    motifFamily: "poster_ribbon_marketing",
    effectName: "RibbonPosterSweep",
    componentName: "RibbonPosterSweep",
    componentPath: `${LIBRARY_DIR}/RibbonPosterSweep.tsx`,
    source: "built_in",
    provider: "built_in",
    validationStatus: "not_required",
    learnedFromSamples: [],
    applicableWhen: ["poster", "ribbon", "gallery", "white_bg_marketing"],
    avoidWhen: ["dark_beat_cut"],
    requiredProps: ["width", "height", "fps", "durationSec", "texts", "colors"],
    createdAt: BUILT_IN_CREATED_AT
  },
  {
    id: "CardOrbitStack",
    motifFamily: "card_orbit_motion_graph",
    effectName: "CardOrbitStack",
    componentName: "CardOrbitStack",
    componentPath: `${LIBRARY_DIR}/CardOrbitStack.tsx`,
    source: "built_in",
    provider: "built_in",
    validationStatus: "not_required",
    learnedFromSamples: [],
    applicableWhen: ["card", "orbit", "stack", "scatter", "black_red"],
    avoidWhen: ["light_poster"],
    requiredProps: ["width", "height", "fps", "durationSec", "colors", "beats"],
    createdAt: BUILT_IN_CREATED_AT
  },
  {
    id: "BlueUiSpotlight",
    motifFamily: "blue_spotlight_ui_pitch",
    effectName: "BlueUiSpotlight",
    componentName: "BlueUiSpotlight",
    componentPath: `${LIBRARY_DIR}/BlueUiSpotlight.tsx`,
    source: "built_in",
    provider: "built_in",
    validationStatus: "not_required",
    learnedFromSamples: [],
    applicableWhen: ["blue", "ui", "dashboard", "spotlight", "search"],
    avoidWhen: ["warm_poster"],
    requiredProps: ["width", "height", "fps", "durationSec", "texts", "colors"],
    createdAt: BUILT_IN_CREATED_AT
  },
  {
    id: "BeatCutKineticText",
    motifFamily: "beat_cut_chinese_editing_tutorial",
    effectName: "BeatCutKineticText",
    componentName: "BeatCutKineticText",
    componentPath: `${LIBRARY_DIR}/BeatCutKineticText.tsx`,
    source: "built_in",
    provider: "built_in",
    validationStatus: "not_required",
    learnedFromSamples: [],
    applicableWhen: ["chinese_text", "beat_cut", "glitch", "whip", "high_bpm"],
    avoidWhen: ["calm_poster"],
    requiredProps: ["width", "height", "fps", "durationSec", "texts", "colors", "beats"],
    createdAt: BUILT_IN_CREATED_AT
  },
  {
    id: "SplitScreenCompare",
    motifFamily: "split_screen_compare",
    effectName: "SplitScreenCompare",
    componentName: "SplitScreenCompare",
    componentPath: `${LIBRARY_DIR}/SplitScreenCompare.tsx`,
    source: "built_in",
    provider: "built_in",
    validationStatus: "not_required",
    learnedFromSamples: [],
    applicableWhen: ["split_screen", "side_by_side", "before_after", "comparison", "对比"],
    avoidWhen: ["single_subject"],
    requiredProps: ["width", "height", "fps", "durationSec", "texts", "colors"],
    createdAt: BUILT_IN_CREATED_AT
  }
];

export function defaultEffectKbPath(): string {
  return path.resolve(process.cwd(), "docs/artifacts/effect-kb/effects.json");
}

function withBuiltIns(entries: EffectKnowledgeEntry[]): EffectKnowledgeEntry[] {
  const byId = new Map<string, EffectKnowledgeEntry>();
  // Built-ins first, then file entries override/add (so a manifest can extend, generated entries win).
  for (const entry of BUILT_IN_EFFECT_ENTRIES) byId.set(entry.id, { ...entry });
  for (const entry of entries) if (entry && typeof entry.id === "string") byId.set(entry.id, entry);
  return [...byId.values()];
}

/** Load the KB from the JSON manifest; built-in entries are always guaranteed present. */
export function loadEffectKnowledgeBase(filePath: string = defaultEffectKbPath()): EffectKnowledgeBaseFile {
  let fileEntries: EffectKnowledgeEntry[] = [];
  try {
    if (existsSync(filePath)) {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<EffectKnowledgeBaseFile>;
      if (Array.isArray(parsed.entries)) fileEntries = parsed.entries as EffectKnowledgeEntry[];
    }
  } catch {
    fileEntries = [];
  }
  return { version: "effect-kb.v1", entries: withBuiltIns(fileEntries) };
}

/** Persist the KB JSON manifest (creates the directory if needed). */
export function saveEffectKnowledgeBase(kb: EffectKnowledgeBaseFile, filePath: string = defaultEffectKbPath()): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(kb, null, 2)}\n`, "utf8");
}

/** Insert or replace an entry by id (pure — returns a new KB object). */
export function upsertEffectKnowledgeEntry(kb: EffectKnowledgeBaseFile, entry: EffectKnowledgeEntry): EffectKnowledgeBaseFile {
  const entries = kb.entries.filter((e) => e.id !== entry.id);
  entries.push(entry);
  return { version: "effect-kb.v1", entries };
}

export function findEffectsByMotif(kb: EffectKnowledgeBaseFile, motifFamily: MotifFamily): EffectKnowledgeEntry[] {
  return kb.entries.filter((e) => e.motifFamily === motifFamily);
}

/** A generated effect is only usable when its validation passed. Failed/unvalidated are excluded. */
const SAFE_GENERATED_STATUS = new Set<EffectValidationStatus>(["pass", "pass_with_preview_blocker"]);

/**
 * Return a generated effect that may override the motif's built-in. It must be (a) validated AND
 * (b) explicitly promoted. Validated-but-un-promoted generated effects (e.g. crude local_fallback
 * proposals) are intentionally NOT returned, so they never shadow a hand-built built-in.
 */
export function findValidatedGeneratedEffectByMotif(
  kb: EffectKnowledgeBaseFile,
  motifFamily: MotifFamily
): EffectKnowledgeEntry | undefined {
  return kb.entries.find(
    (e) =>
      e.motifFamily === motifFamily &&
      e.source === "generated" &&
      e.promoted === true &&
      SAFE_GENERATED_STATUS.has(e.validationStatus)
  );
}

export function findBuiltInEffectByMotif(
  kb: EffectKnowledgeBaseFile,
  motifFamily: MotifFamily
): EffectKnowledgeEntry | undefined {
  return kb.entries.find((e) => e.motifFamily === motifFamily && e.source === "built_in");
}
