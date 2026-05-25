import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HtmlPreviewRenderer, MockRenderer } from "@vvst/renderer";
import {
  nowIso,
  stableId,
  type RenderOutput,
  type RendererAdapter,
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
    const filter = `color=c=${color}:s=${options.width}x${options.height}:d=${options.duration.toFixed(2)},format=yuv420p${
      decorations.length ? `,${decorations.join(",")}` : ""
    }${
      options.subtitle
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

      const inputProps = { timeline };
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

export function selectRenderer(target: RendererTarget, opts: RendererSelectOptions): RendererAdapter {
  switch (target) {
    case "ffmpeg":
      return new FFmpegRenderer(opts);
    case "mock_preview":
      return new MockRenderer();
    case "remotion":
      return new RemotionRenderer({
        generatedDir: opts.generatedDir,
        entryPoint: opts.remotionEntryPoint,
        compositionId: opts.remotionCompositionId
      });
    case "hyperframes":
      return new HyperFramesRenderer({ generatedDir: opts.generatedDir });
    case "html_preview":
    default:
      return new HtmlPreviewRenderer();
  }
}
