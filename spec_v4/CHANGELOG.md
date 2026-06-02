# CHANGELOG

## v4.1 latest-only package

- Created a standalone latest-version package.
- Removed old `spec_v3` and separate `spec_v4` folders from the deliverable.
- Integrated the v4 base architecture with the v4.1 provider/model updates.
- Added Seedance 2.0 as optional video-fill provider.
- Added Volcengine Seedream as optional image/poster/cover provider (model id env-driven via SEEDREAM_ARK_MODEL/AIGC_IMAGE_MODEL; no hardcoded default).
- Added ElevenLabs audio stack: Scribe ASR, TTS, SFX, Music, Audio Isolation, Forced Alignment (Dubbing/Lip Sync reserved as a ModelTask only, no adapter).
- Added provider policy, routing/fallback, generated provenance, and acceptance gates.

> Note: this spec package is labeled v4.1, while the runtime typed model-router summary literal is `model-router-v4.2` (`router.ts:385`, `types.ts:180`).
