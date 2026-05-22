# Test Plan — 爆款结构迁移引擎 MVP Spec v1.1

## 1. Verification Philosophy

MVP v1.1 验证重点不是“视频理解是否完美”，而是证明系统具备可扩展、可解释、可评审复现的核心链路：

1. 样例视频能进入系统并被结构化。
2. 结构模板不是纯文本，而是可机器消费的 JSON。
3. 样例经验能沉淀为结构知识库和 structure atoms。
4. 评委上传的新视频 + prompt 能进入重构流程。
5. 新视频候选片段能映射到结构槽位。
6. 素材不足能被识别并补全。
7. Timeline 能被浏览器预览或后续渲染。
8. 评审能看懂“学到了什么、怎么迁移、哪里补全、结果是什么”。

## 2. Official-like Demo Case A — New Video + Prompt Reconstruction

### Input

- 1 条 10–20 秒 B-end marketing / MG-style 样例视频，用于学习结构。
- 1 条 20–60 秒 source video，作为评委/用户提供的新素材。
- 1 段 prompt：

```text
请基于已学习的爆款营销视频结构，把这个素材重构成一个 15 秒竖屏短视频。
主题：便携式桌面加湿器
目标用户：办公室久坐人群、学生
卖点：小巧便携、静音、USB 供电、柔和夜灯、缓解干燥
风格：快节奏、字幕明显、带 MG 风格卖点卡片
CTA：点击了解更多
```

### Expected Output

- Sample Structure Template:
  - hook segment
  - product/value segment
  - proof or benefit segment
  - CTA segment
  - at least 4 shot slots
  - packaging style and rhythm rules
  - structure atoms
- Knowledge Base:
  - hook atom
  - selling point card atom
  - transition / rhythm atom
  - CTA atom
- Source Video Analysis:
  - source video metadata
  - shot candidates
  - thumbnails or placeholder frames
  - heuristic tags
- Slot Mapping:
  - at least one slot matched to source video candidate
  - some slots may be weak or missing
- Gap Report:
  - missing or weak usage/comparison/CTA visual if source video is sparse
- Fill Plan:
  - crop/zoom reuse
  - text card
  - packaging overlay
  - CTA card
- Timeline:
  - no empty slot
  - target duration around 15 seconds
  - all clips have visual or generated card
  - renderer target is `html_preview` or `mock_preview`
- Result Page:
  - sample structure summary
  - selected structure atoms
  - source mapping
  - gap/fill explanation
  - storyboard and timeline preview

## 3. Demo Case B — Sparse Source Video

### Input

- Same learned sample structure as Case A.
- Source video contains only one simple product shot or mock fixed-interval shots.
- Prompt contains product name and selling points.

### Expected Output

- Product/closeup slot can be matched or weak matched.
- Usage/comparison/proof slots become missing or weak.
- Fill plan uses:
  - repeated crop/zoom from source video;
  - text-card benefit explanation;
  - packaging overlay;
  - CTA card.
- Timeline remains valid.
- Result clearly states that output relies on packaging and text-card fill because video素材不足。

## 4. Demo Case C — Prompt-only Fallback

### Input

- Same learned sample structure as Case A.
- No source video.
- Prompt only:

```text
生成一个 12 秒桌面加湿器营销短视频方案，强调静音、夜灯、USB 供电。
```

### Expected Output

- System should not crash.
- All visual slots are initially missing.
- Fill plan uses text cards, simple background placeholders, title bars and CTA cards.
- Timeline remains schema-valid.
- Result declares limitation: no source video provided, preview is storyboard/text-card based.

## 5. Demo Case D — Vertical Focus Declaration

### Input

- Project vertical set to `b2b_marketing_mg`.
- User attempts to request a vlog-style output.

### Expected Output

- System can still generate a basic plan, but should display a warning:
  - current MVP is optimized for B-end marketing / MG-style outputs;
  - vlog/口播 support is future extension.
- No hard failure unless required input is missing.

## 6. Unit Test Matrix

| Area | Test | Expected |
|---|---|---|
| Schema | valid StructureTemplate | validation pass |
| Schema | StructureTemplate missing segments | validation fail with readable message |
| Schema | valid GenerationRequest with video_plus_prompt | validation pass |
| Schema | GenerationRequest missing prompt | validation fail |
| Schema | valid Timeline with clips and layers | validation pass |
| Schema | Timeline clip without layers | validation fail |
| Fallback Template | 15s sample with 5 shots | hook/body/proof/cta generated |
| Knowledge Base | save template atoms | atoms retrievable by project/vertical |
| Knowledge Base | no selected template | auto-select default atoms by vertical |
| Source Analysis | source video in mock mode | shot candidates generated |
| Slot Matching | product slot + product-like source shot | matched or weak_match |
| Slot Matching | usage slot + no suitable shot | missing |
| Gap Fill | missing product closeup + any visual source exists | reuse_with_crop_zoom |
| Gap Fill | missing usage + prompt text exists | text_card |
| Gap Fill | missing CTA visual | packaging_overlay or text_card |
| Timeline | missing slots after fill | no empty clips |
| API | create project | project persisted |
| API | upload source video | asset persisted and listed |
| API | generation mock mode | complete result returned |
| Renderer | html preview | preview payload generated |

## 7. E2E Verification Steps

1. Start API and frontend in mock mode.
2. Create or open seeded demo project.
3. Upload or load sample video.
4. Run sample analysis.
5. Confirm Structure Template is created and visible.
6. Save template into Knowledge Base.
7. Upload or load source video.
8. Enter prompt.
9. Run reconstruction generation.
10. Confirm source video shot candidates are created.
11. Confirm slot mapping and gap report.
12. Confirm fill plan has no unresolved missing slot.
13. Confirm storyboard and timeline are generated.
14. Render or preview timeline.
15. Export JSON/report.

## 8. Pass/Fail Criteria

MVP passes if all conditions are true:

- [ ] Fresh local run works with mock provider.
- [ ] At least one sample can produce valid StructureTemplate JSON.
- [ ] Structure atoms are saved into Knowledge Base.
- [ ] At least one source video + prompt can produce valid Timeline JSON.
- [ ] Missing slots are detected in sparse-material case.
- [ ] Missing slots are filled by deterministic strategies.
- [ ] Result page shows extraction, knowledge atoms, mapping, gap fill and output preview/video.
- [ ] JSON exports are available for debugging and future development.

## 9. Known Limitations to Declare in Demo

- The first MVP uses heuristic and mock fallback for video understanding when real AI provider is unavailable.
- Shot labels may be approximate until VLM/OCR/ASR are fully integrated.
- Rendering may start with HTML preview or simple FFmpeg output before advanced Remotion/HyperFrames packaging.
- Doubao-Seed-2.0-lite is not treated as a video generation model.
- The system validates structure migration workflow; it does not claim the result is guaranteed to become viral.
- Current recommended vertical is B-end marketing / MG-style short videos; other verticals are future extensions.

## 10. Manual Judge Demo Script

For final showcase recording, use this sequence:

1. Show README and local startup.
2. Open demo project.
3. Show sample video analysis.
4. Show extracted hook/body/proof/CTA structure.
5. Show structure atoms in knowledge base.
6. Upload source video and prompt.
7. Click generate.
8. Show slot mapping and gap report.
9. Show fill plan.
10. Show generated storyboard and timeline preview.
11. Export Timeline JSON.
12. Explain future renderer path: FFmpeg / Remotion / HyperFrames.
