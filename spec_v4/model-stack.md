# Model Stack v4.1

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
| ASR | faster-whisper | ElevenLabs Scribe in cloud mode | transcript, word timestamps, dialogue zones |
| OCR | PaddleOCR or EasyOCR | VLM OCR fallback | subtitle bbox, on-screen text, typography evidence |
| VLM | Gemini 3.1 Pro or Qwen3-VL | Doubao multimodal if available | frame-sheet interpretation, visual naming, material suitability |
| Text planner | Gemini 3.1 Pro / GPT-5 / Qwen3 | Doubao-Seed-2.0-lite | TechniqueAtoms, GapReport, TransferPlan, JSON normalization |
| Renderer | Remotion + FFmpeg | HyperFrames optional | layer-based motion graphics + final mp4 |

## 2. Optional AIGC visual providers

These are useful but must not be mandatory for core success.

| Use case | Preferred | Backup | Fallback without API |
|---|---|---|---|
| Missing moving visual insert | Seedance 2.0 | Veo 3.1, Kling 3.0, Runway Gen-4 | Remotion procedural motion + existing assets |
| Product-in-motion / hero motion | Seedance 2.0 image-to-video | Veo / Kling | product image + Remotion orbit/zoom/sweep |
| Cinematic motion background | Seedance 2.0 | Runway / Kling | procedural gradients, ribbons, particles |
| Static poster / background / cover | Seedream 4.0 | GPT Image 2, Nano Banana 2, FLUX | Remotion generated poster/card |
| CTA visual / product card | Seedream 4.0 | GPT Image 2, Nano Banana 2 | text + card + existing product image |

## 3. ElevenLabs audio stack

ElevenLabs should be used for audio intelligence and audio generation, not as the main visual video generator.

| Module | Provider | Use |
|---|---|---|
| ASR | ElevenLabs Scribe / Scribe Realtime | higher-quality transcript, timestamps, audio-event tags |
| TTS | ElevenLabs TTS | product ad voiceover, CTA narration, multilingual versions |
| SFX | ElevenLabs Sound Effects | whoosh, hit, riser, impact, UI clicks |
| Music | ElevenLabs Music | custom BGM bed matching style, mood, duration |
| Cleanup | ElevenLabs Audio Isolation | clean user source video audio |
| Dubbing | ElevenLabs Dubbing | multilingual localization |
| Lip Sync | ElevenLabs Lip Sync | optional talking-head insert only |

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
- Gemini 3.1 Pro or Qwen3-VL
- Doubao-Seed-2.0-lite as contest-provided LLM fallback
- Remotion + FFmpeg

Optional upgrades:
- Seedance 2.0 for missing moving visuals
- Seedream 4.0 for static poster/background/cover fill
- ElevenLabs Scribe for ASR
- ElevenLabs TTS for voiceover
- ElevenLabs Sound Effects for hits/whoosh/riser
- ElevenLabs Music for BGM
- ElevenLabs Audio Isolation for cleanup
- ElevenLabs Dubbing/Lip Sync for localization/talking-head cases
```

## 6. Why this is the right balance

The project is judged on structure migration,素材缺口处理,结果展示,多版本,真实素材适配, and人机协同. AIGC providers can improve missing assets and audio polish, but they should not hide or replace the structure-transfer system. The core demo must still work with local evidence extraction and Remotion/FFmpeg rendering.
