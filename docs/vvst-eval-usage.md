# VVST Eval Usage Guide

This guide records how to use the evaluation stack for the Viral Video Structure Transfer Engine. It covers the `tools/vvst-eval` submodule, the main-repo render/model/corpus gates, and the full-loop human-review artifact runner.

## What Exists

The eval stack has three layers:

| Layer | Location | Purpose |
|---|---|---|
| VVST-RecipeBench | `tools/vvst-eval/` | Project-specific dataset and scorer for structure transfer, gap/fill planning, render quality, no-copy safety, hygiene, and style-strength checks. |
| Main-repo gates | `scripts/evaluate-render-quality.mjs`, `scripts/evaluate-model-understanding.mjs`, corpus scripts | Lower-level regression gates for render metrics, model understanding, evidence extraction, and corpus behavior. |
| Full-loop artifact runner | `scripts/run-full-loop-editing-artifacts.mjs` | End-to-end live product run through the API, with a human-review pack around the final MP4 and intermediate artifacts. |

`tools/vvst-eval` is a git submodule. It is intentionally not part of the root npm workspace. Use `npm --prefix tools/vvst-eval ...` from the main repo root.

## Safety Rules

- Do not commit raw videos/audio.
- Do not copy sample frames or sample audio into RecipeBench JSONL.
- Do not print `.env` values or provider keys.
- External-provider eval is disabled unless explicitly enabled with `VVST_EVAL_ENABLE_EXTERNAL=1`.
- `dataset:init` creates layout only; it does not create samples.
- `dataset:import-main` imports only real main-repo artifacts or authorized fixtures.
- `train.jsonl`, `val.jsonl`, and `test.jsonl` only accept `gold_eval` or `sft_candidate` samples.
- `candidate`, `imported`, and `needs_human_review` samples stay out of benchmark splits until reviewed.

## Environment Setup

Install the submodule dependencies:

```bash
git submodule update --init --recursive
npm --prefix tools/vvst-eval install
```

Use the local video/tooling environment when running media metrics or FFmpeg render checks:

```bash
source "$HOME/anaconda3/etc/profile.d/conda.sh"
conda activate viral
```

Useful environment variables:

```bash
export VVST_MAIN_ROOT="$PWD"
export VVST_API_BASE="http://localhost:3000/api"
export VVST_EDITING_MOV_PATH="$PWD/test_videos/manual/editing.mov"
export VVST_SOURCE_VIDEO_PATH="$PWD/test_videos/manual/user_materials_combined.mp4"
```

`VVST_EDITING_MOV_PATH` and `VVST_SOURCE_VIDEO_PATH` are local-only media refs. They should point to files on your machine and should not be committed.

## Quick Health Check

From the main repo root:

```bash
npm --prefix tools/vvst-eval run typecheck
npm --prefix tools/vvst-eval test
npm --prefix tools/vvst-eval run dataset:doctor -- --main-root ../..
npm --prefix tools/vvst-eval run hygiene -- --main-root ../..
```

Expected behavior:

- `typecheck` compiles the eval package.
- `test` runs unit tests without requiring raw videos.
- `dataset:doctor` reports present/missing main-repo artifacts and confirms external providers are not required.
- `hygiene` scans eval outputs for private paths, secret-like strings, raw media payloads, and unsafe artifacts.

## RecipeBench Dataset Commands

Initialize the dataset layout:

```bash
npm --prefix tools/vvst-eval run dataset:init -- --main-root ../..
```

Validate committed JSONL and policy rules:

```bash
npm --prefix tools/vvst-eval run dataset:validate -- --main-root ../..
```

Import real main-repo artifacts:

```bash
npm --prefix tools/vvst-eval run dataset:import:main -- --main-root ../..
```

Build benchmark splits:

```bash
npm --prefix tools/vvst-eval run dataset:build -- --main-root ../..
npm --prefix tools/vvst-eval run dataset:split -- --main-root ../..
```

Regenerate the dataset card:

```bash
npm --prefix tools/vvst-eval run dataset:card -- --main-root ../..
```

Export SFT-style data without training anything:

```bash
npm --prefix tools/vvst-eval run dataset:export:sft -- --format generic-jsonl --main-root ../..
```

SFT export includes only reviewed samples that satisfy the SFT policy. It does not include raw video/audio.

## Artifact Scoring

Dry-run planned checks for the editing RecipeBench case:

```bash
npm --prefix tools/vvst-eval run eval:recipebench -- \
  --case editing_mov_beatcut \
  --dry-run \
  --main-root ../..
```

Score a saved prediction JSON:

```bash
npm --prefix tools/vvst-eval run eval:recipebench -- \
  --case editing_mov_beatcut \
  --prediction tools/vvst-eval/artifacts/predictions/editing_mov_prediction.json \
  --main-root ../..
```

Score explicit main-repo artifact files:

```bash
npm --prefix tools/vvst-eval run eval:recipebench -- \
  --case editing_mov_beatcut \
  --allow-shared-prediction \
  --case-id editing_mov_beatcut \
  --template ../../test_fixtures/expected_editing_mov_case_v2/ideal-structure-template-editing-mov.v2.json \
  --generation ../../test_fixtures/expected_editing_mov_case_v2/ideal-generation-editing-mov.v2.json \
  --timeline ../../test_fixtures/expected_editing_mov_case_v2/ideal-timeline-editing-mov.v2.json \
  --visual-evidence ../../test_fixtures/expected_editing_mov_case_v2/ideal-visual-evidence-editing-mov.v2.json \
  --render-quality ../../test_fixtures/expected_editing_mov_case_v2/ideal-render-quality-gates-editing-mov.v2.json \
  --main-root ../..
```

Routing behavior:

- `prediction.sampleId` scores only the matching sample.
- `prediction.caseId` scores matching samples in that case.
- `prediction.task` scores samples with the same task.
- If one prediction bundle is used for multiple samples with no routing metadata, the evaluator warns unless `--allow-shared-prediction` is passed.

Outputs are written under:

```text
tools/vvst-eval/artifacts/eval-runs/<timestamp>/
  manifest.json
  scorecard.json
  report.md
  per-sample/
```

## Live API Eval

`eval:api` does not start the main API server automatically. Start the API first in another terminal:

```bash
npm run dev:api
```

Dry-run without media:

```bash
npm --prefix tools/vvst-eval run eval:api -- \
  --case editing_mov_beatcut \
  --dry-run \
  --main-root ../..
```

This reports `mode=missing_media`, `sampleExists=false`, and no planned API calls.

Sample-only dry-run:

```bash
npm --prefix tools/vvst-eval run eval:api -- \
  --case editing_mov_beatcut \
  --sample "$VVST_EDITING_MOV_PATH" \
  --dry-run \
  --main-root ../..
```

Sample-only live eval:

```bash
npm --prefix tools/vvst-eval run eval:api -- \
  --case editing_mov_beatcut \
  --sample "$VVST_EDITING_MOV_PATH" \
  --main-root ../..
```

Sample-only mode uploads/analyzes the sample, extracts/saves a template, scores sample-structure tasks, and skips transfer/render tasks with explicit reasons.

Full sample+source live eval:

```bash
npm --prefix tools/vvst-eval run eval:api -- \
  --case editing_mov_beatcut \
  --sample "$VVST_EDITING_MOV_PATH" \
  --source "$VVST_SOURCE_VIDEO_PATH" \
  --prompt "主题：爆款结构迁移引擎；强调上传素材、分析结构、自动重组；CTA：立即生成测试。" \
  --main-root ../..
```

Full transfer with async generation, FFmpeg rendering, metrics, and contact sheets:

```bash
npm --prefix tools/vvst-eval run eval:api -- \
  --case editing_mov_beatcut \
  --sample "$VVST_EDITING_MOV_PATH" \
  --source "$VVST_SOURCE_VIDEO_PATH" \
  --async \
  --render \
  --renderer-target ffmpeg \
  --compute-render-metrics \
  --make-contact-sheets \
  --main-root ../..
```

Mode rules:

- No sample: dry-run reports unavailable; real run fails clearly.
- Sample exists, no source configured: sample-only mode.
- Sample and source exist: full-transfer mode.
- If `--source` or `VVST_SOURCE_VIDEO_PATH` is explicitly set but missing, real eval fails instead of silently downgrading.

The live report includes safe path labels, not raw private absolute paths.

## How To Read RecipeBench Scores

Functional dimensions:

- `structureUnderstanding`
- `timestampEvidence`
- `slotQuality`
- `movingMaterial`
- `backgroundLayer`
- `beatAlignment`
- `gapDetection`
- `timelineQuality`
- `renderQuality`
- `noCopySafety`
- `artifactHygiene`

Additional polish dimension:

- `styleTransferStrength`

`styleTransferStrength` compares sample evidence metrics against render metrics for the editing beat-cut case: motion density, cut density, dark-background similarity, red/yellow typography, audio presence, duration, and resolution. It is a high-score polish warning, not a replacement for functional RecipeBench pass/fail.

Common interpretations:

- Functional pass + style warning: artifact contract is satisfied, but visual density/pacing can improve.
- `gapDetection` warning/fail: prediction lacks explicit `gapReport`, `fillPlan`, or remediation for expected missing material.
- `renderQuality` skipped: no render-quality JSON or render metrics were provided.
- `artifactHygiene` fail: report or scorecard contains unsafe paths, secret-like strings, raw media payloads, or placeholder/debug strings.

## Main-Repo Render Quality Gate

Run the render-quality evaluator directly:

```bash
npm run eval:render-quality -- \
  --render docs/artifacts/human_review_full_loop_aerospin_fan/run_20260531T013926Z/_human_review/final.mp4 \
  --template docs/artifacts/human_review_full_loop_aerospin_fan/run_20260531T013926Z/19_exports/structure-template.json \
  --generation docs/artifacts/human_review_full_loop_aerospin_fan/run_20260531T013926Z/19_exports/generation.json \
  --sample test_videos/manual/editing.mov \
  --expect-video-type beat_cut \
  --gates v3 \
  --strict
```

Useful related root scripts:

```bash
npm run eval:model-understanding
npm run e2e:editing-beatcut
npm run regression:corpus:strict
```

The corpus report is written under:

```text
docs/corpus_regression/corpus-regression-report.md
```

## Full-Loop Human Review Run

The full-loop runner drives the live product path through the API and writes a reviewable artifact pack:

```bash
npm run full-loop:editing -- \
  --sample test_videos/manual/editing.mov \
  --source test_videos/manual/user_materials_combined.mp4 \
  --prompt "主题：AeroSpin 便携涡轮小风扇。主打三档强风、USB-C 快充、低噪音、桌面手持两用。CTA：现在入手，随时随地降温。" \
  --out docs/artifacts/human_review_full_loop_aerospin_fan \
  --review-title "AeroSpin 便携涡轮小风扇" \
  --keep-server
```

Notes:

- The runner can start the API server if it is not already running.
- `--keep-server` leaves the server running after the run.
- Do not pass provider secrets on the command line.
- Use `--allow-external-aigc` only when external AIGC calls are intentionally allowed.

Each run is written to:

```text
docs/artifacts/<out-root>/run_<timestamp>/
```

Human review entry points:

```text
OPEN_ME_FIRST.md
_human_review/final.mp4
_human_review/HUMAN_REVIEW_REPORT.md
_human_review/human-review-checklist.md
_human_review/quality-gates-v3.json
_human_review/quality-gates-v3.md
_human_review/artifact-hygiene.json
_human_review/artifact-hygiene.md
_human_review/*contact-sheet*.jpg
```

The canonical MP4 for a run is always:

```text
<run-dir>/_human_review/final.mp4
```

The original renderer output is usually also present under:

```text
storage/generated/
```

## Current 4-Sample AeroSpin Review Set

The current human-review pack lives at:

```text
docs/artifacts/human_review_full_loop_aerospin_fan/
```

Canonical videos:

| Sample | Canonical final MP4 | Current read |
|---|---|---|
| `editing.mov` | `run_20260531T013926Z/_human_review/final.mp4` | Best/reference run; gate PASS 47/47. |
| `mall_discount.mp4` | `run_20260531T014407Z/_human_review/final.mp4` | Strong motion; gate fails on dark-bg similarity, hero descriptor, audio richness. |
| `athlete_drinking.mp4` | `run_20260531T014927Z/_human_review/final.mp4` | Static fallback failure with visible placeholder text. |
| `motion_graph_1.mov` | `run_20260531T015340Z/_human_review/final.mp4` | Strong run; gate fails only on `style_match_dark_bg`. |

Use run 1 first when demonstrating the successful path:

```text
docs/artifacts/human_review_full_loop_aerospin_fan/run_20260531T013926Z/_human_review/final.mp4
```

## What To Check During Human Review

For each run:

1. Watch `_human_review/final.mp4`.
2. Read `_human_review/HUMAN_REVIEW_REPORT.md`.
3. Check `_human_review/quality-gates-v3.md`.
4. Compare sample/render contact sheets.
5. Confirm `_human_review/artifact-hygiene.md` has no render-text secret or placeholder findings.
6. Inspect `15_timeline/timeline.json` for visible text, product token threading, clip roles, layer kinds, and beat info.
7. Inspect `13_gap_report/` and `14_fill_plan/` for honest missing-material handling.

Known current review signals:

- The editing run is the clean reference-quality pass.
- Mall and motion-graph runs are visually useful but expose a sample-style-vs-brief-style scoring tension.
- Athlete fallback is a real defect: static output and visible placeholder text.
- Product selling points such as `strong wind`, `portable`, `low noise`, and `fast charge` need stronger visible copy-threading in the dynamic beat-cut body.

## Suggested Root Script Wrappers

The root `package.json` does not currently include these wrappers. If you want one-command access later, add scripts like:

```json
{
  "eval:vvst:setup": "git submodule update --init --recursive && npm --prefix tools/vvst-eval install",
  "eval:vvst:doctor": "npm --prefix tools/vvst-eval run dataset:doctor -- --main-root ../..",
  "eval:vvst:init": "npm --prefix tools/vvst-eval run dataset:init -- --main-root ../..",
  "eval:vvst:import-main": "npm --prefix tools/vvst-eval run dataset:import:main -- --main-root ../..",
  "eval:vvst:validate": "npm --prefix tools/vvst-eval run dataset:validate -- --main-root ../..",
  "eval:vvst": "npm --prefix tools/vvst-eval run eval:recipebench -- --main-root ../..",
  "eval:vvst:api": "npm --prefix tools/vvst-eval run eval:api -- --main-root ../..",
  "eval:vvst:hygiene": "npm --prefix tools/vvst-eval run hygiene -- --main-root ../.."
}
```

Do not add these wrappers while unrelated root package changes are in progress unless the change is intentional.

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| `eval:api` says `missing_media` | No sample path is configured or the file does not exist. | Pass `--sample` or set `VVST_EDITING_MOV_PATH`. |
| `eval:api` fails when source is set | Explicit source path does not exist. | Fix `--source` or `VVST_SOURCE_VIDEO_PATH`, or unset it for sample-only mode. |
| Live eval cannot connect | API server is not running or `VVST_API_BASE` is wrong. | Run `npm run dev:api` and check `VVST_API_BASE`. |
| Render metrics skipped | FFmpeg/ffprobe/Python tooling unavailable. | Activate conda env `viral`; set `FFMPEG_PATH` / `FFPROBE_PATH` if needed. |
| `gapDetection` low | Prediction lacks explicit gap/fill data. | Ensure generation includes `gapReport`, `fillPlan`, expected gap types, and remediation. |
| `styleTransferStrength` warns | Render is functional but less dense than sample. | Increase moving segments, cut-on-beat events, impact flashes, and typography emphasis. |
| Hygiene flags report text | Report contains debug words, private paths, or placeholder strings. | Scope the scan, redact paths, or remove unsafe render/report strings. |

