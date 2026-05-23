# System Design — Final Spec v1.2

Project: **Viral Video Structure Transfer Engine / 爆款结构迁移引擎**

---

## 1. Design goals

1. **Structure-first**: the core output is not only a video; it is a validated structure transfer workflow.
2. **Video-input ready**: the system must accept sample videos and new source videos.
3. **Knowledge-base driven**: multiple samples can become reusable structure atoms and editing techniques.
4. **Renderer-agnostic**: Timeline JSON is the contract; preview, FFmpeg, Remotion, and HyperFrames are renderers.
5. **Provider-agnostic AI**: LLM/VLM/ASR/OCR are adapters, not hard dependencies.
6. **Deterministic fallback**: the system must run in mock mode without external API keys.
7. **Explainability by default**: every output must show sample structure, target mapping, gaps, fill strategy, and timeline.

---

## 2. Recommended repo layout

```text
.
├── README.md
├── specs_v1/
│   ├── requirements.md
│   ├── design.md
│   ├── api.md
│   ├── tasks.md
│   ├── test-plan.md
│   ├── demo-playbook.md
│   ├── source-alignment.md
│   └── schemas/
├── apps/
│   ├── web/                 # React + Vite + TypeScript
│   └── api/                 # Node.js + TypeScript + Express/Fastify
├── packages/
│   └── shared/              # shared types, schemas, validation helpers
├── storage/
│   ├── uploads/             # uploaded example/source assets
│   ├── generated/           # previews, rendered clips, exported JSON
│   └── db/                  # local JSON or SQLite
├── scripts/
│   ├── seed-demo.ts
│   └── validate-schemas.ts
└── tests/
```

---

## 3. High-level architecture

```text
React Web App
  ├─ dashboard
  ├─ sample learning view
  ├─ structure review view
  ├─ knowledge base view
  ├─ source video + prompt view
  ├─ reconstruction planner view
  └─ compare / preview / export view

Node.js API
  ├─ ProjectController
  ├─ AssetController
  ├─ AnalysisController
  ├─ TemplateController
  ├─ KnowledgeBaseController
  ├─ GenerationController
  ├─ RenderController
  └─ ExportController

Core Services
  ├─ ProjectService
  ├─ AssetService
  ├─ VideoAnalysisService
  ├─ StructureExtractionService
  ├─ KnowledgeBaseService
  ├─ SourceUnderstandingService
  ├─ SlotMatchingService
  ├─ GapDetectionService
  ├─ GapFillService
  ├─ ReconstructionPlannerService
  ├─ TimelineValidationService
  ├─ RenderService
  └─ ExportService

Adapters
  ├─ AIAdapter
  │   ├─ MockAIAdapter
  │   ├─ OpenAICompatibleAdapter
  │   └─ DoubaoCompatibleAdapter
  ├─ VLMAdapter
  │   ├─ DisabledVLMAdapter
  │   └─ KeyframeVLMAdapter
  ├─ ASRAdapter
  │   ├─ DisabledASRAdapter
  │   └─ FasterWhisperAdapter
  ├─ OCRAdapter
  │   ├─ DisabledOCRAdapter
  │   └─ OCRProviderAdapter
  ├─ VideoToolAdapter
  │   ├─ MockVideoToolAdapter
  │   ├─ FFmpegAdapter
  │   └─ OpenCVAdapter
  ├─ RendererAdapter
  │   ├─ HtmlPreviewRenderer
  │   ├─ MockRenderer
  │   ├─ FFmpegRenderer
  │   ├─ RemotionRenderer
  │   └─ HyperFramesRenderer
  └─ StorageAdapter
      ├─ LocalJsonStorage
      └─ SQLiteStorage
```

---

## 4. Runtime flows

### 4.1 Flow A — sample learning

```text
1. User creates project.
2. User uploads sample video.
3. AssetService stores file and asset record.
4. VideoAnalysisService extracts or mocks metadata, keyframes, shots, audio/subtitle summaries.
5. StructureExtractionService builds a StructureTemplate:
   - segment roles: hook/body/proof/cta;
   - shot slots;
   - rhythm;
   - packaging;
   - requiredSlots;
   - structureAtoms;
   - editingTechniques;
   - replacementPolicy;
   - qualityRationale.
6. TimelineValidationService validates StructureTemplate schema.
7. KnowledgeBaseService saves template and indexes atoms.
8. Frontend shows extracted structure and atoms.
```

### 4.2 Flow B — source reconstruction

```text
1. User uploads source video and enters prompt.
2. SourceUnderstandingService analyzes source video:
   - metadata;
   - shot candidates;
   - keyframe thumbnails;
   - heuristic tags;
   - optional ASR/OCR/VLM semantic tags.
3. KnowledgeBaseService selects template/atoms.
4. SlotMatchingService maps slots to source shots.
5. GapDetectionService flags missing/weak slots.
6. GapFillService generates fill plan.
7. ReconstructionPlannerService creates script, storyboard, Timeline JSON, explanation.
8. TimelineValidationService validates output.
9. RenderService creates HTML preview or MP4.
10. Frontend displays compare page and exports artifacts.
```

### 4.3 Flow C — natural-language revision, future

```text
1. User enters edit instruction: “开头更抓人一些”.
2. EditCommandService parses intent.
3. Planner updates selected controls or timeline segment.
4. Timeline re-validates.
5. Preview regenerates.
```

---

## 5. Core data model

### 5.1 Project

```ts
type Project = {
  id: string;
  name: string;
  vertical: "b2b_marketing_mg" | "vlog" | "talking_head" | "beat_cut" | "short_drama" | "ecommerce";
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
  | "generated_card"
  | "generated_background"
  | "render_output";

type Asset = {
  id: string;
  projectId: string;
  role: AssetRole;
  filename: string;
  path: string;
  mimeType: string;
  sourcePolicy: "user_authorized" | "open_download_or_user_uploaded" | "demo_only" | "unknown";
  metadata?: AssetMetadata;
  createdAt: string;
};
```

### 5.3 VideoAnalysisResult

```ts
type VideoAnalysisResult = {
  id: string;
  assetId: string;
  purpose: "sample" | "source";
  metadata: {
    durationSec: number;
    width?: number;
    height?: number;
    fps?: number;
    hasAudio?: boolean;
  };
  keyframes: Keyframe[];
  shots: ShotCandidate[];
  transcript?: TranscriptSegment[];
  ocr?: OcrTextBlock[];
  warnings: string[];
  analyzerMode: "mock" | "ffmpeg" | "ffmpeg_opencv" | "ffmpeg_vlm_asr";
};
```

### 5.4 StructureTemplate

StructureTemplate is the reusable “viral recipe.” It includes segments, required slots, packaging, rhythm, atoms, replacement rules, and rationale.

Main roles:

- `hook`: attention-grabbing opening;
- `setup`: context;
- `body`: selling-point or story development;
- `proof`: comparison, evidence, before/after;
- `transition`: rhythm or emotional bridge;
- `cta`: final call-to-action or closing expression.

### 5.5 KnowledgeAtom

KnowledgeAtom is the smallest reusable creative technique.

Examples:

- hook: “痛点提问 + 快速结果前置”; 
- rhythm: “前 3 秒快切，后 8 秒中速解释”;
- packaging: “大标题条 + 高亮关键词 + 箭头指示”;
- CTA: “优惠/行动引导结尾卡”;
- fill: “缺少商品特写时使用局部放大 + 标题卡”.

### 5.6 GenerationRequest

Primary mode:

```ts
inputMode: "video_plus_prompt"
```

Includes source video, selected template/atoms, prompt, target duration, aspect ratio, and creative controls.

### 5.7 Timeline

Timeline JSON is the renderer contract. It includes ordered clips/layers, subtitles, overlays, mapping, gap report, fill plan, preview instructions, and render target.

---

## 6. Video understanding design

### 6.1 MVP implementation

MVP does not require a heavy video VLM. It should still accept videos and produce deterministic outputs.

MVP video analyzer:

1. ffprobe metadata if available;
2. simple keyframe extraction if available;
3. fixed-interval shot candidates if shot detection is not ready;
4. heuristic tags from position, prompt, filename, and basic metadata;
5. mock/fallback analysis if tools fail.

### 6.2 Strong implementation

Add:

- OpenCV shot-boundary detection;
- ASR transcript with timestamps;
- OCR for on-screen text;
- VLM on selected keyframes, not necessarily full video;
- LLM summarization into strict JSON.

### 6.3 Why keyframe VLM, not full-video VLM first

Keyframe VLM is cheaper, easier to debug, and aligns with the structure-transfer task. The system needs semantic labels and packaging/style observations more than continuous video reasoning.

---

## 7. Slot matching design

### 7.1 Inputs

- selected StructureTemplate or atom plan;
- source video shot candidates;
- prompt and target constraints.

### 7.2 Output

Each slot gets:

```ts
type SlotMapping = {
  slotId: string;
  slotRole: "hook" | "setup" | "body" | "proof" | "transition" | "cta";
  status: "matched" | "weak_match" | "missing";
  candidateShotIds: string[];
  selectedShotId?: string;
  confidence: number;
  reason: string;
  risks: string[];
};
```

### 7.3 Rules

- hook slot prefers high-motion, visually clear, or surprising shots;
- product slot prefers `product_like` or close-up shots;
- usage slot prefers `usage_scene`;
- proof slot prefers comparison/before-after/evidence-like visuals;
- CTA slot may be video, text card, or packaging card;
- if prompt contains useful text but no shot exists, mark `weak_match` and use text/packaging fill;
- if neither visual nor text exists, mark `missing`.

---

## 8. Gap fill design

Strategy priority:

1. `reuse_with_crop_zoom`: crop, zoom, slow, repeat, or freeze source video frame.
2. `text_card`: create title/selling-point/explanation card.
3. `packaging_overlay`: add title bar, subtitles, arrows, sticker, highlight box.
4. `reorder_structure`: merge or shorten slot.
5. `aigc_placeholder`: generate prompt/spec for future image/video/voice asset.

Each fill action must include:

- target slot;
- chosen strategy;
- reason;
- expected visual result;
- renderer instructions;
- limitation note.

---

## 9. Renderer design

### 9.1 Interface

```ts
interface RendererAdapter {
  target: "mock_preview" | "html_preview" | "ffmpeg" | "remotion" | "hyperframes";
  render(timeline: Timeline, options?: RenderOptions): Promise<RenderResult>;
}
```

### 9.2 P0 renderer

`HtmlPreviewRenderer` maps Timeline JSON into browser cards:

- segment blocks;
- thumbnail placeholders;
- subtitles;
- overlays;
- gap-fill badges;
- timeline duration bar.

### 9.3 FFmpeg renderer

Future implementation:

- cut source clips with `-ss` / `-to`;
- create text-card images/video snippets;
- overlay subtitles or drawtext;
- concat into 9:16 MP4.

### 9.4 Remotion renderer

Future implementation:

- timeline clips become `<Sequence>` components;
- title cards, subtitles, product cards, CTA cards become React components;
- render 720p 9:16 MP4.

### 9.5 HyperFrames renderer

Future implementation:

- timeline becomes HTML/CSS/GSAP composition;
- useful for MG-style animated cards, posters, charts, transitions.

---

## 10. Storage design

### P0 local storage

```text
storage/
  uploads/
  generated/
  db/
    projects.json
    assets.json
    analyses.json
    templates.json
    atoms.json
    generations.json
    timelines.json
    jobs.json
```

### Future storage

SQLite, then PostgreSQL if needed.

---

## 11. Validation and error handling

- Validate all JSON with AJV.
- On invalid AI output, retry once with repair prompt or use fallback.
- On missing video tools, fallback to mock analysis.
- On renderer failure, keep timeline preview and exportable JSON.
- Every failed job should show readable error and next action.

---

## 12. Security and safety

- API keys from `.env` only.
- Do not commit real keys.
- Do not copy sample video frames into output unless user-authorized.
- Record source policy for every asset.
- Provide content ownership disclaimer.
- Generated output should be marked as demo unless rights are clear.

---

## 13. Engineering roadmap

### Milestone 1 — runnable mock MVP

- React workspace;
- Node API;
- local storage;
- mock analysis;
- fallback template;
- KB atoms;
- source video + prompt;
- slot matching;
- gap fill;
- timeline preview;
- exports.

### Milestone 2 — real video analysis baseline

- ffprobe metadata;
- keyframe extraction;
- basic shot detection;
- thumbnails;
- better tags.

### Milestone 3 — simple video render

- FFmpeg cut/concat;
- simple text cards;
- 9:16 output.

### Milestone 4 — AI understanding and packaging

- ASR/OCR;
- keyframe VLM;
- Remotion packaging;
- natural-language edit;
- multi-version generation.
