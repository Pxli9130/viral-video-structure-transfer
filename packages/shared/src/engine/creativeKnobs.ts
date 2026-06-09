// engine/creativeKnobs.ts
// ONE knob set that drives BOTH multi-version (brief.variant) AND manual edit (TemplatePatchSet) AND
// natural-language edit. It realises REAL rhythm / copy-density / packaging / colour differences WITHOUT
// re-running visual codegen — purely by (a) a text-to-text directive injected into the (Doubao)
// context-rewrite, (b) a deterministic palette mood, and (c) a Lyria audio-mood phrase. Self-contained.

export type RhythmKnob = "aggressive" | "balanced" | "slow";
export type DensityKnob = "dense" | "medium" | "minimal";
export type IntensityKnob = "high" | "medium" | "low";
export type PaletteMoodKnob = "bold" | "premium" | "clean" | "energetic";
export type AudioMoodKnob = "energetic" | "balanced" | "soft";

export interface CreativeKnobs {
  rhythm: RhythmKnob;
  /** Hook emphasis/length scale: 0.5 = much shorter & punchier, 1.2 = longer. */
  hookRatio: number;
  textDensity: DensityKnob;
  motionIntensity: IntensityKnob;
  /** Bring the CTA forward by N seconds (0..2). */
  ctaAdvanceSec: number;
  paletteMood: PaletteMoodKnob;
  audioMood: AudioMoodKnob;
}

export const DEFAULT_KNOBS: CreativeKnobs = {
  rhythm: "balanced",
  hookRatio: 1,
  textDensity: "medium",
  motionIntensity: "medium",
  ctaAdvanceSec: 0,
  paletteMood: "bold",
  audioMood: "balanced"
};

/** brief.variant -> a distinct knob preset (the 3 multi-version strategies). */
export const VARIANT_KNOBS: Record<string, CreativeKnobs> = {
  high_click: { rhythm: "aggressive", hookRatio: 0.6, textDensity: "dense", motionIntensity: "high", ctaAdvanceSec: 0.8, paletteMood: "bold", audioMood: "energetic" },
  high_conversion: { rhythm: "balanced", hookRatio: 0.9, textDensity: "dense", motionIntensity: "medium", ctaAdvanceSec: 1.2, paletteMood: "energetic", audioMood: "balanced" },
  high_quality: { rhythm: "slow", hookRatio: 1.0, textDensity: "minimal", motionIntensity: "low", ctaAdvanceSec: 0, paletteMood: "premium", audioMood: "soft" }
};

export type CreativeKnobPatch = Partial<CreativeKnobs>;

/** Resolve the knob set for a generation: the variant preset, overlaid by any explicit patch knobs. */
export function resolveCreativeKnobs(variant?: string, patch?: CreativeKnobPatch): CreativeKnobs {
  const base = (variant ? VARIANT_KNOBS[variant] : undefined) ?? DEFAULT_KNOBS;
  return {
    rhythm: patch?.rhythm ?? base.rhythm,
    hookRatio: patch?.hookRatio ?? base.hookRatio,
    textDensity: patch?.textDensity ?? base.textDensity,
    motionIntensity: patch?.motionIntensity ?? base.motionIntensity,
    ctaAdvanceSec: patch?.ctaAdvanceSec ?? base.ctaAdvanceSec,
    paletteMood: patch?.paletteMood ?? base.paletteMood,
    audioMood: patch?.audioMood ?? base.audioMood
  };
}

/** True when the knobs differ from the neutral default (so callers know to apply them). */
export function knobsAreActive(k: CreativeKnobs): boolean {
  return (
    k.rhythm !== DEFAULT_KNOBS.rhythm ||
    k.hookRatio !== DEFAULT_KNOBS.hookRatio ||
    k.textDensity !== DEFAULT_KNOBS.textDensity ||
    k.motionIntensity !== DEFAULT_KNOBS.motionIntensity ||
    k.ctaAdvanceSec !== DEFAULT_KNOBS.ctaAdvanceSec ||
    k.paletteMood !== DEFAULT_KNOBS.paletteMood
  );
}

/** A natural-language directive injected into the (Doubao) context-rewrite so the on-screen text +
 *  emphasis + packaging actually change per knob set. Empty string when knobs are neutral. */
export function knobsToRewriteDirective(k: CreativeKnobs): string {
  const parts: string[] = [];
  if (k.rhythm === "aggressive") parts.push("Fast, punchy pacing: shorten the hook, lead with the single biggest word, hard emphasis.");
  else if (k.rhythm === "slow") parts.push("Calm, premium pacing: let scenes breathe; fewer but larger statements.");
  if (k.hookRatio < 0.85) parts.push("Make the OPENING HOOK noticeably shorter and more provocative.");
  else if (k.hookRatio > 1.1) parts.push("Give the opening hook a little more room to build.");
  if (k.textDensity === "minimal") parts.push("Use MINIMAL on-screen text — keep only the essential headline + CTA; drop secondary captions.");
  else if (k.textDensity === "dense") parts.push("Use DENSE on-screen copy — add supporting captions / selling-point labels.");
  if (k.motionIntensity === "low") parts.push("Subtle, refined motion with generous whitespace (high-quality feel).");
  else if (k.motionIntensity === "high") parts.push("High-energy motion and bold emphasis.");
  if (k.ctaAdvanceSec > 0) parts.push("Bring the CALL-TO-ACTION / offer FORWARD and hold it on screen longer.");
  if (k.paletteMood === "premium" || k.paletteMood === "clean") parts.push("Refined, premium, restrained colour mood.");
  else if (k.paletteMood === "energetic") parts.push("Vivid, energetic, high-saturation colour mood.");
  return parts.join(" ");
}

/** A premium/clean palette nudge for `paletteMood` (returned [bg,text,accent,accent2] is only used when
 *  the mood asks for restraint; bold/energetic keep the theme palette). null = keep theme palette. */
export function paletteMoodOverride(k: CreativeKnobs, sourceIsLight?: boolean): string[] | null {
  if (k.paletteMood === "premium" || k.paletteMood === "clean") {
    return sourceIsLight ? ["#F5F3EF", "#1A1A1A", "#9A8866", "#2A2A2A"] : ["#0E0E10", "#F2EFE9", "#C8A96A", "#1C1C1F"];
  }
  return null;
}

/** Audio-bed mood phrase for the Lyria prompt. */
export function knobsToAudioMood(k: CreativeKnobs): string {
  return k.audioMood === "energetic"
    ? "high-energy, driving, punchy"
    : k.audioMood === "soft"
      ? "soft, warm, premium, understated"
      : "balanced, modern, upbeat";
}
