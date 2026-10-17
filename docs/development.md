# Development Guide

This guide covers the current V5.1 implementation. Start with the [README](../README.md) for the product workflow and demo videos, or the [project overview](project-overview.md) for architecture and competition context.

## Prerequisites

- Node.js 22 and npm for the workspace build and development servers.
- Conda with a Python environment named `viral`, or another name configured through `VIRAL_CONDA_ENV`.
- FFmpeg and ffprobe on PATH, including during API-driven rendering.
- Python packages for the evidence analyzer: NumPy, OpenCV, PySceneDetect, and librosa.
- Chromium for real Remotion rendering. Its first use may download a browser and require network access/system browser dependencies.
- Optional EasyOCR and faster-whisper for local text/speech analysis.

The API's evidence adapter checks for `<CONDA_BASE>/envs/<VIRAL_CONDA_ENV>/bin/python` before invoking analysis. Set those variables explicitly; the code and environment example otherwise contain the original developer's Conda path.

Example environment preparation:

```bash
conda create -n viral -c conda-forge python=3.11 ffmpeg
conda activate viral
python -m pip install numpy opencv-python scenedetect librosa

# Optional local OCR / ASR
python -m pip install easyocr faster-whisper

npm install
cp .env.example .env
```

Set `CONDA_BASE` in `.env` to the output of `conda info --base`, and set `VIRAL_CONDA_ENV=viral`. Add the environment's `bin` directory to the API process PATH if you launch it without `conda activate`. A full render also depends on compatible Remotion/React/Three packages; keep the workspace lockfile and installed dependency versions aligned.

## Local configuration

The supplied `.env.example` is a cloud-demo configuration: it selects Gemini, AI gap filling, cloud audio/ASR, and external sample/user-material analysis switches. Its credentials are blank. With valid credentials added, V5 defaults can invoke those services.

For an explicitly local workflow, keep provider credentials empty in the API process environment, including any inherited Gemini, Ark/Doubao, DashScope, and ElevenLabs keys. Adjust `.env`:

```dotenv
CONDA_BASE=/path/to/your/conda
VIRAL_CONDA_ENV=viral
VIDEO_TOOL=ffmpeg
STORAGE_BACKEND=json

ALLOW_CLOUD_PROVIDERS=0
ALLOW_EXTERNAL_SAMPLE_MEDIA=0
ALLOW_EXTERNAL_VLM_SAMPLE_ANALYSIS=0
ALLOW_EXTERNAL_VLM_USER_ASSET_ANALYSIS=0
ALLOW_EXTERNAL_ASR_SAMPLE_ANALYSIS=0
AIGC_ALLOW_EXTERNAL_UPLOAD=false
AIGC_ALLOW_SAMPLE_FRAMES_TO_PROVIDER=false
AIGC_ALLOW_TARGET_ASSETS_TO_PROVIDER=false
AIGC_MATERIAL_FILL_ENABLED=false
AIGC_VIDEO_FILL=0
GOOGLE_AUDIO_ENABLE_CLOUD=0
GOOGLE_AUDIO_ENABLE_TTS=0
GOOGLE_AUDIO_ENABLE_MUSIC=0
ENABLE_ELEVENLABS_LIVE_TESTS=0
ELEVENLABS_ENABLE_CLOUD=0
ASR_PROVIDER=faster_whisper
```

Use these **learning request options** to select a deterministic template and avoid model-based capsule reconstruction:

```json
{
  "options": {
    "runGen1Ai": false,
    "runCapsuleCodegen": false,
    "useVision": false
  }
}
```

Use these **generation request options** for procedural filling and no context-model rewrite:

```json
{
  "options": {
    "generationMode": "same_template",
    "rewriteContext": false,
    "aigcGapFill": {
      "mode": "auto_on",
      "imageFill": "procedural",
      "audioFill": "procedural",
      "textFill": "off"
    }
  }
}
```

These options belong inside the full request body shown below. Local templates still require the evidence tools and real rendering still requires Chromium/FFmpeg. Natural-language revisions can invoke the text-model factory if keys exist; use structured patches for deterministic edits.

`ALLOW_CLOUD_PROVIDERS=0` alone is insufficient to disable every V5 model factory. Visual reconstruction is gated by sample-analysis settings; text factories inspect credentials; same-template media filling is driven by request options and provider credentials. Planning via `/generations/plan` skips the final render but can still run rewriting and media filling. It is not a guaranteed offline dry run.

## Provider configuration

All model identifiers below describe the repository configuration and can be overridden. Use models/endpoints available to your account.

| Capability | Main settings | Implementation notes |
| --- | --- | --- |
| Gemini reference reconstruction | `GEMINI_API_KEY`, `ALLOW_EXTERNAL_VLM_SAMPLE_ANALYSIS=1`, `GEMINI_GEN1_MODEL`, `GEMINI_GEN1_MODEL_LONG` | `options.useVision=false` disables visual input. `.env.example` selects `gemini-3.1-pro-preview` for both duration buckets; code defaults without overrides differ. |
| Duration-based model routing | `GEMINI_GEN1_PRO_MIN_SEC=34` | Model selection and long-video chunking are related but separately configurable. |
| V5 text rewriting and patch planning | `ARK_API_KEY` + `ARK_MODEL`, or `GEMINI_API_KEY` | `createTextModelFn` prefers configured Ark/Doubao. `DOUBAO_*` overrides are also supported. Some rewrite paths try Gemini after an Ark failure. |
| Legacy text adapter / text codegen | `AI_PROVIDER`, `AI_GEMINI_MODEL`, `GEMINI_CODEGEN_MODEL` | These variables do not override the priority in V5's text-model factory. |
| Target-material VLM enrichment | `GEMINI_API_KEY`, `ALLOW_EXTERNAL_VLM_USER_ASSET_ANALYSIS=1`, `VLM_MODEL` | Otherwise uses local/heuristic profiles. |
| Image filling | `AIGC_IMAGE_PROVIDER=google_gemini_image`, `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL` | `.env.example` selects `gemini-3.1-flash-image`. Use procedural filling in the request for a local path. |
| Seedream image adapter | `SEEDREAM_ARK_API_KEY`, `SEEDREAM_ARK_MODEL`, `SEEDREAM_ARK_BASE_URL` | Available as an image provider/backup in supported paths; backup ordering varies by caller. |
| Seedance footage | `AIGC_VIDEO_FILL=1`, `SEEDANCE_MODEL`, `SEEDANCE_ARK_API_KEY` | Same-template filling can also use `SEEDANCE_API_KEY`, `SEEDREAM_ARK_API_KEY`, or `ARK_API_KEY`. It selects Seedance directly for eligible video slots. |
| happyhorse backup footage | `DASHSCOPE_API_KEY`, `DASHSCOPE_BASE_URL`, `AIGC_VIDEO_BACKUP_PROVIDER=happyhorse_r2v`, `HAPPYHORSE_MODEL` | Uses a generated reference still; match the DashScope base URL to your account's region. |
| Google audio | `GEMINI_API_KEY`, `GOOGLE_AUDIO_ENABLE_CLOUD`, `GOOGLE_AUDIO_ENABLE_MUSIC`, `GOOGLE_MUSIC_MODEL` | Same-template music uses Lyria, with segmented generation for long beds and procedural fallback. TTS settings include `GOOGLE_AUDIO_ENABLE_TTS`, `GOOGLE_TTS_MODEL`, and `GOOGLE_TTS_VOICE`. |
| Optional speech/audio adapters | `ASR_PROVIDER`, `ELEVENLABS_API_KEY`, `ELEVENLABS_ENABLE_*` | Local faster-whisper and ElevenLabs integrations are available; behavior varies by route. |

The cloud same-template path defaults to automatic AI filling. Missing or failed cloud output is represented by warnings, still-image/procedural fallbacks, or missing slots. Check `generatedAssets`, slot-binding provenance, `usedFallbackRenderer`, and the scorecard rather than inferring a cloud success from an MP4.

## Start the application

```bash
conda activate viral
npm run dev
```

`dev` builds shared/renderer packages and starts the API and web servers. To run them separately, build those dependencies first:

```bash
npm run build --workspace @vvst/shared
npm run build --workspace @vvst/renderer
```

Then use `npm run dev:api` and `npm run dev:web` in separate terminals. For a compiled API, run `npm run build`, then `npm run start --workspace @vvst/api`; the frontend still needs a development or static server.

| Surface | Default address |
| --- | --- |
| V5 dashboard | `http://localhost:5173/#v5` (also the default hashless page) |
| Legacy dashboard | `http://localhost:5173/#v4` |
| API status | `http://localhost:3000/` |
| Health/readiness | `http://localhost:3000/healthz`, `http://localhost:3000/readyz` |
| V5 API | `http://localhost:3000/api/v5` |

Vite proxies `/api`, `/generated`, `/healthz`, and `/readyz` to port 3000. If you change `APP_PORT`, update the proxy in `apps/web/vite.config.ts` too. Vite can select a different web port when 5173 is busy.

## API workflow

Legacy project/upload routes return `{ "data": ... }`; V5 routes return their payload directly. Replace placeholder IDs with values returned by your own requests.

### Create a project and upload media

```bash
curl -sS http://localhost:3000/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"Structure transfer demo","aspectRatio":"9:16","targetDurationSec":16}'

curl -sS http://localhost:3000/api/projects/PROJECT_ID/assets \
  -F 'file=@/path/to/reference.mp4' -F 'role=source_video'

curl -sS http://localhost:3000/api/projects/PROJECT_ID/assets \
  -F 'file=@/path/to/product.png' -F 'role=user_image' \
  -F 'sourcePolicy=user_authorized'
```

Uploads accept supported video/image/audio/text files with a 500 MiB per-file limit. Use managed asset IDs in requests. The legacy target-material-manifest endpoint also normalizes managed asset IDs; arbitrary local paths are reserved for supported local scripts.

### Learn a reference

```bash
curl -sS http://localhost:3000/api/v5/learn-samples \
  -H 'Content-Type: application/json' \
  -d '{
    "sampleAssetIds":["REFERENCE_ASSET_ID"],
    "jobId":"learn-demo-1",
    "options":{"runGen1Ai":false,"runCapsuleCodegen":false,"useVision":false}
  }'
```

Read `learned[].templateCapsuleId`, warnings, and template validation results. For cloud visual reconstruction, enable sample analysis, configure Gemini, and set `runCapsuleCodegen=true` and `useVision=true`. `runGen1Ai` controls a separate neutral-program enhancement; it is not the capsule-codegen switch.

### Generate from the template

```bash
curl -sS http://localhost:3000/api/v5/generations \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId":"PROJECT_ID",
    "generationId":"gen-demo-1",
    "jobId":"gen-demo-1",
    "brief":{"theme":"A portable desk lamp","sellingPoints":["Soft light","Compact design"],"aspectRatio":"9:16"},
    "targetAssetIds":["PRODUCT_ASSET_ID"],
    "options":{
      "generationMode":"same_template",
      "templateCapsuleId":"CAPSULE_ID",
      "rewriteContext":false,
      "aigcGapFill":{"mode":"auto_on","imageFill":"procedural","audioFill":"procedural","textFill":"off"}
    }
  }'
```

Use `slotAssignments: { "SLOT_ID": "ASSET_ID" }` at the top level for explicit bindings. Otherwise, compatible user materials are matched in order, with profile-based handling for roles such as logos. Enable AI filling and context rewrite only for the capabilities you intend to invoke.

V5 learning/generation requests wait for the pipeline to finish. A client-supplied `jobId` lets another request poll `GET /api/v5/jobs/:jobId/progress` while the original request remains open. Configure long client timeouts for real-provider runs. The older `/api/generations?async=true` flow is a separate API.

Read the saved result with `GET /api/v5/generations/gen-demo-1` and its trace with `GET /api/v5/generations/gen-demo-1/transfer-trace`. Use the generation ID for trace retrieval; progress IDs can be different.

### Revise a result

```bash
curl -sS http://localhost:3000/api/v5/generations/gen-demo-1/revise \
  -H 'Content-Type: application/json' \
  -d '{"patch":{"copyOverrides":{"headline":"Light that fits your day"},"textDensity":"minimal"}}'

curl -sS http://localhost:3000/api/v5/generations/gen-demo-1/revise-natural-language \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"Reduce subtitle density and move the CTA earlier."}'
```

Use actual copy keys from the capsule for `copyOverrides`. Revisions reuse bound visuals and produce a new generation ID. Creative knobs can invoke a code rewrite; fresh image generation requires a new `/generations` request. Natural-language patch interpretation uses an available text model or deterministic fallback.

### Discovery and evidence endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v5/assets`, `GET /api/v5/assets/:id/media` | List managed materials and serve media. |
| `GET /api/v5/templates`, `GET /api/v5/templates/:id` | List/read reusable capsules. |
| `GET /api/v5/samples/:id/evidence` | Read learning evidence. |
| `GET /api/v5/samples/:id/reconstruction` | Read the neutral reconstruction. |
| `GET /api/v5/samples/:id/elements` | Read learning candidates and curation decisions. |
| `GET /api/v5/kb/elements?kind=&tag=&q=` | Filter knowledge elements. |
| `POST /api/v5/kb/search` | Search with `{ "query": "...", "filters": { "kind": ["hook_pattern"] } }`. |
| `GET /api/v5/kb/decisions` | Inspect curation history. |
| `POST /api/v5/generations/plan` | Run planning without final rendering; rewriting/filling may still execute. |
| `GET /api/v5/generations/:id/scorecard` | Read gates and readiness. |
| `GET /api/v5/showcase` | List curated showcase artifacts that exist locally. |

## Verification and demos

| Command | Purpose / requirements |
| --- | --- |
| `npm run build` | Build all workspaces. |
| `npm run typecheck` | Build shared dependencies and check workspace TypeScript. |
| `npm test` | Build shared/renderer and run shared/API test suites. Tests need local socket access. |
| `npm run validate:schemas:v5` | Validate V5 examples and the canonical gate registry. |
| `npm run v5:golden` | Run the V5 golden pipeline harness. |
| `npm run validate:schemas` | Validate legacy schemas/fixtures and available database rows. |
| `npm run regression:corpus:strict` | Analyze corpus fixtures; requires Python/media tools and fixture videos. |
| `npm run corpus:generate` | Generate synthetic corpus videos. |
| `npm run pipeline:full` | Run the older local build/test/schema/corpus/marketing pipeline; depends on demo fixtures. |
| `npm run visual:qa` | Produce visual review reports for available case artifacts. |
| `npm run showcase:report`, `npm run submission:pack` | Build older static showcase/submission reports from existing local artifacts. |

Additional legacy demos remain available through `npm run e2e:editing-beatcut`, `npm run full-loop:editing`, and `node scripts/run-motion-graph-case.mjs`. These are specialized harnesses with their own fixture requirements, not the V5 dashboard's default generation route.

`scripts/run-v5-four-aigc.py` runs a real-provider multi-reference demonstration against a running API. Inspect its input paths and environment first; it requires local reference videos, configured providers, and can incur cloud calls. Generated bundles under `docs/artifacts/`, `test_runs/`, `verify_submission/`, and most of `storage/` are local evidence, not guaranteed checkout contents.

### Record a UI demo

`scripts/record-v5-demo.mjs` uses Playwright, a running dashboard/API, and FFmpeg. It imports `playwright`, which is not declared in the root development dependencies; install it separately if needed:

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium

DEMO_URL=http://127.0.0.1:5173/#v5 \
RUN_LEARN=0 RUN_GENERATE=0 RUN_REVISE=0 \
EXERCISE_BUTTONS=0 \
node scripts/record-v5-demo.mjs
```

The script's built-in URL uses port **5174**, so set `DEMO_URL` to your actual web URL. Recordings and logs go under `artifacts/demo-recordings/<timestamp>/` unless `DEMO_RECORD_OUT` is set. The script writes a WebM and attempts an MP4 conversion when FFmpeg is available.

`RUN_LEARN=1`, `RUN_GENERATE=1`, and `RUN_REVISE=1` exercise real operations. `SAFE_LOCAL_GENERATE` controls some recording behavior; it does not disable every server-side model path. `DOWNLOAD_EXPORTS=1` saves UI evidence downloads; `DEMO_SAMPLE_FILE` and comma-separated `DEMO_TARGET_FILES` supply upload paths. Use the local settings above when recording without cloud calls.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `evidence unavailable (conda env / sample path)` | Confirm the configured Conda Python exists, required packages import there, and the uploaded video has a real path. |
| `no template capsule available` | Learn a reference first, then use the returned capsule ID. |
| Empty Showcase | The gallery lists only artifacts present at its configured local paths. README demo copies are separate from the runtime gallery. |
| Render/browser crashes | Confirm Chromium dependencies, FFmpeg availability, dependency compatibility, and available memory. Inspect render warnings. |
| Slow or overloaded renders | Start with `RENDER_CONCURRENCY=1` and `RENDER_TABS_PER_JOB=1`; the code defaults are 2 and 2. `RENDER_TIMEOUT_MS` defaults to 120000 for Remotion's rendering waits. |
| Provider rate limits | Lower `AIGC_GLOBAL_CONCURRENCY` from its default of 8; inspect per-provider warnings. |
| Unexpected cloud calls | Check inherited credentials, request options, V5 text-factory priority, and sample/user-material analysis switches. |
| Successful MP4 but low readiness | Inspect missing slots, procedural-only visuals, user assets actually rendered, no-copy details, and scorecard warnings. |
| `listen EPERM` in tests | The execution environment is preventing local socket binding. Run the API tests where local sockets are allowed. |
| V5 schema validation reports a gate-count mismatch | The current validator expects 43 registry entries while the code defines 44. The six example validations can pass while the command exits unsuccessfully on this separate registry assertion. |

For implementation changes, start with `apps/api/src/v5Routes.ts`, `apps/api/src/pipeline-v5/`, `apps/web/src/v5/V5Dashboard.tsx`, and the [canonical V5 contracts](../packages/shared/src/contracts-v5/).
