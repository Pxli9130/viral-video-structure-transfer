# Tasks — 爆款结构迁移引擎 MVP Spec v1.1

This task list is for the first coding version. It should produce a working, expandable MVP skeleton, not a perfect final product.

## Phase 0 — Spec Alignment and Repo Hygiene

- [ ] T0.1 Keep `specs_v1/` as the source of truth for MVP v1.1.
- [ ] T0.2 Update root README with spec links and local run target.
- [ ] T0.3 Add `.gitignore` for `node_modules`, `.env`, `storage/uploads`, `storage/generated`, logs and local DB files.
- [ ] T0.4 Add `.env.example` with mock provider defaults.
- [ ] T0.5 Decide package manager: npm is acceptable for first version.

**Verification**

- [ ] New developer can understand project goal from README.
- [ ] No API key or uploaded video is committed.

## Phase 1 — Monorepo Bootstrap

- [ ] T1.1 Create root `package.json` with workspaces.
- [ ] T1.2 Create `apps/api` with TypeScript backend.
- [ ] T1.3 Create `apps/web` with React + Vite + TypeScript frontend.
- [ ] T1.4 Create `packages/shared` for shared types, constants and schema loading.
- [ ] T1.5 Add root scripts:
  - `npm run dev`
  - `npm run dev:api`
  - `npm run dev:web`
  - `npm run build`
  - `npm run test`
- [ ] T1.6 Add basic lint/typecheck scripts if practical.

**Verification**

- [ ] `npm install` succeeds.
- [ ] `npm run dev` starts API and Web, or README explains separate commands.
- [ ] Web can call API health endpoint.

## Phase 2 — Shared Schemas and Types

- [ ] T2.1 Copy JSON schemas from `specs_v1/schemas` into shared runtime location or load them directly.
- [ ] T2.2 Define TypeScript types for:
  - Project
  - Asset
  - VideoAnalysisResult
  - StructureTemplate
  - StructureAtom
  - GenerationRequest
  - SlotMapping
  - GapReport
  - FillPlan
  - Timeline
  - RenderResult
- [ ] T2.3 Add schema validation helper using AJV or equivalent.
- [ ] T2.4 Add unit tests for schema validation.

**Verification**

- [ ] Valid sample StructureTemplate passes validation.
- [ ] Invalid Timeline without clips fails validation.

## Phase 3 — Storage and Job State

- [ ] T3.1 Implement `StorageAdapter` interface.
- [ ] T3.2 Implement `LocalJsonStorageAdapter` first.
- [ ] T3.3 Create storage folders:
  - `storage/uploads`
  - `storage/generated`
  - `storage/db`
- [ ] T3.4 Persist:
  - projects
  - assets
  - analyses
  - templates
  - knowledge atoms
  - generations
  - renders
- [ ] T3.5 Implement job state model:
  - queued
  - running
  - succeeded
  - failed
- [ ] T3.6 Track job progress, error message, createdAt, updatedAt.

**Verification**

- [ ] Server restart does not lose project/template/generation metadata.
- [ ] Failed job returns readable error.

## Phase 4 — Project and Asset APIs

- [ ] T4.1 Implement project APIs:
  - `POST /api/projects`
  - `GET /api/projects`
  - `GET /api/projects/:projectId`
- [ ] T4.2 Implement asset upload endpoint:
  - `POST /api/projects/:projectId/assets`
  - multipart file upload
  - role parameter: `example_video`, `source_video`, `user_image`, `user_text`
- [ ] T4.3 Implement asset list/detail endpoints:
  - `GET /api/projects/:projectId/assets`
  - `GET /api/assets/:assetId`
- [ ] T4.4 Enforce file size and file type constraints.
- [ ] T4.5 Store assets under project-specific folders.

**Verification**

- [ ] Can create project.
- [ ] Can upload example video and source video.
- [ ] Asset is persisted and listed.

## Phase 5 — Video Analysis with Mock Fallback

- [ ] T5.1 Implement `VideoToolAdapter` interface.
- [ ] T5.2 Implement `MockVideoToolAdapter` that returns deterministic metadata, keyframes and fixed-interval shots.
- [ ] T5.3 Implement optional `FFprobeVideoToolAdapter` if FFmpeg is available.
- [ ] T5.4 Implement `VideoAnalysisService.analyzeVideo(assetId, purpose)`.
- [ ] T5.5 Implement analysis API:
  - `POST /api/assets/:assetId/analyze`
  - `GET /api/assets/:assetId/analysis`
- [ ] T5.6 Support `purpose = sample | source`.
- [ ] T5.7 Generate source video shot candidates for reconstruction.

**Verification**

- [ ] Example video analysis returns duration, resolution, thumbnails/keyframes and shots.
- [ ] Source video analysis returns candidate shots.
- [ ] If FFmpeg is missing, mock mode still completes.

## Phase 6 — Sample Structure Extraction and Knowledge Base

- [ ] T6.1 Implement `AIAdapter` interface.
- [ ] T6.2 Implement `MockAIAdapter` for deterministic structure extraction.
- [ ] T6.3 Add optional OpenAI-compatible/Doubao-compatible adapter skeleton, but do not require real key.
- [ ] T6.4 Implement `StructureExtractionService`:
  - build prompt payload from video analysis
  - generate StructureTemplate
  - validate schema
  - fallback if invalid
- [ ] T6.5 Implement fallback template builder:
  - hook 0–20%
  - body 20–70%
  - proof 70–85%
  - cta 85–100%
  - default B-end marketing / MG packaging
- [ ] T6.6 Extract `structureAtoms` and `editingTechniques`.
- [ ] T6.7 Implement Template APIs:
  - `POST /api/templates`
  - `GET /api/templates?projectId=`
  - `GET /api/templates/:templateId`
- [ ] T6.8 Implement Knowledge Base API:
  - `GET /api/projects/:projectId/knowledge-base`

**Verification**

- [ ] Analyze sample video and produce valid StructureTemplate JSON.
- [ ] Template includes structure atoms.
- [ ] Knowledge base lists atoms and their source template.

## Phase 7 — Generation Request: Video + Prompt Reconstruction

- [ ] T7.1 Implement generation request API:
  - `POST /api/generations`
  - `GET /api/generations/:generationId`
- [ ] T7.2 Validate request against `generation-request.schema.json`.
- [ ] T7.3 Support `inputMode = video_plus_prompt` as P0.
- [ ] T7.4 Allow selected template IDs, but also support auto-select from knowledge base.
- [ ] T7.5 Implement prompt parser:
  - product/topic
  - target user
  - selling points
  - style
  - CTA
  - target duration
- [ ] T7.6 Implement source video understanding:
  - reuse analysis result
  - generate shot candidate tags
  - combine prompt keywords with shot candidates

**Verification**

- [ ] Request with source video + prompt creates generation job.
- [ ] Request without selected template can still select atoms from knowledge base.
- [ ] Invalid request returns readable validation error.

## Phase 8 — Slot Matching and Gap Detection

- [ ] T8.1 Implement `SlotMatchingService`.
- [ ] T8.2 Map structure slots to source video shot candidates.
- [ ] T8.3 Output statuses:
  - matched
  - weak_match
  - missing
- [ ] T8.4 Implement missing slot categories:
  - hook_visual
  - product_closeup
  - usage_scene
  - comparison_scene
  - cta_visual
  - text_or_subtitle
- [ ] T8.5 Implement gap report with severity and impact explanation.
- [ ] T8.6 Save slot mapping and gap report to generation result.

**Verification**

- [ ] With sparse source video/mock tags, system detects missing usage/comparison/CTA slots.
- [ ] At least one slot can be matched to source video.
- [ ] Gap report is visible from API.

## Phase 9 — Gap Fill and Reconstruction Planning

- [ ] T9.1 Implement gap-fill strategies:
  - `reuse_with_crop_zoom`
  - `text_card`
  - `packaging_overlay`
  - `reorder_structure`
  - `aigc_placeholder`
- [ ] T9.2 Implement strategy selector.
- [ ] T9.3 Ensure every missing slot receives a fill action.
- [ ] T9.4 Implement `ReconstructionPlannerService`.
- [ ] T9.5 Generate:
  - script by segment
  - storyboard by shot
  - Timeline JSON
  - migration explanation
- [ ] T9.6 Validate Timeline JSON.
- [ ] T9.7 Make total duration close to target duration, default 10–20s.

**Verification**

- [ ] Timeline has no empty slots.
- [ ] Storyboard contains shot duration, subtitle, asset/fill action, transition and packaging.
- [ ] Generation result includes mapping, gap report, fill plan, timeline and explanation.

## Phase 10 — Renderer / Preview

- [ ] T10.1 Implement `RendererAdapter` interface.
- [ ] T10.2 Implement `HtmlPreviewRenderer` as P0.
- [ ] T10.3 Implement render/preview APIs:
  - `POST /api/generations/:generationId/render`
  - `GET /api/renders/:renderId`
- [ ] T10.4 Generate preview-ready timeline cards/layers for frontend.
- [ ] T10.5 Add placeholder `FFmpegRenderer`, `RemotionRenderer`, `HyperFramesRenderer` interfaces for future use.
- [ ] T10.6 Do not block MVP on real MP4 render.

**Verification**

- [ ] At least browser preview output is generated.
- [ ] Render result references Timeline JSON.
- [ ] Preview uses source video/new generated cards, not copied sample video content.

## Phase 11 — Frontend MVP

- [ ] T11.1 Build Dashboard:
  - project list
  - create project
  - open demo project
- [ ] T11.2 Build Project Workspace wizard:
  - Sample Learning
  - Structure Review
  - Knowledge Base
  - Source Video + Prompt
  - Reconstruction Planner
  - Result & Compare
- [ ] T11.3 Build Sample Learning page:
  - upload example video
  - run analysis
  - show metadata, keyframes, shot list
  - show structure JSON and explanation
  - save template
- [ ] T11.4 Build Knowledge Base page:
  - templates
  - structure atoms
  - editing techniques
  - rationale
- [ ] T11.5 Build Source Video + Prompt page:
  - upload source video
  - prompt textarea
  - selected template dropdown
  - controls: pace, hook intensity, packaging style, CTA style
- [ ] T11.6 Build Reconstruction Planner page:
  - slot mapping table
  - gap report cards
  - fill plan cards
  - generate button
- [ ] T11.7 Build Result & Compare page:
  - sample structure summary
  - selected atoms
  - mapping explanation
  - storyboard table
  - timeline preview / video player placeholder
  - export JSON/report buttons

**Verification**

- [ ] User can complete the full flow without manually calling API.
- [ ] Compare page clearly shows extraction, mapping, gap and result.

## Phase 12 — Seed Demo and Tests

- [ ] T12.1 Add seed demo project script.
- [ ] T12.2 Add mock sample video analysis fixture.
- [ ] T12.3 Add mock source video analysis fixture.
- [ ] T12.4 Add sample generation request fixture.
- [ ] T12.5 Add unit tests:
  - schema validation
  - fallback template builder
  - knowledge base retrieval
  - slot matching
  - gap fill
  - timeline generation
- [ ] T12.6 Add E2E smoke test if practical.
- [ ] T12.7 Update README with local run and demo steps.

**Verification**

- [ ] Fresh clone can run seeded demo in mock mode.
- [ ] Unit tests pass.
- [ ] README instructions are enough for reviewer to run main flow.

## Suggested First Coding Commit Order

1. `chore: bootstrap TypeScript monorepo`
2. `docs: align MVP specs with official FAQ`
3. `feat(api): add project asset and storage foundation`
4. `feat(api): add mock video analysis and structure extraction`
5. `feat(api): add knowledge base and generation planning`
6. `feat(api): add slot matching gap fill and timeline validation`
7. `feat(web): add MVP workspace flow`
8. `feat(web): add result comparison and timeline preview`
9. `test: add MVP mock flow verification`
