# Viral Video Structure Transfer Engine

**Viral Video Structure Transfer Engine: An AI Creation Platform for Deconstructing Examples, Filling Material Gaps, and Reassembling Videos**

## Spec v5.1 — Same Template Reconstruction Mode (Latest Default Behavior)

> Upload a video you like → the system turns it into a **reusable, props-driven Remotion template** (`RemotionTemplateCapsule`) → enter a new topic → **automatically fill in missing visuals, copy, and audio, then render the new content using the same motion-design template**.
>
> Safety boundary: the following may be reused: “template code / timeline / layout / animation curves / typography behavior / transition sequencing / audio cue positions / props & slot schema.” The following from the example **may not be reused**: “original image pixels / video frames / audio / subtitle text / logos / people / product materials.”
>
> The defaults are `generationMode=same_template` and `aigcGapFill=auto_on`; the original “multi-video element mixing” workflow remains available as the advanced `mix_elements` mode. See [`spec_v5/same-template-mode.md`](spec_v5/same-template-mode.md) for the specification; **see [`spec_v5/rubric-alignment.md`](spec_v5/rubric-alignment.md) for an item-by-item rubric mapping**; and see `packages/shared/src/contracts-v5/templateCapsule.ts` for the contract.
>
> **Model responsibilities**: `createTextModelFn` handles all text-generation tasks in one place (context rewriting for a new topic, shot descriptions, natural-language video revisions, text-based code fallback, and Gen1/Gen2 text). When a valid Ark/Doubao configuration is available, Doubao-Seed is preferred; otherwise, the system falls back to Gemini (the current `.env.example` defaults are `AI_PROVIDER=gemini` / `AI_GEMINI_MODEL=gemini-3.5-flash`). **Multimodal reconstruction that “watches video/frames” remains on Gemini**; external providers for images, video, music, and related media all have deterministic or programmatic fallbacks.
>
> **Gen1 Visual Capsule (primary path)**: one Gemini call **watches the entire video clip** together with deterministic evidence and produces a faithful, props-driven `RemotionTemplateCapsule` (React + Remotion + true 3D using `@remotion/three`). **Model selection is based on duration** (short → `gemini-3-flash-preview`; long/chunked → `gemini-3.1-pro-preview`; threshold: `GEMINI_GEN1_PRO_MIN_SEC=34`). **The returned code is canonical**: `mergeCapsule` preserves the code byte-for-byte, fills in only missing metadata, and merges `timingSignature` (with deterministic fallbacks for durationSec/fps, preventing cases such as “a 31-second video renders only 16 seconds”). Only two gates are enforced: **compilation + real rendering**; all other checks are recorded but do not block. Long videos (>34 seconds) are split at scene cuts into ≤30-second chunks, reconstructed concurrently, and then combined into one multi-file capsule. Gemini also returns an `assetPlan`, with one entry for each missing asset that “cannot be drawn in code,” including its key, mediaKind, and AIGC prompt. **Motion/coverage fidelity self-repair**: if the code violates its own sceneRecipe (for example, scrolling subtitles remain static, a single-axis 3D ribbon tumbles on two axes, or coverage is insufficient), one repair attempt is triggered. **AI-first policy**: an AI capsule that compiles and renders is never discarded in favor of a deterministic version merely because of fidelity imperfections.
>
> **Generation: change the topic + use AIGC to fill “dynamic materials.”** A single Pro call performs context rewriting for copy and colors while preserving structure and the source’s light/dark character. Footage slots (`mediaKind=video`) receive **real video**: **Seedance 2.0** (Volcengine Ark text-to-video) is primary → **happyhorse r2v** (Alibaba DashScope reference-to-video, using a Gemini still image as `reference_image`; automatically takes over when Seedance has insufficient funds or returns 403) is backup → an AIGC still image is the final fallback. Image slots use Gemini Image. After rendering: a **color guard** detects when a light source background has incorrectly become dark and performs one rewrite/re-render; **solid-color redundant shots at the end are trimmed**. Concurrency and stability: global render semaphore (`RENDER_CONCURRENCY=2` × `RENDER_TABS_PER_JOB=2`) + `RENDER_TIMEOUT_MS=120000` + retry after renderer/probe crashes + global AIGC semaphore (`AIGC_GLOBAL_CONCURRENCY=8` to prevent 429 errors). **Revision endpoint**: `POST /api/v5/generations/:id/revise`.
>
> Audio defaults to a **Google Lyria music bed** (`lyria-3-clip-preview`; content longer than 30 seconds is segmented and crossfaded; after failed retries, the system falls back to programmatic audio).
>
> **Additional capabilities (implemented and aligned with the rubric; see rubric-alignment.md)**: material **upload + profile analysis** (upload via `POST /api/projects/:projectId/assets`; V5 reads via `GET /api/v5/assets` / `GET /api/v5/assets/:id/media` + `runTargetAssetAnalysis`) · end-to-end **transfer-process visualization** in one trace (`GET /api/v5/generations/:id/transfer-trace`: source structure → knowledge manifest → slot mapping → gaps/fills → scorecard → finished video) · **review evidence center** (Showcase / Learn Analysis / Structure Protocol / Gap Decisions / Transfer Map / Packaging / Export) · **multi-version generation** (dashboard fan-out from one template into high-click, high-conversion, high-tempo, and premium-feel variants) · **natural-language video revision** (`POST /api/v5/generations/:id/revise-natural-language`: one sentence → `TemplatePatchSet` → re-render) · **two-level knowledge base** (Level 1 template capsules + Level 2 elements across 16 atomic categories; `GET /api/v5/kb/elements?kind&tag&q`, `POST /api/v5/kb/search`, `GET /api/v5/templates`) · **knowledge-manifest seeds** (structural hypotheses, atomic modules, and slots for each example).
>
> Core APIs (all under `/api/v5`): `GET /showcase` · `GET /assets` · `POST /learn-samples` · `GET /templates[/:id]` · `POST /generations` (defaults to same_template) · `POST /generations/plan` (planning only; no rendering) · `GET /jobs/:jobId/progress` · `POST /generations/:id/revise` · `POST /generations/:id/revise-natural-language` · `GET /generations/:id[/scorecard|/transfer-trace]` · `GET /samples/:id/{evidence,reconstruction,elements}` · `GET/POST /kb/*`. The default web entry point is `/#v5` (V4 remains accessible at `#v4`).
>
> **Four-video parallel demo** (requires the `viral` conda environment and real keys; output is written to `storage/demo-runs-*/`):
>
> ```bash
> export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$HOME/anaconda3/envs/viral/bin:$PATH"
> npm run build && node apps/api/dist/server.js   # or npm run dev
> VIDEO_CONCURRENCY=4 OUT_DIR=demo-runs python scripts/run-v5-four-aigc.py   # four examples: each runs learn (chunked) + generate (random new topic + AIGC video/still images)
> ```
>
> Video provider environment variables: `AIGC_VIDEO_PROVIDER=seedance_2_0` + `SEEDANCE_ARK_API_KEY` (primary); `AIGC_VIDEO_BACKUP_PROVIDER=happyhorse_r2v` + `DASHSCOPE_API_KEY` + `DASHSCOPE_BASE_URL=https://dashscope-us.aliyuncs.com/api/v1` (backup). **The following dependencies must be installed**: `@remotion/three@4.0.341` + `@react-three/fiber@^9.6.1` + `three@0.176.0` (**fiber must match the React version**: this repository’s web app uses React 19, so fiber must be 9.x; fiber 8 causes a `ReactCurrentBatchConfig` render crash, which makes 3D capsules fall back to deterministic rendering).

## Spec v4.2 Submission Entry

The goal of the current submission is: **learn the structure without copying the content**. Example videos are used only as structural evidence in analysis/template/TechniqueAtom/GapReport; final visuals may use only target materials, user-authorized materials, local programmatic materials, or generated materials with provenance.

Review entry points:

- Chinese showcase: `docs/artifacts/showcase-report.md`, `docs/artifacts/showcase-report.html`
- Submission pack: `docs/artifacts/submission_pack/index.md`, `docs/artifacts/submission_pack/index.html`
- Four canonical FFmpeg outputs: `docs/artifacts/learned_samples_max/{marketing,editing,motion_graph_1,motion_graph_2}/final.mp4`
- Visual QA: each case’s `visual-qa-report.md/json`
- Remotion host verification: `docs/remotion-host-verification.md`

Local verification commands:

```bash
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" npm test
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/evaluate-model-routes.mjs --offline --json --strict-policy
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/visual-qa-report.mjs --all-cases
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/export-showcase-report.mjs
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/export-submission-artifacts.mjs
```

The default submission path does not call Seedance / Seedream / ElevenLabs / Gemini / OpenAI / Qwen / Deepgram / Runway / Veo / Kling, upload example media, or download large model weights. Optional providers are used only after explicit opt-in and key configuration.

This project is not a general-purpose video generator that “takes one sentence and directly generates a video.” Its core objective is:

```text
Example/reference video
→ deterministic evidence extraction
→ open-world slot induction
→ target-material matching
→ material-gap detection
→ fill plan / replaceable slots
→ rendering-capability selection
→ proxy or target-material MP4
→ preview frames / contact sheet
→ evaluators / corpus regression / product demo
```

Default safety boundaries:

- Example videos provide structural evidence only; by default, example frames, audio, text, and branding are not copied.
- Only target materials, user-uploaded materials, authorized reusable materials, programmatic rendering, and clearly labeled AIGC-generated materials may appear in the output.
- Mock/no-path materials cannot satisfy visual slots.
- When materials are missing, the system must produce a gap report, fill plan, replacement slots, or a proxy render.
- AIGC material completion is optional and does not call external providers by default.

For the current implementation status, review conclusions, and artifact evidence, see:

- [Current Project Guide](./CURRENT_PROJECT_GUIDE.md)
- [SDE hardening review](./docs/artifacts/review/sde_hardening_review.md)
- [SDE harness completion review](./docs/artifacts/review/sde_harness_completion_review.md)

## Documentation Entry Points

- [Requirements](./spec_v2/requirements.md)
- [System Design](./spec_v2/design.md)
- [API Documentation](./spec_v2/api.md)
- [Task Breakdown](./spec_v2/tasks.md)
- [Test Plan](./spec_v2/test-plan.md)
- [Demo Playbook](./spec_v2/demo-playbook.md)
- [Schema](./spec_v2/schemas/)

**The current primary submission specification is [`spec_v5/`](./spec_v5/)** (Spec v5.1 — Same Template Reconstruction Mode). `spec_v3/`, `spec_v2/`, `specs_v1/`, and `spec_v1_1/` are retained as historical design and regression materials.

- [Spec v1.3 Requirements](./spec_v3/requirements.md), [System Design](./spec_v3/design.md), [RenderRecipe schema](./spec_v3/schemas/render-recipe.schema.json), [Implementation Status](./spec_v3/implementation-status.md), [Demo Playbook](./spec_v3/demo-playbook.md)

## Spec v1.3 — Source-first RenderRecipe (Historical Demo)

In response to the “example-independent fixed mold” problem exposed by the rendering-overfit investigation ([REPORT](./docs/artifacts/render_overfit_findings/REPORT.md))—where beat_cut inputs of the same type collapsed into the same sequence of six primitives and cross-example layout NCC reached 0.868–1.000—v1.3 changed rendering to **source-first + one unified RenderRecipe contract**:

```text
Example video = structural evidence only (do not copy frames/audio/watermarks)
Target materials / source video = output materials that appear on screen
→ buildRenderRecipe (timeline.renderPlan.renderRecipe, the sole rendering contract; every clip includes an auditable primitiveReason)
→ FFmpeg (composites actual material pixels + beat-synced subtitles + programmatic BGM to produce final.mp4)
   and the Remotion ViralRecipe composition (consumes the same recipe and produces final.remotion.mp4)
```

The historical demo product is an **AeroSpin portable turbo fan** advertisement. The repository contains no real fan materials, so this fixture was generated at the time using Gemini 2.5 Flash Image (Nano Banana) and labeled with the provenance `aigc_generated_material` (not user-uploaded and not a real product photo). See the Provider Configuration Summary below for the current V5.1 default image model and provider configuration.

```bash
# Toolchain prefix (the system Node is the outdated v12; ffmpeg/python are in the viral conda environment)
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$HOME/anaconda3/envs/viral/bin:$PATH"

# 1) Generate the real AIGC fan target fixture (requires GEMINI_API_KEY + external-provider opt-in)
node scripts/generate-aerospin-fan-fixture.mjs

# 2) Final submission demo: Demo A (editing.mov beat_cut + fan) + Demo B (motion_graph + the same fan materials) + anti-overfit diversity
npm run demo:final
```

Outputs: `docs/artifacts/final_submission/` (`demo_a_editing_fan/`, `demo_b_motion_graph_fan/`, `diversity_eval/`, `FINAL_REPORT.md`). Each demo includes `final.mp4` (FFmpeg), `final.remotion.mp4` (Remotion), `render-recipe.json`, `quality-gates.json`, `sample-copy-safety.json`, `source-material-usage.json`, a contact sheet, and `HUMAN_REVIEW_REPORT.md`. **Cross-example anti-overfit result: layout NCC ≈ 0.01** (the same materials combined with different examples produce structurally distinct videos, breaking the fixed mold).

## Directory Structure

```text
apps/
  api/       Node.js + TypeScript + Express; API, adapter, and renderer integrations
  web/       React + Vite + TypeScript; workbench UI
packages/
  shared/    Types, schemas, planner, slot induction, and AIGC material filling
  renderer/  HTML preview / renderer contract
scripts/
  analyze-visual-evidence.py               Deterministic visual-evidence analysis for motion_graph_case
  run-motion-graph-case.mjs                Proxy / target-assets / partial / malformed / AIGC modes
  generate-motion-graph-target-assets.mjs  Deterministic target-material fixture
  check-artifact-hygiene.mjs               Public-artifact leakage scan
docs/
  fixtures/motion_graph_target_assets/     Motion-graph target-material fixtures + manifests
  artifacts/                               Reviewable outputs, reports, MP4s, and contact sheets
storage/
  uploads/, generated/, db/, demo/
```

## Local Environment

The existing `viral` conda environment is recommended. FFmpeg, ffprobe, Python helper scripts, and optional OCR/ASR all run from this environment.

```bash
conda activate viral
npm install
npm run build
```

Optional Python capabilities:

```bash
pip install faster-whisper   # ASR_PROVIDER=faster_whisper
pip install easyocr          # OCR_PROVIDER=easyocr
```

If your conda path is different:

```bash
CONDA_BASE=/path/to/anaconda3
VIRAL_CONDA_ENV=viral
```

## Start the Application

```bash
npm run dev
```

Open:

- Web V5: <http://localhost:5173/#v5> (if port 5173 is occupied, Vite prints a new port such as 5174; open `/#v5` using the terminal’s reported address)
- Web V4: <http://localhost:5173/#v4>
- API root: <http://localhost:3000/>
- API health: <http://localhost:3000/healthz>

Current V5 UI workflow:

1. Under `0 · Upload`, select the example video and target image/video materials. After choosing each file, you must click `Upload` separately.
2. Under `1 · Learn`, select an example video and click `Learn 1 Sample`. The learning result is written to a Remotion template capsule, slot protocol, KB elements, and a structure-learning report.
3. Expand the `Review Evidence Center` and review Showcase, Learn Analysis, Structure Protocol, Gap Decisions, Transfer Map, Packaging, and Export in sequence. Before generation, it also displays a draft transfer and packaging plan; after generation, these are automatically replaced by the actual trace.
4. Select a reusable Remotion template from the `Template Library`, or browse/search atomic elements such as hooks, rhythm, typography, transitions, and asset/audio recipes in the Knowledge Base.
5. Under `2 · Generate`, `same_template` is used by default. Target materials are collapsible and multi-selectable; use “Move Up / Move Down / Remove” to control the order in which they enter media slots. You can also upload or bind materials to individual slots in the slot-gap table.
6. Select an AIGC completion strategy, generation mode, intelligent LLM rewriting, and variant preset. The advanced `mix_elements` mode can combine elements from multiple examples and can enable “have AI write animation code on the fly.”
7. After generation, inspect `final.mp4`, slot bindings, the gap report, timeline, mapping, packaging, scorecard, and no-copy evidence. You can then continue with a structured patch or natural-language revision.
8. Under Export, download the currently loaded `template-capsule-v5.json`, `sample-evidence-v5.json`, `transfer-trace-v5.json`, `scorecard-v5.json`, pre-generation transfer/packaging drafts, and other review evidence.

## Common Commands

```bash
npm run build
npm test
npm run validate:schemas
npm run regression:corpus:strict
VVST_REUSE_IGF_FIXTURE=1 npm run demo:product
node scripts/check-product-demo-page.mjs
node scripts/check-artifact-hygiene.mjs
```

If `npm test` reports `listen EPERM: operation not permitted 0.0.0.0` inside a restricted sandbox, the environment is preventing the API end-to-end tests from binding a local socket. Re-run the tests in an environment that permits local socket binding.

## Evidence-first Structure Transfer (`beat_cut` / `editing.mov`)

For **fast-cut / editing-tutorial** examples such as `editing.mov`, the pipeline has been changed to “first extract evidence with deterministic tools, then let the model provide a semantic interpretation, and finally have the renderer execute the learned visual grammar”:

```text
video
→ ffprobe metadata
→ PySceneDetect scene cuts + per-shot keyframes/visual-family labels + per-shot motionEnergy (Farneback optical flow)
→ librosa beat grid (BPM / beats / onsets)
→ frameMetrics for 60 frames (blackBgRatio / redYellowRatio / motionDiffMean / cutLikeCount) + movingObjectCandidates
→ OCR / ASR text bound to shots by timestamp
→ VisualEvidenceTimeline v2 (six visual families: object_motion/kinetic_typography/background/storyboard/live_action_montage/bgm)
→ Gemini VLM (grounded by evidence rather than free-form interpretation) → text-model merge (Ark/Doubao or Gemini)
→ beat_cut StructureTemplate (eight moving-material slots: hero visual / background / title card / storyboard rules / action montage / impact flash / BGM / CTA)
→ layered timeline (layers + slotId/motion/assetPolicy, beat-synced to the actual 152 BPM) + honest gaps (moving_material_missing / bgm_missing)
→ style-locked dynamic renderer (animated light ribbons on black, beat-synced white flashes, BGM EQ bars, hard-cut montage, red impact starbursts, large red/yellow typography, CTA ticker) + audio
→ rendering quality gate v2 (no placeholders, includes audio, evidence coverage ≥0.8, motionDiffMean ≥0.04, cutLikeCount ≥5, layered clips ≥5, moving gaps reported)
```

The `beat_cut` classification comes from **deterministic evidence** (fast cuts + beats + black background + action montage), not VLM keywords, so output remains stable even when the LLM fails. AI-enrichment failures (such as Ark 401) are **explicitly marked** with `aiEnrichmentStatus=failed/aiEnrichmentError` and are never presented as a clean template. **Moving materials/background/storyboard/BGM are first-class structural slots + rendering contracts + gates**: if no target action materials are available, the action montage uses high-motion programmatic proxies (never copying example frames) and reports `moving_material_missing`, preventing the output from degrading into static cards.

**v3 (human fidelity)**: the analyzer additionally extracts **hero-object descriptors** (head/mask type + palette + motion) and **TypographyEvidenceV2** (OCR bounding boxes → layout role/color/font size/animation). Based on this evidence, the renderer draws **programmatic neon head/mask silhouettes** (not blocks and never copied example faces), uses **role-varying subtitle layouts/colors/type-on effects/jitter**, and replaces a single click track with **layered programmatic BGM** (drone + kick + bass + hi-hat + noise, with a spectral centroid far higher than a click alone). The gate is upgraded to **v3 per-clip** metrics (hero ≥0.025, text clips ≥0.01, montage ≥0.04, so a static early segment cannot pass by hiding behind a global average), plus hero descriptors/proxies, typography evidence, audio richness, a non-empty storyboard, BGM deduplication, fillPlan consistency, and more. `npm run full-loop:editing` materializes the entire product pipeline as 22 stage directories that can be manually reviewed.

**v3 VisualElementGraph (localize, then label)**: the architecture **first uses CV/optical flow/OCR to localize elements (bounding boxes + trajectories), while the VLM only assigns semantic names to the localized candidates** (instead of asking a VLM to guess coordinates from a 1 FPS video). The analyzer outputs a `visualElementGraph`: hero_object (optical-flow bounding-box trajectory + center trajectory + area curve), kinetic_typography and **watermark** (separated with a corner heuristic; TikTok/Douyin watermarks are labeled but never reproduced), impact_fx, background, CTA, plus shot nodes (dominantElements/cutType/motionClass/beatSync) and `audioStructure` (proportions of bass/music/hi-hat layers). The renderer **actually consumes** the graph: hero silhouettes are positioned according to `positionClass`, and the BGM is mixed using the learned layer proportions. Heavy trackers (Grounded-SAM2/SAM2/RAFT/CoTracker/Demucs/Essentia) are **environment-gated stubs** (off by default and do not affect CI). The v3 gate **verifies actual use, not mere presence**: `element_graph_renderer_consumed` (the hero element is attached to a layer and the rendered opening clip actually contains motion), `typography_layout_used`, and `audio_structure_used`. The real-API full-loop run with `--gates v3` passes **47/47**.

Real run (requires the `viral` conda environment and real providers; analysis runs Gemini/ASR/OCR/PySceneDetect/librosa and takes several minutes):

```bash
# 1) Start the API (real providers are controlled by .env: VLM_PROVIDER=gemini, VLM_MODEL defaults to gemini-3.5-flash; AI_PROVIDER=gemini defaults to gemini-3.5-flash, while Ark/Doubao can be used as the text-LLM path; ASR_PROVIDER=faster_whisper/disabled, OCR_PROVIDER=easyocr)
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$HOME/anaconda3/envs/viral/bin:$PATH"   # system Node is the outdated v12
npm run build && node apps/api/dist/server.js

# 2) editing.mov → beat_cut → style-locked 15-second reconstruction → render → export
npm run e2e:editing-beatcut

# 3) Rendering-quality gate v3 (strict beat_cut moving-material + human-fidelity mode, 40 checks)
npm run eval:render-quality -- --render storage/generated/<renderId>.mp4 \
  --template /tmp/editing_e2e/template.json --generation /tmp/editing_e2e/generation.json \
  --sample test_videos/editing.mov --expect-video-type beat_cut --gates v3 --strict

# 4) Product-grade full-loop artifact runner (22 stage directories + comparison images + per-clip motion + audio + v3 gate)
npm run full-loop:editing -- --sample ./test_videos/manual/editing.mov \
  --prompt "Topic: Viral Video Structure Transfer Engine;..." --out docs/artifacts/full_loop_editing_mov

# 4) Run the evidence analyzer / model-provider evaluation separately
npm run analyze:evidence -- --video test_videos/editing.mov --out /tmp/ev.json --frames-dir /tmp/ev_frames
npm run eval:model-understanding -- --sample test_videos/editing.mov
```

Outputs (`storage/generated/` rendering artifacts + `docs/artifacts/model_eval/`): a beat_cut MP4 (large type on black + beat synchronization + audio), real previews sampled per clip, and `docs/artifacts/model_eval/editing_mov_model_eval.{json,md}` (heuristic / Gemini / Ark comparison with visible failures).

Acceptance: `packages/shared/src/__tests__/editingMovMovingMaterialGolden.test.ts` (v2 deterministic golden: eight slots/layered timeline/honest gaps/152 BPM; also proves the gate has teeth—the ideal render passes, while the pre-fix static render fails the motion threshold) + `editingMovBeatCutGolden.test.ts` + `scripts/evaluate-render-quality.mjs --gates v2` (27/27 gates). The v2 test oracle is in `test_fixtures/expected_editing_mov_case_v2/`.

## Motion Graph Structure Transfer Demo

This is currently the strongest SDE/MLE harness path and specifically demonstrates that the system does more than display static JSON or generic B2B templates.

```bash
# No target materials: output family-specific programmatic cards (clean Chinese family names + actual copy, with no PROXY/PLACEHOLDER/debug text)
node scripts/run-motion-graph-case.mjs

# Complete target-material fixture: card images, logo, and copy replace proxy slots
node scripts/run-motion-graph-case.mjs --with-target-assets

# Partial-material stress test: only two cards + copy, with no logo
node scripts/run-motion-graph-case.mjs --with-partial-target-assets

# Malformed-material stress test: external paths, zero-byte files, incorrect roles, and similar cases must be blocked
node scripts/run-motion-graph-case.mjs --with-malformed-target-assets

# Local manifest input: script mode supports a path manifest
node scripts/run-motion-graph-case.mjs --target-assets-manifest docs/fixtures/motion_graph_target_assets/manifest.json
```

Primary outputs:

```text
docs/artifacts/motion_graph_case/visual-evidence.json
docs/artifacts/motion_graph_case/induced-slots.json
docs/artifacts/motion_graph_case/selected-template.json
docs/artifacts/motion_graph_case/asset-evidence.json
docs/artifacts/motion_graph_case/slot-asset-matches.json
docs/artifacts/motion_graph_case/fill-plan.proxy.json
docs/artifacts/motion_graph_case/fill-plan.with-assets.json
docs/artifacts/motion_graph_case/replacement-slots.proxy.json
docs/artifacts/motion_graph_case/replacement-slots.with-assets.json
docs/artifacts/motion_graph_case/render_proxy.mp4
docs/artifacts/motion_graph_case/render_with_assets.mp4
docs/artifacts/motion_graph_case/render_partial_assets.mp4
docs/artifacts/motion_graph_case/render_malformed_assets.mp4
docs/artifacts/motion_graph_case/before_after_contact_sheet.png
docs/artifacts/motion_graph_case/partial_assets_contact_sheet.png
docs/artifacts/motion_graph_case/evaluation.motion_graph.json
```

Target-material fixture:

```text
docs/fixtures/motion_graph_target_assets/
  logo.png
  card_01.png
  card_02.png
  card_03.png
  card_04.png
  copy.json
  manifest.json
  manifest.partial.json
  manifest.malformed.json
```

Current primary-flow slot mapping:

| Induced slot | How it is satisfied |
|---|---|
| `media_cards` | Target image_set with at least four cards |
| `kinetic_typography` | Target brand name / copy |
| `ui_showcase` | Target feature-copy list |
| `geometric_mg` | Programmatic neon geometry; no external materials required |
| `brand_cta` | Target logo + CTA; uses a placeholder/proxy if the logo is missing |

Corpus fixture: `test_videos/corpus/009_motion_graph_card_stack/fixture.json`.

## Managed Material Intake API

In browser/API mode, users do not need to expose local paths in public artifacts. The workflow is:

```text
POST /api/projects/:projectId/assets
→ POST /api/projects/:projectId/target-material-manifests
→ returns normalized targetAssets / assetEvidence / blockedAssets
```

The API manifest uses `assetId`, not arbitrary local paths:

```json
{
  "schemaVersion": "target-material-manifest-v1",
  "brandName": "Viral Structure Engine",
  "cta": "Upload. Analyze. Remix.",
  "features": ["Analyze sample videos", "Induce reusable slots"],
  "assets": [
    { "assetId": "uploaded_card_01", "kind": "image", "role": "media_card" },
    { "assetId": "uploaded_logo", "kind": "logo", "role": "brand_logo" }
  ]
}
```

Material references in the response use safe IDs such as `asset://managed/<assetId>`; actual server paths are resolved only inside the renderer and do not enter public JSON/HTML.

## Optional AIGC Material Completion

AIGC Material Fill is an optional enhancement path. The V5 UI enables gap filling by default when materials are missing, but actual external providers are still controlled by `.env`, API options, and safety switches. Without a key or permission for external calls, the system uses programmatic/deterministic fallbacks. When a user does not have enough materials, this feature turns the gaps into structured generation briefs, generates candidate materials, performs quality checks, registers them as `aigc_generated_material`, and finally sends them through the same slot matcher / fill plan / renderer.

Browser entry point:

- The V5 web workbench’s `2 · Generate` section provides the **Fill Gaps with AIGC and Generate** capability.
- The panel includes an “Enable AIGC gap fill” toggle.
- External providers are controlled by a separate safety toggle. When external calls are not permitted or keys are missing, the live API does not call external image providers and instead falls back to programmatic cards/local deterministic materials.
- The API request sets AIGC gap-fill options; external providers additionally require provider/key configuration in `.env` and an explicit allow flag.
- The result panel displays fields such as the brief, candidate, quality/VLM status, external calls, and sample frames sent.

After external providers are allowed, the live API tries them in this order: `google_gemini_image` (preferred; default `GEMINI_IMAGE_MODEL=gemini-3.1-flash-image`) → `volcengine_seedream` (optional backup; requires `AIGC_IMAGE_BACKUP_PROVIDER`) → `deterministic_local_image_fill` (local deterministic fallback). The live image pipeline does not stop: if all external providers fail, it falls back to a local programmatic PNG and records a `providerFallbackReason` warning. `deterministic_local_image_fill` (formerly `mock_provider`, which now remains only as a deprecated alias) is also used for deterministic CI/script outputs:

```bash
# Deterministic local provider deterministic_local_image_fill (formerly mock_provider, now only a deprecated alias; scripts/CI only, no external calls)
node scripts/run-motion-graph-case.mjs --with-aigc-materials

# Select the provider in .env and explicitly permit external calls
node scripts/run-motion-graph-case.mjs --with-aigc-materials --aigc-provider env --allow-external-aigc

# End-to-end real run: editing/motion example → real Gemini AIGC images + subtitles → render → write to docs/artifacts/full_pipeline_aigc_*/
node scripts/run-full-pipeline-aigc-demo.mjs --sample test_videos/motion_graph_1.mov --theme "AI short-video structure transfer engine"
```

> Real generation (Gemini chunks + AIGC + rendering) may exceed the client’s HTTP timeout. Use asynchronous mode for long-running jobs: `POST /api/generations?async=true` immediately returns `202 {jobId}`; then poll `GET /api/jobs/:jobId` for `outputRefs.generationId`; finally call `GET /api/generations/:id`. The script above already includes this polling logic.

Provider configuration example; do not commit `.env`:

```bash
AIGC_MATERIAL_FILL_ENABLED=false

# Preferred: Google Gemini Image / Nano Banana (accessible through AI Studio)
AIGC_IMAGE_PROVIDER=google_gemini_image
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image
GEMINI_API_KEY=<your_gemini_key>

# Backup: Volcengine Seedream
AIGC_IMAGE_BACKUP_PROVIDER=volcengine_seedream
SEEDREAM_ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
SEEDREAM_ARK_API_KEY=<your_seedream_key>
SEEDREAM_ARK_MODEL=<your_seedream_model_id>   # required; no built-in default. If SEEDREAM_ARK_MODEL/AIGC_IMAGE_MODEL is unset, Seedream configuration throws immediately
SEEDREAM_IMAGE_ENDPOINT=/images/generations
SEEDREAM_RESPONSE_FORMAT=url
SEEDREAM_IMAGE_SIZE=2K
SEEDREAM_STREAM=false
SEEDREAM_WATERMARK=false

# Video material (primary): Volcengine Seedance 2.0 Fast (Ark task API, pure text-to-video)
AIGC_VIDEO_PROVIDER=seedance_2_0
AIGC_VIDEO_MODEL=doubao-seedance-2-0-fast-260128
# The same Ark bearer key can be reused; if SEEDREAM_ARK_API_KEY is already set, this does not need to be configured separately
SEEDANCE_ARK_API_KEY=<your_seedance_or_seedream_ark_key>
SEEDANCE_TASK_ENDPOINT=/contents/generations/tasks
SEEDANCE_GENERATE_AUDIO=true
SEEDANCE_WATERMARK=false

# Video material (backup): Alibaba DashScope happyhorse-1.0-r2v (reference-to-video)
# Automatically takes over if Seedance fails (AccountOverdue/403/moderation 400); uses a Gemini still image as a base64 reference_image.
# Region must match: US key → dashscope-us domain.
AIGC_VIDEO_BACKUP_PROVIDER=happyhorse_r2v
DASHSCOPE_API_KEY=<your_dashscope_key>
DASHSCOPE_BASE_URL=https://dashscope-us.aliyuncs.com/api/v1
HAPPYHORSE_MODEL=happyhorse-1.0-r2v
HAPPYHORSE_RESOLUTION=720P
```

Gemini VLM drives both video understanding and the generated-material quality gate (default: `gemini-3.5-flash`; `gemini-2.5-pro`/`gemini-2.5-flash` are optional alternatives selected through `VLM_MODEL`):

```bash
VLM_PROVIDER=gemini
VLM_MODEL=gemini-3.5-flash          # alt: gemini-2.5-pro | gemini-2.5-flash
GEMINI_VLM_FALLBACK_MODEL=gemini-2.5-flash
GEMINI_API_KEY=<your_gemini_key>
```

AIGC outputs:

```text
docs/artifacts/motion_graph_case/aigc-material-briefs.json
docs/artifacts/motion_graph_case/generated-assets/
docs/artifacts/motion_graph_case/generated-asset-candidates.json
docs/artifacts/motion_graph_case/generated-asset-quality.json
docs/artifacts/motion_graph_case/asset-evidence.aigc.json
docs/artifacts/motion_graph_case/slot-asset-matches.aigc.json
docs/artifacts/motion_graph_case/fill-plan.aigc.json
docs/artifacts/motion_graph_case/replacement-slots.aigc.json
docs/artifacts/motion_graph_case/render_aigc_materials.mp4
docs/artifacts/motion_graph_case/aigc_materials_contact_sheet.png
```

AIGC safety policy:

- Generation and external calls are disabled by default.
- External providers must be explicitly enabled with the UI toggle or, in script mode, by passing `--allow-external-aigc`.
- Once allowed, the live pipeline calls `google_gemini_image → volcengine_seedream → deterministic_local_image_fill` in order. If all external providers fail, it falls back to a local deterministic programmatic PNG without interrupting rendering and records `providerFallbackReason`.
- Seedance video-material generation uses the real Ark task API. On failure, an error warning is recorded without interrupting rendering—no cloud video is produced, while the programmatic Remotion/FFmpeg dynamic proxy produced by the base generation remains available as a local material (`server.ts:1855-1860`).
- Example frames are not sent to external providers (`sampleFramesSentExternally=false`).
- Example video/audio is not uploaded as Seedance `reference_video`/`reference_audio`; currently, only the target-material text prompt is sent.
- Seedream image requests default to `watermark=false`.
- Real brand logos are not fabricated; if `brand_cta` lacks a logo, the system generates a programmatic card/copy or asks the user to upload one.
- Generated materials must include provenance, be labeled `aigc_generated_material`, and must not be presented as user-uploaded materials.

## Provider Configuration Summary

| Capability | Default | Actual implementation | Switch |
|---|---|---|---|
| Video analysis | FFmpeg (mock removed) | FFmpeg / ffprobe / keyframes (fails immediately on error) | `VIDEO_TOOL=ffmpeg` |
| Evidence analyzer | Automatic (when conda is available) | PySceneDetect cuts + librosa beats + keyframes/visual families (`scripts/analyze-evidence-timeline.py`) | Runs automatically with analysis; failures are non-fatal |
| LLM (text enhancement/rewriting/scoring) | `gemini` (default `gemini-3.5-flash`; alternatives: 2.5-pro/2.5-flash) | Gemini (preferred) / Ark Doubao (backup) / OpenAI-compatible | `AI_PROVIDER=gemini|ark_doubao|openai_compatible`; choose a model with `AI_GEMINI_MODEL` |
| VLM | disabled | Gemini (default `VLM_MODEL=gemini-3.5-flash`; alternatives: `gemini-2.5-pro`/`gemini-2.5-flash`) | `VLM_PROVIDER=gemini` |
| Creative-effects code generation | disabled | Gemini generates Remotion effects components (default `GEMINI_CODEGEN_MODEL=gemini-3.5-flash`; Zod schema + static validation + named-import existence checks); falls back to local_fallback on failure | `CREATIVE_EFFECT_GEMINI=1` + `ALLOW_CLOUD_PROVIDERS=1` |
| ASR | `faster_whisper` (local) | faster-whisper (local, optional) → `no_asr_with_warning`. Audio rhythm/BPM is handled by the FFmpeg/librosa evidence pipeline; ASR no longer depends on ElevenLabs. | `ASR_PROVIDER=faster_whisper\|off` |
| OCR | disabled | EasyOCR | `OCR_PROVIDER=easyocr` |
| AIGC image material | disabled | Google Gemini Image, default `gemini-3.1-flash-image` (Nano Banana 2; alternatives: Nano Banana Pro `gemini-3-pro-image` / `imagen-4.0-generate-001` / `gemini-2.5-flash-image`; preferred) → Volcengine Seedream (optional backup; model specified by `SEEDREAM_ARK_MODEL`/`AIGC_IMAGE_MODEL`, with no default) → `deterministic_local_image_fill` (local deterministic fallback that does not interrupt the pipeline) | Select a model with `GEMINI_IMAGE_MODEL`; use `AIGC_IMAGE_PROVIDER=google_gemini_image` / `AIGC_IMAGE_BACKUP_PROVIDER=volcengine_seedream` + explicit flag |
| AIGC video material | disabled | Primary: Volcengine Seedance 2.0 Fast (Ark, pure t2v) → backup: Alibaba DashScope happyhorse-1.0-r2v (reference-to-video, using a Gemini still as base64 `reference_image`; automatically takes over when Seedance has insufficient funds or returns 403) → AIGC still-image fallback | `AIGC_VIDEO_PROVIDER=seedance_2_0` + `SEEDANCE_ARK_API_KEY`; `AIGC_VIDEO_BACKUP_PROVIDER=happyhorse_r2v` + `DASHSCOPE_API_KEY` + `DASHSCOPE_BASE_URL` (US domain) |
| Audio generation | Google preferred (opt-in, never fatal) | Voiceover: Gemini TTS (default `gemini-3.1-flash-tts-preview`) → subtitles/no narration; Music: Lyria (default `lyria-3-clip-preview`) → FFmpeg programmatic BGM; SFX: FFmpeg programmatic hit/riser/whoosh. Finally, FFmpeg performs layered mixing over the BGM bed (bed / voiceover + adelay / programmatic SFX, amix + highpass + alimiter). | `GEMINI_API_KEY` + `GOOGLE_AUDIO_ENABLE_CLOUD`/`ALLOW_CLOUD_PROVIDERS` + `GOOGLE_AUDIO_ENABLE_MUSIC\|TTS` |
| Renderer | FFmpeg (mock removed) | FFmpeg / Remotion / HyperFrames stub (programmatic cards with no debug text) | Request `rendererTarget` |
| Storage | JSON | SQLite | `STORAGE_BACKEND=json|sqlite` |

> The Google audio stack (Gemini TTS voiceover + Lyria music) is integrated through `apps/api/src/adapters/googleAudio.ts`. Before rendering, the server injects Google audio; on failure, it immediately falls back to local FFmpeg/librosa/programmatic audio. ElevenLabs is no longer a required provider and is no longer a default/backup path for ASR, Music, TTS, or SFX. Forced Alignment / Audio Isolation / Dubbing / Lip Sync are not required by the current rubric; their routes return skip/local reports.

## Items That Still Require Manual Configuration

- Ark Doubao / OpenAI-compatible LLM key: used for structure extraction, natural-language revisions, and LLM scorecards.
- Gemini key: used for real VLM video understanding and the AIGC material quality gate.
- Seedream key + model ID: used for optional external image-material generation. `SEEDREAM_ARK_MODEL`/`AIGC_IMAGE_MODEL` has no built-in default; configuration throws immediately if neither is set.
- Seedance/Ark key: used for optional external video-material generation; `SEEDREAM_ARK_API_KEY` can be reused.
- Google audio: Gemini TTS / Lyria reuse `GEMINI_API_KEY` and require `GOOGLE_AUDIO_ENABLE_CLOUD=1` or `ALLOW_CLOUD_PROVIDERS=1`; the current account must also have usable billing/credits.
- faster-whisper / easyocr: install as needed in the `viral` conda environment (faster-whisper is local ASR; audio rhythm/BPM is mainly supplied by the FFmpeg/librosa evidence pipeline).
- Remotion Chromium: the browser cache is downloaded during the first real Remotion render.

## Operational Boundaries and Notes

- External AIGC images, Seedance short videos, happyhorse reference-to-video, and Google Lyria/TTS are all integrated; real cloud output requires explicit `.env` switches and valid keys.
- The default safety policy does not use example video/audio as reference material for generation providers. Pixel-level VLM analysis of user target materials additionally requires `ALLOW_EXTERNAL_VLM_USER_ASSET_ANALYSIS=1`.
- Text-model and multimodal-model calls are separated: `createTextModelFn` prefers Doubao when an Ark/Doubao key is available and otherwise uses Gemini; example video/frame understanding and Gen1 visual-capsule generation use Gemini.
- If a real provider fails, the system does not fabricate a cloud result; the generation pipeline records a warning and falls back to programmatic visuals/audio or a deterministic fixture.
- Real Remotion rendering depends on local Chromium, FFmpeg, and compatible versions of `@remotion/three` / `@react-three/fiber`. Long videos and AIGC video generation take considerable time; use the UI progress bar or `/api/v5/jobs/:jobId/progress` to monitor status.
- `scripts/record-v5-demo.mjs` can record a high-resolution UI demo with Playwright and supports toggles for button-only demonstrations, real Learn/Generate/Revise operations, downloading exported JSON, and more.
