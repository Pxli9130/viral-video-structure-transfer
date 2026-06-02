#!/usr/bin/env node
// Render the PURE codegen output (Gemini-generated Remotion effect components) to real .mp4 via
// Remotion bundle + renderMedia. This renders the generated component DIRECTLY (its own Composition
// fed its fixture) — it does NOT apply/promote to the KB/manifest and does NOT go through
// EffectRegistry/ViralRecipeRoot. It is a standalone "does the pure generated code actually render"
// probe. Real headless Chrome; nothing faked. Duration = fixture.durationSec * fps (full, NOT clamped to ~6s); --max-sec is only a high safety ceiling.
//
// Usage:
//   node scripts/render-pure-codegen-output.mjs --run-dir <dir> [--case <id>] [--max-sec 6]
// Only cases whose proposal status is gemini_ok (real Gemini component on disk) are rendered;
// others are skipped with a recorded reason (never faked).

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Task 4: deterministic procedural audio (non-silent) per motif. A continuous drone + periodic
// impact kicks via ffmpeg aevalsrc — no external/sample audio. Commas in mod() are escaped for lavfi.
function audioExprForMotif(motif) {
  switch (motif) {
    case "card_orbit_motion_graph": // dark pulse + impact hits
      return "0.22*sin(2*PI*48*t)+0.50*exp(-9*mod(t\\,0.5))*sin(2*PI*120*t)+0.18*exp(-22*mod(t\\,0.5))*sin(2*PI*320*t)";
    case "blue_spotlight_ui_pitch": // tech ambient + light-sweep hits
      return "0.16*sin(2*PI*110*t)+0.10*sin(2*PI*(210+50*sin(2*PI*0.12*t))*t)+0.30*exp(-6*mod(t\\,1.0))*sin(2*PI*150*t)";
    case "beat_cut_chinese_editing_tutorial": // fast beat + glitch/whip transients
      return "0.20*sin(2*PI*55*t)+0.55*exp(-12*mod(t\\,0.4))*sin(2*PI*140*t)+0.22*exp(-40*mod(t\\,0.4))*sin(2*PI*640*t)";
    case "poster_ribbon_marketing": // soft gallery bed
      return "0.16*sin(2*PI*98*t)+0.18*exp(-5*mod(t\\,1.0))*sin(2*PI*196*t)";
    default:
      return "0.18*sin(2*PI*90*t)+0.30*exp(-8*mod(t\\,0.75))*sin(2*PI*160*t)";
  }
}

function addProceduralAudio(mp4Path, motif, durSec) {
  const expr = audioExprForMotif(motif);
  const tmpOut = mp4Path.replace(/\.mp4$/, ".withaudio.mp4");
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-i", mp4Path, "-f", "lavfi", "-i", `aevalsrc=${expr}:d=${Math.ceil(durSec)}:s=44100`,
      "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", tmpOut],
    { encoding: "utf8" }
  );
  if (r.status === 0 && existsSync(tmpOut)) { renameSync(tmpOut, mp4Path); return true; }
  return false;
}

const ROOT = process.cwd();
const CASE_ORDER = ["marketing", "motion_graph_1", "motion_graph_2", "editing"];

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

function findBrowser() {
  const candidates = [
    path.join(ROOT, "apps/api/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell"),
    path.join(ROOT, "node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell")
  ];
  return candidates.find((p) => existsSync(p));
}

function buildRootSource(componentName, fixture, maxSec) {
  const fps = Number(fixture.fps) > 0 ? Number(fixture.fps) : 30;
  const width = Number(fixture.width) > 0 ? Number(fixture.width) : 1080;
  const height = Number(fixture.height) > 0 ? Number(fixture.height) : 1920;
  // Duration comes from fixture.durationSec * fps (do NOT clamp previews to ~6s). maxSec is only a
  // high safety ceiling against a runaway fixture, not a default truncation.
  const fixtureDurSec = Number(fixture.durationSec) > 0 ? Number(fixture.durationSec) : 8;
  const durSec = Math.min(fixtureDurSec, maxSec);
  const durationInFrames = Math.max(1, Math.round(durSec * fps));
  return `import React from "react";
import { Composition } from "remotion";
import { ${componentName} } from "./effect";

const fixture = ${JSON.stringify(fixture)};

export const Root: React.FC = () => (
  <Composition
    id="GenEffect"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component={${componentName} as any}
    durationInFrames={${durationInFrames}}
    fps={${fps}}
    width={${width}}
    height={${height}}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    defaultProps={fixture as any}
  />
);
`;
}

async function renderCase({ caseId, runDir, maxSec, browser, bundleApi, rendererApi }) {
  const caseDir = path.join(runDir, caseId);
  const proposalDir = path.join(caseDir, "proposal");
  const summary = readJson(path.join(caseDir, "proposal-summary.json"));
  const result = { caseId, status: summary.status, rendered: false, output: null, error: null };
  if (summary.status !== "gemini_ok") {
    result.error = `skipped: proposal status=${summary.status} (not a real gemini_ok component on disk)`;
    return result;
  }
  const metadata = readJson(path.join(proposalDir, "proposal-metadata.json"));
  const componentName = metadata.componentName;
  const fixture = readJson(path.join(proposalDir, "fixture.json"));

  // Temp bundle project under apps/api/remotion so node_modules (react/remotion) resolve.
  const tmp = path.join(ROOT, "apps/api/remotion", `.gen-render-${caseId}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    copyFileSync(path.join(proposalDir, "index.tsx"), path.join(tmp, "effect.tsx"));
    copyFileSync(path.join(proposalDir, "schema.ts"), path.join(tmp, "schema.ts"));
    writeFileSync(path.join(tmp, "Root.tsx"), buildRootSource(componentName, fixture, maxSec), "utf8");
    writeFileSync(path.join(tmp, "entry.tsx"), `import { registerRoot } from "remotion";\nimport { Root } from "./Root";\nregisterRoot(Root);\n`, "utf8");

    console.log(`[render-pure] ${caseId}: bundling ${componentName} ...`);
    const serveUrl = await bundleApi.bundle({ entryPoint: path.join(tmp, "entry.tsx") });
    const composition = await rendererApi.selectComposition({ serveUrl, id: "GenEffect", inputProps: fixture });
    const outDir = path.join(caseDir, "render");
    mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "pure-codegen.remotion.mp4");
    console.log(`[render-pure] ${caseId}: rendering ${composition.durationInFrames}f @ ${composition.fps}fps ${composition.width}x${composition.height} ...`);
    await rendererApi.renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: outPath,
      inputProps: fixture,
      ...(browser ? { browserExecutable: browser } : {})
    });
    // Task 4: mux deterministic procedural per-motif audio so the preview is never silent.
    if (existsSync(outPath)) {
      const durSec = Math.min(Number(fixture.durationSec) > 0 ? Number(fixture.durationSec) : 8, maxSec);
      result.audio = addProceduralAudio(outPath, metadata.motifFamily, durSec) ? "procedural" : "silent(ffmpeg_unavailable)";
    }
    result.rendered = existsSync(outPath);
    result.output = result.rendered ? outPath : null;
    // copy alongside the proposal too for convenience
    if (result.rendered) copyFileSync(outPath, path.join(proposalDir, "pure-codegen.remotion.mp4"));
    console.log(`[render-pure] ${caseId}: ${result.rendered ? "OK -> " + outPath : "no output produced"}`);
  } catch (error) {
    result.error = `render failed: ${error?.message ?? error}`;
    console.error(`[render-pure] ${caseId}: ${result.error}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return result;
}

async function main() {
  const runDir = path.resolve(ROOT, arg("--run-dir", "docs/artifacts/codegen-live-eval/zod-pure-output-r3"));
  const only = arg("--case");
  // Safety ceiling only (not a default 6s truncation). Full fixture duration is used below this.
  const maxSec = Number(arg("--max-sec", "120")) || 120;
  if (!existsSync(runDir)) throw new Error(`run dir not found: ${runDir}`);

  const bundleApi = await import("@remotion/bundler");
  const rendererApi = await import("@remotion/renderer");
  if (rendererApi.ensureBrowser) {
    try { await rendererApi.ensureBrowser(); } catch (e) { console.error(`[render-pure] ensureBrowser warning: ${e?.message ?? e}`); }
  }
  const browser = findBrowser();
  console.log(`[render-pure] browser: ${browser ?? "(default/ensureBrowser)"}`);

  const targets = only ? [only] : CASE_ORDER;
  const results = [];
  for (const caseId of targets) {
    if (!existsSync(path.join(runDir, caseId, "proposal-summary.json"))) continue;
    results.push(await renderCase({ caseId, runDir, maxSec, browser, bundleApi, rendererApi }));
  }
  const summaryPath = path.join(runDir, "PURE_CODEGEN_RENDER_SUMMARY.json");
  writeFileSync(summaryPath, `${JSON.stringify({ schema: "pure-codegen-render-summary.v1", runDir, maxSec, results }, null, 2)}\n`, "utf8");
  const ok = results.filter((r) => r.rendered).length;
  console.log(`[render-pure] DONE: ${ok}/${results.length} rendered -> ${summaryPath}`);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main().catch((e) => { console.error(`[render-pure] fatal: ${e?.message ?? e}`); process.exit(1); });
