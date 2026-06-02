# Model Stack v4.1

> Spec version: v4.1. The implemented typed model-router summary literal is `model-router-v4.2` (`router.ts`, `types.ts`); see `docs/model-router-v4-2.md`.

> **Current default models (v4.2, env-configurable — see `.env.example`):** LLM / VLM / creative-effect codegen = `gemini-3.5-flash`; native image fill = `gemini-3.1-flash-image` (Nano Banana 2); video fill = Seedance 2.0 (kept). Prior `gemini-2.5-*` ids are now **selectable alternatives** via env. Other Google options (Nano Banana Pro / Imagen 4, Gemini TTS, Lyria, Veo 3.1) are documented alternatives that need a dedicated adapter. The tables below name the role + the current default; swap models via the env vars without code changes.

## v4.2 routing status

Phase 1-2 introduces a typed ModelTask router in `packages/shared/src/model-router/`. This document remains the candidate stack inventory; the canonical implementation of route decisions, fallback reasons, and media access policy is now the shared router plus `docs/model-router-v4-2.md`.

Heavy providers such as Seedance, Seedream, ElevenLabs, PaddleOCR, GroundingDINO, SAM2, CoTracker, and BGE-M3 remain optional candidates until their dependencies, costs, and safety policies are explicitly enabled.

Phase 3 wires route records into product artifacts and adds deterministic/offline versions of model-assisted tasks:

- Recipe lint / repair checks
- Provider prompt compiler
- Gap repair strategy ranker
- Chinese structure explanation generator
- high_click / high_conversion / high_quality version planner
- Natural edit patch agent for supported Chinese edit commands
- Offline video critic / visual QA fallback
- TechniqueAtom lexical retrieval / curator fallback

These tasks do not call paid providers and do not add heavyweight model dependencies. They are local planning/report/gate layers around the existing Remotion + FFmpeg render backbone.

## 1. Required/core stack

These are required or strongly recommended for the core demo because they support deterministic structure transfer and local reproducibility.

| Layer | Primary | Backup | Role |
|---|---|---|---|
| Video metadata / mux | FFmpeg / FFprobe | — | duration, fps, waveform, final mux, fallback render |
| CV / video analysis | OpenCV, PySceneDetect, optical flow | frame-diff heuristics | scene cuts, motion energy, bbox tracks, visual candidates |
| Audio analysis | librosa | FFmpeg audio filters | BPM, onsets, beat grid, energy curve |
| ASR | ElevenLabs Scribe (cloud, default `ASR_PROVIDER=elevenlabs_scribe`) | faster-whisper (local fallback) → no_asr_with_warning | transcript, word timestamps, dialogue zones |
| OCR | PaddleOCR or EasyOCR | VLM OCR fallback | subtitle bbox, on-screen text, typography evidence |
| VLM | Gemini (default `gemini-3.5-flash` via `VLM_MODEL`; alt `gemini-2.5-pro`/`gemini-2.5-flash`) | heuristic / frame-sheet fallback (Qwen3-VL / Doubao multimodal are unimplemented candidates) | frame-sheet interpretation, visual naming, material suitability |
| Text planner | Gemini (default `gemini-3.5-flash` via `AI_GEMINI_MODEL`; alt `gemini-2.5-pro`/`gemini-2.5-flash`) | GPT-5 / Qwen3 / Doubao-Seed-2.0-lite are unimplemented candidates | TechniqueAtoms, GapReport, TransferPlan, JSON normalization |
| Creative-effect codegen | Gemini (default `gemini-3.5-flash` via `GEMINI_CODEGEN_MODEL`) | `local_fallback` template | generate a reusable props-driven Remotion effect component (zod schema in `schema.ts`), statically validated before apply |
| Renderer | Remotion + FFmpeg | HyperFrames optional | layer-based motion graphics + final mp4 |

## 2. Optional AIGC visual providers

These are useful but must not be mandatory for core success.

| Use case | Preferred | Backup | Fallback without API |
|---|---|---|---|
| Missing moving visual insert | Seedance 2.0 (`doubao-seedance-2-0-fast-260128`) | `remotion_procedural_motion` (Veo 3.1 / Kling / Runway are unimplemented candidates) | `ffmpeg_proxy_motion` + existing assets |
| Product-in-motion / hero motion | Seedance 2.0 image-to-video | `remotion_procedural_motion` (Veo / Kling unimplemented) | product image + Remotion orbit/zoom/sweep |
| Cinematic motion background | Seedance 2.0 | `remotion_procedural_motion` (Runway / Kling unimplemented) | procedural gradients, ribbons, particles |
| Static poster / background / cover | google_gemini_image (default `gemini-3.1-flash-image` = Nano Banana 2; alt `gemini-3-pro-image` Nano Banana Pro / `imagen-4.0-generate-001` / `gemini-2.5-flash-image`) | volcengine_seedream (model from `SEEDREAM_ARK_MODEL`/`AIGC_IMAGE_MODEL`, no default) | `deterministic_local_image_fill` / Remotion shape card |
| CTA visual / product card | google_gemini_image (default `gemini-3.1-flash-image`; alt Nano Banana Pro / Imagen 4 / `gemini-2.5-flash-image`) | volcengine_seedream (env-driven model) | `deterministic_local_image_fill` / card + existing product image |

## 3. ElevenLabs audio stack

ElevenLabs should be used for audio intelligence and audio generation, not as the main visual video generator.

| Module | Provider | Use |
|---|---|---|
| ASR | ElevenLabs Scribe / Scribe Realtime | higher-quality transcript, timestamps, audio-event tags |
| TTS | ElevenLabs TTS | product ad voiceover, CTA narration, multilingual versions |
| SFX | ElevenLabs Sound Effects | whoosh, hit, riser, impact, UI clicks |
| Music | ElevenLabs Music | custom BGM bed matching style, mood, duration |
| Cleanup | ElevenLabs Audio Isolation | clean user source video audio |
| Forced Alignment | ElevenLabs Forced Alignment | word/phrase timing alignment for captions and voiceover sync |
| Dubbing | not implemented / future candidate | `dubbing` ModelTask routes to `skip_with_warning` (no adapter method); listed for planning only |
| Lip Sync | not implemented | no `lip_sync` ModelTask or provider exists |

## 4. Provider classification

```ts
type ModelProviderRole =
  | "core_deterministic"
  | "core_ml"
  | "optional_aigc_visual"
  | "optional_aigc_audio"
  | "optional_quality_gate";
```

## 5. Recommended final stack

```text
Core:
- FFmpeg / FFprobe
- OpenCV / PySceneDetect / optical flow
- librosa
- faster-whisper
- PaddleOCR or EasyOCR
- Gemini VLM (default gemini-3.5-flash; alt gemini-2.5-pro/gemini-2.5-flash via VLM_MODEL) — Qwen3-VL / Doubao multimodal are unimplemented candidates
- Gemini text planner + creative-effect codegen (default gemini-3.5-flash via AI_GEMINI_MODEL / GEMINI_CODEGEN_MODEL); Doubao-Seed-2.0-lite is an unimplemented candidate LLM fallback
- Remotion + FFmpeg

Optional upgrades:
- Seedance 2.0 (doubao-seedance-2-0-fast-260128) for missing moving visuals (kept as the video-fill default; Veo 3.1 is a documented alternative needing an adapter)
- google_gemini_image (default gemini-3.1-flash-image = Nano Banana 2; alt gemini-3-pro-image / imagen-4.0-generate-001) for static poster/background/cover fill, with volcengine_seedream (env-driven model, no default) as backup
- ElevenLabs Scribe for ASR
- ElevenLabs TTS for voiceover
- ElevenLabs Sound Effects for hits/whoosh/riser
- ElevenLabs Music for BGM
- ElevenLabs Audio Isolation for cleanup
- ElevenLabs Forced Alignment for caption/voiceover timing
- (Dubbing/Lip Sync are NOT implemented — dubbing routes to skip_with_warning, no lip_sync task)
```

## 6. Why this is the right balance

The project is judged on structure migration,素材缺口处理,结果展示,多版本,真实素材适配, and人机协同. AIGC providers can improve missing assets and audio polish, but they should not hide or replace the structure-transfer system. The core demo must still work with local evidence extraction and Remotion/FFmpeg rendering.
