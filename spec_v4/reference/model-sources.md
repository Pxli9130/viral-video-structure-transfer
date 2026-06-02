# Model Source Notes

These references are for provider selection only. The system should not rely on any single online provider for the core demo.

## ByteDance Seedance 2.0

Official page: `https://seed.bytedance.com/en/seedance2_0`

Relevant capability summary:

- Unified multimodal audio-video generation architecture.
- Supports text, image, audio, and video inputs.
- Useful for optional moving visual fill, product-in-motion inserts, moving backgrounds, and transition clips.

Wired in code today:

- Video fill default model id is `doubao-seedance-2-0-fast-260128` (env override via `SEEDANCE_MODEL` / `AIGC_VIDEO_MODEL`).

## ByteDance Seedream (Volcengine)

Official page: `https://seed.bytedance.com/en/seedream4_0`

Relevant capability summary:

- Unified image generation and image editing architecture.
- Useful for static background fill, poster/cover generation, CTA cards, and visual material补全.

Wired in code today:

- Implemented provider id is `volcengine_seedream`, used as an optional image-fill backup.
- There is no hardcoded default image model: the model id must be supplied via `SEEDREAM_ARK_MODEL` or `AIGC_IMAGE_MODEL`, otherwise config resolution throws.
- The actual primary image-fill provider is `google_gemini_image` (default `gemini-2.5-flash-image`, "Nano Banana"); Seedream is the fallback.

## ElevenLabs

Official API page: `https://elevenlabs.io/api`

Relevant capability summary:

- Voice, music, sound effects, dubbing, and transcription APIs.
- Scribe STT is useful for transcript, word timestamps, diarization/audio event metadata.
- TTS/SFX/Music are useful for voiceover, whoosh/hit/riser, and BGM.

Wired in code today:

- Scribe ASR, TTS, SFX, Music, Audio Isolation, and Forced Alignment are wired through `apps/api/src/adapters/elevenlabs.ts`.
- Scribe (`elevenlabs_scribe`) is the default ASR primary, with `faster-whisper` as the local fallback.
- Dubbing / Lip Sync are NOT implemented (reserved ModelTask only; no adapter method).

## Gemini

Official model card: `https://deepmind.google/models/model-cards/gemini-3-1-pro/`

Relevant capability summary:

- Multimodal reasoning over text, audio, images, video, and code repositories.
- Good fit for frame-sheet understanding, structure interpretation, and visual reasoning.

Wired in code today:

- VLM adapter default model is `gemini-2.5-flash`; the `VLM_MODEL` env default is `gemini-2.5-pro`.
- Text LLM default is `gemini-flash-latest`.
- Native image generation default is `gemini-2.5-flash-image` ("Nano Banana"), the primary image-fill provider.
- "Gemini 3.1 Pro" is a forward-looking reference, not a model id wired in code.

## Notes

- These are volatile provider choices. Keep adapters behind interfaces.
- Keep fallback paths local and deterministic.
- Do not put API keys in the spec package.
