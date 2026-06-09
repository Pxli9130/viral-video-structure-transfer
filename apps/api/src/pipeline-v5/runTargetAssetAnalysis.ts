// pipeline-v5/runTargetAssetAnalysis.ts
// Stage 8 (deterministic core): build a TargetAssetProfile from an ingested Asset without a VLM.
// Labels come from filename/tags; best section is a heuristic. The AI analyzer layers on top later.

import type { Asset } from "@vvst/shared";
import { v5 } from "@vvst/shared";

function kindOf(asset: Asset): v5.TargetAssetProfile["kind"] {
  if (asset.type === "image") return /logo/i.test(asset.filename) ? "logo" : "image";
  if (asset.type === "video") return "video";
  if (asset.type === "audio") return "audio";
  return "text";
}

function bestSectionFor(asset: Asset, kind: v5.TargetAssetProfile["kind"]): v5.SectionRoleV5 {
  const name = `${asset.filename} ${(asset.tags ?? []).join(" ")}`.toLowerCase();
  if (/hero|cover|main/.test(name)) return "hook";
  if (/cta|buy|shop|logo/.test(name) || kind === "logo") return "cta";
  if (/detail|close|spec|proof/.test(name)) return "proof";
  return "benefit";
}

export function runTargetAssetAnalysis(asset: Asset): v5.TargetAssetProfile {
  const kind = kindOf(asset);
  const labels = Array.from(
    new Set(
      [...(asset.tags ?? []), ...asset.filename.replace(/\.[a-z0-9]+$/i, "").split(/[\s_\-.]+/)]
        .map((s) => s.toLowerCase())
        .filter((s) => s.length > 1)
    )
  ).slice(0, 12);
  const widthMeta = asset.metadata?.width;
  const heightMeta = asset.metadata?.height;
  return {
    id: `tap_${asset.id}`,
    assetId: asset.id,
    kind,
    labels,
    qualityScore: kind === "text" ? 0.5 : 0.7,
    bestSection: bestSectionFor(asset, kind),
    extractedText: asset.type === "text" ? asset.text : undefined,
    hasAudio: typeof asset.metadata?.hasAudio === "boolean" ? (asset.metadata.hasAudio as boolean) : kind === "video" ? true : false,
    motionSummary: kind === "video" ? "target video clip" : undefined,
    ...(typeof widthMeta === "number" && typeof heightMeta === "number"
      ? { cropSuggestions: [{ x: 0, y: 0, w: widthMeta, h: heightMeta, reason: "full frame" }] }
      : {})
  };
}

export function runTargetAssetAnalysisMany(assets: Asset[]): v5.TargetAssetProfile[] {
  return assets.map(runTargetAssetAnalysis);
}

// ---------------------------------------------------------------------------------------------------
// VLM (vision) enrichment — actually LOOK at the uploaded asset's pixels (a multimodal model can; Doubao,
// being text-only, cannot). Upgrades the heuristic profile with shot/scene/subject/highlight/bestSection.
// Gated by the caller (ALLOW_EXTERNAL_VLM_USER_ASSET_ANALYSIS); on any failure the heuristic profile is kept.
// ---------------------------------------------------------------------------------------------------

const VLM_ASSET_PROMPT = `You are analysing ONE user-supplied advertising asset (an image, or a single frame grabbed from a video). Look at the pixels and return ONLY JSON, no markdown:
{"shotType":"<product close-up|talking head|wide lifestyle|text card|logo|screenshot|...>","sceneType":"product|person|lifestyle|testimonial|text|scene|other","detectedSubjects":["main visible subjects e.g. sneaker, hand, woman, office"],"bestSection":"hook|benefit|proof|cta","isHighlight":<true if visually striking / good as an opening or hero shot>,"qualityScore":<0..1 visual quality & usability>,"summary":"<one short sentence of what it shows>"}`;

const VLM_SCENE_TYPES = new Set(["product", "person", "lifestyle", "testimonial", "text", "scene", "other"]);
const VLM_ROLES = new Set<v5.SectionRoleV5>(["hook", "benefit", "proof", "cta"]);

function mimeForImage(p: string): string {
  const e = p.toLowerCase();
  return e.endsWith(".png") ? "image/png" : e.endsWith(".webp") ? "image/webp" : e.endsWith(".gif") ? "image/gif" : "image/jpeg";
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fenced ? fenced[1] : raw;
    const s = body.indexOf("{");
    const e = body.lastIndexOf("}");
    if (s < 0 || e <= s) return null;
    return JSON.parse(body.slice(s, e + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Grab one representative frame of a video to PNG via ffmpeg; returns base64 + mime, or null on failure. */
async function grabVideoFrameB64(videoPath: string): Promise<{ b64: string; mime: string } | null> {
  const { promises: fs } = await import("node:fs");
  const { spawn } = await import("node:child_process");
  const path = (await import("node:path")).default;
  const { resolveBin } = await import("./renderV5.js");
  const { nextSeq } = await import("./concurrency.js");
  const out = path.join(path.dirname(videoPath), `._vlmframe_${Date.now()}_${nextSeq()}.png`);
  const code = await new Promise<number>((resolve) => {
    const p = spawn(resolveBin("ffmpeg"), ["-y", "-ss", "0.8", "-i", videoPath, "-frames:v", "1", "-vf", "scale=512:-1", out], { stdio: "ignore" });
    p.on("error", () => resolve(-1));
    p.on("close", (c) => resolve(c ?? -1));
  });
  try {
    if (code !== 0) return null;
    const buf = await fs.readFile(out);
    return buf.length ? { b64: buf.toString("base64"), mime: "image/png" } : null;
  } catch {
    return null;
  } finally {
    await fs.rm(out, { force: true }).catch(() => {});
  }
}

/**
 * Enrich heuristic TargetAssetProfiles by having a VISION model look at each image/video asset's pixels.
 * `visionFn` is `createGeminiVisionFn` (base64,mime,prompt)->json. Per-asset failure keeps the heuristic
 * profile (never blocks generation). Pass `undefined` to skip entirely (returns the input unchanged).
 */
export async function enrichProfilesWithVlm(
  profiles: v5.TargetAssetProfile[],
  assets: Asset[],
  visionFn: ((imageBase64: string, mimeType: string, prompt: string) => Promise<string>) | null | undefined,
  opts: { concurrency?: number } = {}
): Promise<v5.TargetAssetProfile[]> {
  if (!visionFn || !profiles.length) return profiles;
  const { mapLimit } = await import("./concurrency.js");
  const { promises: fs } = await import("node:fs");
  const byId = new Map(assets.map((a) => [a.id, a]));
  return mapLimit(profiles, Math.max(1, opts.concurrency ?? 4), async (profile) => {
    const asset = byId.get(profile.assetId);
    const isMedia = profile.kind === "image" || profile.kind === "video" || profile.kind === "logo";
    if (!asset?.path || !isMedia) return profile;
    try {
      let frame: { b64: string; mime: string } | null = null;
      if (asset.type === "video") frame = await grabVideoFrameB64(asset.path);
      else { const buf = await fs.readFile(asset.path); frame = { b64: buf.toString("base64"), mime: mimeForImage(asset.path) }; }
      if (!frame) return profile;
      const o = extractJsonObject(await visionFn(frame.b64, frame.mime, VLM_ASSET_PROMPT));
      if (!o) return profile;
      const subjects = Array.isArray(o.detectedSubjects) ? o.detectedSubjects.map((s) => String(s)).filter(Boolean).slice(0, 8) : undefined;
      const shotType = typeof o.shotType === "string" ? o.shotType : undefined;
      const sceneType = typeof o.sceneType === "string" && VLM_SCENE_TYPES.has(o.sceneType) ? (o.sceneType as v5.TargetAssetProfile["sceneType"]) : undefined;
      const bestSection = typeof o.bestSection === "string" && VLM_ROLES.has(o.bestSection as v5.SectionRoleV5) ? (o.bestSection as v5.SectionRoleV5) : profile.bestSection;
      const summary = typeof o.summary === "string" ? o.summary : undefined;
      const labels = Array.from(new Set([...(profile.labels ?? []), ...(subjects ?? []), ...(shotType ? [shotType] : [])].map((s) => String(s).toLowerCase()))).slice(0, 16);
      return {
        ...profile,
        vlmAnalyzed: true,
        shotType: shotType ?? profile.shotType,
        sceneType: sceneType ?? profile.sceneType,
        detectedSubjects: subjects ?? profile.detectedSubjects,
        isHighlight: typeof o.isHighlight === "boolean" ? o.isHighlight : profile.isHighlight,
        bestSection,
        qualityScore: typeof o.qualityScore === "number" ? Math.max(0, Math.min(1, o.qualityScore)) : profile.qualityScore,
        motionSummary: asset.type === "video" ? (summary ?? profile.motionSummary) : profile.motionSummary,
        vlmSummary: summary,
        labels
      };
    } catch {
      return profile;
    }
  });
}
