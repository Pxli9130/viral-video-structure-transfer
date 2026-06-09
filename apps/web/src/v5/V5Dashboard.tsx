// apps/web/src/v5/V5Dashboard.tsx
// Self-contained spec_v5 demo dashboard driving /api/v5/*. Mounted via the #v5 hash route so it does
// not touch the V4 App. Flow: pick sample assets -> Learn -> browse KB -> select elements + target
// assets + brief -> Generate -> see composition / gap / scorecard / final video.
import { type PointerEvent, useCallback, useEffect, useMemo, useState } from "react";

const API = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || "";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const headers = isForm ? init?.headers : { "content-type": "application/json", ...(init?.headers ?? {}) };
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...init, headers });
  } catch (error) {
    throw new Error(`Failed to fetch ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => res.statusText)}`);
  return (await res.json()) as T;
}

type AssetRow = { id: string; role: string; type: string; filename: string; hasPath: boolean; tags: string[] };
type ProjectRow = { id: string; name: string };
type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error?: { message?: string; code?: string; details?: unknown } };
type ServiceStatus = {
  health?: { ok: boolean; detail?: string; adapters?: Record<string, string>; mode?: string };
  ready?: { ok: boolean; detail?: string };
  checkedAt?: string;
};
type EvidenceV5 = {
  video?: { durationSec?: number; width?: number; height?: number; fps?: number; aspectRatio?: string; hasAudio?: boolean };
  shots?: Array<{ id: string; startSec: number; endSec: number; confidence?: number; summary?: string }>;
  keyFrames?: Array<{ id: string; timeSec: number; frameRef?: string }>;
  textEvidence?: Array<{ id: string; timeSec: number; text: string; role?: string }>;
  speechEvidence?: { hasSpeech?: boolean; transcript?: string; segments?: Array<{ startSec: number; endSec: number; text: string }> };
  audioEvidence?: { hasAudio?: boolean; bpm?: number; beatGridSec?: number[]; onsetsSec?: number[]; energyCurve?: Array<{ t: number; value: number }> };
  motionEvidence?: { cutDensity?: string; intensityCurve?: Array<{ t: number; value: number }>; peakMomentsSec?: number[] };
  contactSheetRef?: string;
  recommendedVideoInputPolicy?: { mode?: string; globalPass?: { fps?: number; useWholeVideo?: boolean }; detailPass?: { enabled?: boolean; chunkMode?: string; fps?: number } };
  warnings?: string[];
};
type ReconstructionV5 = {
  typedSpec?: {
    composition?: { durationSec?: number; fps?: number; width?: number; height?: number; aspectRatio?: string };
    scenes?: Array<{ id: string; role: string; startSec: number; endSec: number; intent?: string; layers?: unknown[]; evidenceRefs?: string[] }>;
    rhythm?: { cutDensity?: string; beatAlignedCuts?: boolean; peakMomentsSec?: number[] };
    packaging?: { typographySystem?: string; palette?: string[] };
  };
  placeholders?: Array<{ id: string; kind: string; required?: boolean; role?: string; replacementPolicy?: string }>;
  reconstructionQuality?: { structureCoverage?: number; timingCoverage?: number; placeholderCoverage?: number; warnings?: string[] };
  safety?: { samplePixelsRemoved?: boolean; sampleTextSanitized?: boolean; sampleAudioRemoved?: boolean };
  fallbackUsed?: boolean;
  fallbackReason?: string;
};
type SampleElementBundle = {
  candidates?: Array<{ id: string; proposedName?: string; kind?: string; summary?: string; reusablePolicy?: string; evidenceRefs?: string[] }>;
  decisions?: Array<{ id?: string; action?: string; assignedKind?: string; assignedName?: string; reason?: string; createdElementId?: string; targetElementId?: string }>;
};
type SampleReport = { assetId: string; evidence?: EvidenceV5; reconstruction?: ReconstructionV5; elements?: SampleElementBundle; error?: string };
type KbElement = {
  id: string;
  kind: string;
  category?: string;
  subcategory?: string;
  name: string;
  description: string;
  tags: string[];
  source: { sourceSampleId: string; evidenceRefs?: string[] };
  reusablePolicy: string;
  lifecycle?: { status?: string; version?: number; updatedAt?: string };
};
type Gate = { id: string; name: string; status: "pass" | "fail" | "warn"; priority?: string; message?: string };
type Scorecard = { gates: Gate[]; rubricCoverage: Array<{ rubricItem: string; status: string }>; demoReady?: boolean; warnings: string[]; readinessLevel?: string };
type TemplateSlot = { id: string; kind: string; required: boolean; originalRole: string; replacementPolicy: string; propPath?: string };
type TemplateMeta = {
  id: string;
  sourceSampleId: string;
  name: string;
  description?: string;
  tags: string[];
  slotSchema: TemplateSlot[];
  timingSignature?: { durationSec?: number };
  motionSignature?: { activeMotionCoverage?: number };
  quality?: { compilePassed?: boolean; renderPreviewPassed?: boolean; noCopyTemplatePassed?: boolean; warnings?: string[] };
  createdAt?: string;
};
type SlotBinding = { slotId: string; status: string; assetId?: string; uri?: string; text?: string; warnings: string[] };
type GenResult = {
  generationId: string;
  generationMode?: string;
  templateCapsuleId?: string;
  usedTemplateCode?: boolean;
  usedFallbackRenderer?: boolean;
  finalVideoUrl?: string;
  coverUrl?: string;
  scorecard: Scorecard;
  warnings?: string[];
  // same_template
  templateInstance?: { creativeBrief?: { variant?: string; theme?: string }; slotBindings: SlotBinding[]; readinessImpact: { missingRequiredSlotCount: number; usedFallbackCount: number; readinessLevel: string; warnings: string[] } };
  generatedAssets?: Array<{ slotId?: string; uri?: string; kind?: string }>;
  // mix_elements (advanced)
  composition?: { sections: Array<{ id: string; role: string; startSec: number; endSec: number; plannedText?: string }>; stylePlan: { palette: string[] } };
  gapReport?: { gaps: Array<{ slotId: string; status: string; selectedRepair: string; impact: string; reason?: string }> };
  finalProgram?: { renderMode?: string; fallbackUsed?: boolean; validation?: { warnings?: string[] } };
  generatedPatch?: Record<string, unknown>;
  patchNotes?: string[];
  naturalLanguageInstruction?: string;
};
type TransferTrace = {
  sample: {
    assetId?: string;
    filename?: string;
    videoUrl?: string;
    duration?: number;
    thumbnail?: string;
    evidence?: unknown;
    sceneRecipes?: Array<{ sectionId?: string; role?: string; transitionIn?: string; textAnim?: string; confidence?: number }>;
    audioRecipes?: Array<{ kind?: string; bpm?: number; mood?: string[]; cuePoints?: Array<{ t: number; type: string; role?: string }> }>;
  };
  template: {
    capsuleId?: string;
    name?: string;
    slotSchema: TemplateSlot[];
    remotionCodeHash?: string;
    knowledgeManifest?: {
      structureHypothesis?: {
        phases?: Array<{ id: string; role: string; startSec: number; endSec: number; durationSec: number; visualMethod?: string; intent?: string; beatCount?: number }>;
        motionMotifs?: string[];
        transitions?: string[];
      };
      assetSlots?: Array<{ id: string; kind: string; required: boolean; role: string; replacementPolicy: string; mediaKind?: string; promptAvailable?: boolean }>;
    };
  };
  transfer: {
    targetBrief?: { theme?: string; variant?: string; sellingPoints?: string[] };
    targetAssetProfiles?: Array<{ assetId: string; kind: string; labels: string[]; qualityScore: number; bestSection: string; motionSummary?: string; shotType?: string; sceneType?: string; detectedSubjects?: string[]; isHighlight?: boolean; vlmAnalyzed?: boolean }>;
    slotMapping: Array<{ slotId: string; slotKind?: string; originalRole?: string; required?: boolean; status: string; assetId?: string; text?: string; fillReason?: string; assetProfile?: { bestSection?: string; labels?: string[]; qualityScore?: number } }>;
    gapReport?: { gaps?: Array<{ slotId: string; status: string; selectedRepair: string; impact: string; reason?: string }> };
    fillActions: Array<{ slotId: string; status: string; strategy: string; reason: string }>;
    usedKnowledgeElements: Array<{ id: string; kind: string; name: string; tags: string[]; evidenceRefs?: string[] }>;
    // v2 evidence artifacts
    materialAnalysis?: Array<{ asset_id: string; type: string; resolution?: string | null; duration_sec?: number | null; has_audio?: boolean; quality_score?: number; detected_scene?: string; recommended_slots?: string[]; reject_reason?: string | null; crop_suggestions?: Array<{ aspect: string; safe_box: string; risk: string }>; selected_segments?: Array<{ start_sec: number; end_sec: number; score: number; recommended_slot: string }> }>;
    timeline?: { duration_sec?: number; tracks?: { video?: Array<{ segment_id: string; start_sec: number; end_sec: number; structure_slot?: string; transform?: string }>; text?: Array<{ text_id: string; content?: string; safe_zone?: string }> } };
    mapping?: Array<{ reference_slot: string; new_content_slot: string; adaptation_reason: string; copy_risk: string }>;
    similarityReport?: { verdict?: string; copy_risk_overall?: string; structure_reused?: boolean; wording_reused?: boolean; note?: string };
    packagingPlan?: { subtitles?: { count?: number; density?: string; recommended_font_px?: number; contrast_ratio?: number; contrast_ok?: boolean }; title_bar?: { text?: string } };
    beatAlignment?: { bpm?: number | null; transition_count?: number; aligned_count?: number; transitions?: Array<{ section: string; at_sec: number; offset_ms?: number | null; aligned: boolean }> };
    dialoguePlan?: { has_real_voiceover?: boolean; asr?: string; speech_segments?: Array<{ text: string; start_sec: number; end_sec: number }>; safe_cut_points?: unknown[]; unsafe_cuts?: Array<{ at_sec: number; reason: string }> };
    editTrace?: { command?: string; changes?: Array<{ operation: string; target_segment_id: string; reason: string }> };
    structureArbitration?: { selected?: string; selection_reason?: string; candidates?: Array<{ capsuleId: string; score: number; role_coverage?: string[] }>; borrowed?: Array<{ from: string; what: string }> };
  };
  result: {
    outputVideoUrl?: string;
    coverUrl?: string;
    previewFrames?: Array<{ label?: string; url?: string }>;
    scorecard?: Scorecard;
    renderParams?: unknown;
  };
  warnings?: string[];
};
type CreativeVariant = "high_click" | "high_conversion" | "high_quality";
type ProgressState = { label: string; step: number; total: number; detail: string };
type KbView = "structure" | "scene" | "source";

const accent = "#00d7ff";
const accentSoft = "#153747";
const accentGradient = "linear-gradient(135deg, #00f2ea 0%, #2f6bff 58%, #ff2d55 126%)";
const darkControl = "#18202d";
const card: React.CSSProperties = { background: "rgba(15, 18, 25, 0.78)", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 8, padding: 20, marginBottom: 20, boxShadow: "0 18px 48px rgba(0, 0, 0, 0.28)" };
const btn: React.CSSProperties = { background: accentGradient, color: "#fff", border: 0, borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontWeight: 700, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08), 0 10px 28px rgba(0, 215, 255, 0.12)" };
const tag: React.CSSProperties = { display: "inline-block", fontSize: 11, padding: "2px 8px", borderRadius: 99, background: "rgba(28, 37, 53, 0.82)", color: "#b8d7ff", marginRight: 6 };
const muted = "#8091ad";
const panel: React.CSSProperties = { border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: 8, padding: 14, background: "rgba(11, 18, 32, 0.62)" };
const miniPanel: React.CSSProperties = { border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: 8, padding: 10, background: "rgba(17, 24, 39, 0.68)" };
const sectionTitle: React.CSSProperties = { margin: "0 0 14px", fontSize: 16, lineHeight: 1.35, color: "#f7fbff" };
const checkboxStyle: React.CSSProperties = { width: 18, height: 18, margin: 0, flex: "0 0 18px", cursor: "pointer" };
const wrapText: React.CSSProperties = { overflowWrap: "anywhere", wordBreak: "break-word", minWidth: 0 };
const gateColor = (s: string) => (s === "pass" ? "#1f9d55" : s === "fail" ? "#d6324a" : "#b78a14");
const short = (value: string | undefined, n = 96) => (value && value.length > n ? `${value.slice(0, n)}…` : value ?? "");
const fixed = (value: unknown, digits = 1) => (typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "n/a");
const percent = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : "n/a");
const publicRef = (ref: string | undefined) => {
  if (!ref) return undefined;
  if (/^https?:\/\//.test(ref)) return ref;
  if (ref.startsWith("/generated/") || ref.startsWith("/api/")) return `${API}${ref}`;
  if (ref.startsWith("generated/")) return `${API}/${ref}`;
  return undefined;
};
const creativeVariants: Array<{ value: CreativeVariant; label: string; en: string; description: string }> = [
  { value: "high_click", label: "高点击", en: "high_click", description: "更强开头钩子，前三秒节奏更快，优先提升停留和点击。" },
  { value: "high_conversion", label: "高转化", en: "high_conversion", description: "卖点更靠前、CTA 更明确，优先推动转化。" },
  { value: "high_quality", label: "高质感", en: "high_quality", description: "画面更克制、留白更多、配色更高级，优先展示质感。" }
];
/** A clearer, larger collapse triangle (the small inline one was hard to hit). */
const triangleBtn: React.CSSProperties = { fontSize: 15, lineHeight: 1, color: "#cfe0f5", background: "rgba(17,24,39,0.85)", borderRadius: 6, padding: "3px 9px", border: "1px solid rgba(148,163,184,0.28)", display: "inline-flex", alignItems: "center" };
/** Compact card for a v2 evidence artifact. */
const evCard: React.CSSProperties = { border: "1px solid rgba(148,163,184,0.16)", borderRadius: 8, padding: "8px 10px", background: "rgba(11,18,32,0.6)", minWidth: 0, overflow: "hidden", lineHeight: 1.5 };
const evHead: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#cfe0f5", marginBottom: 4 };
/** What each KB view groups by + why it matters (shown under the view selector after selection). */
const KB_VIEW_INFO: Record<string, string> = {
  structure: "结构视图：按「结构 / 节奏 / 排版 / 转场 / CTA」等创作维度归类，看这套模板由哪些可复用的方法构成。影响：混合元素时按维度挑选要复用的「创作方法」。",
  scene: "场景视图：按镜头/场景段落归类（hook / 商品特写 / 使用 / 对比 / 结尾 CTA 等），看每个画面段落可复用的处理。影响：按画面顺序拼接镜头级元素。",
  source: "来源视图：按来源样例归类，看每条知识来自哪个学习过的视频，便于追溯与对比不同样例的贡献。影响：可按样例筛选/混搭多个视频的元素。"
};
/** ISO -> "MM-DD HH:mm" (local), for labelling templates by learn time. */
const fmtTime = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const variantStrategy = (variant: string | undefined) => ({
  high_click: "开头更强、前三秒节奏更快，适合拉点击和停留。",
  high_conversion: "卖点更靠前、CTA 更明确，适合投放转化。",
  high_quality: "画面更克制、转场更少，适合展示质感。"
}[variant ?? ""] ?? "沿用当前模板策略。");
const kbKindOptions = [
  "structure_pattern",
  "hook_pattern",
  "segment_template",
  "rhythm_pattern",
  "motion_pattern",
  "transition_pattern",
  "typography_pattern",
  "layout_pattern",
  "palette_pattern",
  "visual_asset_pattern",
  "image_prompt_recipe",
  "audio_pattern",
  "sfx_pattern",
  "voiceover_pattern",
  "cta_pattern",
  "remotion_snippet"
];
const kbCategoryFor = (element: KbElement) => element.category || element.kind.replace(/_pattern$/, "").replace(/_/g, " ");
const kbSceneFor = (element: KbElement) => {
  const text = [element.category, element.subcategory, element.kind, element.name, element.description, ...element.tags].join(" ").toLowerCase();
  if (/motion|mg|graph|ribbon|poster/.test(text)) return "Motion Graph / 包装";
  if (/audio|rhythm|beat|sfx|voice/.test(text)) return "节奏 / 音频";
  if (/hook|cta|conversion|marketing|ad/.test(text)) return "营销结构";
  if (/transition|motion|layout|typography|palette/.test(text)) return "剪辑与版式";
  return "通用结构";
};
const kbGroupFor = (element: KbElement, view: KbView) => (
  view === "source" ? `source ${element.source.sourceSampleId.slice(0, 10)}` : view === "scene" ? kbSceneFor(element) : kbCategoryFor(element)
);
const kbStatusFor = (element: KbElement) => element.lifecycle?.status ?? "active";
const progressLabelFor = (label: string) => ({
  upload: "上传素材",
  learn: "学习样本",
  generate: "生成视频",
  variants: "生成多版本",
  revise: "改写视频",
  "revise-nl": "自然语言改片"
}[label] ?? label);
const statusColor = (status: string | undefined) => status === "pass" || status === "done" || status === "matched" || status === "user_asset" ? "#1f9d55" : status === "fail" || status === "missing" ? "#d6324a" : "#b78a14";
const gateGroups = (scorecard: Scorecard | undefined) => {
  const gates = scorecard?.gates ?? [];
  const defs = [
    { name: "结构迁移", ids: ["V5-G15", "V5-G17", "V5-G18", "V5-G20"] },
    { name: "素材适配", ids: ["V5-G16", "V5-G18", "V5-G19", "V5-G32"] },
    { name: "画面包装", ids: ["V5-G21", "V5-G22", "V5-G26", "V5-G28"] },
    { name: "最终效果", ids: ["V5-G23", "V5-G24", "V5-G25", "V5-G27"] },
    { name: "安全合规", ids: ["V5-G29", "V5-G30", "V5-G31", "V5-G33"] }
  ];
  return defs.map((def) => {
    const picked = gates.filter((g) => def.ids.includes(g.id));
    const pass = picked.filter((g) => g.status === "pass").length;
    const fail = picked.filter((g) => g.status === "fail").length;
    const warn = picked.filter((g) => g.status === "warn").length;
    const status = fail ? "fail" : warn ? "warn" : pass === picked.length && picked.length ? "pass" : "warn";
    return { ...def, picked, pass, fail, warn, status };
  });
};

export function V5Dashboard() {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [kb, setKb] = useState<KbElement[]>([]);
  const [sampleIds, setSampleIds] = useState<string[]>([]);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [selectedEls, setSelectedEls] = useState<string[]>([]);
  const [theme, setTheme] = useState("portable fan high-click ad");
  const [sellingPoints, setSellingPoints] = useState("small, quiet, long battery");
  const [useAi, setUseAi] = useState(false);
  const [aiCapsule, setAiCapsule] = useState(true); // V5.1: real AI capsule codegen + render validation (default ON)
  const [gen2RemotionCodegen, setGen2RemotionCodegen] = useState(false);
  const [autoRender, setAutoRender] = useState(true);
  const [selectedVariant, setSelectedVariant] = useState<CreativeVariant | null>("high_click");
  const [generateAllVariants, setGenerateAllVariants] = useState(false);
  const reviewMode = true;
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<GenResult | null>(null);
  // V5.1 same-template mode (the DEFAULT)
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [genMode, setGenMode] = useState<"same_template" | "mix_elements">("same_template");
  const [templateId, setTemplateId] = useState<string>(""); // "" = latest learned capsule
  const [aigcOn, setAigcOn] = useState(true);
  const [imageFill, setImageFill] = useState<"aigc" | "procedural" | "off">("aigc");
  const [audioFill, setAudioFill] = useState<"aigc" | "procedural" | "off">("aigc");
  const [textFill, setTextFill] = useState<"llm" | "brief" | "off">("llm");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [reviseTheme, setReviseTheme] = useState("");
  const [reviseHeadline, setReviseHeadline] = useState("");
  // #11 creative knobs (manual adjust beyond theme/copy): rhythm / text-density / palette-mood.
  const [reviseRhythm, setReviseRhythm] = useState<"" | "aggressive" | "balanced" | "slow">("");
  const [reviseTextDensity, setReviseTextDensity] = useState<"" | "dense" | "medium" | "minimal">("");
  const [revisePaletteMood, setRevisePaletteMood] = useState<"" | "bold" | "premium" | "clean" | "energetic">("");
  const [nlInstruction, setNlInstruction] = useState("开头更抓人一些");
  // Per-slot user uploads from the gap radar (slotId -> assetId) + a free-text custom-version request.
  const [slotAssignments, setSlotAssignments] = useState<Record<string, string>>({});
  const [customRequest, setCustomRequest] = useState("");
  const [kbCollapsed, setKbCollapsed] = useState(false);
  const [kbExplorerCollapsed, setKbExplorerCollapsed] = useState(false);
  const [kbQuery, setKbQuery] = useState("");
  const [kbKind, setKbKind] = useState("all");
  const [kbView, setKbView] = useState<KbView>("structure");
  const [sampleReports, setSampleReports] = useState<Record<string, SampleReport>>({});
  const [sampleReportsLoading, setSampleReportsLoading] = useState(false);
  const [trace, setTrace] = useState<TransferTrace | null>(null);
  const [variants, setVariants] = useState<GenResult[]>([]);
  const [uploadProjectId, setUploadProjectId] = useState<string>("");

  const checkServiceStatus = useCallback(async () => {
    const checkedAt = new Date().toLocaleTimeString();
    const ping = async (path: "/healthz" | "/readyz") => {
      try {
        const response = await fetch(`${API}${path}`);
        if (!response.ok) return { ok: false, detail: `${path} ${response.status}` };
        const payload = (await response.json().catch(() => null)) as ApiEnvelope<{ mode?: string; adapters?: Record<string, string>; storageRoot?: string }> | null;
        if (payload?.ok === true) {
          return { ok: true, detail: path === "/readyz" ? payload.data.storageRoot : "ok", adapters: payload.data.adapters, mode: payload.data.mode };
        }
        return { ok: true, detail: "ok" };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    };
    const [health, ready] = await Promise.all([ping("/healthz"), ping("/readyz")]);
    const next = { health, ready, checkedAt };
    setServiceStatus(next);
    return next;
  }, []);

  const refreshKb = useCallback(async () => {
    const params = new URLSearchParams();
    const q = kbQuery.trim();
    if (q) params.set("q", q);
    if (kbKind !== "all") params.set("kind", kbKind);
    const query = params.toString();
    const r = await api<{ elements: KbElement[] }>(`/api/v5/kb/elements${query ? `?${query}` : ""}`);
    setKb(r.elements);
  }, [kbKind, kbQuery]);

  const refreshTemplates = useCallback(async () => {
    const r = await api<{ templates: TemplateMeta[] }>("/api/v5/templates");
    setTemplates(r.templates);
  }, []);

  const refreshAssets = useCallback(async () => {
    const r = await api<{ assets: AssetRow[] }>("/api/v5/assets");
    setAssets(r.assets);
  }, []);

  const loadSampleReports = useCallback(async (ids: string[] = sampleIds) => {
    if (!ids.length) return;
    setSampleReportsLoading(true);
    try {
      const entries = await Promise.all(ids.map(async (assetId) => {
        const [evidence, reconstruction, elements] = await Promise.all([
          api<EvidenceV5>(`/api/v5/samples/${assetId}/evidence`).catch(() => undefined),
          api<ReconstructionV5>(`/api/v5/samples/${assetId}/reconstruction`).catch(() => undefined),
          api<SampleElementBundle>(`/api/v5/samples/${assetId}/elements`).catch(() => undefined)
        ]);
        const report: SampleReport = evidence || reconstruction || elements
          ? { assetId, evidence, reconstruction, elements }
          : { assetId, error: "尚未找到学习产物；先点击 Learn 生成 evidence/reconstruction/elements。" };
        return [assetId, report] as const;
      }));
      setSampleReports((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    } finally {
      setSampleReportsLoading(false);
    }
  }, [sampleIds]);

  useEffect(() => {
    checkServiceStatus().catch(() => undefined);
    refreshAssets().catch((e) => setErr(String(e)));
    refreshKb().catch(() => undefined);
    refreshTemplates().catch(() => undefined);
  }, [checkServiceStatus, refreshAssets, refreshKb, refreshTemplates]);

  const fetchTrace = useCallback(async (generationId: string) => {
    const next = await api<TransferTrace>(`/api/v5/jobs/${generationId}/transfer-trace`).catch(() => null);
    setTrace(next);
  }, []);

  const videoAssets = useMemo(() => assets.filter((a) => a.type === "video" && a.hasPath), [assets]);
  const targetAssets = useMemo(() => assets.filter((a) => a.type === "image" || a.type === "video"), [assets]);
  // Selected template = explicit pick, else the latest learned capsule (the server's default too).
  const activeTemplate = useMemo<TemplateMeta | undefined>(
    () => templates.find((t) => t.id === templateId) ?? templates[templates.length - 1],
    [templates, templateId]
  );
  const requiredSlots = useMemo(() => activeTemplate?.slotSchema.filter((s) => s.required) ?? [], [activeTemplate]);
  // Label a template by its INPUT VIDEO name + learn time (falls back to the source id when the asset is gone).
  const tplLabel = (t: TemplateMeta): string => {
    const src = assets.find((a) => a.id === t.sourceSampleId)?.filename;
    const base = (src ?? t.sourceSampleId).replace(/\.[^.]+$/, "");
    const ts = fmtTime(t.createdAt);
    return ts ? `${base} · ${ts}` : base;
  };
  // How many required slots the user can cover from their own target assets (rough: count provided assets).
  const providedCount = targetIds.length;
  const missingRequired = Math.max(0, requiredSlots.length - providedCount);
  const kbFiltered = kb;
  const kbGroups = useMemo(() => {
    const groups = new Map<string, KbElement[]>();
    for (const element of kbFiltered) {
      const category = kbGroupFor(element, kbView);
      groups.set(category, [...(groups.get(category) ?? []), element]);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, elements]) => ({ category, elements }));
  }, [kbFiltered, kbView]);
  const selectedVariantMeta = creativeVariants.find((variant) => variant.value === selectedVariant) ?? null;
  const progressPercent = progress ? Math.max(8, Math.min(100, Math.round((progress.step / progress.total) * 100))) : 0;
  const selectedReports = sampleIds.map((id) => sampleReports[id]).filter((r): r is SampleReport => Boolean(r));
  const traceEvidence = trace?.sample.evidence as EvidenceV5 | undefined;
  const latestEvidence = selectedReports.find((r) => r.evidence)?.evidence ?? traceEvidence;
  const timelineSections = useMemo(() => {
    const phases = trace?.template.knowledgeManifest?.structureHypothesis?.phases ?? [];
    if (phases.length) return phases.map((p) => ({ id: p.id, role: p.role, startSec: p.startSec, endSec: p.endSec, detail: p.intent ?? p.visualMethod }));
    const sections = result?.composition?.sections ?? [];
    return sections.map((s) => ({ id: s.id, role: s.role, startSec: s.startSec, endSec: s.endSec, detail: s.plannedText }));
  }, [result?.composition?.sections, trace?.template.knowledgeManifest?.structureHypothesis?.phases]);
  const timelineDuration = useMemo(() => Math.max(1, latestEvidence?.video?.durationSec ?? 0, ...timelineSections.map((s) => s.endSec)), [latestEvidence?.video?.durationSec, timelineSections]);
  const slotRadarRows = useMemo(() => {
    const mappings = new Map((trace?.transfer.slotMapping ?? []).map((m) => [m.slotId, m]));
    const gaps = new Map([...(trace?.transfer.gapReport?.gaps ?? []), ...(result?.gapReport?.gaps ?? [])].map((g) => [g.slotId, g]));
    return (activeTemplate?.slotSchema ?? []).map((slot, index) => {
      const mapping = mappings.get(slot.id);
      const gap = gaps.get(slot.id);
      const status = mapping?.status ?? gap?.status ?? (targetIds.length > index ? "待生成时匹配" : slot.required ? "待补全" : "可选");
      const isAudio = /audio|voice|sfx/.test(slot.kind);
      const isText = /text|title|subtitle|cta/.test(slot.kind);
      const fill = gap?.selectedRepair
        ?? (mapping?.status === "user_asset" ? "asset_reuse" : mapping?.status?.includes("generated") ? mapping.status : isAudio ? audioFill : isText ? textFill : imageFill);
      return {
        slot,
        status,
        asset: mapping?.assetId ?? (targetIds.length > index ? "候选素材已选择" : "none"),
        impact: gap?.impact ?? (slot.required ? "medium" : "low"),
        fill,
        reason: mapping?.fillReason ?? gap?.reason ?? slot.replacementPolicy
      };
    });
  }, [activeTemplate?.slotSchema, audioFill, imageFill, result?.gapReport?.gaps, targetIds.length, textFill, trace?.transfer.gapReport?.gaps, trace?.transfer.slotMapping]);
  const qualityGroups = useMemo(() => gateGroups(result?.scorecard), [result?.scorecard]);
  const flowSteps = useMemo(() => [
    { label: "上传样例", detail: `${videoAssets.length} 个视频样例 · ${targetAssets.length} 个目标素材`, status: videoAssets.length ? "done" : "todo" },
    { label: "结构学习", detail: `${templates.length} 个模板 · ${kb.length} 条 KB`, status: templates.length || kb.length ? "done" : sampleIds.length ? "active" : "todo" },
    { label: "素材适配/缺口补全", detail: `${slotRadarRows.length} 个槽位 · ${slotRadarRows.filter((r) => r.status === "missing" || r.status === "待补全").length} 个缺口`, status: result || trace ? "done" : activeTemplate ? "active" : "todo" },
    { label: "生成与对比", detail: result?.finalVideoUrl ? "final.mp4 ready" : variants.length ? `${variants.length} 个版本` : "等待生成", status: result ? "done" : "todo" }
  ], [activeTemplate, kb.length, result, sampleIds.length, slotRadarRows, targetAssets.length, templates.length, trace, variants.length, videoAssets.length]);
  const serviceOk = serviceStatus?.health?.ok === true && serviceStatus.ready?.ok === true;

  const toggle = (arr: string[], set: (v: string[]) => void, id: string) =>
    set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  const setStage = (label: string, step: number, total: number, detail: string) => {
    setProgress({ label, step, total, detail });
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setErr(null);
    setStage(label, 1, 1, "准备中");
    try {
      await fn();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const retryDashboard = async () => {
    setErr(null);
    setDiagnosticsOpen(true);
    await checkServiceStatus();
    await Promise.allSettled([
      refreshAssets(),
      refreshKb(),
      refreshTemplates(),
      sampleIds.length ? loadSampleReports(sampleIds) : Promise.resolve()
    ]);
  };

  const ensureUploadProject = async () => {
    if (uploadProjectId) return uploadProjectId;
    const projects = await api<ProjectRow[]>("/api/projects").catch(() => []);
    const existing = projects.find((p) => p.name === "V5 Structure Transfer Demo") ?? projects[0];
    if (existing) {
      setUploadProjectId(existing.id);
      return existing.id;
    }
    const created = await api<ProjectRow>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "V5 Structure Transfer Demo", vertical: "b2b_marketing_mg", aspectRatio: "9:16", targetDurationSec: 16 })
    });
    setUploadProjectId(created.id);
    return created.id;
  };

  const uploadAssets = (files: FileList | null, role: "example_video" | "source_video" | "user_image") =>
    run("upload", async () => {
      if (!files?.length) return;
      const list = Array.from(files);
      setStage("upload", 1, list.length + 2, "准备上传项目");
      const projectId = await ensureUploadProject();
      for (const [index, file] of list.entries()) {
        setStage("upload", index + 2, list.length + 2, `上传 ${short(file.name, 34)}`);
        const body = new FormData();
        body.append("file", file);
        body.append("role", role);
        body.append("sourcePolicy", "user_authorized");
        body.append("tags", role === "example_video" ? "sample_video,v5" : "target_material,v5");
        await api<AssetRow>(`/api/projects/${projectId}/assets`, { method: "POST", body });
      }
      setStage("upload", list.length + 2, list.length + 2, "刷新素材列表");
      await refreshAssets();
    });

  // Upload ONE file and return the created asset row (used by per-slot gap-radar uploads).
  const uploadOneAsset = async (file: File, role: "source_video" | "user_image"): Promise<AssetRow> => {
    const projectId = await ensureUploadProject();
    const body = new FormData();
    body.append("file", file);
    body.append("role", role);
    body.append("sourcePolicy", "user_authorized");
    body.append("tags", "target_material,v5,slot_assign");
    const created = await api<AssetRow>(`/api/projects/${projectId}/assets`, { method: "POST", body });
    await refreshAssets();
    return created;
  };

  // The user uploaded an asset FOR a specific slot in the gap radar -> bind it to that slot at generation.
  const assignSlotAsset = (slotId: string, files: FileList | null) =>
    run("upload", async () => {
      const file = files?.[0];
      if (!file) return;
      setStage("upload", 1, 2, `上传到槽位 ${slotId}`);
      const created = await uploadOneAsset(file, file.type.startsWith("video") ? "source_video" : "user_image");
      setSlotAssignments((m) => ({ ...m, [slotId]: created.id }));
      setTargetIds((ids) => Array.from(new Set([...ids, created.id])));
      setStage("upload", 2, 2, "已绑定到该槽位");
    });

  const clearSlotAsset = (slotId: string) =>
    setSlotAssignments((m) => {
      const next = { ...m };
      delete next[slotId];
      return next;
    });

  const learn = () =>
    run("learn", async () => {
      setStage("learn", 1, 3, "提交样本学习任务");
      const r = await api<{ learned: Array<{ sampleId: string; storedElements?: number; gen1?: string; error?: string }>; kbSize: number }>(
        "/api/v5/learn-samples",
        { method: "POST", body: JSON.stringify({ sampleAssetIds: sampleIds, options: { runGen1Ai: useAi, runCapsuleCodegen: aiCapsule } }) }
      );
      setLog(r.learned.map((l) => (l.error ? `✗ ${l.sampleId}: ${l.error}` : `✓ ${l.sampleId}: ${l.storedElements} elements (gen1=${l.gen1})`)));
      setStage("learn", 2, 3, "刷新 KB 和模板库");
      await Promise.all([refreshKb(), refreshTemplates()]);
      await loadSampleReports(sampleIds);
      setStage("learn", 3, 3, "学习结果已更新");
    });

  const generate = () =>
    run("generate", async () => {
      const sellingArr = sellingPoints.split(",").map((s) => s.trim()).filter(Boolean);
      const options: Record<string, unknown> =
        genMode === "same_template"
          ? {
              generationMode: "same_template",
              autoRender,
              ...(templateId ? { templateCapsuleId: templateId } : {}),
              aigcGapFill: aigcOn
                ? { mode: "auto_on", imageFill, audioFill, textFill }
                : { mode: "off", imageFill: "off", audioFill: "off", textFill: "off" }
            }
          : { generationMode: "mix_elements", autoRender, runGen1Ai: useAi, runGen2Ai: useAi };
      if (genMode === "mix_elements" && gen2RemotionCodegen) options.runGen2RemotionCodegen = true;
      setStage("generate", 1, 4, autoRender ? "生成 recipe / 补全素材 / 渲染 final.mp4" : "生成 recipe / 补全素材");
      const res = await api<GenResult>("/api/v5/generations", {
        method: "POST",
        body: JSON.stringify({
          projectId: "proj_v5_ui",
          brief: { theme, variant: selectedVariant ?? undefined, targetDurationSec: 16, aspectRatio: "9:16", sellingPoints: sellingArr },
          targetAssetIds: targetIds,
          ...(Object.keys(slotAssignments).length ? { slotAssignments } : {}),
          selectedElementIds: genMode === "mix_elements" && selectedEls.length ? selectedEls : undefined,
          options
        })
      });
      setStage("generate", 2, 4, "写入生成结果");
      setResult(res);
      setVariants([]);
      setStage("generate", 3, 4, "读取 transfer trace");
      await fetchTrace(res.generationId);
      setStage("generate", 4, 4, "生成完成");
    });

  const generateVariants = () =>
    run("variants", async () => {
      const sellingArr = sellingPoints.split(",").map((s) => s.trim()).filter(Boolean);
      const selectedTemplate = templateId || activeTemplate?.id;
      const baseOptions = {
        generationMode: "same_template",
        autoRender,
        ...(selectedTemplate ? { templateCapsuleId: selectedTemplate } : {}),
        aigcGapFill: aigcOn
          ? { mode: "auto_on", imageFill, audioFill, textFill }
          : { mode: "off", imageFill: "off", audioFill: "off", textFill: "off" }
      };
      const labels: Array<"high_click" | "high_conversion" | "high_quality"> = ["high_click", "high_conversion", "high_quality"];
      const next: GenResult[] = [];
      for (const [index, variant] of labels.entries()) {
        setStage("variants", index + 1, labels.length + 1, `生成 ${variant}`);
        const res = await api<GenResult>("/api/v5/generations", {
          method: "POST",
          body: JSON.stringify({
            projectId: "proj_v5_ui",
            generationId: `gen_${variant}_${Date.now().toString(36)}`,
            brief: { theme, variant, targetDurationSec: 16, aspectRatio: "9:16", sellingPoints: sellingArr },
            targetAssetIds: targetIds,
            ...(Object.keys(slotAssignments).length ? { slotAssignments } : {}),
            options: baseOptions
          })
        });
        next.push(res);
        setVariants([...next]);
      }
      if (next[0]) {
        setResult(next[0]);
        setStage("variants", labels.length + 1, labels.length + 1, "读取首个版本 trace");
        await fetchTrace(next[0].generationId);
      }
    });

  // Patch-first revise (modify_template) of the current result.
  const revise = (gen: GenResult) =>
    run("revise", async () => {
      const patch: Record<string, unknown> = {};
      if (reviseTheme.trim()) patch.theme = reviseTheme.trim();
      if (reviseHeadline.trim()) patch.copyOverrides = { headline: reviseHeadline.trim() };
      if (reviseRhythm) patch.rhythm = reviseRhythm;
      if (reviseTextDensity) patch.textDensity = reviseTextDensity;
      if (revisePaletteMood) patch.paletteMood = revisePaletteMood;
      setStage("revise", 1, 3, "提交模板 patch");
      const res = await api<GenResult>(`/api/v5/generations/${gen.generationId}/revise`, {
        method: "POST",
        body: JSON.stringify({ projectId: "proj_v5_ui", patch })
      });
      setStage("revise", 2, 3, "写入改写结果");
      setResult(res);
      setStage("revise", 3, 3, "读取 transfer trace");
      await fetchTrace(res.generationId);
    });

  const reviseNatural = (gen: GenResult, instruction?: string) =>
    run("revise-nl", async () => {
      const instr = (instruction ?? nlInstruction).trim();
      setStage("revise-nl", 1, 3, "解析自然语言改片请求");
      const res = await api<GenResult>(`/api/v5/generations/${gen.generationId}/revise-natural-language`, {
        method: "POST",
        body: JSON.stringify({ projectId: "proj_v5_ui", instruction: instr })
      });
      setStage("revise-nl", 2, 3, "写入改写结果");
      setResult(res);
      setStage("revise-nl", 3, 3, "读取 transfer trace");
      await fetchTrace(res.generationId);
    });

  // Custom version from a free-text request: build a base scaffold (no render) then re-theme it via the
  // natural-language revise (which parses the request into creative knobs + re-renders the visible version).
  const generateCustom = () =>
    run("generate", async () => {
      const instr = customRequest.trim();
      if (!instr) return;
      const sellingArr = sellingPoints.split(",").map((s) => s.trim()).filter(Boolean);
      const baseOptions: Record<string, unknown> = {
        generationMode: "same_template",
        autoRender: false,
        ...(templateId ? { templateCapsuleId: templateId } : {}),
        aigcGapFill: aigcOn ? { mode: "auto_on", imageFill, audioFill, textFill } : { mode: "off", imageFill: "off", audioFill: "off", textFill: "off" }
      };
      setStage("generate", 1, 3, "生成基础版本");
      const base = await api<GenResult>("/api/v5/generations", {
        method: "POST",
        body: JSON.stringify({
          projectId: "proj_v5_ui",
          brief: { theme, targetDurationSec: 16, aspectRatio: "9:16", sellingPoints: sellingArr },
          targetAssetIds: targetIds,
          ...(Object.keys(slotAssignments).length ? { slotAssignments } : {}),
          options: baseOptions
        })
      });
      setStage("generate", 2, 3, "按自定义需求改写并渲染");
      const res = await api<GenResult>(`/api/v5/generations/${base.generationId}/revise-natural-language`, {
        method: "POST",
        body: JSON.stringify({ projectId: "proj_v5_ui", instruction: instr })
      });
      setResult(res);
      setVariants([]);
      setStage("generate", 3, 3, "读取 transfer trace");
      await fetchTrace(res.generationId);
    });

  // "Start from this template" CTA — pick a learned capsule and jump to same_template generate.
  const startFromTemplate = (t: TemplateMeta) => {
    setGenMode("same_template");
    setTemplateId(t.id);
    setResult(null);
    document.getElementById("v5-generate")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const trackPointerGlow = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--v5-mx", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--v5-my", `${event.clientY - rect.top}px`);
  };

  return (
    <div className="v5-shell" onPointerMove={trackPointerGlow} style={{ minHeight: "100vh", color: "#e6edf6", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div className="v5-shell-inner" style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, lineHeight: 1.25, color: "#f7fbff" }}>爆款结构迁移创作引擎</h1>
          <div style={{ marginTop: 5, color: muted, fontSize: 12 }}>样例理解 → 结构抽取 → 缺口补全 → 同模板生成 / 多版本对比</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ ...tag, background: serviceOk ? "#16321f" : "#3a2030", color: serviceOk ? "#7fdca0" : "#ffb3bf", marginRight: 0 }}>
            API {serviceOk ? "ready" : "check"}
          </span>
        </div>
      </header>

      {!reviewMode && (
        <section style={{ ...card, padding: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8 }}>
            <label style={panel} title="学习时用真 Gemini 重写模板 TSX（三重门）+ 学习期渲染验证；关掉则用确定性胶囊">
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 650, fontSize: 12 }}>
                <input type="checkbox" className="v5-checkbox" style={checkboxStyle} checked={aiCapsule} onChange={(e) => setAiCapsule(e.target.checked)} /> AI 代码胶囊
              </span>
              <span style={{ display: "block", marginTop: 4, color: muted, lineHeight: 1.35, fontSize: 11 }}>学习期生成可复用 Remotion 模板代码。</span>
            </label>
            <label style={panel}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 650, fontSize: 12 }}>
                <input type="checkbox" className="v5-checkbox" style={checkboxStyle} checked={useAi} onChange={(e) => setUseAi(e.target.checked)} /> AI Gen1/Gen2
              </span>
              <span style={{ display: "block", marginTop: 4, color: muted, lineHeight: 1.35, fontSize: 11 }}>Gen1 理解样本结构；Gen2 改写 recipe/文案。</span>
            </label>
            <label style={panel}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 650, fontSize: 12 }}>
                <input type="checkbox" className="v5-checkbox" style={checkboxStyle} checked={autoRender} onChange={(e) => setAutoRender(e.target.checked)} /> render final.mp4
              </span>
              <span style={{ display: "block", marginTop: 4, color: muted, lineHeight: 1.35, fontSize: 11 }}>生成后立即渲染成可播放 MP4。</span>
            </label>
          </div>
        </section>
      )}

      <section style={{ ...card, position: "sticky", top: 0, zIndex: 3, background: "rgba(12, 18, 28, 0.82)", boxShadow: "0 18px 48px rgba(0,0,0,0.32)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
          {flowSteps.map((step, index) => (
            <div key={step.label} style={{ ...miniPanel, borderColor: step.status === "done" ? "#1f9d55" : step.status === "active" ? accent : "rgba(148, 163, 184, 0.16)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <strong style={{ fontSize: 13 }}>{index + 1}. {step.label}</strong>
                <span style={{ ...tag, marginRight: 0, background: step.status === "done" ? "#16321f" : step.status === "active" ? accentSoft : darkControl, color: step.status === "done" ? "#7fdca0" : step.status === "active" ? "#b8f4ff" : "#9fb3d1" }}>{step.status}</span>
              </div>
              <div style={{ marginTop: 5, color: muted, fontSize: 11 }}>{step.detail}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 11, color: muted }}>
          <span>模型: {serviceStatus?.health?.mode ?? "unknown"}</span>
          <span>当前模板: {activeTemplate?.name ?? "未选择"}</span>
          <span>版本: {generateAllVariants ? "3 variants" : selectedVariantMeta?.label ?? "默认"}</span>
          <span>检查: {serviceStatus?.checkedAt ?? "not yet"}</span>
        </div>
      </section>

      {err && (
        <div style={{ ...card, borderColor: "#d6324a", background: "#22141a", color: "#ffb3bf" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <strong>服务连接或请求失败</strong>
              <div style={{ marginTop: 4, fontSize: 12 }}>{err}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...btn, background: "#d6324a" }} onClick={() => retryDashboard()}>重试</button>
              <button style={{ ...btn, background: darkControl }} onClick={() => setDiagnosticsOpen((v) => !v)}>{diagnosticsOpen ? "收起详情" : "诊断详情"}</button>
            </div>
          </div>
          {diagnosticsOpen && (
            <div style={{ marginTop: 12, ...miniPanel, color: "#9fb3d1", fontSize: 12 }}>
              <div>API base: {API || "(same origin)"}</div>
              <div>/healthz: {serviceStatus?.health?.ok ? "ok" : serviceStatus?.health?.detail ?? "unknown"}</div>
              <div>/readyz: {serviceStatus?.ready?.ok ? "ok" : serviceStatus?.ready?.detail ?? "unknown"}</div>
              {serviceStatus?.health?.adapters && <div>adapters: {Object.entries(serviceStatus.health.adapters).map(([k, v]) => `${k}=${v}`).join(", ")}</div>}
            </div>
          )}
        </div>
      )}
      {busy && progress && (
        <div style={{ ...card, padding: 12, borderColor: accent, background: "rgba(8, 22, 35, 0.86)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, marginBottom: 8 }}>
            <strong>{progressLabelFor(progress.label)}</strong>
            <span style={{ color: "#9fb3d1" }}>{progress.step}/{progress.total} · {progress.detail}</span>
          </div>
          <div style={{ height: 7, borderRadius: 99, background: darkControl, overflow: "hidden" }}>
            <div style={{ width: `${progressPercent}%`, height: "100%", borderRadius: 99, background: accentGradient, transition: "width 180ms ease" }} />
          </div>
        </div>
      )}

      <section style={card}>
        <h2 style={sectionTitle}>0 · Upload — 样本与目标素材</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
          <label style={{ border: "1px solid #262a33", borderRadius: 8, padding: 12, background: "#0f1117", fontSize: 13 }}>
            上传样本视频
            <input className="v5-file-input" style={{ display: "block", marginTop: 8, width: "100%" }} type="file" accept="video/mp4,video/quicktime,video/*" disabled={!!busy} onChange={(event) => uploadAssets(event.target.files, "example_video")} />
          </label>
          <label style={{ border: "1px solid #262a33", borderRadius: 8, padding: 12, background: "#0f1117", fontSize: 13 }}>
            上传目标图片 / 视频素材
            <input className="v5-file-input" style={{ display: "block", marginTop: 8, width: "100%" }} type="file" multiple accept="image/*,video/*,.gif" disabled={!!busy} onChange={(event) => uploadAssets(event.target.files, "user_image")} />
          </label>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "#7c8aa0" }}>{assets.length} 个素材已登记{busy === "upload" ? " · 上传中…" : ""}</div>
      </section>

      {/* 1. Learn */}
      <section style={card}>
        <h2 style={sectionTitle}>1 · Learn — 选择样本视频</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {videoAssets.length === 0 && <span style={{ color: "#7c8aa0" }}>没有可用样本视频（先在 V4 上传，或确认 /api/v5/assets）。</span>}
          {videoAssets.map((a) => (
            <button key={a.id} onClick={() => toggle(sampleIds, setSampleIds, a.id)} style={{ ...tag, cursor: "pointer", background: sampleIds.includes(a.id) ? accentGradient : darkControl, color: sampleIds.includes(a.id) ? "#fff" : "#9fb3d1", padding: "6px 10px" }}>
              {a.filename}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <button style={{ ...btn, opacity: sampleIds.length && !busy ? 1 : 0.5 }} disabled={!sampleIds.length || !!busy} onClick={learn}>
            {busy === "learn" ? "学习中…" : `Learn ${sampleIds.length} 个样本`}
          </button>
          <button style={{ ...btn, marginLeft: 8, background: darkControl, opacity: sampleIds.length && !busy ? 1 : 0.5 }} disabled={!sampleIds.length || !!busy} onClick={() => loadSampleReports()}>
            {sampleReportsLoading ? "读取报告中…" : "读取结构学习报告"}
          </button>
        </div>
        {log.length > 0 && <pre style={{ marginTop: 12, color: "#9fb3d1", fontSize: 12, whiteSpace: "pre-wrap" }}>{log.join("\n")}</pre>}
        {selectedReports.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>结构学习报告</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
              {selectedReports.map((report) => {
                const ev = report.evidence;
                const rec = report.reconstruction;
                const firstFrame = publicRef(ev?.keyFrames?.find((frame) => frame.frameRef)?.frameRef);
                const candidates = report.elements?.candidates ?? [];
                const decisions = report.elements?.decisions ?? [];
                return (
                  <div key={report.assetId} style={panel}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                      <strong style={{ fontSize: 13 }}>{videoAssets.find((a) => a.id === report.assetId)?.filename ?? report.assetId}</strong>
                      <span style={{ ...tag, marginRight: 0 }}>{ev ? "evidence" : "pending"}</span>
                    </div>
                    {firstFrame && <img src={firstFrame} alt="sample key frame" style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 8, background: "#000", marginBottom: 8 }} />}
                    {report.error && <div style={{ color: "#ffce7a", fontSize: 12 }}>{report.error}</div>}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, fontSize: 11 }}>
                      <div style={miniPanel}>时长<br /><b>{fixed(ev?.video?.durationSec)}s</b></div>
                      <div style={miniPanel}>镜头数<br /><b>{ev?.shots?.length ?? 0}</b></div>
                      <div style={miniPanel}>BPM<br /><b>{fixed(ev?.audioEvidence?.bpm, 0)}</b></div>
                      <div style={miniPanel}>字幕/OCR<br /><b>{ev?.textEvidence?.length ?? 0}</b></div>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 12, color: "#9fb3d1" }}>
                      Hook/结构：{short(rec?.typedSpec?.scenes?.[0]?.intent ?? ev?.shots?.[0]?.summary ?? "尚无结构摘要", 120)}
                    </div>
                    <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                      <span style={tag}>cut {ev?.motionEvidence?.cutDensity ?? "n/a"}</span>
                      <span style={tag}>beats {ev?.audioEvidence?.beatGridSec?.length ?? 0}</span>
                      <span style={tag}>placeholders {rec?.placeholders?.length ?? 0}</span>
                      <span style={tag}>KB decisions {decisions.length}</span>
                    </div>
                    {candidates.length > 0 && (
                      <div style={{ marginTop: 8, fontSize: 11, color: muted }}>
                        learned: {candidates.slice(0, 4).map((c) => c.kind ?? c.proposedName ?? c.id).join(" / ")}
                      </div>
                    )}
                    {rec?.reconstructionQuality && (
                      <div style={{ marginTop: 8, fontSize: 11, color: muted }}>
                        coverage: structure {percent(rec.reconstructionQuality.structureCoverage)} · timing {percent(rec.reconstructionQuality.timingCoverage)} · placeholders {percent(rec.reconstructionQuality.placeholderCoverage)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* 1.5 Template library — learned capsules with a primary "Start from this template" CTA. */}
      {templates.length > 0 && (
        <section style={card}>
          <h2 style={sectionTitle}>模板库 — {templates.length} 个可复用 Remotion 模板</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {templates.map((t) => (
              <div key={t.id} style={{ border: `1px solid ${templateId === t.id ? accent : "rgba(148, 163, 184, 0.16)"}`, borderRadius: 8, padding: 12, background: templateId === t.id ? accentSoft : "rgba(11, 18, 32, 0.62)" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{tplLabel(t)}</div>
                <div style={{ fontSize: 11, color: "#7c8aa0", margin: "4px 0 8px" }}>
                  {t.slotSchema.length} 槽位 · {t.slotSchema.filter((s) => s.required).length} 必填 · {Math.round((t.timingSignature?.durationSec ?? 0))}s · src={t.sourceSampleId.slice(0, 8)}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                  {t.quality?.compilePassed && <span style={{ ...tag, background: "#16321f", color: "#7fdca0" }}>compiles ✓</span>}
                  {t.quality?.renderPreviewPassed && <span style={{ ...tag, background: "#16321f", color: "#7fdca0" }}>renders ✓</span>}
                  {t.quality?.noCopyTemplatePassed && <span style={{ ...tag, background: "#16321f", color: "#7fdca0" }}>no-copy ✓</span>}
                </div>
                <button style={{ ...btn, width: "100%" }} onClick={() => startFromTemplate(t)}>▶ 用此模板生成</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={card}>
        <h2 style={{ ...sectionTitle, display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }} onClick={() => setKbExplorerCollapsed((v) => !v)} title={kbExplorerCollapsed ? "展开知识库" : "收起知识库"}>
          <span style={triangleBtn}>{kbExplorerCollapsed ? "▸" : "▾"}</span>
          Knowledge Base — {kbFiltered.length}/{kb.length} 条可复用知识
        </h2>
        {kbExplorerCollapsed ? null : (
        <>
        <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
          {[
            ["structure", "结构视图"],
            ["scene", "场景视图"],
            ["source", "来源视图"]
          ].map(([value, label]) => (
            <button
              key={value}
              style={{ ...btn, background: kbView === value ? accentGradient : darkControl, color: kbView === value ? "#fff" : "#9fb3d1" }}
              onClick={() => setKbView(value as KbView)}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "#7c8aa0", marginBottom: 12, lineHeight: 1.4 }}>{KB_VIEW_INFO[kbView] ?? ""}</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <input value={kbQuery} onChange={(e) => setKbQuery(e.target.value)} placeholder="搜索 hook / rhythm / slot / audio / remotion" style={{ flex: 1, padding: 8, background: "rgba(11, 18, 32, 0.76)", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 6, color: "#e6edf6" }} />
          <select
            value={kbKind}
            onChange={(e) => setKbKind(e.target.value)}
            style={{ minWidth: 170, padding: 8, background: "rgba(11, 18, 32, 0.76)", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 6, color: "#e6edf6" }}
          >
            <option value="all">全部 kind</option>
            {kbKindOptions.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </select>
          <button style={btn} disabled={!!busy} onClick={() => refreshKb()}>搜索</button>
        </div>
        <div style={{ display: "grid", gap: 14 }}>
          {kbGroups.map((group) => (
            <div key={group.category}>
              <div style={{ fontSize: 12, color: "#9fb3d1", marginBottom: 8, fontWeight: 650, ...wrapText }}>{group.category} · {group.elements.length}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
                {group.elements.map((e) => (
                  <div key={e.id} style={{ border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: 8, padding: 10, background: "rgba(11, 18, 32, 0.62)", minWidth: 0, overflow: "hidden" }}>
                    <div style={{ fontSize: 13, fontWeight: 650, lineHeight: 1.25, ...wrapText }}>{e.name}</div>
                    <div style={{ marginTop: 5 }}>
                      <span style={tag}>{e.kind}</span>
                      {e.subcategory && <span style={tag}>{e.subcategory}</span>}
                      <span style={tag}>{e.reusablePolicy}</span>
                      <span style={tag}>{kbStatusFor(e)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#9fb3d1", marginTop: 7, lineHeight: 1.35, ...wrapText }}>{short(e.description, 110)}</div>
                    <div style={{ fontSize: 10, color: "#54607a", marginTop: 7, lineHeight: 1.3, ...wrapText }}>src={e.source.sourceSampleId.slice(0, 10)} · evidence={(e.source.evidenceRefs ?? []).slice(0, 2).join(", ") || "n/a"}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {kb.length === 0 && <span style={{ color: "#7c8aa0", fontSize: 12 }}>还没有 KB 元素 — 先 Learn 一个样本。</span>}
          {kb.length > 0 && kbFiltered.length === 0 && <span style={{ color: "#7c8aa0", fontSize: 12 }}>当前过滤条件下没有 KB 元素。</span>}
        </div>
        </>
        )}
      </section>

      {/* 2. Template + theme + AIGC gap fill (the DEFAULT same-template flow) */}
      <section id="v5-generate" style={card}>
        <h2 style={sectionTitle}>2 · Generate — 模板 + 主题 + 自动补全</h2>

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 8, width: "min(100%, 920px)", margin: "0 auto 14px" }}>
          <button
            onClick={() => setGenMode("same_template")}
            style={{ ...btn, background: genMode === "same_template" ? accentGradient : darkControl, color: genMode === "same_template" ? "#fff" : "#9fb3d1", flex: 1, textAlign: "left" }}
          >
            ▸ 用同一个模板 <span style={{ fontWeight: 400, fontSize: 12, opacity: 0.85 }}>（复用样本的运动模板 + 新主题，默认）</span>
          </button>
          <button
            onClick={() => setGenMode("mix_elements")}
            style={{ ...btn, background: genMode === "mix_elements" ? accentGradient : darkControl, color: genMode === "mix_elements" ? "#fff" : "#9fb3d1", flex: 1, textAlign: "left" }}
          >
            ▸ 混合多视频元素 <span style={{ fontWeight: 400, fontSize: 12, opacity: 0.85 }}>（进阶：跨多个样例拆解 hook / 节奏 / 转场 / CTA 等元素，重组成全新结构，而非照搬单个模板）</span>
          </button>
        </div>

        {genMode === "same_template" && (
          <div style={{ display: "grid", gap: 12, width: "min(100%, 720px)", margin: "0 auto" }}>
            {/* Template selector */}
            <label style={{ fontSize: 13 }}>模板胶囊
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                style={{ width: "100%", marginTop: 4, padding: 8, background: "rgba(11, 18, 32, 0.76)", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 6, color: "#e6edf6" }}
              >
                <option value="">最新学习的模板{activeTemplate ? `（${tplLabel(activeTemplate)}）` : ""}</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{tplLabel(t)} · {t.slotSchema.length} slots</option>
                ))}
              </select>
            </label>
            {templates.length === 0 && <span style={{ color: "#7c8aa0", fontSize: 12 }}>还没有模板胶囊 — 先在上面 Learn 一个样本视频。</span>}

            {/* Slot schema */}
            {activeTemplate && (
              <div>
                <div style={{ fontSize: 13, marginBottom: 6 }}>
                  Slot schema — {activeTemplate.slotSchema.length} 个槽位（<b>{requiredSlots.length}</b> 必填）
                  {activeTemplate.quality?.compilePassed === false && <span style={{ ...tag, background: "#3a2030", color: "#ffb3bf", marginLeft: 8 }}>编译未通过</span>}
                  {activeTemplate.quality?.noCopyTemplatePassed && <span style={{ ...tag, background: "#16321f", color: "#7fdca0", marginLeft: 8 }}>no-copy ✓</span>}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {activeTemplate.slotSchema.map((s) => (
                    <span key={s.id} title={`${s.originalRole} · ${s.replacementPolicy} · ${s.propPath ?? ""}`} style={{ ...tag, background: s.required ? accentSoft : darkControl, color: s.required ? "#b8f4ff" : "#9fb3d1", border: s.required ? `1px solid ${accent}` : "1px solid rgba(148, 163, 184, 0.16)" }}>
                      {s.kind}{s.required ? " *" : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <label style={{ fontSize: 13 }}>新主题<input value={theme} onChange={(e) => setTheme(e.target.value)} style={{ width: "100%", marginTop: 4, padding: 8, background: "rgba(11, 18, 32, 0.76)", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 6, color: "#e6edf6" }} /></label>
            <label style={{ fontSize: 13 }}>卖点（逗号分隔）<input value={sellingPoints} onChange={(e) => setSellingPoints(e.target.value)} style={{ width: "100%", marginTop: 4, padding: 8, background: "rgba(11, 18, 32, 0.76)", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 6, color: "#e6edf6" }} /></label>
            <div style={{ fontSize: 13 }}>你的目标素材（可选，没有就让 AI 补全）：
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                {targetAssets.length === 0 && <span style={{ color: "#7c8aa0", fontSize: 12 }}>没有目标素材 — AI 将补全所有必填槽位。</span>}
                {targetAssets.map((a) => (
                  <button key={a.id} onClick={() => toggle(targetIds, setTargetIds, a.id)} style={{ ...tag, cursor: "pointer", background: targetIds.includes(a.id) ? accentGradient : darkControl, color: targetIds.includes(a.id) ? "#fff" : "#9fb3d1", padding: "6px 10px" }}>{a.filename}</button>
                ))}
              </div>
            </div>

            {activeTemplate && (
              <div style={panel}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <strong style={{ fontSize: 13 }}>素材缺口雷达</strong>
                    <div style={{ color: muted, fontSize: 11, marginTop: 3 }}>生成前显示槽位需求；生成后用真实 slot mapping / gap report 更新。每行可直接上传你自己的素材，绑定到该槽位。</div>
                  </div>
                  <span style={{ ...tag, marginRight: 0 }}>{slotRadarRows.filter((r) => r.status === "missing" || r.status === "待补全").length} gaps</span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 800 }}>
                    <thead>
                      <tr style={{ color: muted, textAlign: "left" }}>
                        <th style={{ padding: "6px 8px", borderBottom: "1px solid #262a33" }}>结构槽位</th>
                        <th style={{ padding: "6px 8px", borderBottom: "1px solid #262a33" }}>需要什么</th>
                        <th style={{ padding: "6px 8px", borderBottom: "1px solid #262a33" }}>当前素材匹配</th>
                        <th style={{ padding: "6px 8px", borderBottom: "1px solid #262a33" }}>缺口判断</th>
                        <th style={{ padding: "6px 8px", borderBottom: "1px solid #262a33" }}>补全策略</th>
                        <th style={{ padding: "6px 8px", borderBottom: "1px solid #262a33" }}>上传素材</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slotRadarRows.map((row) => {
                        const assignedId = slotAssignments[row.slot.id];
                        const assignedName = assignedId ? assets.find((a) => a.id === assignedId)?.filename ?? "已上传" : null;
                        return (
                          <tr key={row.slot.id}>
                            <td style={{ padding: "7px 8px", borderBottom: "1px solid #1d2430", fontWeight: 650 }}>{row.slot.originalRole || row.slot.id}</td>
                            <td style={{ padding: "7px 8px", borderBottom: "1px solid #1d2430", color: "#9fb3d1" }}>{row.slot.kind}{row.slot.required ? " · required" : " · optional"}</td>
                            <td style={{ padding: "7px 8px", borderBottom: "1px solid #1d2430", color: assignedName ? "#7fdca0" : "#9fb3d1", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{assignedName ?? row.asset}</td>
                            <td style={{ padding: "7px 8px", borderBottom: "1px solid #1d2430" }}>
                              <span style={{ ...tag, background: assignedName ? "#16321f" : statusColor(row.status), color: assignedName ? "#7fdca0" : "#fff", marginRight: 0 }}>{assignedName ? "已上传素材" : row.status}</span>
                            </td>
                            <td style={{ padding: "7px 8px", borderBottom: "1px solid #1d2430", color: "#9fb3d1" }}>{assignedName ? "user_asset" : row.fill}</td>
                            <td style={{ padding: "7px 8px", borderBottom: "1px solid #1d2430" }}>
                              {assignedName ? (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ color: "#7fdca0", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{assignedName}</span>
                                  <button onClick={() => clearSlotAsset(row.slot.id)} disabled={!!busy} title="移除" style={{ background: "none", border: 0, color: "#ff9bb0", cursor: busy ? "default" : "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                                </span>
                              ) : (
                                <label style={{ ...tag, marginRight: 0, cursor: busy ? "default" : "pointer", background: darkControl, color: "#9fb3d1", opacity: busy ? 0.5 : 1 }}>
                                  ＋ 上传
                                  <input type="file" accept="image/*,video/*" disabled={!!busy} style={{ display: "none" }} onChange={(e) => assignSlotAsset(row.slot.id, e.target.files)} />
                                </label>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* AIGC gap fill toggle (default ON) */}
            <div style={{ border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: 8, padding: 12, background: "rgba(11, 18, 32, 0.62)" }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" className="v5-checkbox" style={checkboxStyle} checked={aigcOn} onChange={(e) => setAigcOn(e.target.checked)} />
                  用 AI 自动补全缺失的画面 / 文案 / 音频
                </span>
                <span style={{ ...tag, background: aigcOn ? "#16321f" : "#3a2030", color: aigcOn ? "#7fdca0" : "#ffb3bf" }}>{aigcOn ? "ON" : "OFF"}</span>
              </label>

              {aigcOn && (
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => setShowAdvanced((v) => !v)} style={{ background: "none", border: 0, color: "#7c8aa0", fontSize: 12, cursor: "pointer", padding: 0 }}>
                    {showAdvanced ? "▾ 收起高级补全选项" : "▸ 高级补全选项"}
                  </button>
                  {showAdvanced && (
                    <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12, color: "#9fb3d1", flexWrap: "wrap" }}>
                      <label>画面 <select value={imageFill} onChange={(e) => setImageFill(e.target.value as typeof imageFill)} style={{ background: "#0f1117", border: "1px solid #262a33", borderRadius: 6, color: "#e6edf6", padding: "2px 6px" }}><option value="aigc">AIGC 生成</option><option value="procedural">程序化设计卡</option><option value="off">关闭</option></select></label>
                      <label>文案 <select value={textFill} onChange={(e) => setTextFill(e.target.value as typeof textFill)} style={{ background: "#0f1117", border: "1px solid #262a33", borderRadius: 6, color: "#e6edf6", padding: "2px 6px" }}><option value="llm">LLM 文案</option><option value="brief">直接用 brief</option><option value="off">关闭</option></select></label>
                      <label>音频 <select value={audioFill} onChange={(e) => setAudioFill(e.target.value as typeof audioFill)} style={{ background: "#0f1117", border: "1px solid #262a33", borderRadius: 6, color: "#e6edf6", padding: "2px 6px" }}><option value="aigc">Google Lyria</option><option value="procedural">程序化节拍床</option><option value="off">关闭</option></select></label>
                    </div>
                  )}
                </div>
              )}

              {!aigcOn && missingRequired > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#ffce7a", background: "#3a2f12", border: "1px solid #6b541a", borderRadius: 6, padding: "8px 10px" }}>
                  ⚠ 这个模板有 {requiredSlots.length} 个必填槽位，你只提供了 {providedCount} 个素材。关闭 AI 补全可能生成不完整的视频，成片就绪度会被降级为 technical_demo。
                </div>
              )}
            </div>

            <div style={{ border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: 8, padding: 12, background: "rgba(11, 18, 32, 0.62)" }}>
              <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 8 }}>生成版本</div>

              <div style={{ fontSize: 12, color: "#9fb3d1", fontWeight: 600, marginBottom: 6 }}>预设调整模板</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {creativeVariants.map((variant) => (
                  <button
                    key={variant.value}
                    disabled={!!busy || generateAllVariants}
                    title="再次点击可取消选择（使用中性默认）"
                    onClick={() => setSelectedVariant((cur) => (cur === variant.value ? null : variant.value))}
                    style={{
                      ...btn,
                      gap: 8,
                      alignItems: "baseline",
                      lineHeight: 1.2,
                      background: selectedVariant === variant.value && !generateAllVariants ? accentGradient : darkControl,
                      color: selectedVariant === variant.value && !generateAllVariants ? "#fff" : "#9fb3d1",
                      opacity: generateAllVariants ? 0.55 : 1
                    }}
                  >
                    <span style={{ fontWeight: 650 }}>{variant.label}</span>
                    <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.7 }}>{variant.en}</span>
                  </button>
                ))}
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 10, width: "fit-content", fontSize: 12, color: "#9fb3d1", border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: 6, padding: "6px 8px", background: "rgba(17, 24, 39, 0.72)" }}>
                <input type="checkbox" className="v5-checkbox" style={checkboxStyle} checked={generateAllVariants} disabled={!!busy} onChange={(e) => setGenerateAllVariants(e.target.checked)} />
                一次生成三个预设版本（高点击 / 高转化 / 高质感）
              </label>
              <div style={{ fontSize: 11, color: "#7c8aa0", marginTop: 6 }}>
                {generateAllVariants ? "会连续生成 3 个版本，并在 Variant Gallery 中对比。" : selectedVariantMeta?.description ?? "未选预设：使用中性默认（不套用预设旋钮）。再次点击已选按钮可取消选择。"}
              </div>

              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(148, 163, 184, 0.14)" }}>
                <div style={{ fontSize: 12, color: "#9fb3d1", fontWeight: 600, marginBottom: 4 }}>自定义需求（自然语言）</div>
                <div style={{ fontSize: 11, color: "#7c8aa0", marginBottom: 6 }}>不想用预设？直接描述你想要的版本，AI 会解析成节奏 / 文案密度 / 配色 / CTA 等调整后生成。</div>
                <textarea
                  value={customRequest}
                  onChange={(e) => setCustomRequest(e.target.value)}
                  disabled={!!busy}
                  rows={2}
                  placeholder="例如：开头三秒更抓人，字幕更少，配色更高级，把 CTA 提前"
                  style={{ width: "100%", boxSizing: "border-box", background: "rgba(17, 24, 39, 0.72)", color: "#e6edf6", border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: 6, padding: 8, fontSize: 12, resize: "vertical" }}
                />
                <button
                  onClick={generateCustom}
                  disabled={!customRequest.trim() || (!templates.length && !templateId) || !!busy}
                  style={{ ...btn, marginTop: 8, width: "fit-content", opacity: customRequest.trim() && (templates.length || templateId) && !busy ? 1 : 0.5 }}
                >
                  {busy === "generate" ? "生成中…" : "按自定义需求生成"}
                </button>
              </div>
            </div>

            <button style={{ ...btn, opacity: (templates.length || templateId) && !busy ? 1 : 0.5 }} disabled={(!templates.length && !templateId) || !!busy} onClick={generateAllVariants ? generateVariants : generate}>
              {busy === "generate"
                ? "生成中…（含渲染可能数十秒）"
                : busy === "variants"
                  ? "生成三版本中…"
                  : generateAllVariants
                    ? "用此模板生成 3 个版本"
                    : `用此模板生成视频 · ${selectedVariantMeta?.label ?? "默认"}`}
            </button>
          </div>
        )}

        {genMode === "mix_elements" && (
          <div style={{ display: "grid", gap: 12, width: "min(100%, 720px)", margin: "0 auto" }}>
            <div style={{ fontSize: 12, color: "#7c8aa0" }}>高级模式：从知识库挑选原子元素（hook / 节奏 / 排版 / 转场 / CTA …）组合成新结构。</div>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: 8, padding: 10, background: "rgba(11, 18, 32, 0.62)" }}>
              <input type="checkbox" className="v5-checkbox" style={checkboxStyle} checked={gen2RemotionCodegen} onChange={(e) => setGen2RemotionCodegen(e.target.checked)} />
              <span>让 AI 现场编写动画代码 <span style={{ fontWeight: 400, fontSize: 11, color: "#7c8aa0" }}>（实验性：更灵活但更慢；关闭则用现成模板拼装）</span></span>
              <span style={{ ...tag, background: gen2RemotionCodegen ? "#16321f" : darkControl, color: gen2RemotionCodegen ? "#7fdca0" : "#9fb3d1" }}>{gen2RemotionCodegen ? "ON" : "OFF"}</span>
            </label>
            <div>
              <div onClick={() => setKbCollapsed((v) => !v)} title={kbCollapsed ? "展开" : "收起"} style={{ fontSize: 13, marginBottom: 6, cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={triangleBtn}>{kbCollapsed ? "▸" : "▾"}</span>
                <span>Knowledge Base — {kbFiltered.length}/{kb.length} elements（点选用于合成）</span>
                {kbCollapsed && selectedEls.length > 0 && <span style={{ ...tag, marginRight: 0 }}>已选 {selectedEls.length}</span>}
              </div>
              {!kbCollapsed && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
                  {kbFiltered.map((e) => (
                    <div key={e.id} onClick={() => toggle(selectedEls, setSelectedEls, e.id)} style={{ border: `1px solid ${selectedEls.includes(e.id) ? accent : "rgba(148, 163, 184, 0.16)"}`, borderRadius: 8, padding: 10, cursor: "pointer", background: selectedEls.includes(e.id) ? accentSoft : "rgba(11, 18, 32, 0.62)", minWidth: 0, overflow: "hidden" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25, ...wrapText }}>{e.name}</div>
                      <div style={{ marginTop: 4 }}><span style={tag}>{kbCategoryFor(e)}</span><span style={tag}>{e.kind}</span><span style={tag}>{e.reusablePolicy}</span></div>
                      <div style={{ fontSize: 11, color: "#7c8aa0", marginTop: 6, lineHeight: 1.35, ...wrapText }}>{e.description.slice(0, 80)}</div>
                    </div>
                  ))}
                  {kbFiltered.length === 0 && <span style={{ color: "#7c8aa0", fontSize: 12 }}>当前过滤条件下没有 KB 元素。</span>}
                </div>
              )}
            </div>
            <label style={{ fontSize: 13 }}>主题<input value={theme} onChange={(e) => setTheme(e.target.value)} style={{ width: "100%", marginTop: 4, padding: 8, background: "rgba(11, 18, 32, 0.76)", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 6, color: "#e6edf6" }} /></label>
            <label style={{ fontSize: 13 }}>卖点（逗号分隔）<input value={sellingPoints} onChange={(e) => setSellingPoints(e.target.value)} style={{ width: "100%", marginTop: 4, padding: 8, background: "rgba(11, 18, 32, 0.76)", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 6, color: "#e6edf6" }} /></label>
            <div style={{ fontSize: 13 }}>目标素材：
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                {targetAssets.map((a) => (
                  <button key={a.id} onClick={() => toggle(targetIds, setTargetIds, a.id)} style={{ ...tag, cursor: "pointer", background: targetIds.includes(a.id) ? accentGradient : darkControl, color: targetIds.includes(a.id) ? "#fff" : "#9fb3d1", padding: "6px 10px" }}>{a.filename}</button>
                ))}
              </div>
            </div>
            <button style={{ ...btn, opacity: kb.length && !busy ? 1 : 0.5 }} disabled={!kb.length || !!busy} onClick={generate}>
              {busy === "generate" ? "生成中…（含渲染可能数十秒）" : "Mix & Generate video"}
            </button>
          </div>
        )}
      </section>

      {variants.length > 0 && (
        <section style={card}>
          <h2 style={sectionTitle}>多版本对比 — {variants.length}/3</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            {variants.map((v) => (
              <div key={v.generationId} style={{ border: "1px solid #262a33", borderRadius: 8, padding: 10, background: "#0f1117" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                  <strong style={{ fontSize: 13 }}>{v.templateInstance?.creativeBrief?.variant ?? v.generationId}</strong>
                  <span style={{ ...tag, marginRight: 0 }}>{v.scorecard.readinessLevel ?? "score"}</span>
                </div>
                {v.finalVideoUrl && <video src={`${API}${v.finalVideoUrl}`} controls style={{ width: "100%", borderRadius: 8, background: "#000" }} />}
                <div style={{ fontSize: 12, color: "#9fb3d1", marginTop: 8 }}>{variantStrategy(v.templateInstance?.creativeBrief?.variant)}</div>
                <div style={{ fontSize: 11, color: "#9fb3d1", marginTop: 8 }}>
                  {v.scorecard.gates.filter((g) => g.status === "pass").length}/{v.scorecard.gates.length} gates · {v.usedTemplateCode ? "template code" : "fallback/plan"}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                  {v.scorecard.rubricCoverage.slice(0, 3).map((r) => <span key={r.rubricItem} style={{ ...tag, background: r.status === "done" ? "#16321f" : "#1d2430", color: r.status === "done" ? "#7fdca0" : "#9fb3d1" }}>{r.rubricItem.replace(/^P\d+\s*/, "")}: {r.status}</span>)}
                </div>
                <button style={{ ...btn, width: "100%", marginTop: 8, background: "#1d2430" }} onClick={() => { setResult(v); fetchTrace(v.generationId).catch(() => undefined); }}>打开此版本</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3. Result */}
      {result && (
        <section style={card}>
          <h2 style={sectionTitle}>
            3 · Result · {result.generationId} · {result.scorecard.demoReady ? <span style={{ color: "#1f9d55" }}>demoReady ✓</span> : <span style={{ color: "#b78a14" }}>not demoReady</span>}
            {result.scorecard.readinessLevel && <span style={{ ...tag, marginLeft: 8 }}>{result.scorecard.readinessLevel}</span>}
            {result.generationMode && <span style={{ ...tag, marginLeft: 4 }}>{result.generationMode}</span>}
            {result.finalProgram?.renderMode && <span style={{ ...tag, marginLeft: 4 }}>{result.finalProgram.renderMode}</span>}
            {result.finalProgram?.fallbackUsed && <span style={{ ...tag, marginLeft: 4, background: "#3a2f12", color: "#ffce7a" }}>fallback</span>}
          </h2>

          {/* same_template provenance badges */}
          {result.generationMode === "same_template" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              <span style={{ ...tag, background: result.usedTemplateCode ? "#16321f" : "#3a2030", color: result.usedTemplateCode ? "#7fdca0" : "#ffb3bf" }}>
                {result.usedTemplateCode ? "✓ 用模板代码渲染 (bespoke_codegen)" : "✗ 未用模板代码"}
              </span>
              {result.usedFallbackRenderer && <span style={{ ...tag, background: "#3a2f12", color: "#ffce7a" }}>fallback renderer</span>}
              {result.templateCapsuleId && <span style={{ ...tag }}>capsule={result.templateCapsuleId.slice(0, 12)}</span>}
            </div>
          )}

          {timelineSections.length > 0 && (
            <div style={{ ...panel, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 10 }}>
                <strong style={{ fontSize: 13 }}>结构时间线</strong>
                <span style={{ ...tag, marginRight: 0 }}>{fixed(timelineDuration)}s</span>
              </div>
              <div style={{ position: "relative", height: 50, borderRadius: 8, background: "#11151d", overflow: "hidden", border: "1px solid #262a33" }}>
                {timelineSections.map((section, index) => {
                  const left = Math.max(0, Math.min(100, (section.startSec / timelineDuration) * 100));
                  const width = Math.max(6, Math.min(100 - left, ((section.endSec - section.startSec) / timelineDuration) * 100));
                  return (
                    <div
                      key={section.id}
                      title={`${section.role} ${section.startSec.toFixed(1)}-${section.endSec.toFixed(1)}s${section.detail ? ` · ${section.detail}` : ""}`}
                      style={{
                        position: "absolute",
                        left: `${left}%`,
                        width: `${width}%`,
                        top: 0,
                        bottom: 0,
                        background: index % 2 ? "#1d2a44" : "#16243f",
                        borderRight: "1px solid #2b6cff",
                        padding: "8px 8px",
                        overflow: "hidden"
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{section.role}</div>
                      <div style={{ color: "#bcd2ff", fontSize: 10 }}>{section.startSec.toFixed(1)}-{section.endSec.toFixed(1)}s</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {trace && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 18 }}>
              <div style={{ border: "1px solid #262a33", borderRadius: 8, padding: 12, background: "#0f1117" }}>
                <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>样例结构</h3>
                {trace.sample.videoUrl && <video src={`${API}${trace.sample.videoUrl}`} controls style={{ width: "100%", maxHeight: 240, borderRadius: 8, background: "#000", marginBottom: 10 }} />}
                <div style={{ fontSize: 12, color: "#9fb3d1", marginBottom: 8 }}>
                  {trace.sample.filename ?? trace.sample.assetId ?? "sample"} · {trace.sample.duration ? `${trace.sample.duration.toFixed(1)}s` : "duration n/a"}
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {(trace.template.knowledgeManifest?.structureHypothesis?.phases ?? []).slice(0, 8).map((p) => (
                    <div key={p.id} style={{ borderLeft: "3px solid #2b6cff", paddingLeft: 8, fontSize: 12 }}>
                      <b>{p.role}</b> {p.startSec.toFixed(1)}-{p.endSec.toFixed(1)}s · {p.beatCount ?? 0} beats
                      <div style={{ color: "#7c8aa0" }}>{short(p.visualMethod || p.intent, 88)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10 }}>
                  {(trace.template.knowledgeManifest?.structureHypothesis?.motionMotifs ?? []).slice(0, 5).map((m) => <span key={m} style={tag}>{m}</span>)}
                  {(trace.template.knowledgeManifest?.structureHypothesis?.transitions ?? []).slice(0, 4).map((m) => <span key={m} style={tag}>{m}</span>)}
                </div>
              </div>

              <div style={{ border: "1px solid #262a33", borderRadius: 8, padding: 12, background: "#0f1117" }}>
                <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>迁移映射</h3>
                <div style={{ display: "grid", gap: 7 }}>
                  {trace.transfer.slotMapping.slice(0, 14).map((m) => (
                    <div key={m.slotId} style={{ border: "1px solid #262a33", borderRadius: 6, padding: 8, fontSize: 12, background: "#11151d" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <b>{m.originalRole ?? m.slotId}</b>
                        <span style={{ ...tag, marginRight: 0, background: m.status === "missing" ? "#3a2030" : m.status === "user_asset" ? "#16321f" : "#16243f" }}>{m.status}</span>
                      </div>
                      <div style={{ color: "#7c8aa0", marginTop: 4 }}>{m.slotKind} · {m.assetId ?? "no asset"}{m.assetProfile?.bestSection ? ` · fit=${m.assetProfile.bestSection}` : ""}</div>
                      <div style={{ color: "#9fb3d1", marginTop: 4 }}>{short(m.fillReason, 120)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10 }}>
                  {trace.transfer.usedKnowledgeElements.slice(0, 8).map((e) => <span key={e.id} title={(e.evidenceRefs ?? []).join(", ")} style={tag}>{e.kind}</span>)}
                </div>
                {(trace.transfer.targetAssetProfiles ?? []).length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>用户素材理解 {trace.transfer.targetAssetProfiles?.some((p) => p.vlmAnalyzed) ? "（VLM 看像素）" : "（启发式）"}</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {(trace.transfer.targetAssetProfiles ?? []).slice(0, 8).map((p) => (
                        <div key={p.assetId} style={{ border: "1px solid #262a33", borderRadius: 6, padding: 7, fontSize: 11, background: "#11151d" }}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            <b>{p.shotType ?? p.kind}</b>
                            {p.sceneType && <span style={tag}>{p.sceneType}</span>}
                            {p.isHighlight && <span style={{ ...tag, background: "#16321f" }}>高光</span>}
                            <span style={{ ...tag, marginRight: 0 }}>→ {p.bestSection}</span>
                          </div>
                          {(p.detectedSubjects?.length ?? 0) > 0 && <div style={{ color: "#7c8aa0", marginTop: 3 }}>{p.detectedSubjects?.slice(0, 6).join(" · ")}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ border: "1px solid #262a33", borderRadius: 8, padding: 12, background: "#0f1117" }}>
                <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>生成结果</h3>
                {trace.result.outputVideoUrl && <video src={`${API}${trace.result.outputVideoUrl}`} controls style={{ width: "100%", maxHeight: 240, borderRadius: 8, background: "#000", marginBottom: 10 }} />}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  <span style={tag}>{trace.template.name ?? trace.template.capsuleId}</span>
                  {trace.template.remotionCodeHash && <span style={tag}>code={trace.template.remotionCodeHash.slice(0, 10)}</span>}
                  <span style={tag}>{trace.transfer.targetBrief?.variant ?? "variant"}</span>
                </div>
                <div style={{ fontSize: 12, color: "#9fb3d1" }}>
                  {(trace.transfer.gapReport?.gaps ?? []).slice(0, 8).map((g) => (
                    <div key={g.slotId}>{g.slotId}: {g.status} → {g.selectedRepair} · impact={g.impact}</div>
                  ))}
                </div>
                {trace.result.scorecard && (
                  <div style={{ marginTop: 10, fontSize: 12, color: "#7c8aa0" }}>
                    scorecard: {trace.result.scorecard.gates.filter((g) => g.status === "pass").length}/{trace.result.scorecard.gates.length} pass · {trace.result.scorecard.readinessLevel ?? "readiness n/a"}
                  </div>
                )}

                {/* v2 evidence artifacts */}
                <div style={{ marginTop: 12, borderTop: "1px solid rgba(148,163,184,0.14)", paddingTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>结构迁移证据 (v2)</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px,1fr))", gap: 10, fontSize: 11, color: "#9fb3d1" }}>
                    {trace.transfer.structureArbitration && (
                      <div style={evCard}>
                        <div style={evHead}>多参考结构仲裁</div>
                        <div>选中: <b style={{ color: "#cfe0f5" }}>{trace.transfer.structureArbitration.selected}</b></div>
                        <div style={{ opacity: 0.85 }}>{trace.transfer.structureArbitration.selection_reason}</div>
                        {(trace.transfer.structureArbitration.borrowed ?? []).map((b, i) => <div key={i}>借用 {b.from}: {b.what}</div>)}
                      </div>
                    )}
                    {trace.transfer.similarityReport && (
                      <div style={evCard}>
                        <div style={evHead}>不复制检查 (similarity)</div>
                        <div>判定 <b style={{ color: trace.transfer.similarityReport.verdict === "pass" ? "#7fdca0" : "#ffb3bf" }}>{trace.transfer.similarityReport.verdict}</b> · copy_risk={trace.transfer.similarityReport.copy_risk_overall}</div>
                        <div style={{ opacity: 0.85 }}>结构复用={String(trace.transfer.similarityReport.structure_reused)} · 文案照搬={String(trace.transfer.similarityReport.wording_reused)}</div>
                      </div>
                    )}
                    {trace.transfer.timeline && (
                      <div style={evCard}>
                        <div style={evHead}>时间线 ({trace.transfer.timeline.duration_sec}s)</div>
                        {(trace.transfer.timeline.tracks?.video ?? []).slice(0, 6).map((v) => <div key={v.segment_id}>{v.start_sec}-{v.end_sec}s · {v.structure_slot} · {v.transform}</div>)}
                      </div>
                    )}
                    {trace.transfer.beatAlignment && (
                      <div style={evCard}>
                        <div style={evHead}>节拍对齐 (bpm {trace.transfer.beatAlignment.bpm ?? "?"})</div>
                        <div>{trace.transfer.beatAlignment.aligned_count}/{trace.transfer.beatAlignment.transition_count} 转场对齐</div>
                        {(trace.transfer.beatAlignment.transitions ?? []).map((tr, i) => <div key={i}>{tr.section}@{tr.at_sec}s off={tr.offset_ms}ms {tr.aligned ? "✓" : "✗"}</div>)}
                      </div>
                    )}
                    {trace.transfer.packagingPlan && (
                      <div style={evCard}>
                        <div style={evHead}>包装 / 字幕安全区</div>
                        <div>字幕 {trace.transfer.packagingPlan.subtitles?.count} 条 · 密度 {trace.transfer.packagingPlan.subtitles?.density} · {trace.transfer.packagingPlan.subtitles?.recommended_font_px}px</div>
                        <div>对比度 {trace.transfer.packagingPlan.subtitles?.contrast_ratio} {trace.transfer.packagingPlan.subtitles?.contrast_ok ? "✓达标" : "⚠不足"}</div>
                      </div>
                    )}
                    {trace.transfer.dialoguePlan && (
                      <div style={evCard}>
                        <div style={evHead}>对话/切点 {trace.transfer.dialoguePlan.has_real_voiceover ? `· ${trace.transfer.dialoguePlan.asr}` : ""}</div>
                        <div>口播={String(trace.transfer.dialoguePlan.has_real_voiceover)} · 安全切点 {(trace.transfer.dialoguePlan.safe_cut_points ?? []).length}</div>
                        {(trace.transfer.dialoguePlan.unsafe_cuts ?? []).slice(0, 2).map((u, i) => <div key={i} style={{ color: "#ffb3bf" }}>⚠ {u.at_sec}s: {u.reason}</div>)}
                      </div>
                    )}
                    {trace.transfer.editTrace && (
                      <div style={evCard}>
                        <div style={evHead}>自然语言改片 diff</div>
                        <div style={{ opacity: 0.85 }}>“{trace.transfer.editTrace.command}”</div>
                        {(trace.transfer.editTrace.changes ?? []).slice(0, 5).map((c, i) => <div key={i}>[{c.operation}] {c.target_segment_id}: {c.reason}</div>)}
                      </div>
                    )}
                    {(trace.transfer.materialAnalysis ?? []).map((ma) => (
                      <div key={ma.asset_id} style={evCard}>
                        <div style={evHead}>素材分析 {ma.asset_id.slice(0, 12)}</div>
                        <div>{ma.type} · {ma.resolution ?? "?"} {ma.duration_sec ? `· ${ma.duration_sec}s` : ""} · audio={String(ma.has_audio)} · q={ma.quality_score}</div>
                        {ma.reject_reason && <div style={{ color: "#ffb3bf" }}>剔除: {ma.reject_reason}</div>}
                        {(ma.crop_suggestions ?? []).map((c, i) => <div key={i}>裁切 {c.aspect}: {c.safe_box}</div>)}
                        {(ma.selected_segments ?? []).map((s, i) => <div key={i}>高光 {s.start_sec}-{s.end_sec}s → {s.recommended_slot} ({s.score})</div>)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* #7 Before / After — sample original ↔ same-template output, side by side */}
          {result.finalVideoUrl && trace?.sample.videoUrl && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>样例原片 ↔ 同模板生成（前后对比）</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#7c8aa0", marginBottom: 4 }}>① 样例原片（学的对象）</div>
                  <video src={`${API}${trace.sample.videoUrl}`} controls style={{ width: "100%", borderRadius: 10, background: "#000" }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#7c8aa0", marginBottom: 4 }}>② 新主题成片（同动效模板）</div>
                  <video src={`${API}${result.finalVideoUrl}`} poster={result.coverUrl ? `${API}${result.coverUrl}` : undefined} controls style={{ width: "100%", borderRadius: 10, background: "#000" }} />
                </div>
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: result.finalVideoUrl ? "320px 1fr" : "1fr", gap: 20 }}>
            {result.finalVideoUrl && (
              <video src={`${API}${result.finalVideoUrl}`} poster={result.coverUrl ? `${API}${result.coverUrl}` : undefined} controls style={{ width: 320, borderRadius: 10, background: "#000" }} />
            )}
            <div>
              {/* same_template: slot bindings + readiness */}
              {result.templateInstance && (
                <>
                  <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Slot bindings ({result.templateInstance.slotBindings.length})</h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                    {result.templateInstance.slotBindings.map((b) => (
                      <span key={b.slotId} title={b.warnings.join("; ")} style={{ ...tag, background: b.status === "missing" || b.status === "unresolved" ? "#3a2030" : b.status.includes("generated") || b.status === "aigc_filled" ? "#16243f" : "#1d2430" }}>
                        {b.slotId}: {b.status}
                      </span>
                    ))}
                  </div>
                  {result.templateInstance.readinessImpact.warnings.length > 0 && (
                    <div style={{ fontSize: 12, color: "#ffce7a", marginBottom: 12 }}>
                      {result.templateInstance.readinessImpact.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                    </div>
                  )}
                </>
              )}

              {/* mix_elements: composition + gap report */}
              {result.composition && (
                <>
                  <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Composition</h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                    {result.composition.sections.map((s) => (
                      <span key={s.id} style={{ ...tag, background: "#1d2430" }}>{s.role} {s.startSec}-{s.endSec}s{s.plannedText ? `: ${s.plannedText}` : ""}</span>
                    ))}
                  </div>
                </>
              )}
              {result.gapReport && (
                <>
                  <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Gap report</h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                    {result.gapReport.gaps.map((g, i) => (
                      <span key={i} style={{ ...tag, background: g.status === "missing" ? "#3a2030" : "#1d2430" }}>{g.slotId}: {g.status}→{g.selectedRepair}</span>
                    ))}
                  </div>
                </>
              )}
              {result.finalProgram?.validation?.warnings?.length ? (
                <div style={{ fontSize: 12, color: "#ffce7a", marginBottom: 12 }}>
                  {result.finalProgram.validation.warnings.slice(0, 4).map((w, i) => <div key={i}>{w}</div>)}
                </div>
              ) : null}

              <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>质量报告</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, marginBottom: 12 }}>
                {qualityGroups.map((group) => (
                  <div key={group.name} style={{ ...miniPanel, borderColor: statusColor(group.status) }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <strong style={{ fontSize: 12 }}>{group.name}</strong>
                      <span style={{ ...tag, marginRight: 0, background: statusColor(group.status), color: "#fff" }}>{group.status}</span>
                    </div>
                    <div style={{ marginTop: 6, color: "#9fb3d1", fontSize: 11 }}>{group.pass} pass / {group.warn} warn / {group.fail} fail</div>
                    <div style={{ marginTop: 5, color: muted, fontSize: 10 }}>{group.picked.slice(0, 2).map((g) => `${g.id}: ${g.message ?? g.name}`).join(" · ") || "未评估"}</div>
                  </div>
                ))}
              </div>
              {result.scorecard.rubricCoverage.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
                  {result.scorecard.rubricCoverage.map((r) => (
                    <span key={r.rubricItem} style={{ ...tag, background: r.status === "done" ? "#16321f" : r.status === "missing" ? "#3a2030" : "#3a2f12", color: r.status === "done" ? "#7fdca0" : r.status === "missing" ? "#ffb3bf" : "#ffce7a" }}>
                      {r.rubricItem}: {r.status}
                    </span>
                  ))}
                </div>
              )}
              {!reviewMode && (
                <>
                  <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Raw Scorecard ({result.scorecard.gates.filter((g) => g.status === "pass").length}/{result.scorecard.gates.length} pass)</h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {result.scorecard.gates.map((g) => (
                      <span key={g.id} title={`${g.name}${g.message ? " — " + g.message : ""}`} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: gateColor(g.status), color: "#fff" }}>{g.id}</span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Revise (modify_template): patch theme / headline and re-render the SAME template, reusing visuals. */}
          {result.templateInstance && (
            <div style={{ marginTop: 16, borderTop: "1px solid #262a33", paddingTop: 14 }}>
              <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>改写这个视频（同模板，复用画面）</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <input value={reviseTheme} onChange={(e) => setReviseTheme(e.target.value)} placeholder="新主题（可选）" style={{ flex: "1 1 220px", padding: 8, background: "#0f1117", border: "1px solid #262a33", borderRadius: 6, color: "#e6edf6" }} />
                <input value={reviseHeadline} onChange={(e) => setReviseHeadline(e.target.value)} placeholder="新主标题文案（可选）" style={{ flex: "1 1 220px", padding: 8, background: "#0f1117", border: "1px solid #262a33", borderRadius: 6, color: "#e6edf6" }} />
                <select value={reviseRhythm} onChange={(e) => setReviseRhythm(e.target.value as typeof reviseRhythm)} title="节奏" style={{ padding: 8, background: "#0f1117", border: "1px solid #262a33", borderRadius: 6, color: "#e6edf6" }}>
                  <option value="">节奏…</option><option value="aggressive">快·冲</option><option value="balanced">均衡</option><option value="slow">慢·高级</option>
                </select>
                <select value={reviseTextDensity} onChange={(e) => setReviseTextDensity(e.target.value as typeof reviseTextDensity)} title="字幕密度" style={{ padding: 8, background: "#0f1117", border: "1px solid #262a33", borderRadius: 6, color: "#e6edf6" }}>
                  <option value="">字幕…</option><option value="dense">密集</option><option value="medium">适中</option><option value="minimal">精简</option>
                </select>
                <select value={revisePaletteMood} onChange={(e) => setRevisePaletteMood(e.target.value as typeof revisePaletteMood)} title="配色风格" style={{ padding: 8, background: "#0f1117", border: "1px solid #262a33", borderRadius: 6, color: "#e6edf6" }}>
                  <option value="">配色…</option><option value="bold">大胆</option><option value="energetic">活力</option><option value="premium">高级</option><option value="clean">干净</option>
                </select>
                <button
                  style={{ ...btn, opacity: (reviseTheme.trim() || reviseHeadline.trim() || reviseRhythm || reviseTextDensity || revisePaletteMood) && !busy ? 1 : 0.5 }}
                  disabled={(!reviseTheme.trim() && !reviseHeadline.trim() && !reviseRhythm && !reviseTextDensity && !revisePaletteMood) || !!busy}
                  onClick={() => revise(result)}
                >
                  {busy === "revise" ? "改写中…" : "改写并重渲染"}
                </button>
              </div>
              <div style={{ fontSize: 11, color: "#7c8aa0", marginTop: 6 }}>theme/文案/配色为 patch-first（复用画面）；节奏/字幕/配色风格会重写文案与包装（同模板、不换画面）。换画面请重新生成。</div>
              <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {["开头更抓人一些", "字幕更少，节奏更快", "CTA 更强，把购买理由提前", "更像原模板的节奏", "画面更干净更高级"].map((instruction) => (
                    <button key={instruction} style={{ ...btn, background: "#1d2430", fontSize: 12, padding: "6px 9px" }} onClick={() => setNlInstruction(instruction)}>
                      {instruction}
                    </button>
                  ))}
                </div>
                <textarea value={nlInstruction} onChange={(e) => setNlInstruction(e.target.value)} rows={2} placeholder="例如：开头更抓人一些，减少字幕，增强节奏感，把商品信息提前" style={{ width: "100%", padding: 8, background: "#0f1117", border: "1px solid #262a33", borderRadius: 6, color: "#e6edf6", resize: "vertical" }} />
                <button style={{ ...btn, width: "fit-content", opacity: nlInstruction.trim() && !busy ? 1 : 0.5 }} disabled={!nlInstruction.trim() || !!busy} onClick={() => reviseNatural(result)}>
                  {busy === "revise-nl" ? "解析并改写中…" : "自然语言改片"}
                </button>
                {(result.generatedPatch || result.patchNotes?.length || result.naturalLanguageInstruction) && (
                  <div style={{ border: "1px solid #262a33", borderRadius: 8, padding: 10, background: "#0f1117", fontSize: 12, color: "#9fb3d1" }}>
                    {result.naturalLanguageInstruction && <div>request: {result.naturalLanguageInstruction}</div>}
                    {result.patchNotes?.map((note, i) => <div key={i}>patch: {note}</div>)}
                    {result.generatedPatch && <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", color: "#7c8aa0" }}>{JSON.stringify(result.generatedPatch, null, 2)}</pre>}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}
      </div>
    </div>
  );
}
