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
