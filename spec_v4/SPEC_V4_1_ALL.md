# SPEC V4.1 ALL-IN-ONE

> **AUTO-AGGREGATED — 请勿手工编辑（DO NOT HAND-EDIT）。**
>
> 本文件原先是 `spec_v4/` 下各拆分文档的逐字汇总副本（约 80KB）。该副本已落后于拆分文档（其时间戳早于已更新的 `provider-policy.md` / `model-stack.md` 等文件），因此携带了大量已被纠正的过期内容（reversed ASR/image-fill 链路、`render-recipe-v4` 旧版本号、未实现的 model family、已不存在的 REST 路由等）。
>
> 为消除“双副本漂移（drift）”，本文件已被**去重收敛**为一个聚合索引 banner。
>
> **单一事实来源（Single Source of Truth）= `spec_v4/` 目录下的各拆分文档。** 本聚合页不再手工维护内容。若需要重新生成全文聚合产物，应由构建步骤机械地拼接已纠正的拆分文件，而不是在此手工补写第二份副本。

---

## 阅读顺序与拆分文档索引

按以下顺序阅读 `spec_v4/` 下的拆分文档（与 `manifest.json` 一致）：

| # | 文档 | 文件 |
|---|---|---|
| 00 | Executive Summary | [`00-executive-summary.md`](./00-executive-summary.md) |
| 01 | Source Alignment | [`source-alignment.md`](./source-alignment.md) |
| 02 | Requirements | [`requirements.md`](./requirements.md) |
| 03 | Architecture | [`architecture.md`](./architecture.md) |
| 04 | Design: Core Protocols | [`design.md`](./design.md) |
| 05 | Model Stack | [`model-stack.md`](./model-stack.md) |
| 06 | Provider Policy | [`provider-policy.md`](./provider-policy.md) |
| 07 | Routing and Fallbacks | [`routing-and-fallbacks.md`](./routing-and-fallbacks.md) |
| 08 | Renderer Spec | [`renderer-spec.md`](./renderer-spec.md) |
| 09 | Data Contracts and Artifact Conventions | [`data-contracts.md`](./data-contracts.md) |
| 10 | API and CLI Spec | [`api.md`](./api.md) |
| 11 | UI and Demo Spec | [`ui-demo-spec.md`](./ui-demo-spec.md) |
| 12 | Implementation Tasks | [`tasks.md`](./tasks.md) |
| 13 | Test Plan | [`test-plan.md`](./test-plan.md) |
| 14 | Implementation Delta (v4.0 → v4.1) | [`implementation-delta.md`](./implementation-delta.md) |
| 15 | Acceptance Gates | [`acceptance-gates.md`](./acceptance-gates.md) |
| 16 | Migration Plan (v3/v1.3 → v4.1) | [`migration-to-v4-1.md`](./migration-to-v4-1.md) |
| 17 | Codex Prompts | [`codex-prompts.md`](./codex-prompts.md) |
| 18 | CHANGELOG | [`CHANGELOG.md`](./CHANGELOG.md) |

辅助文件：

- 包索引与提供方清单：[`README.md`](./README.md)、[`manifest.json`](./manifest.json)
- 实现状态模板：[`implementation-status-template.md`](./implementation-status-template.md)
- JSON Schemas：`schemas/`（canonical RenderRecipe schema 为 `render-recipe-v4-1.schema.json`）
- 示例 fixtures：`examples/`
- 提供方 / 选型参考：[`reference/model-sources.md`](./reference/model-sources.md)
- Codex / 实现提示词：`prompts/`

## 版本说明

- 本规格包版本为 **spec v4.1**（见 `manifest.json` 的 `version: "4.1"`）。
- 运行时强类型 model-router 的 summary literal 为 **`model-router-v4.2`**（见 `packages/shared/src/model-router/router.ts`、`packages/shared/src/model-router/types.ts`）；说明见 [`docs/model-router-v4-2.md`](../docs/model-router-v4-2.md)。

## Core statement

```text
Seedance 2.0       = optional AIGC video-fill provider（失败不中断，回退本地程序化运动代理）
Seedream（Volcengine）= optional image/poster fill provider（model id 由 SEEDREAM_ARK_MODEL/AIGC_IMAGE_MODEL 提供，无内置默认）
ElevenLabs         = optional audio intelligence provider（ASR/TTS/SFX/Music/Isolation/Forced Alignment 已接入；Dubbing/Lip Sync 仅预留，未实现）
Remotion + FFmpeg  = deterministic rendering backbone
TechniqueAtom + layer-based RenderRecipe = structure-transfer core
```
