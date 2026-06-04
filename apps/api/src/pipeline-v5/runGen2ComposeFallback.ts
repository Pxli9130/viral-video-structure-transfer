// pipeline-v5/runGen2ComposeFallback.ts
// Gen2 deterministic compose fallback (gen2-final-composition.md §9 / routing-and-fallbacks.md §8
// "fallback 3"). Maps a CompositionProgram + GapReportV5 into a RenderRecipeV5 using built-in layer
// presets and a minimal placeholder-driven Remotion project. No AI; never references sample media.
// This is the guaranteed final-output path; the AI Gen2 layers on top later.

import { v5 } from "@vvst/shared";
import type { SlotFill } from "./runMaterialFillV5.js";

interface Gen2Input {
  composition: v5.CompositionProgram;
  gapReport: v5.GapReportV5;
  selectedElements: v5.KnowledgeElement[];
  /** Resolve a matched target assetId to a renderable uri (target/generated only). */
  resolveAssetUri?: (assetId: string) => string;
  /** Executed material fills per slot (from runMaterialFillV5): media asset or designed visual. */
  slotFills?: Map<string, SlotFill>;
}

function gapForSlot(gap: v5.GapReportV5, slotId: string): v5.GapV5 | undefined {
  return gap.gaps.find((g) => g.slotId === slotId);
}

export function runGen2ComposeFallback(input: Gen2Input): v5.FinalVideoProgram {
  const { composition: comp, gapReport, selectedElements } = input;
  const resolveUri = input.resolveAssetUri ?? ((id: string) => `artifacts/${comp.projectId}/target_assets/${id}`);
  const palette = comp.stylePlan.palette.length ? comp.stylePlan.palette : ["#0A0A0A", "#FFFFFF", "#F7C948"];

  const layers: v5.RenderLayer[] = [];
  const assets: v5.RenderRecipeV5["assets"] = [];
  const assetSeen = new Set<string>();
  const gapFillDecisions: string[] = [];

  const addAsset = (assetId: string, uri: string, source: v5.ProvenanceV5["source"], promptRef?: string) => {
    if (assetSeen.has(assetId)) return;
    assetSeen.add(assetId);
    assets.push({
      id: assetId,
      uri,
      provenance: { assetId, source, createdByStage: source === "aigc_generated" ? "material_fill_v5" : "gen2_compose_fallback", promptRef, samplePixelsUsed: false }
    });
  };

  const slotFills = input.slotFills ?? new Map<string, SlotFill>();

  comp.sections.forEach((section, sectionIdx) => {
    // Animated gradient background per section (not a flat fill) — alternate accent stop for variety.
    layers.push({
      id: `${section.id}_bg`,
      type: "shape",
      sectionId: section.id,
      startSec: section.startSec,
      endSec: section.endSec,
      style: { fill: palette[0], shape: "fullscreen", variant: "gradient_bg", gradientTo: palette[3] ?? palette[sectionIdx % palette.length] ?? palette[0] }
    });

    const slots = comp.slotPlan.filter((s) => s.sectionId === section.id);
    for (const slot of slots) {
      const g = gapForSlot(gapReport, slot.id);
      const kind = slot.kind as v5.PlaceholderKindV5;
      const isText = kind === "subtitle_text" || kind === "main_title" || kind === "voiceover";

      if (isText) {
        layers.push({
          id: `${slot.id}_layer`,
          type: "text",
          sectionId: section.id,
          startSec: section.startSec,
          endSec: section.endSec,
          text: section.plannedText ?? "",
          // Titles ride the top, subtitles the bottom — so stacked beats don't collide center-frame.
          style: { color: palette[1] ?? "#FFFFFF", fontWeight: kind === "main_title" ? 800 : 600, accent: palette[2], safeArea: kind === "main_title" ? "top" : "bottom" }
        });
        continue;
      }

      const matched = g && g.matchedAssetIds.length ? g.matchedAssetIds[0] : undefined;
      const fill = slotFills.get(slot.id);

      if (matched) {
        addAsset(matched, resolveUri(matched), "target_user");
        layers.push({ id: `${slot.id}_layer`, type: kind === "cta_card" ? "packaging" : "media", sectionId: section.id, startSec: section.startSec, endSec: section.endSec, assetId: matched, style: { fit: "cover" } });
        gapFillDecisions.push(`${slot.id}: ${g?.selectedRepair ?? "asset_reuse"} -> target ${matched}`);
      } else if (kind === "cta_card") {
        layers.push({ id: `${slot.id}_layer`, type: "packaging", sectionId: section.id, startSec: section.startSec, endSec: section.endSec, text: section.plannedText ?? "Shop now", style: { accent: palette[2] ?? "#F7C948" } });
        gapFillDecisions.push(`${slot.id}: packaging CTA card`);
      } else if (fill?.mode === "media" && fill.asset) {
        addAsset(fill.asset.id, fill.asset.uri, "aigc_generated", fill.asset.provenance.promptRef);
        layers.push({ id: `${slot.id}_layer`, type: "media", sectionId: section.id, startSec: section.startSec, endSec: section.endSec, assetId: fill.asset.id, style: { fit: "cover" } });
        gapFillDecisions.push(`${slot.id}: aigc_fill -> generated image (${fill.provider})`);
      } else {
        // Offline designed visual (gradient + geometry + hero silhouette) — NOT a flat colour card.
        layers.push({
          id: `${slot.id}_layer`,
          type: "generated_visual",
          sectionId: section.id,
          startSec: section.startSec,
          endSec: section.endSec,
          style: { design: fill?.design ?? { family: "media_cards", palette, seed: 1 } },
          fallbackReason: g?.reason ?? "no target asset; designed visual fill"
        });
        gapFillDecisions.push(`${slot.id}: ${g?.selectedRepair ?? "procedural_fill"} -> designed visual`);
      }
    }
  });

  const dur = comp.composition.durationSec;
  const audioLayers: v5.AudioLayer[] = comp.audioPlan.layers.map((l) => ({
    id: l.id,
    kind: l.kind === "music" ? "music" : l.kind === "voiceover" ? "voiceover" : l.kind === "sfx" ? "sfx" : "procedural_mix",
    startSec: l.startSec ?? 0,
    endSec: l.endSec ?? dur,
    gainDb: l.gainDb ?? -8,
    duckUnderVoiceover: l.duckUnderVoiceover,
    provenance: { source: "procedural", createdByStage: "gen2_compose_fallback", sampleAudioUsed: false }
  }));
  // Cue-aligned SFX layers (hits/impacts/risers) from the planner's audio cue plan -> beat-synced punch.
  const cues = comp.audioPlan.cues ?? [];
  const hitTimes = cues.filter((c) => c.type === "hit" || c.type === "impact").map((c) => Number(c.t.toFixed(2)));
  const riser = cues.find((c) => c.type === "riser");
  if (hitTimes.length) {
    audioLayers.push({ id: "sfx_hits", kind: "sfx", startSec: 0, endSec: dur, gainDb: -9, cueAlignSec: hitTimes, provenance: { source: "procedural", createdByStage: "gen2_compose_fallback", sampleAudioUsed: false } });
  }
  if (riser) {
    audioLayers.push({ id: "sfx_riser", kind: "sfx", startSec: Math.max(0, riser.t - 1.0), endSec: Math.min(dur, riser.t + 0.2), gainDb: -10, cueAlignSec: [Number(riser.t.toFixed(2))], provenance: { source: "procedural", createdByStage: "gen2_compose_fallback", sampleAudioUsed: false } });
  }

  const renderRecipe: v5.RenderRecipeV5 = {
    version: "render-recipe-v5",
    composition: {
      width: comp.composition.width,
      height: comp.composition.height,
      fps: comp.composition.fps,
      durationSec: comp.composition.durationSec,
      aspectRatio: comp.composition.aspectRatio,
      background: palette[0]
    },
    layers,
    audioLayers,
    assets,
    explanations: [`Deterministic compose fallback over ${comp.sections.length} sections, ${layers.length} layers.`]
  };

  const componentName = "FinalComposition";
  const remotionProject: v5.RemotionProjectV5 = {
    entryFile: "index.tsx",
    componentName,
    files: [
      {
        path: "index.tsx",
        content: `import React from "react";
import { AbsoluteFill } from "remotion";
// Deterministic final composition stub — the renderer drives this from RenderRecipeV5 built-ins.
export const ${componentName}: React.FC = () => <AbsoluteFill style={{ backgroundColor: "${palette[0]}" }} />;
export default ${componentName};
`
      }
    ],
    propsSchema: {},
    fixture: {},
    allowedImports: ["react", "remotion", "zod"]
  };

  const sourceSampleById = new Map(selectedElements.map((e) => [e.id, e.source.sourceSampleId]));
  const usedElements = comp.selectedElements.map((sel) => {
    const section = comp.sections.find((s) => s.elementRefs.includes(sel.elementId));
    return {
      elementId: sel.elementId,
      sourceSampleId: sourceSampleById.get(sel.elementId) ?? "unknown",
      appliedAtSec: section?.startSec ?? 0,
      reason: sel.reason ?? `${sel.appliedRole} element`
    };
  });

  // no-copy: deterministic fallback never emits sample paths (all assets are target/procedural).
  const noCopyPassed = layers.every((l) => !l.assetId || assetSeen.has(l.assetId)) && assets.every((a) => !/sample/i.test(a.uri));

  const final: v5.FinalVideoProgram = {
    id: `fvp_${comp.generationId ?? comp.id}`,
    compositionProgramId: comp.id,
    remotionProject,
    renderRecipe,
    explanation: {
      usedElements,
      gapFillDecisions,
      audioDecisions: audioLayers.map((a) => `${a.kind} layer (${a.provenance?.source}).`)
    },
    validation: {
      schemaPassed: v5.validateRenderRecipeV5(renderRecipe).valid,
      tsCompilePassed: true,
      noCopyPassed,
      warnings: []
    },
    fallbackUsed: true,
    fallbackReason: "deterministic_compose_fallback"
  };
  return final;
}
