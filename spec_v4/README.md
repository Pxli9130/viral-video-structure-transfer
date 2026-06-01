# Spec v4.1 最新完整规格 — Evidence-Faithful Atom Transfer Engine

这是**最新版本单独包**，不包含旧版 `spec_v3` 或单独的 `spec_v4` 目录。

## 一句话目标

系统从样例视频中抽取结构证据和可复用的 `TechniqueAtom`，匹配到用户新素材，识别缺口并补全，最终编译成 layer-based `RenderRecipe v4.1`，由 Remotion + FFmpeg 输出可看的新短视频。

核心不是“调用最多模型”，而是：

1. 定义视频结构；
2. 把样例结构迁移到新内容；
3. 素材不足时能识别缺口并补全；
4. 结果可解释、可调整、可展示；
5. 最终能产出 `final.mp4` / `final.remotion.mp4`。

## v4.1 相比 v4.0 的新增点

1. **Seedance 2.0** 加入 AIGC moving visual fill，但仍是 optional provider，不是核心依赖。
2. **Seedream 4.0** 加入静态海报、背景、封面、商品卡片生成。
3. **ElevenLabs** 加入音频智能栈：Scribe ASR、TTS、SFX、Music、Audio Isolation、Dubbing/Lip Sync。
4. 新增 provider policy、routing/fallback schema、generated asset provenance schema。
5. 明确所有 AIGC provider 都必须有 fallback，核心 demo 仍靠 Remotion + FFmpeg 跑通。
6. 强化安全边界：样例帧/音频默认不得进入最终画面，也不得默认作为 AIGC reference。

## 推荐阅读顺序

1. `00-executive-summary.md`
2. `requirements.md`
3. `architecture.md`
4. `design.md`
5. `model-stack.md`
6. `provider-policy.md`
7. `routing-and-fallbacks.md`
8. `renderer-spec.md`
9. `data-contracts.md`
10. `tasks.md`
11. `test-plan.md`
12. `codex-prompts.md`
13. `SPEC_V4_1_ALL.md`

## 目录说明

```text
schemas/      JSON schemas: evidence, atoms, assets, gap report, recipe, providers
examples/     sample JSON fixtures
prompts/      Codex/implementation prompts
reference/    model/provider reference notes
```

## Core statement

```text
Seedance 2.0 = optional AIGC video-fill provider
Seedream 4.0 = optional image/poster fill provider
ElevenLabs = optional audio intelligence provider
Remotion + FFmpeg = deterministic rendering backbone
TechniqueAtom + layer-based RenderRecipe = structure-transfer core
```
