# Model Candidate Matrix

Generated: 2026-06-01

Sources were restricted to official docs, official GitHub repos/model cards, or papers where possible. Items with incomplete verification are marked TODO.

## Matrix

| Task | Current | Candidate | Pros | Cons | Required for core? | Optional? | Local fallback | Safety risk | Priority | Confidence | Sources/TODO |
|---|---|---|---|---|---|---|---|---|---|---|---|
| video_structure_vlm | Gemini VLM adapter optional | current Gemini VLM | Implemented; strong video understanding path | Uploads sample video externally when enabled; key required | no | yes | heuristic/frame sheet | sample media external analysis | P1 | high | https://ai.google.dev/gemini-api/docs/video-understanding |
| video_structure_vlm | Gemini VLM adapter optional | Gemini latest Pro multimodal | Better temporal/reasoning candidate | Must verify account/model id/cost | no | yes | heuristic/frame sheet | sample media external analysis | P1 | medium | https://ai.google.dev/gemini-api/docs/models |
| video_structure_vlm | none | Qwen3-VL | Open-weight; video/OCR/grounding capabilities; self-host path possible | Large models/GPU burden; no dependency added now | no | yes | heuristic/frame sheet | local sample analysis if self-hosted | P1 | high | https://github.com/QwenLM/Qwen3-VL |
| video_structure_vlm | none | Doubao multimodal | China-region candidate, Ark-compatible direction | Exact model ids/video behavior not verified | no | yes | heuristic/frame sheet | sample media external analysis | P2 | low | TODO |
| video_structure_vlm | heuristic adapter | heuristic frame-sheet summarizer | Offline, deterministic, no keys | Limited semantic precision | yes | no | n/a | local sample analysis only | P0 | high | local repo |
| text_planning_llm | Gemini/OpenAI-compatible/Ark adapter | current Gemini text adapter | Already implemented; text-only planning | Key required for LLM path | no | yes | deterministic planner | prompt leakage if not linted | P1 | high | local repo; https://ai.google.dev/gemini-api/docs/models |
| text_planning_llm | OpenAI-compatible adapter | OpenAI-compatible endpoint | Flexible endpoint wiring | Quality varies by provider | no | yes | deterministic planner | text-only | P1 | medium | local repo |
| text_planning_llm | Ark/Doubao path | Ark/Doubao endpoint | Existing env shape | Must verify current model id/JSON reliability | no | yes | deterministic planner | text-only | P2 | low | TODO |
| text_planning_llm | none | Qwen text models | Local/cloud candidate; Chinese strong | Not wired; model choice needs verification | no | yes | deterministic planner | text-only | P2 | medium | https://github.com/QwenLM/Qwen3-VL |
| text_planning_llm | deterministic planner | deterministic baseline fallback | Core reliable path; no cloud | Lower semantic flexibility | yes | no | n/a | no external media | P0 | high | local repo |
| asr | faster-whisper adapter | faster-whisper | Local reproducible ASR baseline | Model/package may be missing; limited diarization | yes | no | no_asr_with_warning | local sample audio only | P0 | high | https://github.com/SYSTRAN/faster-whisper |
| asr | none | ElevenLabs Scribe/Scribe realtime | Word timestamps, diarization, event tags | Cloud cost; sample/source audio upload | no | yes | faster-whisper/no_asr | external audio upload | P2 | high | https://elevenlabs.io/docs/capabilities/speech-to-text |
| asr | none | Deepgram Nova | Mature cloud STT | Cloud cost; source audio upload | no | yes | faster-whisper/no_asr | external audio upload | P2 | high | https://developers.deepgram.com/docs/models-languages-overview/ |
| asr | none | OpenAI-compatible transcription | Flexible if already configured | Not wired; cloud upload | no | yes | faster-whisper/no_asr | external audio upload | P2 | medium | https://platform.openai.com/docs/guides/speech-to-text |
| asr | disabled adapter | no_asr_with_warning | Honest no-cloud fallback | No transcript | yes | no | n/a | none | P0 | high | local repo |
| ocr | EasyOCR adapter | EasyOCR | Already supported; local | Simple adapter lacks bbox; package may be missing | yes | no | no_ocr_with_warning | local sample pixels | P0 | high | local repo |
| ocr | none | PaddleOCR / PaddleOCR-VL | Strong multilingual/document OCR; bbox/layout path | Heavy dependency; install risk | no | yes | EasyOCR/no_ocr | local sample pixels | P1 | high | https://github.com/PaddlePaddle/PaddleOCR |
| ocr | none | Qwen-VL OCR verifier | Handles hard stylized OCR cases | VLM cost/GPU; coordinates can hallucinate | no | yes | EasyOCR/no_ocr | sample media if external | P2 | high | https://github.com/QwenLM/Qwen3-VL |
| ocr | disabled adapter | no_ocr_with_warning | Honest fallback | Text layout evidence degraded | yes | no | n/a | none | P0 | high | local repo |
| visual_grounding | OpenCV/flow heuristics | current heuristics | Implemented, local, deterministic | Weak hero/ribbon/media-card localization | yes | no | heuristic_bbox | local sample pixels | P0 | high | local repo |
| visual_grounding | none | GroundingDINO | Open-set text-guided boxes | Heavy dependency; image-first | no | yes | heuristic_bbox | local sample pixels | P1 | high | https://github.com/IDEA-Research/GroundingDINO |
| visual_grounding | none | SAM2 | Video/image masks and tracking prompt support | Needs detector/prompts; GPU burden | no | yes | heuristic_bbox | local sample pixels | P1 | high | https://ai.meta.com/sam2/ |
| visual_grounding | none | Grounded-SAM2 | Combined grounding + masks/tracks | Integration complexity; some variants API-token gated | no | yes | heuristic_bbox | local sample pixels | P2 | high | https://github.com/IDEA-Research/Grounded-SAM-2 |
| visual_grounding | none | CoTracker/CoTracker3 | Point tracking for motion transfer | Needs robust initial points; GPU burden | no | yes | heuristic_bbox | local sample pixels | P1 | high | https://github.com/facebookresearch/co-tracker |
| visual_grounding | none | Qwen-VL verifier | Semantic verification for boxes/OCR | Coordinates may hallucinate; external upload if cloud | no | yes | heuristic_bbox | sample media external if cloud | P2 | high | https://github.com/QwenLM/Qwen3-VL |
| image_fill | deterministic local provider | deterministic_local_image_fill | Offline, provenance-labeled, no fake external claim | Visual quality is procedural | no | yes | remotion_shape_card | no sample refs | P0 | high | local repo |
| image_fill | optional provider | Seedream | Strong image generation candidate; Ark API docs | Paid/cloud; must keep sample refs blocked | no | yes | deterministic local | AIGC sample-copy risk if misconfigured | P1 | high | https://www.volcengine.com/docs/82379/1824692 |
| image_fill | optional provider | Gemini image / Nano Banana | Already partially implemented; image/text prompt path | Paid/cloud; text/layout limits | no | yes | deterministic local | AIGC sample-copy risk if misconfigured | P1 | high | https://ai.google.dev/gemini-api/docs/image-generation |
| image_fill | none | GPT Image | Strong text/render/editing candidate | Paid/cloud; org verification may apply | no | yes | deterministic local | AIGC sample-copy risk if misconfigured | P2 | high | https://platform.openai.com/docs/guides/image-generation |
| image_fill | none | local FLUX / ComfyUI | Local/high control if already installed | Not present/verified; heavy weights | no | yes | deterministic local | local only if self-hosted | P2 | low | TODO |
| image_fill | Remotion | Remotion procedural card/poster | Fully local renderer fallback | Limited visual diversity | yes for fallback | no | n/a | none | P0 | high | local repo |
| video_fill | procedural motion | Seedance 2.0 | Strong optional video-fill candidate; reference modes | Paid/cloud; sample refs forbidden by default in this repo | no | yes | Remotion/FFmpeg | AIGC sample-copy risk if misconfigured | P1 | high | https://www.volcengine.com/docs/82379/1393047 |
| video_fill | none | Veo | Official Gemini API video generation | Paid/cloud; cost/latency unknown | no | yes | Remotion/FFmpeg | AIGC sample-copy risk if misconfigured | P2 | high | https://ai.google.dev/gemini-api/docs/video |
| video_fill | none | Runway | Official API available; image/text to video | Paid/cloud; limits/cost must be verified | no | yes | Remotion/FFmpeg | AIGC sample-copy risk if misconfigured | P2 | medium | https://docs.dev.runwayml.com/guides/models/ |
| video_fill | none | Kling | Strong video generation candidate | Official API details not fully verified | no | yes | Remotion/FFmpeg | AIGC sample-copy risk if misconfigured | P2 | low | TODO |
| video_fill | Remotion/FFmpeg | local/procedural Remotion motion | Core demo path; deterministic | Similar outputs if motif transfer is weak | yes | no | n/a | none | P0 | high | local repo |
| audio_generation | procedural synth | current procedural synth | Offline, deterministic | Same/limited BGM/SFX | yes for fallback | no | n/a | none | P0 | high | local repo |
| audio_generation | none | ElevenLabs Music | Text-to-music API candidate | Paid/cloud; music terms/provenance needed | no | yes | skip_with_warning | generated audio provenance | P2 | medium | https://elevenlabs.io/music-api |
| audio_generation | none | ElevenLabs Sound Effects | SFX from text; duration control | Paid/cloud | no | yes | skip_with_warning | generated audio provenance | P2 | high | https://elevenlabs.io/docs/capabilities/sound-effects/ |
| audio_generation | none | ElevenLabs TTS | Mature voiceover path | Voice/consent/commercial policy required | no | yes | skip_with_warning | generated audio provenance | P2 | high | https://elevenlabs.io/docs/api-reference/text-to-speech |
| audio_generation | none | ElevenLabs Audio Isolation | Cleanup candidate | Uploads user/source audio; not generation alone | no | yes | skip_with_warning | external audio upload | P3 | medium | https://elevenlabs.io/docs/overview/intro |
| audio_generation | none | ElevenLabs Dubbing/Lip Sync | Localization/lip-sync candidate | Uploads media; complex rights | no | yes | skip_with_warning | external media upload | P3 | medium | https://elevenlabs.io/docs/api-reference/create-dub |
| knowledge_retrieval | deterministic atom filtering | keyword/BM25 | Fast local baseline | Lexical only | no | yes | no_retrieval | none | P0 | high | https://lucene.apache.org/core/9_8_0/core/org/apache/lucene/search/similarities/BM25Similarity.html |
| knowledge_retrieval | none | BGE-M3 | Multilingual dense/sparse/ColBERT retrieval | Adds model dependency; GPU/CPU benchmark needed | no | yes | keyword | local text only | P1 | high | https://huggingface.co/BAAI/bge-m3 |
| knowledge_retrieval | none | Gemini embeddings | Managed embedding API | Cloud cost; sends text evidence | no | yes | keyword | text evidence external | P2 | high | https://ai.google.dev/gemini-api/docs/embeddings |
| knowledge_retrieval | none | Voyage/OpenAI-compatible embeddings | Strong hosted retrieval options | Cloud cost; provider-specific | no | yes | keyword | text evidence external | P2 | high | https://docs.voyageai.com/docs/embeddings |
| quality_judge | deterministic gates | deterministic gates | Core offline safety/quality checks | Limited semantic judgment | yes | no | n/a | local output/sample analysis | P0 | high | local repo |
| quality_judge | optional script | Gemini VLM judge | Can compare visual outputs | Uploads output frames; sample frames gated | no | yes | deterministic gates | sample-frame external risk | P1 | high | https://ai.google.dev/gemini-api/docs/video-understanding |
| quality_judge | optional text LLM | text LLM rubric judge | Good for prompt leakage/report reasoning | Cannot see pixels unless given summaries | no | yes | deterministic gates | text-only | P2 | medium | local repo |
| quality_judge | none | pairwise judge | Useful for A/B route selection | Needs artifact design | no | yes | deterministic gates | output/sample policy | P2 | low | TODO |
| quality_judge | none | no_cloud_judge | Honest offline fallback | No semantic VLM judgment | yes | no | n/a | none | P0 | high | local repo |

## Recommended route tiers

| Tier | Recommendation |
|---|---|
| P0 required | Keep FFmpeg + Remotion core renderer, deterministic planner, local evidence analyzer, current offline route evaluator, deterministic quality gates, procedural/local fallbacks, and explicit no-ASR/no-OCR warnings. |
| P1 strong optional | Add visual grounding abstraction before heavy dependencies; evaluate PaddleOCR/PaddleOCR-VL, GroundingDINO, SAM2, CoTracker, BGE-M3/BM25, Seedance 2.0 video fill, Seedream/Gemini image fill, Gemini VLM judge with policy gates. |
| P2 experimental | Runway, Veo, GPT Image, Doubao multimodal, Qwen-VL verifier, Gemini embeddings, Voyage/OpenAI-compatible embeddings, ElevenLabs audio generation stack. |
| Defer / do not use yet | Any provider that requires sample frames/audio as AIGC generation references; any provider that cannot provide route records/provenance; any heavy local model without dependency and performance verification. |

Expected shape:

- Keep Remotion + FFmpeg as core renderer.
- Keep faster-whisper local as ASR baseline, with `no_asr_with_warning` fallback.
- Keep EasyOCR fallback; consider PaddleOCR/PaddleOCR-VL after dependency verification.
- Add a visual grounding abstraction before GroundingDINO/SAM2/CoTracker dependencies.
- Add ElevenLabs only as optional audio intelligence.
- Add Seedance 2.0 only as optional `video_fill`.
- Add Seedream/image providers only as optional `image_fill`.
- Add BGE-M3 or BM25 for TechniqueAtom retrieval while keeping keyword fallback.

