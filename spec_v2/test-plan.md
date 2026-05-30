# Test Plan — Final Spec v1.2

The test plan verifies that the product is usable by evaluators, aligned with the official task, and expandable toward a high-score implementation.

---

## 1. Test principles

1. The main flow must work without external AI keys.
2. Video input must be supported, even if initial analysis uses mock/heuristic fallback.
3. Structure output must be schema-valid.
4. Result must explain structure transfer, not just show generated text.
5. Sparse source material must trigger gap detection and fill.
6. Renderer failure must not block timeline preview/export.

---

## 2. Smoke test — fresh local run

Steps:

1. Clone repo.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open web app.
5. Open seeded demo project.
6. Run sample learning.
7. Save structure template.
8. Run source video + prompt reconstruction.
9. View timeline preview and export JSON.

Pass criteria:

- Web UI opens.
- API health check passes.
- Seeded demo generates valid template and timeline.
- No external AI key required.

---

## 3. Demo case A — official-style video + prompt reconstruction

Input:

- Existing structure knowledge base with at least one marketing/MG template.
- Source video: one 20–60s video.
- Prompt: “Generate a 15-second high-conversion promo. Highlight portability, price, and final CTA.”

Expected:

- Source video is analyzed into shot candidates.
- Structure atoms are selected.
- Slots are matched or marked weak/missing.
- Gap report is generated.
- Fill plan uses source reuse, text cards, overlays, or reorder.
- Timeline is generated and schema-valid.
- Preview shows 10–20s target result.
- Compare page explains mappings.

---

## 4. Demo case B — sample video learning

Input:

- A sample short promo video.

Expected:

- Metadata shown.
- Keyframes/shots shown or mocked.
- Template generated with hook/body/proof/cta.
- Rhythm and packaging summarized.
- Structure atoms created.
- Template saved into knowledge base.

---

## 5. Demo case C — sparse source material

Input:

- Source video with no clear product closeup or usage shot.
- Prompt asks for product-benefit promo.

Expected:

- Product closeup or usage slot marked `missing` or `weak_match`.
- Gap report explains impact.
- Fill plan uses `text_card`, `packaging_overlay`, `reuse_with_crop_zoom`, or `reorder_structure`.
- Timeline has no unresolved required slots.

---

## 6. Demo case D — evaluator uses different material

Input:

- A source video not used during development.
- Existing knowledge base.

Expected:

- App accepts the video.
- Mock/heuristic analysis still runs if tools fail.
- The system does not depend on a hard-coded demo file.

---

## 7. Demo case E — renderer downgrade

Input:

- Valid Timeline JSON.
- MP4 renderer disabled or fails.

Expected:

- HTML preview still works.
- Timeline JSON export still works.
- UI shows renderer limitation clearly.

---

## 8. Demo case F — motion-graph target asset adaptation

Input:

- Reference sample: `test_videos/motion_graph_1.mov`.
- Target material fixture: `docs/fixtures/motion_graph_target_assets/`.
- Commands:

```bash
node scripts/generate-motion-graph-target-assets.mjs
node scripts/run-motion-graph-case.mjs
node scripts/run-motion-graph-case.mjs --with-target-assets
node scripts/run-motion-graph-case.mjs --with-partial-target-assets
node scripts/run-motion-graph-case.mjs --with-malformed-target-assets
```

Expected:

- `visual-evidence.json` is generated from deterministic video evidence.
- `induced-slots.json` includes open-world families such as `media_cards`, `ui_showcase`, `geometric_mg`, `kinetic_typography`, and `brand_cta`.
- The selected template name is `Learned Motion Graph Structure · Media Cards + Feature List + Neon Geometry + CTA`, not the seed B2B scaffold.
- Proxy mode writes `render_proxy.mp4` and family-specific proxy fill artifacts.
- Target-asset mode writes `render_with_assets.mp4`, `slot-asset-matches.json`, `asset-evidence.json`, and `before_after_contact_sheet.png`.
- Target-asset mode visibly uses target card images, target feature copy, and target logo/CTA.
- Partial mode reports weak `media_cards` matching and keeps missing logo as proxy.
- Malformed mode blocks external paths, unsupported/no-path/zero-byte/wrong-role assets and does not match them to visual slots.
- Sample/reference frames appear only as evidence, not target material.
- `evaluation.motion_graph.json` passes all target asset gates.

## 8.1 Demo case G — optional AIGC material fill

Input:

- Reference sample: `test_videos/motion_graph_1.mov`.
- No user target image fixture is required for AIGC mode.
- Web path: open the Reconstruction Planner and click **AIGC 补缺口并生成**.
- API path: `POST /api/generations` with `controls.allowAigcMaterialGeneration=true`.
- Optional external provider config in `.env`:
  - `AIGC_IMAGE_PROVIDER=volcengine_seedream`;
  - `SEEDREAM_ARK_MODEL=doubao-seedream-5-0-260128`;
  - `SEEDREAM_WATERMARK=false`;
  - `VLM_PROVIDER=gemini` for generated-material review.

Commands:

```bash
node scripts/run-motion-graph-case.mjs --with-aigc-materials
node scripts/run-motion-graph-case.mjs --with-aigc-materials --aigc-provider env --allow-external-aigc
```

Expected:

- AIGC fill is disabled in default/proxy runs.
- Web UI exposes the AIGC button/toggle and does not run AIGC through the normal generate action unless enabled.
- API response includes `generation.aigcMaterialFill` with provider, external-call status, sample-frame-sent status, briefs, candidates, quality, and generated target assets.
- External provider mode runs only with `--allow-external-aigc`.
- `aigc-material-briefs.json` maps real missing slots to generation briefs.
- `generated-asset-candidates.json` records provider, model, prompt, provenance, and `sampleFramesSentExternally=false`.
- `generated-asset-quality.json` records deterministic checks and Gemini VLM status when configured.
- `asset-evidence.aigc.json` and `slot-asset-matches.aigc.json` mark usable generated assets as `aigc_generated_material`.
- `fill-plan.aigc.json` uses `aigc_generated_asset` for usable generated media cards / CTA placeholder.
- `render_aigc_materials.mp4` and `aigc_materials_contact_sheet.png` exist and visibly use generated materials.
- Public artifacts contain no API keys, `.env` values, or private absolute paths.

---

## 9. Unit + automated test matrix (status as of current hardening)

| Area | Test | Implemented in | Expected |
|---|---|---|---|
| Schema | valid StructureTemplate | shared vitest | pass |
| Schema | missing segments | shared vitest | fail readable error |
| Schema | valid GenerationRequest video_plus_prompt | shared vitest | pass |
| Schema | missing prompt | shared vitest | fail |
| Schema | valid Timeline | shared vitest | pass |
| Structure | fallback template hook/body/proof/cta | shared vitest | matches expected segments |
| Structure | VLM enrichment merges into template | shared vitest | name + intent + atoms updated |
| Slot matching | at least one slot matches mock source | shared vitest | ≥1 matched |
| Gap fill | missing hook/usage slots produce actions | shared vitest | fillPlan length == gaps length |
| Gap typing (FR-008) | gapType + Chinese label populated | shared vitest | hook/cta have correct gapType |
| Gap typing (FR-008) | synthetic voiceover_or_script_missing when source has no transcript/OCR | shared vitest | fires when applicable |
| Fill strategy (FR-009) | reorder_structure picked when subtitle slot misses but sibling matched | shared vitest | strategy == reorder_structure |
| Storage | JSON backend round-trips full DB | api vitest | projects/jobs persisted |
| Storage | SQLite backend round-trips + clears deleted ids | api vitest | matches input on read |
| E2E | project create → sample analyze → source upload+analyze → generate → render html_preview + hyperframes → export → revise → variants → scorecard → KB export | api vitest | all 201/200, variants returns 4 named versions, scorecard has 5 dimensions |
| Remotion | bundle TSX entry without errors (gated by `RUN_REMOTION_BUNDLE_TEST`) | api vitest | bundle path returned |
| Motion graph | deterministic visual evidence and induced open-world slots | `node scripts/run-motion-graph-case.mjs` | proxy render + gates pass |
| Motion graph target assets | slot-specific target material matching and adapted render | `node scripts/run-motion-graph-case.mjs --with-target-assets` | `evaluation.motion_graph.json` passes |
| Motion graph partial assets | insufficient cards/no logo produce weak/missing slots | `node scripts/run-motion-graph-case.mjs --with-partial-target-assets` | weak match + mixed proxy/target render |
| Motion graph malformed assets | bad/external/no-path assets are blocked | `node scripts/run-motion-graph-case.mjs --with-malformed-target-assets` | blocked report + no false visual match |
| Motion graph AIGC materials | optional generated material fill | `node scripts/run-motion-graph-case.mjs --with-aigc-materials` and explicit external mode when configured | briefs, candidates, quality, AIGC render gates pass |
| Web/API AIGC gap fill | explicit UI button + generation API controls | `apps/api/tests/e2e.test.ts` + browser build | mock provider by default, no external calls, generated assets labeled |
| Corpus | open-world motion graph fixture + asset-mode gates | `npm run regression:corpus:strict` | `009_motion_graph_card_stack` PASS |
| Product demo | VLM optional; motion graph artifacts linked | `VVST_REUSE_IGF_FIXTURE=1 npm run demo:product` + `node scripts/check-product-demo-page.mjs` | smoke check passes |
| Schemas (runtime) | AJV-validate every demo fixture + DB row | `npm run validate:schemas` | current run: 366/0 |

---

## 10. E2E acceptance criteria

MVP passes if:

- [x] app runs locally;
- [x] seeded demo works without AI key (Mock + Heuristic adapters);
- [x] sample video learning generates valid StructureTemplate;
- [x] knowledge base stores atoms;
- [x] source video + prompt generates valid Timeline;
- [x] missing material triggers gap report (with FR-008 gapType labels);
- [x] fill plan resolves missing required slots;
- [x] result page shows sample structure, atoms, source mapping, gaps, fill plan, storyboard, preview;
- [x] JSON exports are available (template, timeline, report markdown/json, KB, atoms).

Strong demo passes if:

- [x] real ffprobe or FFmpeg analysis works on at least one uploaded video;
- [x] FFmpeg MP4 render artefact produced (latest: `storage/generated/render_mp4_tofpa6.mp4`);
- [x] FFmpeg render returns `clipPreviewFrames` (one real still per clip under `storage/generated/previews/<renderId>/`) and the Step 6 timeline preview renders them by clip id instead of gradient placeholders (verified end-to-end against real `ffmpeg`);
- [x] **Evidence-first beat_cut**: `editing.mov` driven through the real API (Gemini + faster-whisper + easyocr + PySceneDetect + librosa) yields `videoType=beat_cut`, evidence-bound slots (≥70% with frame/timestamp evidence), a style-locked 15s MP4 (6 beat-cut primitives incl. `impact_flash_stamp`, audio, no placeholder strings), and passes `node scripts/evaluate-render-quality.mjs --expect-video-type beat_cut --strict` (10/10 gates). Golden unit test `editingMovBeatCutGolden.test.ts` passes; full `@vvst/shared` suite is 56/56. Driven by `npm run e2e:editing-beatcut`;
- [x] AI-enrichment failures are visible (`aiEnrichmentStatus=failed`, e.g. Ark 401) and never silently become a clean B2B template; `npm run eval:model-understanding` compares heuristic/Gemini/Ark with failures surfaced;
- [x] **Procedural cards carry no debug text**: the non-beat-cut family cards (`media_cards`/`ui_showcase`/`kinetic_typography`/`geometric_mg`/`brand_cta`) render a clean CJK family header (媒体卡片/功能清单/动态文字/霓虹几何/品牌 CTA) + the clip's real copy; the old hard-coded debug badges ("CARD STACK PROXY", "FEATURE LIST PROXY", "KINETIC TYPOGRAPHY", "NEON GEOMETRY PROXY", "LOGO / CTA PLACEHOLDER", "MISSING N CARD PROXY", "Target image set/feature copy") are gone and `proxy/placeholder/占位/代理` is stripped from every label — verified by rendering all five families and inspecting the frames;
- [x] **Async generation jobs**: `POST /api/generations?async=true` returns `202 {jobId}`; polling `GET /api/jobs/:jobId` yields `outputRefs.generationId` on completion and a real `error.message` on failure (no fabricated success). Exercised by `npm run e2e:editing-beatcut` and `scripts/run-full-pipeline-aigc-demo.mjs`;
- [x] **Google-first AIGC fill**: with external providers allowed, the live API uses `google_gemini_image` (gemini-2.5-flash-image) → `volcengine_seedream` → real error, never a mock; `sampleFramesSentExternally=false`. Proven by `scripts/run-full-pipeline-aigc-demo.mjs` (real Gemini images + subtitles into `docs/artifacts/full_pipeline_aigc_*/`);
- [x] Remotion MP4 render path bundled and ready (composition compiles in 4s; renderMedia downloads headless Chromium on first call);
- [x] HyperFrames JSON manifest produced as deterministic stub artefact;
- [x] demo video shows the final product flow (recorded outside the repo).

High-score passes (P1 progression, r3) if:

- [x] natural-language revise applies a patch and produces a new generation id;
- [x] `/variants` returns four named versions (高点击/高转化/高节奏/高质感) with distinct controls;
- [x] `/scorecard` returns five-dimension scores in 0-100;
- [x] FR-008 gap report exposes Chinese labels + recommended fill strategies;
- [x] full E2E `apps/api/tests/e2e.test.ts` is green.
- [x] motion-graph target-asset adaptation demo renders both proxy and with-assets MP4s.
- [x] corpus fixture `009_motion_graph_card_stack` gates visual evidence, induced slots, renderer capability, target asset matching, no sample copy, and preview frames.
- [x] optional AIGC material fill generates briefs, generated assets, quality checks, AIGC fill plan, MP4, and contact sheet.
- [x] no-watermark Seedream image generation can be used through explicit external-provider opt-in; Gemini VLM can review generated assets without sample-frame upload.
- [x] web Reconstruction Planner exposes an explicit AIGC gap-fill button/toggle and API e2e covers the safe mock-provider path.

---

## 11. Known limitations to declare

- First version may use heuristic/mock video understanding.
- Direct video generation is not required and not assumed.
- Doubao-Seed-2.0-lite, if used, is treated as language/model planning capability, not a video generator.
- Initial renderer may be HTML preview before FFmpeg/Remotion/HyperFrames MP4.
- The product learns and transfers structure; it does not guarantee viral performance.
- Motion-graph target adaptation is still strongest in deterministic fixture/API harness modes; richer browser-side asset management remains productization work.
- Managed material manifest intake exists at the API/harness layer; browser AIGC gap fill is wired, but full drag/drop material pool editing is still productization work.
- Optional AIGC image material fill is implemented; direct video generation remains intentionally out of default scope.
- The deterministic visual evidence analyzer is currently wired to `motion_graph_case`; editing/marketing analyzer expansion is intentionally deferred.
