# 02. Requirements

## 1. Product Goal

用户上传一条或多条样例视频，再上传新主题/商品信息/素材，系统自动分析样例结构，沉淀创作原子，匹配新素材，识别缺口并补全，生成新短视频。

## 2. User Stories

### US1: 样例学习

用户上传样例视频，系统展示：

- 基础信息：时长、fps、分辨率、音频、封面。
- 镜头结构：shot timeline、cut density、climax。
- 节奏结构：beat grid、energy curve、accent。
- 字幕结构：OCR/ASR、bbox、字号、动画。
- 包装结构：贴纸、卡片、ribbon、UI panel、CTA。
- TechniqueAtoms：可复用创作原子。

### US2: 新素材输入

用户上传：

- 图片：商品图、logo、截图、海报。
- 视频：产品使用、人物、场景、口播、长素材。
- 文案：商品名、卖点、CTA、风格要求。
- 可选：目标版本 high_click / high_conversion / high_quality。

系统输出 AssetProfile。

### US3: Gap Report

系统展示每个 slot/atom 的匹配情况：

- matched。
- weak_match。
- missing。

每个 gap 必须说明：

```text
缺什么 → 为什么缺 → 影响什么 → 用什么策略补 → 结果会长什么样
```

### US4: 视频生成

系统输出：

- script / storyboard / timeline / render recipe。
- `final.mp4`。
- `final.remotion.mp4`。
- preview frames。
- structure diff。

### US5: 人工可调

至少支持一种：

- 改 hook 强度。
- 改卖点顺序。
- 改包装风格。
- 改节奏。
- 改 CTA。

### US6: 自然语言改片

最小支持：

```text
“开头更抓人一些”
“减少字幕，增强节奏感”
“把商品信息提前”
```

输出 recipe patch，并重新渲染。

## 3. P0 Requirements

### P0.1 Evidence Analyzer

必须输出：

- `analysis.json`。
- frame sheets。
- shot timeline。
- beat/energy summary。
- typographyEvidence。
- visualElementGraph。
- motionAtoms。
- audioStructure。

如果没有识别到某类 evidence，必须写 explicit empty reason。

### P0.2 Template Evidence Carry-forward

`buildBeatCutTemplate()` 和 `buildFallbackTemplate()` 都必须保留：

- heroDescriptor。
- typographyEvidence。
- visualElementGraph。
- audioStructure。
- renderPlan.motionAtoms。
- evidenceRefs/sourceEvidence。

### P0.3 Layer-based RenderRecipe

保留 `clips[]`，新增 `layers[]`：

- MediaLayer。
- TextLayer。
- MotionAtomLayer。
- ShapeLayer。
- TransitionLayer。
- AudioLayer。

### P0.4 Renderer Must Consume Layers

Remotion：

- render media/image/video。
- render text with bbox/font size。
- render parametric ribbon。
- render CTA safely。

FFmpeg：

- source video cut/crop/mux。
- image overlay fallback。
- text draw fallback。
- motion atom 2D fallback。
- procedural audio from audioPlan。

### P0.5 Safety

必须满足：

```text
sampleFrameCopyAllowed = false
sampleAudioCopyAllowed = false
sample asset path not in final material.assetIds
provenance preserved
```

## 4. P1 Requirements

- TechniqueAtom extraction。
- Evidence-based primitive selection。
- Element track-aware layout。
- AudioPlan fidelity。
- 多版本 generation。
- UI 展示 mapping/gap/layer。

## 5. P2 Requirements

- Natural language editing。
- Fine-grained timeline editor。
- Structure KB search/retrieval。
- 自动评估和可视化质量报告。
- 可选数据库/队列化部署。

## 6. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Local deploy | `npm install && npm run demo:final` or documented equivalent |
| Determinism | fixtures/golden tests deterministic |
| No silent fallback | every dropped evidence has reason |
| Explainability | every clip/layer has evidenceRefs or fallbackReason |
| Runtime | speed not primary; should complete demo cases reliably |
| Cost control | no external paid API in tests unless explicitly enabled |
| Security | no API keys committed; no sample copy |

## 7. Hard Definition of Done

1. `marketing` template preserves non-empty evidence.
2. `marketing` recipe has media/text/motion/audio layers.
3. Remotion no longer outputs 0 pics for image-bearing recipe.
4. CTA safe.
5. MotionAtom rendered.
6. Typography fidelity improved.
7. Element geometry not over-reused.
8. Primitive diversity across cases.
9. Audio diversity across cases.
10. Final MP4s render for at least marketing + one other case.
