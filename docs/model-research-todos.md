# Model Research TODOs

This file lists candidate claims that were not fully verified from primary official documentation during Phase 1-2. Do not implement these as hard dependencies until verified.

| Area | TODO |
|---|---|
| Doubao multimodal VLM | Verify the current Ark/Doubao multimodal model ids, JSON mode behavior, video input support, and sample-media data policy from official Volcengine docs. |
| Kling API | Verify official API endpoint, terms, pricing, duration limits, and whether `kling.art` docs map to a stable production API. |
| FLUX / ComfyUI local | Check whether this repo already has a local ComfyUI/FLUX install before recommending it as anything beyond optional. |
| Runway | Verify current model ids, price, video duration limits, and commercial terms from Runway API docs before wiring. |
| Gemini latest Pro multimodal | Re-check the currently available Gemini Pro model id in the user's API account before changing defaults. |
| PaddleOCR-VL | Verify current package/model install path and GPU/CPU requirements before adding dependencies. |
| GroundingDINO/SAM2/CoTracker | Benchmark local GPU/CPU cost on target machine before any production dependency. |
| ElevenLabs Music/SFX/TTS/Dubbing/Lip Sync | Verify endpoint availability on the user's plan and generated-asset provenance fields before provider implementation. |

