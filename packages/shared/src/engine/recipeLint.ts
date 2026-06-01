import type {
  RenderRecipe,
  RenderRecipeLayer,
  RenderRecipeMediaLayer,
  RenderRecipeMotionAtomLayer,
  RenderRecipePrimitive,
  RenderRecipeTextLayer
} from "../types.js";
import { containsPromptLikeDisplayText } from "./renderRecipeV41.js";

export type RecipeLintIssueKind =
  | "missing_media_layer"
  | "missing_text_bbox"
  | "missing_font_size"
  | "unsupported_motion_atom"
  | "raw_prompt_render_risk"
  | "sample_asset_render_risk"
  | "missing_provenance"
  | "missing_evidence_refs"
  | "missing_fallback_reason"
  | "empty_audio_layers"
  | "unknown_primitive"
  | "provider_unavailable_without_fallback";

export type RecipeLintIssue = {
  severity: "info" | "warn" | "fatal";
  kind: RecipeLintIssueKind;
  path: string;
  message: string;
  suggestedPatch?: unknown;
  safeToAutoPatch: boolean;
};

export type RecipeLintReport = {
  status: "pass" | "warn" | "fail";
  issues: RecipeLintIssue[];
  safeToAutoPatch: boolean;
  patches: unknown[];
};

export interface RecipeLintOptions {
  audioStructure?: Record<string, unknown>;
  supportedPrimitives?: Set<string>;
  supportedMotionAtoms?: Set<string>;
  sampleAssetIds?: string[];
}

const SUPPORTED_PRIMITIVES = new Set<RenderRecipePrimitive | string>([
  "SourceClipBeatMontage",
  "ProductHeroOrbit",
  "FanHeroSpin",
  "ProductPosterHero",
  "FeatureCardStack",
  "MediaCardCascade",
  "KineticTypographySweep",
  "ParametricRibbonSurface",
  "TypographyLayoutSequence",
  "ImpactFlash",
  "PriceBadgePulse",
  "LightLeakTransition",
  "ObjectTrackReveal",
  "SplitScreenCompare",
  "CTAEndSlate",
  "DynamicProxyMontage"
]);

const SUPPORTED_MOTION_ATOMS = new Set(["parametric_ribbon_surface", "text_sweep_mask", "impact_flash", "light_sweep"]);

function push(issues: RecipeLintIssue[], issue: RecipeLintIssue): void {
  issues.push(issue);
}

function layerPath(layer: RenderRecipeLayer, index: number): string {
  return `/layers/${layer.id || index}`;
}

function clipPath(clipId: string, index: number): string {
  return `/clips/${clipId || index}`;
}

function isTextLayer(layer: RenderRecipeLayer): layer is RenderRecipeTextLayer {
  return layer.type === "text";
}

function isMediaLayer(layer: RenderRecipeLayer): layer is RenderRecipeMediaLayer {
  return layer.type === "media";
}

function isMotionAtomLayer(layer: RenderRecipeLayer): layer is RenderRecipeMotionAtomLayer {
  return layer.type === "motion_atom";
}

function evidenceMissing(layer: RenderRecipeLayer): boolean {
  return (layer.evidenceRefs?.length ?? 0) === 0 && !layer.fallbackReason;
}

function assetLooksSample(id: string, sampleIds: Set<string>): boolean {
  return sampleIds.has(id) || /^sample[:/_-]/i.test(id) || /sample[_/-]?(frame|audio|video|shot|reference)/i.test(id) || id.startsWith("evidence://");
}

function hasAudioEvidence(recipe: RenderRecipe, options: RecipeLintOptions): boolean {
  if ((recipe.evidenceSummary?.preservedEvidence.audioLayers ?? 0) > 0) return true;
  const layers = options.audioStructure?.estimatedLayers;
  return Boolean(layers && typeof layers === "object" && Object.keys(layers).length > 0);
}

function audioLayerCount(recipe: RenderRecipe): number {
  const layerCount = (recipe.layers ?? []).filter((layer) => layer.type === "audio").length;
  const planCount = Object.values(recipe.global.audioPlan.layers ?? {}).filter((value) => typeof value === "number" && Number.isFinite(value)).length;
  return Math.max(layerCount, planCount);
}

function displayTexts(recipe: RenderRecipe): Array<{ path: string; text: string | undefined }> {
  return [
    { path: "/productTheme/name", text: recipe.productTheme.name },
    { path: "/productTheme/productName", text: recipe.productTheme.productName },
    { path: "/productTheme/brandName", text: recipe.productTheme.brandName },
    { path: "/productTheme/cta", text: recipe.productTheme.cta },
    { path: "/productTheme/ctaText", text: recipe.productTheme.ctaText },
    ...(recipe.layers ?? [])
      .filter(isTextLayer)
      .map((layer, index) => ({ path: `${layerPath(layer, index)}/text/content`, text: layer.text.content })),
    ...recipe.clips.map((clip, index) => ({ path: `${clipPath(clip.clipId, index)}/text/copy`, text: clip.text.copy }))
  ];
}

export function lintRenderRecipe(recipe: RenderRecipe, options: RecipeLintOptions = {}): RecipeLintReport {
  const issues: RecipeLintIssue[] = [];
  const patches: unknown[] = [];
  const supportedPrimitives = options.supportedPrimitives ?? SUPPORTED_PRIMITIVES;
  const supportedMotionAtoms = options.supportedMotionAtoms ?? SUPPORTED_MOTION_ATOMS;
  const sampleIds = new Set([...(recipe.evidenceSummary?.sourceSampleIds ?? []), ...(options.sampleAssetIds ?? [])]);
  const layers = recipe.layers ?? [];

  recipe.clips.forEach((clip, index) => {
    const path = clipPath(clip.clipId, index);
    if (!supportedPrimitives.has(clip.selectedPrimitive) && !(clip as unknown as { fallbackComponent?: string }).fallbackComponent) {
      push(issues, {
        severity: "fatal",
        kind: "unknown_primitive",
        path: `${path}/selectedPrimitive`,
        message: `Unknown primitive ${clip.selectedPrimitive} has no fallbackComponent.`,
        safeToAutoPatch: false
      });
    }
    if (clip.material.kind !== "none" && clip.material.kind !== "procedural" && clip.material.assetIds.length) {
      const hasMediaLayer = layers.some((layer) => isMediaLayer(layer) && layer.clipId === clip.clipId && layer.material.assetIds.length > 0);
      if (!hasMediaLayer) {
        push(issues, {
          severity: "fatal",
          kind: "missing_media_layer",
          path,
          message: `Image/video-bearing clip ${clip.clipId} has material.assetIds but no matching MediaLayer.`,
          suggestedPatch: { op: "add_media_layer", clipId: clip.clipId },
          safeToAutoPatch: false
        });
      }
    }
    if ((clip.evidenceRefs?.length ?? 0) === 0 && !clip.primitiveReason) {
      push(issues, {
        severity: "warn",
        kind: "missing_evidence_refs",
        path,
        message: `Clip ${clip.clipId} has no evidenceRefs or primitiveReason.`,
        safeToAutoPatch: false
      });
    }
    for (const assetId of clip.material.assetIds ?? []) {
      if (clip.material.policy === "renderable" && assetLooksSample(assetId, sampleIds) && recipe.sourcePolicy.sampleUse !== "authorized_reuse") {
        push(issues, {
          severity: "fatal",
          kind: "sample_asset_render_risk",
          path: `${path}/material/assetIds`,
          message: `Renderable material references sample/evidence asset ${assetId}.`,
          safeToAutoPatch: false
        });
      }
    }
    if (clip.material.kind === "generated_target_asset" && clip.material.provenance !== "aigc_generated") {
      push(issues, {
        severity: "fatal",
        kind: "missing_provenance",
        path: `${path}/material/provenance`,
        message: `Generated material on clip ${clip.clipId} is missing aigc_generated provenance.`,
        suggestedPatch: { op: "replace", path: `${path}/material/provenance`, value: "aigc_generated" },
        safeToAutoPatch: true
      });
      patches.push({ op: "replace", path: `${path}/material/provenance`, value: "aigc_generated" });
    }
  });

  layers.forEach((layer, index) => {
    const path = layerPath(layer, index);
    if (isTextLayer(layer)) {
      if (!layer.layout?.bboxNorm) {
        push(issues, {
          severity: "fatal",
          kind: "missing_text_bbox",
          path: `${path}/layout/bboxNorm`,
          message: `TextLayer ${layer.id} is missing bboxNorm.`,
          safeToAutoPatch: false
        });
      }
      if (typeof layer.typography?.fontSizeRatio !== "number") {
        push(issues, {
          severity: "fatal",
          kind: "missing_font_size",
          path: `${path}/typography/fontSizeRatio`,
          message: `TextLayer ${layer.id} is missing fontSizeRatio.`,
          safeToAutoPatch: false
        });
      }
    }
    if (isMotionAtomLayer(layer) && !supportedMotionAtoms.has(layer.atom.kind)) {
      push(issues, {
        severity: "fatal",
        kind: "unsupported_motion_atom",
        path: `${path}/atom/kind`,
        message: `Motion atom ${layer.atom.kind} is not supported by the renderer contract.`,
        safeToAutoPatch: false
      });
    }
    if (isMediaLayer(layer)) {
      for (const assetId of layer.material.assetIds) {
        if (layer.material.policy === "renderable" && assetLooksSample(assetId, sampleIds) && recipe.sourcePolicy.sampleUse !== "authorized_reuse") {
          push(issues, {
            severity: "fatal",
            kind: "sample_asset_render_risk",
            path: `${path}/material/assetIds`,
            message: `Renderable media layer references sample/evidence asset ${assetId}.`,
            safeToAutoPatch: false
          });
        }
      }
      if (layer.material.kind === "generated_target_asset" && layer.material.provenance !== "aigc_generated") {
        push(issues, {
          severity: "fatal",
          kind: "missing_provenance",
          path: `${path}/material/provenance`,
          message: `Generated media layer ${layer.id} is missing aigc_generated provenance.`,
          suggestedPatch: { op: "replace", path: `${path}/material/provenance`, value: "aigc_generated" },
          safeToAutoPatch: true
        });
        patches.push({ op: "replace", path: `${path}/material/provenance`, value: "aigc_generated" });
      }
    }
    if (evidenceMissing(layer)) {
      push(issues, {
        severity: "warn",
        kind: "missing_evidence_refs",
        path: `${path}/evidenceRefs`,
        message: `Layer ${layer.id} has no evidenceRefs or fallbackReason.`,
        safeToAutoPatch: false
      });
    }
  });

  for (const item of displayTexts(recipe)) {
    if (item.text && containsPromptLikeDisplayText(item.text)) {
      push(issues, {
        severity: "fatal",
        kind: "raw_prompt_render_risk",
        path: item.path,
        message: "Display text contains prompt-like/raw instruction content.",
        safeToAutoPatch: false
      });
    }
  }

  if (hasAudioEvidence(recipe, options) && audioLayerCount(recipe) === 0) {
    push(issues, {
      severity: "fatal",
      kind: "empty_audio_layers",
      path: "/layers",
      message: "Audio evidence exists but recipe has no AudioLayer/audioPlan layer.",
      safeToAutoPatch: false
    });
  }

  for (const decision of recipe.providerDecisions ?? []) {
    if (decision.fallbackUsed && !decision.fallbackReason) {
      push(issues, {
        severity: decision.requiredForCoreDemo ? "fatal" : "warn",
        kind: "missing_fallback_reason",
        path: `/providerDecisions/${decision.task}`,
        message: `Provider decision ${decision.task} used fallback without fallbackReason.`,
        safeToAutoPatch: false
      });
    }
    if (decision.selectedProvider === "unavailable" && decision.requiredForCoreDemo) {
      push(issues, {
        severity: "fatal",
        kind: "provider_unavailable_without_fallback",
        path: `/providerDecisions/${decision.task}`,
        message: `Required provider decision ${decision.task} has no available fallback.`,
        safeToAutoPatch: false
      });
    }
  }

  const fatal = issues.some((issue) => issue.severity === "fatal");
  const warn = issues.some((issue) => issue.severity === "warn");
  const safeToAutoPatch = issues.length > 0 && issues.every((issue) => issue.safeToAutoPatch);
  return {
    status: fatal ? "fail" : warn ? "warn" : "pass",
    issues,
    safeToAutoPatch,
    patches: safeToAutoPatch ? patches : []
  };
}
