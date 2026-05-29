# Demo Playbook — Final Spec v1.2

Use this playbook for product demos, judge walkthroughs, and final recording.

---

## 1. One-sentence demo story

“我先让系统学习一个爆款视频的结构，把 hook、节奏、字幕包装、CTA 等拆成知识库；然后我上传一个新的长视频和一句需求，系统自动选片段、发现缺口、补全包装，生成一个新的短视频时间线和预览。”

---

## 2. Recommended final demo vertical

B-end marketing / MG-style product promo.

Example prompt:

```text
帮我把这段产品素材重构成一个 15 秒高转化短视频，突出便携、护眼、价格友好，风格要快节奏、字幕清晰，结尾引导立即购买。
```

---

## 3. Demo flow

### Step 1 — open local app

Show that the project runs locally.

```bash
npm install
npm run dev
```

Narration:

```text
这个项目不要求部署上线，评委本地能跑通主流程即可。这里我用本地 Web App 演示。
```

### Step 2 — create/open project

Show project config:

- vertical: B-end marketing / MG;
- aspect ratio: 9:16;
- target duration: 15s.

### Step 3 — sample learning

Upload or select a sample video.

Show:

- metadata;
- keyframes/shots;
- extracted hook/body/proof/CTA;
- rhythm;
- packaging;
- structure atoms.

Narration:

```text
这里不是复制样例视频，而是学习它的创作方法。系统把样例拆成结构模板和结构原子，后面会用这些经验重构新视频。
```

### Step 4 — knowledge base

Show saved atoms:

- hook pattern;
- rhythm pattern;
- subtitle style;
- title card pattern;
- CTA pattern;
- gap fill strategy.

### Step 5 — source video + prompt

Upload a new source video and enter prompt.

Show source shot candidates.

Narration:

```text
官方测试时更可能给一段视频素材，所以这个系统支持视频 + 提示词输入，而不是只靠文字生成。
```

### Step 6 — slot matching and gap detection

Show table:

| Target slot | Source shot | Status | Reason |
|---|---|---|---|
| hook | shot 03 | matched | motion/high visual impact |
| product closeup | shot 05 | weak_match | product visible but not close enough |
| usage | none | missing | no usage shot detected |
| CTA | generated card | filled | CTA text from prompt |

### Step 7 — gap fill

Show fill plan:

- crop/zoom existing shot;
- text card for missing usage;
- packaging overlay for selling point;
- CTA card.

### Step 8 — result preview

Show storyboard/timeline:

```text
0.0–2.5s  Hook
2.5–7.0s  Selling point 1
7.0–11.0s Proof / comparison
11.0–15.0s CTA
```

Show HTML preview, then optionally MP4 if implemented.

### Step 9 — export

Show export buttons:

- structure template JSON;
- generation request JSON;
- timeline JSON;
- report.

---

## 4. What judges should notice

- The product takes video input.
- The product extracts structure, not just captions.
- The product stores knowledge atoms.
- The product reconstructs a new video from a new source video and prompt.
- The product handles missing material.
- The product explains every mapping and gap fill.
- The product has renderer path for FFmpeg/Remotion/HyperFrames.
- The motion-graph hardening path separates reference structure evidence from target material and shows proxy-to-asset replacement.

---

## 5. Motion-graph target adaptation walkthrough

Use this focused artifact demo when the judge wants proof that the system is not just showing proxy cards.

Commands:

```bash
npm run build
node scripts/generate-motion-graph-target-assets.mjs
node scripts/run-motion-graph-case.mjs
node scripts/run-motion-graph-case.mjs --with-target-assets
npm run regression:corpus:strict
VVST_REUSE_IGF_FIXTURE=1 npm run demo:product
node scripts/check-product-demo-page.mjs
```

Show these artifacts:

```text
docs/artifacts/motion_graph_case/visual-evidence.json
docs/artifacts/motion_graph_case/induced-slots.json
docs/artifacts/motion_graph_case/slot-asset-matches.json
docs/artifacts/motion_graph_case/render_proxy.mp4
docs/artifacts/motion_graph_case/render_with_assets.mp4
docs/artifacts/motion_graph_case/before_after_contact_sheet.png
docs/artifacts/motion_graph_case/evaluation.motion_graph.json
```

Narration:

```text
这里样例视频只提供结构证据，不作为目标素材复制。系统从像素证据归纳 media cards、feature list、neon geometry 和 CTA 等开放世界槽位。没有目标素材时先生成代理版本；加载目标素材 fixture 后，media cards 替换成用户卡片图，feature list 使用用户文案，CTA 使用用户 logo，同时保持原来的 motion-graph 结构。
```

Expected slot mapping:

| Slot family | Fulfillment |
|---|---|
| `media_cards` | 4 target card images |
| `kinetic_typography` | target brand/copy |
| `ui_showcase` | target feature list |
| `geometric_mg` | procedural neon geometry |
| `brand_cta` | target logo + CTA |

Corpus evidence:

```text
test_videos/corpus/009_motion_graph_card_stack/fixture.json
```

This fixture gates visual evidence generation, induced slots, renderer capability selection, target asset matching, no sample visual copy, preview frames, and with-assets render presence.

---

## 6. Demo fallback statement

If real AI or renderer is disabled, say:

```text
当前演示运行在 deterministic fallback 模式，用固定规则模拟 VLM/LLM 输出，目的是验证产品主流程和数据协议。后续接入真实 VLM、ASR、FFmpeg、Remotion 后，不需要改核心流程，只替换 adapter。
```

---

## 7. Final recording checklist

- [ ] show README and local run command;
- [ ] show project dashboard;
- [ ] show sample upload/analysis;
- [ ] show extracted structure;
- [ ] show knowledge base;
- [ ] show source video + prompt input;
- [ ] show slot mapping;
- [ ] show gap report;
- [ ] show fill plan;
- [ ] show timeline preview or MP4;
- [ ] show motion_graph proxy vs with-assets before/after sheet;
- [ ] show export JSON;
- [ ] explain future VLM/ASR/Remotion path.
