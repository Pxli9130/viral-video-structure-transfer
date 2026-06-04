# 08 — API Specification

## 1. Project and asset APIs

### POST /api/projects

Create project.

Request:

```json
{
  "vertical": "marketing",
  "aspectRatio": "9:16",
  "targetDurationSec": 16
}
```

Response:

```json
{
  "projectId": "proj_001"
}
```

### POST /api/assets

Upload asset.

Multipart fields:

```text
projectId
role
sourcePolicy
file
```

Response:

```json
{
  "assetId": "asset_001",
  "role": "sample_video",
  "path": "..."
}
```

## 2. Learn APIs

### POST /api/learn-samples

Run full Learn Pipeline for one or more sample videos.

Request:

```json
{
  "projectId": "proj_001",
  "sampleAssetIds": ["asset_sample_1", "asset_sample_2"],
  "options": {
    "runGen1": true,
    "storeToKb": true,
    "videoInputMode": "auto"
  }
}
```

Response:

```json
{
  "learnJobId": "learn_001",
  "status": "running"
}
```

### GET /api/learn-samples/:learnJobId

Return progress and artifacts.

### GET /api/samples/:sampleId/evidence

Return EvidenceTimelineV5.

### GET /api/samples/:sampleId/reconstruction

Return NeutralReconstructionProgram and preview links.

### GET /api/samples/:sampleId/elements

Return CandidateElements and curation decisions.

## 3. Knowledge Base APIs

### GET /api/kb/elements

Query elements.

Query params:

```text
kind
tag
sourceSampleId
q
limit
offset
```

### POST /api/kb/search

Semantic search.

Request:

```json
{
  "projectId": "proj_001",
  "query": "fast hook with bold title and electronic beat",
  "filters": {
    "kind": ["hook_pattern", "audio_pattern"]
  }
}
```

### POST /api/kb/recommend

Recommend elements for a brief.

Request:

```json
{
  "projectId": "proj_001",
  "brief": {
    "theme": "portable fan high-click ad",
    "sellingPoints": ["small", "quiet", "long battery"]
  },
  "targetAssetIds": ["asset_fan_1"]
}
```

### POST /api/kb/curate

Manually approve/merge/reject elements.

## 4. Generation APIs

### POST /api/generations/plan

Generate CompositionProgram only.

Request:

```json
{
  "projectId": "proj_001",
  "brief": {
    "theme": "portable fan high-click ad",
    "variant": "high_click",
    "targetDurationSec": 16,
    "sellingPoints": ["small", "quiet", "long battery"]
  },
  "targetAssetIds": ["asset_fan_1", "asset_fan_2"],
  "selectedElementIds": ["kb_hook_1", "kb_subtitle_3", "kb_audio_2"],
  "autoFillMissing": true
}
```

Response:

```json
{
  "compositionProgramId": "comp_001",
  "gapReportId": "gap_001"
}
```

### POST /api/generations

Run full Create Pipeline.

Request:

```json
{
  "projectId": "proj_001",
  "brief": {
    "theme": "portable fan high-click ad",
    "variant": "high_click",
    "targetDurationSec": 16,
    "aspectRatio": "9:16",
    "sellingPoints": ["small", "quiet", "long battery"]
  },
  "targetAssetIds": ["asset_fan_1", "asset_fan_2"],
  "selectedElementIds": ["kb_hook_1", "kb_subtitle_3", "kb_cta_2"],
  "options": {
    "materialFill": "aigc",
    "audioFill": "procedural",
    "finalCodegen": "on",
    "fallbackRender": true,
    "autoRender": true
  }
}
```

Response:

```json
{
  "generationId": "gen_001",
  "status": "running"
}
```

### GET /api/generations/:id

Return status and artifact links.

### POST /api/generations/:id/render

Render or re-render.

### POST /api/generations/:id/revise

Revise by structured patch or natural language.

Request:

```json
{
  "instruction": "make the opening stronger and reduce subtitles",
  "patch": {
    "stylePlan.textDensity": "low",
    "sections[0].motionIntensity": "high"
  }
}
```

### GET /api/generations/:id/scorecard

Return ScorecardV5.

## 5. Artifact APIs

### GET /api/artifacts/:artifactId

Return artifact JSON or media.

### GET /api/projects/:projectId/lineage

Return artifact lineage graph.
