# CHANGELOG

## v4.2 model defaults + creative-effect codegen

- **Default models moved to the current Google line** (env-configurable; see `.env.example`):
  - LLM / VLM / creative-effect codegen → `gemini-3.5-flash` (was `gemini-2.5-pro` / `gemini-2.5-flash`).
  - Native image fill → `gemini-3.1-flash-image` (Nano Banana 2; was `gemini-2.5-flash-image`).
  - Prior `gemini-2.5-*` models kept as **selectable alternatives** (env override); **Seedance 2.0 stays the video-fill default**.
  - Other Google options documented as selectable alternatives that need a new adapter: Nano Banana Pro / Imagen 4 (image), Gemini TTS, Lyria (music), Veo 3.1 (video).
- **Creative-effect codegen layer (new):** evidence → MotifFamily → CreativeEffectSpec → live-Gemini-generated reusable Remotion effect component (zod schema in `schema.ts`, props-driven `index.tsx`) → static validator → apply→KB→manifest→EffectRegistry→RenderRecipe→render. Five motifs: poster_ribbon_marketing, card_orbit_motion_graph, blue_spotlight_ui_pitch, beat_cut_chinese_editing_tutorial, **split_screen_compare** (new).
  - Validator hardened: file-aware zod policy (zod only in `schema.ts`), fixture `proceduralFallback`+`assets`, and **named-import existence check vs installed remotion/react** (catches removed APIs e.g. `Extrapolate` before render). Promotion gate: a generated effect only overrides a built-in when explicitly promoted.
  - Report-only "pure codegen output" eval + a structure-transfer render harness; neither weakens existing gates.

## v4.1 latest-only package

- Created a standalone latest-version package.
- Removed old `spec_v3` and separate `spec_v4` folders from the deliverable.
- Integrated the v4 base architecture with the v4.1 provider/model updates.
- Added Seedance 2.0 as optional video-fill provider.
- Added Volcengine Seedream as optional image/poster/cover provider (model id env-driven via SEEDREAM_ARK_MODEL/AIGC_IMAGE_MODEL; no hardcoded default).
- Added ElevenLabs audio stack: Scribe ASR, TTS, SFX, Music, Audio Isolation, Forced Alignment (Dubbing/Lip Sync reserved as a ModelTask only, no adapter).
- Added provider policy, routing/fallback, generated provenance, and acceptance gates.

> Note: this spec package is labeled v4.1, while the runtime typed model-router summary literal is `model-router-v4.2` (`router.ts:385`, `types.ts:180`).
