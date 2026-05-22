# Viral Video Structure Transfer Engine

AI 创作平台，用于从优质短视频样例中学习可复用的创作结构，并将这些结构迁移到新的素材、主题或商品内容中，生成可解释、可预览、可进一步渲染的视频重组方案。

当前版本为 **MVP Spec v1.1**，已根据官方过程 FAQ 调整：第一版重点验证核心闭环，不追求覆盖全部高级功能。

## MVP v1.1 Focus

核心验证链路：

```text
样例视频学习
→ 结构模板 / 结构原子沉淀
→ 结构知识库
→ 新视频 + Prompt 输入
→ 槽位匹配与素材缺口识别
→ 缺口补全与重构规划
→ Storyboard / Timeline JSON
→ 浏览器预览，后续可扩展为 FFmpeg / Remotion / HyperFrames 渲染
```

本项目不是简单复制爆款视频内容，而是迁移其创作方法，例如 hook、节奏、字幕包装、卖点推进、转场和 CTA 结构。

## Why v1.1 changed from v1

官方 FAQ 明确了几件事：

- 评测时可能会使用评委自己的素材，而不是只看提交时绑定的素材。
- 测试输入更可能是视频，通常是一个较长视频素材，而不是默认给多个切好的分镜素材。
- 推荐形态可以理解为：输入一段视频和提示词，视频作为素材输入，再结合已沉淀的知识库经验去重构生成新视频。
- 不提供视频生成模型 token，Doubao-Seed-2.0-lite 不能直接生成视频；Remotion / HyperFrames / FFmpeg 更适合作为工程渲染路径。
- 生成速度不是核心指标，结构规划与最终产物效果更重要。

## Specs

- [Requirements](./spec_v1_1/requirements.md)
- [Design](./spec_v1_1/design.md)
- [Implementation Tasks](./spec_v1_1/tasks.md)
- [Test Plan](./spec_v1_1/test-plan.md)
- [Schemas](./spec_v1_1/schemas/)

## Recommended MVP Tech Stack

```text
Frontend: React + TypeScript + Vite
Backend: Node.js + TypeScript + Express/Fastify
Shared: TypeScript types + JSON schemas
Storage: local JSON under storage/
Video tools: FFmpeg / FFprobe optional, deterministic mock fallback required
Renderer v1: HTML / browser timeline preview
Renderer later: FFmpeg, Remotion, HyperFrames
AI provider v1: mock/fallback first; OpenAI-compatible / Doubao adapter later
```

## Local Development

The MVP runs locally in deterministic mock mode:

```bash
npm install
npm test
npm run build
npm run dev
```

Open:

- Web: `http://localhost:5173`
- API health: `http://localhost:3000/healthz`

Demo path:

1. Open or create the default `b2b_marketing_mg` project.
2. Click `Analyze Mock Sample` or upload a sample video.
3. Review the generated Structure Template and Knowledge Base atoms.
4. Click `Add Mock Source Video` or upload a source video.
5. Edit the prompt and click `Generate Reconstruction`.
6. Review slot mapping, gaps, fill plan, storyboard and timeline preview.
7. Export Template / Knowledge Base / Request / Timeline / Report JSON.

Configuration starts from `.env.example`:

```bash
APP_PORT=3000
WEB_PORT=5173
STORAGE_DIR=./storage
AI_PROVIDER=mock
RENDERER=html_preview
```

The app supports mock/fallback mode so the core demo can run without external API keys or FFmpeg. Real LLM/VLM/ASR/FFmpeg/Remotion/HyperFrames integrations remain adapter-backed extension work.

## MVP Non-goals

- No requirement to generate a perfect MP4 in the first coding version.
- No dependency on video generation models.
- No need to support every video category.
- No real platform traffic validation.
- No guarantee that output will become viral.

## Preferred MVP Vertical

Primary demo vertical: **B-end marketing / MG-style promo short videos**.

Reason: this direction is easier to render with text cards, product cards, motion graphics, FFmpeg, Remotion, or HyperFrames, and does not depend heavily on expensive video generation models.

Future extensions can support vlog, 口播, 剪辑卡点, short drama clips, and multi-template fusion.
