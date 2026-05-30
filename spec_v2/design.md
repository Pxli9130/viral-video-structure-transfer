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

## 2. Repo layout (as implemented in r3)

```text
.
├── README.md
├── spec_v2/                    # this directory — final spec
├── spec_v1_1/, specs_v1/       # historical, superseded
├── apps/
│   ├── web/                    # React + Vite + TypeScript (one-page workspace)
│   └── api/                    # Node.js + TypeScript + Express
│       ├── src/
│       │   ├── server.ts       # Express app + routes + runGeneration helper
│       │   ├── storage/        # StorageBackend interface + Json + SQLite + DatabaseStore
│       │   └── adapters/
│       │       ├── index.ts                # buildAdapterSet, Mock + heuristic wiring
│       │       ├── openaiCompatible.ts     # real OpenAI-style client (ark_doubao alias)
│       │       ├── gemini.ts               # real Gemini VLM (inline + Files API)
│       │       ├── renderers.ts            # FFmpeg + Remotion + HyperFrames + selectRenderer
│       │       └── condaPython.ts          # conda viral Python subprocess runner
│       ├── remotion/
│       │   ├── index.tsx                   # registerRoot + Composition
│       │   └── ReconstructionRoot.tsx      # the React composition driven by Timeline
│       └── tests/
│           ├── e2e.test.ts                 # supertest pipeline E2E
│           ├── storage.test.ts             # Json/SQLite parity
│           └── remotion-bundle.test.ts     # gated bundle smoke
├── packages/
│   ├── shared/                 # types, schemas, AJV validators, mock pipeline
│   └── renderer/               # HtmlPreviewRenderer + MockRenderer (browser-safe)
├── storage/
│   ├── uploads/                # uploaded example/source assets
│   ├── generated/              # previews, rendered MP4s, hyperframes manifests, exported JSON
│   ├── db/                     # app.json (default) or app.sqlite (when STORAGE_BACKEND=sqlite)
│   └── demo/                   # seeded fixtures from scripts/seed-demo.mjs
├── scripts/
│   ├── seed-demo.mjs
│   ├── validate-schemas.mjs
│   └── python/                 # ffprobe_metadata, extract_keyframes, asr_faster_whisper, ocr_easyocr
└── (no separate top-level tests/; api and shared each host vitest tests)
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
  ├─ VisualEvidenceTimelineService
  ├─ StructureExtractionService
  ├─ OpenWorldSlotInductionService
  ├─ KnowledgeBaseService
  ├─ SourceUnderstandingService
  ├─ SlotMatchingService
  ├─ MaterialPolicyService
  ├─ TargetAssetMatchingService
  ├─ GapDetectionService
  ├─ GapFillService
  ├─ AigcMaterialPlanner
  ├─ AigcMaterialQualityGate
  ├─ RendererCapabilityService
  ├─ ReconstructionPlannerService
  ├─ TimelineValidationService
  ├─ RenderService
  └─ ExportService

Adapters (real providers only; no runtime mock — a failed provider raises a real error)
  ├─ AIAdapter (text LLM, a separate request from the VLM)
  │   ├─ GeminiAIAdapter (default; gemini-2.5-flash)
  │   ├─ OpenAICompatibleAdapter
  │   └─ DoubaoCompatibleAdapter (Ark Doubao, backup)
  ├─ VLMAdapter
  │   ├─ DisabledVLMAdapter
  │   └─ KeyframeVLMAdapter (Gemini gemini-2.5-pro)
  ├─ ASRAdapter
  │   ├─ DisabledASRAdapter
  │   └─ FasterWhisperAdapter
  ├─ OCRAdapter
  │   ├─ DisabledOCRAdapter
  │   └─ OCRProviderAdapter (EasyOCR)
  ├─ VideoToolAdapter
  │   ├─ FFmpegAdapter
  │   └─ OpenCVAdapter
  ├─ RendererAdapter
  │   ├─ HtmlPreviewRenderer
  │   ├─ FFmpegRenderer
  │   ├─ RemotionRenderer
  │   └─ HyperFramesRenderer
  ├─ AigcMaterialProvider
  │   ├─ google_gemini_image (primary; gemini-2.5-flash-image / "Nano Banana")
  │   ├─ volcengine_seedream (backup)
  │   ├─ local_folder_provider
  │   ├─ ark_seedance_provider_stub
  │   ├─ image_provider
  │   ├─ copy_provider
  │   └─ mock_provider (deterministic; CI/scripts only, never in the live generation path)
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

### 4.4 Flow D — motion-graph evidence, material intake, and target-asset adaptation

This flow is the current SDE/MLE hardening showcase. It is intentionally scoped to `motion_graph_case`; editing/marketing/corpus analyzer expansion is not assumed by this slice.

```text
1. scripts/analyze-visual-evidence.py reads test_videos/motion_graph_1.mov.
2. The analyzer writes VisualEvidenceTimeline artifacts:
   - visual-evidence.json;
   - evidence_frames/;
   - visual-evidence-contact-sheet.png.
3. slotInduction induces open-world visual families from visual evidence:
   - media_cards;
   - kinetic_typography;
   - ui_showcase;
   - geometric_mg;
   - brand_cta;
   - optional object_motion/live_action_montage when evidence supports it.
4. The motion-graph template is renamed to a learned motion-graph structure and uses induced slots as the primary flow.
5. The material policy blocks sample/reference frames as target material.
6. Proxy mode leaves visual assets missing and renders family-specific proxies.
7. Target-asset mode loads `docs/fixtures/motion_graph_target_assets/` or a `--target-assets-manifest` file and matches assets to slots.
8. Managed API intake uses `POST /api/projects/:projectId/assets` followed by `POST /api/projects/:projectId/target-material-manifests`; public responses use safe refs such as `asset://managed/<assetId>`, while renderer path resolution stays server-side.
9. Partial and malformed modes prove insufficient/invalid material remains weak or blocked rather than being falsely matched.
10. Fill planning switches matched slots from proxy placeholders to target-material/procedural fulfillment.
11. FFmpegRenderer renders target card stack, target feature list, target kinetic copy, procedural neon geometry, and target logo/CTA hold.
12. The case writes MP4s, before/after contact sheets, slot-match artifacts, blocked-material reports, and evaluation gates.
```

Active commands:

```bash
node scripts/run-motion-graph-case.mjs
node scripts/run-motion-graph-case.mjs --with-target-assets
node scripts/run-motion-graph-case.mjs --with-partial-target-assets
node scripts/run-motion-graph-case.mjs --with-malformed-target-assets
node scripts/run-motion-graph-case.mjs --target-assets-manifest docs/fixtures/motion_graph_target_assets/manifest.json
```

Primary outputs are under `docs/artifacts/motion_graph_case/`.

### 4.5 Flow E — optional AIGC material fill

This flow is optional and only runs when explicitly requested. It fills missing visual material without copying sample frames.

```text
1. User either clicks the web "AIGC 补缺口并生成" action or runs an explicit AIGC script mode.
2. UI/API sets controls.allowAigcMaterialGeneration=true.
3. External providers remain disabled unless controls.allowExternalAigcProvider=true or the script receives --allow-external-aigc.
4. GapReportItem and induced slots identify missing/weak visual material.
5. AigcMaterialPlanner creates MaterialGenerationBrief records only when AIGC fill is enabled.
6. When external providers are allowed, the live API path uses real image providers in order: google_gemini_image (primary) → volcengine_seedream (backup) → a real error. It never silently falls back to a mock in the live generation path; mock_provider is reserved for CI/script determinism.
7. Provider generates candidate image material into generated-assets storage.
8. Deterministic quality checks verify file/type/non-empty/path hygiene.
9. Gemini VLM may review candidates with strict JSON; sample frames are not sent.
10. Usable candidates are registered as target assets with materialRole="aigc_generated_material".
11. Asset matcher and fill planner select aigc_generated_asset strategies for matching slots.
12. Renderer writes the AIGC render and contact sheet/artifacts.
```

Active commands:

```bash
node scripts/run-motion-graph-case.mjs --with-aigc-materials
node scripts/run-motion-graph-case.mjs --with-aigc-materials --aigc-provider env --allow-external-aigc
```

Safety rules:

- AIGC material fill is disabled by default.
- External providers require explicit opt-in through `allowExternalAigcProvider` or `--allow-external-aigc`.
- Seedream image generation uses `watermark=false` for review artifacts.
- Generated assets are labeled as generated material, not user-provided material.
- Brand/logo gaps create placeholders or ask-user-upload actions; they do not fabricate a real logo.

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

### 5.8 InducedVisualSlot

`InducedVisualSlot` is the open-world slot representation used by the evidence-driven motion-graph path. It sits between raw visual evidence and a concrete `RequiredSlot`.

Important fields:

```ts
type InducedVisualSlot = {
  id: string;
  role: SegmentRole;
  modality: "visual" | "text" | "audio" | "mixed";
  visualFormFamily:
    | "media_cards"
    | "kinetic_typography"
    | "ui_showcase"
    | "geometric_mg"
    | "object_motion"
    | "live_action_montage"
    | "brand_cta"
    | "unknown";
  visualForm: string;
  motionPattern?: string;
  layoutRelation?: string;
  assetRequirement?: SlotAssetRequirement;
  sourceEvidence?: SlotSourceEvidence;
  rendererCandidates: string[];
  fallbackStrategies: FillStrategy[];
  replacementPolicy: ReplacementPolicy;
  confidence: number;
};
```

The goal is not to invent a fixed slot taxonomy for every possible video. The goal is to keep enough structured evidence that a renderer, asset matcher, evaluator, and UI can explain what was preserved and what still needs material.

### 5.9 TargetAssetInput and material roles

Target assets represent material that may appear in the generated output. Sample/reference video frames are not target assets by default.

For the current motion-graph target fixture:

```text
target_card_01..04     image cards for media_cards
target_feature_copy    feature-list copy for ui_showcase
target_kinetic_copy    brand/copy for kinetic_typography
target_logo            logo + brand/CTA metadata for brand_cta
```

Material policy rules:

- sample/reference material is structure evidence only unless sample reuse is authorized;
- mock/no-path assets cannot satisfy visual slots;
- copy can satisfy copy/text-driven slots, not arbitrary visual slots;
- procedural families such as `geometric_mg` can be marked `procedural_not_required`;
- missing visual material creates a gap plus proxy/replacement slot.

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
  selectedTargetAssetId?: string;
  selectedTargetAssetIds?: string[];
  selectedTargetAssetKind?: TargetAssetKind;
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
- for `media_cards`, match a target image set only when enough renderable target images exist;
- for `geometric_mg`, use procedural fulfillment when no external asset is required;
- never match sample/reference shots as output material unless explicitly authorized.

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

For induced visual slots, fill plan behavior is slot-family specific:

| Family | Proxy mode | Target-asset mode |
|---|---|---|
| `media_cards` | `card_stack_proxy` | `user_asset_replace` with target image set |
| `kinetic_typography` | `kinetic_text_card` from prompt/copy | `kinetic_text_card` using target copy |
| `ui_showcase` | `feature_list_scroller` from prompt/copy | `feature_list_scroller` using target feature list |
| `geometric_mg` | procedural neon geometry | procedural neon geometry |
| `brand_cta` | logo placeholder | target logo + brand/CTA hold |
| `live_action_montage` | montage proxy | proxy unless enough image/video material exists |

---

## 9. Renderer design

### 9.1 Interface

```ts
interface RendererAdapter {
  target: "html_preview" | "ffmpeg" | "remotion" | "hyperframes";
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

Implemented and used by the motion-graph artifact path:

- cut source clips with `-ss` / `-to`;
- create text-card images/video snippets;
- overlay subtitles or drawtext;
- concat into 9:16 MP4.
- render family-specific motion-graph cards (`media_cards`, `ui_showcase`, `kinetic_typography`, `geometric_mg`, `brand_cta`, `object_motion`, `live_action_montage`). These are **real procedural cards**, not debug placeholders: each shows a clean CJK family header (媒体卡片 / 功能展示 / 动态文字 / 霓虹几何 / 品牌 CTA …) plus the clip's real copy (`subtitleText`/`visualIntent`/target copy). Debug words (`proxy`/`placeholder`/`占位`/`代理`) are stripped from any label before drawing, so no rendered frame ever shows "…PROXY"/"…PLACEHOLDER" text.
- render target image sets as card stacks (real generated/uploaded images; empty slots show only an outline, no debug text);
- render target logo + CTA holds.
- sample one real still per clip from its rendered segment into `storage/generated/previews/<renderId>/clip_<n>.png`, returned as `RenderOutput.clipPreviewFrames` (`{ clipId, previewFrame }[]`) so the web timeline preview shows actual frames instead of gradient placeholders. Extraction is non-fatal: a missing still falls back to the placeholder card.
- **Beat-cut style primitives** (driven by `clip.motionPrimitive` + `clip.beatTimestamps` + `renderPlan.beatGrid`): `neon_hero_intro`, `beat_text_card`, `tutorial_rule_card`, `action_montage`, `impact_flash_stamp`, `motivation_cta` — dark background, bold center CJK typography, red/yellow emphasis, beat-synced flashes and hard cuts. No placeholder/proxy text reaches a beat-cut output.
- **Audio**: per `renderPlan.audioPolicy` — `sample_bgm` (carry authorized sample audio when `sampleAssetReuse=authorized`), `synth_beat` (generate a beat-aligned click track at the timeline BPM), or `silent`. `RenderOutput.renderQualityWarnings` flags `no_audio`/`placeholder_detected`/`no_source_clips`/`weak_style_transfer`.

### 9.3a Evidence-first beat-cut pipeline

For fast-cut / editing-tutorial samples (`videoType=beat_cut`), perception is deterministic-first:

1. `scripts/analyze-evidence-timeline.py` extracts a **`VisualEvidenceTimeline` v2** — PySceneDetect `ContentDetector` scene cuts, librosa beat grid (BPM/beats/onsets), per-shot keyframes + visual/style tags + **per-shot `motionEnergy` (Farneback optical flow)**, black-bg/cut-density/palette stats, a **6-family `evidenceFamilies` summary** (object_motion / kinetic_typography / background / storyboard / live_action_montage / bgm), **`movingObjectCandidates`**, a **`detectedStyle`** fingerprint, and a **60-frame `frameMetrics` array** `{blackBgRatio, redYellowRatio, motionDiffMean, cutLikeCount}`. A `--metrics-only` mode returns just ffprobe + those frame metrics — the single source of truth the render gate recomputes on the rendered MP4. Frames are served under `/generated/evidence/<assetId>/` (safe paths, never absolute).
2. The timeline is attached to `VideoAnalysisResult.evidenceTimeline` **before** the VLM call, and a compact summary grounds Gemini (so it cites cuts/beats/families instead of free-form guessing). ASR/OCR text is then bound to shots by timestamp.
3. `videoType=beat_cut` is decided by the deterministic evidence (fast cuts + audio beats + dark bg + montage), not VLM keywords, so it survives LLM failure. `buildBeatCutTemplate` emits **8 named, evidence-bound moving-material slots** — `slot_moving_hero_object`, `slot_dark_background` (global background layer), `slot_kinetic_text_card`, `slot_storyboard_rule_card`, `slot_moving_source_montage` (modality `video_set`, `minCount:3`, fallback ladder `target_source_clips_by_motion → aigc_generated_material → procedural_dynamic_proxy`), `slot_impact_flash`, `slot_bgm_grid` (global BGM beat grid), `slot_motivation_cta` — each with `modality` + `assetRequirement` + renderer candidates + frame/timestamp/motion evidence. Non-global slots are tightened to their role window (no whole-video ranges). `buildTimeline` emits **layered clips** (`layers[]` of `background`/`moving_material`/`moving_video`/`text`/`text_overlay`/`transition`/`ticker`/`beat_bars` with `slotId`/`motion`/`assetPolicy`) driven by the real 152-BPM grid, plus a first-class `RenderPlan.audioPlan`.
4. **Honest gaps:** with no target moving clips, `generateGapReport` emits `moving_material_missing` (the montage renders a high-motion **procedural dynamic proxy**, never sample frames) + `bgm_missing` (a synthesized beat track rides the detected BPM). Sample visuals are stripped from beat-cut clips even under authorized self-reconstruction. AI enrichment failure is surfaced via `StructureTemplate.aiEnrichmentStatus` (`ok|failed|skipped`) + `aiEnrichmentError`; `scoreTemplate` penalizes evidence-poor templates and exposes `selectedTemplateReason` + a UI warning.
5. The **style-locked dynamic renderer** (`renderBeatCutPrimitive`) draws a moving dark-tech background, per-beat white flashes, animated beat-EQ bars, a hard-cut cyan/orange montage field, a red radial impact starburst, a scrolling CTA ticker, clean Chinese genre tags and bold red/yellow/white copy — hitting `motionDiffMean ≥ 0.04` (≈0.06), `cutLikeCount ≥ 5` (≈17), `redYellowRatio ≈ 0.09` vs the old static 0.025 / 0 / 0.012.
6. `scripts/evaluate-render-quality.mjs --gates v2` gates the output with 12 `mustPass` booleans + metric thresholds (`minMotionDiffMean 0.04`, `minCutLikeCount 5`, `minMovingMaterialFamilies 3`, `minSlotEvidenceCoverage 0.8`, `minLayeredClips 5`, 720×1280, audio, `moving_material_missing` reported) — **27/27** on the editing.mov render. Golden regression: `packages/shared/src/__tests__/editingMovMovingMaterialGolden.test.ts` (deterministic, v2) + the prior `editingMovBeatCutGolden.test.ts`, fixtures under `test_fixtures/expected_editing_mov_case_v2/`.

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
- Public HTML/JSON artifacts should avoid absolute private paths and secret patterns.
- Source evidence frames shown in timelines should be labeled as evidence-only, not target material.
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

### Milestone 5 — evidence-driven slot transfer and target adaptation

- deterministic VisualEvidenceTimeline for motion-graph sample;
- open-world slot induction;
- material-pool policy and no-sample-copy boundary;
- target asset fixture and slot matching;
- proxy mode and with-assets mode;
- renderer capability gates;
- corpus fixture `009_motion_graph_card_stack`.
