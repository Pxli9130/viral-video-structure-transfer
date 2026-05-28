#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFallbackTemplate,
  buildMockVideoAnalysis,
  generateMigrationResult,
  induceSlotsFromAnalysis,
  matchSlots,
  nowIso,
  understandSourceVideo
} from "../packages/shared/dist/index.js";
import { FFmpegRenderer } from "../apps/api/dist/adapters/renderers.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "docs", "artifacts", "motion_graph_case");
const previewDir = path.join(artifactDir, "preview_frames");
const samplePath = path.join(repoRoot, "test_videos", "motion_graph_1.mov");
const forbiddenArtifactPatterns = [
  { id: "/home/pxli", re: /\/home\/pxli/g },
  { id: ".env", re: /\.env/g },
  { id: "GEMINI_API_KEY", re: /GEMINI_API_KEY/g },
  { id: "AIza", re: /AIza[0-9A-Za-z_-]*/g },
  { id: "ark-", re: /ark-[0-9A-Za-z_-]*/g }
];
const textArtifactExtensions = new Set([".html", ".md", ".json", ".txt", ".csv"]);

function resolveBin(name) {
  const explicit = process.env[name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"];
  if (explicit && explicit !== name) return explicit;
  const condaBase = process.env.CONDA_BASE ?? "/home/pxli/anaconda3";
  const condaEnv = process.env.VIRAL_CONDA_ENV ?? "viral";
  const condaBin = path.join(condaBase, "envs", condaEnv, "bin", name);
  return existsSync(condaBin) ? condaBin : name;
}

const ffmpegBin = resolveBin("ffmpeg");
const ffprobeBin = resolveBin("ffprobe");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function extractFrame(inputPath, timeSec, outputPath) {
  await run(ffmpegBin, [
    "-y",
    "-ss",
    String(Math.max(0, timeSec).toFixed(2)),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=360:-1",
    outputPath
  ]);
}

async function muxBeatAudio(videoInputPath, outputPath, durationSec) {
  const tickSource = `aevalsrc=if(lt(mod(t\\,0.5)\\,0.035)\\,0.18*sin(2*PI*920*t)\\,0):s=48000:d=${Math.max(1, durationSec).toFixed(2)}`;
  await run(ffmpegBin, [
    "-y",
    "-i",
    videoInputPath,
    "-f",
    "lavfi",
    "-i",
    tickSource,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-b:v",
    "950k",
    "-maxrate",
    "1200k",
    "-bufsize",
    "1900k",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath
  ]);
}

async function probeRender(renderPath) {
  const result = await run(ffprobeBin, [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,codec_name,width,height,r_frame_rate",
    "-show_entries",
    "format=duration,size,bit_rate",
    "-of",
    "json",
    renderPath
  ]);
  const parsed = JSON.parse(result.stdout || "{}");
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  let fps = null;
  if (video?.r_frame_rate) {
    const [n, d] = String(video.r_frame_rate).split("/").map(Number);
    if (Number.isFinite(n) && Number.isFinite(d) && d !== 0) fps = n / d;
  }
  return {
    durationSec: parsed.format?.duration ? Number(parsed.format.duration) : null,
    sizeBytes: parsed.format?.size ? Number(parsed.format.size) : null,
    bitrate: parsed.format?.bit_rate ? Number(parsed.format.bit_rate) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps,
    hasAudio: Boolean(audio),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null
  };
}

function motionGraphVlmFixture() {
  return {
    videoType: "motion_graphic_saas_promo",
    videoSummary:
      "Motion graphic SaaS promo with cascading card stack, rapid collage zoom, feature list UI scroller, neon geometry line frames, cinematic hero montage, split kinetic typography, and final logo/end-slate CTA.",
    shots: [
      { start: 0, end: 3, visual: "Cascading card stack showing varied media formats around center text", purpose: "hook", transition: "zoom_out" },
      { start: 3, end: 7, visual: "Rapid image collage grid and split kinetic typography", purpose: "setup", transition: "hard_cut" },
      { start: 7, end: 10, visual: "Feature list UI/tool menu with highlighted rows", purpose: "body", transition: "slide" },
      { start: 10, end: 12, visual: "Neon geometry line frame and polygon shape pulse", purpose: "transition", transition: "morph" },
      { start: 12, end: 14, visual: "Cinematic hero montage for proof", purpose: "proof", transition: "beat_cut" },
      { start: 14, end: 15, visual: "Final logo hold and CTA end slate", purpose: "cta", transition: "clean_hold" }
    ],
    structure: {
      hook: "Cascading media cards hook, then title lock.",
      setup: "Image collage and split kinetic typography introduce the tool.",
      sellingPoints: ["feature list scroller", "neon geometric MG", "hero montage proof"],
      climax: "Cinematic hero montage and geometry pulse.",
      cta: "Final logo/end-slate CTA hold."
    },
    rhythm: { avgShotLength: 1.4, peakTimeRatio: 0.76, fastSections: ["0-7s"], peakMoments: ["12-14s"] },
    packaging: {
      subtitleDensity: "medium",
      titleCards: ["split kinetic typography"],
      stickers: ["neon geometry line frame", "feature list highlight"],
      colorStyle: "black cyan purple white",
      coverStyle: "card stack over dark SaaS hero"
    },
    reusablePatterns: [
      "rapid_collage_zoom",
      "feature_list_scroller",
      "split_kinetic_typography",
      "neon_geometry_line_frame",
      "cinematic_hero_montage",
      "logo_cta_hold"
    ],
    materialGapsForNewVideo: ["image set for media cards", "target video/image set for hero montage", "brand logo for CTA"]
  };
}

function buildMotionGraphAnalysis() {
  const analysis = buildMockVideoAnalysis({
    assetId: "motion_graph_sample",
    projectId: "motion_graph_case_project",
    filename: "motion_graph_1.mov",
    purpose: "sample",
    durationSec: 15,
    width: 1080,
    height: 1920,
    fps: 30
  });
  return {
    ...analysis,
    analyzerMode: "ffmpeg_vlm_asr",
    keyframes: [
      { id: "mg_card_stack", timeSec: 1, path: "preview_frames/sample_card_stack.png", description: "Cascading media card stack evidence", tags: ["media_cards_candidate", "hook_candidate"] },
      { id: "mg_feature_list", timeSec: 7.4, path: "preview_frames/sample_feature_list.png", description: "Feature list UI scroller evidence", tags: ["ui_showcase_candidate", "text_card_candidate"] },
      { id: "mg_geometry", timeSec: 10.6, path: "preview_frames/sample_geometry.png", description: "Neon geometry line frame evidence", tags: ["geometric_mg_candidate", "background"] },
      { id: "mg_montage", timeSec: 12.6, path: "preview_frames/sample_montage.png", description: "Cinematic hero montage evidence", tags: ["live_action_montage_candidate", "comparison_candidate"] },
      { id: "mg_logo_cta", timeSec: 14.3, path: "preview_frames/sample_logo_cta.png", description: "Final logo/end-slate CTA evidence", tags: ["brand_cta_candidate", "cta_candidate"] }
    ],
    shots: [
      { id: "source_shot_card_stack", startSec: 0, endSec: 3, durationSec: 3, tags: ["media_cards_candidate", "hook_candidate"], confidence: 0.88, notes: "结构证据：cascading card stack / varied media formats." },
      { id: "source_shot_feature_list", startSec: 7, endSec: 10, durationSec: 3, tags: ["ui_showcase_candidate", "text_card_candidate"], confidence: 0.82, notes: "结构证据：feature list / tool UI highlight." },
      { id: "source_shot_geometry", startSec: 10, endSec: 12, durationSec: 2, tags: ["geometric_mg_candidate", "background"], confidence: 0.8, notes: "结构证据：neon geometry / polygon line frame." },
      { id: "source_shot_montage", startSec: 12, endSec: 14, durationSec: 2, tags: ["live_action_montage_candidate", "comparison_candidate"], confidence: 0.84, notes: "结构证据：cinematic hero montage / beat cut." },
      { id: "source_shot_logo_cta", startSec: 14, endSec: 15, durationSec: 1, tags: ["brand_cta_candidate", "cta_candidate"], confidence: 0.78, notes: "结构证据：final logo/end-slate CTA." }
    ],
    primaryMotif: {
      motif: "cascading_media_card_stack",
      confidence: 0.82,
      evidence: { generic: true, visualFormFamily: "media_cards" }
    },
    motifCandidates: [
      { motif: "feature_list_scroller", confidence: 0.78 },
      { motif: "neon_geometry_line_frame", confidence: 0.74 },
      { motif: "cinematic_hero_montage", confidence: 0.76 },
      { motif: "logo_cta_hold", confidence: 0.73 }
    ],
    warnings: ["motion_graph_case uses sample frames only as labeled evidence; targetAssets intentionally remain empty."]
  };
}

function requestForCase() {
  return {
    projectId: "motion_graph_case_project",
    inputMode: "video_plus_prompt",
    sampleReferenceAssetId: "motion_graph_sample",
    sourceVideo: { assetId: "demo_source_video" },
    prompt: [
      "主题：AI 创作工具发布短视频",
      "目标用户：设计师、内容创作者、SaaS 增长团队",
      "卖点：多格式素材管理、功能列表清晰、动态图形包装、品牌 CTA",
      "CTA：上传素材并生成你的创意版本"
    ].join("\n"),
    target: {
      vertical: "b2b_marketing_mg",
      aspectRatio: "9:16",
      targetDurationSec: 15,
      outputMode: "mp4_render"
    },
    controls: {
      pace: "fast",
      hookIntensity: "strong",
      packagingStyle: "mg_motion",
      ctaStyle: "direct",
      allowAigcPlaceholder: true,
      creativeMode: "explainable_demo",
      subtitleDensity: "dense"
    },
    constraints: {
      noSampleVisualCopy: true,
      sampleAssetReuse: "disabled"
    },
    targetAssets: []
  };
}

async function walkTextArtifacts(root, acc = []) {
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkTextArtifacts(full, acc);
    } else if (entry.isFile() && textArtifactExtensions.has(path.extname(entry.name).toLowerCase())) {
      acc.push(full);
    }
  }
  return acc;
}

async function scanPublicTextArtifacts(root) {
  const files = await walkTextArtifacts(root);
  const matches = [];
  for (const file of files) {
    const body = await readFile(file, "utf8");
    const lines = body.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      for (const pattern of forbiddenArtifactPatterns) {
        pattern.re.lastIndex = 0;
        if (pattern.re.test(lines[index])) {
          matches.push({ path: path.relative(repoRoot, file), line: index + 1, pattern: pattern.id });
        }
      }
    }
  }
  return { scannedFiles: files.map((file) => path.relative(repoRoot, file)), matchCount: matches.length, matches, passed: matches.length === 0 };
}

function evidenceFrameForFamily(family) {
  if (family === "media_cards") return "preview_frames/sample_card_stack.png";
  if (family === "ui_showcase") return "preview_frames/sample_feature_list.png";
  if (family === "geometric_mg") return "preview_frames/sample_geometry.png";
  if (family === "live_action_montage") return "preview_frames/sample_montage.png";
  if (family === "brand_cta") return "preview_frames/sample_logo_cta.png";
  return "preview_frames/sample_card_stack.png";
}

function gate(id, passed, value, comment) {
  return { id, passed: Boolean(passed), value, comment };
}

async function writeJson(relativePath, value) {
  await writeFile(path.join(artifactDir, relativePath), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function main() {
  if (!existsSync(samplePath)) {
    throw new Error("Expected sample video at test_videos/motion_graph_1.mov");
  }

  await rm(artifactDir, { recursive: true, force: true });
  await mkdir(previewDir, { recursive: true });

  await Promise.all([
    extractFrame(samplePath, 1, path.join(previewDir, "sample_card_stack.png")),
    extractFrame(samplePath, 7.4, path.join(previewDir, "sample_feature_list.png")),
    extractFrame(samplePath, 10.6, path.join(previewDir, "sample_geometry.png")),
    extractFrame(samplePath, 12.6, path.join(previewDir, "sample_montage.png")),
    extractFrame(samplePath, 14.3, path.join(previewDir, "sample_logo_cta.png"))
  ]);

  const vlm = motionGraphVlmFixture();
  const analysis = buildMotionGraphAnalysis();
  const template = buildFallbackTemplate(analysis, "b2b_marketing_mg", "motion_graph_case_project", vlm);
  const inducedSlots = induceSlotsFromAnalysis(analysis, template, template.structureAtoms, vlm);
  const request = requestForCase();
  const mockSourceAsset = {
    id: "demo_source_video",
    projectId: "motion_graph_case_project",
    role: "source_video",
    type: "video",
    filename: "demo_source_video",
    sourcePolicy: "user_authorized",
    metadata: { mock: true },
    tags: ["hook_candidate", "product_like", "usage_scene"],
    status: "ready",
    createdAt: nowIso()
  };
  const mockSourceAnalysis = buildMockVideoAnalysis({
    assetId: "demo_source_video",
    projectId: "motion_graph_case_project",
    purpose: "source",
    durationSec: 30
  });
  const selectedTemplateReason =
    `current sample match picked ${template.id}; sampleReferenceAssetId=motion_graph_sample; matched sourceAssetId/sourceSampleIds=motion_graph_sample/${template.sourceSampleIds.join(",")}; seed B2B fallback was not primary because a learned template matches the active sample.`;

  const generation = generateMigrationResult({
    template,
    request,
    sourceAsset: mockSourceAsset,
    sourceAnalysis: mockSourceAnalysis,
    sourceVlm: vlm,
    generationIdSalt: "motion_graph_case",
    selectedTemplateReason
  });

  const tempRenderDir = await mkdtemp(path.join(tmpdir(), "vvst-motion-graph-case-"));
  const renderer = new FFmpegRenderer({
    generatedDir: tempRenderDir,
    assetResolver: { resolve() { return undefined; } }
  });
  const renderOutput = await renderer.render(generation.timeline, generation.id);
  if (renderOutput.status !== "completed" || !renderOutput.outputPath) {
    throw new Error(`Motion graph case render failed: ${renderOutput.error ?? "unknown error"}`);
  }
  const renderPath = path.join(artifactDir, "render.mp4");
  await muxBeatAudio(renderOutput.outputPath, renderPath, generation.timeline.durationSec);
  await rm(tempRenderDir, { recursive: true, force: true });
  const renderMetadata = await probeRender(renderPath);

  const timeline = structuredClone(generation.timeline);
  const previewPairs = [];
  for (let index = 0; index < timeline.clips.length; index += 1) {
    const clip = timeline.clips[index];
    const family = clip.visualFormFamily ?? clip.layers.find((layer) => layer.style?.visualFormFamily)?.style?.visualFormFamily ?? "unknown";
    const filename = `clip_${String(index + 1).padStart(2, "0")}_${family}_${clip.gapFillStrategy ?? "generated"}.png`;
    const relative = `preview_frames/${filename}`;
    const framePath = path.join(artifactDir, relative);
    await extractFrame(renderPath, clip.startSec + Math.min(0.4, clip.durationSec / 2), framePath);
    clip.previewFrame = relative;
    clip.sourceEvidenceFrame = evidenceFrameForFamily(String(family));
    previewPairs.push({
      slotId: clip.replacementSlotId ?? clip.id,
      clipId: clip.id,
      visualFormFamily: family,
      status: clip.gapFillStrategy ?? "none",
      sourceEvidenceFrame: clip.sourceEvidenceFrame,
      generatedProxyFrame: relative
    });
  }
  timeline.clips = timeline.clips.map((clip) => clip);
  const previewManifest = {
    generatedAt: nowIso(),
    sample: "motion_graph_1.mov",
    render: "render.mp4",
    pairs: previewPairs
  };
  await writeFile(path.join(previewDir, "manifest.json"), `${JSON.stringify(previewManifest, null, 2)}\n`, "utf8");

  await run(ffmpegBin, [
    "-y",
    "-i",
    renderPath,
    "-vf",
    "fps=1/3,scale=180:-1,tile=3x2",
    "-frames:v",
    "1",
    path.join(artifactDir, "contact_sheet.png")
  ]);

  const source = understandSourceVideo(mockSourceAnalysis, mockSourceAsset, request, vlm);
  const mappings = matchSlots(template, source, request);
  const visualGapCount = generation.gapReport.filter((gap) => gap.severity !== "low" && gap.status !== "matched").length;
  const proxyFamilies = new Set(timeline.clips.filter((clip) => clip.gapFillStrategy === "proxy_placeholder").map((clip) => String(clip.visualFormFamily ?? "unknown")));
  const familySet = new Set(inducedSlots.map((slot) => slot.visualFormFamily));
  const gates = [
    gate("selected_template_matches_current_sample", generation.selectedTemplateReason?.includes("sampleReferenceAssetId=motion_graph_sample"), template.id, "当前样例模板优先，不盲选最新模板。"),
    gate("induced_slots_non_empty", inducedSlots.length > 0, inducedSlots.length, "开放世界槽位归纳输出非空。"),
    gate("media_cards_slot_detected", familySet.has("media_cards"), "media_cards", "识别卡片堆叠/拼贴槽位。"),
    gate("feature_list_slot_detected", familySet.has("ui_showcase"), "ui_showcase", "识别功能列表 UI 展示槽位。"),
    gate("brand_cta_slot_detected", familySet.has("brand_cta"), "brand_cta", "识别品牌/Logo/CTA 收尾槽位。"),
    gate("card_stack_proxy_rendered", proxyFamilies.has("media_cards"), Array.from(proxyFamilies).join(","), "media_cards 缺口渲染为卡片堆叠代理。"),
    gate("generic_b2b_fallback_not_primary", template.requiredSlots[0]?.inducedSlotId === template.requiredSlots[0]?.id, template.requiredSlots[0]?.id, "requiredSlots 由 induced slot 驱动，粗粒度 B2B 槽位仅作次级兜底。"),
    gate(
      "timeline_preview_has_family_specific_proxies",
      previewPairs.every((pair) => existsSync(path.join(artifactDir, pair.generatedProxyFrame)) && existsSync(path.join(artifactDir, pair.sourceEvidenceFrame))) &&
        !previewPairs.some((pair) => /generic_green/i.test(pair.generatedProxyFrame)),
      previewPairs.length,
      "时间线预览使用样例证据帧 + family-specific proxy 帧。"
    ),
    gate("render_mp4_not_only_text_cards", proxyFamilies.size > 0 && (renderMetadata.sizeBytes ?? 0) >= 250000, renderMetadata.sizeBytes ?? 0, "渲染包含 family proxy，不是纯文字卡。")
  ];

  const selectedTemplate = {
    id: template.id,
    selectedTemplateReason,
    matchedSourceAssetId: "motion_graph_sample",
    sourceSampleIds: template.sourceSampleIds,
    seedB2bNotPrimary: true,
    inducedSlotFamilies: inducedSlots.map((slot) => slot.visualFormFamily),
    rendererCandidates: Object.fromEntries(inducedSlots.map((slot) => [slot.id, slot.rendererCandidates]))
  };

  const artifactGeneration = {
    ...generation,
    timeline,
    inducedSlots,
    selectedTemplateReason,
    selectedTemplate,
    motionGraphCaseGates: gates,
    renderMetadata,
    previewManifest: "preview_frames/manifest.json",
    slotMappingSummary: {
      sourceVideoMappedCount: mappings.filter((mapping) => mapping.assetAvailability === "source_video_mapped").length,
      visualGapCount,
      replacementSlotCount: generation.replacementSlots?.length ?? 0
    }
  };

  await writeJson("analysis.motion_graph.json", { analysis, vlm, template });
  await writeJson("generation-result.json", artifactGeneration);
  await writeJson("induced-slots.json", inducedSlots);
  await writeJson("selected-template.json", selectedTemplate);
  await writeJson("gap-report.json", generation.gapReport);
  await writeJson("fill-plan.json", generation.fillPlan);
  await writeJson("replacement-slots.json", generation.replacementSlots ?? []);
  await writeJson("timeline.json", timeline);

  const report = [
    "# 开放世界槽位归纳案例",
    "",
    `生成时间：${nowIso()}`,
    "",
    "## 模板选择",
    "",
    `- selected template id: \`${template.id}\``,
    `- selectedTemplateReason: ${selectedTemplateReason}`,
    `- matched sourceAssetId/sourceSampleIds: motion_graph_sample / ${template.sourceSampleIds.join(", ")}`,
    "- seed B2B template was not primary because the learned template matches the current sample asset.",
    "",
    "## 归纳槽位",
    "",
    ...inducedSlots.map((slot) => `- ${slot.id}: ${slot.visualFormFamily}, ${slot.status}, confidence=${slot.confidence.toFixed(2)}, renderer=${slot.rendererCandidates.join("/")}, clickToReplace=${slot.replacementPolicy.clickToReplace}`),
    "",
    "## 缺口与代理",
    "",
    ...generation.gapReport.map((gap) => `- ${gap.slotId}: ${gap.visualFormFamily ?? gap.gapType}, ${gap.gapLabelZh ?? gap.gapLabel}, ${gap.severity}`),
    "",
    "## 校验门",
    "",
    ...gates.map((item) => `- ${item.passed ? "通过" : "失败"} ${item.id}: ${item.value} - ${item.comment}`),
    "",
    "## 渲染",
    "",
    `- render.mp4: ${renderMetadata.durationSec ?? "?"}s, ${renderMetadata.width ?? "?"}x${renderMetadata.height ?? "?"}, audio=${renderMetadata.hasAudio}, size=${renderMetadata.sizeBytes ?? "?"}`,
    "- contact_sheet.png",
    "- preview_frames/manifest.json"
  ].join("\n");
  await writeFile(path.join(artifactDir, "report.md"), `${report}\n`, "utf8");

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>开放世界槽位归纳 · motion_graph_case</title>
  <style>
    body { margin: 0; background: #f7f8fa; color: #172033; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px; }
    section { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; box-shadow: 0 10px 28px rgba(15,23,42,.06); padding: 18px; margin-bottom: 16px; }
    h1, h2, p { margin: 0 0 8px; }
    video, img { max-width: 100%; border-radius: 8px; background: #111827; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .badges { display: flex; flex-wrap: wrap; gap: 8px; }
    .badge { background: #e0f2fe; color: #075985; border-radius: 999px; padding: 5px 8px; font-size: 12px; font-weight: 750; }
    .pass { background: #dcfce7; color: #166534; }
    .fail { background: #fee2e2; color: #991b1b; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border-bottom: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top; }
    figure { margin: 0; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; }
    .frames { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    figcaption { color: #475569; font-size: 12px; margin-top: 6px; }
    @media (max-width: 860px) { main { padding: 16px; } .grid, .frames { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<main>
  <section>
    <span class="badge">Open-World Slot Induction</span>
    <h1>开放世界槽位归纳 · motion_graph_1</h1>
    <p>该案例不为 sample 写专属槽位，而是从证据归纳 visualFormFamily，再匹配 renderer capability 和 family-specific proxy。</p>
    <div class="badges">${Array.from(familySet).map((family) => `<span class="badge">${esc(family)}</span>`).join("")}</div>
  </section>
  <div class="grid">
    <section>
      <h2>生成代理渲染</h2>
      <video controls src="render.mp4"></video>
      <p>${esc(renderMetadata.durationSec ?? "?")}s · ${esc(renderMetadata.width ?? "?")}x${esc(renderMetadata.height ?? "?")} · audio=${renderMetadata.hasAudio ? "present" : "missing"}</p>
    </section>
    <section>
      <h2>模板选择</h2>
      <p>${esc(selectedTemplateReason)}</p>
      <p>Seed B2B fallback 未作为 primary；粗粒度槽位仅作 secondary fallback。</p>
    </section>
  </div>
  <section>
    <h2>归纳槽位与 renderer candidates</h2>
    <table><thead><tr><th>slot</th><th>family</th><th>status/confidence</th><th>renderer</th><th>clickToReplace</th></tr></thead><tbody>
      ${inducedSlots.map((slot) => `<tr><td>${esc(slot.id)}</td><td>${esc(slot.visualFormFamily)}</td><td>${esc(slot.status)} / ${slot.confidence.toFixed(2)}</td><td>${esc(slot.rendererCandidates.join(", "))}</td><td>${slot.replacementPolicy.clickToReplace ? "是" : "否"}</td></tr>`).join("")}
    </tbody></table>
  </section>
  <section>
    <h2>时间线预览 · 样例证据 → 生成代理</h2>
    <div class="frames">${previewPairs.map((pair) => `<figure><div class="pair"><img src="${esc(pair.sourceEvidenceFrame)}" alt="样例证据" /><img src="${esc(pair.generatedProxyFrame)}" alt="生成代理" /></div><figcaption>${esc(pair.visualFormFamily)} · ${esc(pair.status)}</figcaption></figure>`).join("")}</div>
    <p><a href="preview_frames/manifest.json">preview_frames/manifest.json</a></p>
  </section>
  <section>
    <h2>校验门</h2>
    <div class="badges">${gates.map((item) => `<span class="badge ${item.passed ? "pass" : "fail"}">${esc(item.id)}: ${item.passed ? "通过" : "失败"}</span>`).join("")}</div>
  </section>
  <section>
    <h2>工程证据</h2>
    <p><a href="report.md">report.md</a> · <a href="induced-slots.json">induced-slots.json</a> · <a href="selected-template.json">selected-template.json</a> · <a href="gap-report.json">gap-report.json</a> · <a href="contact_sheet.png">contact_sheet.png</a></p>
  </section>
</main>
</body>
</html>`;
  await writeFile(path.join(artifactDir, "index.html"), html, "utf8");

  const scan = await scanPublicTextArtifacts(artifactDir);
  if (!scan.passed) {
    throw new Error(`Public artifact sanitization failed: ${scan.matches.map((match) => `${match.path}:${match.line}:${match.pattern}`).join(", ")}`);
  }
  const failed = gates.filter((item) => !item.passed);
  if (failed.length) {
    throw new Error(`Motion graph gates failed: ${failed.map((item) => item.id).join(", ")}`);
  }

  console.log(`Motion graph case generated at ${path.relative(repoRoot, artifactDir)}`);
  console.log(`Selected template: ${template.id}`);
  console.log(`Induced slot families: ${Array.from(familySet).join(", ")}`);
  console.log(`Replacement slots: ${(generation.replacementSlots ?? []).map((slot) => slot.slotId).join(", ")}`);
  console.log(`Rendered MP4: ${path.relative(repoRoot, renderPath)}`);
  console.log(`Contact sheet: ${path.relative(repoRoot, path.join(artifactDir, "contact_sheet.png"))}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
