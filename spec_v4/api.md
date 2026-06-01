# 06. API and CLI Spec

## 1. REST API

### Projects

```text
POST /api/projects
GET  /api/projects/:id
```

### Uploads

```text
POST /api/projects/:id/sample-videos
POST /api/projects/:id/assets
```

### Analysis

```text
POST /api/videos/:id/analyze
GET  /api/videos/:id/analysis
GET  /api/videos/:id/frame-sheets
GET  /api/videos/:id/structure-template
GET  /api/videos/:id/technique-atoms
```

### Transfer

```text
POST /api/projects/:id/transfer
GET  /api/transfer-plans/:id
GET  /api/transfer-plans/:id/gap-report
GET  /api/transfer-plans/:id/render-recipe
PATCH /api/transfer-plans/:id/recipe
```

### Render

```text
POST /api/transfer-plans/:id/render
GET  /api/render-jobs/:id
GET  /api/render-jobs/:id/download
GET  /api/render-jobs/:id/log
```

Query:

```text
?target=remotion|ffmpeg|both
?quality=preview|final
```

### Natural Edits

```text
POST /api/edits/natural-language
```

Input:

```json
{
  "recipeId": "recipe_xxx",
  "instruction": "开头更抓人一些",
  "mode": "patch_only"
}
```

Output:

```json
{
  "patch": [{ "op": "replace", "path": "/layers/3/text/content", "value": "3 秒抓住眼球" }],
  "explanation": "增强 hook 标题并缩短开头铺垫",
  "requiresRerender": true
}
```

## 2. Important Response Shapes

### Analysis Response

```json
{
  "videoId": "sample_marketing",
  "analysisPath": "artifacts/.../analysis.json",
  "frameSheets": {
    "globalSheet": ".../global_sheet.jpg",
    "shotSheet": ".../shot_sheet.jpg"
  },
  "summary": {
    "shots": 12,
    "typographyRuns": 24,
    "visualElements": 33,
    "motionAtoms": 1,
    "audioLayers": 4
  }
}
```

### Transfer Response

```json
{
  "transferPlanId": "tp_xxx",
  "templateId": "tmpl_xxx",
  "gapReportPath": ".../gap-report.json",
  "renderRecipePath": ".../render-recipe.json",
  "summary": {
    "clips": 9,
    "mediaLayers": 8,
    "textLayers": 9,
    "motionAtomLayers": 1,
    "audioLayers": 4
  }
}
```

## 3. CLI Scripts

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

```bash
node scripts/render-case.mjs --case marketing --target both
node scripts/render-case.mjs --recipe artifacts/marketing/render-recipe.json --target remotion
```

### run-learn-samples

```bash
node scripts/run-learn-samples.mjs --cases marketing,editing,motion_graph_1,motion_graph_2
```

### evaluate-render-quality

```bash
node scripts/evaluate-render-quality.mjs --case marketing --strict v4
```

## 4. WebSocket Events

Optional:

```text
analysis.started
analysis.shots_done
analysis.frame_sheets_done
analysis.structure_done
transfer.gap_done
transfer.recipe_done
render.progress
render.done
render.failed
```

## 5. API Safety

Never return committed API keys. Environment config should be documented as:

```text
ARK_API_KEY=...
GEMINI_API_KEY=...
OPENAI_API_KEY=...
```

Do not put real secrets in docs or fixtures.
