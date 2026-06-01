import type { ModelRouteSummary, ProviderDecision } from "../model-router/types.js";
import type { FillAction, GapReportItem, RenderRecipe, TechniqueAtom } from "../types.js";

export type StructureExplanation = {
  summaryZh: string;
  bulletStepsZh: string[];
  sampleLearned: string[];
  mappedToNewContent: string[];
  gapsAndRepairs: string[];
  renderSummary: string[];
  providerSummary: string[];
  safetySummary: string[];
  demoNarrationZh: string;
};

export interface StructureExplanationInput {
  evidenceSummary?: RenderRecipe["evidenceSummary"];
  techniqueAtoms?: TechniqueAtom[];
  gapReport?: GapReportItem[];
  fillPlan?: FillAction[];
  renderRecipe?: RenderRecipe;
  providerDecisions?: ProviderDecision[];
  modelRouteSummary?: ModelRouteSummary;
  finalGates?: { status?: string; summary?: unknown };
}

function safeText(value: unknown): string {
  return String(value ?? "")
    .replace(/prompt|生成提示词|raw prompt|学习样例|不复制样例/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function providerLine(decision: ProviderDecision): string {
  if (decision.fallbackUsed) {
    return `${decision.task} 使用 ${decision.selectedProvider} fallback；原因：${safeText(decision.fallbackReason ?? decision.selectedReason)}`;
  }
  return `${decision.task} 使用 ${decision.selectedProvider}`;
}

export function generateStructureExplanation(input: StructureExplanationInput): StructureExplanation {
  const recipe = input.renderRecipe;
  const evidence = input.evidenceSummary ?? recipe?.evidenceSummary;
  const atoms = input.techniqueAtoms ?? [];
  const gaps = input.gapReport ?? [];
  const fills = input.fillPlan ?? [];
  const decisions = input.providerDecisions ?? input.modelRouteSummary?.decisions ?? recipe?.providerDecisions ?? [];
  const externalUploads = input.modelRouteSummary?.summary.externalSampleMediaUploads ?? input.modelRouteSummary?.externalSampleMediaUploads ?? decisions.filter((decision) => decision.consumesSampleVideoExternally || decision.consumesSamplePixelsExternally || decision.consumesSampleAudioExternally).length;

  const sampleLearned = [
    `抽取到视觉元素 ${evidence?.preservedEvidence.visualElements ?? 0} 个、文字结构 ${evidence?.preservedEvidence.typographyRuns ?? 0} 组、运动原子 ${evidence?.preservedEvidence.motionAtoms ?? 0} 个、音频层 ${evidence?.preservedEvidence.audioLayers ?? 0} 个。`,
    atoms.length
      ? `复用的结构原子包括：${atoms.slice(0, 5).map((atom) => atom.name).join("、")}。`
      : "未检测到可命名 TechniqueAtom 时，使用确定性版式/节奏 fallback。"
  ];

  const mappedToNewContent = [
    `样片内容只作为结构证据；最终画面使用目标素材、生成素材或本地程序化图形。`,
    recipe ? `当前 RenderRecipe 有 ${recipe.clips.length} 个 clip、${recipe.layers?.length ?? 0} 个 layer，视频类型为 ${recipe.videoType}。` : "当前输入未提供 RenderRecipe。"
  ];

  const gapsAndRepairs = gaps.length
    ? gaps.slice(0, 8).map((gap) => {
        const fill = fills.find((item) => item.repairSourceGapId === gap.slotId || item.slotId === gap.slotId);
        return `${gap.slotId}: ${safeText(gap.reason)}；修复：${safeText(fill?.reason ?? gap.selectedRepair?.reason ?? gap.expectedVisualResult ?? "使用本地安全 fallback")}`;
      })
    : ["未记录 gap，或所有必需槽位已由目标素材/程序化 fallback 覆盖。"];

  const renderSummary = [
    recipe?.version ? `渲染合约版本：${recipe.version}。` : "渲染合约使用兼容结构。",
    `最终渲染仍由 Remotion/FFmpeg 本地链路消费 RenderRecipe，不由外部模型直接决定像素。`
  ];

  const providerSummary = decisions.length
    ? decisions.slice(0, 12).map(providerLine)
    : ["未提供 provider decision 记录；报告无法证明具体 provider/fallback。"];

  const safetySummary = [
    externalUploads === 0 ? "本次路由记录显示没有外部样片上传。" : `本次有 ${externalUploads} 个外部样片分析入口，必须确认均为 analysis-only。`,
    "AIGC 生成 provider 不接收样片帧/音频/视频作为引用。",
    "原始提示词不进入可渲染文字；生成素材必须携带 provenance。"
  ];

  const bulletStepsZh = [
    "先从样片抽取节奏、镜头、文字位置、运动原子和音频层等结构证据。",
    "再把这些结构映射到新商品/目标素材，样片像素和音频不作为 renderable material。",
    "遇到缺失素材时优先选择本地 Remotion/FFmpeg/procedural fallback，并记录 provider decision。",
    "最后用 lint、final gates 和 offline critic 检查安全与可渲染性。"
  ];

  const summaryZh = `本次生成学习的是样片结构，而不是复制样片画面。${decisions.some((decision) => decision.fallbackUsed) ? "存在 provider fallback，报告已列出原因。" : "主要 provider 路由均未触发 fallback。"}`;

  return {
    summaryZh,
    bulletStepsZh,
    sampleLearned,
    mappedToNewContent,
    gapsAndRepairs,
    renderSummary,
    providerSummary,
    safetySummary,
    demoNarrationZh: `${summaryZh} ${sampleLearned.join(" ")} ${mappedToNewContent.join(" ")} ${safetySummary.join(" ")}`
  };
}
