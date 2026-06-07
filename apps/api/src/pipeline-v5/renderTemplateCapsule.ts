// pipeline-v5/renderTemplateCapsule.ts
// Dynamic per-generation render of a RemotionTemplateCapsule's CODE with bound props. Writes the
// capsule files + a Remotion root (that registers a <Composition> driven by boundProps) into a temp
// project UNDER the repo (so node_modules resolves), bundles, and renders. This is what makes
// "use the same template code, new content" real — the stored template component renders the new props.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v5 } from "@vvst/shared";
import { muxProceduralAudio } from "./renderV5.js";
import { renderSemaphore, RENDER_TABS_PER_JOB, nextSeq } from "./concurrency.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../../..");

export interface CapsuleRenderResult {
  ok: boolean;
  finalMp4?: string;
  hasAudio: boolean;
  audioMuxed: boolean;
  durationSec: number;
  usedTemplateCode: boolean;
  warnings: string[];
  error?: string;
}

function dimsFor(aspect: string | undefined): { width: number; height: number } {
  if (aspect === "16:9") return { width: 1920, height: 1080 };
  if (aspect === "1:1") return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

/** Write the capsule files + a Remotion root registering the "Capsule" composition into workDir. */
async function writeCapsuleProject(
  capsule: v5.RemotionTemplateCapsule,
  workDir: string,
  durationFrames: number,
  fps: number,
  width: number,
  height: number
): Promise<string> {
  await fs.mkdir(workDir, { recursive: true });
  for (const f of capsule.codeBundle.files) {
    const fp = path.join(workDir, f.path);
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, f.content);
  }
  const entryNoExt = capsule.codeBundle.entryFile.replace(/\.(tsx|ts|jsx|js)$/, "");
  const comp = capsule.codeBundle.componentName;
  const rootTsx = `import React from "react";
import { Composition, registerRoot } from "remotion";
import { ${comp} } from "./${entryNoExt}";
const Root = () => (
  <Composition id="Capsule" component={${comp}} durationInFrames={${Math.max(1, durationFrames)}} fps={${fps}} width={${width}} height={${height}} defaultProps={{}} />
);
registerRoot(Root);
`;
  const rootPath = path.join(workDir, "root.tsx");
  await fs.writeFile(rootPath, rootTsx);
  return rootPath;
}

export interface CapsuleStillResult {
  ok: boolean;
  pngPath?: string;
  error?: string;
  warnings: string[];
}

/**
 * Fast REAL render gate: bundle the capsule code and render a single frame via renderStill.
 * This is the cheap "does it actually bundle + render" check used by the AI codegen gate and by
 * learn-time validation (so T8/renderPreviewPassed is earned, not deferred). Bundling dominates cost.
 */
export async function renderCapsuleStill(opts: {
  capsule: v5.RemotionTemplateCapsule;
  boundProps: Record<string, unknown>;
  aspectRatio?: string;
  frame?: number;
  workDir?: string;
  outPng?: string;
}): Promise<CapsuleStillResult> {
  const warnings: string[] = [];
  const durationSec = opts.capsule.timingSignature.durationSec || 16;
  const fps = opts.capsule.timingSignature.fps || 30;
  const { width, height } = dimsFor(opts.aspectRatio);
  // Unique workDir (Date.now + monotonic seq) so concurrent still-renders of the same capsule never collide.
  const workDir = opts.workDir ?? path.join(repoRoot, "storage", "generated", "v5", "_capsule_still", `${opts.capsule.id}_${Date.now()}_${nextSeq()}`);
  const outPng = opts.outPng ?? path.join(workDir, "frame.png");
  try {
    const rootPath = await writeCapsuleProject(opts.capsule, workDir, Math.round(durationSec * fps), fps, width, height);
    return await renderSemaphore.run(async () => {
      const [{ bundle }, { renderStill, selectComposition }] = await Promise.all([import("@remotion/bundler"), import("@remotion/renderer")]);
      const serveUrl = await bundle({ entryPoint: rootPath });
      const composition = await selectComposition({ serveUrl, id: "Capsule", inputProps: opts.boundProps });
      await renderStill({ composition, serveUrl, output: outPng, frame: opts.frame ?? 0, inputProps: opts.boundProps, overwrite: true });
      const ok = existsSync(outPng);
      return { ok, pngPath: ok ? outPng : undefined, warnings, error: ok ? undefined : "still not written to disk" };
    });
  } catch (err) {
    return { ok: false, warnings, error: err instanceof Error ? err.message.slice(0, 220) : String(err) };
  }
}

export interface CapsuleRenderOptions {
  capsule: v5.RemotionTemplateCapsule;
  boundProps: Record<string, unknown>;
  outPath: string;
  /** Temp project dir under the repo (defaults under storage/generated/v5/_capsule_render). */
  workDir?: string;
  aspectRatio?: string;
  proceduralAudio?: boolean;
  bpm?: number | null;
  hitTimes?: number[];
  riserTime?: number;
}

/** Render the capsule's stored Remotion component with the bound props. */
export async function renderTemplateCapsule(opts: CapsuleRenderOptions): Promise<CapsuleRenderResult> {
  const warnings: string[] = [];
  const durationSec = opts.capsule.timingSignature.durationSec || 16;
  const fps = opts.capsule.timingSignature.fps || 30;
  const { width, height } = dimsFor(opts.aspectRatio);
  const workDir = opts.workDir ?? path.join(repoRoot, "storage", "generated", "v5", "_capsule_render", `${opts.capsule.id}_${Math.round(durationSec * 1000)}_${nextSeq()}`);

  try {
    await fs.mkdir(workDir, { recursive: true });
    // 1. write capsule code files
    for (const f of opts.capsule.codeBundle.files) {
      const fp = path.join(workDir, f.path);
      await fs.mkdir(path.dirname(fp), { recursive: true });
      await fs.writeFile(fp, f.content);
    }
    // 2. write a Remotion root that registers the capsule component as a composition
    const entryNoExt = opts.capsule.codeBundle.entryFile.replace(/\.(tsx|ts|jsx|js)$/, "");
    const comp = opts.capsule.codeBundle.componentName;
    const rootTsx = `import React from "react";
import { Composition, registerRoot } from "remotion";
import { ${comp} } from "./${entryNoExt}";
const Root = () => (
  <Composition
    id="Capsule"
    component={${comp}}
    durationInFrames={${Math.max(1, Math.round(durationSec * fps))}}
    fps={${fps}}
    width={${width}}
    height={${height}}
    defaultProps={{}}
  />
);
registerRoot(Root);
`;
    await fs.writeFile(path.join(workDir, "root.tsx"), rootTsx);

    const inputProps = opts.boundProps;
    const remotionMp4 = opts.proceduralAudio ? `${opts.outPath}.silent.mp4` : opts.outPath;
    // Cap concurrent headless-Chrome renders process-wide AND cap tabs-per-render (memory = slots × tabs).
    // Bound the OffthreadVideo frame cache too (heavy montages with many <OffthreadVideo> can otherwise
    // balloon the Rust compositor's cache -> frame_cache panic). Retry once on transient compositor crashes.
    const offthreadCacheBytes = Number(process.env.OFFTHREAD_VIDEO_CACHE_BYTES ?? 512 * 1024 * 1024);
    let renderErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await renderSemaphore.run(async () => {
          const [{ bundle }, { renderMedia, selectComposition }] = await Promise.all([
            import("@remotion/bundler"),
            import("@remotion/renderer")
          ]);
          const serveUrl = await bundle({ entryPoint: path.join(workDir, "root.tsx") });
          const composition = await selectComposition({ serveUrl, id: "Capsule", inputProps });
          await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: remotionMp4, inputProps, concurrency: RENDER_TABS_PER_JOB, offthreadVideoCacheSizeInBytes: offthreadCacheBytes });
        });
        renderErr = undefined;
        break;
      } catch (err) {
        renderErr = err;
        warnings.push(`render attempt ${attempt + 1} failed: ${err instanceof Error ? err.message.slice(0, 140) : String(err)}`);
      }
    }
    if (renderErr) throw renderErr;

    let finalMp4 = remotionMp4;
    let audioMuxed = false;
    if (opts.proceduralAudio) {
      const mux = await muxProceduralAudio(remotionMp4, opts.outPath, durationSec, { bpm: opts.bpm ?? null, hitTimes: opts.hitTimes ?? [], riserTime: opts.riserTime });
      if (mux.ok) {
        finalMp4 = opts.outPath;
        audioMuxed = true;
      } else {
        // Honest degrade: the template code rendered fine; only the procedural-audio mux failed
        // (e.g. ffmpeg missing). Promote the silent render to the real output so final.mp4 actually
        // EXISTS and is playable — reported with hasAudio=false rather than a URL to a missing file.
        warnings.push(`procedural audio mux failed — emitting silent final.mp4: ${mux.error}`);
        await fs.copyFile(remotionMp4, opts.outPath);
        finalMp4 = opts.outPath;
      }
    }
    // Tie success to the file actually existing on disk; never claim a render that isn't there.
    const finalExists = existsSync(finalMp4);
    return {
      ok: finalExists,
      finalMp4,
      hasAudio: audioMuxed,
      audioMuxed,
      durationSec,
      usedTemplateCode: finalExists,
      warnings: finalExists ? warnings : [...warnings, `render output missing on disk: ${path.basename(finalMp4)}`]
    };
  } catch (err) {
    return { ok: false, hasAudio: false, audioMuxed: false, durationSec, usedTemplateCode: false, warnings, error: err instanceof Error ? err.message : String(err) };
  } finally {
    // best-effort cleanup of the temp project (keep on error for debugging)
  }
}
