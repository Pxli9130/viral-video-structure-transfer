# Test Plan — 爆款结构迁移引擎 MVP v0.1

## 1. Verification Philosophy

MVP 验证重点不是“视频理解是否完美”，而是证明系统具备可扩展的核心链路：

1. 样例视频能进入系统并被结构化。
2. 结构模板不是纯文本，而是可机器消费的 JSON。
3. 新内容与素材能映射到模板槽位。
4. 素材不足能被识别并补全。
5. 时间线能被预览或渲染。
6. 评审能看懂迁移过程。

## 2. Demo Case A — 商品营销类最小闭环

### Input

- 1 条 10–20 秒营销类样例视频。
- 1 张商品图。
- 1 段商品 brief：

```text
商品：便携式桌面加湿器
目标用户：办公室久坐人群、学生
卖点：小巧便携、静音、USB 供电、柔和夜灯、缓解干燥
CTA：点击了解更多
风格：快节奏、高点击、字幕明显
```

### Expected Output

- Structure Template:
  - hook segment
  - product/value segment
  - CTA segment
  - at least 4 shot slots
  - packaging style and quality rules
- Slot Mapping:
  - product image matches product closeup slot
  - usage/comparison slots are missing or weak_match
- Gap Report:
  - missing usage scene
  - missing comparison scene
  - weak CTA visual
- Fill Plan:
  - product image crop/zoom
  - text card for usage benefit
  - title bar / selling point card
  - CTA card
- Timeline:
  - no empty slot
  - total duration 10–20 seconds
  - all clips have visual or generated text card
- Result Page:
  - sample structure summary
  - mapping/gap/fill explanation
  - preview or MP4

## 3. Demo Case B — 文案-only fallback

### Input

- Same sample template as Case A.
- No media assets.
- Brief with product name and selling points.

### Expected Output

- All visual slots are missing initially.
- Fill plan uses text cards, simple backgrounds, title bars and CTA cards.
- Timeline remains valid.
- Result clearly states that video is packaging/text-card based because no media assets were supplied.

## 4. Unit Test Matrix

| Area | Test | Expected |
|---|---|---|
| Schema | valid StructureTemplate | validation pass |
| Schema | missing segments | validation fail with readable message |
| Schema | timeline clip without layer | validation fail |
| Fallback Template | 15s video with 5 shots | hook/body/cta generated |
| Slot Matching | product slot + product image | matched |
| Slot Matching | usage slot + no video | missing |
| Gap Fill | missing product closeup + product image exists | reuse_with_crop_zoom |
| Gap Fill | missing usage + brief text exists | text_card |
| Timeline | missing slots after fill | no empty clips |
| API | create project | project persisted |
| API | upload asset | asset persisted and listed |
| API | generation mock mode | complete result returned |

## 5. E2E Verification Steps

1. Start API and frontend in mock mode.
2. Create or open demo project.
3. Upload/load sample video.
4. Run sample analysis.
5. Confirm structure template is created and visible.
6. Enter product brief and upload one product image.
7. Run generation.
8. Confirm slot mapping and gap report.
9. Confirm fill plan has no unresolved missing slot.
10. Confirm storyboard and timeline are generated.
11. Render or preview timeline.
12. Export JSON/report.

## 6. Pass/Fail Criteria

MVP passes if all conditions are true:

- [ ] Fresh local run works with mock provider.
- [ ] At least one sample can produce valid StructureTemplate JSON.
- [ ] At least one new brief + asset set can produce valid Timeline JSON.
- [ ] Missing slots are detected in sparse-material case.
- [ ] Missing slots are filled by deterministic strategies.
- [ ] Result page shows extraction, mapping, gap fill and output preview/video.
- [ ] JSON exports are available for debugging and future development.

## 7. Known Limitations to Declare in Demo

- The first MVP uses heuristic and mock fallback for video understanding when real AI provider is unavailable.
- Shot labels may be approximate until VLM/OCR/ASR are fully integrated.
- Rendering may start with HTML preview or simple FFmpeg output before advanced Remotion packaging.
- The system validates structure migration workflow; it does not claim the result is guaranteed to become viral.
