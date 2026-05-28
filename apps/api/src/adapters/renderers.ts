import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { HtmlPreviewRenderer, MockRenderer } from "@vvst/renderer";
import {
  nowIso,
  stableId,
  type RenderOutput,
  type RendererAdapter,
  type RendererBackend,
  type RendererTarget,
  type Timeline,
  type TimelineClip
} from "@vvst/shared";

export { HtmlPreviewRenderer, MockRenderer };

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
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return fallback;
  return `0x${hex.slice(1)}`;
}

function backgroundFor(clip: TimelineClip, timeline: Timeline): string {
  const base = ffmpegColor(timeline.renderPlan?.background, "");
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

function mgMotionDecorationFilters(timeline: Timeline, width: number, height: number): string[] {
  const packagingStyle = String(timeline.renderPlan?.adapterOptions?.packagingStyle ?? "");
  if (packagingStyle !== "mg_motion") return [];
  const top = Math.round(height * 0.15);
  const mid = Math.round(height * 0.72);
  const lower = Math.round(height * 0.82);
  const keywordStyle: DrawTextStyle = {
    fontColor: "0x38bdf8",
    boxColor: "black@0.0",
    sourceFontSize: 28,
    cardFontSize: 28
  };
  return [
    `drawbox=x=0:y=${top}:w=${width}:h=26:color=0x38bdf8@0.22:t=fill`,
    `drawbox=x=0:y=${top + 34}:w=${width}:h=18:color=0xa855f7@0.24:t=fill`,
    `drawbox=x=0:y=${mid}:w=${width}:h=22:color=0xf97316@0.25:t=fill`,
    `drawbox=x=0:y=${lower}:w=${width}:h=16:color=0x22c55e@0.24:t=fill`,
    drawTextFilter("STRUCTURE / REMIX / TIMELINE / AIGC", keywordStyle, 28, String(top + 58))
  ];
}

function proxyPlaceholderFilters(clip: TimelineClip, width: number, height: number, style: DrawTextStyle): string[] {
  const proxyLayer = clip.layers.find((layer) => layer.style?.fillStrategy === "proxy_placeholder");
  if (clip.gapFillStrategy !== "proxy_placeholder" && !proxyLayer) return [];
  const placeholder = (clip.placeholderSpec ?? proxyLayer?.style?.placeholderSpec ?? {}) as {
    label?: string;
    color?: string;
    shape?: string;
  };
  const replacementSlotId = String(clip.replacementSlotId ?? proxyLayer?.style?.replacementSlotId ?? "");
  const visualForm = String(proxyLayer?.style?.visualForm ?? "");
  const labelRaw = String(placeholder.label ?? "Rotating hero object placeholder");
  const isRotatingHero =
    replacementSlotId.includes("rotating_hero") ||
    visualForm === "rotating_3d_object" ||
    /rotating|hero object|helmet|head|logo/i.test(labelRaw);
  const isMontage =
    replacementSlotId.includes("beat_sync") ||
    replacementSlotId.includes("match_cut") ||
    visualForm === "action_montage_sequence" ||
    visualForm === "match_cut_sequence" ||
    /montage|match|action|beat/i.test(labelRaw);
  const proxyColor = ffmpegColor(placeholder.color, "0xE53935");
  const size = Math.round(Math.min(width, height) * 0.34);
  const x = Math.round((width - size) / 2);
  const y = Math.round(height * 0.27);
  const badgeY = Math.round(y + size + height * 0.05);
  const label = escapeDrawText(labelRaw);
  const shapeLabel = escapeDrawText(`PROXY PLACEHOLDER · ${placeholder.shape ?? "shape"}`);

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
      `drawbox=x=iw-${Math.round(width * 0.46)}:y=${Math.round(height * 0.82)}:w='${Math.round(width * 0.32)}+${Math.round(width * 0.14)}*cos(2*PI*t*2)':h=10:color=0x38bdf8@0.46:t=fill`,
      drawTextFilter(shapeLabel, { ...style, boxColor: "black@0.58", fontColor: "white" }, 30, String(Math.max(24, y - 82))),
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
      `drawbox=x=${cardX + Math.round(cardW * 0.26)}:y=${cardY + Math.round(cardH * 2.25)}:w=${Math.round(cardW * 0.62)}:h=${cardH}:color=0xf97316@0.72:t=fill`,
      `drawbox=x=${cardX}:y=${cardY}:w='${cardW}*${pulse}':h=8:color=white@0.72:t=fill`,
      `drawbox=x=${cardX}:y=${cardY + cardH + 28}:w='${Math.round(cardW * 0.7)}*${pulse}':h=8:color=0x38bdf8@0.78:t=fill`,
      `drawbox=x=${cardX + Math.round(cardW * 0.26)}:y=${cardY + Math.round(cardH * 2.25)}:w='${Math.round(cardW * 0.62)}*${pulse}':h=8:color=white@0.78:t=fill`,
      `drawbox=x='mod(t*${Math.round(width * 1.8)},iw)':y=${Math.round(height * 0.2)}:w=34:h=${Math.round(height * 0.66)}:color=white@0.14:t=fill`,
      drawTextFilter(shapeLabel, { ...style, boxColor: "black@0.58", fontColor: "white" }, 30, String(Math.max(24, y - 76))),
      drawTextFilter(label, { ...style, boxColor: "black@0.66", fontColor: "white" }, 34, String(badgeY))
    ];
  }

  return [
    `drawbox=x=${x - 18}:y=${y - 18}:w=${size + 36}:h=${size + 36}:color=white@0.16:t=fill`,
    `drawbox=x=${x}:y=${y}:w=${size}:h=${size}:color=${proxyColor}@0.92:t=fill`,
    `drawbox=x=${x}:y=${y}:w=${size}:h=${size}:color=white@0.86:t=8`,
    drawTextFilter(shapeLabel, { ...style, boxColor: "black@0.55", fontColor: "white" }, 30, String(Math.max(24, y - 76))),
    drawTextFilter(label, { ...style, boxColor: "black@0.62", fontColor: "white" }, 34, String(badgeY))
  ];
}

export interface FFmpegRendererOptions {
  generatedDir: string;
  assetResolver: AssetPathResolver;
  preferSourceClips?: boolean;
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
    const segmentFiles: string[] = [];
    const warnings: string[] = [];

    for (let index = 0; index < timeline.clips.length; index += 1) {
      const clip = timeline.clips[index];
      const segmentPath = path.join(workDir, `clip_${index + 1}.mp4`);
      const subtitle = escapeDrawText(clip.subtitleText ?? clip.visualIntent ?? "");
      const duration = Math.max(0.5, clip.durationSec);
      const usedSource = await this.renderClip(clip, segmentPath, { width, height, fps, duration, subtitle, warnings, timeline, textStyle });
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
    const outputPath = path.join(this.opts.generatedDir, `${renderId}.mp4`);
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", outputPath]);

    return {
      renderId,
      generationId,
      rendererTarget: this.target,
      status: "completed",
      outputPath,
      previewHtml: `<video controls width="320"><source src="${path.basename(outputPath)}" type="video/mp4" /></video>`,
      error: warnings.length ? warnings.join(" | ") : undefined,
      createdAt: nowIso()
    };
  }

  private async renderClip(
    clip: TimelineClip,
    segmentPath: string,
    options: { width: number; height: number; fps: number; duration: number; subtitle: string; warnings: string[]; timeline: Timeline; textStyle: DrawTextStyle }
  ): Promise<boolean> {
    const sourcePath = clip.sourceAssetId ? this.opts.assetResolver.resolve(clip.sourceAssetId) : undefined;
    if (sourcePath && (clip.type === "video" || clip.type === "image")) {
      try {
        const filter = [
          `scale=${options.width}:${options.height}:force_original_aspect_ratio=increase`,
          `crop=${options.width}:${options.height}`,
          options.subtitle
            ? drawTextFilter(options.subtitle, options.textStyle, options.textStyle.sourceFontSize, "h-(text_h*2)")
            : ""
        ]
          .filter(Boolean)
          .join(",");
        await runFfmpeg([
          "-y",
          "-ss",
          "0",
          "-t",
          options.duration.toFixed(2),
          "-i",
          sourcePath,
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
    return this.renderGeneratedCard(clip, segmentPath, options);
  }

  private async renderGeneratedCard(
    clip: TimelineClip,
    segmentPath: string,
    options: { width: number; height: number; fps: number; duration: number; subtitle: string; warnings: string[]; timeline: Timeline; textStyle: DrawTextStyle }
  ): Promise<boolean> {
    const color = backgroundFor(clip, options.timeline);
    const decorations = mgMotionDecorationFilters(options.timeline, options.width, options.height);
    const proxyFilters = proxyPlaceholderFilters(clip, options.width, options.height, options.textStyle);
    const filter = `color=c=${color}:s=${options.width}x${options.height}:d=${options.duration.toFixed(2)},format=yuv420p${
      decorations.length ? `,${decorations.join(",")}` : ""
    }${
      proxyFilters.length ? `,${proxyFilters.join(",")}` : ""
    }${
      options.subtitle && !proxyFilters.length
        ? `,${drawTextFilter(options.subtitle, options.textStyle, options.textStyle.cardFontSize, "(h-text_h)/2")}`
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
    const outputPath = path.join(this.opts.generatedDir, `${renderId}.mp4`);
    const entryPoint = this.opts.entryPoint ?? path.resolve(process.cwd(), "remotion", "index.tsx");

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
          timeline.clips.flatMap((clip) => [
            clip.sourceAssetId,
            ...clip.layers.map((layer) => layer.assetId)
          ]).filter((assetId): assetId is string => Boolean(assetId))
        )
      );
      const assetEntries = await Promise.all(
        assetIds.flatMap(async (assetId) => {
          const resolved = this.opts.assetResolver?.resolve(assetId);
          if (!resolved || !existsSync(resolved)) return [];
          return [[assetId, { src: await remotionAssetSrc(resolved), ext: path.extname(resolved).toLowerCase() }]];
        })
      );
      const assetMap = Object.fromEntries(assetEntries.flat());
      const inputProps = { timeline, assetMap };
      const browserExecutable = this.opts.browserExecutable ?? resolveRemotionBrowserExecutable();
      const composition = await selectComposition({
        serveUrl: this.bundleLocation,
        id: this.opts.compositionId ?? "ViralReconstruction",
        inputProps,
        browserExecutable
      });

      await renderMedia({
        composition,
        serveUrl: this.bundleLocation,
        codec: "h264",
        outputLocation: outputPath,
        inputProps,
        browserExecutable,
        chromiumOptions: { headless: true }
      });

      return {
        renderId,
        generationId,
        rendererTarget: this.target,
        status: "completed",
        outputPath,
        previewHtml: `<video controls width="320"><source src="${path.basename(outputPath)}" type="video/mp4" /></video>`,
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
        assetResolver: opts.assetResolver
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
    case "hyperframes":
      return new HyperFramesRenderer({ generatedDir: opts.generatedDir });
    case "mock_preview":
      return new MockRenderer();
    case "html_preview":
    default:
      return new HtmlPreviewRenderer();
  }
}
