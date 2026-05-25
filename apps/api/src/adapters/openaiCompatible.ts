import {
  buildFallbackTemplate,
  type AIAdapter,
  type GenerationControls,
  type GenerationRequest,
  type Project,
  type StructureExtractionRequest,
  type StructureTemplate,
  type KnowledgeAtom,
  type GenerationResult
} from "@vvst/shared";

export interface OpenAICompatibleConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

interface TemplateEnrichment {
  templateName?: string;
  hookIntent?: string;
  bodyIntent?: string;
  proofIntent?: string;
  ctaIntent?: string;
  atomNames?: string[];
  qualityRationale?: string;
  pace?: "slow" | "medium" | "fast" | "mixed";
  packagingSubtitleStyle?: string;
  packagingTitleCardStyle?: string;
  packagingTransitionStyle?: string;
  packagingCoverStyle?: string;
}

interface ReviseLLMOutput {
  summary: string;
  patch?: Partial<GenerationControls> & { prompt?: string };
  pace?: GenerationControls["pace"];
  hookIntensity?: GenerationControls["hookIntensity"];
  packagingStyle?: GenerationControls["packagingStyle"];
  ctaStyle?: GenerationControls["ctaStyle"];
}

export interface ScorecardDimension {
  name: string;
  score: number;
  comment: string;
}

export interface ScorecardResult {
  overall: number;
  dimensions: ScorecardDimension[];
  rationale: string;
  judge: "heuristic" | "llm" | "llm+heuristic";
  warnings?: string[];
}

const DEFAULT_TIMEOUT = 30_000;

export class OpenAICompatibleAIAdapter implements AIAdapter {
  readonly name = "OpenAICompatibleAIAdapter";
  readonly available: boolean;
  private readonly config: Required<Pick<OpenAICompatibleConfig, "baseUrl" | "apiKey" | "model">> & { timeoutMs: number };

  constructor(config: OpenAICompatibleConfig) {
    this.available = Boolean(config.baseUrl && config.apiKey && config.model);
    this.config = {
      baseUrl: (config.baseUrl ?? "").replace(/\/$/, ""),
      apiKey: config.apiKey ?? "",
      model: config.model ?? "",
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT
    };
  }

  async extractStructure(request: StructureExtractionRequest): Promise<StructureTemplate> {
    const baseline = buildFallbackTemplate(request.analysis, request.vertical, request.projectId, request.vlm);
    if (!this.available) return baseline;
    try {
      const enrichment = await this.requestTemplateEnrichment(request, baseline);
      return mergeEnrichment(baseline, enrichment);
    } catch (error) {
      const warning = `OpenAI-compatible LLM failed (${(error as Error).message}); using deterministic fallback.`;
      return { ...baseline, qualityRationale: `${baseline.qualityRationale} | ${warning}` };
    }
  }

  async reviseInstruction(input: { generationId: string; instruction: string }) {
    if (!this.available) {
      return heuristicRevise(input.instruction, input.generationId);
    }
    try {
      const llm = await this.requestRevisePatch(input.instruction);
      const patch = mergeReviseControls(llm);
      return {
        summary: llm.summary || `Applied: ${input.instruction}`,
        patchedControls: patch,
        promptAddendum: llm.patch?.prompt
      };
    } catch (error) {
      const heuristic = heuristicRevise(input.instruction, input.generationId);
      return {
        ...heuristic,
        summary: `${heuristic.summary} (llm fallback: ${(error as Error).message})`
      };
    }
  }

  async judgeGeneration(generation: GenerationResult): Promise<ScorecardResult | null> {
    if (!this.available) return null;
    try {
      const payload = buildJudgePayload(generation);
      const text = await this.chat(
        [
          {
            role: "system",
            content:
              "你是一位资深短视频创作评审。请基于提供的脚本与时间线信息，对生成结果在五个维度上分别打分（0-100），并给出简短理由。请只返回 JSON，键为 overall, dimensions, rationale。dimensions 是 5 项 {name, score, comment}, name 限定为 hook/clarity/packaging/rhythm/cta，overall 是 5 项加权平均。"
          },
          { role: "user", content: JSON.stringify(payload) }
        ],
        true
      );
      const parsed = safeParseJson<ScorecardResult>(text);
      if (!parsed || !Array.isArray(parsed.dimensions)) return null;
      return { ...parsed, judge: "llm" };
    } catch {
      return null;
    }
  }

  private async requestTemplateEnrichment(
    request: StructureExtractionRequest,
    baseline: StructureTemplate
  ): Promise<TemplateEnrichment> {
    const compact = compactAnalysisForPrompt(request);
    const system = [
      "你是一名爆款短视频结构分析师。",
      "请根据样例视频的分析结果，提炼出可复用的结构模板字段。",
      "严格按 JSON Schema 输出：{ templateName, hookIntent, bodyIntent, proofIntent, ctaIntent, atomNames(6项), qualityRationale, pace, packagingSubtitleStyle, packagingTitleCardStyle, packagingTransitionStyle, packagingCoverStyle }。",
      "atomNames 给出 6 条不同的可复用创作技巧名称，分别覆盖 hook/rhythm/subtitle/proof/cta/gap_fill。",
      "pace 仅可为 slow/medium/fast/mixed。每个字段都用简体中文，单条不超过 80 字。",
      "禁止编造数据；如果信息不足，请基于通用 B 端 MG 风格爆款经验回答。"
    ].join("\n");
    const user = [
      `当前 baseline 模板：${truncate(JSON.stringify(baseline.name), 120)}`,
      `垂类：${request.vertical}`,
      `用户 prompt：${request.prompt ?? "(none)"}`,
      `分析摘要：${JSON.stringify(compact)}`
    ].join("\n");
    const reply = await this.chat([
      { role: "system", content: system },
      { role: "user", content: user }
    ], true);
    const parsed = safeParseJson<TemplateEnrichment>(reply);
    if (!parsed) throw new Error("LLM did not return valid JSON enrichment.");
    return parsed;
  }

  private async requestRevisePatch(instruction: string): Promise<ReviseLLMOutput> {
    const system = [
      "你是短视频创作助理。用户提交了一句自然语言改片指令，请将其映射成 controls 修改建议。",
      "返回 JSON {summary, pace?, hookIntensity?, packagingStyle?, ctaStyle?, patch?:{prompt?}}",
      "pace ∈ slow/medium/fast",
      "hookIntensity ∈ safe/strong/aggressive",
      "packagingStyle ∈ clean/bold/mg_motion",
      "ctaStyle ∈ soft/direct",
      "若指令未涉及某字段，则不要包含它。summary 用中文一句话总结所做改动。"
    ].join("\n");
    const reply = await this.chat([
      { role: "system", content: system },
      { role: "user", content: instruction }
    ], true);
    const parsed = safeParseJson<ReviseLLMOutput>(reply);
    if (!parsed || !parsed.summary) throw new Error("LLM did not return valid revise JSON.");
    return parsed;
  }

  private async chat(messages: ChatMessage[], json: boolean): Promise<string> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      temperature: 0.4
    };
    if (json) body.response_format = { type: "json_object" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 200)}`);
      }
      const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = json.choices?.[0]?.message?.content;
      if (!text) throw new Error("LLM response missing content");
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function compactAnalysisForPrompt(request: StructureExtractionRequest): unknown {
  const { analysis, vlm } = request;
  return {
    durationSec: analysis.metadata.durationSec,
    shotCount: analysis.shots.length,
    keyframeCount: analysis.keyframes.length,
    analyzer: analysis.analyzerMode,
    transcript: (analysis.transcript ?? [])
      .slice(0, 8)
      .map((cue) => ({ t: Math.round(cue.startSec * 10) / 10, text: truncate(cue.text ?? "", 80) })),
    ocr: (analysis.ocr ?? []).slice(0, 8).map((row: any) => truncate(String(row.text ?? ""), 80)),
    vlmSummary: vlm?.videoSummary ? truncate(vlm.videoSummary, 240) : null,
    vlmStructure: vlm?.structure,
    vlmRhythm: vlm?.rhythm,
    vlmPackaging: vlm?.packaging,
    reusablePatterns: vlm?.reusablePatterns?.slice(0, 6),
    materialGaps: vlm?.materialGapsForNewVideo?.slice(0, 6)
  };
}

function safeParseJson<T>(text: string): T | null {
  if (!text) return null;
  const tryParse = (input: string): T | null => {
    try {
      return JSON.parse(input) as T;
    } catch {
      return null;
    }
  };
  const direct = tryParse(text);
  if (direct) return direct;
  const match = text.match(/\{[\s\S]*\}/);
  if (match) return tryParse(match[0]);
  return null;
}

function mergeEnrichment(baseline: StructureTemplate, enrichment: TemplateEnrichment): StructureTemplate {
  const segments = baseline.segments.map((segment) => {
    if (segment.role === "hook" && enrichment.hookIntent) return { ...segment, intent: enrichment.hookIntent };
    if (segment.role === "body" && enrichment.bodyIntent) return { ...segment, intent: enrichment.bodyIntent };
    if (segment.role === "proof" && enrichment.proofIntent) return { ...segment, intent: enrichment.proofIntent };
    if (segment.role === "cta" && enrichment.ctaIntent) return { ...segment, intent: enrichment.ctaIntent };
    return segment;
  });

  const atoms: KnowledgeAtom[] = baseline.structureAtoms.map((atom, index) => {
    const llmName = enrichment.atomNames?.[index];
    if (!llmName) return atom;
    return { ...atom, name: truncate(llmName, 80) };
  });

  return {
    ...baseline,
    name: enrichment.templateName ? truncate(`LLM · ${enrichment.templateName}`, 120) : baseline.name,
    segments,
    structureAtoms: atoms,
    rhythm: enrichment.pace ? { ...baseline.rhythm, pace: enrichment.pace } : baseline.rhythm,
    packaging: {
      ...baseline.packaging,
      subtitleStyle: enrichment.packagingSubtitleStyle ?? baseline.packaging.subtitleStyle,
      titleCardStyle: enrichment.packagingTitleCardStyle ?? baseline.packaging.titleCardStyle,
      transitionStyle: enrichment.packagingTransitionStyle ?? baseline.packaging.transitionStyle,
      coverStyle: enrichment.packagingCoverStyle ?? baseline.packaging.coverStyle
    },
    qualityRationale: enrichment.qualityRationale
      ? `${baseline.qualityRationale} | LLM: ${enrichment.qualityRationale}`
      : baseline.qualityRationale
  };
}

function mergeReviseControls(llm: ReviseLLMOutput): Partial<GenerationControls> {
  const { prompt: _prompt, ...nestedPatch } = llm.patch ?? {};
  const patch: Partial<GenerationControls> = { ...nestedPatch };
  if (llm.pace) patch.pace = llm.pace;
  if (llm.hookIntensity) patch.hookIntensity = llm.hookIntensity;
  if (llm.packagingStyle) patch.packagingStyle = llm.packagingStyle;
  if (llm.ctaStyle) patch.ctaStyle = llm.ctaStyle;
  return patch;
}

const ZH_HOOK_AGGRESSIVE = /(开头|hook).*(更|增强|更猛|更抓|更狠|提速|快一点|加速)|aggressive hook/i;
const ZH_HOOK_SOFTER = /(开头|hook).*(柔|缓|平稳|安静|温和)|softer hook/i;
const ZH_REDUCE_SUBTITLE = /(减少|降低|更少).*(字幕|文字|caption)|less subtitle/i;
const ZH_FAST = /(更|增强|加).*(节奏|快|fast)|tempo up|increase rhythm/i;
const ZH_SLOW = /(放慢|更慢|更稳|sl(o|ow)).*(节奏)?|slower rhythm/i;
const ZH_DIRECT_CTA = /(cta|结尾).*(直接|直白|强|强力)|direct cta/i;
const ZH_SOFT_CTA = /(cta|结尾).*(柔|缓|温和|soft)|soft cta/i;
const ZH_PRODUCT_FIRST = /把.*商品.*提前|商品信息提前|product first/i;

export function heuristicRevise(instruction: string, generationId: string): { summary: string; patchedControls: Partial<GenerationControls> & { promptAddendum?: string } } {
  const patch: Partial<GenerationControls> & { promptAddendum?: string } = {};
  const reasons: string[] = [];
  if (ZH_HOOK_AGGRESSIVE.test(instruction)) {
    patch.hookIntensity = "aggressive";
    patch.pace = "fast";
    reasons.push("开头更抓人 → hookIntensity=aggressive, pace=fast");
  } else if (ZH_HOOK_SOFTER.test(instruction)) {
    patch.hookIntensity = "safe";
    reasons.push("开头更柔和 → hookIntensity=safe");
  }
  if (ZH_REDUCE_SUBTITLE.test(instruction)) {
    patch.packagingStyle = "clean";
    reasons.push("减少字幕 → packagingStyle=clean");
  }
  if (ZH_FAST.test(instruction)) {
    patch.pace = "fast";
    reasons.push("增强节奏 → pace=fast");
  } else if (ZH_SLOW.test(instruction)) {
    patch.pace = "slow";
    reasons.push("放慢节奏 → pace=slow");
  }
  if (ZH_DIRECT_CTA.test(instruction)) {
    patch.ctaStyle = "direct";
    reasons.push("CTA 更直接 → ctaStyle=direct");
  } else if (ZH_SOFT_CTA.test(instruction)) {
    patch.ctaStyle = "soft";
    reasons.push("CTA 更柔和 → ctaStyle=soft");
  }
  if (ZH_PRODUCT_FIRST.test(instruction)) {
    patch.promptAddendum = "请把商品信息/特写提前到 hook 段。";
    reasons.push("把商品信息提前 → 在 prompt 中追加优先级提示");
  }
  return {
    summary: reasons.length
      ? `(heuristic) generation ${generationId}: ${reasons.join("; ")}`
      : `(heuristic) generation ${generationId}: 未识别指令意图，沿用原参数。`,
    patchedControls: patch
  };
}

function buildJudgePayload(generation: GenerationResult): unknown {
  return {
    prompt: generation.request.prompt,
    durationSec: generation.timeline.durationSec,
    storyboard: generation.storyboard.map((shot) => ({
      time: shot.timeRange,
      subtitle: shot.subtitle,
      shot: shot.shotDescription,
      usage: shot.assetUsage
    })),
    gapReport: generation.gapReport,
    selectedAtoms: generation.selectedAtoms.map((atom) => atom.name)
  };
}

export type { TemplateEnrichment, ReviseLLMOutput };
