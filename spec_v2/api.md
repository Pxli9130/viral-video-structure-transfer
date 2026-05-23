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
    "ctaStyle": "direct"
  }
}
```

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

Future natural-language edit.

Request:

```json
{
  "instruction": "开头更抓人一些，字幕少一点",
  "preserveSourceShots": true
}
```

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

- `mock_preview`;
- `html_preview`;
- `ffmpeg`;
- `remotion`;
- `hyperframes`.

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
