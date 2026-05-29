# API Specification — Final Spec v1.2

Base path: `/api`

All responses should use JSON. Long-running operations should create a Job and return a `jobId` or generation id with status.

---

## 1. Common response shapes

### Success

```json
{
  "ok": true,
  "data": {}
}
```

### Error

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Readable error message",
    "details": {}
  }
}
```

---

## 2. Projects

### POST `/projects`

Create project.

Request:

```json
{
  "name": "Demo Product Promo",
  "vertical": "b2b_marketing_mg",
  "aspectRatio": "9:16",
  "targetDurationSec": 15
}
```

Response: Project.

### GET `/projects`

List projects.

### GET `/projects/:projectId`

Get project detail with asset/template/generation summaries.

---

## 3. Assets

### POST `/projects/:projectId/assets`

Upload asset as multipart form.

Fields:

- `file`: video/image file;
- `role`: `example_video` or `source_video`;
- `sourcePolicy`: `user_authorized`, `open_download_or_user_uploaded`, `demo_only`, or `unknown`.

Response: Asset.

### GET `/projects/:projectId/assets`

List assets.

### GET `/assets/:assetId`

Get asset detail.

### POST `/projects/:projectId/target-material-manifests`

Normalize uploaded/managed assets into a target material pool for structure-transfer generation.

This endpoint is the API-backed material intake path. It does not accept arbitrary local paths. Manifest entries reference managed `assetId` values previously created through `POST /projects/:projectId/assets`.

Request:

```json
{
  "schemaVersion": "target-material-manifest-v1",
  "brandName": "Viral Structure Engine",
  "cta": "Upload. Analyze. Remix.",
  "features": ["Analyze sample videos", "Induce reusable slots"],
  "assets": [
    { "assetId": "asset_card_01", "kind": "image", "role": "media_card" },
    { "assetId": "asset_logo", "kind": "logo", "role": "brand_logo" }
  ]
}
```

Response:

```json
{
  "schemaVersion": "target-material-manifest-v1",
  "projectId": "project_123",
  "brandName": "Viral Structure Engine",
  "cta": "Upload. Analyze. Remix.",
  "features": ["Analyze sample videos", "Induce reusable slots"],
  "targetAssets": [],
  "assetEvidence": [],
  "blockedAssets": [],
  "materialPolicy": {
    "source": "managed_upload",
    "externalPathsAllowed": false,
    "sampleReferenceUse": "structure_evidence_only"
  }
}
```

Public refs use safe managed identifiers such as `asset://managed/<assetId>`. Renderer adapters resolve actual server-side file paths internally.

---

## 4. Video analysis

### POST `/assets/:assetId/analyze`

Analyze a video asset.

Request:

```json
{
  "purpose": "sample",
  "mode": "auto"
}
```

`purpose`: `sample` or `source`.

`mode`: `auto`, `mock`, `ffmpeg`, `ffmpeg_opencv`, `ffmpeg_vlm_asr`.

Response:

```json
{
  "ok": true,
  "data": {
    "jobId": "job_123",
    "analysisId": "analysis_123",
    "status": "completed"
  }
}
```

### GET `/assets/:assetId/analysis`

Get latest analysis result.

---

## 5. Templates and knowledge base

### POST `/templates/extract`

Extract StructureTemplate from a sample analysis.

Request:

```json
{
  "projectId": "project_123",
  "sampleAssetId": "asset_123",
  "analysisId": "analysis_123",
  "mode": "auto"
}
```

Response: StructureTemplate.

### POST `/templates`

Save template to knowledge base.

Request: StructureTemplate JSON.

### GET `/templates?projectId=...`

List templates.

### GET `/templates/:templateId`

Get template.

### GET `/projects/:projectId/knowledge-base`

Get templates, atoms, editing techniques and counts.

### GET `/projects/:projectId/knowledge-base/atoms?role=hook&vertical=b2b_marketing_mg`

### GET `/projects/:projectId/knowledge-base/export`

Download the full knowledge base for a project (templates + atoms + editing techniques) as JSON.

### GET `/projects/:projectId/knowledge-base/atoms/export?role=&category=&vertical=`

Search atoms.

---

## 6. Generation and reconstruction

### POST `/generations`

Create reconstruction generation.

Request SHALL validate against `generation-request.schema.json`.

Example:

```json
{
  "projectId": "project_123",
  "inputMode": "video_plus_prompt",
  "sourceVideo": { "assetId": "asset_src_123" },
  "selectedTemplateIds": ["template_123"],
  "prompt": "Generate a 15s high-conversion promo for a portable student desk lamp. Emphasize eye protection, portability, and affordable price.",
  "target": {
    "vertical": "b2b_marketing_mg",
    "aspectRatio": "9:16",
    "targetDurationSec": 15,
    "outputMode": "storyboard_preview"
  },
  "controls": {
    "pace": "fast",
    "hookIntensity": "strong",
    "packagingStyle": "mg_motion",
    "ctaStyle": "direct",
    "allowAigcMaterialGeneration": false,
    "allowExternalAigcProvider": false
  }
}
```

Optional AIGC material-fill request from the web reconstruction planner:

```json
{
  "projectId": "project_123",
  "inputMode": "video_plus_prompt",
  "sourceVideo": { "assetId": "asset_src_123" },
  "selectedTemplateIds": ["template_123"],
  "prompt": "主题：AI 视频结构迁移工具；CTA：立即上传素材",
  "target": {
    "vertical": "b2b_marketing_mg",
    "aspectRatio": "9:16",
    "targetDurationSec": 15,
    "outputMode": "storyboard_preview"
  },
  "controls": {
    "pace": "fast",
    "hookIntensity": "strong",
    "packagingStyle": "mg_motion",
    "allowAigcPlaceholder": true,
    "allowAigcMaterialGeneration": true,
    "allowExternalAigcProvider": false
  }
}
```

Rules:

- `allowAigcMaterialGeneration=true` enables generation briefs and generated-material matching.
- `allowExternalAigcProvider=false` keeps the provider at deterministic `mock_provider`.
- `allowExternalAigcProvider=true` allows the API to use `AIGC_IMAGE_PROVIDER` from `.env` when configured; sample frames are still not sent.
- Generated material is returned as `materialRole="aigc_generated_material"`, not as a user upload.

Response:

```json
{
  "ok": true,
  "data": {
    "generationId": "gen_123",
    "jobId": "job_456",
    "status": "completed"
  }
}
```

When AIGC material fill runs, the full `generation` object in the response includes:

```json
{
  "aigcMaterialFill": {
    "enabled": true,
    "provider": "mock_provider",
    "externalProviderUsed": false,
    "sampleFramesSentExternally": false,
    "briefs": ["...MaterialGenerationBrief"],
    "candidates": ["...GeneratedAssetCandidate"],
    "quality": ["...GeneratedAssetQualityResult"],
    "generatedTargetAssets": ["...TargetAssetInput with materialRole=aigc_generated_material"]
  }
}
```

### GET `/generations/:generationId`

Returns generation detail:

- request;
- selected structure plan;
- source understanding;
- slot mapping;
- gap report;
- fill plan;
- timeline;
- preview/render result.

### POST `/generations/:generationId/revise`

Natural-language edit. The AIAdapter (or its heuristic fallback) parses the instruction into a `patchedControls: Partial<GenerationControls>` and an optional `promptAddendum`. By default the API immediately re-runs `generateMigrationResult` with the patched request and returns the new generation; pass `dryRun: true` to only see the planned mutation.

Request:

```json
{
  "instruction": "开头更抓人一些，字幕少一点，CTA 更直接",
  "dryRun": false
}
```

Response (applied):

```json
{
  "ok": true,
  "data": {
    "generationId": "generation_<new>",
    "previousGenerationId": "generation_<old>",
    "instruction": "...",
    "summary": "...",
    "patchedControls": { "hookIntensity": "aggressive", "pace": "fast", "ctaStyle": "direct" },
    "promptAddendum": null,
    "applied": true,
    "generation": { /* full GenerationResult */ }
  }
}
```

Recognised instruction patterns (heuristic): `开头更抓人/aggressive hook → hookIntensity=aggressive+pace=fast`, `减少字幕 → packagingStyle=clean`, `节奏更快 → pace=fast`, `放慢 → pace=slow`, `CTA 更直接 → ctaStyle=direct`, `把商品信息提前 → promptAddendum`. With `AI_PROVIDER=ark_doubao|openai_compatible` the LLM produces the patch directly.

### POST `/generations/:generationId/variants`

Multi-version generation. Produces four named variants (`高点击/高转化/高节奏/高质感`) by mutating `controls` and the prompt with a strategy preset. Pass `labels: ["high_ctr", ...]` to filter.

Request:

```json
{ "labels": ["high_ctr", "high_conversion"] }
```

Response:

```json
{
  "ok": true,
  "data": {
    "baseGenerationId": "generation_<base>",
    "count": 4,
    "variants": [
      {
        "label": "high_ctr",
        "displayName": "高点击版",
        "strategy": "更激进的 hook + 快节奏 + 强 CTA，前 3 秒抓注意力",
        "generationId": "generation_<variant>",
        "generation": { /* full GenerationResult */ }
      }
    ]
  }
}
```

### POST `/generations/:generationId/scorecard`

Heuristic + optional LLM-judge scorecard with five dimensions (hook, clarity, packaging, rhythm, cta). Pass `skipLlm: true` to force the deterministic heuristic only.

Response:

```json
{
  "ok": true,
  "data": {
    "generationId": "generation_xxx",
    "overall": 78,
    "dimensions": [
      { "name": "hook", "score": 82, "comment": "hook slot matched" },
      { "name": "clarity", "score": 74, "comment": "5/6 slots matched, 1 weak" },
      { "name": "packaging", "score": 70, "comment": "3 packaging signals" },
      { "name": "rhythm", "score": 80, "comment": "avg shot 1.8s vs target 1.8s" },
      { "name": "cta", "score": 84, "comment": "cta style direct, 8/8 source-backed" }
    ],
    "rationale": "Heuristic scorecard: slot fill 83%, source-backed clips 8/8, avg shot 1.88s.",
    "judge": "heuristic"
  }
}
```

When the configured AI adapter implements `judgeGeneration`, the heuristic and LLM scores are merged 50/50 and `judge` becomes `llm+heuristic`.

---

## 7. Render and preview

### POST `/generations/:generationId/render`

Request:

```json
{
  "rendererTarget": "html_preview"
}
```

Allowed targets:

- `mock_preview` — `MockRenderer`, returns a placeholder RenderOutput; useful for smoke tests.
- `html_preview` — `HtmlPreviewRenderer`, writes a self-contained HTML preview to `storage/generated/<renderId>.html`.
- `ffmpeg` — `FFmpegRenderer`, cuts source shots + drawtext overlays + concat into a real 9:16 720p MP4 in `storage/generated/<renderId>.mp4`.
- `remotion` — `RemotionRenderer`, bundles `apps/api/remotion/index.tsx`, feeds the timeline as `inputProps`, and renders MP4 via `@remotion/renderer`. First call may download a headless Chromium.
- `hyperframes` — `HyperFramesRenderer`, writes a deterministic JSON manifest at `storage/generated/hyperframes/<renderId>/hyperframes.json` that a future HyperFrames coding-renderer could consume. Status returns `completed`; the manifest path is in `outputPath`.

Response: RenderResult.

### GET `/renders/:renderId`

Get render result metadata and path.

---

## 8. Export

### GET `/generations/:generationId/export/timeline`

Download Timeline JSON.

### GET `/generations/:generationId/export/report`

Download Markdown or JSON report.

### GET `/templates/:templateId/export`

Download StructureTemplate JSON.

---

## 9. Jobs

### GET `/jobs/:jobId`

Get job status.

Response:

```json
{
  "ok": true,
  "data": {
    "id": "job_123",
    "type": "generation",
    "status": "completed",
    "progress": 100,
    "steps": [
      { "name": "source_analysis", "status": "completed" },
      { "name": "slot_matching", "status": "completed" },
      { "name": "timeline_generation", "status": "completed" }
    ]
  }
}
```
