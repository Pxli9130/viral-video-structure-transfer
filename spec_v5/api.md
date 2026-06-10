# 08 — API Specification (Current V5.1)

The V5 surface is mounted under `/api/v5` in `apps/api/src/v5Routes.ts`. V4/project
asset upload APIs still live in `apps/api/src/server.ts` and are used by the V5 dashboard
for managed uploads.

Response shape note:

- `/api/v5/*` routes return the payload directly.
- legacy `/api/projects/*` routes return `{ "ok": true, "data": ... }`.

## 1. Health and service status

### GET /

Returns the API root status and route hints.

```json
{
  "service": "vvst-api",
  "status": "running",
  "ui": "Open the Vite web URL printed by npm run dev, usually http://localhost:5174/#v5",
  "routes": { "health": "/healthz", "ready": "/readyz", "v5": "/api/v5" }
}
```

### GET /healthz

Returns adapter status.

### GET /readyz

Checks storage directories.

## 2. Project and managed upload APIs

### POST /api/projects

Create a project.

```json
{
  "name": "V5 UI Project",
  "vertical": "marketing",
  "aspectRatio": "9:16",
  "targetDurationSec": 16
}
```

### POST /api/projects/:projectId/assets

Upload one managed asset. This is the upload endpoint used by V5 Dashboard before
the asset appears in `GET /api/v5/assets`.

Multipart fields:

```text
file=<binary>
role=example_video | source_video | user_image | ...
```

Accepted media include video, image, audio and text assets. The server stores them
under `storage/uploads/<projectId>/` and returns an `Asset` record in the legacy
envelope.

### GET /api/projects/:projectId/assets

List assets for a project.

## 3. V5 asset browsing and media

### GET /api/v5/assets

List registered assets for V5 selection.

```json
{
  "assets": [
    {
      "id": "asset_abc",
      "role": "example_video",
      "type": "video",
      "filename": "motion_graph_1.mov",
      "hasPath": true,
      "tags": [],
      "createdAt": "2026-06-10T01:00:00.000Z"
    }
  ]
}
```

### GET /api/v5/assets/:assetId/media

Serve the uploaded media file for preview, analysis, rendering and trace links.

## 4. Showcase APIs

### GET /api/v5/showcase

Returns curated local judging/demo cases from `storage/showcase-runs/*` when present.

```json
{
  "cases": [
    {
      "id": "sc_motion1_app",
      "title": "AI 智能记账 App · 学自 motion_graph_1.mov",
      "description": "...",
      "tags": ["same_template", "motion_graphics", "aigc", "product_theme"],
      "primary": { "id": "sc_motion1_final", "label": "final.mp4", "kind": "video", "url": "/api/v5/showcase-artifacts/sc_motion1_final" },
      "thumbnail": { "id": "sc_motion1_cover", "label": "cover.png", "kind": "image", "url": "/api/v5/showcase-artifacts/sc_motion1_cover" },
      "artifacts": []
    }
  ]
}
```

### GET /api/v5/showcase-artifacts/:artifactId

Serves an allowlisted showcase video/image/json artifact.

## 5. Learn APIs

### POST /api/v5/learn-samples

Learn one or more sample videos into V5 evidence, reconstruction, KB elements and a
Level-1 `RemotionTemplateCapsule`.

```json
{
  "jobId": "job_learn_demo_001",
  "sampleAssetIds": ["asset_sample_1"],
  "options": {
    "runGen1Ai": true,
    "runCapsuleCodegen": true,
    "useVision": true,
    "gen1Model": "gemini-3-flash-preview",
    "gen1ModelLong": "gemini-3.1-pro-preview",
    "validateTemplateRender": true
  }
}
```

Response:

```json
{
  "learned": [
    {
      "sampleId": "asset_sample_1",
      "evidenceTimelineId": "ev_asset_sample_1",
      "reconstructionProgramId": "nrp_asset_sample_1",
      "gen1": "ai",
      "gen1Model": "gemini-3.1-pro-preview",
      "templateCapsuleId": "tpl_asset_sample_1",
      "templateSlots": 12,
      "templateCompiles": true,
      "templateValidationPassed": true,
      "templateRenders": true,
      "templateCode": "ai",
      "candidateCount": 30,
      "storedElements": 8,
      "warnings": []
    }
  ],
  "kbSize": 257
}
```

Learn artifacts are persisted under `storage/generated/v5/learn/<assetId>/`, including:

- `evidence-timeline-v5.json`
- `neutral-reconstruction-program.json`
- `candidate-elements.json`
- `knowledge-elements.json`
- `knowledge_manifest.seed.json`
- `remotion-template-capsule.json`
- `template-validation.json`

### GET /api/v5/samples/:assetId/evidence

Returns `EvidenceTimelineV5`, or `null` if the sample has not been learned.

### GET /api/v5/samples/:assetId/reconstruction

Returns `NeutralReconstructionProgram`, or `null` if absent.

### GET /api/v5/samples/:assetId/elements

Returns candidate elements and KB decisions, or `null` if absent.

## 6. Knowledge Base APIs

### GET /api/v5/kb/elements

Query Level-2 knowledge elements.

Query params:

```text
kind
tag
sourceSampleId
q
limit
offset
```

### POST /api/v5/kb/search

Search KB elements.

```json
{
  "query": "fast hook with bold title and electronic beat",
  "filters": {
    "kind": ["hook_pattern", "audio_pattern"]
  }
}
```

### GET /api/v5/kb/decisions

Returns curator decisions (`store`, `merge_existing`, `store_variant`, `reject`, etc.).

## 7. Template capsule APIs

### GET /api/v5/templates

List Level-1 `RemotionTemplateCapsule` metadata. The list omits code bundle content.

Query params:

```text
sourceSampleId
projectId
tag
q
```

### GET /api/v5/templates/:id

Returns the full template capsule, including `codeBundle`, `propsSchema`, `slotSchema`,
`timingSignature`, `motionSignature`, `sceneRecipes`, `assetRecipes`, `audioRecipes`,
fixtures, safety and quality fields.

## 8. Job progress and trace APIs

### GET /api/v5/jobs/:jobId/progress

Returns live progress for in-flight learn/generate/revise operations.

```json
{
  "step": 2,
  "total": 4,
  "detail": "补全 AIGC 缺口素材：按槽位生成图片 / 视频 / 文案 / 音频…"
}
```

The dashboard uses this endpoint for the fixed status/progress UI.

### GET /api/v5/jobs/:jobId/transfer-trace

Returns the generated transfer trace when `jobId` equals the generation id or was supplied
to `POST /api/v5/generations`.

### GET /api/v5/generations/:id/transfer-trace

Returns the canonical explainability trace for a generation:

```text
sample evidence + scene/audio recipes
template capsule + knowledge manifest
target brief + target asset profiles
slot mapping + gap report + fill actions
material analysis + timeline-v2 + mapping-v2
similarity report + packaging plan + beat alignment + dialogue plan
scorecard + output video URLs
```

## 9. Generation APIs

### POST /api/v5/generations/plan

Dry-run generation. It executes planning/binding/fill decisions but never renders MP4.

### POST /api/v5/generations

Run generation. Default mode is `same_template`.

#### same_template request

```json
{
  "projectId": "proj_v5_ui",
  "jobId": "job_generate_demo_001",
  "brief": {
    "theme": "高端无线机械键盘",
    "targetDurationSec": 16,
    "aspectRatio": "9:16",
    "sellingPoints": ["低延迟", "铝合金机身", "长续航"],
    "variant": "high_click",
    "promptMode": "llm",
    "customNL": "开头三秒更抓人，字幕更少，CTA 提前。"
  },
  "targetAssetIds": ["asset_keyboard_hero", "asset_keyboard_detail"],
  "slotAssignments": {
    "hero_product": "asset_keyboard_hero"
  },
  "options": {
    "generationMode": "same_template",
    "templateCapsuleId": "tpl_asset_sample_1",
    "referenceCapsuleIds": ["tpl_asset_sample_1", "tpl_asset_sample_2"],
    "autoRender": true,
    "rewriteContext": true,
    "aigcGapFill": {
      "mode": "auto_on",
      "imageFill": "aigc",
      "audioFill": "aigc",
      "textFill": "llm"
    }
  }
}
```

Important same-template behavior:

- `targetAssetIds` order matters: earlier selected assets are matched to earlier compatible visual slots first.
- `slotAssignments` wins over automatic matching.
- `referenceCapsuleIds` enables multi-reference structure arbitration; the selected and rejected candidates are
  written to `structure-arbitration.json`.
- `autoRender=false` builds a plan/instance without final MP4.
- if required slots are missing and AIGC/procedural fallback is off, readiness is downgraded honestly.

Response highlights:

```json
{
  "generationId": "gen_001",
  "generationMode": "same_template",
  "templateCapsuleId": "tpl_asset_sample_1",
  "usedTemplateCode": true,
  "usedFallbackRenderer": false,
  "finalVideoUrl": "/generated/v5/generations/gen_001/final.mp4",
  "coverUrl": "/generated/v5/generations/gen_001/cover.png",
  "templateInstance": {
    "slotBindings": [],
    "readinessImpact": {
      "missingRequiredSlotCount": 0,
      "usedFallbackCount": 2,
      "readinessLevel": "review_demo",
      "warnings": []
    }
  },
  "generatedAssets": [],
  "gapReport": {},
  "materialAnalysis": [],
  "timelineV2": {},
  "mappingV2": [],
  "similarityReport": {},
  "packagingPlan": {},
  "beatAlignment": {},
  "dialoguePlan": {},
  "qualityReport": {},
  "scorecard": {},
  "warnings": []
}
```

Artifacts written under `storage/generated/v5/generations/<generationId>/`:

- `generation-result.json`
- `template-instance.json`
- `final-video-program.json`
- `gap-report.json`
- `scorecard.json`
- `material-analysis.json`
- `timeline-v2.json`
- `mapping-v2.json`
- `similarity-report.json`
- `packaging-plan.json`
- `beat-alignment.json`
- `dialogue-plan.json`
- `quality-report.json` when available
- `edit-trace.json` for revise generations

#### mix_elements request

Advanced mode that composes Level-2 KB elements, optionally asking AI to write a fresh Remotion
capsule for the final composition.

```json
{
  "projectId": "proj_v5_ui",
  "jobId": "job_mix_demo_001",
  "brief": {
    "theme": "高端桌面效率装备",
    "targetDurationSec": 16,
    "aspectRatio": "9:16",
    "sellingPoints": ["模块化", "高质感", "工作流加速"]
  },
  "targetAssetIds": ["asset_1", "asset_2"],
  "selectedElementIds": ["kb_hook_1", "kb_transition_7", "kb_cta_3"],
  "options": {
    "generationMode": "mix_elements",
    "autoRender": true,
    "runGen1Ai": true,
    "runGen2Ai": true,
    "runGen2RemotionCodegen": true,
    "audioFill": "aigc"
  }
}
```

## 10. Revise APIs

### POST /api/v5/generations/:id/revise

Patch-first `modify_template` revise of a prior `same_template` generation. It reuses prior visuals
and re-renders the template. `regenerateImages=true` is rejected; start a fresh `POST /api/v5/generations`
when new visuals are required.

```json
{
  "projectId": "proj_v5_ui",
  "patch": {
    "theme": "高端桌面效率装备",
    "copyOverrides": { "headline": "让桌面进入专注状态" },
    "rhythm": "balanced",
    "textDensity": "minimal",
    "paletteMood": "premium",
    "ctaAdvanceSec": 4
  }
}
```

### POST /api/v5/generations/:id/revise-natural-language

Parses one user instruction into `TemplatePatchSet`, then calls the same patch-first revise path.
The model never edits arbitrary files or shell commands.

```json
{
  "projectId": "proj_v5_ui",
  "instruction": "开头更抓人，字幕更少，把购买理由提前到 8 秒前。"
}
```

Response is a new generation result with `generationMode="modify_template"`, `generatedPatch`,
`patchNotes`, `naturalLanguageInstruction` and `editTrace`.

## 11. Fetch generation and scorecard

### GET /api/v5/generations/:id

Returns the stored `generation-result.json`.

### GET /api/v5/generations/:id/scorecard

Returns the stored `scorecard.json`.

## 12. Dashboard export artifacts

The V5 dashboard `Export` tab downloads currently loaded artifacts directly from browser state:

- `template-capsule-v5.json`
- `sample-evidence-v5.json`
- `transfer-trace-v5.json`
- `scorecard-v5.json`
- `generation-result-v5.json`
- `planned-transfer-map-v5.json` before generation
- `packaging-plan-draft-v5.json` before generation
