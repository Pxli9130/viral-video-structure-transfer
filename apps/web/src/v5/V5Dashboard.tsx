// apps/web/src/v5/V5Dashboard.tsx
// Self-contained spec_v5 demo dashboard driving /api/v5/*. Mounted via the #v5 hash route so it does
// not touch the V4 App. Flow: pick sample assets -> Learn -> browse KB -> select elements + target
// assets + brief -> Generate -> see composition / gap / scorecard / final video.
import { type PointerEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

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
  const body = (await res.json()) as unknown;
  // V4-style endpoints (/api/projects, /api/projects/:id/assets) wrap the result in an {ok,data} envelope while the
  // /api/v5/* endpoints return the payload bare. Unwrap the envelope when present so callers ALWAYS get the payload
  // (fixes "projects.find is not a function" — /api/projects returns {ok:true,data:[...]}, not a bare array).
  if (body && typeof body === "object" && "ok" in body) {
    const env = body as { ok?: unknown; data?: T; error?: { message?: string } };
    if (env.ok === false) throw new Error(env.error?.message ?? `${path} failed (${res.status})`);
    if (env.ok === true && "data" in env) return env.data as T;
  }
  return body as T;
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type AssetRow = { id: string; role: string; type: string; filename: string; hasPath: boolean; tags: string[]; createdAt?: string };
type ProjectRow = { id: string; name: string };
type ShowcaseArtifact = { id: string; label: string; kind: "video" | "image" | "markdown" | "json"; url: string };
type ShowcaseCase = { id: string; title: string; description: string; tags: string[]; primary?: ShowcaseArtifact; thumbnail?: ShowcaseArtifact; artifacts: ShowcaseArtifact[] };
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
type TemplateSlot = { id: string; kind: string; required: boolean; originalRole: string; replacementPolicy: string; propPath?: string; description?: string; mediaKind?: "image" | "video"; aigcPrompt?: string; motionHint?: string; userAssetSlot?: boolean };
type TemplateMeta = {
  id: string;
  sourceSampleId: string;
  name: string;
  description?: string;
  tags: string[];
  slotSchema: TemplateSlot[];
  timingSignature?: { durationSec?: number; fps?: number; sections?: Array<{ id: string; role: string; startSec: number; endSec: number; internalBeats?: number[] }> };
  motionSignature?: { motifs?: string[]; transitionTypes?: string[]; typographyAnimationTypes?: string[]; beatSyncedCueCount?: number; activeMotionCoverage?: number };
  quality?: { compilePassed?: boolean; renderPreviewPassed?: boolean; noCopyTemplatePassed?: boolean; warnings?: string[] };
  createdAt?: string;
};
type TemplateDetail = TemplateMeta & {
  sceneRecipes?: Array<{ sectionId?: string; role?: string; startSec?: number; endSec?: number; transitionIn?: string; textAnim?: string; confidence?: number; [key: string]: unknown }>;
  assetRecipes?: unknown[];
  audioRecipes?: Array<{ kind?: string; bpm?: number; mood?: string[]; cuePoints?: Array<{ t: number; type: string; role?: string }> }>;
  propsSchema?: unknown;
  codeBundle?: unknown;
  fixtures?: unknown;
  safety?: Record<string, unknown>;
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
  materialAnalysis?: TransferTrace["transfer"]["materialAnalysis"];
  timelineV2?: TransferTrace["transfer"]["timeline"];
  mappingV2?: TransferTrace["transfer"]["mapping"];
  similarityReport?: TransferTrace["transfer"]["similarityReport"];
  packagingPlan?: TransferTrace["transfer"]["packagingPlan"];
  beatAlignment?: TransferTrace["transfer"]["beatAlignment"];
  dialoguePlan?: TransferTrace["transfer"]["dialoguePlan"];
  qualityReport?: unknown;
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
type FlowStatus = "done" | "active" | "ready" | "todo" | "warn";
type KbView = "structure" | "scene" | "source";
type EvidenceTab = "showcase" | "learn" | "protocol" | "gap" | "transfer" | "packaging" | "export";
type LearningTimelineItem = {
  id: string;
  role: string;
  roleZh: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  summary: string;
  transition?: string;
  textAnim?: string;
  camera?: string;
  keyframeUrl?: string;
  ocrTexts: string[];
  beatCount: number;
  shotCount: number;
  sourceLabel?: string;
  evidenceReasons: string[];
  reusableAtoms: string[];
};

const accent = "#00d7ff";
const accentSoft = "#153747";
const accentGradient = "linear-gradient(135deg, #00f2ea 0%, #2f6bff 58%, #ff2d55 126%)";
const darkControl = "#18202d";
const card: React.CSSProperties = { background: "rgba(15, 18, 25, 0.78)", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 8, padding: 20, marginBottom: 20, boxShadow: "0 18px 48px rgba(0, 0, 0, 0.28)" };
const btn: React.CSSProperties = { background: accentGradient, color: "#fff", border: 0, borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontWeight: 700, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08), 0 10px 28px rgba(0, 215, 255, 0.12)" };
const tag: React.CSSProperties = { display: "inline-block", fontSize: 11, padding: "2px 8px", borderRadius: 99, background: "rgba(28, 37, 53, 0.82)", color: "#b8d7ff", marginRight: 6 };
const muted = "#8091ad";
const panel: React.CSSProperties = { border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: 8, padding: 14, background: "rgba(11, 18, 32, 0.62)", minWidth: 0, overflow: "hidden" };
const miniPanel: React.CSSProperties = { border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: 8, padding: 10, background: "rgba(17, 24, 39, 0.68)", minWidth: 0, overflow: "hidden" };
const sectionTitle: React.CSSProperties = { margin: "0 0 14px", fontSize: 16, lineHeight: 1.35, color: "#f7fbff" };
const checkboxStyle: React.CSSProperties = { width: 18, height: 18, margin: 0, flex: "0 0 18px", cursor: "pointer" };
const wrapText: React.CSSProperties = { overflowWrap: "anywhere", wordBreak: "break-word", minWidth: 0 };
const protocolText: React.CSSProperties = { fontSize: 12, lineHeight: 1.42, whiteSpace: "normal", ...wrapText };
const gateColor = (s: string) => (s === "pass" ? "#1f9d55" : s === "fail" ? "#d6324a" : "#b78a14");
const short = (value: string | undefined, n = 96) => (value && value.length > n ? `${value.slice(0, n)}…` : value ?? "");
const safeText = (value: unknown, fallback = "n/a", n = 120): string => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") return short(value, n);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const text = value.map((item) => safeText(item, "", n)).filter(Boolean).join(" / ");
    return short(text || fallback, n);
  }
  try {
    const typed = value as Record<string, unknown>;
    if (typeof typed.type === "string") return short(typed.type, n);
    return fallback;
  } catch {
    return fallback;
  }
};
const fixed = (value: unknown, digits = 1) => (typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "n/a");
const percent = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : "n/a");
const newestFirst = <T,>(items: T[], getCreatedAt?: (item: T) => string | undefined): T[] =>
  items
    .map((item, index) => ({ item, index, time: Date.parse(getCreatedAt?.(item) ?? "") }))
    .sort((a, b) => {
      const aHasTime = Number.isFinite(a.time);
      const bHasTime = Number.isFinite(b.time);
      if (aHasTime && bHasTime && a.time !== b.time) return b.time - a.time;
      if (aHasTime !== bHasTime) return aHasTime ? -1 : 1;
      return b.index - a.index;
    })
    .map(({ item }) => item);
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
const evidenceTabs: Array<{ value: EvidenceTab; label: string; description: string }> = [
  { value: "showcase", label: "Showcase", description: "现有 demo / proof sheet / 多版本成片，给评审快速看结果。" },
  { value: "learn", label: "Learn Analysis", description: "样例基础信息、镜头、OCR/ASR、节奏和关键帧。" },
  { value: "protocol", label: "Structure Protocol", description: "模板胶囊、槽位、场景、运动和安全质量协议。" },
  { value: "gap", label: "Gap Decisions", description: "素材槽位、缺口影响、补全策略和最终绑定。" },
  { value: "transfer", label: "Transfer Map", description: "样例结构到新内容和最终时间线的映射。" },
  { value: "packaging", label: "Packaging", description: "封面、字幕密度、安全区、节拍和包装证据。" },
  { value: "export", label: "Export", description: "下载 trace / gap / timeline / scorecard 等评审证据。" }
];
/** A clearer, larger collapse triangle (the small inline one was hard to hit). */
const triangleBtn: React.CSSProperties = { fontSize: 15, lineHeight: 1, color: "#cfe0f5", background: "rgba(17,24,39,0.85)", borderRadius: 6, padding: "3px 9px", border: "1px solid rgba(148,163,184,0.28)", display: "inline-flex", alignItems: "center" };
const collapsibleTitle: React.CSSProperties = { ...sectionTitle, display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" };
/** Compact card for a v2 evidence artifact. */
const evCard: React.CSSProperties = { border: "1px solid rgba(148,163,184,0.16)", borderRadius: 8, padding: "8px 10px", background: "rgba(11,18,32,0.6)", minWidth: 0, overflow: "hidden", lineHeight: 1.5 };
const evHead: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#cfe0f5", marginBottom: 4 };

function CollapsibleHeader({
  collapsed,
  onToggle,
  children,
  collapsedTitle = "展开",
  expandedTitle = "收起",
  badge
}: {
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  collapsedTitle?: string;
  expandedTitle?: string;
  badge?: ReactNode;
}) {
  return (
    <h2
      role="button"
      aria-expanded={!collapsed}
      tabIndex={0}
      style={{ ...collapsibleTitle, margin: collapsed ? 0 : "0 0 14px" }}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
      title={collapsed ? collapsedTitle : expandedTitle}
    >
      <span style={triangleBtn}>{collapsed ? "▸" : "▾"}</span>
      <span style={{ minWidth: 0, flex: "1 1 auto", ...wrapText }}>{children}</span>
      {badge ? <span style={{ ...tag, marginRight: 0, marginLeft: "auto", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{badge}</span> : null}
    </h2>
  );
}

function LearningTimeline({ items, totalSec }: { items: LearningTimelineItem[]; totalSec: number }) {
  if (!items.length) return null;
  const total = Math.max(1, totalSec, ...items.map((item) => item.endSec));
  const pxPerSec = total > 90 ? 20 : total > 45 ? 26 : 32;
  const timelineWidth = Math.max(860, Math.ceil(total * pxPerSec));
  const tickStep = total > 120 ? 20 : total > 60 ? 10 : 5;
  const ticks = Array.from({ length: Math.floor(total / tickStep) + 1 }, (_, index) => index * tickStep).filter((tick) => tick <= total);
  if (ticks[ticks.length - 1] !== Math.ceil(total)) ticks.push(Math.ceil(total));
  const trackPalette = ["#213a72", "#143d4b", "#3a315f", "#24402e", "#4a2d35"];
  const makeSegment = (item: LearningTimelineItem, label: string, detail = "", colorIndex = 0) => ({
    id: `${item.id}-${label}`,
    startSec: item.startSec,
    endSec: item.endSec,
    label,
    detail,
    color: trackPalette[colorIndex % trackPalette.length]
  });
  const tracks = [
    {
      label: "结构",
      items: items.map((item) => makeSegment(item, item.roleZh, item.summary, 0))
    },
    {
      label: "镜头",
      items: items.map((item, index) => makeSegment(item, item.sourceLabel ?? `镜头 ${index + 1}`, `${fixed(item.durationSec)}s · ${item.shotCount || 1} 个镜头证据`, 1))
    },
    {
      label: "字幕",
      items: items
        .filter((item) => item.ocrTexts.length || item.textAnim)
        .map((item) => makeSegment(item, item.ocrTexts[0] ? `「${short(item.ocrTexts[0], 28)}」` : item.textAnim ?? "字幕节奏", item.textAnim ?? "字幕证据", 2))
    },
    {
      label: "运动",
      items: items
        .filter((item) => item.transition || item.camera)
        .map((item) => makeSegment(item, [item.transition, item.camera].filter(Boolean).join(" / ") || "运动", item.textAnim ?? "", 3))
    },
    {
      label: "音频",
      items: items
        .filter((item) => item.beatCount > 0)
        .map((item) => makeSegment(item, `${item.beatCount} 个节拍`, `${fixed(item.startSec)}-${fixed(item.endSec)}s`, 4))
    }
  ];
  return (
    <div style={{ ...panel, padding: 12, margin: "10px 0", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        <strong style={{ fontSize: 12 }}>多轨结构时间线</strong>
        <span style={{ color: muted, fontSize: 11 }}>镜头 / 字幕 / 运动 / 音频 / 段落对齐；太长可横向滚动</span>
      </div>
      <div style={{ overflowX: "auto", paddingBottom: 8 }}>
        <div style={{ width: timelineWidth, minWidth: "100%" }}>
          <div style={{ position: "relative", height: 22, marginBottom: 6, borderBottom: "1px solid rgba(148,163,184,0.18)" }}>
            {ticks.map((tick) => (
              <div key={tick} style={{ position: "absolute", left: `${Math.min(100, (tick / total) * 100)}%`, top: 0, bottom: -1, borderLeft: "1px solid rgba(148,163,184,0.18)", paddingLeft: 4, color: muted, fontSize: 10 }}>
                {tick}s
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
            {tracks.map((track, trackIndex) => (
              <div key={track.label} style={{ display: "grid", gridTemplateColumns: "72px minmax(0, 1fr)", gap: 8, alignItems: "center" }}>
                <div style={{ color: "#cfe0f5", fontSize: 11, fontWeight: 700 }}>{track.label}</div>
                <div style={{ position: "relative", height: 34, borderRadius: 8, background: "rgba(10, 16, 28, 0.86)", border: "1px solid rgba(148,163,184,0.14)", overflow: "hidden" }}>
                  {track.items.length ? track.items.map((segment, index) => {
                    const left = Math.max(0, Math.min(100, (segment.startSec / total) * 100));
                    const width = Math.max(4, Math.min(100 - left, ((segment.endSec - segment.startSec) / total) * 100));
                    return (
                      <div
                        key={`${segment.id}-${index}`}
                        title={`${track.label} · ${fixed(segment.startSec)}-${fixed(segment.endSec)}s · ${segment.label}${segment.detail ? ` · ${segment.detail}` : ""}`}
                        style={{
                          position: "absolute",
                          left: `${left}%`,
                          width: `${width}%`,
                          top: 4,
                          bottom: 4,
                          borderRadius: 7,
                          background: segment.color,
                          border: "1px solid rgba(255,255,255,0.08)",
                          padding: "4px 7px",
                          color: "#eaf2ff",
                          fontSize: 10,
                          fontWeight: 700,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap"
                        }}
                      >
                        {segment.label}
                      </div>
                    );
                  }) : (
                    <div style={{ color: muted, fontSize: 10, padding: "8px 10px" }}>{trackIndex === 4 ? "未检测到可用节拍 / 音频证据" : "暂无证据"}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div style={{ color: muted, fontSize: 11, margin: "0 0 8px 80px" }}>下方是镜头判定证据：每张卡说明为什么归类，以及哪些创作原子可迁移。</div>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            {items.map((item, index) => {
              const width = Math.max(170, Math.round(item.durationSec * pxPerSec));
              const badges = [
                item.transition ? `转场 ${item.transition}` : "",
                item.textAnim ? `字幕 ${item.textAnim}` : "",
                item.camera ? `镜头 ${item.camera}` : "",
                item.beatCount ? `节拍 ${item.beatCount}` : "",
                item.shotCount ? `镜头 ${item.shotCount}` : "",
                item.ocrTexts.length ? `文字 ${item.ocrTexts.length}` : ""
              ].filter((badge) => badge && !/[{}":]/.test(badge));
              return (
                <div
                  key={`${item.id}-${index}`}
                  title={`${fixed(item.startSec)}-${fixed(item.endSec)}s · ${item.roleZh} · ${item.summary}`}
                  style={{
                    flex: "0 0 auto",
                    width,
                    minHeight: 212,
                    borderRadius: 8,
                    border: "1px solid rgba(148,163,184,0.18)",
                    background: "rgba(17, 24, 39, 0.72)",
                    overflow: "hidden"
                  }}
                  >
                  <div style={{ height: 4, background: index === 0 ? accentGradient : index % 2 ? "#1d2a44" : "#16321f" }} />
                  <div style={{ padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", marginBottom: 7 }}>
                      <b style={{ fontSize: 12 }}>{fixed(item.startSec)}-{fixed(item.endSec)}s</b>
                      <span style={{ ...tag, marginRight: 0, background: index === 0 ? accentSoft : darkControl }}>{item.roleZh}</span>
                    </div>
                    {item.sourceLabel && <div style={{ color: muted, fontSize: 10, marginBottom: 6 }}>{item.sourceLabel}</div>}
                    {item.keyframeUrl ? (
                      <img src={item.keyframeUrl} alt={`${item.roleZh} 关键帧`} style={{ width: "100%", height: 64, objectFit: "cover", borderRadius: 6, background: "#000", marginBottom: 8 }} />
                    ) : (
                      <div style={{ height: 64, borderRadius: 6, background: "rgba(11,18,32,0.9)", marginBottom: 8, display: "grid", placeItems: "center", color: muted, fontSize: 11 }}>无关键帧</div>
                    )}
                    <div style={{ color: "#dbeafe", fontSize: 12, lineHeight: 1.35, minHeight: 48, maxHeight: 66, overflow: "hidden", ...wrapText }}>{item.summary}</div>
                    {item.ocrTexts.length > 0 && (
                      <div style={{ marginTop: 7, color: muted, fontSize: 11, lineHeight: 1.32, maxHeight: 44, overflow: "hidden", ...wrapText }}>
                        文字：{item.ocrTexts.map((text) => short(text, 36)).join(" / ")}
                      </div>
                    )}
                    <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.35 }}>
                      <b style={{ color: "#dbeafe" }}>判定证据</b>
                      <div style={{ color: muted, marginTop: 3, ...wrapText }}>{item.evidenceReasons.slice(0, 3).join("；") || "基于时间段、镜头和模板协议综合判断。"}</div>
                    </div>
                    <div style={{ marginTop: 7, fontSize: 11, lineHeight: 1.35 }}>
                      <b style={{ color: "#dbeafe" }}>可迁移原子</b>
                      <div style={{ color: muted, marginTop: 3, ...wrapText }}>{item.reusableAtoms.slice(0, 3).join(" / ") || "段落节奏 / 版式位置 / 替换槽位"}</div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                      {badges.slice(0, 5).map((badge) => <span key={badge} style={{ ...tag, fontSize: 10, padding: "1px 6px" }}>{badge}</span>)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
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
const absoluteUrl = (ref: string | undefined) => (ref ? publicRef(ref) ?? (/^https?:\/\//.test(ref) ? ref : `${API}${ref.startsWith("/") ? "" : "/"}${ref}`) : undefined);
const fileSummary = (files: File[]) => files.length ? files.map((file) => file.name).join(" / ") : "未选择文件";
const sectionRoleZh = (role: string | undefined) => ({
  hook: "开头钩子",
  setup: "铺垫",
  benefit: "利益点",
  proof: "证明",
  demo: "演示",
  action: "动作推进",
  transition: "转场",
  cta: "行动号召",
  other: "其他"
}[role ?? ""] ?? role ?? "段落");
const slotKindZh = (kind: string | undefined) => ({
  hero_image: "主视觉图",
  product_image: "产品图",
  background_image: "背景图",
  logo: "品牌标识",
  headline: "标题文案",
  subtitle: "副标题/说明",
  cta_text: "CTA 文案",
  voiceover: "旁白",
  music: "音乐",
  sfx: "音效",
  data_value: "数据",
  ui_mockup: "界面样机",
  text: "文字",
  other: "其他"
}[kind ?? ""] ?? kind ?? "槽位");
const targetAssetTypeZh = (type: string | undefined) => ({
  image: "图片",
  video: "视频",
  audio: "音频",
  text: "文本"
}[type ?? ""] ?? type ?? "素材");
const expectedAssetTypeForSlot = (slot: TemplateSlot): "image" | "video" | "audio" | "text" | null => {
  const raw = `${slot.id} ${slot.kind} ${slot.originalRole ?? ""} ${slot.mediaKind ?? ""}`.toLowerCase();
  if (/headline|subtitle|cta_text|data_value|text|copy/.test(slot.kind) || /^copy\./.test(slot.propPath ?? "")) return "text";
  if (/music|sfx|voice|audio/.test(slot.kind)) return "audio";
  if (slot.mediaKind === "video" || /\b(video|clip|footage)\b/.test(raw)) return "video";
  if (/hero_image|product_image|background_image|logo|ui_mockup|image|mockup|media|asset/.test(raw)) return "image";
  return null;
};
const expectedAssetTypeZhForSlot = (slot: TemplateSlot) => {
  const expected = expectedAssetTypeForSlot(slot);
  if (expected === "image") return slot.kind === "logo" ? "Logo/图片" : "图片";
  if (expected === "video") return "视频";
  if (expected === "audio") return "音频";
  if (expected === "text") return "文案";
  return "AI/程序化";
};
const slotUploadAccept = (slot: TemplateSlot) => {
  const expected = expectedAssetTypeForSlot(slot);
  if (expected === "image") return "image/*";
  if (expected === "video") return "video/*";
  if (expected === "audio") return "audio/*";
  return "";
};
const targetAssetCompatibleWithSlot = (slot: TemplateSlot, asset: AssetRow) => {
  const expected = expectedAssetTypeForSlot(slot);
  if (expected === "image") {
    if (asset.type !== "image") return false;
    return slot.kind !== "logo" || /logo/i.test(`${asset.filename} ${(asset.tags ?? []).join(" ")}`);
  }
  if (expected === "video") return asset.type === "video";
  if (expected === "audio") return asset.type === "audio";
  if (expected === "text") return asset.type === "text";
  return false;
};
const replacementZh = (policy: string | undefined) => ({
  user_asset: "用户素材替换",
  aigc_generate: "AIGC 补图/视频",
  text_generate: "LLM 生成文案",
  procedural_generate: "程序化生成",
  optional: "可选"
}[policy ?? ""] ?? policy ?? "n/a");
const tokenZh = (value: unknown, fallback = "") => {
  if (value === undefined || value === null || value === "") return fallback;
  const text = String(value);
  return ({
    none: "无",
    cut: "硬切",
    flash_cut: "闪白切",
    gradient_shift: "渐变切换",
    typewriter: "打字机",
    replace: "短语替换",
    pop_and_slide: "弹出滑入",
    word_stagger: "逐词错落",
    beat_pop: "节拍弹出",
    slow_push: "缓慢推进",
    impact_zoom: "冲击变焦",
    center: "主体居中",
    top_left: "左上",
    top_center: "上中",
    bottom_left: "左下",
    bottom_center: "下中",
    bottom_right: "右下",
    linear: "线性",
    phrase: "短语",
    char: "逐字",
    low: "低",
    medium: "中等",
    high: "高",
    fast: "快",
    slow: "慢"
  }[text] ?? text.replace(/_/g, " "));
};
const parseMaybeJsonObject = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(value) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
  return Array.isArray(value) ? undefined : value as Record<string, unknown>;
};
const formatRecipeValue = (value: unknown, kind: "transition" | "text" | "camera" | "layout" | "motion" = "motion") => {
  const obj = parseMaybeJsonObject(value);
  if (!obj) {
    const text = safeText(value, "", 70);
    if (!text || text === "n/a") return "";
    return tokenZh(text, text);
  }
  const type = typeof obj.type === "string" ? obj.type : "";
  if (type === "none") {
    if (kind === "transition") return "无转场";
    if (kind === "text") return "无字幕动画";
    if (kind === "camera") return "固定镜头";
  }
  if (kind === "layout") {
    const subject = tokenZh(obj.subjectAnchor, "");
    const text = tokenZh(obj.textAnchor, "");
    const layers = Array.isArray(obj.depthLayers) ? obj.depthLayers.length : 0;
    return [subject, text ? `文字${text}` : "", layers ? `${layers} 层景深` : ""].filter(Boolean).join(" · ") || "版式已解析";
  }
  const parts = [
    tokenZh(type, kind === "transition" ? "转场" : kind === "text" ? "字幕动画" : kind === "camera" ? "镜头运动" : "运动"),
    typeof obj.durationSec === "number" && obj.durationSec > 0 ? `${fixed(obj.durationSec)}s` : "",
    typeof obj.direction === "string" && obj.direction !== "none" ? tokenZh(obj.direction) : "",
    typeof obj.split === "string" && obj.split !== "none" ? tokenZh(obj.split) : "",
    typeof obj.curve === "string" && obj.curve !== "linear" ? tokenZh(obj.curve) : ""
  ].filter(Boolean);
  return parts.join(" · ");
};
const patchFieldZh = (key: string) => ({
  theme: "主题",
  copyOverrides: "文案覆盖",
  rhythm: "节奏",
  textDensity: "字幕密度",
  paletteMood: "配色情绪",
  timeline: "时间线",
  slots: "槽位",
  assets: "素材"
}[key] ?? key.replace(/_/g, " "));
const knowledgeKindZh = (kind: string | undefined) => ({
  structure_pattern: "结构模式",
  hook_pattern: "开头钩子",
  segment_template: "段落模板",
  rhythm_pattern: "节奏模式",
  motion_pattern: "运动模式",
  transition_pattern: "转场模式",
  typography_pattern: "字幕/排版模式",
  layout_pattern: "版式模式",
  palette_pattern: "配色模式",
  visual_asset_pattern: "视觉素材模式",
  image_prompt_recipe: "图像提示词配方",
  audio_pattern: "音频模式",
  sfx_pattern: "音效模式",
  voiceover_pattern: "旁白模式",
  cta_pattern: "行动号召模式",
  remotion_snippet: "Remotion 片段"
}[kind ?? ""] ?? slotKindZh(kind));
const codeOriginZh = (value: unknown) => ({
  ai: "AI 生成并通过校验",
  deterministic: "确定性模板生成",
  deterministic_fallback: "确定性兜底模板"
}[String(value ?? "")] ?? "来源待确认");
const inferSectionRole = (role: string | undefined, summary: string | undefined, index: number, total: number) => {
  const hay = `${role ?? ""} ${summary ?? ""}`.toLowerCase();
  if (/cta|call.?to.?action|行动|购买|点击|learn more|get started/.test(hay)) return "cta";
  if (/proof|trust|review|badge|背书|证明|证据/.test(hay)) return "proof";
  if (/benefit|feature|value|卖点|利益|优势/.test(hay)) return "benefit";
  if (/demo|show|product|use|展示|演示/.test(hay)) return "demo";
  if (/setup|context|铺垫/.test(hay)) return "setup";
  if (/hook|opening|open|开头|钩子/.test(hay)) return "hook";
  if (role && role !== "other") return role;
  if (index === 0) return "hook";
  if (total > 1 && index === total - 1) return "cta";
  return role ?? "other";
};
const chineseSummaryFallback = (role: string, raw: string | undefined) => {
  const text = raw?.trim();
  if (!text) return `${sectionRoleZh(role)}段落：承接样本节奏与版式。`;
  if (/hook section/i.test(text)) return "开场钩子段落：用首屏文字/视觉建立注意力。";
  if (/benefit section/i.test(text)) return "利益点段落：展开产品卖点或核心信息。";
  if (/proof section/i.test(text)) return "证明段落：用对比、背书或结果增强可信度。";
  if (/cta section/i.test(text)) return "行动号召段落：收束信息并推动点击/转化。";
  if (/deterministic template/i.test(text)) return `${sectionRoleZh(role)}段落：由结构模板推断的可复用时间段。`;
  return short(text, 110);
};
const roleReasonZh = (role: string) => ({
  hook: "位于开头注意力窗口，承担首屏停留和主题引入。",
  setup: "承接开头信息，负责建立语境和视觉铺垫。",
  benefit: "开始解释产品/主题价值，信息密度高于开头段。",
  proof: "出现证明、界面、对比或结果信息，用来增强可信度。",
  demo: "画面转向具体展示或使用场景，承担演示功能。",
  action: "节奏推进明显，承担信息转场或动作连接。",
  transition: "主要作用是连接两个段落，强调视觉连续性。",
  cta: "靠近尾段，承担收束、转化或行动提示。",
  other: "该段缺少明确语义标签，按镜头、文字和节奏综合归类。"
}[role] ?? "按时间位置、画面内容和模板协议综合归类。");
const evidenceReasonsFor = (role: string, ocrTexts: string[], beatCount: number, transition?: string, textAnim?: string, camera?: string, shotCount = 0) => [
  roleReasonZh(role),
  ocrTexts.length ? `OCR/字幕检测到 ${ocrTexts.length} 条文字线索：${ocrTexts.map((text) => `「${short(text, 18)}」`).join(" / ")}。` : "",
  beatCount ? `该时间段覆盖 ${beatCount} 个节拍点，能支撑卡点或节奏同步。` : "",
  transition ? `转场模式为「${transition}」，说明该段有明确剪辑语法。` : "",
  textAnim ? `字幕包装为「${textAnim}」，可迁移为新文案的出现方式。` : "",
  camera ? `镜头/运动为「${camera}」，可复用运动曲线但替换画面内容。` : "",
  shotCount > 1 ? `该段合并 ${shotCount} 个镜头证据，属于段落级结构判断。` : ""
].filter(Boolean);
const reusableAtomsFor = (role: string, transition?: string, textAnim?: string, camera?: string, ocrCount = 0) => [
  role === "hook" ? "开头注意力钩子" : "",
  role === "proof" ? "证明/对比信息段" : "",
  role === "benefit" ? "卖点展开段" : "",
  role === "cta" ? "转化收束段" : "",
  textAnim ? `${textAnim} 字幕节奏` : ocrCount ? "短句大字包装" : "",
  transition ? `${transition} 转场语法` : "",
  camera ? `${camera} 运动曲线` : "",
  "时间占比与段落顺序"
].filter(Boolean);
const timelineOverlap = (startA: number, endA: number, startB: number, endB: number) => startA < endB && startB < endA;
const buildLearningTimeline = (ev: EvidenceV5 | undefined, rec: ReconstructionV5 | undefined, detail: TemplateDetail | undefined): LearningTimelineItem[] => {
  const scenes = rec?.typedSpec?.scenes ?? [];
  const templateSections = detail?.timingSignature?.sections ?? [];
  const evidenceShots = ev?.shots ?? [];
  const useShotLevel = evidenceShots.length >= 4 && evidenceShots.length > Math.max(templateSections.length, scenes.length);
  const fallbackShots = evidenceShots.map((shot, index) => ({
    id: shot.id,
    role: index === 0 ? "hook" : index === evidenceShots.length - 1 ? "cta" : "other",
    startSec: shot.startSec,
    endSec: shot.endSec,
    internalBeats: [] as number[],
    sourceLabel: `镜头 ${index + 1}`,
    summary: shot.summary
  }));
  const baseSections = useShotLevel
    ? fallbackShots
    : templateSections.length
      ? templateSections.map((section, index) => ({ ...section, sourceLabel: `段落 ${index + 1}`, summary: undefined as string | undefined }))
      : scenes.length
        ? scenes.map((scene, index) => ({ id: scene.id, role: scene.role, startSec: scene.startSec, endSec: scene.endSec, internalBeats: [] as number[], sourceLabel: `段落 ${index + 1}`, summary: scene.intent }))
        : fallbackShots;
  const keyFrames = ev?.keyFrames ?? [];
  const textEvidence = ev?.textEvidence ?? [];
  const beats = ev?.audioEvidence?.beatGridSec ?? [];
  return baseSections
    .map((section, index) => {
      const startSec = Math.max(0, Number(section.startSec) || 0);
      const endSec = Math.max(startSec + 0.1, Number(section.endSec) || startSec + 0.1);
      const midSec = (startSec + endSec) / 2;
      const parentSection = templateSections.find((item) => midSec >= item.startSec && midSec <= item.endSec)
        ?? templateSections.find((item) => timelineOverlap(startSec, endSec, item.startSec, item.endSec));
      const recipe = detail?.sceneRecipes?.find((item) => item.sectionId === (parentSection?.id ?? section.id))
        ?? detail?.sceneRecipes?.find((item) => item.startSec !== undefined && item.endSec !== undefined && timelineOverlap(startSec, endSec, item.startSec, item.endSec))
        ?? detail?.sceneRecipes?.[index];
      const scene = scenes.find((item) => item.id === section.id)
        ?? scenes.find((item) => timelineOverlap(startSec, endSec, item.startSec, item.endSec))
        ?? scenes[index];
      const shots = (ev?.shots ?? []).filter((shot) => timelineOverlap(startSec, endSec, shot.startSec, shot.endSec));
      const nearestFrame = keyFrames.find((frame) => frame.timeSec >= startSec && frame.timeSec <= endSec)
        ?? keyFrames.slice().sort((a, b) => Math.abs(a.timeSec - startSec) - Math.abs(b.timeSec - startSec))[0];
      const ocrTexts = textEvidence
        .filter((item) => item.timeSec >= startSec && item.timeSec <= endSec)
        .map((item) => item.text)
        .filter(Boolean)
        .slice(0, 3);
      const layoutText = formatRecipeValue(recipe?.layout, "layout");
      const role = inferSectionRole(parentSection?.role ?? section.role ?? recipe?.role ?? scene?.role, scene?.intent ?? section.summary ?? shots[0]?.summary ?? layoutText, index, baseSections.length);
      const ocrSummary = ocrTexts.length ? `画面文字「${ocrTexts.map((text) => short(text, 26)).join(" / ")}」。` : undefined;
      const rawSummary = ocrSummary
        ?? scene?.intent
        ?? section.summary
        ?? shots[0]?.summary
        ?? layoutText
        ?? formatRecipeValue(recipe?.textAnim ?? recipe?.transitionIn, "motion");
      const camera = formatRecipeValue((recipe as Record<string, unknown> | undefined)?.cameraMove ?? (recipe as Record<string, unknown> | undefined)?.camera, "camera");
      const beatCount = beats.filter((time) => time >= startSec && time <= endSec).length || (section.internalBeats?.length ?? 0);
      const transition = formatRecipeValue(recipe?.transitionIn, "transition");
      const textAnim = formatRecipeValue(recipe?.textAnim ?? (recipe as Record<string, unknown> | undefined)?.textAnimation, "text");
      return {
        id: section.id ?? `section-${index}`,
        role,
        roleZh: sectionRoleZh(role),
        startSec,
        endSec,
        durationSec: endSec - startSec,
        summary: chineseSummaryFallback(role, rawSummary),
        transition,
        textAnim,
        camera,
        keyframeUrl: publicRef(nearestFrame?.frameRef),
        ocrTexts,
        beatCount,
        shotCount: shots.length || (useShotLevel ? 1 : 0),
        sourceLabel: section.sourceLabel,
        evidenceReasons: evidenceReasonsFor(role, ocrTexts, beatCount, transition, textAnim, camera, shots.length || (useShotLevel ? 1 : 0)),
        reusableAtoms: reusableAtomsFor(role, transition, textAnim, camera, ocrTexts.length)
      };
    })
    .sort((a, b) => a.startSec - b.startSec);
};
const codeBundleInfo = (value: unknown) => {
  const bundle = value as { componentName?: unknown; entryFile?: unknown; files?: unknown } | undefined;
  const files = Array.isArray(bundle?.files) ? bundle.files as Array<{ path?: unknown; content?: unknown }> : [];
  const code = files.map((file) => typeof file.content === "string" ? file.content : "").join("\n");
  const count = (pattern: RegExp) => (code.match(pattern) ?? []).length;
  const features = [
    /useCurrentFrame/.test(code) ? "逐帧驱动" : "",
    /interpolate/.test(code) ? "插值动画" : "",
    /spring/.test(code) ? "弹性动画" : "",
    /<Sequence|Sequence\s*\(/.test(code) ? "分段编排" : "",
    /<AbsoluteFill|AbsoluteFill\s*\(/.test(code) ? "全屏图层" : "",
    /<Img|<Image|staticFile\([^)]*\.(png|jpg|jpeg|webp)/i.test(code) ? "图片/产品层" : "",
    /<Video|staticFile\([^)]*\.(mp4|mov|webm)/i.test(code) ? "视频素材层" : "",
    /<Audio|staticFile\([^)]*\.(mp3|wav|m4a)/i.test(code) ? "音频轨" : "",
    /transform|translate|scale|rotate/.test(code) ? "位移/缩放/旋转" : "",
    /opacity/.test(code) ? "透明度节奏" : "",
    /boundProps|props\.|slot|assets\.|copy\./.test(code) ? "槽位绑定" : ""
  ].filter(Boolean);
  return {
    componentName: safeText(bundle?.componentName, "n/a", 60),
    entryFile: safeText(bundle?.entryFile, "n/a", 60),
    fileCount: files.length,
    lineCount: files.reduce((sum, file) => sum + (typeof file.content === "string" ? file.content.split("\n").length : 0), 0),
    paths: files.map((file) => safeText(file.path, "index.tsx", 64)).slice(0, 4),
    features: Array.from(new Set(features)).slice(0, 10),
    sequenceCount: count(/<Sequence|Sequence\s*\(/g),
    textLayerCount: count(/<Text|fontSize|headline|subtitle|cta|caption/gi),
    mediaLayerCount: count(/<Img|<Image|<Video|staticFile\(/gi),
    animationExpressionCount: count(/interpolate|spring|useCurrentFrame|useVideoConfig/g)
  };
};
type ConsistencyCheck = { label: string; status: "pass" | "warn" | "fail"; detail: string };
const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const checkMark = (status: ConsistencyCheck["status"]) => status === "pass" ? "✅" : status === "warn" ? "⚠️" : "✗";
const checkColor = (status: ConsistencyCheck["status"]) => status === "pass" ? "#7fdca0" : status === "warn" ? "#ffce7a" : "#ffb3bf";
const uniqueCompact = (items: string[], limit = 5) => Array.from(new Set(items.filter(Boolean))).slice(0, limit);
const buildStructureFingerprint = (items: LearningTimelineItem[], slots: TemplateSlot[], codeInfo: ReturnType<typeof codeBundleInfo>) => {
  const roles = uniqueCompact(items.map((item) => item.roleZh), 6);
  const hasProductGrid = slots.some((slot) => /product|grid|image|mockup/i.test(`${slot.id} ${slot.kind} ${slot.originalRole}`));
  const hasProof = items.some((item) => item.role === "proof") || slots.some((slot) => /proof|ui|data|compare/i.test(`${slot.id} ${slot.kind} ${slot.originalRole}`));
  const parts = [
    roles[0] ?? "开头钩子",
    codeInfo.features.some((feature) => /运动|透明度|插值|弹性/.test(feature)) ? "光效/运动铺垫" : "视觉铺垫",
    hasProductGrid ? "产品/界面矩阵展示" : "主体信息展示",
    hasProof ? "对比证明" : roles.includes("利益点") ? "卖点展开" : "",
    roles.includes("行动号召") ? "CTA 收束" : "尾段收束"
  ].filter(Boolean);
  return uniqueCompact(parts, 6).join(" → ");
};
const buildLearningConfidence = (
  ev: EvidenceV5 | undefined,
  rec: ReconstructionV5 | undefined,
  detail: TemplateDetail | undefined,
  items: LearningTimelineItem[],
  codeInfo: ReturnType<typeof codeBundleInfo>
) => [
  {
    label: "结构",
    value: clampScore((rec?.reconstructionQuality?.structureCoverage ?? (items.length >= 3 ? 0.76 : 0.48)) * 100)
  },
  {
    label: "节奏",
    value: clampScore((ev?.audioEvidence?.beatGridSec?.length ? 72 : 42) + (ev?.motionEvidence?.peakMomentsSec?.length ?? 0) * 2)
  },
  {
    label: "包装",
    value: clampScore((detail?.motionSignature?.activeMotionCoverage ?? 0.62) * 60 + Math.min(28, codeInfo.animationExpressionCount * 3) + Math.min(12, codeInfo.textLayerCount))
  },
  {
    label: "文本",
    value: clampScore(Math.min(88, 38 + (ev?.textEvidence?.length ?? 0) * 3))
  },
  {
    label: "音频",
    value: clampScore(ev?.audioEvidence?.hasAudio ? (ev.audioEvidence.bpm ? 68 : 52) + Math.min(20, (ev.audioEvidence.beatGridSec?.length ?? 0) / 4) : 24)
  }
];
const migrationFitFor = (slots: TemplateSlot[], codeInfo: ReturnType<typeof codeBundleInfo>, ev: EvidenceV5 | undefined) => {
  const hasUi = slots.some((slot) => /ui|mockup|screen|dashboard|data|proof/i.test(`${slot.id} ${slot.kind} ${slot.originalRole}`));
  const hasProduct = slots.some((slot) => /product|image|packshot|hero/i.test(`${slot.id} ${slot.kind} ${slot.originalRole}`));
  const hasText = (ev?.textEvidence?.length ?? 0) >= 4 || codeInfo.textLayerCount >= 6;
  const fit = uniqueCompact([
    hasProduct ? "科技产品 / 智能硬件" : "",
    hasProduct ? "潮流电商 / 商品种草" : "",
    hasUi ? "SaaS 功能发布 / App 展示" : "",
    codeInfo.animationExpressionCount >= 8 ? "高质感品牌片" : "",
    hasText ? "短句大字营销视频" : ""
  ], 5);
  return {
    fit: fit.length ? fit : ["科技产品", "品牌展示", "电商短视频"],
    avoid: ["强剧情类", "人物口播类", "长教程步骤类"]
  };
};
const missingLearningNeeds = (
  ev: EvidenceV5 | undefined,
  rec: ReconstructionV5 | undefined,
  detail: TemplateDetail | undefined,
  slots: TemplateSlot[],
  codeInfo: ReturnType<typeof codeBundleInfo>
) => [
  !ev ? "缺少样例证据：需要先 Learn 样本。" : "",
  !rec ? "缺少中性重建：需要重新 Learn 并开启 Gen1 分析。" : "",
  !detail ? "缺少 Remotion 模板细节：读取模板协议，或重新 Learn 让模型补读 Remotion 代码。" : "",
  detail && codeInfo.fileCount === 0 ? "Remotion codeBundle 为空：建议重新 Learn 并开启 Remotion 代码生成。" : "",
  slots.length === 0 ? "缺少 slot schema：无法生成素材需求表，需要重新学习模板。" : "",
  !(detail?.sceneRecipes?.length) ? "缺少场景 recipe：段落转场/字幕/镜头协议不完整，可让模型补读。" : "",
  !(ev?.audioEvidence?.beatGridSec?.length) ? "音频节拍证据较弱：BGM 卡点只能按兜底节奏迁移。" : "",
  !(ev?.textEvidence?.length) ? "OCR/字幕证据较弱：文本包装置信度会降低。" : ""
].filter(Boolean);
const slotNeedText = (slot: TemplateSlot) => {
  const raw = `${slot.id} ${slot.kind} ${slot.originalRole}`.toLowerCase();
  if (/hook|headline/.test(raw)) return "开头标题 / 注意力钩子文案";
  if (/bg|background/.test(raw)) return "品牌背景 / 产品氛围图";
  if (/product|hero|image|packshot/.test(raw)) return "用户商品图、特写图或产品视频";
  if (/ui|proof|data|mockup/.test(raw)) return "证明截图、参数图、对比图或 UI 截图";
  if (/cta|end/.test(raw)) return "优惠、购买、预约或行动号召信息";
  if (/music|audio|voice|sfx/.test(raw)) return "新 BGM、旁白或音效，不复用样例音频";
  if (/subtitle|text|copy/.test(raw)) return "根据新主题重写的短句文案";
  return `${slotKindZh(slot.kind)}素材 / 文案`;
};
const slotFallbackText = (slot: TemplateSlot) => {
  if (slot.aigcPrompt) return "AIGC 按提示词补全";
  if (slot.motionHint) return "用运动提示生成动态补位";
  if (/music|audio|voice|sfx/.test(slot.kind)) return "生成/替换音频床";
  if (/text|headline|subtitle|cta/.test(slot.kind)) return "LLM 重写文案";
  if (/product|image|video|mockup|background/.test(slot.kind)) return "不足时用生成图、裁切或程序化背景补位";
  return slot.required ? "必填槽位需绑定素材或补全策略" : "可跳过或使用模板默认补位";
};
const reusableBoundaryRows = (safety: Record<string, unknown> | ReconstructionV5["safety"] | undefined) => [
  { type: "段落结构", reusable: "可复用", method: "迁移 hook → benefit → proof → CTA 的顺序和时间占比。" },
  { type: "字幕节奏", reusable: "可复用", method: "迁移短句长度、出现时机、逐字/弹出方式；不复制原文案。" },
  { type: "视觉包装", reusable: "可复用", method: "迁移光效、卡片、留白、品牌色位置；替换为新品牌色。" },
  { type: "原始商品图", reusable: safetyZh(safety, "samplePixelsReusable", "samplePixelsRemoved"), method: "不可直接进入最终视频，只能替换为用户商品素材或生成素材。" },
  { type: "原始文案", reusable: safetyZh(safety, "sampleTextReusable", "sampleTextSanitized", "已清洗"), method: "只能迁移句式和字幕密度，内容必须重写。" },
  { type: "原始音频", reusable: safetyZh(safety, "sampleAudioReusable", "sampleAudioRemoved"), method: "只能迁移 BPM、卡点密度和情绪标签，BGM 需替换。" }
];
const buildPreGenerationChecks = (
  ev: EvidenceV5 | undefined,
  rec: ReconstructionV5 | undefined,
  detail: TemplateDetail | undefined,
  slots: TemplateSlot[],
  timelineItems: LearningTimelineItem[]
): ConsistencyCheck[] => {
  const required = slots.filter((slot) => slot.required);
  const textCount = ev?.textEvidence?.length ?? 0;
  const timelineCoverage = rec?.reconstructionQuality?.timingCoverage ?? (timelineItems.length ? 1 : 0);
  const sectionCoverage = rec?.reconstructionQuality?.structureCoverage ?? (timelineItems.length >= 3 ? 0.8 : 0.35);
  return [
    { label: "时间线覆盖率", status: timelineCoverage >= 0.95 ? "pass" : timelineCoverage >= 0.65 ? "warn" : "fail", detail: percent(timelineCoverage) },
    { label: "段落覆盖率", status: sectionCoverage >= 0.75 ? "pass" : sectionCoverage >= 0.5 ? "warn" : "fail", detail: percent(sectionCoverage) },
    { label: "槽位定义完整", status: slots.length && required.length ? "pass" : "fail", detail: `${required.length}/${slots.length} 必填槽位` },
    { label: "可复用文本", status: textCount ? "warn" : "pass", detail: `0/${textCount} 原文可复用；生成时必须重写` },
    { label: "音频复用边界", status: ev?.audioEvidence?.hasAudio ? "warn" : "pass", detail: ev?.audioEvidence?.hasAudio ? "原音频不可复用，只迁移 BPM / 卡点" : "样例无可复用音频" },
    { label: "Remotion 模板", status: detail?.quality?.compilePassed === false ? "fail" : detail ? "pass" : "warn", detail: detail ? `编译 ${detail.quality?.compilePassed ? "通过" : "待确认"} · 预览 ${detail.quality?.renderPreviewPassed ? "通过" : "待确认"}` : "需读取模板细节" },
    { label: "必填槽位兜底", status: required.every((slot) => slot.replacementPolicy || slot.aigcPrompt || slot.motionHint) ? "pass" : "warn", detail: `${required.length} 个必填槽位需有用户素材或补全策略` }
  ];
};
const decisionActionZh = (action: unknown) => ({
  store_variant: "新增结构原子",
  create: "新增结构原子",
  merge_existing: "合并已有结构",
  merge: "合并已有结构",
  skip: "重复跳过",
  reject: "不写入"
}[String(action ?? "")] ?? safeText(action, "知识决策", 40));
const decisionReasonZh = (reason: unknown) => {
  const text = safeText(reason, "", 120);
  if (!text) return "";
  if (/Exact signature duplicate/i.test(text)) return "与已有结构签名完全重复，已合并/跳过。";
  if (/stored as useful variant/i.test(text)) return "作为有价值的结构变体写入知识库。";
  if (/duplicate/i.test(text)) return "检测到重复结构，避免重复写入。";
  return text;
};
const buildKnowledgeWriteSummary = (candidates: SampleElementBundle["candidates"] = [], decisions: SampleElementBundle["decisions"] = []) => {
  const created = decisions.filter((d) => /store|create|variant/i.test(String(d.action ?? "")));
  const merged = decisions.filter((d) => /merge/i.test(String(d.action ?? "")));
  const skipped = decisions.filter((d) => /skip|reject|duplicate/i.test(`${d.action ?? ""} ${d.reason ?? ""}`));
  return {
    counts: [
      `新增结构原子 ${created.length || Math.min(3, candidates.length)}`,
      `合并已有结构 ${merged.length}`,
      `重复跳过 ${skipped.length}`
    ],
    created: candidates.slice(0, 3).map((candidate) => candidate.proposedName ?? candidate.id),
    merged: decisions.filter((d) => /merge/i.test(String(d.action ?? ""))).slice(0, 2),
    skipped: skipped.slice(0, 2)
  };
};
const buildResultConsistencyChecks = (result: GenResult | null, trace: TransferTrace | null, timelineSections: Array<{ id: string; role: string; startSec: number; endSec: number; detail?: string }>): ConsistencyCheck[] => {
  const mappings = trace?.transfer.slotMapping ?? result?.templateInstance?.slotBindings ?? [];
  const userAssetCount = mappings.filter((m) => "assetId" in m && Boolean(m.assetId)).length;
  const visualSlotCount = mappings.filter((m) => !/audio|voice|music|sfx/i.test(("slotKind" in m ? m.slotKind : "") ?? ("slotId" in m ? m.slotId : ""))).length;
  const filledVisual = mappings.filter((m) => {
    const key = ("slotKind" in m ? m.slotKind : "") ?? ("slotId" in m ? m.slotId : "");
    const status = "status" in m ? m.status : "";
    return !/audio|voice|music|sfx/i.test(key) && !/missing|none/i.test(status);
  }).length;
  const ctaReady = timelineSections.some((section) => /cta|行动|转化|收束/i.test(`${section.role} ${section.detail ?? ""}`)) || mappings.some((m) => /cta/i.test(("slotId" in m ? m.slotId : "") ?? ""));
  return [
    { label: "final.mp4", status: result?.finalVideoUrl ? "pass" : "warn", detail: result?.finalVideoUrl ? "已生成可播放视频" : "还在渲染或只生成了协议" },
    { label: "时间线 / 渲染配方同源", status: (result?.timelineV2 || trace?.transfer.timeline || timelineSections.length) ? "pass" : "warn", detail: timelineSections.length ? `${timelineSections.length} 个结构段可追踪` : "待读取迁移证据" },
    { label: "用户素材上屏", status: userAssetCount > 0 ? "pass" : "warn", detail: `${userAssetCount} 个槽位绑定了用户素材` },
    { label: "视觉槽位承载", status: visualSlotCount ? (filledVisual >= visualSlotCount ? "pass" : "warn") : "warn", detail: `${filledVisual}/${visualSlotCount || 0} 个视觉槽位已承载` },
    { label: "CTA 时间段", status: ctaReady ? "pass" : "warn", detail: ctaReady ? "已检测到 CTA / 收束结构" : "需要确认尾段转化信息" }
  ];
};
const safetyZh = (value: unknown, reusableKey: string, removedKey: string, removedLabel = "已移除") => {
  const obj = value as Record<string, unknown> | undefined;
  if (obj?.[reusableKey] === true) return "可复用";
  if (obj?.[reusableKey] === false) return "不可复用";
  if (obj?.[removedKey] === true) return removedLabel;
  if (obj?.[removedKey] === false) return "待确认";
  return "不可复用";
};
const generatedAssetSummary = (items: GenResult["generatedAssets"] | undefined, imageMode: string, audioMode: string) => {
  const assets = items ?? [];
  const imageCount = assets.filter((item) => /image|still|poster|visual/i.test(item.kind ?? item.uri ?? "")).length;
  const audioCount = assets.filter((item) => /audio|music|sfx|voice/i.test(item.kind ?? item.uri ?? "")).length;
  const videoCount = assets.filter((item) => /video|clip|motion/i.test(item.kind ?? item.uri ?? "")).length;
  const otherCount = Math.max(0, assets.length - imageCount - audioCount - videoCount);
  const parts = [
    imageCount ? `${imageCount} 张 AIGC 图${imageMode === "aigc" ? "(Gemini)" : ""}` : "",
    videoCount ? `${videoCount} 条视频素材` : "",
    audioCount ? `${audioCount} 条音频${audioMode === "aigc" ? "" : "/节拍床"}` : "",
    otherCount ? `${otherCount} 个补全素材` : ""
  ].filter(Boolean);
  return parts.length ? parts.join(" + ") : assets.length ? `${assets.length} 个补全素材` : "";
};
const progressLabelFor = (label: string) => ({
  upload: "上传素材",
  learn: "学习样本",
  generate: "生成视频",
  variants: "生成多版本",
  revise: "改写视频",
  "revise-nl": "自然语言改片"
}[label] ?? label);
const flowStatusMeta = (status: FlowStatus) => ({
  done: { border: "#1f9d55", bg: "#16321f", color: "#7fdca0", label: "完成" },
  active: { border: accent, bg: accentSoft, color: "#b8f4ff", label: "进行中" },
  ready: { border: "#526bff", bg: "#18224a", color: "#c7d2ff", label: "可执行" },
  warn: { border: "#b78a14", bg: "#3a2f12", color: "#ffce7a", label: "需检查" },
  todo: { border: "rgba(148, 163, 184, 0.16)", bg: darkControl, color: "#9fb3d1", label: "待处理" }
}[status]);
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
  // Generation strategy: "llm" = the LLM rewrites the Remotion code from theme+卖点+自定义需求+所选预设 (authoritative,
  // hard rules become fallback). "preset" = deterministic knob-driven presets (legacy). Default to LLM.
  const [generationMethod, setGenerationMethod] = useState<"llm" | "preset">("llm");
  const reviewMode = true;
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<GenResult | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
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
  // Default-expand the core workflow steps (Learn → pick template → Generate) so a first-time user immediately
  // sees the whole pipeline, not just Upload. Dense secondary panels (KB explorer / review) stay collapsed.
  const [learnCollapsed, setLearnCollapsed] = useState(false);
  const [templateLibraryCollapsed, setTemplateLibraryCollapsed] = useState(false);
  const [generateCollapsed, setGenerateCollapsed] = useState(false);
  const [targetAssetsCollapsed, setTargetAssetsCollapsed] = useState(true);
  const [kbCollapsed, setKbCollapsed] = useState(false);
  const [kbExplorerCollapsed, setKbExplorerCollapsed] = useState(true);
  const [kbQuery, setKbQuery] = useState("");
  const [kbKind, setKbKind] = useState("all");
  const [kbView, setKbView] = useState<KbView>("structure");
  const [sampleReports, setSampleReports] = useState<Record<string, SampleReport>>({});
  const [sampleReportsLoading, setSampleReportsLoading] = useState(false);
  const [trace, setTrace] = useState<TransferTrace | null>(null);
  const [variants, setVariants] = useState<GenResult[]>([]);
  const [uploadProjectId, setUploadProjectId] = useState<string>("");
  const [pendingSampleFiles, setPendingSampleFiles] = useState<File[]>([]);
  const [pendingTargetFiles, setPendingTargetFiles] = useState<File[]>([]);
  const [reviewCollapsed, setReviewCollapsed] = useState(true);
  const [reviewTab, setReviewTab] = useState<EvidenceTab>("showcase");
  const [showcaseCases, setShowcaseCases] = useState<ShowcaseCase[]>([]);
  const [showcaseLoading, setShowcaseLoading] = useState(false);
  const [templateDetail, setTemplateDetail] = useState<TemplateDetail | null>(null);
  const [templateDetailsById, setTemplateDetailsById] = useState<Record<string, TemplateDetail>>({});
  const [templateDetailLoading, setTemplateDetailLoading] = useState(false);

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
    setKb(newestFirst(r.elements, (element) => element.lifecycle?.updatedAt));
  }, [kbKind, kbQuery]);

  const refreshTemplates = useCallback(async () => {
    const r = await api<{ templates: TemplateMeta[] }>("/api/v5/templates");
    setTemplates(newestFirst(r.templates, (template) => template.createdAt));
  }, []);

  const refreshShowcase = useCallback(async () => {
    setShowcaseLoading(true);
    try {
      const r = await api<{ cases: ShowcaseCase[] }>("/api/v5/showcase");
      setShowcaseCases(r.cases);
    } finally {
      setShowcaseLoading(false);
    }
  }, []);

  const refreshAssets = useCallback(async () => {
    const r = await api<{ assets: AssetRow[] }>("/api/v5/assets");
    setAssets(newestFirst(r.assets, (asset) => asset.createdAt));
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
          : { assetId, error: "尚未找到学习产物；先点击 Learn 生成样本证据、结构重建和知识元素。" };
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
    refreshShowcase().catch(() => undefined);
  }, [checkServiceStatus, refreshAssets, refreshKb, refreshTemplates, refreshShowcase]);

  useEffect(() => {
    if (!busy) {
      setElapsedSec(0);
      return;
    }
    const started = Date.now();
    setElapsedSec(0);
    const timer = window.setInterval(() => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const fetchTrace = useCallback(async (generationId: string) => {
    const next = await api<TransferTrace>(`/api/v5/jobs/${generationId}/transfer-trace`).catch(() => null);
    setTrace(next);
  }, []);

  const videoAssets = useMemo(() => assets.filter((a) => a.type === "video" && a.hasPath), [assets]);
  const targetAssets = useMemo(() => assets.filter((a) => a.type === "image" || a.type === "video"), [assets]);
  const selectedTargetAssets = useMemo(() => {
    const byId = new Map(targetAssets.map((asset) => [asset.id, asset]));
    return targetIds.map((id) => byId.get(id)).filter((asset): asset is AssetRow => Boolean(asset));
  }, [targetAssets, targetIds]);
  // Selected template = explicit pick, else the latest learned capsule (the server's default too).
  const activeTemplate = useMemo<TemplateMeta | undefined>(
    () => templates.find((t) => t.id === templateId) ?? templates[0],
    [templates, templateId]
  );
  const loadTemplateDetail = useCallback(async (id = activeTemplate?.id) => {
    if (!id) return;
    setTemplateDetailLoading(true);
    try {
      const detail = await api<TemplateDetail>(`/api/v5/templates/${id}`);
      setTemplateDetail(detail);
      setTemplateDetailsById((prev) => ({ ...prev, [detail.id]: detail }));
    } finally {
      setTemplateDetailLoading(false);
    }
  }, [activeTemplate?.id]);
  useEffect(() => {
    if (!activeTemplate?.id || templateDetail?.id === activeTemplate.id) return;
    loadTemplateDetail(activeTemplate.id).catch(() => undefined);
  }, [activeTemplate?.id, loadTemplateDetail, templateDetail?.id]);
  const requiredSlots = useMemo(() => activeTemplate?.slotSchema.filter((s) => s.required) ?? [], [activeTemplate]);
  // Label a template by its INPUT VIDEO name + learn time (falls back to the source id when the asset is gone).
  const tplLabel = (t: TemplateMeta): string => {
    const src = assets.find((a) => a.id === t.sourceSampleId)?.filename;
    const base = (src ?? t.sourceSampleId).replace(/\.[^.]+$/, "");
    const ts = fmtTime(t.createdAt);
    return ts ? `${base} · ${ts}` : base;
  };
  // How many required slots the user can cover from their own target assets, respecting image-vs-video needs.
  const providedCount = useMemo(() => {
    const unused = [...selectedTargetAssets];
    let covered = 0;
    for (const slot of requiredSlots) {
      if (slotAssignments[slot.id]) {
        covered += 1;
        continue;
      }
      const index = unused.findIndex((asset) => targetAssetCompatibleWithSlot(slot, asset));
      if (index >= 0) {
        covered += 1;
        unused.splice(index, 1);
      }
    }
    return covered;
  }, [requiredSlots, selectedTargetAssets, slotAssignments]);
  const missingRequired = Math.max(0, requiredSlots.length - providedCount);
  const kbFiltered = kb;
  const kbGroups = useMemo(() => {
    const groups = new Map<string, KbElement[]>();
    for (const element of kbFiltered) {
      const category = kbGroupFor(element, kbView);
      groups.set(category, [...(groups.get(category) ?? []), element]);
    }
    return Array.from(groups.entries())
      .map(([category, elements]) => ({ category, elements }));
  }, [kbFiltered, kbView]);
  const selectedVariantMeta = creativeVariants.find((variant) => variant.value === selectedVariant) ?? null;
  const progressPercent = progress ? Math.max(8, Math.min(100, Math.round((progress.step / progress.total) * 100))) : 0;
  const progressNarrative = useMemo(() => {
    if (!busy || !progress) return [];
    const elapsed = elapsedSec ? `已用 ${elapsedSec}s` : "刚开始";
    if (progress.label === "generate" || progress.label === "variants") {
      const assetSummary = generatedAssetSummary(result?.generatedAssets, imageFill, audioFill);
      const expectedDuration = fixed(activeTemplate?.timingSignature?.durationSec ?? trace?.sample.duration ?? 39, 0);
      return [
        assetSummary ? `✅ ${assetSummary} 已生成完` : aigcOn ? "🔄 AIGC 缺口补全中：按槽位生成图片/视频、文案和音频。" : "🔄 正在绑定素材并实例化 Remotion 模板。",
        autoRender ? `🔄 渲染阶段：Chrome 渲帧 + FFmpeg 合成；${result?.generationId ? `任务 ${result.generationId}` : "任务提交后"} 保持活跃。` : "当前关闭 autoRender：只生成模板实例、缺口报告和评审证据。",
        result?.finalVideoUrl ? `✅ final.mp4 已生成：${result.finalVideoUrl}` : `final.mp4 还没出 —— ${expectedDuration} 秒视频，渲染通常还需约 1-3 分钟。`,
        elapsed
      ];
    }
    if (progress.label === "learn") {
      return [
        "🔄 正在读取样本视频证据：镜头、关键帧、OCR/ASR、BPM 和运动曲线。",
        "🔄 学习完成后会写入 Remotion 模板胶囊、槽位协议和可复用 KB。",
        elapsed
      ];
    }
    if (progress.label === "revise-nl") {
      return [
        "🔄 解析自然语言改片请求：节奏、文案密度、配色和 CTA 调整。",
        "🔄 写入 patch 后会重新读取 transfer trace。",
        elapsed
      ];
    }
    if (progress.label === "upload") {
      return [
        "🔄 正在写入素材库，完成后新素材会排在列表最前面。",
        elapsed
      ];
    }
    return [progress.detail, elapsed];
  }, [activeTemplate?.timingSignature?.durationSec, aigcOn, audioFill, autoRender, busy, elapsedSec, imageFill, progress, result?.finalVideoUrl, result?.generatedAssets, result?.generationId, trace?.sample.duration]);
  const selectedReports = videoAssets.map((asset) => sampleReports[asset.id]).filter((report): report is SampleReport => Boolean(report) && sampleIds.includes(report.assetId));
  const traceEvidence = trace?.sample.evidence as EvidenceV5 | undefined;
  const latestEvidence = selectedReports.find((r) => r.evidence)?.evidence ?? traceEvidence;
  const latestReconstruction = selectedReports.find((r) => r.reconstruction)?.reconstruction;
  const reviewTemplateDetail = templateDetail ?? activeTemplate;
  const learningTimelineItemsForReview = useMemo(
    () => buildLearningTimeline(latestEvidence, latestReconstruction, reviewTemplateDetail),
    [latestEvidence, latestReconstruction, reviewTemplateDetail]
  );
  const reviewPreviewUrl = publicRef(latestEvidence?.contactSheetRef ?? latestEvidence?.keyFrames?.[0]?.frameRef);
  const reviewCodeInfo = useMemo(() => codeBundleInfo(templateDetail?.codeBundle), [templateDetail?.codeBundle]);
  const learnedBpm = latestEvidence?.audioEvidence?.bpm ?? templateDetail?.audioRecipes?.[0]?.bpm;
  const learnedSubtitleCount = latestEvidence?.textEvidence?.length ?? 0;
  const learnedSubtitleDensity = latestEvidence?.video?.durationSec
    ? learnedSubtitleCount / Math.max(1, latestEvidence.video.durationSec) > 0.55 ? "偏密" : learnedSubtitleCount > 0 ? "适中" : "低"
    : learnedSubtitleCount > 8 ? "偏密" : learnedSubtitleCount > 0 ? "适中" : "待确认";
  const timelineSections = useMemo(() => {
    const phases = trace?.template.knowledgeManifest?.structureHypothesis?.phases ?? [];
    if (phases.length) return phases.map((p) => ({ id: p.id, role: p.role, startSec: p.startSec, endSec: p.endSec, detail: p.intent ?? p.visualMethod }));
    const sections = result?.composition?.sections ?? [];
    if (sections.length) return sections.map((s) => ({ id: s.id, role: s.role, startSec: s.startSec, endSec: s.endSec, detail: s.plannedText }));
    return learningTimelineItemsForReview.map((item) => ({ id: item.id, role: item.roleZh, startSec: item.startSec, endSec: item.endSec, detail: item.summary }));
  }, [learningTimelineItemsForReview, result?.composition?.sections, trace?.template.knowledgeManifest?.structureHypothesis?.phases]);
  const timelineDuration = useMemo(() => Math.max(1, latestEvidence?.video?.durationSec ?? 0, ...timelineSections.map((s) => s.endSec)), [latestEvidence?.video?.durationSec, timelineSections]);
  const slotRadarRows = useMemo(() => {
    const mappings = new Map((trace?.transfer.slotMapping ?? []).map((m) => [m.slotId, m]));
    const gaps = new Map([...(trace?.transfer.gapReport?.gaps ?? []), ...(result?.gapReport?.gaps ?? [])].map((g) => [g.slotId, g]));
    return (activeTemplate?.slotSchema ?? []).map((slot) => {
      const mapping = mappings.get(slot.id);
      const gap = gaps.get(slot.id);
      const compatibleAssets = selectedTargetAssets.filter((asset) => targetAssetCompatibleWithSlot(slot, asset));
      const status = mapping?.status ?? gap?.status ?? (compatibleAssets.length ? "待生成时匹配" : slot.required ? "待补全" : "可选");
      const isAudio = /audio|voice|sfx/.test(slot.kind);
      const isText = /text|title|subtitle|cta/.test(slot.kind);
      const fill = gap?.selectedRepair
        ?? (mapping?.status === "user_asset" ? "asset_reuse" : mapping?.status?.includes("generated") ? mapping.status : isAudio ? audioFill : isText ? textFill : imageFill);
      return {
        slot,
        status,
        asset: mapping?.assetId ?? (compatibleAssets.length ? `兼容候选 ${compatibleAssets.length} 个：${compatibleAssets.map((asset) => asset.filename).slice(0, 2).join(" / ")}${compatibleAssets.length > 2 ? " …" : ""}` : "none"),
        compatibleAssets,
        impact: gap?.impact ?? (slot.required ? "medium" : "low"),
        fill,
        reason: mapping?.fillReason ?? gap?.reason ?? slot.replacementPolicy
      };
    });
  }, [activeTemplate?.slotSchema, audioFill, imageFill, result?.gapReport?.gaps, selectedTargetAssets, textFill, trace?.transfer.gapReport?.gaps, trace?.transfer.slotMapping]);
  const draftTransferMap = useMemo(() => {
    if (trace || result || (!activeTemplate && !latestEvidence && !slotRadarRows.length)) return null;
    return {
      status: "pre_generation_plan",
      note: "生成前迁移计划；生成后会由 transfer-trace-v5.json 替换为真实映射证据。",
      template: activeTemplate ? { id: activeTemplate.id, name: activeTemplate.name, durationSec: activeTemplate.timingSignature?.durationSec } : null,
      sampleStructure: learningTimelineItemsForReview.map((item) => ({
        id: item.id,
        role: item.roleZh,
        startSec: item.startSec,
        endSec: item.endSec,
        summary: item.summary,
        reusableAtoms: item.reusableAtoms
      })),
      slotPlan: slotRadarRows.map((row) => ({
        slotId: row.slot.id,
        originalRole: row.slot.originalRole,
        kind: row.slot.kind,
        required: row.slot.required,
        status: row.status,
        asset: row.asset,
        fill: row.fill,
        reason: row.reason
      })),
      targetAssetOrder: selectedTargetAssets.map((asset, index) => ({ order: index + 1, id: asset.id, filename: asset.filename, type: asset.type }))
    };
  }, [activeTemplate, latestEvidence, learningTimelineItemsForReview, result, selectedTargetAssets, slotRadarRows, trace]);
  const draftPackagingPlan = useMemo(() => {
    if (trace || result || (!activeTemplate && !latestEvidence && !templateDetail)) return null;
    return {
      status: "pre_generation_packaging_plan",
      note: "生成前包装计划；生成后会由 packaging-plan.json / transfer trace 回填真实封面、字幕和节拍证据。",
      previewRef: latestEvidence?.contactSheetRef ?? latestEvidence?.keyFrames?.[0]?.frameRef,
      subtitles: {
        evidenceCount: learnedSubtitleCount,
        density: learnedSubtitleDensity,
        safeZone: "避开画面边缘 10%，优先底部/中部主视觉外侧",
        recommendedFontPx: "48-64"
      },
      rhythm: {
        bpm: learnedBpm,
        beatCount: latestEvidence?.audioEvidence?.beatGridSec?.length ?? templateDetail?.audioRecipes?.[0]?.cuePoints?.length ?? 0,
        peakMomentsSec: latestEvidence?.motionEvidence?.peakMomentsSec ?? []
      },
      motionPackaging: {
        motifs: activeTemplate?.motionSignature?.motifs ?? [],
        transitions: activeTemplate?.motionSignature?.transitionTypes ?? [],
        codeFeatures: reviewCodeInfo.features
      },
      safety: {
        samplePixelsReusable: false,
        sampleTextReusable: false,
        sampleAudioReusable: false
      }
    };
  }, [activeTemplate, latestEvidence, learnedBpm, learnedSubtitleCount, learnedSubtitleDensity, result, reviewCodeInfo.features, templateDetail, trace]);
  const exportArtifacts = useMemo(
    () => [
      { filename: "transfer-trace-v5.json", value: trace },
      { filename: "planned-transfer-map-v5.json", value: draftTransferMap },
      { filename: "generation-result-v5.json", value: result },
      { filename: "gap-report-v5.json", value: result?.gapReport ?? trace?.transfer.gapReport },
      { filename: "timeline-v2.json", value: result?.timelineV2 ?? trace?.transfer.timeline },
      { filename: "mapping-v2.json", value: result?.mappingV2 ?? trace?.transfer.mapping },
      { filename: "material-analysis.json", value: result?.materialAnalysis ?? trace?.transfer.materialAnalysis },
      { filename: "packaging-plan.json", value: result?.packagingPlan ?? trace?.transfer.packagingPlan },
      { filename: "packaging-plan-draft-v5.json", value: draftPackagingPlan },
      { filename: "scorecard-v5.json", value: result?.scorecard ?? trace?.result.scorecard },
      { filename: "template-capsule-v5.json", value: templateDetail },
      { filename: "sample-evidence-v5.json", value: latestEvidence }
    ].filter((item) => item.value !== undefined && item.value !== null),
    [draftPackagingPlan, draftTransferMap, latestEvidence, result, templateDetail, trace]
  );
  const qualityGroups = useMemo(() => gateGroups(result?.scorecard), [result?.scorecard]);
  const resultConsistencyChecks = useMemo(() => buildResultConsistencyChecks(result, trace, timelineSections), [result, timelineSections, trace]);
  const assignedSlotCount = Object.keys(slotAssignments).length;
  const flowSteps = useMemo((): Array<{ label: string; detail: string; status: FlowStatus }> => {
    const missingSlotCount = slotRadarRows.filter((row) => row.status === "missing" || row.status === "待补全").length;
    const hasLearnedStructure = templates.length > 0 || kb.length > 0;
    const hasTemplate = Boolean(activeTemplate);
    const hasResult = Boolean(result || trace || variants.length);
    const generationBusy = busy === "generate" || busy === "variants" || busy === "revise" || busy === "revise-nl";
    const canGenerate = hasTemplate && (aigcOn || targetIds.length > 0 || assignedSlotCount > 0 || missingSlotCount === 0);
    const materialNeedsInput = hasTemplate && missingSlotCount > 0 && !aigcOn && targetIds.length === 0 && assignedSlotCount === 0;
    return [
      {
        label: "上传样例",
        detail: videoAssets.length ? `${videoAssets.length} 个视频样例 · ${targetAssets.length} 个目标素材` : "等待上传样本视频",
        status: busy === "upload" ? "active" : videoAssets.length ? "done" : "active"
      },
      {
        label: "结构学习",
        detail: hasLearnedStructure ? `${templates.length} 个模板 · ${kb.length} 条 KB` : sampleIds.length ? `已选 ${sampleIds.length} 个样本 · 待读取/学习` : "等待选择样本",
        status: busy === "learn" ? "active" : hasLearnedStructure ? "done" : sampleIds.length ? "ready" : "todo"
      },
      {
        label: "素材适配/缺口补全",
        detail: hasTemplate ? `${slotRadarRows.length} 个槽位 · ${missingSlotCount} 个缺口 · ${targetIds.length} 个目标素材` : "等待模板胶囊",
        status: hasResult ? "done" : materialNeedsInput ? "active" : hasTemplate ? "ready" : "todo"
      },
      {
        label: "生成与对比",
        detail: result?.finalVideoUrl ? "final.mp4 ready" : variants.length ? `${variants.length} 个版本` : canGenerate ? "可生成/可对比" : "等待生成条件",
        status: generationBusy ? "active" : hasResult ? "done" : canGenerate ? "ready" : "todo"
      }
    ];
  }, [activeTemplate, aigcOn, assignedSlotCount, busy, kb.length, result, sampleIds.length, slotRadarRows, targetAssets.length, targetIds.length, templates.length, trace, variants.length, videoAssets.length]);
  const serviceOk = serviceStatus?.health?.ok === true && serviceStatus.ready?.ok === true;

  const toggle = (arr: string[], set: (v: string[]) => void, id: string) =>
    set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  const selectSingleSample = (id: string) =>
    setSampleIds((current) => (current[0] === id ? [] : [id]));

  const toggleTargetAsset = (id: string) =>
    setTargetIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  const removeTargetAsset = (id: string) =>
    setTargetIds((current) => current.filter((x) => x !== id));

  const moveTargetAsset = (id: string, direction: -1 | 1) =>
    setTargetIds((current) => {
      const index = current.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });

  const setStage = (label: string, step: number, total: number, detail: string) => {
    setProgress({ label, step, total, detail });
  };

  const run = async (label: string, fn: () => Promise<void>, jobId?: string) => {
    setBusy(label);
    setErr(null);
    setStage(label, 1, 1, "准备中");
    // While the (single, blocking) request runs, POLL the server for its real stage so the bar reflects
    // evidence→codegen→render etc. instead of freezing on step 1. Best-effort; failures are ignored.
    let poll: number | undefined;
    if (jobId) {
      poll = window.setInterval(async () => {
        const p = await api<{ step: number; total: number; detail: string } | null>(`/api/v5/jobs/${jobId}/progress`).catch(() => null);
        if (p && typeof p.step === "number" && p.step >= 1) {
          setProgress({ label, step: p.step, total: p.total ?? 4, detail: p.detail ?? "" });
        }
      }, 2000);
    }
    try {
      await fn();
    } catch (e) {
      setErr(String(e));
    } finally {
      if (poll !== undefined) window.clearInterval(poll);
      setBusy(null);
      setProgress(null);
    }
  };
  // Short random id the UI generates so it can poll progress for the request it just fired.
  const newJobId = () => `job_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

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

  const uploadAssets = (files: FileList | File[] | null, role: "example_video" | "source_video" | "user_image", onDone?: () => void) =>
    run("upload", async () => {
      const list = Array.from(files ?? []);
      if (!list.length) return;
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
      onDone?.();
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

  const learn = () => {
    const jobId = newJobId();
    return run("learn", async () => {
      setStage("learn", 1, 4, "提交样本学习任务");
      const r = await api<{ learned: Array<{ sampleId: string; storedElements?: number; gen1?: string; error?: string }>; kbSize: number }>(
        "/api/v5/learn-samples",
        { method: "POST", body: JSON.stringify({ sampleAssetIds: sampleIds, jobId, options: { runGen1Ai: useAi, runCapsuleCodegen: aiCapsule } }) }
      );
      setLog([...r.learned].reverse().map((l) => (l.error ? `✗ ${l.sampleId}: ${l.error}` : `✓ ${l.sampleId}: ${l.storedElements} elements (gen1=${l.gen1})`)));
      setStage("learn", 4, 4, "刷新 KB 和模板库");
      await Promise.all([refreshKb(), refreshTemplates()]);
      await loadSampleReports(sampleIds);
      setStage("learn", 4, 4, "学习结果已更新");
    }, jobId);
  };

  const generate = () => {
    const jobId = newJobId();
    return run("generate", async () => {
      const sellingArr = sellingPoints.split(",").map((s) => s.trim()).filter(Boolean);
      const selectedTemplateId = templateId || activeTemplate?.id;
      const options: Record<string, unknown> =
        genMode === "same_template"
          ? {
              generationMode: "same_template",
              autoRender,
              ...(selectedTemplateId ? { templateCapsuleId: selectedTemplateId } : {}),
              aigcGapFill: aigcOn
                ? { mode: "auto_on", imageFill, audioFill, textFill }
                : { mode: "off", imageFill: "off", audioFill: "off", textFill: "off" }
            }
          : { generationMode: "mix_elements", autoRender, runGen1Ai: useAi, runGen2Ai: useAi, audioFill: aigcOn ? audioFill : "off" };
      if (genMode === "mix_elements" && gen2RemotionCodegen) options.runGen2RemotionCodegen = true;
      setStage("generate", 1, 4, autoRender ? "生成 recipe / 补全素材 / 渲染 final.mp4" : "生成 recipe / 补全素材");
      const res = await api<GenResult>("/api/v5/generations", {
        method: "POST",
        body: JSON.stringify({
          projectId: "proj_v5_ui",
          jobId,
          brief: {
            theme,
            variant: selectedVariant ?? undefined,
            promptMode: generationMethod,
            customNL: generationMethod === "llm" ? customRequest.trim() || undefined : undefined,
            targetDurationSec: 16,
            aspectRatio: "9:16",
            sellingPoints: sellingArr
          },
          targetAssetIds: targetIds,
          ...(Object.keys(slotAssignments).length ? { slotAssignments } : {}),
          selectedElementIds: genMode === "mix_elements" && selectedEls.length ? selectedEls : undefined,
          options
        })
      });
      setStage("generate", 4, 4, "写入生成结果");
      setResult(res);
      setVariants([]);
      setStage("generate", 4, 4, "读取 transfer trace");
      await fetchTrace(res.generationId);
      setStage("generate", 4, 4, "生成完成");
    }, jobId);
  };

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
            brief: { theme, variant, promptMode: "preset", targetDurationSec: 16, aspectRatio: "9:16", sellingPoints: sellingArr },
            targetAssetIds: targetIds,
            ...(Object.keys(slotAssignments).length ? { slotAssignments } : {}),
            options: baseOptions
          })
        });
        next.unshift(res);
        setVariants([...next]);
      }
      if (next[0]) {
        setResult(next[0]);
        setStage("variants", labels.length + 1, labels.length + 1, "读取最新版本 trace");
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
        ...(templateId || activeTemplate?.id ? { templateCapsuleId: templateId || activeTemplate?.id } : {}),
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
    setGenerateCollapsed(false);
    setResult(null);
    document.getElementById("v5-generate")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const trackPointerGlow = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--v5-mx", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--v5-my", `${event.clientY - rect.top}px`);
  };

  const selectedTargetOrderPanel = selectedTargetAssets.length ? (
    <div style={{ ...miniPanel, marginTop: 10, padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 12 }}>已选素材顺序</strong>
        <span style={{ color: muted, fontSize: 11 }}>生成时按此顺序进入媒体槽：1 号素材优先出现在第一个画面。</span>
      </div>
      <div style={{ display: "grid", gap: 7 }}>
        {selectedTargetAssets.map((asset, index) => (
          <div key={asset.id} style={{ display: "grid", gridTemplateColumns: "34px minmax(0, 1fr) auto", gap: 8, alignItems: "center", ...miniPanel, padding: 8 }}>
            <span style={{ ...tag, marginRight: 0, textAlign: "center", background: index === 0 ? accentSoft : darkControl }}>{index + 1}</span>
            <span title={asset.filename} style={{ fontSize: 12, fontWeight: 700, ...wrapText }}>
              {asset.filename} <span style={{ color: muted, fontWeight: 500 }}>· {targetAssetTypeZh(asset.type)}</span>
            </span>
            <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
              <button type="button" disabled={!!busy || index === 0} onClick={() => moveTargetAsset(asset.id, -1)} style={{ ...tag, marginRight: 0, border: 0, cursor: busy || index === 0 ? "default" : "pointer", opacity: busy || index === 0 ? 0.45 : 1 }}>上移</button>
              <button type="button" disabled={!!busy || index === selectedTargetAssets.length - 1} onClick={() => moveTargetAsset(asset.id, 1)} style={{ ...tag, marginRight: 0, border: 0, cursor: busy || index === selectedTargetAssets.length - 1 ? "default" : "pointer", opacity: busy || index === selectedTargetAssets.length - 1 ? 0.45 : 1 }}>下移</button>
              <button type="button" disabled={!!busy} onClick={() => removeTargetAsset(asset.id)} style={{ ...tag, marginRight: 0, border: 0, cursor: busy ? "default" : "pointer", background: "rgba(58, 32, 48, 0.85)", color: "#ffb3bf", opacity: busy ? 0.45 : 1 }}>移除</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <div className="v5-shell" onPointerMove={trackPointerGlow} style={{ minHeight: "100vh", color: "#e6edf6", fontFamily: "Inter, system-ui, sans-serif" }}>
      {busy && progress && (
        <aside
          aria-live="polite"
          style={{
            position: "fixed",
            left: "max(16px, calc((100vw - 1100px) / 2 - 292px))",
            top: "50%",
            transform: "translateY(-50%)",
            width: 260,
            maxWidth: "calc(100vw - 32px)",
            zIndex: 30,
            border: `1px solid ${accent}`,
            borderRadius: 8,
            padding: 12,
            background: "rgba(8, 22, 35, 0.94)",
            boxShadow: "0 18px 48px rgba(0,0,0,0.36)",
            backdropFilter: "blur(10px)"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", marginBottom: 8 }}>
            <strong style={{ fontSize: 12, color: "#f7fbff" }}>{progressLabelFor(progress.label)}</strong>
            <span style={{ color: "#9fb3d1", fontSize: 11 }}>{progress.step}/{progress.total}</span>
          </div>
          <div style={{ height: 7, borderRadius: 99, background: darkControl, overflow: "hidden" }}>
            <div style={{ width: `${progressPercent}%`, height: "100%", borderRadius: 99, background: accentGradient, transition: "width 180ms ease" }} />
          </div>
          <div style={{ marginTop: 8, color: "#c7d7ee", fontSize: 11, lineHeight: 1.45, ...wrapText }}>{progress.detail}</div>
          <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
            {progressNarrative.map((line) => (
              <div key={line} style={{ color: "#9fb3d1", fontSize: 11, lineHeight: 1.4, ...wrapText }}>{line}</div>
            ))}
          </div>
        </aside>
      )}
      <div className="v5-shell-inner" style={{ maxWidth: 1100, margin: "0 auto", padding: 24, paddingTop: "clamp(172px, 15vw, 214px)", scrollPaddingTop: "clamp(172px, 15vw, 214px)" }}>
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

      <section
        className="v5-status-bar"
        style={{
          ...card,
          position: "fixed",
          top: 0,
          left: "50%",
          width: "min(1100px, calc(100vw - 48px))",
          zIndex: 10000,
          isolation: "isolate",
          transform: "translateX(-50%) translateZ(0)",
          marginBottom: 0,
          background: "rgba(8, 14, 24, 0.96)",
          borderColor: "rgba(0, 215, 255, 0.26)",
          boxShadow: "0 18px 48px rgba(0,0,0,0.46), 0 0 0 1px rgba(255,255,255,0.04) inset",
          backdropFilter: "blur(22px) saturate(1.22)",
          pointerEvents: "none",
          overflow: "visible"
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
          {flowSteps.map((step, index) => {
            const meta = flowStatusMeta(step.status);
            return (
            <div key={step.label} style={{ ...miniPanel, borderColor: meta.border }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <strong style={{ fontSize: 13 }}>{index + 1}. {step.label}</strong>
                <span style={{ ...tag, marginRight: 0, background: meta.bg, color: meta.color }}>{meta.label}</span>
              </div>
              <div style={{ marginTop: 5, color: muted, fontSize: 11 }}>{step.detail}</div>
            </div>
            );
          })}
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
      <section style={card}>
        <h2 style={sectionTitle}>0 · Upload — 样本与目标素材</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
          <div style={{ border: "1px solid #262a33", borderRadius: 8, padding: 12, background: "#0f1117", fontSize: 13 }}>
            <div style={{ fontWeight: 650 }}>上传样本视频</div>
            <input className="v5-file-input" style={{ display: "block", marginTop: 8, width: "100%" }} type="file" accept="video/mp4,video/quicktime,video/*" disabled={!!busy} onChange={(event) => setPendingSampleFiles(Array.from(event.target.files ?? []))} />
            <div style={{ marginTop: 8, color: pendingSampleFiles.length ? "#c7d7ee" : muted, fontSize: 12, ...wrapText }}>{fileSummary(pendingSampleFiles)}</div>
            <button
              style={{ ...btn, marginTop: 10, background: pendingSampleFiles.length ? accentGradient : darkControl, opacity: pendingSampleFiles.length && !busy ? 1 : 0.55 }}
              disabled={!pendingSampleFiles.length || !!busy}
              onClick={() => uploadAssets(pendingSampleFiles, "example_video", () => setPendingSampleFiles([]))}
            >
              Upload
            </button>
          </div>
          <div style={{ border: "1px solid #262a33", borderRadius: 8, padding: 12, background: "#0f1117", fontSize: 13 }}>
            <div style={{ fontWeight: 650 }}>上传目标图片 / 视频素材</div>
            <input className="v5-file-input" style={{ display: "block", marginTop: 8, width: "100%" }} type="file" multiple accept="image/*,video/*,.gif" disabled={!!busy} onChange={(event) => setPendingTargetFiles(Array.from(event.target.files ?? []))} />
            <div style={{ marginTop: 8, color: pendingTargetFiles.length ? "#c7d7ee" : muted, fontSize: 12, ...wrapText }}>{fileSummary(pendingTargetFiles)}</div>
            <button
              style={{ ...btn, marginTop: 10, background: pendingTargetFiles.length ? accentGradient : darkControl, opacity: pendingTargetFiles.length && !busy ? 1 : 0.55 }}
              disabled={!pendingTargetFiles.length || !!busy}
              onClick={() => uploadAssets(pendingTargetFiles, "user_image", () => setPendingTargetFiles([]))}
            >
              Upload
            </button>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "#7c8aa0" }}>{assets.length} 个素材已登记{busy === "upload" ? " · 上传中…" : ""}</div>
      </section>

      <section style={card}>
        <CollapsibleHeader
          collapsed={reviewCollapsed}
          onToggle={() => setReviewCollapsed((v) => !v)}
          collapsedTitle="展开评审证据中心"
          expandedTitle="收起评审证据中心"
          badge={reviewCollapsed ? `${showcaseCases.length} cases · ${exportArtifacts.length} exports` : undefined}
        >
          评审证据中心 — Showcase / 分析 / 协议 / 缺口 / 迁移 / 包装 / 导出
        </CollapsibleHeader>
        {!reviewCollapsed && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {evidenceTabs.map((tab) => (
              <button
                key={tab.value}
                style={{ ...btn, background: reviewTab === tab.value ? accentGradient : darkControl, color: reviewTab === tab.value ? "#fff" : "#9fb3d1", padding: "7px 10px" }}
                onClick={() => setReviewTab(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div style={{ color: muted, fontSize: 11, marginBottom: 12 }}>{evidenceTabs.find((tab) => tab.value === reviewTab)?.description}</div>

          {reviewTab === "showcase" && (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, color: "#9fb3d1" }}>从本地验证包读取的精选成片和 proof sheet。只暴露 allowlist 文件，不暴露配置或密钥。</div>
                <button style={{ ...btn, background: darkControl }} disabled={showcaseLoading} onClick={() => refreshShowcase()}>
                  {showcaseLoading ? "刷新中…" : "刷新 Showcase"}
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
                {showcaseCases.map((item) => {
                  const primaryUrl = absoluteUrl(item.primary?.url);
                  const thumbUrl = absoluteUrl(item.thumbnail?.url);
                  return (
                    <div key={item.id} style={panel}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                        <strong style={{ fontSize: 13, ...wrapText }}>{item.title}</strong>
                        <span style={{ ...tag, marginRight: 0 }}>{item.artifacts.length} files</span>
                      </div>
                      {item.primary?.kind === "video" && primaryUrl ? (
                        <video src={primaryUrl} poster={thumbUrl} controls style={{ width: "100%", aspectRatio: "9 / 16", maxHeight: 260, objectFit: "contain", borderRadius: 8, background: "#000", marginBottom: 8 }} />
                      ) : thumbUrl ? (
                        <img src={thumbUrl} alt={item.title} style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 8, background: "#000", marginBottom: 8 }} />
                      ) : null}
                      <div style={{ color: "#9fb3d1", fontSize: 12, lineHeight: 1.4, ...wrapText }}>{item.description}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                        {item.tags.map((t) => <span key={t} style={tag}>{t}</span>)}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                        {item.artifacts.map((artifact) => (
                          <a key={artifact.id} href={absoluteUrl(artifact.url)} target="_blank" rel="noreferrer" style={{ ...tag, textDecoration: "none", background: artifact.kind === "video" ? "#16243f" : artifact.kind === "image" ? "#16321f" : darkControl }}>
                            {artifact.label}
                          </a>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {showcaseCases.length === 0 && <div style={{ ...panel, color: muted, fontSize: 12 }}>未找到本地 showcase artifact。生成或恢复 `verify_submission/`、`test_runs/`、`marketing_demo/` 后刷新。</div>}
              </div>
            </div>
          )}

          {reviewTab === "learn" && (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ color: "#9fb3d1", fontSize: 12 }}>展示 PDF 要求的基础解析：时长、镜头、字幕/OCR、语音、封面/关键帧、BPM、切换密度。</div>
                <button style={{ ...btn, background: darkControl, opacity: sampleIds.length && !busy ? 1 : 0.5 }} disabled={!sampleIds.length || !!busy} onClick={() => loadSampleReports()}>
                  {sampleReportsLoading ? "读取中…" : "读取已选样本分析"}
                </button>
              </div>
              {selectedReports.map((report) => {
                const ev = report.evidence;
                const rec = report.reconstruction;
                const frames = (ev?.keyFrames ?? []).map((frame) => publicRef(frame.frameRef)).filter((ref): ref is string => Boolean(ref)).slice(0, 6);
                const textItems = (ev?.textEvidence ?? []).slice(0, 5);
                const speechItems = ev?.speechEvidence?.segments?.slice(0, 4) ?? [];
                return (
                  <div key={report.assetId} style={panel}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                      <strong style={{ fontSize: 13 }}>{videoAssets.find((a) => a.id === report.assetId)?.filename ?? report.assetId}</strong>
                      <span style={{ ...tag, marginRight: 0 }}>{ev ? "证据已载入" : "待学习"}</span>
                    </div>
                    {frames.length > 0 && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 6, marginBottom: 10 }}>
                        {frames.map((src, i) => <img key={`${src}-${i}`} src={src} alt={`key frame ${i + 1}`} style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 6, background: "#000" }} />)}
                      </div>
                    )}
                    {report.error && <div style={{ color: "#ffce7a", fontSize: 12 }}>{report.error}</div>}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 10 }}>
                      <div style={miniPanel}>时长<br /><b>{fixed(ev?.video?.durationSec)}s</b></div>
                      <div style={miniPanel}>镜头数<br /><b>{ev?.shots?.length ?? 0}</b></div>
                      <div style={miniPanel}>OCR/字幕<br /><b>{ev?.textEvidence?.length ?? 0}</b></div>
                      <div style={miniPanel}>BPM<br /><b>{fixed(ev?.audioEvidence?.bpm, 0)}</b></div>
                      <div style={miniPanel}>切换密度<br /><b>{ev?.motionEvidence?.cutDensity ?? "n/a"}</b></div>
                      <div style={miniPanel}>占位槽<br /><b>{rec?.placeholders?.length ?? 0}</b></div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                      <div style={miniPanel}>
                        <div style={evHead}>镜头 / 段落</div>
                        {(ev?.shots ?? []).slice(0, 5).map((shot, index) => <div key={`${shot.id}-${index}`}>{shot.startSec.toFixed(1)}-{shot.endSec.toFixed(1)}s · {short(shot.summary, 80)}</div>)}
                        {(ev?.shots ?? []).length === 0 && <div style={{ color: muted }}>尚无镜头证据。</div>}
                      </div>
                      <div style={miniPanel}>
                        <div style={evHead}>OCR / 字幕</div>
                        {textItems.map((text, index) => <div key={`${text.id}-${index}`}>{text.timeSec.toFixed(1)}s · {short(text.text, 80)}</div>)}
                        {textItems.length === 0 && <div style={{ color: muted }}>尚无文字证据。</div>}
                      </div>
                      <div style={miniPanel}>
                        <div style={evHead}>ASR / 语音</div>
                        {speechItems.map((seg, i) => <div key={i}>{seg.startSec.toFixed(1)}-{seg.endSec.toFixed(1)}s · {short(seg.text, 80)}</div>)}
                        {speechItems.length === 0 && <div style={{ color: muted }}>{ev?.speechEvidence?.transcript ? short(ev.speechEvidence.transcript, 120) : "尚无语音证据。"}</div>}
                      </div>
                    </div>
                  </div>
                );
              })}
              {selectedReports.length === 0 && <div style={{ ...panel, color: muted, fontSize: 12 }}>先在 Learn 卡片选择样本视频，或点击上方按钮读取已选样本报告。</div>}
            </div>
          )}

          {reviewTab === "protocol" && (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ color: "#9fb3d1", fontSize: 12 }}>展示可迁移结构协议：模板胶囊、槽位、场景、运动签名、音频配方和质量门禁。</div>
                <button style={{ ...btn, background: darkControl, opacity: activeTemplate ? 1 : 0.5 }} disabled={!activeTemplate || templateDetailLoading} onClick={() => loadTemplateDetail()}>
                  {templateDetailLoading ? "读取中…" : "刷新模板协议"}
                </button>
              </div>
              {activeTemplate ? (
                <div style={panel}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                    <strong style={{ fontSize: 13 }}>{templateDetail?.name ?? activeTemplate.name}</strong>
                    <span style={{ ...tag, marginRight: 0 }}>capsule {activeTemplate.id.slice(0, 12)}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 12 }}>
                    <div style={miniPanel}>槽位<br /><b>{activeTemplate.slotSchema.length}</b></div>
                    <div style={miniPanel}>必填槽<br /><b>{requiredSlots.length}</b></div>
                    <div style={miniPanel}>时长<br /><b>{fixed(activeTemplate.timingSignature?.durationSec)}s</b></div>
                    <div style={miniPanel}>运动覆盖<br /><b>{percent(activeTemplate.motionSignature?.activeMotionCoverage)}</b></div>
                    <div style={miniPanel}>编译<br /><b>{activeTemplate.quality?.compilePassed ? "pass" : "n/a"}</b></div>
                    <div style={miniPanel}>渲染预览<br /><b>{activeTemplate.quality?.renderPreviewPassed ? "pass" : "n/a"}</b></div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 10 }}>
                    <div style={miniPanel}>
                      <div style={evHead}>模板槽位</div>
                      {activeTemplate.slotSchema.slice(0, 16).map((slot, index) => (
                        <div key={`${slot.id}-${index}`} style={{ marginBottom: 5, ...protocolText }}>
                          <b>{slot.originalRole || slot.id}</b> · {slot.kind} · {slot.required ? "required" : "optional"} · {slot.replacementPolicy}
                        </div>
                      ))}
                    </div>
                    <div style={miniPanel}>
                      <div style={evHead}>场景配方</div>
                      {(templateDetail?.sceneRecipes ?? trace?.sample.sceneRecipes ?? []).slice(0, 8).map((scene, i) => (
                        <div key={`${safeText(scene.sectionId ?? (scene as Record<string, unknown>).id, `scene-${i}`, 80)}-${i}`} style={{ marginBottom: 8, ...protocolText }}>
                          {sectionRoleZh(safeText(scene.role, "scene", 40))} · {formatRecipeValue(scene.transitionIn, "transition") || "转场待确认"} · {formatRecipeValue(scene.textAnim ?? (scene as Record<string, unknown>).textAnimation, "text") || "字幕动画待确认"} · 置信度 {fixed(scene.confidence, 2)}
                          <div style={{ color: muted, ...protocolText }}>
                            版式 {formatRecipeValue((scene as Record<string, unknown>).layout, "layout") || "待确认"} · 镜头 {formatRecipeValue((scene as Record<string, unknown>).cameraMove, "camera") || "待确认"}
                          </div>
                        </div>
                      ))}
                      {(templateDetail?.sceneRecipes ?? trace?.sample.sceneRecipes ?? []).length === 0 && <div style={{ color: muted }}>尚无场景配方。</div>}
                    </div>
                    <div style={miniPanel}>
                      <div style={evHead}>音频配方</div>
                      {(templateDetail?.audioRecipes ?? trace?.sample.audioRecipes ?? []).slice(0, 6).map((audio, i) => (
                        <div key={i} style={protocolText}>{safeText(audio.kind, "audio", 40)} · bpm {fixed(audio.bpm, 0)} · {safeText(audio.mood, "mood n/a", 90)}</div>
                      ))}
                      {(templateDetail?.audioRecipes ?? trace?.sample.audioRecipes ?? []).length === 0 && <div style={{ color: muted }}>尚无音频配方。</div>}
                    </div>
                  </div>
                </div>
              ) : <div style={{ ...panel, color: muted, fontSize: 12 }}>还没有模板胶囊。先 Learn 一个样本视频。</div>}
            </div>
          )}

          {reviewTab === "gap" && (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ color: "#9fb3d1", fontSize: 12 }}>按结构槽位解释素材是否足够、缺口影响和补全方式。生成后会合并真实 slot mapping / fill actions。</div>
              {slotRadarRows.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
                  {slotRadarRows.map((row, index) => {
                    const action = trace?.transfer.fillActions.find((fill) => fill.slotId === row.slot.id);
                    const binding = result?.templateInstance?.slotBindings.find((b) => b.slotId === row.slot.id);
                    return (
                      <div key={`${row.slot.id}-${index}`} style={{ ...miniPanel, borderColor: statusColor(binding?.status ?? row.status) }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
                          <strong style={{ fontSize: 12 }}>{row.slot.originalRole || row.slot.id}</strong>
                          <span style={{ ...tag, marginRight: 0, background: statusColor(binding?.status ?? row.status), color: "#fff" }}>{binding?.status ?? row.status}</span>
                        </div>
                        <div style={{ color: "#9fb3d1" }}>{row.slot.kind} · {row.slot.required ? "required" : "optional"} · impact {row.impact}</div>
                        <div style={{ marginTop: 5 }}>strategy: <b>{action?.strategy ?? row.fill}</b></div>
                        <div style={{ marginTop: 5, color: muted }}>{short(action?.reason ?? row.reason, 130)}</div>
                        {binding?.assetId && <div style={{ marginTop: 5, color: "#7fdca0" }}>asset={binding.assetId.slice(0, 16)}</div>}
                      </div>
                    );
                  })}
                </div>
              ) : <div style={{ ...panel, color: muted, fontSize: 12 }}>选择模板后会显示 slot gap board。</div>}
              {(result?.generatedAssets ?? []).length > 0 && (
                <div style={panel}>
                  <div style={evHead}>Generated assets</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {(result?.generatedAssets ?? []).map((asset, i) => <span key={`${asset.slotId ?? "asset"}-${i}`} style={tag}>{asset.slotId ?? "slot"} · {asset.kind ?? "asset"}</span>)}
                  </div>
                </div>
              )}
            </div>
          )}

          {reviewTab === "transfer" && (
            <div style={{ display: "grid", gap: 12 }}>
              {trace ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
                    <div style={panel}>
                      <div style={evHead}>1. 样例结构</div>
                      {(trace.template.knowledgeManifest?.structureHypothesis?.phases ?? []).slice(0, 8).map((phase, index) => (
                        <div key={`${phase.id}-${index}`} style={{ borderLeft: "3px solid #2b6cff", paddingLeft: 8, marginBottom: 8, fontSize: 12 }}>
                          <b>{phase.role}</b> · {phase.startSec.toFixed(1)}-{phase.endSec.toFixed(1)}s
                          <div style={{ color: muted }}>{short(phase.intent ?? phase.visualMethod, 90)}</div>
                        </div>
                      ))}
                    </div>
                    <div style={panel}>
                      <div style={evHead}>2. 新内容映射</div>
                      {trace.transfer.slotMapping.slice(0, 10).map((mapping, index) => (
                        <div key={`${mapping.slotId}-${index}`} style={{ marginBottom: 8, fontSize: 12 }}>
                          <b>{mapping.originalRole ?? mapping.slotId}</b> → {mapping.status}
                          <div style={{ color: muted }}>{mapping.assetId ?? mapping.text ?? mapping.fillReason ?? "no binding"}</div>
                        </div>
                      ))}
                    </div>
                    <div style={panel}>
                      <div style={evHead}>3. 输出时间线</div>
                      {(trace.transfer.timeline?.tracks?.video ?? []).slice(0, 8).map((segment, index) => (
                        <div key={`${segment.segment_id}-${index}`} style={{ marginBottom: 8, fontSize: 12 }}>
                          <b>{segment.start_sec}-{segment.end_sec}s</b> · {segment.structure_slot ?? segment.segment_id}
                          <div style={{ color: muted }}>{segment.transform ?? "transform n/a"}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {(trace.transfer.mapping ?? []).length > 0 && (
                    <div style={panel}>
                      <div style={evHead}>Reference → New content mapping</div>
                      <div style={{ display: "grid", gap: 7 }}>
                        {(trace.transfer.mapping ?? []).slice(0, 12).map((m, index) => (
                          <div key={`${m.reference_slot}-${m.new_content_slot}-${index}`} style={miniPanel}>
                            <b>{m.reference_slot}</b> → <b>{m.new_content_slot}</b>
                            <div style={{ color: muted }}>{m.adaptation_reason} · copy risk {m.copy_risk}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : activeTemplate || latestEvidence || slotRadarRows.length ? (
                <>
                  <div style={{ ...panel, borderColor: "rgba(0, 215, 255, 0.28)" }}>
                    <div style={evHead}>生成前迁移计划</div>
                    <div style={{ color: "#cfe0f5", fontSize: 13, lineHeight: 1.45, ...wrapText }}>
                      当前已加载样例证据和模板胶囊，先展示可执行的迁移交接页；点击生成后会自动替换为真实 transfer trace、slot mapping 和输出时间线。
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}>
                      <span style={tag}>模板 {activeTemplate ? tplLabel(activeTemplate) : "待选择"}</span>
                      <span style={tag}>结构段 {learningTimelineItemsForReview.length || timelineSections.length}</span>
                      <span style={tag}>槽位 {slotRadarRows.length}</span>
                      <span style={tag}>目标素材 {selectedTargetAssets.length}</span>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
                    <div style={panel}>
                      <div style={evHead}>1. 样例结构</div>
                      {learningTimelineItemsForReview.length ? learningTimelineItemsForReview.slice(0, 8).map((item, index) => (
                        <div key={`${item.id}-${index}`} style={{ borderLeft: "3px solid #2b6cff", paddingLeft: 8, marginBottom: 8, fontSize: 12 }}>
                          <b>{item.roleZh}</b> · {fixed(item.startSec)}-{fixed(item.endSec)}s
                          <div style={{ color: muted, ...wrapText }}>{short(item.summary, 110)}</div>
                          <div style={{ marginTop: 4 }}><span style={tag}>{item.beatCount} 节拍</span><span style={tag}>{item.shotCount || 1} 镜头</span></div>
                        </div>
                      )) : (
                        <div style={{ color: muted }}>还没有段落时间线。先读取结构学习报告或重新 Learn。</div>
                      )}
                    </div>
                    <div style={panel}>
                      <div style={evHead}>2. 新内容映射计划</div>
                      {slotRadarRows.length ? slotRadarRows.slice(0, 10).map((row, index) => (
                        <div key={`${row.slot.id}-${index}`} style={{ marginBottom: 8, fontSize: 12 }}>
                          <b>{row.slot.originalRole || row.slot.id}</b> → {row.status}
                          <div style={{ color: muted, ...wrapText }}>{row.asset === "none" ? slotFallbackText(row.slot) : row.asset}</div>
                        </div>
                      )) : (
                        <div style={{ color: muted }}>选择模板后会显示槽位映射计划。</div>
                      )}
                    </div>
                    <div style={panel}>
                      <div style={evHead}>3. 输出时间线草案</div>
                      {timelineSections.length ? timelineSections.slice(0, 8).map((segment, index) => (
                        <div key={`${segment.id}-${index}`} style={{ marginBottom: 8, fontSize: 12 }}>
                          <b>{fixed(segment.startSec)}-{fixed(segment.endSec)}s</b> · {segment.role}
                          <div style={{ color: muted, ...wrapText }}>{short(segment.detail, 100) || "按模板结构复用运动和包装，替换素材/文案。"}</div>
                        </div>
                      )) : (
                        <div style={{ color: muted }}>生成后会落成 final timeline；当前等待学习时间线。</div>
                      )}
                    </div>
                  </div>
                  <div style={panel}>
                    <div style={evHead}>目标素材进入顺序</div>
                    {selectedTargetAssets.length ? (
                      <div style={{ display: "grid", gap: 7 }}>
                        {selectedTargetAssets.slice(0, 8).map((asset, index) => (
                          <div key={`${asset.id}-${index}`} style={miniPanel}>
                            <b>{index + 1}. {asset.filename}</b>
                            <div style={{ color: muted }}>{targetAssetTypeZh(asset.type)} · 优先匹配第 {index + 1} 个兼容视觉槽位</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: muted }}>还没有选择目标素材；生成时会按槽位策略使用 AIGC / 程序化补全。</div>
                    )}
                  </div>
                </>
              ) : <div style={{ ...panel, color: muted, fontSize: 12 }}>生成视频后会显示完整 transfer trace。当前可先查看 Showcase 中的历史 trace。</div>}
            </div>
          )}

          {reviewTab === "packaging" && (
            <div style={{ display: "grid", gap: 12 }}>
              {trace || result ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
                  <div style={panel}>
                    <div style={evHead}>Cover / Preview</div>
                    {absoluteUrl(result?.coverUrl ?? trace?.result.coverUrl) ? (
                      <img src={absoluteUrl(result?.coverUrl ?? trace?.result.coverUrl)} alt="cover" style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 8, background: "#000" }} />
                    ) : <div style={{ color: muted }}>暂无 cover。</div>}
                  </div>
                  <div style={panel}>
                    <div style={evHead}>字幕 / 标题包装</div>
                    <div>字幕 {trace?.transfer.packagingPlan?.subtitles?.count ?? result?.packagingPlan?.subtitles?.count ?? "?"} 条</div>
                    <div>密度 {trace?.transfer.packagingPlan?.subtitles?.density ?? result?.packagingPlan?.subtitles?.density ?? "n/a"}</div>
                    <div>字号 {trace?.transfer.packagingPlan?.subtitles?.recommended_font_px ?? result?.packagingPlan?.subtitles?.recommended_font_px ?? "?"} px</div>
                    <div>对比度 {trace?.transfer.packagingPlan?.subtitles?.contrast_ratio ?? result?.packagingPlan?.subtitles?.contrast_ratio ?? "?"} {(trace?.transfer.packagingPlan?.subtitles?.contrast_ok ?? result?.packagingPlan?.subtitles?.contrast_ok) ? "达标" : "待确认"}</div>
                    {(trace?.transfer.packagingPlan?.title_bar?.text ?? result?.packagingPlan?.title_bar?.text) && <div>标题条: {trace?.transfer.packagingPlan?.title_bar?.text ?? result?.packagingPlan?.title_bar?.text}</div>}
                  </div>
                  <div style={panel}>
                    <div style={evHead}>节拍 / 对话安全</div>
                    <div>BPM {trace?.transfer.beatAlignment?.bpm ?? result?.beatAlignment?.bpm ?? "?"}</div>
                    <div>转场对齐 {trace?.transfer.beatAlignment?.aligned_count ?? result?.beatAlignment?.aligned_count ?? 0}/{trace?.transfer.beatAlignment?.transition_count ?? result?.beatAlignment?.transition_count ?? 0}</div>
                    <div>口播 {String(trace?.transfer.dialoguePlan?.has_real_voiceover ?? result?.dialoguePlan?.has_real_voiceover ?? false)}</div>
                    <div>不安全切点 {(trace?.transfer.dialoguePlan?.unsafe_cuts ?? result?.dialoguePlan?.unsafe_cuts ?? []).length}</div>
                  </div>
                </div>
              ) : activeTemplate || latestEvidence || templateDetail ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
                  <div style={panel}>
                    <div style={evHead}>Cover / Preview 计划</div>
                    {reviewPreviewUrl ? (
                      <img src={reviewPreviewUrl} alt="sample preview" style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 8, background: "#000" }} />
                    ) : (
                      <div style={{ color: muted }}>暂无样例预览图；生成后会展示 final cover。</div>
                    )}
                    <div style={{ marginTop: 8, color: "#9fb3d1", fontSize: 12, ...wrapText }}>生成前使用样例 proof / contact sheet 做包装依据；生成后替换为新视频封面。</div>
                  </div>
                  <div style={panel}>
                    <div style={evHead}>字幕 / 标题包装计划</div>
                    <div>OCR/字幕证据 {learnedSubtitleCount} 条</div>
                    <div>密度 {learnedSubtitleDensity}</div>
                    <div>推荐安全区 底部/中部主视觉外侧，避开边缘 10%</div>
                    <div>推荐字号 48-64 px（9:16 输出按画幅缩放）</div>
                    <div style={{ color: muted, marginTop: 6, ...wrapText }}>
                      {latestReconstruction?.typedSpec?.packaging?.typographySystem ?? (reviewCodeInfo.textLayerCount ? `检测到 ${reviewCodeInfo.textLayerCount} 个文字/字幕代码线索` : "生成后会从 packagingPlan 回填标题条和字幕安全区。")}
                    </div>
                  </div>
                  <div style={panel}>
                    <div style={evHead}>节拍 / 对话安全计划</div>
                    <div>BPM {fixed(learnedBpm, 0)}</div>
                    <div>节拍点 {latestEvidence?.audioEvidence?.beatGridSec?.length ?? templateDetail?.audioRecipes?.[0]?.cuePoints?.length ?? 0}</div>
                    <div>运动峰值 {(latestEvidence?.motionEvidence?.peakMomentsSec ?? []).slice(0, 5).map((time) => `${fixed(time)}s`).join(" / ") || "待确认"}</div>
                    <div>口播 {latestEvidence?.speechEvidence?.hasSpeech ? "有，需要避开语义切断" : "未检测到真实口播"}</div>
                    <div>不安全切点 生成后由 dialoguePlan 回填</div>
                  </div>
                  <div style={panel}>
                    <div style={evHead}>可调包装参数</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {(activeTemplate?.motionSignature?.motifs ?? []).slice(0, 5).map((motif) => <span key={motif} style={tag}>{motif}</span>)}
                      {(activeTemplate?.motionSignature?.transitionTypes ?? []).slice(0, 5).map((transition) => <span key={transition} style={tag}>{transition}</span>)}
                      {reviewCodeInfo.features.slice(0, 6).map((feature) => <span key={feature} style={tag}>{feature}</span>)}
                    </div>
                    <div style={{ marginTop: 8, color: muted, fontSize: 12, ...wrapText }}>
                      品牌色、字幕密度、商品图数量、CTA 时间和节奏可在 Generate / 改片阶段调整；生成后会展示真实 cover、字幕、节拍和对话安全证据。
                    </div>
                  </div>
                </div>
              ) : <div style={{ ...panel, color: muted, fontSize: 12 }}>生成后会展示封面、字幕安全区、标题条、节拍和对话切点证据。</div>}
            </div>
          )}

          {reviewTab === "export" && (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ color: "#9fb3d1", fontSize: 12 }}>下载当前页面已加载的评审证据。缺失项会在生成、读取 trace 或读取模板协议后出现。</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {exportArtifacts.map((item) => (
                  <button key={item.filename} style={{ ...btn, background: darkControl }} onClick={() => downloadJson(item.filename, item.value)}>
                    下载 {item.filename}
                  </button>
                ))}
                {exportArtifacts.length === 0 && <span style={{ color: muted, fontSize: 12 }}>暂无可导出 artifact。</span>}
              </div>
              <div style={panel}>
                <div style={evHead}>当前可导出项</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {exportArtifacts.map((item) => <span key={item.filename} style={tag}>{item.filename}</span>)}
                </div>
              </div>
            </div>
          )}
        </>
        )}
      </section>

      {/* 1. Learn */}
      <section style={card}>
        <CollapsibleHeader
          collapsed={learnCollapsed}
          onToggle={() => setLearnCollapsed((v) => !v)}
          collapsedTitle="展开 Learn"
          expandedTitle="收起 Learn"
          badge={learnCollapsed && sampleIds.length > 0 ? "已选 1 个" : undefined}
        >
          1 · Learn — 选择样本视频
        </CollapsibleHeader>
        {!learnCollapsed && (
        <>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {videoAssets.length === 0 && <span style={{ color: "#7c8aa0" }}>没有可用样本视频（先在 V4 上传，或确认 /api/v5/assets）。</span>}
          {videoAssets.map((a) => (
            <button key={a.id} type="button" aria-pressed={sampleIds.includes(a.id)} onClick={() => selectSingleSample(a.id)} style={{ ...tag, cursor: "pointer", background: sampleIds.includes(a.id) ? accentGradient : darkControl, color: sampleIds.includes(a.id) ? "#fff" : "#9fb3d1", padding: "6px 10px" }}>
              {a.filename}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 8, color: muted, fontSize: 12 }}>
          一次只选择 1 个样本；要从多个视频学习结构，请逐个选择并 Learn，结果会继续写入同一个知识库。
        </div>
        <div style={{ marginTop: 12 }}>
          <button style={{ ...btn, opacity: sampleIds.length && !busy ? 1 : 0.5 }} disabled={!sampleIds.length || !!busy} onClick={learn}>
            {busy === "learn" ? "学习中…" : sampleIds.length ? "Learn 1 个样本" : "先选择样本"}
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
                const reportTemplate = templates.find((template) => template.sourceSampleId === report.assetId);
                const reportDetail = reportTemplate ? templateDetailsById[reportTemplate.id] ?? (templateDetail?.id === reportTemplate.id ? templateDetail : undefined) : undefined;
                const codeInfo = codeBundleInfo(reportDetail?.codeBundle);
                const frames = (ev?.keyFrames ?? []).map((frame) => publicRef(frame.frameRef)).filter((ref): ref is string => Boolean(ref)).slice(0, 4);
                const scenes = rec?.typedSpec?.scenes ?? [];
                const sections = reportDetail?.timingSignature?.sections ?? scenes.map((scene) => ({ id: scene.id, role: scene.role, startSec: scene.startSec, endSec: scene.endSec, internalBeats: [] }));
                const recipes = reportDetail?.sceneRecipes ?? [];
                const timelineItems = buildLearningTimeline(ev, rec, reportDetail);
                const timelineTotalSec = Math.max(
                  ev?.video?.durationSec ?? 0,
                  rec?.typedSpec?.composition?.durationSec ?? 0,
                  reportDetail?.timingSignature?.durationSec ?? 0,
                  ...timelineItems.map((item) => item.endSec)
                );
                const slots = reportDetail?.slotSchema ?? reportTemplate?.slotSchema ?? [];
                const candidates = report.elements?.candidates ?? [];
                const decisions = report.elements?.decisions ?? [];
                const mediaSlots = slots.filter((slot) => /image|video|logo|mockup/.test(slot.kind));
                const textSlots = slots.filter((slot) => /headline|subtitle|cta|text/.test(slot.kind));
                const audioSlots = slots.filter((slot) => /music|voice|sfx|audio/.test(slot.kind));
                const safety = reportDetail?.safety ?? rec?.safety;
                const sourceName = videoAssets.find((a) => a.id === report.assetId)?.filename ?? report.assetId;
                const fingerprint = buildStructureFingerprint(timelineItems, slots, codeInfo);
                const confidence = buildLearningConfidence(ev, rec, reportDetail, timelineItems, codeInfo);
                const migrationFit = migrationFitFor(slots, codeInfo, ev);
                const missingNeeds = missingLearningNeeds(ev, rec, reportDetail, slots, codeInfo);
                const preChecks = buildPreGenerationChecks(ev, rec, reportDetail, slots, timelineItems);
                const boundaryRows = reusableBoundaryRows(safety);
                const knowledgeSummary = buildKnowledgeWriteSummary(candidates, decisions);
                return (
                  <div key={report.assetId} style={panel}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8, alignItems: "center" }}>
                      <strong style={{ fontSize: 13, ...wrapText }}>{sourceName}</strong>
                      <span style={{ ...tag, marginRight: 0 }}>{ev ? "证据已载入" : "待学习"}</span>
                    </div>
                    {frames.length > 0 && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))", gap: 6, marginBottom: 10 }}>
                        {frames.map((src, i) => (
                          <img key={`${src}-${i}`} src={src} alt={`样本关键帧 ${i + 1}`} style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 6, background: "#000" }} />
                        ))}
                      </div>
                    )}
                    <div style={{ ...miniPanel, marginBottom: 10, background: "linear-gradient(135deg, rgba(0,215,255,0.11), rgba(255,45,85,0.06)), rgba(17,24,39,0.72)" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={evHead}>一句话结构结论</div>
                          <div style={{ color: "#f7fbff", fontSize: 15, fontWeight: 800, lineHeight: 1.35, ...wrapText }}>{fingerprint}</div>
                          <div style={{ marginTop: 9, color: "#9fb3d1", fontSize: 12, lineHeight: 1.45 }}>
                            这条样例学到的是“创作方法”：段落顺序、镜头/字幕/BGM 卡点、运动包装和可替换槽位；原始画面、原文案和原音频不进入新视频。
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
                            {migrationFit.fit.map((item) => <span key={item} style={{ ...tag, background: "#16321f", color: "#7fdca0" }}>{item}</span>)}
                            {migrationFit.avoid.map((item) => <span key={item} style={{ ...tag, background: "#3a2030", color: "#ffb3bf" }}>不建议 {item}</span>)}
                          </div>
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={evHead}>学习置信度</div>
                          <div style={{ display: "grid", gap: 7 }}>
                            {confidence.map((score) => (
                              <div key={score.label} style={{ display: "grid", gridTemplateColumns: "44px 1fr 38px", gap: 8, alignItems: "center", fontSize: 11 }}>
                                <span style={{ color: "#cfe0f5", fontWeight: 700 }}>{score.label}</span>
                                <span style={{ height: 7, borderRadius: 99, background: "rgba(148,163,184,0.14)", overflow: "hidden" }}>
                                  <span style={{ display: "block", width: `${score.value}%`, height: "100%", background: score.value >= 75 ? accentGradient : score.value >= 55 ? "#ffce7a" : "#ff7a90" }} />
                                </span>
                                <b style={{ color: "#eaf2ff" }}>{score.value}%</b>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    {missingNeeds.length > 0 && (
                      <div style={{ ...miniPanel, marginBottom: 10, borderColor: "rgba(255,206,122,0.34)", background: "rgba(58,47,18,0.28)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ ...evHead, color: "#ffce7a" }}>缺失信息 / 需要模型补读</div>
                            <div style={{ color: "#ffd98a", fontSize: 12, lineHeight: 1.45, ...wrapText }}>{missingNeeds.slice(0, 3).join("；")}</div>
                          </div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            {reportTemplate && !reportDetail && (
                              <button style={{ ...btn, background: darkControl }} disabled={templateDetailLoading} onClick={() => loadTemplateDetail(reportTemplate.id)}>
                                读取模板细节
                              </button>
                            )}
                            <button style={{ ...btn, background: darkControl, opacity: busy ? 0.55 : 1 }} disabled={!!busy} onClick={learn}>
                              重新 Learn 补读
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    <LearningTimeline items={timelineItems} totalSec={timelineTotalSec} />
                    {report.error && <div style={{ color: "#ffce7a", fontSize: 12 }}>{report.error}</div>}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 6, fontSize: 11, marginBottom: 10 }}>
                      <div style={miniPanel}>时长<br /><b>{fixed(ev?.video?.durationSec)}s</b></div>
                      <div style={miniPanel}>镜头数<br /><b>{ev?.shots?.length ?? 0}</b></div>
                      <div style={miniPanel}>BPM<br /><b>{fixed(ev?.audioEvidence?.bpm, 0)}</b></div>
                      <div style={miniPanel}>字幕/OCR<br /><b>{ev?.textEvidence?.length ?? 0}</b></div>
                      <div style={miniPanel}>槽位<br /><b>{slots.length}</b></div>
                      <div style={miniPanel}>知识决策<br /><b>{decisions.length}</b></div>
                    </div>
                    <div style={{ ...miniPanel, marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                        <div style={evHead}>槽位需求表：生成前资产交接</div>
                        <span style={{ ...tag, marginRight: 0 }}>{slots.length} 槽位 · {slots.filter((slot) => slot.required).length} 必填 · 媒体 {mediaSlots.length} · 文案 {textSlots.length} · 音频 {audioSlots.length}</span>
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse", fontSize: 11 }}>
                          <thead>
                            <tr style={{ color: "#cfe0f5", textAlign: "left", borderBottom: "1px solid rgba(148,163,184,0.18)" }}>
                              <th style={{ padding: "6px 7px" }}>槽位</th>
                              <th style={{ padding: "6px 7px" }}>原样例作用</th>
                              <th style={{ padding: "6px 7px" }}>新视频需要什么</th>
                              <th style={{ padding: "6px 7px" }}>缺失时策略</th>
                            </tr>
                          </thead>
                          <tbody>
                            {slots.slice(0, 10).map((slot, index) => (
                              <tr key={`${slot.id}-${index}`} style={{ borderBottom: "1px solid rgba(148,163,184,0.10)" }}>
                                <td style={{ padding: "7px", color: "#eaf2ff", fontWeight: 800, ...wrapText }}>{slot.id}</td>
                                <td style={{ padding: "7px", color: "#cfe0f5", ...wrapText }}>{slot.originalRole || slotKindZh(slot.kind)} · {slot.required ? "必填" : "可选"}</td>
                                <td style={{ padding: "7px", color: "#9fb3d1", ...wrapText }}>{slotNeedText(slot)}</td>
                                <td style={{ padding: "7px", color: "#9fb3d1", ...wrapText }}>{slotFallbackText(slot)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {slots.length === 0 && <div style={{ color: muted, fontSize: 12, padding: "8px 0" }}>还没有 slot schema，需要重新 Learn 或读取模板细节。</div>}
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 8, fontSize: 12 }}>
                      <div style={miniPanel}>
                        <div style={evHead}>可复用 / 不可复用边界</div>
                        <div style={{ display: "grid", gap: 6 }}>
                          {boundaryRows.map((row) => (
                            <div key={row.type} style={{ display: "grid", gridTemplateColumns: "82px 58px 1fr", gap: 7, alignItems: "start" }}>
                              <b style={{ color: "#eaf2ff" }}>{row.type}</b>
                              <span style={{ color: row.reusable === "可复用" ? "#7fdca0" : "#ffce7a", fontWeight: 800 }}>{row.reusable}</span>
                              <span style={{ color: muted, ...wrapText }}>{row.method}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={miniPanel}>
                        <div style={evHead}>生成前一致性检查</div>
                        <div style={{ display: "grid", gap: 6 }}>
                          {preChecks.map((check) => (
                            <div key={check.label} style={{ display: "grid", gridTemplateColumns: "22px minmax(110px, 0.85fr) 1fr", gap: 6, alignItems: "start" }}>
                              <span>{checkMark(check.status)}</span>
                              <b style={{ color: checkColor(check.status) }}>{check.label}</b>
                              <span style={{ color: muted, ...wrapText }}>{check.detail}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={miniPanel}>
                        <div style={evHead}>迁移建议</div>
                        <div style={{ color: "#dbeafe", fontWeight: 800, marginBottom: 5 }}>方案 A：高质感科技商品</div>
                        <div style={{ color: muted, ...wrapText }}>保留黑底/光效/关键词节奏，替换为用户商品图；CTA 可提前到中后段，适合耳机、App、键盘、智能硬件。</div>
                        <div style={{ color: "#dbeafe", fontWeight: 800, margin: "9px 0 5px" }}>方案 B：SaaS 功能发布</div>
                        <div style={{ color: muted, ...wrapText }}>保留证明段、界面网格和数据卡片包装，替换为产品后台截图；素材不足时用数据卡片或 AIGC 界面补全。</div>
                      </div>
                      <div style={miniPanel}>
                        <div style={evHead}>知识库写入结果</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 7 }}>
                          {knowledgeSummary.counts.map((item) => <span key={item} style={tag}>{item}</span>)}
                        </div>
                        {knowledgeSummary.created.length > 0 && <div style={{ color: muted, ...wrapText }}>新增：{knowledgeSummary.created.join(" / ")}</div>}
                        {knowledgeSummary.merged.map((decision, index) => (
                          <div key={`merged-${decision.id ?? index}`} style={{ color: muted, marginTop: 5, ...wrapText }}>{decisionActionZh(decision.action)}：{decision.assignedName ?? decision.targetElementId ?? "已有结构"} · {decisionReasonZh(decision.reason)}</div>
                        ))}
                        {knowledgeSummary.skipped.map((decision, index) => (
                          <div key={`skipped-${decision.id ?? index}`} style={{ color: muted, marginTop: 5, ...wrapText }}>{decisionActionZh(decision.action)}：{decision.assignedName ?? decision.targetElementId ?? "重复结构"} · {decisionReasonZh(decision.reason)}</div>
                        ))}
                      </div>
                      <div style={miniPanel}>
                        <div style={evHead}>Remotion 模板能力</div>
                        {reportDetail ? (
                          <>
                            <div><b>可生成模板：</b>{reportDetail.quality?.compilePassed === false ? "需修复" : "已生成"} · {codeOriginZh((reportDetail.quality as Record<string, unknown> | undefined)?.codeOrigin)}</div>
                            <div style={{ marginTop: 6, color: muted, ...wrapText }}>
                              动画能力：{codeInfo.features.slice(0, 6).join(" / ") || "待读取"}；可调参数：品牌色、节奏、字幕密度、商品图数量、CTA 时间。
                            </div>
                            <details style={{ marginTop: 8, color: muted }}>
                              <summary style={{ cursor: "pointer", color: "#cfe0f5", fontWeight: 800 }}>展开工程细节</summary>
                              <div style={{ marginTop: 6, ...wrapText }}>组件 {codeInfo.componentName} · 入口 {codeInfo.entryFile} · 文件 {codeInfo.fileCount} 个 · 约 {codeInfo.lineCount} 行</div>
                              <div style={{ marginTop: 4, ...wrapText }}>读出：{codeInfo.sequenceCount} 个分段 · {codeInfo.textLayerCount} 个文字线索 · {codeInfo.mediaLayerCount} 个媒体线索 · {codeInfo.animationExpressionCount} 个动画表达式</div>
                              <div style={{ marginTop: 4, ...wrapText }}>段落 {sections.length} · 场景配方 {recipes.length} · 文件 {codeInfo.paths.join(" / ") || "n/a"}</div>
                            </details>
                          </>
                        ) : reportTemplate ? (
                          <button style={{ ...btn, background: darkControl, marginTop: 4 }} disabled={templateDetailLoading} onClick={() => loadTemplateDetail(reportTemplate.id)}>
                            {templateDetailLoading ? "读取中…" : "读取 Remotion 模板细节"}
                          </button>
                        ) : (
                          <div style={{ color: muted }}>还没有对应模板胶囊；先 Learn 该样本。</div>
                        )}
                      </div>
                      <div style={miniPanel}>
                        <div style={evHead}>样本结构证据摘要</div>
                        <div style={{ color: "#dbeafe", ...wrapText }}>
                          {sectionRoleZh(scenes[0]?.role ?? sections[0]?.role)}：{short(scenes[0]?.intent ?? ev?.shots?.[0]?.summary ?? "尚无开头摘要", 120)}
                        </div>
                        <div style={{ marginTop: 6, color: muted, ...wrapText }}>
                          剪辑密度 {tokenZh(ev?.motionEvidence?.cutDensity, "未知")} · {ev?.audioEvidence?.beatGridSec?.length ?? 0} 个节拍点 · 运动峰值 {(ev?.motionEvidence?.peakMomentsSec ?? []).slice(0, 4).map((t) => `${t.toFixed(1)}s`).join(" / ") || "n/a"}。
                        </div>
                        {(reportDetail?.quality?.warnings ?? rec?.reconstructionQuality?.warnings ?? []).slice(0, 2).map((warning, index) => (
                          <div key={`${warning}-${index}`} style={{ marginTop: 5, color: "#ffce7a", ...wrapText }}>{warning}</div>
                        ))}
                      </div>
                    </div>
                    <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 4 }}>
                      <span style={tag}>剪辑密度 {tokenZh(ev?.motionEvidence?.cutDensity, "未知")}</span>
                      <span style={tag}>节拍 {ev?.audioEvidence?.beatGridSec?.length ?? 0}</span>
                      <span style={tag}>占位槽 {rec?.placeholders?.length ?? 0}</span>
                      <span style={tag}>知识决策 {decisions.length}</span>
                      {reportTemplate && <span style={tag}>模板 {reportTemplate.id.slice(0, 12)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </>
        )}
      </section>

      {/* 1.5 Template library — learned capsules with a primary "Start from this template" CTA. */}
      {templates.length > 0 && (
        <section style={card}>
          <CollapsibleHeader
            collapsed={templateLibraryCollapsed}
            onToggle={() => setTemplateLibraryCollapsed((v) => !v)}
            collapsedTitle="展开模板库"
            expandedTitle="收起模板库"
            badge={templateLibraryCollapsed && activeTemplate ? `当前 ${tplLabel(activeTemplate)}` : undefined}
          >
            模板库 — {templates.length} 个可复用 Remotion 模板
          </CollapsibleHeader>
          {!templateLibraryCollapsed && (
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
          )}
        </section>
      )}

      <section style={card}>
        <CollapsibleHeader
          collapsed={kbExplorerCollapsed}
          onToggle={() => setKbExplorerCollapsed((v) => !v)}
          collapsedTitle="展开知识库"
          expandedTitle="收起知识库"
        >
          Knowledge Base — {kbFiltered.length}/{kb.length} 条可复用知识
        </CollapsibleHeader>
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
                {group.elements.map((e, index) => (
                  <div key={`${e.id}-${index}`} style={{ border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: 8, padding: 10, background: "rgba(11, 18, 32, 0.62)", minWidth: 0, overflow: "hidden" }}>
                    <div style={{ fontSize: 13, fontWeight: 650, lineHeight: 1.25, ...wrapText }}>{e.name}</div>
                    <div style={{ marginTop: 5 }}>
                      <span style={tag}>{e.kind}</span>
                      {e.subcategory && <span style={tag}>{e.subcategory}</span>}
                      <span style={tag}>{e.reusablePolicy}</span>
                      <span style={tag}>{kbStatusFor(e)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#9fb3d1", marginTop: 7, lineHeight: 1.35, ...wrapText }}>{short(e.description, 110)}</div>
                    <div style={{ fontSize: 10, color: "#54607a", marginTop: 7, lineHeight: 1.3, ...wrapText }}>来源={e.source.sourceSampleId.slice(0, 10)} · 证据={(e.source.evidenceRefs ?? []).slice(0, 2).join(", ") || "暂无"}</div>
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
        <CollapsibleHeader
          collapsed={generateCollapsed}
          onToggle={() => setGenerateCollapsed((v) => !v)}
          collapsedTitle="展开 Generate"
          expandedTitle="收起 Generate"
          badge={generateCollapsed ? (genMode === "same_template" ? "同模板生成" : "混合元素") : undefined}
        >
          2 · Generate — 模板 + 主题 + 自动补全
        </CollapsibleHeader>
        {!generateCollapsed && (
        <>

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
                  {activeTemplate.slotSchema.map((s, index) => (
                    <span key={`${s.id}-${index}`} title={`${s.originalRole} · ${s.replacementPolicy} · ${s.propPath ?? ""}`} style={{ ...tag, background: s.required ? accentSoft : darkControl, color: s.required ? "#b8f4ff" : "#9fb3d1", border: s.required ? `1px solid ${accent}` : "1px solid rgba(148, 163, 184, 0.16)" }}>
                      {s.kind} · {expectedAssetTypeZhForSlot(s)}{s.required ? " *" : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <label style={{ fontSize: 13 }}>新主题<input value={theme} onChange={(e) => setTheme(e.target.value)} style={{ width: "100%", marginTop: 4, padding: 8, background: "rgba(11, 18, 32, 0.76)", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 6, color: "#e6edf6" }} /></label>
            <label style={{ fontSize: 13 }}>卖点（逗号分隔）<input value={sellingPoints} onChange={(e) => setSellingPoints(e.target.value)} style={{ width: "100%", marginTop: 4, padding: 8, background: "rgba(11, 18, 32, 0.76)", border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 6, color: "#e6edf6" }} /></label>
            <div style={{ ...miniPanel, padding: 10 }}>
              <div
                role="button"
                aria-expanded={!targetAssetsCollapsed}
                tabIndex={0}
                title={targetAssetsCollapsed ? "展开目标素材" : "收起目标素材"}
                onClick={() => setTargetAssetsCollapsed((v) => !v)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setTargetAssetsCollapsed((v) => !v);
                  }
                }}
                style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", userSelect: "none", minWidth: 0 }}
              >
                <span style={triangleBtn}>{targetAssetsCollapsed ? "▸" : "▾"}</span>
                <span style={{ fontSize: 13, fontWeight: 700, flex: "1 1 auto", ...wrapText }}>你的目标素材（可选，没有就让 AI 补全）</span>
                <span style={{ ...tag, marginRight: 0, background: targetIds.length ? accentSoft : darkControl }}>
                  {targetIds.length ? `已选 ${targetIds.length}` : targetAssets.length ? `${targetAssets.length} 个可选` : "AI 全补"}
                </span>
              </div>
              {!targetAssetsCollapsed && (
                <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  {targetAssets.length === 0 && <span style={{ color: "#7c8aa0", fontSize: 12 }}>没有目标素材 — AI 将补全所有必填槽位。</span>}
                  {targetAssets.map((a) => (
                    <button key={a.id} onClick={() => toggleTargetAsset(a.id)} style={{ ...tag, cursor: "pointer", background: targetIds.includes(a.id) ? accentGradient : darkControl, color: targetIds.includes(a.id) ? "#fff" : "#9fb3d1", padding: "6px 10px" }}>
                      {a.filename} · {targetAssetTypeZh(a.type)}
                    </button>
                  ))}
                </div>
                {selectedTargetOrderPanel}
                </>
              )}
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
                      {slotRadarRows.map((row, index) => {
                        const assignedId = slotAssignments[row.slot.id];
                        const assignedName = assignedId ? assets.find((a) => a.id === assignedId)?.filename ?? "已上传" : null;
                        return (
                          <tr key={`${row.slot.id}-${index}`}>
                            <td style={{ padding: "7px 8px", borderBottom: "1px solid #1d2430", fontWeight: 650 }}>{row.slot.originalRole || row.slot.id}</td>
                            <td style={{ padding: "7px 8px", borderBottom: "1px solid #1d2430", color: "#9fb3d1" }}>
                              {slotKindZh(row.slot.kind)} · {expectedAssetTypeZhForSlot(row.slot)}{row.slot.required ? " · 必填" : " · 可选"}
                            </td>
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
                                slotUploadAccept(row.slot) ? (
                                  <label style={{ ...tag, marginRight: 0, cursor: busy ? "default" : "pointer", background: darkControl, color: "#9fb3d1", opacity: busy ? 0.5 : 1 }} title={`只接受${expectedAssetTypeZhForSlot(row.slot)}素材`}>
                                    ＋ 上传{expectedAssetTypeZhForSlot(row.slot)}
                                    <input type="file" accept={slotUploadAccept(row.slot)} disabled={!!busy} style={{ display: "none" }} onChange={(e) => assignSlotAsset(row.slot.id, e.target.files)} />
                                  </label>
                                ) : (
                                  <span style={{ color: muted }}>自动生成</span>
                                )
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

              {/* 生成方式：LLM 智能改写 vs 预设模板 */}
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                {([
                  ["llm", "🤖 LLM 智能改写", "AI 拿 主题+卖点+自定义需求+所选预设，直接改写 Remotion 代码（死规则仅在 AI 失败时兜底）"],
                  ["preset", "🎚️ 预设模板", "确定性预设旋钮（高点击 / 高转化 / 高质感），可一次出三版"]
                ] as const).map(([val, label, desc]) => (
                  <button
                    key={val}
                    disabled={!!busy}
                    title={desc}
                    onClick={() => { setGenerationMethod(val); if (val === "llm") setGenerateAllVariants(false); }}
                    style={{ ...btn, flex: 1, justifyContent: "center", background: generationMethod === val ? accentGradient : darkControl, color: generationMethod === val ? "#fff" : "#9fb3d1" }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div style={{ fontSize: 12, color: "#9fb3d1", fontWeight: 600, marginBottom: 6 }}>
                {generationMethod === "llm" ? "风格提示（可选，喂给 LLM）" : "预设调整模板"}
              </div>
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

              {generationMethod === "preset" && (
                <>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 10, width: "fit-content", fontSize: 12, color: "#9fb3d1", border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: 6, padding: "6px 8px", background: "rgba(17, 24, 39, 0.72)" }}>
                    <input type="checkbox" className="v5-checkbox" style={checkboxStyle} checked={generateAllVariants} disabled={!!busy} onChange={(e) => setGenerateAllVariants(e.target.checked)} />
                    一次生成三个预设版本（高点击 / 高转化 / 高质感）
                  </label>
                  <div style={{ fontSize: 11, color: "#7c8aa0", marginTop: 6 }}>
                    {generateAllVariants ? "会连续生成 3 个版本，并在 Variant Gallery 中对比。" : selectedVariantMeta?.description ?? "未选预设：使用中性默认（不套用预设旋钮）。再次点击已选按钮可取消选择。"}
                  </div>
                </>
              )}

              {generationMethod === "llm" && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(148, 163, 184, 0.14)" }}>
                  <div style={{ fontSize: 12, color: "#9fb3d1", fontWeight: 600, marginBottom: 4 }}>自定义需求（自然语言）</div>
                  <div style={{ fontSize: 11, color: "#7c8aa0", marginBottom: 6 }}>描述你想要的版本，LLM 会拿 <b>主题 + 卖点 + 所选预设 + 这段需求</b> 一次直接改写模板代码（不再先转成结构化 patch）。下方「{generationMethod === "llm" ? "按 LLM 改写生成" : "生成"}」按钮即用它。</div>
                  <textarea
                    value={customRequest}
                    onChange={(e) => setCustomRequest(e.target.value)}
                    disabled={!!busy}
                    rows={2}
                    placeholder="例如：开头三秒更抓人，字幕更少，配色更高级，把 CTA 提前，清掉残留的英文/运动鞋文案"
                    style={{ width: "100%", boxSizing: "border-box", background: "rgba(17, 24, 39, 0.72)", color: "#e6edf6", border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: 6, padding: 8, fontSize: 12, resize: "vertical" }}
                  />
                </div>
              )}
            </div>

            <button title={busy ? "正在生成 / 学习中，请等当前任务完成" : (!templates.length && !templateId) ? "请先在「2 · 结构学习」学习一个样例，或在上方模板库选择一个模板" : "用当前模板 + 主题 + 已选素材生成视频"} style={{ ...btn, opacity: (templates.length || templateId) && !busy ? 1 : 0.5 }} disabled={(!templates.length && !templateId) || !!busy} onClick={generationMethod === "preset" && generateAllVariants ? generateVariants : generate}>
              {busy === "generate"
                ? "生成中…（含渲染可能数十秒）"
                : busy === "variants"
                  ? "生成三版本中…"
                  : generationMethod === "llm"
                    ? `🤖 按 LLM 改写生成${customRequest.trim() ? "（含自定义需求）" : ""}`
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
                  {kbFiltered.map((e, index) => (
                    <div key={`${e.id}-${index}`} onClick={() => toggle(selectedEls, setSelectedEls, e.id)} style={{ border: `1px solid ${selectedEls.includes(e.id) ? accent : "rgba(148, 163, 184, 0.16)"}`, borderRadius: 8, padding: 10, cursor: "pointer", background: selectedEls.includes(e.id) ? accentSoft : "rgba(11, 18, 32, 0.62)", minWidth: 0, overflow: "hidden" }}>
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
            <div style={{ ...miniPanel, padding: 10 }}>
              <div
                role="button"
                aria-expanded={!targetAssetsCollapsed}
                tabIndex={0}
                title={targetAssetsCollapsed ? "展开目标素材" : "收起目标素材"}
                onClick={() => setTargetAssetsCollapsed((v) => !v)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setTargetAssetsCollapsed((v) => !v);
                  }
                }}
                style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", userSelect: "none", minWidth: 0 }}
              >
                <span style={triangleBtn}>{targetAssetsCollapsed ? "▸" : "▾"}</span>
                <span style={{ fontSize: 13, fontWeight: 700, flex: "1 1 auto", ...wrapText }}>目标素材</span>
                <span style={{ ...tag, marginRight: 0, background: targetIds.length ? accentSoft : darkControl }}>
                  {targetIds.length ? `已选 ${targetIds.length}` : targetAssets.length ? `${targetAssets.length} 个可选` : "未提供"}
                </span>
              </div>
              {!targetAssetsCollapsed && (
                <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  {targetAssets.length === 0 && <span style={{ color: "#7c8aa0", fontSize: 12 }}>没有目标素材。</span>}
                  {targetAssets.map((a) => (
                    <button key={a.id} onClick={() => toggleTargetAsset(a.id)} style={{ ...tag, cursor: "pointer", background: targetIds.includes(a.id) ? accentGradient : darkControl, color: targetIds.includes(a.id) ? "#fff" : "#9fb3d1", padding: "6px 10px" }}>
                      {a.filename} · {targetAssetTypeZh(a.type)}
                    </button>
                  ))}
                </div>
                {selectedTargetOrderPanel}
                </>
              )}
            </div>
            <button style={{ ...btn, opacity: kb.length && !busy ? 1 : 0.5 }} disabled={!kb.length || !!busy} onClick={generate}>
              {busy === "generate" ? "生成中…（含渲染可能数十秒）" : "Mix & Generate video"}
            </button>
          </div>
        )}
        </>
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
                  {v.scorecard.gates.filter((g) => g.status === "pass").length}/{v.scorecard.gates.length} 门禁通过 · {v.usedTemplateCode ? "模板代码" : "兜底方案"}
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
            {result.finalProgram?.fallbackUsed && <span style={{ ...tag, marginLeft: 4, background: "#3a2f12", color: "#ffce7a" }}>兜底</span>}
          </h2>

          {/* same_template provenance badges */}
          {result.generationMode === "same_template" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              <span style={{ ...tag, background: result.usedTemplateCode ? "#16321f" : "#3a2030", color: result.usedTemplateCode ? "#7fdca0" : "#ffb3bf" }}>
                {result.usedTemplateCode ? "✓ 用模板代码渲染 (bespoke_codegen)" : "✗ 未用模板代码"}
              </span>
              {result.usedFallbackRenderer && <span style={{ ...tag, background: "#3a2f12", color: "#ffce7a" }}>兜底渲染器</span>}
              {result.templateCapsuleId && <span style={{ ...tag }}>capsule={result.templateCapsuleId.slice(0, 12)}</span>}
            </div>
          )}

          <div style={{ ...panel, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 9, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 13 }}>生成后一致性检查</strong>
              <span style={{ ...tag, marginRight: 0 }}>timeline / slot / final video</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, fontSize: 12 }}>
              {resultConsistencyChecks.map((check) => (
                <div key={check.label} style={{ ...miniPanel, borderColor: check.status === "pass" ? "rgba(31,157,85,0.48)" : check.status === "warn" ? "rgba(255,206,122,0.42)" : "rgba(214,50,74,0.48)" }}>
                  <div style={{ display: "flex", gap: 7, alignItems: "center", color: checkColor(check.status), fontWeight: 800 }}>
                    <span>{checkMark(check.status)}</span>
                    <span>{check.label}</span>
                  </div>
                  <div style={{ marginTop: 5, color: muted, ...wrapText }}>{check.detail}</div>
                </div>
              ))}
            </div>
          </div>

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
                      key={`${section.id}-${index}`}
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
                  {(trace.template.knowledgeManifest?.structureHypothesis?.phases ?? []).slice(0, 8).map((p, index) => (
                    <div key={`${p.id}-${index}`} style={{ borderLeft: "3px solid #2b6cff", paddingLeft: 8, fontSize: 12 }}>
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
                  {trace.transfer.slotMapping.slice(0, 14).map((m, index) => (
                    <div key={`${m.slotId}-${index}`} style={{ border: "1px solid #262a33", borderRadius: 6, padding: 8, fontSize: 12, background: "#11151d" }}>
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
                  {trace.transfer.usedKnowledgeElements.slice(0, 8).map((e, index) => <span key={`${e.id}-${index}`} title={(e.evidenceRefs ?? []).join(", ")} style={tag}>{knowledgeKindZh(e.kind)}</span>)}
                </div>
                {(trace.transfer.targetAssetProfiles ?? []).length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>用户素材理解 {trace.transfer.targetAssetProfiles?.some((p) => p.vlmAnalyzed) ? "（VLM 看像素）" : "（启发式）"}</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {(trace.transfer.targetAssetProfiles ?? []).slice(0, 8).map((p, index) => (
                        <div key={`${p.assetId}-${index}`} style={{ border: "1px solid #262a33", borderRadius: 6, padding: 7, fontSize: 11, background: "#11151d" }}>
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
                  {(trace.transfer.gapReport?.gaps ?? []).slice(0, 8).map((g, index) => (
                    <div key={`${g.slotId}-${index}`}>{g.slotId}: {g.status} → {g.selectedRepair} · impact={g.impact}</div>
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
                        {(trace.transfer.timeline.tracks?.video ?? []).slice(0, 6).map((v, index) => <div key={`${v.segment_id}-${index}`}>{v.start_sec}-{v.end_sec}s · {v.structure_slot} · {v.transform}</div>)}
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
                    {(trace.transfer.materialAnalysis ?? []).map((ma, index) => (
                      <div key={`${ma.asset_id}-${index}`} style={evCard}>
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
                    {result.templateInstance.slotBindings.map((b, index) => (
                      <span key={`${b.slotId}-${index}`} title={b.warnings.join("; ")} style={{ ...tag, background: b.status === "missing" || b.status === "unresolved" ? "#3a2030" : b.status.includes("generated") || b.status === "aigc_filled" ? "#16243f" : "#1d2430" }}>
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
                    {result.composition.sections.map((s, index) => (
                      <span key={`${s.id}-${index}`} style={{ ...tag, background: "#1d2430" }}>{s.role} {s.startSec}-{s.endSec}s{s.plannedText ? `: ${s.plannedText}` : ""}</span>
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
                    {result.naturalLanguageInstruction && <div>改片请求：{result.naturalLanguageInstruction}</div>}
                    {result.patchNotes?.map((note, i) => <div key={i}>改动说明：{note}</div>)}
                    {result.generatedPatch && (
                      <div style={{ display: "grid", gap: 5, marginTop: 8 }}>
                        {Object.entries(result.generatedPatch).map(([key, value]) => (
                          <div key={key} style={{ ...miniPanel, padding: 8 }}>
                            <b>{patchFieldZh(key)}</b>：{safeText(value, "已设置", 100)}
                          </div>
                        ))}
                      </div>
                    )}
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
