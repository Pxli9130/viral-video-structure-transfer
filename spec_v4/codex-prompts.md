# 12. Codex Prompts

## 1. Main Implementation Prompt

```text
你是这个 repo 的 senior engineer。请实施 Spec v4.0: Evidence-Faithful Atom Transfer Engine。

目标：让 learned_samples_max / marketing / editing / motion_graph cases 真正从样例学习结构，并迁移到新素材，最终输出可看的 final.mp4 / final.remotion.mp4。不要只修单点，也不要为了架构洁癖重写全项目；目标是 make it work。

核心原则：
1. 样例只提供结构证据，不得复制样例帧/音频/水印。
2. analysis evidence 必须保真流过 template -> transferPlan -> RenderRecipe -> renderer。
3. RenderRecipe 从 clip-only 升级为 backward-compatible layer-based recipe。
4. TechniqueAtom 成为结构迁移的主要中间表示，避免 videoType/role-only primitive collapse。
5. Remotion 是主视觉 renderer；FFmpeg 负责 source video cut/crop/mux 和 fallback。
6. 先使用 local JSON/filesystem，不要引入 PostgreSQL/Redis/BullMQ/Prisma，除非已有项目强依赖。
7. 所有修复必须有 tests/gates，不要靠肉眼。

请先阅读：
- spec_v4/README.md
- spec_v4/requirements.md
- spec_v4/architecture.md
- spec_v4/design.md
- spec_v4/migration-v3-to-v4.md
- packages/shared/src/engine/planner.ts
- packages/shared/src/types.ts
- apps/api/remotion/ViralRecipeRoot.tsx
- apps/api/src/adapters/renderers.ts
- scripts/analyze-evidence-timeline.py
- learned_samples_max artifacts if present

P0：
1. 修 buildFallbackTemplate evidence carry-forward。
2. 修 productTheme prompt pollution。
3. 修 Remotion TypographyLayoutSequence 0 pics。
4. 扩 RenderRecipe 为 backward-compatible layer-based schema。
5. 实现 Remotion layer interpreter。
6. FFmpeg renderer 消费新增字段或 fallback。
7. 新增 scripts/inspect-learning-fidelity.mjs。

P1：
8. 新增 TechniqueAtom extraction。
9. selectPrimitive 改成 evidence + atom + material + capability。
10. 修 elementGeometry hero bbox over-reuse。
11. 修 audio fidelity。

P2：
12. Web UI 补 Evidence/Structure、TechniqueAtom、GapReport、Layer timeline、Render preview。
13. 多版本 high_click / high_conversion / high_quality。
14. Natural edit 最小实现。

测试：
必须新增/更新 evidence carry-forward、CTA sanitize、media rendering、schema compatibility、TextLayer bbox/fontSize、MotionAtomLayer、FFmpeg fallback、TechniqueAtom、primitive diversity、geometry、audioPlan、safety、fidelity script tests。

Validation：
先发现真实 package scripts，不要编造命令。尽量跑 pnpm typecheck/test/lint，以及 inspect-learning-fidelity for four cases。

Final report：
输出 Spec v4.0 Implementation Report，包括 files changed、fixes by root cause、tests run、artifact counts、render outputs、safety check、remaining risks、git status。
```

## 2. Focus Prompt: Evidence Carry-forward

```text
只修 analysis -> learned-template evidence carry-forward，不要改 renderer。

找到 buildBeatCutTemplate 和 buildFallbackTemplate。
抽 attachEvidenceToTemplate。
保留 heroDescriptor、typographyEvidence、visualElementGraph、audioStructure、renderPlan.motionAtoms、evidenceRefs。
添加测试证明 marketing/non-beat 不再 0/0/0。
最后运行相关 unit tests 和 git diff summary。
```

## 3. Focus Prompt: CTA and Remotion 0 Pics

```text
只修两个高影响 bug：
1. productTheme.name raw prompt pollution。
2. Remotion TypographyLayoutSequence ignores media。

要求：
- parsePromptToBrief 拆 productName/brandName/brief/ctaText/generationPrompt。
- sanitizeDisplayText。
- CtaSlate 不显示 raw prompt。
- TypographyLayoutSequence 有 material.assetIds 时先渲 media。
- 加 regression tests。
```

## 4. Focus Prompt: Layer-based RenderRecipe

```text
实现 backward-compatible RenderRecipe v4 layers[]。
保留 clips[]。
新增 MediaLayer/TextLayer/MotionAtomLayer/AudioLayer types and schema。
buildRenderRecipe carry bboxNorm/fontSizeRatio/animation/motionAtoms/audioLayers/provenance。
旧 recipe 继续 validate，新 recipe preferred。
加 tests。
```

## 5. Focus Prompt: Renderer Consumption

```text
让 Remotion 和 FFmpeg 消费 RenderRecipe v4 layers。
Remotion：LayerRecipeRoot, RenderLayer, MediaLayer, TextLayer, MotionAtomLayer, ParametricRibbonSurface。
FFmpeg：bbox/fontSize drawtext, motionAtom 2D fallback, audioPlan layers。
输出 render-log.json 记录 consumed/fallbacks。
加 renderer tests。
```

## 6. Focus Prompt: Primitive Diversity and Geometry

```text
实现 TechniqueAtom extraction 和 evidence-based primitive selection。
修 elementGeometryForClip 不再复用第一个 hero bbox。
四个 learned samples primitive histograms 不得完全相同。
多 image clips 不得全部 same bbox unless same evidence track。
加 tests 和 fidelity warnings。
```
```
