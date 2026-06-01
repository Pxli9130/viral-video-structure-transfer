# Model Source Notes

These references are for provider selection only. The system should not rely on any single online provider for the core demo.

## ByteDance Seedance 2.0

Official page: `https://seed.bytedance.com/en/seedance2_0`

Relevant capability summary:

- Unified multimodal audio-video generation architecture.
- Supports text, image, audio, and video inputs.
- Useful for optional moving visual fill, product-in-motion inserts, moving backgrounds, and transition clips.

## ByteDance Seedream 4.0

Official page: `https://seed.bytedance.com/en/seedream4_0`

Relevant capability summary:

- Unified image generation and image editing architecture.
- Useful for static background fill, poster/cover generation, CTA cards, and visual material补全.

## ElevenLabs

Official API page: `https://elevenlabs.io/api`

Relevant capability summary:

- Voice, music, sound effects, dubbing, and transcription APIs.
- Scribe STT is useful for transcript, word timestamps, diarization/audio event metadata.
- TTS/SFX/Music are useful for voiceover, whoosh/hit/riser, and BGM.

## Gemini 3.1 Pro

Official model card: `https://deepmind.google/models/model-cards/gemini-3-1-pro/`

Relevant capability summary:

- Multimodal reasoning over text, audio, images, video, and code repositories.
- Good fit for frame-sheet understanding, structure interpretation, and visual reasoning.

## Notes

- These are volatile provider choices. Keep adapters behind interfaces.
- Keep fallback paths local and deterministic.
- Do not put API keys in the spec package.
