# Spec v4.2 Phase 0 Model Surface Audit

Generated: 2026-06-01

Scope: local repository audit only. No implementation changes, no model calls, no network calls, and no external provider usage were performed for this audit.

## Preflight

Required local inspection commands were run before this file was created:

| Command | Result |
|---|---|
| `pwd` | `/home/pxli/viral-video-structure-transfer` |
| `git status --short` | Dirty worktree with existing app/shared/docs/scripts/spec changes. This audit does not revert or normalize them. |
| `find . -maxdepth 4 -iname "AGENTS.md" -o -iname "package.json" -o -iname "SPEC_V4_1_ALL.md" -o -iname "model-stack.md" -o -iname "provider-policy.md"` | No root `AGENTS.md` found. `spec_v4/SPEC_V4_1_ALL.md`, `spec_v4/model-stack.md`, and `spec_v4/provider-policy.md` exist. Workspace package files exist under `apps/*` and `packages/*`. |
| `cat package.json` | npm workspace repo with scripts for API/web/dev/test/render/eval/demo/learn gates. |
| `find apps packages scripts -maxdepth 3 -name package.json -print` | `apps/web/package.json`, `apps/api/package.json`, `packages/renderer/package.json`, `packages/shared/package.json`. |

Spec path note: the checked-in spec directory is `spec_v4/`; this repo does not currently contain a `spec_v4_1_latest/` directory.

## Short Local Plan

Current model/adapters found:

| Area | Current implementation |
|---|---|
| Video metadata/keyframes | `FFmpegVideoToolAdapter` in `apps/api/src/adapters/index.ts`; Python helpers `ffprobe_metadata.py` and `extract_keyframes.py`. |
| Evidence timeline | `apps/api/src/adapters/evidenceTimeline.ts` calls `scripts/analyze-evidence-timeline.py` with the conda Python environment. |
| VLM video understanding | Optional `GeminiVLMAdapter` via `VLM_PROVIDER=gemini` plus `GEMINI_API_KEY`; heuristic adapter via `VLM_PROVIDER=heuristic`; otherwise disabled. |
| Text planning / revision / scoring / subtitles | `GeminiAIAdapter` or `OpenAICompatibleAIAdapter` selected by `AI_PROVIDER`; deterministic fallback paths inside `openaiCompatible.ts` and planner code. |
| ASR | Optional `FasterWhisperASRAdapter` via `ASR_PROVIDER=faster_whisper`; otherwise disabled. |
| OCR | Optional `EasyOCRAdapter` via `OCR_PROVIDER=easyocr`; Python evidence analyzer also has local EasyOCR-assisted typography extraction when available. |
| Visual grounding | Local OpenCV/PySceneDetect/optical-flow/OCR heuristics in `scripts/analyze-evidence-timeline.py`; no production GroundingDINO/SAM2/CoTracker adapter found. |
| AIGC material fill | `packages/shared/src/engine/aigcMaterialPlanner.ts`, `aigcMaterialProviders.ts`, `aigcMaterialQualityGate.ts`; deterministic local provider is now `deterministic_local_image_fill` with deprecated `mock_provider` alias; external image providers are opt-in only. |
| Provider policy | `packages/shared/src/engine/providerPolicy.ts`; coarse task router for generation/audio/ASR categories, not the requested v4.2 task router. |
| Render backbone | Remotion + FFmpeg remain the actual render paths in `apps/api/src/adapters/renderers.ts` and `apps/api/remotion/ViralRecipeRoot.tsx`. |

Current scripts found:

| Script | Purpose |
|---|---|
| `scripts/analyze-evidence-timeline.py` | Scene, motion, typography, audio, beat, OCR/ASR-assisted evidence extraction. |
| `scripts/python/asr_faster_whisper.py` | Local faster-whisper wrapper; outputs empty transcript on unavailable/failure paths. |
| `scripts/python/ocr_easyocr.py` | Local EasyOCR wrapper; outputs empty OCR rows on unavailable/failure paths. |
| `scripts/evaluate-model-understanding.mjs` | Current provider comparison harness for evidence-first understanding; not a v4.2 route matrix harness. |
| `scripts/evaluate-render-quality.mjs` | Render/sample structural and motion/audio quality gates. |
| `scripts/evaluate-final-gates.mjs` | Final artifact gate report for demo/learn outputs. |
| `scripts/vlm-judge-video.mjs` | Optional Gemini VLM judge; sends extracted sample/output frames when `GEMINI_API_KEY` is set. |
| `scripts/inspect-learning-fidelity.mjs` | Checks evidence transfer through analysis/template/timeline/recipe. |
| `scripts/run-demo-final.mjs`, `scripts/run-learn-samples.mjs`, `scripts/run-learn-samples-max.mjs` | Demo and sample-learning artifact runners. |

Likely later files to touch after Phase 0:

| Future phase | Likely files |
|---|---|
| ModelTask types and route decisions | `packages/shared/src/types.ts`, `packages/shared/src/schemas.ts`, `packages/shared/src/validation.ts`, new shared router module. |
| Adapter routing | `apps/api/src/adapters/index.ts`, `apps/api/src/server.ts`, possibly new `apps/api/src/adapters/modelRouter.ts`. |
| Provider policy expansion | `packages/shared/src/engine/providerPolicy.ts`, provider-policy tests. |
| RenderRecipe lint / gate integration | `packages/shared/src/engine/renderRecipeV41.ts`, `scripts/evaluate-final-gates.mjs`, new route evaluation script. |
| Docs | `spec_v4/` or `docs/` model stack/provider policy updates. |

Risks and gaps:

| Risk | Current evidence |
|---|---|
| No unified v4.2 router | Provider choice is split across `AI_PROVIDER`, `VLM_PROVIDER`, `ASR_PROVIDER`, `OCR_PROVIDER`, AIGC controls, and `providerPolicy.ts`. |
| Spec docs include target-state models | `spec_v4/model-stack.md` lists desired models/providers that are not all implemented locally. |
| Cloud VLM can consume sample pixels/audio | `GeminiVLMAdapter.describeVideo` uploads the sample video to Gemini when enabled. This is separate from AIGC generation, but it is still an external sample-media call. |
| Optional VLM judge can upload sample/output frames | `scripts/vlm-judge-video.mjs` sends extracted frames to Gemini when `GEMINI_API_KEY` is set. |
| ASR/OCR fallbacks are not centrally recorded | Missing local dependencies often produce disabled or empty output rather than a task-level `ProviderDecision`. |
| External image AIGC is guarded but not centrally routed by v4.2 task ids | Seedream/Gemini image providers require opt-in and reject sample frames, but route records are material-fill specific. |
| "mock_provider" name is misleading | It generates deterministic local files with provenance. v4.2 keeps it only as a deprecated alias for `deterministic_local_image_fill`. |

Tests to add later:

| Test/gate | Purpose |
|---|---|
| `evaluate-model-routes --offline` | Prove every ModelTask has a provider decision and deterministic fallback without keys/network. |
| Router unit tests | Verify env-gated provider selection, fallback reasons, and no silent provider substitution. |
| Safety tests | Prove sample frames/audio are never sent to AIGC generation providers and provider records state this. |
| Route artifact tests | Verify `GenerationResult`, reports, and RenderRecipe carry route/provenance/fallback summaries. |
| ASR/OCR/VLM disabled tests | Verify disabled/unavailable local tools produce explicit fallback records. |
| RenderRecipe lint tests | Verify route/fallback decisions cannot pass with missing evidence/provenance/fallback reason. |

## Model Task Summary

| Task | Current model/tool | Current files | Output | Failure mode | Better candidate? | Priority |
|---|---|---|---|---|---|---|
| `video_structure_vlm` | Optional Gemini VLM; optional heuristic VLM; local evidence analyzer is always earlier in pipeline | `apps/api/src/adapters/gemini.ts`, `apps/api/src/adapters/index.ts`, `apps/api/src/server.ts`, `scripts/analyze-evidence-timeline.py` | `VLMVideoAnalysis`, merged into `VideoAnalysisResult` and `StructureTemplate` | Disabled without provider/env; Gemini failure becomes job warning and deterministic template continues | Phase 1 evidence required; current highest gap is route accounting and sample-media policy clarity | P0 |
| `text_planning_llm` | Gemini text LLM, OpenAI-compatible LLM, Ark/Doubao OpenAI-compatible endpoint, deterministic planner fallback | `apps/api/src/adapters/geminiAi.ts`, `apps/api/src/adapters/openaiCompatible.ts`, `packages/shared/src/engine/planner.ts`, `naturalLanguageEdit.ts` | `StructureTemplate` enrichment, edit plans, subtitles, scorecard dimensions | Missing key/provider falls back to baseline/heuristic; malformed JSON is ignored or sanitized | Phase 1 evidence required; current priority is separating planning, linting, subtitle, judge routes | P0 |
| `asr` | Local faster-whisper only when enabled | `apps/api/src/adapters/index.ts`, `scripts/python/asr_faster_whisper.py`, `scripts/analyze-evidence-timeline.py` | `TranscriptSegment[]`, transcript evidence | Disabled by default; missing dependency/failure often returns empty transcript | Faster local models may improve quality, but router/fallback record is the urgent gap | P1 |
| `ocr` | Local EasyOCR adapter and EasyOCR-assisted evidence analyzer | `apps/api/src/adapters/index.ts`, `scripts/python/ocr_easyocr.py`, `scripts/analyze-evidence-timeline.py` | OCR rows, typography evidence, bbox/font-size/color/animation hints | Disabled/missing dependency returns empty rows; simple adapter loses bbox | Better OCR/bbox stack requires Phase 1 research; immediate gap is preserving bbox/animation through render | P0 |
| `visual_grounding` | OpenCV, PySceneDetect, optical flow, OCR-derived boxes, heuristic visual element graph | `scripts/analyze-evidence-timeline.py`, `packages/shared/src/engine/planner.ts`, `atomExtractor.ts`, `renderRecipeV41.ts` | `visualElementGraph`, `heroDescriptor`, motion atoms, geometry evidence | Heuristic boxes can be wrong; advanced tracker is not implemented beyond availability probes | Phase 1 should evaluate grounding/tracking candidates; current code needs honest route labels | P0 |
| `audio_analysis` | FFmpeg/FFprobe + librosa local analysis | `scripts/analyze-evidence-timeline.py`, `apps/api/src/adapters/evidenceTimeline.ts`, `packages/shared/src/engine/planner.ts` | Beat grid, audio structure, layer estimates, timing cues | Missing audio/libs gives empty/no-audio evidence; BGM reuse is restricted by policy | Better beat/source-separation candidates are Phase 1; current priority is route/fallback visibility | P1 |
| `image_fill` | Deterministic local generated image provider; optional Seedream/Gemini image providers with explicit external opt-in | `aigcMaterialPlanner.ts`, `aigcMaterialProviders.ts`, `aigcMaterialQualityGate.ts`, `apps/api/src/server.ts` | `GeneratedAssetCandidate[]`, target assets, media layers with provenance | Disabled unless requested; external providers fail without keys; bad candidates are blocked by quality gate | Current provider names/policies need v4.2 route normalization; model candidates require Phase 1 | P1 |
| `video_fill` | No real external video generation provider; procedural/Remotion/FFmpeg fill and disabled Seedance stub | `packages/shared/src/engine/planner.ts`, `apps/api/src/adapters/renderers.ts`, `providerPolicy.ts` | Procedural or proxy moving material, gap/fill actions | Missing moving material stays procedural/proxy; Seedance is policy-only/stub path | High need for real provider decision, but core demo must remain local/deterministic | P1 |
| `audio_generation` | Local FFmpeg/procedural audio plan; ElevenLabs entries are policy-only optional providers | `packages/shared/src/engine/planner.ts`, `apps/api/src/adapters/renderers.ts`, `providerPolicy.ts` | Audio plan/layers, synthesized BGM/SFX/voice-like local paths depending renderer | Limited variety; no real music/TTS/SFX provider implementation found | Phase 1 should research, but local fallback must stay first-class | P2 |
| `knowledge_retrieval` | In-memory/database KB surfaces and deterministic atom/filter logic | `apps/api/src/server.ts`, `packages/shared/src/engine/atomExtractor.ts`, `packages/shared/src/engine/planner.ts`, `docs/architecture.md` | Templates, TechniqueAtoms, evidence reports, filtered KB views | No vector/BM25 retrieval route found; quality depends on deterministic atom extraction | Phase 1 should define whether retrieval is required before adding model deps | P2 |
| `quality_judge` | Deterministic gates plus optional LLM scorecard and optional Gemini VLM judge script | `scripts/evaluate-render-quality.mjs`, `scripts/evaluate-final-gates.mjs`, `scripts/inspect-learning-fidelity.mjs`, `scripts/vlm-judge-video.mjs`, `openaiCompatible.ts`, `server.ts` | Gate report, scorecard, VLM judge JSON, fidelity report | Optional judge skipped without key; VLM judge uploads frames when enabled; deterministic gates do not judge all semantics | Needs v4.2 route records and offline judge baseline before model upgrades | P0 |
| `code/debug agent usage` | External development workflow through Codex/user; no runtime model adapter | `spec_v4/codex-prompts.md`, repo docs/tests/scripts | Code/doc/test changes, debugging notes | Not represented as a product ModelTask; cannot be audited from runtime artifacts | Keep outside runtime router unless automation is explicitly added | P3 |

## Detailed Task Inventory

### `video_structure_vlm`

| Field | Current state |
|---|---|
| Current implementation | API analysis job runs FFmpeg/keyframes and local evidence extraction first. If configured, VLM analysis is then invoked and merged into source understanding/template extraction. |
| Files/functions | `apps/api/src/server.ts` `runAnalysisJob`; `apps/api/src/adapters/index.ts` `buildAdapters`; `apps/api/src/adapters/gemini.ts` `GeminiVLMAdapter.describeVideo`; `packages/shared/src/engine/planner.ts` `buildFallbackTemplate`, `detectVideoType`, `summariseVlm`. |
| Input schema | `Asset` video path plus optional evidence context; `StructureExtractionRequest` can include `vlm`. |
| Output schema | `VLMVideoAnalysis`, then `VideoAnalysisResult`/`StructureTemplate`. |
| Provider/model | `VLM_PROVIDER=gemini` uses Gemini with `VLM_MODEL` defaulting to `gemini-2.5-flash`; `VLM_PROVIDER=heuristic` uses local heuristic; otherwise disabled. |
| Cloud required? | No for core flow. Yes only for Gemini VLM. |
| Deterministic/local? | Local evidence and heuristic VLM are deterministic enough for offline fallback; Gemini is not deterministic. |
| Consumes sample pixels/audio? | Yes when Gemini VLM is enabled: the adapter uploads the sample/source video bytes. Local evidence consumes sample pixels/audio locally. |
| Can affect final pixels? | Yes indirectly through video type, segments, slots, visual style, technique atoms, and RenderRecipe choices. |
| Current fallback | Disabled/heuristic VLM plus deterministic `buildFallbackTemplate`; Gemini failures are surfaced as warnings/job failed step and pipeline continues. |
| Tests/gates | Existing model-eval script, planner tests, render/fidelity gates. No v4.2 route decision test. |
| Failure mode | External sample-media upload can violate stricter policy if not explicitly allowed; disabled path can silently reduce structure understanding. |

### `text_planning_llm`

| Field | Current state |
|---|---|
| Current implementation | OpenAI-compatible adapter builds deterministic baseline first, then optionally enriches template/revision/scorecard/subtitles through text LLM. Gemini text adapter wraps this OpenAI-compatible path. |
| Files/functions | `apps/api/src/adapters/openaiCompatible.ts` `extractStructure`, `reviseInstruction`, `judgeGeneration`, `generateSubtitles`; `apps/api/src/adapters/geminiAi.ts`; `apps/api/src/adapters/index.ts`; `packages/shared/src/engine/planner.ts`; `naturalLanguageEdit.ts`. |
| Input schema | `StructureExtractionRequest`, `GenerationResult`, natural language instruction strings, subtitle generation input. |
| Output schema | `StructureTemplate`, revision controls/patches, `ScorecardResult`, generated subtitle cues. |
| Provider/model | `AI_PROVIDER=gemini` default; `AI_PROVIDER=openai_compatible`; `AI_PROVIDER=ark_doubao`. Models are env-driven. |
| Cloud required? | No. Baseline/heuristic paths operate without keys. |
| Deterministic/local? | Baseline template, heuristic edit parser, gap/fill/timeline/render recipe are deterministic local paths. |
| Consumes sample pixels/audio? | No direct pixel/audio upload in text planner; it consumes text summaries/evidence objects. |
| Can affect final pixels? | Yes, through template enrichment, controls, subtitle text, edit plans, and scorecards that may guide acceptance. |
| Current fallback | Baseline template, heuristic revise parser, deterministic scorecard/subtitle fallback logic in API. |
| Tests/gates | `mockPipeline.test.ts`, natural language edit/version tests, scorecard endpoint behavior. No per-task router tests. |
| Failure mode | LLM tasks are not separated; structure planning, subtitle generation, judge, lint/reasoning share broad adapter paths. |

### `asr`

| Field | Current state |
|---|---|
| Current implementation | Optional faster-whisper adapter selected only by `ASR_PROVIDER=faster_whisper`; evidence analyzer can also run ASR when requested. |
| Files/functions | `apps/api/src/adapters/index.ts` `FasterWhisperASRAdapter`; `scripts/python/asr_faster_whisper.py`; `scripts/analyze-evidence-timeline.py`. |
| Input schema | `Asset` with local media path. |
| Output schema | `TranscriptSegment[]` with start/end/text/confidence. |
| Provider/model | Local faster-whisper; model selected by `ASR_MODEL`, default `tiny`. |
| Cloud required? | No. |
| Deterministic/local? | Local, but model output can vary by installed model/runtime. |
| Consumes sample pixels/audio? | Consumes audio locally. |
| Can affect final pixels? | Indirectly; transcript density and subtitle evidence affect gaps, text layers, and layout. |
| Current fallback | Disabled adapter returns empty transcript. Python wrapper also returns empty list if dependency/model execution fails. |
| Tests/gates | Transcript/gap behavior is covered indirectly; no explicit route/fallback artifact test. |
| Failure mode | Empty transcript can look like valid "no speech" unless route/fallback reason is recorded. |

### `ocr`

| Field | Current state |
|---|---|
| Current implementation | Optional EasyOCR adapter for keyframes; evidence analyzer performs OCR-assisted typography extraction when EasyOCR is available. |
| Files/functions | `apps/api/src/adapters/index.ts` `EasyOCRAdapter`; `scripts/python/ocr_easyocr.py`; `scripts/analyze-evidence-timeline.py`; `packages/shared/src/engine/renderRecipeV41.ts`. |
| Input schema | Keyframe image paths or analyzer frame extracts. |
| Output schema | OCR rows/text, `typographyEvidence`, bbox/font-size/color-role/animation hints where available. |
| Provider/model | Local EasyOCR. |
| Cloud required? | No. |
| Deterministic/local? | Local; OCR confidence varies by model/runtime. |
| Consumes sample pixels/audio? | Consumes sample/source frames locally. |
| Can affect final pixels? | Yes, directly through text layer bbox, font-size ratio, layout role, color role, and animation hint. |
| Current fallback | Disabled adapter or empty OCR rows; RenderRecipe migration has fallback text bbox/animation when evidence is missing. |
| Tests/gates | `renderRecipeV41.test.ts`, final gates `G11`, render-quality `v3_typography_layout_used`. |
| Failure mode | Simple OCR adapter output lacks bbox; typography evidence may be dropped or generalized before render. |

### `visual_grounding`

| Field | Current state |
|---|---|
| Current implementation | Local heuristics detect scene families, moving candidates, text boxes, hero descriptors, trajectories, and motion atoms from frames/flow/OCR. |
| Files/functions | `scripts/analyze-evidence-timeline.py`; `packages/shared/src/engine/planner.ts` `attachEvidenceToTemplate`, `evidenceMotionAtomsFromAnalysis`; `atomExtractor.ts`; `renderRecipeV41.ts`. |
| Input schema | Extracted frames, scene cuts, optical flow, OCR rows, metadata. |
| Output schema | `visualElementGraph`, `heroDescriptor`, `motionAtoms`, geometry evidence, `TechniqueAtom[]`. |
| Provider/model | OpenCV/PySceneDetect/optical-flow heuristics. Script checks heavy analyzer availability for `sam2` only; no full grounding/tracking provider was found. |
| Cloud required? | No. |
| Deterministic/local? | Local deterministic heuristics. |
| Consumes sample pixels/audio? | Consumes sample/source pixels locally. |
| Can affect final pixels? | Yes, via media geometry, motion atom layers, primitive selection, and Remotion/FFmpeg render instructions. |
| Current fallback | Heuristic/fallback bbox, procedural primitives, fallback reasons on atoms/layers. |
| Tests/gates | Technique atom tests, RenderRecipe v4.1 tests, render-quality v3 visual graph gates, fidelity inspector. |
| Failure mode | Heuristic grounding can create wrong geometry or repeated/default motion; no model-backed grounding route records confidence. |

### `audio_analysis`

| Field | Current state |
|---|---|
| Current implementation | Local FFmpeg/FFprobe/librosa analysis extracts duration/audio metadata, beat grid, onset and audio layer estimates. |
| Files/functions | `scripts/analyze-evidence-timeline.py`; `apps/api/src/adapters/evidenceTimeline.ts`; `packages/shared/src/engine/planner.ts` `recipeAudioPlan`, rhythm/timing builders. |
| Input schema | Local media path. |
| Output schema | Beat grid, audio structure, estimated layers, rhythm/timing evidence. |
| Provider/model | Local FFmpeg/FFprobe/librosa. |
| Cloud required? | No. |
| Deterministic/local? | Local; beat tracking can vary by library/model version. |
| Consumes sample pixels/audio? | Consumes audio locally. |
| Can affect final pixels? | Yes indirectly through beat-aligned cuts/motion; affects final audio directly through audio plan. |
| Current fallback | No-audio/unavailable states; procedural/synth audio plan can still render. |
| Tests/gates | Render-quality audio and beat gates, final gates `G8`/`G15`, fidelity inspector audio counts. |
| Failure mode | Similar BGM/procedural audio across outputs because generation is currently limited and not routed as a task. |

### `image_fill`

| Field | Current state |
|---|---|
| Current implementation | Gap reports can create material generation briefs. API selects a provider, generates candidates, runs quality checks, and adds usable generated assets to the generation request. |
| Files/functions | `packages/shared/src/engine/aigcMaterialPlanner.ts`; `aigcMaterialProviders.ts`; `aigcMaterialQualityGate.ts`; `apps/api/src/server.ts` `runMaterialGeneration`; `packages/shared/src/engine/planner.ts`. |
| Input schema | `MaterialGenerationBrief`, provider context, privacy policy, target-safe prompt pack. |
| Output schema | `GeneratedAssetCandidate[]`, quality report, generated target assets, media layers. |
| Provider/model | Deterministic local `deterministic_local_image_fill` (`mock_provider` compatibility alias); optional `volcengine_seedream`; optional `google_gemini_image`; disabled stubs for unsupported providers. |
| Cloud required? | No for core demo. Yes only for explicitly allowed external image providers with env keys. |
| Deterministic/local? | Local deterministic provider is available. External providers are not deterministic. |
| Consumes sample pixels/audio? | Should not. Brief policy defaults to `allowSampleFramesToProvider=false`; external providers reject sample frame briefs. |
| Can affect final pixels? | Yes, generated or selected target assets can become renderable media layers. |
| Current fallback | Disabled/no-brief/no-provider paths fall back to procedural or target/user replacement strategies. |
| Tests/gates | `aigcMaterialFill.test.ts`, provider policy tests, final gate generated provenance checks. |
| Failure mode | Provider choice is not represented by v4.2 task ids; deterministic provider id includes "mock", which is confusing for production semantics. |

### `video_fill`

| Field | Current state |
|---|---|
| Current implementation | No real video generation provider implementation found. Planner/renderer use procedural moving material, proxy placeholders, media clips, and an `aigc_video_fill_stub` renderer manifest path. |
| Files/functions | `packages/shared/src/engine/planner.ts`; `apps/api/src/adapters/renderers.ts`; `packages/shared/src/engine/providerPolicy.ts`; `scripts/run-motion-graph-case.mjs`. |
| Input schema | Gap/fill action, RenderRecipe layers, renderer instructions. |
| Output schema | Procedural video/media layer output, renderer manifests, gap/fill records. |
| Provider/model | Local Remotion/FFmpeg/procedural only. `seedance_2_0` exists as policy entry/stub concept, not as a real adapter. |
| Cloud required? | No. |
| Deterministic/local? | Yes for core procedural path. |
| Consumes sample pixels/audio? | Should not use sample media as final material unless authorized; evidence-only sample use is policy separated. |
| Can affect final pixels? | Yes. |
| Current fallback | Procedural dynamic proxy, image card, target source clips when allowed, explicit moving material gap. |
| Tests/gates | Render-quality gates, final gates, motion/fidelity scripts. |
| Failure mode | Complex sample-specific motion cannot be filled by a real generated video provider, so outputs can converge to similar procedural motion. |

### `audio_generation`

| Field | Current state |
|---|---|
| Current implementation | Renderer/planner creates local procedural audio plan. ElevenLabs providers exist only in policy entries; no real Scribe/TTS/SFX/Music generation adapter was found. |
| Files/functions | `packages/shared/src/engine/planner.ts`; `apps/api/src/adapters/renderers.ts`; `packages/shared/src/engine/providerPolicy.ts`. |
| Input schema | RenderRecipe global audio plan, timing/rhythm evidence, fill actions. |
| Output schema | Audio layers/plan and rendered audio stream. |
| Provider/model | Local FFmpeg/procedural synth; policy-only optional ElevenLabs ids. |
| Cloud required? | No. |
| Deterministic/local? | Yes for local procedural path. |
| Consumes sample pixels/audio? | Local analysis consumes audio; final sample audio copy remains disallowed by `sampleAudioCopyAllowed=false`. |
| Can affect final pixels? | Not directly, but beat timing can affect cuts/motion. |
| Current fallback | Procedural BGM/SFX/silent-safe behavior depending renderer policy. |
| Tests/gates | Final gates `G8`/`G15`, render-quality audio checks. |
| Failure mode | Same/limited BGM and audio style across cases because no true generation/selection router exists. |

### `knowledge_retrieval`

| Field | Current state |
|---|---|
| Current implementation | Templates and TechniqueAtoms are stored and exposed through API/report surfaces; atom filtering is deterministic. |
| Files/functions | `apps/api/src/server.ts` evidence/technique/gap/recipe/report endpoints; `packages/shared/src/engine/atomExtractor.ts`; `packages/shared/src/engine/planner.ts`; `docs/architecture.md`. |
| Input schema | Templates, evidence timelines, atom query/filter fields. |
| Output schema | `KnowledgeAtom[]`, `TechniqueAtom[]`, KB snapshots/report JSON. |
| Provider/model | No embedding/vector/BM25 model route found. |
| Cloud required? | No. |
| Deterministic/local? | Yes. |
| Consumes sample pixels/audio? | Only consumes derived evidence/metadata, not raw media. |
| Can affect final pixels? | Indirectly if selected atoms guide recipe/primitive selection. |
| Current fallback | Direct deterministic atom extraction and filter matching. |
| Tests/gates | Technique atom tests, report endpoint tests, architecture docs. |
| Failure mode | Retrieval is shallow and may not distinguish similar motifs or prior learnings. |

### `quality_judge`

| Field | Current state |
|---|---|
| Current implementation | Deterministic gates inspect artifacts, render metrics, evidence transfer, safety/provenance, and optional LLM/VLM scorecards. |
| Files/functions | `scripts/evaluate-render-quality.mjs`; `scripts/evaluate-final-gates.mjs`; `scripts/inspect-learning-fidelity.mjs`; `scripts/vlm-judge-video.mjs`; `apps/api/src/adapters/openaiCompatible.ts` `judgeGeneration`; `apps/api/src/server.ts` scorecard endpoint. |
| Input schema | Rendered videos, generation/template/timeline/recipe JSON, optional sample video/evidence, scorecard request. |
| Output schema | Gate JSON/Markdown, scorecard dimensions, VLM judge JSON, fidelity report. |
| Provider/model | Local deterministic gates; optional text LLM judge; optional Gemini VLM frame judge. |
| Cloud required? | No for deterministic gates. Yes for optional LLM/VLM judge. |
| Deterministic/local? | Deterministic gate scripts are local. Optional judges are external/non-deterministic. |
| Consumes sample pixels/audio? | Deterministic gates analyze sample locally. `vlm-judge-video.mjs` sends extracted sample/output frames externally when enabled. |
| Can affect final pixels? | Usually no direct pixel changes; can block/report/guide future repair. |
| Current fallback | VLM judge exits skipped without key; scorecard uses deterministic heuristic when LLM is skipped/unavailable. |
| Tests/gates | Existing evaluation scripts and endpoint tests. No unified per-task provider decision artifact. |
| Failure mode | Optional cloud judge can violate stricter "do not send sample frames" policy unless explicitly gated; deterministic gates miss some semantic issues. |

### `code/debug agent usage`

| Field | Current state |
|---|---|
| Current implementation | Development-time workflow only. There is no product runtime adapter for a code/debug agent. |
| Files/functions | `spec_v4/codex-prompts.md`, docs, tests, scripts, and this Codex session. |
| Input schema | Human instructions and repository files. |
| Output schema | Code changes, docs, analysis, test runs. |
| Provider/model | External to application runtime. |
| Cloud required? | Not part of core demo/runtime. |
| Deterministic/local? | No; human/agent workflow. |
| Consumes sample pixels/audio? | Only if a developer explicitly opens/inspects local artifacts; no application provider path. |
| Can affect final pixels? | Only by modifying code/config in development. |
| Current fallback | Human developer workflow. |
| Tests/gates | Normal repo tests/gates after changes. |
| Failure mode | If included in ModelTask routing, it would blur runtime safety policy with development process. |

## Phase 0 Findings

1. The current repo has no unified `ModelTask` router matching the v4.2 task list.
2. The closest existing router is `packages/shared/src/engine/providerPolicy.ts`, but it only covers coarse provider classes such as video generation, image generation, speech-to-text, music generation, and local procedural fallbacks.
3. Existing cloud model paths are environment-gated, but their safety semantics differ by task:
   - Text LLM planning does not upload sample pixels/audio.
   - Gemini VLM uploads the input video when enabled.
   - VLM judge uploads extracted sample/output frames when enabled.
   - External image generation providers are guarded against sample frame upload.
4. Core demo/rendering can run without paid/cloud APIs through FFmpeg, Remotion, deterministic planning, local evidence extraction, and local/procedural material paths.
5. Several current failure paths are honest at execution time but not yet centralized into route artifacts, especially ASR/OCR/VLM disabled or unavailable states.
6. Many reported user-visible issues map to missing or weak task separation:
   - Similar FFmpeg motion/audio: `video_fill` and `audio_generation` are mostly procedural/local and not routed by learned motif.
   - Text position/animation/color not learned enough: `ocr` and `visual_grounding` evidence exist, but consumption can degrade through template/timeline/recipe/render.
   - Polluted subtitles/text: `text_planning_llm` and subtitle display need separate safety/lint routes.
   - Remotion with zero pics: `image_fill`/material mapping and renderer consumption need route/gate visibility.

## Required Next Step

Before implementing v4.2, add a real Model Router design with explicit route records:

```ts
type ModelTask =
  | "video_structure_vlm"
  | "text_planning_llm"
  | "asr"
  | "ocr"
  | "visual_grounding"
  | "audio_analysis"
  | "image_fill"
  | "video_fill"
  | "audio_generation"
  | "knowledge_retrieval"
  | "quality_judge"
  | "code_debug_agent";
```

Each route record should state selected provider, provider class, model id, whether cloud is required, whether sample pixels/audio are consumed, whether final pixels/audio can be affected, fallback provider, fallback reason, and generated-asset provenance rules. This should be testable offline before any provider upgrade or optional API integration is added.

## v4.2 Terminology Addendum

These terms are normalized for Phase 1-2:

- `sample media`: sample video frames/audio used for structure evidence.
- `AIGC provider`: image/video/audio generation provider.
- `VLM understanding provider`: external multimodal analysis provider; it may consume sample media only when policy explicitly allows analysis upload.
- `quality judge provider`: output evaluator; output frames may be allowed, while sample-frame comparison is separately policy-gated.
- `renderable material`: assets allowed to enter final video pixels/audio.

Default policy remains: sample frames/audio are never allowed as AIGC generation references. External VLM analysis of sample media is a separate policy; if enabled, the route record must explicitly state that sample media was uploaded for analysis only, not as renderable or generation reference material.
