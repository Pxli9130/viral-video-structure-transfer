import type { AssetProfile, RenderRecipe, TechniqueAtom, VersionStrategy } from "../types.js";
import { applyVersionStrategyToRecipe } from "./versionStrategies.js";

export type VersionStrategyPlan = {
  version: VersionStrategy;
  changes: Array<{
    dimension:
      | "hook_duration"
      | "text_density"
      | "cta_timing"
      | "motion_intensity"
      | "audio_density"
      | "selling_point_order"
      | "packaging_style";
    before?: unknown;
    after: unknown;
    reason: string;
  }>;
  recipePatch: unknown[];
};

export interface VersionStrategyPlannerInput {
  version: VersionStrategy;
  renderRecipe?: RenderRecipe;
  productTheme?: RenderRecipe["productTheme"];
  techniqueAtoms?: TechniqueAtom[];
  assetProfiles?: AssetProfile[];
}

function normalizeDimension(value: string): VersionStrategyPlan["changes"][number]["dimension"] {
  if (value === "cta_placement") return "cta_timing";
  if (value === "hook_duration" || value === "text_density" || value === "motion_intensity" || value === "audio_density" || value === "selling_point_order" || value === "packaging_style") return value;
  return "packaging_style";
}

function previewPlan(input: VersionStrategyPlannerInput): VersionStrategyPlan {
  const base =
    input.version === "high_click"
      ? [
          { dimension: "hook_duration" as const, after: "shorter setup / stronger first beat", reason: "High-click needs the payoff earlier." },
          { dimension: "motion_intensity" as const, after: "higher opening motion", reason: "Increase stop-scroll energy." },
          { dimension: "cta_timing" as const, after: "earlier CTA/payoff", reason: "Expose action earlier." }
        ]
      : input.version === "high_conversion"
        ? [
            { dimension: "selling_point_order" as const, after: "concrete benefits first", reason: "Conversion prioritizes proof and clarity." },
            { dimension: "cta_timing" as const, after: "clearer/larger CTA hold", reason: "Make decision point easier." },
            { dimension: "text_density" as const, after: "benefit text emphasized", reason: "Readable claims support conversion." }
          ]
        : [
            { dimension: "text_density" as const, after: "less subtitle clutter", reason: "Premium version needs more whitespace." },
            { dimension: "motion_intensity" as const, after: "smoother/lower motion", reason: "Reduce noise." },
            { dimension: "packaging_style" as const, after: "clean premium palette", reason: "Increase perceived quality." }
          ];
  return { version: input.version, changes: base, recipePatch: [{ op: "preview_only", reason: "No RenderRecipe supplied." }] };
}

export function planVersionStrategy(input: VersionStrategyPlannerInput): VersionStrategyPlan {
  if (!input.renderRecipe) return previewPlan(input);
  const result = applyVersionStrategyToRecipe(input.renderRecipe, input.version);
  return {
    version: input.version,
    changes: result.diff.changedDimensions.map((item) => ({
      dimension: normalizeDimension(item.dimension),
      before: item.before,
      after: item.after,
      reason: item.reason
    })),
    recipePatch: result.diff.changedDimensions.map((item) => ({
      op: "replace_or_scale",
      dimension: normalizeDimension(item.dimension),
      before: item.before,
      after: item.after,
      reason: item.reason
    }))
  };
}
