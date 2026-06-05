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
  const workDir = opts.workDir ?? path.join(repoRoot, "storage", "generated", "v5", "_capsule_render", `${opts.capsule.id}_${Math.round(durationSec * 1000)}`);

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

    const [{ bundle }, { renderMedia, selectComposition }] = await Promise.all([
      import("@remotion/bundler"),
      import("@remotion/renderer")
    ]);
    const serveUrl = await bundle({ entryPoint: path.join(workDir, "root.tsx") });
    const inputProps = opts.boundProps;
    const composition = await selectComposition({ serveUrl, id: "Capsule", inputProps });
    const remotionMp4 = opts.proceduralAudio ? `${opts.outPath}.silent.mp4` : opts.outPath;
    await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: remotionMp4, inputProps });

    let finalMp4 = remotionMp4;
    let audioMuxed = false;
    if (opts.proceduralAudio) {
      const mux = muxProceduralAudio(remotionMp4, opts.outPath, durationSec, { bpm: opts.bpm ?? null, hitTimes: opts.hitTimes ?? [], riserTime: opts.riserTime });
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
