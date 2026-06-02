// Static runtime registry of built-in creative-effect components. Effects are imported statically
// (never dynamically) so the Remotion bundle is deterministic and safe. Generated effects will later
// be added through a separate generated static manifest; built-ins are sufficient for this step.

import type React from "react";
import { BeatCutKineticText } from "./library/BeatCutKineticText";
import { BlueUiSpotlight } from "./library/BlueUiSpotlight";
import { CardOrbitStack } from "./library/CardOrbitStack";
import { RibbonPosterSweep } from "./library/RibbonPosterSweep";
import { SplitScreenCompare } from "./library/SplitScreenCompare";
import { generatedEffectManifest } from "./generated/effect-manifest";
import type { CreativeEffectRuntimeProps } from "./types";

export type EffectComponent = React.FC<CreativeEffectRuntimeProps>;

const RUNTIME_EFFECTS: Record<string, EffectComponent> = {
  RibbonPosterSweep,
  CardOrbitStack,
  BlueUiSpotlight,
  BeatCutKineticText,
  SplitScreenCompare
};

const MOTIF_FALLBACK: Record<string, EffectComponent | undefined> = {
  poster_ribbon_marketing: RibbonPosterSweep,
  card_orbit_motion_graph: CardOrbitStack,
  blue_spotlight_ui_pitch: BlueUiSpotlight,
  beat_cut_chinese_editing_tutorial: BeatCutKineticText,
  split_screen_compare: SplitScreenCompare,
  generic_motion_graph: undefined
};

/**
 * Resolve an effect component by program id. Order: (1) generated static manifest, (2) built-in
 * registry. Generated effects only resolve from the statically-imported manifest — never via dynamic
 * import of arbitrary paths.
 */
export function getRuntimeEffectComponent(effectProgramId: string | undefined): EffectComponent | undefined {
  if (!effectProgramId) return undefined;
  const generated = generatedEffectManifest[effectProgramId]?.Component as EffectComponent | undefined;
  if (generated) return generated;
  return RUNTIME_EFFECTS[effectProgramId];
}

/**
 * Resolve a fallback component for a motif family: a validated generated effect for that motif if one
 * exists in the manifest, else the built-in (undefined for generic_motion_graph).
 */
export function getBuiltInFallbackForMotif(motifFamily: string | undefined): EffectComponent | undefined {
  if (!motifFamily) return undefined;
  const generated = Object.values(generatedEffectManifest).find((e) => e.motifFamily === motifFamily);
  if (generated) return generated.Component as EffectComponent;
  return MOTIF_FALLBACK[motifFamily];
}

export { BeatCutKineticText, BlueUiSpotlight, CardOrbitStack, RibbonPosterSweep, SplitScreenCompare };
