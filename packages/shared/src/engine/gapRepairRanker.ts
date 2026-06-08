import type { ProviderDecision } from "../model-router/types.js";
import type { AssetProfile, GapReportItem, GapRepairOption, VersionStrategy } from "../types.js";

export type RankedRepairOption = {
  gapId: string;
  optionType: string;
  rank: number;
  score: number;
  selected: boolean;
  reason: string;
  providerDecision?: ProviderDecision;
  expectedVisualResult: string;
};

export interface GapRepairRankerInput {
  gapReport: GapReportItem[];
  assetProfiles?: AssetProfile[];
  providerDecisions: ProviderDecision[];
  versionStrategy?: VersionStrategy;
}

function decisionForOption(optionType: string, decisions: ProviderDecision[]): ProviderDecision | undefined {
  if (/seedance|video|motion/i.test(optionType)) return decisions.find((decision) => decision.task === "video_fill");
  if (/seedream|image|poster|card|packaging|cta/i.test(optionType)) return decisions.find((decision) => decision.task === "image_fill");
  if (/audio|bgm|music|sfx|sound/i.test(optionType)) {
    return decisions.find((decision) => decision.task === "music") ?? decisions.find((decision) => decision.task === "sound_effect");
  }
  return decisions.find((decision) => decision.task === "gap_repair_ranking");
}

function optionTypesForGap(gap: GapReportItem): string[] {
  const existing = (gap.repairOptions ?? []).map((option) => option.strategy);
  if (existing.length) return existing;
  const haystack = [gap.gapType, gap.visualFormFamily, gap.visualForm, gap.slotId].join(" ").toLowerCase();
  if (/audio|bgm|music|sound/.test(haystack)) return ["google_lyria_music", "procedural_audio"];
  if (/motion|moving|hero|ribbon|video/.test(haystack)) return ["procedural_motion", "aigc_video_fill", "packaging_fill"];
  if (/cta|brand|poster|image|card|background/.test(haystack)) return ["packaging_fill", "aigc_image_fill", "procedural_motion"];
  return ["packaging_fill", "procedural_motion"];
}

function unsafe(optionType: string, decision: ProviderDecision | undefined): boolean {
  if (!decision) return false;
  if (decision.mediaAccessPolicy.rawPromptRenderable) return true;
  if (decision.consumesSamplePixelsExternally || decision.consumesSampleAudioExternally || decision.consumesSampleVideoExternally) {
    return /aigc|seedance|seedream|google_lyria/i.test(optionType);
  }
  return false;
}

function baseScore(optionType: string, decision: ProviderDecision | undefined, gap: GapReportItem): number {
  let score = 50;
  if (/procedural|packaging|remotion|local/i.test(optionType)) score += 24;
  if (/aigc|seedance|seedream|google_lyria/i.test(optionType)) score += decision && !decision.fallbackUsed && decision.selectedProvider !== "unavailable" ? 12 : -24;
  if (decision?.fallbackUsed) score -= 6;
  if (gap.severity === "high") score += /motion|video|aigc_video/.test(optionType) ? 8 : 4;
  if (gap.status === "missing") score += 4;
  if (unsafe(optionType, decision)) score = -999;
  return score;
}

function strategyBoost(optionType: string, strategy: VersionStrategy | undefined, gap: GapReportItem): number {
  if (!strategy) return 0;
  if (strategy === "high_click") return /motion|video|hook|impact/i.test(`${optionType} ${gap.gapType ?? ""}`) ? 10 : 0;
  if (strategy === "high_conversion") return /cta|product|packaging|card|proof/i.test(`${optionType} ${gap.gapType ?? ""}`) ? 10 : 0;
  return /packaging|local|procedural/i.test(optionType) ? 8 : -4;
}

function visualResult(optionType: string, gap: GapReportItem, decision: ProviderDecision | undefined): string {
  if (/procedural_audio/.test(optionType)) return "Procedural beat/SFX layer fills the missing audio without copying sample audio.";
  if (/procedural_motion/.test(optionType)) return "Remotion procedural motion preserves learned timing and geometry with target-only material.";
  if (/packaging_fill/.test(optionType)) return "Local packaging/card fill supplies a renderable target visual without external generation.";
  if (/aigc_video/.test(optionType)) return `Optional video-fill provider ${decision?.selectedProvider ?? "unknown"} can create generated motion material when available.`;
  if (/aigc_image/.test(optionType)) return `Optional image provider ${decision?.selectedProvider ?? "unknown"} can create provenance-labeled still material when available.`;
  return `Repair option for ${gap.slotId} using ${optionType}.`;
}

export function rankGapRepairOptions(input: GapRepairRankerInput): RankedRepairOption[] {
  const rows: RankedRepairOption[] = [];
  for (const gap of input.gapReport) {
    const optionTypes = optionTypesForGap(gap);
    const scored = optionTypes
      .map((optionType) => {
        const decision = decisionForOption(optionType, input.providerDecisions);
        const score = baseScore(optionType, decision, gap) + strategyBoost(optionType, input.versionStrategy, gap);
        return {
          gapId: gap.slotId,
          optionType,
          score,
          selected: false,
          reason: decision?.fallbackUsed
            ? `${optionType} scored ${score}; provider route used fallback ${decision.selectedProvider}.`
            : `${optionType} scored ${score}; ${decision ? `provider route ${decision.selectedProvider}` : "no provider route needed"}.`,
          providerDecision: decision,
          expectedVisualResult: visualResult(optionType, gap, decision)
        };
      })
      .filter((option) => option.score > -999)
      .sort((a, b) => b.score - a.score);
    scored.forEach((option, index) => {
      rows.push({ ...option, rank: index + 1, selected: index === 0 });
    });
  }
  return rows;
}

export function applyRankedRepairOptions(gaps: GapReportItem[], ranked: RankedRepairOption[]): GapReportItem[] {
  return gaps.map((gap) => {
    const options = ranked.filter((option) => option.gapId === gap.slotId);
    const selected = options.find((option) => option.selected);
    const selectedRepair: GapRepairOption | undefined = selected
      ? {
          strategy: selected.optionType.includes("motion") ? "procedural_motion" : selected.optionType.includes("aigc") ? "aigc_fill" : "packaging_fill",
          label: selected.optionType,
          requiredInputs: [],
          risk: selected.optionType.includes("aigc") ? "medium" : "low",
          preservesStructure: true,
          reason: selected.reason
        }
      : gap.selectedRepair;
    return {
      ...gap,
      rankedRepairOptions: options,
      ...(selectedRepair ? { selectedRepair } : {}),
      expectedVisualResult: selected?.expectedVisualResult ?? gap.expectedVisualResult
    };
  });
}
