# Requirements — Final Spec v1.2

Project: **Viral Video Structure Transfer Engine / 爆款结构迁移引擎**

Version: **v1.2-final-spec**

Purpose: define the buildable MVP and competition-ready roadmap for an AI creative platform that learns reusable short-video structures from sample videos and reconstructs new short videos from a new source video plus a prompt.

---

## 1. Product definition

The product is an **AI video structure transfer platform**. It should not simply generate a script, and it should not copy a sample video. It should:

1. ingest one or more high-quality sample videos;
2. analyze why the sample works structurally;
3. extract reusable video structure templates and structure atoms;
4. store them in a structure knowledge base;
5. accept a new source video and a user prompt;
6. understand usable source-video shots;
7. match source shots to target structure slots;
8. detect missing or weak material slots;
9. fill gaps through reuse, crop/zoom, text cards, packaging overlays, reordering, proxy placeholders, user material, or optional AIGC generated material;
10. generate script, storyboard, timeline JSON, explanation, and preview;
11. optionally render an MP4 through FFmpeg / Remotion / HyperFrames.

### 1.1 Core slogan

```text
Learn the viral recipe, not the original content.
Use the recipe to reconstruct a new video from new material.
```

### 1.2 Primary vertical

MVP and first competition demo SHALL target:

```text
B-end marketing / MG-style short promo videos
```

This vertical is preferred because it can produce strong demos through title cards, subtitle packaging, product/selling-point cards, motion graphics, crop/zoom reuse, and simple clip assembly without relying on a direct video-generation model.

The architecture SHALL still support future extension to:

- C-end vlog;
- talking-head / one-take口播重剪;
- beat-cut edits;
- short-drama highlight remix;
- e-commerce product videos;
- multi-template fusion.

### 1.3 Final competition alignment

The final project SHALL be prepared for evaluator-owned input videos. The system MUST NOT only work with fixed demo files. The most important evaluator-style path is:

```text
existing learned knowledge base
+ evaluator uploads a source video
+ evaluator enters a prompt
→ system reconstructs a new short video plan / preview / demo
```

Current hardening adds a second judge-visible path for motion-graph structure transfer:

```text
sample/reference video
→ deterministic visual evidence
→ open-world induced slots
→ target material pool
→ slot-specific asset matching
→ proxy fill or target asset replacement
→ optional AIGC material fill when explicitly enabled
→ family-specific renderer capability
→ MP4 + timeline previews + evaluator gates
```

In this path, the sample/reference video is structure evidence only by default. Target assets, authorized reusable assets, procedural renderer output, and explicitly accepted generated material are the material pool. Mock/no-path assets MUST NOT satisfy visual slots. AIGC material generation MUST be opt-in and MUST NOT upload sample frames to external providers unless a future explicit privacy control allows it.

### 1.4 Build stages

| Stage | Name | Must work? | Purpose |
|---|---:|---:|---|
| S0 | Mock MVP | Yes | Run complete flow with deterministic fallback outputs. |
| S1 | Competition MVP | Yes | Use real video uploads, local storage, HTML preview, schema validation, and explainable mapping. |
| S2 | Strong demo | Recommended | Add FFmpeg clip cutting and simple MP4 output. |
| S3 | High-score demo | Stretch | Add VLM keyframe understanding, ASR/OCR, Remotion/HyperFrames packaging, natural-language edit, multi-version generation. |

---

## 2. Personas

### P1 — Competition evaluator

Needs to quickly run the app locally, upload or select videos, enter a prompt, generate a result, and see clear evidence of structure extraction, mapping, gap handling, and output preview.

### P2 — Short-video creator / marketer

Needs to turn a longer source video and product/message brief into a shorter, more structured promotional video.

### P3 — Developer / teammate

Needs stable schemas, module boundaries, adapters, deterministic tests, and clear extension points for VLM, ASR, FFmpeg, Remotion, HyperFrames, and AI providers.

---

## 3. P0 functional requirements

### FR-001 Project workspace

The system SHALL allow users to create and open projects.

**Acceptance criteria**

- WHEN user opens the app THEN the app SHALL show a dashboard and a seeded demo project.
- WHEN user creates a project THEN user SHALL enter name, vertical, aspect ratio, and target duration.
- Default vertical SHALL be `b2b_marketing_mg`.
- Default aspect ratio SHALL be `9:16`.
- Default target duration SHALL be between 10 and 20 seconds, while allowing longer targets if explicitly requested.

### FR-002 Sample video input

The system SHALL support one or more sample videos for structure learning.

**Acceptance criteria**

- User SHALL be able to upload MP4 or MOV files as `example_video` assets.
- System SHALL persist asset metadata locally.
- System SHALL extract or mock: duration, resolution, fps, audio presence, thumbnail candidates, keyframes, and shot list.
- If FFmpeg/ffprobe is unavailable, system SHALL fall back to deterministic mock analysis so the demo still runs.

### FR-003 Structure extraction

The system SHALL extract reusable structure from sample video analysis.

**Acceptance criteria**

- Structure Template JSON SHALL pass `structure-template.schema.json` validation.
- It SHALL include at least:
  - `segments`;
  - `shots` or shot slots;
  - `requiredSlots`;
  - `rhythm`;
  - `packaging`;
  - `structureAtoms`;
  - `editingTechniques`;
  - `replacementPolicy`;
  - `qualityRationale`;
  - `sourcePolicy`.
- It SHALL cover at least two structure categories from: script/paragraph, rhythm, packaging.
- Strong implementation SHOULD cover all three.

### FR-004 Structure knowledge base

The system SHALL store templates and atoms in a local knowledge base.

**Acceptance criteria**

- User SHALL be able to save an extracted template.
- Saved template SHALL create searchable atoms such as hook pattern, rhythm pattern, subtitle style, title-card style, CTA pattern, transition pattern, and gap-fill strategy.
- Knowledge base SHALL show atom source, role, applicable vertical, and usage rules.
- MVP MAY use JSON files; later versions MAY migrate to SQLite/PostgreSQL.

### FR-005 Source video + prompt input

The system SHALL support new source video plus prompt as the primary reconstruction input.

**Acceptance criteria**

- GenerationRequest SHALL support `inputMode = "video_plus_prompt"`.
- User SHALL upload a source video as `source_video`.
- User SHALL enter prompt describing topic, product/message, target audience, selling points, tone, CTA, constraints, and target duration.
- User MAY manually select a structure template, or let the system auto-select based on vertical and target.
- If no source video is available, system MAY run prompt-only fallback, but this is not the official primary path.

### FR-006 Source video understanding

The system SHALL produce candidate shots from the new source video.

**Acceptance criteria**

- System SHALL extract or mock metadata, keyframes, shot candidates, basic tags, and confidence.
- Candidate shot tags SHALL include at least some of:
  - `hook_candidate`;
  - `product_like`;
  - `usage_scene`;
  - `person_scene`;
  - `comparison_candidate`;
  - `background`;
  - `cta_candidate`;
  - `text_card_candidate`.
- MVP MAY use heuristics and mock tags.
- Strong implementation SHOULD add VLM on selected keyframes, ASR, and OCR.

### FR-007 Slot matching

The system SHALL map target structure slots to source video shots or generated packaging elements.

**Acceptance criteria**

- Each target slot SHALL be assigned status:
  - `matched`;
  - `weak_match`;
  - `missing`.
- Mapping SHALL record candidate asset/shot, confidence, reason, and risk.
- System SHALL avoid using sample-video visual content in the generated output unless the sample is also explicitly user-authorized as source material.

### FR-008 Gap detection

The system SHALL detect material gaps and explain their impact.

**Acceptance criteria**

- Gap report SHALL identify slot type, severity, reason, impact, and recommended remediation.
- MVP SHALL detect at least:
  - missing hook visual (`hook_visual_missing` / 缺少开头吸引镜头);
  - missing product closeup (`product_closeup_missing` / 缺少商品特写镜头);
  - missing usage/process visual (`usage_scene_missing` / 缺少使用过程镜头);
  - missing comparison/proof visual (`comparison_missing` / 缺少对比镜头);
  - missing CTA visual/text (`cta_visual_missing` / 缺少结尾 CTA 镜头);
  - insufficient subtitle/script information (`voiceover_or_script_missing` / 缺少口播或脚本) when source has shots but no ASR/OCR text;
  - subtitle density low (`subtitle_density_low` / 字幕密度偏低) when transcript exists but no source shot is a strong text-card carrier.
- Each gap SHALL include `gapType`, `gapLabel`, `gapLabelZh`, and `recommendedFillStrategies` to drive both UI labels and downstream fill selection.

### FR-009 Gap filling

The system SHALL fill or mitigate missing slots.

**Acceptance criteria**

- For each `missing` or `weak_match` slot, system SHALL choose one or more fill strategies.
- MVP SHALL implement at least three deterministic strategies:
  - `reuse_with_crop_zoom`;
  - `text_card`;
  - `packaging_overlay`;
  - `reorder_structure`;
  - `aigc_placeholder`.
- Fill plan SHALL leave no unresolved required slot in generated timeline.
- Fill plan SHALL be visible in the UI.

### FR-010 Reconstruction planning

The system SHALL generate a new video plan from selected structure and source material.

**Acceptance criteria**

- System SHALL generate:
  - script by segment;
  - storyboard by shot;
  - timeline JSON;
  - migration explanation;
  - warnings/limitations.
- Timeline SHALL pass `timeline.schema.json` validation.
- Timeline SHALL reference source assets and generated packaging elements.
- Timeline SHALL include mapping from structure atoms to output clips.

### FR-011 Browser preview

The system SHALL render a browser-based preview for P0/S1.

**Acceptance criteria**

- Preview SHALL display a visual timeline/storyboard with segment roles, timings, subtitles, overlays, gaps, and fill strategies.
- Preview SHALL not require MP4 export in P0.
- Preview SHALL clearly show that the result is based on new source material and structure transfer.

### FR-012 Optional MP4 render path

The system SHOULD provide an extensible renderer path.

**Acceptance criteria**

- RendererAdapter SHALL support at least `html_preview` and `ffmpeg` (the `mock_preview` renderer target was removed — a failed render raises a real error rather than returning a placeholder RenderOutput).
- Strong demo SHOULD implement `ffmpeg` or `remotion` renderer for a simple 9:16 MP4.
- The renderer SHALL consume Timeline JSON rather than custom hidden state.
- `hyperframes` MAY be added for HTML/CSS/GSAP style MG animation generation.

### FR-013 Migration visualization

The system SHALL make the transfer process explainable.

**Acceptance criteria**

Result page SHALL show:

1. sample structure;
2. selected knowledge atoms;
3. source video shot candidates;
4. slot mapping;
5. gap report;
6. fill plan;
7. final storyboard/timeline;
8. preview/render result.

### FR-014 Export and debugging

The system SHALL export generated intermediate artifacts.

**Acceptance criteria**

- User SHALL export:
  - StructureTemplate JSON;
  - KnowledgeAtom JSON;
  - GenerationRequest JSON;
  - Timeline JSON;
  - generation report Markdown/JSON.
- Backend SHALL save job logs and schema validation results.

### FR-015 Local runnable demo

The project SHALL be locally runnable.

**Acceptance criteria**

- README SHALL explain setup and run commands.
- Fresh clone SHALL run mock demo without external AI key.
- Reviewer SHALL be able to complete main flow through UI.
- App SHOULD not require production deployment.

### FR-016 Evidence-driven visual slot induction

The system SHOULD support deterministic visual evidence for open-world motion-graph structures instead of relying only on model summaries or seed B2B slots.

**Acceptance criteria**

- Visual evidence artifacts SHOULD include metadata, shots, motion/layout candidates, evidence frames, and a contact sheet.
- Induced visual slots SHOULD record `visualFormFamily`, `visualForm`, motion/layout relation, asset requirements, renderer candidates, fallback strategies, replacement policy, confidence, and evidence.
- The motion-graph case SHOULD induce families such as:
  - `media_cards`;
  - `kinetic_typography`;
  - `ui_showcase`;
  - `geometric_mg`;
  - `brand_cta`;
  - optional `object_motion` or `live_action_montage` when supported by evidence.
- Generic B2B slots such as `hook_visual/product_closeup/usage_scene/comparison/cta_visual` MUST NOT be the primary flow when open-world slots exist.

### FR-017 Material pool and target asset adaptation

The system SHALL separate reference structure evidence from output material.

**Acceptance criteria**

- Sample/reference assets SHALL be blocked as target material unless `sampleAssetReuse="authorized"`.
- Target assets SHALL be matched to induced slots by role, kind, tags, renderability, and slot requirements.
- `media_cards` SHALL support image-set matching, not only single-image matching.
- Text/copy assets MAY satisfy text or copy-driven slots but MUST NOT satisfy required visual slots unless the slot family explicitly supports procedural text rendering.
- Missing visual material SHALL produce a gap report plus proxy/replacement slots.
- For the motion-graph target-asset demo, expected matches are:
  - `media_cards -> image_set` with at least 4 images;
  - `ui_showcase -> copy_list`;
  - `kinetic_typography -> copy`;
  - `brand_cta -> logo_or_brand_name`;
  - `geometric_mg -> procedural_not_required`;
  - `live_action_montage -> missing/proxy` unless enough image/video material exists.

### FR-018 Renderer capability selection for induced slots

Renderer selection SHALL be driven by slot family and fill strategy rather than silently falling back to centered text cards.

**Acceptance criteria**

- Fill actions SHOULD expose renderer capability ids and fulfillment source.
- Motion-graph renderers SHOULD support:
  - `card_stack_motion`;
  - `feature_list_scroller`;
  - `neon_geometry_typography`;
  - `kinetic_text_card`;
  - `logo_cta_hold`;
  - `generic_asset_proxy` for honest unknown/fallback clips.
- Proxy mode SHOULD render family-specific proxies.
- Target-asset mode SHOULD visibly render target card images, feature copy, and logo/CTA while preserving the induced structure.

### FR-019 Motion-graph regression artifacts

The motion-graph case SHALL write enough artifacts for code-driven, artifact-driven, and visual review.

**Acceptance criteria**

- Required artifacts SHOULD include:
  - `visual-evidence.json`;
  - `induced-slots.json`;
  - `selected-template.json`;
  - `asset-evidence.json`;
  - `slot-asset-matches.json`;
  - `fill-plan.proxy.json`;
  - `fill-plan.with-assets.json`;
  - `replacement-slots.proxy.json`;
  - `replacement-slots.with-assets.json`;
  - `render_proxy.mp4`;
  - `render_with_assets.mp4`;
  - `before_after_contact_sheet.png`;
  - `evaluation.motion_graph.json`;
  - `preview_frames/manifest.json`.
- Evaluator gates SHOULD include:
  - `target_assets_loaded`;
  - `media_cards_asset_matched`;
  - `ui_showcase_copy_matched`;
  - `brand_cta_logo_matched`;
  - `proxy_to_asset_replacement_applied`;
  - `render_with_assets_has_user_images`;
  - `render_with_assets_has_brand_cta`;
  - `structure_preserved_after_asset_replacement`;
  - `no_sample_visual_copy`.

### FR-020 Optional AIGC material fill

The system SHALL support optional generated material fill for missing visual slots without making external generation part of the default path.

**Acceptance criteria**

- AIGC material fill SHALL be disabled by default.
- Enabling external AIGC providers SHALL require explicit user/operator opt-in.
- The web reconstruction planner SHALL expose an explicit AIGC gap-fill control, not hide AIGC behind the normal generate action.
- The web UI SHALL make the safe default clear: no external calls unless the external-provider control is enabled.
- `GenerationRequest.controls` SHALL support `allowAigcMaterialGeneration` and `allowExternalAigcProvider`.
- Generation responses SHOULD expose an `aigcMaterialFill` summary containing provider, external-call status, sample-frame-sent status, briefs, candidates, quality results, and generated target assets.
- The motion-graph harness SHALL support `--with-aigc-materials`.
- The default provider for deterministic tests SHALL be `mock_provider`.
- Volcengine Seedream image generation MAY be used as an external image provider when `--allow-external-aigc` is present.
- Seedream image requests SHOULD set watermark generation off for reviewable artifacts.
- Missing `media_cards` MAY create an `image_set` generation brief.
- Missing `brand_cta` MUST NOT generate a fake real logo; it MAY create a logo placeholder or ask for user upload.
- Generated assets SHALL record provenance, provider, model, prompt, external-call status, and whether sample frames were sent.
- Usable generated assets SHALL be registered as target material with `materialRole="aigc_generated_material"`, not as user-provided assets.
- Deterministic quality checks SHALL run before VLM review.
- VLM review, when configured, SHALL be a bounded strict-JSON quality gate. If unavailable, it SHALL be marked as skipped infrastructure, not as a deterministic pass.
- Required AIGC artifacts SHOULD include:
  - `aigc-material-briefs.json`;
  - `generated-assets/`;
  - `generated-asset-candidates.json`;
  - `generated-asset-quality.json`;
  - `asset-evidence.aigc.json`;
  - `slot-asset-matches.aigc.json`;
  - `fill-plan.aigc.json`;
  - `replacement-slots.aigc.json`;
  - `render_aigc_materials.mp4`;
  - `aigc_materials_contact_sheet.png`.

---

## 4. P1/P2 requirements

### P1 — high-value additions (status as of r3)

- ✅ Real FFmpeg/ffprobe metadata extraction and keyframe extraction.
- ✅ Real FFmpeg clip cutting and concat.
- ✅ ASR with faster-whisper or provider API (wired into `runAnalysisJob`).
- ✅ VLM on selected keyframes for semantic scene tags (`KeyframeHeuristicVLMAdapter`) **and** real Gemini full-video understanding (`GeminiVLMAdapter`).
- ✅ OCR for embedded subtitles/title cards (`EasyOCRAdapter`).
- ✅ Remotion renderer for title cards, subtitles, CTA cards, and overlays (`apps/api/remotion/` composition bundled via `@remotion/bundler`).
- ✅ Natural-language adjustment commands (`POST /api/generations/:id/revise` mutates controls + re-runs the pipeline; heuristic by default, LLM via Ark/OpenAI-compatible when wired).
- ✅ Four output variants instead of two: **高点击版 / 高转化版 / 高节奏版 / 高质感版** via `POST /api/generations/:id/variants`.
- ✅ Quality evaluator scorecard (`POST /api/generations/:id/scorecard`) with heuristic + optional LLM judge merged 50/50.
- ✅ Motion-graph evidence-driven slot induction and target-asset adaptation demo (`scripts/run-motion-graph-case.mjs --with-target-assets`) with corpus gates.
- ✅ Motion-graph managed material intake, partial/malformed target material stress, and optional no-watermark Seedream AIGC material fill (`--with-aigc-materials --aigc-provider env --allow-external-aigc`) with generated-asset provenance and Gemini quality gate.
- ✅ Browser/API optional AIGC gap-fill path: the Reconstruction Planner exposes an explicit AIGC button/toggle, API generation uses `allowAigcMaterialGeneration`, and external image generation is opt-in. When allowed, the live path uses real providers in order `google_gemini_image` (gemini-2.5-flash-image) → `volcengine_seedream` → real error; `mock_provider` is the deterministic default only for CI/script runs, never the live path.

### P2 — advanced additions

- Multi-template fusion and template clustering.
- Rich timeline editor.
- Beat/music alignment.
- TTS voiceover.
- HyperFrames-generated MG animations.
- Export to editable project format if feasible.
- More verticals and style packs.

---

## 5. Non-functional requirements

### NFR-001 Extensibility

System SHALL isolate providers through adapters:

- AIAdapter (Mock; OpenAI-compatible; `ark_doubao` alias for Volcano Ark Doubao Seed 2.0 lite — all support `extractStructure`, `reviseInstruction`, `judgeGeneration`).
- VLMAdapter (Disabled / KeyframeHeuristic / Gemini real video).
- ASRAdapter (Disabled / FasterWhisper).
- OCRAdapter (Disabled / EasyOCR).
- VideoToolAdapter (Mock / FFmpeg).
- RendererAdapter (HtmlPreview / Mock / FFmpeg / Remotion / HyperFrames).
- StorageBackend (Json / SQLite) — the API-internal high-level snapshot interface used by `DatabaseStore`. The collection-level `StorageAdapter` interface in `packages/shared/src/adapters.ts` stays as a forward-looking lower-level abstraction.

### NFR-002 Determinism

Mock mode SHALL be deterministic and testable. Same seeded input SHALL produce same template, mapping, fill plan, and timeline.

### NFR-003 Schema safety

All AI-produced or planner-produced structured outputs SHALL be validated against JSON schemas.

### NFR-004 Observability

System SHALL persist intermediate artifacts and job states.

### NFR-005 Security and compliance

- API keys SHALL be read from `.env`, never committed.
- Sample videos SHALL be used for structural learning, not direct copying.
- Public artifacts SHALL avoid absolute private paths and secret patterns.
- Sample/reference frames SHALL be labeled as evidence-only when shown next to generated preview frames.
- External AIGC providers SHALL never receive sample frames by default.
- Generated assets SHALL be labeled as generated material and SHALL NOT be represented as user uploads.
- API keys SHALL NOT be printed, persisted in public artifacts, or included in prompts/reports.
- Source policy SHALL be recorded.
- User-facing copy SHALL remind that commercial use requires authorization.
- The system SHALL not rely on platform performance data or claim a video will definitely go viral.

### NFR-006 Latency priority

Generation speed SHALL not be the primary optimization target. Correct structure planning, clear explanation, and output quality are higher priority.

---

## 6. Out of scope for first implementation

- Full professional video editor.
- Mandatory cloud deployment.
- Guaranteed viral performance prediction.
- Direct video-generation model dependency.
- Default external AIGC generation.
- Fake brand/logo generation.
- Music copyright handling beyond placeholders.
- Real ad platform data integration.
- Multi-user collaboration and account system.
