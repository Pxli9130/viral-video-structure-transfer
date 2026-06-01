import { describe, expect, it } from "vitest";
import { selectPrimitive, type StructureTemplate, type TimelineClip } from "../index.js";

function clip(partial: Partial<TimelineClip>): TimelineClip {
  return {
    id: "c1",
    role: "body",
    startSec: 0,
    durationSec: 2.5,
    type: "generated_packaging",
    layers: [],
    ...partial
  } as TimelineClip;
}

function template(partial: Record<string, unknown>): StructureTemplate {
  return partial as unknown as StructureTemplate;
}

const NO_EVIDENCE = template({});

describe("v1.3 selectPrimitive (evidence + material driven)", () => {
  it("CTA role/family → motivation_cta", () => {
    expect(selectPrimitive({ clip: clip({ role: "cta" }), template: NO_EVIDENCE, hasSourcePixels: false }).primitive).toBe("motivation_cta");
    expect(selectPrimitive({ clip: clip({ role: "body", visualFormFamily: "brand_cta" }), template: NO_EVIDENCE, hasSourcePixels: false }).primitive).toBe("motivation_cta");
  });

  it("hook with hero evidence → neon_hero_intro", () => {
    const withHero = template({ heroDescriptor: { motionPattern: "spin" } });
    const r = selectPrimitive({ clip: clip({ role: "hook" }), template: withHero, hasSourcePixels: false });
    expect(r.primitive).toBe("neon_hero_intro");
    expect(r.reason).toContain("hero");
  });

  it("proof with source pixels → source-first action_montage; without → procedural proxy montage", () => {
    const withSource = selectPrimitive({ clip: clip({ role: "proof" }), template: NO_EVIDENCE, hasSourcePixels: true });
    const noSource = selectPrimitive({ clip: clip({ role: "proof" }), template: NO_EVIDENCE, hasSourcePixels: false });
    expect(withSource.primitive).toBe("action_montage");
    expect(withSource.reason).toContain("source-first");
    expect(noSource.primitive).toBe("action_montage");
    expect(noSource.reason).toContain("proxy");
  });

  it("transition diverges on impact evidence (anti-mold signal)", () => {
    const withImpact = template({ visualElementGraph: { elements: [{ family: "impact_fx" }] } });
    const a = selectPrimitive({ clip: clip({ role: "transition" }), template: withImpact, hasSourcePixels: false });
    const b = selectPrimitive({ clip: clip({ role: "transition" }), template: NO_EVIDENCE, hasSourcePixels: false });
    expect(a.primitive).toBe("impact_flash_stamp");
    expect(a.primitive).not.toBe(b.primitive); // different evidence → different primitive
  });

  it("kinetic typography diverges on layout evidence (rule/list vs headline)", () => {
    const list = template({ typographyEvidence: [{ layoutRole: "rule_list", colorRole: "white", animationHint: "none", fontSizeRatio: 0.1 }] });
    const headline = template({ typographyEvidence: [{ layoutRole: "headline", colorRole: "red", animationHint: "scale", fontSizeRatio: 0.3 }] });
    const a = selectPrimitive({ clip: clip({ role: "body", visualFormFamily: "kinetic_typography" }), template: list, hasSourcePixels: false });
    const b = selectPrimitive({ clip: clip({ role: "body", visualFormFamily: "kinetic_typography", subtitleText: undefined }), template: headline, hasSourcePixels: false });
    expect(a.primitive).toBe("tutorial_rule_card");
    expect(b.primitive).toBe("beat_text_card");
    expect(a.primitive).not.toBe(b.primitive);
  });

  it("always returns a non-empty auditable reason", () => {
    for (const role of ["hook", "setup", "body", "proof", "transition", "cta"] as const) {
      const r = selectPrimitive({ clip: clip({ role }), template: NO_EVIDENCE, hasSourcePixels: false });
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });
});
