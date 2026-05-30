import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useState } from "react";
import type {
  Asset,
  ExampleAnalysis,
  GenerationRequest,
  GenerationResult,
  KnowledgeAtom,
  Project,
  RendererTarget,
  StructureTemplate,
  TargetAssetInput,
  TemplateRecord,
  VideoAnalysisResult,
  Vertical
} from "@vvst/shared";

type ApiState = "idle" | "loading" | "error";

type KnowledgeBaseResponse = {
  projectId: string;
  templates: TemplateRecord[];
  atoms: KnowledgeAtom[];
  editingTechniques: Array<{ id: string; name: string; category: string; description: string; sourceTemplateId?: string }>;
  counts: { templates: number; atoms: number; techniques: number };
};

type ProjectDetailResponse = Project & {
  assets: Asset[];
  analyses: ExampleAnalysis[];
  templates: TemplateRecord[];
  generations: GenerationResult[];
  renders: RenderResponse["render"][];
};

type AnalyzeResponse = {
  project?: Project;
  asset: Asset;
  jobId: string;
  analysisId?: string;
  status: string;
  analysis: ExampleAnalysis;
  template?: StructureTemplate;
};

type GenerateResponse = {
  generationId: string;
  jobId: string;
  status: string;
  generation: GenerationResult;
};

type RenderResponse = {
  jobId: string;
  renderId: string;
  status: string;
  render: {
    outputPath?: string;
    previewHtml?: string;
    rendererTarget: RendererTarget;
    status: string;
    clipPreviewFrames?: { clipId: string; previewFrame: string }[];
  };
};

type ReviseResponse = {
  generationId: string;
  previousGenerationId?: string;
  instruction: string;
  summary: string;
  patchedControls: Record<string, unknown>;
  promptAddendum?: string | null;
  applied: boolean;
  generation?: GenerationResult;
};

type VariantResponse = {
  label: string;
  displayName: string;
  strategy: string;
  generationId: string;
  generation: GenerationResult;
};

type VariantsResponse = {
  baseGenerationId: string;
  count: number;
  variants: VariantResponse[];
};

type ScorecardResponse = {
  generationId: string;
  overall: number;
  dimensions: Array<{ name: string; score: number; comment: string }>;
  gates?: Array<{ id: string; passed: boolean; value: number | boolean | string; comment: string }>;
  rationale: string;
  judge: "heuristic" | "llm" | "llm+heuristic";
  warnings?: string[];
};

type ReplacementResponse = {
  previousGenerationId: string;
  generationId: string;
  replacementSlot: NonNullable<GenerationResult["replacementSlots"]>[number] | null;
  binding: { slotId: string; assetId: string; applyMotionFromSlot?: boolean };
  generation: GenerationResult;
};

type TargetMaterialManifestResponse = {
  schemaVersion: string;
  projectId: string;
  normalizedAt: string;
  brandName?: string;
  cta?: string;
  features?: string[];
  targetAssets: TargetAssetInput[];
  assetEvidence: Array<{ assetId: string; type: string; role: string; renderable: boolean; dimensions?: { width?: number; height?: number; codec?: string }; decodeStatus?: string }>;
  blockedAssets: Array<{ assetId?: string | null; kind?: string; role?: string; reason: string; status?: string }>;
  materialPolicy: Record<string, unknown>;
};

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } };

async function api<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) }
  });
  const payload = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (!payload || payload.ok !== true) {
    const message = payload && payload.ok === false ? payload.error.message : `Request failed: ${response.status}`;
    const details = payload && payload.ok === false ? payload.error.details : undefined;
    const detail = Array.isArray(details) ? details.join("; ") : "";
    throw new Error(detail ? `${message} (${detail})` : message);
  }
  return payload.data;
}

const defaultPrompt = `请基于已学习的爆款营销视频结构，把这个素材重构成一个 15 秒竖屏短视频。
主题：爆款结构迁移引擎
目标用户：短视频创作者、营销团队、内容运营
卖点：解析样例结构、诱导可复用槽位、检测素材缺口、渲染可编辑时间线
风格：快节奏、MG 动效、信息清晰
CTA：上传素材，分析结构，快速重构`;

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function publicAssetUrl(pathname: string): string {
  if (/^https?:\/\//.test(pathname)) return pathname;
  const configuredBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (configuredBase) return new URL(pathname, configuredBase).toString();
  if (import.meta.env.DEV && typeof window !== "undefined" && window.location.port && window.location.port !== "3000") {
    return `http://${window.location.hostname}:3000${pathname}`;
  }
  return pathname;
}

function generatedOutputUrl(render: RenderResponse["render"] | null): string | null {
  const outputPath = render?.outputPath;
  if (!outputPath) return null;
  if (/^https?:\/\//.test(outputPath)) return outputPath;
  if (outputPath.startsWith("/generated/")) return publicAssetUrl(outputPath);
  const filename = outputPath.split(/[\\/]/).pop();
  return filename ? publicAssetUrl(`/generated/${filename}`) : null;
}

function renderOutputUrl(render: RenderResponse["render"] | null): string | null {
  const outputPath = render?.outputPath;
  if (!outputPath || !outputPath.endsWith(".mp4")) return null;
  return generatedOutputUrl(render);
}

function renderOutputLabel(render: RenderResponse["render"] | null): string {
  const outputPath = render?.outputPath;
  if (!outputPath) return rendererLabel(render?.rendererTarget);
  return outputPath.split(/[\\/]/).pop() ?? outputPath;
}

function analysisVideoView(analysis: ExampleAnalysis | null): Partial<VideoAnalysisResult> | null {
  if (!analysis) return null;
  const record = analysis as unknown as Record<string, unknown>;
  const candidate = record.video && typeof record.video === "object"
    ? record.video as Partial<VideoAnalysisResult>
    : record as Partial<VideoAnalysisResult>;
  if (!candidate.metadata && !candidate.shots && !candidate.keyframes) return null;
  return candidate;
}

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function fixed(value: unknown, digits = 1): string {
  return safeNumber(value).toFixed(digits);
}

function percent(value: unknown): string {
  return `${Math.round(safeNumber(value) * 100)}%`;
}

const statusDisplay: Record<string, string> = {
  idle: "空闲",
  loading: "处理中",
  error: "错误",
  matched: "已匹配",
  weak_match: "弱匹配",
  missing: "缺失",
  generated: "已生成",
  skipped: "已跳过",
  proxy_generated: "代理占位",
  user_replaced: "用户已替换",
  rendered: "已渲染",
  completed: "已完成",
  failed: "失败",
  fast: "快",
  medium: "中",
  slow: "慢",
  source_video_mapped: "目标素材已匹配",
  target_asset_mapped: "目标素材已匹配",
  target_asset_weak_match: "目标素材弱匹配",
  no_user_asset_available: "缺少用户素材"
};

const roleDisplay: Record<string, string> = {
  hook: "钩子",
  body: "主体",
  proof: "证明",
  cta: "行动召唤",
  intro: "开场",
  outro: "结尾"
};

const strategyDisplay: Record<string, string> = {
  none: "无",
  proxy_placeholder: "代理占位",
  user_asset_replace: "用户素材替换",
  procedural_generation: "程序化生成",
  text_card: "文字卡片",
  packaging_overlay: "包装补全",
  reuse_with_crop_zoom: "裁切缩放复用",
  aigc_placeholder: "AIGC 占位",
  aigc_generated_asset: "AIGC 生成素材",
  source_video_mapped: "目标素材已匹配"
};

const severityDisplay: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重"
};

const rendererDisplay: Record<string, string> = {
  html_preview: "HTML 预览",
  ffmpeg: "FFmpeg MP4",
  remotion: "Remotion（占位）",
  hyperframes: "HyperFrames（占位）",
  remotion_mg: "Remotion MG",
  image_card: "图片卡片",
  ffmpeg_compose: "FFmpeg 合成"
};

function displayLabel(map: Record<string, string>, value: unknown, fallback = "未提供"): string {
  const key = String(value ?? "");
  if (!key) return fallback;
  return map[key] ?? key.replace(/_/g, " ");
}

function statusLabel(value: unknown): string {
  return displayLabel(statusDisplay, value, "未生成");
}

function roleLabel(value: unknown): string {
  return displayLabel(roleDisplay, value, "未分类");
}

function strategyLabel(value: unknown): string {
  return displayLabel(strategyDisplay, value, "未选择策略");
}

function severityLabel(value: unknown): string {
  return displayLabel(severityDisplay, value, "未评级");
}

function rendererLabel(value: unknown): string {
  return displayLabel(rendererDisplay, value, "未选择渲染器");
}

function clipLabel(generation: GenerationResult, clipId: string): string {
  const clip = safeArray(generation.timeline?.clips).find((item) => item.id === clipId);
  if (!clip) return clipId;
  const start = safeNumber(clip.startSec);
  return `${roleLabel(clip.role)} ${fixed(start)}-${fixed(start + safeNumber(clip.durationSec))}s`;
}

function visualStyleLine(template: StructureTemplate | null): string {
  const style = template?.visualStyle;
  if (!style) return "还没有结构化视觉风格";
  return [style.background, style.layout, style.motionAsset, style.typography].filter(Boolean).join(" · ");
}

function StatusLine({ state, error }: { state: ApiState; error: string | null }) {
  if (state === "loading") return <span className="status">处理中...</span>;
  if (state === "error") return <span className="status error">{error}</span>;
  return <span className="status ok">Spec v1.2 已就绪</span>;
}

function JsonPreview({ value }: { value: unknown }) {
  return <pre className="json-preview">{JSON.stringify(value, null, 2)}</pre>;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("VVST web UI render error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-shell">
          <section className="panel error-panel">
            <h1>界面渲染错误</h1>
            <p>{this.state.error}</p>
            <button onClick={() => window.location.reload()}>重新加载</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

const STAGE_HINTS: Record<string, string> = {
  "上传并分析样例视频": "ffprobe 元数据 → 证据分析(PySceneDetect 场景切点 + librosa 鼓点) → Gemini VLM 理解 → ASR/OCR → 结构抽取",
  "上传并分析源视频": "ffprobe 元数据 → 关键帧/镜头切分 → 素材理解",
  "AIGC 补缺口并生成": "槽位匹配 → 缺口检测 → 生成 brief → provider 出图 → 质量门(VLM) → 重新匹配 → 渲染",
  "重构生成": "选模板 → 源理解 → 槽位匹配 → 缺口报告 → 填充计划 → 时间线",
  "渲染视频": "逐片段渲染 → 拼接 → 混音 → 抽取每片段预览帧",
  "生成多版本": "为 4 个版本各跑一遍重构链路",
  "创建项目": "创建项目记录"
};

function ProgressBar({ label, elapsedSec }: { label: string; elapsedSec: number }) {
  const hint = STAGE_HINTS[label];
  return (
    <div className="progress-strip" role="status" aria-live="polite">
      <div className="progress-strip-bar"><span /></div>
      <div className="progress-strip-text">
        <strong>{label || "处理中"}…</strong>
        <span>已用时 {elapsedSec}s · 真实模型/分析处理，可能需要几分钟，请勿关闭页面</span>
        {hint ? <small>{hint}</small> : null}
      </div>
    </div>
  );
}

function AppContent() {
  const [apiState, setApiState] = useState<ApiState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [loadingLabel, setLoadingLabel] = useState<string>("");
  const [loadingStartedAt, setLoadingStartedAt] = useState<number | null>(null);
  const [, setNowTick] = useState(0);
  useEffect(() => {
    if (apiState !== "loading") return;
    const id = window.setInterval(() => setNowTick((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, [apiState]);
  const elapsedSec = loadingStartedAt ? Math.max(0, Math.floor((Date.now() - loadingStartedAt) / 1000)) : 0;
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBaseResponse | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [sampleAssetId, setSampleAssetId] = useState<string>("");
  const [sampleAnalysis, setSampleAnalysis] = useState<ExampleAnalysis | null>(null);
  const [sourceAssetId, setSourceAssetId] = useState<string>("");
  const [sourceAnalysis, setSourceAnalysis] = useState<ExampleAnalysis | null>(null);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [pace, setPace] = useState<"slow" | "medium" | "fast">("fast");
  const [packagingStyle, setPackagingStyle] = useState<"clean" | "bold" | "mg_motion">("mg_motion");
  const [generation, setGeneration] = useState<GenerationResult | null>(null);
  const [rendererTarget, setRendererTarget] = useState<RendererTarget>("ffmpeg");
  const [renderResult, setRenderResult] = useState<RenderResponse["render"] | null>(null);
  const [reviseInstruction, setReviseInstruction] = useState("放慢节奏，减少字幕，CTA 更柔和");
  const [reviseResult, setReviseResult] = useState<ReviseResponse | null>(null);
  const [variants, setVariants] = useState<VariantResponse[]>([]);
  const [scorecard, setScorecard] = useState<ScorecardResponse | null>(null);
  const [selectedReplacementSlotId, setSelectedReplacementSlotId] = useState<string>("");
  const [replacementResult, setReplacementResult] = useState<ReplacementResponse | null>(null);
  const [materialCardAssetIds, setMaterialCardAssetIds] = useState<string[]>([]);
  const [materialLogoAssetId, setMaterialLogoAssetId] = useState<string>("");
  const [materialCopyAssetId, setMaterialCopyAssetId] = useState<string>("");
  const [materialBrandName, setMaterialBrandName] = useState("Viral Structure Engine");
  const [materialCta, setMaterialCta] = useState("Upload. Analyze. Remix.");
  const [materialFeatureCopy, setMaterialFeatureCopy] = useState("Analyze sample videos\nInduce reusable slots\nDetect missing assets\nRender editable timelines");
  const [materialManifest, setMaterialManifest] = useState<TargetMaterialManifestResponse | null>(null);
  const [allowAigcGapFill, setAllowAigcGapFill] = useState(false);
  const [allowExternalAigcProvider, setAllowExternalAigcProvider] = useState(false);
  const [subtitleGenerationMode, setSubtitleGenerationMode] = useState<NonNullable<GenerationRequest["controls"]>["subtitleGenerationMode"]>("prompt_only");

  const selectedTemplate = useMemo(
    () => templates.find((record) => record.id === selectedTemplateId)?.template ?? templates[0]?.template ?? null,
    [selectedTemplateId, templates]
  );
  const renderedOutputUrl = generatedOutputUrl(renderResult);
  const renderedVideoUrl = renderOutputUrl(renderResult);
  const renderedHtmlPreview = renderResult?.previewHtml ?? null;
  const replacementSlots = generation?.replacementSlots ?? [];
  const selectedReplacementSlot =
    replacementSlots.find((slot) => slot.slotId === selectedReplacementSlotId) ?? replacementSlots[0] ?? null;
  const sampleVideo = analysisVideoView(sampleAnalysis);
  const sampleMetadata = sampleVideo?.metadata;
  const sampleShots = safeArray(sampleVideo?.shots);
  const sampleKeyframes = safeArray(sampleVideo?.keyframes);
  const sampleTranscript = safeArray(sampleVideo?.transcript);
  const sampleOcr = safeArray(sampleVideo?.ocr);
  const sourceShots = safeArray(analysisVideoView(sourceAnalysis)?.shots);
  const templateSegments = safeArray(selectedTemplate?.segments);
  const templateExcludeSegments = safeArray(selectedTemplate?.excludeSegments);
  const knowledgeAtoms = safeArray(knowledgeBase?.atoms);
  const generationSlotMapping = safeArray(generation?.slotMapping);
  const generationFillPlan = safeArray(generation?.fillPlan);
  const generationGapReport = safeArray(generation?.gapReport);
  const generationTimelineMappings = safeArray(generation?.timeline?.mapping);
  const generationSelectedAtoms = safeArray(generation?.selectedAtoms);
  const generationCandidates = safeArray(generation?.sourceUnderstanding?.candidates);
  const generationStoryboard = safeArray(generation?.storyboard);
  const generationClips = safeArray(generation?.timeline?.clips);
  // Evidence-first KB view: slots (induced + required) that cite real frame/timestamp evidence.
  const usedSlotIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of safeArray(generation?.slotMapping)) if (m?.slotId) ids.add(m.slotId);
    for (const c of safeArray(generation?.timeline?.clips)) if (c?.replacementSlotId) ids.add(c.replacementSlotId);
    return ids;
  }, [generation]);
  const templateEvidenceRows = useMemo(() => {
    if (!selectedTemplate) return [] as Array<{ id: string; family: string; role: string; confidence?: number; kinds: string[]; timeRange?: number[]; thumb?: string; signal?: string; summary?: string; used: boolean }>;
    const slots = [...safeArray(selectedTemplate.inducedSlots), ...safeArray(selectedTemplate.requiredSlots)] as unknown as Array<Record<string, unknown>>;
    const seen = new Set<string>();
    const rows = [];
    for (const slot of slots) {
      const id = String(slot.id ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const ev = slot.sourceEvidence as { confidence?: number; evidenceKinds?: string[]; timeRange?: number[]; framePaths?: string[]; signalSource?: string; summary?: string } | undefined;
      if (!ev || (!(ev.framePaths?.length) && !ev.timeRange)) continue;
      rows.push({
        id,
        family: String(slot.visualFormFamily ?? slot.visualForm ?? "—"),
        role: String(slot.role ?? "—"),
        confidence: ev.confidence,
        kinds: safeArray(ev.evidenceKinds),
        timeRange: ev.timeRange,
        thumb: ev.framePaths?.[0] ? publicAssetUrl(String(ev.framePaths[0])) : undefined,
        signal: ev.signalSource,
        summary: ev.summary,
        used: usedSlotIds.has(id)
      });
    }
    return rows;
  }, [selectedTemplate, usedSlotIds]);
  const templateCoveragePct = useMemo(() => {
    if (!selectedTemplate) return 0;
    const slots = [...safeArray(selectedTemplate.inducedSlots), ...safeArray(selectedTemplate.requiredSlots)] as unknown as Array<Record<string, unknown>>;
    const uniq = new Map<string, Record<string, unknown>>();
    for (const s of slots) uniq.set(String(s.id), s);
    const all = [...uniq.values()];
    if (!all.length) return 0;
    const withEv = all.filter((s) => {
      const ev = s.sourceEvidence as { framePaths?: string[]; timeRange?: number[] } | undefined;
      return (ev?.framePaths?.length ?? 0) > 0 || ev?.timeRange;
    });
    return Math.round((withEv.length / all.length) * 100);
  }, [selectedTemplate]);
  const selectionWarnings = safeArray(generation?.warnings).filter((w) => w.startsWith("template_selection"));
  const renderedClipFrames = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of safeArray(renderResult?.clipPreviewFrames)) {
      if (entry?.clipId && entry?.previewFrame) map.set(entry.clipId, publicAssetUrl(entry.previewFrame));
    }
    return map;
  }, [renderResult]);
  const managedTargetAssets = materialManifest?.targetAssets ?? [];
  const managedBlockedAssets = materialManifest?.blockedAssets ?? [];
  const aigcMaterialFill = generation?.aigcMaterialFill;
  const generationUsesAigcMaterial = Boolean(aigcMaterialFill?.generatedTargetAssets.length);

  async function run<T>(work: () => Promise<T>, label = "处理中"): Promise<T | undefined> {
    setLoadingLabel(label);
    setLoadingStartedAt(Date.now());
    setApiState("loading");
    setError(null);
    console.info(`[ui] ▶ ${label}`);
    const startedAt = Date.now();
    try {
      const result = await work();
      setApiState("idle");
      console.info(`[ui] ✓ ${label} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setApiState("error");
      console.error(`[ui] ✗ ${label} (${((Date.now() - startedAt) / 1000).toFixed(1)}s):`, caught);
      return undefined;
    }
  }

  async function refreshProject(projectId = project?.id) {
    if (!projectId) return;
    const [projectDetail, nextAssets, nextTemplates, nextKb] = await Promise.all([
      api<ProjectDetailResponse>(`/api/projects/${projectId}`),
      api<Asset[]>(`/api/projects/${projectId}/assets`),
      api<TemplateRecord[]>(`/api/templates?projectId=${projectId}`),
      api<KnowledgeBaseResponse>(`/api/projects/${projectId}/knowledge-base`)
    ]);
    setAssets(nextAssets);
    setTemplates(nextTemplates);
    setKnowledgeBase(nextKb);
    if (!selectedTemplateId && nextTemplates[0]) setSelectedTemplateId(nextTemplates[0].id);
    const sources = nextAssets.filter((asset) => asset.role === "source_video");
    const sortedByCreatedDesc = [...sources].sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    const realSources = sortedByCreatedDesc.filter((asset) => Boolean(asset.path));
    const latestReal = realSources[0];
    const fallback = sortedByCreatedDesc[0];
    const current = sources.find((asset) => asset.id === sourceAssetId);
    const currentIsMock = current && !current.path;
    const currentIsStale = current && current.path && latestReal && current.id !== latestReal.id && current.createdAt < latestReal.createdAt;
    if (!current || currentIsMock || currentIsStale) {
      const next = latestReal ?? fallback;
      if (next) setSourceAssetId(next.id);
    }
    const latestAnalyses = [...safeArray(projectDetail.analyses)].sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    const latestSampleAnalysis = latestAnalyses.find((analysis) => analysis.purpose === "sample" && analysisVideoView(analysis));
    const latestSourceAnalysis = latestAnalyses.find((analysis) => analysis.purpose === "source" && analysisVideoView(analysis));
    if (latestSampleAnalysis) {
      setSampleAssetId(latestSampleAnalysis.assetId);
      setSampleAnalysis(latestSampleAnalysis);
    }
    if (latestSourceAnalysis && (!sourceAssetId || latestSourceAnalysis.assetId === sourceAssetId)) {
      setSourceAssetId(latestSourceAnalysis.assetId);
      setSourceAnalysis(latestSourceAnalysis);
    }
  }

  async function loadProjects() {
    await run(async () => {
      const existing = await api<Project[]>("/api/projects");
      const nextProject =
        existing.find((item) => item.vertical === "b2b_marketing_mg") ??
        existing[0] ??
        (await api<Project>("/api/projects", {
          method: "POST",
          body: JSON.stringify({
            name: "Demo v1.2 Structure Knowledge Project",
            vertical: "b2b_marketing_mg",
            aspectRatio: "9:16",
            targetDurationSec: 15
          })
        }));
      setProjects(existing.length ? existing : [nextProject]);
      setProject(nextProject);
      await refreshProject(nextProject.id);
    });
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    const firstSlotId = generation?.replacementSlots?.[0]?.slotId ?? "";
    setSelectedReplacementSlotId((current) =>
      current && generation?.replacementSlots?.some((slot) => slot.slotId === current) ? current : firstSlotId
    );
  }, [generation?.id]);

  async function createProject() {
    const defaultName = `结构迁移项目 ${projects.length + 1}`;
    // Prompt the user to type a project name at the start; blank/accept → use our default.
    const input = typeof window !== "undefined" ? window.prompt("项目名称（可直接使用默认名）", defaultName) : defaultName;
    if (input === null) return; // user cancelled
    const name = input.trim() || defaultName;
    await run(async () => {
      const created = await api<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name,
          vertical: "b2b_marketing_mg" satisfies Vertical,
          aspectRatio: "9:16",
          targetDurationSec: 15
        })
      });
      setProject(created);
      setProjects((current) => [created, ...current]);
      setSelectedTemplateId("");
      setSampleAssetId("");
      setSampleAnalysis(null);
      setGeneration(null);
      setRenderResult(null);
      await refreshProject(created.id);
    }, "创建项目");
  }

  async function uploadAndAnalyze(file: File | null, role: "example_video" | "source_video") {
    if (!project || !file) return;
    const uploadLabel = role === "example_video" ? "上传并分析样例视频" : "上传并分析源视频";
    await run(async () => {
      const body = new FormData();
      body.set("file", file);
      body.set("role", role);
      body.set("sourcePolicy", role === "source_video" ? "user_authorized" : "demo_only");
      body.set("tags", role === "source_video" ? "product_like,background" : "example");
      const asset = await api<Asset>(`/api/projects/${project.id}/assets`, { method: "POST", body });
      const analysis = await api<AnalyzeResponse>(`/api/assets/${asset.id}/analyze`, {
        method: "POST",
        body: JSON.stringify({ purpose: role === "example_video" ? "sample" : "source", mode: "auto" })
      });
      if (role === "source_video") {
        setSourceAssetId(asset.id);
        setSourceAnalysis(analysis.analysis);
      } else {
        setSampleAssetId(asset.id);
        setSampleAnalysis(analysis.analysis);
      }
      if (analysis.template) setSelectedTemplateId(analysis.template.id);
      await refreshProject(project.id);
    }, uploadLabel);
  }

  async function uploadMotionGraphCards(files: FileList | null) {
    if (!project || !files?.length) return;
    await run(async () => {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.set("file", file);
        body.set("role", "user_image");
        body.set("sourcePolicy", "user_authorized");
        body.set("tags", "media_card,card,target_material");
        const asset = await api<Asset>(`/api/projects/${project.id}/assets`, { method: "POST", body });
        uploaded.push(asset.id);
      }
      setMaterialCardAssetIds((current) => Array.from(new Set([...current, ...uploaded])));
      setMaterialManifest(null);
      await refreshProject(project.id);
    });
  }

  async function uploadMotionGraphLogo(file: File | null) {
    if (!project || !file) return;
    await run(async () => {
      const body = new FormData();
      body.set("file", file);
      body.set("role", "user_image");
      body.set("sourcePolicy", "user_authorized");
      body.set("tags", "brand_logo,logo,target_material");
      const asset = await api<Asset>(`/api/projects/${project.id}/assets`, { method: "POST", body });
      setMaterialLogoAssetId(asset.id);
      setMaterialManifest(null);
      await refreshProject(project.id);
    });
  }

  async function saveMotionGraphCopyAsset() {
    if (!project || !materialFeatureCopy.trim()) return;
    await run(async () => {
      const asset = await api<Asset>(`/api/projects/${project.id}/assets`, {
        method: "POST",
        body: JSON.stringify({
          role: "user_text",
          type: "text",
          originalName: "motion-graph-feature-copy.txt",
          text: materialFeatureCopy.trim(),
          tags: "feature_copy,kinetic_copy,target_material",
          sourcePolicy: "user_authorized"
        })
      });
      setMaterialCopyAssetId(asset.id);
      setMaterialManifest(null);
      await refreshProject(project.id);
    });
  }

  async function buildMotionGraphTargetManifest() {
    if (!project) return;
    await run(async () => {
      const features = materialFeatureCopy
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);
      const response = await api<TargetMaterialManifestResponse>(`/api/projects/${project.id}/target-material-manifests`, {
        method: "POST",
        body: JSON.stringify({
          schemaVersion: "target-material-manifest-v1",
          brandName: materialBrandName,
          cta: materialCta,
          features,
          assets: [
            ...materialCardAssetIds.map((assetId) => ({ assetId, kind: "image", role: "media_card" })),
            ...(materialLogoAssetId ? [{ assetId: materialLogoAssetId, kind: "logo", role: "brand_logo" }] : []),
            ...(materialCopyAssetId ? [{ assetId: materialCopyAssetId, kind: "copy", role: "feature_copy" }] : [])
          ]
        })
      });
      setMaterialManifest(response);
    });
  }

  async function generate(options: { forceAigc?: boolean } = {}) {
    if (!project) return;
    const useAigcGapFill = options.forceAigc ?? allowAigcGapFill;
    await run(async () => {
      const request: GenerationRequest = {
        projectId: project.id,
        inputMode: sourceAssetId ? "video_plus_prompt" : "prompt_only",
        selectedTemplateIds: selectedTemplateId ? [selectedTemplateId] : undefined,
        sampleReferenceAssetId: sampleAssetId || sampleAnalysis?.assetId,
        sourceVideo: sourceAssetId ? { assetId: sourceAssetId } : undefined,
        prompt,
        target: {
          vertical: project.vertical,
          targetDurationSec: project.targetDurationSec,
          aspectRatio: project.aspectRatio,
          outputMode: "storyboard_preview"
        },
        controls: {
          pace,
          hookIntensity: "strong",
          packagingStyle,
          ctaStyle: "direct",
          allowAigcPlaceholder: true,
          allowAigcMaterialGeneration: useAigcGapFill,
          allowExternalAigcProvider: useAigcGapFill && allowExternalAigcProvider,
          subtitleGenerationMode
        },
        constraints: {
          noSampleVisualCopy: true
        },
        targetAssets: managedTargetAssets.length ? managedTargetAssets : undefined
      };
      const response = await api<GenerateResponse>("/api/generations", {
        method: "POST",
        body: JSON.stringify(request)
      });
      setGeneration(response.generation);
      setRenderResult(null);
      setReviseResult(null);
      setVariants([]);
      setScorecard(null);
      setReplacementResult(null);
    }, useAigcGapFill ? "AIGC 补缺口并生成" : "重构生成");
  }

  async function generateWithAigcGapFill() {
    setAllowAigcGapFill(true);
    await generate({ forceAigc: true });
  }

  async function renderTimeline() {
    if (!generation) return;
    await run(async () => {
      const response = await api<RenderResponse>(`/api/generations/${generation.id}/render`, {
        method: "POST",
        body: JSON.stringify({ rendererTarget })
      });
      setRenderResult(response.render);
    }, "渲染视频");
  }

  async function reviseGeneration() {
    if (!generation || !reviseInstruction.trim()) return;
    await run(async () => {
      const response = await api<ReviseResponse>(`/api/generations/${generation.id}/revise`, {
        method: "POST",
        body: JSON.stringify({ instruction: reviseInstruction.trim() })
      });
      setReviseResult(response);
      if (response.generation) {
        setGeneration(response.generation);
        setRenderResult(null);
        setScorecard(null);
        setReplacementResult(null);
      }
    });
  }

  async function generateVariants() {
    if (!generation) return;
    await run(async () => {
      const response = await api<VariantsResponse>(`/api/generations/${generation.id}/variants`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setVariants(response.variants);
    }, "生成多版本");
  }

  async function scoreGeneration() {
    if (!generation) return;
    await run(async () => {
      const response = await api<ScorecardResponse>(`/api/generations/${generation.id}/scorecard`, {
        method: "POST",
        body: JSON.stringify({ skipLlm: false })
      });
      setScorecard(response);
    });
  }

  async function uploadReplacementAsset(file: File | null) {
    if (!project || !generation || !selectedReplacementSlot || !file) return;
    await run(async () => {
      const body = new FormData();
      body.set("file", file);
      body.set("role", file.type.startsWith("video/") ? "source_video" : "user_image");
      body.set("sourcePolicy", "user_authorized");
      body.set("tags", `slot_replacement,${selectedReplacementSlot.slotId},${selectedReplacementSlot.visualForm}`);
      const asset = await api<Asset>(`/api/projects/${project.id}/assets`, { method: "POST", body });
      const response = await api<ReplacementResponse>(`/api/generations/${generation.id}/replacements`, {
        method: "POST",
        body: JSON.stringify({
          slotId: selectedReplacementSlot.slotId,
          assetId: asset.id,
          applyMotionFromSlot: true
        })
      });
      setReplacementResult(response);
      setGeneration(response.generation);
      setRenderResult(null);
      setScorecard(null);
      setSelectedReplacementSlotId(response.replacementSlot?.slotId ?? selectedReplacementSlot.slotId);
      await refreshProject(project.id);
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">爆款结构迁移引擎 MVP v1.2</p>
          <h1>视频 + 提示词重构工作台</h1>
        </div>
        <StatusLine state={apiState} error={error} />
      </header>
      {apiState === "loading" && <ProgressBar label={loadingLabel} elapsedSec={elapsedSec} />}
      <p style={{ background: "#eef2ff", color: "#3730a3", padding: "8px 12px", margin: "0 0 16px", borderRadius: 6, fontSize: 13 }}>
        素材策略提醒：系统只学习可复用的创意结构。样例视频中的画面、音频、旁白和人物肖像默认不会复制进生成结果。上传素材的商业复用权限仍由上传者负责，请在下游使用前确认授权。
      </p>

      <section className="workspace">
        <aside className="rail">
          <h2>项目面板</h2>
          <p>{project?.name ?? "正在加载项目..."}</p>
          <dl>
            <div>
              <dt>垂类</dt>
              <dd>{project?.vertical ?? "b2b_marketing_mg"}</dd>
            </div>
            <div>
              <dt>画幅</dt>
              <dd>{project?.aspectRatio ?? "9:16"}</dd>
            </div>
            <div>
              <dt>目标时长</dt>
              <dd>{project?.targetDurationSec ?? 15}s</dd>
            </div>
          </dl>
          <div className="button-row">
            <button onClick={createProject}>新建</button>
            <button onClick={loadProjects}>刷新</button>
          </div>
          <label>
            打开项目
            <select
              value={project?.id ?? ""}
              onChange={(event) => {
                const next = projects.find((item) => item.id === event.target.value);
                if (!next) return;
                setProject(next);
                setSelectedTemplateId("");
                setGeneration(null);
                setRenderResult(null);
                void refreshProject(next.id);
              }}
            >
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </aside>

        <div className="flow">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="step">步骤 1</span>
                <h2>样例学习</h2>
              </div>
              <div className="button-row">
                <label className="file-button">
                  上传样例
                  <input type="file" accept="video/mp4,video/quicktime,video/*" onChange={(event) => uploadAndAnalyze(event.target.files?.[0] ?? null, "example_video")} />
                </label>
              </div>
            </div>
            {sampleAnalysis && (
              sampleVideo ? (
                <div className="analysis-summary">
                  <article>
                    <strong>{sampleMetadata?.durationSec == null ? "-" : `${fixed(sampleMetadata.durationSec)}s`}</strong>
                    <span>{sampleMetadata?.width ?? "-"}×{sampleMetadata?.height ?? "-"} · {sampleVideo.analyzerMode ?? "analyzer"}</span>
                  </article>
                  <article>
                    <strong>{sampleShots.length}</strong>
                    <span>镜头 / {sampleKeyframes.length} 个关键帧</span>
                  </article>
                  <article>
                    <strong>{sampleTranscript.length}</strong>
                    <span>ASR 片段</span>
                  </article>
                  <article>
                    <strong>{sampleOcr.length}</strong>
                    <span>OCR 行</span>
                  </article>
                </div>
              ) : (
                <p className="empty">样例已上传，但分析响应没有返回 video 字段；请重新分析或刷新项目。</p>
              )
            )}
          </section>

          <section className="panel two-col">
            <div>
              <div className="panel-heading compact">
                <div>
                  <span className="step">步骤 2</span>
                  <h2>结构复盘</h2>
                </div>
                {selectedTemplate && <button onClick={() => downloadJson("structure-template-v1.2.json", selectedTemplate)}>导出模板</button>}
              </div>
              <div className="metrics">
                <div>
                  <strong>{templates.length}</strong>
                  <span>模板</span>
                </div>
                <div>
                  <strong>{knowledgeBase?.counts.atoms ?? 0}</strong>
                  <span>原子</span>
                </div>
                <div>
                  <strong>{templateSegments.length}</strong>
                  <span>段落</span>
                </div>
                <div>
                  <strong>{statusLabel(selectedTemplate?.rhythm.pace ?? "-")}</strong>
                  <span>节奏</span>
                </div>
              </div>
              {selectedTemplate && (
                <div className="template-facts">
                  <article>
                    <strong>视频类型</strong>
                    <span>{selectedTemplate.videoType ?? "unclassified"}</span>
                  </article>
                  <article>
                    <strong>视觉风格</strong>
                    <span>{visualStyleLine(selectedTemplate)}</span>
                    {selectedTemplate.visualStyle?.colorProgression?.length ? (
                      <small>{selectedTemplate.visualStyle.colorProgression.join(" → ")}</small>
                    ) : null}
                  </article>
                  <article>
                    <strong>排除片段</strong>
                    {templateExcludeSegments.length ? (
                      templateExcludeSegments.map((segment) => (
                        <span key={`${segment.startSec}-${segment.endSec}`}>
                          {fixed(segment.startSec)}–{fixed(segment.endSec)}s · {segment.reason}
                        </span>
                      ))
                    ) : (
                      <span>无</span>
                    )}
                  </article>
                </div>
              )}
              <div className="segment-row">
                {templateSegments.map((segment) => (
                  <article key={segment.id}>
                    <strong>{roleLabel(segment.role)}</strong>
                    <span>{segment.intent}</span>
                  </article>
                ))}
                {!selectedTemplate && <p className="empty">先分析样例，生成 v1.2 结构模板。</p>}
              </div>
              {sampleAnalysis && (
                <div className="segment-row vertical">
                  {sampleKeyframes.slice(0, 4).map((frame) => (
                    <article key={frame.id}>
                      <strong>{frame.id} · {fixed(frame.timeSec)}s</strong>
                      <span>{frame.description ?? frame.path ?? "关键帧"} · {safeArray(frame.tags).join(", ") || "无标签"}</span>
                    </article>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label>
                当前模板
                <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
                  <option value="">自动选择最新模板</option>
                  {templates.map((record) => (
                    <option key={record.id} value={record.id}>
                      {record.name}
                    </option>
                  ))}
                </select>
              </label>
              {selectedTemplate ? <JsonPreview value={selectedTemplate} /> : <p className="empty">还没有结构模板。</p>}
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="step">步骤 3</span>
                <h2>知识库 · 证据视图</h2>
              </div>
              {knowledgeBase && <button onClick={() => downloadJson("knowledge-base.json", knowledgeBase)}>导出知识库</button>}
            </div>
            {selectedTemplate && (
              <div className="kb-badges">
                <span className={`kb-badge ${selectedTemplate.videoType === "beat_cut" ? "ok" : ""}`}>类型 · {selectedTemplate.videoType ?? "未分类"}</span>
                <span className={`kb-badge ${selectedTemplate.aiEnrichmentStatus === "ok" ? "ok" : selectedTemplate.aiEnrichmentStatus === "failed" ? "warn" : ""}`}>AI 增强 · {selectedTemplate.aiEnrichmentStatus ?? "n/a"}</span>
                <span className={`kb-badge ${templateCoveragePct >= 70 ? "ok" : "warn"}`}>证据覆盖 · {templateCoveragePct}%</span>
                {selectedTemplate.rhythm?.bpm ? <span className="kb-badge">节奏 · {Math.round(selectedTemplate.rhythm.bpm)} BPM</span> : null}
              </div>
            )}
            {selectionWarnings.length > 0 && (
              <div className="kb-warning">{selectionWarnings.map((w, i) => <p key={i}>⚠️ {w.replace("template_selection: ", "")}</p>)}</div>
            )}
            {generation?.selectedTemplateReason && (
              <p className="kb-reason">选模依据：{generation.selectedTemplateReason}</p>
            )}
            <div className="asset-list knowledge-scroll">
              {templateEvidenceRows.map((row) => (
                <article key={row.id} className={`kb-evidence-row${row.used ? " used" : ""}`}>
                  {row.thumb ? <img className="kb-evidence-thumb" src={row.thumb} alt={row.family} /> : <div className="kb-evidence-thumb empty" />}
                  <div className="kb-evidence-body">
                    <strong>{roleLabel(row.role)} · {row.family}{row.used ? " ✓ 已用于本次生成" : ""}</strong>
                    <span>
                      {row.timeRange ? `${row.timeRange[0]}–${row.timeRange[1]}s` : "—"}
                      {typeof row.confidence === "number" ? ` · 置信度 ${row.confidence.toFixed(2)}` : ""}
                      {row.kinds.length ? ` · ${row.kinds.join("/")}` : ""}
                    </span>
                    {row.summary ? <small>{row.summary}</small> : null}
                  </div>
                </article>
              ))}
              {!templateEvidenceRows.length && <p className="empty">分析样例后，带帧/时间戳证据的可复用槽位会出现在这里。</p>}
            </div>
            {knowledgeAtoms.length > 0 && (
              <details className="kb-atoms-details">
                <summary>结构原子（{knowledgeAtoms.length}）</summary>
                <div className="asset-list">
                  {knowledgeAtoms.map((atom) => (
                    <article key={`${atom.templateId}-${atom.id}`}>
                      <strong>{roleLabel(atom.role)} · {atom.category}: {atom.name}</strong>
                      <span>{atom.description}</span>
                    </article>
                  ))}
                </div>
              </details>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="step">步骤 4</span>
                <h2>目标素材与提示词</h2>
              </div>
              <div className="button-row">
                <label className="file-button">
                  上传目标素材
                  <input type="file" accept="video/mp4,video/quicktime,video/*" onChange={(event) => uploadAndAnalyze(event.target.files?.[0] ?? null, "source_video")} />
                </label>
              </div>
            </div>
            {(() => {
              const selectedSource = assets.find((asset) => asset.id === sourceAssetId);
              const isMock = Boolean(selectedSource && !selectedSource.path);
              const hasNoSelection = !sourceAssetId;
              if (hasNoSelection || isMock) {
                return (
                  <p className="status" style={{ background: "#fef3c7", color: "#92400e", padding: 8, borderRadius: 6 }}>
                    {hasNoSelection
                      ? "还没有选择目标素材。生成会退回提示词模式，画面更偏文字卡片。上传真实目标视频后，重构会更丰富。"
                      : `当前目标素材“${selectedSource?.filename}”是 Mock 占位，没有真实文件。请点击“上传目标素材”选择真实视频。`}
                  </p>
                );
              }
              return null;
            })()}
            <div className="form-grid">
              <label>
                目标素材视频
                <select value={sourceAssetId} onChange={(event) => setSourceAssetId(event.target.value)}>
                  <option value="">仅提示词兜底</option>
                  {assets
                    .filter((asset) => asset.role === "source_video")
                    .map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.filename}{asset.path ? "" : " (Mock)"}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                节奏
                <select value={pace} onChange={(event) => setPace(event.target.value as typeof pace)}>
                  <option value="fast">快</option>
                  <option value="medium">中</option>
                  <option value="slow">慢</option>
                </select>
              </label>
              <label>
                包装风格
                <select value={packagingStyle} onChange={(event) => setPackagingStyle(event.target.value as typeof packagingStyle)}>
                  <option value="mg_motion">MG 动效</option>
                  <option value="bold">强对比</option>
                  <option value="clean">干净高级</option>
                </select>
              </label>
              <label>
                目标镜头候选
                <input readOnly value={sourceShots.length ? `${sourceShots.length} 个候选` : "生成时自动兜底"} />
              </label>
              <label className="wide">
                提示词
                <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
              </label>
            </div>
            <div className="material-intake">
              <div className="panel-heading compact">
                <div>
                  <span className="step">Motion Graph Material Intake</span>
                  <h3>目标卡片 / Logo / 文案素材池</h3>
                </div>
                <button onClick={buildMotionGraphTargetManifest} disabled={!project || apiState === "loading"}>
                  生成 Target Manifest
                </button>
              </div>
              <p className="empty">该路径使用项目托管上传素材。样例视频只作为结构证据，不会作为 target material。</p>
              <div className="form-grid">
                <label>
                  品牌名
                  <input value={materialBrandName} onChange={(event) => setMaterialBrandName(event.target.value)} />
                </label>
                <label>
                  CTA
                  <input value={materialCta} onChange={(event) => setMaterialCta(event.target.value)} />
                </label>
                <label>
                  上传 media cards
                  <span className="file-button inline-file">
                    选择图片
                    <input type="file" accept="image/*" multiple onChange={(event) => uploadMotionGraphCards(event.target.files)} />
                  </span>
                </label>
                <label>
                  上传 logo
                  <span className="file-button inline-file">
                    选择 Logo
                    <input type="file" accept="image/*" onChange={(event) => uploadMotionGraphLogo(event.target.files?.[0] ?? null)} />
                  </span>
                </label>
                <label className="wide">
                  feature copy
                  <textarea value={materialFeatureCopy} onChange={(event) => setMaterialFeatureCopy(event.target.value)} />
                </label>
                <button onClick={saveMotionGraphCopyAsset} disabled={!project || !materialFeatureCopy.trim() || apiState === "loading"}>
                  保存文案素材
                </button>
              </div>
              <div className="result-grid compact-grid">
                <div>
                  <h3>已选素材</h3>
                  <table>
                    <thead><tr><th>角色</th><th>素材</th></tr></thead>
                    <tbody>
                      <tr><td>media_cards</td><td>{materialCardAssetIds.map((id) => assets.find((asset) => asset.id === id)?.filename ?? id).join(", ") || "未上传"}</td></tr>
                      <tr><td>brand_cta</td><td>{assets.find((asset) => asset.id === materialLogoAssetId)?.filename ?? "未上传"}</td></tr>
                      <tr><td>ui_showcase/copy</td><td>{assets.find((asset) => asset.id === materialCopyAssetId)?.filename ?? "使用 manifest features 或未保存"}</td></tr>
                    </tbody>
                  </table>
                </div>
                <div>
                  <h3>Manifest 结果</h3>
                  <table>
                    <thead><tr><th>asset</th><th>role</th><th>状态</th></tr></thead>
                    <tbody>
                      {managedTargetAssets.map((asset) => (
                        <tr key={asset.id}><td>{asset.filename ?? asset.id}</td><td>{asset.role}</td><td>target material</td></tr>
                      ))}
                      {managedBlockedAssets.map((asset, index) => (
                        <tr key={`${asset.assetId ?? "blocked"}-${index}`}><td>{asset.assetId ?? "manifest entry"}</td><td>{asset.role ?? asset.kind}</td><td>{asset.reason}</td></tr>
                      ))}
                      {!managedTargetAssets.length && !managedBlockedAssets.length && <tr><td colSpan={3}>尚未生成 manifest。</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="step">步骤 5</span>
                <h2>重构规划器</h2>
              </div>
              <div className="button-row">
                <button onClick={() => generate()} disabled={!project || !templates.length || apiState === "loading"}>
                  生成重构方案
                </button>
                <button onClick={generateWithAigcGapFill} disabled={!project || !templates.length || apiState === "loading"}>
                  AIGC 补缺口并生成
                </button>
              </div>
            </div>
            <div className="aigc-gap-fill-card">
              <div>
                <strong>可选 AIGC 素材补全</strong>
                <span>默认关闭。开启后，缺失视觉槽位会先生成 MaterialGenerationBrief，再用安全 provider 生成候选素材，通过质量检查后作为 <code>aigc_generated_material</code> 进入 slot matching。</span>
              </div>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={allowAigcGapFill}
                  onChange={(event) => setAllowAigcGapFill(event.target.checked)}
                />
                启用 AIGC gap fill
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={allowExternalAigcProvider}
                  disabled={!allowAigcGapFill}
                  onChange={(event) => setAllowExternalAigcProvider(event.target.checked)}
                />
                允许外部 provider（Seedream，需要服务端 .env，可能产生费用）
              </label>
              <small>未勾选外部 provider 时，API 使用 deterministic mock_provider，不会外呼。样例帧不会发送给外部 provider。</small>
              <label>
                字幕生成
                <select value={subtitleGenerationMode} onChange={(event) => setSubtitleGenerationMode(event.target.value as typeof subtitleGenerationMode)}>
                  <option value="prompt_only">Prompt 文案（默认，不复制样例字幕）</option>
                  <option value="off">关闭字幕层</option>
                  <option value="ark_doubao">Ark Doubao 生成字幕/短文案</option>
                </select>
              </label>
            </div>
            {generation ? (
              <>
                {aigcMaterialFill && (
                  <div className="aigc-result-card">
                    <div>
                      <strong>AIGC material fill</strong>
                      <span>
                        provider: {aigcMaterialFill.provider}
                        {aigcMaterialFill.requestedProvider && aigcMaterialFill.requestedProvider !== aigcMaterialFill.provider ? ` · requested: ${aigcMaterialFill.requestedProvider}` : ""}
                        {" "}· generated target assets: {aigcMaterialFill.generatedTargetAssets.length} · external calls: {aigcMaterialFill.externalProviderUsed ? "yes" : "no"} · sample frames sent: {aigcMaterialFill.sampleFramesSentExternally ? "yes" : "no"}
                      </span>
                      {aigcMaterialFill.providerFallbackReason && <small>{aigcMaterialFill.providerFallbackReason}</small>}
                    </div>
                    <div className="result-grid compact-grid">
                      <div className="table-scroll">
                        <table>
                          <thead><tr><th>brief</th><th>family</th><th>type</th><th>count</th></tr></thead>
                          <tbody>
                            {aigcMaterialFill.briefs.map((brief) => (
                              <tr key={brief.id}><td>{brief.slotId}</td><td>{brief.visualFormFamily}</td><td>{brief.assetType}</td><td>{brief.count}</td></tr>
                            ))}
                            {!aigcMaterialFill.briefs.length && <tr><td colSpan={4}>没有可生成的缺口。</td></tr>}
                          </tbody>
                        </table>
                      </div>
                      <div className="table-scroll">
                        <table>
                          <thead><tr><th>candidate</th><th>usable</th><th>vlm</th><th>issues</th></tr></thead>
                          <tbody>
                            {aigcMaterialFill.quality.map((item) => (
                              <tr key={item.candidateId}>
                                <td>{item.candidateId}</td>
                                <td>{item.usable ? "yes" : "no"}</td>
                                <td>{item.vlmStatus}</td>
                                <td>{item.issues?.join(", ") || "none"}</td>
                              </tr>
                            ))}
                            {!aigcMaterialFill.quality.length && <tr><td colSpan={4}>尚无质量检查结果。</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
                <div className="result-grid">
                  <div>
                    <h3>槽位映射</h3>
                    <table>
                      <thead>
                        <tr>
                          <th>槽位</th>
                          <th>状态</th>
                          <th>依据</th>
                        </tr>
                      </thead>
                      <tbody>
                        {generationSlotMapping.map((mapping) => (
                          <tr key={mapping.slotId}>
                            <td>{mapping.slotType}</td>
                            <td><span className={`pill ${mapping.status}`}>{statusLabel(mapping.status)}</span></td>
                            <td>{mapping.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <h3>缺口补全</h3>
                    <div className="gap-list">
                      {generationFillPlan.map((action) => (
                        <article key={action.targetClipId}>
                          <strong>{strategyLabel(action.strategy)}</strong>
                          <span>{action.reason}</span>
                        </article>
                      ))}
                      {!generationFillPlan.length && <p className="empty">未检测到缺口。</p>}
                    </div>
                  </div>
                </div>
                <h3 style={{ marginTop: 18 }}>缺口报告</h3>
                <div className="gap-list">
                  {generationGapReport.map((gap) => (
                    <article key={`${gap.slotId}-${gap.gapType ?? gap.status}`}>
                      <strong>
                        {gap.gapLabelZh ?? gap.gapLabel ?? gap.slotId}
                        <span className={`severity ${gap.severity}`}>{severityLabel(gap.severity)}</span>
                      </strong>
                      <span>{gap.impact}</span>
                      <small>{gap.recommendedFillStrategies?.map(strategyLabel).join(", ") ?? "无推荐策略"}</small>
                    </article>
                  ))}
                  {!generationGapReport.length && <p className="empty">未检测到素材缺口。</p>}
                </div>
                <h3 style={{ marginTop: 18 }}>交互式缺口补全</h3>
                <div className="replacement-workbench">
                  <div className="replacement-slot-list">
                    {replacementSlots.map((slot) => (
                      <button
                        type="button"
                        key={slot.slotId}
                        className={`replacement-slot ${slot.status} ${selectedReplacementSlot?.slotId === slot.slotId ? "active" : ""}`}
                        onClick={() => setSelectedReplacementSlotId(slot.slotId)}
                      >
                        <span>{statusLabel(slot.status)}</span>
                        <strong>{slot.semanticLabel}</strong>
                        <small>{slot.visualForm} · {(slot.acceptedAssetTypes ?? []).join(", ")}</small>
                      </button>
                    ))}
                    {!replacementSlots.length && <p className="empty">本次生成没有检测到可点击替换的素材槽位。</p>}
                  </div>
                  {selectedReplacementSlot && (
                    <article className="slot-inspector">
                      <div className="slot-inspector-head">
                        <div>
                          <strong>{selectedReplacementSlot.semanticLabel}</strong>
                          <span>{selectedReplacementSlot.slotId}</span>
                        </div>
                        <span className={`pill ${selectedReplacementSlot.status}`}>{statusLabel(selectedReplacementSlot.status)}</span>
                      </div>
                      <dl>
                        <div>
                          <dt>当前填充</dt>
                          <dd>{selectedReplacementSlot.boundAssetId ?? selectedReplacementSlot.placeholderSpec?.label ?? "代理占位"}</dd>
                        </div>
                        <div>
                          <dt>运动</dt>
                          <dd>{selectedReplacementSlot.motionSpec?.type ?? "槽位运动"} · {String(selectedReplacementSlot.motionSpec?.axis ?? "保留")}</dd>
                        </div>
                        <div>
                          <dt>渲染器</dt>
                          <dd>{rendererLabel(selectedReplacementSlot.rendererBackend ?? "remotion_mg")}</dd>
                        </div>
                      </dl>
                      <label className="file-button replacement-upload">
                        上传替换素材
                        <input type="file" accept="image/*,video/*,.gif" onChange={(event) => uploadReplacementAsset(event.target.files?.[0] ?? null)} />
                      </label>
                      <p className="empty">点击替换会保留已学习的时序、布局和运动，并用项目内托管的上传素材重新生成。</p>
                    </article>
                  )}
                </div>
                {replacementResult && (
                  <div className="replacement-diff">
                    <strong>替换前后差异</strong>
                    <span>{replacementResult.previousGenerationId} → {replacementResult.generationId}</span>
                    <code>fillStrategy: 代理占位 → 用户素材替换</code>
                    <code>assetId: {replacementResult.binding.assetId}</code>
                    <code>motion: 沿用槽位运动</code>
                  </div>
                )}
              </>
            ) : (
              <p className="empty">运行重构后可查看映射、缺口、补全计划和时间线。</p>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="step">步骤 6</span>
                <h2>结果对比与预览</h2>
              </div>
              {generation && (
                <div className="button-row">
                  <button onClick={() => downloadJson("generation-request-v1.2.json", generation.request)}>导出请求</button>
                  <button onClick={() => downloadJson("timeline-v1.2.json", generation.timeline)}>导出时间线</button>
                  <button onClick={() => downloadJson("generation-report-v1.2.json", generation)}>导出报告</button>
                </div>
              )}
            </div>
            {generation && (
              <div className="form-grid">
                <label>
                  渲染目标
                  <select value={rendererTarget} onChange={(event) => setRendererTarget(event.target.value as RendererTarget)}>
                    <option value="html_preview">HTML 预览</option>
                    <option value="ffmpeg">FFmpeg MP4</option>
                    <option value="remotion">Remotion（占位）</option>
                    <option value="hyperframes">HyperFrames（占位）</option>
                  </select>
                </label>
                <button onClick={renderTimeline} disabled={apiState === "loading"}>
                  渲染
                </button>
                <p className={`render-material-note wide ${generationUsesAigcMaterial ? "ok" : "warn"}`}>
                  {generationUsesAigcMaterial
                    ? `当前时间线已包含 ${aigcMaterialFill?.generatedTargetAssets.length ?? 0} 个 AIGC 生成素材，FFmpeg 会按时间线渲染它们。`
                    : "当前时间线未包含 AIGC 生成素材；如需使用 AIGC 补缺口，请先点击“AIGC 补缺口并生成”，再渲染。"}
                </p>
                {renderResult && (
                  <p className="empty render-status wide">
                    {statusLabel(renderResult.status)} → {renderedOutputUrl ? (
                      <a href={renderedOutputUrl} target="_blank" rel="noreferrer">{renderOutputLabel(renderResult)}</a>
                    ) : renderOutputLabel(renderResult)}
                  </p>
                )}
                {renderedVideoUrl && (
                  <div className="render-preview wide">
                    <video className="render-player" controls src={renderedVideoUrl} />
                  </div>
                )}
                {!renderedVideoUrl && renderedHtmlPreview && (
                  <iframe className="html-preview wide" title="HTML render preview" srcDoc={renderedHtmlPreview} />
                )}
                {!renderedVideoUrl && !renderedHtmlPreview && renderedOutputUrl && (
                  <p className="empty wide">
                    <a href={renderedOutputUrl} target="_blank" rel="noreferrer">打开渲染结果</a>
                  </p>
                )}
                <label className="wide">
                  修改指令
                  <textarea value={reviseInstruction} onChange={(event) => setReviseInstruction(event.target.value)} />
                </label>
                <div className="button-row">
                  <button onClick={reviseGeneration} disabled={apiState === "loading"}>应用修改</button>
                  <button onClick={generateVariants} disabled={apiState === "loading"}>生成多版本</button>
                  <button onClick={scoreGeneration} disabled={apiState === "loading"}>评分面板</button>
                </div>
                {reviseResult && <p className="empty">修改结果：{reviseResult.summary}</p>}
              </div>
            )}
            {generation ? (
              <div className="compare-grid">
                <div>
                  <h3>样例模板段落</h3>
                  <div className="segment-row vertical">
                    {templateSegments.map((segment) => {
                      const mapping = generationTimelineMappings.find((item) => item.templateSegmentId === segment.id);
                      return (
                        <article key={segment.id} className="segment-diff-card">
                          <strong>{roleLabel(segment.role)} · {percent(segment.startRatio)}–{percent(segment.endRatio)}</strong>
                          <span>{segment.intent}</span>
                          <small>
                            映射到：{safeArray(mapping?.targetClipIds).length
                              ? safeArray(mapping?.targetClipIds).map((clipId) => clipLabel(generation, clipId)).join(" / ")
                              : "没有生成片段"}
                          </small>
                        </article>
                      );
                    })}
                    {!templateSegments.length && <p className="empty">还没有选择样例模板。</p>}
                  </div>
                  {templateExcludeSegments.length > 0 && (
                    <>
                      <h3 style={{ marginTop: 16 }}>样例排除片段</h3>
                      <div className="segment-row vertical">
                        {templateExcludeSegments.map((segment) => (
                          <article key={`${segment.startSec}-${segment.endSec}`}>
                            <strong>{fixed(segment.startSec)}–{fixed(segment.endSec)}s</strong>
                            <span>{segment.reason}</span>
                            <small>不会迁移到生成时间线。</small>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                  <h3 style={{ marginTop: 16 }}>已选结构原子</h3>
                  <div className="segment-row vertical">
                    {generationSelectedAtoms.map((atom) => (
                      <article key={atom.id}>
                        <strong>{roleLabel(atom.role)}：{atom.name}</strong>
                        <span>{atom.description}</span>
                      </article>
                    ))}
                  </div>
                  <h3 style={{ marginTop: 16 }}>目标镜头候选（{generationCandidates.length}）</h3>
                  <div className="segment-row vertical">
                    {generationCandidates.map((shot) => (
                      <article key={shot.id}>
                        <strong>{shot.id} · {fixed(shot.startSec)}–{fixed(shot.endSec)}s</strong>
                        <span>{safeArray(shot.tags).join(", ") || "无标签"}</span>
                      </article>
                    ))}
                    {generationCandidates.length === 0 && (
                      <p className="empty">没有目标镜头候选（仅提示词兜底）。</p>
                    )}
                  </div>
                </div>
                <div>
                  <h3>故事板</h3>
                  <div className="story-list">
                    {generationStoryboard.map((item) => (
                      <article key={item.clipId}>
                        <strong>{item.timeRange}: {item.subtitle}</strong>
                        <span>{item.shotDescription} · {item.assetUsage}</span>
                      </article>
                    ))}
                  </div>
                  {variants.length > 0 && (
                    <>
                      <h3 style={{ marginTop: 16 }}>多版本</h3>
                      <div className="story-list">
                        {variants.map((variant) => (
                          <article key={variant.generationId}>
                            <strong>{variant.displayName} · {variant.label}</strong>
                            <span>{variant.strategy}</span>
                            <small>{safeArray(variant.generation.timeline?.clips).length} clips · {variant.generation.timeline?.renderPlan?.background}</small>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                  {scorecard && (
                    <>
                      <h3 style={{ marginTop: 16 }}>评分面板 · {scorecard.overall}/100 · {scorecard.judge}</h3>
                      <div className="story-list">
                        {scorecard.dimensions.map((dimension) => (
                          <article key={dimension.name}>
                            <strong>{dimension.name}: {dimension.score}</strong>
                            <span>{dimension.comment}</span>
                          </article>
                        ))}
                        {scorecard.gates?.map((gate) => (
                          <article key={gate.id}>
                            <strong>{gate.id}: {gate.passed ? "通过" : "待检查"}</strong>
                            <span>{String(gate.value)} · {gate.comment}</span>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <div className="timeline-column">
                  <h3>时间线预览</h3>
                  <div className="timeline-strip">
                    {generationClips.map((clip, index) => {
                      const subtitle = clip.subtitleText ?? safeArray(clip.layers).find((layer) => layer.kind === "subtitle")?.text ?? clip.visualIntent ?? `Clip ${index + 1}`;
                      const clipExtra = clip as { previewFrame?: string; thumbnailPath?: string };
                      const previewFrame = renderedClipFrames.get(clip.id) ?? String(clipExtra.previewFrame ?? clipExtra.thumbnailPath ?? "");
                      const proxyLayer = safeArray(clip.layers).find((layer) => layer.style?.fillStrategy === "proxy_placeholder");
                      const isProxy = clip.gapFillStrategy === "proxy_placeholder" || Boolean(proxyLayer);
                      return (
                        <article key={clip.id} className={`phone-frame${isProxy ? " proxy" : ""}${previewFrame ? " has-preview" : ""}`}>
                          {previewFrame ? <img src={previewFrame} alt={`Clip ${index + 1} preview`} /> : null}
                          <div className="phone-frame-overlay">
                            <span>片段 {index + 1} · {roleLabel(clip.role)}</span>
                            <strong>{isProxy ? proxyLayer?.text ?? subtitle : subtitle}</strong>
                            <small>{strategyLabel(clip.gapFillStrategy ?? "none")}</small>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <p className="empty">结果区会展示结构原子、故事板和浏览器预览卡片。</p>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AppContent />
    </AppErrorBoundary>
  );
}
