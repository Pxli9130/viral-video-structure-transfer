import { describe, expect, it } from "vitest";
import {
  applyRankedRepairOptions,
  buildDefaultProviderDecisions,
  buildModelRouteSummary,
  compilePromptPlanWithFallback,
  compileProviderPromptPlan,
  critiqueVideoOffline,
  curateTechniqueAtomDuplicates,
  generateStructureExplanation,
  lintRenderRecipe,
  planNaturalEditPatch,
  planVersionStrategy,
  rankGapRepairOptions,
  resolveModelRoute,
  retrieveTechniqueAtoms,
  type GapReportItem,
  type RenderRecipe,
  type TechniqueAtom
} from "../index.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function recipeFixture(): RenderRecipe {
  return {
    schemaVersion: "render-recipe-v1",
    version: "render-recipe-v4.1",
    videoType: "motion_graph",
    productTheme: {
      name: "AeroSpin",
      category: "portable fan",
      sellingPoints: ["fast cooling", "USB-C charging"],
      cta: "现在入手",
      productName: "AeroSpin"
    },
    sourcePolicy: {
      sampleUse: "structure_evidence_only",
      sourceVideoUse: "missing",
      targetAssetUse: "renderable_target_material",
      sampleFrameCopyAllowed: false,
      sampleAudioCopyAllowed: false
    },
    evidenceSummary: {
      sourceSampleIds: ["sample_1"],
      preservedEvidence: { visualElements: 2, typographyRuns: 2, motionAtoms: 1, audioLayers: 1 },
      droppedEvidence: []
    },
    global: {
      aspectRatio: "9:16",
      width: 720,
      height: 1280,
      fps: 30,
      durationSec: 12,
      palette: ["#0f172a", "#14b8a6", "#facc15"],
      bpm: 120,
      beatGridSec: [0, 0.5, 1],
      cutPattern: { targetCutCount: 4, avgShotDurationSec: 3, fastZones: [[0, 2]] },
      audioPlan: { policy: "procedural_bgm", layers: { kick: 0.8, hats: 0.5 } }
    },
    clips: [
      {
        id: "clip_hook",
        clipId: "clip_hook",
        role: "hook",
        startSec: 0,
        endSec: 3,
        durationSec: 3,
        layerIds: ["layer_hook_media", "layer_hook_text"],
        evidenceRefs: ["evidence://sample_1/clip/hook"],
        slotId: "slot_hook",
        visualFormFamily: "product_hero",
        selectedPrimitive: "ProductPosterHero",
        primitiveReason: "Hero product evidence maps to target product.",
        rendererTarget: "remotion_recipe",
        material: { kind: "target_image", assetIds: ["target_fan"], policy: "renderable", provenance: "user_uploaded" },
        layout: { bboxNorm: { x: 0.1, y: 0.18, w: 0.8, h: 0.4 } },
        motion: { pattern: "orbit", beatAligned: true, beatTimestampsSec: [0.5, 1] },
        text: { copy: "三档强风", colorRoles: ["white"], animationHint: "scale", fontSizeRatio: 0.08 }
      },
      {
        id: "clip_cta",
        clipId: "clip_cta",
        role: "cta",
        startSec: 9,
        endSec: 12,
        durationSec: 3,
        layerIds: ["layer_cta_text"],
        evidenceRefs: ["evidence://sample_1/clip/cta"],
        slotId: "slot_cta",
        visualFormFamily: "brand_cta",
        selectedPrimitive: "CTAEndSlate",
        primitiveReason: "CTA end slate evidence maps to target CTA.",
        rendererTarget: "remotion_recipe",
        material: { kind: "procedural", assetIds: [], policy: "renderable", provenance: "fixture" },
        layout: { bboxNorm: { x: 0.08, y: 0.72, w: 0.84, h: 0.13 } },
        motion: { pattern: "zoom_pulse", beatAligned: true, beatTimestampsSec: [9.5, 10] },
        text: { copy: "现在入手", colorRoles: ["yellow"], animationHint: "scale", fontSizeRatio: 0.09 }
      }
    ],
    layers: [
      {
        id: "layer_hook_media",
        type: "media",
        clipId: "clip_hook",
        zIndex: 10,
        startSec: 0,
        durationSec: 3,
        evidenceRefs: ["evidence://sample_1/visual/hero"],
        material: { kind: "target_image", assetIds: ["target_fan"], policy: "renderable", provenance: "user_uploaded" },
        layout: { bboxNorm: { x: 0.1, y: 0.18, w: 0.8, h: 0.4 }, fit: "contain" },
        motion: { pattern: "orbit", beatAligned: true, beatTimestampsSec: [0.5, 1] }
      },
      {
        id: "layer_hook_text",
        type: "text",
        clipId: "clip_hook",
        zIndex: 40,
        startSec: 0,
        durationSec: 3,
        evidenceRefs: ["evidence://sample_1/text/hook"],
        text: { content: "三档强风", role: "headline" },
        layout: { bboxNorm: { x: 0.12, y: 0.08, w: 0.76, h: 0.12 }, align: "center" },
        typography: { fontSizeRatio: 0.08, colorRole: "on_dark" },
        animation: { enter: "scale" }
      },
      {
        id: "layer_cta_text",
        type: "text",
        clipId: "clip_cta",
        zIndex: 40,
        startSec: 9,
        durationSec: 3,
        evidenceRefs: ["evidence://sample_1/text/cta"],
        text: { content: "现在入手", role: "cta" },
        layout: { bboxNorm: { x: 0.08, y: 0.72, w: 0.84, h: 0.13 }, align: "center" },
        typography: { fontSizeRatio: 0.09, colorRole: "accent" },
        animation: { enter: "pop" }
      },
      {
        id: "layer_motion_ribbon",
        type: "motion_atom",
        zIndex: 20,
        startSec: 0,
        durationSec: 12,
        evidenceRefs: ["evidence://sample_1/motion/ribbon"],
        atom: { kind: "parametric_ribbon_surface", direction: "right_to_left", path: "horizontal_wave", thicknessRatio: 0.06, twist: 0.5, opacity: 0.6, colorRoles: ["#14b8a6"] }
      },
      {
        id: "layer_audio_kick",
        type: "audio",
        zIndex: -10,
        startSec: 0,
        durationSec: 12,
        evidenceRefs: ["evidence://sample_1/audio/kick"],
        audio: { kind: "kick", policy: "procedural", weight: 0.8, bpm: 120 }
      }
    ],
    warnings: []
  };
}

function gapFixture(overrides: Partial<GapReportItem> = {}): GapReportItem {
  return {
    slotId: "slot_product_motion",
    status: "missing",
    severity: "high",
    reason: "Missing target product motion material.",
    impact: "Hook motion would otherwise collapse.",
    gapType: "moving_material_missing",
    visualFormFamily: "object_motion",
    repairOptions: [],
    ...overrides
  };
}

function atomFixture(name: TechniqueAtom["name"], category: TechniqueAtom["category"], visualPattern: string): TechniqueAtom {
  return {
    id: `atom_${name}`,
    name,
    category,
    sourceSampleId: "sample_1",
    sourceEvidenceRefs: ["evidence://sample_1"],
    visualPattern,
    timingPattern: "fast hook",
    requiredAssets: ["image"],
    renderer: { preferred: "remotion_recipe_compose", component: name },
    fallbackComponent: "TypographyLayoutSequence",
    transferRules: ["target-only transfer"],
    qualityHints: ["no sample copy"],
    confidence: 0.8
  };
}

describe("Spec v4.2 deterministic model-assisted tasks", () => {
  it("recipe lint catches broken recipe risks and passes valid recipes", () => {
    expect(lintRenderRecipe(recipeFixture()).status).toBe("pass");

    const broken = clone(recipeFixture());
    broken.productTheme.name = "AeroSpin 15 秒高转化广告 prompt";
    broken.layers = broken.layers?.filter((layer) => layer.id !== "layer_hook_media");
    const text = broken.layers?.find((layer) => layer.type === "text" && layer.id === "layer_hook_text") as unknown as Record<string, unknown>;
    text.layout = {};
    text.typography = {};
    broken.clips[0].material.assetIds = ["sample_1"];
    broken.clips[0].material.kind = "generated_target_asset";
    broken.clips[0].material.provenance = undefined;

    const report = lintRenderRecipe(broken);
    expect(report.status).toBe("fail");
    expect(report.issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining([
      "missing_media_layer",
      "missing_text_bbox",
      "missing_font_size",
      "raw_prompt_render_risk",
      "sample_asset_render_risk",
      "missing_provenance"
    ]));
  });

  it("provider prompt compiler creates safe offline plans and rejects sample references", () => {
    const decision = resolveModelRoute("video_fill", { env: {}, allowCloud: false });
    const plans = compilePromptPlanWithFallback(
      { gap: gapFixture(), providerDecision: decision, selectedProvider: "seedance_2_0", productTheme: recipeFixture().productTheme, referenceAssetIds: ["target_fan"] },
      "remotion_procedural_motion"
    );
    expect(plans[0].provider).toBe("seedance_2_0");
    expect(plans[0].fallbackConfig).toBeTruthy();
    expect(plans[1].provider).toBe("remotion_procedural_motion");
    expect(plans[0].provenanceRequired).toBe(true);
    expect(() =>
      compileProviderPromptPlan({ gap: gapFixture(), providerDecision: decision, selectedProvider: "seedance_2_0", referenceAssetIds: ["sample_frame_1"] })
    ).toThrow(/sample/);
  });

  it("gap repair ranker chooses local procedural fallback offline and can apply selected reason", () => {
    const decisions = buildDefaultProviderDecisions({ env: {}, allowCloud: false });
    const ranked = rankGapRepairOptions({ gapReport: [gapFixture()], providerDecisions: decisions });
    expect(ranked[0].selected).toBe(true);
    expect(ranked[0].optionType).toBe("procedural_motion");
    expect(ranked[0].reason).toContain("scored");
    const patched = applyRankedRepairOptions([gapFixture()], ranked);
    expect(patched[0].selectedRepair?.reason).toContain("procedural_motion");
  });

  it("structure explanation is Chinese, route-aware, and does not claim unavailable cloud usage", () => {
    const decisions = buildDefaultProviderDecisions({ env: {}, allowCloud: false });
    const summary = buildModelRouteSummary(decisions);
    const explanation = generateStructureExplanation({
      renderRecipe: recipeFixture(),
      providerDecisions: decisions,
      modelRouteSummary: summary,
      gapReport: [gapFixture()],
      fillPlan: []
    });
    expect(explanation.summaryZh).toContain("样片结构");
    expect(explanation.safetySummary.join("")).toContain("没有外部样片上传");
    expect(explanation.providerSummary.join("\n")).toContain("fallback");
    expect(explanation.demoNarrationZh).not.toMatch(/raw prompt/i);
  });

  it("version strategy planner outputs distinct plans", () => {
    const click = planVersionStrategy({ version: "high_click", renderRecipe: recipeFixture() });
    const quality = planVersionStrategy({ version: "high_quality", renderRecipe: recipeFixture() });
    expect(click.changes.length).toBeGreaterThanOrEqual(2);
    expect(quality.changes.length).toBeGreaterThanOrEqual(2);
    expect(click.changes.map((item) => item.dimension)).not.toEqual(quality.changes.map((item) => item.dimension));
  });

  it("natural edit patch supports required deterministic commands with lint safety", () => {
    for (const command of ["开头更抓人一些", "减少字幕，增强节奏感", "把商品信息提前", "结尾 CTA 更明显", "整体更高级一点"]) {
      const plan = planNaturalEditPatch(command, recipeFixture());
      expect(plan.renderNeeded).toBe(true);
      expect(plan.patches.length).toBeGreaterThan(0);
      expect(plan.safetyChecked).toBe(true);
    }
  });

  it("offline video critic flags bad recipes and scores valid recipes higher", () => {
    const good = critiqueVideoOffline({ renderRecipe: recipeFixture() });
    const badRecipe = clone(recipeFixture());
    badRecipe.layers = badRecipe.layers?.filter((layer) => layer.id !== "layer_hook_media");
    const bad = critiqueVideoOffline({ renderRecipe: badRecipe });
    expect(bad.issues.some((issue) => issue.kind === "missing_media")).toBe(true);
    expect(good.score).toBeGreaterThan(bad.score);
  });

  it("TechniqueAtom retrieval works without embeddings and curator suggests duplicates", () => {
    const atoms = [
      atomFixture("ParametricRibbonSurface", "motion_atom", "3d ribbon poster surface"),
      atomFixture("KineticTypographySweep", "typography", "fast subtitle hook kinetic text"),
      atomFixture("KineticTypographySweepAlt", "typography", "fast subtitle hook kinetic text")
    ];
    const ribbon = retrieveTechniqueAtoms({ userPrompt: "ribbon poster" }, atoms);
    const subtitle = retrieveTechniqueAtoms({ userPrompt: "fast subtitle hook" }, atoms);
    expect(ribbon[0].atomId).toContain("ParametricRibbonSurface");
    expect(subtitle[0].atomId).toContain("KineticTypographySweep");
    expect(curateTechniqueAtomDuplicates(atoms, 0.35).length).toBeGreaterThan(0);
  });
});
