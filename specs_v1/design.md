# Design — 爆款结构迁移引擎 MVP v0.1

## 1. Design Goals

MVP 的设计目标是先建立稳定、可验证、可扩展的工程骨架。核心原则：

1. **协议先行**：Structure Template、Generation Request、Timeline JSON 是系统主干，AI 和渲染都围绕协议工作。
2. **AI 可替换**：LLM/VLM/ASR 通过 adapter 封装；无模型 key 时用 mock/fallback 保证 demo 可跑。
3. **流程可观察**：每个阶段都生成中间产物，前端能展示，不把所有逻辑藏在一个黑盒 prompt 里。
4. **渲染可降级**：优先输出 MP4；如果环境限制，则输出 timeline preview + JSON，保证验证不断链。
5. **后续可扩展**：P1/P2 可以逐步加入多版本、自然语言编辑、真实素材理解、Remotion 高级包装、评估 Agent。

## 2. High-Level Architecture

```text
Frontend: React + TypeScript + Vite
  ├─ Project Workspace
  ├─ Example Analyzer View
  ├─ Template Library View
  ├─ Migration Planner View
  └─ Result / Compare View

Backend API: Node.js + TypeScript + Express/Fastify
  ├─ ProjectController
  ├─ AssetController
  ├─ AnalysisController
  ├─ TemplateController
  ├─ GenerationController
  └─ RenderController

Core Services
  ├─ AssetService
  ├─ VideoAnalysisService
  ├─ StructureExtractionService
  ├─ TemplateService
  ├─ AssetUnderstandingService
  ├─ SlotMatchingService
  ├─ GapFillService
  ├─ MigrationPlannerService
  ├─ TimelineService
  └─ RenderService

Adapters / Plugins
  ├─ AIAdapter: OpenAI-compatible / Doubao / mock
  ├─ VideoToolAdapter: ffprobe / ffmpeg / OpenCV worker
  ├─ ASRAdapter: faster-whisper / provider / disabled
  ├─ RendererAdapter: Remotion / FFmpeg / HTML preview
  └─ StorageAdapter: local fs + SQLite first, PostgreSQL later
```

## 3. MVP Runtime Flow

```text
1. createProject()
2. uploadAsset(projectId, role="example")
3. analyzeExample(assetId)
   3.1 ffprobe metadata
   3.2 extract thumbnails/keyframes
   3.3 scene/shot split
   3.4 optional ASR or transcript fallback
   3.5 structure extraction via AIAdapter or fallback
   3.6 save ExampleAnalysis + StructureTemplate
4. createGeneration(projectId, templateId, brief, assets)
   4.1 understand assets
   4.2 match slots
   4.3 detect gaps
   4.4 choose gap-fill strategies
   4.5 plan script/storyboard/timeline
   4.6 validate schemas
5. renderTimeline(timelineId)
   5.1 use Remotion/FFmpeg if available
   5.2 fallback to preview if rendering fails
6. compare page displays template, mapping, gaps, timeline, output
```

## 4. Module Design

### 4.1 ProjectService

Responsible for project metadata and workspace state.

Core methods:

```ts
createProject(input: CreateProjectInput): Promise<Project>
getProject(projectId: string): Promise<ProjectDetail>
listProjects(): Promise<Project[]>
```

### 4.2 AssetService

Responsible for file upload, storage path, metadata and asset roles.

Asset roles:

- `example_video`
- `user_video`
- `user_image`
- `user_text`
- `generated_background`
- `render_output`

Core methods:

```ts
saveUploadedAsset(projectId: string, file: UploadedFile, role: AssetRole): Promise<Asset>
extractBasicMetadata(assetId: string): Promise<AssetMetadata>
listAssets(projectId: string): Promise<Asset[]>
```

### 4.3 VideoAnalysisService

Responsible for deterministic video features.

MVP outputs:

- duration, width, height, fps, codec
- audio presence
- thumbnail path
- keyframe paths
- shot list with start/end/duration/confidence
- optional transcript placeholder

Core methods:

```ts
analyzeVideo(assetId: string): Promise<VideoAnalysisResult>
extractKeyframes(assetPath: string): Promise<Keyframe[]>
detectShots(assetPath: string): Promise<Shot[]>
```

### 4.4 StructureExtractionService

Responsible for converting analysis into Structure Template.

MVP strategy:

1. Build prompt from metadata, shot list, keyframes summary and optional transcript.
2. Request strict JSON from AIAdapter.
3. Validate against `structure-template.schema.json`.
4. If AI fails, use fallback template:
   - 0–20% duration: `hook`
   - 20–80% duration: `body`
   - 80–100% duration: `cta`
   - Use detected shots to fill shot slots.
   - Add default packaging style based on project category.

Core methods:

```ts
extractStructure(input: StructureExtractionInput): Promise<StructureTemplate>
validateStructure(template: unknown): ValidationResult
buildFallbackTemplate(analysis: VideoAnalysisResult): StructureTemplate
```

### 4.5 AssetUnderstandingService

Responsible for understanding new assets.

MVP implementation can be simple:

- For image/video: metadata + optional manual tag + filename heuristic.
- For text: extract product name, selling points, CTA using AIAdapter or fallback regex.
- For video: reuse VideoAnalysisService to get shots.

Core output:

```ts
type AssetTag =
  | "product_closeup"
  | "usage_scene"
  | "comparison"
  | "lifestyle_scene"
  | "text_card_candidate"
  | "cta_candidate"
  | "background";
```

### 4.6 SlotMatchingService

Responsible for mapping template shot slots to user assets.

Matching rules v0.1:

- If shot requires `product_closeup`, prefer image/video tagged product.
- If shot requires `usage`, prefer user video with action/usage tag.
- If shot requires `comparison`, prefer two assets or fallback to text card.
- If no asset match but brief has relevant text, mark `weak_match`.
- If neither asset nor text supports slot, mark `missing`.

Core methods:

```ts
matchSlots(template: StructureTemplate, assets: UnderstoodAsset[], brief: Brief): SlotMapping[]
```

### 4.7 GapFillService

Responsible for missing/weak slot remediation.

MVP strategy priority:

1. `reuse_with_crop_zoom`: use best available product/background asset with crop/zoom.
2. `text_card`: generate title/selling point card.
3. `packaging_overlay`: add title bar, sticker, arrow, highlight box.
4. `reorder_structure`: shorten or merge missing slot into adjacent segment.
5. `aigc_placeholder`: create placeholder background prompt, not necessarily call model.

Core methods:

```ts
generateGapReport(mappings: SlotMapping[], template: StructureTemplate): GapReport
createFillPlan(gapReport: GapReport, assets: UnderstoodAsset[], brief: Brief): FillPlan
```

### 4.8 MigrationPlannerService

Responsible for generating final script, storyboard and timeline.

Input:

- StructureTemplate
- Brief
- SlotMapping
- GapReport / FillPlan
- Controls: hook_style, pace, packaging_style, cta_style

Output:

- MigrationPlan
- Storyboard
- Timeline JSON
- Explanation

Core methods:

```ts
planGeneration(input: MigrationPlannerInput): Promise<GenerationResult>
validateTimeline(timeline: unknown): ValidationResult
```

### 4.9 RenderService

Responsible for converting timeline into preview/output.

MVP renderer options:

- Preferred: Remotion render to MP4.
- Simpler fallback: FFmpeg concat + drawtext/cards.
- Last fallback: HTML timeline preview with exported JSON.

Core methods:

```ts
renderTimeline(timelineId: string): Promise<RenderOutput>
getRenderStatus(renderId: string): Promise<RenderJobStatus>
```

## 5. Data Model

### Project

```ts
type Project = {
  id: string;
  name: string;
  category: "marketing" | "mg" | "edit" | "vlog" | "custom";
  targetDurationMs: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
  createdAt: string;
  updatedAt: string;
};
```

### Asset

```ts
type Asset = {
  id: string;
  projectId: string;
  role: AssetRole;
  type: "video" | "image" | "text" | "audio" | "output";
  originalName: string;
  path: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  status: "uploaded" | "processing" | "ready" | "failed";
  createdAt: string;
};
```

### Job

```ts
type Job = {
  id: string;
  projectId: string;
  type: "analysis" | "generation" | "render";
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  inputRef: string;
  outputRef?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
};
```

## 6. API Design v0.1

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/projects` | Create project |
| `GET` | `/api/projects` | List projects |
| `GET` | `/api/projects/:projectId` | Get project detail |
| `POST` | `/api/projects/:projectId/assets` | Upload asset |
| `GET` | `/api/projects/:projectId/assets` | List assets |
| `POST` | `/api/assets/:assetId/analyze` | Start video/sample analysis |
| `GET` | `/api/jobs/:jobId` | Poll job status |
| `GET` | `/api/assets/:assetId/analysis` | Get analysis result |
| `POST` | `/api/templates` | Save template |
| `GET` | `/api/templates?projectId=` | List templates |
| `GET` | `/api/templates/:templateId` | Get template detail |
| `POST` | `/api/generations` | Create generation task |
| `GET` | `/api/generations/:generationId` | Get generation result |
| `POST` | `/api/generations/:generationId/render` | Start render |
| `GET` | `/api/renders/:renderId` | Get render status/output |
| `GET` | `/api/exports/:id` | Download JSON/report/video |

## 7. Job State Machine

```text
queued -> running -> succeeded
               └──> failed
failed -> queued  // retry
```

Every long-running operation creates a Job. Frontend polls `/api/jobs/:jobId` or later uses WebSocket/SSE.

## 8. Frontend MVP Pages

### 8.1 Dashboard

- Project cards
- Create project modal
- Demo project entry

### 8.2 Project Workspace

Wizard steps:

1. Sample Upload
2. Sample Analysis
3. Template Review
4. New Content Input
5. Migration Planner
6. Result & Compare

### 8.3 Sample Analysis View

Panels:

- Video player / thumbnail
- Metadata card
- Shot timeline
- Structure template JSON preview
- Natural language explanation
- Save Template button

### 8.4 Migration Planner View

Panels:

- Selected template segments
- Brief form and asset list
- Slot mapping table
- Gap report cards
- Generate button

### 8.5 Result & Compare View

Panels:

- Sample structure summary
- Mapping diagram/table
- Gap fill plan
- Storyboard table
- Timeline preview/video player
- Export buttons

## 9. Extension Points

### AIAdapter

```ts
interface AIAdapter {
  generateJson<T>(request: AIJsonRequest, schemaName: string): Promise<T>;
}
```

Implementations:

- `MockAIAdapter` for local demo.
- `OpenAICompatibleAdapter` for OpenRouter / compatible APIs.
- `DoubaoArkAdapter` for 火山方舟 later.

### RendererAdapter

```ts
interface RendererAdapter {
  render(timeline: Timeline, outputDir: string): Promise<RenderOutput>;
}
```

Implementations:

- `HtmlPreviewRenderer`
- `FFmpegRenderer`
- `RemotionRenderer`

### GapFillStrategy

```ts
interface GapFillStrategy {
  name: string;
  canHandle(slot: Slot, context: GenerationContext): boolean;
  apply(slot: Slot, context: GenerationContext): FillAction;
}
```

Future strategies can add TTS, generated image, generated video, multi-template substitution.

## 10. Error Handling

- Upload error: show file type/size issue.
- FFmpeg missing: show setup instruction and allow mock demo mode.
- AI JSON invalid: retry once with repair prompt; if still invalid, fallback.
- Render failure: keep Timeline JSON and generate HTML preview.
- Asset missing: mark affected slots and create gap fill plan.

## 11. Configuration

`.env` example:

```bash
APP_PORT=3000
DATA_DIR=./data
DATABASE_URL=file:./data/app.db
AI_PROVIDER=mock
OPENAI_COMPATIBLE_BASE_URL=
OPENAI_COMPATIBLE_API_KEY=
OPENAI_COMPATIBLE_MODEL=
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
RENDERER=html-preview
```

## 12. MVP Verification Definition

MVP is considered verified when:

1. A fresh local clone can run with `AI_PROVIDER=mock`.
2. User can create/open a demo project.
3. User can analyze a sample or load seeded analysis.
4. System generates valid Structure Template JSON.
5. System accepts a new brief and assets.
6. System outputs slot mapping, gap report, fill plan, storyboard and Timeline JSON.
7. System displays compare page.
8. System produces either MP4 output or deterministic preview.
