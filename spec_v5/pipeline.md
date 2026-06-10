# 03 — Pipeline Specification

V5.1 keeps the Program-KB pipeline, but the production default is same-template migration:

```text
sample -> evidence -> neutral reconstruction + RemotionTemplateCapsule
       -> ordered target assets / slotAssignments
       -> TemplateInstance -> Remotion render -> trace + scorecard + final.mp4
```

The Program-KB/Gen2 stages below are used for advanced `mix_elements` generation and for extracting reusable knowledge from learned samples.

## Stage 1 — Ingest

### Input

```ts
ProjectConfig
AssetUpload[]
```

### Output

```ts
Asset[]
```

### Behavior

- Accept `.mov`, `.mp4`, image files, text assets, product JSON.
- Store raw files in artifact storage.
- Create asset ids.
- Assign roles: `sample_video`, `target_video`, `target_image`, `target_text`, `generated_asset`, `audio_asset`.
- Record source policy.

## Stage 2 — Deterministic Evidence

### Input

```ts
Asset role = sample_video or target_video
```

### Output

```ts
EvidenceTimelineV5
```

### Tools

- `ffprobe`: metadata, duration, dimensions, audio streams.
- FFmpeg: frame extraction, contact sheet, audio waveform.
- OpenCV / PySceneDetect: scene boundaries and shot count.
- Optical flow: motion intensity curve.
- OCR: subtitles and text regions.
- ASR: speech transcript and word/segment times.
- librosa / FFmpeg filters: beat grid, onset, energy curve.

### Required fields

- metadata
- shotTimeline
- keyFrames
- textEvidence
- speechEvidence
- audioEvidence
- motionEvidence
- contactSheetRef
- recommendedVideoInputPolicy

## Stage 3 — Video Input Policy

### Purpose

Decide what video representation to send to Gen1.

### Default

For short videos under 2 minutes:

```text
send whole video + evidence
fps 2-5
```

### Detail pass

For fast motion, MG animation, beat cuts, or failed reconstruction:

```text
whole video global pass
+ scene-aware detail clips
fps 5-8
```

### Long video

For long videos:

```text
low-fps global pass
+ scene/chapter chunk pass
```

No fixed 8-second chunking by default. Use chunks only when needed for detail or long inputs.

## Stage 4 — Gen1 Neutral Reconstruction

### Input

```ts
OriginalVideoRef
EvidenceTimelineV5
ContactSheetRef
VideoInputPolicy
Gen1PromptVersion
```

### Output

```ts
NeutralReconstructionProgram
RemotionTemplateCapsule
```

### Requirements

Gen1 must output:

- typed spec JSON
- Remotion reconstruction project
- renderable Remotion template capsule
- placeholder slots
- slot schema with role/type/required/fallback policy
- timing map
- scene recipes and audio recipes
- learned asset recipes
- learned audio recipes
- evidence refs for all key claims
- safety metadata

### Content-neutral rules

Gen1 must not output reusable sample content:

- no raw sample image reuse
- no sample logo reuse
- no sample watermark reuse
- no sample original subtitle text reuse except sanitized evidence
- no sample audio reuse

## Stage 4B — Template Capsule Reconstruction

### Purpose

Create the Level-1 reusable template that the UI can immediately use for same-template migration.

### Input

```ts
NeutralReconstructionProgram
EvidenceTimelineV5
OriginalVideoRef
ContactSheetRef
```

### Output

```ts
RemotionTemplateCapsule
TemplateSlot[]
SceneRecipe[]
AudioRecipe[]
TemplateValidation
```

### Requirements

- Preserve sample timing, section order, motion grammar, transition grammar, packaging style, and beat cues.
- Replace sample-specific content with typed slots such as `hook_bg`, `hero_product`, `product_grid`, `proof_ui`, `cta_end`, and `music_bed`.
- Keep user-facing slot labels in Chinese in the dashboard.
- Include fallback prompts or procedural fallbacks for every required slot.
- Record evidence links from each capsule decision back to shots, OCR/ASR, motion, or Remotion code.

## Stage 5 — Validate Reconstruction and Template Capsule

### Checks

- JSON schema valid
- Remotion project compiles or fallback exists
- template capsule has valid composition entry and component files
- all segments have evidence refs
- placeholders cover sample-specific content
- no sample audio referenced in renderable project
- no sample raw asset referenced as reusable target material
- every required template slot has a fallback or explicit user-provided requirement
- frame-0 or short dry-run render succeeds when validation is enabled

### Output

- valid NeutralReconstructionProgram
- valid RemotionTemplateCapsule
- reconstruction preview if possible
- validation warnings

## Stage 6 — Element Extractor

### Input

```ts
NeutralReconstructionProgram
EvidenceTimelineV5
```

### Output

```ts
CandidateElement[]
```

### Extracted kinds

- structure pattern
- hook pattern
- rhythm pattern
- motion pattern
- transition pattern
- typography pattern
- layout pattern
- palette pattern
- visual asset pattern
- image prompt recipe
- audio pattern
- SFX pattern
- voiceover pattern
- CTA pattern
- Remotion snippet

### Implementation

Use deterministic parser first, then a lighter text model:

```text
typedSpec parser
+ timing map parser
+ recipe parser
+ light model classifier/namer
```

Do not use heavy VLM here unless needed. Input is already text/JSON.

## Stage 7 — KB Curator

### Input

```ts
CandidateElement[]
KnowledgeBaseIndex
```

### Output

```ts
KbCurationDecision[]
KnowledgeElement[]
```

### Steps

```text
normalize candidate
hard-rule duplicate/safety check
embedding search top K
ML judge if uncertain
store / merge / variant / reject / evidence_only
```

## Stage 8 — Target Asset Analysis

### Input

```ts
TargetAsset[]
CreativeBrief
```

### Output

```ts
TargetAssetProfile[]
```

### Analyze

- object/product/person/scene labels
- quality score
- best usage section: hook, demo, proof, CTA
- crop suggestions
- text extraction
- motion/action summary for video assets
- audio availability
- media type separation so videos are not auto-bound into image-only slots
- user-selected order so earlier assets can appear earlier in the generated video

## Stage 9 — User Selection / Recommendation

### Input

```ts
KnowledgeBase
CreativeBrief
TargetAssetProfile[]
```

### Output

```ts
SelectionSet
TemplateSelection
SlotAssignment[]
```

### Modes

- manual: user picks elements
- assisted: system recommends elements
- hybrid: system recommends and user edits
- same-template: user selects one template capsule and optionally assigns target assets to slots

## Stage 10 — Composition Planner

### Input

```ts
CreativeBrief
SelectionSet
TargetAssetProfile[]
```

### Output

```ts
CompositionProgram
```

### Requirement

Planner outputs JSON only. It does not output Remotion code.

Planner is responsible for:

- video section structure
- element placement
- slot plan
- style plan
- pacing plan
- material plan
- audio plan
- coherence plan

## Stage 11 — Gap Report

### Input

```ts
CompositionProgram
TargetAssetProfile[]
```

### Output

```ts
GapReportV5
SlotGapReport
```

### Status values

- `matched`
- `weak_match`
- `missing`
- `not_needed_after_replan`

### Fill strategies

- target crop/reuse
- text card
- packaging card
- generated image
- generated background
- generated voiceover
- procedural audio
- structure replan
- same-template context rewrite
- ordered asset reuse only when media type and role are compatible

## Stage 12 — Optional Material Generator

### Input

```ts
GapReportV5
AssetRecipe[]
CreativeBrief
TargetAssetProfile[]
```

### Output

```ts
GeneratedAsset[]
```

### Rules

- Use stored recipes, not raw sample pixels.
- Record prompt, model, source recipe, and provenance.
- Support local fallback: text card, crop, background gradient, shape composition.

## Stage 13 — Optional Audio Generator

### Input

```ts
CompositionProgram.audioPlan
AudioRecipe[]
CreativeBrief
```

### Output

```ts
AudioAsset[]
AudioLayer[]
```

### Rules

- Do not reuse sample audio.
- Use BPM/mood/cue patterns from KB.
- Prefer procedural fallback when cloud providers unavailable.

## Stage 14 — Gen2 Final Remotion Codegen

### Input

```ts
CompositionProgram
Selected KnowledgeElement[]
TargetAssetProfile[]
GeneratedAsset[]
AudioLayer[]
AllowedComponentLibrary
SafetyPolicy
```

### Output

```ts
FinalVideoProgram
```

### Requirements

- Generate final Remotion code.
- Generate RenderRecipeV5.
- Explain used elements.
- Bind placeholders to target/generated assets.
- Avoid sample content.
- Use allowed imports only.
- Support code repair.

## Stage 14B — Same-template Generation

### Input

```ts
RemotionTemplateCapsule
TemplateSlot[]
TargetAssetProfile[]
SlotAssignment[]
CreativeBrief
GenerationOptionsV5
GapReportV5
```

### Output

```ts
TemplateInstance
RenderRecipeV5
TransferTrace
```

### Requirements

- Bind target assets by explicit slot assignment first, then by user order, then by compatible fallback.
- Preserve learned timing, section order, transition grammar, and motion density unless natural-language revise requests a change.
- Rewrite all sample text into new Chinese or user-provided copy.
- Use generated images/video cards only for missing slots or user-approved augmentation.
- Record Transfer Map, Packaging, and Export evidence for the review center.
- Support `autoRender=false` for planning without immediate render.

## Stage 15 — Compile, Lint, Validate

### Checks

- TypeScript compile
- schema validation
- render dry run
- allowed imports
- file path policy
- no-copy policy
- asset provenance
- audio policy
- duration and aspect ratio
- timeline/render recipe consistency
- required-slot visual coverage
- target asset on-screen evidence

## Stage 16 — Render

### Output

- `final.remotion.mp4`
- `final.mp4`
- `preview_frames/`
- `render-contact-sheet.png`
- `render-log.json`
- `timeline-v2.json`
- `mapping-v2.json`
- `packaging-plan.json`
- `scorecard-v5.json`

### Renderer

- Remotion for graphics and layout.
- FFmpeg for mux, crop, concat, audio mix, fallback.

## Stage 17 — Eval and Scorecard

### Output

```ts
ScorecardV5
```

### Checks

- final video exists
- no long blank
- audio not silent unless intended
- no sample copy
- structure mapping visible
- gap report exists
- final render matches recipe
- UI artifacts exist
- rubric coverage recorded
- transfer trace exists
- packaging evidence exists
