import { useEffect, useMemo, useState } from "react";
import type {
  Asset,
  ExampleAnalysis,
  GenerationRequest,
  GenerationResult,
  KnowledgeAtom,
  Project,
  RendererTarget,
  StructureTemplate,
  TemplateRecord,
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
  render: { outputPath?: string; previewHtml?: string; rendererTarget: RendererTarget; status: string };
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
主题：便携式桌面加湿器
目标用户：办公室久坐人群、学生
卖点：小巧便携、静音、USB 供电、柔和夜灯、缓解干燥
风格：快节奏、字幕明显、带 MG 风格卖点卡片
CTA：点击了解更多`;

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function renderOutputUrl(render: RenderResponse["render"] | null): string | null {
  const outputPath = render?.outputPath;
  if (!outputPath || !outputPath.endsWith(".mp4")) return null;
  const filename = outputPath.split(/[\\/]/).pop();
  return filename ? `/generated/${filename}` : null;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function clipLabel(generation: GenerationResult, clipId: string): string {
  const clip = generation.timeline.clips.find((item) => item.id === clipId);
  if (!clip) return clipId;
  return `${clip.role} ${clip.startSec.toFixed(1)}-${(clip.startSec + clip.durationSec).toFixed(1)}s`;
}

function visualStyleLine(template: StructureTemplate | null): string {
  const style = template?.visualStyle;
  if (!style) return "No structured visual style yet";
  return [style.background, style.layout, style.motionAsset, style.typography].filter(Boolean).join(" · ");
}

function StatusLine({ state, error }: { state: ApiState; error: string | null }) {
  if (state === "loading") return <span className="status">Working...</span>;
  if (state === "error") return <span className="status error">{error}</span>;
  return <span className="status ok">Spec v1.2 ready</span>;
}

function JsonPreview({ value }: { value: unknown }) {
  return <pre className="json-preview">{JSON.stringify(value, null, 2)}</pre>;
}

export default function App() {
  const [apiState, setApiState] = useState<ApiState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBaseResponse | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [sampleDescription, setSampleDescription] = useState("B2B MG promo: hook, product value, proof card, CTA.");
  const [sampleAnalysis, setSampleAnalysis] = useState<ExampleAnalysis | null>(null);
  const [sourceAssetId, setSourceAssetId] = useState<string>("");
  const [sourceAnalysis, setSourceAnalysis] = useState<ExampleAnalysis | null>(null);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [pace, setPace] = useState<"slow" | "medium" | "fast">("fast");
  const [packagingStyle, setPackagingStyle] = useState<"clean" | "bold" | "mg_motion">("mg_motion");
  const [generation, setGeneration] = useState<GenerationResult | null>(null);
  const [rendererTarget, setRendererTarget] = useState<RendererTarget>("html_preview");
  const [renderResult, setRenderResult] = useState<RenderResponse["render"] | null>(null);
  const [reviseInstruction, setReviseInstruction] = useState("放慢节奏，减少字幕，CTA 更柔和");
  const [reviseResult, setReviseResult] = useState<ReviseResponse | null>(null);
  const [variants, setVariants] = useState<VariantResponse[]>([]);
  const [scorecard, setScorecard] = useState<ScorecardResponse | null>(null);
  const [selectedReplacementSlotId, setSelectedReplacementSlotId] = useState<string>("");
  const [replacementResult, setReplacementResult] = useState<ReplacementResponse | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((record) => record.id === selectedTemplateId)?.template ?? templates[0]?.template ?? null,
    [selectedTemplateId, templates]
  );
  const renderedVideoUrl = renderOutputUrl(renderResult);
  const replacementSlots = generation?.replacementSlots ?? [];
  const selectedReplacementSlot =
    replacementSlots.find((slot) => slot.slotId === selectedReplacementSlotId) ?? replacementSlots[0] ?? null;

  async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
    setApiState("loading");
    setError(null);
    try {
      const result = await work();
      setApiState("idle");
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setApiState("error");
      return undefined;
    }
  }

  async function refreshProject(projectId = project?.id) {
    if (!projectId) return;
    const [nextAssets, nextTemplates, nextKb] = await Promise.all([
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
    await run(async () => {
      const created = await api<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: `B2B MG Project ${projects.length + 1}`,
          vertical: "b2b_marketing_mg" satisfies Vertical,
          aspectRatio: "9:16",
          targetDurationSec: 15
        })
      });
      setProject(created);
      setProjects((current) => [created, ...current]);
      setSelectedTemplateId("");
      setGeneration(null);
      setRenderResult(null);
      await refreshProject(created.id);
    });
  }

  async function analyzeMockSample() {
    if (!project) return;
    await run(async () => {
      const response = await api<AnalyzeResponse>("/api/samples/analyze", {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          sampleName: "b2b-mg-sample.mp4",
          description: sampleDescription,
          durationSec: project.targetDurationSec,
          width: 720,
          height: 1280,
          fps: 30
        })
      });
      if (response.template) setSelectedTemplateId(response.template.id);
      setSampleAnalysis(response.analysis);
      await refreshProject(project.id);
    });
  }

  async function uploadAndAnalyze(file: File | null, role: "example_video" | "source_video") {
    if (!project || !file) return;
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
        setSampleAnalysis(analysis.analysis);
      }
      if (analysis.template) setSelectedTemplateId(analysis.template.id);
      await refreshProject(project.id);
    });
  }

  async function addMockSourceVideo() {
    if (!project) return;
    await run(async () => {
      const asset = await api<Asset>(`/api/projects/${project.id}/assets`, {
        method: "POST",
        body: JSON.stringify({
          role: "source_video",
          type: "video",
          originalName: "judge-source-video.mp4",
          tags: "product_like,background",
          sourcePolicy: "demo_only"
        })
      });
      const analysis = await api<AnalyzeResponse>(`/api/assets/${asset.id}/analyze`, {
        method: "POST",
        body: JSON.stringify({ purpose: "source", mode: "mock", durationSec: 30, width: 720, height: 1280 })
      });
      setSourceAssetId(asset.id);
      setSourceAnalysis(analysis.analysis);
      await refreshProject(project.id);
    });
  }

  async function generate() {
    if (!project) return;
    await run(async () => {
      const request: GenerationRequest = {
        projectId: project.id,
        inputMode: sourceAssetId ? "video_plus_prompt" : "prompt_only",
        selectedTemplateIds: selectedTemplateId ? [selectedTemplateId] : undefined,
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
          allowAigcPlaceholder: true
        },
        constraints: {
          noSampleVisualCopy: true
        }
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
    });
  }

  async function renderTimeline() {
    if (!generation) return;
    await run(async () => {
      const response = await api<RenderResponse>(`/api/generations/${generation.id}/render`, {
        method: "POST",
        body: JSON.stringify({ rendererTarget })
      });
      setRenderResult(response.render);
    });
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
    });
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
          <h1>Video + Prompt Reconstruction</h1>
        </div>
        <StatusLine state={apiState} error={error} />
      </header>
      <p style={{ background: "#eef2ff", color: "#3730a3", padding: "8px 12px", margin: "0 0 16px", borderRadius: 6, fontSize: 13 }}>
        Source-policy reminder: this engine learns reusable creative structure only. Sample frames, audio, voiceover and people likenesses from learned videos are never copied into generated output. Commercial reuse of uploaded material remains the uploader's responsibility — confirm rights before downstream use.
      </p>

      <section className="workspace">
        <aside className="rail">
          <h2>Dashboard</h2>
          <p>{project?.name ?? "Loading project..."}</p>
          <dl>
            <div>
              <dt>Vertical</dt>
              <dd>{project?.vertical ?? "b2b_marketing_mg"}</dd>
            </div>
            <div>
              <dt>Ratio</dt>
              <dd>{project?.aspectRatio ?? "9:16"}</dd>
            </div>
            <div>
              <dt>Target</dt>
              <dd>{project?.targetDurationSec ?? 15}s</dd>
            </div>
          </dl>
          <div className="button-row">
            <button onClick={createProject}>New</button>
            <button onClick={loadProjects}>Refresh</button>
          </div>
          <label>
            Open project
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
                <span className="step">Step 1</span>
                <h2>Sample Learning</h2>
              </div>
              <div className="button-row">
                <button onClick={analyzeMockSample} disabled={!project || apiState === "loading"}>
                  Analyze Mock Sample
                </button>
                <label className="file-button">
                  Upload Sample
                  <input type="file" accept="video/mp4,video/quicktime,video/*" onChange={(event) => uploadAndAnalyze(event.target.files?.[0] ?? null, "example_video")} />
                </label>
              </div>
            </div>
            <label>
              Sample description fallback
              <textarea value={sampleDescription} onChange={(event) => setSampleDescription(event.target.value)} />
            </label>
            {sampleAnalysis && (
              <div className="analysis-summary">
                <article>
                  <strong>{sampleAnalysis.video.metadata.durationSec.toFixed(1)}s</strong>
                  <span>{sampleAnalysis.video.metadata.width ?? "-"}×{sampleAnalysis.video.metadata.height ?? "-"} · {sampleAnalysis.video.analyzerMode}</span>
                </article>
                <article>
                  <strong>{sampleAnalysis.video.shots.length}</strong>
                  <span>shots / {sampleAnalysis.video.keyframes.length} keyframes</span>
                </article>
                <article>
                  <strong>{sampleAnalysis.video.transcript?.length ?? 0}</strong>
                  <span>ASR cues</span>
                </article>
                <article>
                  <strong>{sampleAnalysis.video.ocr?.length ?? 0}</strong>
                  <span>OCR rows</span>
                </article>
              </div>
            )}
          </section>

          <section className="panel two-col">
            <div>
              <div className="panel-heading compact">
                <div>
                  <span className="step">Step 2</span>
                  <h2>Structure Review</h2>
                </div>
                {selectedTemplate && <button onClick={() => downloadJson("structure-template-v1.2.json", selectedTemplate)}>Export Template</button>}
              </div>
              <div className="metrics">
                <div>
                  <strong>{templates.length}</strong>
                  <span>Templates</span>
                </div>
                <div>
                  <strong>{knowledgeBase?.counts.atoms ?? 0}</strong>
                  <span>Atoms</span>
                </div>
                <div>
                  <strong>{selectedTemplate?.segments.length ?? 0}</strong>
                  <span>Segments</span>
                </div>
                <div>
                  <strong>{selectedTemplate?.rhythm.pace ?? "-"}</strong>
                  <span>Rhythm</span>
                </div>
              </div>
              {selectedTemplate && (
                <div className="template-facts">
                  <article>
                    <strong>Video Type</strong>
                    <span>{selectedTemplate.videoType ?? "unclassified"}</span>
                  </article>
                  <article>
                    <strong>Visual Style</strong>
                    <span>{visualStyleLine(selectedTemplate)}</span>
                    {selectedTemplate.visualStyle?.colorProgression?.length ? (
                      <small>{selectedTemplate.visualStyle.colorProgression.join(" → ")}</small>
                    ) : null}
                  </article>
                  <article>
                    <strong>Exclude Segments</strong>
                    {(selectedTemplate.excludeSegments ?? []).length ? (
                      selectedTemplate.excludeSegments?.map((segment) => (
                        <span key={`${segment.startSec}-${segment.endSec}`}>
                          {segment.startSec.toFixed(1)}–{segment.endSec.toFixed(1)}s · {segment.reason}
                        </span>
                      ))
                    ) : (
                      <span>none</span>
                    )}
                  </article>
                </div>
              )}
              <div className="segment-row">
                {selectedTemplate?.segments.map((segment) => (
                  <article key={segment.id}>
                    <strong>{segment.role}</strong>
                    <span>{segment.intent}</span>
                  </article>
                ))}
                {!selectedTemplate && <p className="empty">Analyze a sample to create a v1.2 structure template.</p>}
              </div>
              {sampleAnalysis && (
                <div className="segment-row vertical">
                  {sampleAnalysis.video.keyframes.slice(0, 4).map((frame) => (
                    <article key={frame.id}>
                      <strong>{frame.id} · {frame.timeSec.toFixed(1)}s</strong>
                      <span>{frame.description ?? frame.path ?? "keyframe"} · {(frame.tags ?? []).join(", ") || "no tags"}</span>
                    </article>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label>
                Selected template
                <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
                  <option value="">Auto-select latest</option>
                  {templates.map((record) => (
                    <option key={record.id} value={record.id}>
                      {record.name}
                    </option>
                  ))}
                </select>
              </label>
              {selectedTemplate ? <JsonPreview value={selectedTemplate} /> : <p className="empty">No structure template yet.</p>}
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="step">Step 3</span>
                <h2>Knowledge Base</h2>
              </div>
              {knowledgeBase && <button onClick={() => downloadJson("knowledge-base.json", knowledgeBase)}>Export KB</button>}
            </div>
            <div className="asset-list">
              {knowledgeBase?.atoms.map((atom) => (
                <article key={`${atom.templateId}-${atom.id}`}>
                  <strong>{atom.role} · {atom.category}: {atom.name}</strong>
                  <span>{atom.description}</span>
                </article>
              ))}
              {!knowledgeBase?.atoms.length && <p className="empty">Template atoms appear here after sample learning.</p>}
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="step">Step 4</span>
                <h2>Source Video + Prompt</h2>
              </div>
              <div className="button-row">
                <button onClick={addMockSourceVideo} disabled={!project || apiState === "loading"}>
                  Add Mock Source Video
                </button>
                <label className="file-button">
                  Upload Source
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
                      ? "No source video selected. Generation will fall back to prompt-only (text-card heavy). Upload a real source video via the Upload Source button for richer reconstruction."
                      : `Currently selected source “${selectedSource?.filename}” is a mock placeholder (no real file). Click Upload Source to pick a real video.`}
                  </p>
                );
              }
              return null;
            })()}
            <div className="form-grid">
              <label>
                Source video
                <select value={sourceAssetId} onChange={(event) => setSourceAssetId(event.target.value)}>
                  <option value="">Prompt-only fallback</option>
                  {assets
                    .filter((asset) => asset.role === "source_video")
                    .map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.filename}{asset.path ? "" : " (mock)"}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Pace
                <select value={pace} onChange={(event) => setPace(event.target.value as typeof pace)}>
                  <option value="fast">Fast</option>
                  <option value="medium">Medium</option>
                  <option value="slow">Slow</option>
                </select>
              </label>
              <label>
                Packaging
                <select value={packagingStyle} onChange={(event) => setPackagingStyle(event.target.value as typeof packagingStyle)}>
                  <option value="mg_motion">MG motion</option>
                  <option value="bold">Bold</option>
                  <option value="clean">Clean</option>
                </select>
              </label>
              <label>
                Source shots
                <input readOnly value={sourceAnalysis?.video.shots.length ? `${sourceAnalysis.video.shots.length} candidates` : "auto-mock on generate"} />
              </label>
              <label className="wide">
                Prompt
                <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="step">Step 5</span>
                <h2>Reconstruction Planner</h2>
              </div>
              <button onClick={generate} disabled={!project || !templates.length || apiState === "loading"}>
                Generate Reconstruction
              </button>
            </div>
            {generation ? (
              <>
                <div className="result-grid">
                  <div>
                    <h3>Slot Mapping</h3>
                    <table>
                      <thead>
                        <tr>
                          <th>Slot</th>
                          <th>Status</th>
                          <th>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {generation.slotMapping.map((mapping) => (
                          <tr key={mapping.slotId}>
                            <td>{mapping.slotType}</td>
                            <td><span className={`pill ${mapping.status}`}>{mapping.status}</span></td>
                            <td>{mapping.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <h3>Gap Fill</h3>
                    <div className="gap-list">
                      {generation.fillPlan.map((action) => (
                        <article key={action.targetClipId}>
                          <strong>{action.strategy}</strong>
                          <span>{action.reason}</span>
                        </article>
                      ))}
                      {!generation.fillPlan.length && <p className="empty">No gaps detected.</p>}
                    </div>
                  </div>
                </div>
                <h3 style={{ marginTop: 18 }}>Gap Report</h3>
                <div className="gap-list">
                  {generation.gapReport.map((gap) => (
                    <article key={`${gap.slotId}-${gap.gapType ?? gap.status}`}>
                      <strong>
                        {gap.gapLabelZh ?? gap.gapLabel ?? gap.slotId}
                        <span className={`severity ${gap.severity}`}>{gap.severity}</span>
                      </strong>
                      <span>{gap.impact}</span>
                      <small>{gap.recommendedFillStrategies?.join(", ") ?? "no strategy"}</small>
                    </article>
                  ))}
                  {!generation.gapReport.length && <p className="empty">No material gaps detected.</p>}
                </div>
                <h3 style={{ marginTop: 18 }}>Interactive Gap Fill</h3>
                <div className="replacement-workbench">
                  <div className="replacement-slot-list">
                    {replacementSlots.map((slot) => (
                      <button
                        type="button"
                        key={slot.slotId}
                        className={`replacement-slot ${slot.status} ${selectedReplacementSlot?.slotId === slot.slotId ? "active" : ""}`}
                        onClick={() => setSelectedReplacementSlotId(slot.slotId)}
                      >
                        <span>{slot.status.replace(/_/g, " ")}</span>
                        <strong>{slot.semanticLabel}</strong>
                        <small>{slot.visualForm} · {(slot.acceptedAssetTypes ?? []).join(", ")}</small>
                      </button>
                    ))}
                    {!replacementSlots.length && <p className="empty">No click-to-replace slots detected in this generation.</p>}
                  </div>
                  {selectedReplacementSlot && (
                    <article className="slot-inspector">
                      <div className="slot-inspector-head">
                        <div>
                          <strong>{selectedReplacementSlot.semanticLabel}</strong>
                          <span>{selectedReplacementSlot.slotId}</span>
                        </div>
                        <span className={`pill ${selectedReplacementSlot.status}`}>{selectedReplacementSlot.status.replace(/_/g, " ")}</span>
                      </div>
                      <dl>
                        <div>
                          <dt>Current fill</dt>
                          <dd>{selectedReplacementSlot.boundAssetId ?? selectedReplacementSlot.placeholderSpec?.label ?? "proxy placeholder"}</dd>
                        </div>
                        <div>
                          <dt>Motion</dt>
                          <dd>{selectedReplacementSlot.motionSpec?.type ?? "slot motion"} · {String(selectedReplacementSlot.motionSpec?.axis ?? "preserved")}</dd>
                        </div>
                        <div>
                          <dt>Renderer</dt>
                          <dd>{selectedReplacementSlot.rendererBackend ?? "remotion_mg"}</dd>
                        </div>
                      </dl>
                      <label className="file-button replacement-upload">
                        Upload replacement
                        <input type="file" accept="image/*,video/*,.gif" onChange={(event) => uploadReplacementAsset(event.target.files?.[0] ?? null)} />
                      </label>
                      <p className="empty">Click-to-replace keeps the learned timing, layout and motion, then regenerates the generation with a managed uploaded asset.</p>
                    </article>
                  )}
                </div>
                {replacementResult && (
                  <div className="replacement-diff">
                    <strong>Before / After replacement diff</strong>
                    <span>{replacementResult.previousGenerationId} → {replacementResult.generationId}</span>
                    <code>fillStrategy: proxy_placeholder → user_asset_replace</code>
                    <code>assetId: {replacementResult.binding.assetId}</code>
                    <code>motion: preserved from slot</code>
                  </div>
                )}
              </>
            ) : (
              <p className="empty">Run reconstruction to see mapping, gaps, fill plan and timeline.</p>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="step">Step 6</span>
                <h2>Result Compare / Preview</h2>
              </div>
              {generation && (
                <div className="button-row">
                  <button onClick={() => downloadJson("generation-request-v1.2.json", generation.request)}>Export Request</button>
                  <button onClick={() => downloadJson("timeline-v1.2.json", generation.timeline)}>Export Timeline</button>
                  <button onClick={() => downloadJson("generation-report-v1.2.json", generation)}>Export Report</button>
                </div>
              )}
            </div>
            {generation && (
              <div className="form-grid">
                <label>
                  Renderer target
                  <select value={rendererTarget} onChange={(event) => setRendererTarget(event.target.value as RendererTarget)}>
                    <option value="html_preview">HTML preview</option>
                    <option value="mock_preview">Mock preview</option>
                    <option value="ffmpeg">FFmpeg MP4</option>
                    <option value="remotion">Remotion (placeholder)</option>
                    <option value="hyperframes">HyperFrames (placeholder)</option>
                  </select>
                </label>
                <button onClick={renderTimeline} disabled={apiState === "loading"}>
                  Render
                </button>
                {renderResult && (
                  <p className="empty">
                    {renderResult.status} → {renderResult.outputPath ?? renderResult.rendererTarget}
                  </p>
                )}
                {renderedVideoUrl && (
                  <video className="render-player" controls src={renderedVideoUrl} />
                )}
                <label className="wide">
                  Revise instruction
                  <textarea value={reviseInstruction} onChange={(event) => setReviseInstruction(event.target.value)} />
                </label>
                <div className="button-row">
                  <button onClick={reviseGeneration} disabled={apiState === "loading"}>Revise</button>
                  <button onClick={generateVariants} disabled={apiState === "loading"}>Generate Variants</button>
                  <button onClick={scoreGeneration} disabled={apiState === "loading"}>Scorecard</button>
                </div>
                {reviseResult && <p className="empty">Revise: {reviseResult.summary}</p>}
              </div>
            )}
            {generation ? (
              <div className="compare-grid">
                <div>
                  <h3>Sample Template Segments</h3>
                  <div className="segment-row vertical">
                    {selectedTemplate?.segments.map((segment) => {
                      const mapping = generation.timeline.mapping.find((item) => item.templateSegmentId === segment.id);
                      return (
                        <article key={segment.id} className="segment-diff-card">
                          <strong>{segment.role} · {percent(segment.startRatio)}–{percent(segment.endRatio)}</strong>
                          <span>{segment.intent}</span>
                          <small>
                            Mapped to: {mapping?.targetClipIds.length
                              ? mapping.targetClipIds.map((clipId) => clipLabel(generation, clipId)).join(" / ")
                              : "no generated clip"}
                          </small>
                        </article>
                      );
                    })}
                    {!selectedTemplate?.segments.length && <p className="empty">No sample template selected.</p>}
                  </div>
                  {(selectedTemplate?.excludeSegments ?? []).length > 0 && (
                    <>
                      <h3 style={{ marginTop: 16 }}>Excluded Sample Segments</h3>
                      <div className="segment-row vertical">
                        {selectedTemplate?.excludeSegments?.map((segment) => (
                          <article key={`${segment.startSec}-${segment.endSec}`}>
                            <strong>{segment.startSec.toFixed(1)}–{segment.endSec.toFixed(1)}s</strong>
                            <span>{segment.reason}</span>
                            <small>Not transferred into the generated timeline.</small>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                  <h3 style={{ marginTop: 16 }}>Selected Atoms</h3>
                  <div className="segment-row vertical">
                    {generation.selectedAtoms.map((atom) => (
                      <article key={atom.id}>
                        <strong>{atom.role}: {atom.name}</strong>
                        <span>{atom.description}</span>
                      </article>
                    ))}
                  </div>
                  <h3 style={{ marginTop: 16 }}>Source Shot Candidates ({generation.sourceUnderstanding.candidates.length})</h3>
                  <div className="segment-row vertical">
                    {generation.sourceUnderstanding.candidates.map((shot) => (
                      <article key={shot.id}>
                        <strong>{shot.id} · {shot.startSec.toFixed(1)}–{shot.endSec.toFixed(1)}s</strong>
                        <span>{shot.tags.join(", ") || "no tags"}</span>
                      </article>
                    ))}
                    {generation.sourceUnderstanding.candidates.length === 0 && (
                      <p className="empty">No source shot candidates (prompt-only fallback).</p>
                    )}
                  </div>
                </div>
                <div>
                  <h3>Storyboard</h3>
                  <div className="story-list">
                    {generation.storyboard.map((item) => (
                      <article key={item.clipId}>
                        <strong>{item.timeRange}: {item.subtitle}</strong>
                        <span>{item.shotDescription} · {item.assetUsage}</span>
                      </article>
                    ))}
                  </div>
                  {variants.length > 0 && (
                    <>
                      <h3 style={{ marginTop: 16 }}>Variants</h3>
                      <div className="story-list">
                        {variants.map((variant) => (
                          <article key={variant.generationId}>
                            <strong>{variant.displayName} · {variant.label}</strong>
                            <span>{variant.strategy}</span>
                            <small>{variant.generation.timeline.clips.length} clips · {variant.generation.timeline.renderPlan?.background}</small>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                  {scorecard && (
                    <>
                      <h3 style={{ marginTop: 16 }}>Scorecard · {scorecard.overall}/100 · {scorecard.judge}</h3>
                      <div className="story-list">
                        {scorecard.dimensions.map((dimension) => (
                          <article key={dimension.name}>
                            <strong>{dimension.name}: {dimension.score}</strong>
                            <span>{dimension.comment}</span>
                          </article>
                        ))}
                        {scorecard.gates?.map((gate) => (
                          <article key={gate.id}>
                            <strong>{gate.id}: {gate.passed ? "PASS" : "CHECK"}</strong>
                            <span>{String(gate.value)} · {gate.comment}</span>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <div className="timeline-column">
                  <h3>Timeline Preview</h3>
                  <div className="timeline-strip">
                    {generation.timeline.clips.map((clip, index) => {
                      const subtitle = clip.subtitleText ?? clip.layers.find((layer) => layer.kind === "subtitle")?.text ?? clip.visualIntent ?? `Clip ${index + 1}`;
                      return (
                        <article key={clip.id} className="phone-frame">
                          <span>Clip {index + 1} · {clip.role}</span>
                          <strong>{subtitle}</strong>
                          <small>{clip.gapFillStrategy ?? "none"}</small>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <p className="empty">The result area will show atoms, storyboard and browser preview cards.</p>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
