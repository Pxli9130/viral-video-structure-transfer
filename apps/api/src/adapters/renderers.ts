import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
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
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "’")
    .replace(/\n/g, " ")
    .slice(0, 60);
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

function backgroundFor(clip: TimelineClip): string {
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
    const segmentFiles: string[] = [];
    const warnings: string[] = [];

    for (let index = 0; index < timeline.clips.length; index += 1) {
      const clip = timeline.clips[index];
      const segmentPath = path.join(workDir, `clip_${index + 1}.mp4`);
      const subtitle = escapeDrawText(clip.subtitleText ?? clip.visualIntent ?? "");
      const duration = Math.max(0.5, clip.durationSec);
      const usedSource = await this.renderClip(clip, segmentPath, { width, height, fps, duration, subtitle, warnings });
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
    options: { width: number; height: number; fps: number; duration: number; subtitle: string; warnings: string[] }
  ): Promise<boolean> {
    const sourcePath = clip.sourceAssetId ? this.opts.assetResolver.resolve(clip.sourceAssetId) : undefined;
    if (sourcePath && (clip.type === "video" || clip.type === "image")) {
      try {
        const filter = [
          `scale=${options.width}:${options.height}:force_original_aspect_ratio=increase`,
          `crop=${options.width}:${options.height}`,
          options.subtitle
            ? `drawtext=text='${options.subtitle}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=h-(text_h*2):box=1:boxcolor=black@0.45:boxborderw=18`
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
    options: { width: number; height: number; fps: number; duration: number; subtitle: string; warnings: string[] }
  ): Promise<boolean> {
    const color = backgroundFor(clip);
    const filter = `color=c=${color}:s=${options.width}x${options.height}:d=${options.duration.toFixed(2)},format=yuv420p${
      options.subtitle
        ? `,drawtext=text='${options.subtitle}':fontcolor=white:fontsize=46:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.45:boxborderw=18`
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

export class RemotionRenderer implements RendererAdapter {
  readonly target: RendererTarget = "remotion";

  async render(timeline: Timeline, generationId: string): Promise<RenderOutput> {
    return {
      renderId: stableId("render_remotion", generationId, timeline.id),
      generationId,
      rendererTarget: this.target,
      status: "failed",
      error: "RemotionRenderer not yet implemented; placeholder adapter only.",
      createdAt: nowIso()
    };
  }
}

export class HyperFramesRenderer implements RendererAdapter {
  readonly target: RendererTarget = "hyperframes";

  async render(timeline: Timeline, generationId: string): Promise<RenderOutput> {
    return {
      renderId: stableId("render_hyperframes", generationId, timeline.id),
      generationId,
      rendererTarget: this.target,
      status: "failed",
      error: "HyperFramesRenderer not yet implemented; placeholder adapter only.",
      createdAt: nowIso()
    };
  }
}

export function selectRenderer(target: RendererTarget, opts: FFmpegRendererOptions): RendererAdapter {
  switch (target) {
    case "ffmpeg":
      return new FFmpegRenderer(opts);
    case "mock_preview":
      return new MockRenderer();
    case "remotion":
      return new RemotionRenderer();
    case "hyperframes":
      return new HyperFramesRenderer();
    case "html_preview":
    default:
      return new HtmlPreviewRenderer();
  }
}
