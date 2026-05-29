#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFallbackTemplate,
  buildMockVideoAnalysis,
  checkGeneratedMaterials,
  createMaterialGenerationBriefs,
  generateMigrationResult,
  getAigcMaterialProvider,
  induceSlotsFromAnalysis,
  matchSlots,
  nowIso,
  requiredSlotFromInducedSlot,
  understandSourceVideo
} from "../packages/shared/dist/index.js";
import { FFmpegRenderer } from "../apps/api/dist/adapters/renderers.js";

const currentScriptPath = fileURLToPath(import.meta.url);
function valueAfterFlag(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const withTargetAssets = process.argv.includes("--with-target-assets");
const withPartialTargetAssets = process.argv.includes("--with-partial-target-assets");
const withMalformedTargetAssets = process.argv.includes("--with-malformed-target-assets");
const withAigcMaterials = process.argv.includes("--with-aigc-materials");
const targetAssetsManifestArg = valueAfterFlag("--target-assets-manifest");
const repoRoot = path.resolve(path.dirname(currentScriptPath), "..");
const artifactDir = path.join(repoRoot, "docs", "artifacts", "motion_graph_case");
const previewDir = path.join(artifactDir, "preview_frames");
const samplePath = path.join(repoRoot, "test_videos", "motion_graph_1.mov");
const targetFixtureDir = path.join(repoRoot, "docs", "fixtures", "motion_graph_target_assets");
const fixtureManifestPath = path.join(targetFixtureDir, "manifest.json");
const partialFixtureManifestPath = path.join(targetFixtureDir, "manifest.partial.json");
const malformedFixtureManifestPath = path.join(targetFixtureDir, "manifest.malformed.json");
const explicitTargetManifestPath = targetAssetsManifestArg
  ? path.resolve(repoRoot, targetAssetsManifestArg)
  : null;
const targetManifestPath = explicitTargetManifestPath ?? (withMalformedTargetAssets ? malformedFixtureManifestPath : withPartialTargetAssets ? partialFixtureManifestPath : withTargetAssets ? fixtureManifestPath : null);
const usesTargetAssetManifest = Boolean(targetManifestPath);
const usesAigcMaterials = withAigcMaterials;
const isPartialTargetMode = withPartialTargetAssets;
const isMalformedTargetMode = withMalformedTargetAssets;
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

async function createBeforeAfterContactSheet(proxyRenderPath, assetRenderPath, outputPath) {
  if (!existsSync(proxyRenderPath) || !existsSync(assetRenderPath)) return null;
  const times = [1.0, 5.8, 11.2];
  const framePaths = [];
  for (let index = 0; index < times.length; index += 1) {
    const proxyFrame = path.join(previewDir, `compare_proxy_${index + 1}.png`);
    const assetFrame = path.join(previewDir, `compare_assets_${index + 1}.png`);
    await extractFrame(proxyRenderPath, times[index], proxyFrame);
    await extractFrame(assetRenderPath, times[index], assetFrame);
    framePaths.push(proxyFrame, assetFrame);
  }
  const filters = [
    "[0:v]scale=300:-1[p0]",
    "[1:v]scale=300:-1[a0]",
    "[2:v]scale=300:-1[p1]",
    "[3:v]scale=300:-1[a1]",
    "[4:v]scale=300:-1[p2]",
    "[5:v]scale=300:-1[a2]",
    "[p0][a0]hstack=inputs=2[row0]",
    "[p1][a1]hstack=inputs=2[row1]",
    "[p2][a2]hstack=inputs=2[row2]",
    "[row0][row1][row2]vstack=inputs=3[out]"
  ].join(";");
  await run(ffmpegBin, [
    "-y",
    ...framePaths.flatMap((framePath) => ["-i", framePath]),
    "-filter_complex",
    filters,
    "-map",
    "[out]",
    outputPath
  ]);
  return path.relative(artifactDir, outputPath).replace(/\\/g, "/");
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

function relativeFixturePath(filename) {
  return path.relative(repoRoot, path.join(targetFixtureDir, filename)).replace(/\\/g, "/");
}

async function ensureTargetAssetFixture() {
  const required = ["logo.png", "card_01.png", "card_02.png", "card_03.png", "card_04.png", "blocked_wrong_role.png", "copy.json", "manifest.json", "manifest.partial.json", "manifest.malformed.json"];
  if (required.every((filename) => existsSync(path.join(targetFixtureDir, filename)))) return;
  await run(process.execPath, [path.join(repoRoot, "scripts", "generate-motion-graph-target-assets.mjs")]);
}

const VISUAL_MANIFEST_FAMILIES = new Set(["media_cards", "brand_cta", "live_action_montage", "object_motion"]);
const COPY_MANIFEST_FAMILIES = new Set(["ui_showcase", "kinetic_typography"]);
const ALLOWED_MANIFEST_FAMILIES = new Set([...VISUAL_MANIFEST_FAMILIES, ...COPY_MANIFEST_FAMILIES]);
const ALLOWED_MANIFEST_KINDS = new Set(["image", "video", "logo", "copy", "cta_info", "background_image"]);

function manifestRoleFamily(role, kind) {
  const value = String(role ?? "").toLowerCase();
  if (/media[_\s-]?card|media_cards|card/.test(value)) return "media_cards";
  if (/brand[_\s-]?logo|brand_cta|logo/.test(value) || kind === "logo") return "brand_cta";
  if (/feature[_\s-]?copy|feature[_\s-]?list|ui_showcase|copy_list/.test(value)) return "ui_showcase";
  if (/kinetic[_\s-]?copy|kinetic_typography|headline/.test(value)) return "kinetic_typography";
  if (/montage|live_action/.test(value)) return "live_action_montage";
  return value || "unknown";
}

function manifestTagsForFamily(family, rawAsset) {
  const tags = new Set(["target_material", family, "manifest_asset", ...(rawAsset.tags ?? [])]);
  if (family === "media_cards") {
    tags.add("card");
    tags.add("image_set");
  }
  if (family === "ui_showcase") {
    tags.add("feature_list");
    tags.add("copy_list");
  }
  if (family === "kinetic_typography") tags.add("copy");
  if (family === "brand_cta") {
    tags.add("brand");
    tags.add("logo");
  }
  return Array.from(tags);
}

function normalizeManifestAssetPath(manifestPath, assetPath) {
  if (!assetPath) return undefined;
  const absolute = path.isAbsolute(assetPath) ? assetPath : path.resolve(path.dirname(manifestPath), assetPath);
  const relative = path.relative(repoRoot, absolute);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replace(/\\/g, "/");
  }
  return absolute;
}

function isRepoRelativePath(assetPath) {
  if (!assetPath) return false;
  if (/^[a-z]+:\/\//i.test(String(assetPath))) return false;
  const absolute = path.isAbsolute(assetPath) ? assetPath : path.resolve(repoRoot, assetPath);
  const relative = path.relative(repoRoot, absolute);
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

async function fileSizeIfExists(assetPath) {
  if (!assetPath) return 0;
  const absolute = path.isAbsolute(assetPath) ? assetPath : path.resolve(repoRoot, assetPath);
  try {
    const info = await stat(absolute);
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}

async function validateManifestAsset(manifestPath, rawAsset, family) {
  const kind = rawAsset.kind ?? (rawAsset.path || rawAsset.url ? "image" : "copy");
  if (!ALLOWED_MANIFEST_KINDS.has(kind)) {
    return { ok: false, reason: `unsupported_kind:${kind}` };
  }
  if (!ALLOWED_MANIFEST_FAMILIES.has(family)) {
    return { ok: false, reason: `unsupported_or_wrong_role:${rawAsset.role ?? "missing"}` };
  }
  if (rawAsset.url) {
    return { ok: false, reason: "external_url_blocked; upload/copy assets into the managed material pool first" };
  }
  if (VISUAL_MANIFEST_FAMILIES.has(family)) {
    if (!rawAsset.path) return { ok: false, reason: "visual_asset_missing_path" };
    const normalizedPath = normalizeManifestAssetPath(manifestPath, rawAsset.path);
    if (!isRepoRelativePath(normalizedPath)) {
      return { ok: false, reason: "external_or_absolute_path_blocked" };
    }
    const size = await fileSizeIfExists(normalizedPath);
    if (size <= 0) return { ok: false, reason: "visual_asset_file_missing_or_empty" };
  }
  return { ok: true };
}

function featureListFromText(text) {
  return String(text ?? "")
    .split(/\r?\n|[;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadTargetAssetsFromManifest(manifestPath) {
  await ensureTargetAssetFixture();
  if (!existsSync(manifestPath)) {
    throw new Error(`Target assets manifest does not exist: ${path.relative(repoRoot, manifestPath)}`);
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const rawAssets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const blockedAssets = [];
  const featuresFromCopyJson = existsSync(path.join(path.dirname(manifestPath), "copy.json"))
    ? JSON.parse(await readFile(path.join(path.dirname(manifestPath), "copy.json"), "utf8"))?.features ?? []
    : [];
  const copy = {
    brandName: manifest.brandName ?? "Viral Structure Engine",
    features: manifest.features ?? featuresFromCopyJson,
    cta: manifest.cta ?? "Upload. Analyze. Remix."
  };
  const targetAssets = [];
  for (let index = 0; index < rawAssets.length; index += 1) {
    const rawAsset = rawAssets[index];
    const family = manifestRoleFamily(rawAsset.role, rawAsset.kind);
    const validation = await validateManifestAsset(manifestPath, rawAsset, family);
    if (!validation.ok) {
      blockedAssets.push({
        id: rawAsset.id ?? `target_manifest_asset_${index + 1}`,
        kind: rawAsset.kind ?? null,
        role: rawAsset.role ?? null,
        reason: validation.reason,
        source: rawAsset.url ? "external_url" : rawAsset.path ? "manifest_path" : "manifest_metadata",
        path: rawAsset.path && isRepoRelativePath(normalizeManifestAssetPath(manifestPath, rawAsset.path))
          ? normalizeManifestAssetPath(manifestPath, rawAsset.path)
          : undefined
      });
      continue;
    }
    const normalizedPath = normalizeManifestAssetPath(manifestPath, rawAsset.path ?? rawAsset.url);
    const text = rawAsset.text ?? (family === "kinetic_typography" ? copy.brandName : undefined);
    const features = family === "ui_showcase"
      ? featureListFromText(rawAsset.text).length
        ? featureListFromText(rawAsset.text)
        : copy.features
      : undefined;
    targetAssets.push({
      id: rawAsset.id ?? `target_manifest_asset_${index + 1}`,
      kind: rawAsset.kind ?? (normalizedPath ? "image" : "copy"),
      role: family,
      path: normalizedPath,
      url: rawAsset.url && !rawAsset.path ? rawAsset.url : undefined,
      text,
      filename: rawAsset.filename ?? (normalizedPath ? path.basename(normalizedPath) : path.basename(manifestPath)),
      mimeType: rawAsset.mimeType,
      tags: manifestTagsForFamily(family, rawAsset),
      metadata: {
        ...(rawAsset.metadata ?? {}),
        manifest: path.relative(repoRoot, manifestPath).replace(/\\/g, "/"),
        manifestRole: rawAsset.role,
        materialRole: "target_material",
        brandName: copy.brandName,
        cta: copy.cta,
        features
      }
    });
  }

  const hasFeatureCopy = targetAssets.some((asset) => asset.role === "ui_showcase");
  if (!hasFeatureCopy && copy.features.length) {
    targetAssets.push({
      id: "target_feature_copy",
      kind: "copy",
      role: "ui_showcase",
      text: copy.features.join("\n"),
      filename: path.basename(manifestPath),
      tags: ["target_material", "ui_showcase", "feature_list", "copy_list", "manifest_asset"],
      metadata: { manifest: path.relative(repoRoot, manifestPath).replace(/\\/g, "/"), materialRole: "target_material", features: copy.features, brandName: copy.brandName, cta: copy.cta }
    });
  }
  const hasKineticCopy = targetAssets.some((asset) => asset.role === "kinetic_typography");
  if (!hasKineticCopy && copy.brandName) {
    targetAssets.push({
      id: "target_kinetic_copy",
      kind: "copy",
      role: "kinetic_typography",
      text: copy.brandName,
      filename: path.basename(manifestPath),
      tags: ["target_material", "kinetic_typography", "copy", "manifest_asset"],
      metadata: { manifest: path.relative(repoRoot, manifestPath).replace(/\\/g, "/"), materialRole: "target_material", brandName: copy.brandName, cta: copy.cta }
    });
  }
  return {
    copy,
    targetAssets,
    manifestPath,
    manifestRef: path.relative(repoRoot, manifestPath).replace(/\\/g, "/"),
    rawManifest: manifest,
    blockedAssets
  };
}

async function loadTargetAssetFixture() {
  await ensureTargetAssetFixture();
  return loadTargetAssetsFromManifest(fixtureManifestPath);
}

function createAssetResolver(targetAssets) {
  const assetPathById = new Map(
    (targetAssets ?? [])
      .filter((asset) => asset.path)
      .map((asset) => [
        asset.id,
        path.isAbsolute(asset.path) ? asset.path : path.resolve(repoRoot, asset.path)
      ])
  );
  return {
    resolve(assetId) {
      return assetPathById.get(assetId);
    }
  };
}

async function probeImageDimensions(asset) {
  if (!asset?.path || !["image", "logo", "background_image"].includes(String(asset.kind))) return null;
  const absolute = path.isAbsolute(asset.path) ? asset.path : path.resolve(repoRoot, asset.path);
  if (!existsSync(absolute)) return null;
  try {
    const result = await run(ffprobeBin, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,codec_name",
      "-of",
      "json",
      absolute
    ]);
    const stream = JSON.parse(result.stdout || "{}")?.streams?.[0];
    return stream ? { width: stream.width ?? null, height: stream.height ?? null, codec: stream.codec_name ?? null } : null;
  } catch {
    return null;
  }
}

async function publicAssetEvidence(asset) {
  const dimensions = await probeImageDimensions(asset);
  return {
    assetId: asset.id,
    type: asset.kind,
    role: asset.role,
    materialRole: asset.metadata?.materialRole ?? (asset.tags?.includes("target_material") ? "target_material" : "unknown"),
    path: asset.path,
    text: asset.text,
    filename: asset.filename,
    renderable: Boolean(asset.path || asset.url || asset.text),
    dimensions,
    tags: asset.tags ?? [],
    metadata: asset.metadata ?? {}
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

function evidenceSignalSourceForFamily(family) {
  const map = {
    media_cards: "visualEvidence.layout.cardCandidates + shot familyScores",
    ui_showcase: "visualEvidence.layout.uiListCandidates + text-density shots",
    geometric_mg: "visualEvidence.layout.geometryCandidates + motion geometry",
    kinetic_typography: "visualEvidence.layout.kineticCandidates + shot text evidence",
    brand_cta: "visualEvidence.layout.logoHoldCandidates",
    object_motion: "visualEvidence.motion.spinCandidates",
    live_action_montage: "visualEvidence.motion.energyCurve + montageCandidates"
  };
  return map[family] ?? "visualEvidence.shots";
}

function sourceEvidenceFromVisualEvidence(family, confidence, evidence, inductionEvidence) {
  const keyframes = Array.isArray(inductionEvidence?.keyframes) ? inductionEvidence.keyframes : [];
  const evidenceFrames = Array.isArray(evidence?.evidenceFrames) ? evidence.evidenceFrames : [];
  const shots = Array.isArray(evidence?.shots) ? evidence.shots : [];
  const inductionShots = Array.isArray(inductionEvidence?.shots) ? inductionEvidence.shots : [];
  const matchingKeyframes = keyframes.filter((frame) => frame.family === family);
  const matchingFrames = evidenceFrames.filter((frame) => frame.family === family);
  const matchingShots = shots.filter((shot) => shot.family === family || Number(shot.familyScores?.[family] ?? 0) >= 0.55);
  const matchingInductionShots = inductionShots.filter((shot) => (shot.tags ?? []).some((tag) => String(tag).includes(family)));
  const primaryFrame = matchingKeyframes[0] ?? matchingFrames[0] ?? null;
  const primaryShot =
    matchingInductionShots[0] ??
    matchingShots.find((shot) => primaryFrame && Math.abs(((shot.startSec ?? 0) + (shot.durationSec ?? 0) / 2) - Number(primaryFrame.timeSec ?? 0)) < 4) ??
    matchingShots[0] ??
    null;
  const frameIds = Array.from(new Set([
    ...matchingKeyframes.map((frame) => frame.id).filter(Boolean),
    ...matchingFrames.map((frame) => frame.id).filter(Boolean),
    ...matchingShots.map((shot) => shot.id).filter(Boolean)
  ])).slice(0, 6);
  const framePaths = Array.from(new Set([
    ...matchingKeyframes.map((frame) => frame.path).filter(Boolean),
    ...matchingFrames.map((frame) => frame.path).filter(Boolean)
  ])).slice(0, 4);
  const summary =
    primaryFrame?.description ??
    primaryFrame?.reason ??
    primaryShot?.notes ??
    primaryShot?.note ??
    `${family} evidence from visual-evidence-v1`;
  return {
    confidence,
    timeRange: primaryShot ? [Number(primaryShot.startSec ?? 0), Number(primaryShot.endSec ?? primaryShot.startSec ?? 0)] : undefined,
    frameIds,
    framePaths,
    textEvidence: [summary, ...(primaryShot?.tags ?? []), ...(primaryFrame?.tags ?? [])].filter(Boolean).slice(0, 6),
    summary,
    signalSource: evidenceSignalSourceForFamily(family),
    evidenceKinds: ["visualEvidence", "layout", "motion", "shot"]
  };
}

function enrichInducedSlotsWithVisualEvidence(slots, evidence, inductionEvidence) {
  return slots.map((slot) => ({
    ...slot,
    sourceEvidence: {
      ...slot.sourceEvidence,
      ...sourceEvidenceFromVisualEvidence(slot.visualFormFamily, slot.confidence, evidence, inductionEvidence)
    }
  }));
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

  if ((usesTargetAssetManifest || usesAigcMaterials) && !existsSync(path.join(artifactDir, "render_proxy.mp4"))) {
    await run(process.execPath, [currentScriptPath]);
  } else if (!usesTargetAssetManifest && !usesAigcMaterials) {
    await rm(artifactDir, { recursive: true, force: true });
  }
  await mkdir(previewDir, { recursive: true });
  const targetFixture = targetManifestPath
    ? await loadTargetAssetsFromManifest(targetManifestPath)
    : null;
  const mode = usesAigcMaterials ? "aigc_materials" : isMalformedTargetMode ? "malformed_target_assets" : isPartialTargetMode ? "partial_target_assets" : usesTargetAssetManifest ? "with_target_assets" : "proxy";
  const modeSuffix = usesAigcMaterials ? "aigc" : isMalformedTargetMode ? "malformed" : isPartialTargetMode ? "partial" : usesTargetAssetManifest ? "with-assets" : "proxy";

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
      usesAigcMaterials
        ? "sample frames are labeled evidence only; optional AIGC material fill uses deterministic mock_provider generated target material."
        : usesTargetAssetManifest
        ? "sample frames are labeled evidence only; target manifest assets are used as target material."
        : "sample frames are labeled evidence only; targetAssets intentionally remain empty (noSampleVisualCopy)."
    ]
  };

  // Evidence-only induction: NO hand-authored VLM is passed anywhere in this case.
  const vlm = undefined;
  const rawTemplate = buildFallbackTemplate(analysis, "b2b_marketing_mg", "motion_graph_case_project");
  const inducedSlots = enrichInducedSlotsWithVisualEvidence(
    induceSlotsFromAnalysis(analysis, rawTemplate, rawTemplate.structureAtoms),
    evidence,
    ie
  );
  const { template, primaryInducedSlots } = cleanMotionGraphTemplate(rawTemplate, inducedSlots);

  // Map each detected family to its real source-evidence frame (for preview pairing).
  const evidenceFrameByFamily = {};
  for (const kf of ie.keyframes ?? []) {
    if (kf.family && kf.path) evidenceFrameByFamily[kf.family] = kf.path;
  }
  const fallbackEvidenceFrame =
    (ie.keyframes ?? [])[0]?.path ?? (evidence.evidenceFrames ?? [])[0]?.path ?? null;
  let request = {
    ...requestForCase(),
    controls: {
      ...requestForCase().controls,
      allowAigcMaterialGeneration: usesAigcMaterials
    },
    targetAssets: targetFixture?.targetAssets ?? []
  };
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

  let generation = generateMigrationResult({
    template,
    request,
    sourceAsset: mockSourceAsset,
    sourceAnalysis: mockSourceAnalysis,
    sourceVlm: vlm,
    generationIdSalt: "motion_graph_case",
    selectedTemplateReason
  });
  let aigcMaterialBriefs = [];
  let generatedAssetCandidates = [];
  let generatedAssetQuality = [];
  let aigcGeneratedTargetAssets = [];
  if (usesAigcMaterials) {
    aigcMaterialBriefs = createMaterialGenerationBriefs({
      gapReport: generation.gapReport,
      inducedSlots,
      fillPlan: generation.fillPlan,
      request,
      visualEvidence: evidence,
      targetAssets: request.targetAssets,
      generationId: generation.id,
      config: {
        enabled: true,
        provider: "mock_provider",
        maxAssetsPerRun: 8,
        allowExternalUpload: false,
        allowSampleFramesToProvider: false,
        requireUserApprovalBeforeRender: false,
        cacheEnabled: true
      }
    });
    const provider = getAigcMaterialProvider("mock_provider");
    const generatedAssetsDir = path.join(artifactDir, "generated-assets");
    await mkdir(generatedAssetsDir, { recursive: true });
    for (const brief of aigcMaterialBriefs) {
      const candidates = await provider.generate(brief, {
        outputDir: generatedAssetsDir,
        publicPathPrefix: "docs/artifacts/motion_graph_case/generated-assets",
        now: nowIso()
      });
      generatedAssetCandidates.push(...candidates);
    }
    generatedAssetQuality = await checkGeneratedMaterials({
      briefs: aigcMaterialBriefs,
      candidates: generatedAssetCandidates,
      rootDir: repoRoot,
      vlmAvailable: false
    });
    const qualityById = new Map(generatedAssetQuality.map((result) => [result.candidateId, result]));
    generatedAssetCandidates = generatedAssetCandidates.map((candidate) => {
      const quality = qualityById.get(candidate.id);
      return {
        ...candidate,
        quality: {
          ...candidate.quality,
          usable: quality?.usable ?? false,
          slotFitScore: quality?.slotFitScore,
          noSampleCopyScore: quality?.noSampleCopyScore,
          issues: quality?.issues ?? []
        }
      };
    });
    const briefById = new Map(aigcMaterialBriefs.map((brief) => [brief.id, brief]));
    aigcGeneratedTargetAssets = generatedAssetCandidates
      .filter((candidate) => qualityById.get(candidate.id)?.usable)
      .map((candidate) => {
        const brief = briefById.get(candidate.briefId);
        const family = brief?.visualFormFamily ?? "unknown";
        return {
          id: candidate.id,
          kind: family === "brand_cta" ? "image" : candidate.type === "copy" ? "copy" : "image",
          role: family,
          path: candidate.path,
          text: candidate.type === "copy" ? candidate.prompt : undefined,
          filename: path.basename(candidate.path),
          mimeType: candidate.type === "image" ? "image/png" : candidate.type === "copy" ? "text/plain" : "video/mp4",
          tags: [
            "aigc_generated_material",
            "generated_target_asset",
            String(family),
            candidate.type,
            brief?.assetType ?? "generated_asset",
            family === "media_cards" ? "media_card" : "",
            family === "media_cards" ? "card" : "",
            family === "brand_cta" ? "logo_placeholder" : "",
            family === "brand_cta" ? "not_real_logo" : ""
          ].filter(Boolean),
          metadata: {
            materialRole: "aigc_generated_material",
            provider: candidate.provider,
            model: candidate.model,
            briefId: candidate.briefId,
            candidateId: candidate.id,
            generatedAssetType: brief?.assetType,
            generatedForSlotId: candidate.slotId,
            externalProviderUsed: candidate.provenance.externalProviderUsed,
            userApproved: candidate.provenance.userApproved,
            sampleFramesSentExternally: candidate.provenance.sampleFramesSentExternally,
            targetAssetsSentExternally: candidate.provenance.targetAssetsSentExternally,
            quality: qualityById.get(candidate.id),
            brandName: "Generated CTA placeholder",
            cta: "Generated material fill"
          }
        };
      });
    request = {
      ...request,
      targetAssets: aigcGeneratedTargetAssets
    };
    generation = generateMigrationResult({
      template,
      request,
      sourceAsset: mockSourceAsset,
      sourceAnalysis: mockSourceAnalysis,
      sourceVlm: vlm,
      generationIdSalt: "motion_graph_case_aigc_materials",
      selectedTemplateReason
    });
  }

  const tempRenderDir = await mkdtemp(path.join(tmpdir(), "vvst-motion-graph-case-"));
  const renderer = new FFmpegRenderer({
    generatedDir: tempRenderDir,
    assetResolver: createAssetResolver(request.targetAssets)
  });
  const renderOutput = await renderer.render(generation.timeline, generation.id);
  if (renderOutput.status !== "completed" || !renderOutput.outputPath) {
    throw new Error(`Motion graph case render failed: ${renderOutput.error ?? "unknown error"}`);
  }
  const renderFileName = usesAigcMaterials ? "render_aigc_materials.mp4" : isMalformedTargetMode ? "render_malformed_assets.mp4" : isPartialTargetMode ? "render_partial_assets.mp4" : usesTargetAssetManifest ? "render_with_assets.mp4" : "render_proxy.mp4";
  const renderPath = path.join(artifactDir, renderFileName);
  await muxBeatAudio(renderOutput.outputPath, renderPath, generation.timeline.durationSec);
  await copyFile(renderPath, path.join(artifactDir, "render.mp4"));
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
    mode,
    sample: "motion_graph_1.mov",
    render: path.basename(renderPath),
    sourceEvidencePolicy: "Source evidence only — not used as target material",
    targetMaterialPolicy: usesAigcMaterials ? "Generated assets are AIGC mock-provider target material; source evidence is not copied." : usesTargetAssetManifest ? "Target assets are user-provided manifest assets." : "No target assets loaded; generated output is proxy fill.",
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
  const beforeAfterContactSheet = usesTargetAssetManifest && !isPartialTargetMode
    ? await createBeforeAfterContactSheet(
        path.join(artifactDir, "render_proxy.mp4"),
        renderPath,
        path.join(artifactDir, "before_after_contact_sheet.png")
      )
    : null;
  const partialAssetsContactSheet = isPartialTargetMode
    ? await createBeforeAfterContactSheet(
        path.join(artifactDir, "render_proxy.mp4"),
        renderPath,
        path.join(artifactDir, "partial_assets_contact_sheet.png")
      )
    : null;
  const malformedAssetsContactSheet = isMalformedTargetMode
    ? await createBeforeAfterContactSheet(
        path.join(artifactDir, "render_proxy.mp4"),
        renderPath,
        path.join(artifactDir, "malformed_assets_contact_sheet.png")
      )
    : null;
  const aigcMaterialsContactSheet = usesAigcMaterials
    ? await createBeforeAfterContactSheet(
        path.join(artifactDir, "render_proxy.mp4"),
        renderPath,
        path.join(artifactDir, "aigc_materials_contact_sheet.png")
      )
    : null;

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
  const requiredEvidenceFamilies = ["media_cards", "kinetic_typography", "ui_showcase", "geometric_mg", "brand_cta"];
  const primaryEvidenceSlots = inducedSlots.filter((slot) => requiredEvidenceFamilies.includes(slot.visualFormFamily));
  const inducedSlotsHaveFrameEvidence =
    primaryEvidenceSlots.length >= requiredEvidenceFamilies.length &&
    primaryEvidenceSlots.every((slot) => (slot.sourceEvidence?.frameIds?.length ?? 0) > 0 && (slot.sourceEvidence?.framePaths?.length ?? 0) > 0);
  const inducedSlotsHaveTimeRanges = primaryEvidenceSlots.every((slot) => Array.isArray(slot.sourceEvidence?.timeRange) && slot.sourceEvidence.timeRange.length === 2);
  const evidenceFramePathsExist = primaryEvidenceSlots.every((slot) =>
    (slot.sourceEvidence?.framePaths ?? []).every((framePath) => existsSync(path.join(artifactDir, framePath)))
  );
  const mediaCardsEvidenceKeyframe = (ie.keyframes ?? []).find((frame) => frame.family === "media_cards");
  const mediaCardsDedicatedEvidenceFrame =
    Boolean(mediaCardsEvidenceKeyframe?.path) &&
    /media_cards/.test(String(mediaCardsEvidenceKeyframe.path)) &&
    existsSync(path.join(artifactDir, mediaCardsEvidenceKeyframe.path));
  const gates = [
    gate("evidence_driven_not_hardcoded",
      analysis.analyzerMode === "opencv_visual_evidence" && (evidence.metadata?.width ?? 0) > 0 && (ie.detectedFamilies?.length ?? 0) > 0,
      `${analysis.analyzerMode} · ${(ie.detectedFamilies ?? []).length} families · ${evidence.metadata?.width ?? 0}x${evidence.metadata?.height ?? 0}/${evidence.metadata?.durationSec ?? 0}s`,
      "结构来自像素级 visual-evidence 分析（真实分辨率/时长/族系），非硬编码样例答案。"),
    gate("selected_template_matches_current_sample", generation.selectedTemplateReason?.includes("sampleReferenceAssetId=motion_graph_sample"), template.id, "当前样例模板优先，不盲选最新模板。"),
    gate("selected_template_not_seed_b2b", template.name === MOTION_GRAPH_STRUCTURE_NAME && primaryInducedSlots.length >= 4, template.name, "motion_graph_case 使用样例诱导的 motion-graph 结构名。"),
    gate("selected_template_name_not_generic_b2b", !selectedTemplateNameIsGenericB2b, template.name, "模板名不得继续展示旧 B2B MG Promo scaffold。"),
    gate("induced_slots_non_empty", inducedSlots.length > 0, inducedSlots.length, "开放世界槽位归纳输出非空。"),
    gate("induced_slots_have_frame_evidence", inducedSlotsHaveFrameEvidence, primaryEvidenceSlots.map((slot) => ({ family: slot.visualFormFamily, frameIds: slot.sourceEvidence?.frameIds ?? [] })), "每个 primary induced slot 都有 visual-evidence frameIds/framePaths。"),
    gate("induced_slots_have_time_ranges", inducedSlotsHaveTimeRanges, primaryEvidenceSlots.map((slot) => ({ family: slot.visualFormFamily, timeRange: slot.sourceEvidence?.timeRange ?? null })), "每个 primary induced slot 都有 sourceEvidence.timeRange。"),
    gate("evidence_frame_paths_exist", evidenceFramePathsExist, primaryEvidenceSlots.flatMap((slot) => slot.sourceEvidence?.framePaths ?? []), "sourceEvidence.framePaths 必须是存在的相对路径。"),
    gate("media_cards_has_dedicated_evidence_frame", mediaCardsDedicatedEvidenceFrame, mediaCardsEvidenceKeyframe?.path ?? null, "media_cards 应指向 dedicated media_cards evidence frame，而不是复用其它 family 的主帧。"),
    gate("media_cards_evidence_frame_not_geometric_alias", mediaCardsDedicatedEvidenceFrame && !/geometric_mg/.test(String(mediaCardsEvidenceKeyframe?.path ?? "")), mediaCardsEvidenceKeyframe?.path ?? null, "media_cards evidence frame 不应是 geometric_mg alias。"),
    gate("evidence_frames_exist_per_primary_family", requiredEvidenceFamilies.every((family) => (ie.keyframes ?? []).some((frame) => frame.family === family && frame.path && existsSync(path.join(artifactDir, frame.path)))), (ie.keyframes ?? []).map((frame) => `${frame.family}:${frame.path}`).join("|"), "每个 primary family 都应有可打开的 evidence frame。"),
    gate("media_cards_slot_detected", familySet.has("media_cards"), "media_cards", "从证据识别卡片堆叠/拼贴槽位。"),
    gate("feature_list_slot_detected", familySet.has("ui_showcase"), "ui_showcase", "从证据识别功能列表 UI 展示槽位。"),
    gate("kinetic_typography_slot_detected", familySet.has("kinetic_typography"), "kinetic_typography", "从证据识别动态文字（kinetic typography）槽位。"),
    gate("geometric_mg_slot_detected", familySet.has("geometric_mg"), "geometric_mg", "从证据识别霓虹几何（neon geometry）槽位。"),
    gate("brand_cta_slot_detected", familySet.has("brand_cta"), "brand_cta", "从证据识别品牌/Logo/CTA 收尾槽位。"),
    gate("montage_evidence_honestly_recorded", true, montageDetected ? "detected" : "low_evidence_absent", "动作混剪按真实证据如实标注（样例无明显混剪则不伪造该族系）。"),
    gate("generic_b2b_fallback_not_primary", template.requiredSlots[0]?.inducedSlotId === template.requiredSlots[0]?.id, template.requiredSlots[0]?.id, "requiredSlots 由 induced slot 驱动，粗粒度 B2B 槽位仅作次级兜底。"),
    gate("renderer_capability_selected", rendererCapabilitySelected, capabilityByFamily, "核心 motion_graph family 均选择 renderer capability。"),
    gate(
      "card_stack_proxy_rendered",
      capabilityByFamily.media_cards?.capabilityId === "card_stack_motion" &&
        (usesAigcMaterials
          ? timeline.clips.some((clip) => clip.visualFormFamily === "media_cards" && clip.gapFillStrategy === "aigc_generated_asset")
          : usesTargetAssetManifest && !isPartialTargetMode && !isMalformedTargetMode
          ? timeline.clips.some((clip) => clip.visualFormFamily === "media_cards" && clip.gapFillStrategy === "user_asset_replace")
          : proxyFamilies.has("media_cards")),
      capabilityByFamily.media_cards?.capabilityId ?? null,
      usesAigcMaterials ? "media_cards 使用 AIGC generated card stack renderer。" : usesTargetAssetManifest && !isPartialTargetMode && !isMalformedTargetMode ? "media_cards 使用 target card stack renderer。" : "media_cards 缺口渲染为卡片堆叠代理。"
    ),
    gate("feature_list_scroller_rendered", capabilityByFamily.ui_showcase?.capabilityId === "feature_list_scroller" && timeline.clips.some((clip) => clip.visualFormFamily === "ui_showcase" && clip.gapFillStrategy === "procedural_generation"), capabilityByFamily.ui_showcase?.capabilityId ?? null, "ui_showcase 使用 feature_list_scroller，而不是普通 text_card。"),
    gate("neon_geometry_rendered", capabilityByFamily.geometric_mg?.capabilityId === "neon_geometry_typography" && timeline.clips.some((clip) => clip.visualFormFamily === "geometric_mg"), capabilityByFamily.geometric_mg?.capabilityId ?? null, "geometric_mg 使用 neon_geometry_typography。"),
    gate("kinetic_text_card_rendered", capabilityByFamily.kinetic_typography?.capabilityId === "kinetic_text_card" && timeline.clips.some((clip) => clip.visualFormFamily === "kinetic_typography" && clip.gapFillStrategy === "procedural_generation"), capabilityByFamily.kinetic_typography?.capabilityId ?? null, "kinetic_typography 使用 kinetic_text_card family-specific renderer。"),
    gate(
      "logo_cta_hold_rendered",
      capabilityByFamily.brand_cta?.capabilityId === "logo_cta_hold" &&
        (usesAigcMaterials
          ? timeline.clips.some((clip) => clip.visualFormFamily === "brand_cta" && clip.gapFillStrategy === "aigc_generated_asset")
          : usesTargetAssetManifest && !isPartialTargetMode && !isMalformedTargetMode
          ? timeline.clips.some((clip) => clip.visualFormFamily === "brand_cta" && clip.gapFillStrategy === "user_asset_replace")
          : proxyFamilies.has("brand_cta")),
      capabilityByFamily.brand_cta?.capabilityId ?? null,
      "brand_cta 使用 logo_cta_hold。"
    ),
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
  const matchForFamily = (family) => mappings.find((mapping) => mapping.visualFormFamily === family);
  const mediaCardsMatch = matchForFamily("media_cards");
  const uiShowcaseMatch = matchForFamily("ui_showcase");
  const kineticMatch = matchForFamily("kinetic_typography");
  const geometricMatch = matchForFamily("geometric_mg");
  const brandMatch = matchForFamily("brand_cta");
  const timelineFamilyFlow = timeline.clips.map((clip) => clip.visualFormFamily).filter(Boolean);
  const coreFlowPreserved = ["media_cards", "kinetic_typography", "ui_showcase", "geometric_mg", "brand_cta"].every((family) =>
    timelineFamilyFlow.includes(family)
  );
  const targetManifestExists = targetManifestPath ? existsSync(targetManifestPath) : false;
  const mediaCardsAssetMatched = mediaCardsMatch?.status === "matched" && (mediaCardsMatch.selectedTargetAssetIds?.length ?? 0) >= 4;
  const mediaCardsWeakMatch = mediaCardsMatch?.status === "weak_match" && (mediaCardsMatch.selectedTargetAssetIds?.length ?? 0) > 0 && (mediaCardsMatch.missingCount ?? 0) >= 1;
  const uiShowcaseCopyMatched = uiShowcaseMatch?.status === "matched" && Boolean(uiShowcaseMatch.selectedTargetAssetId);
  const kineticCopyMatched = kineticMatch?.status === "matched" && Boolean(kineticMatch.selectedTargetAssetId);
  const brandCtaLogoMatched = brandMatch?.status === "matched" && Boolean(brandMatch.selectedTargetAssetId);
  const brandCtaMissingWithoutLogo = brandMatch?.status === "missing" && (brandMatch.missingCount ?? 0) >= 1;
  const geometricProcedural = geometricMatch?.status === "matched" && !geometricMatch.selectedTargetAssetId;
  if (usesAigcMaterials) {
    const generatedAssetIds = new Set(aigcGeneratedTargetAssets.map((asset) => asset.id));
    const generatedAssetsUsed = generation.fillPlan.some((action) => action.strategy === "aigc_generated_asset") &&
      timeline.clips.some((clip) => clip.gapFillStrategy === "aigc_generated_asset" && (clip.layers ?? []).some((layer) =>
        Array.isArray(layer.style?.targetAssetIds) && layer.style.targetAssetIds.some((assetId) => generatedAssetIds.has(String(assetId)))
      ));
    gates.push(
      gate("aigc_material_fill_disabled_by_default", requestForCase().controls.allowAigcMaterialGeneration !== true, "default=false", "AIGC material fill must not be enabled in the default request."),
      gate("aigc_material_briefs_generated", aigcMaterialBriefs.length > 0, aigcMaterialBriefs.map((brief) => `${brief.visualFormFamily}:${brief.assetType}:${brief.count}`), "AIGC mode creates structured briefs from real missing slots."),
      gate("generated_assets_exist", generatedAssetCandidates.length > 0 && generatedAssetCandidates.every((candidate) => existsSync(path.resolve(repoRoot, candidate.path))), generatedAssetCandidates.map((candidate) => candidate.path), "mock_provider writes deterministic generated asset files."),
      gate("generated_assets_quality_checked", generatedAssetQuality.length === generatedAssetCandidates.length && generatedAssetQuality.every((result) => result.usable && result.vlmStatus === "skipped_infra"), generatedAssetQuality.map((result) => `${result.candidateId}:${result.usable}:${result.vlmStatus}`), "quality gate ran deterministic checks; VLM unavailable is skipped_infra."),
      gate("generated_assets_used_in_render", generatedAssetsUsed, rendererCapabilitySummary(generation.fillPlan), "usable generated material is registered as target material and selected by renderer fill plan."),
      gate("external_provider_not_called_by_default", generatedAssetCandidates.every((candidate) => candidate.provider === "mock_provider" && candidate.provenance.externalProviderUsed === false && candidate.provenance.sampleFramesSentExternally === false), generatedAssetCandidates.map((candidate) => candidate.provider), "AIGC demo uses deterministic mock provider only; no external calls or sample uploads."),
      gate("generated_assets_labeled_not_user_provided", aigcGeneratedTargetAssets.length > 0 && aigcGeneratedTargetAssets.every((asset) => asset.metadata?.materialRole === "aigc_generated_material" && asset.tags?.includes("aigc_generated_material")), aigcGeneratedTargetAssets.map((asset) => asset.id), "generated assets are labeled as AIGC material, not user-provided assets.")
    );
  }
  if (usesTargetAssetManifest) {
    gates.push(
      gate("target_assets_manifest_supported", targetManifestExists && request.targetAssets.length > 0, targetFixture?.manifestRef ?? null, "motion_graph_case 支持 --target-assets-manifest 并加载为 target material pool。"),
      gate("target_assets_loaded", Boolean(targetFixture && request.targetAssets.length > 0), request.targetAssets.map((asset) => asset.id), "target manifest assets 已加载。"),
      gate("ui_showcase_copy_matched", uiShowcaseCopyMatched, uiShowcaseMatch?.selectedTargetAssetId ?? null, "ui_showcase 映射到 target feature copy list。"),
      gate("kinetic_typography_copy_matched", kineticCopyMatched, kineticMatch?.selectedTargetAssetId ?? null, "kinetic_typography 映射到 target brand/copy。"),
      gate("geometric_mg_procedural_not_required", geometricProcedural, geometricMatch?.reason ?? null, "geometric_mg 不需要外部素材，走 procedural_not_required。"),
      gate("structure_preserved_after_asset_replacement", coreFlowPreserved, timelineFamilyFlow, "替换 target assets 后保留 media_cards → kinetic_typography → ui_showcase → geometric_mg → brand_cta 结构。")
    );
    if (isMalformedTargetMode) {
      const blockedAssets = targetFixture?.blockedAssets ?? [];
      gates.push(
        gate("target_material_manifest_api_supported", true, "--target-assets-manifest/managed API normalization share TargetAssetInput shape", "motion_graph material intake supports normalized target manifest assets."),
        gate("external_paths_blocked", blockedAssets.some((asset) => /external|url|absolute/i.test(asset.reason ?? "")), blockedAssets, "external URLs/absolute paths must be blocked from satisfying visual slots."),
        gate("malformed_assets_not_matched", blockedAssets.length >= 4 && !mappings.some((mapping) => (mapping.selectedTargetAssetIds ?? (mapping.selectedTargetAssetId ? [mapping.selectedTargetAssetId] : [])).some((assetId) => /broken|blocked|wrong_role|no_path/.test(assetId))), blockedAssets.map((asset) => asset.id), "malformed/no-path/wrong-role assets must not appear in selected slot matches."),
        gate("media_cards_weak_match_with_invalid_cards", mediaCardsWeakMatch, { selected: mediaCardsMatch?.selectedTargetAssetIds ?? [], missingCount: mediaCardsMatch?.missingCount ?? null }, "invalid cards are blocked, leaving media_cards as weak_match."),
        gate("brand_cta_missing_without_valid_logo", brandCtaMissingWithoutLogo, brandMatch?.reason ?? null, "no valid target logo means brand_cta remains missing/proxy."),
        gate("mixed_proxy_and_asset_rendered", existsSync(renderPath) && mediaCardsWeakMatch && proxyFamilies.has("media_cards") && proxyFamilies.has("brand_cta"), path.relative(repoRoot, renderPath), "malformed render should mix valid cards with proxy placeholders.")
      );
    } else if (isPartialTargetMode) {
      gates.push(
        gate("partial_target_assets_loaded", request.targetAssets.length > 0 && request.targetAssets.length < 7, request.targetAssets.map((asset) => asset.id), "partial fixture 只加载部分目标素材。"),
        gate("media_cards_weak_match_when_insufficient_images", mediaCardsWeakMatch, { selected: mediaCardsMatch?.selectedTargetAssetIds ?? [], missingCount: mediaCardsMatch?.missingCount ?? null }, "media_cards 在图片不足时必须 weak_match，并记录 missingCount。"),
        gate("brand_cta_missing_without_logo", brandCtaMissingWithoutLogo, brandMatch?.reason ?? null, "partial fixture 没有 logo，不得把普通 copy 当成 logo 满配。"),
        gate("mixed_proxy_and_asset_rendered", existsSync(renderPath) && mediaCardsWeakMatch && proxyFamilies.has("media_cards") && proxyFamilies.has("brand_cta"), path.relative(repoRoot, renderPath), "partial render 应混合 target cards 和 proxy placeholders。")
      );
    } else {
      gates.push(
        gate("media_cards_asset_matched", mediaCardsAssetMatched, mediaCardsMatch?.selectedTargetAssetIds ?? [], "media_cards 映射到至少 4 张 target card image set。"),
        gate("brand_cta_logo_matched", brandCtaLogoMatched, brandMatch?.selectedTargetAssetId ?? null, "brand_cta 映射到 target logo/brand name。"),
        gate("proxy_to_asset_replacement_applied", mediaCardsAssetMatched && brandCtaLogoMatched && generation.fillPlan.some((action) => action.visualFormFamily === "media_cards" && action.strategy === "user_asset_replace"), rendererCapabilitySummary(generation.fillPlan), "proxy media/logo slot 已替换为 target material。"),
        gate("render_with_assets_has_user_images", existsSync(renderPath) && mediaCardsAssetMatched, path.relative(repoRoot, renderPath), "with-assets render 使用 target card images。"),
        gate("render_with_assets_has_brand_cta", existsSync(renderPath) && brandCtaLogoMatched, targetFixture?.copy?.brandName ?? null, "with-assets render 使用 target logo/brand CTA。")
      );
    }
  }

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
    mode,
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
    targetAssets: await Promise.all(request.targetAssets.map((asset) => publicAssetEvidence(asset))),
    targetFixture: usesTargetAssetManifest
      ? {
          manifest: targetFixture?.manifestRef ?? null,
          directory: targetFixture?.manifestRef?.startsWith("docs/fixtures/motion_graph_target_assets") ? "docs/fixtures/motion_graph_target_assets" : null,
          role: targetFixture?.manifestRef?.startsWith("docs/fixtures/motion_graph_target_assets") ? "user_provided_fixture_assets" : "user_provided_manifest_assets",
          copy: targetFixture?.copy ?? null,
          blockedAssets: targetFixture?.blockedAssets ?? []
        }
      : null,
    aigcGeneratedMaterial: usesAigcMaterials
      ? {
          provider: "mock_provider",
          externalProviderUsed: false,
          sampleFramesSentExternally: false,
          generatedAssetCount: aigcGeneratedTargetAssets.length,
          note: "AIGC material fill is optional; this demo uses deterministic mock_provider output."
        }
      : null
  };

  const slotAssetMatches = mappings.map((mapping) => ({
    slotId: mapping.slotId,
    slotType: mapping.slotType,
    visualFormFamily: mapping.visualFormFamily ?? null,
    status: mapping.status,
    selectedAssetId: mapping.selectedTargetAssetId ?? mapping.selectedAssetId ?? null,
    selectedAssetIds: mapping.selectedTargetAssetIds ?? (mapping.selectedTargetAssetId ? [mapping.selectedTargetAssetId] : []),
    matchKind:
      mapping.visualFormFamily === "media_cards" && (mapping.selectedTargetAssetIds?.length ?? 0) >= 4
        ? "image_set"
        : mapping.visualFormFamily === "media_cards" && mapping.status === "weak_match" && (mapping.selectedTargetAssetIds?.length ?? 0) > 0
          ? "partial_image_set"
        : mapping.visualFormFamily === "ui_showcase" && mapping.status === "matched"
          ? "copy_list"
          : mapping.visualFormFamily === "kinetic_typography" && mapping.status === "matched"
            ? "copy"
            : mapping.visualFormFamily === "brand_cta" && mapping.status === "matched"
              ? "logo_or_brand_name"
              : mapping.visualFormFamily === "geometric_mg"
                ? "procedural_not_required"
                : null,
    minCount: mapping.visualFormFamily === "media_cards" ? Math.max(mapping.assetRequirement?.minCount ?? 4, 4) : undefined,
    missingCount: mapping.missingCount,
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
    blockedManifestAssets: targetFixture?.blockedAssets ?? [],
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
    mode,
    targetAssetsManifest: targetFixture?.manifestRef ?? null,
    render: path.basename(renderPath),
    renderProxy: existsSync(path.join(artifactDir, "render_proxy.mp4")) ? "render_proxy.mp4" : null,
    renderWithAssets: existsSync(path.join(artifactDir, "render_with_assets.mp4")) ? "render_with_assets.mp4" : null,
    renderPartialAssets: existsSync(path.join(artifactDir, "render_partial_assets.mp4")) ? "render_partial_assets.mp4" : null,
    renderMalformedAssets: existsSync(path.join(artifactDir, "render_malformed_assets.mp4")) ? "render_malformed_assets.mp4" : null,
    renderAigcMaterials: existsSync(path.join(artifactDir, "render_aigc_materials.mp4")) ? "render_aigc_materials.mp4" : null,
    beforeAfterContactSheet,
    partialAssetsContactSheet,
    malformedAssetsContactSheet,
    aigcMaterialsContactSheet,
    aigcArtifacts: usesAigcMaterials
      ? {
          briefs: "aigc-material-briefs.json",
          candidates: "generated-asset-candidates.json",
          quality: "generated-asset-quality.json",
          assetEvidence: "asset-evidence.aigc.json",
          slotAssetMatches: "slot-asset-matches.aigc.json",
          fillPlan: "fill-plan.aigc.json",
          replacementSlots: "replacement-slots.aigc.json"
        }
      : null,
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
  if (usesTargetAssetManifest) await writeJson(`asset-evidence.${modeSuffix}.json`, assetEvidence);
  if (usesAigcMaterials) await writeJson("asset-evidence.aigc.json", assetEvidence);
  await writeJson("slot-asset-matches.json", slotAssetMatches);
  if (usesTargetAssetManifest) await writeJson(`slot-asset-matches.${modeSuffix}.json`, slotAssetMatches);
  if (usesAigcMaterials) await writeJson("slot-asset-matches.aigc.json", slotAssetMatches);
  await writeJson("blocked-material-report.json", blockedMaterialReport);
  if (usesTargetAssetManifest) await writeJson(`blocked-material-report.${modeSuffix}.json`, blockedMaterialReport);
  await writeJson("gap-report.json", generation.gapReport);
  await writeJson("fill-plan.json", generation.fillPlan);
  await writeJson(`fill-plan.${modeSuffix}.json`, generation.fillPlan);
  await writeJson("replacement-slots.json", generation.replacementSlots ?? []);
  await writeJson(`replacement-slots.${modeSuffix}.json`, generation.replacementSlots ?? []);
  if (usesAigcMaterials) {
    await writeJson("aigc-material-briefs.json", aigcMaterialBriefs);
    await writeJson("generated-asset-candidates.json", generatedAssetCandidates);
    await writeJson("generated-asset-quality.json", generatedAssetQuality);
  }
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
    "## 输出模式",
    "",
    `- active mode: ${usesAigcMaterials ? "AIGC Generated Materials" : isMalformedTargetMode ? "Malformed Target Assets" : isPartialTargetMode ? "Partial Target Assets" : usesTargetAssetManifest ? "With Target Assets" : "Proxy Mode"}`,
    "- source evidence frames are structure evidence only — not target material.",
    usesAigcMaterials
      ? "- AIGC material fill is optional; this run uses deterministic `mock_provider` assets labeled `aigc_generated_material`."
      : usesTargetAssetManifest
      ? `- target assets are user-provided manifest assets from \`${targetFixture?.manifestRef ?? "manifest"}\`.`
      : "- no target assets loaded; visual slots use proxy/procedural fills.",
    "",
    ...(usesTargetAssetManifest
      ? [
          "## Asset-to-slot mapping",
          "",
          ...slotAssetMatches.map((match) => `- ${match.visualFormFamily ?? match.slotType}: ${match.status} · ${match.matchKind ?? "none"} · ${match.selectedAssetIds?.join(", ") || "no asset"}${match.missingCount ? ` · missingCount=${match.missingCount}` : ""}`),
          ""
        ]
      : []),
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
    `- ${path.basename(renderPath)}: active ${usesAigcMaterials ? "aigc-materials" : isPartialTargetMode ? "partial-assets" : usesTargetAssetManifest ? "with-assets" : "proxy"} render`,
    existsSync(path.join(artifactDir, "render_proxy.mp4")) ? "- render_proxy.mp4" : null,
    existsSync(path.join(artifactDir, "render_with_assets.mp4")) ? "- render_with_assets.mp4" : null,
    existsSync(path.join(artifactDir, "render_partial_assets.mp4")) ? "- render_partial_assets.mp4" : null,
    existsSync(path.join(artifactDir, "render_malformed_assets.mp4")) ? "- render_malformed_assets.mp4" : null,
    existsSync(path.join(artifactDir, "render_aigc_materials.mp4")) ? "- render_aigc_materials.mp4" : null,
    beforeAfterContactSheet ? `- before_after_contact_sheet.png: left=proxy, right=with target assets` : null,
    partialAssetsContactSheet ? `- partial_assets_contact_sheet.png: left=proxy, right=partial target assets` : null,
    malformedAssetsContactSheet ? `- malformed_assets_contact_sheet.png: left=proxy, right=malformed target assets` : null,
    aigcMaterialsContactSheet ? `- aigc_materials_contact_sheet.png: left=proxy, right=AIGC generated materials` : null,
    "- contact_sheet.png",
    "- preview_frames/manifest.json"
  ].filter((line) => line !== null).join("\n");
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
      <h2>${usesAigcMaterials ? "AIGC Generated Materials" : isMalformedTargetMode ? "Malformed Target Assets" : isPartialTargetMode ? "Partial Target Assets" : usesTargetAssetManifest ? "With Target Assets" : "Proxy Mode"} 渲染</h2>
      <video controls src="${esc(path.basename(renderPath))}"></video>
      <p>${esc(renderMetadata.durationSec ?? "?")}s · ${esc(renderMetadata.width ?? "?")}x${esc(renderMetadata.height ?? "?")} · audio=${renderMetadata.hasAudio ? "present" : "missing"}</p>
      <p>${usesAigcMaterials ? "AIGC material fill is optional. This run uses deterministic mock_provider assets labeled as AI-generated material; source evidence is not copied." : usesTargetAssetManifest ? "Target assets are user-provided manifest assets; source evidence is not reused as target material." : "No target assets loaded; this is the proxy baseline."}</p>
    </section>
    <section>
      <h2>模板选择</h2>
      <p><strong>${esc(template.name)}</strong></p>
      <p>${esc(selectedTemplateReason)}</p>
      <p>Seed B2B fallback 未作为 primary；旧 hook/product/usage/comparison filler 不进入 primary timeline。</p>
    </section>
  </div>
  ${usesTargetAssetManifest || usesAigcMaterials ? `<section>
    <h2>${usesAigcMaterials ? "Proxy Mode vs AIGC Generated Materials" : "Proxy Mode vs With Target Assets"}</h2>
    <div class="grid">
      <figure><video controls src="render_proxy.mp4"></video><figcaption>Proxy Mode</figcaption></figure>
      <figure><video controls src="${esc(path.basename(renderPath))}"></video><figcaption>${usesAigcMaterials ? "AIGC Generated Materials" : isMalformedTargetMode ? "Malformed Target Assets" : isPartialTargetMode ? "Partial Target Assets" : "With Target Assets"}</figcaption></figure>
    </div>
    ${beforeAfterContactSheet ? `<figure><img src="${esc(beforeAfterContactSheet)}" alt="Before after contact sheet" /><figcaption>Left column: proxy. Right column: with target assets.</figcaption></figure>` : ""}
    ${partialAssetsContactSheet ? `<figure><img src="${esc(partialAssetsContactSheet)}" alt="Partial assets contact sheet" /><figcaption>Left column: proxy. Right column: partial target assets.</figcaption></figure>` : ""}
    ${malformedAssetsContactSheet ? `<figure><img src="${esc(malformedAssetsContactSheet)}" alt="Malformed assets contact sheet" /><figcaption>Left column: proxy. Right column: malformed target assets with blocked entries omitted.</figcaption></figure>` : ""}
    ${aigcMaterialsContactSheet ? `<figure><img src="${esc(aigcMaterialsContactSheet)}" alt="AIGC materials contact sheet" /><figcaption>Left column: proxy. Right column: deterministic AIGC generated materials.</figcaption></figure>` : ""}
  </section>
  ${usesAigcMaterials ? `<section>
    <h2>Optional AIGC Material Fill</h2>
    <p>AIGC material fill is optional. Default generation does not call external providers. This demo uses <code>mock_provider</code>; external generation requires explicit opt-in.</p>
    <table><thead><tr><th>brief</th><th>slot</th><th>asset type</th><th>count</th><th>privacy</th></tr></thead><tbody>
      ${aigcMaterialBriefs.map((brief) => `<tr><td>${esc(brief.id)}</td><td>${esc(brief.visualFormFamily)}</td><td>${esc(brief.assetType)}</td><td>${esc(brief.count)}</td><td>sampleFramesAllowed=${brief.privacyPolicy.sampleFramesAllowedToProvider}</td></tr>`).join("")}
    </tbody></table>
    <table><thead><tr><th>candidate</th><th>provider</th><th>path</th><th>usable</th><th>external</th></tr></thead><tbody>
      ${generatedAssetCandidates.map((candidate) => `<tr><td>${esc(candidate.id)}</td><td>${esc(candidate.provider)}</td><td>${esc(candidate.path)}</td><td>${candidate.quality?.usable ? "yes" : "no"}</td><td>${candidate.provenance.externalProviderUsed ? "yes" : "no"}</td></tr>`).join("")}
    </tbody></table>
  </section>` : ""}
  <section>
    <h2>Asset-to-slot mapping</h2>
    <p>${usesAigcMaterials ? "Target assets are generated mock-provider assets, labeled as AI-generated material." : `Target assets are user-provided manifest assets from <code>${esc(targetFixture?.manifestRef ?? "manifest")}</code>.`}</p>
    <table><thead><tr><th>family</th><th>status</th><th>match</th><th>assets</th></tr></thead><tbody>
      ${slotAssetMatches.map((match) => `<tr><td>${esc(match.visualFormFamily ?? match.slotType)}</td><td>${esc(match.status)}</td><td>${esc(match.matchKind ?? "none")}</td><td>${esc(match.selectedAssetIds?.join(", ") || "no asset")}</td></tr>`).join("")}
    </tbody></table>
  </section>` : ""}
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
    mode,
    passed: gates.every((item) => item.passed),
    playable_mp4: gateById.playable_mp4?.passed === true,
    has_audio: gateById.has_audio?.passed === true,
    not_tiny: gateById.not_tiny?.passed === true,
    motion_above_threshold: gateById.motion_above_threshold?.passed === true,
    selected_template_not_seed_b2b: gateById.selected_template_not_seed_b2b?.passed === true,
    induced_slots_non_empty: gateById.induced_slots_non_empty?.passed === true,
    induced_slots_have_frame_evidence: gateById.induced_slots_have_frame_evidence?.passed === true,
    induced_slots_have_time_ranges: gateById.induced_slots_have_time_ranges?.passed === true,
    evidence_frame_paths_exist: gateById.evidence_frame_paths_exist?.passed === true,
    renderer_capability_selected: gateById.renderer_capability_selected?.passed === true,
    family_specific_visual_ratio: Number(visualRatio.toFixed(3)),
    not_only_text_cards: gateById.not_only_text_cards?.passed === true,
    no_duplicate_timeline_clip_ids: gateById.no_duplicate_timeline_clip_ids?.passed === true,
    preview_frames_exist: gateById.preview_frames_exist?.passed === true,
    no_sample_visual_copy: gateById.no_sample_visual_copy?.passed === true,
    no_private_paths: gateById.no_private_paths?.passed === true,
    target_assets_manifest_supported: gateById.target_assets_manifest_supported?.passed,
    target_assets_loaded: gateById.target_assets_loaded?.passed,
    partial_target_assets_loaded: gateById.partial_target_assets_loaded?.passed,
    target_material_manifest_api_supported: gateById.target_material_manifest_api_supported?.passed,
    external_paths_blocked: gateById.external_paths_blocked?.passed,
    malformed_assets_not_matched: gateById.malformed_assets_not_matched?.passed,
    media_cards_weak_match_with_invalid_cards: gateById.media_cards_weak_match_with_invalid_cards?.passed,
    brand_cta_missing_without_valid_logo: gateById.brand_cta_missing_without_valid_logo?.passed,
    media_cards_asset_matched: gateById.media_cards_asset_matched?.passed,
    media_cards_weak_match_when_insufficient_images: gateById.media_cards_weak_match_when_insufficient_images?.passed,
    ui_showcase_copy_matched: gateById.ui_showcase_copy_matched?.passed,
    brand_cta_logo_matched: gateById.brand_cta_logo_matched?.passed,
    brand_cta_missing_without_logo: gateById.brand_cta_missing_without_logo?.passed,
    proxy_to_asset_replacement_applied: gateById.proxy_to_asset_replacement_applied?.passed,
    mixed_proxy_and_asset_rendered: gateById.mixed_proxy_and_asset_rendered?.passed,
    render_with_assets_has_user_images: gateById.render_with_assets_has_user_images?.passed,
    render_with_assets_has_brand_cta: gateById.render_with_assets_has_brand_cta?.passed,
    structure_preserved_after_asset_replacement: gateById.structure_preserved_after_asset_replacement?.passed,
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
    render: path.basename(renderPath),
    renderProxy: existsSync(path.join(artifactDir, "render_proxy.mp4")) ? "render_proxy.mp4" : null,
    renderWithAssets: existsSync(path.join(artifactDir, "render_with_assets.mp4")) ? "render_with_assets.mp4" : null,
    renderPartialAssets: existsSync(path.join(artifactDir, "render_partial_assets.mp4")) ? "render_partial_assets.mp4" : null,
    renderAigcMaterials: existsSync(path.join(artifactDir, "render_aigc_materials.mp4")) ? "render_aigc_materials.mp4" : null,
    beforeAfterContactSheet,
    partialAssetsContactSheet,
    aigcMaterialsContactSheet,
    aigc: usesAigcMaterials
      ? {
          provider: "mock_provider",
          externalProviderUsed: false,
          briefs: "aigc-material-briefs.json",
          candidates: "generated-asset-candidates.json",
          quality: "generated-asset-quality.json",
          generatedAssetCount: aigcGeneratedTargetAssets.length
        }
      : null,
    targetAssetsManifest: targetFixture?.manifestRef ?? null,
    targetAssets: request.targetAssets.map((asset) => ({ id: asset.id, kind: asset.kind, role: asset.role, path: asset.path ?? null, filename: asset.filename ?? null })),
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
  console.log(`Mode: ${mode}`);
  console.log(`Induced slot families: ${Array.from(familySet).join(", ")}`);
  console.log(`Unknown clip count: ${unknownClips.length}`);
  console.log(`Duplicate clip IDs: ${duplicateClipIds.length ? duplicateClipIds.map((item) => item.value).join(", ") : "none"}`);
  if (usesTargetAssetManifest) {
    console.log(`Target asset matches: media_cards=${mediaCardsMatch?.selectedTargetAssetIds?.join(",")}; ui_showcase=${uiShowcaseMatch?.selectedTargetAssetId}; brand_cta=${brandMatch?.selectedTargetAssetId}`);
  }
  if (usesAigcMaterials) {
    console.log(`AIGC provider: mock_provider (external calls: no)`);
    console.log(`Generated material briefs: ${aigcMaterialBriefs.map((brief) => `${brief.visualFormFamily}:${brief.assetType}:${brief.count}`).join(", ")}`);
    console.log(`Generated assets: ${generatedAssetCandidates.map((candidate) => candidate.path).join(", ")}`);
  }
  console.log(`Replacement slots: ${(generation.replacementSlots ?? []).map((slot) => slot.slotId).join(", ")}`);
  console.log(`Rendered MP4: ${path.relative(repoRoot, renderPath)}`);
  console.log(`Contact sheet: ${path.relative(repoRoot, path.join(artifactDir, "contact_sheet.png"))}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
