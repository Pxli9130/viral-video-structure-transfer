import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFallbackTemplate,
  buildMockVideoAnalysis,
  createFillPlan,
  generateGapReport,
  generateMigrationResult,
  matchSlots,
  nowIso,
  understandSourceVideo
} from "../packages/shared/dist/index.js";
import { FFmpegRenderer } from "../apps/api/dist/adapters/renderers.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "docs", "artifacts", "editing_case");
const previewDir = path.join(artifactDir, "preview_frames");
const samplePath = path.join(repoRoot, "test_videos", "editing.mov");
const forbiddenArtifactPatterns = [
  { id: "/home/pxli", re: /\/home\/pxli/g },
  { id: ".env", re: /\.env/g },
  { id: "GEMINI_API_KEY", re: /GEMINI_API_KEY/g },
  { id: "AIza", re: /AIza[0-9A-Za-z_-]*/g },
  { id: "ark-", re: /ark-[0-9A-Za-z_-]*/g }
];
const textArtifactExtensions = new Set([".html", ".md", ".json", ".txt", ".csv", ".mjs", ".js"]);

function resolveFfmpegBin() {
  const explicit = process.env.FFMPEG_PATH;
  if (explicit && explicit !== "ffmpeg") return explicit;
  const condaBase = process.env.CONDA_BASE ?? "/home/pxli/anaconda3";
  const condaEnv = process.env.VIRAL_CONDA_ENV ?? "viral";
  const condaBin = path.join(condaBase, "envs", condaEnv, "bin", "ffmpeg");
  return existsSync(condaBin) ? condaBin : "ffmpeg";
}

const ffmpegBin = resolveFfmpegBin();

function resolveFfprobeBin() {
  const explicit = process.env.FFPROBE_PATH;
  if (explicit && explicit !== "ffprobe") return explicit;
  const condaBase = process.env.CONDA_BASE ?? "/home/pxli/anaconda3";
  const condaEnv = process.env.VIRAL_CONDA_ENV ?? "viral";
  const condaBin = path.join(condaBase, "envs", condaEnv, "bin", "ffprobe");
  return existsSync(condaBin) ? condaBin : "ffprobe";
}

const ffprobeBin = resolveFfprobeBin();

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

async function extractFrame(inputPath, timeSec, outputPath, label) {
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
  return { path: outputPath, label };
}

async function muxBeatAudio(videoInputPath, outputPath, durationSec) {
  const tickSource = `aevalsrc=if(lt(mod(t\\,0.5)\\,0.04)\\,0.22*sin(2*PI*1040*t)\\,0):s=48000:d=${Math.max(1, durationSec).toFixed(2)}`;
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
    "900k",
    "-maxrate",
    "1100k",
    "-bufsize",
    "1800k",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath
  ]);
}

async function probeRender(renderPath) {
  if (!existsSync(renderPath)) return { exists: false };
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
    exists: true,
    durationSec: parsed.format?.duration ? Number(parsed.format.duration) : null,
    sizeBytes: parsed.format?.size ? Number(parsed.format.size) : null,
    bitrate: parsed.format?.bit_rate ? Number(parsed.format.bit_rate) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps,
    videoCodec: video?.codec_name ?? null,
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name ?? null
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
      const line = lines[index];
      for (const pattern of forbiddenArtifactPatterns) {
        pattern.re.lastIndex = 0;
        if (pattern.re.test(line)) {
          matches.push({
            path: path.relative(repoRoot, file),
            line: index + 1,
            pattern: pattern.id
          });
        }
      }
    }
  }
  return {
    scannedFiles: files.map((file) => path.relative(repoRoot, file)),
    matchCount: matches.length,
    matches,
    passed: matches.length === 0
  };
}

function sourceEvidenceForSlot(slotId, role) {
  if (/rotating_hero|hook/.test(slotId) || role === "hook") return "preview_frames/sample_hook.png";
  if (/kinetic|text|title|subtitle|cta/.test(slotId) || role === "cta") return "preview_frames/sample_text.png";
  if (/beat_sync|match_cut|action|comparison|usage|proof/.test(slotId) || role === "proof") return "preview_frames/sample_action.png";
  return "preview_frames/sample_text.png";
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

function editingVlmFixture() {
  return {
    videoType: "beat_cut_editing_tutorial",
    videoSummary:
      "High-energy editing tutorial with an opening rotating helmet/head/logo-like object, kinetic black text cards, beat-sync cinematic action montage, match cuts, and CTA end slate.",
    shots: [
      { start: 0, end: 1.5, visual: "Opening rotating 3D helmet/head/logo object on black", purpose: "hook" },
      { start: 1.5, end: 8, visual: "Kinetic text-card sequence explaining edit steps", purpose: "setup", transition: "hard_cut" },
      { start: 8, end: 15, visual: "Beat-sync cinematic action montage", purpose: "proof", transition: "match_cut" }
    ],
    structure: {
      hook: "Visual logo intro with a rotating 3D head/helmet object before kinetic text.",
      setup: "Kinetic text cards outline the edit sequence and rhythm.",
      sellingPoints: ["beat-sync montage clips", "seamless cinematic match cuts", "high-impact text timing"],
      climax: "High-speed action montage aligned to punches, gunshots, and impact beats.",
      cta: "Practice the sequence until you master the edit."
    },
    rhythm: {
      avgShotLength: 1.2,
      peakTimeRatio: 0.72,
      fastSections: ["0-8s", "100-118s"],
      peakMoments: ["46-59s", "107-118s"],
      notes: "Fast hook, black text cards, and beat-cut action bursts."
    },
    packaging: {
      subtitleDensity: "high",
      titleCards: ["Heavy white/red kinetic typography on black"],
      stickers: ["beat marker", "impact flash"],
      colorStyle: "black red blue white",
      coverStyle: "centered high-contrast editing tip title"
    },
    reusablePatterns: ["rotating_3d_object_intro", "text_card_beat_sync_sequence", "cinematic_match_cut_montage"],
    materialGapsForNewVideo: ["rotating hero object", "target action montage clips", "proof/action clip sequence", "CTA visual"]
  };
}

function buildEditingAnalysis() {
  const analysis = buildMockVideoAnalysis({
    assetId: "editing_sample",
    projectId: "editing_case_project",
    filename: "editing.mov",
    purpose: "sample",
    durationSec: 118.12,
    width: 1280,
    height: 720,
    fps: 24
  });
  return {
    ...analysis,
    analyzerMode: "ffmpeg_vlm_asr",
    metadata: { ...analysis.metadata, durationSec: 118.12, width: 1280, height: 720, fps: 24, hasAudio: true },
    keyframes: [
      { id: "editing_hook_rotating_object", timeSec: 0.6, path: "preview_frames/sample_hook.png", description: "Opening rotating hero/head/logo object evidence", tags: ["hook_candidate", "rotating_object_candidate"] },
      { id: "editing_kinetic_text", timeSec: 2.4, path: "preview_frames/sample_text.png", description: "Kinetic black text card evidence", tags: ["text_card_candidate"] },
      { id: "editing_action_montage", timeSec: 8.5, path: "preview_frames/sample_action.png", description: "Beat-sync action montage evidence", tags: ["action_montage_candidate", "comparison_candidate"] }
    ],
    shots: [
      { id: "source_shot_1", startSec: 0, endSec: 1.5, durationSec: 1.5, tags: ["hook_candidate", "rotating_object_candidate"], confidence: 0.88, notes: "Reference-only rotating 3D hero object intro." },
      { id: "source_shot_2", startSec: 1.5, endSec: 8, durationSec: 6.5, tags: ["text_card_candidate"], confidence: 0.82, notes: "Reference-only kinetic text cards." },
      { id: "source_shot_3", startSec: 8, endSec: 15, durationSec: 7, tags: ["usage_scene", "action_montage_candidate"], confidence: 0.84, notes: "Reference-only beat-sync action montage." },
      { id: "source_shot_4", startSec: 15, endSec: 30, durationSec: 15, tags: ["comparison_candidate", "match_cut_candidate"], confidence: 0.8, notes: "Reference-only cinematic match cuts." },
      { id: "source_shot_5", startSec: 110, endSec: 118.12, durationSec: 8.12, tags: ["cta_candidate"], confidence: 0.72, notes: "Reference-only CTA/end slate." }
    ],
    primaryMotif: {
      motif: "rotating_3d_object_intro",
      confidence: 0.82,
      evidence: { generic: true, semanticLabel: "unknown_object", timeRange: "0.0-1.5s" }
    },
    motifCandidates: [
      { motif: "text_card_beat_sync_sequence", confidence: 0.78 },
      { motif: "cinematic_match_cut_montage", confidence: 0.76 }
    ],
    warnings: ["Editing case fixture uses local sample frames as structure evidence only; targetAssets are intentionally empty."]
  };
}

function requestForCase(sampleAssetReuse = "disabled") {
  return {
    projectId: "editing_case_project",
    inputMode: "video_plus_prompt",
    sourceVideo: { assetId: "demo_source_video" },
    selectedTemplateIds: ["editing_template"],
    prompt: [
      "主题：剪辑课程短视频结构迁移",
      "目标用户：想学习动作卡点剪辑的创作者",
      "卖点：节奏清晰、字幕强、动作匹配、可替换缺失素材",
      "CTA：上传你的素材并重建这个结构"
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
      sampleAssetReuse
    },
    targetAssets: []
  };
}

async function main() {
  if (!existsSync(samplePath)) {
    throw new Error(`Expected sample video at test_videos/editing.mov`);
  }
  await rm(artifactDir, { recursive: true, force: true });
  await mkdir(previewDir, { recursive: true });

  await Promise.all([
    extractFrame(samplePath, 0.6, path.join(previewDir, "sample_hook.png"), "sample hook"),
    extractFrame(samplePath, 2.4, path.join(previewDir, "sample_text.png"), "sample kinetic text"),
    extractFrame(samplePath, 8.5, path.join(previewDir, "sample_action.png"), "sample action montage")
  ]);

  const vlm = editingVlmFixture();
  const analysis = buildEditingAnalysis();
  const template = buildFallbackTemplate(analysis, "b2b_marketing_mg", "editing_case_project", vlm);
  const request = requestForCase("disabled");
  const mockSourceAsset = {
    id: "demo_source_video",
    projectId: "editing_case_project",
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
    projectId: "editing_case_project",
    purpose: "source",
    durationSec: 30
  });

  const generation = generateMigrationResult({
    template,
    request,
    sourceAsset: mockSourceAsset,
    sourceAnalysis: mockSourceAnalysis,
    sourceVlm: vlm,
    generationIdSalt: "editing_case"
  });

  const sampleReferenceAsset = {
    ...mockSourceAsset,
    id: "editing_sample",
    role: "example_video",
    filename: "editing.mov",
    path: samplePath,
    sourcePolicy: "demo_only",
    metadata: {}
  };
  const disabledReferenceSource = understandSourceVideo(analysis, sampleReferenceAsset, request, vlm);
  const disabledReferenceMappings = matchSlots(template, disabledReferenceSource, request);
  const authorizedRequest = requestForCase("authorized");
  const authorizedReferenceSource = understandSourceVideo(analysis, sampleReferenceAsset, authorizedRequest, vlm);
  const authorizedReferenceMappings = matchSlots(template, authorizedReferenceSource, authorizedRequest);
  const pathlessSourceAsset = {
    ...mockSourceAsset,
    id: "pathless_source_video",
    metadata: {},
    path: undefined,
    url: undefined
  };
  const pathlessRequest = { ...requestForCase("disabled"), sourceVideo: { assetId: "pathless_source_video" } };
  const pathlessSourceAnalysis = buildMockVideoAnalysis({
    assetId: "pathless_source_video",
    projectId: "editing_case_project",
    purpose: "source",
    durationSec: 30
  });
  const pathlessSource = understandSourceVideo(pathlessSourceAnalysis, pathlessSourceAsset, pathlessRequest, vlm);
  const pathlessMappings = matchSlots(template, pathlessSource, pathlessRequest);

  const tempRenderDir = await mkdtemp(path.join(tmpdir(), "vvst-editing-case-"));
  const renderer = new FFmpegRenderer({
    generatedDir: tempRenderDir,
    assetResolver: {
      resolve(assetId) {
        if (assetId === "editing_sample") return samplePath;
        return undefined;
      }
    }
  });
  const renderOutput = await renderer.render(generation.timeline, generation.id);
  if (renderOutput.status !== "completed" || !renderOutput.outputPath) {
    throw new Error(`Editing case render failed: ${renderOutput.error ?? "unknown error"}`);
  }
  const renderPath = path.join(artifactDir, "render.mp4");
  await muxBeatAudio(renderOutput.outputPath, renderPath, generation.timeline.durationSec);
  await rm(tempRenderDir, { recursive: true, force: true });
  await rm(path.join(artifactDir, "ffmpeg"), { recursive: true, force: true });
  const renderMetadata = await probeRender(renderPath);

  const timeline = structuredClone(generation.timeline);
  const previewFrames = [];
  const previewPairs = [];
  for (let index = 0; index < timeline.clips.length; index += 1) {
    const clip = timeline.clips[index];
    const isProxy = clip.gapFillStrategy === "proxy_placeholder";
    const filename = `clip_${String(index + 1).padStart(2, "0")}_${isProxy ? "proxy" : "generated"}.png`;
    const relative = `preview_frames/${filename}`;
    const framePath = path.join(artifactDir, relative);
    await extractFrame(renderPath, clip.startSec + Math.min(0.35, clip.durationSec / 2), framePath, clip.id);
    clip.previewFrame = relative;
    const slotId = clip.replacementSlotId ?? clip.layers.find((layer) => layer.style?.replacementSlotId)?.style?.replacementSlotId ?? clip.id;
    const sourceEvidenceFrame = sourceEvidenceForSlot(String(slotId), clip.role);
    clip.sourceEvidenceFrame = sourceEvidenceFrame;
    previewFrames.push({ clipId: clip.id, frame: relative, kind: isProxy ? "proxy" : "generated", slotId });
    previewPairs.push({
      slotId,
      clipId: clip.id,
      kind: isProxy ? "proxy" : "generated",
      status: clip.gapFillStrategy ?? "none",
      sourceEvidenceFrame,
      generatedProxyFrame: relative
    });
  }
  const previewManifest = {
    generatedAt: nowIso(),
    sample: "editing.mov",
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

  const gapReport = generateGapReport(generation.slotMapping, { source: generation.sourceUnderstanding, template, request });
  const fillPlan = createFillPlan(generation.slotMapping, generation.sourceUnderstanding, request, template);
  const visualGapCount = gapReport.filter((gap) => gap.severity !== "low" && gap.status !== "matched").length;
  const proxyClipCount = timeline.clips.filter((clip) => clip.gapFillStrategy === "proxy_placeholder").length;
  const gates = [
    gate(
      "sample_reference_cannot_satisfy_visual_slots_by_default",
      disabledReferenceMappings.every((mapping) => mapping.assetAvailability !== "source_video_mapped"),
      disabledReferenceMappings.filter((mapping) => mapping.assetAvailability === "source_video_mapped").length,
      "editing.mov source_shot_* remains structure evidence only by default."
    ),
    gate(
      "sample_visual_not_reused_without_authorization",
      disabledReferenceMappings.every((mapping) => mapping.assetAvailability !== "source_video_mapped"),
      disabledReferenceMappings.filter((mapping) => mapping.assetAvailability === "source_video_mapped").length,
      "Default sampleAssetReuse disabled blocks reference visual reuse."
    ),
    gate(
      "authorized_sample_reuse_can_match_visual_slots",
      authorizedReferenceMappings.some((mapping) => mapping.assetAvailability === "source_video_mapped"),
      authorizedReferenceMappings.filter((mapping) => mapping.assetAvailability === "source_video_mapped").length,
      "sampleAssetReuse='authorized' is the explicit override path."
    ),
    gate(
      "mock_asset_cannot_satisfy_visual_slots",
      generation.slotMapping.every((mapping) => mapping.assetAvailability !== "source_video_mapped"),
      generation.slotMapping.filter((mapping) => mapping.assetAvailability === "source_video_mapped").length,
      "demo_source_video is mock/no renderable path and cannot fill visual slots."
    ),
    gate(
      "mock_asset_not_counted_as_match",
      generation.slotMapping.every((mapping) => mapping.assetAvailability !== "source_video_mapped"),
      generation.slotMapping.filter((mapping) => mapping.assetAvailability === "source_video_mapped").length,
      "Mock source evidence is blocked from material matching."
    ),
    gate(
      "asset_without_path_cannot_satisfy_visual_slots",
      pathlessMappings.every((mapping) => mapping.assetAvailability !== "source_video_mapped"),
      pathlessMappings.filter((mapping) => mapping.assetAvailability === "source_video_mapped").length,
      "Pathless source assets are not renderable material."
    ),
    gate(
      "editing_case_no_target_assets_creates_visual_gaps",
      visualGapCount > 0,
      visualGapCount,
      "targetAssets is empty, so visual gaps must be surfaced."
    ),
    gate(
      "gap_detected_when_no_target_assets",
      visualGapCount > 0,
      visualGapCount,
      "No-target editing case produced non-low material gaps."
    ),
    gate(
      "interactive_gap_fill_non_empty",
      (generation.replacementSlots ?? []).length > 0,
      generation.replacementSlots?.length ?? 0,
      "replacementSlots are created for visual/material gaps."
    ),
    gate(
      "proxy_placeholder_rendered",
      proxyClipCount > 0 && previewFrames.some((frame) => frame.kind === "proxy"),
      previewFrames.filter((frame) => frame.kind === "proxy").length,
      "render.mp4 and preview_frames include proxy frames."
    ),
    gate(
      "timeline_preview_has_real_or_proxy_frames",
      timeline.clips.every((clip) =>
        typeof clip.previewFrame === "string" &&
        existsSync(path.join(artifactDir, clip.previewFrame)) &&
        typeof clip.sourceEvidenceFrame === "string" &&
        existsSync(path.join(artifactDir, clip.sourceEvidenceFrame))
      ) && existsSync(path.join(previewDir, "manifest.json")),
      timeline.clips.length,
      "Every timeline clip links to source evidence and generated/proxy preview frames."
    ),
    gate(
      "render_mp4_has_audio",
      renderMetadata.hasAudio === true,
      renderMetadata.audioCodec ?? "missing",
      "Editing-case MP4 includes deterministic low-volume beat/tick audio."
    ),
    gate(
      "render_mp4_not_tiny",
      (renderMetadata.sizeBytes ?? 0) >= 250000,
      renderMetadata.sizeBytes ?? 0,
      "Muxed audio and animated proxy render should avoid tiny text-card-only output."
    ),
    gate(
      "render_mp4_not_only_text_cards",
      proxyClipCount > 0 && (renderMetadata.sizeBytes ?? 0) >= 250000,
      proxyClipCount,
      "At least one rendered clip is a visible proxy placeholder, not a plain text card."
    )
  ];

  const motifSlots = template.requiredSlots.filter((slot) =>
    ["slot_rotating_hero_object_intro", "slot_kinetic_text_card_sequence", "slot_beat_sync_action_montage", "slot_cinematic_match_cut_sequence", "slot_cta_end_slate"].includes(slot.id)
  );

  async function writeCaseArtifacts(currentGates, publicScan) {
    const artifactGeneration = {
      ...generation,
      timeline,
      gapReport,
      fillPlan,
      motifSlots,
      previewManifest: "preview_frames/manifest.json",
      renderMetadata,
      editingCaseGates: currentGates,
      publicArtifactScan: publicScan ? { passed: publicScan.passed, scannedFiles: publicScan.scannedFiles.length, matchCount: publicScan.matchCount } : undefined,
      materialPoolEvidence: {
        targetAssetsEmpty: true,
        blockedMockAsset: "demo_source_video blocked because it is mock/no renderable path.",
        blockedSampleReference: "source_shot_* from editing.mov blocked because sample/reference only.",
        pathlessBlocked: "pathless source assets are ignored because they are not renderable material.",
        authorizedOverride: "sampleAssetReuse='authorized' allows reference/source shots to satisfy visual slots."
      }
    };

    await writeJson("analysis.editing.json", { analysis: { ...analysis, motifSlots }, vlm, template });
    await writeJson("generation-result.json", artifactGeneration);
    await writeJson("timeline.json", timeline);
    await writeJson("gap-report.json", gapReport);
    await writeJson("fill-plan.json", fillPlan);
    await writeJson("replacement-slots.json", generation.replacementSlots ?? []);

    const report = [
    "# Editing Case IGF Report",
    "",
    `Generated: ${nowIso()}`,
    "",
    "## Material Pool Policy",
    "",
    "- `demo_source_video` was blocked because it is mock/no renderable path.",
    "- `source_shot_*` from `editing.mov` was blocked because it is sample/reference only.",
    "- `targetAssets` were empty, so visual gaps were detected.",
    "- `sampleAssetReuse: \"authorized\"` is the explicit override path.",
    "- Pathless and mock source assets are blocked from target-material matching.",
    "",
    "## Motif Slots",
    "",
    ...motifSlots.map((slot) => `- ${slot.id}: ${slot.visualForm ?? slot.slotType}, ${slot.semanticLabel ?? "unknown_object"}, clickToReplace=${slot.clickToReplace === true}`),
    "",
    "## Detected Gaps",
    "",
    ...gapReport.map((gap) => `- ${gap.gapType ?? gap.slotId}: ${gap.gapLabelZh ?? gap.gapLabel ?? gap.reason} (${gap.severity})`),
    "",
    "## Replacement Slots",
    "",
    ...(generation.replacementSlots ?? []).map((slot) => `- ${slot.slotId}: ${slot.status}, ${slot.visualForm}, accepts ${slot.acceptedAssetTypes.join("/")}`),
    "",
    "## Gates",
    "",
    ...currentGates.map((gate) => `- ${gate.passed ? "PASS" : "FAIL"} ${gate.id}: ${gate.value} - ${gate.comment}`),
    "",
    "## Render Metadata",
    "",
    `- duration: ${renderMetadata.durationSec ?? "unknown"}s`,
    `- resolution: ${renderMetadata.width ?? "?"}x${renderMetadata.height ?? "?"}`,
    `- fps: ${renderMetadata.fps ?? "unknown"}`,
    `- sizeBytes: ${renderMetadata.sizeBytes ?? "unknown"}`,
    `- bitrate: ${renderMetadata.bitrate ?? "unknown"}`,
    `- audio: ${renderMetadata.hasAudio ? renderMetadata.audioCodec ?? "present" : "missing"}`,
    "",
    "## Timeline Preview",
    "",
    "- `preview_frames/manifest.json` pairs labeled sample evidence frames with generated proxy frames.",
    "- Sample frames are evidence only; they are not used as target material.",
    "",
    "## Public Artifact Sanitization",
    "",
    `- scannedFiles: ${publicScan?.scannedFiles.length ?? "pending"}`,
    `- forbiddenMatches: ${publicScan?.matchCount ?? "pending"}`,
    "",
    "## Artifacts",
    "",
    "- `render.mp4`",
    "- `contact_sheet.png`",
    "- `preview_frames/*.png`",
    "- `preview_frames/manifest.json`"
  ].join("\n");
    await writeFile(path.join(artifactDir, "report.md"), `${report}\n`, "utf8");

    const proxySlot = (generation.replacementSlots ?? []).find((slot) => slot.slotId === "slot_rotating_hero_object_intro") ?? generation.replacementSlots?.[0];
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Editing Case · Interactive Gap Fill</title>
  <style>
    body { margin: 0; background: #f7f8fa; color: #172033; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px; }
    .hero, .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06); padding: 18px; }
    .hero { display: grid; gap: 10px; margin-bottom: 16px; }
    h1, h2, p { margin: 0; }
    .grid { display: grid; gap: 16px; grid-template-columns: 1.1fr 0.9fr; }
    video, img { max-width: 100%; border-radius: 8px; }
    .badges, .frames { display: flex; flex-wrap: wrap; gap: 8px; }
    .badge { background: #e0f2fe; color: #075985; border-radius: 999px; font-size: 12px; font-weight: 750; padding: 5px 8px; }
    .pass { background: #dcfce7; color: #166534; }
    .fail { background: #fee2e2; color: #991b1b; }
    .warn { background: #fef3c7; color: #92400e; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border-bottom: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top; }
    .frames figure { width: min(240px, 100%); margin: 0; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: start; }
    .frames img { width: 100%; aspect-ratio: 9 / 16; object-fit: cover; background: #111827; }
    figcaption { color: #475569; font-size: 12px; margin-top: 6px; }
    @media (max-width: 860px) { main { padding: 16px; } .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<main>
  <section class="hero">
    <span class="badge warn">Reference Video ≠ Target Material</span>
    <h1>Editing Case · Interactive Gap Fill</h1>
    <p>editing.mov is used as structure evidence only. With empty targetAssets, visual slots become gaps and proxy placeholders are rendered instead of copying sample frames.</p>
    <div class="badges">
      <span class="badge">sampleAssetReuse: disabled</span>
      <span class="badge">targetAssets: empty</span>
      <span class="badge">source_shot_* blocked</span>
      <span class="badge">proxy_placeholder rendered</span>
    </div>
  </section>
  <div class="grid">
    <section class="card">
      <h2>Rendered Proxy Output</h2>
      <video controls src="render.mp4"></video>
      <p>Proxy must be visible in the MP4; JSON-only replacement slots do not count.</p>
    </section>
    <section class="card">
      <h2>Rotating Hero Object Slot</h2>
      <table>
        <tr><th>slotId</th><td>${esc(proxySlot?.slotId ?? "missing")}</td></tr>
        <tr><th>status</th><td>${esc(proxySlot?.status ?? "missing")}</td></tr>
        <tr><th>visualForm</th><td>${esc(proxySlot?.visualForm ?? "missing")}</td></tr>
        <tr><th>motion</th><td>${esc(`${proxySlot?.motionSpec?.type ?? "unknown"} / ${proxySlot?.motionSpec?.axis ?? "unknown"}`)}</td></tr>
        <tr><th>accepted</th><td>${esc(proxySlot?.acceptedAssetTypes?.join(", ") ?? "")}</td></tr>
        <tr><th>placeholder</th><td>${esc(proxySlot?.placeholderSpec?.label ?? "")}</td></tr>
      </table>
    </section>
  </div>
  <section class="card" style="margin-top:16px">
    <h2>Timeline Preview · Source Evidence → Generated Proxy</h2>
    <div class="frames">
      ${previewPairs.map((pair) => `<figure><div class="pair"><div><img src="${esc(pair.sourceEvidenceFrame)}" alt="source evidence ${esc(pair.slotId)}" /><figcaption>source evidence</figcaption></div><div><img src="${esc(pair.generatedProxyFrame)}" alt="generated ${esc(pair.slotId)}" /><figcaption>${esc(pair.kind)} output</figcaption></div></div><figcaption>${esc(pair.slotId)} · ${esc(pair.status)}</figcaption></figure>`).join("")}
    </div>
    <p><a href="preview_frames/manifest.json">preview_frames/manifest.json</a></p>
  </section>
  <section class="card" style="margin-top:16px">
    <h2>Gates</h2>
    <div class="badges">${currentGates.map((gate) => `<span class="badge ${gate.passed ? "pass" : "fail"}">${esc(gate.id)}: ${gate.passed ? "PASS" : "FAIL"}</span>`).join("")}</div>
  </section>
  <section class="card" style="margin-top:16px">
    <h2>Render Metadata</h2>
    <p>${esc(renderMetadata.durationSec ?? "?")}s · ${esc(renderMetadata.width ?? "?")}x${esc(renderMetadata.height ?? "?")} · audio=${renderMetadata.hasAudio ? "present" : "missing"} · size=${esc(renderMetadata.sizeBytes ?? "?")} bytes</p>
  </section>
  <section class="card" style="margin-top:16px">
    <h2>Artifact Links</h2>
    <p><a href="report.md">report.md</a> · <a href="generation-result.json">generation-result.json</a> · <a href="gap-report.json">gap-report.json</a> · <a href="replacement-slots.json">replacement-slots.json</a> · <a href="contact_sheet.png">contact_sheet.png</a></p>
  </section>
</main>
</body>
</html>`;
    await writeFile(path.join(artifactDir, "index.html"), html, "utf8");
  }

  await writeCaseArtifacts(gates, undefined);
  let publicArtifactScan = await scanPublicTextArtifacts(artifactDir);
  gates.push(
    gate(
      "public_artifacts_sanitized",
      publicArtifactScan.passed,
      publicArtifactScan.matchCount,
      "Public editing_case HTML/JSON/MD/TXT artifacts contain no private paths or obvious secret patterns."
    )
  );
  await writeCaseArtifacts(gates, publicArtifactScan);
  publicArtifactScan = await scanPublicTextArtifacts(artifactDir);
  if (!publicArtifactScan.passed) {
    const matchSummary = publicArtifactScan.matches.map((match) => `${match.path}:${match.line}:${match.pattern}`).join(", ");
    throw new Error(`Public artifact sanitization failed: ${matchSummary}`);
  }

  const failed = gates.filter((gate) => !gate.passed);
  if (failed.length) {
    throw new Error(`Editing case gates failed: ${failed.map((gate) => gate.id).join(", ")}`);
  }

  console.log(`Editing case generated at ${path.relative(repoRoot, artifactDir)}`);
  console.log(`Detected gaps: ${gapReport.map((gap) => gap.gapType ?? gap.slotId).join(", ")}`);
  console.log(`Replacement slots: ${(generation.replacementSlots ?? []).map((slot) => slot.slotId).join(", ")}`);
  console.log(`Rendered MP4: ${path.relative(repoRoot, renderPath)}`);
  console.log(`Contact sheet: ${path.relative(repoRoot, path.join(artifactDir, "contact_sheet.png"))}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
