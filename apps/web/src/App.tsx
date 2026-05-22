import { useEffect, useMemo, useState } from "react";
import type {
  Asset,
  ExampleAnalysis,
  GenerationRequest,
  GenerationResult,
  Project,
  StructureTemplate,
  TemplateRecord,
  Vertical
} from "@vvst/shared";

type ApiState = "idle" | "loading" | "error";

type KnowledgeBaseResponse = {
  projectId: string;
  templates: TemplateRecord[];
  atoms: Array<{ id: string; role: string; name: string; description: string; sourceTemplateId: string }>;
  editingTechniques: Array<{ id: string; name: string; description: string; sourceTemplateId: string }>;
};

type AnalyzeResponse = {
  project?: Project;
  asset: Asset;
  jobId: string;
  analysis: ExampleAnalysis;
  template?: StructureTemplate;
};

type GenerateResponse = {
  jobId: string;
  generation: GenerationResult;
};

const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) }
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string; details?: string[] } | null;
    throw new Error(payload?.details?.join("; ") ?? payload?.error ?? `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
};

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

function StatusLine({ state, error }: { state: ApiState; error: string | null }) {
  if (state === "loading") return <span className="status">Working...</span>;
  if (state === "error") return <span className="status error">{error}</span>;
  return <span className="status ok">Spec v1.1 mock mode</span>;
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
  const [sourceAssetId, setSourceAssetId] = useState<string>("");
  const [sourceAnalysis, setSourceAnalysis] = useState<ExampleAnalysis | null>(null);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [pace, setPace] = useState<"slow" | "medium" | "fast">("fast");
  const [packagingStyle, setPackagingStyle] = useState<"clean" | "bold" | "mg_motion">("mg_motion");
  const [generation, setGeneration] = useState<GenerationResult | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((record) => record.id === selectedTemplateId)?.template ?? templates[0]?.template ?? null,
    [selectedTemplateId, templates]
  );

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
    const source = nextAssets.find((asset) => asset.role === "source_video");
    if (source && !sourceAssetId) setSourceAssetId(source.id);
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
            name: "Demo v1.1 Structure Knowledge Project",
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
      await refreshProject(project.id);
    });
  }

  async function uploadAndAnalyze(file: File | null, role: "example_video" | "source_video") {
    if (!project || !file) return;
    await run(async () => {
      const body = new FormData();
      body.set("file", file);
      body.set("role", role);
      body.set("tags", role === "source_video" ? "product_like,background" : "example");
      const asset = await api<Asset>(`/api/projects/${project.id}/assets`, { method: "POST", body });
      const analysis = await api<AnalyzeResponse>(`/api/assets/${asset.id}/analyze`, {
        method: "POST",
        body: JSON.stringify({ purpose: role === "example_video" ? "sample" : "source" })
      });
      if (role === "source_video") {
        setSourceAssetId(asset.id);
        setSourceAnalysis(analysis.analysis);
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
          tags: "product_like,background"
        })
      });
      const analysis = await api<AnalyzeResponse>(`/api/assets/${asset.id}/analyze`, {
        method: "POST",
        body: JSON.stringify({ purpose: "source", durationSec: 30, width: 720, height: 1280 })
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
        schemaVersion: "1.1",
        projectId: project.id,
        inputMode: sourceAssetId ? "video_plus_prompt" : "prompt_only",
        selectedTemplateIds: selectedTemplateId ? [selectedTemplateId] : undefined,
        knowledgeBaseScope: { vertical: project.vertical, preferLatest: true },
        sourceVideo: sourceAssetId ? { assetId: sourceAssetId, role: "source_video" } : undefined,
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
          allowReorder: true
        },
        constraints: {
          doNotUseSampleVisuals: true,
          mustUseSourceVideo: Boolean(sourceAssetId),
          maxClips: 8
        }
      };
      const response = await api<GenerateResponse>("/api/generations", {
        method: "POST",
        body: JSON.stringify(request)
      });
      setGeneration(response.generation);
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">爆款结构迁移引擎 MVP v1.1</p>
          <h1>Video + Prompt Reconstruction</h1>
        </div>
        <StatusLine state={apiState} error={error} />
      </header>

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
          </section>

          <section className="panel two-col">
            <div>
              <div className="panel-heading compact">
                <div>
                  <span className="step">Step 2</span>
                  <h2>Structure Review</h2>
                </div>
                {selectedTemplate && <button onClick={() => downloadJson("structure-template-v1.1.json", selectedTemplate)}>Export Template</button>}
              </div>
              <div className="metrics">
                <div>
                  <strong>{templates.length}</strong>
                  <span>Templates</span>
                </div>
                <div>
                  <strong>{knowledgeBase?.atoms.length ?? 0}</strong>
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
              <div className="segment-row">
                {selectedTemplate?.segments.map((segment) => (
                  <article key={segment.id}>
                    <strong>{segment.role}</strong>
                    <span>{segment.intent}</span>
                  </article>
                ))}
                {!selectedTemplate && <p className="empty">Analyze a sample to create a v1.1 structure template.</p>}
              </div>
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
                <article key={`${atom.sourceTemplateId}-${atom.id}`}>
                  <strong>{atom.role}: {atom.name}</strong>
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
            <div className="form-grid">
              <label>
                Source video
                <select value={sourceAssetId} onChange={(event) => setSourceAssetId(event.target.value)}>
                  <option value="">Prompt-only fallback</option>
                  {assets
                    .filter((asset) => asset.role === "source_video")
                    .map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.filename}
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
                <input readOnly value={sourceAnalysis?.video.shotCandidates.length ? `${sourceAnalysis.video.shotCandidates.length} candidates` : "auto mock on generate"} />
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
              <div className="result-grid">
                <div>
                  <h3>Slot Mapping</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Slot</th>
                        <th>Status</th>
                        <th>Explanation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {generation.slotMapping.map((mapping) => (
                        <tr key={mapping.slotId}>
                          <td>{mapping.slotType}</td>
                          <td><span className={`pill ${mapping.status}`}>{mapping.status}</span></td>
                          <td>{mapping.explanation}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <h3>Gap Fill</h3>
                  <div className="gap-list">
                    {generation.fillPlan.map((action) => (
                      <article key={action.id}>
                        <strong>{action.strategy}</strong>
                        <span>{action.description}</span>
                      </article>
                    ))}
                    {!generation.fillPlan.length && <p className="empty">No gaps detected.</p>}
                  </div>
                </div>
              </div>
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
                  <button onClick={() => downloadJson("generation-request-v1.1.json", generation.request)}>Export Request</button>
                  <button onClick={() => downloadJson("timeline-v1.1.json", generation.timeline)}>Export Timeline</button>
                  <button onClick={() => downloadJson("generation-report-v1.1.json", generation)}>Export Report</button>
                </div>
              )}
            </div>
            {generation ? (
              <div className="compare-grid">
                <div>
                  <h3>Selected Atoms</h3>
                  <div className="segment-row vertical">
                    {generation.selectedAtoms.map((atom) => (
                      <article key={atom.id}>
                        <strong>{atom.role}: {atom.name}</strong>
                        <span>{atom.applicableWhen}</span>
                      </article>
                    ))}
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
                </div>
                <div className="timeline-column">
                  <h3>Timeline Preview</h3>
                  <div className="timeline-strip">
                    {generation.timeline.clips.map((clip, index) => {
                      const subtitle = clip.layers.find((layer) => layer.type === "subtitle")?.text ?? clip.visualIntent;
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
