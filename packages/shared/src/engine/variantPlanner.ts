import type { GenerationControls, GenerationRequest } from "../types.js";

export interface EngineVariantSpec {
  label: "main" | "high_click" | "high_conversion" | "high_quality" | "high_fidelity";
  displayName: string;
  controls: Partial<GenerationControls>;
  promptAddendum?: string;
}

export const DEFAULT_ENGINE_VARIANTS: EngineVariantSpec[] = [
  {
    label: "main",
    displayName: "Final creative",
    controls: { creativeMode: "final_creative", pace: "fast", hookIntensity: "strong", packagingStyle: "mg_motion", ctaStyle: "direct" }
  },
  {
    label: "high_click",
    displayName: "High click",
    controls: { creativeMode: "final_creative", pace: "fast", hookIntensity: "aggressive", packagingStyle: "mg_motion", ctaStyle: "direct" },
    promptAddendum: "Keep the opening high-contrast and attention-led while preserving the source structure."
  },
  {
    label: "high_conversion",
    displayName: "High conversion",
    controls: { creativeMode: "final_creative", pace: "medium", hookIntensity: "strong", packagingStyle: "bold", ctaStyle: "direct", ctaTiming: "early", subtitleDensity: "dense" },
    promptAddendum: "Move product information and proof earlier, keep CTA visible longer, and order selling points by conversion value."
  },
  {
    label: "high_quality",
    displayName: "High quality",
    controls: { creativeMode: "final_creative", pace: "slow", hookIntensity: "safe", packagingStyle: "clean", ctaStyle: "soft", stylePreset: "clean_premium" },
    promptAddendum: "Use quieter pacing, fewer subtitles, and premium whitespace."
  },
  {
    label: "high_fidelity",
    displayName: "High fidelity style",
    controls: { creativeMode: "high_fidelity_style", pace: "fast", hookIntensity: "strong", packagingStyle: "mg_motion", ctaStyle: "direct", stylePreset: "sample_like" },
    promptAddendum: "Match the sample visual grammar closely without copying sample frames, audio, text, or branding."
  }
];

export function planGenerationVariants(
  base: GenerationRequest,
  variants: EngineVariantSpec[] = DEFAULT_ENGINE_VARIANTS
): Array<{ label: string; request: GenerationRequest; displayName: string }> {
  return variants.map((variant) => ({
    label: variant.label,
    displayName: variant.displayName,
    request: {
      ...base,
      controls: { ...(base.controls ?? {}), ...variant.controls },
      prompt: variant.promptAddendum ? `${base.prompt}\n[variant=${variant.label}]: ${variant.promptAddendum}` : base.prompt
    }
  }));
}
