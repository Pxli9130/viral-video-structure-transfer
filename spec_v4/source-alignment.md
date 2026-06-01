# 01. Source Alignment

本文件说明 v4 和官方课题要求、v1.3 现状、参考 arch 之间的关系。

## 1. 官方课题对齐

官方课题的关键不是“直接生成视频”，而是：

```text
样例理解 → 结构抽取 → 素材适配 → 结果生成
```

系统需要体现：

- 如何定义视频结构。
- 如何把样例结构迁移到新内容。
- 素材不足时如何识别缺口并合理补全。
- 结果是否可解释、可调整、可展示。
- 最终需要可验证产物：视频 demo / 分镜 / 时间线 / 对比展示。

v4 对应关系：

| 官方要求 | v4 模块 |
|---|---|
| 样例输入与解析 | Evidence Analyzer + Frame Sheet Builder |
| 脚本/节奏/包装结构拆解 | VideoEvidenceBundle + StructureTemplate |
| 结构沉淀 | TechniqueAtom Library |
| 新内容与素材输入 | Asset Analyzer |
| 素材缺口识别 | Gap Analyzer |
| 缺口补全 | FillPlan + repair strategy |
| 结构迁移与结果生成 | Transfer Planner + RenderRecipe Compiler |
| 迁移过程可视化 | Structure/Atom/Gap/Layer UI |
| 成片 demo | Remotion + FFmpeg renderers |
| 多版本 | version strategies: high_click/high_conversion/high_quality |
| 人工可调/自然语言改片 | timeline patch / recipe patch |

## 2. v1.3 当前状态对齐

v1.3 已经做对了这些：

- “学结构，不抄内容”的安全边界。
- 确定性证据 + VLM grounding 的感知层。
- `StructureTemplate -> generateMigrationResult -> timeline -> RenderRecipe` 的主线。
- `RenderRecipe` 作为唯一渲染契约的方向。
- FFmpeg canonical + Remotion secondary renderer。
- quality gates 与 layout NCC 反 overfit 指标。

v1.3 的主要不足：

| 当前不足 | v4 改造 |
|---|---|
| non-beat fallback template 丢 visual/typography/audio evidence | `attachEvidenceToTemplate` 统一 evidence carry-forward |
| RenderRecipe clip-only，不能表达 media/text/motion/audio 细节 | backward-compatible `layers[]` |
| motionAtoms 停在 gap/renderPlan | `MotionAtomLayer` + renderer consumption |
| Remotion TypographyLayoutSequence 只画字 | `RenderMediaLayer` + text overlay |
| CTA 使用 raw prompt | productTheme 字段拆分 + sanitize |
| 字幕固定居中/字号固定 | TextLayer bboxNorm/fontSizeRatio/keyframes |
| elementGeometry 复用第一个 hero bbox | evidenceRefs/track-aware layout strategy |
| primitive vocabulary 太小 | TechniqueAtoms + component variants |
| procedural audio 参数过近 | audioStructure-driven synth |

## 3. 从参考 arch 中应该学习什么

可学习：

- Monorepo + shared schemas。
- Frame sheet builder，让 VLM 看结构而不是盲猜原视频。
- TechniqueAtom / Structure Knowledge Base。
- Asset Analyzer + Gap Analyzer。
- Timeline UI / Layer tracks。
- Remotion 做 motion graphics，FFmpeg 做素材处理和 mux。

暂时不建议照搬：

- PostgreSQL / Redis / BullMQ / Prisma / MinIO 全套基础设施。
- 复杂 worker 拆分。
- 过早引入权限、账户、项目管理等产品功能。

当前更有效的路径：

```text
先把 local artifact pipeline 做通：JSON + files + scripts + existing API。
然后再把 UI 和后端 job 化。
```

## 4. v4 的取舍

v4 不是“论文式完整架构”，而是“参赛项目能工作”的工程规格。

优先级：

1. 证据不丢。
2. renderer 真消费。
3. final video 好看且可解释。
4. UI 能让评委看懂迁移链路。
5. 再做队列、数据库、部署扩展。


## v4.1 model/provider alignment

- 比赛/导师强调没有生视频模型资源，主要提供语言模型资源，因此 v4.1 把 Seedance 2.0 设为 optional，不作为核心闭环依赖。
- 课题要求交付代码、演示视频、视频产物 case、项目说明文档；v4.1 包含 AI 架构、工具协议、RenderRecipe 数据协议、provider policy 和安全边界。
- 评分强调迁移过程可视化、素材缺口补全、多版本、真实素材适配和人工可调；v4.1 对这些点分别定义了 UI 页面、GapReport、VersionStrategy、AssetProfile 和 Natural Edit Patch。
