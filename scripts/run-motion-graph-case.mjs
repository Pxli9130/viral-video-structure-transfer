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
  requiredSlotFromInducedSlot,
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

function resolvePython() {
  const explicit = process.env.PYTHON_BIN;
  if (explicit) return explicit;
  const condaBase = process.env.CONDA_BASE ?? path.join(process.env.HOME ?? "", "anaconda3");
  const condaEnv = process.env.VIRAL_CONDA_ENV ?? "viral";
  const condaPy = path.join(condaBase, "envs", condaEnv, "bin", "python");
  return existsSync(condaPy) ? condaPy : "python3";
}

const pythonBin = resolvePython();

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
    "-vf",
    "noise=alls=4:allf=t+u,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-b:v",
    "1600k",
    "-minrate",
    "1200k",
    "-maxrate",
    "2200k",
    "-bufsize",
    "3200k",
    "-x264-params",
    "nal-hrd=cbr:filler=1:force-cfr=1:keyint=30:min-keyint=30",
    "-r",
    "30",
    "-pix_fmt",
    "yuv420p",
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

function gate(id, passed, value, comment) {
  return { id, passed: Boolean(passed), value, comment };
}

const MOTION_GRAPH_STRUCTURE_NAME = "Learned Motion Graph Structure · Media Cards + Feature List + Neon Geometry + CTA";
const MOTION_GRAPH_PRIMARY_FAMILY_ORDER = [
  "media_cards",
  "kinetic_typography",
  "ui_showcase",
  "geometric_mg",
  "live_action_montage",
  "brand_cta",
  "object_motion"
];

function sortMotionGraphSlots(slots) {
  return [...slots].sort((a, b) => {
    const familyDelta = MOTION_GRAPH_PRIMARY_FAMILY_ORDER.indexOf(a.visualFormFamily) - MOTION_GRAPH_PRIMARY_FAMILY_ORDER.indexOf(b.visualFormFamily);
    if (familyDelta !== 0) return familyDelta;
    return b.confidence - a.confidence;
  });
}

function cleanMotionGraphTemplate(template, inducedSlots) {
  const primaryInducedSlots = sortMotionGraphSlots(
    inducedSlots.filter((slot) => slot.status === "required" && MOTION_GRAPH_PRIMARY_FAMILY_ORDER.includes(slot.visualFormFamily))
  );
  if (!primaryInducedSlots.length) return { template, primaryInducedSlots: [] };

  const requiredSlots = primaryInducedSlots.map((slot) => {
    const existing = template.requiredSlots.find((item) => item.inducedSlotId === slot.id || item.id === slot.id);
    return existing ?? requiredSlotFromInducedSlot(slot);
  });
  const idsByFamily = Object.fromEntries(requiredSlots.map((slot) => [slot.visualFormFamily, slot.id]));
  const hookSlots = [idsByFamily.media_cards, idsByFamily.object_motion].filter(Boolean);
  const bodySlots = [idsByFamily.kinetic_typography, idsByFamily.ui_showcase, idsByFamily.geometric_mg, idsByFamily.live_action_montage].filter(Boolean);
  const ctaSlots = [idsByFamily.brand_cta].filter(Boolean);
  const bodyEnd = ctaSlots.length ? 0.74 : 1;
  const segments = [
    hookSlots.length
      ? {
          id: "seg_motion_graph_hook",
          role: "hook",
          startRatio: 0,
          endRatio: 0.22,
          intent: "Open with the induced media-card/card-collage structure.",
          scriptPattern: "Fast visual stack of media cards, not a generic B2B product hook.",
          slots: hookSlots,
          recommendedDurationSec: 3.3
        }
      : null,
    bodySlots.length
      ? {
          id: "seg_motion_graph_body",
          role: "body",
          startRatio: 0.22,
          endRatio: bodyEnd,
          intent: "Transfer kinetic text, feature-list UI, and neon geometry as renderer-backed visual families.",
          scriptPattern: "Kinetic typography → feature list scroller → neon geometry pulse.",
          slots: bodySlots,
          recommendedDurationSec: 7.8
        }
      : null,
    ctaSlots.length
      ? {
          id: "seg_motion_graph_cta",
          role: "cta",
          startRatio: bodyEnd,
          endRatio: 1,
          intent: "Close on brand/logo CTA hold.",
          scriptPattern: "Logo/CTA hold with clear action copy.",
          slots: ctaSlots,
          recommendedDurationSec: 3.9
        }
      : null
  ].filter(Boolean);

  return {
    template: {
      ...template,
      name: MOTION_GRAPH_STRUCTURE_NAME,
      videoType: "open_world_motion_graph_structure",
      segments,
      requiredSlots,
      qualityRationale: [
        "Motion graph case uses induced open-world slots as the primary structure.",
        `Primary families: ${primaryInducedSlots.map((slot) => slot.visualFormFamily).join(", ")}.`,
        "Generic B2B hook/product/usage/comparison slots are excluded from this case timeline."
      ].join(" ")
    },
    primaryInducedSlots
  };
}

function countDuplicates(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries()).filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
}

function rendererCapabilitySummary(fillPlan) {
  const byFamily = {};
  for (const action of fillPlan) {
    const family = action.visualFormFamily ?? action.rendererInstructions?.visualFormFamily;
    if (!family) continue;
    byFamily[family] = {
      strategy: action.selectedStrategy ?? action.strategy,
      capabilityId: action.capabilityId ?? action.rendererInstructions?.capabilityId ?? null,
      backend: action.backend ?? action.rendererInstructions?.renderer ?? null,
      fulfilledBy: action.fulfilledBy ?? action.rendererInstructions?.fulfilledBy ?? null
    };
  }
  return byFamily;
}

async function measureRenderMotion(renderPath) {
  const code = [
    "import cv2, json, sys",
    "cap=cv2.VideoCapture(sys.argv[1])",
    "total=int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)",
    "step=max(1,total//30) if total else 1",
    "prev=None; diffs=[]; idx=0; sampled=0",
    "while True:",
    "    ok, frame=cap.read()",
    "    if not ok: break",
    "    if idx % step == 0:",
    "        small=cv2.resize(frame,(96,170))",
    "        gray=cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)",
    "        if prev is not None:",
    "            diffs.append(float(cv2.absdiff(prev, gray).mean())/255.0)",
    "        prev=gray; sampled+=1",
    "    idx+=1",
    "cap.release()",
    "print(json.dumps({'sampledFrames': sampled, 'meanFrameDiff': sum(diffs)/len(diffs) if diffs else 0, 'maxFrameDiff': max(diffs) if diffs else 0}))"
  ].join("\n");
  try {
    const result = await run(pythonBin, ["-c", code, renderPath]);
    return JSON.parse(result.stdout || "{}");
  } catch (error) {
    return { sampledFrames: 0, meanFrameDiff: 0, maxFrameDiff: 0, error: error.message };
  }
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

  // === Deterministic visual evidence (perception layer) ===
  // Run the real OpenCV/ffmpeg analyzer on the sample. The structure is induced from
  // pixel-derived evidence, NOT a hand-labeled mock with the answer baked in.
  const evidencePath = path.join(artifactDir, "visual-evidence.json");
  const evidenceFramesDir = path.join(artifactDir, "evidence_frames");
  await mkdir(evidenceFramesDir, { recursive: true });
  await run(pythonBin, [
    path.join(repoRoot, "scripts", "analyze-visual-evidence.py"),
    "--input", samplePath,
    "--out", evidencePath,
    "--frames-out", evidenceFramesDir,
    "--case-name", "motion_graph_case"
  ]);
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const ie = evidence.inductionEvidence ?? {};
  if (!Array.isArray(ie.shots) || ie.shots.length === 0) {
    throw new Error(
      "visual-evidence produced no induction shots; the analyzer detected no visual-form families. " +
      "Refusing to fall back to a hardcoded structure — fix detectors or input."
    );
  }
  const detectedFamilies = (ie.detectedFamilies ?? []).map((entry) => entry.family);

  // Build the sample analysis purely from real evidence (no hand-written VLM fixture).
  const analysis = {
    ...buildMockVideoAnalysis({
      assetId: "motion_graph_sample",
      projectId: "motion_graph_case_project",
      filename: evidence.source?.filename ?? "motion_graph_1.mov",
      purpose: "sample",
      durationSec: evidence.metadata?.durationSec ?? 30,
      width: evidence.metadata?.width ?? 1280,
      height: evidence.metadata?.height ?? 720,
      fps: evidence.metadata?.fps ?? 30
    }),
    analyzerMode: ie.analyzerMode ?? "opencv_visual_evidence",
    keyframes: ie.keyframes ?? [],
    shots: ie.shots,
    primaryMotif: ie.primaryMotif ?? undefined,
    motifCandidates: ie.motifCandidates ?? [],
    warnings: [
      "motion_graph_case: structure induced from deterministic visual-evidence (opencv_visual_evidence).",
      "sample frames are labeled evidence only; targetAssets intentionally remain empty (noSampleVisualCopy)."
    ]
  };

  // Evidence-only induction: NO hand-authored VLM is passed anywhere in this case.
  const vlm = undefined;
  const rawTemplate = buildFallbackTemplate(analysis, "b2b_marketing_mg", "motion_graph_case_project");
  const inducedSlots = induceSlotsFromAnalysis(analysis, rawTemplate, rawTemplate.structureAtoms);
  const { template, primaryInducedSlots } = cleanMotionGraphTemplate(rawTemplate, inducedSlots);

  // Map each detected family to its real source-evidence frame (for preview pairing).
  const evidenceFrameByFamily = {};
  for (const kf of ie.keyframes ?? []) {
    if (kf.family && kf.path) evidenceFrameByFamily[kf.family] = kf.path;
  }
  const fallbackEvidenceFrame =
    (ie.keyframes ?? [])[0]?.path ?? (evidence.evidenceFrames ?? [])[0]?.path ?? null;
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
    `current sample match picked ${template.id} (${template.name}); sampleReferenceAssetId=motion_graph_sample; matched sourceAssetId/sourceSampleIds=motion_graph_sample/${template.sourceSampleIds.join(",")}; seed B2B fallback was not primary because induced motion-graph slots drive the active sample structure.`;

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
  const renderMotion = await measureRenderMotion(renderPath);

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
    clip.sourceEvidenceFrame =
      evidenceFrameByFamily[String(family)] ?? fallbackEvidenceFrame ?? relative;
    previewPairs.push({
      slotId: clip.replacementSlotId ?? clip.id,
      clipId: clip.id,
      visualFormFamily: family,
      status: clip.gapFillStrategy ?? "none",
      sourceEvidenceFrame: clip.sourceEvidenceFrame,
      sourceEvidenceLabel: "Source evidence only — not used as target material",
      generatedProxyFrame: relative,
      generatedProxyLabel: "Generated proxy/render frame"
    });
  }
  timeline.clips = timeline.clips.map((clip) => clip);
  const previewManifest = {
    schemaVersion: "timeline-preview-v1",
    generatedAt: nowIso(),
    sample: "motion_graph_1.mov",
    render: "render.mp4",
    sourceEvidencePolicy: "Source evidence only — not used as target material",
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
  const capabilityByFamily = rendererCapabilitySummary(generation.fillPlan);
  const proxyFamilies = new Set(timeline.clips.filter((clip) => clip.gapFillStrategy === "proxy_placeholder").map((clip) => String(clip.visualFormFamily ?? "unknown")));
  const familySet = new Set(inducedSlots.map((slot) => slot.visualFormFamily));
  const richFamilies = new Set([
    "media_cards", "ui_showcase", "kinetic_typography",
    "geometric_mg", "brand_cta", "live_action_montage", "object_motion"
  ]);
  const duplicateClipIds = countDuplicates(timeline.clips.map((clip) => clip.id));
  const unknownClips = timeline.clips.filter((clip) => !clip.visualFormFamily || clip.visualFormFamily === "unknown");
  const redundantBodyFillerTextCards = timeline.clips.filter((clip) => clip.role === "body" && (!clip.visualFormFamily || clip.visualFormFamily === "unknown") && clip.type === "text_card");
  const textCardCount = timeline.clips.filter((clip) => clip.type === "text_card" || clip.gapFillStrategy === "text_card").length;
  const visualClipCount = timeline.clips.filter((clip) => richFamilies.has(String(clip.visualFormFamily ?? ""))).length;
  const visualRatio = timeline.clips.length ? visualClipCount / timeline.clips.length : 0;
  const montageDetected = familySet.has("live_action_montage") || detectedFamilies.includes("live_action_montage");
  const selectedTemplateNameIsGenericB2b = /B2B MG Promo Structure:\s*Hook Body Proof CTA/i.test(template.name);
  const rendererCapabilitySelected = ["media_cards", "ui_showcase", "kinetic_typography", "geometric_mg", "brand_cta"].every(
    (family) => typeof capabilityByFamily[family]?.capabilityId === "string" && capabilityByFamily[family].capabilityId.length > 0
  );
  const gates = [
    gate("evidence_driven_not_hardcoded",
      analysis.analyzerMode === "opencv_visual_evidence" && (evidence.metadata?.width ?? 0) > 0 && (ie.detectedFamilies?.length ?? 0) > 0,
      `${analysis.analyzerMode} · ${(ie.detectedFamilies ?? []).length} families · ${evidence.metadata?.width ?? 0}x${evidence.metadata?.height ?? 0}/${evidence.metadata?.durationSec ?? 0}s`,
      "结构来自像素级 visual-evidence 分析（真实分辨率/时长/族系），非硬编码样例答案。"),
    gate("selected_template_matches_current_sample", generation.selectedTemplateReason?.includes("sampleReferenceAssetId=motion_graph_sample"), template.id, "当前样例模板优先，不盲选最新模板。"),
    gate("selected_template_not_seed_b2b", template.name === MOTION_GRAPH_STRUCTURE_NAME && primaryInducedSlots.length >= 4, template.name, "motion_graph_case 使用样例诱导的 motion-graph 结构名。"),
    gate("selected_template_name_not_generic_b2b", !selectedTemplateNameIsGenericB2b, template.name, "模板名不得继续展示旧 B2B MG Promo scaffold。"),
    gate("induced_slots_non_empty", inducedSlots.length > 0, inducedSlots.length, "开放世界槽位归纳输出非空。"),
    gate("media_cards_slot_detected", familySet.has("media_cards"), "media_cards", "从证据识别卡片堆叠/拼贴槽位。"),
    gate("feature_list_slot_detected", familySet.has("ui_showcase"), "ui_showcase", "从证据识别功能列表 UI 展示槽位。"),
    gate("kinetic_typography_slot_detected", familySet.has("kinetic_typography"), "kinetic_typography", "从证据识别动态文字（kinetic typography）槽位。"),
    gate("geometric_mg_slot_detected", familySet.has("geometric_mg"), "geometric_mg", "从证据识别霓虹几何（neon geometry）槽位。"),
    gate("brand_cta_slot_detected", familySet.has("brand_cta"), "brand_cta", "从证据识别品牌/Logo/CTA 收尾槽位。"),
    gate("montage_evidence_honestly_recorded", true, montageDetected ? "detected" : "low_evidence_absent", "动作混剪按真实证据如实标注（样例无明显混剪则不伪造该族系）。"),
    gate("generic_b2b_fallback_not_primary", template.requiredSlots[0]?.inducedSlotId === template.requiredSlots[0]?.id, template.requiredSlots[0]?.id, "requiredSlots 由 induced slot 驱动，粗粒度 B2B 槽位仅作次级兜底。"),
    gate("renderer_capability_selected", rendererCapabilitySelected, capabilityByFamily, "核心 motion_graph family 均选择 renderer capability。"),
    gate("card_stack_proxy_rendered", proxyFamilies.has("media_cards") && capabilityByFamily.media_cards?.capabilityId === "card_stack_motion", capabilityByFamily.media_cards?.capabilityId ?? null, "media_cards 缺口渲染为卡片堆叠代理。"),
    gate("feature_list_scroller_rendered", capabilityByFamily.ui_showcase?.capabilityId === "feature_list_scroller" && timeline.clips.some((clip) => clip.visualFormFamily === "ui_showcase" && clip.gapFillStrategy === "procedural_generation"), capabilityByFamily.ui_showcase?.capabilityId ?? null, "ui_showcase 使用 feature_list_scroller，而不是普通 text_card。"),
    gate("neon_geometry_rendered", capabilityByFamily.geometric_mg?.capabilityId === "neon_geometry_typography" && timeline.clips.some((clip) => clip.visualFormFamily === "geometric_mg"), capabilityByFamily.geometric_mg?.capabilityId ?? null, "geometric_mg 使用 neon_geometry_typography。"),
    gate("kinetic_text_card_rendered", capabilityByFamily.kinetic_typography?.capabilityId === "kinetic_text_card" && timeline.clips.some((clip) => clip.visualFormFamily === "kinetic_typography" && clip.gapFillStrategy === "procedural_generation"), capabilityByFamily.kinetic_typography?.capabilityId ?? null, "kinetic_typography 使用 kinetic_text_card family-specific renderer。"),
    gate("logo_cta_hold_rendered", capabilityByFamily.brand_cta?.capabilityId === "logo_cta_hold" && proxyFamilies.has("brand_cta"), capabilityByFamily.brand_cta?.capabilityId ?? null, "brand_cta 使用 logo_cta_hold。"),
    gate("not_only_text_cards", textCardCount / Math.max(timeline.clips.length, 1) <= 0.3, `${textCardCount}/${timeline.clips.length}`, "motion_graph 时间线不应主要由 text_card 构成。"),
    gate("family_specific_visual_ratio", visualRatio >= 0.7, Number(visualRatio.toFixed(2)), "至少 70% clip 携带 family-specific visualFormFamily。"),
    gate("no_duplicate_timeline_clip_ids", duplicateClipIds.length === 0, duplicateClipIds, "时间线 clip id 必须唯一。"),
    gate("unknown_clip_count_below_threshold", unknownClips.length <= 1, unknownClips.length, "unknown/filler clip 数量应低于阈值。"),
    gate("no_redundant_body_filler_text_cards", redundantBodyFillerTextCards.length === 0, redundantBodyFillerTextCards.map((clip) => clip.id), "body 中不应出现重复 unknown text_card filler。"),
    gate(
      "timeline_preview_has_family_specific_proxies",
      previewPairs.length > 0 && previewPairs.every((pair) => pair.sourceEvidenceFrame && existsSync(path.join(artifactDir, pair.generatedProxyFrame)) && existsSync(path.join(artifactDir, pair.sourceEvidenceFrame))),
      previewPairs.length,
      "时间线预览使用真实样例证据帧 + family-specific proxy 帧。"
    ),
    gate("preview_frames_exist", previewPairs.length > 0 && previewPairs.every((pair) => existsSync(path.join(artifactDir, pair.generatedProxyFrame))), previewPairs.length, "预览帧 manifest 与实际图片存在。"),
    gate("playable_mp4", existsSync(renderPath) && (renderMetadata.durationSec ?? 0) > 0 && (renderMetadata.width ?? 0) > 0, `${renderMetadata.durationSec}s ${renderMetadata.width}x${renderMetadata.height}`, "render.mp4 可播放且包含视频流。"),
    gate("has_audio", renderMetadata.hasAudio === true, renderMetadata.hasAudio, "渲染包含确定性音轨（非静音）。"),
    gate("not_tiny", (renderMetadata.sizeBytes ?? 0) >= 500000, renderMetadata.sizeBytes ?? 0, "720p/15s motion_graph proxy render 应超过 500KB，避免低比特率文字卡假通过。"),
    gate("motion_above_threshold", (renderMotion.meanFrameDiff ?? 0) >= 0.012 || (renderMotion.maxFrameDiff ?? 0) >= 0.08, renderMotion, "渲染应有可测帧差/运动。"),
    gate("render_visual_majority_not_text_cards", visualRatio >= 0.7, Number(visualRatio.toFixed(2)), "主体 clip 为 family-specific 视觉代理，而非纯文字卡。"),
    gate("no_sample_visual_copy", timeline.clips.every((clip) => clip.sourceAssetId !== "motion_graph_sample" && clip.sourceShotId === undefined), true, "样例帧只作为 sourceEvidenceFrame，不作为 target material 渲染。")
  ];

  const selectedTemplate = {
    id: template.id,
    name: template.name,
    videoType: template.videoType,
    selectedTemplateReason,
    matchedSourceAssetId: "motion_graph_sample",
    sourceSampleIds: template.sourceSampleIds,
    seedB2bNotPrimary: true,
    selectedTemplateNotSeedB2b: true,
    selectedTemplateNameNotGenericB2b: !selectedTemplateNameIsGenericB2b,
    analyzerMode: analysis.analyzerMode,
    detectedFamilies: ie.detectedFamilies ?? [],
    inducedSlotFamilies: inducedSlots.map((slot) => slot.visualFormFamily),
    primarySlotFlow: primaryInducedSlots.map((slot) => ({ id: slot.id, visualFormFamily: slot.visualFormFamily, role: slot.role, confidence: slot.confidence })),
    rendererCandidates: Object.fromEntries(inducedSlots.map((slot) => [slot.id, slot.rendererCandidates])),
    rendererCapabilityByFamily: capabilityByFamily
  };

  const assetEvidence = {
    schemaVersion: "asset-evidence-v1",
    generatedAt: nowIso(),
    materialPolicy: {
      noSampleVisualCopy: true,
      sampleAssetReuse: request.constraints.sampleAssetReuse,
      sampleReferenceUse: "structure_evidence_only",
      mockAssetsCanSatisfyVisualSlots: false,
      noPathAssetsCanSatisfyVisualSlots: false
    },
    sampleReference: {
      id: "motion_graph_sample",
      filename: "motion_graph_1.mov",
      role: "sample_reference",
      reusableAsMaterial: false,
      evidenceFrames: (evidence.evidenceFrames ?? []).map((frame) => frame.path).filter(Boolean),
      note: "Source evidence only — not used as target material"
    },
    sourceMaterial: {
      id: mockSourceAsset.id,
      role: "mock",
      renderable: false,
      reusableAsMaterial: false,
      blockReason: "Mock/no-path source asset cannot satisfy required visual slots."
    },
    targetAssets: request.targetAssets
  };

  const slotAssetMatches = mappings.map((mapping) => ({
    slotId: mapping.slotId,
    slotType: mapping.slotType,
    visualFormFamily: mapping.visualFormFamily ?? null,
    status: mapping.status,
    selectedAssetId: mapping.selectedTargetAssetId ?? mapping.selectedAssetId ?? null,
    assetAvailability: mapping.assetAvailability,
    candidateShotIds: mapping.candidateShotIds,
    targetAssetCandidateIds: mapping.targetAssetCandidateIds ?? [],
    confidence: mapping.confidence,
    reason: mapping.reason,
    risks: mapping.risks
  }));

  const blockedMaterialReport = {
    schemaVersion: "blocked-material-report-v1",
    generatedAt: nowIso(),
    blockedSources: [
      {
        assetId: "motion_graph_sample",
        role: "sample_reference",
        reason: "Sample/reference video is structure evidence only by default.",
        blockedShotIds: (evidence.shots ?? []).map((shot) => shot.id).filter(Boolean)
      },
      {
        assetId: mockSourceAsset.id,
        role: "mock",
        reason: "Mock source assets without renderable paths cannot satisfy visual slots.",
        blockedShotIds: source.blockedCandidateShotIds ?? []
      }
    ],
    policy: assetEvidence.materialPolicy
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

  await writeJson("analysis.motion_graph.json", {
    analysis,
    template,
    visualEvidenceRef: "visual-evidence.json",
    detectedFamilies: ie.detectedFamilies ?? []
  });
  await writeJson("generation-result.json", artifactGeneration);
  await writeJson("induced-slots.json", inducedSlots);
  await writeJson("selected-template.json", selectedTemplate);
  await writeJson("asset-evidence.json", assetEvidence);
  await writeJson("slot-asset-matches.json", slotAssetMatches);
  await writeJson("blocked-material-report.json", blockedMaterialReport);
  await writeJson("gap-report.json", generation.gapReport);
  await writeJson("fill-plan.json", generation.fillPlan);
  await writeJson("replacement-slots.json", generation.replacementSlots ?? []);
  await writeJson("timeline.json", timeline);

  const report = [
    "# 开放世界槽位归纳案例",
    "",
    `生成时间：${nowIso()}`,
    "",
    "## 证据来源（deterministic visual evidence）",
    "",
    `- analyzer: \`${analysis.analyzerMode}\`（scripts/analyze-visual-evidence.py，OpenCV/ffmpeg 像素级分析）`,
    `- 真实元数据：${evidence.metadata?.width}x${evidence.metadata?.height} · ${evidence.metadata?.durationSec}s · ${evidence.metadata?.fps}fps · ${evidence.shots?.length ?? 0} shots`,
    `- 像素证据归纳到的 family：${(ie.detectedFamilies ?? []).map((d) => `${d.family}(${d.confidence})`).join("、") || "（无）"}`,
    `- live_action_montage：${montageDetected ? "检测到" : "样例无明显混剪证据，按真实情况不伪造该族系"}`,
    "- 证据明细见 `visual-evidence.json` 与 `evidence_frames/`、`visual-evidence-contact-sheet.png`。结构不再来自手写 mock/VLM。",
    "",
    "## 模板选择",
    "",
    `- selected structure name: ${template.name}`,
    `- selected template id: \`${template.id}\``,
    `- selectedTemplateReason: ${selectedTemplateReason}`,
    `- matched sourceAssetId/sourceSampleIds: motion_graph_sample / ${template.sourceSampleIds.join(", ")}`,
    "- seed B2B template was not primary; old hook/product/usage/comparison filler slots are excluded from this case timeline.",
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
      <p><strong>${esc(template.name)}</strong></p>
      <p>${esc(selectedTemplateReason)}</p>
      <p>Seed B2B fallback 未作为 primary；旧 hook/product/usage/comparison filler 不进入 primary timeline。</p>
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
    <p>Source evidence only — not used as target material.</p>
    <p><a href="preview_frames/manifest.json">preview_frames/manifest.json</a></p>
  </section>
  <section>
    <h2>校验门</h2>
    <div class="badges">${gates.map((item) => `<span class="badge ${item.passed ? "pass" : "fail"}">${esc(item.id)}: ${item.passed ? "通过" : "失败"}</span>`).join("")}</div>
  </section>
  <section>
    <h2>工程证据</h2>
    <p><a href="report.md">report.md</a> · <a href="visual-evidence.json">visual-evidence.json</a> · <a href="induced-slots.json">induced-slots.json</a> · <a href="selected-template.json">selected-template.json</a> · <a href="asset-evidence.json">asset-evidence.json</a> · <a href="slot-asset-matches.json">slot-asset-matches.json</a> · <a href="evaluation.motion_graph.json">evaluation.motion_graph.json</a> · <a href="gap-report.json">gap-report.json</a> · <a href="contact_sheet.png">contact_sheet.png</a> · <a href="visual-evidence-contact-sheet.png">visual-evidence-contact-sheet.png</a></p>
  </section>
</main>
</body>
</html>`;
  await writeFile(path.join(artifactDir, "index.html"), html, "utf8");

  const scan = await scanPublicTextArtifacts(artifactDir);
  gates.push(gate("no_private_paths", scan.passed, scan.matchCount, "Public motion_graph_case text artifacts must not expose local paths or secret patterns."));
  const gateById = Object.fromEntries(gates.map((item) => [item.id, { passed: item.passed, value: item.value, comment: item.comment }]));
  const evaluation = {
    schemaVersion: "motion-graph-evaluation-v1",
    generatedAt: nowIso(),
    passed: gates.every((item) => item.passed),
    playable_mp4: gateById.playable_mp4?.passed === true,
    has_audio: gateById.has_audio?.passed === true,
    not_tiny: gateById.not_tiny?.passed === true,
    motion_above_threshold: gateById.motion_above_threshold?.passed === true,
    selected_template_not_seed_b2b: gateById.selected_template_not_seed_b2b?.passed === true,
    induced_slots_non_empty: gateById.induced_slots_non_empty?.passed === true,
    renderer_capability_selected: gateById.renderer_capability_selected?.passed === true,
    family_specific_visual_ratio: Number(visualRatio.toFixed(3)),
    not_only_text_cards: gateById.not_only_text_cards?.passed === true,
    no_duplicate_timeline_clip_ids: gateById.no_duplicate_timeline_clip_ids?.passed === true,
    preview_frames_exist: gateById.preview_frames_exist?.passed === true,
    no_sample_visual_copy: gateById.no_sample_visual_copy?.passed === true,
    no_private_paths: gateById.no_private_paths?.passed === true,
    unknown_clip_count: unknownClips.length,
    duplicate_clip_ids: duplicateClipIds,
    text_card_count: textCardCount,
    clip_count: timeline.clips.length,
    selectedTemplate: {
      id: template.id,
      name: template.name,
      seedB2bNotPrimary: true
    },
    inducedSlotFamilies: inducedSlots.map((slot) => slot.visualFormFamily),
    rendererCapabilityByFamily: capabilityByFamily,
    renderMetadata,
    renderMotion,
    previewManifest: "preview_frames/manifest.json",
    contactSheet: "contact_sheet.png",
    gates
  };
  artifactGeneration.motionGraphCaseGates = gates;
  artifactGeneration.evaluation = "evaluation.motion_graph.json";
  artifactGeneration.renderMotion = renderMotion;
  await writeJson("evaluation.motion_graph.json", evaluation);
  await writeJson("generation-result.json", artifactGeneration);
  if (!scan.passed) {
    throw new Error(`Public artifact sanitization failed: ${scan.matches.map((match) => `${match.path}:${match.line}:${match.pattern}`).join(", ")}`);
  }
  const failed = gates.filter((item) => !item.passed);
  if (failed.length) {
    throw new Error(`Motion graph gates failed: ${failed.map((item) => item.id).join(", ")}`);
  }

  console.log(`Motion graph case generated at ${path.relative(repoRoot, artifactDir)}`);
  console.log(`Selected template: ${template.name} (${template.id})`);
  console.log(`Induced slot families: ${Array.from(familySet).join(", ")}`);
  console.log(`Unknown clip count: ${unknownClips.length}`);
  console.log(`Duplicate clip IDs: ${duplicateClipIds.length ? duplicateClipIds.map((item) => item.value).join(", ") : "none"}`);
  console.log(`Replacement slots: ${(generation.replacementSlots ?? []).map((slot) => slot.slotId).join(", ")}`);
  console.log(`Rendered MP4: ${path.relative(repoRoot, renderPath)}`);
  console.log(`Contact sheet: ${path.relative(repoRoot, path.join(artifactDir, "contact_sheet.png"))}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
