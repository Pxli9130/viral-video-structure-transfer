// scripts/run-v5-four.mjs
// Drive the spec_v5 pipeline 4x ENTIRELY over the HTTP API (/api/v5 + V4 project/asset upload).
// For each test_videos/*.mov: create asset -> learn (AI Gen1) -> take ALL KB elements from THAT
// video only -> generate a video (random theme, AI Gen2, render) -> collect scorecard + final.mp4.
// Node 22 global fetch/FormData/Blob; server must be running on $BASE.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.BASE || "http://localhost:3000";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const JOBS = [
  { file: "test_videos/editing.mov", theme: "cinematic city night drive teaser", sellingPoints: ["fast cuts", "moody", "premium"] },
  { file: "test_videos/marketing.mov", theme: "portable fan high-click ad", sellingPoints: ["small", "quiet", "long battery"] },
  { file: "test_videos/motion_graph_1.mov", theme: "fintech app launch promo", sellingPoints: ["instant", "secure", "no fees"] },
  { file: "test_videos/motion_graph_2.mov", theme: "energy drink hype reel", sellingPoints: ["explosive", "zero sugar", "all day"] }
];

async function jget(p) {
  const r = await fetch(`${BASE}${p}`);
  if (!r.ok) throw new Error(`GET ${p} -> ${r.status} ${await r.text().catch(() => "")}`);
  return r.json();
}
async function jpost(p, body) {
  const r = await fetch(`${BASE}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST ${p} -> ${r.status} ${await r.text().catch(() => "")}`);
  return r.json();
}

async function uploadAsset(projectId, fileRel) {
  const abs = path.resolve(repoRoot, fileRel);
  const buf = await readFile(abs);
  const fd = new FormData();
  fd.append("role", "example_video");
  fd.append("sourcePolicy", "user_authorized");
  fd.append("file", new Blob([buf], { type: "video/quicktime" }), path.basename(abs));
  const r = await fetch(`${BASE}/api/projects/${projectId}/assets`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`upload ${fileRel} -> ${r.status} ${await r.text().catch(() => "")}`);
  const env = await r.json();
  return env.data ?? env; // V4 ok() wraps in {ok,data}
}

function unwrap(env) {
  return env && typeof env === "object" && "data" in env ? env.data : env;
}

async function main() {
  console.log(`[four] BASE=${BASE}`);
  const proj = unwrap(await jpost("/api/projects", { name: "V5 Four-Sample Run", aspectRatio: "9:16", targetDurationSec: 16 }));
  console.log(`[four] project=${proj.id}`);

  const report = [];
  for (let i = 0; i < JOBS.length; i++) {
    const job = JOBS[i];
    console.log(`\n[four] ===== ${i + 1}/4 ${job.file} =====`);
    const asset = await uploadAsset(proj.id, job.file);
    console.log(`[four] asset=${asset.id}`);

    // LEARN (AI Gen1) from this one video
    console.log(`[four] learn (AI Gen1)…`);
    const learn = await jpost("/api/v5/learn-samples", { sampleAssetIds: [asset.id], options: { runGen1Ai: true } });
    const learned = learn.learned[0];
    if (learned.error) {
      console.log(`[four] LEARN FAILED: ${learned.error}`);
      report.push({ video: job.file, error: `learn: ${learned.error}` });
      continue;
    }
    console.log(`[four] learned: ${learned.storedElements} elements (gen1=${learned.gen1})`);

    // ALL elements from THIS video only
    const kb = await jget(`/api/v5/kb/elements?sourceSampleId=${encodeURIComponent(asset.id)}`);
    const elementIds = kb.elements.map((e) => e.id);
    console.log(`[four] using ${elementIds.length} elements from this video: ${kb.elements.map((e) => e.kind).join(", ")}`);

    // GENERATE (random theme, AI Gen2, render) using ONLY this video's elements, no external targets
    console.log(`[four] generate "${job.theme}" (render + AI Gen2)…`);
    const gen = await jpost("/api/v5/generations", {
      projectId: proj.id,
      generationId: `gen_four_${i + 1}`,
      brief: { theme: job.theme, variant: "high_click", targetDurationSec: 16, aspectRatio: "9:16", sellingPoints: job.sellingPoints },
      targetAssetIds: [],
      selectedElementIds: elementIds,
      options: { autoRender: true, runGen2Ai: true, materialFill: "aigc", materialFillMax: 4 }
    });
    const sc = gen.scorecard;
    const pass = sc.gates.filter((g) => g.status === "pass").length;
    const fail = sc.gates.filter((g) => g.status === "fail").length;
    const layers = gen.finalProgram?.renderRecipe?.layers ?? [];
    const layerTypes = layers.reduce((m, l) => ((m[l.type] = (m[l.type] || 0) + 1), m), {});
    const mediaLayers = layers.filter((l) => l.type === "media").length;
    const genVisuals = layers.filter((l) => l.type === "generated_visual").length;
    const realAssets = (gen.finalProgram?.renderRecipe?.assets ?? []).length;
    const audioLayers = (gen.finalProgram?.renderRecipe?.audioLayers ?? []).length;
    const textBeats = layers.filter((l) => l.type === "text" || (l.type === "packaging" && l.text)).length;
    console.log(`[four] -> ${gen.finalVideoUrl ?? "(no video)"} | media=${mediaLayers} genVisual=${genVisuals} assets=${realAssets} text=${textBeats} audio=${audioLayers} | gates ${pass}p/${fail}f | ${sc.readinessLevel} demoReady=${sc.demoReady}`);
    report.push({
      video: job.file,
      theme: job.theme,
      assetId: asset.id,
      elementsUsed: elementIds.length,
      generationId: gen.generationId,
      finalVideoUrl: gen.finalVideoUrl,
      sectionCount: gen.composition.sections.length,
      sections: gen.composition.sections.map((s) => `${s.role}(${(s.endSec - s.startSec).toFixed(1)}s):${s.plannedText ?? ""}`),
      palette: gen.composition.stylePlan?.palette,
      layerTypes,
      mediaLayers,
      generatedVisualLayers: genVisuals,
      realAssets,
      audioLayers,
      textBeats,
      readinessLevel: sc.readinessLevel,
      gatesPass: pass,
      gatesFail: fail,
      demoReady: sc.demoReady,
      warnings: sc.warnings
    });
  }

  const outDir = path.resolve(repoRoot, "artifacts/v5-four");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "report.json"), JSON.stringify({ project: proj.id, report }, null, 2));

  console.log(`\n[four] ================ SUMMARY ================`);
  for (const r of report) {
    if (r.error) console.log(`✗ ${r.video}: ${r.error}`);
    else console.log(`✓ ${r.video} → "${r.theme}" | ${r.sectionCount} sections, media=${r.mediaLayers} genVisual=${r.generatedVisualLayers} assets=${r.realAssets} text=${r.textBeats} audio=${r.audioLayers} | ${r.readinessLevel} | ${r.finalVideoUrl}`);
  }
  await writeFile(path.join(outDir, "report.json"), JSON.stringify({ project: proj.id, report }, null, 2));
  console.log(`[four] report -> ${path.join(outDir, "report.json")}`);
}

main().catch((e) => {
  console.error("[four] ERROR:", e);
  process.exit(1);
});
