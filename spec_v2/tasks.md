# Implementation Tasks — Final Spec v1.2

This task plan is designed for a clean repo named `viral-video-structure-transfer`.

---

## Phase 0 — Spec and repo setup

- [ ] T0.1 Commit final specs under `specs_v1/`.
- [ ] T0.2 Add root README navigation.
- [ ] T0.3 Decide package manager: npm, pnpm, or yarn.
- [ ] T0.4 Add `.gitignore` for node_modules, storage uploads, generated files, and `.env`.
- [ ] T0.5 Add `.env.example` without real secrets.

Verification:

- [ ] Specs are committed.
- [ ] README links work.
- [ ] No API keys committed.

---

## Phase 1 — TypeScript monorepo foundation

- [ ] T1.1 Create root `package.json` with workspaces.
- [ ] T1.2 Create `apps/web` using React + Vite + TypeScript.
- [ ] T1.3 Create `apps/api` using Node.js + TypeScript + Express/Fastify.
- [ ] T1.4 Create `packages/shared` for shared schemas, types, and validation helpers.
- [ ] T1.5 Add root scripts:
  - `npm run dev`;
  - `npm run dev:web`;
  - `npm run dev:api`;
  - `npm test`;
  - `npm run demo:seed`;
  - `npm run validate:schemas`.

Verification:

- [ ] API health endpoint works.
- [ ] Web app opens.
- [ ] Shared package imports work.

---

## Phase 2 — Schemas and shared types

- [ ] T2.1 Copy JSON schemas into `packages/shared/schemas` or import from `specs_v1/schemas`.
- [ ] T2.2 Add TypeScript types for Project, Asset, VideoAnalysisResult, StructureTemplate, KnowledgeAtom, GenerationRequest, Timeline, Job.
- [ ] T2.3 Add AJV validation utility.
- [ ] T2.4 Add fixtures for valid/invalid schema examples.
- [ ] T2.5 Add unit tests for schemas.

Verification:

- [ ] Valid fixtures pass.
- [ ] Invalid fixtures fail with readable errors.

---

## Phase 3 — Local storage and project workspace API

- [ ] T3.1 Implement LocalJsonStorage.
- [ ] T3.2 Create storage folders on startup.
- [ ] T3.3 Implement ProjectService.
- [ ] T3.4 Implement AssetService with file upload support.
- [ ] T3.5 Implement API routes:
  - `POST /api/projects`;
  - `GET /api/projects`;
  - `GET /api/projects/:projectId`;
  - `POST /api/projects/:projectId/assets`;
  - `GET /api/projects/:projectId/assets`.

Verification:

- [ ] Create project from API.
- [ ] Upload example/source video file.
- [ ] Asset appears in project detail.

---

## Phase 4 — Video analysis baseline

- [ ] T4.1 Implement VideoToolAdapter interface.
- [ ] T4.2 Implement MockVideoToolAdapter.
- [ ] T4.3 Implement optional ffprobe metadata extraction.
- [ ] T4.4 Implement keyframe placeholder generation or static placeholder thumbnails.
- [ ] T4.5 Implement fixed-interval shot candidate generation.
- [ ] T4.6 Implement routes:
  - `POST /api/assets/:assetId/analyze`;
  - `GET /api/assets/:assetId/analysis`.

Verification:

- [ ] Mock mode returns deterministic analysis.
- [ ] ffprobe mode works if FFmpeg is installed.
- [ ] Analysis result is persisted.

---

## Phase 5 — Structure extraction and fallback template

- [ ] T5.1 Implement AIAdapter interface.
- [ ] T5.2 Implement MockAIAdapter.
- [ ] T5.3 Implement fallback StructureTemplate builder:
  - hook 0–20%;
  - body 20–70%;
  - proof 70–85%;
  - cta 85–100%.
- [ ] T5.4 Add default B-end marketing/MG packaging patterns.
- [ ] T5.5 Add structureAtoms and editingTechniques generation.
- [ ] T5.6 Validate StructureTemplate schema.
- [ ] T5.7 Implement `POST /api/templates/extract` and `POST /api/templates`.

Verification:

- [ ] Sample analysis can produce a valid template.
- [ ] Fallback works when AIAdapter is disabled.

---

## Phase 6 — Knowledge base

- [ ] T6.1 Implement KnowledgeBaseService.
- [ ] T6.2 Save templates and atoms.
- [ ] T6.3 Query atoms by project, vertical, role, style.
- [ ] T6.4 Auto-select template/atoms when user does not select one.
- [ ] T6.5 Implement routes:
  - `GET /api/templates`;
  - `GET /api/templates/:templateId`;
  - `GET /api/projects/:projectId/knowledge-base`.

Verification:

- [ ] Template appears after saving.
- [ ] Atoms are retrievable and shown with source/rationale.

---

## Phase 7 — Source video understanding

- [ ] T7.1 Reuse VideoAnalysisService for source videos.
- [ ] T7.2 Generate heuristic shot tags.
- [ ] T7.3 Use prompt keywords to influence source shot tags.
- [ ] T7.4 Add optional manual tag override in fixture or UI.
- [ ] T7.5 Persist SourceVideoUnderstanding result.

Verification:

- [ ] Source video produces shot candidates.
- [ ] Tags include hook/product/usage/background candidates.

---

## Phase 8 — Slot matching, gap detection, gap fill

- [ ] T8.1 Implement SlotMatchingService.
- [ ] T8.2 Implement GapDetectionService.
- [ ] T8.3 Implement GapFillService.
- [ ] T8.4 Support strategies:
  - reuse_with_crop_zoom;
  - text_card;
  - packaging_overlay;
  - reorder_structure;
  - aigc_placeholder.
- [ ] T8.5 Add tests for missing/weak slots.

Verification:

- [ ] Each required slot gets matched/weak/missing.
- [ ] Gap report is generated.
- [ ] Fill plan resolves required slots.

---

## Phase 9 — Reconstruction and timeline generation

- [ ] T9.1 Implement ReconstructionPlannerService.
- [ ] T9.2 Generate segment script.
- [ ] T9.3 Generate storyboard.
- [ ] T9.4 Generate Timeline JSON.
- [ ] T9.5 Add migration explanation.
- [ ] T9.6 Validate timeline schema.
- [ ] T9.7 Implement generation routes:
  - `POST /api/generations`;
  - `GET /api/generations/:generationId`.

Verification:

- [ ] `video_plus_prompt` request creates valid Timeline JSON.
- [ ] Timeline has no unresolved required slots.
- [ ] Explanation maps atoms to output clips.

---

## Phase 10 — HTML preview and export

- [ ] T10.1 Implement HtmlPreviewRenderer.
- [ ] T10.2 Render timeline blocks in web UI.
- [ ] T10.3 Implement render routes:
  - `POST /api/generations/:generationId/render`;
  - `GET /api/renders/:renderId`.
- [ ] T10.4 Implement exports:
  - template JSON;
  - generation request JSON;
  - timeline JSON;
  - report Markdown/JSON.

Verification:

- [ ] Preview shows storyboard and timeline.
- [ ] Export buttons work.

---

## Phase 11 — Frontend UX

- [ ] T11.1 Build Dashboard.
- [ ] T11.2 Build Project Workspace wizard.
- [ ] T11.3 Build Sample Learning view.
- [ ] T11.4 Build Structure Review view.
- [ ] T11.5 Build Knowledge Base view.
- [ ] T11.6 Build Source Video + Prompt view.
- [ ] T11.7 Build Reconstruction Planner view.
- [ ] T11.8 Build Result Compare / Preview view.
- [ ] T11.9 Add visible status for mock/real provider mode.

Verification:

- [ ] Full flow can be completed from UI.
- [ ] Result page clearly shows extraction, atoms, mapping, gaps, fill plan, and output.

---

## Phase 12 — Seed demo and tests

- [ ] T12.1 Add seeded demo project.
- [ ] T12.2 Add mock sample analysis fixture.
- [ ] T12.3 Add mock source analysis fixture.
- [ ] T12.4 Add sample generation request fixture.
- [ ] T12.5 Add unit tests for core services.
- [ ] T12.6 Add E2E smoke test if practical.
- [ ] T12.7 Update README run instructions.

Verification:

- [ ] Fresh clone can run seeded demo in mock mode.
- [ ] Tests pass.

---

## Phase 13 — Strong demo extensions

- [ ] T13.1 Add real ffprobe metadata extraction.
- [ ] T13.2 Add FFmpeg keyframe extraction.
- [ ] T13.3 Add basic FFmpeg cut/concat renderer.
- [ ] T13.4 Add simple MP4 render for one demo.
- [ ] T13.5 Add Remotion placeholder package or renderer adapter.
- [ ] T13.6 Add better visual polish for result page.

Verification:

- [ ] One source video + prompt produces an MP4 demo or clear render artifact.

---

## Phase 14 — High-score extensions

- [ ] T14.1 Add keyframe VLM adapter.
- [ ] T14.2 Add ASR adapter.
- [ ] T14.3 Add OCR adapter.
- [ ] T14.4 Add natural-language edit commands.
- [ ] T14.5 Add multi-version generation.
- [ ] T14.6 Add quality evaluator.
- [ ] T14.7 Add Remotion/HyperFrames visual packaging components.

---

## Suggested commit order

1. `docs: add final v1.2 specs`
2. `chore: bootstrap TypeScript monorepo`
3. `feat(shared): add schemas types and validation`
4. `feat(api): add projects assets and local storage`
5. `feat(api): add mock video analysis`
6. `feat(api): add structure extraction and knowledge base`
7. `feat(api): add source understanding slot matching and gap fill`
8. `feat(api): add reconstruction timeline and preview render`
9. `feat(web): add MVP workspace flow`
10. `feat(web): add comparison page and timeline preview`
11. `test: add mock MVP flow verification`
12. `feat(renderer): add ffmpeg demo render`
