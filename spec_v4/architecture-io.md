<!-- Auto-generated 2026-06-03 from real code + real docs/artifacts/marking_run run via the arch-io-trace workflow. Grounded, per-block I/O. -->

# 爆款结构迁移引擎 (Viral Video Structure Transfer) — Pipeline Architecture

## What this system is

`viral-video-structure-transfer` learns the **structure** of a viral sample video — its rhythm, scene-cut grammar, beat grid, typography behavior, motion atoms, palette and slot layout — and **re-composes a brand-new video from a different target theme**, *never copying the sample's pixels, audio, text, or watermark*. Perception is **deterministic-first** (PySceneDetect + librosa + Farneback optical flow + 60-frame metrics ground the analysis) with **VLM/ASR/OCR** layered on top to label, not invent. Generation is a deterministic planner that maps the learned structure onto target/AIGC-generated material, validates against AJV schemas, renders via FFmpeg + Remotion, mixes evidence-driven procedural/AIGC audio, and gates the result with 30 motif-agnostic acceptance gates. A v4.2 model-router governs every external provider call and a const-false safety clamp guarantees no generator ever receives sample media.

**End-to-end data-flow one-liner:**
`Asset (uploaded .mov) → VisualEvidenceTimeline (deterministic) + VLMVideoAnalysis/transcript/ocr → StructureTemplate (slots/segments/atoms) → [brief + SourceVideoUnderstanding → SlotMapping → GapReport+FillPlan → AIGC material fill → 2nd SlotMapping] → Timeline + RenderRecipe (dual v1/v4.1) → (optional codegen: CreativeEffectSpec→layer-plan→Remotion component→validate/apply/promote/select) → final.mp4 (FFmpeg) + final.remotion.mp4 (Remotion) + audio mix → render-quality.json + final-gates.json (G1–G30)`

---

## Full pipeline block diagram

```
                         INGEST
  POST /api/projects ───────────────► Project{id,vertical,aspectRatio,targetDurationSec}
  POST /api/projects/:id/assets (multer upload.single("file"))
        │  raw .mov/.mp4 bytes  (≤500MB, video/image/audio/text)
        ▼
  ┌──────────────────────────────────────────┐
  │ (1) Asset record {id,path=storage/uploads │  Asset.path, .id, .filename
  │     /<proj>/<id>.mov, sourcePolicy, role}  │────────────┐
  └──────────────────────────────────────────┘            │
                                                            ▼
                         PERCEPTION  (POST /api/assets/:id/analyze → runAnalysisJob)
  ┌─────────────────────────────────────────────┐   ┌──────────────────────────────────────┐
  │ (2) DETERMINISTIC evidence analysis          │   │ (3) VLM + ASR + OCR (model side)       │
  │  scripts/analyze-evidence-timeline.py        │   │  Gemini VLM (WHOLE video inline ≤18MB) │
  │  PySceneDetect+librosa+Farneback+60frame     │   │  ElevenLabs Scribe ASR                 │
  │  ──► VisualEvidenceTimeline (v2)             │──►│  EasyOCR (local)                       │
  │      shots[], sceneCuts, beatGrid{bpm},      │   │  ──► VLMVideoAnalysis + transcript[]   │
  │      frameMetrics(+contentStd), heroDescr.,  │   │      + ocr[]; bound into evidence      │
  │      typographyEvidence, detectedStyle       │   │      (shots[].asrText/ocrText)         │
  └─────────────────────────────────────────────┘   └──────────────────────────────────────┘
                          │  evidenceContext grounds the VLM (built BEFORE the call)
                          ▼   VideoAnalysisResult (analysis.json)  analyzerMode='ffmpeg_vlm_asr'
                         TEMPLATE  (extractStructure → buildFallbackTemplate)
  ┌─────────────────────────────────────────────────────────────────────────────────────────┐
  │ (4) StructureTemplate {videoType, segments[], requiredSlots[], inducedSlots[],            │
  │     structureAtoms[], techniqueAtoms[], dominantHexPalette, replacementPolicy}            │
  │     learned-template.json  + technique-atoms.json     (skeleton DETERMINISTIC; LLM only   │
  │     overlays cosmetic name/intent strings)                                                │
  └─────────────────────────────────────────────────────────────────────────────────────────┘
                          │  StructureTemplate
                          ▼
                         GENERATE  (POST /api/generations → generateMigrationResult)
  (5) source_analysis: parsePromptToBrief → ParsedBrief ; understandSourceVideo → SourceVideoUnderstanding
                          │ brief + source
                          ▼
  (6) slot_matching: matchSlots(template,source,request) ──► SlotMapping[]  (slot-mapping.json)
                          │ mappings
                          ▼
  (7) gap_fill: generateGapReport ──► GapReport[]  +  createFillPlan ──► FillAction[]
                          │ gapReport+fillPlan          (gap-report.json / fill-plan.json)
                          ▼
  (8) AIGC material fill: brief → google_gemini_image / seedream / seedance → quality gate
                          │   ──► generatedTargetAssets[]  (aigc-material-fill.json)
                          │   ── appended to request.targetAssets → 2nd matchSlots ──┐
                          ▼                                                           │
  (9) timeline_generation: buildTimeline ──► Timeline (timeline.json)                │
        buildRenderRecipe → migrateRenderRecipeToV4_1 ──► RenderRecipe (DUAL v1+v4.1)│
        generateStructureExplanation ──► structure-explanation.md                    │
                          │  Timeline.renderPlan.renderRecipe == render-recipe.json  │
                          ▼                                                           │
  (10) schema_validation: validateGenerationRequest + validateTimeline (AJV, hard)   │
        lintRenderRecipe + critiqueVideoOffline ; buildRecipeVersions (high_click/quality)
                          │  validated recipe
                          ▼
        [OPTIONAL CODEGEN — OFF in full pipeline, effectProgramIds=[] ]
   (5a) CreativeEffectSpec ─► (5b) layer-plan (Gemini-on-contact-sheet IMAGE, eval only)
        ─► (5c) Remotion component (Gemini text-only) ─► (5d) validate→apply→promote→select
        ─► recipe.effectProgramIds + effectPropsById
                          │
                          ▼
                         RENDER
  ┌────────────────────────────────────┐     ┌────────────────────────────────────┐
  │ (11) FFmpeg: clips@bboxNorm,        │     │ (12) Remotion: ViralRecipeRoot     │
  │  primitives, motif overlay fallback │     │  layers[]→LayerView / clips[]→Clip │
  │  ──► final.mp4 720x1280 h264 AAC    │     │  ──► silent.mp4 → muxProceduralAudio│
  └────────────────────────────────────┘     │  ──► final.remotion.mp4 (mono)     │
                          │                    └────────────────────────────────────┘
                          ▼
  (13) Audio mix (FFmpeg addAudioTrack): Lyria bed@0.42 + TTS voiceover@1.25 + SFX@0.7
        OR evidence-driven procedural beat bed (drone/kick/hat/riser/impact)
                          │  final.mp4 with AAC audio
                          ▼
                         EVAL / GATES
  (14) Model Router → ProviderDecision[31] + ModelRouteSummary (generation.json)
  (15) Provider policy → MediaAccessPolicy presets + AIGC const-false clamp
  (16) Storage → atomic whole-snapshot JSON (storage/db/app.json)
  (17) final-gates G1–G30 ──► final-gates.json   (motif-agnostic acceptance)
  (18) render-quality (universal + opt-in v2/v3) ──► render-quality.json
  (19) marking-pipeline orchestrator + package builder ──► case-summary.json / RUN_SUMMARY.json
```

---

## Block reference

### (1) Ingestion / Upload — Project + managed Asset

**Purpose.** Create a `Project`, accept a multipart video upload, persist it under `storage/uploads/<projectId>/<assetId><ext>`, and return a managed `Asset`. This is the only sanctioned entry for sample media — external absolute paths are rejected downstream (`server.ts:557`).

**Triggered by.** `POST /api/projects` (`server.ts:986`), then `POST /api/projects/:projectId/assets` with `multer upload.single("file")` (`server.ts:1029-1042`); asset built by `createAssetFromRequest` (`server.ts:369-402`).

| Input | Shape / fields | Source |
|---|---|---|
| Project create body | `{ name?, vertical?, aspectRatio?('9:16'), targetDurationSec?(15) }` | `POST /api/projects` body; defaults via `pickEnum`/`toNumber` |
| Asset upload form | `multipart/form-data: file(binary), role(AssetRole), sourcePolicy(default user_authorized), type?, tags?, text?` | `POST /api/projects/:projectId/assets`; multer → `uploads/tmp`, 500MB cap |
| Raw video bytes | `Express.Multer.File{path,originalname,mimetype,size}` | the sample video to learn from |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| `Asset` record | `{id,projectId,role,type('video'),filename,path,mimeType?,sourcePolicy,text?,metadata{size,mimetype},tags?,status:'ready',createdAt}` (`types.ts:501-515`) | `db.assets` via `store.update` (`server.ts:1037`); consumed by `POST /api/assets/:assetId/analyze` (`server.ts:1139`) which passes `asset.path` to Block 2; `asset.id`/`filename` threaded as `--source-asset-id`/`--source-asset-filename` |

**Implementation.** `server.ts:986`, `:1029`, `:369`, `:194` (multer); `types.ts:501`.
**Model usage.** Deterministic — no model. Pure HTTP/multer + `stableId`; persisted via atomic JSON backend.
**Real example (motion_graph_2).** Surfaces in `analysis.json.evidenceTimeline`: `sourceAssetId="asset_es02jg"`, `sourceAssetFilename="motion_graph_2.mov"`; post-upload ffprobe metadata `{durationSec:39.008, width:1138, height:640, fps:30, hasAudio:true, codec:"h264"}`; evidence frame paths `/generated/evidence/asset_es02jg/frame_000.png`.
**Notes.** No standalone `asset.json` artifact; identity surfaces inside `analysis.json`/`generation.json`. `sourcePolicy` is the provenance gate read later as `modelRouteSummary.mediaAccessPolicy.sampleVideoUsageAllowed`. `filename` is load-bearing through template/render naming.

---

### (2) Deterministic evidence analysis — VisualEvidenceTimeline

**Purpose.** Produce a fully deterministic, timestamped evidence timeline so the VLM/LLM must cite real signals: scene cuts, audio beat grid, per-shot motion/family classification, 60-frame metrics, moving-object candidates, hero descriptor, typography evidence, element graph. **Runs BEFORE the VLM** to ground it.

**Triggered by.** `runAnalysisJob` (`server.ts:691`) → `analyzeEvidenceTimeline(asset,{generatedDir})` (`evidenceTimeline.ts:26`) shelling to `scripts/analyze-evidence-timeline.py` via conda `viral`. Text-bound later by `bindAnalysisTextToEvidence` (`server.ts:765`).

| Input | Shape / fields | Source |
|---|---|---|
| `asset` | `{path,id,filename}` | Block 1; guarded by `hasCondaEnv() && asset.path` |
| Python CLI args | `[--video, --out evidence-timeline.json, --frames-dir, --frames-url-prefix, --source-asset-id, --source-asset-filename]` (`evidenceTimeline.ts:34-43`) | built by `analyzeEvidenceTimeline`, timeout 240s |
| Decoded frames + audio | 60 evenly-spaced OpenCV frames (w=240) + librosa mono 22050Hz | raw video bytes (cv2.VideoCapture + librosa.load) |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| `VisualEvidenceTimeline` | `{schemaVersion:'visual-evidence-timeline-v2', sourceAssetId, durationSec, hasAudio, shots[], sceneCuts[], beatGrid{status,bpm,beats[],onsets[],source}, frameMetrics[](+contentStd), movingObjectCandidates[], evidenceFamilies[], detectedStyle, heroDescriptor, typographyEvidence[], visualElementGraph, audioStructure, stats, analyzerMode:'evidence_timeline_v2'}` (`types.ts:744`) | `<gen>/evidence/<id>/evidence-timeline.json`; merged into `analysis.json.evidenceTimeline`; consumed by `summarizeEvidenceForPrompt`, `GET /evidence`, `slotInduction.ts` |
| Served frames | PNG keyframes `/generated/evidence/<id>/frame_NNN.png` | on disk; referenced in `shots[].evidencePaths` (never absolute local paths) |

**Implementation.** `evidenceTimeline.ts:26,65`; `analyze-evidence-timeline.py:88` (ContentDetector threshold 27.0), `:175` (60-frame metrics), `:218` (Farneback), `:575` (librosa beat grid), `:340` (element graph), `:1038` (assembly); `types.ts:744`.
**Model usage.** **DETERMINISTIC** — PySceneDetect, librosa beat_track/onset_detect, `cv2.calcOpticalFlowFarneback(0.5,2,13,3,5,1.1)`, frame absdiff for cutLike, grayscale std/255 for `contentStd`, k=4 dominant palette. Heuristic family/hero/typography. The VLM runs AFTER and only labels.
**Real example (motion_graph_2).** `durationSec=39.008`, 16 shots, 16 sceneCuts, `beatGrid={status:'ok', bpm:107.7, source:'librosa', 65 beats, 170 onsets}`. `stats={blackBgRatio:0.938, dominantPalette:['#020408','#162541','#3d5580','#99adcf'], cutDensity:0.41, avgShotDurationSec:2.438, medianShotDurationSec:2.233, motionDiffMean:0.0849}`. `shots[0]={shotId:'shot_000',0–4s,family:'object_motion',motionEnergy:1.1214,visualTags:['dark_background','hook_candidate']}`. `detectedStyle.videoType='beat_cut'`; `heroDescriptor.objectType='head_like_mask', timeRangeSec:[14.033,16.2], confidence:0.9`.
**Notes (dual-path).** `contentStd` is deliberately separate from `blackBgRatio`: the blank-section gate keys off `contentStd≈0` so legitimately dark UI motifs (high blackBgRatio) aren't false-flagged. **Field-name gotcha:** top-level `VideoAnalysisResult.analyzerMode='ffmpeg_vlm_asr'` (whole job) vs `evidenceTimeline.analyzerMode='evidence_timeline_v2'` (this block). conda-gated; PySceneDetect falls back to uniform 2s shots if <2 scenes. `bindAnalysisTextToEvidence` overlays ASR/OCR onto shots by timestamp overlap *without* re-running Python OCR/ASR.

---

### (3) VLM + ASR + OCR perception (model side of analyze)

**Purpose.** Gemini understands the **whole** sample video (grounded by deterministic evidence), ElevenLabs Scribe transcribes audio, EasyOCR reads keyframe text; merged into `VideoAnalysisResult` + bound into the evidence timeline, then feeds template extraction.

**Triggered by.** `runAnalysisJob` (`server.ts:659`): stages `vlm_video_understanding` (`:702-717`), `asr_transcript` (`:719-735`), `ocr_keyframe_text` (`:737-760`), `bindAnalysisTextToEvidence` (`:764`), then `extractStructure` (`:789`).

| Input | Shape / fields | Source |
|---|---|---|
| `asset` | `{id,path,filename,mimeType,role}` | uploaded sample |
| `evidenceContext` | grounding string from `summarizeEvidenceForPrompt(evidence)` | Block 2, built BEFORE the VLM call |
| `opts.purpose` | `'sample'｜'source'` | `runAnalysisJob` param |
| keyframes (OCR) | `{path(non mock://),timeSec}[]` | deterministic `videoTool.analyze()` |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| `VLMVideoAnalysis` | `{videoSummary, videoType, visualStyle{background,layout,motionAsset,colorProgression[],typography}, excludeSegments[], shots[VLMShotInsight], structure{hook,setup,sellingPoints[],climax,cta}, rhythm, packaging, reusablePatterns[], materialGapsForNewVideo[], recommendedTimelineForRemotion, raw}` | `mergeVlmIntoAnalysis` (`server.ts:321`) → `analysis.shots[].tags/notes` + keyframes; passed to `extractStructure({...,vlm})` |
| `transcript` | `TranscriptSegment[]={startSec,endSec,text}` | `analysis.transcript`; bound into `evidenceTimeline.shots[].asrText` |
| `ocr` | `{timeSec,text}[]` | `analysis.ocr`; bound into `shots[].ocrText` |
| bound evidenceTimeline | shots[].asrText[]/ocrText[] filled; ocrStatus/asrStatus→'ok' | `analysis.evidenceTimeline`; consumed by slot induction + template extraction |

**Implementation.** `gemini.ts:14` (`INLINE_MAX_BYTES=18MB`), `:16` (`DEFAULT_MODEL='gemini-3.5-flash'`), `:247-302` (`describeVideo` inline vs files-api + grounding), `:113-186` (normalise), `:18-95` (STRUCTURE_PROMPT); `elevenlabs.ts:84-103,151-173`; `index.ts:188-211` (EasyOCR), `:307-310` (adapter gates); `server.ts:702-766,321-353`; `evidenceTimeline.ts:65-106`.
**Model usage.** VLM = **Gemini** (`gemini_vlm_current`, code default `gemini-3.5-flash`, env `VLM_MODEL`) — cloud, consumes sample pixels+audio+video externally. ASR = **ElevenLabs Scribe** (`scribe_v2`) — cloud, sample audio external. OCR = **EasyOCR** — local conda (fallback from disabled paddleocr). Evidence grounding deterministic.
**Real example (motion_graph_2).** `analyzerMode='ffmpeg_vlm_asr'`, `transcript=[{0.019→35.019,'[outro jingle]'}]`, `ocr` 5 rows e.g. `{3.901,'Side h\nStudio Both Sides\n小纡书'}`. `learned-template.json.visualStyle={background:'dark_tech_black',layout:'center_bold_typography',motionAsset:'beat_synced_cards_and_montage',colorProgression:['black','red','yellow','white']}`. `server.log`: all Gemini analyses `mode=inline` (largest `size=17220280 < 18MB`). `generation.json` providerDecisions: `video_structure_vlm{selectedProvider:'gemini_vlm_current',consumesSamplePixels/Audio/VideoExternally:true}`, `asr{elevenlabs_scribe,consumesSampleAudioExternally:true}`, `ocr{easyocr_current,fallbackUsed:true,fallbackReason:'...paddleocr disabled by env gate ENABLE_HEAVY_LOCAL_ML'}`.
**Notes (verified ground truth).** (1) `describeVideo` sends the **whole video inline base64** when `size≤18MB`, else Files-API upload + poll to ACTIVE; all marking samples went `mode=inline`. (2) Prompt is evidence-grounded (`STRUCTURE_PROMPT` + "DETERMINISTIC EVIDENCE (treat as ground truth)" + `evidenceContext`). **Gotcha:** in `analysis.json` top-level `videoType` is `None` and there is no top-level structure/packaging — VLM output is fused into shots/keyframes; the authoritative `videoType='beat_cut'` comes from the **deterministic** `evidenceTimeline.detectedStyle.videoType`. ASR guards with `rejectSampleAudio()`; OCR stays local and failure is non-fatal.

---

### (4) StructureTemplate construction

**Purpose.** Turn the per-sample `VideoAnalysisResult` into a reusable `StructureTemplate` — the learned visual grammar as named, evidence-bound slots/segments/atoms. This is the LEARN side; it captures STRUCTURE only and never copies sample pixels/audio.

**Triggered by.** `server.ts:790` → `aiAdapter.extractStructure({analysis,projectId,vertical,vlm})` (`openaiCompatible.ts:87`) whose first line is `buildFallbackTemplate` (`planner.ts:1274`), branching to `buildBeatCutTemplate` (`planner.ts:1146`) when `detectVideoType(...)==="beat_cut"`. Offline runner calls `buildFallbackTemplate` directly (no vlm).

| Input | Shape / fields | Source |
|---|---|---|
| `analysis` | `VideoAnalysisResult{metadata,evidenceTimeline{stats,beatGrid,shots[],heroDescriptor,typographyEvidence[],visualElementGraph,audioStructure},keyframes,shots,ocr,transcript,primaryMotif}` | Block 2+3 (`analysis.json`) |
| `vertical` | enum e.g. `b2b_marketing_mg` | `project.vertical` |
| `projectId` | string | `project.id` |
| `vlm` | `VLMVideoAnalysis｜undefined` | Block 3 |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| `StructureTemplate` | `{id,videoType,visualStyle,segments[]{role,startRatio,endRatio,slots[],intent}, requiredSlots[]{id,role,slotType,visualForm,visualFormFamily,modality,assetRequirement{required,type,minCount},rendererCandidates[],sourceEvidence{confidence,timeRange,frameIds[],framePaths[],signalSource,evidenceKinds[]},semanticLabel,clickToReplace}, inducedSlots[], rhythm, packaging, structureAtoms[], techniqueAtoms[], replacementPolicy{doNotCopySampleVisuals,forbiddenTransfer[]}, dominantHexPalette[], heroDescriptor, typographyEvidence[], visualElementGraph, audioStructure, motionAtoms[]}` | `learned-template.json`; consumed by template-selection + the generate side (slot-mapping/gap/fill/timeline/recipe) |
| `techniqueAtoms[]` | `TechniqueAtom{id,name,category,sourceEvidenceRefs[],visualPattern,timingPattern,requiredAssets[],renderer{preferred,component},transferRules[],confidence}` | embedded + `technique-atoms.json`; from `extractTechniqueAtoms` (`atomExtractor.ts:104`) inside `attachEvidenceToTemplate` |

**Implementation.** `planner.ts:796` (detectVideoType), `:777` (videoTypeFromVlm), `:1146` (buildBeatCutTemplate), `:1129` (BEAT_CUT_SLOT_SPECS), `:1274` (buildFallbackTemplate), `:1018` (attachEvidenceToTemplate); `slotInduction.ts:472,517,646,149,102`; `atomExtractor.ts:104`; `openaiCompatible.ts:87,326`; `server.ts:800-804`.
**Model usage.** Skeleton **DETERMINISTIC**. Two optional model touches: (1) Gemini VLM supplies `videoType` passthrough + evidenceTexts biasing induction/name seed; (2) OpenAI-compatible text LLM (`text_planning_llm → configured_ai_adapter`) does **post-hoc cosmetic** enrichment in `mergeEnrichment` — rewrites name (`"LLM · …"`), segment intents, atom names, packaging strings, `rhythm.pace`, appends `qualityRationale`. It does **not** change videoType/slots/segments/families/techniqueAtoms.
**Real example (motion_graph_2).** `id=template_zpjll6`, `videoType="beat_cut"`, `name="LLM · B2B高能动效产品发布模板 · motion_graph_2.mov · 2026-06-03T18:16Z"`, `dominantHexPalette=["#020408","#162541","#3d5580","#99adcf"]`, 6 segments, 8 requiredSlots from `BEAT_CUT_SLOT_SPECS` (e.g. `slot_moving_source_montage` minCount 3, fallback `[target_source_clips_by_motion, aigc_generated_material, procedural_dynamic_proxy]`), 6 inducedSlots, `heroDescriptor.motionPattern="orbit+light_sweep"`. `technique-atoms.json` 6 atoms: KineticTypographySweep (conf 0.937, 22 typography refs), ParametricRibbonSurface (14.033–16.2s), ProductPosterHero, ObjectTrackReveal, ImpactFlash, CTAEndSlate. Contrast: `marketing` → `videoType="motion_graphic_marketing_poster"`, non-beat-cut `buildRequiredSlots` (7 slots).
**Notes (verify-don't-trust on videoType).** `detectVideoType` (`:796-814`) returns `"beat_cut"` early *only if* `score≥3 AND editingTempo`, where `editingTempo = montage || medianShot<2.0 || beats≥150`. Recomputing on mg2's saved analysis (median 2.233, beats 65, no montage) gives `score=3` but `editingTempo=FALSE` → early-return does **not** fire. mg2 is `beat_cut` because the merged analysis **contains the string "beat_cut"** (VLM-supplied videoType) which `videoTypeFromVlm` (`:778`) passes through. So the `editingTempo` thresholds are the **hallucination-proof deterministic guard** (editing.mov ≈1.8s/297 beats clears it; MG promos do not), while VLM passthrough still routes to beat_cut when the VLM labels it so. **Safety:** every path sets `replacementPolicy.doNotCopySampleVisuals=true`, `forbiddenTransfer=[original_video_frames,original_audio,original_voiceover,person_likeness]`; sourceEvidence frames are references only. `buildEvidenceSource="vlm"` merely records a VLM was present, not that structure was VLM-authored.

---

### (5) source_analysis (Stage 1: parsePromptToBrief + understandSourceVideo)

**Purpose.** Parse the free-text prompt into a `ParsedBrief` and fold deterministic source-video analysis (+optional VLM) into a `SourceVideoUnderstanding` whose per-shot candidates carry slot-affinity tags and a material-reuse policy.

**Triggered by.** `runGenerationPipeline` → `advanceJob(job,"source_analysis","completed")` (`server.ts:2387`); `understandSourceVideo` (`planner.ts:1471`), `parsePromptToBrief` (`planner.ts:1334`).

| Input | Shape / fields | Source |
|---|---|---|
| `request` (GenerationRequest) | `{prompt,projectId,target{aspectRatio,targetDurationSec},targetAssets[],constraints{forbiddenWords?,sampleAssetReuse?},controls{...},selectedTemplateIds}` | `POST /api/generations`; `generation.json.request` |
| `analysis` | `{id,analyzerMode,shots[],transcript[],ocr[]}` | reused from `db.analyses` |
| `sourceAsset` | `{id,path,sourcePolicy,tags?,metadata?}` | uploaded sample; `sourcePolicy` gates reuse |
| `vlm` (optional) | `{shots[],videoSummary,materialGapsForNewVideo[]}` | Gemini (whole video inline) |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| `brief` (ParsedBrief) | `{topic,productName,brandName?,targetAudience,sellingPoints[],tone,cta,rawPrompt,forbiddenContent[]}` | `createFillPlan` + AIGC copyContext; folded into `theme.json`/fill-plan text |
| `source` (SourceVideoUnderstanding) | `{assetId,analysisId,summary,candidates[],warnings[],transcript,ocrText,materialRole,renderable,sourcePolicy,reusableAsMaterial,materialBlockReason?,blockedCandidateShotIds[]}` | `matchSlots` + `generateGapReport`; `generation.json.sourceUnderstanding` |

**Implementation.** `planner.ts:1334,1471,1419`; `server.ts:2358-2397`.
**Model usage.** Both **deterministic** (regex matchLine + merge); underlying analysis deterministic; optional `vlm` from Gemini (`gemini_vlm_current`, `samplePixelsAllowed:true`). Reference video IS sent to the VLM but **never** to any generator.
**Real example (motion_graph_2).** brief from `theme.json`: `productName='蓝山精品挂耳咖啡'`, `cta='明早从一杯好咖啡开始'`. `source.candidates` carry `sourceEvidence` e.g. `summary='rotating neon hero object intro on dark background', signalSource='evidence_analyzer:family_region', evidenceKinds=['visual','ocr','asr','beat','motion']`.
**Notes (the core guarantee).** A `demo_only` sample without `sampleAssetReuse='authorized'` becomes `materialRole='sample_reference'`, `reusableAsMaterial=false`, so its shots join `blockedCandidateShotIds` and **cannot** fill visual slots — "learn structure, never copy content." If no source asset, returns an early stub with a text-card fallback warning.

---

### (6) slot_matching (Stage 2: matchSlots)

**Purpose.** Map every `template.requiredSlots` entry to a target asset, source shot, procedural family, or mark it weak/missing — producing `SlotMapping[]`.

**Triggered by.** `matchSlots(template,source,request)` (`planner.ts:4693`); `advanceJob(job,"slot_matching")` (`server.ts:2435`). **Runs TWICE** — re-run with AIGC-augmented targetAssets (`server.ts:1760`).

| Input | Shape / fields | Source |
|---|---|---|
| `template` | `{videoType,requiredSlots[]{id,role,slotType,visualForm,visualFormFamily,modality,assetRequirement{required,type,minCount},rendererCandidates,sourceEvidence,semanticLabel,motionSpec,confidence}}` | `learned-template.json` |
| `source` | Stage 1 `SourceVideoUnderstanding` | Block 5 |
| `request.targetAssets` | `{id,kind,role,tags?,path?,url?,text?,metadata?{materialRole?}}[]` | request; 2nd pass also includes `generatedTargetAssets` |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| `slotMapping` (SlotMapping[]) | per slot `{slotId,slotRole,slotType,status('matched'｜'weak_match'｜'missing'),candidateShotIds[],selectedShotId?,selectedAssetId?,selectedTargetAssetId(s)?,selectedTargetAssetKind?,targetAssetCandidateIds,assetAvailability,missingCount?,confidence,reason,risks,slotMetadata{visualForm,visualFormFamily,modality,rendererCandidates,sourceEvidence,semanticLabel,motionSpec,clickToReplace}}` | `generateGapReport` + `createFillPlan`; `slot-mapping.json` + `generation.json.slotMapping` |

**Implementation.** `planner.ts:1923` (matchSlots), `:1546` (preferredTagForSlot), `:2039-2042` (candidateMatchesSlot + sample-block filter).
**Model usage.** **Deterministic** — `geometric_mg` auto-matched to procedural; targetAsset candidate threshold ≥0.38, best ≥0.62; `brand_cta` with no logo forced `missing`; sample shots filtered out when not reusable.
**Real example (motion_graph_2).** 8 slots, 6 matched / 2 missing. `slot_moving_hero_object`: `status='matched', selectedTargetAssetId='generated_slot_moving_hero_object_01', assetAvailability='target_asset_mapped', confidence=0.88` (AIGC asset matched on 2nd pass). `slot_dark_background`: `status='missing', visualFormFamily='background', assetAvailability='no_user_asset_available', confidence=0`.
**Notes (ordering bias).** Target assets + procedural families win **before** any source-shot reuse, and source shots are only eligible when `sourceCanProvideMaterial` — sample footage never silently fills a slot. The `slot-mapping.json` artifact is the **POST-fill (final) state**.

---

### (7) gap_fill (Stage 3: generateGapReport + createFillPlan)

**Purpose.** Turn unmatched/weak `SlotMapping`s into an honest `GapReport` (with `repairOptions` + a `selectedRepair`) plus a `FillPlan` of per-slot `RendererInstructions` that drive timeline + renderer.

**Triggered by.** `generateGapReport(mappings,{source,template,request})` (`planner.ts:4431`) + `createFillPlan(...)` (`planner.ts:4694`); `advanceJob(job,"gap_fill")` (`server.ts:2436`). The FIRST (pre-AIGC) gap set feeds `createMaterialGenerationBriefs`.

| Input | Shape / fields | Source |
|---|---|---|
| `mappings` | Stage 2 output | Block 6 |
| `context` | `{source,template,request}` | Blocks 4,5 + request |
| `template.videoType/requiredSlots` | beat_cut → synthetic moving-material + bgm gaps | `learned-template.json` |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| `gapReport` (GapReportItem[]) | `{slotId,slotType,slotRole,status,severity,reason,impact,gapType,gapLabel,gapLabelZh,recommendedFillStrategies[],repairOptions[],selectedRepair{strategy,label,requiredInputs,risk,preservesStructure,reason},placeholderSpec?,visualFormFamily,sourceEvidence,missingCount?,assetAvailability,fillSource}` | `createMaterialGenerationBriefs`; `gap-report.json` + `generation.json.gapReport` |
| `fillPlan` (FillAction[]) | `{slotId,strategy,reason,targetClipId,rendererInstructions{renderer,fallbackRenderer,strategy,fulfilledBy,requiredInputs,atom?,ribbonMotion?,placeholderSpec?,motionSpec?,boundAssetId?,targetAssetIds?},backend,capabilityId?,fallbackUsed,fallbackReason?,visualFormFamily,selectedStrategy,providerDecision?}` | `buildTimeline`/renderer; `fill-plan.json` + `generation.json.fillPlan` |

**Implementation.** `planner.ts:2437` (generateGapReport), `:2615` (chooseStrategy), `:2649` (createFillPlan), `:2546-2591` (beat_cut synthetic gaps).
**Model usage.** **Deterministic** — `selectedRepair` chosen by a deterministic scorer (reason strings like `procedural_motion scored 86; provider route seedance_2_0` are written by the repair-scoring/provider-router, NOT an LLM). `chooseStrategy` is a rule cascade keyed on slotType + visualFormFamily.
**Real example (motion_graph_2).** `gap-report.json` (2 gaps): `slot_dark_background severity='high' gapType='background_missing' gapLabelZh='缺少背景/铺垫镜头' selectedRepair.strategy='packaging_fill' reason='structure_reorder scored 58; provider route deterministic_planner.'`; `slot_bgm_grid gapType='bgm_missing' selectedRepair='procedural_motion scored 86; provider route seedance_2_0'`. `fill-plan.json` (7 actions) e.g. `slot_dark_background strategy='procedural_generation' atom='parametric_ribbon_surface' backend='remotion_mg' fallbackUsed=true`; `slot_moving_hero_object strategy='aigc_generated_asset' fulfilledBy='aigc_generated_material' capabilityId='rotating_object_proxy'`.
**Notes.** For beat_cut the system ALWAYS emits honest synthetic gaps (`slot_moving_source_montage` moving_material_missing, `slot_bgm_grid` bgm_missing) when no authorized footage/BGM — renders procedural montage + synth beat instead of copying sample frames. `gap-report.json` shows only 2 gaps because it is the **POST-AIGC-fill** state (moving slots filled by generated assets dropped out); briefs were created from the FIRST larger gap set. `fillPlan` includes both unmatched-slot actions and `matchedCapabilityFillPlan` actions (`planner.ts:2796`) — how matched-but-generated slots get `strategy='aigc_generated_asset'`.

---

### (8) AIGC material fill (gap → brief → generator → quality gate → generatedTargetAssets)

**Purpose.** For each gap, synthesize a `MaterialGenerationBrief`, call an image/video generator to produce NEW target-theme material (never the sample), gate each candidate deterministically (+optional VLM), keep usable ones, and feed them back as targetAssets for a 2nd `matchSlots` pass.

**Triggered by.** `applyAigcMaterialFill` (image, `server.ts:1630`, called `:2399`) then `applyAigcVideoFill` (video, `server.ts:1797`, `:2409`) — both gated on `request.controls.allowAigcMaterialGeneration===true`.

| Input | Shape / fields | Source |
|---|---|---|
| gapReport + fillPlan | Stage 3 (FIRST, pre-fill) | `server.ts:1658-1659` |
| `MaterialGenerationBrief` | `{id,slotId,visualFormFamily,visualForm,assetType,count,targetTheme,copyContext[],promptPack[],styleConstraints{aspectRatio,mood,avoidSampleLookalike},structureConstraints{intendedRendererCapability,motionPattern,slotRole,durationSec?},negativePrompts[],evidenceRefs{sampleEvidenceFrameIds,note},privacyPolicy{externalUploadAllowed,sampleFramesAllowedToProvider:false,targetAssetsAllowedToProvider}}` | `createMaterialGenerationBriefs` (`aigcMaterialPlanner.ts:175`) |
| `AigcMaterialFillConfig` | `{enabled,provider,maxAssetsPerRun:8(image)/1(video),allowExternalUpload,allowSampleFramesToProvider:false,...}` | `server.ts:1662-1670`; provider from `AIGC_IMAGE_PROVIDER`/`AIGC_VIDEO_PROVIDER` |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| `candidates` (GeneratedAssetCandidate[]) | `{id:'generated_<slotId>_NN',briefId,slotId,provider,model,type,materialRole:'aigc_generated_material',path,prompt,negativePrompt,provenance{generatedAt,userApproved:false,externalProviderUsed,sampleFramesSentExternally:false,targetAssetsSentExternally:false},quality}` | `aigc-material-fill.json.candidates` |
| `quality` (GeneratedAssetQualityResult[]) | `{candidateId,slotId,usable,slotFitScore,targetThemeFitScore,noSampleCopyScore,textArtifactRisk,deterministicChecks[],vlmStatus,issues}` | `aigc-material-fill.json.quality`; usable filter `server.ts:1748` |
| `generatedTargetAssets` (TargetAssetInput[]) | `{id,kind,role,path,filename,tags['target_material','aigc_generated_material',...],metadata{materialRole,provider,model,briefId,slotId,quality,provenance}}` | appended to `request.targetAssets` → 2nd `generateMigrationResult`; `aigc-material-fill.json.generatedTargetAssets` |

**Implementation.** `aigcMaterialPlanner.ts:175`; `aigcMaterialProviders.ts:714` (googleGeminiImageProvider / Nano Banana); `aigcMaterialQualityGate.ts:63`; `server.ts:1630,1747,1553`.
**Model usage.** **GENERATIVE.** `google_gemini_image` = Gemini Nano Banana (`gemini-3.1-flash-image`, text-only prompt → `inlineData` image). Backup `volcengine_seedream` (`doubao-seedream-5-0-260128`). Video `seedance_2_0` (`doubao-seedance-2-0-fast-260128`). Quality gate **deterministic** (PNG/JPEG/WEBP header dims, path/secret regex, provenance flags); optional VLM review sees only the GENERATED output, never sample frames.
**Real example (motion_graph_2).** `enabled=true, requestedProvider='seedance_2_0', externalProviderUsed=true, sampleFramesSentExternally=false`. 5 briefs, 11 candidates (`volcengine_seedream×6, google_gemini_image×4, seedance_2_0×1`; image×10, video×1), usable=11/11. `providerFallbackReason='Primary AIGC provider google_gemini_image failed (...response did not include an inlineData image part.); used backup volcengine_seedream.'` `generated_slot_moving_hero_object_01`: `provider='google_gemini_image', model='gemini-3.1-flash-image', path='storage/generated/aigc-materials/generation_no82wu/slot_moving_hero_object_image_01_gemini.jpg', 768x1376 jpeg, slotFitScore=0.86, noSampleCopyScore=0.96, textArtifactRisk=0.08, vlmStatus='ok'` — the exact asset later bound to `slot_moving_hero_object`.
**Notes.** Privacy invariant holds: `sampleFramesAllowedToProvider=false` in every brief; all providers throw if true (`providers.ts:721`); `evidenceRefs.sampleEvidenceFrameIds` are STRUCTURE-only hints (`note='do not copy visual content'`), never uploaded. DEFAULT config is `enabled:false` + provider `deterministic_local_image_fill`; external generation only with `allowAigcMaterialGeneration && allowExternalAigcProvider` (both true here).

---

### (9) Stage 4 — timeline_generation (buildTimeline → buildRenderRecipe → migrateRenderRecipeToV4_1 → structureExplanation)

**Purpose.** Deterministically compose the new video's `Timeline` and the renderer-agnostic `RenderRecipe` (the heart of the engine) from template + fill plan + brief — never copying sample pixels/audio.

**Triggered by.** `generateMigrationResult(input)` (`planner.ts:4683`): `buildTimeline` (`:4162`) → `buildRenderRecipe` (`:3612`) → `migrateRenderRecipeToV4_1` (`renderRecipeV41.ts:255`) → `generateStructureExplanation` (`structureExplanation.ts:41`).

| Input | Shape / fields | Source |
|---|---|---|
| `template` | `{videoType,segments[],requiredSlots[],structureAtoms[],rhythm{bpm},audioStructure{bpm,strongBeats[],estimatedLayers},visualElementGraph,typographyEvidence[],heroDescriptor,motionAtoms[]/techniqueAtoms[],dominantHexPalette[]}` | `learned-template.json` |
| `fillPlan` (FillAction[]) | `{slotId,strategy,targetClipId?,rendererInstructions{boundAssetId,motionSpec,placeholderSpec,targetCopy,brandName,cta}}` | `fill-plan.json` (recomputed inside) |
| `mappings` | `{slotId,status,selectedTargetAssetId(s),selectedTargetAssetKind,selectedShotId,visualFormFamily,assetAvailability,reason}` | `slot-mapping.json` |
| `request` + controls | `{target,targetAssets[],constraints{noSampleVisualCopy},controls{recipeEvidencePrimitives,recipeAdaptiveStructure,subtitleGenerationMode,pace,packagingStyle,hookIntensity,ctaStyle,enableCreativeEffects}}` | `run-marking-pipeline.mjs:67` |
| `source` | `{assetId,reusableAsMaterial,materialRole,warnings[]}` | `understandSourceVideo` |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| `timeline` (Timeline) | `{id,durationSec,aspectRatio,rendererTarget,clips[]{id,role,startSec,durationSec,type,subtitleText,layers[]{kind,text,style,assetId},motionPrimitive,visualFormFamily,beatTimestamps},renderPlan{width,height,fps,background,motionAtoms,beatGrid{status,bpm,beats[]},audioPolicy('synth_beat'),audioRef,audioPlan{policy('user_bgm'),bpm,beatGridSec[],strongBeatsSec[]},rendererBackend,renderRecipe},warnings[]}` | `timeline.json`; `renderPlan.renderRecipe` consumed by render + gates |
| `renderRecipe` (DUAL v1+v4.1) | `{schemaVersion:'render-recipe-v1',version:'render-recipe-v4.1',videoType:'beat_cut_product',productTheme,composition{width:720,height:1280,fps:30,durationSec,aspectRatio:'9:16'},sourcePolicy{sampleFrameCopyAllowed:false,sampleAudioCopyAllowed:false},evidenceSummary{preservedEvidence{...}},motionAtoms[],global{palette[],bpm,beatGridSec[],cutPattern,audioPlan{policy:'procedural_bgm',layers{drone,riser,hats,impact}}},clips[]{id,role,startSec,endSec,atomIds[],layerIds[],evidenceRefs[],slotId,visualFormFamily,selectedPrimitive,primitiveReason,material{kind,assetIds[],policy,provenance},layout{bboxNorm?},motion{pattern,beatAligned,beatTimestampsSec[]},text{copy,colorRoles[],animationHint,fontSizeRatio?}},layers[]{type:media｜text｜motion_atom｜audio｜shape｜transition},warnings[],providerDecisions[],modelRouteSummary,recipeLintReport,videoCriticReport,structureExplanation}` | `render-recipe.json` (==`render-recipe.base.json`, byte-identical); embedded as `timeline.renderPlan.renderRecipe` |
| `structureExplanation` | `{summaryZh,bulletStepsZh[],sampleLearned[],mappedToNewContent[],gapsAndRepairs[],renderSummary[],providerSummary[],safetySummary[],demoNarrationZh}` | `structure-explanation.md` + `generation.json.structureExplanation` |

**Implementation.** `planner.ts:4162,4374,3612,3659,3821,3827-3856,3986,4683-4784`; `renderRecipeV41.ts:255,218,343`; `structureExplanation.ts:41`.
**Model usage.** **DETERMINISTIC, no model.** `modelRouteSummary` records `transfer_planning, natural_edit, json_schema_repair, structure_explanation, recipe_lint, technique_atom_extraction` all → `deterministic_planner`. No external model decides pixels.
**Real example (motion_graph_2).** `composition={width:720,height:1280,fps:30,durationSec:15.01,aspectRatio:'9:16'}`; 5 clips, 13 layers (`media×3, text×5, motion_atom×1, audio×4` — no shape/transition). `selectedPrimitives = ProductHeroOrbit, SourceClipBeatMontage, KineticTypographySweep, ImpactFlash, CTAEndSlate`. `clip_rhdddc` role=hook 0–4.48s, `primitiveReason='Preserved learned motionPrimitive=neon_hero_intro → ProductHeroOrbit; …'`, media `material={kind:'target_image',assetIds:['generated_slot_moving_hero_object_01'],policy:'renderable',provenance:'aigc_generated'}`, `layout.bboxNorm={x:0.229,y:0,w:0.692,h:0.844}`, `motion.pattern='orbit'`. text `content='蓝山精品挂耳咖啡（drip co', typography{fontSizeRatio:0.144,weight:900,color:'#f5f5f5'}`. `global.audioPlan={policy:'procedural_bgm',layers:{drone:0.24,riser:0.4317,hats:0.16,impact:0.18}}`. `evidenceSummary.preservedEvidence={visualElements:31,typographyRuns:22,motionAtoms:1,audioLayers:3}`.
**Notes (dual-shape / dual-vocabulary).** `effectProgramIds` is **absent** (verified 0 occurrences in render-recipe.json) — creative-effect codegen OFF (the `controls.enableCreativeEffects`/`ENABLE_CREATIVE_EFFECTS=1` gate at `planner.ts:3830` not set). The same object carries BOTH `schemaVersion:'render-recipe-v1'` (legacy fields) AND `version:'render-recipe-v4.1'` (migration overlay); `validateRenderRecipe` routes by `version==='render-recipe-v4.1'`. **Two audioPlan shapes intentionally differ:** `recipe.global.audioPlan.policy='procedural_bgm'` vs `timeline.renderPlan.audioPlan.policy='user_bgm'` (+ `renderPlan.audioPolicy='synth_beat'`). **Two layer vocabularies:** timeline clip.layers use legacy TimelineLayer kinds; v4.1 `recipe.layers` use the 6-kind union keyed by `type`. `selectPrimitive` (evidence-driven) only runs when `recipeEvidencePrimitives===true` (true in marking); `dominantHexPalette` leads the palette only then (mg2 starts `#020408,#162541`, cool).

---

### (10) Stage 5 — schema_validation + multi-version recipes

**Purpose.** Validate the `GenerationRequest` and assembled `Timeline` against AJV JSON-Schemas (hard gate before/after composition), run recipe lint + offline critic, and produce alternate version recipes (high_click/high_quality) with a version-diff.

**Triggered by.** `validateGenerationRequest(request)` (`planner.ts:4685`, throws `:4687`) + `validateTimeline(timeline)` (`:4703`, throws `:4705`); `lintRenderRecipe` (`:4768`) + `critiqueVideoOffline` (`:4769`). Multi-version: `run-marking-pipeline.mjs:241-255` loops `['high_click','high_quality']`; alternate export path `buildRecipeVersions` (`versionStrategies.ts:145`).

| Input | Shape / fields | Source |
|---|---|---|
| `request` | validated vs `generationRequestSchema` (`schemas.ts:362`, root required `['projectId','inputMode','prompt','target']`, `additionalProperties:false`) | `buildRequest()` |
| `timeline` | validated vs `timelineSchema` | Block 9 |
| `renderRecipe` | v4.1 → `renderRecipeV41Schema`; lint checks SUPPORTED_PRIMITIVES, bbox, provenance, evidenceRefs, fallback reason, prompt-leak | Block 9 |
| `versionStrategy` | `'high_click'｜'high_conversion'｜'high_quality'` (`types.ts:1247`) | `buildRequest(...,vs)` adds top-level `request.versionStrategy` |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| validation result | `{generationRequest:{valid,errors[]},timeline:{valid,errors[]}}` (errors `${instancePath||'/'} ${message}`) | `generation.json.validation`; invalid → thrown Error aborts |
| `recipeLintReport` | `{status:'pass'｜'warn'｜'fail',issues[],safeToAutoPatch,patches[]}` | `render-recipe.json` + `generation.json` |
| `videoCriticReport` | `{score,issues[],suggestions[],confidence,deterministicGateRefs[]}` | `render-recipe.json` |
| version recipes + diff | `render-recipe.{high_click,high_quality}.json` + `version-diff.md`; or `buildRecipeVersions → RecipeVersionResult{strategy,recipe,diff{changedDimensions[]}}` | per-strategy files / `version-diff.md` |

**Implementation.** `planner.ts:4685-4688,4703-4706`; `validation.ts:79,95,51`; `schemas.ts:362-368`; `recipeLint.ts:127,48`; `versionStrategies.ts:72,145`; `run-marking-pipeline.mjs:241-255,67-81`; `export-submission-artifacts.mjs:188-200`.
**Model usage.** **DETERMINISTIC.** AJV 2020 + deterministic recipeLint + offline critic. `videoCriticReport.confidence='medium'` but suggestions say "Keep deterministic gates as the source of truth; optional VLM critic should not override hard safety gates."
**Real example (motion_graph_2).** BASE passed: `validation={generationRequest:{valid:true},timeline:{valid:true}}`; `recipeLintReport={status:'pass',issues:[],patches:[]}`; `videoCriticReport={score:82,issues:[{severity:'warn',kind:'sample_copy_risk',message:'2 external sample media upload routes recorded; verify analysis-only policy.'}],deterministicGateRefs:['recipe_lint','model_route_summary']}`. BUT both version recipes **FAILED** — `version-diff.md`: `base | ProductHeroOrbit, SourceClipBeatMontage, KineticTypographySweep, ImpactFlash, CTAEndSlate | 13` then `high_click | Invalid generation request: / must NOT have additional properties | -` and the same for `high_quality`.
**Notes (REAL BUG — verified).** `buildRequest()` (`:76`) injects `versionStrategy` at the **top level** of GenerationRequest, but `generationRequestSchema` has root `additionalProperties:false` and does **not** declare it. So `validateGenerationRequest` fails at instancePath `''` → formatted `/`, `planner.ts:4687` throws `Invalid generation request: / must NOT have additional properties`, caught at `run-marking-pipeline.mjs:247`. **Net effect:** `render-recipe.high_click.json`/`high_quality.json` were NOT produced for motion_graph_2 (confirmed on disk — only `render-recipe.json` + `render-recipe.base.json` exist, byte-identical). The correct path is `buildRecipeVersions`/`applyVersionStrategyToRecipe` (mutates a clone, no re-validation). Fix generally: add `versionStrategy` to the request schema, or pass via controls, or use `buildRecipeVersions` — never hardcode per case.

---

### (5a) Motif spec — deterministic CreativeEffectSpec *(codegen path, OFF in full run)*

**Purpose.** Map filename-free evidence (OCR/palette/technique-keywords/videoType/bpm) to one of 6 motif families and emit a renderer-agnostic, props-driven `CreativeEffectSpec` (`creative-effect-spec.v1`). The seed for all later codegen.

**Triggered by.** `buildDeterministicCreativeEffectSpecFromEvidence(input)` → `mapEvidenceToMotifFamily`. Called by `run-live-codegen-eval.mjs:505` (eval) and `generate-effect-from-sample.mjs:137` (apply). **Flag-gated: OFF in marking_run** (no `creativeEffectSpecId` in any recipe).

| Input | Shape / fields | Source |
|---|---|---|
| `CreativeEffectEvidenceInput` | `{id?,caseId?,ocrText?:string[],palette?:string[],techniqueKeywords?:string[],visualForms?:string[],videoType?:string,bpm?:number,evidenceRefs?:string[],hasChineseText?:boolean}` | eval: `live.json.motifEvidence`; apply: `evidenceFromAnalysis()` from analysis.json+template. **NEVER** filenames/paths/pixels |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| `CreativeEffectSpec` | `{version:'creative-effect-spec.v1',id,caseId?,motifFamily,effectName,visualDescription,motionBehavior[],transitionBehavior[],requiredProps[],reusableRules[],forbiddenOverfitRules[],evidenceRefs[],safety{noSamplePixelCopy:true,noSampleAudioCopy:true,propsDriven:true,noRuntimeNetwork:true},source:'deterministic',createdAt}` | `creative-effect-spec.local.json`/`.json`; consumed by 5d (`selectEffect`) via `motifFamily` and 5c as `input.spec` |

**Implementation.** `creativeEffectSpec.ts:162,236,91,75`.
**Model usage.** **Deterministic** — regex/keyword scoring + static `MOTIF_TEMPLATES`.
**Real example (eval, editing case).** `creative-effect-spec.local.json`: from editing evidence (`palette #000000/#FFFFFF/#FF0000/#FFFF00`, techniqueKeywords `['kinetic typography','hard cuts','beat sync',...]`, `videoType='editing_tutorial'`, bpm 150) the classifier emitted `motifFamily='card_orbit_motion_graph'`, `effectName='CardOrbitStack'`, `source='deterministic'`, safety all true.
**Notes (real classifier discrepancy).** For editing the mapper chose `card_orbit_motion_graph` (Chinese-beat-cut branch needs `videoType=beat_cut OR glitch/whip+bpm>128`; here videoType was `'editing_tutorial'` so the beat_cut branch scored 0). The Gemini layer-plan (5b) AND the oracle say `beat_cut_chinese_editing_tutorial`, so eval failed `motif_local_matches_expected` — the HIGH_BPM/classifier class of bug; a mismatch here cascades. `mapEvidenceToMotifFamily` uses ONLY learned signals, never filenames.

---

### (5b) Layer plan — codegenLayers[] *(codegen path, OFF in full run)*

**Purpose.** Produce the authoritative per-section layer timeline driving the generated component's fixture + `<Sequence>` schedule. **TWO sources:** full-pipeline = deterministic timeline/recipe; eval = Gemini-vision on a **contact-sheet IMAGE** + deterministic summaries, graded against a hand-authored `evalAssertions` oracle.

**Triggered by.** eval: `run-live-codegen-eval.mjs main() → geminiJsonWithImage()` (`:499`), mapped via `toCodegenLayerPlan()` (`:46`). full-pipeline: deterministic timeline.json/render-recipe.json (no Gemini layer-plan).

| Input | Shape / fields | Source |
|---|---|---|
| contact-sheet image (eval only) | JPEG base64-inlined as `parts[].inlineData{mimeType:'image/jpeg',data}` | `expected_codegen_eval_bundle/video_analysis/<case>_contact.jpg` — a STILL, NOT the sample video |
| `compactExpectedForPrompt` | `{caseId,source{...},expectedEvalAssertions[],audio,visualChanges,hardRules{samplePixelsAllowedInFinal:false}}` | `expected_codegen_layers_eval.json` (cases[case].evalAssertions = ORACLE) + audio/visual summaries |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| `actual-codegen-layers.json` | `{caseId,motifEvidence,observedVisualGrammar{motifFamily,summary,timeline[]},creativeEffectSpec,effectSelection,codegenLayers[]{id,type:'media｜motion_atom｜text｜transition｜audio',kind,startSec,durationSec,zIndex,expectedRenderer,params},audioFallback,safety}` | `motifEvidence`→5a; `codegenLayers`→5c via `toCodegenLayerPlan()`; graded by `evaluateCase()`→`eval-result.json` |
| `CodegenLayerPlanInput` (mapped) | `{caseId,motifFamily,durationSec,layers[]{id,type,startSec,durationSec,role,semanticTags,params}(≤60),audio,safety}` | `generateRemotionEffectProposal` (5c) |

**Implementation.** `run-live-codegen-eval.mjs:124,187,46,262`; `buildGeminiEffectPrompt.ts:40`.
**Model usage.** eval: Gemini multimodal `generateContent` (model `AI_GEMINI_MODEL`, real run `gemini-3.5-flash`, temp 0.1, JSON, maxOutputTokens 65536). full-pipeline: deterministic.
**Real example (eval, editing).** 8 codegenLayers (1 audio bgm 0–118.21s bpm150, 5 motion_atom text cards e.g. `{text:'注意镜头的切换',backgroundColor:'#000000',textColor:'#FFFFFF',accentColor:'#FF0000',fontSize:64,animation:'scale_pop'}`, 2 media video_insert placeholders), `observedVisualGrammar.motifFamily='beat_cut_chinese_editing_tutorial'`. ORACLE assertions include `['Chinese kinetic text is primary, not English',...,'does not copy Douyin UI, author handle, FENDA watermark, or movie frames']`; `minimumLayerCounts {media:2,text:2,motion_atom:3,transition:1,audio:2}`; `eval-result.json pass=false` (LLM put text in `motion_atom` not `text`, only 1 audio layer).
**Notes (dual-path).** Full marking_run uses deterministic timeline/recipe and does NOT run this Gemini layer-plan (no `actual-codegen-layers.json` in marking_run). The eval path is the ONLY place codegenLayers come from Gemini, and Gemini sees a **still contact-sheet + numeric summaries** — never the sample video or audio. The oracle is hand-authored in `expected_codegen_layers_eval.json`, used by `evaluateCase()` as grader.

---

### (5c) Component codegen — generate Remotion effect proposal *(codegen path, OFF in full run)*

**Purpose.** Turn `CreativeEffectSpec` + layer plan + recipe context + product theme into a reusable, sandbox-safe Remotion effect module (`index.tsx`/`schema.ts`/`fixture.json`/`README.md`) under strict zod/safety/non-blank/full-coverage contracts. Calls Gemini only when explicitly enabled; else a safe local fallback. **Never executes generated code.**

**Triggered by.** `generateRemotionEffectProposal(input,options)`. Enabled ONLY when `GEMINI_API_KEY && CREATIVE_EFFECT_GEMINI=1 && ALLOW_CLOUD_PROVIDERS=1` (`:54-56`); else `local_fallback`. Invoked by `run-live-codegen-eval.mjs:528`, `generate-effect-from-sample.mjs:153`.

| Input | Shape / fields | Source |
|---|---|---|
| `BuildEffectPromptInput` | `{spec:CreativeEffectSpec,evidenceSummary?,contactSheetPathMeta?{fileName,frameCount?,note?}(METADATA ONLY — no image bytes),recipeContext?{width,height,fps,durationSec,palette[]},productTheme?{name,category,cta},codegenLayerPlan?:CodegenLayerPlanInput}` | spec from 5a; layerPlan from 5b; recipeContext from expected/recipe.global; productTheme hardcoded in eval / recipe.productTheme in apply |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| `GenerateProposalResult` | `{proposal{version,effectId,motifFamily,effectName,componentName,files{'index.tsx','schema.ts','fixture.json','README.md'},provider:'gemini'｜'local_fallback',model?,promptHash,safetyNotes[]},status:'gemini_ok'｜'local_fallback'｜'provider_error'｜'invalid_response',provider,model?,promptHash,prompt,rawResponse?,pureGeminiOutput{status,parsedJson?,envelopeValidation?,contractViolations?},error?}` | `writeGeneratedEffectProposal()` → 4 files + `proposal-metadata.json`; consumed by 5d (`validateGeneratedEffect`) |

**Implementation.** `generateRemotionEffectProposal.ts:435,285,246`; `buildGeminiEffectPrompt.ts:205`; `generatedEffectProposal.ts:65`.
**Model usage.** Gemini text `generateContent` (model `GEMINI_CODEGEN_MODEL ?? AI_GEMINI_MODEL ?? 'gemini-3.5-flash'`; real run `gemini-3.5-flash`, temp 0.4, JSON, maxOutputTokens 65536; `finishReason=MAX_TOKENS` → truncation error). Disabled → templated `local_fallback` TSX.
**Real example (eval, editing).** `proposal/`: status `gemini_ok`, provider `gemini`, model `gemini-3.5-flash`, `promptHash 53e1d222acb458a4`. `gemini-prompt.txt` opens `'You are generating a reusable Remotion React component. Target motif family: card_orbit_motion_graph / Effect name: CardOrbitStack'` + `'fixtureJson.durationSec MUST equal 118.21'` + the 8-layer Layers JSON. `index.tsx` is a REAL 565-line Gemini component (imports `remotion {interpolate,spring,useCurrentFrame,useVideoConfig,Sequence,AbsoluteFill}`) — not the ~30-line fallback. `fixture.json: {width:1280,height:720,fps:24,durationSec:118.21,colors:[#000000,#FF0000,#FFFF00,#FFFFFF,#1A1A1A],texts:[{text:'注意镜头的切换',role:'title_1'},...],assets:[],proceduralFallback:true}`.
**Notes.** **CODEGEN RECEIVES NO SAMPLE VIDEO/PIXELS** — only METADATA: `contactSheetPathMeta.fileName` (a string used to phrase "STYLE inspiration only"), spec text, layer numbers, recipe dims/palette. `defaultGeminiCall` sends TEXT parts only. `gemini_ok` is returned only when the static safety scan (`scanProposalContractViolations`: forbidden module/literal/import, zod-API allowlist, exact `import { z } from "zod"`, `fixture.proceduralFallback:true + assets:[]`) is CLEAN — else `invalid_response` falling back to local. The prompt carries a HARD NON-BLANK/full-coverage contract (every `<Sequence>` paints an opaque AbsoluteFill bg + animated fg over `[0,durationSec]`). The editing proposal inherited the 5a motif mismatch (`card_orbit_motion_graph`).

---

### (5d) validate → apply → promote → select *(codegen path, OFF in full run)*

**Purpose.** Gate a proposal (static safety + TS parse + export + props + fixture + best-effort Remotion preview), optionally register it into production (generated source + `EffectKnowledgeBase` + static `effect-manifest.ts`), gate promotion behind explicit `--promote`, and resolve the motif family to concrete `effectProgramIds` attached to the recipe.

**Triggered by.** `validateGeneratedEffect(proposalDir)`; `applyGeneratedEffect(...)` on `--apply` when `safeToApply`; `selectEffect({motifFamily,preferGenerated,strictEffectCoverage})` (`effectRegistry.ts:51`); `attachCreativeEffectToRenderRecipe(...)`.

| Input | Shape / fields | Source |
|---|---|---|
| proposal dir + KB | validate: proposalDir (4 files + metadata). apply: `GeneratedEffectProposal + validation{validationStatus,safeToApply,exportStyle} + caseId + force/promote`. select: `EffectSelectionInput{motifFamily,preferGenerated?,strictEffectCoverage?,componentExists?} + EffectKnowledgeBaseFile{version:'effect-kb.v1',entries[]}` | proposal from 5c; KB from `docs/artifacts/effect-kb/effects.json` (built-ins always via `withBuiltIns`); motifFamily from 5a |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| `validation-report.json` | `{validationStatus:'pass'｜'pass_with_preview_blocker'｜'fail'｜'not_required',failedChecks[],warnings,previewStatus,exactErrors[],safeToApply,exportStyle:'named'｜'default'}` | `proposal/`; `safeToApply` gates apply |
| `EffectKnowledgeEntry` + `effect-manifest.ts` | `{id,motifFamily,effectName,componentName,componentPath,propsSchemaPath,source:'generated',provider,validationStatus,promoted:(--promote),defaultExport,learnedFromSamples[caseId],applicableWhen,avoidWhen,requiredProps}` | upsert into `effect-kb/effects.json` (atomic temp+rename); regenerated manifest (valid + on-disk only) |
| `EffectSelectionResult` → `recipe.effectProgramIds` | `{selected,effectProgramIds[],effectNames[],source:'generated'｜'built_in'｜'legacy_fallback'｜'none',fallbackReason?,motifFamily,requiredProps}`; attach adds `{creativeEffectSpecId,motifFamily,effectProgramIds,effectPropsById,effectSelection}` | `render-recipe.json.effectProgramIds` (full pipeline = `[]`/absent); `effectPropsById` = props-only runtime props (no sample paths) |

**Implementation.** `validate-generated-effect.mjs:43-60,17`; `generate-effect-from-sample.mjs:34,208`; `effectRegistry.ts:51`; `effectKnowledgeBase.ts:177`; `creativeEffectAttach.ts:116`.
**Model usage.** **Deterministic** (static TS/safety + FS registration + selection). Optional `--repair` may re-call Gemini up to 2×, but validate/apply/promote/select are deterministic.
**Real example (apply-proof).** `docs/artifacts/codegen-live-eval/hardened-editing-v1/apply-proof/apply-proof-all-report.json`: motion_graph_2 effectId `blue_spotlight_ui_pitch`, `selectsGenerated=true, selection.source='generated', effectProgramIds=['blue_spotlight_ui_pitch'], inManifest=true, render.status='completed', audioMeanVolumeDb=-15.3, audioOk=true`. KB holds 5 built-ins (`not_required`) + generated entries where `ribbon_poster_sweep`/`card_orbit_stack`/`blue_spotlight_ui_pitch` are `promoted=true` (`pass_with_preview_blocker`) while `GenericMotionGraph_local_*`/`RibbonPosterSweep_local_*` are `promoted=false`. editing proposal `validation-report.json`: `validationStatus='pass_with_preview_blocker', safeToApply=true, exportStyle='named', failedChecks=[]`.
**Notes.** **apply≠promote:** `applyGeneratedEffect` always registers (`source=generated`) but `entry.promoted=(--promote===true)`; `selectEffect`/`findValidatedGeneratedEffectByMotif` only let a generated effect OVERRIDE a built-in when `promoted=true AND validation passed AND source file exists on disk`. `pass_with_preview_blocker` still counts as `safeToApply`. **Dual-path:** in marking_run codegen is OFF — `selectEffect`/attach not run, so `render-recipe.json` has NO `effectProgramIds` field (grep across all marking_run recipes = empty); `effectProgramIds=[]` is the documented OFF state. KB writes atomic. The static validator re-checks the same safety denylist as 5c (defense in depth) and rejects hallucinated imports like `Extrapolate`.

---

### (11) FFmpeg Render

**Purpose.** Composite the final MP4: render each `TimelineClip` to a segment (real resolved AIGC/source asset at the recipe's `bboxNorm`, else a beat-cut primitive / family proxy card), concat, apply motif-specific FFmpeg overlay fallbacks when an effect is selected, mux audio, extract preview frames.

**Triggered by.** `selectRenderer("ffmpeg",opts) → selectRendererBackend("ffmpeg_compose") → new FFmpegRenderer(opts).render(timeline,generationId)`.

| Input | Shape / fields | Source |
|---|---|---|
| `timeline` | `Timeline{aspectRatio:'9:16',durationSec,clips[]{id,role,startSec,durationSec,type,subtitleText,sourceAssetId,visualFormFamily,motionPrimitive,placeholderSpec,layers[]{kind,assetId,style{fillStrategy,materialSource,targetAssetIds,elementGeometry,typography,heroDescriptor}}},renderPlan{fps,audioPolicy,audioRef,audioPlan,adapterOptions{packagingStyle},renderRecipe,beatGrid{bpm}}}` | `timeline.json`; renderRecipe==render-recipe.json |
| resolved assets | `AssetPathResolver.resolve(assetId)→absolute path` (clip.sourceAssetId, layer.assetId, style.targetAssetIds AIGC `generated_slot_*`) | `opts.assetResolver`; resolves `aigc-material-fill.json` materials |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| `final.mp4` (RenderOutput.outputPath) | `{renderId,generationId,rendererTarget:'ffmpeg',status:'completed',outputPath,previewHtml,clipPreviewFrames[],renderQualityWarnings?,effectProgramIds?,ffmpegEffectFallbackUsed?,error?}`; MP4 720x1280 h264 yuv420p AAC | `docs/artifacts/marking_run/<case>/final.mp4`; consumed by render-quality + final-gates |
| clip preview frames | PNG `scale=240:-2` per clip `generated/previews/<renderId>/clip_N.png` | web preview; `RenderOutput.clipPreviewFrames` |

**Implementation.** `renderers.ts:989` (render), `:1289` (renderClip @bboxNorm), `:1304` (throws if AIGC assets present but none resolve), `:1435` (renderBeatCutPrimitive), `:715/735` (effect fallback), `:1039-1056` (overlay pass), `:153` (pickResolution 9:16→720x1280).
**Model usage.** **Deterministic** — pure FFmpeg (conda `viral/bin/ffmpeg`) + libx264. AIGC images/audio generated upstream.
**Real example (motion_graph_2).** `case-summary.json final = {duration:15.01,width:720,height:1280,meanVolumeDb:-19.3}`; final.mp4 = 1,818,493 bytes; `videoType="beat_cut_product"`. `render-quality.json` gate `output_portrait_9_16` passed `"720x1280"`. `renderStats {blackBgRatio:0.5,cutDensity:0.533,shots:8}`.
**Notes.** Full-pipeline: `recipe.effectProgramIds` ABSENT, so `planFfmpegEffectFallback` returns `ffmpegEffectFallbackUsed=false` and the effect-overlay pass is skipped (non-effect renders byte-for-byte unchanged). Eval/codegen-demo (`marking/demo-videos`) is the only path setting `effectProgramIds`. **Gotcha:** FFmpeg cannot execute TSX → only motif-keyed `drawbox`/`drawtext` fallbacks via `MOTIF_FFMPEG_FALLBACK_LAYERS`. Honesty warnings (`moving_material_missing`, `beat_alignment_unverified`) pushed to `renderQualityWarnings`. `parametric_ribbon_surface` approximated by 2D drawbox overlays (`layer.fallback.mode="simple_overlay"`).

---

### (12) Remotion Render

**Purpose.** Render the recipe via React/Remotion `ViralRecipeRoot` (sorted `layers[]` as `<Sequence>`→LayerView, or `clips[]`→ClipView, or EffectLayer when `effectProgramIds` present), producing a silent MP4, then mux the shared procedural audio bed so the output isn't −91dB silent.

**Triggered by.** `selectRenderer("remotion_recipe",opts) → new RemotionRenderer({compositionId:"ViralRecipe"}).render(timeline,generationId)`.

| Input | Shape / fields | Source |
|---|---|---|
| `inputProps{timeline,assetMap}` | timeline (carries `renderPlan.renderRecipe`); `assetMap: Record<assetId,{src,ext}>` — `data:` URL for images, `http://127.0.0.1:<port>/asset/<id>` for video (OffthreadVideo) | `timeline.json`; assetMap from assetResolver over recipe layers/clips |
| `recipe.layers[]/clips[]/global` | `RecipeLayer{type:media｜text｜motion_atom｜audio,zIndex,startSec,durationSec,material{assetIds,kind},layout{bboxNorm,fit,align,minAreaRatio},text{content,role},typography{fontSizeRatio,color,colorRole,weight,shadow},animation{enter,beatReactive{beatRefs}},atom{kind,direction,path,colorRoles}}`; `global.palette/fps/durationSec` | `render-recipe.json` |
| `recipe.effectProgramIds/effectPropsById/motifFamily` | `effectProgramIds:string[](optional); effectPropsById:Record<id,CreativeEffectRuntimeProps{width,height,fps,durationSec,colors,texts,beats}>` | `render-recipe.json` (ABSENT in full pipeline); when present ViralRecipeRoot short-circuits to EffectLayer |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| `final.remotion.mp4` | `{renderId,rendererTarget:'remotion',status:'completed',outputPath,previewHtml,renderQualityWarnings?(no_audio｜audio_mux_failed),effectProgramIds?,effectFallbackReason?,effectSelectionSource?}`; MP4 720x1280 h264 + MONO AAC (`-ac 1`) | `docs/artifacts/marking_run/<case>/final.remotion.mp4` (2,215,064 bytes in mg2) |

**Implementation.** `renderers.ts:1790` (render: bundle, asset http server, renderMedia→silent), `:1957` (muxProceduralAudio `-map 0:v:0 + bed -ac 1 -shortest`); `ViralRecipeRoot.tsx:521` (effectIds→layers→clips precedence), `:364` (LayerView), `:392` (ClipView primitive switch), `:274` (ParametricRibbonSurface SVG), `:479` (EffectLayer).
**Model usage.** **Deterministic** — Remotion (@remotion/bundler + renderer) via chrome-headless-shell + FFmpeg mux.
**Real example (motion_graph_2).** `render-recipe.json layers[]` = 8 visual/motion + 4 audio; ViralRecipeRoot renders the 8 sorted by zIndex (media z10, motion_atom z30, text z40) — e.g. `layer_clip_rhdddc_media{assetIds:[generated_slot_moving_hero_object_01],fit:contain,bboxNorm{x:0.229,y:0,w:0.692,h:0.844}}` + `layer_clip_rhdddc_text{content:"蓝山精品挂耳咖啡（drip co",colorRole:on_dark,color:#f5f5f5,fontSizeRatio:0.144}`. `case-summary remotion={duration:15,width:720,height:1280}`. `effectProgramIds` absent → layers[] branch.
**Notes (P0 audio fix — verified in code).** ViralRecipeRoot carries NO `<Audio>`, so `renderMedia` alone yields a −91dB empty stereo track. The renderer now renders to `<name>.silent.mp4` when `audioPolicy!=silent`, then `muxProceduralAudio` adds the bed as MONO (`-ac 1`). Failure is non-fatal → silent + `renderQualityWarnings:[no_audio]`. **Dual-path difference vs FFmpeg:** `muxProceduralAudio` ALWAYS uses only `buildProceduralBedSources` — it does NOT layer the Lyria music bed / voiceover / SFX that FFmpeg's `addAudioTrack` uses. EffectLayer/effectPropsById only fire in the codegen path; dormant in the full pipeline. Video served over ephemeral 127.0.0.1 http (OffthreadVideo rejects `file://`); images inlined as `data:` URLs.

---

### (13) Audio Mix

**Purpose.** Build the final audio per `renderPlan.audioPolicy`: when `audioRef` resolves to a real (Lyria) bed it loops+ducks that bed and layers AIGC voiceover (full vol, +400ms) and SFX over it; otherwise synthesizes a layered procedural beat bed (drone+kick+bass+hat+pink-air+riser+per-strong-beat impacts) whose weights come from the sample's **learned** `audioPlan.layers`/BPM/strongBeats.

**Triggered by.** `FFmpegRenderer.render → addAudioTrack(preAudioPath,outputPath,timeline,totalDuration)`. AIGC audio injected upstream by `applyGoogleAudioMusic`/`applyElevenLabsMusic`/`applyGoogleAudioVoiceover`/`applyElevenLabsVoiceAndSfx` (`server.ts:2420-2423`).

| Input | Shape / fields | Source |
|---|---|---|
| `renderPlan.audioPolicy + audioRef` | `audioPolicy:'silent'｜'synth_beat'｜'sample_bgm'`; `audioRef`: abs path to music | `timeline.json`; audioRef set by `applyGoogleAudioMusic` (`server.ts:2103`) to the Lyria mp3 |
| `renderPlan.audioPlan{bpm,layers,strongBeatsSec,spectral*?}` | `layers:{drone,riser,hats,impact,(bass/kick/bass_kick),...}`; `strongBeatsSec[]`; `bpm` | `render-recipe.json global.audioPlan` + recipe audio layers; read by `buildProceduralBedSources` (`:917`) |
| `adapterOptions.googleAudioVoiceover/elevenLabsSfx` | `{provider,materialRole,path,provenance{source:aigc_generated,renderable:true},metadata}` | `server.ts:2236/2313`; read via `auxPath()` |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| mixed AAC track in final.mp4 | FFmpeg `[bed]volume=0.42 + [vo]volume=1.25,adelay=400 + [sfx]volume=0.7 → amix(duration=longest,normalize=0),highpass=f=30,alimiter → AAC 192k`, capped `-t <dur>`. Procedural branch: amix of lavfi `aevalsrc/anoisesrc` | audio stream of final.mp4; gate `audio_not_silent` reads `meanVolumeDb` |
| procedural bed source list (shared) | `string[]` of FFmpeg lavfi exprs: drone (55/82.5/110Hz) [+kick/bass if drumWeight>0.05] [+hat/pink-air if gAir>0.15] [+riser if gRiser>0.05] [+impact at strongBeats if gImpact>0.05] | used by BOTH `addAudioTrack` and `muxProceduralAudio` |

**Implementation.** `renderers.ts:917,1121,1149-1191,1196-1238`; `server.ts:2082/2216/2269`; `googleAudio.ts:105-106,153,183`; `elevenlabs.ts:205-214`.
**Model usage.** AIGC audio (upstream, paths injected): voiceover = `google_gemini_tts` (`gemini-3.1-flash-tts-preview`/env `GOOGLE_TTS_MODEL`); music = `google_lyria_music` (`lyria-3-clip-preview`/env `GOOGLE_MUSIC_MODEL`); sfx = `elevenlabs_sound_effects` (POST `/sound-generation`). The MIX itself is **deterministic FFmpeg**.
**Real example (motion_graph_2).** providerDecisions: voiceover→`google_gemini_tts`, music→`google_lyria_music`, sound_effect→`elevenlabs_sound_effects`, audio_analysis→`ffmpeg_librosa_audio_analysis` (all `fallbackUsed=false`). `recipe global.audioPlan={policy:"procedural_bgm",layers:{drone:0.24,riser:0.43166,hats:0.16,impact:0.18}},bpm:107.7`. timeline renderPlan: `audioPolicy="synth_beat"`, `audioRef=.../google_audio_1gwa8vy.mp3` (Lyria), `googleAudioVoiceover.path=.../google_audio_1y7yay9.wav`, `elevenLabsSfx.path=.../elevenlabs_audio_gskbl0.mp3`; `strongBeatsSec` has 32 entries (capped 36). Result `meanVolumeDb=-19.3` (gate passed, >−50dB).
**Notes (dual-path).** Although `audioPolicy="synth_beat"`, `audioRef` RESOLVED to the real Lyria mp3, so FFmpeg takes the audioFile branch (bed@0.42 + voiceover@1.25/adelay=400 + sfx@0.7), NOT the procedural-only path. `audioPlan.policy` was overwritten to `"user_bgm"` by `applyGoogleAudioMusic` (`server.ts:2107`) while `recipe.global.audioPlan.policy` stayed `"procedural_bgm"`. The Remotion path always plays only the procedural bed (mono). 100% synthesized procedural bed = no copyrighted/sample audio; weights evidence-driven (no sample-name branching).

---

### (14) Model Router (route resolution + ModelRouteSummary)

**Purpose.** Map each of 31 abstract `ModelTask`s to a concrete provider via a primary→fallback chain, attach a per-task `MediaAccessPolicy`, compute sample-media consumption flags, and aggregate a `ModelRouteSummary` — the run's provider-governance manifest.

**Triggered by.** `resolveModelRoute(task,options)` per task / `buildDefaultProviderDecisions(options)` / `buildModelRouteSummary(decisions,options)`. Emitted into `generation.json.providerDecisions` (top-level array) + `modelRouteSummary`.

| Input | Shape / fields | Source |
|---|---|---|
| `task` | `ModelTask` (31 literals incl. `video_structure_vlm, text_planning_llm, asr, ocr, visual_grounding, audio_analysis, image_fill, video_fill, voiceover, sound_effect, music, quality_judge, ...`) | `MODEL_TASKS` (`modelRegistry.ts:13`) |
| `options` | `ModelRouterOptions{env?,allowCloud?,allowSampleMediaExternal?,allowQualityJudgeSampleFrames?,enabledFeatures?,requestedProvider?,localCapabilities?,now?}` | pipeline; marking_run had `allowCloud=true + allowSampleMediaExternal=true` |
| `MODEL_ROUTE_TABLE[task]` | `ModelRouteConfig{task,primary,fallbacks[],localFallback?,requiredForCoreDemo,featureGate?,providerClass,effectScope,mediaAccessPolicy,candidateProviders?}` | `modelRegistry.ts:562-872` |
| `MODEL_PROVIDER_REGISTRY[id]` | `ModelProviderDefinition{id,displayName,providerClass,cloud,implemented,envVars?,heavyLocal?,...,mediaAccessPolicy}` | `modelRegistry.ts:47-538` |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| `ProviderDecision` (per task) | `{task,selectedProvider,providerClass,selectedReason,fallbackUsed,fallbackReason?,rejectedProviders[],mediaAccessPolicy,requiredForCoreDemo,featureGate?,effectScope,canAffectFinalPixels,canAffectFinalAudio,consumesSamplePixels/Audio/Video Locally/Externally,generatedAssetProvenanceRequired,severity,warnings?}` | `generation.json.providerDecisions[]` (31) + `modelRouteSummary.decisions[]` |
| `ModelRouteSummary` | `{version:'model-router-v4.2',generatedAt,decisions[],summary{totalTasks,requiredTasks,featureGatedRequiredTasks,fallbackUsed,fatal,unsafePolicyIssues,externalSampleMediaUploads,localSampleMediaAnalyses},effectScopeSummary,featureGateSummary,unsafePolicyIssueMessages[] + flattened compat aliases}` | `generation.json.modelRouteSummary`; consumed by G22/final-gates + provider-call enforcement |

**Implementation.** `router.ts:306,361,365,266,117,226,94`; `modelRegistry.ts:562`.
**Model usage.** **Deterministic** — pure config resolution. It NAMES the models other blocks call.
**Real example (motion_graph_2 — verified).** `version='model-router-v4.2'`, `summary={totalTasks:31, requiredTasks:14, featureGatedRequiredTasks:0, fallbackUsed:3, fatal:0, unsafePolicyIssues:0, externalSampleMediaUploads:2, localSampleMediaAnalyses:3}`; `effectScopeSummary={read_only_report:4, planning_affects_recipe:15, generation_affects_assets:6, rendering_affects_pixels:0, audio_affects_final_mix:3, quality_gate_only:3, no_effect:0}`. `video_structure_vlm`: `selectedProvider='gemini_vlm_current', fallbackUsed=false, mediaAccessPolicy={samplePixelsAllowed:true,sampleAudioAllowed:true,sampleVideoUploadAllowed:true}, consumesSamplePixels/Audio/VideoExternally all true`. `asr`: `elevenlabs_scribe, consumesSampleAudioExternally=true`.
**Notes (chains + safety).** Key primary→fallback chains: `video_structure_vlm: gemini_vlm_current→heuristic_vlm→frame_sheet_heuristics`; `asr: elevenlabs_scribe→faster_whisper→no_asr_with_warning`; `ocr: paddleocr_vl→paddleocr→easyocr_current→no_ocr_with_warning`; `image_fill: google_gemini_image→volcengine_seedream→deterministic_local_image_fill→remotion_shape_card`; `video_fill: seedance_2_0→remotion_procedural_motion→ffmpeg_proxy_motion`; `voiceover: google_gemini_tts→elevenlabs_tts→skip_with_warning`; `music: google_lyria_music→elevenlabs_music→procedural_synth→skip_with_warning`; `quality_judge: deterministic_gates→deterministic_gates_only`. The 3 real fallbacks in mg2 were all heavy-local-disabled (`ENABLE_HEAVY_LOCAL_ML` unset): ocr→`easyocr_current`, visual_grounding→`opencv_flow_ocr_heuristic`, knowledge_retrieval→`keyword_filter`. **Safety invariant:** sample-media access opened ONLY in `policyFor` (`router.ts:94`) for `gemini_vlm_current@video_structure_vlm` + `elevenlabs_scribe@asr`, and only when `allowCloud && allowSampleMediaExternal`; AIGC provider classes force-clamped to false (`router.ts:104-113`). **Dual-system gotcha:** there are TWO provider-policy systems — this v4.2 router and a separate legacy `engine/providerPolicy.ts` (`DEFAULT_PROVIDER_POLICIES[16]`, `mayReceiveSampleFrames=false`); same safety stance, different ids/fields.

---

### (15) Provider policy (MediaAccessPolicy presets + AIGC clamp)

**Purpose.** Define the `MediaAccessPolicy` presets every route references and the **const-false safety clamp** preventing any AIGC generation provider from receiving sample pixels/audio/video — enforced at route-resolution and via post-hoc validation.

**Triggered by.** Imported by `modelRegistry.ts` (presets) and `router.ts` (`policyFor` override + `isAigcProviderClass` clamp + `validateProviderDecisionSafety` + `assertProviderDecisionsSafe`).

| Input | Shape / fields | Source |
|---|---|---|
| `provider.providerClass` | `ProviderClass` union (`deterministic_local｜text_llm｜vlm｜asr｜ocr｜visual_grounding｜image_generation｜video_generation｜audio_generation｜...`) | `ModelProviderDefinition.providerClass` |
| `provider/route.mediaAccessPolicy` | `MediaAccessPolicy{samplePixelsAllowed,sampleAudioAllowed,sampleVideoUploadAllowed,outputPixelsAllowed,userAssetsAllowed,rawPromptRenderable,generatedAssetProvenanceRequired}` (all bool) | named presets `providerPolicy.ts:3-63` |
| `options.allowCloud/allowSampleMediaExternal/allowQualityJudgeSampleFrames` | booleans | `ModelRouterOptions`; gate the only sample-media openings (`router.ts:95-103`) |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| effective `MediaAccessPolicy` | 7 booleans. Presets: `BLOCK_SAMPLE_MEDIA_POLICY`, `DETERMINISTIC_LOCAL_POLICY`, `LOCAL_ANALYSIS_POLICY`, `LOCAL_PIXEL_ANALYSIS_POLICY`, `EXTERNAL_VLM_DEFAULT_POLICY`, `EXTERNAL_VLM_SAMPLE_MEDIA_POLICY`, `QUALITY_JUDGE_*`, `AIGC_GENERATION_POLICY` (all-sample false + provenance required), `AIGC_GENERATION_WITH_USER_ASSETS_POLICY` | per `ProviderDecision.mediaAccessPolicy` → `generation.json` |
| `unsafePolicyIssues` (string[]) | violation strings | `ModelRouteSummary.unsafePolicyIssueMessages` + `summary.unsafePolicyIssues`; `assertProviderDecisionsSafe` throws if non-empty |

**Implementation.** `providerPolicy.ts:3-63,50,65`; `router.ts:104-113,431-448`; `engine/providerPolicy.ts:10-219` (separate legacy system).
**Model usage.** **Deterministic.**
**Real example (motion_graph_2).** `image_fill mediaAccessPolicy={samplePixelsAllowed:false,sampleAudioAllowed:false,sampleVideoUploadAllowed:false,outputPixelsAllowed:false,userAssetsAllowed:true,rawPromptRenderable:false,generatedAssetProvenanceRequired:true}`, `consumesSamplePixels/Audio/VideoExternally` all false — `google_gemini_image` (cloud) selected yet receives ZERO sample media. `video_fill`/`voiceover`/`music` identical clamp. `unsafePolicyIssues=0`, `unsafePolicyIssueMessages=[]` across all 31.
**Notes.** The load-bearing safety boundary of "迁移结构, 不复制内容". The clamp (`router.ts:104-113`) spreads the policy but FORCE-overrides `samplePixelsAllowed/sampleAudioAllowed/sampleVideoUploadAllowed/rawPromptRenderable=false` + `generatedAssetProvenanceRequired=true` for any image/video/audio_generation provider — even a misconfigured registry entry can never grant sample access. **Field-name gotcha:** the artifact field is `samplePixelsAllowed` (not `sampleFramesAllowed`); the legacy engine system uses `mayReceiveSampleFrames`/`mayReceiveSampleAudio` — both independently hardcode no-sample-media for AIGC.

---

### (16) Storage (JsonStorageBackend atomic RMW + Database collections)

**Purpose.** Single-file JSON persistence: read the entire `Database` snapshot, mutate in memory, write back **atomically** (temp+rename) with corrupt-file quarantine, so concurrent readers (job-status polling during a large generation write) never observe a torn snapshot.

**Triggered by.** `DatabaseStore.read/write/upsert/remove/update` → `JsonStorageBackend.readDatabase/writeDatabase`. `dbPath = storage/db/app.json`.

| Input | Shape / fields | Source |
|---|---|---|
| Database snapshot (read) | `Database{projects[],assets[],jobs[],analyses[],templates[],atoms[],generations[],renders[]}`; `atoms` derived from `templates.flatMap(t=>t.template?.structureAtoms)` (`jsonBackend.ts:77`) | on-disk `storage/db/app.json` (`jsonBackend.ts:67`) |
| value/id/mutator | `upsert(collection,value)` / `remove(collection,id)` / `update(mutator)` | API handlers / pipeline (`store.ts:29-42`) |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| Database snapshot (write) | same shape, re-ordered by `COLLECTIONS=['projects','assets','jobs','analyses','templates','atoms','generations','renders']`, pretty JSON + trailing newline | `storage/db/app.json` via temp `${dbPath}.${pid}.${seq}.tmp` then `fs.rename` (`jsonBackend.ts:109-111`) |
| quarantined corrupt file | renamed to `${dbPath}.corrupt-${pid}-${seq}` on SyntaxError, then fresh `emptyDatabase()` | `storage/db/` (`jsonBackend.ts:89-94`) |

**Implementation.** `jsonBackend.ts:67,99-112,89-94`; `store.ts:37`; `collectionAdapter.ts:23`; `types.ts:12-45`.
**Model usage.** **Deterministic.**
**Real example.** `storage/db/app.json` counts `{projects:3,assets:4,jobs:10,analyses:4,templates:3,atoms:20,generations:3,renders:4}`. A real quarantine artifact exists: `storage/db/app.json.corrupt-manual-1780516053` — the SyntaxError quarantine path has actually fired.
**Notes.** rename(2) is atomic on the same filesystem, so a poll mid-write never hits "Unterminated string"/"Unexpected end of JSON input" 500s (the pre-fix bug). NOT a transaction log — whole-snapshot read-modify-write, so two concurrent writers can still last-write-wins clobber (no locking); atomicity only protects against TORN reads. A SQLite backend (`sqliteBackend.ts`) is selectable; the marking_run used JSON.

---

### (17) final-gates (G1–G30) evaluator

**Purpose.** Deterministic, motif-agnostic acceptance gate over a completed case directory. Reads recipe + rendered mp4s + generation/route-summary + gap-report and emits 30 pass/fail/blocked gates plus a summary — the hard source of truth for marking.

**Triggered by.** `run-marking-pipeline.mjs` step 5 spawns `node scripts/evaluate-final-gates.mjs --case-root <dir> --out <dir>/final-gates.json`; standalone CLI at `evaluate-final-gates.mjs:339`; exported `evaluateCaseGates(caseRoot,options)`.

| Input | Shape / fields | Source |
|---|---|---|
| caseRoot dir | `render-recipe.json, final.mp4, final.remotion.mp4, generation.json, timeline.json, learned-template.json, analysis.json, gap-report.json` (+ optional sidecars) | `run-marking-pipeline.mjs runSample()` step 4 |
| `recipe` (v4.1) | `{version:'render-recipe-v4.1',clips[]{selectedPrimitive,primitiveReason,text},layers[]{type,evidenceRefs[],layout.bboxNorm,typography.fontSizeRatio,material{kind,provenance,assetIds,policy},audio{kind,weight}},sourcePolicy{sampleFrameCopyAllowed,sampleAudioCopyAllowed},global.audioPlan.layers,providerDecisions[],modelRouteSummary,recipeLintReport,videoCriticReport,productTheme}` | `render-recipe.json` (`evaluate-final-gates.mjs:233`) |
| routeSummary + providerDecisions | `{summary{...,externalSampleMediaUploads,localSampleMediaAnalyses},decisions[]{task,selectedProvider,fallbackUsed,effectScope,consumesSample*,mediaAccessPolicy.rawPromptRenderable,generatedAssetProvenanceRequired}}` | `routePayloadFrom()` (`:111`): `recipe.modelRouteSummary‖generation.modelRouteSummary‖sidecar` |
| rendered mp4 measurements | ffprobe `{width,height,durationSec}`; `meanVolumeDb` via volumedetect; `longestBlankSectionSec` via conda python `--metrics-only frameMetrics[].contentStd` | `probe()`/`meanVolumeDb()`/`longestBlankSectionSec()` (`:38/59/74`) |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| `final-gates.json` | `{caseRoot,generatedAt,status:'pass'｜'fail'｜'blocked',counts{...},primitiveHistogram,finalProbe,remotionProbe,analysisCounts,gates[]{id,status,notes},routeSummary{summary,rows[]},recipeLintReport,videoCriticReport,summary{pass,fail,blocked}}` | `<caseRoot>/final-gates.json`; consumed by case-summary.json, visual-qa-report.mjs (G7/G8/G20/G22→safety), build-marking-package.mjs |

**Implementation.** `evaluate-final-gates.mjs:226,246-310,318,268,287-299,303-309`.
**Model usage.** **Deterministic** — ffprobe + ffmpeg volumedetect + conda python `frameMetrics.contentStd`. Physics/metadata, motif-agnostic.
**Real example (motion_graph_2 — verified).** `status='fail', summary={pass:29,fail:1,blocked:0}`. Single FAIL = `G22_no_external_sample_media_uploads, notes='externalSampleMediaUploads=2'`. `G29_audio_not_silent` PASS `'final.mp4=-19.3dB, final.remotion.mp4=-17.4dB (> -50dB required)'`. `G30_no_long_blank_section` PASS `'longestNearBlank=0.0s (<= 3.0s allowed)'`. `counts.recipe={mediaLayers:3,textLayers:5,motionAtomLayers:1,audioLayers:4}`. `primitiveHistogram={ProductHeroOrbit:1,SourceClipBeatMontage:1,KineticTypographySweep:1,ImpactFlash:1,CTAEndSlate:1}`.
**Notes (gate map + why G22 fails).** G1/G2 mp4s exist; G3 dims 720x1280; G4 duration 10–20s; G5 `version==='render-recipe-v4.1'`; G6 every clip has primitiveReason, every layer evidenceRefs‖fallbackReason; G7 `sampleFrameCopyAllowed===false` + no `sample_reference` layers; G8 `sampleAudioCopyAllowed===false`; G9 no watermark/水印 in display text; G10 template counts >0; G11 text layers have bboxNorm+fontSizeRatio; G12 motion_atom layers>0; G13 media layers carry assetIds + policy≠`evidence_only`; G14 no prompt-pollution tokens; G15 audio layers>0; G16 distinct primitives≥3; G17 gaps have reason+impact+repairOptions+selectedRepair; G18 preview frames per clip; G19 providerPolicy.ts present; G20 generated assets/media carry provenance; G21 providerDecisions present; G22 `externalSampleMediaUploads===0`; G23 fallbackUsed is a number; G24 `unsafePolicyIssues===0`; G25 every decision `rawPromptRenderable===false`; G26 generation providers require provenance; G27 recipeLintReport≠`fail`; G28 videoCriticReport.score present; G29 audio_not_silent (>−50dBFS); G30 no_long_blank_section (`contentStd<0.04`, allowance `max(2s,0.2*dur)`). **G22 fails by design** because `video_structure_vlm→gemini_vlm_current` uploads sample pixels+audio+video externally (the ≤18MB inline VLM perception send) and `asr→elevenlabs_scribe` uploads sample audio externally → `externalSampleMediaUploads=2`; surfaced as the `videoCriticReport` warn `sample_copy_risk`. Status rollup: `fail===0?'pass':(blocked>0 && fail<=2)?'blocked':'fail'` → with `blocked=0, fail=1` → **'fail'**. G21–G28 BLOCK (not fail) on old artifacts lacking a route summary; the marking run hit the full path (31 decisions).

---

### (18) render-quality evaluator (universal + v2/v3)

**Purpose.** Per-render structural-transfer quality gate: confirms the mp4 actually transferred the sample's structure (portrait, cuts, dark-bg match, no placeholder strings) rather than emitting a silent/blank B2B scaffold. Includes universal `audio_not_silent` + `no_long_blank_section` plus opt-in v2/v3 beat_cut gate sets.

**Triggered by.** `run-marking-pipeline.mjs` step 5 spawns `node scripts/evaluate-render-quality.mjs --render final.mp4 --template learned-template.json --generation generation.json --sample test_videos/<slug>.mov --out <dir>/render-quality.json` (no `--gates` flag → universal set only).

| Input | Shape / fields | Source |
|---|---|---|
| `--render mp4` | path to final.mp4 (ffprobe + volumedetect + conda frameMetrics) | the FFmpeg final.mp4 |
| `--template` | `{videoType,aiEnrichmentStatus,requiredSlots[]{visualFormFamily,sourceEvidence{frameIds,timeRange}},inducedSlots[],typographyEvidence[],visualElementGraph.elements[],heroDescriptor,segments[]}` | `learned-template.json` |
| `--generation` | `{timeline{renderPlan{audioPolicy,beatGrid.beats[],audioPlan.layers},clips[]{subtitleText,visualIntent,transitionOut,motionPrimitive,beatTimestamps[],layers[]}},gapReport[]{gapType},fillPlan[],storyboard[]}` | `generation.json` |
| `--sample mov` | original `test_videos/<slug>.mov` (analyzed for blackBgRatio/cutDensity/bpm comparison) | `samplePath` |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| `render-quality.json` | `{overall:'pass'｜'warn'｜'fail',render,scores{gatesPassed,gatesTotal},gates[]{id,passed,detail,value},failures[],warnings[],evidence{render{...},slotEvidenceCoverage,placeholderHits[],renderStats{blackBgRatio,cutDensity,shots},sampleStats{blackBgRatio,cutDensity,bpm}}}` | `<caseRoot>/render-quality.json`; consumed by case-summary.json + build-marking-package.mjs |

**Implementation.** `evaluate-render-quality.mjs:145-158,160-173,103-120,198-235,242-338`.
**Model usage.** **Deterministic** — ffprobe + volumedetect + conda python (PySceneDetect+librosa: blackBgRatio, cutDensity, bpm, per-frame contentStd, motion/audio for v2/v3).
**Real example (motion_graph_2 — verified).** `overall='fail', scores={gatesPassed:9,gatesTotal:11}, failures=['no_placeholder_text','style_match_dark_bg']`. `audio_not_silent` PASS `'mean_volume=-19.3dB'`; `no_long_blank_section` PASS `'longestNearBlank=0.0s'`; `slot_evidence_coverage_ge_70 '100% of 14 slots'`; `renderStats={blackBgRatio:0.5,cutDensity:0.533,shots:8}` vs `sampleStats={blackBgRatio:0.938,cutDensity:0.41,bpm:107.7}`.
**Notes.** Universal gates run for ALL flows: `output_portrait_9_16`, `audio_present_or_silent_ok`, `audio_not_silent` (>−50dBFS), `no_long_blank_section` (allowance `max(2s,0.2*dur)`, `BLANK_CONTENT_STD=0.04`), `video_type_not_generic_b2b`, `ai_enrichment_not_failed`, `slot_evidence_coverage>=70%`, `no_placeholder_text` (hard fail on `/proxy/placeholder/插槽/占位/Beat montage proxy/`), `beat_or_hard_cut_present`, `render_has_cuts`, `style_match_dark_bg` (`|render−sample|<=0.35`). `overall`: any fail→'fail', else any warn→'warn', else 'pass'. **Dual-path:** `--gates v2` adds 12 beat_cut booleans + thresholds; `--gates v3` adds per-clip motion/hero/typography/audio-richness gates but false-fails non-beat_cut flows — the marking run deliberately omits `--gates` so only the universal set applies. The mg2 fails (`no_placeholder_text` + `style_match_dark_bg`) are about the FFmpeg renderer's procedural proxy strings and dark-bg mismatch, **not** the audio/blank gates (which both pass).

---

### (19) marking-pipeline orchestrator + package builder

**Purpose.** Drive the REAL API server through the full structure-transfer pipeline once per sample, each with a different random real-product theme, then write the per-case evidence chain + dual renders + gates + cross-sample diversity. `build-marking-package.mjs` assembles the gradeable `marking/` package.

**Triggered by.** `node scripts/run-marking-pipeline.mjs` (all 4) or `--case <slug[,slug]>`; then `node scripts/build-marking-package.mjs`. `run-marking-pipeline.mjs main()` at `:279`; `build-marking-package.mjs main()` at `:30`.

| Input | Shape / fields | Source |
|---|---|---|
| 4 sample .mov + 4 hardcoded themes | `test_videos/{marketing,editing,motion_graph_1,motion_graph_2}.mov` + `THEMES{<slug>:{name,en,category,cta,features[]}}` (`:43-48`) | repo `test_videos/` + THEMES; `SAMPLE_ORDER=[marketing,editing,motion_graph_1,motion_graph_2]` |
| generation request per sample | `{projectId,inputMode:'brief_assets',selectedTemplateIds:[template.id],sampleReferenceAssetId,prompt:themePrompt(t),targetAssets:copyTargets()[3 copy items: ui_showcase/kinetic_typography/brand_cta — NO product images],target{vertical:'b2b_marketing_mg',targetDurationSec:15,aspectRatio:'9:16',outputMode:'mp4_render'},controls{pace:'fast',hookIntensity:'strong',packagingStyle:'mg_motion',recipeEvidencePrimitives:true,allowAigcMaterialGeneration:true,allowExternalAigcProvider:true,subtitleGenerationMode:'auto'},constraints{noSampleVisualCopy:true,sampleAssetReuse:'disabled'}}` | `buildRequest()` (`:67`); product IMAGES omitted so gap-detect→AIGC fill generates them |

| Output | Shape / fields | Destination / consumer |
|---|---|---|
| per-case evidence chain | `docs/artifacts/marking_run/<case>/`: theme.json, learned-template.json, analysis.json, generation.json, render-recipe.json (+.base), timeline.json, slot-mapping.json, gap-report.json, fill-plan.json, technique-atoms.json, aigc-material-fill.json, structure-explanation.md, version-diff.md, final.mp4, final.remotion.mp4, render-contact-sheet[.remotion].png, preview_frames/clip_N.png, render-quality.json, final-gates.json, case-summary.json | staging; → `marking/case-evidence/<case>/` + `marking/demo-videos/` |
| run-level | `themes.json`, `diversity_matrix.json` (diversity_ncc.py over FFmpeg finals: `{layout_ncc_mean,layout_ncc_max,color_hist_corr_mean,n_identical_frames,interpretation}`), `RUN_SUMMARY.json`, `server.log` (redacted) | `marking_run/` root; build-marking-package writes RUN_SUMMARY.md/showcase-report.md/RUN_OUTPUTS.md |
| `case-summary.json` | `{sample,theme,videoType,final{duration,width,height,meanVolumeDb},remotion{...}｜{ok:false,error},slots,gaps,aigcGenerated,renderQuality{passed,total},finalGates{pass,fail,blocked}}` | `<case>/case-summary.json`; rolled into `RUN_SUMMARY.samples[]` |

**Implementation.** `run-marking-pipeline.mjs:170-277,279-309,149-163,238-255`; `build-marking-package.mjs:30-99`; `diversity_ncc.py:73-121`.
**Model usage.** Orchestration is deterministic glue, but DRIVES the real API server (full pipeline): Gemini VLM perception (inline whole-video), ElevenLabs ASR, AIGC fill via `google_gemini_image`/`seedance_2_0`/`google_gemini_tts`/`google_lyria_music`/`elevenlabs_sound_effects`, `deterministic_planner` for planning. Gate scripts + diversity_ncc.py deterministic.
**Real example.** `RUN_SUMMARY.json` (generatedAt 2026-06-03T20:02:27Z) holds a 2-case partial rerun `[marketing(motion_graphic_marketing_poster,15.0s,-12.4dB,gaps1,aigc5,29P/1F/0B), motion_graph_1(beat_cut,14.99s,-14dB,gaps2,aigc11,29P/1F/0B)]` with `diversity={layout_ncc_mean:0.0002,layout_ncc_max:0.1372,color_hist_corr_mean:0.0707,n_identical_frames:0}` — far below the 0.70 'diverse' threshold (proves the engine is NOT a fixed mold). `motion_graph_2/case-summary.json`: theme=蓝山精品挂耳咖啡, videoType=beat_cut, `final{15.01,720x1280,-19.3dB}`, slots:8, gaps:2 (background_missing→packaging_fill, bgm_missing→procedural_motion), aigcGenerated:11, renderQuality{passed:9,total:11}, finalGates{pass:29,fail:1,blocked:0}. themePrompt explicitly: '学习样例视频的结构…但绝不复制样例的画面、音频、文字或水印'.
**Notes (dual-path).** Per-sample flow: write theme.json → POST /api/projects → upload .mov (`role=example_video`/`sourcePolicy=user_authorized`) → analyze (Gemini VLM + evidence + ASR/OCR) → POST /api/generations (async) + pollJob → render FFmpeg (final.mp4) → render Remotion (final.remotion.mp4) → contactSheet + preview frames → persist chain → multi-version recipes (broken, see Block 10) → render-quality + final-gates → case-summary. The CURRENT `RUN_SUMMARY.json` reflects a 2-case partial rerun (marketing+motion_graph_1), while all 4 case dirs exist with full evidence from their own runs. For motion_graph_2, `render-recipe.high_click/high_quality.json` were NOT materialized (only `render-recipe.json` + `.base.json`) — the multi-version step errored (Block 10 bug). The full pipeline did NOT enable creative-effect codegen; the only G22 fail across cases is the designed external-upload flag, uniformly 29P/1F/0B.

---

## Dual paths (the differences that matter)

**(a) Sample media exposure: REAL VIDEO (full pipeline) vs CONTACT-SHEET IMAGE (codegen-eval).**
In the full marking pipeline, perception sends the **whole real sample video inline base64** to Gemini when `size ≤ INLINE_MAX_BYTES = 18MB` (`gemini.ts:255`); all marking samples went `mode=inline` (largest 17,220,280 bytes). ASR sends the sample audio to ElevenLabs Scribe. These two routes are the only external sample-media uploads (`externalSampleMediaUploads=2`). In the **codegen-eval** (`run-live-codegen-eval.mjs`), Gemini sees only a **still contact-sheet JPEG** (`<case>_contact.jpg`, inlined as `inlineData`) plus numeric audio/visual summaries — never the sample video or its audio. And **codegen component generation (5c) receives NO image at all** — only `contactSheetPathMeta.fileName` (a string) and text. **No generator (AIGC image/video/audio or codegen) ever receives sample pixels/audio.**

**(b) Structure source: deterministic engine (full pipeline, no oracle) vs Gemini-on-pic + hand-authored oracle (eval).**
The full pipeline derives structure/layer-plan **deterministically** — `timeline.json`/`render-recipe.json` are built by pure planner code (`buildTimeline`/`buildRenderRecipe`, `modelRouteSummary` shows `transfer_planning/natural_edit/structure_explanation = deterministic_planner`); the authoritative `videoType` comes from the deterministic `evidenceTimeline.detectedStyle`. There is **no oracle**. The eval path instead has Gemini produce `codegenLayers[]` from the contact sheet, then grades them against a **hand-authored `evalAssertions` oracle** (`expected_codegen_layers_eval.json`: `evalAssertions`, `acceptedEffectProgramIds`, `minimumLayerCounts`, `mustRejectIfOnly`) — used by `evaluateCase()`, not by the pipeline.

**(c) effectProgramIds=[] (codegen OFF) — generic recipe layers vs bespoke codegen components.**
In the full pipeline the creative-effect gate (`planner.ts:3830`, `controls.enableCreativeEffects`/`ENABLE_CREATIVE_EFFECTS=1`) was **not set**, so `render-recipe.json` has **no `effectProgramIds` field** (verified: 0 occurrences in mg2's recipe; empty across all marking_run recipes). Render therefore uses the **generic recipe layers/primitives** (ProductHeroOrbit, SourceClipBeatMontage, KineticTypographySweep, ImpactFlash, CTAEndSlate) via `ViralRecipeRoot`'s `layers[]`/`clips[]` branches and FFmpeg's primitive/proxy compositing — the effect-overlay pass is skipped entirely (`ffmpegEffectFallbackUsed=false`). The `marking/demo-videos`/codegen-apply path is the ONLY one that sets `effectProgramIds` (e.g. `apply-proof`: `effectProgramIds=['blue_spotlight_ui_pitch']`, `inManifest=true`) and renders bespoke generated Remotion components.

---

## Model & provider map

| ModelTask | Primary provider / model | Fallbacks (in order) | Consumes sample media externally? |
|---|---|---|---|
| `video_structure_vlm` | `gemini_vlm_current` (Gemini, `gemini-3.5-flash`) | `heuristic_vlm` → `frame_sheet_heuristics` | **YES** — pixels+audio+video (whole video inline ≤18MB) |
| `asr` | `elevenlabs_scribe` (`scribe_v2`) | `faster_whisper` → `no_asr_with_warning` | **YES** — sample audio |
| `ocr` | `paddleocr_vl` | `paddleocr` → `easyocr_current` → `no_ocr_with_warning` | No (local only); mg2 fell back to `easyocr_current` |
| `text_planning_llm` | `configured_ai_adapter` (Gemini/OpenAI-compat/Ark text) | `deterministic_planner` | No (text only) |
| `transfer_planning` / `natural_edit` / `json_schema_repair` / `structure_explanation` / `recipe_lint` / `technique_atom_extraction` | `deterministic_planner` | — | No |
| `visual_grounding` | `grounding_dino` | `sam2` → `cotracker3` → `opencv_flow_ocr_heuristic` → `heuristic_bbox` | No (local); mg2 fell back to `opencv_flow_ocr_heuristic` |
| `audio_analysis` | `ffmpeg_librosa_audio_analysis` | `no_audio_analysis_with_warning` | No (local) |
| `image_fill` | `google_gemini_image` (`gemini-3.1-flash-image`) | `volcengine_seedream` (`doubao-seedream-5-0`) → `deterministic_local_image_fill` → `remotion_shape_card` | **NO** — AIGC clamp (samplePixels/Audio/Video=false) |
| `video_fill` | `seedance_2_0` (`doubao-seedance-2-0-fast`) | `remotion_procedural_motion` → `ffmpeg_proxy_motion` | **NO** — AIGC clamp |
| `voiceover` | `google_gemini_tts` (`gemini-3.1-flash-tts-preview`) | `elevenlabs_tts` → `skip_with_warning` | **NO** — AIGC clamp |
| `sound_effect` | `elevenlabs_sound_effects` | `procedural_synth` → `skip_with_warning` | **NO** — AIGC clamp |
| `music` | `google_lyria_music` (`lyria-3-clip-preview`) | `elevenlabs_music` → `procedural_synth` → `skip_with_warning` | **NO** — AIGC clamp |
| `quality_judge` | `deterministic_gates` | `deterministic_gates_only` (`gemini_vlm_judge` only as candidate, not auto-routed) | No (judges output, not sample) |
| `knowledge_retrieval` | `bge_m3` | `keyword_filter` | No (local); mg2 fell back to `keyword_filter` |

(The router defines 31 ModelTasks total; the rest — e.g. `gap_reasoning`, `provider_prompt_compilation`, `gap_repair_ranking`, `version_strategy_planning`, `video_critic`, `technique_atom_kb_curator`, `asset_understanding`, `forced_alignment`, `model_discovery`, `voice_discovery`, `dubbing`, `audio_cleanup` — resolve to deterministic or read-only/quality-gate providers.)

---

## Safety invariants

- **No sample pixel/audio copy into output.** `RenderRecipe.sourcePolicy.sampleFrameCopyAllowed=false`, `sampleAudioCopyAllowed=false`; `StructureTemplate.replacementPolicy.doNotCopySampleVisuals=true` with `forbiddenTransfer=[original_video_frames, original_audio, original_voiceover, person_likeness]`. Gates **G7/G8** enforce this; the rendered audio bed is 100% synthesized (procedural) or AIGC-generated, never sample-derived.
- **AIGC generators never receive sample frames.** The router clamp (`router.ts:104-113`) force-overrides any `image_generation`/`video_generation`/`audio_generation` provider's policy to `samplePixelsAllowed/sampleAudioAllowed/sampleVideoUploadAllowed/rawPromptRenderable=false` regardless of options. Every `MaterialGenerationBrief.privacyPolicy.sampleFramesAllowedToProvider=false`, and providers throw if it were true (`aigcMaterialProviders.ts:721`). Gate **G25** asserts `rawPromptRenderable===false` on every decision. The legacy `engine/providerPolicy.ts` independently hardcodes `mayReceiveSampleFrames/Audio=false`.
- **Generated assets carry provenance.** Every `GeneratedAssetCandidate.provenance{generatedAt, externalProviderUsed, sampleFramesSentExternally:false, targetAssetsSentExternally:false}`; recipe media layers carry `provenance:'aigc_generated'` / `materialRole:'aigc_generated_material'`. Gate **G20** requires it; **G26** requires generation providers to require provenance.
- **G22 meaning.** `G22_no_external_sample_media_uploads` requires `modelRouteSummary.summary.externalSampleMediaUploads===0`. In the full pipeline this **fails by design** (count=2) because the **analysis-only** routes `video_structure_vlm`→Gemini (whole-video inline) and `asr`→ElevenLabs Scribe legitimately upload sample media for *understanding* — never for copying. This is the single uniform FAIL across all cases (29 pass / 1 fail / 0 blocked), surfaced as the `videoCriticReport` warn `sample_copy_risk: 2 external sample media upload routes recorded; verify analysis-only policy.` It is the only gate that cannot pass while live VLM/ASR perception is enabled.

---

## Where the artifacts live

`docs/artifacts/marking_run/<case>/` (cases: `marketing`, `editing`, `motion_graph_1`, `motion_graph_2`):

| Artifact | Produced by (block) |
|---|---|
| `theme.json` | (19) orchestrator — random real-product theme written before the run |
| `analysis.json` (incl. `evidenceTimeline`, `transcript`, `ocr`) | (2) deterministic evidence + (3) VLM/ASR/OCR perception |
| `learned-template.json` | (4) StructureTemplate construction |
| `technique-atoms.json` | (4) via `extractTechniqueAtoms` |
| `slot-mapping.json` | (6) matchSlots (POST-AIGC-fill final state) |
| `gap-report.json` | (7) generateGapReport (POST-fill) |
| `fill-plan.json` | (7) createFillPlan |
| `aigc-material-fill.json` | (8) AIGC material fill (briefs/candidates/quality/generatedTargetAssets) |
| `timeline.json` | (9) buildTimeline |
| `render-recipe.json` (==`render-recipe.base.json`, byte-identical) | (9) buildRenderRecipe→migrateRenderRecipeToV4_1 |
| `render-recipe.high_click.json` / `high_quality.json` | (10) — **NOT materialized** (versionStrategy schema bug) |
| `version-diff.md` | (10) multi-version loop (records the version failures) |
| `structure-explanation.md` | (9) generateStructureExplanation |
| `generation.json` (incl. `providerDecisions[31]`, `modelRouteSummary`, `validation`, `recipeLintReport`, `videoCriticReport`) | (5)–(10) generate stages + (14) Model Router + (15) Provider policy |
| `final.mp4`, `preview_frames/clip_N.png`, `render-contact-sheet.png` | (11) FFmpeg Render + (13) Audio Mix |
| `final.remotion.mp4`, `render-contact-sheet.remotion.png` | (12) Remotion Render |
| `render-quality.json` | (18) render-quality evaluator |
| `final-gates.json` | (17) final-gates G1–G30 |
| `case-summary.json` | (19) orchestrator roll-up |

Run-level (`docs/artifacts/marking_run/`): `themes.json`, `diversity_matrix.json`, `RUN_SUMMARY.json`, `server.log` — all (19). Persistent DB snapshot: `storage/db/app.json` (+ real quarantine `app.json.corrupt-manual-1780516053`) — (16). Codegen artifacts (separate path, OFF in marking_run): `docs/artifacts/codegen-live-eval/hardened-editing-v1/<case>/` (creative-effect-spec, actual-codegen-layers, proposal/, validation-report, apply-proof) — blocks (5a)–(5d); `docs/artifacts/effect-kb/effects.json` — EffectKnowledgeBase (5d).