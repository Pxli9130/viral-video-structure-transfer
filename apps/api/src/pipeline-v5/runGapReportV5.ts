// pipeline-v5/runGapReportV5.ts
// Stage 11: match CompositionProgram slots against target assets and choose a fill strategy per gap.
// Text/CTA slots are always fillable (text/procedural), so they never read as "missing"; media slots
// need a target asset of a compatible kind, else they are aigc_fill (or procedural CTA card).

import { v5 } from "@vvst/shared";

const TEXT_KINDS = new Set<v5.PlaceholderKindV5>(["subtitle_text", "main_title", "voiceover"]);
const MEDIA_KINDS = new Set<v5.PlaceholderKindV5>(["hero", "hero_head", "hero_product", "product_closeup", "background", "logo"]);

function sectionRole(comp: v5.CompositionProgram, sectionId?: string): v5.SectionRoleV5 | undefined {
  return comp.sections.find((s) => s.id === sectionId)?.role;
}

export function runGapReportV5(comp: v5.CompositionProgram, targetProfiles: v5.TargetAssetProfile[]): v5.GapReportV5 {
  const mediaAssets = targetProfiles.filter((p) => p.kind === "image" || p.kind === "video" || p.kind === "logo");
  const gaps: v5.GapV5[] = [];

  comp.slotPlan.forEach((slot, i) => {
    const kind = slot.kind as v5.PlaceholderKindV5;
    const role = sectionRole(comp, slot.sectionId);

    // Text / title / voiceover slots: always satisfiable via text fill.
    if (TEXT_KINDS.has(kind)) {
      gaps.push({
        id: `gap_${i + 1}`,
        slotId: slot.id,
        sourceElementId: slot.sourceElementId,
        status: "matched",
        required: kind,
        matchedAssetIds: [],
        reason: "Text slot filled from planned copy / brief.",
        impact: "low",
        selectedRepair: "text_fill",
        expectedVisualOrAudioResult: "Readable on-brand text card."
      });
      return;
    }

    // CTA card: procedural unless an explicit cta/logo asset exists.
    if (kind === "cta_card") {
      const logo = mediaAssets.find((p) => p.kind === "logo" || p.bestSection === "cta");
      gaps.push({
        id: `gap_${i + 1}`,
        slotId: slot.id,
        sourceElementId: slot.sourceElementId,
        status: logo ? "matched" : "weak_match",
        required: kind,
        matchedAssetIds: logo ? [logo.assetId] : [],
        reason: logo ? "CTA card uses provided logo/cta asset." : "No CTA asset; procedural card.",
        impact: "medium",
        selectedRepair: logo ? "asset_reuse" : "procedural_fill",
        expectedVisualOrAudioResult: "Rounded CTA card with button."
      });
      return;
    }

    // Media slots: need a compatible target asset.
    if (MEDIA_KINDS.has(kind)) {
      const exact = mediaAssets.find((p) => p.bestSection === role && (p.kind === "image" || p.kind === "video"));
      const any = exact ?? mediaAssets.find((p) => p.kind === "image" || p.kind === "video");
      if (exact) {
        gaps.push({
          id: `gap_${i + 1}`,
          slotId: slot.id,
          sourceElementId: slot.sourceElementId,
          status: "matched",
          required: kind,
          matchedAssetIds: [exact.assetId],
          reason: `Target asset matched by section (${role}).`,
          impact: "low",
          selectedRepair: "asset_reuse",
          expectedVisualOrAudioResult: "Target media placed in slot."
        });
      } else if (any) {
        gaps.push({
          id: `gap_${i + 1}`,
          slotId: slot.id,
          sourceElementId: slot.sourceElementId,
          status: "weak_match",
          required: kind,
          matchedAssetIds: [any.assetId],
          reason: "Reusing a target asset from another section (section mismatch).",
          impact: "medium",
          selectedRepair: "asset_reuse",
          expectedVisualOrAudioResult: "Cropped/zoomed target media."
        });
      } else {
        gaps.push({
          id: `gap_${i + 1}`,
          slotId: slot.id,
          sourceElementId: slot.sourceElementId,
          status: "missing",
          required: kind,
          matchedAssetIds: [],
          reason: "No target media for this slot.",
          impact: slot.required ? "high" : "medium",
          selectedRepair: "aigc_fill",
          expectedVisualOrAudioResult: "Generated image from asset recipe (or text/packaging card fallback)."
        });
      }
      return;
    }

    // Fallback for any other kind.
    gaps.push({
      id: `gap_${i + 1}`,
      slotId: slot.id,
      sourceElementId: slot.sourceElementId,
      status: "weak_match",
      required: kind,
      matchedAssetIds: [],
      reason: "Unclassified slot; packaging card fallback.",
      impact: "low",
      selectedRepair: "packaging_fill",
      expectedVisualOrAudioResult: "Packaging card."
    });
  });

  return { id: `gap_${comp.generationId ?? comp.id}`, compositionProgramId: comp.id, gaps };
}
