// EffectRegistry — resolves a motif family to a concrete effect program. Selection order:
//   1. preferGenerated=true → a validated AND explicitly promoted generated effect from the KB
//      (un-promoted generated effects never override a built-in; see findValidatedGeneratedEffectByMotif)
//   2. otherwise the built-in effect for the motif family
//   3. otherwise legacy_fallback (only when strictEffectCoverage=false)
//   4. strictEffectCoverage=true with no built-in/generated effect → not selected (fatal for gates)

import { existsSync } from "node:fs";
import path from "node:path";
import type { MotifFamily } from "./creativeEffectSpec.js";
import {
  findBuiltInEffectByMotif,
  findValidatedGeneratedEffectByMotif,
  loadEffectKnowledgeBase,
  type EffectKnowledgeBaseFile
} from "./effectKnowledgeBase.js";

export interface EffectSelectionInput {
  motifFamily: MotifFamily;
  preferGenerated?: boolean;
  strictEffectCoverage?: boolean;
  evidence?: unknown;
  /** Test/override seam: decide whether a generated effect's source file is present. */
  componentExists?: (componentPath: string) => boolean;
}

export type EffectSelectionSource = "generated" | "built_in" | "legacy_fallback" | "none";

export interface EffectSelectionResult {
  selected: boolean;
  effectProgramIds: string[];
  effectNames: string[];
  source: EffectSelectionSource;
  fallbackReason?: string;
  motifFamily: MotifFamily;
  requiredProps: string[];
}

/** The one built-in effect per motif family. generic_motion_graph has no motif-specific effect. */
export const BUILT_IN_MOTIF_EFFECT: Record<MotifFamily, string | null> = {
  poster_ribbon_marketing: "RibbonPosterSweep",
  card_orbit_motion_graph: "CardOrbitStack",
  blue_spotlight_ui_pitch: "BlueUiSpotlight",
  beat_cut_chinese_editing_tutorial: "BeatCutKineticText",
  split_screen_compare: "SplitScreenCompare",
  generic_motion_graph: null
};

const DEFAULT_REQUIRED_PROPS = ["width", "height", "fps", "durationSec"];

export function selectEffect(input: EffectSelectionInput, kbArg?: EffectKnowledgeBaseFile): EffectSelectionResult {
  const { motifFamily, preferGenerated = false, strictEffectCoverage = false } = input;
  const kb = kbArg ?? loadEffectKnowledgeBase();
  const componentExists = input.componentExists ?? ((p: string) => existsSync(path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)));
  let skippedReason: string | undefined;

  // 1. Prefer a validated + promoted generated effect when requested — but only if its source file is present.
  if (preferGenerated) {
    const generated = findValidatedGeneratedEffectByMotif(kb, motifFamily);
    if (generated) {
      if (componentExists(generated.componentPath)) {
        return {
          selected: true,
          effectProgramIds: [generated.id],
          effectNames: [generated.effectName],
          source: "generated",
          motifFamily,
          requiredProps: generated.requiredProps ?? DEFAULT_REQUIRED_PROPS
        };
      }
      skippedReason = `validated generated effect "${generated.id}" ignored: source file missing at ${generated.componentPath}`;
    }
  }

  // 2. Built-in effect for the motif family.
  const builtInName = BUILT_IN_MOTIF_EFFECT[motifFamily];
  if (builtInName) {
    const entry = findBuiltInEffectByMotif(kb, motifFamily);
    return {
      selected: true,
      effectProgramIds: [builtInName],
      effectNames: [entry?.effectName ?? builtInName],
      source: "built_in",
      motifFamily,
      requiredProps: entry?.requiredProps ?? DEFAULT_REQUIRED_PROPS,
      ...(skippedReason ? { fallbackReason: skippedReason } : {})
    };
  }

  // 3/4. No motif-specific effect (e.g. generic_motion_graph).
  if (strictEffectCoverage) {
    return {
      selected: false,
      effectProgramIds: [],
      effectNames: [],
      source: "none",
      fallbackReason: `strictEffectCoverage: no built-in or validated generated effect for motif "${motifFamily}"`,
      motifFamily,
      requiredProps: []
    };
  }
  return {
    selected: false,
    effectProgramIds: [],
    effectNames: [],
    source: "legacy_fallback",
    fallbackReason: `no motif-specific effect for "${motifFamily}"; rendering legacy layer-based template`,
    motifFamily,
    requiredProps: []
  };
}
