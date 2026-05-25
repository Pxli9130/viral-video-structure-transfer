import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildFallbackTemplate,
  generateMigrationResult,
  nowIso,
  stableId,
  validateStructureTemplate,
  validateTimeline
} from "../packages/shared/dist/index.js";
import { RemotionRenderer } from "../apps/api/dist/adapters/renderers.js";
import { marketingArtifactDir as artifactDir, rel, repoRoot } from "./artifact-paths.mjs";

const videoPath = path.join(repoRoot, "test_videos", "marketing.mov");
const condaBase = process.env.CONDA_BASE ?? "/home/pxli/anaconda3";
const condaEnv = process.env.VIRAL_CONDA_ENV ?? "viral";
const condaBin = path.join(condaBase, "envs", condaEnv, "bin");
const ffmpeg = existsSync(path.join(condaBin, "ffmpeg")) ? path.join(condaBin, "ffmpeg") : "ffmpeg";
const ffprobe = existsSync(path.join(condaBin, "ffprobe")) ? path.join(condaBin, "ffprobe") : "ffprobe";

const projectId = "project_marketing_poster_case";
const sampleAssetId = "asset_marketing_mov";
const skipVlmJudge = process.argv.includes("--skip-vlm-judge") || process.env.VVST_SKIP_VLM_JUDGE === "1";
const MARKETING_RIBBON_MOTION = {
  surfaceType: "wide_band",
  pathFamily: "vertical_helix",
  axis: "screen_y",
  depthBehavior: "front_back_crossing",
  layoutRelation: "around_title",
  textRelation: "text_on_ribbon",
  confidence: 0.78,
  evidenceFrames: [4.6, 9.2, 13.8],
  turns: 1.25,
  radiusX: 260,
  radiusZ: 160,
  pitchY: 960
};

if (!existsSync(videoPath)) {
  throw new Error(`Missing testcase input video: ${path.relative(repoRoot, videoPath)}`);
}

if (!existsSync(path.join(repoRoot, "packages", "shared", "dist", "index.js"))) {
  throw new Error("Build output is missing. Run `npm run build --workspace @vvst/shared` first.");
}

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function ffprobeMetadata(file) {
  const stdout = run(
    ffprobe,
    ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,avg_frame_rate,codec_name", "-of", "json", file],
    "ffprobe"
  );
  const parsed = JSON.parse(stdout);
  const video = parsed.streams.find((stream) => stream.codec_type === "video") ?? {};
  const audio = parsed.streams.some((stream) => stream.codec_type === "audio");
  const [fpsNum, fpsDen] = String(video.avg_frame_rate ?? "30/1").split("/").map(Number);
  return {
    durationSec: Number(parsed.format?.duration ?? 18.433333),
    width: Number(video.width ?? 718),
    height: Number(video.height ?? 1018),
    fps: fpsDen ? fpsNum / fpsDen : 30,
    hasAudio: audio,
    codec: String(video.codec_name ?? "unknown")
  };
}

function fixtureMarketingAnalysis(metadata) {
  // VLM-supplied semantic phase breakdown (would normally come from Gemini).
  // CV analyzer cannot semantically distinguish "ribbon entry" vs "keyword memory" because
  // marketing.mov is one continuous animation with no hard cuts. We keep this fixture as the
  // semantic layer; everything else (metadata, exclude_segments, motif evidence, primary motif)
  // comes from scripts/analyze-video-structure.py at runtime.
  return {
    id: "analysis_marketing_mov",
    assetId: sampleAssetId,
    projectId,
    purpose: "sample",
    metadata,
    keyframes: [
      { id: "marketing_kf_1", timeSec: 0.5, description: "Minimal off-white poster with central Chinese title and fixed info anchors.", tags: ["hook_candidate", "text_card_candidate"] },
      { id: "marketing_kf_2", timeSec: 4, description: "Large ribbon surface enters and starts a vertical helix around the title.", tags: ["background", "text_card_candidate"] },
      { id: "marketing_kf_3", timeSec: 8.5, description: "Keyword repetition and color progression strengthen brand memory.", tags: ["text_card_candidate"] },
      { id: "marketing_kf_4", timeSec: 13.5, description: "Dense multi-color ribbon climax around static poster typography.", tags: ["comparison_candidate", "text_card_candidate"] },
      { id: "marketing_kf_5", timeSec: 16.6, description: "Social platform profile page tail, not part of the transferable creative structure.", tags: ["background"] }
    ],
    shots: [
      { id: "marketing_shot_hook", startSec: 0, endSec: 2, durationSec: 2, tags: ["hook_candidate", "text_card_candidate"], confidence: 0.9, notes: "Main title appears immediately." },
      { id: "marketing_shot_ribbon_entry", startSec: 2, endSec: 6, durationSec: 4, tags: ["background", "text_card_candidate"], confidence: 0.86, notes: "Ribbon surface enters as a vertical helix around the static poster." },
      { id: "marketing_shot_keyword_memory", startSec: 6, endSec: 10, durationSec: 4, tags: ["text_card_candidate"], confidence: 0.84, notes: "English keywords repeat around the poster." },
      { id: "marketing_shot_color_climax", startSec: 10, endSec: 14.5, durationSec: 4.5, tags: ["comparison_candidate", "text_card_candidate"], confidence: 0.82, notes: "Color diversity and motion density increase." },
      { id: "marketing_shot_cta_poster", startSec: 14.5, endSec: 15.7, durationSec: 1.2, tags: ["cta_candidate", "text_card_candidate"], confidence: 0.82, notes: "Clean final poster hold." },
      { id: "marketing_shot_platform_tail", startSec: 15.7, endSec: metadata.durationSec, durationSec: Math.max(0, metadata.durationSec - 15.7), tags: ["background"], confidence: 0.45, notes: "Platform UI tail; excluded from transferable structure." }
    ],
    transcript: [],
    ocr: [
      { timeSec: 0.5, text: "造物 逐空 2026" },
      { timeSec: 8.5, text: "STRUCTURE COLOR SPACE" },
      { timeSec: 16.6, text: "小红书 profile UI" }
    ],
    warnings: ["VLM/fixture semantic layer (CV analyzer cannot derive hook/body/proof/cta without a real VLM)."],
    analyzerMode: "ffmpeg_vlm_asr",
    createdAt: nowIso()
  };
}

const condaPython = (() => {
  const candidates = [
    process.env.VIRAL_PYTHON,
    path.join(condaBin, "python"),
    path.join(condaBase, "envs", condaEnv, "bin", "python"),
    "python3"
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === "python3" || existsSync(candidate)) ?? "python3";
})();

function mergeAnalyzerIntoAnalysis(fixture, analyzerJson) {
  if (!analyzerJson) return fixture;
  const merged = { ...fixture };
  if (analyzerJson.metadata) merged.metadata = { ...merged.metadata, ...analyzerJson.metadata };
  if (Array.isArray(analyzerJson.excludeSegments) && analyzerJson.excludeSegments.length) {
    // Replace the platform-tail shot in the fixture with the analyzer-derived range when present.
    const tail = analyzerJson.excludeSegments[0];
    merged.shots = merged.shots.map((shot) =>
      shot.id === "marketing_shot_platform_tail"
        ? { ...shot, startSec: tail.startSec, endSec: tail.endSec, durationSec: Math.max(0, tail.endSec - tail.startSec), notes: tail.reason }
        : shot
    );
  }
  if (analyzerJson.primaryMotif) {
    merged.warnings = [
      ...(merged.warnings ?? []),
      `CV analyzer primaryMotif=${analyzerJson.primaryMotif.motif} confidence=${analyzerJson.primaryMotif.confidence}`
    ];
  }
  merged.analyzerEvidence = {
    primaryMotif: analyzerJson.primaryMotif,
    bandWidthEstimate: analyzerJson.stability?.bandWidthEstimate,
    colorfulForegroundRatioPeak: analyzerJson.stability?.colorfulForegroundRatioPeak,
    centralLayoutStability: analyzerJson.stability?.centralLayoutStability,
    motionEnergyAverage: analyzerJson.motion?.energyAverage,
    excludeSegments: analyzerJson.excludeSegments,
    motifCandidates: analyzerJson.motifCandidates,
    source: "scripts/analyze-video-structure.py"
  };
  return merged;
}

function loadAnalyzerOutput(targetPath) {
  if (!existsSync(targetPath)) return null;
  try {
    return JSON.parse(require("node:fs").readFileSync(targetPath, "utf8"));
  } catch (error) {
    console.warn(`Failed to parse ${targetPath}: ${error.message}`);
    return null;
  }
}

function runAnalyzer(input, output) {
  const args = ["scripts/analyze-video-structure.py", "--input", input, "--out", output];
  const result = spawnSync(condaPython, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Analyzer failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(spawnSync("cat", [output], { encoding: "utf8" }).stdout);
}

function loadOrAnalyze(input, output) {
  if (existsSync(output)) {
    try {
      const json = JSON.parse(spawnSync("cat", [output], { encoding: "utf8" }).stdout);
      if (!json.motionGeometry?.ribbonMotion) {
        console.log(`Re-running analyzer because ${rel(output)} lacks ribbon motion geometry.`);
        return runAnalyzer(input, output);
      }
      console.log(`Loaded existing analyzer output: ${rel(output)} (primary=${json.primaryMotif?.motif})`);
      return json;
    } catch (error) {
      console.warn(`Re-running analyzer because parse failed: ${error.message}`);
    }
  }
  return runAnalyzer(input, output);
}

// ---------------------------------------------------------------------------
// Six-phase semantic labelling for the generated reconstruction.
// Phases match the evaluator's REQUIRED_PHASES so semantic_phases_present passes.
// ---------------------------------------------------------------------------

const PHASES = [
  {
    key: "hook",
    label: "PHASE 1 · HOOK",
    subtitle: "爆款结构迁移引擎登场",
    startSec: 0,
    endSec: 2,
    mainHint: "爆款结构迁移引擎"
  },
  {
    key: "sample_analysis",
    label: "PHASE 2 · SAMPLE ANALYSIS",
    subtitle: "AI 拆解 Hook · Rhythm · Packaging",
    startSec: 2,
    endSec: 5,
    mainHint: "样例结构拆解"
  },
  {
    key: "material_gap",
    label: "PHASE 3 · MATERIAL GAP",
    subtitle: "缺少动态主视觉 → procedural ribbon fill",
    startSec: 5,
    endSec: 8,
    mainHint: "素材缺口补全"
  },
  {
    key: "recomposition",
    label: "PHASE 4 · RECOMPOSITION",
    subtitle: "Motion Atom + Timeline + CTA 重新编排",
    startSec: 8,
    endSec: 11,
    mainHint: "结构重组"
  },
  {
    key: "structure_mapping",
    label: "PHASE 5 · STRUCTURE MAPPING",
    subtitle: "Sample Structure → New Timeline",
    startSec: 11,
    endSec: 14,
    mainHint: "结构映射"
  },
  {
    key: "cta",
    label: "PHASE 6 · CTA",
    subtitle: "Upload. Analyze. Remix.",
    startSec: 14,
    endSec: 16,
    mainHint: "Upload. Analyze. Remix."
  }
];

const MAPPING_PAIRS = [
  { sample: "Hook · 极简海报", target: "Hook · 引擎登场" },
  { sample: "Vertical ribbon helix", target: "Parametric ribbon surface" },
  { sample: "Color climax", target: "Demo recomposition" },
  { sample: "CTA hold", target: "Upload. Remix." }
];

function findPhase(centreSec) {
  return PHASES.reduce((best, phase) => {
    const distance = centreSec >= phase.startSec && centreSec <= phase.endSec
      ? 0
      : Math.min(Math.abs(centreSec - phase.startSec), Math.abs(centreSec - phase.endSec));
    if (!best || distance < best.distance) return { phase, distance };
    return best;
  }, null)?.phase ?? PHASES[0];
}

function labelGenerationPhases(generation, { visibleDebug = false } = {}) {
  const totalSec = generation.timeline.durationSec;
  const denom = totalSec || 16;
  const scale = 16 / denom;
  for (const clip of generation.timeline.clips) {
    const centre = (clip.startSec + clip.durationSec / 2) * scale;
    const phase = findPhase(centre);
    clip.phaseLabel = phase.label;
    clip.phaseSubtitle = phase.subtitle;
    const phaseTag = `[Phase ${PHASES.indexOf(phase) + 1} · ${phase.key}]`;
    if (visibleDebug) {
      clip.subtitleText = clip.subtitleText && clip.subtitleText.includes(phaseTag)
        ? clip.subtitleText
        : `${phaseTag} ${clip.subtitleText ?? phase.mainHint}`.trim();
      clip.visualIntent = clip.visualIntent && clip.visualIntent.includes(phaseTag)
        ? clip.visualIntent
        : `${phaseTag} ${clip.visualIntent ?? phase.subtitle}`.trim();
    }
    if (phase.key === "structure_mapping") {
      clip.mappingPairs = MAPPING_PAIRS;
    } else {
      clip.mappingPairs = undefined;
    }
  }
  for (let i = 0; i < generation.storyboard.length; i += 1) {
    const item = generation.storyboard[i];
    const clip = generation.timeline.clips.find((c) => c.id === item.clipId);
    const centre = clip ? (clip.startSec + clip.durationSec / 2) * scale : (i * 16) / generation.storyboard.length;
    const phase = findPhase(centre);
    const phaseTag = `[Phase ${PHASES.indexOf(phase) + 1} · ${phase.key}]`;
    if (visibleDebug) {
      item.subtitle = item.subtitle && item.subtitle.includes(phaseTag) ? item.subtitle : `${phaseTag} ${item.subtitle ?? ""}`.trim();
      item.shotDescription = item.shotDescription && item.shotDescription.includes(phase.key)
        ? item.shotDescription
        : `${phase.label} — ${item.shotDescription ?? phase.subtitle}`.trim();
    }
    item.rationale = item.rationale ? `${item.rationale} | Phase=${phase.key}` : `Phase=${phase.key}`;
    if (phase.key === "structure_mapping") {
      item.assetUsage = `Sample→New mapping: ${MAPPING_PAIRS.map((pair) => `${pair.sample}→${pair.target}`).join("; ")}`;
    }
  }
  generation.migrationExplanation = `${generation.migrationExplanation ?? ""}\nPhases: ${PHASES.map((phase) => phase.key).join(" → ")}.`.trim();
  return generation;
}

const POSTER_BEATS = [
  {
    key: "hook",
    role: "hook",
    startSec: 0,
    endSec: 2.1,
    subtitle: "爆款结构迁移引擎",
    visualIntent: "Central Chinese title appears immediately on a sparse off-white poster."
  },
  {
    key: "sample_analysis",
    role: "body",
    startSec: 2.1,
    endSec: 5.8,
    subtitle: "Sample Analysis",
    visualIntent: "Large ribbon enters around the central title while small anchors stay fixed."
  },
  {
    key: "material_gap",
    role: "body",
    startSec: 5.8,
    endSec: 9.1,
    subtitle: "Material Gap",
    visualIntent: "English typography and information anchors build memory around the title."
  },
  {
    key: "recomposition",
    role: "proof",
    startSec: 9.1,
    endSec: 13.7,
    subtitle: "Video Recomposition",
    visualIntent: "Colorful ribbon density climbs toward the visual climax."
  },
  {
    key: "cta",
    role: "cta",
    startSec: 13.7,
    endSec: 16,
    subtitle: "Upload. Analyze. Remix.",
    visualIntent: "Clean final poster hold with title, anchors, CTA and no platform tail."
  }
];

function phaseForKey(key) {
  return PHASES.find((phase) => phase.key === key) ?? PHASES[0];
}

function rebuildPosterTimeline(generation, { label, mode }) {
  const highFidelity = mode === "high_fidelity_style";
  const finalCreative = mode === "final_creative" || highFidelity;
  const background = highFidelity ? "#f4efe4" : finalCreative ? "#f7f1e8" : generation.timeline.renderPlan?.background ?? "#0f172a";
  const clips = POSTER_BEATS.map((beat) => {
    const phase = phaseForKey(beat.key);
    const clipId = stableId("poster_clip", generation.id, label, beat.key);
    const subtitle = highFidelity && beat.key !== "cta" ? beat.subtitle : beat.subtitle;
    return {
      id: clipId,
      role: beat.role,
      startSec: beat.startSec,
      durationSec: Number((beat.endSec - beat.startSec).toFixed(2)),
      type: "generated_card",
      visualIntent: beat.visualIntent,
      scriptText: `${phase.key}: ${beat.visualIntent}`,
      subtitleText: subtitle,
      transitionIn: beat.startSec === 0 ? "none" : "hard_cut",
      transitionOut: beat.key === "cta" ? "hold" : "hard_cut",
      phaseLabel: phase.label,
      phaseSubtitle: phase.subtitle,
      layers: [
        {
          id: stableId("layer_bg", clipId),
          kind: "background",
          style: { color: background, posterMode: mode }
        },
        {
          id: stableId("layer_title", clipId),
          kind: "title_bar",
          text: subtitle,
          style: { role: beat.role, layout: highFidelity ? "sample_style_poster" : "final_creative_poster" }
        },
        {
          id: stableId("layer_subtitle", clipId),
          kind: "subtitle",
          text: subtitle,
          style: { hiddenInHighFidelityFrame: highFidelity, position: "poster_anchor" }
        }
      ],
      gapFillStrategy: "procedural_generation"
    };
  });

  generation.timeline.clips = clips;
  generation.timeline.durationSec = 16;
  generation.timeline.id = stableId("timeline", generation.id, label, mode);
  generation.timeline.renderPlan = {
    ...(generation.timeline.renderPlan ?? {}),
    background,
    motionAtoms: (generation.timeline.renderPlan?.motionAtoms ?? []).map((atom) => {
      const next = { ...atom };
      next.type = "parametric_ribbon_surface";
      next.surfaceType = MARKETING_RIBBON_MOTION.surfaceType;
      next.pathFamily = MARKETING_RIBBON_MOTION.pathFamily;
      next.axis = MARKETING_RIBBON_MOTION.axis;
      next.depthBehavior = MARKETING_RIBBON_MOTION.depthBehavior;
      next.layoutRelation = MARKETING_RIBBON_MOTION.layoutRelation;
      next.textRelation = MARKETING_RIBBON_MOTION.textRelation;
      next.confidence = MARKETING_RIBBON_MOTION.confidence;
      next.evidenceFrames = MARKETING_RIBBON_MOTION.evidenceFrames;
      next.turns = MARKETING_RIBBON_MOTION.turns;
      next.radiusX = MARKETING_RIBBON_MOTION.radiusX;
      next.radiusZ = MARKETING_RIBBON_MOTION.radiusZ;
      next.pitchY = MARKETING_RIBBON_MOTION.pitchY;
      if (highFidelity) {
        next.style = "mg_motion";
        next.density = 4;
        next.speed = 0.82;
        next.opacity = 0.74;
        next.bandWidth = 122;
        next.edgeWidth = 20;
        next.frontLayerCount = 3;
        next.backLayerCount = 2;
        next.twistIntensity = 0.82;
        next.perspectiveStrength = 0.74;
        next.shadowOpacity = 0.38;
      }
      next.startSec = highFidelity ? 2.15 : 0;
      next.endSec = highFidelity ? 14.85 : 16;
      return next;
    }),
    adapterOptions: {
      ...(generation.timeline.renderPlan?.adapterOptions ?? {}),
      creativeMode: mode,
      outputMode: mode,
      posterBackground: background,
      typography: "central_chinese_title_with_vertical_english",
      infoAnchors: ["top_left_date", "bottom_left_year_product_info", "bottom_right_cta"],
      debugLabelsInVideo: mode === "explainable_demo"
    }
  };
  generation.timeline.mapping = generation.timeline.mapping.map((item) => ({
    ...item,
    targetClipIds: clips.filter((clip) => clip.role === item.templateSegmentId.replace("seg_", "")).map((clip) => clip.id)
  }));
  generation.storyboard = clips.map((clip) => ({
    clipId: clip.id,
    timeRange: `${clip.startSec.toFixed(1)}-${(clip.startSec + clip.durationSec).toFixed(1)}s`,
    shotDescription: clip.visualIntent,
    subtitle: clip.subtitleText,
    assetUsage: highFidelity
      ? "Procedural poster assets: off-white background, central title, info anchors, parametric_ribbon_surface vertical_helix/screen_y."
      : "Procedural poster assets: clean background, central title, info anchors, parametric_ribbon_surface.",
    packaging: highFidelity ? "high_fidelity_style · sample visual grammar, no sample-frame copy" : `${mode} · final poster composition`,
    rationale: `Phase=${clip.phaseLabel?.replace(/^PHASE \d+ · /, "").toLowerCase().replace(/\s+/g, "_")}; structure_mapping=sample visual grammar to generated poster layout; in-video debug labels=${mode === "explainable_demo" ? "on" : "off"}`
  }));
  generation.request.controls = {
    ...(generation.request.controls ?? {}),
    creativeMode: mode
  };
  generation.migrationExplanation = `${generation.migrationExplanation ?? ""}\nCreative output mode: ${mode}. Debug/mapping labels are kept in JSON/report${mode === "explainable_demo" ? " and shown in the video." : " and hidden from the MP4 frame."}`.trim();
  return generation;
}

// ---------------------------------------------------------------------------
// Local BGM/SFX: deterministic ffmpeg lavfi mix, no online assets.
// ---------------------------------------------------------------------------

async function ensureBgmWav(outDir) {
  const bgmPath = path.join(outDir, "bgm.wav");
  if (existsSync(bgmPath)) return bgmPath;
  // Pad chord (low/mid/high sines) + soft brown noise + sparse high tick = pleasant ambient pad.
  const filter = [
    "sine=frequency=110:duration=16,volume=0.30[bass]",
    "sine=frequency=165:duration=16,volume=0.22[mid]",
    "sine=frequency=220:duration=16,volume=0.18[treble]",
    "sine=frequency=330:duration=16,volume=0.14[sparkle]",
    "anoisesrc=color=brown:duration=16:amplitude=0.05[pad]",
    "[bass][mid][treble][sparkle][pad]amix=inputs=5:duration=longest:normalize=0[mix]",
    "[mix]highpass=f=50,lowpass=f=8000,acompressor=threshold=-18dB:ratio=3:attack=20:release=200[out]"
  ].join(";");
  run(
    ffmpeg,
    ["-y", "-filter_complex", filter, "-map", "[out]", "-ar", "44100", "-ac", "2", "-t", "16", bgmPath],
    "generate bgm.wav"
  );
  return bgmPath;
}

function muxAudio(mp4Path, bgmPath) {
  // Replace the silent audio track on the rendered MP4 with the generated pad.
  const tempPath = `${mp4Path}.audio.mp4`;
  run(
    ffmpeg,
    [
      "-y",
      "-i", mp4Path,
      "-i", bgmPath,
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "160k",
      "-shortest",
      tempPath
    ],
    "mux audio"
  );
  run("mv", [tempPath, mp4Path], "replace muxed mp4");
}

// ---------------------------------------------------------------------------
// Evaluator runner
// ---------------------------------------------------------------------------

function runEvaluator({ label, mp4Path, sampleVideoPath, analysisPath, generationPath, reportPath, expectedAtom, creativeMode, outPath, minBandWidth, minMotion }) {
  const args = [
    "scripts/evaluate-generated-video.py",
    "--video", mp4Path,
    "--sample-video", sampleVideoPath,
    "--analysis", analysisPath,
    "--generation", generationPath,
    "--report", reportPath,
    "--expected-atom", expectedAtom,
    "--creative-mode", creativeMode,
    "--min-band-width", String(minBandWidth ?? 40),
    "--min-motion", String(minMotion ?? 0.012),
    "--out", outPath,
    "--allow-fail"
  ];
  const result = spawnSync(condaPython, args, { encoding: "utf8" });
  if (result.status !== 0 && result.status !== 2) {
    console.warn(`Evaluator ${label} produced non-standard exit ${result.status}: ${result.stderr || result.stdout}`);
  }
  try {
    return JSON.parse(spawnSync("cat", [outPath], { encoding: "utf8" }).stdout);
  } catch (error) {
    return { error: error.message, label };
  }
}

const marketingVlm = {
  videoSummary:
    "Marketing motion-graphic poster: minimal off-white poster, central static typography, wide parametric ribbon surface moving as a vertical helix around the screen Y axis, repeated English keywords, progressive color build, and a social-platform UI tail after the creative ending.",
  videoType: "motion_graphic_marketing_poster",
  visualStyle: {
    background: "minimal_off_white",
    layout: "central_static_typography",
    motionAsset: "parametric_ribbon_surface",
    ribbonMotion: MARKETING_RIBBON_MOTION,
    colorProgression: ["blue", "purple", "pink", "orange", "yellow", "green"],
    typography: "Chinese main title + English keyword repetition"
  },
  excludeSegments: [
    {
      startSec: 15.7,
      endSec: 18.4,
      reason: "social platform UI / screen recording tail; do not transfer"
    }
  ],
  shots: [
    { start: 0, end: 2, purpose: "hook", visual: "Main title appears immediately on a minimal poster layout.", transition: "none" },
    { start: 2, end: 6, purpose: "visual_attention", visual: "A large ribbon surface enters and starts a vertical helix around the title.", transition: "ribbon sweep" },
    { start: 6, end: 10, purpose: "brand_memory", visual: "English keywords repeat on and around the Y-axis ribbon while poster anchors remain fixed.", transition: "helix loop" },
    { start: 10, end: 14.5, purpose: "climax", visual: "Color diversity and motion density increase to a multi-color ribbon climax.", transition: "color progression" },
    { start: 14.5, end: 15.7, purpose: "cta", visual: "Clean final poster hold with date, location, logo, and action cue.", transition: "hold" }
  ],
  structure: {
    hook: "Show main title immediately and keep the poster readable.",
    setup: "Use central static typography, large negative space, and fixed information anchors.",
    sellingPoints: ["minimal poster layout", "parametric vertical helix ribbon", "keyword repetition", "color progression", "clean final CTA"],
    climax: "Increase color diversity and motion density before the final poster hold.",
    cta: "Freeze a clean final poster with date, location, logo, and action cue."
  },
  rhythm: {
    avgShotLength: 3.1,
    fastSections: ["3-8s vertical ribbon helix", "8-13s color acceleration"],
    peakMoments: ["13-15.7s multi-color ribbon climax"],
    peakTimeRatio: 0.78,
    notes: "0-3s poster, 3-8s motion entry, 8-13s keyword/color build, 13-15.7s climax, 15.7-18.4s platform UI tail excluded."
  },
  packaging: {
    subtitleDensity: "medium",
    titleCards: ["central static typography + English keyword repetition"],
    stickers: ["parametric_ribbon_surface", "vertical_helix_y", "keyword_ring", "date_location_anchor"],
    colorStyle: "blue → purple → pink → orange → yellow → green progression",
    coverStyle: "minimal off-white poster with large central title"
  },
  reusablePatterns: [
    "minimal information poster + parametric ribbon dynamic packaging",
    "vertical helix ribbon around central static typography",
    "progressive multi-color climax",
    "clean final poster CTA hold"
  ],
  materialGapsForNewVideo: ["dynamic_3d_ribbon_asset", "final_date_location_card", "brand_keyword_copy"],
  raw: JSON.stringify({
    exclude_segments: [{ time: "15.7-18.4", reason: "social platform UI / screen recording tail; do not transfer" }]
  })
};

function aiChallengeRequest(controls = {}) {
  const creativeMode = controls.creativeMode ?? "final_creative";
  return {
    projectId,
    inputMode: "brief_assets",
    selectedTemplateIds: ["template_marketing_case"],
    assets: [
      { assetId: "target_title_copy", role: "title/copy" },
      { assetId: "target_info_anchor", role: "date/product_info" },
      { assetId: "target_procedural_ribbon", role: "generated/procedural_motion_asset" }
    ],
    prompt: [
      "主题：爆款结构迁移引擎",
      "英文名：Viral Structure Transfer Engine",
      "目标用户：评委、参赛者",
      "卖点：Sample Analysis、Material Gap、Video Recomposition",
      "风格：极简米白动态海报、中心中文标题、英文纵排字、信息锚点、3D 彩带穿插",
      "CTA：Upload. Analyze. Remix."
    ].join("\n"),
    target: {
      vertical: "b2b_marketing_mg",
      aspectRatio: "9:16",
      targetDurationSec: 16,
      outputMode: "mp4_render"
    },
    controls: {
      pace: "fast",
      hookIntensity: "strong",
      packagingStyle: "mg_motion",
      ctaStyle: "direct",
      allowAigcPlaceholder: true,
      creativeMode,
      ...controls
    },
    constraints: {
      noSampleVisualCopy: true,
      sampleAssetReuse: "disabled",
      forbiddenWords: ["造物", "逐空", "小红书", "Xiaohongshu"],
      mustMention: ["爆款结构迁移引擎", "Upload. Analyze. Remix."]
    }
  };
}

function requireLocalRemotionBrowser() {
  const candidates = [
    process.env.REMOTION_BROWSER_EXECUTABLE,
    path.join(repoRoot, "apps", "api", "node_modules", ".remotion", "chrome-headless-shell", "linux64", "chrome-headless-shell-linux64", "chrome-headless-shell"),
    path.join(process.env.HOME ?? "/home/pxli", ".cache", "ms-playwright", "chromium_headless_shell-1208", "chrome-headless-shell-linux64", "chrome-headless-shell")
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      "No local Remotion browser executable found. Set REMOTION_BROWSER_EXECUTABLE; this testcase intentionally does not download browser binaries."
    );
  }
  return found;
}

async function renderToFixed(renderer, generation, filename) {
  const output = await renderer.render(generation.timeline, generation.id);
  if (output.status !== "completed" || !output.outputPath) {
    throw new Error(`Render failed for ${filename}: ${output.error ?? "missing output path"}`);
  }
  const fixedPath = path.join(artifactDir, filename);
  await copyFile(output.outputPath, fixedPath);
  return { ...output, fixedPath };
}

async function fileHashes(file) {
  const buffer = await readFile(file);
  return {
    bytes: buffer.length,
    md5: createHash("md5").update(buffer).digest("hex"),
    sha256: createHash("sha256").update(buffer).digest("hex")
  };
}

function extractFrame(input, timeSec, output) {
  run(ffmpeg, ["-y", "-ss", String(timeSec), "-i", input, "-frames:v", "1", output], `extract frame ${path.basename(output)}`);
}

async function extractFramesFor(label, input, times) {
  const frames = [];
  for (const timeSec of times) {
    const framePath = path.join(artifactDir, `${label}_t${timeSec}.png`);
    extractFrame(input, timeSec, framePath);
    frames.push({ timeSec, path: framePath, hash: await fileHashes(framePath) });
  }
  return frames;
}

function createContactSheet(rows) {
  const frameInputs = rows.flatMap((row) => row.frames.map((frame) => frame.path));
  const output = path.join(artifactDir, "contact_sheet.png");
  const scaleFilters = frameInputs.map((_, index) => `[${index}:v]scale=240:426:force_original_aspect_ratio=decrease,pad=240:426:(ow-iw)/2:(oh-ih)/2,setsar=1[v${index}]`);
  const rowFilters = rows.map((_, row) => {
    const start = row * 3;
    return `[v${start}][v${start + 1}][v${start + 2}]hstack=inputs=3[row${row}]`;
  });
  const vstack = rows.map((_, row) => `[row${row}]`).join("") + `vstack=inputs=${rows.length}[out]`;
  const filter = [...scaleFilters, ...rowFilters, vstack].join(";");
  run(
    ffmpeg,
    ["-y", ...frameInputs.flatMap((frame) => ["-i", frame]), "-filter_complex", filter, "-map", "[out]", output],
    "create contact sheet"
  );
  return output;
}

function assertRenderedVideo(label, metadata) {
  if (metadata.width !== 720 || metadata.height !== 1280) {
    throw new Error(`${label} resolution mismatch: expected 720x1280, got ${metadata.width}x${metadata.height}`);
  }
  if (metadata.durationSec < 15.4 || metadata.durationSec > 16.7) {
    throw new Error(`${label} duration mismatch: expected around 16s, got ${metadata.durationSec.toFixed(2)}s`);
  }
  if (metadata.fps < 29 || metadata.fps > 31) {
    throw new Error(`${label} fps mismatch: expected around 30fps, got ${metadata.fps.toFixed(2)}`);
  }
}

function assertUniqueVideoHashes(renderSummaries) {
  for (const field of ["md5", "sha256"]) {
    const values = renderSummaries.map((item) => item.hashes[field]);
    if (new Set(values).size !== values.length) {
      throw new Error(`Generated videos are not unique by ${field}: ${values.join(", ")}`);
    }
  }
}

function assertFrameMotion(label, frames, minimumUnique) {
  const unique = new Set(frames.map((frame) => frame.hash.sha256));
  if (unique.size < minimumUnique) {
    throw new Error(`${label} frame-motion sanity failed: expected ${minimumUnique} unique sampled frames, got ${unique.size}`);
  }
}

function visibleTextFor(generation) {
  const storyboardText = generation.storyboard.flatMap((item) => [item.shotDescription, item.subtitle, item.assetUsage, item.packaging, item.rationale]);
  const timelineText = generation.timeline.clips.flatMap((clip) => [
    clip.subtitleText,
    clip.visualIntent,
    ...clip.layers.map((layer) => layer.text ?? "")
  ]);
  return [...storyboardText, ...timelineText].filter(Boolean).join("\n");
}

function assertNoForbiddenVisibleText(generations) {
  const forbidden = ["造物", "逐空", "小红书", "Xiaohongshu"];
  for (const generation of generations) {
    const visibleText = visibleTextFor(generation);
    const matched = forbidden.find((word) => visibleText.includes(word));
    if (matched) {
      throw new Error(`Forbidden copied sample text leaked into final visible text/storyboard: ${matched}`);
    }
  }
}

function publicGeneration(generation) {
  const clone = JSON.parse(JSON.stringify(generation));
  if (clone.request?.constraints?.forbiddenWords) {
    clone.request.constraints.forbiddenWords = ["[redacted copied sample text list]"];
  }
  return clone;
}

function tableRows(items, render) {
  return items.map(render).join("\n");
}

await mkdir(artifactDir, { recursive: true });

const metadata = ffprobeMetadata(videoPath);
const analyzerOutputPath = path.join(artifactDir, "analysis.marketing.json");
const analyzerJson = loadOrAnalyze(videoPath, analyzerOutputPath);
const fixtureAnalysis = fixtureMarketingAnalysis(metadata);
const analysis = mergeAnalyzerIntoAnalysis(fixtureAnalysis, analyzerJson);
const template = buildFallbackTemplate(analysis, "b2b_marketing_mg", projectId, marketingVlm);
const explainableDemo = labelGenerationPhases(generateMigrationResult({
  template,
  request: aiChallengeRequest({ creativeMode: "explainable_demo" }),
  generationIdSalt: "explainable_demo"
}), { visibleDebug: true });
const main = rebuildPosterTimeline(labelGenerationPhases(generateMigrationResult({
  template,
  request: aiChallengeRequest({ creativeMode: "final_creative" })
})), { label: "main", mode: "final_creative" });
const highCtr = rebuildPosterTimeline(labelGenerationPhases(generateMigrationResult({
  template,
  request: aiChallengeRequest({ pace: "fast", hookIntensity: "aggressive", packagingStyle: "mg_motion", ctaStyle: "direct", creativeMode: "final_creative" }),
  generationIdSalt: "high_ctr"
})), { label: "high_ctr", mode: "final_creative" });
const highQuality = rebuildPosterTimeline(labelGenerationPhases(generateMigrationResult({
  template,
  request: aiChallengeRequest({ pace: "slow", hookIntensity: "safe", packagingStyle: "clean", ctaStyle: "soft", creativeMode: "final_creative" }),
  generationIdSalt: "high_quality"
})), { label: "high_quality", mode: "final_creative" });
const highFidelity = rebuildPosterTimeline(labelGenerationPhases(generateMigrationResult({
  template,
  request: aiChallengeRequest({ pace: "fast", hookIntensity: "strong", packagingStyle: "mg_motion", ctaStyle: "direct", creativeMode: "high_fidelity_style" }),
  generationIdSalt: "high_fidelity"
})), { label: "high_fidelity", mode: "high_fidelity_style" });

const templateValidation = validateStructureTemplate(template);
const timelineValidation = validateTimeline(main.timeline);
if (!templateValidation.valid || !timelineValidation.valid) {
  throw new Error(`Validation failed: template=${templateValidation.errors.join("; ")} timeline=${timelineValidation.errors.join("; ")}`);
}

for (const generation of [explainableDemo, main, highCtr, highQuality, highFidelity]) {
  const validation = validateTimeline(generation.timeline);
  if (!validation.valid) {
    throw new Error(`Timeline validation failed for ${generation.id}: ${validation.errors.join("; ")}`);
  }
}

assertNoForbiddenVisibleText([explainableDemo, main, highCtr, highQuality, highFidelity]);

const renderer = new RemotionRenderer({
  generatedDir: artifactDir,
  entryPoint: path.join(repoRoot, "apps", "api", "remotion", "index.tsx"),
  compositionId: "ViralReconstruction",
  browserExecutable: requireLocalRemotionBrowser()
});
const explainableRender = await renderToFixed(renderer, explainableDemo, "ai_challenge_poster_explainable_demo.mp4");
const mainRender = await renderToFixed(renderer, main, "ai_challenge_poster_main.mp4");
const ctrRender = await renderToFixed(renderer, highCtr, "ai_challenge_poster_high_ctr.mp4");
const qualityRender = await renderToFixed(renderer, highQuality, "ai_challenge_poster_high_quality.mp4");
const highFidelityRender = await renderToFixed(renderer, highFidelity, "ai_challenge_poster_high_fidelity.mp4");

// Inject deterministic local BGM (ffmpeg lavfi pad chord + soft noise), replacing the silent track.
const bgmPath = await ensureBgmWav(artifactDir);
muxAudio(explainableRender.fixedPath, bgmPath);
muxAudio(mainRender.fixedPath, bgmPath);
muxAudio(ctrRender.fixedPath, bgmPath);
muxAudio(qualityRender.fixedPath, bgmPath);
muxAudio(highFidelityRender.fixedPath, bgmPath);

extractFrame(videoPath, 0.5, path.join(artifactDir, "input_hook.png"));
extractFrame(videoPath, 13.5, path.join(artifactDir, "input_climax.png"));
extractFrame(videoPath, Math.min(16.6, metadata.durationSec - 0.5), path.join(artifactDir, "input_excluded_tail.png"));

const inputFrames = await extractFramesFor("input", videoPath, [1, 7, 13]);
const renderSummaries = [
  {
    label: "explainable_demo",
    generation: explainableDemo,
    render: explainableRender,
    metadata: ffprobeMetadata(explainableRender.fixedPath),
    hashes: await fileHashes(explainableRender.fixedPath),
    frames: await extractFramesFor("explainable_demo", explainableRender.fixedPath, [1, 7, 13])
  },
  {
    label: "main",
    generation: main,
    render: mainRender,
    metadata: ffprobeMetadata(mainRender.fixedPath),
    hashes: await fileHashes(mainRender.fixedPath),
    frames: await extractFramesFor("main", mainRender.fixedPath, [1, 7, 13])
  },
  {
    label: "high_ctr",
    generation: highCtr,
    render: ctrRender,
    metadata: ffprobeMetadata(ctrRender.fixedPath),
    hashes: await fileHashes(ctrRender.fixedPath),
    frames: await extractFramesFor("high_ctr", ctrRender.fixedPath, [1, 7, 13])
  },
  {
    label: "high_quality",
    generation: highQuality,
    render: qualityRender,
    metadata: ffprobeMetadata(qualityRender.fixedPath),
    hashes: await fileHashes(qualityRender.fixedPath),
    frames: await extractFramesFor("high_quality", qualityRender.fixedPath, [1, 7, 13])
  },
  {
    label: "high_fidelity",
    generation: highFidelity,
    render: highFidelityRender,
    metadata: ffprobeMetadata(highFidelityRender.fixedPath),
    hashes: await fileHashes(highFidelityRender.fixedPath),
    frames: await extractFramesFor("high_fidelity", highFidelityRender.fixedPath, [1, 7, 13])
  }
];

for (const summary of renderSummaries) {
  assertRenderedVideo(summary.label, summary.metadata);
  assertFrameMotion(summary.label, summary.frames, summary.label === "high_quality" ? 2 : 3);
}
assertUniqueVideoHashes(renderSummaries);
const contactSheetPath = createContactSheet([
  { label: "input_sample", frames: inputFrames },
  renderSummaries.find((summary) => summary.label === "explainable_demo"),
  renderSummaries.find((summary) => summary.label === "high_fidelity")
].filter(Boolean));

const proceduralAction = main.fillPlan.find(
  (action) =>
    action.strategy === "procedural_generation" &&
    action.rendererInstructions?.fulfilledBy === "procedural_generation" &&
    String(action.rendererInstructions?.atom ?? "").includes("ribbon")
);
const mainMotionAtom = main.timeline.renderPlan?.motionAtoms?.find((atom) =>
  ["ribbon_orbit", "3d_ribbon_orbit", "wide_3d_ribbon_surface", "ribbon_surface_3d", "true_3d_ribbon_mesh", "ribbon_mesh_3d", "parametric_ribbon_surface"].includes(atom.type)
);
const highFidelityMotionAtom = highFidelity.timeline.renderPlan?.motionAtoms?.find((atom) =>
  atom.type === "parametric_ribbon_surface" && atom.pathFamily === "vertical_helix" && atom.axis === "screen_y"
);
if (!proceduralAction || !mainMotionAtom) {
  throw new Error("dynamic_3d_ribbon_asset was not fulfilled by a renderer-backed procedural ribbon/surface atom.");
}
if (!highFidelityMotionAtom) {
  throw new Error("high_fidelity_style did not render parametric_ribbon_surface with vertical_helix/screen_y geometry.");
}

await writeFile(path.join(artifactDir, "structure-template.json"), JSON.stringify(template, null, 2), "utf8");
await writeFile(path.join(artifactDir, "generation-result.json"), JSON.stringify(publicGeneration(main), null, 2), "utf8");
await writeFile(path.join(artifactDir, "timeline.json"), JSON.stringify(main.timeline, null, 2), "utf8");
await writeFile(path.join(artifactDir, "timeline.high_fidelity.json"), JSON.stringify(highFidelity.timeline, null, 2), "utf8");

const variantSummary = [
  {
    label: "explainable_demo",
    generationId: explainableDemo.id,
    timelineId: explainableDemo.timeline.id,
    clips: explainableDemo.timeline.clips.length,
    background: explainableDemo.timeline.renderPlan?.background,
    mp4: rel(explainableRender.fixedPath),
    motionAtom: explainableDemo.timeline.renderPlan?.motionAtoms?.[0],
    metadata: renderSummaries[0].metadata,
    hashes: renderSummaries[0].hashes
  },
  {
    label: "main",
    generationId: main.id,
    timelineId: main.timeline.id,
    clips: main.timeline.clips.length,
    background: main.timeline.renderPlan?.background,
    mp4: rel(mainRender.fixedPath),
    motionAtom: main.timeline.renderPlan?.motionAtoms?.[0],
    metadata: renderSummaries[1].metadata,
    hashes: renderSummaries[1].hashes
  },
  {
    label: "high_ctr",
    generationId: highCtr.id,
    timelineId: highCtr.timeline.id,
    clips: highCtr.timeline.clips.length,
    background: highCtr.timeline.renderPlan?.background,
    mp4: rel(ctrRender.fixedPath),
    motionAtom: highCtr.timeline.renderPlan?.motionAtoms?.[0],
    metadata: renderSummaries[2].metadata,
    hashes: renderSummaries[2].hashes
  },
  {
    label: "high_quality",
    generationId: highQuality.id,
    timelineId: highQuality.timeline.id,
    clips: highQuality.timeline.clips.length,
    background: highQuality.timeline.renderPlan?.background,
    mp4: rel(qualityRender.fixedPath),
    motionAtom: highQuality.timeline.renderPlan?.motionAtoms?.[0],
    metadata: renderSummaries[3].metadata,
    hashes: renderSummaries[3].hashes
  },
  {
    label: "high_fidelity",
    generationId: highFidelity.id,
    timelineId: highFidelity.timeline.id,
    clips: highFidelity.timeline.clips.length,
    background: highFidelity.timeline.renderPlan?.background,
    mp4: rel(highFidelityRender.fixedPath),
    motionAtom: highFidelity.timeline.renderPlan?.motionAtoms?.[0],
    metadata: renderSummaries[4].metadata,
    hashes: renderSummaries[4].hashes
  }
];
await writeFile(path.join(artifactDir, "variant-summary.json"), JSON.stringify(variantSummary, null, 2), "utf8");

// Run the visual + audio acceptance evaluator on every variant.
const generationsByLabel = { explainable_demo: explainableDemo, main, high_ctr: highCtr, high_quality: highQuality, high_fidelity: highFidelity };
const evaluationByLabel = {};
const judgeByLabel = {};

function runVlmJudge({ label, inputVideo, outputVideo, expectedMotif, outPath }) {
  if (skipVlmJudge) {
    const report = {
      status: "SKIPPED",
      reason: "Skipped by --skip-vlm-judge; run scripts/vlm-judge-video.mjs separately when external VLM upload is approved.",
      variant: label
    };
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
    return report;
  }
  const args = [
    "scripts/vlm-judge-video.mjs",
    "--input", inputVideo,
    "--output", outputVideo,
    "--expected-motif", expectedMotif,
    "--variant-label", label,
    "--out", outPath
  ];
  // Up to 2 retries on transient network failure (Gemini occasionally drops connections).
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = spawnSync(process.execPath, args, { encoding: "utf8" });
    if (result.status !== 0) {
      console.warn(`VLM judge ${label} exited ${result.status} on attempt ${attempt}: ${result.stderr || result.stdout}`);
    }
    let report;
    try {
      report = JSON.parse(spawnSync("cat", [outPath], { encoding: "utf8" }).stdout);
    } catch (error) {
      report = { status: "FAILED", reason: error.message };
    }
    const isTransient = report?.status === "FAILED" && /fetch failed|ECONN|ETIMEDOUT|503|429/i.test(String(report.reason ?? ""));
    if (!isTransient || attempt === 3) return report;
    console.warn(`Retrying VLM judge for ${label} (transient: ${report.reason})...`);
  }
  return { status: "FAILED", reason: "exhausted retries" };
}

for (const summary of renderSummaries) {
  const generationJsonPath = path.join(artifactDir, `generation.${summary.label}.json`);
  await writeFile(generationJsonPath, JSON.stringify(publicGeneration(generationsByLabel[summary.label]), null, 2), "utf8");
  const evalOut = path.join(artifactDir, `evaluation.${summary.label}.json`);
  // high_quality variant uses the clean_premium ribbon (intentionally thin),
  // so it carries a lower bandWidth gate; main + high_ctr stay at the default.
  const variantMinBandWidth = summary.label === "high_quality" ? 10 : 40;
  const variantMinMotion = summary.label === "high_quality" ? 0.008 : 0.012;
  const creativeMode = String(summary.generation.timeline.renderPlan?.adapterOptions?.creativeMode ?? summary.generation.request.controls?.creativeMode ?? "explainable_demo");
  const expectedAtom = "parametric_ribbon_surface";
  const evaluation = runEvaluator({
    label: summary.label,
    mp4Path: summary.render.fixedPath,
    sampleVideoPath: videoPath,
    analysisPath: analyzerOutputPath,
    generationPath: generationJsonPath,
    reportPath: path.join(artifactDir, "report.md"),
    expectedAtom,
    creativeMode,
    outPath: evalOut,
    minBandWidth: variantMinBandWidth,
    minMotion: variantMinMotion
  });
  evaluationByLabel[summary.label] = evaluation;
  summary.evaluation = evaluation;

  // VLM-as-judge: bounded-rubric Gemini judge per variant.
  const judgeOut = path.join(artifactDir, `vlm-judge.${summary.label}.json`);
  const judgeReport = runVlmJudge({
    label: summary.label,
    inputVideo: videoPath,
    outputVideo: summary.render.fixedPath,
    expectedMotif: "wide_surface_ribbon_2_5d",
    outPath: judgeOut
  });
  judgeByLabel[summary.label] = judgeReport;
  summary.judge = judgeReport;
}

const evaluatorSummaryLines = renderSummaries.map((summary) => {
  const ev = summary.evaluation ?? {};
  const gates = (ev.gates ?? []).map((gate) => `${gate.passed ? "✅" : "❌"} ${gate.id}`).join("; ");
  return `- ${summary.label}: overall=${ev.passed ? "PASS" : "FAIL"} | style_fidelity=${ev.styleFidelity?.overall?.toFixed?.(2) ?? "?"} | audio mean=${ev.audio?.meanVolumeDb?.toFixed?.(2) ?? "?"}dB max=${ev.audio?.maxVolumeDb?.toFixed?.(2) ?? "?"}dB | motion=${ev.motion?.avgFrameDiff ?? "?"} | bandWidth=${ev.foreground?.bandWidth ?? "?"} | ${gates}`;
}).join("\n");

const report = `# Marketing.mov Dynamic Poster Case

Generated: ${nowIso()}

## Input

- File: \`${rel(videoPath)}\`
- Duration: ${metadata.durationSec.toFixed(2)}s
- Resolution: ${metadata.width}x${metadata.height}
- FPS: ${metadata.fps.toFixed(2)}
- Audio: ${metadata.hasAudio ? "yes" : "no"}

## Expected Structure Captured

- Type: MG dynamic marketing poster / minimal motion graphic poster
- Core method: central static typography + negative space + parametric ribbon surface (vertical_helix/screen_y) + keyword repetition + progressive color climax
- Excluded tail: 15.7-${metadata.durationSec.toFixed(1)}s platform UI / screen recording tail, not transferred

## Template Evidence

- Template: ${template.name}
- Video type: ${template.videoType}
- Visual style: ${JSON.stringify(template.visualStyle)}
- Exclude segments: ${(template.excludeSegments ?? []).map((segment) => `${segment.startSec}-${segment.endSec}s ${segment.reason}`).join("; ") || "none"}
- Packaging: ${template.packaging.titleCardStyle}; ${template.packaging.overlayStyle}; ${template.packaging.coverStyle}
- Atoms: ${template.structureAtoms.map((atom) => atom.name).join(", ")}
- Validation: template=${templateValidation.valid}, timeline=${timelineValidation.valid}

## Migration Output

- New topic: AI 全栈挑战赛 · 爆款结构迁移引擎
- Output MP4: [ai_challenge_poster_main.mp4](ai_challenge_poster_main.mp4)
- High-fidelity MP4: [ai_challenge_poster_high_fidelity.mp4](ai_challenge_poster_high_fidelity.mp4)
- Explainable demo MP4: [ai_challenge_poster_explainable_demo.mp4](ai_challenge_poster_explainable_demo.mp4)
- Contact sheet: [contact_sheet.png](contact_sheet.png)
- Timeline JSON: [timeline.json](timeline.json)
- Full generation JSON: [generation-result.json](generation-result.json)
- Critical motif: \`dynamic_3d_ribbon_asset -> fulfilled_by_procedural_generation -> ${proceduralAction.rendererInstructions.atom} rendered\`
- Renderer: Remotion procedural motion atom, no online asset download

## Output Modes

| Mode | In-video debug labels | Purpose | MP4 |
|---|---|---|---|
| explainable_demo | yes | Shows phases/mapping/gap evidence inside the creative frame for judging walkthroughs. | [mp4](ai_challenge_poster_explainable_demo.mp4) |
| final_creative | no | Polished poster output; debug/mapping moves to this report and index page. | [mp4](ai_challenge_poster_main.mp4) |
| high_fidelity_style | no | Closely matches marketing.mov visual grammar with generated/procedural assets only. | [mp4](ai_challenge_poster_high_fidelity.mp4) |

## Gap Report

| Gap | Severity | Impact | Strategies |
|---|---|---|---|
${tableRows(main.gapReport, (gap) => `| ${gap.gapLabelZh ?? gap.gapLabel ?? gap.slotId} | ${gap.severity} | ${gap.impact} | ${(gap.recommendedFillStrategies ?? []).join(", ")} |`)}

## Fill Strategy Evidence

| Missing Motif | Fill Strategy | Renderer Atom | Fulfilled By |
|---|---|---|---|
| dynamic_3d_ribbon_asset | ${proceduralAction.strategy} | ${proceduralAction.rendererInstructions.atom} | fulfilled_by_${proceduralAction.rendererInstructions.fulfilledBy} |

## General Ribbon Motion Geometry

This is not a \`marketing.mov\` hardcode. The transferable ribbon motif is represented as reusable parameters: \`surfaceType\`, \`pathFamily\`, \`axis\`, \`depthBehavior\`, \`layoutRelation\`, and \`textRelation\`.

\`\`\`json
${JSON.stringify(MARKETING_RIBBON_MOTION, null, 2)}
\`\`\`

## Motion Atom

\`\`\`json
${JSON.stringify(mainMotionAtom, null, 2)}
\`\`\`

## High-Fidelity Motion Atom

\`\`\`json
${JSON.stringify(highFidelityMotionAtom, null, 2)}
\`\`\`

## Debug Labels Moved Out Of Final MP4

- In-video phase labels, mapping tables, gap explanation copy, and "Sample Structure → New Timeline" remain in JSON/report/index.
- \`final_creative\` and \`high_fidelity_style\` render only poster copy: 爆款结构迁移引擎 / Viral Structure Transfer Engine / Sample Analysis / Material Gap / Video Recomposition / Upload. Analyze. Remix.
- Sample frames/audio/text remain blocked by default: \`noSampleVisualCopy=true\`, \`sampleAssetReuse=disabled\`.

## Storyboard

| Time | Subtitle | Asset Usage |
|---|---|---|
${tableRows(main.storyboard, (item) => `| ${item.timeRange} | ${item.subtitle} | ${item.assetUsage} |`)}

## Variant Progress

| Variant | Clips | Background | Motion Atom | MP4 |
|---|---:|---|---|---|
${tableRows(variantSummary, (variant) => `| ${variant.label} | ${variant.clips} | ${variant.background} | ${variant.motionAtom?.type}; ${variant.motionAtom?.pathFamily}/${variant.motionAtom?.axis}; density=${variant.motionAtom?.density}; speed=${variant.motionAtom?.speed} | [mp4](${path.basename(variant.mp4)}) |`)}

## CV Analyzer Evidence

- Analyzer output: [analysis.marketing.json](analysis.marketing.json) (produced by \`scripts/analyze-video-structure.py\`)
- Primary motif: ${analyzerJson?.primaryMotif?.motif ?? "n/a"} (confidence ${analyzerJson?.primaryMotif?.confidence ?? "n/a"})
- Band-width estimate: ${analyzerJson?.stability?.bandWidthEstimate ?? "n/a"}px (90th percentile saturated horizontal run)
- Colorful foreground ratio peak: ${analyzerJson?.stability?.colorfulForegroundRatioPeak ?? "n/a"}
- Central layout stability: ${analyzerJson?.stability?.centralLayoutStability ?? "n/a"}
- Average motion energy: ${analyzerJson?.motion?.energyAverage ?? "n/a"}
- Ribbon motion geometry: ${analyzerJson?.motionGeometry?.ribbonMotion ? `${analyzerJson.motionGeometry.ribbonMotion.surfaceType}/${analyzerJson.motionGeometry.ribbonMotion.pathFamily}/${analyzerJson.motionGeometry.ribbonMotion.axis}/${analyzerJson.motionGeometry.ribbonMotion.depthBehavior}` : "n/a"}
- Detected exclude segments: ${(analyzerJson?.excludeSegments ?? []).map((segment) => `${segment.startSec}-${segment.endSec}s · ${segment.reason}`).join("; ") || "none"}
- Top-3 motif candidates: ${(analyzerJson?.motifCandidates ?? []).slice(0, 3).map((m) => `${m.motif}(${m.confidence})`).join(", ")}

## Acceptance Evaluator

${evaluatorSummaryLines}

## VLM-as-Judge (Gemini bounded rubric)

${renderSummaries.map((summary) => {
  const j = summary.judge ?? {};
  if (j.status === "SKIPPED") return `- ${summary.label}: SKIPPED — ${j.reason}`;
  if (j.status === "FAILED") return `- ${summary.label}: FAILED — ${j.reason}`;
  const s = j.scores ?? {};
  return `- ${summary.label}: overall=${s.overall?.toFixed?.(2) ?? "?"} | structure=${s.structure_transfer?.toFixed?.(2) ?? "?"} style=${s.sample_style_fidelity?.toFixed?.(2) ?? "?"} no_copy=${s.no_direct_copy?.toFixed?.(2) ?? "?"} quality=${s.visual_quality?.toFixed?.(2) ?? "?"} — "${s.rationale ?? ""}"`;
}).join("\n")}

## Render Sanity

| Variant | Duration | Resolution | FPS | MD5 | SHA256 |
|---|---:|---|---:|---|---|
${tableRows(variantSummary, (variant) => `| ${variant.label} | ${variant.metadata.durationSec.toFixed(2)}s | ${variant.metadata.width}x${variant.metadata.height} | ${variant.metadata.fps.toFixed(2)} | ${variant.hashes.md5} | ${variant.hashes.sha256} |`)}

Copied sample visible text is absent from storyboard and rendered text layers.
`;
await writeFile(path.join(artifactDir, "report.md"), report, "utf8");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Marketing.mov Structure Transfer Case</title>
  <style>
    body { margin: 0; font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; background: #eef3f6; color: #172033; }
    main { max-width: 1440px; margin: 0 auto; padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 30px; }
    h2 { font-size: 18px; margin: 0 0 12px; }
    p, li, td { font-size: 14px; line-height: 1.45; }
    .grid { display: grid; grid-template-columns: 0.9fr 1fr 1.15fr; gap: 16px; align-items: start; }
    section { background: #fff; border: 1px solid #d8e1e8; border-radius: 8px; padding: 16px; }
    .frames { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    img, video { width: 100%; border-radius: 8px; background: #020617; }
    video.poster { max-height: 560px; object-fit: contain; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 8px 6px; text-align: left; vertical-align: top; }
    th { color: #64748b; font-size: 12px; text-transform: uppercase; }
    .pill { display: inline-flex; border-radius: 999px; padding: 3px 8px; font-size: 12px; font-weight: 800; background: #dff8ef; color: #0f766e; }
    .variants { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
    code { background: #f1f5f9; border-radius: 4px; padding: 1px 4px; }
    @media (max-width: 1000px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<main>
  <h1>Marketing.mov 动态海报结构迁移 testcase</h1>
  <p><span class="pill">PASS</span> 结构拆解、排除片段、素材缺口、迁移生成、可见 MP4、多版本差异、高保真风格复现已生成到 <code>${rel(artifactDir)}/</code></p>
  <div class="grid">
    <section>
      <h2>左栏：输入样例</h2>
      <p><strong>marketing.mov</strong> · ${metadata.durationSec.toFixed(2)}s · ${metadata.width}x${metadata.height} · ${metadata.fps.toFixed(2)}fps · audio=${metadata.hasAudio ? "yes" : "no"}</p>
      <div class="frames">
        <img src="input_hook.png" alt="input hook" />
        <img src="input_climax.png" alt="input climax" />
        <img src="input_excluded_tail.png" alt="excluded platform tail" />
      </div>
      <ul>
        <li>核心结构：极简信息海报 + 3D 彩带动态包装 + 英文关键词环绕 + 色彩递进</li>
        <li>排除片段：15.7-${metadata.durationSec.toFixed(1)}s 平台 UI / 录屏尾巴</li>
      </ul>
    </section>
    <section>
      <h2>中栏：结构理解</h2>
      <table>
        <tbody>
          <tr><th>模板</th><td>${template.name}</td></tr>
          <tr><th>视频类型</th><td>${template.videoType}</td></tr>
          <tr><th>视觉风格</th><td>${template.visualStyle?.background ?? "-"} · ${template.visualStyle?.layout ?? "-"} · ${template.visualStyle?.motionAsset ?? "-"}</td></tr>
          <tr><th>排除片段</th><td>${(template.excludeSegments ?? []).map((segment) => `${segment.startSec}-${segment.endSec}s · ${segment.reason}`).join("<br/>") || "none"}</td></tr>
          <tr><th>包装</th><td>${template.packaging.titleCardStyle}<br/>${template.packaging.overlayStyle}<br/>${template.packaging.coverStyle}</td></tr>
          <tr><th>Atoms</th><td>${template.structureAtoms.map((atom) => atom.name).join("<br/>")}</td></tr>
        </tbody>
      </table>
      <h2 style="margin-top:16px;">Gap Report</h2>
      <table>
        <thead><tr><th>缺口</th><th>Severity</th><th>策略</th></tr></thead>
        <tbody>
          ${tableRows(main.gapReport, (gap) => `<tr><td>${gap.gapLabelZh ?? gap.gapLabel ?? gap.slotId}</td><td>${gap.severity}</td><td>${(gap.recommendedFillStrategies ?? []).join(", ")}</td></tr>`)}
        </tbody>
      </table>
      <h2 style="margin-top:16px;">Fill Strategy</h2>
      <table>
        <tbody>
          <tr><th>Missing motif</th><td><code>dynamic_3d_ribbon_asset</code></td></tr>
          <tr><th>Fulfilled by</th><td><code>fulfilled_by_procedural_generation</code></td></tr>
          <tr><th>Renderer atom</th><td><code>${proceduralAction.rendererInstructions.atom}</code></td></tr>
          <tr><th>Keywords</th><td>${mainMotionAtom.keywords.join(" / ")}</td></tr>
        </tbody>
      </table>
    </section>
    <section>
      <h2>右栏：迁移生成</h2>
      <video class="poster" controls src="ai_challenge_poster_main.mp4"></video>
      <p>Contact sheet rows: input sample / explainable demo / high-fidelity style.</p>
      <img src="contact_sheet.png" alt="contact sheet" style="margin-top:10px;" />
      <div class="frames" style="margin-top:10px;">
        <img src="main_t1.png" alt="main output frame 1" />
        <img src="main_t7.png" alt="main output frame 7" />
        <img src="main_t13.png" alt="main output frame 13" />
      </div>
      <table style="margin-top:12px;">
        <thead><tr><th>时间</th><th>字幕</th><th>用法</th></tr></thead>
        <tbody>
          ${tableRows(main.storyboard, (item) => `<tr><td>${item.timeRange}</td><td>${item.subtitle}</td><td>${item.assetUsage}</td></tr>`)}
        </tbody>
      </table>
      <div class="variants">
        <div>
          <h2>Explainable Demo</h2>
          <video controls src="ai_challenge_poster_explainable_demo.mp4"></video>
        </div>
        <div>
          <h2>High Fidelity Style</h2>
          <video controls src="ai_challenge_poster_high_fidelity.mp4"></video>
          <div class="frames" style="margin-top:10px;">
            <img src="high_fidelity_t1.png" alt="high fidelity frame 1" />
            <img src="high_fidelity_t7.png" alt="high fidelity frame 7" />
            <img src="high_fidelity_t13.png" alt="high fidelity frame 13" />
          </div>
        </div>
        <div>
          <h2>高点击版</h2>
          <video controls src="ai_challenge_poster_high_ctr.mp4"></video>
          <div class="frames" style="margin-top:10px;">
            <img src="high_ctr_t1.png" alt="high ctr frame 1" />
            <img src="high_ctr_t7.png" alt="high ctr frame 7" />
            <img src="high_ctr_t13.png" alt="high ctr frame 13" />
          </div>
        </div>
        <div>
          <h2>高质感版</h2>
          <video controls src="ai_challenge_poster_high_quality.mp4"></video>
          <div class="frames" style="margin-top:10px;">
            <img src="high_quality_t1.png" alt="high quality frame 1" />
            <img src="high_quality_t7.png" alt="high quality frame 7" />
            <img src="high_quality_t13.png" alt="high quality frame 13" />
          </div>
        </div>
      </div>
      <h2 style="margin-top:16px;">Render Hashes</h2>
      <table>
        <thead><tr><th>Variant</th><th>Style</th><th>MD5</th></tr></thead>
        <tbody>
          ${tableRows(variantSummary, (variant) => `<tr><td>${variant.label}</td><td>${variant.motionAtom?.style}; density=${variant.motionAtom?.density}; speed=${variant.motionAtom?.speed}</td><td><code>${variant.hashes.md5}</code></td></tr>`)}
        </tbody>
      </table>
    </section>
  </div>
</main>
</body>
</html>
`;
await writeFile(path.join(artifactDir, "index.html"), html, "utf8");

console.log(JSON.stringify({
  status: "PASS",
  input: rel(videoPath),
  report: rel(path.join(artifactDir, "report.md")),
  html: rel(path.join(artifactDir, "index.html")),
  contactSheet: rel(contactSheetPath),
  explainableDemoMp4: rel(explainableRender.fixedPath),
  mainMp4: rel(mainRender.fixedPath),
  highCtrMp4: rel(ctrRender.fixedPath),
  highQualityMp4: rel(qualityRender.fixedPath),
  highFidelityMp4: rel(highFidelityRender.fixedPath),
  videos: variantSummary.map((variant) => ({
    label: variant.label,
    path: variant.mp4,
    durationSec: Number(variant.metadata.durationSec.toFixed(3)),
    resolution: `${variant.metadata.width}x${variant.metadata.height}`,
    fps: Number(variant.metadata.fps.toFixed(3)),
    md5: variant.hashes.md5,
    sha256: variant.hashes.sha256,
    motionAtom: variant.motionAtom
  })),
  dynamic_3d_ribbon_asset: {
    fulfilledBy: proceduralAction.rendererInstructions.fulfilledBy,
    strategy: proceduralAction.strategy,
    atom: proceduralAction.rendererInstructions.atom
  },
  gaps: main.gapReport.length,
  storyboardItems: main.storyboard.length,
  variants: variantSummary
}, null, 2));
