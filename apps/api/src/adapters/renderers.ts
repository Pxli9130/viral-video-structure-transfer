import { spawn } from "node:child_process";
import { createReadStream, existsSync, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { HtmlPreviewRenderer } from "@vvst/renderer";
import {
  nowIso,
  stableId,
  type BBoxNormObject,
  type RenderClipPreviewFrame,
  type RenderRecipeLayer,
  type RenderRecipeMediaLayer,
  type RenderRecipeMotionAtomLayer,
  type RenderRecipeTextLayer,
  type RenderOutput,
  type RendererAdapter,
  type RendererBackend,
  type RendererTarget,
  type Timeline,
  type TimelineClip
} from "@vvst/shared";

export { HtmlPreviewRenderer };

function resolveFfmpegBin(): string {
  const explicit = process.env.FFMPEG_PATH;
  if (explicit && explicit !== "ffmpeg") return explicit;
  const condaBase = process.env.CONDA_BASE ?? "/home/pxli/anaconda3";
  const condaEnv = process.env.VIRAL_CONDA_ENV ?? "viral";
  const condaBin = path.join(condaBase, "envs", condaEnv, "bin", "ffmpeg");
  if (existsSync(condaBin)) return condaBin;
  return "ffmpeg";
}

const FFMPEG_BIN = resolveFfmpegBin();
const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function resolveRemotionBrowserExecutable(): string | undefined {
  const explicit = process.env.REMOTION_BROWSER_EXECUTABLE;
  const home = process.env.HOME ?? "/home/pxli";
  const candidates = [
    explicit,
    path.join(API_ROOT, "node_modules", ".remotion", "chrome-headless-shell", "linux64", "chrome-headless-shell-linux64", "chrome-headless-shell"),
    path.resolve(process.cwd(), "apps", "api", "node_modules", ".remotion", "chrome-headless-shell", "linux64", "chrome-headless-shell-linux64", "chrome-headless-shell"),
    path.join(home, ".cache", "ms-playwright", "chromium_headless_shell-1208", "chrome-headless-shell-linux64", "chrome-headless-shell")
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => existsSync(candidate));
}

function resolveCjkFontFile(): string | undefined {
  const explicit = process.env.FFMPEG_FONT_FILE;
  if (explicit && existsSync(explicit)) return explicit;
  // Order matters: prefer fonts that ship BOTH CJK + Latin so subtitles like
  // "便携式加湿器: fits 办公室..." render without tofu boxes for the punctuation/ASCII.
  // DroidSansFallback is CJK-only and is therefore intentionally NOT used here.
  const candidates = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/mnt/c/Windows/Fonts/msyh.ttc",
    "/mnt/c/Windows/Fonts/simhei.ttf",
    "/mnt/c/Windows/Fonts/NotoSansSC-VF.ttf",
    "/usr/share/fonts/truetype/arphic/ukai.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf"
  ];
  return candidates.find((path) => existsSync(path));
}

const CJK_FONT_FILE = resolveCjkFontFile();

function escapeFontFilePath(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

const FONT_FILE_ARG = CJK_FONT_FILE ? `fontfile=${escapeFontFilePath(CJK_FONT_FILE)}:` : "";

function mimeForAssetExt(ext: string): string | undefined {
  switch (ext.toLowerCase()) {
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".mp4":
    case ".m4v":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    default:
      return undefined;
  }
}

async function remotionAssetSrc(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const mime = mimeForAssetExt(ext);
  if (!mime) return pathToFileURL(filePath).href;
  const encoded = await fs.readFile(filePath, "base64");
  return `data:${mime};base64,${encoded}`;
}

export interface AssetPathResolver {
  resolve(assetId: string): string | undefined;
}

function runFfmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
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
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function escapeDrawText(text: string): string {
  const normalized = text.replace(/[\r\n]+/g, " ").trim();
  const maxLength = /[\u4e00-\u9fff]/.test(normalized) ? 22 : 52;
  const truncated =
    normalized.length <= maxLength
      ? normalized
      : `${normalized.slice(0, maxLength - 3).replace(/\s+\S*$/, "") || normalized.slice(0, maxLength - 3)}...`;
  // FFmpeg filter argument escaping for drawtext text= value, even inside single quotes:
  // backslash, single quote and the filter-arg-separator colon all need escaping.
  return truncated
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "’");
}

function pickResolution(timeline: Timeline): { width: number; height: number } {
  switch (timeline.aspectRatio) {
    case "9:16":
      return { width: 720, height: 1280 };
    case "16:9":
      return { width: 1280, height: 720 };
    case "1:1":
    default:
      return { width: 720, height: 720 };
  }
}

function ffmpegColor(hex: string | undefined, fallback: string): string {
  if (!hex) return fallback;
  const rgba = /^rgba?\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})(?:,\s*([0-9.]+))?\)$/i.exec(hex.trim());
  if (rgba) {
    const channel = (value: string) => Math.max(0, Math.min(255, Number(value))).toString(16).padStart(2, "0");
    const alpha = rgba[4] !== undefined ? `@${Math.max(0, Math.min(1, Number(rgba[4]))).toFixed(2)}` : "";
    return `0x${channel(rgba[1])}${channel(rgba[2])}${channel(rgba[3])}${alpha}`;
  }
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return fallback;
  return `0x${hex.slice(1)}`;
}

const ROLE_HEX: Record<string, string> = {
  black: "#05060a",
  dark: "#05060a",
  white: "#f5f5f5",
  red: "#e11d2a",
  yellow: "#f5c518",
  amber: "#f5c518",
  blue: "#22d3ee",
  cyan: "#22d3ee",
  teal: "#14b8a6",
  purple: "#a855f7",
  pink: "#f472b6",
  orange: "#f97316",
  green: "#22c55e"
};

type RenderPalette = {
  bg: string;
  primary: string;
  accent: string;
  secondary: string;
  cool: string;
  text: string;
  muted: string;
};

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  const shortHex = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
  if (shortHex) return `#${shortHex[1]}${shortHex[1]}${shortHex[2]}${shortHex[2]}${shortHex[3]}${shortHex[3]}`;
  if (/^0x[0-9a-f]{6}$/i.test(text)) return `#${text.slice(2)}`;
  return ROLE_HEX[text] ?? undefined;
}

function paletteEntries(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(paletteEntries);
  if (typeof value !== "string") return [];
  const exact = normalizeHexColor(value);
  if (exact) return [exact];
  return value
    .split(/[,/|+_\s-]+/)
    .map((part) => normalizeHexColor(part))
    .filter((color): color is string => Boolean(color));
}

function colorChannel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(1 + offset, 3 + offset), 16);
}

function colorDistance(hex: string, target: [number, number, number]): number {
  const dr = colorChannel(hex, 0) - target[0];
  const dg = colorChannel(hex, 2) - target[1];
  const db = colorChannel(hex, 4) - target[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function luminance(hex: string): number {
  return 0.2126 * colorChannel(hex, 0) + 0.7152 * colorChannel(hex, 2) + 0.0722 * colorChannel(hex, 4);
}

function pickClosest(colors: string[], target: [number, number, number], fallback: string): string {
  return colors.length
    ? colors.slice().sort((a, b) => colorDistance(a, target) - colorDistance(b, target))[0]
    : fallback;
}

function timelinePalette(timeline: Timeline): RenderPalette {
  const learned = paletteEntries(timeline.renderPlan?.renderRecipe?.global?.palette);
  const renderBackground = normalizeHexColor(timeline.renderPlan?.background);
  const defaults = ["#05060a", "#e11d2a", "#f5c518", "#f5f5f5", "#22d3ee", "#a855f7"];
  const unique: string[] = [];
  for (const color of [renderBackground, ...learned, ...defaults]) {
    if (color && !unique.includes(color)) unique.push(color);
  }
  const text = unique.find((color) => luminance(color) > 185) ?? "#f5f5f5";
  return {
    bg: ffmpegColor(unique[0], "0x05060a"),
    primary: ffmpegColor(unique[1], "0xe11d2a"),
    accent: ffmpegColor(unique[2], "0xf5c518"),
    secondary: ffmpegColor(unique[3], "0xa855f7"),
    // Prefer the sample's learned palette for the "cool" accent so per-sample color identity reaches
    // the bright bars/streaks. Falls back to the generic set (which contains #22d3ee) when no learned
    // palette is present — so goldens whose generic palette already includes cyan are unchanged.
    cool: ffmpegColor(pickClosest(learned.length ? learned : unique, [34, 211, 238], "#22d3ee"), "0x22d3ee"),
    text: ffmpegColor(text, "white"),
    muted: ffmpegColor(unique[4], "0x334155")
  };
}

function backgroundFor(clip: TimelineClip, timeline: Timeline): string {
  const palette = timelinePalette(timeline);
  const base = palette.bg;
  if (timeline.renderPlan?.renderRecipe?.global?.palette?.length) return base;
  const packagingStyle = String(timeline.renderPlan?.adapterOptions?.packagingStyle ?? "");
  if (base && (packagingStyle === "clean" || packagingStyle === "bold")) return base;
  switch (clip.role) {
    case "hook":
      return "0x0f172a";
    case "body":
      return "0x111827";
    case "proof":
      return "0x0f766e";
    case "cta":
      return "0xb91c1c";
    default:
      return "0x1f2937";
  }
}

interface DrawTextStyle {
  fontColor: string;
  boxColor: string;
  sourceFontSize: number;
  cardFontSize: number;
}

function drawTextStyle(timeline: Timeline): DrawTextStyle {
  const packagingStyle = String(timeline.renderPlan?.adapterOptions?.packagingStyle ?? "");
  if (packagingStyle === "clean") {
    return { fontColor: "0x111827", boxColor: "white@0.72", sourceFontSize: 40, cardFontSize: 44 };
  }
  if (packagingStyle === "bold") {
    return { fontColor: "white", boxColor: "0x7f1d1d@0.78", sourceFontSize: 46, cardFontSize: 52 };
  }
  return { fontColor: "white", boxColor: "black@0.45", sourceFontSize: 34, cardFontSize: 36 };
}

function drawTextFilter(text: string, style: DrawTextStyle, size: number, y: string): string {
  return `drawtext=${FONT_FILE_ARG}text='${text}':fontcolor=${style.fontColor}:fontsize=${size}:x=(w-text_w)/2:y=${y}:box=1:boxcolor=${style.boxColor}:boxborderw=18`;
}

function recipeLayersForClip(timeline: Timeline, clip: TimelineClip): RenderRecipeLayer[] {
  return (timeline.renderPlan?.renderRecipe?.layers ?? []).filter((layer) =>
    layer.clipId === clip.id ||
    (layer.startSec < clip.startSec + clip.durationSec && layer.startSec + layer.durationSec > clip.startSec)
  );
}

function recipeTextLayerForClip(timeline: Timeline, clip: TimelineClip): RenderRecipeTextLayer | undefined {
  return recipeLayersForClip(timeline, clip)
    .filter((layer): layer is RenderRecipeTextLayer => layer.type === "text")
    .sort((a, b) => b.zIndex - a.zIndex)[0];
}

function recipeMediaLayerForClip(timeline: Timeline, clip: TimelineClip): RenderRecipeMediaLayer | undefined {
  return recipeLayersForClip(timeline, clip)
    .filter((layer): layer is RenderRecipeMediaLayer => layer.type === "media")
    .sort((a, b) => b.zIndex - a.zIndex)[0];
}

function measureTextUnits(text: string): number {
  return Array.from(text.replace(/\\:/g, ":").replace(/\\\\/g, "\\")).reduce((sum, ch) => {
    if (/[\u4e00-\u9fff]/.test(ch)) return sum + 1;
    if (/\s/.test(ch)) return sum + 0.32;
    if (/[A-Z0-9]/.test(ch)) return sum + 0.68;
    return sum + 0.55;
  }, 0);
}

function fitFontSizeToBox(text: string, baseSize: number, boxW: number, boxH: number): number {
  const units = Math.max(1, measureTextUnits(text));
  const fitWidth = Math.floor(boxW / Math.max(0.56, units * 0.72));
  const fitHeight = Math.floor(boxH * 0.68);
  return Math.max(12, Math.min(baseSize, fitWidth, fitHeight));
}

function bboxObjectToArray(box: BBoxNormObject | undefined): [number, number, number, number] | undefined {
  return box ? [box.x, box.y, box.w, box.h] : undefined;
}

function recipeDrawTextFilter(text: string, layer: RenderRecipeTextLayer | undefined, fallbackStyle: DrawTextStyle, W: number, H: number): string | undefined {
  if (!text) return undefined;
  const box = layer?.layout.bboxNorm;
  if (!box) return drawTextFilter(text, fallbackStyle, fallbackStyle.sourceFontSize, "h-(text_h*2)");
  const boxW = Math.max(24, Math.round(W * box.w));
  const boxH = Math.max(24, Math.round(H * box.h));
  const baseSize = Math.max(12, Math.min(96, Math.round(H * (layer.typography.fontSizeRatio ?? Math.min(0.11, box.h * 0.72)))));
  const size = fitFontSizeToBox(text, baseSize, boxW, boxH);
  const color = ffmpegColor(layer.typography.color, layer.typography.colorRole === "accent" ? "0xf5c518" : layer.typography.colorRole === "primary" ? "0xe11d2a" : fallbackStyle.fontColor);
  const left = Math.round(W * box.x);
  const top = Math.round(H * box.y);
  const alignExpr = layer.layout.align === "left"
    ? `${left}`
    : layer.layout.align === "right"
      ? `${left}+${boxW}-text_w`
      : `${left}+(${boxW}-text_w)/2`;
  const yExpr = `${top}+(${boxH}-text_h)/2`;
  const shadow = layer.typography.shadow ? `:shadowcolor=${ffmpegColor(layer.typography.shadow.color, "black@0.75")}:shadowx=${Math.round(W * (layer.typography.shadow.dxRatio ?? 0.004))}:shadowy=${Math.round(H * (layer.typography.shadow.dyRatio ?? 0.004))}` : "";
  return `drawtext=${FONT_FILE_ARG}text='${text}':fontcolor=${color}:fontsize=${size}:x=${alignExpr}:y=${yExpr}:box=1:boxcolor=${fallbackStyle.boxColor}:boxborderw=12${shadow}`;
}

function motionAtomFiltersFromRecipe(timeline: Timeline, clip: TimelineClip, W: number, H: number, palette: RenderPalette): string[] {
  const atoms = recipeLayersForClip(timeline, clip)
    .filter((layer): layer is RenderRecipeMotionAtomLayer => layer.type === "motion_atom");
  const filters: string[] = [];
  for (const layer of atoms) {
    const localStart = Math.max(0, layer.startSec - clip.startSec);
    const localEnd = Math.min(clip.durationSec, layer.startSec + layer.durationSec - clip.startSec);
    if (localEnd <= 0 || localStart >= clip.durationSec) continue;
    const enable = `between(t\\,${localStart.toFixed(3)}\\,${localEnd.toFixed(3)})`;
    if (layer.atom.kind === "parametric_ribbon_surface") {
      const band = Math.max(10, Math.round(W * layer.atom.thicknessRatio));
      const opacity = Math.max(0.12, Math.min(0.82, layer.atom.opacity));
      if (layer.atom.path === "s_curve_orbit") {
        const ribbonW = Math.max(12, Math.round(band * 0.72));
        filters.push(`drawbox=x='${Math.round(W * 0.5)}+${Math.round(W * 0.22)}*sin(t*1.2)-${Math.round(ribbonW / 2)}':y='mod(t*${Math.round(H * 0.28)}\\,ih+${Math.round(H * 0.44)})-${Math.round(H * 0.22)}':w=${ribbonW}:h=${Math.round(H * 0.74)}:color=${palette.cool}@${opacity.toFixed(2)}:t=fill:enable='${enable}'`);
        filters.push(`drawbox=x='${Math.round(W * 0.5)}+${Math.round(W * 0.22)}*sin(t*1.2)+${Math.round(ribbonW * 0.15)}':y='mod(t*${Math.round(H * 0.28)}\\,ih+${Math.round(H * 0.44)})-${Math.round(H * 0.2)}':w=${Math.max(3, Math.round(ribbonW * 0.18))}:h=${Math.round(H * 0.64)}:color=white@0.32:t=fill:enable='${enable}'`);
      } else if (layer.atom.path === "horizontal_wave") {
        filters.push(`drawbox=x='mod(t*${Math.round(W * 0.42)}\\,iw+${Math.round(W * 0.45)})-${Math.round(W * 0.22)}':y='${Math.round(H * 0.42)}+${Math.round(H * 0.08)}*sin(t*3.1)':w=${Math.round(W * 0.62)}:h=${band}:color=${palette.cool}@${opacity.toFixed(2)}:t=fill:enable='${enable}'`);
        filters.push(`drawbox=x='mod(t*${Math.round(W * 0.42)}\\,iw+${Math.round(W * 0.45)})-${Math.round(W * 0.18)}':y='${Math.round(H * 0.42)}+${Math.round(H * 0.08)}*sin(t*3.1)+${Math.round(band * 0.42)}':w=${Math.round(W * 0.48)}:h=${Math.max(3, Math.round(band * 0.16))}:color=white@0.35:t=fill:enable='${enable}'`);
      } else {
        filters.push(`drawbox=x='mod(t*${Math.round(W * 0.58)}\\,iw+${Math.round(W * 0.55)})-${Math.round(W * 0.28)}':y='${Math.round(H * 0.22)}+mod(t*${Math.round(H * 0.24)}\\,${Math.round(H * 0.62)})':w=${Math.round(W * 0.7)}:h=${band}:color=${palette.cool}@${opacity.toFixed(2)}:t=fill:enable='${enable}'`);
        filters.push(`drawbox=x='mod(t*${Math.round(W * 0.58)}\\,iw+${Math.round(W * 0.55)})-${Math.round(W * 0.2)}':y='${Math.round(H * 0.25)}+mod(t*${Math.round(H * 0.24)}\\,${Math.round(H * 0.58)})+${Math.round(band * 0.36)}':w=${Math.round(W * 0.46)}:h=${Math.max(3, Math.round(band * 0.16))}:color=white@0.34:t=fill:enable='${enable}'`);
      }
    } else if (layer.atom.kind === "impact_flash") {
      filters.push(`drawbox=x=0:y=0:w=iw:h=ih:color=0xffffff@0.34:t=fill:enable='${enable}*lt(mod(t\\,0.32)\\,0.08)'`);
    } else if (layer.atom.kind === "light_sweep" || layer.atom.kind === "text_sweep_mask") {
      filters.push(`drawbox=x='mod(t*${Math.round(W * 0.75)}\\,iw+${Math.round(W * 0.35)})-${Math.round(W * 0.18)}':y=0:w=${Math.round(W * 0.18)}:h=ih:color=white@0.24:t=fill:enable='${enable}'`);
    }
  }
  return filters;
}

function styleValueFromClip(clip: TimelineClip, key: string): unknown {
  for (const layer of clip.layers) {
    if (layer.style && Object.prototype.hasOwnProperty.call(layer.style, key)) {
      return layer.style[key];
    }
  }
  return undefined;
}

function stringStyleValue(clip: TimelineClip, key: string): string | undefined {
  const value = styleValueFromClip(clip, key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayStyleValue(clip: TimelineClip, key: string): string[] {
  const value = styleValueFromClip(clip, key);
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function targetAssetIdsForClip(clip: TimelineClip): string[] {
  const ids = new Set<string>();
  if (clip.sourceAssetId) ids.add(clip.sourceAssetId);
  for (const layer of clip.layers) {
    if (layer.assetId) ids.add(layer.assetId);
    const styleValue = layer.style?.targetAssetIds;
    if (Array.isArray(styleValue)) {
      for (const item of styleValue) {
        if (typeof item === "string" && item.trim()) ids.add(item.trim());
      }
    }
  }
  return Array.from(ids);
}

function clipUsesAigcGeneratedMaterial(clip: TimelineClip): boolean {
  return clip.layers.some((layer) =>
    layer.style?.fillStrategy === "aigc_generated_asset" ||
    layer.style?.materialSource === "aigc_generated_material"
  );
}

function mgMotionDecorationFilters(timeline: Timeline, width: number, height: number, palette: RenderPalette): string[] {
  const packagingStyle = String(timeline.renderPlan?.adapterOptions?.packagingStyle ?? "");
  if (packagingStyle !== "mg_motion") return [];
  const top = Math.round(height * 0.15);
  const mid = Math.round(height * 0.72);
  const lower = Math.round(height * 0.82);
  // v1.3: never burn engine/debug keywords ("STRUCTURE / REMIX / TIMELINE / AIGC") onto a product
  // ad frame — keep only subtle MG accent bands (their colors are palette-driven elsewhere).
  return [
    `drawbox=x=0:y=${top}:w=${width}:h=26:color=${palette.cool}@0.22:t=fill`,
    `drawbox=x=0:y=${top + 34}:w=${width}:h=18:color=${palette.secondary}@0.24:t=fill`,
    `drawbox=x=0:y=${mid}:w=${width}:h=22:color=${palette.accent}@0.25:t=fill`,
    `drawbox=x=0:y=${lower}:w=${width}:h=16:color=${palette.primary}@0.24:t=fill`
  ];
}

function proxyPlaceholderFilters(clip: TimelineClip, width: number, height: number, style: DrawTextStyle, palette: RenderPalette): string[] {
  const proxyLayer = clip.layers.find((layer) => layer.style?.fillStrategy === "proxy_placeholder");
  const visualForm = String(proxyLayer?.style?.visualForm ?? "");
  const visualFormFamily = String(proxyLayer?.style?.visualFormFamily ?? clip.visualFormFamily ?? "");
  // Render the family-specific proxy whenever a clip carries a rich visual-form family,
  // not only when the gap-fill strategy is proxy_placeholder. Otherwise ui_showcase /
  // kinetic_typography / geometric_mg clips silently degrade to plain drawtext text cards.
  const richFamilies = new Set([
    "media_cards", "ui_showcase", "kinetic_typography",
    "geometric_mg", "brand_cta", "live_action_montage", "object_motion"
  ]);
  const familyDriven = richFamilies.has(visualFormFamily);
  if (clip.gapFillStrategy !== "proxy_placeholder" && !proxyLayer && !familyDriven) return [];
  const placeholder = (clip.placeholderSpec ?? proxyLayer?.style?.placeholderSpec ?? {}) as {
    label?: string;
    color?: string;
    shape?: string;
  };
  const featureList = stringArrayStyleValue(clip, "featureList");
  const targetCopy = stringStyleValue(clip, "targetCopy");
  const brandName = stringStyleValue(clip, "brandName");
  const cta = stringStyleValue(clip, "cta");
  const replacementSlotId = String(clip.replacementSlotId ?? proxyLayer?.style?.replacementSlotId ?? "");
  const familyLabels: Record<string, string> = {
    media_cards: "媒体卡片",
    ui_showcase: "功能展示",
    kinetic_typography: "动态文字",
    geometric_mg: "霓虹几何",
    brand_cta: "品牌 CTA",
    live_action_montage: "动作混剪",
    object_motion: "主视觉"
  };
  // Clean display label: prefer the clip's real subtitle/copy; otherwise a clean family name.
  // Never surface debug words like "proxy"/"placeholder" in the rendered output.
  const rawLabel = String(placeholder.label ?? familyLabels[visualFormFamily] ?? "主视觉");
  const cleanLabel = rawLabel.replace(/\s*(proxy|placeholder|占位|代理)\b/gi, "").replace(/\s{2,}/g, " ").trim() || familyLabels[visualFormFamily] || "主视觉";
  const displayText = clip.subtitleText?.trim() || clip.visualIntent?.trim() || cleanLabel;
  const isMediaCards = visualFormFamily === "media_cards" || visualForm === "stacked_media_cards" || /card stack|media card|collage/i.test(rawLabel);
  const isUiShowcase = visualFormFamily === "ui_showcase" || visualForm === "feature_list_ui" || /feature list|ui|tool list/i.test(rawLabel);
  const isKinetic = visualFormFamily === "kinetic_typography" || visualForm === "kinetic_text_card" || /kinetic|typography|bold text/i.test(rawLabel);
  const isGeometric = visualFormFamily === "geometric_mg" || visualForm === "neon_geometry_frame" || /neon|geometry|shape/i.test(rawLabel);
  const isBrandCta = visualFormFamily === "brand_cta" || visualForm === "logo_hold" || /logo|cta|brand/i.test(rawLabel);
  const isRotatingHero =
    visualFormFamily === "object_motion" ||
    replacementSlotId.includes("rotating_hero") ||
    visualForm === "rotating_3d_object" ||
    /rotating|hero object|helmet|head|logo/i.test(rawLabel);
  const isMontage =
    visualFormFamily === "live_action_montage" ||
    replacementSlotId.includes("beat_sync") ||
    replacementSlotId.includes("match_cut") ||
    visualForm === "action_montage_sequence" ||
    visualForm === "match_cut_sequence" ||
    /montage|match|action|beat/i.test(rawLabel);
  const proxyColor = ffmpegColor(normalizeHexColor(placeholder.color), palette.primary);
  const size = Math.round(Math.min(width, height) * 0.34);
  const x = Math.round((width - size) / 2);
  const y = Math.round(height * 0.27);
  const badgeY = Math.round(y + size + height * 0.05);
  const label = escapeDrawText(displayText);

  if (isMediaCards) {
    const cardW = Math.round(width * 0.46);
    const cardH = Math.round(height * 0.18);
    const cx = Math.round(width * 0.5);
    const startY = Math.round(height * 0.24);
    const spread = `22*sin(2*PI*t*0.7)`;
    return [
      `drawbox=x='${cx - Math.round(cardW * 0.72)}-${spread}':y=${startY + 74}:w=${cardW}:h=${cardH}:color=0x111827@0.86:t=fill`,
      `drawbox=x='${cx - Math.round(cardW * 0.5)}':y=${startY + 24}:w=${cardW}:h=${cardH}:color=${proxyColor}@0.86:t=fill`,
      `drawbox=x='${cx - Math.round(cardW * 0.25)}+${spread}':y=${startY + 120}:w=${cardW}:h=${cardH}:color=${palette.cool}@0.78:t=fill`,
      `drawbox=x=${cx - Math.round(cardW * 0.5)}:y=${startY + 24}:w=${cardW}:h=10:color=white@0.72:t=fill`,
      `drawbox=x=${cx - Math.round(cardW * 0.38)}:y=${startY + 82}:w=${Math.round(cardW * 0.62)}:h=8:color=white@0.42:t=fill`,
      drawTextFilter(escapeDrawText("媒体卡片"), { ...style, boxColor: "black@0.58", fontColor: "white" }, 30, String(Math.max(24, y - 82))),
      drawTextFilter(label, { ...style, boxColor: "black@0.66", fontColor: "white" }, 34, String(badgeY))
    ];
  }

  if (isUiShowcase) {
    const panelW = Math.round(width * 0.66);
    const panelH = Math.round(height * 0.44);
    const panelX = Math.round((width - panelW) / 2);
    const panelY = Math.round(height * 0.22);
    return [
      `drawbox=x=${panelX}:y=${panelY}:w=${panelW}:h=${panelH}:color=0x0f172a@0.88:t=fill`,
      `drawbox=x=${panelX}:y=${panelY}:w=${panelW}:h=${panelH}:color=${palette.cool}@0.82:t=5`,
      ...Array.from({ length: 5 }).flatMap((_, index) => {
        const rowY = panelY + 52 + index * 72;
        const feature = featureList[index];
        return [
          `drawbox=x=${panelX + 38}:y=${rowY}:w=${panelW - 76}:h=42:color=white@0.1:t=fill`,
          feature
            ? `drawtext=${FONT_FILE_ARG}text='${escapeDrawText(feature)}':fontcolor=0xf8fafc:fontsize=23:x=${panelX + 66}:y=${rowY + 8}:box=0`
            : `drawbox=x=${panelX + 52}:y=${rowY + 12}:w='${Math.round(panelW * (0.34 + index * 0.06))}+${Math.round(panelW * 0.08)}*gt(sin(2*PI*t*0.8+${index}),0)':h=12:color=${palette.cool}@0.74:t=fill`
        ];
      }),
      drawTextFilter(label, { ...style, boxColor: "black@0.66", fontColor: "white" }, 34, String(badgeY))
    ];
  }

  if (isKinetic) {
    // Use the clip's REAL product subtitle/copy as the kinetic headline (not the family label).
    const kineticLabel = escapeDrawText(displayText);
    const bandY = Math.round(height * 0.32);
    const bandH = Math.round(height * 0.3);
    const barW = Math.round(width * 0.52);
    const barX = Math.round((width - barW) / 2);
    const midY = Math.round(height * 0.46);
    const scale = "1+0.16*sin(2*PI*t*1.6)";
    return [
      `drawbox=x=0:y=${bandY}:w=${width}:h=${bandH}:color=0x111827@0.5:t=fill`,
      `drawbox=x='${barX}':y=${midY - 64}:w='${barW}*${scale}':h=12:color=${palette.secondary}@0.88:t=fill`,
      `drawbox=x='${barX}':y=${midY + 70}:w='${barW}*${scale}':h=12:color=${palette.cool}@0.88:t=fill`,
      `drawbox=x='mod(t*${Math.round(width * 1.1)},iw)':y=${bandY}:w=26:h=${bandH}:color=white@0.1:t=fill`,
      drawTextFilter(kineticLabel, { ...style, boxColor: "black@0.0", fontColor: "0xf8fafc" }, 52, String(midY - 30))
    ];
  }

  if (isGeometric) {
    const box = Math.round(Math.min(width, height) * 0.42);
    const gx = Math.round((width - box) / 2);
    const gy = Math.round(height * 0.24);
    return [
      `drawbox=x=${gx}:y=${gy}:w=${box}:h=${box}:color=${palette.secondary}@0.18:t=8`,
      `drawbox=x='${gx}+${Math.round(box * 0.16)}*sin(2*PI*t*0.8)':y=${gy + Math.round(box * 0.14)}:w=${Math.round(box * 0.68)}:h=8:color=${palette.cool}@0.88:t=fill`,
      `drawbox=x=${gx + Math.round(box * 0.1)}:y='${gy}+${Math.round(box * 0.16)}*cos(2*PI*t*0.8)':w=8:h=${Math.round(box * 0.78)}:color=${palette.accent}@0.72:t=fill`,
      `drawbox=x=${gx + Math.round(box * 0.24)}:y=${gy + Math.round(box * 0.24)}:w=${Math.round(box * 0.52)}:h=${Math.round(box * 0.52)}:color=0xffffff@0.08:t=fill`,
      drawTextFilter(label, { ...style, boxColor: "black@0.66", fontColor: "white" }, 34, String(badgeY))
    ];
  }

  if (isBrandCta) {
    const logo = Math.round(Math.min(width, height) * 0.24);
    const lx = Math.round((width - logo) / 2);
    const ly = Math.round(height * 0.28);
    return [
      `drawbox=x=${lx}:y=${ly}:w=${logo}:h=${logo}:color=white@0.92:t=fill`,
      `drawbox=x=${lx}:y=${ly}:w=${logo}:h=${logo}:color=${proxyColor}@0.8:t=8`,
      `drawbox=x=${lx + Math.round(logo * 0.22)}:y=${ly + Math.round(logo * 0.44)}:w=${Math.round(logo * 0.56)}:h=${Math.round(logo * 0.13)}:color=${proxyColor}@0.9:t=fill`,
      `drawbox=x=${Math.round(width * 0.2)}:y=${ly + logo + 78}:w=${Math.round(width * 0.6)}:h=48:color=${proxyColor}@0.72:t=fill`,
      drawTextFilter(escapeDrawText(brandName ?? cleanLabel), { ...style, boxColor: "black@0.66", fontColor: "white" }, 34, String(badgeY)),
      ...(cta ? [drawTextFilter(escapeDrawText(cta), { ...style, boxColor: "black@0.42", fontColor: "white" }, 28, String(badgeY + 78))] : [])
    ];
  }

  if (isRotatingHero) {
    const orbitX = `(iw-${size})/2+${Math.round(size * 0.28)}*sin(2*PI*t*0.72)`;
    const orbitY = `${y}+${Math.round(size * 0.11)}*cos(2*PI*t*0.72)`;
    const visorY = `${y + Math.round(size * 0.32)}+${Math.round(size * 0.05)}*cos(2*PI*t*0.72)`;
    const shineX = `(iw-${size})/2+${Math.round(size * 0.63)}+${Math.round(size * 0.22)}*sin(2*PI*t*0.72)`;
    return [
      `drawbox=x=${x - 48}:y=${y - 54}:w=${size + 96}:h=${size + 108}:color=white@0.08:t=fill`,
      `drawbox=x=${orbitX}:y=${orbitY}:w=${size}:h=${size}:color=${proxyColor}@0.88:t=fill`,
      `drawbox=x=${orbitX}:y=${orbitY}:w=${size}:h=${size}:color=white@0.88:t=10`,
      `drawbox=x=(iw-${size})/2+${Math.round(size * 0.17)}:y=${visorY}:w=${Math.round(size * 0.66)}:h=${Math.round(size * 0.16)}:color=black@0.42:t=fill`,
      `drawbox=x=${shineX}:y=${y + Math.round(size * 0.12)}:w=${Math.round(size * 0.12)}:h=${Math.round(size * 0.58)}:color=white@0.32:t=fill`,
      `drawbox=x=0:y=${Math.round(height * 0.12)}:w='${Math.round(width * 0.36)}+${Math.round(width * 0.18)}*sin(2*PI*t*2)':h=8:color=${proxyColor}@0.52:t=fill`,
      `drawbox=x=iw-${Math.round(width * 0.46)}:y=${Math.round(height * 0.82)}:w='${Math.round(width * 0.32)}+${Math.round(width * 0.14)}*cos(2*PI*t*2)':h=10:color=${palette.cool}@0.46:t=fill`,
      drawTextFilter(label, { ...style, boxColor: "black@0.66", fontColor: "white" }, 34, String(badgeY))
    ];
  }

  if (isMontage) {
    const cardW = Math.round(width * 0.68);
    const cardH = Math.round(height * 0.16);
    const cardX = Math.round((width - cardW) / 2);
    const cardY = Math.round(height * 0.28);
    const pulse = `1+0.08*sin(2*PI*t*2)`;
    return [
      `drawbox=x=${cardX}:y=${cardY}:w=${cardW}:h=${cardH}:color=${proxyColor}@0.78:t=fill`,
      `drawbox=x=${cardX - 20}:y=${cardY + cardH + 28}:w=${Math.round(cardW * 0.7)}:h=${cardH}:color=0x111827@0.82:t=fill`,
      `drawbox=x=${cardX + Math.round(cardW * 0.26)}:y=${cardY + Math.round(cardH * 2.25)}:w=${Math.round(cardW * 0.62)}:h=${cardH}:color=${palette.accent}@0.72:t=fill`,
      `drawbox=x=${cardX}:y=${cardY}:w='${cardW}*${pulse}':h=8:color=white@0.72:t=fill`,
      `drawbox=x=${cardX}:y=${cardY + cardH + 28}:w='${Math.round(cardW * 0.7)}*${pulse}':h=8:color=${palette.cool}@0.78:t=fill`,
      `drawbox=x=${cardX + Math.round(cardW * 0.26)}:y=${cardY + Math.round(cardH * 2.25)}:w='${Math.round(cardW * 0.62)}*${pulse}':h=8:color=white@0.78:t=fill`,
      `drawbox=x='mod(t*${Math.round(width * 1.8)},iw)':y=${Math.round(height * 0.2)}:w=34:h=${Math.round(height * 0.66)}:color=white@0.14:t=fill`,
      drawTextFilter(label, { ...style, boxColor: "black@0.66", fontColor: "white" }, 34, String(badgeY))
    ];
  }

  return [
    `drawbox=x=${x - 18}:y=${y - 18}:w=${size + 36}:h=${size + 36}:color=white@0.16:t=fill`,
    `drawbox=x=${x}:y=${y}:w=${size}:h=${size}:color=${proxyColor}@0.92:t=fill`,
    `drawbox=x=${x}:y=${y}:w=${size}:h=${size}:color=white@0.86:t=8`,
    drawTextFilter(label, { ...style, boxColor: "black@0.62", fontColor: "white" }, 34, String(badgeY))
  ];
}

export interface FFmpegRendererOptions {
  generatedDir: string;
  assetResolver: AssetPathResolver;
  preferSourceClips?: boolean;
  /** User-facing output file basename ("theme_sampleName_timestamp", already sanitized). renderId stays the internal key. */
  outputBasename?: string;
}

// ---- beat-cut visual-grammar helpers (shared by the generic primitive + the hero intro) ----

/** A strong moving streak field — the motion bed every beat-cut clip rides so even text clips are
 * not static. `energy` scales count/alpha (montage/hero use the strongest field). */
function streakBedFilters(W: number, energy: "calm" | "strong" | "montage", palette: RenderPalette, speedScale = 1): string[] {
  const out: string[] = [];
  const cfg = energy === "montage" ? { n: 9, w: 0.08, a: 0.6, warm: true } : energy === "strong" ? { n: 8, w: 0.06, a: 0.5, warm: false } : { n: 7, w: 0.05, a: 0.42, warm: false };
  const barW = Math.max(6, Math.round(W * cfg.w));
  for (let i = 0; i < cfg.n; i += 1) {
    // speedScale ties the motion-bed tempo to the sample's BPM (default 120 → ×1.0), so a faster
    // sample renders visibly faster streaks than a calmer one.
    const speed = Math.round(W * (0.5 + i * 0.32) * speedScale);
    const off = Math.round((i * (W + barW)) / cfg.n);
    const color = cfg.warm && i % 3 === 0 ? palette.accent : i % 2 ? palette.secondary : palette.cool;
    out.push(`drawbox=x='mod(t*${speed}+${off}\\,iw+${barW})-${barW}':y=0:w=${barW}:h=ih:color=${color}@${cfg.a}:t=fill`);
  }
  return out;
}

/** Animated bottom beat-EQ bars (yellow/orange/red) — red/yellow pixels + per-frame motion. */
function beatEqFilters(W: number, H: number, beatHz: string, palette: RenderPalette, tall = false): string[] {
  const out: string[] = [];
  const eqN = 13;
  const eqBand = Math.round(H * (tall ? 0.1 : 0.075));
  const eqGap = Math.round(W / eqN);
  const eqBarW = Math.max(4, Math.round(eqGap * 0.55));
  for (let i = 0; i < eqN; i += 1) {
    const x = i * eqGap + Math.round((eqGap - eqBarW) / 2);
    const phase = (i * 0.7).toFixed(2);
    const hExpr = `(0.18+0.82*abs(sin(2*PI*${beatHz}*t+${phase})))`;
    const color = i % 4 === 0 ? palette.primary : palette.accent;
    out.push(`drawbox=x=${x}:y='ih-${eqBand}*${hExpr}':w=${eqBarW}:h='${eqBand}*${hExpr}':color=${color}@0.9:t=fill`);
  }
  return out;
}

// ---- v1.4 FFmpeg creative-effect fallback ----
// FFmpeg cannot execute TSX effect components, so when a recipe selects a creative effect it records
// the selection and adds motif-specific *visible* overlay filters as a fallback approximation.

export interface FfmpegEffectFallbackPlan {
  ffmpegEffectFallbackUsed: boolean;
  effectProgramIds: string[];
  motifFamily?: string;
  fallbackReason?: string;
  fallbackVisualLayersAdded: string[];
}

const MOTIF_FFMPEG_FALLBACK_LAYERS: Record<string, string[]> = {
  poster_ribbon_marketing: ["ribbon_sweep_band", "poster_panel"],
  card_orbit_motion_graph: ["card_stack_scatter"],
  blue_spotlight_ui_pitch: ["blue_radial_spotlight", "ui_panel_cards"],
  beat_cut_chinese_editing_tutorial: ["chinese_pop_text", "beat_flash", "slash_bars"],
  split_screen_compare: ["split_tint_panels", "center_divider", "compare_labels"],
  generic_motion_graph: []
};

/** Plan the FFmpeg fallback for a recipe's selected effect. Pure — used by the renderer + the gate. */
export function planFfmpegEffectFallback(recipe: unknown): FfmpegEffectFallbackPlan {
  const r = recipe as { effectProgramIds?: unknown; motifFamily?: unknown } | undefined;
  const effectProgramIds = Array.isArray(r?.effectProgramIds)
    ? r!.effectProgramIds.filter((id): id is string => typeof id === "string")
    : [];
  const motifFamily = typeof r?.motifFamily === "string" ? r.motifFamily : undefined;
  if (!effectProgramIds.length) {
    return { ffmpegEffectFallbackUsed: false, effectProgramIds: [], fallbackVisualLayersAdded: [] };
  }
  const layers = motifFamily ? MOTIF_FFMPEG_FALLBACK_LAYERS[motifFamily] ?? [] : [];
  return {
    ffmpegEffectFallbackUsed: layers.length > 0,
    effectProgramIds,
    motifFamily,
    fallbackReason: `Remotion TSX effects not executable in FFmpeg; applied motif fallback overlays for ${motifFamily ?? "unknown_motif"}.`,
    fallbackVisualLayersAdded: layers
  };
}

/** Build motif-specific ffmpeg overlay filter strings (drawbox/drawtext) for the FFmpeg fallback. */
export function ffmpegFallbackOverlayFilters(
  motifFamily: string | undefined,
  W: number,
  H: number,
  palette: RenderPalette,
  beatInterval: string
): string[] {
  const r = (frac: number) => Math.round(W * frac);
  const rh = (frac: number) => Math.round(H * frac);
  switch (motifFamily) {
    case "poster_ribbon_marketing":
      return [
        `drawbox=x='mod(t*${r(0.5)}\\,iw+${r(0.5)})-${r(0.25)}':y=${rh(0.16)}:w=${r(0.22)}:h=${rh(0.5)}:color=${palette.accent}@0.45:t=fill`,
        `drawbox=x=${r(0.06)}:y=${rh(0.06)}:w=${r(0.88)}:h=${rh(0.88)}:color=${palette.primary}@0.5:t=4`
      ];
    case "card_orbit_motion_graph":
      return [0, 1, 2, 3, 4].map((i) => {
        const cx = r(0.2 + (i % 3) * 0.3);
        const cy = rh(0.28 + Math.floor(i / 3) * 0.34);
        return `drawbox=x='${cx}+${r(0.04)}*sin(2*PI*t*0.5+${i})':y=${cy}:w=${r(0.16)}:h=${rh(0.12)}:color=${palette.cool}@0.6:t=3`;
      });
    case "blue_spotlight_ui_pitch":
      return [
        `drawbox=x='${r(0.2)}+${r(0.4)}*sin(t*0.8)':y='${rh(0.2)}+${rh(0.3)}*cos(t*0.6)':w=${r(0.3)}:h=${r(0.3)}:color=${palette.cool}@0.28:t=fill`,
        `drawbox=x=${r(0.14)}:y=${rh(0.4)}:w=${r(0.66)}:h=${rh(0.09)}:color=${palette.cool}@0.5:t=2`,
        `drawbox=x=${r(0.18)}:y=${rh(0.54)}:w=${r(0.6)}:h=${rh(0.09)}:color=${palette.cool}@0.5:t=2`
      ];
    case "beat_cut_chinese_editing_tutorial":
      return [
        `drawbox=x=0:y=${rh(0.3)}:w=iw:h=${rh(0.012)}:color=${palette.primary}@0.85:t=fill`,
        `drawbox=x=0:y=${rh(0.66)}:w=iw:h=${rh(0.012)}:color=${palette.accent}@0.85:t=fill`,
        `drawbox=x=0:y=0:w=iw:h=ih:color=white@0.18:t=fill:enable='lt(mod(t\\,${beatInterval})\\,0.05)'`,
        `drawtext=${FONT_FILE_ARG}text='重点':fontcolor=${palette.accent}:fontsize=${rh(0.12)}:x=(w-text_w)/2:y=${rh(0.42)}:box=0:shadowcolor=black@0.8:shadowx=4:shadowy=4`
      ];
    case "split_screen_compare":
      return [
        // left/right tint panels, an animated center divider, and BEFORE/AFTER labels
        `drawbox=x=0:y=0:w=${r(0.5)}:h=ih:color=${palette.primary}@0.18:t=fill`,
        `drawbox=x=${r(0.5)}:y=0:w=${r(0.5)}:h=ih:color=${palette.cool}@0.18:t=fill`,
        `drawbox=x='${r(0.5)}-${r(0.006)}+${r(0.02)}*sin(2*PI*t*0.5)':y=0:w=${r(0.012)}:h=ih:color=white@0.9:t=fill`,
        `drawtext=${FONT_FILE_ARG}text='BEFORE':fontcolor=white:fontsize=${rh(0.04)}:x=${r(0.1)}:y=${rh(0.08)}:box=1:boxcolor=black@0.4:boxborderw=10`,
        `drawtext=${FONT_FILE_ARG}text='AFTER':fontcolor=white:fontsize=${rh(0.04)}:x=${r(0.6)}:y=${rh(0.08)}:box=1:boxcolor=black@0.4:boxborderw=10`
      ];
    default:
      return [];
  }
}

type TextLayout = {
  yFrac: number;
  xFrac?: number;
  colorHex: string;
  pulseHex: string;
  anim: "per_char_reveal" | "shake" | "scale";
  fontScale: number;
};

/** Read a typography hint (layoutRole/colorRole/animation) the planner attached to a text layer. */
function typographyForClip(clip: TimelineClip): { layoutRole?: string; colorRole?: string; animationHint?: string; bboxNorm?: [number, number, number, number]; fontSizeRatio?: number } | undefined {
  for (const layer of clip.layers ?? []) {
    const t = (layer.style as Record<string, unknown> | undefined)?.typography as Record<string, unknown> | undefined;
    const bbox = Array.isArray(t?.bboxNorm) && t.bboxNorm.length === 4 && t.bboxNorm.every((v) => typeof v === "number" && Number.isFinite(v))
      ? t.bboxNorm as [number, number, number, number]
      : undefined;
    const fontSizeRatio = typeof t?.fontSizeRatio === "number" && Number.isFinite(t.fontSizeRatio) ? t.fontSizeRatio : undefined;
    if (t && (t.layoutRole || t.colorRole || t.animationHint || bbox || fontSizeRatio)) {
      return { layoutRole: t.layoutRole as string, colorRole: t.colorRole as string, animationHint: t.animationHint as string, bboxNorm: bbox, fontSizeRatio };
    }
  }
  return undefined;
}

/** Per-clip text placement/animation so copy is NOT always centered: position, colour and animation
 * vary by primitive, and are enriched by sample typography evidence when present. */
function textLayoutForClip(clip: TimelineClip, primitive: string, palette: RenderPalette): TextLayout {
  const roleColor: Record<string, string> = {
    red: palette.primary,
    yellow: palette.accent,
    amber: palette.accent,
    white: palette.text,
    blue: palette.cool,
    cyan: palette.cool,
    teal: palette.cool,
    purple: palette.secondary,
    pink: palette.secondary,
    green: palette.secondary,
    orange: palette.accent
  };
  const byPrimitive: Record<string, TextLayout> = {
    neon_hero_intro: { yFrac: 0.74, colorHex: palette.text, pulseHex: palette.primary, anim: "per_char_reveal", fontScale: 1.0 },
    beat_text_card: { yFrac: 0.44, colorHex: palette.text, pulseHex: palette.primary, anim: "per_char_reveal", fontScale: 1.0 },
    tutorial_rule_card: { yFrac: 0.47, colorHex: palette.accent, pulseHex: palette.primary, anim: "scale", fontScale: 0.92 },
    action_montage: { yFrac: 0.77, colorHex: palette.text, pulseHex: palette.primary, anim: "shake", fontScale: 0.86 },
    impact_flash_stamp: { yFrac: 0.43, colorHex: palette.primary, pulseHex: palette.accent, anim: "shake", fontScale: 1.06 },
    motivation_cta: { yFrac: 0.42, colorHex: palette.text, pulseHex: palette.primary, anim: "per_char_reveal", fontScale: 1.06 }
  };
  const base = { ...(byPrimitive[primitive] ?? { yFrac: 0.46, colorHex: palette.text, pulseHex: palette.primary, anim: "scale" as const, fontScale: 1.0 }) };
  const typ = typographyForClip(clip);
  if (typ) {
    // only a non-white sample colour overrides the role default (keep the yellow/red variety)
    if (typ.colorRole && typ.colorRole !== "white" && roleColor[typ.colorRole]) base.colorHex = roleColor[typ.colorRole];
    if (typ.layoutRole === "lower_third") base.yFrac = 0.77;
    else if (typ.layoutRole === "top_tag" || typ.layoutRole === "top_left_tag") base.yFrac = 0.27;
    else if (typ.layoutRole === "center_title") base.yFrac = 0.44;
    if (typ.animationHint === "per_char_reveal" || typ.animationHint === "shake") base.anim = typ.animationHint as TextLayout["anim"];
    if (typeof typ.fontSizeRatio === "number" && typ.fontSizeRatio > 0) {
      // Match the sample's text scale: the renderer's base text height is ~H*0.072, so a sample run
      // measured at fontSizeRatio R renders at fontScale ≈ R/0.072 (clamped). A sample with big bold
      // headlines renders big text; a sample with small captions renders smaller — per-sample.
      base.fontScale = Math.max(0.7, Math.min(1.8, typ.fontSizeRatio / 0.072));
    }
    if (typ.bboxNorm) {
      const [x, y, w, h] = typ.bboxNorm;
      base.xFrac = Math.max(0.08, Math.min(0.92, x + w / 2));
      base.yFrac = Math.max(0.12, Math.min(0.84, y + h / 2));
    }
  }
  return base;
}

/** Build drawtext filters for a headline with the clip's layout + animation (per-char reveal, shake,
 * or beat-scale), in the learned red/yellow/white palette. `rawText` must be the UN-escaped copy. */
function beatCutTextFilters(rawText: string, layout: TextLayout, W: number, H: number, beatInterval: string, duration: number): string[] {
  const text = (rawText ?? "").trim();
  if (!text) return [];
  const out: string[] = [];
  const chars = Array.from(text);
  const n = chars.length || 1;
  const widthFit = Math.floor((W * 0.9) / n);
  const fontSize = Math.max(Math.round(H * 0.034), Math.min(Math.round(H * 0.072 * layout.fontScale), widthFit));
  const yBase = Math.round(H * layout.yFrac);
  const xFrac = layout.xFrac ?? 0.5;
  if (layout.anim === "per_char_reveal" && n <= 12) {
    // lay chars out horizontally and reveal each in turn over the first ~55% of the clip
    const charW = fontSize;
    const textW = n * charW;
    const x0 = Math.max(18, Math.min(W - textW - 18, Math.round(W * xFrac - textW / 2)));
    const step = Math.max(0.05, (duration * 0.55) / n);
    chars.forEach((ch, i) => {
      const reveal = (i * step).toFixed(3);
      out.push(`drawtext=${FONT_FILE_ARG}text='${escapeDrawText(ch)}':fontcolor=${layout.colorHex}:fontsize=${fontSize}:x=${x0 + i * charW}:y=${yBase}:box=0:shadowcolor=black@0.7:shadowx=3:shadowy=3:enable='gte(t\\,${reveal})'`);
    });
    return out;
  }
  const xAnchor = Math.round(W * xFrac);
  const xExpr = layout.anim === "shake" ? `${xAnchor}-text_w/2+6*sin(2*PI*t*9)` : `${xAnchor}-text_w/2`;
  const yExpr = layout.anim === "shake" ? `${yBase}+5*cos(2*PI*t*7)` : String(yBase);
  // red beat-pulse shadow under the headline
  out.push(`drawtext=${FONT_FILE_ARG}text='${escapeDrawText(text)}':fontcolor=${layout.pulseHex}@0.7:fontsize=${Math.round(fontSize * 1.12)}:x=${xExpr}:y=(${yExpr})-6:box=0:enable='lt(mod(t\\,${beatInterval})\\,0.12)'`);
  out.push(`drawtext=${FONT_FILE_ARG}text='${escapeDrawText(text)}':fontcolor=${layout.colorHex}:fontsize=${fontSize}:x=${xExpr}:y=${yExpr}:box=1:boxcolor=black@0.42:boxborderw=20`);
  return out;
}

/** Hero palette from the descriptor the planner attached to the moving_material layer. */
function heroPaletteForClip(clip: TimelineClip): string[] {
  for (const layer of clip.layers ?? []) {
    const d = (layer.style as Record<string, unknown> | undefined)?.heroDescriptor as Record<string, unknown> | undefined;
    if (d && Array.isArray(d.palette) && d.palette.length) return (d.palette as string[]);
  }
  return ["black", "red", "blue"];
}

/** The located hero element (VisualElementGraph) the planner attached to the moving_material layer:
 * the renderer positions the silhouette by its positionClass + trajectory (actual graph consumption). */
function heroElementForClip(clip: TimelineClip): { positionClass?: string; centerTrajectory?: Array<[number, number]> } | undefined {
  for (const layer of clip.layers ?? []) {
    const e = (layer.style as Record<string, unknown> | undefined)?.heroElement as { positionClass?: string; centerTrajectory?: Array<[number, number]> } | undefined;
    if (e && (e.positionClass || e.centerTrajectory)) return e;
  }
  return undefined;
}

/**
 * Build the layered PROCEDURAL beat-track lavfi source expressions for a timeline — dark ambient
 * drone (harmonic pad) + kick + bass pulse + hi-hat + pink-noise air + optional riser/impacts at the
 * sample's strong beats. The mix weights are derived from the sample's LEARNED audio structure
 * (renderPlan.audioPlan.layers / recipe audio layers / BPM / spectral stats), never from a sample
 * name — so any input flows through the same generator. 100% synthesized (no copyrighted/sample
 * audio). Shared by FFmpegRenderer.addAudioTrack AND RemotionRenderer so BOTH render paths emit the
 * same evidence-derived bed (previously only the FFmpeg path muxed audio; Remotion shipped silent).
 * Returns the lavfi source list (always >=1 entry: the drone) or [] only on invalid duration.
 */
function buildProceduralBedSources(timeline: Timeline, durationSec: number): string[] {
  if (!(durationSec > 0)) return [];
  const dur = Math.max(1, durationSec).toFixed(2);
  const bpm = timeline.renderPlan?.audioPlan?.bpm ?? timeline.renderPlan?.beatGrid?.bpm ?? 120;
  const bi = (60 / (bpm > 40 && bpm < 300 ? bpm : 120)).toFixed(4);
  const half = (Number(bi) / 2).toFixed(4);
  const sr = "s=44100";
  // v3: mix the layers by the sample's learned audio-structure balance (bass_kick / music_harmonic
  // / hats_air) — a bass-heavy sample gets a heavier kick/bass, etc. — not just a fixed click.
  const recipeAudioLayers = Object.fromEntries(
    (timeline.renderPlan?.renderRecipe?.layers ?? [])
      .filter((layer) => layer.type === "audio")
      .map((layer) => [layer.audio.kind === "hat" ? "hats" : layer.audio.kind, layer.audio.weight])
  ) as Record<string, number>;
  const timelineAudioLayers = (timeline.renderPlan?.audioPlan?.layers ?? {}) as Record<string, number>;
  const layers = Object.keys(timelineAudioLayers).length ? timelineAudioLayers : recipeAudioLayers;
  const readLayer = (keys: string[]): number | undefined => {
    for (const key of keys) {
      const value = layers[key];
      if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(1, value));
    }
    return undefined;
  };
  const layer = (keys: string[], fallback: number): number => readLayer(keys) ?? fallback;
  const motionDriven = timeline.clips.some((clip) => Boolean(clip.motionPrimitive));
  const spectralCentroid = timeline.renderPlan?.audioPlan?.spectralCentroidMean;
  const spectralFlatness = timeline.renderPlan?.audioPlan?.spectralFlatnessMean;
  const airBoost =
    (typeof spectralCentroid === "number" && spectralCentroid > 2000 ? 0.28 : 0) +
    (typeof spectralFlatness === "number" && spectralFlatness > 0.35 ? 0.22 : 0);
  const drumWeight = readLayer(["bass", "kick", "bass_kick"]) ?? 0;
  const gBass = drumWeight > 0 ? 0.55 + drumWeight * (motionDriven ? 0.95 : 0.55) : 0;
  const gMusic = 0.7 + layer(["drone", "music_harmonic"], 0.45) * 2.2;
  const gAir = 0.45 + layer(["hats", "hats_air"], 0.12) * 2.6 + airBoost;
  const gRiser = layer(["riser"], 0) * 1.6;
  const gImpact = layer(["impact"], drumWeight > 0 ? 0.35 : 0.08) * 0.9;
  const strongBeats = (timeline.renderPlan?.audioPlan?.strongBeatsSec ?? [])
    .filter((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= durationSec)
    .slice(0, 36);
  const a = (base: number, g: number) => (base * g).toFixed(3);
  const drone = `aevalsrc='${a(0.10, gMusic)}*sin(2*PI*55*t)+${a(0.07, gMusic)}*sin(2*PI*82.5*t)+${a(0.05, gMusic)}*sin(2*PI*110*t)':${sr}:d=${dur}`;
  const kick = `aevalsrc='${a(motionDriven ? 0.6 : 0.34, gBass)}*sin(2*PI*58*t)*exp(-26*mod(t\\,${bi}))':${sr}:d=${dur}`;
  const bass = `aevalsrc='${a(motionDriven ? 0.28 : 0.18, gBass)}*sin(2*PI*98*t)*exp(-7*mod(t\\,${bi}))':${sr}:d=${dur}`;
  const hat = `aevalsrc='${a(0.16, gAir)}*sin(2*PI*1400*t)*exp(-42*mod(t\\,${half}))':${sr}:d=${dur}`;
  const air = `anoisesrc=color=pink:amplitude=${a(0.05, gAir)}:duration=${dur}:sample_rate=44100`;
  const riser = `aevalsrc='${a(0.08, gRiser)}*sin(2*PI*(160+80*t/${dur})*t)':${sr}:d=${dur}`;
  const impactExpr = strongBeats.length
    ? strongBeats
        .map((beat) => {
          const b = beat.toFixed(3);
          return `${a(0.18, gImpact)}*sin(2*PI*180*(t-${b}))*exp(-28*(t-${b}))*gte(t\\,${b})`;
        })
        .join("+")
    : "0";
  const impact = `aevalsrc='${impactExpr}':${sr}:d=${dur}`;
  return [
    drone,
    ...(drumWeight > 0.05 ? [kick, bass] : []),
    ...(gAir > 0.15 ? [hat, air] : []),
    ...(gRiser > 0.05 ? [riser] : []),
    ...(gImpact > 0.05 && strongBeats.length ? [impact] : [])
  ];
}

export class FFmpegRenderer implements RendererAdapter {
  readonly target: RendererTarget = "ffmpeg";
  private readonly opts: FFmpegRendererOptions;

  constructor(opts: FFmpegRendererOptions) {
    this.opts = opts;
  }

  async render(timeline: Timeline, generationId: string): Promise<RenderOutput> {
    const renderId = stableId("render_mp4", generationId, timeline.id);
    const workDir = path.join(this.opts.generatedDir, "ffmpeg", renderId);
    await fs.mkdir(workDir, { recursive: true });

    const { width, height } = pickResolution(timeline);
    const fps = timeline.renderPlan?.fps ?? 30;
    const textStyle = drawTextStyle(timeline);
    const renderStartedAt = Date.now();
    console.log(`[ffmpeg] ▶ rendering ${timeline.clips.length} clips @ ${width}x${height} ${fps}fps, audio=${timeline.renderPlan?.audioPolicy ?? "silent"}`);
    const segmentFiles: string[] = [];
    const warnings: string[] = [];
    let sourceClipCount = 0;
    let primitiveClipCount = 0;
    let placeholderClipCount = 0;
    const recipeMotionAtomLayerCount = (timeline.renderPlan?.renderRecipe?.layers ?? []).filter((layer) => layer.type === "motion_atom").length;

    for (let index = 0; index < timeline.clips.length; index += 1) {
      const clip = timeline.clips[index];
      const segmentPath = path.join(workDir, `clip_${index + 1}.mp4`);
      const subtitle = escapeDrawText(clip.subtitleText ?? clip.visualIntent ?? "");
      const duration = Math.max(0.5, clip.durationSec);
      const usedSource = await this.renderClip(clip, segmentPath, { width, height, fps, duration, subtitle, warnings, timeline, textStyle });
      if (usedSource) sourceClipCount += 1;
      else if (clip.motionPrimitive || clip.type !== "placeholder") primitiveClipCount += 1;
      else placeholderClipCount += 1;
      if (!usedSource && (this.opts.preferSourceClips ?? false)) {
        warnings.push(`Clip ${clip.id}: no usable source asset; fell back to generated card.`);
      }
      segmentFiles.push(segmentPath);
    }

    if (segmentFiles.length === 0) {
      throw new Error("FFmpegRenderer received an empty timeline.");
    }

    const listPath = path.join(workDir, "concat.txt");
    await fs.writeFile(listPath, segmentFiles.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
    const silentPath = path.join(workDir, `${renderId}.silent.mp4`);
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", silentPath]);

    // User-facing filename = theme_sampleName_timestamp (no random hash); renderId stays the internal key.
    const outputBase = this.opts.outputBasename?.trim() || renderId;
    const outputPath = path.join(this.opts.generatedDir, `${outputBase}.mp4`);
    const renderQualityWarnings: string[] = [];
    const totalDuration = timeline.durationSec || timeline.clips.reduce((sum, c) => sum + Math.max(0.5, c.durationSec), 0);

    // v1.4 FFmpeg creative-effect fallback: when the recipe selected an effect (which only Remotion
    // can render natively), apply motif-specific visible overlays here. Only runs when an effect is
    // selected, so non-effect renders are byte-for-byte unchanged.
    const effectFallback = planFfmpegEffectFallback(timeline.renderPlan?.renderRecipe);
    let preAudioPath = silentPath;
    if (effectFallback.ffmpegEffectFallbackUsed) {
      const palette = timelinePalette(timeline);
      const bpm = timeline.renderPlan?.renderRecipe?.global?.bpm ?? timeline.renderPlan?.audioPlan?.bpm ?? 120;
      const beatInterval = (60 / (bpm > 40 && bpm < 300 ? bpm : 120)).toFixed(4);
      const overlays = ffmpegFallbackOverlayFilters(effectFallback.motifFamily, width, height, palette, beatInterval);
      if (overlays.length) {
        const overlaidPath = path.join(workDir, `${renderId}.effectfx.mp4`);
        try {
          await runFfmpeg(["-y", "-i", silentPath, "-vf", overlays.join(","), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", overlaidPath]);
          preAudioPath = overlaidPath;
          warnings.push(`FFmpeg effect fallback overlays applied for ${effectFallback.motifFamily}: ${effectFallback.fallbackVisualLayersAdded.join(", ")}.`);
        } catch (error) {
          warnings.push(`FFmpeg effect overlay pass failed (${(error as Error).message}); kept base composite.`);
        }
      }
    }

    const audioAdded = await this.addAudioTrack(preAudioPath, outputPath, timeline, totalDuration, warnings);
    if (!audioAdded) {
      await fs.copyFile(preAudioPath, outputPath);
      if ((timeline.renderPlan?.audioPolicy ?? "silent") !== "silent") renderQualityWarnings.push("no_audio");
    }

    // Quality signals for the gate / UI.
    const isBeatCut = timeline.renderPlan?.renderRecipe?.videoType === "beat_cut_product" || timeline.clips.some((clip) => Boolean(clip.motionPrimitive));
    if (placeholderClipCount > 0) renderQualityWarnings.push("placeholder_detected");
    if (isBeatCut && sourceClipCount === 0) renderQualityWarnings.push("no_source_clips");
    if (isBeatCut && primitiveClipCount + sourceClipCount < Math.ceil(timeline.clips.length * 0.6)) {
      renderQualityWarnings.push("weak_style_transfer");
    }
    // v2 honesty signals: the montage/hero used a dynamic procedural proxy (no real moving footage);
    // a non-sample-BGM beat-cut output rides a synthesized beat track (beat alignment is engine-set,
    // not analyzed from real audio).
    if (isBeatCut) {
      const hasMovingVideo = timeline.clips.some((clip) =>
        clip.layers?.some((layer) => layer.kind === "moving_video" && Boolean(layer.assetId)));
      if (sourceClipCount === 0 && !hasMovingVideo) renderQualityWarnings.push("moving_material_missing");
      if (timeline.clips.some((clip) => clip.motionPrimitive === "action_montage") && sourceClipCount === 0 && !hasMovingVideo) {
        renderQualityWarnings.push("static_action_montage_avoided_via_dynamic_proxy");
      }
      if (timeline.renderPlan?.audioPolicy === "synth_beat") renderQualityWarnings.push("beat_alignment_unverified");
    }

    const clipPreviewFrames = await this.extractClipPreviewFrames(timeline.clips, segmentFiles, renderId, warnings);

    console.log(
      `[ffmpeg] ✓ ${path.basename(outputPath)} (${((Date.now() - renderStartedAt) / 1000).toFixed(1)}s) · ` +
        `source=${sourceClipCount} primitive=${primitiveClipCount} placeholder=${placeholderClipCount}` +
        `${recipeMotionAtomLayerCount ? ` motionAtomLayers=${recipeMotionAtomLayerCount} fallback=2d_overlay` : ""}` +
        `${renderQualityWarnings.length ? ` · warnings=[${renderQualityWarnings.join(",")}]` : ""}`
    );
    return {
      renderId,
      generationId,
      rendererTarget: this.target,
      status: "completed",
      outputPath,
      previewHtml: `<video controls width="320"><source src="${path.basename(outputPath)}" type="video/mp4" /></video>`,
      clipPreviewFrames,
      renderQualityWarnings: renderQualityWarnings.length ? renderQualityWarnings : undefined,
      ...(effectFallback.effectProgramIds.length ? { effectProgramIds: effectFallback.effectProgramIds } : {}),
      ...(effectFallback.ffmpegEffectFallbackUsed
        ? {
            ffmpegEffectFallbackUsed: true,
            effectFallbackReason: effectFallback.fallbackReason,
            fallbackVisualLayersAdded: effectFallback.fallbackVisualLayersAdded
          }
        : {}),
      error: warnings.length ? warnings.join(" | ") : undefined,
      createdAt: nowIso()
    };
  }

  /**
   * Mux an audio track onto the silent render per renderPlan.audioPolicy:
   *  - sample_bgm: carry the authorized sample/source audio (looped to duration);
   *  - synth_beat: generate a beat-aligned click track at the timeline BPM;
   *  - silent: no audio.
   * Returns true when an audio track was written to finalPath.
   */
  private async addAudioTrack(
    silentPath: string,
    finalPath: string,
    timeline: Timeline,
    durationSec: number,
    warnings: string[]
  ): Promise<boolean> {
    const policy = timeline.renderPlan?.audioPolicy ?? "silent";
    if (policy === "silent") return false;
    const dur = Math.max(1, durationSec).toFixed(2);
    try {
      const audioRef = timeline.renderPlan?.audioRef;
      const directAudioFile = audioRef && path.isAbsolute(audioRef) && existsSync(audioRef) ? audioRef : undefined;
      const resolvedAudioFile = audioRef ? this.opts.assetResolver.resolve(audioRef) : undefined;
      const audioFile = directAudioFile ?? (resolvedAudioFile && existsSync(resolvedAudioFile) ? resolvedAudioFile : undefined);
      // Google voiceover is layered over whatever bed is used. SFX/risers are procedural in
      // buildProceduralBedSources(), so the required audio path does not depend on external SFX APIs.
      const auxPath = (key: string): string | undefined => {
        const entry = (timeline.renderPlan?.adapterOptions as Record<string, unknown> | undefined)?.[key];
        const candidate = entry && typeof entry === "object" ? (entry as { path?: unknown }).path : undefined;
        if (typeof candidate !== "string" || !candidate) return undefined;
        if (path.isAbsolute(candidate) && existsSync(candidate)) return candidate;
        const resolved = this.opts.assetResolver.resolve(candidate);
        return resolved && existsSync(resolved) ? resolved : undefined;
      };
      const voiceoverFile = auxPath("googleAudioVoiceover");
      if (audioFile) {
        if (voiceoverFile) {
          try {
            // Bed looped + ducked; voiceover full-volume slightly delayed. amix with
            // duration=longest, capped by -t (no -shortest: VO/SFX are shorter than the video).
            const inputs: string[] = ["-y", "-i", silentPath, "-stream_loop", "-1", "-i", audioFile];
            const filters: string[] = ["[1:a]volume=0.42[bed]"];
            const mixLabels: string[] = ["[bed]"];
            let inputIndex = 2;
            inputs.push("-i", voiceoverFile);
            filters.push(`[${inputIndex}:a]aresample=44100,volume=1.25,adelay=400:all=1[vo]`);
            mixLabels.push("[vo]");
            filters.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=longest:normalize=0,highpass=f=30,alimiter=limit=0.95[a]`);
            await runFfmpeg([
              ...inputs,
              "-filter_complex", filters.join(";"),
              "-map", "0:v:0", "-map", "[a]", "-t", dur,
              "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", finalPath
            ]);
            warnings.push("Generated audio layered: bed+voiceover.");
            return true;
          } catch (error) {
            warnings.push(`Generated voiceover mux failed (${(error as Error).message}); muxing music bed only.`);
          }
        }
        await runFfmpeg([
          "-y", "-i", silentPath, "-stream_loop", "-1", "-i", audioFile,
          "-map", "0:v:0", "-map", "1:a:0", "-t", dur,
          "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", finalPath
        ]);
        return true;
      }
      if (audioRef) warnings.push(`Audio ref ${audioRef} did not resolve; falling back to synth beat.`);
      if (policy === "sample_bgm") {
        warnings.push(`Audio policy sample_bgm but audioRef ${audioRef ?? "n/a"} did not resolve; falling back to synth beat.`);
      }
      // synth_beat (and sample_bgm fallback): a layered PROCEDURAL beat track at the timeline BPM,
      // built by the shared buildProceduralBedSources() so the Remotion path emits the SAME bed.
      const sources = buildProceduralBedSources(timeline, durationSec);
      const lavfiInputs = sources.flatMap((source) => ["-f", "lavfi", "-i", source]);
      const labels = sources.map((_, index) => `[${index + 1}]`).join("");
      // Layer Google voiceover onto the procedural bed. Inputs: 0=silent video,
      // 1..N=lavfi beat sources, then the voice file. When aux is present we drop -shortest (aux is
      // shorter than the video) and rely on -t; the lavfi sources are d=dur so the mix spans the clip.
      const auxInputs: string[] = [];
      const auxFilters: string[] = [];
      const auxLabels: string[] = [];
      let auxIndex = sources.length + 1;
      if (voiceoverFile) {
        auxInputs.push("-i", voiceoverFile);
        auxFilters.push(`[${auxIndex}:a]aresample=44100,volume=1.25,adelay=400:all=1[vo]`);
        auxLabels.push("[vo]");
        auxIndex += 1;
      }
      const mixCount = sources.length + auxLabels.length;
      const filterComplex = [
        ...auxFilters,
        `${labels}${auxLabels.join("")}amix=inputs=${mixCount}:duration=longest:normalize=0,highpass=f=30,alimiter=limit=0.9[a]`
      ].join(";");
      await runFfmpeg([
        "-y", "-i", silentPath,
        ...lavfiInputs,
        ...auxInputs,
        "-filter_complex", filterComplex,
        "-map", "0:v:0", "-map", "[a]", "-t", dur,
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        ...(auxLabels.length ? [] : ["-shortest"]),
        "-movflags", "+faststart", finalPath
      ]);
      if (auxLabels.length) {
        warnings.push("Generated voiceover layered over procedural bed.");
      }
      return true;
    } catch (error) {
      warnings.push(`Audio mux failed (${(error as Error).message}); writing silent video.`);
      return false;
    }
  }

  /**
   * Sample one real still per clip from its already-rendered segment so the web
   * timeline preview shows the actual frame at that timestamp instead of a gradient.
   * Failures are non-fatal: a missing frame just falls back to the placeholder card.
   */
  private async extractClipPreviewFrames(
    clips: TimelineClip[],
    segmentFiles: string[],
    renderId: string,
    warnings: string[]
  ): Promise<RenderClipPreviewFrame[]> {
    const frames: RenderClipPreviewFrame[] = [];
    const frameDir = path.join(this.opts.generatedDir, "previews", renderId);
    let frameDirReady = false;
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index];
      const segmentPath = segmentFiles[index];
      if (!segmentPath || !existsSync(segmentPath)) continue;
      const framePath = path.join(frameDir, `clip_${index + 1}.png`);
      // Sample near the middle of the segment; clamp to the rendered (>=0.5s) duration.
      const renderedDuration = Math.max(0.5, clip.durationSec);
      const seek = Math.max(0.05, Math.min(clip.durationSec / 2, renderedDuration - 0.05));
      try {
        if (!frameDirReady) {
          await fs.mkdir(frameDir, { recursive: true });
          frameDirReady = true;
        }
        await runFfmpeg([
          "-y",
          "-ss", seek.toFixed(2),
          "-i", segmentPath,
          "-frames:v", "1",
          "-vf", "scale=240:-2",
          framePath
        ]);
        const relative = path.relative(this.opts.generatedDir, framePath).split(path.sep).join("/");
        frames.push({ clipId: clip.id, previewFrame: `/generated/${relative}` });
      } catch (error) {
        warnings.push(`Clip ${clip.id}: preview frame extraction failed (${(error as Error).message}).`);
      }
    }
    return frames;
  }

  private async renderClip(
    clip: TimelineClip,
    segmentPath: string,
    options: { width: number; height: number; fps: number; duration: number; subtitle: string; warnings: string[]; timeline: Timeline; textStyle: DrawTextStyle }
  ): Promise<boolean> {
    const visualFormFamily = String(clip.visualFormFamily ?? styleValueFromClip(clip, "visualFormFamily") ?? "");
    const palette = timelinePalette(options.timeline);
    const recipeTextLayer = recipeTextLayerForClip(options.timeline, clip);
    const recipeMediaLayer = recipeMediaLayerForClip(options.timeline, clip);
    const targetAssetIds = targetAssetIdsForClip(clip);
    const resolvedTargetAssetPaths = new Map<string, string>();
    for (const assetId of targetAssetIds) {
      const resolved = this.opts.assetResolver.resolve(assetId);
      if (resolved && existsSync(resolved)) resolvedTargetAssetPaths.set(assetId, resolved);
    }
    if (clipUsesAigcGeneratedMaterial(clip) && targetAssetIds.length > 0 && resolvedTargetAssetPaths.size === 0) {
      throw new Error(`Clip ${clip.id}: AIGC generated assets are present in the timeline but none resolved to renderable files (${targetAssetIds.join(", ")}).`);
    }
    if (visualFormFamily === "media_cards" && targetAssetIds.length >= 2) {
      const assetPaths = targetAssetIds
        .map((assetId) => resolvedTargetAssetPaths.get(assetId))
        .filter((assetPath): assetPath is string => Boolean(assetPath))
        .slice(0, 4);
      if (assetPaths.length >= 2) {
        try {
          await this.renderMediaCardAssetStack(clip, assetPaths, segmentPath, options);
          return true;
        } catch (error) {
          options.warnings.push(`Clip ${clip.id}: target card-stack render failed (${(error as Error).message}); using generated proxy.`);
        }
      }
    }

    if (visualFormFamily === "brand_cta" && targetAssetIds.length > 0) {
      const logoPath = targetAssetIds
        .map((assetId) => resolvedTargetAssetPaths.get(assetId))
        .find((assetPath) => Boolean(assetPath && existsSync(assetPath)));
      if (logoPath) {
        try {
          await this.renderBrandCtaAssetClip(clip, logoPath, segmentPath, options);
          return true;
        } catch (error) {
          options.warnings.push(`Clip ${clip.id}: target brand CTA render failed (${(error as Error).message}); using generated proxy.`);
        }
      }
    }

    const sourcePath = clip.sourceAssetId ? this.opts.assetResolver.resolve(clip.sourceAssetId) : undefined;
    // v1.3 source-first: composite a real resolvable target/source asset (image or video) even when
    // clip.type is a generated_card (a family-renderer fill that still bound a real asset). The golden
    // self-reconstruction path has no resolvable sourceAssetId, so this branch never fires there.
    const sourceIsRenderableMedia = Boolean(sourcePath && existsSync(sourcePath));
    if (sourcePath && (clip.type === "video" || clip.type === "image" || sourceIsRenderableMedia)) {
      try {
        const isStillImage = /\.(png|jpe?g|webp)$/i.test(sourcePath);
        // v1.3 fidelity: composite the real asset at the SAMPLE's learned element geometry
        // (size + position + motion) instead of always full-bleed + a fixed pan. The planner attaches
        // `style.elementGeometry = { bbox:[x,y,w,h], motionPattern }` (from the VisualElementGraph hero
        // element) to image clips; a sub-frame bbox is placed on a dark bed so different samples render
        // the product at their actual size/position, not "one big pic filling the screen".
        const geom = (clip.layers
          .map((l) => (l.style as { elementGeometry?: { bbox?: [number, number, number, number]; motionPattern?: string } } | undefined)?.elementGeometry)
          .find(Boolean));
        const bb = geom?.bbox ?? bboxObjectToArray(recipeMediaLayer?.layout.bboxNorm);
        const subFrame = Boolean(bb && (bb[2] < 0.9 || bb[3] < 0.9 || bb[0] > 0.04 || bb[1] > 0.04));
        if (isStillImage && bb && subFrame) {
          const [bx, by, bw, bh] = bb;
          const tW = Math.max(24, Math.round(options.width * Math.min(1, bw)));
          const tH = Math.max(24, Math.round(options.height * Math.min(1, bh)));
          const px = Math.round(options.width * Math.max(0, Math.min(1 - bw, bx)));
          const py = Math.round(options.height * Math.max(0, Math.min(1 - bh, by)));
          const mp = String(geom?.motionPattern ?? "");
          const sweep = /sweep|orbit|pan|rotate/.test(mp) ? 20 : 8;
          const bob = /orbit|float|bob|helix/.test(mp) ? 16 : 5;
          const textFilter = recipeDrawTextFilter(options.subtitle, recipeTextLayer, options.textStyle, options.width, options.height);
          const atomFilters = motionAtomFiltersFromRecipe(options.timeline, clip, options.width, options.height, palette);
          const postOverlay = [...atomFilters, ...(textFilter ? [textFilter] : [])];
          const sub = postOverlay.length
            ? `;[ov]${postOverlay.join(",")}[outv]`
            : "";
          const outLabel = sub ? "[outv]" : "[ov]";
          const fc =
            `color=c=${palette.bg}:s=${options.width}x${options.height}:d=${options.duration.toFixed(2)}[bg];` +
            `[0:v]scale=${tW}:${tH}:force_original_aspect_ratio=increase,crop=${tW}:${tH},eq=saturation=1.08[el];` +
            `[bg][el]overlay=x='${px}+sin(n/20)*${sweep}':y='${py}+cos(n/26)*${bob}'${sub ? "[ov]" + sub : "[ov]"}`;
          await runFfmpeg([
            "-y", "-loop", "1", "-t", options.duration.toFixed(2), "-i", sourcePath,
            "-filter_complex", fc, "-map", outLabel,
            "-r", String(options.fps), "-pix_fmt", "yuv420p", "-an",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", segmentPath
          ]);
          return true;
        }
        const scaleWidth = isStillImage ? Math.round(options.width * 1.12) : options.width;
        const scaleHeight = isStillImage ? Math.round(options.height * 1.12) : options.height;
        const panMp = String(geom?.motionPattern ?? "");
        const panX = /sweep|orbit|pan|rotate/.test(panMp) ? 22 : 14;
        const filter = [
          `scale=${scaleWidth}:${scaleHeight}:force_original_aspect_ratio=increase`,
          isStillImage
            ? `crop=${options.width}:${options.height}:x=(iw-ow)/2+sin(n/18)*${panX}:y=(ih-oh)/2+cos(n/24)*10`
            : `crop=${options.width}:${options.height}`,
          isStillImage ? "eq=saturation=1.08,noise=alls=3:allf=t+u" : "",
          ...motionAtomFiltersFromRecipe(options.timeline, clip, options.width, options.height, palette),
          recipeDrawTextFilter(options.subtitle, recipeTextLayer, options.textStyle, options.width, options.height) ?? ""
        ]
          .filter(Boolean)
          .join(",");
        await runFfmpeg([
          "-y",
          ...(isStillImage
            ? ["-loop", "1", "-t", options.duration.toFixed(2), "-i", sourcePath]
            : ["-ss", "0", "-t", options.duration.toFixed(2), "-i", sourcePath]),
          "-vf",
          filter,
          "-r",
          String(options.fps),
          "-pix_fmt",
          "yuv420p",
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          segmentPath
        ]);
        return true;
      } catch (error) {
        options.warnings.push(`Clip ${clip.id}: source render failed (${(error as Error).message}); using card.`);
      }
    }
    // Beat-cut style program: render the learned visual grammar (dark bg, bold center
    // typography, beat-synced flashes/cuts) instead of a generic proxy placeholder card.
    if (clip.motionPrimitive) {
      return this.renderBeatCutPrimitive(clip, segmentPath, options, clip.motionPrimitive);
    }
    return this.renderGeneratedCard(clip, segmentPath, options);
  }

  /**
   * Render a named beat-cut style primitive as a self-contained lavfi segment:
   * dark background + bold center text + red emphasis + a beat-synced white flash
   * (and per-primitive accents). Returns false (no source asset was consumed).
   */
  private async renderBeatCutPrimitive(
    clip: TimelineClip,
    segmentPath: string,
    options: { width: number; height: number; fps: number; duration: number; subtitle: string; warnings: string[]; timeline: Timeline; textStyle: DrawTextStyle },
    primitive: string
  ): Promise<boolean> {
    // The hero intro renders a procedural head/mask silhouette (separate ffmpeg input).
    if (primitive === "neon_hero_intro") {
      return this.renderHeroIntro(clip, segmentPath, options);
    }

    const { width: W, height: H, duration } = options;
    const palette = timelinePalette(options.timeline);
    const bpm = options.timeline.renderPlan?.beatGrid?.bpm ?? 120;
    const bpmSafe = bpm > 40 && bpm < 300 ? bpm : 120;
    const beatInterval = (60 / bpmSafe).toFixed(4);
    const beatHz = (bpmSafe / 60).toFixed(3);

    const filters: string[] = ["format=yuv420p"];
    // Strong moving streak bed so even text clips are not static (the montage rides the strongest).
    filters.push(...streakBedFilters(W, primitive === "action_montage" ? "montage" : "strong", palette, Math.max(0.6, Math.min(1.6, bpmSafe / 120))));
    filters.push(`drawbox=x=0:y='mod(t*${Math.round(H * 0.32)}\\,ih)':w=iw:h=3:color=${palette.cool}@0.3:t=fill`);
    // per-beat full-frame WHITE flash — brief, colour-neutral cut-like jumps
    filters.push(`drawbox=x=0:y=0:w=iw:h=ih:color=0xffffff@0.24:t=fill:enable='lt(mod(t\\,${beatInterval})\\,0.05)'`);

    // ---- Per-primitive accents.
    if (primitive === "action_montage") {
      filters.push(`drawbox=x=0:y=0:w=iw:h=ih:color=0xffffff@0.22:t=fill:enable='lt(mod(t\\,${beatInterval})\\,0.09)'`);
    } else if (primitive === "impact_flash_stamp") {
      const cx = Math.round(W * 0.5);
      const cy = Math.round(H * 0.46);
      const len = Math.round(Math.min(W, H) * 0.5);
      for (let i = 0; i < 8; i += 1) {
        const ang = (i / 8) * Math.PI;
        filters.push(`drawbox=x='${cx}+${len}*${Math.cos(ang).toFixed(3)}*sin(2*PI*t*0.5)':y='${cy}+${len}*${Math.sin(ang).toFixed(3)}*sin(2*PI*t*0.5)':w=10:h=${len}:color=${palette.primary}@0.7:t=fill`);
      }
      filters.push(`drawbox=x=${cx - Math.round(W * 0.2)}:y=${cy - Math.round(W * 0.2)}:w=${Math.round(W * 0.4)}:h=${Math.round(W * 0.4)}:color=${palette.primary}@0.9:t=fill:enable='lt(mod(t\\,${beatInterval})\\,0.1)'`);
    } else if (primitive === "motivation_cta") {
      filters.push(`drawbox=x=0:y=${Math.round(H * 0.84)}:w=iw:h=${Math.round(H * 0.08)}:color=${palette.primary}@0.92:t=fill`);
      filters.push(`drawbox=x='iw-mod(t*${Math.round(W * 0.6)}\\,iw+${Math.round(W * 0.3)})':y=${Math.round(H * 0.855)}:w=${Math.round(W * 0.3)}:h=${Math.round(H * 0.05)}:color=${palette.accent}@0.85:t=fill`);
    } else {
      // beat_text_card / tutorial_rule_card: red title bar + red underline accent.
      filters.push(`drawbox=x=0:y=${Math.round(H * 0.2)}:w=iw:h=${Math.round(H * 0.012)}:color=${palette.primary}@0.9:t=fill`);
      filters.push(`drawbox=x=${Math.round(W * 0.16)}:y=${Math.round(H * 0.62)}:w=${Math.round(W * 0.68)}:h=${Math.round(H * 0.012)}:color=${palette.primary}@0.9:t=fill`);
    }

    filters.push(...beatEqFilters(W, H, beatHz, palette));
    filters.push(...motionAtomFiltersFromRecipe(options.timeline, clip, W, H, palette));

    // v1.3: no meta genre tag ("文字卡"/"动作混剪"…) is burned onto the card — a product ad shows
    // product copy, not a label naming the primitive. The card's message is the subtitle below.

    // ---- Main copy with per-clip layout + animation (raw subtitle; escaped inside the helper).
    const rawText = (clip.subtitleText ?? clip.visualIntent ?? "").trim();
    const recipeText = recipeTextLayerForClip(options.timeline, clip);
    if (recipeText) {
      const textFilter = recipeDrawTextFilter(escapeDrawText(rawText), recipeText, options.textStyle, W, H);
      if (textFilter) filters.push(textFilter);
    } else {
      filters.push(...beatCutTextFilters(rawText, textLayoutForClip(clip, primitive, palette), W, H, beatInterval, duration));
    }

    const lavfi = `color=c=${palette.bg}:s=${W}x${H}:d=${duration.toFixed(2)},${filters.join(",")}`;
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", lavfi,
      "-t", duration.toFixed(2), "-r", String(options.fps),
      "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
      segmentPath
    ]);
    return false;
  }

  /** Generate (and cache) a procedural neon head/mask silhouette PNG with glow-based alpha. */
  private async heroHeadPng(workDir: string, palette: string[]): Promise<string | undefined> {
    const colors = paletteEntries(palette);
    const glow = pickClosest(colors, [235, 55, 150], "#e11d2a");
    const visor = pickClosest(colors, [34, 211, 238], "#22d3ee");
    const key = `${glow.slice(1)}_${visor.slice(1)}`;
    const out = path.join(workDir, `hero_head_${key}.png`);
    if (existsSync(out)) return out;
    const hw = 380;
    const hh = 470;
    const cx = 190;
    const cy = 200;
    const rx = 150;
    const ry = 200;
    const r = colorChannel(glow, 0);
    const g = colorChannel(glow, 2);
    const b = colorChannel(glow, 4);
    const visorColor = ffmpegColor(visor, "0x22d3ee");
    try {
      await runFfmpeg([
        "-y", "-f", "lavfi", "-i", `color=c=black:s=${hw}x${hh}:d=0.1`,
        "-filter_complex",
        `[0:v]format=rgba,geq=r='${r}':g='${g}':b='${b}':a='255*exp(-3.0*(pow((X-${cx})/${rx}\\,2)+pow((Y-${cy})/${ry}\\,2)))'[g];` +
          `[g]drawbox=x=${cx - rx}:y=${cy - 14}:w=${rx * 2}:h=34:color=black@1.0:t=fill,drawbox=x=${cx - rx + 22}:y=${cy - 5}:w=${rx * 2 - 44}:h=8:color=${visorColor}@1.0:t=fill[out]`,
        "-map", "[out]", "-frames:v", "1", out
      ]);
      return existsSync(out) ? out : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Render the opening hero clip: a procedural head/mask silhouette (neon glow + visor) orbiting
   * over a strong moving streak field, with beat flashes, EQ bars and the headline below it. The
   * silhouette is generated from shapes (never a sample frame). Falls back to orbiting neon shapes
   * if the silhouette can't be generated. Returns false (no source asset consumed).
   */
  private async renderHeroIntro(
    clip: TimelineClip,
    segmentPath: string,
    options: { width: number; height: number; fps: number; duration: number; subtitle: string; warnings: string[]; timeline: Timeline; textStyle: DrawTextStyle }
  ): Promise<boolean> {
    const { width: W, height: H, duration, fps } = options;
    const palette = timelinePalette(options.timeline);
    const bpm = options.timeline.renderPlan?.beatGrid?.bpm ?? 120;
    const bpmSafe = bpm > 40 && bpm < 300 ? bpm : 120;
    const beatInterval = (60 / bpmSafe).toFixed(4);
    const beatHz = (bpmSafe / 60).toFixed(3);
    const workDir = path.dirname(segmentPath);
    const head = await this.heroHeadPng(workDir, [
      ...((options.timeline.renderPlan?.renderRecipe?.global?.palette ?? []) as string[]),
      ...heroPaletteForClip(clip)
    ]).catch(() => undefined);
    // Consume the located hero element: place the silhouette by its positionClass (upper_center /
    // center / lower_third) from the VisualElementGraph instead of a fixed offset.
    const heroEl = heroElementForClip(clip);
    const posOffsetFrac = heroEl?.positionClass === "upper_center" ? -0.14 : heroEl?.positionClass === "lower_third" ? 0.08 : -0.04;
    const heroYOffset = Math.round(H * posOffsetFrac);

    const bg: string[] = ["format=yuv420p"];
    bg.push(...streakBedFilters(W, "montage", palette, Math.max(0.6, Math.min(1.6, bpmSafe / 120))));
    bg.push(`drawbox=x=0:y=0:w=iw:h=ih:color=0xffffff@0.24:t=fill:enable='lt(mod(t\\,${beatInterval})\\,0.05)'`);
    if (!head) {
      // fallback: a big orbiting neon "head" blob (never just static boxes)
      const box = Math.round(Math.min(W, H) * 0.2);
      const R = Math.round(Math.min(W, H) * 0.16);
      bg.push(`drawbox=x='(iw-${box})/2+${R}*sin(2*PI*t*0.9)':y='(ih-${box})/2-${Math.round(H * 0.1)}+${R}*cos(2*PI*t*0.9)':w=${box}:h=${box}:color=${palette.primary}@0.85:t=fill`);
    }
    bg.push(...beatEqFilters(W, H, beatHz, palette));
    bg.push(...motionAtomFiltersFromRecipe(options.timeline, clip, W, H, palette));
    const recipeText = recipeTextLayerForClip(options.timeline, clip);
    const rawHeroText = (clip.subtitleText ?? clip.visualIntent ?? "").trim();
    const recipeHeroText = recipeText ? recipeDrawTextFilter(escapeDrawText(rawHeroText), recipeText, options.textStyle, W, H) : undefined;
    const textFilters = recipeHeroText ? [recipeHeroText] : beatCutTextFilters(rawHeroText, textLayoutForClip(clip, "neon_hero_intro", palette), W, H, beatInterval, duration);

    if (!head) {
      const lavfi = `color=c=${palette.bg}:s=${W}x${H}:d=${duration.toFixed(2)},${[...bg, ...textFilters].join(",")}`;
      await runFfmpeg(["-y", "-f", "lavfi", "-i", lavfi, "-t", duration.toFixed(2), "-r", String(fps), "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", segmentPath]);
      return false;
    }
    const bgChain = `[0:v]${bg.join(",")}[bg]`;
    const overlay = `[bg][1:v]overlay=x='(W-w)/2+44*sin(2*PI*t*0.85)':y='(H-h)/2+${heroYOffset}+30*cos(2*PI*t*0.85)'[ov]`;
    const textChain = textFilters.length ? `[ov]${textFilters.join(",")}[out]` : `[ov]null[out]`;
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", `color=c=${palette.bg}:s=${W}x${H}:d=${duration.toFixed(2)}`,
      "-loop", "1", "-t", duration.toFixed(2), "-i", head,
      "-filter_complex", `${bgChain};${overlay};${textChain}`,
      "-map", "[out]", "-t", duration.toFixed(2), "-r", String(fps),
      "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", segmentPath
    ]);
    return false;
  }

  private async renderMediaCardAssetStack(
    clip: TimelineClip,
    assetPaths: string[],
    segmentPath: string,
    options: { width: number; height: number; fps: number; duration: number; subtitle: string; warnings: string[]; timeline: Timeline; textStyle: DrawTextStyle }
  ): Promise<void> {
    const palette = timelinePalette(options.timeline);
    const cardW = Math.round(options.width * 0.42);
    const cardH = Math.round(options.height * 0.32);
    const positions = [
      { x: Math.round(options.width * 0.12), y: Math.round(options.height * 0.22) },
      { x: Math.round(options.width * 0.46), y: Math.round(options.height * 0.18) },
      { x: Math.round(options.width * 0.18), y: Math.round(options.height * 0.54) },
      { x: Math.round(options.width * 0.50), y: Math.round(options.height * 0.50) }
    ];
    const inputs = [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${palette.bg}:s=${options.width}x${options.height}:d=${options.duration.toFixed(2)}`,
      ...assetPaths.flatMap((assetPath) => ["-loop", "1", "-t", options.duration.toFixed(2), "-i", assetPath])
    ];
    const filters: string[] = [];
    assetPaths.forEach((_, index) => {
      filters.push(
        `[${index + 1}:v]scale=${cardW}:${cardH}:force_original_aspect_ratio=decrease,pad=${cardW}:${cardH}:(ow-iw)/2:(oh-ih)/2:color=${palette.muted},format=rgba[c${index}]`
      );
    });
    let last = "[0:v]";
    assetPaths.forEach((_, index) => {
      const out = index === assetPaths.length - 1 ? "[stacked]" : `[v${index}]`;
      const pos = positions[index] ?? positions[positions.length - 1];
      filters.push(`${last}[c${index}]overlay=x=${pos.x}:y=${pos.y}:shortest=1${out}`);
      last = out;
    });
    if (assetPaths.length < positions.length) {
      const proxyFilters: string[] = [];
      for (let index = assetPaths.length; index < positions.length; index += 1) {
        const pos = positions[index];
        proxyFilters.push(`drawbox=x=${pos.x}:y=${pos.y}:w=${cardW}:h=${cardH}:color=${palette.muted}@0.82:t=fill`);
        proxyFilters.push(`drawbox=x=${pos.x + 12}:y=${pos.y + 12}:w=${cardW - 24}:h=${cardH - 24}:color=${palette.cool}@0.28:t=4`);
      }
      filters.push(`[stacked]${proxyFilters.join(",")}[partial]`);
      last = "[partial]";
    } else {
      last = "[stacked]";
    }
    const titleStyle = { ...options.textStyle, boxColor: "black@0.62", fontColor: "white" };
    filters.push(`${last}${drawTextFilter(options.subtitle?.trim() || "媒体卡片", titleStyle, 32, String(Math.round(options.height * 0.1)))}[out]`);
    await runFfmpeg([
      ...inputs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[out]",
      "-t",
      options.duration.toFixed(2),
      "-r",
      String(options.fps),
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "21",
      segmentPath
    ]);
  }

  private async renderBrandCtaAssetClip(
    clip: TimelineClip,
    logoPath: string,
    segmentPath: string,
    options: { width: number; height: number; fps: number; duration: number; subtitle: string; warnings: string[]; timeline: Timeline; textStyle: DrawTextStyle }
  ): Promise<void> {
    const palette = timelinePalette(options.timeline);
    const logo = Math.round(Math.min(options.width, options.height) * 0.28);
    const brand = escapeDrawText(stringStyleValue(clip, "brandName") ?? options.subtitle ?? "Viral Structure Engine");
    const cta = escapeDrawText(stringStyleValue(clip, "cta") ?? "Upload. Analyze. Remix.");
    const filters = [
      `[1:v]scale=${logo}:${logo}:force_original_aspect_ratio=decrease,pad=${logo}:${logo}:(ow-iw)/2:(oh-ih)/2:color=white,format=rgba[logo]`,
      `[0:v][logo]overlay=x=(main_w-overlay_w)/2:y=${Math.round(options.height * 0.25)}:shortest=1[v0]`,
      `[v0]${drawTextFilter(brand, { ...options.textStyle, boxColor: "black@0.0", fontColor: palette.text }, 42, String(Math.round(options.height * 0.52)))}[v1]`,
      `[v1]${drawTextFilter(cta, { ...options.textStyle, boxColor: `${palette.primary}@0.86`, fontColor: palette.text }, 34, String(Math.round(options.height * 0.64)))}[out]`
    ];
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${palette.bg}:s=${options.width}x${options.height}:d=${options.duration.toFixed(2)}`,
      "-loop",
      "1",
      "-t",
      options.duration.toFixed(2),
      "-i",
      logoPath,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[out]",
      "-t",
      options.duration.toFixed(2),
      "-r",
      String(options.fps),
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "21",
      segmentPath
    ]);
  }

  private async renderGeneratedCard(
    clip: TimelineClip,
    segmentPath: string,
    options: { width: number; height: number; fps: number; duration: number; subtitle: string; warnings: string[]; timeline: Timeline; textStyle: DrawTextStyle }
  ): Promise<boolean> {
    const palette = timelinePalette(options.timeline);
    const color = backgroundFor(clip, options.timeline);
    const decorations = [
      ...mgMotionDecorationFilters(options.timeline, options.width, options.height, palette),
      ...motionAtomFiltersFromRecipe(options.timeline, clip, options.width, options.height, palette)
    ];
    const proxyFilters = proxyPlaceholderFilters(clip, options.width, options.height, options.textStyle, palette);
    const visualFormFamily = String(clip.visualFormFamily ?? styleValueFromClip(clip, "visualFormFamily") ?? "");
    const centerSubtitle = visualFormFamily === "kinetic_typography";
    const subtitleY = centerSubtitle ? "(h-text_h)/2" : "h-(text_h*2)";
    const subtitleSize = centerSubtitle ? options.textStyle.cardFontSize : options.textStyle.sourceFontSize;
    const recipeText = recipeDrawTextFilter(options.subtitle, recipeTextLayerForClip(options.timeline, clip), options.textStyle, options.width, options.height);
    const filter = `color=c=${color}:s=${options.width}x${options.height}:d=${options.duration.toFixed(2)},format=yuv420p${
      decorations.length ? `,${decorations.join(",")}` : ""
    }${
      proxyFilters.length ? `,${proxyFilters.join(",")}` : ""
    }${
      options.subtitle && !proxyFilters.length
        ? `,${recipeText ?? drawTextFilter(options.subtitle, options.textStyle, subtitleSize, subtitleY)}`
        : ""
    }`;
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      filter,
      "-t",
      options.duration.toFixed(2),
      "-r",
      String(options.fps),
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      segmentPath
    ]);
    return false;
  }
}

export interface RemotionRendererOptions {
  generatedDir: string;
  entryPoint?: string;
  compositionId?: string;
  browserExecutable?: string;
  assetResolver?: AssetPathResolver;
  /** User-facing output basename ("theme_sampleName_timestamp"); renderId stays the internal key. */
  outputBasename?: string;
}

export class RemotionRenderer implements RendererAdapter {
  readonly target: RendererTarget = "remotion";
  private bundleLocation: string | null = null;
  private readonly opts: RemotionRendererOptions;

  constructor(opts: RemotionRendererOptions) {
    this.opts = opts;
  }

  async render(timeline: Timeline, generationId: string): Promise<RenderOutput> {
    const renderId = stableId("render_remotion", generationId, timeline.id);
    const outputPath = path.join(this.opts.generatedDir, `${this.opts.outputBasename?.trim() || renderId}.mp4`);
    const entryPoint = this.opts.entryPoint ?? path.resolve(process.cwd(), "remotion", "index.tsx");
    // The Remotion composition (ViralRecipeRoot) carries no <Audio>, so renderMedia emits an empty
    // stereo track (-91 dB silence). When the recipe asks for audio, render to a temp silent file
    // and mux the SAME evidence-derived procedural bed the FFmpeg path uses (buildProceduralBedSources)
    // so production / codegen / apply-proof renders are no longer silent.
    const needsAudio = (timeline.renderPlan?.audioPolicy ?? "silent") !== "silent";
    const silentPath = needsAudio ? outputPath.replace(/\.mp4$/i, ".silent.mp4") : outputPath;
    const renderQualityWarnings: string[] = [];

    if (!existsSync(entryPoint)) {
      return {
        renderId,
        generationId,
        rendererTarget: this.target,
        status: "failed",
        error: `Remotion entry not found at ${entryPoint}; set REMOTION_ENTRY env or place apps/api/remotion/index.tsx.`,
        createdAt: nowIso()
      };
    }

    try {
      const [{ bundle }, { renderMedia, selectComposition }] = await Promise.all([
        import("@remotion/bundler"),
        import("@remotion/renderer")
      ]);

      if (!this.bundleLocation) {
        this.bundleLocation = await bundle({ entryPoint });
      }

      const assetIds = Array.from(
        new Set(
          [
            ...timeline.clips.flatMap((clip) => [
              clip.sourceAssetId,
              ...clip.layers.map((layer) => layer.assetId)
            ]),
            ...((timeline.renderPlan?.renderRecipe?.clips ?? []).flatMap((clip) => clip.material?.assetIds ?? [])),
            ...((timeline.renderPlan?.renderRecipe?.layers ?? []).flatMap((layer) =>
              layer.type === "media" ? layer.material.assetIds : []
            ))
          ].filter((assetId): assetId is string => Boolean(assetId))
        )
      );
      // Serve resolved local VIDEO assets over an ephemeral localhost http server: OffthreadVideo
      // only accepts http/https sources (file:// is rejected and <Video> hangs loading its duration
      // for local files). Images stay inlined as data: URLs via remotionAssetSrc.
      const assetFileById = new Map<string, string>();
      const assetServer = http.createServer((req, res) => {
        const match = /^\/asset\/([^/?]+)/.exec(req.url ?? "");
        const file = match ? assetFileById.get(decodeURIComponent(match[1])) : undefined;
        if (!file || !existsSync(file)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("content-type", mimeForAssetExt(path.extname(file)) ?? "application/octet-stream");
        createReadStream(file).pipe(res).on("error", () => {
          res.statusCode = 500;
          res.end();
        });
      });
      await new Promise<void>((resolve) => assetServer.listen(0, "127.0.0.1", () => resolve()));
      const assetServerPort = (assetServer.address() as { port: number }).port;
      const assetBase = `http://127.0.0.1:${assetServerPort}`;

      try {
        const assetEntries = await Promise.all(
          assetIds.flatMap(async (assetId) => {
            const resolved = this.opts.assetResolver?.resolve(assetId);
            if (!resolved || !existsSync(resolved)) return [];
            const ext = path.extname(resolved).toLowerCase();
            if (/\.(mp4|mov|webm|m4v)$/i.test(ext)) {
              assetFileById.set(assetId, resolved);
              return [[assetId, { src: `${assetBase}/asset/${encodeURIComponent(assetId)}`, ext }]];
            }
            return [[assetId, { src: await remotionAssetSrc(resolved), ext }]];
          })
        );
        const assetMap = Object.fromEntries(assetEntries.flat());
        const inputProps = { timeline, assetMap };
        const browserExecutable = this.opts.browserExecutable ?? resolveRemotionBrowserExecutable();
        // disableWebSecurity lets headless Chrome load local/cross-origin material without CORS blocks.
        const chromiumOptions = { headless: true, disableWebSecurity: true } as const;
        const composition = await selectComposition({
          serveUrl: this.bundleLocation,
          id: this.opts.compositionId ?? "ViralReconstruction",
          inputProps,
          browserExecutable,
          chromiumOptions
        });

        await renderMedia({
          composition,
          serveUrl: this.bundleLocation,
          codec: "h264",
          outputLocation: silentPath,
          inputProps,
          browserExecutable,
          chromiumOptions,
          // Surface DEBUG_EFFECT_LABEL into the rendering browser so the effect label can show.
          ...(process.env.DEBUG_EFFECT_LABEL
            ? { envVariables: { DEBUG_EFFECT_LABEL: String(process.env.DEBUG_EFFECT_LABEL) } }
            : {})
        });
      } finally {
        assetServer.close();
      }

      // Mux the procedural audio bed onto the (otherwise silent) Remotion render so this path matches
      // the FFmpeg path. Failure is non-fatal: fall back to the silent render rather than no output.
      if (needsAudio) {
        const totalDuration = timeline.durationSec || timeline.clips.reduce((sum, c) => sum + Math.max(0.5, c.durationSec), 0);
        let audioMuxed = false;
        try {
          audioMuxed = await this.muxProceduralAudio(silentPath, outputPath, timeline, totalDuration);
        } catch (error) {
          console.warn(`[remotion] audio mux failed: ${(error as Error).message}`);
          renderQualityWarnings.push("audio_mux_failed");
        }
        if (!audioMuxed) {
          if (silentPath !== outputPath && existsSync(silentPath)) await fs.copyFile(silentPath, outputPath);
          renderQualityWarnings.push("no_audio");
        }
        if (silentPath !== outputPath) await fs.rm(silentPath, { force: true }).catch(() => {});
      }

      // v1.4: record creative-effect selection / fallback from the recipe into the render report.
      const recipe = timeline.renderPlan?.renderRecipe as
        | { effectProgramIds?: string[]; effectFallbackReason?: string; effectSelection?: { source?: string } }
        | undefined;
      const effectProgramIds = recipe?.effectProgramIds ?? [];
      const effectFallbackReason = recipe?.effectFallbackReason;
      return {
        renderId,
        generationId,
        rendererTarget: this.target,
        status: "completed",
        outputPath,
        previewHtml: `<video controls width="320"><source src="${path.basename(outputPath)}" type="video/mp4" /></video>`,
        ...(renderQualityWarnings.length ? { renderQualityWarnings } : {}),
        ...(effectProgramIds.length ? { effectProgramIds } : {}),
        ...(effectFallbackReason ? { effectFallbackReason } : {}),
        ...(recipe?.effectSelection?.source ? { effectSelectionSource: recipe.effectSelection.source } : {}),
        createdAt: nowIso()
      };
    } catch (error) {
      return {
        renderId,
        generationId,
        rendererTarget: this.target,
        status: "failed",
        error: `RemotionRenderer failed: ${(error as Error).message}`,
        createdAt: nowIso()
      };
    }
  }

  /**
   * Mux the shared procedural audio bed onto a silent Remotion render. Drops Remotion's default empty
   * stereo track (-map 0:v:0 only) and writes a mono (-ac 1) track to match the FFmpeg/pure-codegen
   * signature. Returns true on success. The bed is evidence-derived (buildProceduralBedSources), so
   * arbitrary inputs flow through the same generator — no sample-name branching.
   */
  private async muxProceduralAudio(
    silentPath: string,
    finalPath: string,
    timeline: Timeline,
    durationSec: number
  ): Promise<boolean> {
    const sources = buildProceduralBedSources(timeline, durationSec);
    if (!sources.length) return false;
    const dur = Math.max(1, durationSec).toFixed(2);
    const lavfiInputs = sources.flatMap((source) => ["-f", "lavfi", "-i", source]);
    const labels = sources.map((_, index) => `[${index + 1}]`).join("");
    const filterComplex = `${labels}amix=inputs=${sources.length}:duration=longest:normalize=0,highpass=f=30,alimiter=limit=0.9[a]`;
    await runFfmpeg([
      "-y", "-i", silentPath,
      ...lavfiInputs,
      "-filter_complex", filterComplex,
      "-map", "0:v:0", "-map", "[a]", "-t", dur,
      "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "1", "-shortest",
      "-movflags", "+faststart", finalPath
    ]);
    return true;
  }
}

export interface HyperFramesRendererOptions {
  generatedDir: string;
}

export class HyperFramesRenderer implements RendererAdapter {
  readonly target: RendererTarget = "hyperframes";
  private readonly opts: HyperFramesRendererOptions;

  constructor(opts: HyperFramesRendererOptions) {
    this.opts = opts;
  }

  async render(timeline: Timeline, generationId: string): Promise<RenderOutput> {
    const renderId = stableId("render_hyperframes", generationId, timeline.id);
    const manifestDir = path.join(this.opts.generatedDir, "hyperframes", renderId);
    await fs.mkdir(manifestDir, { recursive: true });
    const manifest = {
      renderer: "HyperFramesRenderer",
      version: "stub-v1",
      generationId,
      timelineId: timeline.id,
      aspectRatio: timeline.aspectRatio,
      durationSec: timeline.durationSec,
      note:
        "HyperFrames does not yet have a public SDK; this manifest is what a HyperFrames coding-style renderer would consume.",
      composition: {
        fps: timeline.renderPlan?.fps ?? 30,
        width: timeline.renderPlan?.width ?? (timeline.aspectRatio === "9:16" ? 720 : 1280),
        height: timeline.renderPlan?.height ?? (timeline.aspectRatio === "9:16" ? 1280 : 720),
        background: timeline.renderPlan?.background ?? "#0f172a"
      },
      sequences: timeline.clips.map((clip) => ({
        id: clip.id,
        role: clip.role,
        from: clip.startSec,
        duration: clip.durationSec,
        type: clip.type,
        subtitle: clip.subtitleText ?? null,
        visualIntent: clip.visualIntent ?? null,
        sourceAssetId: clip.sourceAssetId ?? null,
        sourceShotId: clip.sourceShotId ?? null,
        layers: clip.layers.map((layer) => ({ kind: layer.kind, text: layer.text ?? null }))
      })),
      gapFillStrategies: timeline.fillPlan.map((action) => ({ slotId: action.slotId, strategy: action.strategy }))
    };
    const manifestPath = path.join(manifestDir, "hyperframes.json");
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    const previewHtml = [
      "<section style=\"font-family:system-ui;padding:16px;background:#0f172a;color:#f8fafc;border-radius:12px;\">",
      "<h2 style=\"margin-top:0;\">HyperFrames manifest (stub)</h2>",
      `<p>Render ${renderId} would compile ${manifest.sequences.length} sequences (${timeline.durationSec.toFixed(1)}s) to MP4 via a HyperFrames coding renderer.</p>`,
      `<pre style=\"background:#1e293b;padding:12px;border-radius:8px;font-size:12px;overflow:auto;\">${JSON.stringify(
        manifest.composition,
        null,
        2
      )}</pre>`,
      "</section>"
    ].join("");
    return {
      renderId,
      generationId,
      rendererTarget: this.target,
      status: "completed",
      outputPath: manifestPath,
      previewHtml,
      error: undefined,
      createdAt: nowIso()
    };
  }
}

export interface RendererSelectOptions extends FFmpegRendererOptions {
  remotionEntryPoint?: string;
  remotionCompositionId?: string;
}

export class ImageCardRenderer implements RendererAdapter {
  readonly target: RendererTarget = "html_preview";

  async render(timeline: Timeline, generationId: string): Promise<RenderOutput> {
    const renderId = stableId("render_image_card", generationId, timeline.id);
    const cards = timeline.clips.map((clip) => `<article><strong>${clip.role}</strong><p>${clip.subtitleText ?? clip.visualIntent ?? ""}</p></article>`).join("");
    return {
      renderId,
      generationId,
      rendererTarget: this.target,
      status: "completed",
      previewHtml: `<section class="image-card-renderer">${cards}</section>`,
      createdAt: nowIso()
    };
  }
}

export class AigcVideoFillStubRenderer implements RendererAdapter {
  readonly target: RendererTarget = "hyperframes";
  private readonly opts: { generatedDir: string };

  constructor(opts: { generatedDir: string }) {
    this.opts = opts;
  }

  async render(timeline: Timeline, generationId: string): Promise<RenderOutput> {
    const renderId = stableId("render_aigc_stub", generationId, timeline.id);
    const manifestDir = path.join(this.opts.generatedDir, "aigc_video_fill_stub", renderId);
    await fs.mkdir(manifestDir, { recursive: true });
    const manifestPath = path.join(manifestDir, "manifest.json");
    await fs.writeFile(
      manifestPath,
      JSON.stringify(
        {
          renderer: "aigc_video_fill_stub",
          generationId,
          timelineId: timeline.id,
          note: "Stub only. No paid or external video-generation API was called.",
          fillPlan: timeline.fillPlan.map((action) => ({
            slotId: action.slotId,
            strategy: action.strategy,
            renderer: action.rendererInstructions?.renderer,
            fallbackRenderer: action.rendererInstructions?.fallbackRenderer,
            requiredInputs: action.rendererInstructions?.requiredInputs ?? []
          }))
        },
        null,
        2
      ),
      "utf8"
    );
    return {
      renderId,
      generationId,
      rendererTarget: this.target,
      status: "completed",
      outputPath: manifestPath,
      previewHtml: `<p>AIGC video fill stub manifest written to ${path.basename(manifestPath)}. No external model call was made.</p>`,
      createdAt: nowIso()
    };
  }
}

export interface RendererRegistryEntry {
  backend: RendererBackend;
  target: RendererTarget;
  label: string;
  create(opts: RendererSelectOptions): RendererAdapter;
}

export const RendererRegistry: Record<RendererBackend, RendererRegistryEntry> = {
  remotion_mg: {
    backend: "remotion_mg",
    target: "remotion",
    label: "Remotion MG/dynamic poster renderer",
    create: (opts) =>
      new RemotionRenderer({
        generatedDir: opts.generatedDir,
        entryPoint: opts.remotionEntryPoint,
        compositionId: opts.remotionCompositionId,
        assetResolver: opts.assetResolver,
        outputBasename: opts.outputBasename
      })
  },
  remotion_recipe_compose: {
    backend: "remotion_recipe_compose",
    target: "remotion_recipe",
    label: "Remotion RenderRecipe-driven renderer (ViralRecipe composition)",
    create: (opts) =>
      new RemotionRenderer({
        generatedDir: opts.generatedDir,
        entryPoint: opts.remotionEntryPoint,
        compositionId: opts.remotionCompositionId ?? "ViralRecipe",
        assetResolver: opts.assetResolver,
        outputBasename: opts.outputBasename
      })
  },
  ffmpeg_compose: {
    backend: "ffmpeg_compose",
    target: "ffmpeg",
    label: "FFmpeg source compose renderer",
    create: (opts) => new FFmpegRenderer(opts)
  },
  image_card: {
    backend: "image_card",
    target: "html_preview",
    label: "Deterministic text/image card renderer",
    create: () => new ImageCardRenderer()
  },
  aigc_video_fill_stub: {
    backend: "aigc_video_fill_stub",
    target: "hyperframes",
    label: "AIGC video fill stub manifest renderer",
    create: (opts) => new AigcVideoFillStubRenderer({ generatedDir: opts.generatedDir })
  }
};

export function selectRendererBackend(backend: RendererBackend, opts: RendererSelectOptions): RendererAdapter {
  return RendererRegistry[backend].create(opts);
}

export function selectRenderer(target: RendererTarget, opts: RendererSelectOptions): RendererAdapter {
  switch (target) {
    case "ffmpeg":
      return selectRendererBackend("ffmpeg_compose", opts);
    case "remotion":
      return selectRendererBackend("remotion_mg", opts);
    case "remotion_recipe":
      return selectRendererBackend("remotion_recipe_compose", opts);
    case "hyperframes":
      return new HyperFramesRenderer({ generatedDir: opts.generatedDir });
    case "html_preview":
    default:
      return new HtmlPreviewRenderer();
  }
}
