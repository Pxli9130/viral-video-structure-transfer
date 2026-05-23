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

## 8. Unit test matrix

| Area | Test | Expected |
|---|---|---|
| Schema | valid StructureTemplate | pass |
| Schema | missing segments | fail readable error |
| Schema | valid GenerationRequest video_plus_prompt | pass |
| Schema | missing prompt | fail |
| Schema | valid Timeline | pass |
| Project | create project | persisted |
| Asset | upload asset | saved with role/sourcePolicy |
| Analysis | mock sample analysis | deterministic result |
| Analysis | mock source analysis | deterministic shot candidates |
| Structure | fallback template | hook/body/proof/cta generated |
| KB | save template | atoms indexed |
| KB | query hook atoms | returns atoms |
| Slot matching | product slot + product shot | matched |
| Slot matching | usage slot + no usage shot | missing |
| Gap fill | missing hook visual | text_card or crop_zoom |
| Gap fill | missing CTA | text_card / packaging_overlay |
| Timeline | generated plan | no unresolved required slot |
| Renderer | html preview | preview payload generated |
| Export | timeline export | valid JSON file |

---

## 9. E2E acceptance criteria

MVP passes if:

- [ ] app runs locally;
- [ ] seeded demo works without AI key;
- [ ] sample video learning generates valid StructureTemplate;
- [ ] knowledge base stores atoms;
- [ ] source video + prompt generates valid Timeline;
- [ ] missing material triggers gap report;
- [ ] fill plan resolves missing required slots;
- [ ] result page shows sample structure, atoms, source mapping, gaps, fill plan, storyboard, preview;
- [ ] JSON exports are available.

Strong demo passes if:

- [ ] real ffprobe or FFmpeg analysis works on at least one uploaded video;
- [ ] at least one MP4 or render artifact can be produced;
- [ ] demo video shows the final product flow.

---

## 10. Known limitations to declare

- First version may use heuristic/mock video understanding.
- Direct video generation is not required and not assumed.
- Doubao-Seed-2.0-lite, if used, is treated as language/model planning capability, not a video generator.
- Initial renderer may be HTML preview before FFmpeg/Remotion/HyperFrames MP4.
- The product learns and transfers structure; it does not guarantee viral performance.
