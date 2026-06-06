// pipeline-v5/deriveSceneRecipes.ts
// Compute CONTENT-NEUTRAL per-scene visual recipes from the sample's already-extracted keyframes
// (scripts/analyze-scene-recipes.py — cv2 palette/grading/subject-anchor/camera/text-anchor). This is
// what lets each capsule reconstruct ITS source's look (4 sources -> 4 distinct templates). Captures
// only structure (positions / motion labels / grading) — never pixels or OCR text. Offline + graceful:
// no conda or no frames on disk -> returns [] and the caller uses role-varied deterministic fallbacks.

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v5 } from "@vvst/shared";
import { runPython, hasCondaEnv } from "../adapters/condaPython.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../../..");
const SCENE_SCRIPT = path.join(repoRoot, "scripts", "analyze-scene-recipes.py");

const ANCHORS = new Set(["top_left", "top_center", "top_right", "center_left", "center", "center_right", "bottom_left", "bottom_center", "bottom_right"]);

export interface SceneSectionMeta {
  id: string;
  role: string;
  startSec: number;
  endSec: number;
}

/**
 * Derive per-scene visual recipes. `storageRoot` is the dir that contains "generated" (so keyFrame
 * frameRef like "/generated/evidence/<id>/frame_000.png" resolves under it). Returns [] on any failure.
 */
export async function deriveSceneRecipes(
  evidence: v5.EvidenceTimelineV5,
  sections: SceneSectionMeta[],
  opts: { storageRoot?: string; timeoutMs?: number } = {}
): Promise<v5.SceneVisualRecipeV5[]> {
  const storageRoot = opts.storageRoot;
  const keyFrames = (evidence.keyFrames ?? []).map((k) => ({ timeSec: k.timeSec, frameRef: (k as { frameRef?: string }).frameRef })).filter((k) => k.frameRef);
  if (!storageRoot || !hasCondaEnv() || !keyFrames.length) return [];
  // Require at least one frame on disk — otherwise the analyzer can't see anything; fall back.
  const anyFrame = keyFrames.some((k) => existsSync(path.join(storageRoot, String(k.frameRef).replace(/^\//, ""))));
  if (!anyFrame) return [];

  const motion = evidence.motionEvidence ?? ({} as Record<string, unknown>);
  const cfg = {
    storageRoot,
    keyFrames,
    sections: sections.map((s) => ({ id: s.id, role: s.role, startSec: s.startSec, endSec: s.endSec })),
    motion: { peaks: (motion as { peakMomentsSec?: number[] }).peakMomentsSec ?? [], cutDensity: (motion as { cutDensity?: unknown }).cutDensity ?? 0.3 }
  };

  const cfgPath = path.join(repoRoot, "storage", "tmp", `scene-recipes-${evidence.assetId ?? "x"}-${sections.length}.json`);
  try {
    await fs.mkdir(path.dirname(cfgPath), { recursive: true });
    await fs.writeFile(cfgPath, JSON.stringify(cfg));
    const { stdout } = await runPython(SCENE_SCRIPT, [cfgPath], { cwd: repoRoot, timeoutMs: opts.timeoutMs ?? 90_000 });
    const parsed = JSON.parse(stdout) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((r) => sanitize(r as Record<string, unknown>)).filter(Boolean) as v5.SceneVisualRecipeV5[];
  } catch {
    return [];
  } finally {
    fs.rm(cfgPath, { force: true }).catch(() => undefined);
  }
}

/** Validate/clamp a python recipe into the contract (defensive — never trust raw model/script output). */
function sanitize(r: Record<string, unknown>): v5.SceneVisualRecipeV5 | null {
  if (!r || typeof r.sectionId !== "string") return null;
  const anchor = (a: unknown): v5.AnchorV5 => (typeof a === "string" && ANCHORS.has(a) ? (a as v5.AnchorV5) : "center");
  const g = (r.grading ?? {}) as Record<string, unknown>;
  const subj = (r.subject ?? {}) as Record<string, unknown>;
  return {
    sectionId: r.sectionId,
    role: typeof r.role === "string" ? r.role : "",
    transitionIn: (r.transitionIn as v5.TransitionInV5) ?? "hard_cut",
    subject: {
      anchor: anchor(subj.anchor),
      areaRatio: clamp01(subj.areaRatio, 0.4),
      cameraMove: (subj.cameraMove as v5.CameraMoveV5) ?? "push_in",
      motionIntensity: clamp01(subj.motionIntensity, 0.4)
    },
    textAnchor: anchor(r.textAnchor),
    textAnim: (r.textAnim as v5.TextAnimV5) ?? "word_stagger",
    grading: {
      mood: (g.mood as v5.GradingMoodV5) ?? "neutral",
      brightness: clamp01(g.brightness, 0.5),
      saturation: clamp01(g.saturation, 0.4),
      palette: Array.isArray(g.palette) ? (g.palette as unknown[]).filter((x) => typeof x === "string").slice(0, 5) as string[] : []
    },
    source: r.source === "vlm" ? "vlm" : "deterministic",
    confidence: clamp01(r.confidence, 0.4)
  };
}

function clamp01(v: unknown, d: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : d;
}
