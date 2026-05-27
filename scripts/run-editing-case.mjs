import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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

function resolveFfmpegBin() {
  const explicit = process.env.FFMPEG_PATH;
  if (explicit && explicit !== "ffmpeg") return explicit;
  const condaBase = process.env.CONDA_BASE ?? "/home/pxli/anaconda3";
  const condaEnv = process.env.VIRAL_CONDA_ENV ?? "viral";
  const condaBin = path.join(condaBase, "envs", condaEnv, "bin", "ffmpeg");
  return existsSync(condaBin) ? condaBin : "ffmpeg";
}

const ffmpegBin = resolveFfmpegBin();

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

  const renderer = new FFmpegRenderer({
    generatedDir: artifactDir,
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
  await copyFile(renderOutput.outputPath, renderPath);
  if (path.resolve(renderOutput.outputPath) !== path.resolve(renderPath)) {
    await rm(renderOutput.outputPath, { force: true });
  }

  const timeline = structuredClone(generation.timeline);
  const previewFrames = [];
  for (let index = 0; index < timeline.clips.length; index += 1) {
    const clip = timeline.clips[index];
    const isProxy = clip.gapFillStrategy === "proxy_placeholder";
    const filename = `clip_${String(index + 1).padStart(2, "0")}_${isProxy ? "proxy" : "generated"}.png`;
    const relative = `preview_frames/${filename}`;
    const framePath = path.join(artifactDir, relative);
    await extractFrame(renderPath, clip.startSec + Math.min(0.35, clip.durationSec / 2), framePath, clip.id);
    clip.previewFrame = relative;
    previewFrames.push({ clipId: clip.id, frame: relative, kind: isProxy ? "proxy" : "generated" });
  }

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
  const gates = [
    {
      id: "gap_detected_when_no_target_assets",
      passed: gapReport.some((gap) => gap.status !== "matched" && gap.severity !== "low"),
      value: gapReport.filter((gap) => gap.status !== "matched").length,
      comment: "targetAssets is empty, so visual gaps must be surfaced."
    },
    {
      id: "sample_visual_not_reused_without_authorization",
      passed: disabledReferenceMappings.every((mapping) => mapping.assetAvailability !== "source_video_mapped"),
      value: disabledReferenceMappings.filter((mapping) => mapping.assetAvailability === "source_video_mapped").length,
      comment: "editing.mov source_shot_* remains structure evidence only by default."
    },
    {
      id: "authorized_sample_reuse_can_match_visual_slots",
      passed: authorizedReferenceMappings.some((mapping) => mapping.assetAvailability === "source_video_mapped"),
      value: authorizedReferenceMappings.filter((mapping) => mapping.assetAvailability === "source_video_mapped").length,
      comment: "sampleAssetReuse='authorized' is the explicit override path."
    },
    {
      id: "mock_asset_not_counted_as_match",
      passed: generation.slotMapping.every((mapping) => mapping.assetAvailability !== "source_video_mapped"),
      value: generation.slotMapping.filter((mapping) => mapping.assetAvailability === "source_video_mapped").length,
      comment: "demo_source_video is mock/no renderable path and cannot fill visual slots."
    },
    {
      id: "interactive_gap_fill_non_empty",
      passed: (generation.replacementSlots ?? []).length > 0,
      value: generation.replacementSlots?.length ?? 0,
      comment: "replacementSlots are created for visual/material gaps."
    },
    {
      id: "proxy_placeholder_rendered",
      passed: timeline.clips.some((clip) => clip.gapFillStrategy === "proxy_placeholder") && previewFrames.some((frame) => frame.kind === "proxy"),
      value: previewFrames.filter((frame) => frame.kind === "proxy").length,
      comment: "render.mp4 and preview_frames include proxy frames."
    },
    {
      id: "timeline_preview_has_real_or_proxy_frames",
      passed: timeline.clips.every((clip) => typeof clip.previewFrame === "string" && existsSync(path.join(artifactDir, clip.previewFrame))),
      value: timeline.clips.length,
      comment: "Every timeline clip links to an artifact-backed preview frame."
    },
    {
      id: "render_mp4_not_only_text_cards",
      passed: timeline.clips.some((clip) => clip.gapFillStrategy === "proxy_placeholder"),
      value: timeline.clips.filter((clip) => clip.gapFillStrategy === "proxy_placeholder").length,
      comment: "At least one rendered clip is a visible proxy placeholder, not a plain text card."
    }
  ];

  const artifactGeneration = {
    ...generation,
    timeline,
    gapReport,
    fillPlan,
    editingCaseGates: gates,
    materialPoolEvidence: {
      targetAssetsEmpty: true,
      blockedMockAsset: "demo_source_video blocked because it is mock/no renderable path.",
      blockedSampleReference: "source_shot_* from editing.mov blocked because sample/reference only.",
      authorizedOverride: "sampleAssetReuse='authorized' allows reference/source shots to satisfy visual slots."
    }
  };

  await writeJson("analysis.editing.json", { analysis, vlm, template });
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
    ...gates.map((gate) => `- ${gate.passed ? "PASS" : "FAIL"} ${gate.id}: ${gate.value} - ${gate.comment}`),
    "",
    "## Artifacts",
    "",
    "- `render.mp4`",
    "- `contact_sheet.png`",
    "- `preview_frames/*.png`"
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
    .frames img { width: 150px; aspect-ratio: 9 / 16; object-fit: cover; background: #111827; }
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
        <tr><th>accepted</th><td>${esc(proxySlot?.acceptedAssetTypes?.join(", ") ?? "")}</td></tr>
        <tr><th>placeholder</th><td>${esc(proxySlot?.placeholderSpec?.label ?? "")}</td></tr>
      </table>
    </section>
  </div>
  <section class="card" style="margin-top:16px">
    <h2>Timeline Preview Frames</h2>
    <div class="frames">
      ${previewFrames.map((frame) => `<figure><img src="${esc(frame.frame)}" alt="${esc(frame.clipId)}" /><figcaption>${esc(frame.kind)} · ${esc(frame.clipId)}</figcaption></figure>`).join("")}
    </div>
  </section>
  <section class="card" style="margin-top:16px">
    <h2>Gates</h2>
    <div class="badges">${gates.map((gate) => `<span class="badge ${gate.passed ? "pass" : "fail"}">${esc(gate.id)}: ${gate.passed ? "PASS" : "FAIL"}</span>`).join("")}</div>
  </section>
  <section class="card" style="margin-top:16px">
    <h2>Artifact Links</h2>
    <p><a href="report.md">report.md</a> · <a href="generation-result.json">generation-result.json</a> · <a href="gap-report.json">gap-report.json</a> · <a href="replacement-slots.json">replacement-slots.json</a> · <a href="contact_sheet.png">contact_sheet.png</a></p>
  </section>
</main>
</body>
</html>`;
  await writeFile(path.join(artifactDir, "index.html"), html, "utf8");

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
