# Tasks — 爆款结构迁移引擎 MVP v0.1

本任务列表用于第一版开发。目标是 1–2 周内跑通核心闭环，不追求完整功能覆盖。

## Phase 0 — Repo Scaffolding

- [ ] T0.1 Initialize monorepo structure
  - `apps/web` React + TypeScript + Vite
  - `apps/api` Node.js + TypeScript + Express/Fastify
  - `packages/shared` shared types and schemas
  - `packages/renderer` renderer adapter placeholder
- [ ] T0.2 Add basic tooling
  - ESLint, Prettier, TypeScript strict mode
  - npm/pnpm scripts: `dev`, `build`, `test`, `lint`
- [ ] T0.3 Add `.env.example`
  - mock AI provider default
  - data directory
  - ffmpeg/ffprobe path
  - renderer mode
- [ ] T0.4 Add local data folders
  - `data/uploads`
  - `data/outputs`
  - `data/cache`
  - `data/demo`

## Phase 1 — Shared Contracts and Schemas

- [ ] T1.1 Add shared TypeScript types
  - Project, Asset, Job, ExampleAnalysis, StructureTemplate, GenerationRequest, Timeline, RenderOutput
- [ ] T1.2 Add JSON schemas
  - `structure-template.schema.json`
  - `generation-request.schema.json`
  - `timeline.schema.json`
- [ ] T1.3 Add schema validation utility
  - Use Ajv or Zod
  - Expose `validateStructureTemplate`, `validateTimeline`, `validateGenerationRequest`
- [ ] T1.4 Add deterministic ID and timestamp helpers

**Verification**

- [ ] Unit tests pass for valid and invalid schema examples.
- [ ] Invalid AI/timeline JSON returns readable validation error.

## Phase 2 — Backend Foundation

- [ ] T2.1 Implement API server health endpoints
  - `GET /healthz`
  - `GET /readyz`
- [ ] T2.2 Implement local storage adapter
  - save uploaded files
  - generate stable file paths
  - create output folders per project
- [ ] T2.3 Implement lightweight database
  - MVP can use SQLite, lowdb, Prisma SQLite, or JSON-file storage
  - tables/collections: projects, assets, jobs, analyses, templates, generations, renders
- [ ] T2.4 Implement job state machine
  - queued, running, succeeded, failed
  - progress and error message
- [ ] T2.5 Implement project APIs
  - `POST /api/projects`
  - `GET /api/projects`
  - `GET /api/projects/:id`

**Verification**

- [ ] Can create and fetch project from API.
- [ ] Server restarts without losing project metadata.

## Phase 3 — Asset Upload and Video Metadata

- [ ] T3.1 Implement asset upload endpoint
  - `POST /api/projects/:projectId/assets`
  - multipart file upload
  - role parameter: example_video, user_video, user_image, user_text
- [ ] T3.2 Implement asset list endpoint
  - `GET /api/projects/:projectId/assets`
- [ ] T3.3 Implement FFprobe metadata extraction
  - duration, width, height, fps, codec, audio presence
- [ ] T3.4 Implement thumbnail/keyframe extraction
  - first frame thumbnail
  - 1 frame per second or max 12 frames for MVP
- [ ] T3.5 Implement basic scene/shot detection
  - use ffmpeg scene detection or simple interval fallback
  - output shot list with start/end/duration
- [ ] T3.6 Implement graceful fallback when FFmpeg is missing
  - mark analysis as mock/demo mode
  - allow seeded example analysis

**Verification**

- [ ] Upload sample MP4/MOV and view metadata.
- [ ] Keyframes are visible in local output folder.
- [ ] Shot list is generated even if scene detection falls back to fixed intervals.

## Phase 4 — Sample Structure Extraction

- [ ] T4.1 Implement AIAdapter interface
  - `MockAIAdapter`
  - optional OpenAI-compatible adapter skeleton
- [ ] T4.2 Build structure extraction prompt template
  - input: metadata, shots, optional transcript, frame summaries
  - output: strict JSON matching structure schema
- [ ] T4.3 Implement deterministic fallback template builder
  - split video into hook/body/cta by duration
  - map detected shots into required slots
  - assign default packaging based on project category
- [ ] T4.4 Implement `POST /api/assets/:assetId/analyze`
  - create analysis job
  - run video analysis
  - run structure extraction
  - save ExampleAnalysis and StructureTemplate draft
- [ ] T4.5 Implement `GET /api/assets/:assetId/analysis`
- [ ] T4.6 Implement template save/list/detail APIs
  - `POST /api/templates`
  - `GET /api/templates?projectId=`
  - `GET /api/templates/:templateId`

**Verification**

- [ ] Analyze sample video and produce valid StructureTemplate JSON.
- [ ] AI provider can be `mock` and still produce valid output.
- [ ] Template can be saved and retrieved.

## Phase 5 — New Brief, Asset Understanding, Slot Matching

- [ ] T5.1 Implement generation request API
  - `POST /api/generations`
  - input: projectId, templateId, brief, assetIds, controls
- [ ] T5.2 Implement brief parser
  - extract product name, selling points, target audience, CTA
  - use mock/AI fallback
- [ ] T5.3 Implement user asset understanding
  - image/video metadata
  - manual tags from request if provided
  - filename/text heuristic tags
- [ ] T5.4 Implement slot matcher
  - compare `visual_requirement` and `shot_type` with asset tags
  - output matched / weak_match / missing
- [ ] T5.5 Implement gap report generator
  - missing slot list
  - impact explanation
  - severity

**Verification**

- [ ] With only one product image + text brief, system detects usage/comparison/CTA gaps.
- [ ] With a matching video asset, at least one slot becomes matched.
- [ ] Slot mapping table is returned by API.

## Phase 6 — Gap Fill and Migration Planning

- [ ] T6.1 Implement gap-fill strategies
  - text_card
  - packaging_overlay
  - reuse_with_crop_zoom
  - reorder_structure
- [ ] T6.2 Implement fill plan generator
  - every missing slot gets at least one fill action
  - fill actions are explainable
- [ ] T6.3 Implement migration planner
  - generate script by segment
  - generate storyboard by shot
  - generate Timeline JSON
  - generate migration explanation
- [ ] T6.4 Validate Timeline JSON
  - no empty clips
  - total duration within target range
  - every clip has visual layer or generated card
- [ ] T6.5 Implement generation result endpoint
  - `GET /api/generations/:generationId`

**Verification**

- [ ] Timeline has no empty slot.
- [ ] Storyboard contains shot duration, subtitle, asset/fill action, transition.
- [ ] Generation result includes mapping, gap report, fill plan, timeline, explanation.

## Phase 7 — MVP Renderer / Preview

- [ ] T7.1 Implement RendererAdapter interface
- [ ] T7.2 Implement `HtmlPreviewRenderer`
  - render timeline as browser-previewable cards/layers
  - use asset thumbnails and generated text cards
- [ ] T7.3 Implement simple `FFmpegRenderer` or Remotion skeleton
  - 9:16 720p
  - image/video clips
  - text overlays or text-card clips
  - hard-cut transition first
- [ ] T7.4 Implement render API
  - `POST /api/generations/:generationId/render`
  - `GET /api/renders/:renderId`
- [ ] T7.5 Add render fallback
  - if MP4 render fails, output preview and timeline JSON

**Verification**

- [ ] At least one output mode is generated for demo.
- [ ] Render output uses new brief/materials and not original sample content.
- [ ] Render status and output path are visible from API.

## Phase 8 — Frontend MVP

- [ ] T8.1 Build Dashboard
  - project list
  - create project
  - open demo project
- [ ] T8.2 Build Project Workspace wizard
  - Sample Upload
  - Sample Analysis
  - Template Review
  - New Content Input
  - Migration Planner
  - Result & Compare
- [ ] T8.3 Build Sample Analysis page
  - upload example video
  - run analysis
  - show metadata, keyframes, shot list
  - show structure JSON and explanation
  - save template
- [ ] T8.4 Build New Content page
  - brief form
  - asset upload/list
  - controls: hook style, pace, packaging style, CTA style
- [ ] T8.5 Build Migration Planner page
  - slot mapping table
  - gap report cards
  - fill plan cards
  - generate button
- [ ] T8.6 Build Result & Compare page
  - sample structure summary
  - mapping explanation
  - storyboard table
  - timeline preview / video player
  - export JSON/report buttons

**Verification**

- [ ] User can complete the full flow without using API manually.
- [ ] Compare page clearly shows extraction, mapping, gap and result.

## Phase 9 — Demo Data, Tests and Documentation

- [ ] T9.1 Add seeded demo project
  - sample analysis JSON
  - sample template JSON
  - product brief
  - product image/video placeholders
- [ ] T9.2 Add automated tests
  - schema validation tests
  - fallback template tests
  - slot matching tests
  - gap fill tests
  - timeline validation tests
- [ ] T9.3 Add end-to-end demo script
  - start server/web
  - load demo project
  - generate timeline
  - render/preview output
- [ ] T9.4 Add README
  - installation
  - environment variables
  - mock mode
  - real AI provider setup
  - FFmpeg setup
  - demo steps
- [ ] T9.5 Add project explanation doc skeleton
  - AI architecture
  - tool protocol
  - safety boundaries
  - current limitations
  - future roadmap

**Verification**

- [ ] Fresh clone can run demo in mock mode.
- [ ] README steps reproduce the core flow.
- [ ] Demo material is enough for a 2–3 minute walkthrough.

## Future Backlog After MVP

- [ ] Multi-template library and template fusion.
- [ ] Real VLM frame understanding.
- [ ] ASR + OCR subtitle extraction.
- [ ] Beat detection and BGM/cut alignment.
- [ ] Natural language edit commands.
- [ ] Multi-version generation: high-click, high-conversion, high-pace, premium.
- [ ] Remotion advanced packaging: title bar, stickers, animated cards, alpha overlays.
- [ ] Evaluation Agent: hook score, CTA clarity, slot coverage, rhythm consistency.
- [ ] Full timeline editor with drag/drop.
