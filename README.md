# Viral Video Structure Transfer Engine — Final Spec v1.2

中文名：**爆款结构迁移引擎：从样例拆解、素材补全到视频重组的 AI 创作平台**

The system learns reusable creative structures from high-performing short videos, stores them as a knowledge base of `StructureTemplate` + `KnowledgeAtom`, and applies them to a new source video plus a user prompt to produce a reconstructed short-video plan, browser preview, and (when FFmpeg is available) an MP4 demo.

## Spec v1.2 documents

- [Requirements](./spec_v2/requirements.md)
- [System Design](./spec_v2/design.md)
- [API Specification](./spec_v2/api.md)
- [Implementation Tasks](./spec_v2/tasks.md)
- [Test Plan](./spec_v2/test-plan.md)
- [Demo Playbook](./spec_v2/demo-playbook.md)
- [Source Alignment](./spec_v2/source-alignment.md)
- [JSON Schemas](./spec_v2/schemas/)
- **[Implementation Status](./spec_v2/implementation-status.md)** — what's done, what's partial, what's deferred (phase-by-phase against `tasks.md`)

The deprecated `specs_v1/` and `spec_v1_1/` directories are kept for traceability but are superseded by `spec_v2/`.

## Repo layout

```text
apps/
  api/      # Node.js + TypeScript + Express, adapter wiring, spec v1.2 routes
  web/      # React + Vite + TypeScript, 6-step workspace + dashboard rail
packages/
  shared/   # Inline JSON schemas, types, validators, mock pipeline, adapter interfaces
  renderer/ # HtmlPreviewRenderer + MockRenderer (browser-safe)
scripts/
  seed-demo.mjs        # Build a seeded humidifier demo into storage/db + storage/demo/
  validate-schemas.mjs # AJV-validate every fixture and DB row
  python/              # Python helpers (ffprobe, keyframes, faster-whisper, easyocr)
storage/
  uploads/, generated/, db/, demo/
```

## Local run (mock + FFmpeg auto-fallback)

```bash
# 1. Install JS deps
npm install

# 2. Build shared + renderer, then start API and web together
npm run dev
```

Open:

- Web app: <http://localhost:5173>
- API health: <http://localhost:3000/healthz>

Demo flow inside the UI:

1. Open or create a project on the Dashboard rail (default vertical: `b2b_marketing_mg`).
2. **Step 1 Sample Learning** → `Upload Sample` (.mov/.mp4). With `VLM_PROVIDER=gemini` set, Gemini analyses the whole video and the StructureTemplate name + segment intents + atoms are derived from the actual video content, not a static template. `Analyze Mock Sample` is also available for offline testing.
3. **Step 2 Structure Review** → 5 uploaded samples yield 5 distinctly named templates (e.g. *“Learned MG Structure · Cascading cards stacked together, transitioning into rapid splits…”*).
4. **Step 3 Knowledge Base** → atoms are unique per source video (each template contributes 6 base atoms whose names come from VLM `structure.hook/climax/cta/sellingPoints/rhythm/subtitleDensity`, plus up to 4 extra atoms derived from `reusable_patterns`).
5. **Step 4 Source Video + Prompt** → `Upload Source` for a real video. The dropdown auto-selects the most recent real upload; a yellow banner warns when no source is selected or when the seeded mock is still selected.
6. **Step 5 Reconstruction Planner** → click `Generate Reconstruction`. With Gemini-enriched source-side tags every required slot typically matches a real shot (smoke test: 6/6 matched, 8/8 clips use real source footage).
7. **Step 6 Result & Render** → choose a renderer target (`HTML preview`, `Mock preview`, `FFmpeg MP4`, `Remotion` placeholder, `HyperFrames` placeholder) and `Render`. The FFmpeg path cuts source shots, scales to 9:16 720p, overlays subtitles via `drawtext`, and concatenates a real `.mp4`.
8. Export Request / Timeline / Report JSON; the report can be Markdown via `?format=markdown`.

## Conda environment `viral`

FFmpeg-based analysis and rendering, plus optional Python ASR/OCR/VLM helpers, run inside a dedicated conda env so the Node app can shell out reproducibly.

The env is already provisioned at `~/anaconda3/envs/viral` and contains `python 3.11`, `ffmpeg`, `ffprobe`. To extend it with optional adapters:

```bash
conda activate viral
pip install faster-whisper        # enables ASR_PROVIDER=faster_whisper
pip install easyocr               # enables OCR_PROVIDER=easyocr
```

Override discovery via env vars if needed:

```bash
CONDA_BASE=/path/to/anaconda3
VIRAL_CONDA_ENV=viral
```

When `VIDEO_TOOL=ffmpeg`, the API uses `scripts/python/ffprobe_metadata.py` and `scripts/python/extract_keyframes.py` through `apps/api/src/adapters/condaPython.ts`. Failures degrade gracefully back to deterministic mock analysis with warnings on the analysis result.

## NPM scripts

```bash
npm run dev              # build shared/renderer, then run api + web concurrently
npm run dev:api          # backend only
npm run dev:web          # frontend only
npm run build            # build all workspaces
npm run typecheck        # tsc --noEmit across workspaces
npm test                 # shared + api vitest suites
npm run seed:demo        # produce storage/db/app.json + storage/demo/*.json fixtures
npm run validate:schemas # AJV-validate fixtures + DB rows
```

`npm run dev` requires Node 18+ (the project uses `--experimental-vm-modules`-friendly ESM). If you have multiple Node installs, point `npm` at the right one (e.g. `nvm use 22`). When the default JSON backend is used and `storage/db/app.json` is missing, API startup automatically runs the demo seed before the store is opened. SQLite mode does not auto-write the JSON demo DB; run `npm run seed:demo` explicitly if you want those fixtures.

The FFmpeg/Python path is designed to use the conda env `viral`:

```bash
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral npm run dev:api
```

## Adapter map (NFR-001)

All providers are isolated behind interfaces in `packages/shared/src/adapters.ts`. Default wiring lives in `apps/api/src/adapters/index.ts`:

| Concern       | Default (mock-friendly)      | Real implementation                                    | Toggle                                |
|---------------|------------------------------|--------------------------------------------------------|---------------------------------------|
| Video analysis | `MockVideoToolAdapter`      | `FFmpegVideoToolAdapter` (ffprobe + keyframes)         | `VIDEO_TOOL=mock` or `ffmpeg`         |
| AI / LLM       | `MockAIAdapter` (heuristic revise) | `OpenAICompatibleAIAdapter` — generic OpenAI-style or Volcano Ark Doubao Seed 2.0 lite (real `extractStructure`, `reviseInstruction`, `judgeGeneration`)         | `AI_PROVIDER=mock` / `openai_compatible` / `ark_doubao` |
| ASR            | `DisabledASRAdapter`        | `FasterWhisperASRAdapter` via conda viral              | `ASR_PROVIDER=faster_whisper`         |
| OCR            | `DisabledOCRAdapter`        | `EasyOCRAdapter` via conda viral                       | `OCR_PROVIDER=easyocr`                |
| VLM            | `DisabledVLMAdapter`        | `KeyframeHeuristicVLMAdapter` (heuristic) **or** `GeminiVLMAdapter` (Google Gemini, real video understanding) | `VLM_PROVIDER=heuristic` or `gemini` |
| Renderer       | `HtmlPreviewRenderer`       | `FFmpegRenderer` (real MP4), `RemotionRenderer` (bundles `apps/api/remotion/` + renderMedia), `HyperFramesRenderer` (deterministic JSON manifest stub) | per-request `rendererTarget` field    |
| Storage        | `JsonStorageBackend` (single JSON file) | `SqliteStorageBackend` (better-sqlite3 with one table per collection) | `STORAGE_BACKEND=json` or `sqlite`    |

`MockRenderer` lives in `apps/api/src/adapters/renderers.ts` alongside the real renderers; both the Remotion entry (`apps/api/remotion/index.tsx`) and the HyperFrames manifest writer are wired so the API returns a usable artefact for every renderer target.

## Enabling the Ark Doubao Seed 2.0 lite LLM (real `extractStructure` + natural-language revise + LLM scoring)

`OpenAICompatibleAIAdapter` speaks the OpenAI-compatible chat-completions protocol. Volcano Engine Ark Doubao Seed 2.0 lite is supported with a dedicated alias:

```bash
# in your repo-root .env (the assets/ packet ships a contest EP + key — do NOT commit)
AI_PROVIDER=ark_doubao
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3   # default
ARK_API_KEY=<your_ark_key>
ARK_MODEL=ep-20260508213828-7ntjl                       # the EP id you were issued
```

What the LLM does once enabled:

- **`extractStructure`** asks the model for a strict-JSON `TemplateEnrichment` (template name, hook/body/proof/cta intents, 6 atom names, packaging style, rhythm pace, quality rationale) and merges it into the deterministic fallback template. Schema validation is preserved; if the LLM returns bad JSON the fallback runs unchanged.
- **`reviseInstruction`** turns natural-language edits (e.g. "开头更抓人一些") into `Partial<GenerationControls>` + optional `promptAddendum`. The `/api/generations/:id/revise` endpoint applies the patch and re-runs the pipeline.
- **`judgeGeneration`** (used by `/api/generations/:id/scorecard`) returns a 0-100 score across hook/clarity/packaging/rhythm/cta which is merged 50/50 with the deterministic heuristic scorecard.

Without a key the heuristic fallbacks still work end-to-end. To use a generic OpenAI-compatible endpoint instead, set `AI_PROVIDER=openai_compatible` and fill the `OPENAI_COMPATIBLE_*` env vars.

## Enabling Gemini VLM (optional but powerful)

Set up once:

```bash
# in your repo-root .env
VLM_PROVIDER=gemini
VLM_MODEL=gemini-flash-latest   # or gemini-2.5-flash if your account has video access
GEMINI_API_KEY=<your_key_from_aistudio.google.com>
```

When `VLM_PROVIDER=gemini` is set:
- Every sample/source analysis runs the local FFmpeg pipeline (metadata + keyframes) **and** asks Gemini to describe the whole video with strict-JSON output (video_summary, shots, structure, rhythm, packaging, reusable_patterns, material_gaps_for_new_video).
- The VLM result is merged back into the shot list: tags are blended (e.g. `["background"]` → `["background","product_like","usage_scene"]`), `notes` is augmented with the VLM's `visual` description per shot, and `analyzerMode` is upgraded to `ffmpeg_vlm_asr`.
- **The same VLM result is also threaded into `StructureExtractionRequest` so the template itself reflects the real video**: template name from `videoSummary`/`structure.hook`, segment intents from `structure.{hook,setup,sellingPoints,climax,cta}`, rhythm pace and `peakTimeRatio` from `rhythm.avgShotLength`, packaging fields from `packaging.{subtitleDensity,titleCards,stickers,coverStyle}`, plus 6 base atoms with VLM-derived names and 0–4 extra atoms drawn from `reusable_patterns`. Multiple uploads now produce visibly different templates and a non-duplicating knowledge base.
- Slot matching, gap detection and the FFmpeg renderer all benefit from the richer tags; in our final smoke test the source-matched slot count went from 2/6 (FFmpeg only) to **6/6** once Gemini covered both the sample-learning side and the source-understanding side.

Behind the scenes [apps/api/src/adapters/gemini.ts](apps/api/src/adapters/gemini.ts) sends ≤18 MB files inline as base64 (no async file processing required) and falls back to the Files API + state polling for larger uploads. Failures are caught per-step and surfaced on the analysis row's `warnings`; the rest of the pipeline keeps running on FFmpeg-only data.

## Multi-version, revise, scorecard (P1 进阶能力)

Once you have a generation id (`generation_xxx`) you can drive the post-generation features end-to-end via the API:

```bash
# 4 named variants in one call (高点击/高转化/高节奏/高质感)
curl -s -X POST http://localhost:3000/api/generations/$GEN/variants -H 'Content-Type: application/json' -d '{}' | python3 -m json.tool

# Natural-language revise (mutates controls + re-runs generation)
curl -s -X POST http://localhost:3000/api/generations/$GEN/revise -H 'Content-Type: application/json' \
  -d '{"instruction":"开头更抓人一些，节奏更快，CTA 更直接"}' | python3 -m json.tool

# Scorecard (heuristic + optional LLM judge)
curl -s -X POST http://localhost:3000/api/generations/$GEN/scorecard -H 'Content-Type: application/json' \
  -d '{"skipLlm":false}' | python3 -m json.tool
```

Heuristic revise (without an LLM key) recognises hook intensity, pace, subtitle density, CTA style, and "把商品信息提前" instructions. With `AI_PROVIDER=ark_doubao` the LLM does the parsing instead.

## Running the test suites

```bash
npm test                # shared unit + api storage/openai/e2e suites
npm run test:unit       # shared only
npm run test:e2e        # HTTP integration pipeline via supertest (mock adapters)
npm run validate:schemas
# optional: bundle-only smoke for the Remotion entry (no Chromium download)
cd apps/api && RUN_REMOTION_BUNDLE_TEST=true npx vitest run tests/remotion-bundle.test.ts
```

## Switching to SQLite storage

```bash
STORAGE_BACKEND=sqlite npm run dev:api
```

JSON remains the default. The SQLite backend creates `storage/db/app.sqlite` and stores one table per collection (`projects`, `assets`, `jobs`, `analyses`, `templates`, `atoms`, `generations`, `renders`) with `(id PRIMARY KEY, json TEXT)`. Round-trip is verified by `apps/api/tests/storage.test.ts`.

## What still needs a human

These items are intentionally left for the user (cost or external setup):

- **Volcano Ark Doubao key** (`AI_PROVIDER=ark_doubao` + `ARK_API_KEY` + `ARK_MODEL`): contest assets ship an EP + key — copy them into your local `.env` (kept out of git via `.gitignore`).
- **Generic OpenAI-compatible key** (`AI_PROVIDER=openai_compatible` + `OPENAI_COMPATIBLE_*`): use this instead if you have a non-Ark endpoint.
- **Gemini VLM key**: set `VLM_PROVIDER=gemini` + `GEMINI_API_KEY` to enable real video understanding (see section above). Without it, video analysis works via FFmpeg only.
- **faster-whisper / easyocr** Python packages: optional, pip install inside `viral` when desired.
- **Remotion headless Chromium**: the first `rendererTarget=remotion` render auto-downloads a headless Chromium (~150 MB) into `~/.cache/remotion`.

## Primary vertical

**B-end marketing / MG-style short promo videos** — the FFmpegRenderer is tuned for 9:16 720p with title-bar overlays, hard cuts and generated text cards. Other verticals (vlog, talking-head, beat_cut, short_drama, ecommerce) round-trip through the same pipeline but trigger a UI warning that they are best-effort.
