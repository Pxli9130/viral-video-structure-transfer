// apps/web/src/v5/V5Dashboard.tsx
// Self-contained spec_v5 demo dashboard driving /api/v5/*. Mounted via the #v5 hash route so it does
// not touch the V4 App. Flow: pick sample assets -> Learn -> browse KB -> select elements + target
// assets + brief -> Generate -> see composition / gap / scorecard / final video.
import { useCallback, useEffect, useMemo, useState } from "react";

const API = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || "";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { "content-type": "application/json" }, ...init });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => res.statusText)}`);
  return (await res.json()) as T;
}

type AssetRow = { id: string; role: string; type: string; filename: string; hasPath: boolean; tags: string[] };
type KbElement = { id: string; kind: string; name: string; description: string; tags: string[]; source: { sourceSampleId: string }; reusablePolicy: string };
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
};
type SlotBinding = { slotId: string; status: string; assetId?: string; uri?: string; text?: string; warnings: string[] };
type GenResult = {
  generationId: string;
  generationMode?: string;
  templateCapsuleId?: string;
  usedTemplateCode?: boolean;
  usedFallbackRenderer?: boolean;
  finalVideoUrl?: string;
  scorecard: Scorecard;
  warnings?: string[];
  // same_template
  templateInstance?: { slotBindings: SlotBinding[]; readinessImpact: { missingRequiredSlotCount: number; usedFallbackCount: number; readinessLevel: string; warnings: string[] } };
  generatedAssets?: Array<{ slotId?: string; uri?: string; kind?: string }>;
  // mix_elements (advanced)
  composition?: { sections: Array<{ id: string; role: string; startSec: number; endSec: number; plannedText?: string }>; stylePlan: { palette: string[] } };
  gapReport?: { gaps: Array<{ slotId: string; status: string; selectedRepair: string; impact: string }> };
};

const card: React.CSSProperties = { background: "#13151a", border: "1px solid #262a33", borderRadius: 10, padding: 16, marginBottom: 16 };
const btn: React.CSSProperties = { background: "#2b6cff", color: "#fff", border: 0, borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontWeight: 600 };
const tag: React.CSSProperties = { display: "inline-block", fontSize: 11, padding: "2px 8px", borderRadius: 99, background: "#1d2430", color: "#9fb3d1", marginRight: 6 };
const gateColor = (s: string) => (s === "pass" ? "#1f9d55" : s === "fail" ? "#d6324a" : "#b78a14");

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
  const [autoRender, setAutoRender] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
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

  const refreshKb = useCallback(async () => {
    const r = await api<{ elements: KbElement[] }>("/api/v5/kb/elements");
    setKb(r.elements);
  }, []);

  const refreshTemplates = useCallback(async () => {
    const r = await api<{ templates: TemplateMeta[] }>("/api/v5/templates");
    setTemplates(r.templates);
  }, []);

  const refreshAssets = useCallback(async () => {
    const r = await api<{ assets: AssetRow[] }>("/api/v5/assets");
    setAssets(r.assets);
  }, []);

  useEffect(() => {
    refreshAssets().catch((e) => setErr(String(e)));
    refreshKb().catch(() => undefined);
    refreshTemplates().catch(() => undefined);
  }, [refreshAssets, refreshKb, refreshTemplates]);

  const videoAssets = useMemo(() => assets.filter((a) => a.type === "video" && a.hasPath), [assets]);
  const targetAssets = useMemo(() => assets.filter((a) => a.type === "image" || a.type === "video"), [assets]);
  // Selected template = explicit pick, else the latest learned capsule (the server's default too).
  const activeTemplate = useMemo<TemplateMeta | undefined>(
    () => templates.find((t) => t.id === templateId) ?? templates[templates.length - 1],
    [templates, templateId]
  );
  const requiredSlots = useMemo(() => activeTemplate?.slotSchema.filter((s) => s.required) ?? [], [activeTemplate]);
  // How many required slots the user can cover from their own target assets (rough: count provided assets).
  const providedCount = targetIds.length;
  const missingRequired = Math.max(0, requiredSlots.length - providedCount);

  const toggle = (arr: string[], set: (v: string[]) => void, id: string) =>
    set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };

  const learn = () =>
    run("learn", async () => {
      const r = await api<{ learned: Array<{ sampleId: string; storedElements?: number; gen1?: string; error?: string }>; kbSize: number }>(
        "/api/v5/learn-samples",
        { method: "POST", body: JSON.stringify({ sampleAssetIds: sampleIds, options: { runGen1Ai: useAi, runCapsuleCodegen: aiCapsule } }) }
      );
      setLog(r.learned.map((l) => (l.error ? `✗ ${l.sampleId}: ${l.error}` : `✓ ${l.sampleId}: ${l.storedElements} elements (gen1=${l.gen1})`)));
      await Promise.all([refreshKb(), refreshTemplates()]);
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
      const res = await api<GenResult>("/api/v5/generations", {
        method: "POST",
        body: JSON.stringify({
          projectId: "proj_v5_ui",
          brief: { theme, variant: "high_click", targetDurationSec: 16, aspectRatio: "9:16", sellingPoints: sellingArr },
          targetAssetIds: targetIds,
          selectedElementIds: genMode === "mix_elements" && selectedEls.length ? selectedEls : undefined,
          options
        })
      });
      setResult(res);
    });

  // Patch-first revise (modify_template) of the current result.
  const revise = (gen: GenResult) =>
    run("revise", async () => {
      const patch: Record<string, unknown> = {};
      if (reviseTheme.trim()) patch.theme = reviseTheme.trim();
      if (reviseHeadline.trim()) patch.copyOverrides = { headline: reviseHeadline.trim() };
      const res = await api<GenResult>(`/api/v5/generations/${gen.generationId}/revise`, {
        method: "POST",
        body: JSON.stringify({ projectId: "proj_v5_ui", patch })
      });
      setResult(res);
    });

  // "Start from this template" CTA — pick a learned capsule and jump to same_template generate.
  const startFromTemplate = (t: TemplateMeta) => {
    setGenMode("same_template");
    setTemplateId(t.id);
    setResult(null);
    document.getElementById("v5-generate")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24, color: "#e6edf6", fontFamily: "Inter, system-ui, sans-serif" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>V5.1 — Same-Template Reconstruction</h1>
        <div>
          <label style={{ marginRight: 12, fontSize: 13 }} title="学习时用真 Gemini 重写模板 TSX（三重门）+ 学习期渲染验证；关掉则用确定性胶囊">
            <input type="checkbox" checked={aiCapsule} onChange={(e) => setAiCapsule(e.target.checked)} /> AI 代码胶囊
          </label>
          <label style={{ marginRight: 12, fontSize: 13 }}>
            <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} /> AI Gen1/Gen2
          </label>
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={autoRender} onChange={(e) => setAutoRender(e.target.checked)} /> render final.mp4
          </label>
          <a href="#v4" style={{ marginLeft: 14, fontSize: 12, color: "#7c8aa0" }}>→ V4</a>
        </div>
      </header>

      {err && <div style={{ ...card, borderColor: "#d6324a", color: "#ffb3bf" }}>错误: {err}</div>}

      {/* 1. Learn */}
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>1 · Learn — 选择样本视频</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {videoAssets.length === 0 && <span style={{ color: "#7c8aa0" }}>没有可用样本视频（先在 V4 上传，或确认 /api/v5/assets）。</span>}
          {videoAssets.map((a) => (
            <button key={a.id} onClick={() => toggle(sampleIds, setSampleIds, a.id)} style={{ ...tag, cursor: "pointer", background: sampleIds.includes(a.id) ? "#2b6cff" : "#1d2430", color: sampleIds.includes(a.id) ? "#fff" : "#9fb3d1", padding: "6px 10px" }}>
              {a.filename}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <button style={{ ...btn, opacity: sampleIds.length && !busy ? 1 : 0.5 }} disabled={!sampleIds.length || !!busy} onClick={learn}>
            {busy === "learn" ? "学习中…" : `Learn ${sampleIds.length} 个样本`}
          </button>
        </div>
        {log.length > 0 && <pre style={{ marginTop: 12, color: "#9fb3d1", fontSize: 12, whiteSpace: "pre-wrap" }}>{log.join("\n")}</pre>}
      </section>

      {/* 1.5 Template library — learned capsules with a primary "Start from this template" CTA. */}
      {templates.length > 0 && (
        <section style={card}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>模板库 — {templates.length} 个可复用 Remotion 模板</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {templates.map((t) => (
              <div key={t.id} style={{ border: `1px solid ${templateId === t.id ? "#2b6cff" : "#262a33"}`, borderRadius: 8, padding: 12, background: templateId === t.id ? "#16243f" : "#0f1117" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
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

      {/* 2. Template + theme + AIGC gap fill (the DEFAULT same-template flow) */}
      <section id="v5-generate" style={card}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>2 · Generate — 模板 + 主题 + 自动补全</h2>

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button
            onClick={() => setGenMode("same_template")}
            style={{ ...btn, background: genMode === "same_template" ? "#2b6cff" : "#1d2430", color: genMode === "same_template" ? "#fff" : "#9fb3d1", flex: 1, textAlign: "left" }}
          >
            ▸ 用同一个模板 <span style={{ fontWeight: 400, fontSize: 12, opacity: 0.85 }}>（复用样本的运动模板 + 新主题，默认）</span>
          </button>
          <button
            onClick={() => setGenMode("mix_elements")}
            style={{ ...btn, background: genMode === "mix_elements" ? "#2b6cff" : "#1d2430", color: genMode === "mix_elements" ? "#fff" : "#9fb3d1", flex: 1, textAlign: "left" }}
          >
            ▸ 混合多视频元素 <span style={{ fontWeight: 400, fontSize: 12, opacity: 0.85 }}>（高级）</span>
          </button>
        </div>

        {genMode === "same_template" && (
          <div style={{ display: "grid", gap: 12, maxWidth: 720 }}>
            {/* Template selector */}
            <label style={{ fontSize: 13 }}>模板胶囊
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                style={{ width: "100%", marginTop: 4, padding: 8, background: "#0f1117", border: "1px solid #262a33", borderRadius: 6, color: "#e6edf6" }}
              >
                <option value="">最新学习的模板{activeTemplate ? `（${activeTemplate.name}）` : ""}</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} · {t.slotSchema.length} slots · src={t.sourceSampleId.slice(0, 8)}</option>
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
                    <span key={s.id} title={`${s.originalRole} · ${s.replacementPolicy} · ${s.propPath ?? ""}`} style={{ ...tag, background: s.required ? "#1d2a44" : "#1d2430", color: s.required ? "#bcd2ff" : "#9fb3d1", border: s.required ? "1px solid #2b6cff" : "1px solid #262a33" }}>
                      {s.kind}{s.required ? " *" : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <label style={{ fontSize: 13 }}>新主题<input value={theme} onChange={(e) => setTheme(e.target.value)} style={{ width: "100%", marginTop: 4, padding: 8, background: "#0f1117", border: "1px solid #262a33", borderRadius: 6, color: "#e6edf6" }} /></label>
            <label style={{ fontSize: 13 }}>卖点（逗号分隔）<input value={sellingPoints} onChange={(e) => setSellingPoints(e.target.value)} style={{ width: "100%", marginTop: 4, padding: 8, background: "#0f1117", border: "1px solid #262a33", borderRadius: 6, color: "#e6edf6" }} /></label>
            <div style={{ fontSize: 13 }}>你的目标素材（可选，没有就让 AI 补全）：
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                {targetAssets.length === 0 && <span style={{ color: "#7c8aa0", fontSize: 12 }}>没有目标素材 — AI 将补全所有必填槽位。</span>}
                {targetAssets.map((a) => (
                  <button key={a.id} onClick={() => toggle(targetIds, setTargetIds, a.id)} style={{ ...tag, cursor: "pointer", background: targetIds.includes(a.id) ? "#2b6cff" : "#1d2430", color: targetIds.includes(a.id) ? "#fff" : "#9fb3d1", padding: "6px 10px" }}>{a.filename}</button>
                ))}
              </div>
            </div>

            {/* AIGC gap fill toggle (default ON) */}
            <div style={{ border: "1px solid #262a33", borderRadius: 8, padding: 12, background: "#0f1117" }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={aigcOn} onChange={(e) => setAigcOn(e.target.checked)} />
                用 AI 自动补全缺失的画面 / 文案 / 音频
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

            <button style={{ ...btn, opacity: (templates.length || templateId) && !busy ? 1 : 0.5 }} disabled={(!templates.length && !templateId) || !!busy} onClick={generate}>
              {busy === "generate" ? "生成中…（含渲染可能数十秒）" : "用此模板生成视频"}
            </button>
          </div>
        )}

        {genMode === "mix_elements" && (
          <div style={{ display: "grid", gap: 12, maxWidth: 720 }}>
            <div style={{ fontSize: 12, color: "#7c8aa0" }}>高级模式：从知识库挑选原子元素（hook / 节奏 / 排版 / 转场 / CTA …）组合成新结构。</div>
            <div>
              <div style={{ fontSize: 13, marginBottom: 6 }}>Knowledge Base — {kb.length} elements（点选用于合成）</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
                {kb.map((e) => (
                  <div key={e.id} onClick={() => toggle(selectedEls, setSelectedEls, e.id)} style={{ border: `1px solid ${selectedEls.includes(e.id) ? "#2b6cff" : "#262a33"}`, borderRadius: 8, padding: 10, cursor: "pointer", background: selectedEls.includes(e.id) ? "#16243f" : "#0f1117" }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{e.name}</div>
                    <div style={{ marginTop: 4 }}><span style={tag}>{e.kind}</span><span style={tag}>{e.reusablePolicy}</span></div>
                    <div style={{ fontSize: 11, color: "#7c8aa0", marginTop: 6 }}>{e.description.slice(0, 80)}</div>
                  </div>
                ))}
              </div>
            </div>
            <label style={{ fontSize: 13 }}>主题<input value={theme} onChange={(e) => setTheme(e.target.value)} style={{ width: "100%", marginTop: 4, padding: 8, background: "#0f1117", border: "1px solid #262a33", borderRadius: 6, color: "#e6edf6" }} /></label>
            <label style={{ fontSize: 13 }}>卖点（逗号分隔）<input value={sellingPoints} onChange={(e) => setSellingPoints(e.target.value)} style={{ width: "100%", marginTop: 4, padding: 8, background: "#0f1117", border: "1px solid #262a33", borderRadius: 6, color: "#e6edf6" }} /></label>
            <div style={{ fontSize: 13 }}>目标素材：
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                {targetAssets.map((a) => (
                  <button key={a.id} onClick={() => toggle(targetIds, setTargetIds, a.id)} style={{ ...tag, cursor: "pointer", background: targetIds.includes(a.id) ? "#2b6cff" : "#1d2430", color: targetIds.includes(a.id) ? "#fff" : "#9fb3d1", padding: "6px 10px" }}>{a.filename}</button>
                ))}
              </div>
            </div>
            <button style={{ ...btn, opacity: kb.length && !busy ? 1 : 0.5 }} disabled={!kb.length || !!busy} onClick={generate}>
              {busy === "generate" ? "生成中…（含渲染可能数十秒）" : "Mix & Generate video"}
            </button>
          </div>
        )}
      </section>

      {/* 3. Result */}
      {result && (
        <section style={card}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>
            3 · Result · {result.generationId} · {result.scorecard.demoReady ? <span style={{ color: "#1f9d55" }}>demoReady ✓</span> : <span style={{ color: "#b78a14" }}>not demoReady</span>}
            {result.scorecard.readinessLevel && <span style={{ ...tag, marginLeft: 8 }}>{result.scorecard.readinessLevel}</span>}
            {result.generationMode && <span style={{ ...tag, marginLeft: 4 }}>{result.generationMode}</span>}
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

          <div style={{ display: "grid", gridTemplateColumns: result.finalVideoUrl ? "320px 1fr" : "1fr", gap: 20 }}>
            {result.finalVideoUrl && (
              <video src={`${API}${result.finalVideoUrl}`} controls style={{ width: 320, borderRadius: 10, background: "#000" }} />
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

              <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Scorecard ({result.scorecard.gates.filter((g) => g.status === "pass").length}/{result.scorecard.gates.length} pass)</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {result.scorecard.gates.map((g) => (
                  <span key={g.id} title={`${g.name}${g.message ? " — " + g.message : ""}`} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: gateColor(g.status), color: "#fff" }}>{g.id}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Revise (modify_template): patch theme / headline and re-render the SAME template, reusing visuals. */}
          {result.templateInstance && (
            <div style={{ marginTop: 16, borderTop: "1px solid #262a33", paddingTop: 14 }}>
              <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>改写这个视频（同模板，复用画面）</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <input value={reviseTheme} onChange={(e) => setReviseTheme(e.target.value)} placeholder="新主题（可选）" style={{ flex: "1 1 220px", padding: 8, background: "#0f1117", border: "1px solid #262a33", borderRadius: 6, color: "#e6edf6" }} />
                <input value={reviseHeadline} onChange={(e) => setReviseHeadline(e.target.value)} placeholder="新主标题文案（可选）" style={{ flex: "1 1 220px", padding: 8, background: "#0f1117", border: "1px solid #262a33", borderRadius: 6, color: "#e6edf6" }} />
                <button
                  style={{ ...btn, opacity: (reviseTheme.trim() || reviseHeadline.trim()) && !busy ? 1 : 0.5 }}
                  disabled={(!reviseTheme.trim() && !reviseHeadline.trim()) || !!busy}
                  onClick={() => revise(result)}
                >
                  {busy === "revise" ? "改写中…" : "改写并重渲染"}
                </button>
              </div>
              <div style={{ fontSize: 11, color: "#7c8aa0", marginTop: 6 }}>patch-first：只换主题/文案/配色，复用已生成的画面与音频；要换画面请重新生成。</div>
            </div>
          )}
        </section>
      )}
      <footer style={{ color: "#54607a", fontSize: 12, marginTop: 8 }}>spec_v5.1 · learn → template capsule → 新主题 + AIGC 补全 → 渲染模板代码 → revise · AI gated by GEMINI_API_KEY</footer>
    </div>
  );
}
