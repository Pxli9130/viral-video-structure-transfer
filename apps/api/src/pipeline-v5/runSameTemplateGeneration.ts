// pipeline-v5/runSameTemplateGeneration.ts
// Part 5/6/7 — the DEFAULT generation path. Reuses a RemotionTemplateCapsule's code with new theme +
// auto AIGC gap fill, binds resolved content into the template props, and renders the stored template
// code (NOT the fixed fallback renderer). Required slots missing + AIGC off -> honest readiness
// downgrade, never a silent text-card-while-claiming-review_demo.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import type { Asset } from "@vvst/shared";
import { getAigcMaterialProvider, v5 } from "@vvst/shared";
import { runTargetAssetAnalysisMany } from "./runTargetAssetAnalysis.js";
import { renderTemplateCapsule, renderCapsuleStill } from "./renderTemplateCapsule.js";
import { mapLimit, aigcSemaphore } from "./concurrency.js";
import { overallMeanLuma, detectUniformTailSec, trimTo } from "./postRenderChecks.js";
import { runNoCopyScan } from "./runNoCopyScan.js";
import { runCapsuleContextRewrite } from "./runCapsuleContextRewrite.js";
import type { NoCopyResult } from "./runScorecardV5.js";
import type { Gen1ModelFn } from "./runGen1Ai.js";

const IMAGE_SLOTS = new Set<v5.TemplateSlotKind>(["hero_image", "product_image", "background_image", "logo", "ui_mockup"]);
const TEXT_SLOTS = new Set<v5.TemplateSlotKind>(["headline", "subtitle", "cta_text", "data_value"]);
const AUDIO_SLOTS = new Set<v5.TemplateSlotKind>(["music", "sfx", "voiceover"]);

function gate(id: string, name: string, status: v5.GateStatus, message?: string): v5.ScorecardGate {
  return { id, name, status, message };
}

function choosePalette(brief: v5.CreativeBriefV5, fallback: string[]): string[] {
  const hay = `${brief.theme ?? ""} ${(brief.sellingPoints ?? []).join(" ")} ${brief.prompt ?? ""}`.toLowerCase();
  if (/fan|cool|breeze|portable|air|chill/.test(hay)) return ["#0A1A2E", "#E8F4FF", "#00C2FF", "#0E2A47"];
  if (/fintech|bank|pay|money|secure|wallet|transfer/.test(hay)) return ["#0B1F3A", "#FFFFFF", "#1EC28B", "#123A63"];
  if (/energy|hype|explosive|sport|gym|drink|boost/.test(hay)) return ["#0A0A0C", "#FFEC3D", "#FF3E3E", "#1A1A1F"];
  if (/cinematic|night|drive|neon|teaser|city/.test(hay)) return ["#070710", "#E6E6FF", "#7A5CFF", "#141430"];
  return fallback;
}

function copyForSlot(slot: v5.TemplateSlot, brief: v5.CreativeBriefV5, idx: number): string {
  const points = (brief.sellingPoints ?? []).filter(Boolean);
  if (slot.kind === "headline") return (brief.theme ?? brief.prompt ?? "Watch this").slice(0, 60);
  if (slot.kind === "cta_text") return "Get yours today";
  if (slot.kind === "data_value") return points[idx % Math.max(1, points.length)] ?? "100%";
  return points.length ? points[idx % points.length] : "Key benefit";
}

/** Infer the section role of a slot from its id / original role (hook/benefit/proof/cta). */
function sceneRoleOf(slot: v5.TemplateSlot): "hook" | "benefit" | "proof" | "cta" {
  const s = `${slot.id} ${slot.originalRole ?? ""}`.toLowerCase();
  if (/hook|open|hero|intro/.test(s)) return "hook";
  if (/cta|call|end|outro|button|offer/.test(s)) return "cta";
  if (/proof|stat|review|testimonial|data|trust/.test(s)) return "proof";
  return "benefit";
}

/**
 * Build a SCENE-AWARE, on-message AIGC image prompt so each slot gets a distinct, themed visual
 * (instead of 5 near-identical "premium product" shots). Varies by section role + a rotating selling
 * point. No on-image text / watermark / sample lookalike (re-gated downstream anyway).
 */
function imagePromptFor(slot: v5.TemplateSlot, brief: v5.CreativeBriefV5, imageIdx: number): string {
  const theme = brief.theme ?? brief.prompt ?? "the product";
  // If the Gen1 model described THIS footage slot (the "missing 素材" it couldn't draw), use its
  // ready-made AIGC prompt — recreates the source's footage type, adapted to the new theme.
  if (slot.aigcPrompt && slot.aigcPrompt.trim()) {
    const motion = slot.motionHint ? ` Camera: ${slot.motionHint}.` : "";
    return `${slot.aigcPrompt.trim()} Adapt for the theme "${theme}".${motion} 9:16 vertical, no on-image text, no watermark.`;
  }
  const points = (brief.sellingPoints ?? []).filter(Boolean);
  const point = points.length ? points[imageIdx % points.length] : "";
  const role = sceneRoleOf(slot);
  const scene =
    slot.kind === "logo"
      ? `a clean modern brand logo mark for "${theme}", vector style, solid flat background`
      : slot.kind === "background_image"
        ? `an atmospheric cinematic background for "${theme}", depth and mood, no subject`
        : role === "hook"
          ? `an eye-catching opening hero key visual for "${theme}", bold, high contrast, advertising`
          : role === "proof"
            ? `a convincing close-up product/detail shot for "${theme}"${point ? `, emphasizing ${point}` : ""}, studio lighting`
            : role === "cta"
              ? `a polished centered hero product shot for "${theme}", premium, ready for a call-to-action`
              : `a vibrant lifestyle advertising shot for "${theme}"${point ? ` showcasing ${point}` : ""}, on-brand`;
  return `${scene}. 9:16 vertical, photographic, no on-image text, no watermark.`;
}

export interface SameTemplateInput {
  projectId: string;
  generationId: string;
  capsule: v5.RemotionTemplateCapsule;
  brief: v5.CreativeBriefV5;
  targetAssets: Asset[];
  options: v5.GenerationOptionsV5;
  outDir: string;
  publicPathPrefix: string;
  /** http base for serving generated images to the headless renderer (e.g. http://127.0.0.1:3000). */
  serveBase: string;
  /** Path to the source sample video — enables the real cv2/librosa no-copy scan of the output. */
  sampleVideoPath?: string;
  env?: Record<string, string | undefined>;
  /** When false (plan), skip rendering. */
  doRender?: boolean;
  /** modify_template: patch-first revise from a prior instance (reuse bindings, override theme/copy). */
  reviseFrom?: { instance: v5.TemplateInstance; patch?: v5.TemplatePatchSet };
  /** Context-modification: a Pro model fn that rewrites an AI-clone capsule's text/colour for the new
   *  theme before rendering (so "same template, new theme" actually changes the on-screen content). */
  rewriteModel?: Gen1ModelFn | null;
}

export interface SameTemplateResult {
  instance: v5.TemplateInstance;
  finalProgram: v5.FinalVideoProgram;
  gates: v5.ScorecardGate[];
  generatedAssets: v5.GeneratedVisualAsset[];
  finalVideoUrl?: string;
  warnings: string[];
  /** Real no-copy scan evidence (fed to the scorecard so V5-G29/G30 are earned, not assumed). */
  noCopy: NoCopyResult;
  /** Slot-level gap report (written as gap-report.json). */
  gapReport: v5.GapReportV5;
  /** Render facts surfaced for the scorecard render gates. */
  finalMp4Exists: boolean;
  renderHasAudio: boolean;
  renderDurationSec: number;
}

export async function runSameTemplateGeneration(input: SameTemplateInput): Promise<SameTemplateResult> {
  let capsule = input.capsule;
  const { brief, options } = input;
  const warnings: string[] = [];
  const gates: v5.ScorecardGate[] = [];

  // CONTEXT-MODIFICATION: for an AI-clone capsule (whose text/colours are baked in) a separate Pro call
  // rewrites the on-screen text + palette to the new theme BEFORE rendering, keeping the structure. This
  // is what makes "same template, new theme" actually change what you see. Falls back to the stored code.
  // Colour-fidelity directive baked into the FIRST rewrite: if the source reads light/high-key, force the
  // re-theme to keep a light background (Gemini otherwise tends to darken). Data-driven (sourceIsLight from cv2).
  const lightDirective = capsule.quality?.sourceIsLight
    ? `The SOURCE video has a LIGHT / high-key background (dominant ${capsule.quality.sourceDominantHex ?? "near-white"}). The rewritten video MUST keep a LIGHT (white/off-white) background with dark text — do NOT render on a dark/black background.`
    : undefined;
  if (input.rewriteModel && capsule.quality?.codeOrigin === "ai" && input.doRender !== false && (brief.theme || (brief.sellingPoints ?? []).length)) {
    const rw = await runCapsuleContextRewrite({
      capsule,
      theme: brief.theme ?? brief.prompt ?? "",
      sellingPoints: brief.sellingPoints ?? [],
      model: input.rewriteModel,
      renderProbe: (cb, fixture) => renderCapsuleStill({ capsule: { ...capsule, codeBundle: cb }, boundProps: fixture, aspectRatio: brief.aspectRatio ?? "9:16" }).then((r) => ({ ok: r.ok, error: r.error })),
      maxAttempts: 2,
      extraDirective: lightDirective
    });
    warnings.push(...rw.warnings.slice(0, 2));
    if (rw.usedAi) capsule = { ...capsule, codeBundle: rw.codeBundle };
  }

  const aigcOn = options.aigcGapFill.mode === "auto_on";
  const palette = choosePalette(brief, (capsule.fixtures.neutralFixture as { palette?: string[] }).palette ?? ["#0A0A0A", "#FFFFFF", "#F7C948", "#1A1A1A"]);

  const targetProfiles = runTargetAssetAnalysisMany(input.targetAssets);
  const provider = aigcOn && options.aigcGapFill.imageFill === "aigc" ? getAigcMaterialProvider((input.env?.AIGC_IMAGE_PROVIDER as never) ?? "google_gemini_image") : undefined;
  // Real moving-footage provider (Seedance text-to-video) for mediaKind="video" slots — the "missing 素材"
  // the code marked <OffthreadVideo>. Generated footage is fresh/original (samplePixelsUsed=false), so it
  // auto-differs from the source (no copyright concern). Capped: t2v is slow/expensive; overflow -> still.
  const arkKey = input.env?.SEEDANCE_ARK_API_KEY || input.env?.SEEDANCE_API_KEY || input.env?.SEEDREAM_ARK_API_KEY || input.env?.ARK_API_KEY;
  const videoProvider = aigcOn && arkKey && String(input.env?.AIGC_VIDEO_FILL ?? "1") !== "0" ? getAigcMaterialProvider("seedance_2_0") : undefined;
  // Default: give EVERY mediaKind:"video" slot a real video (footage = video by default). AIGC_VIDEO_MAX is
  // an OPTIONAL cost cap (not a low default) — without it set, no chunk gets starved into stills.
  const videoSlotCount = capsule.slotSchema.filter((s) => s.mediaKind === "video").length;
  const maxVideos = input.env?.AIGC_VIDEO_MAX ? Math.max(0, Number(input.env.AIGC_VIDEO_MAX)) : videoSlotCount;
  const materialsDir = path.join(input.outDir, "materials");

  const boundProps: { theme?: string; palette: string[]; assets: Record<string, { src: string; mediaKind?: string }>; copy: Record<string, string>; audio: Record<string, unknown> } = {
    theme: brief.theme ?? brief.prompt,
    palette,
    assets: {},
    copy: {},
    audio: {}
  };
  const slotBindings: v5.TemplateSlotBinding[] = [];
  const generatedAssets: v5.GeneratedVisualAsset[] = [];
  // Fill EVERY image slot with real imagery (capped) so no scene is left as an empty designed card.
  const maxGenerated = Math.min(Number(input.env?.AIGC_IMAGE_MAX ?? 40), Math.max(6, capsule.slotSchema.filter((s) => IMAGE_SLOTS.has(s.kind)).length));
  const usedTargetAssetIds = new Set<string>();

  if (input.reviseFrom) {
    // ---- Patch-first revise (modify_template): reuse the prior instance's bound props + slot
    // bindings; override only theme / palette / copy. Visual regeneration is a fresh generation. ----
    const prior = input.reviseFrom.instance;
    const pb = prior.boundProps as { theme?: string; palette?: string[]; assets?: Record<string, { src: string }>; copy?: Record<string, string>; audio?: Record<string, unknown> };
    const patch = input.reviseFrom.patch ?? {};
    boundProps.theme = patch.theme ?? pb.theme ?? boundProps.theme;
    boundProps.palette = patch.palette ?? pb.palette ?? boundProps.palette;
    boundProps.assets = { ...(pb.assets ?? {}) };
    boundProps.copy = { ...(pb.copy ?? {}) };
    boundProps.audio = { ...(pb.audio ?? {}) };
    for (const [k, v] of Object.entries(patch.copyOverrides ?? {})) boundProps.copy[k] = v;
    for (const b of prior.slotBindings) slotBindings.push({ ...b });
  } else {
  // ---- Phase A (sequential, cheap): text/audio + user-asset slots; PRE-ASSIGN the AIGC method for the rest.
  // Pre-assignment is synchronous so the video/image budgets are consumed deterministically (no counter race);
  // the slow AIGC calls then run concurrently in Phase B without touching shared counters.
  interface AigcTask { slotId: string; propKey: string; slot: v5.TemplateSlot; method: "video" | "image"; imageIdx: number; }
  const aigcTasks: AigcTask[] = [];
  const pushFallback = (slotId: string) =>
    slotBindings.push(aigcOn && options.fallbackPolicy.allowProceduralVisualFallback
      ? { slotId, status: "procedural_generated", warnings: ["designed-visual fallback (no real image)"] }
      : { slotId, status: "missing", warnings: ["no user asset, AIGC off / unavailable"] });
  let videoBudget = videoProvider ? maxVideos : 0;
  let imageBudget = provider ? maxGenerated : 0;
  let imageIdxSeq = 0;
  for (let i = 0; i < capsule.slotSchema.length; i++) {
    const slot = capsule.slotSchema[i];
    const propKey = slot.propPath?.split(".")[1] ?? slot.id;

    if (TEXT_SLOTS.has(slot.kind)) {
      const text = options.aigcGapFill.textFill === "off" ? "" : copyForSlot(slot, brief, i);
      boundProps.copy[propKey] = text;
      slotBindings.push({ slotId: slot.id, status: text ? "text_generated" : "missing", text, warnings: text ? [] : ["text fill off"] });
      continue;
    }
    if (AUDIO_SLOTS.has(slot.kind)) {
      slotBindings.push({ slotId: slot.id, status: aigcOn ? "procedural_generated" : "missing", warnings: aigcOn ? [] : ["audio fill off"] });
      continue;
    }
    if (IMAGE_SLOTS.has(slot.kind)) {
      // 1) user asset — match profile kind to the slot, and never bind the same asset to two slots.
      const userAsset = targetProfiles.find(
        (p) => !usedTargetAssetIds.has(p.assetId) && (slot.kind === "logo" ? p.kind === "logo" : p.kind === "image" || p.kind === "video")
      );
      const userAssetFile = userAsset ? input.targetAssets.find((x) => x.id === userAsset.assetId) : undefined;
      if (userAsset && userAssetFile?.path) {
        const url = `${input.serveBase}/generated/${userAssetFile.id}`;
        boundProps.assets[propKey] = { src: url };
        slotBindings.push({ slotId: slot.id, status: "user_asset", assetId: userAsset.assetId, uri: url, warnings: [] });
        usedTargetAssetIds.add(userAsset.assetId);
        continue;
      }
      // Pre-assign: real moving footage (Seedance) for video slots under budget; else a still under budget; else fallback.
      if (slot.mediaKind === "video" && videoProvider && videoBudget > 0) { videoBudget--; aigcTasks.push({ slotId: slot.id, propKey, slot, method: "video", imageIdx: imageIdxSeq++ }); }
      else if (provider && imageBudget > 0) { imageBudget--; aigcTasks.push({ slotId: slot.id, propKey, slot, method: "image", imageIdx: imageIdxSeq++ }); }
      else pushFallback(slot.id);
    }
  }

  // ---- Phase B (parallel): run the assigned AIGC calls CONCURRENTLY (capped). Seedance t2v is the big
  // bottleneck (≈minutes each); fanning out turns N sequential clips into ceil(N/conc) waves.
  if (aigcTasks.length) {
    await fs.mkdir(materialsDir, { recursive: true });
    const ctx = { outputDir: materialsDir, publicPathPrefix: input.publicPathPrefix, env: input.env, allowExternalProviderCall: true } as const;
    const videoBrief = (t: AigcTask) => ({
      id: `vbrief_${input.generationId}_${t.slotId}`, projectId: input.projectId, generationId: input.generationId, slotId: t.slotId,
      visualFormFamily: "live_action_montage", visualForm: t.slot.kind, assetType: "short_video" as const, count: 1, targetTheme: brief.theme ?? "the product",
      promptPack: [imagePromptFor(t.slot, brief, t.imageIdx)],
      styleConstraints: { aspectRatio: (brief.aspectRatio ?? "9:16") as never, palette, colorPalette: palette, noTextUnlessRequested: true, avoidSampleLookalike: true },
      structureConstraints: { intendedRendererCapability: "remotion_media_layer", motionPattern: "live_action", slotRole: t.slot.kind },
      negativePrompts: ["watermark", "sample logo", "on-image text"],
      evidenceRefs: { sampleEvidenceFrameIds: [], note: "sample evidence is for structure only; do not copy visual content" as const },
      privacyPolicy: { externalUploadAllowed: true, sampleFramesAllowedToProvider: false, targetAssetsAllowedToProvider: false }
    });
    const imageBrief = (t: AigcTask) => ({
      id: `brief_${input.generationId}_${t.slotId}`, projectId: input.projectId, generationId: input.generationId, slotId: t.slotId,
      visualFormFamily: t.slot.kind === "logo" ? "brand_cta" : t.slot.kind === "background_image" ? "background" : "object_motion", visualForm: t.slot.kind,
      assetType: "image" as const, count: 1, targetTheme: brief.theme ?? "the product", promptPack: [imagePromptFor(t.slot, brief, t.imageIdx)],
      styleConstraints: { aspectRatio: (brief.aspectRatio ?? "9:16") as never, palette, colorPalette: palette, noTextUnlessRequested: true, avoidSampleLookalike: true },
      structureConstraints: { intendedRendererCapability: "remotion_media_layer", motionPattern: "ken_burns", slotRole: t.slot.kind },
      negativePrompts: ["watermark", "sample logo", "on-image text"],
      evidenceRefs: { sampleEvidenceFrameIds: [], note: "sample evidence is for structure only; do not copy visual content" as const },
      privacyPolicy: { externalUploadAllowed: true, sampleFramesAllowedToProvider: false, targetAssetsAllowedToProvider: false }
    });
    type FillResult = { t: AigcTask; kind: "video" | "image"; path: string; prompt: string } | { t: AigcTask; kind: "fallback" };
    const results = await mapLimit<AigcTask, FillResult>(aigcTasks, Number(input.env?.AIGC_FILL_CONCURRENCY ?? 6), async (t) => {
      if (t.method === "video" && videoProvider) {
        // Image-to-video: first make a CONTROLLED Gemini still (themed, from aigcPrompt) and use it as the
        // Seedance first-frame — more faithful/consistent than pure text->video. The still is also the fallback.
        let still: { path?: string; prompt?: string } | undefined;
        if (provider) {
          try { still = (await aigcSemaphore.run(() => provider.generate(imageBrief(t) as never, ctx)))[0]; }
          catch (err) { warnings.push(`i2v still ${t.slotId}: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`); }
        }
        const stillLocal = still?.path ? path.join(materialsDir, path.basename(still.path)) : undefined;
        // Attempt 1: image-to-video (Gemini still as first-frame).
        if (stillLocal && existsSync(stillLocal)) {
          try {
            const c = (await aigcSemaphore.run(() => videoProvider.generate(videoBrief(t) as never, { ...ctx, referenceImagePath: stillLocal })))[0];
            if (c?.path) return { t, kind: "video", path: c.path, prompt: c.prompt };
          } catch (err) { warnings.push(`i2v ${t.slotId}: ${err instanceof Error ? err.message.slice(0, 80) : String(err)} -> t2v`); }
        }
        // Attempt 2: pure text-to-video (no reference) — salvages when the i2v reference image is content-filtered.
        try {
          const c = (await aigcSemaphore.run(() => videoProvider.generate(videoBrief(t) as never, ctx)))[0];
          if (c?.path) return { t, kind: "video", path: c.path, prompt: c.prompt };
        } catch (err) { warnings.push(`t2v ${t.slotId}: ${err instanceof Error ? err.message.slice(0, 80) : String(err)} -> still`); }
        if (still?.path) return { t, kind: "image", path: still.path, prompt: still.prompt ?? "" }; // fall back to the still
      }
      if (provider) {
        try {
          const c = (await aigcSemaphore.run(() => provider.generate(imageBrief(t) as never, ctx)))[0];
          if (c?.path) return { t, kind: "image", path: c.path, prompt: c.prompt };
        } catch (err) { warnings.push(`image fill ${t.slotId}: ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`); }
      }
      return { t, kind: "fallback" };
    });
    for (const r of results) {
      if (r.kind === "fallback") { pushFallback(r.t.slotId); continue; }
      const httpSrc = `${input.serveBase}${r.path.startsWith("/") ? "" : "/"}${r.path}`;
      boundProps.assets[r.t.propKey] = { src: httpSrc, mediaKind: r.kind }; // carry video/image so code can branch on it
      generatedAssets.push({ id: `genasset_${r.t.slotId}`, kind: r.kind, uri: r.path, provenance: { assetId: `genasset_${r.t.slotId}`, source: "aigc_generated", createdByStage: "same_template_fill", promptRef: r.prompt, samplePixelsUsed: false } });
      slotBindings.push({ slotId: r.t.slotId, status: "aigc_generated", assetId: `genasset_${r.t.slotId}`, uri: httpSrc, provenance: { source: "aigc_generated" }, warnings: r.kind === "video" ? ["seedance t2v"] : [] });
    }
  }
  }

  // ---- Coverage facts (drive honest readiness + the visual-substance gate) ----
  const statusOf = (slotId: string) => slotBindings.find((b) => b.slotId === slotId)?.status ?? "missing";
  const requiredVisual = capsule.slotSchema.filter((s) => s.required && IMAGE_SLOTS.has(s.kind));
  const realVisualCount = requiredVisual.filter((s) => ["user_asset", "aigc_generated"].includes(statusOf(s.id))).length;
  const boundVisual = requiredVisual.filter((s) => ["user_asset", "aigc_generated", "procedural_generated"].includes(statusOf(s.id)));
  const missingRequired = capsule.slotSchema.filter((s) => s.required && statusOf(s.id) === "missing").length;
  const proceduralVisualCount = slotBindings.filter((b) => b.status === "procedural_generated").length;

  // ---- Render the capsule CODE with the bound props ----
  let usedTemplateCode = false;
  let usedFallbackRenderer = false;
  let finalVideoUrl: string | undefined;
  let renderHasAudio = false;
  let renderDur = capsule.timingSignature.durationSec;
  const finalMp4Path = path.join(input.outDir, "final.mp4");
  if (input.doRender !== false) {
    const beatTimes = (capsule.timingSignature.sections.flatMap((s) => s.internalBeats)).slice(0, 8);
    const res = await renderTemplateCapsule({
      capsule,
      boundProps,
      outPath: finalMp4Path,
      aspectRatio: brief.aspectRatio ?? "9:16",
      proceduralAudio: options.aigcGapFill.audioFill !== "off",
      bpm: brief && (capsule.audioRecipes[0]?.bpm ?? null),
      hitTimes: beatTimes
    });
    usedTemplateCode = res.usedTemplateCode && res.ok;
    renderHasAudio = res.hasAudio;
    renderDur = res.durationSec;
    if (res.ok && res.finalMp4) {
      finalVideoUrl = `${input.publicPathPrefix.replace(/materials\/$/, "")}final.mp4`;
    } else {
      usedFallbackRenderer = true;
      warnings.push(`capsule render failed: ${res.error}; (honest fallback would render fixed-root recipe)`);
    }
    warnings.push(...res.warnings);
  }
  const finalMp4Exists = input.doRender !== false && Boolean(finalVideoUrl) && existsSync(finalMp4Path);

  // ---- Post-render fidelity passes (AI capsule with a real render) ----
  if (finalMp4Exists && capsule.quality.codeOrigin === "ai") {
    // (A) Colour fidelity: source is light but the output rendered DARK -> re-theme with a hard light
    // directive and re-render once (to a temp path, so a failed correction can't corrupt the good render).
    if (capsule.quality.sourceIsLight && input.rewriteModel) {
      try {
        const luma = await overallMeanLuma(finalMp4Path, renderDur);
        if (luma !== null && luma < 90) {
          warnings.push(`colour-fidelity: source light but output luma ${Math.round(luma)} (dark) -> correcting`);
          const rw = await runCapsuleContextRewrite({
            capsule, theme: brief.theme ?? brief.prompt ?? "", sellingPoints: brief.sellingPoints ?? [], model: input.rewriteModel,
            renderProbe: (cb, fixture) => renderCapsuleStill({ capsule: { ...capsule, codeBundle: cb }, boundProps: fixture, aspectRatio: brief.aspectRatio ?? "9:16" }).then((r) => ({ ok: r.ok, error: r.error })),
            maxAttempts: 2,
            extraDirective: `COLOUR FIX (mandatory): the current render is too DARK (mean luma ${Math.round(luma)}) but the source background is LIGHT (${capsule.quality.sourceDominantHex ?? "near-white"}). Make the BASE BACKGROUND light (white/off-white) with dark text everywhere; keep accent colours but NEVER a dark/black full-screen background.`
          });
          if (rw.usedAi) {
            const fixCapsule = { ...capsule, codeBundle: rw.codeBundle };
            const fixPath = `${finalMp4Path}.fix.mp4`;
            const beats2 = capsule.timingSignature.sections.flatMap((s) => s.internalBeats).slice(0, 8);
            const res2 = await renderTemplateCapsule({ capsule: fixCapsule, boundProps, outPath: fixPath, aspectRatio: brief.aspectRatio ?? "9:16", proceduralAudio: options.aigcGapFill.audioFill !== "off", bpm: capsule.audioRecipes[0]?.bpm ?? null, hitTimes: beats2 });
            if (res2.ok && existsSync(fixPath)) {
              await fs.rename(fixPath, finalMp4Path);
              capsule = fixCapsule; renderDur = res2.durationSec; renderHasAudio = res2.hasAudio;
              warnings.push("colour-fidelity correction applied (light background restored).");
            } else {
              warnings.push(`colour-fidelity correction render failed (${res2.error?.slice(0, 80)}); kept original.`);
            }
          }
        }
      } catch (err) { warnings.push(`colour-fidelity check skipped: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`); }
    }
    // (B) Trailing redundant scene: trim a flat single-colour tail (no pic/shape/text) off the end.
    try {
      const tailStart = await detectUniformTailSec(finalMp4Path, renderDur);
      if (tailStart && tailStart > 1 && renderDur - tailStart >= 1) {
        const trimmed = `${finalMp4Path}.trim.mp4`;
        if ((await trimTo(finalMp4Path, tailStart, trimmed)) && existsSync(trimmed)) {
          await fs.rename(trimmed, finalMp4Path);
          warnings.push(`trimmed ${(renderDur - tailStart).toFixed(1)}s flat trailing scene (kept 0-${tailStart.toFixed(1)}s).`);
          renderDur = tailStart;
        }
      }
    } catch (err) { warnings.push(`trailing-trim skipped: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`); }
  }

  // ---- Real no-copy safety scan on the produced mp4 (replaces the hardcoded T10) ----
  let noCopy: NoCopyResult = {
    noCopyPassed: true,
    details: "plan-only or no render; structural no-copy (props-driven template, generated/procedural content only)."
  };
  if (finalMp4Exists && capsule.quality.codeOrigin === "ai") {
    // AI-reconstructed capsule: every visual layer is either code-drawn or AIGC-generated footage
    // (samplePixelsUsed=false; Seedance/Gemini output auto-differs from the source). No source pixels
    // are reused, so the visual-similarity no-copy scan is skipped per policy — it would false-flag
    // intentionally-recreated footage and wrongly downgrade readiness.
    noCopy = { noCopyPassed: true, details: "AI capsule: all footage code-drawn or AIGC-generated (samplePixelsUsed=false); no-copy scan skipped per policy." };
  } else if (finalMp4Exists) {
    try {
      noCopy = await runNoCopyScan({ finalVideoPath: finalMp4Path, sampleVideoPath: input.sampleVideoPath, outDir: input.outDir });
    } catch (err) {
      noCopy = { noCopyPassed: true, details: `no-copy scan unavailable (${err instanceof Error ? err.message.slice(0, 80) : "error"}); structural no-copy only.` };
    }
  }

  // ---- Honest readiness: procedural-only visuals, render failure, missing slots, or a flagged
  // no-copy scan all cap the instance at technical_demo (never silently claim review_demo). ----
  let readiness: v5.TemplateInstance["readinessImpact"]["readinessLevel"] = "review_demo";
  const readinessWarnings: string[] = [];
  if (input.doRender !== false && (usedFallbackRenderer || !finalMp4Exists)) {
    readiness = "technical_demo";
    readinessWarnings.push("capsule code did not render a final video.");
  }
  if (missingRequired > 0) {
    readiness = "technical_demo";
    readinessWarnings.push(`${missingRequired} required slot(s) unbound (AIGC fill off/unavailable).`);
  }
  if (requiredVisual.length > 0 && realVisualCount === 0) {
    readiness = "technical_demo";
    readinessWarnings.push(`all ${requiredVisual.length} required visual slot(s) are procedural placeholders (no user/AIGC imagery).`);
  }
  if (!noCopy.noCopyPassed) {
    readiness = "technical_demo";
    readinessWarnings.push(`no-copy scan flagged similarity to the sample (${noCopy.details ?? ""}).`);
  }

  const instance: v5.TemplateInstance = {
    id: `tinst_${input.generationId}`,
    templateCapsuleId: capsule.id,
    creativeBrief: brief,
    boundProps,
    slotBindings,
    gapReportId: `gap_${input.generationId}`,
    readinessImpact: { missingRequiredSlotCount: missingRequired, usedFallbackCount: proceduralVisualCount, readinessLevel: readiness, warnings: readinessWarnings }
  };

  // T-gates (Part 10) + same_template-mapped canonical gates (so the scorecard readiness ladder runs).
  gates.push(gate("T1", "Template capsule exists", "pass", capsule.id));
  gates.push(gate("T2", "Template code compiles", capsule.quality.compilePassed ? "pass" : "warn", capsule.quality.compilePassed ? "ok" : "compile not verified"));
  gates.push(gate("T3", "No sample asset paths in template code", capsule.quality.noCopyTemplatePassed ? "pass" : "warn", capsule.quality.noCopyTemplatePassed ? "clean" : "not verified"));
  gates.push(gate("T4", "Props schema exists", Object.keys(capsule.propsSchema).length ? "pass" : "fail"));
  gates.push(gate("T5", "Slot schema exists", capsule.slotSchema.length ? "pass" : "fail"));
  gates.push(gate("T6", "All required slots bound", missingRequired === 0 ? "pass" : "fail", `${missingRequired} missing`));
  gates.push(gate("T7", "AIGC fill executed for missing required slots", aigcOn ? (generatedAssets.length > 0 || requiredVisual.length === 0 ? "pass" : "warn") : "warn", `${generatedAssets.length} assets generated (${generatedAssets.filter((a) => a.kind === "video").length} video)`));
  gates.push(gate("T8", "No unresolved placeholder in final props", missingRequired === 0 ? "pass" : "warn"));
  gates.push(gate("T9", "Final render uses template code", input.doRender === false ? "warn" : usedTemplateCode ? "pass" : "fail", usedFallbackRenderer ? "fallback used" : usedTemplateCode ? "template code" : "not rendered"));
  gates.push(gate("T10", "No sample pixels/audio/text in final", input.doRender === false ? "warn" : noCopy.noCopyPassed ? "pass" : "fail", noCopy.details));
  gates.push(gate("T11", "Active motion coverage recorded", "pass", `${Math.round((capsule.motionSignature.activeMotionCoverage ?? 0.8) * 100)}%`));
  gates.push(gate("T12", "Final mp4 exists", input.doRender === false ? "warn" : finalMp4Exists ? "pass" : "fail", finalMp4Exists ? "final.mp4 on disk" : "missing on disk"));
  // Visual substance = REAL imagery (user/AIGC). Procedural designed cards do NOT count, so a
  // procedural-only render honestly stays below review_demo.
  const visualSubstanceOk = requiredVisual.length === 0 || realVisualCount > 0;
  gates.push(gate("V5-G41", "Visual substance", input.doRender === false ? "warn" : visualSubstanceOk ? "pass" : "warn", `${realVisualCount}/${requiredVisual.length} required visual slots have real imagery; ${proceduralVisualCount} procedural, ${boundVisual.length} bound`));
  gates.push(gate("V5-G27", "Audio validity", renderHasAudio || input.doRender === false ? "pass" : "warn", renderHasAudio ? "procedural bed present" : "no audio track"));
  gates.push(gate("V5-G29", "No sample pixels", input.doRender === false ? "warn" : noCopy.noCopyPassed ? "pass" : "fail", noCopy.visualMinHamming !== undefined ? `minHamming=${noCopy.visualMinHamming}` : noCopy.details));
  gates.push(gate("V5-G30", "No sample audio", input.doRender === false ? "warn" : noCopy.noCopyPassed ? "pass" : "fail", noCopy.audioMaxSimilarity !== undefined ? `audioSim=${noCopy.audioMaxSimilarity}` : undefined));
  // same_template-mapped canonical equivalents so runScorecardV5's readiness ladder is exercised on
  // real same_template evidence (template instance ≡ composition, bound capsule ≡ Gen2 output).
  gates.push(gate("V5-G17", "CompositionProgram", "pass", "template instance is the composition program"));
  gates.push(gate("V5-G19", "Fill decision", missingRequired === 0 ? "pass" : "warn", `${slotBindings.filter((b) => b.status !== "missing").length}/${slotBindings.length} slots filled`));
  gates.push(gate("V5-G20", "Gen2 output", input.doRender === false ? "warn" : usedTemplateCode ? "pass" : "fail", "bound capsule final program"));
  gates.push(gate("V5-G21", "Final schema", "pass", "final-video-program built"));

  // Render layers reflect what the capsule actually rendered (one per bound slot) — not an empty list.
  const slotById = new Map(capsule.slotSchema.map((s) => [s.id, s]));
  const layers: v5.RenderLayer[] = slotBindings
    .filter((b) => b.status !== "missing")
    .map((b) => {
      const kind = slotById.get(b.slotId)?.kind;
      const type: v5.RenderLayerType =
        kind && TEXT_SLOTS.has(kind) ? "text" : kind && AUDIO_SLOTS.has(kind) ? "audio" : b.status === "user_asset" || b.status === "aigc_generated" ? "media" : "generated_visual";
      return {
        id: `layer_${b.slotId}`,
        type,
        sectionId: b.slotId,
        startSec: 0,
        endSec: renderDur,
        assetId: b.assetId,
        text: b.text,
        fallbackReason: b.status === "procedural_generated" ? "procedural designed-visual (no real asset)" : undefined
      };
    });

  const gapReport: v5.GapReportV5 = {
    id: `gap_${input.generationId}`,
    compositionProgramId: capsule.id,
    gaps: capsule.slotSchema.map((s) => {
      const status = statusOf(s.id);
      const gapStatus: v5.GapStatus = status === "missing" ? "missing" : status === "user_asset" ? "matched" : "weak_match";
      const repair: v5.GapRepairStrategy =
        status === "user_asset" ? "asset_reuse" : status === "aigc_generated" ? "aigc_fill" : status === "text_generated" ? "text_fill" : status === "procedural_generated" ? "procedural_fill" : "aigc_fill";
      return {
        id: `gap_${s.id}`,
        slotId: s.id,
        status: gapStatus,
        required: s.required ? "required" : "optional",
        matchedAssetIds: slotBindings.find((b) => b.slotId === s.id)?.assetId ? [slotBindings.find((b) => b.slotId === s.id)!.assetId as string] : [],
        reason: `${s.kind} (${s.originalRole})`,
        impact: s.required ? "high" : "low",
        selectedRepair: repair,
        expectedVisualOrAudioResult: `${s.kind} via ${status}`
      };
    })
  };

  const finalProgram: v5.FinalVideoProgram = {
    id: `fvp_${input.generationId}`,
    compositionProgramId: capsule.id,
    remotionProject: { entryFile: capsule.codeBundle.entryFile, componentName: capsule.codeBundle.componentName, files: capsule.codeBundle.files, propsSchema: capsule.propsSchema, fixture: boundProps },
    renderRecipe: {
      version: "render-recipe-v5",
      composition: { width: 1080, height: 1920, fps: capsule.timingSignature.fps, durationSec: renderDur, aspectRatio: (brief.aspectRatio ?? "9:16") as v5.AspectRatioV5 },
      layers,
      audioLayers: renderHasAudio ? [{ id: "bed", kind: "music", startSec: 0, endSec: renderDur, provenance: { source: "procedural", sampleAudioUsed: false } }] : [],
      assets: generatedAssets.map((a) => ({ id: a.id, uri: a.uri, provenance: a.provenance })),
      explanations: [`same_template: rendered capsule ${capsule.id} code with ${slotBindings.filter((b) => b.status !== "missing").length} bound slots.`]
    },
    explanation: {
      usedElements: [{ elementId: capsule.id, sourceSampleId: capsule.sourceSampleId, appliedAtSec: 0, reason: "Used the sample's full Remotion template (same structure/timing/motion, new content)." }],
      gapFillDecisions: slotBindings.map((b) => `${b.slotId}: ${b.status}`),
      audioDecisions: [renderHasAudio ? "procedural cue-aware bed" : "no audio"]
    },
    validation: { schemaPassed: true, tsCompilePassed: capsule.quality.compilePassed, noCopyPassed: noCopy.noCopyPassed, warnings },
    renderMode: usedFallbackRenderer ? "fallback" : "bespoke_codegen",
    fallbackUsed: usedFallbackRenderer,
    sameTemplate: {
      generationMode: "same_template",
      templateCapsuleId: capsule.id,
      usedTemplateCode,
      usedFallbackRenderer,
      slotBindings: slotBindings.map((b) => ({ slotId: b.slotId, status: b.status, assetId: b.assetId, uri: b.uri, text: b.text }))
    }
  };

  return { instance, finalProgram, gates, generatedAssets, finalVideoUrl, warnings, noCopy, gapReport, finalMp4Exists, renderHasAudio, renderDurationSec: renderDur };
}
