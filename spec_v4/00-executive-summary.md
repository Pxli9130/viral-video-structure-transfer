# 00. Executive Summary

## 目标

Spec v4.1 的目标是把系统从“结构说明写得像，但成片像换图模板”改到“样例结构证据能保真传递，并被 renderer 真正消费”。

> 版本说明：本规范文档为 spec v4.1；实现层的 typed model-router 摘要版本字面量为 `model-router-v4.2`（router.ts:385、types.ts:180）。

一句话：

```text
学结构，不抄内容；拆原子，不套整模；编 layer，不猜 clip；能解释，能渲染，能验收。
```

## 当前已确认的主要问题

| ID | 问题 | v4 处理方式 |
|---|---|---|
| F1 | marketing analysis 有证据，template 层丢失 | `attachEvidenceToTemplate()` 统一 carry-forward |
| F2 | 3D ribbon 被识别但无人渲染 | `MotionAtomLayer` + Remotion ribbon + FFmpeg fallback |
| F3 | Remotion TypographyLayoutSequence 0 pics | `MediaLayer` / media-before-text render helper |
| F4 | CTA 结尾显示整段 prompt | `productName/ctaText/rawPrompt` 拆分 + sanitize |
| F5 | bbox/fontSize/animation 没进 recipe | `TextLayer.layout/typography/animation` 明确表达 |
| F6 | FFmpeg 复用第一个 hero bbox | `elementTrackId/slotInstanceId/evidenceRefs` layout strategy |
| F7 | 四个视频 primitive 相似 | `TechniqueAtom` + evidence-based primitive selection |
| F8 | BGM 像同一首底噪 | audioStructure 全链路保留 + style/layer/accent 驱动 synth |

## v4 架构关键

```text
VideoEvidenceBundle
  ↓
StructureTemplate + TechniqueAtoms
  ↓
AssetProfile + GapReport
  ↓
TransferPlan
  ↓
RenderRecipe v4 { clips[], layers[] }
  ↓
Remotion Layer Interpreter + FFmpeg mux/fallback
  ↓
final.mp4 / final.remotion.mp4 + evidence-fidelity report
```

## 原则

### 1. Evidence first

坐标、节奏、镜头、OCR/ASR、音频峰值等尽量由确定性工具产出。VLM/LLM 主要做命名、归纳、解释和映射，不做唯一事实来源。

### 2. Template is not enough; TechniqueAtoms matter

不能把整条样例压成一个粗 `videoType`。结构要拆成 TechniqueAtoms：字幕扫入、卡片堆叠、ribbon、impact flash、CTA slate、source montage 等。

### 3. Clip is time; Layer is pixels

clip 表示时间段和叙事 role，layer 才是真正渲染单位。一个 clip 可以包含 media/text/motion/audio 多层。

### 4. Renderer consumes recipe, not guesses structure

renderer 不应从 `role=hook` 重新猜组件。结构选择和 fallback 应该在 RenderRecipe 中显式表达。

### 5. Safety is invariant

样例视频只提供结构证据。默认 `sampleFrameCopyAllowed=false`、`sampleAudioCopyAllowed=false`。任何 sample pixel/audio 路径都不能进入 final material。

## 适合当前项目的范围

当前不要追求“万能视频生成器”。优先把三个 showcase 打强：

1. **Editing**：黑底红黄大字剪辑教程 / 卡点混剪。
2. **Marketing**：白底 3D ribbon 动态海报。
3. **Motion Graph**：黑红/蓝黑科技广告。

每个 showcase 都必须能展示：

```text
样例证据 → TechniqueAtoms → slot mapping → gap repair → layer recipe → final video
```
