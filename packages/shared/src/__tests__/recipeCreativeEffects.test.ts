import { describe, expect, it } from "vitest";
import {
  buildFallbackTemplate,
  buildMockVideoAnalysis,
  generateMigrationResult,
  type GenerationRequest,
  type StructureTemplate
} from "../index.js";

function request(controls?: GenerationRequest["controls"]): GenerationRequest {
  return {
    projectId: "p_fx",
    inputMode: "video_plus_prompt",
    selectedTemplateIds: ["t_fx"],
    sourceVideo: { assetId: "src" },
    prompt: "把样例迁移成 15 秒竖屏产品广告。主题：AeroSpin 小风扇 卖点：三档强风 CTA：现在入手",
    target: { vertical: "b2b_marketing_mg", targetDurationSec: 15, aspectRatio: "9:16", outputMode: "storyboard_preview" },
    controls: { pace: "fast", hookIntensity: "strong", packagingStyle: "mg_motion", ctaStyle: "direct", ...controls },
    constraints: { noSampleVisualCopy: true }
  };
}

// Force card_orbit motif evidence (black+red named palette, no other motif signals).
function cardOrbitTemplate(): StructureTemplate {
  const analysis = buildMockVideoAnalysis({ assetId: "s", projectId: "p_fx", purpose: "sample", durationSec: 15 });
  const base = buildFallbackTemplate(analysis, "b2b_marketing_mg", "p_fx");
  return {
    ...base,
    visualElementGraph: {
      ...(base.visualElementGraph ?? { elements: [] }),
      globalStyle: { ...((base.visualElementGraph ?? {}).globalStyle ?? {}), palette: ["black", "red"] }
    },
    typographyEvidence: []
  } as StructureTemplate;
}

describe("RenderRecipe creative-effect integration (3.md P4)", () => {
  it("old recipe (flag OFF) carries no effect fields — backward compatible", () => {
    const recipe = generateMigrationResult({ template: cardOrbitTemplate(), request: request() }).timeline.renderPlan?.renderRecipe;
    expect(recipe?.effectProgramIds).toBeUndefined();
    expect(recipe?.motifFamily).toBeUndefined();
  });

  it("flag ON selects a motif effect and attaches effect fields + props", () => {
    const recipe = generateMigrationResult({
      template: cardOrbitTemplate(),
      request: request({ enableCreativeEffects: true })
    }).timeline.renderPlan?.renderRecipe;
    expect(recipe?.motifFamily).toBe("card_orbit_motion_graph");
    expect(recipe?.effectProgramIds).toEqual(["CardOrbitStack"]);
    expect(recipe?.effectSelection?.source).toBe("built_in");
    const props = recipe?.effectPropsById?.["CardOrbitStack"] as { width?: number; colors?: string[] } | undefined;
    expect(props?.width).toBeGreaterThan(0);
    expect(Array.isArray(props?.colors)).toBe(true);
  });
});
