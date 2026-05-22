# Design — 爆款结构迁移引擎 MVP Spec v1.1

## 1. Design Goals

MVP v1.1 的目标是建立稳定、可验证、可扩展的工程骨架。核心原则：

1. **协议先行**：Structure Template、Generation Request、Timeline JSON 是系统主干，AI 和渲染都围绕协议工作。
2. **知识库先行**：系统不是只做一次性 template transfer，而是把样例拆解为可复用的 structure atoms 和 editing techniques。
3. **视频 + Prompt 重构优先**：支持评委上传一段新视频素材和提示词，系统结合知识库进行重构。
4. **AI 可替换**：LLM/VLM/ASR 通过 adapter 封装；无模型 key 时用 mock/fallback 保证 demo 可跑。
5. **流程可观察**：每个阶段都生成中间产物，前端能展示，不把所有逻辑藏在一个黑盒 prompt 里。
6. **渲染可降级**：P0 输出浏览器 preview + Timeline JSON；P1 接 FFmpeg / Remotion / HyperFrames 输出 MP4。
7. **不依赖生视频模型**：Doubao-Seed-2.0-lite 可作为语言模型能力候选，但不能直接生成视频，架构不能依赖视频生成 token。

## 2. High-Level Architecture

```text
Frontend: React + TypeScript + Vite
  ├─ Dashboard
  ├─ Project Workspace
  ├─ Sample Learning View
  ├─ Structure Knowledge Base View
  ├─ Reconstruction Planner View
  └─ Result / Compare / Preview View

Backend API: Node.js + TypeScript + Express/Fastify
  ├─ ProjectController
  ├─ AssetController
  ├─ AnalysisController
  ├─ TemplateController
  ├─ KnowledgeBaseController
  ├─ GenerationController
  └─ RenderController

Core Services
  ├─ AssetService
  ├─ VideoAnalysisService
  ├─ StructureExtractionService
  ├─ KnowledgeBaseService
  ├─ SourceVideoUnderstandingService
  ├─ SlotMatchingService
  ├─ GapFillService
  ├─ ReconstructionPlannerService
  ├─ TimelineService
  └─ RenderService

Adapters / Plugins
  ├─ AIAdapter: mock / OpenAI-compatible / Doubao-compatible later
  ├─ VideoToolAdapter: mock / ffprobe / ffmpeg / OpenCV worker later
  ├─ ASRAdapter: disabled / faster-whisper / provider later
  ├─ RendererAdapter: html_preview / mock / ffmpeg / remotion / hyperframes later
  └─ StorageAdapter: local JSON first / SQLite later / PostgreSQL later
```

## 3. Repository Layout Recommendation

```text
.
├── README.md
├── specs_v1/
│   ├── requirements.md
│   ├── design.md
│   ├── tasks.md
│   ├── test-plan.md
│   └── schemas/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   └── shared/
├── storage/
│   ├── uploads/
│   ├── generated/
│   └── db/
└── scripts/
```

For first coding version, the repo can start smaller, but the module boundaries should not block this target structure.

## 4. Runtime Flow

### 4.1 Learning Flow — Sample Video to Knowledge Base

```text
1. createProject(vertical="b2b_marketing_mg")
2. uploadAsset(projectId, role="example_video")
3. analyzeSample(assetId)
   3.1 ffprobe metadata or mock metadata
   3.2 extract thumbnails/keyframes or use placeholder thumbnails
   3.3 shot split or fixed interval fallback
   3.4 optional ASR/OCR placeholder
   3.5 structure extraction via AIAdapter or fallback
   3.6 validate StructureTemplate schema
   3.7 extract structureAtoms and editingTechniques
   3.8 save template and atoms to KnowledgeBase
4. frontend displays sample structure, atoms, replacement policy and rationale
```

### 4.2 Reconstruction Flow — New Video + Prompt to Timeline

```text
1. createGeneration(inputMode="video_plus_prompt")
2. upload source_video and enter prompt
3. analyze source_video
   3.1 metadata
   3.2 keyframes
   3.3 shot candidates
   3.4 basic heuristic tags
4. retrieve template / structure atoms
   4.1 use selected template if provided
   4.2 otherwise choose atoms by vertical + prompt + target duration
5. match structure slots to source video shots/assets
6. detect missing / weak slots
7. generate gap fill plan
8. generate storyboard and Timeline JSON
9. validate Timeline schema
10. render with HtmlPreviewRenderer by default
11. frontend compare page displays mapping, gaps, fill plan and preview
```

## 5. Core Data Concepts

### 5.1 Project

```ts
type Project = {
  id: string;
  name: string;
  vertical: "b2b_marketing_mg" | "vlog" | "talking_head" | "cutting_beat" | "short_drama";
  aspectRatio: "9:16" | "16:9" | "1:1";
  targetDurationSec: number;
  createdAt: string;
  updatedAt: string;
};
```

### 5.2 Asset

```ts
type AssetRole =
  | "example_video"
  | "source_video"
  | "user_image"
  | "user_text"
  | "generated_background"
  | "render_output";

type Asset = {
  id: string;
  projectId: string;
  role: AssetRole;
  filename: string;
  path: string;
  mimeType: string;
  metadata?: AssetMetadata;
  tags?: string[];
};
```

### 5.3 Structure Template

Structure Template 是从样例中拆出的可迁移结构。它不是最终视频脚本，而是一个可复用的结构协议。

Key fields:

- `segments`: hook/body/proof/cta 等段落。
- `shots`: 每个段落内部的镜头槽位。
- `requiredSlots`: 迁移到新素材时需要满足的槽位。
- `packaging`: 字幕、标题条、贴纸、转场、封面风格。
- `rhythm`: 节奏信息，如平均镜头长度、高潮位置、快慢变化。
- `structureAtoms`: 可复用的结构原子，如 hook pattern、CTA card、卖点推进。
- `editingTechniques`: 经验库项目，如 jump cut、zoom-in、text emphasis。
- `qualityRationale`: 为什么这个结构可能有效。
- `sourcePolicy`: 样例素材使用边界。

### 5.4 Generation Request

MVP v1.1 必须支持 `video_plus_prompt`：

```ts
type GenerationRequest = {
  inputMode: "video_plus_prompt" | "brief_assets" | "prompt_only";
  projectId: string;
  selectedTemplateIds?: string[];
  sourceVideo?: AssetRef;
  assets?: AssetRef[];
  prompt: string;
  target: {
    vertical: string;
    targetDurationSec: number;
    aspectRatio: "9:16" | "16:9" | "1:1";
    outputMode: "storyboard_preview" | "mp4_render";
  };
  controls?: {
    pace?: "slow" | "medium" | "fast";
    hookIntensity?: "safe" | "strong" | "aggressive";
    packagingStyle?: "clean" | "bold" | "mg_motion";
    ctaStyle?: "soft" | "direct";
  };
};
```

### 5.5 Timeline

Timeline JSON 是后续渲染器的统一输入。

Key fields:

- `clips`: 按时间排列的视频片段 / 图片片段 / text card / subtitle / overlay。
- `layers`: 每个 clip 的视觉层、字幕层、包装层。
- `mapping`: 样例 segment / structure atom 到目标 clip 的映射。
- `gapReport`: 素材缺口。
- `fillPlan`: 缺口补全动作。
- `rendererTarget`: `mock_preview`、`html_preview`、`ffmpeg`、`remotion`、`hyperframes`。
- `renderPlan`: 后续 renderer 使用的参数。

## 6. Service Design

### 6.1 ProjectService

Responsible for project metadata and workspace state.

```ts
createProject(input: CreateProjectInput): Promise<Project>
getProject(projectId: string): Promise<ProjectDetail>
listProjects(): Promise<Project[]>
```

### 6.2 AssetService

Responsible for file upload, storage path, metadata and asset roles.

```ts
saveUploadedAsset(projectId: string, file: UploadedFile, role: AssetRole): Promise<Asset>
extractBasicMetadata(assetId: string): Promise<AssetMetadata>
listAssets(projectId: string): Promise<Asset[]>
```

### 6.3 VideoAnalysisService

Responsible for deterministic video features.

MVP outputs:

- duration, width, height, fps, codec
- audio presence
- thumbnail path
- keyframe paths
- shot list with start/end/duration/confidence
- optional transcript placeholder

```ts
analyzeVideo(assetId: string, purpose: "sample" | "source"): Promise<VideoAnalysisResult>
extractKeyframes(assetPath: string): Promise<Keyframe[]>
detectShots(assetPath: string): Promise<Shot[]>
buildMockAnalysis(assetId: string, purpose: "sample" | "source"): VideoAnalysisResult
```

### 6.4 StructureExtractionService

Responsible for converting sample analysis into Structure Template.

MVP strategy:

1. Build prompt from metadata, shot list, keyframes summary and optional transcript.
2. Request strict JSON from AIAdapter or use MockAIAdapter.
3. Validate against `structure-template.schema.json`.
4. If AI fails, use fallback template:
   - 0–20% duration: `hook`
   - 20–70% duration: `body`
   - 70–85% duration: `proof`
   - 85–100% duration: `cta`
   - Use detected shots to fill shot slots.
   - Add default B-end marketing / MG packaging patterns.

```ts
extractStructure(input: StructureExtractionInput): Promise<StructureTemplate>
validateStructure(template: unknown): ValidationResult
buildFallbackTemplate(analysis: VideoAnalysisResult): StructureTemplate
```

### 6.5 KnowledgeBaseService

Responsible for storing and retrieving reusable structure experience.

```ts
saveTemplate(projectId: string, template: StructureTemplate): Promise<void>
indexAtoms(projectId: string, template: StructureTemplate): Promise<StructureAtom[]>
queryAtoms(input: AtomQuery): Promise<StructureAtom[]>
selectTemplateOrAtoms(request: GenerationRequest): Promise<SelectedStructurePlan>
```

MVP retrieval can be simple:

- prefer selected template if provided;
- otherwise filter by `vertical`;
- rank atoms by role coverage: hook, body, proof, cta;
- prefer target duration close to request.

### 6.6 SourceVideoUnderstandingService

Responsible for understanding the new uploaded source video.

MVP implementation can be simple:

- reuse `VideoAnalysisService`;
- use filename, prompt keywords and fixed interval shots to produce tags;
- optionally allow manual tags in request;
- no real VLM requirement in first version.

```ts
understandSourceVideo(sourceVideo: Asset, prompt: string): Promise<SourceVideoUnderstanding>
```

### 6.7 SlotMatchingService

Responsible for mapping structure slots to source video shots/assets.

Matching rules v1.1:

- If slot requires product closeup, prefer source shot tagged `product_like` or image tagged `product`.
- If slot requires usage, prefer shot tagged `usage_scene`.
- If slot requires comparison, prefer two related shots or fallback to text card.
- If prompt has relevant text but no visual support, mark `weak_match`.
- If neither visual nor text supports slot, mark `missing`.

```ts
matchSlots(plan: SelectedStructurePlan, source: SourceVideoUnderstanding, request: GenerationRequest): SlotMapping[]
```

### 6.8 GapFillService

Responsible for missing/weak slot remediation.

MVP strategy priority:

1. `reuse_with_crop_zoom`: use best available source video shot or product image with crop/zoom.
2. `text_card`: generate title/selling point card.
3. `packaging_overlay`: add title bar, sticker, arrow, highlight box.
4. `reorder_structure`: shorten or merge missing slot into adjacent segment.
5. `aigc_placeholder`: generate prompt/spec for future AI asset, not real video.

```ts
generateGapReport(mappings: SlotMapping[]): GapReport
generateFillPlan(report: GapReport, request: GenerationRequest): FillPlan
```

### 6.9 ReconstructionPlannerService

Responsible for turning structure + source video + gap plan into storyboard and timeline.

```ts
planReconstruction(input: ReconstructionInput): Promise<ReconstructionResult>
```

Output:

- script by segment;
- storyboard by shot;
- timeline JSON;
- migration explanation;
- warnings and known limitations.

### 6.10 RenderService

Renderer adapter interface:

```ts
interface RendererAdapter {
  target: "mock_preview" | "html_preview" | "ffmpeg" | "remotion" | "hyperframes";
  render(timeline: Timeline): Promise<RenderResult>;
}
```

MVP implementation:

- `HtmlPreviewRenderer`: returns preview data consumed by frontend.
- `MockRenderer`: returns static preview blocks for tests.

Future implementation:

- `FFmpegRenderer`: cut source video clips, add text cards, concat.
- `RemotionRenderer`: map timeline clips to React components and render MP4.
- `HyperFramesRenderer`: generate HTML/CSS/GSAP composition and render MP4.

## 7. API Design

### Projects

```http
POST /api/projects
GET /api/projects
GET /api/projects/:projectId
```

### Assets

```http
POST /api/projects/:projectId/assets
GET /api/projects/:projectId/assets
GET /api/assets/:assetId
```

### Analysis

```http
POST /api/assets/:assetId/analyze
GET /api/assets/:assetId/analysis
```

Request body:

```json
{
  "purpose": "sample"
}
```

or

```json
{
  "purpose": "source"
}
```

### Templates and Knowledge Base

```http
POST /api/templates
GET /api/templates?projectId=...
GET /api/templates/:templateId
GET /api/projects/:projectId/knowledge-base
```

### Generation

```http
POST /api/generations
GET /api/generations/:generationId
```

`POST /api/generations` accepts `generation-request.schema.json`.

### Render / Preview

```http
POST /api/generations/:generationId/render
GET /api/renders/:renderId
```

MVP may return an HTML preview payload instead of MP4.

## 8. Frontend Pages

### 8.1 Dashboard

- Project list.
- Create project.
- Open seeded demo.

### 8.2 Project Workspace

Wizard steps:

1. Sample Learning
2. Structure Review
3. Knowledge Base
4. Source Video + Prompt
5. Reconstruction Planner
6. Result Compare / Preview

### 8.3 Sample Learning View

- Upload sample video.
- Run analysis.
- Show metadata, keyframes, shots.
- Show extracted structure template.
- Save template to knowledge base.

### 8.4 Knowledge Base View

- List templates.
- List structure atoms.
- Filter by role: hook/body/proof/cta.
- Show source and rationale.

### 8.5 Reconstruction Planner View

- Upload source video.
- Input prompt.
- Select template or auto-select from knowledge base.
- Run generation.
- Show slot mapping and gap report.

### 8.6 Result Compare / Preview

- Left: sample structure and selected atoms.
- Middle: mapping and gap fill explanation.
- Right: storyboard and timeline preview.
- Export JSON files.

## 9. Validation Strategy

- Validate all schema outputs with AJV or equivalent.
- Backend should reject invalid GenerationRequest with readable errors.
- StructureTemplate and Timeline invalid output should trigger fallback generation.
- Mock mode should be deterministic for regression tests.

## 10. Extension Roadmap

### P1

- Real FFmpeg clip cutting and concat.
- Remotion renderer for 9:16 MP4.
- Better source video shot labeling with VLM.
- ASR/OCR extraction.
- Natural language edit commands.

### P2

- Multi-template fusion.
- Template clustering.
- Quality evaluator agent.
- A/B version generation.
- Rich timeline editing.
- Export to 剪映-like editable project format if feasible.
