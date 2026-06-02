# 06. API and CLI Spec

> Spec doc is v4.1; the implemented typed model-router summary literal is `model-router-v4.2`.
> The routes below are the REAL surface registered in `apps/api/src/server.ts` (verified). The pipeline is generation-centric: upload an asset → analyze it → extract a template → create a generation → render the generation. There is no `/api/videos/:id/...`, `/api/projects/:id/transfer`, `/api/edits/natural-language`, or WebSocket surface (those were aspirational and never shipped).

## 1. REST API

### Health

```text
GET /healthz                          # liveness, no storage touch
GET /readyz                           # readiness, ensures storage dirs, returns { storageRoot }
```

### Projects

```text
POST /api/projects                    # create project, returns 201
GET  /api/projects                    # list projects
GET  /api/projects/:projectId         # project + nested assets/analyses/templates/generations/renders
```

### Assets and Target Material

```text
POST /api/projects/:projectId/assets                       # multipart upload (field 'file'); role example_video|source/material
GET  /api/projects/:projectId/assets                       # list project assets
POST /api/projects/:projectId/target-material-manifests    # register a target-material manifest for the project
GET  /api/assets/:assetId                                  # fetch a single asset
```

### Analysis

```text
POST /api/assets/:assetId/analyze     # run analysis (body: purpose sample|source, mode auto|...); returns jobId + analysis + template
GET  /api/assets/:assetId/analysis    # latest analysis for the asset (optional ?purpose=sample|source)
POST /api/samples/analyze             # DEPRECATED — returns 400 MOCK_REMOVED (text-only mock removed; upload + analyze a real video instead)
```

### Templates

```text
POST /api/templates/extract           # extract a structure template (body: projectId)
POST /api/templates                   # create/persist a template
GET  /api/templates                   # list templates
GET  /api/templates/:templateId       # fetch a template
GET  /api/templates/:templateId/export
```

### Knowledge Base and Evidence

```text
GET  /api/projects/:projectId/knowledge-base
GET  /api/projects/:projectId/knowledge-base/atoms
GET  /api/projects/:projectId/knowledge-base/atoms/export
GET  /api/projects/:projectId/knowledge-base/export
GET  /api/projects/:projectId/evidence
GET  /api/projects/:projectId/technique-atoms
```

### Generation (the real transfer entrypoint)

```text
POST /api/generations                              # create a generation (structure transfer)
POST /api/generate                                 # alias of POST /api/generations
GET  /api/generations/:generationId                # fetch a generation
POST /api/generations/:generationId/replacements   # apply material replacements
POST /api/generations/:generationId/revise         # revise the generation (natural-language style edits live here)
POST /api/generations/:generationId/variants       # produce variants
POST /api/generations/:generationId/scorecard      # compute/return the scorecard
GET  /api/generations/:generationId/export/timeline
GET  /api/generations/:generationId/export/report
```

### Render

```text
POST /api/generations/:generationId/render
```

The render target is a JSON BODY field `rendererTarget` (NOT a query param). There is no `?target=both` and no `?quality=` param.

```json
{
  "rendererTarget": "html_preview"
}
```

`rendererTarget` is one of: `html_preview` | `ffmpeg` | `remotion` | `remotion_recipe` | `hyperframes`.
When omitted, the server falls back to `generation.timeline.rendererTarget`, and finally to `html_preview` (server.ts:82, 2897). The response is `201` with `{ jobId, renderId, status, render }`.

### Reports and Jobs

```text
GET /api/transfer-plans/:generationId/gap-report      # gap report for the generation
GET /api/transfer-plans/:generationId/render-recipe   # render recipe for the generation
GET /api/render-jobs/:renderId/report                 # render-quality report for a render
GET /api/renders/:renderId                            # fetch a render record
GET /api/jobs/:jobId                                  # fetch a job (poll for progress)
```

## 2. Important Response Shapes

### Analyze Response (`POST /api/assets/:assetId/analyze`)

```json
{
  "jobId": "job_xxx",
  "analysisId": "analysis_xxx",
  "status": "completed",
  "analysis": {
    "id": "analysis_xxx",
    "projectId": "project_xxx",
    "assetId": "asset_xxx",
    "purpose": "sample",
    "video": { "...": "VideoAnalysis" },
    "template": { "...": "StructureTemplate" }
  },
  "template": { "...": "StructureTemplate (when extracted)" }
}
```

### Render Response (`POST /api/generations/:generationId/render`)

```json
{
  "jobId": "job_xxx",
  "renderId": "render_xxx",
  "status": "completed",
  "render": {
    "renderId": "render_xxx",
    "outputPath": ".../generated/render_xxx.html",
    "status": "completed"
  }
}
```

## 3. CLI Scripts

> Use a Node 22 runtime (the system Node may be stale). Prefix `PATH` if needed before running these.

### inspect-learning-fidelity

```bash
node scripts/inspect-learning-fidelity.mjs --case marketing
node scripts/inspect-learning-fidelity.mjs \
  --analysis artifacts/marketing/analysis.json \
  --template artifacts/marketing/learned-template.json \
  --timeline artifacts/marketing/timeline.json \
  --recipe artifacts/marketing/render-recipe.json
```

Output:

```json
{
  "case": "marketing",
  "status": "pass",
  "counts": {
    "analysis": { "visualElements": 33, "typographyRuns": 24, "audioLayers": 4, "motionAtoms": 1 },
    "template": { "visualElements": 33, "typographyRuns": 24, "audioLayers": 4, "motionAtoms": 1 },
    "recipe": { "mediaLayers": 8, "textLayers": 9, "motionAtomLayers": 1, "audioLayers": 4 }
  },
  "droppedEvidence": []
}
```

Fatal rules:

- analysis visual > 0 but template visual = 0。
- analysis typography > 0 but recipe TextLayer no bbox/fontSize。
- analysis motionAtoms > 0 but recipe renderer cannot consume。
- image-bearing TypographyLayoutSequence not rendering media。
- CTA display contains raw prompt。

### render-case

`render-case.mjs` selects the runner by `--case` (one of `marketing`, `editing`, `motion_graph_1`, `motion_graph_2`). There is NO `--target` flag — the underlying runner emits both `final.mp4` (FFmpeg) and `final.remotion.mp4` (Remotion).

```bash
node scripts/render-case.mjs --case marketing
```

### run-learn-samples

`run-learn-samples.mjs` takes `--samples` as a comma-separated list of video file PATHS (there is no `--cases` flag).

```bash
node scripts/run-learn-samples.mjs --samples test_videos/editing.mov,test_videos/marketing.mov,test_videos/motion_graph_1.mov,test_videos/motion_graph_2.mov
```

### evaluate-render-quality

Gate tiers are `v2` and `v3` (there is no `v4` tier). `--strict` is a boolean flag (it takes no value).

```bash
node scripts/evaluate-render-quality.mjs --case marketing --gates v3 --strict
```

## 4. Realtime / Progress (Not implemented)

WebSocket events (`analysis.*`, `transfer.*`, `render.*`) are NOT implemented — they were a forward-looking idea only. Observe progress by polling:

```text
GET /api/generations/:generationId    # generation status
GET /api/jobs/:jobId                   # job status + progress
```

## 5. API Safety

Never return committed API keys. Environment config should be documented by variable NAME only, e.g.:

```text
ARK_API_KEY=...
GEMINI_API_KEY=...
OPENAI_API_KEY=...
ELEVENLABS_API_KEY=...
SEEDREAM_ARK_MODEL=...   # no built-in default; required to enable Seedream image fallback
```

Do not put real secrets in docs or fixtures.
