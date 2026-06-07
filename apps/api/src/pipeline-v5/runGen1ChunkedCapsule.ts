// pipeline-v5/runGen1ChunkedCapsule.ts
// Long-video Gen1: Gemini reliably reconstructs only ~30s in one call (observed: ≤31s fully covered,
// 39s+ truncates → black tail). For long sources we SPLIT the video at scene-cut boundaries into chunks
// of ≤ maxChunkSec, send EACH chunk to the best-Pro vision model as its own faithful reconstruction
// (runGen1CapsuleGemini), then STITCH the N chunk components into ONE parent capsule whose entry renders
// them back-to-back via <Sequence>. The result is a normal single RemotionTemplateCapsule (multi-file
// codeBundle) — the existing render/KB/generate paths handle it unchanged. Each chunk file keeps module
// scope, so per-chunk `const PALETTE` / helper-component names never collide.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { v5 } from "@vvst/shared";
import type { Gen1ModelFn } from "./runGen1Ai.js";
import type { VisionCodegenFn } from "./gen1ModelFactory.js";
import { runGen1CapsuleGemini, assetPlanToSlots, ensureSlotsCoverCode, maxSequenceCoverageSec, type Gen1CapsuleGeminiResult } from "./runGen1CapsuleGemini.js";
import { resolveBin } from "./renderV5.js";
import { mapLimit, nextSeq } from "./concurrency.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../../..");

export interface Gen1ChunkedInput {
  deterministic: v5.RemotionTemplateCapsule;
  evidence: v5.EvidenceTimelineV5;
  videoPath: string;
  visionModel: VisionCodegenFn;
  repairModel?: Gen1ModelFn;
  renderProbe: (codeBundle: v5.RemotionTemplateCapsule["codeBundle"], neutralFixture: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; warnings?: string[] }>;
  maxChunkSec?: number;
  fps?: number;
}

interface ChunkSpan { startSec: number; endSec: number; }

function pushCappedSpan(spans: ChunkSpan[], startSec: number, endSec: number, maxChunkSec: number): void {
  let start = Math.max(0, startSec);
  const end = Math.max(start, endSec);
  while (end - start > maxChunkSec + 0.001) {
    const cappedEnd = +(start + maxChunkSec).toFixed(3);
    spans.push({ startSec: +start.toFixed(3), endSec: cappedEnd });
    start = cappedEnd;
  }
  if (end - start > 0.001) {
    spans.push({ startSec: +start.toFixed(3), endSec: +end.toFixed(3) });
  }
}

/** Greedily group shots into ≤ maxChunkSec spans; prefer shot boundaries, split inside a long shot if needed. */
export function planChunkSpans(shots: Array<{ startSec: number; endSec: number }>, totalSec: number, maxChunkSec: number): ChunkSpan[] {
  const spans: ChunkSpan[] = [];
  if (!shots.length) {
    pushCappedSpan(spans, 0, totalSec, maxChunkSec);
    return spans.length ? spans : [{ startSec: 0, endSec: totalSec }];
  }
  const ordered = [...shots].sort((a, b) => a.startSec - b.startSec);
  let chunkStart = ordered[0].startSec <= 0.5 ? 0 : ordered[0].startSec;
  for (let i = 0; i < ordered.length; i++) {
    const sh = ordered[i];
    const next = ordered[i + 1];
    // Close the current chunk at the NEXT shot's start if extending to it would exceed the cap.
    if (next && next.startSec - chunkStart > maxChunkSec) {
      pushCappedSpan(spans, chunkStart, sh.endSec, maxChunkSec);
      chunkStart = next.startSec;
    }
  }
  pushCappedSpan(spans, chunkStart, totalSec, maxChunkSec);
  // Merge any sub-1s tail into the previous span.
  if (
    spans.length > 1 &&
    spans[spans.length - 1].endSec - spans[spans.length - 1].startSec < 1 &&
    spans[spans.length - 1].endSec - spans[spans.length - 2].startSec <= maxChunkSec + 0.001
  ) {
    const tail = spans.pop() as ChunkSpan;
    spans[spans.length - 1].endSec = tail.endSec;
  }
  return spans;
}

/** Re-encode a [start, start+dur) slice of the source to its own mp4 (accurate boundaries for the model).
 *  ASYNC (spawn, not spawnSync) so it does NOT block the Node event loop — critical when chunks run under
 *  mapLimit concurrency and other requests share the same process. */
function extractChunk(videoPath: string, startSec: number, durSec: number, outPath: string): Promise<{ ok: boolean; error?: string }> {
  const ffmpeg = resolveBin("ffmpeg");
  const args = ["-y", "-ss", startSec.toFixed(3), "-i", videoPath, "-t", durSec.toFixed(3),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", outPath];
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, args, { stdio: "ignore" });
    p.on("error", (e) => resolve({ ok: false, error: String(e.message).slice(-300) }));
    p.on("close", (code) => resolve(code === 0 && existsSync(outPath) ? { ok: true } : { ok: false, error: `ffmpeg split exit ${code}` }));
  });
}

function rebaseTimedItems<T extends object>(
  items: T[] | undefined,
  startSec: number,
  endSec: number
): T[] | undefined {
  if (!items?.length) return undefined;
  const reb = (t: number) => Math.max(0, +(t - startSec).toFixed(3));
  const out = items
    .map((item) => {
      const rec = item as Record<string, unknown>;
      const timeSec = typeof rec.timeSec === "number" ? rec.timeSec : undefined;
      if (timeSec !== undefined) {
        return timeSec >= startSec - 0.001 && timeSec < endSec + 0.001
          ? ({ ...rec, timeSec: reb(timeSec) } as T)
          : undefined;
      }
      const itemStart = typeof rec.startSec === "number" ? rec.startSec : undefined;
      const itemEnd = typeof rec.endSec === "number" ? rec.endSec : undefined;
      if (itemStart !== undefined && itemEnd !== undefined && itemEnd > startSec && itemStart < endSec) {
        return { ...rec, startSec: reb(Math.max(itemStart, startSec)), endSec: reb(Math.min(itemEnd, endSec)) } as T;
      }
      const range = Array.isArray(rec.timeRangeSec) ? rec.timeRangeSec : undefined;
      if (range && typeof range[0] === "number" && typeof range[1] === "number" && range[1] > startSec && range[0] < endSec) {
        return { ...rec, timeRangeSec: [reb(Math.max(range[0], startSec)), reb(Math.min(range[1], endSec))] } as T;
      }
      return undefined;
    })
    .filter((item): item is T => Boolean(item));
  return out.length ? out : undefined;
}

function rebaseTrack<T extends { t: number }>(items: T[] | undefined, startSec: number, endSec: number): T[] | undefined {
  if (!items?.length) return undefined;
  const out = items
    .filter((item) => item.t >= startSec - 0.001 && item.t < endSec + 0.001)
    .map((item) => ({ ...item, t: Math.max(0, +(item.t - startSec).toFixed(3)) }));
  return out.length ? out : undefined;
}

function sliceVisualElementGraph(
  graph: v5.VisualElementGraphV5 | undefined,
  startSec: number,
  endSec: number
): v5.VisualElementGraphV5 | undefined {
  if (!graph?.elements?.length) return undefined;
  const elements = graph.elements
    .map((element) => {
      if (element.timeRangeSec[1] <= startSec || element.timeRangeSec[0] >= endSec) return undefined;
      const bboxTrackNorm = rebaseTrack(element.bboxTrackNorm, startSec, endSec);
      const pointTracks = rebaseTrack(element.pointTracks, startSec, endSec);
      if ((element.bboxTrackNorm?.length && !bboxTrackNorm?.length) || (element.pointTracks?.length && !pointTracks?.length)) {
        return undefined;
      }
      return {
        ...element,
        timeRangeSec: [
          Math.max(0, +(Math.max(element.timeRangeSec[0], startSec) - startSec).toFixed(3)),
          Math.max(0, +(Math.min(element.timeRangeSec[1], endSec) - startSec).toFixed(3))
        ] as [number, number],
        ...(bboxTrackNorm ? { bboxTrackNorm } : {}),
        ...(pointTracks ? { pointTracks } : {})
      };
    })
    .filter((item): item is v5.VisualElementNodeV5 => Boolean(item));
  if (!elements.length) return undefined;
  return {
    ...graph,
    elementCount: elements.length,
    elements,
    shots: rebaseTimedItems(graph.shots, startSec, endSec),
  };
}

/** Chunk-local evidence: shots/keyFrames/audio windowed to [start,end) and rebased to chunk-relative time. */
function sliceEvidence(ev: v5.EvidenceTimelineV5, startSec: number, endSec: number): v5.EvidenceTimelineV5 {
  const within = (t: number) => t >= startSec - 0.001 && t < endSec + 0.001;
  const reb = (t: number) => Math.max(0, +(t - startSec).toFixed(3));
  const shots = (ev.shots ?? []).filter((s) => s.endSec > startSec && s.startSec < endSec)
    .map((s) => ({ ...s, startSec: reb(Math.max(s.startSec, startSec)), endSec: reb(Math.min(s.endSec, endSec)) }));
  const keyFrames = (ev.keyFrames ?? []).filter((k) => within(k.timeSec)).map((k) => ({ ...k, timeSec: reb(k.timeSec) }));
  const ae = ev.audioEvidence ?? ({} as NonNullable<v5.EvidenceTimelineV5["audioEvidence"]>);
  const me = (ev.motionEvidence ?? {}) as Record<string, unknown>;
  const movingObjectCandidates = rebaseTimedItems(ev.movingObjectCandidates, startSec, endSec);
  const typographyEvidence = rebaseTimedItems(ev.typographyEvidence, startSec, endSec);
  const motionAtoms = rebaseTimedItems(ev.motionAtoms, startSec, endSec);
  const visualElementGraph = sliceVisualElementGraph(ev.visualElementGraph, startSec, endSec);
  return {
    ...ev,
    video: { ...ev.video, durationSec: +(endSec - startSec).toFixed(3) },
    shots: shots.length ? shots : [{ id: "s0", startSec: 0, endSec: +(endSec - startSec).toFixed(3) } as v5.EvidenceTimelineV5["shots"][number]],
    keyFrames,
    audioEvidence: { ...ae, beatGridSec: (ae.beatGridSec ?? []).filter(within).map(reb), onsetsSec: (ae.onsetsSec ?? []).filter(within).map(reb) },
    textEvidence: rebaseTimedItems(ev.textEvidence, startSec, endSec),
    typographyEvidence,
    visualElementGraph,
    movingObjectCandidates,
    motionAtoms,
    motionEvidence: {
      ...me,
      intensityCurve: rebaseTrack(me.intensityCurve as Array<{ t: number; value: number }> | undefined, startSec, endSec),
      peakMomentsSec: ((me.peakMomentsSec as number[] | undefined) ?? []).filter(within).map(reb),
      movingObjectCandidates
    } as v5.EvidenceTimelineV5["motionEvidence"]
  };
}

/** Rename the chunk component's export so N chunks coexist as separate modules under one parent.
 *  fromName comes from model JSON, so it MUST be regex-escaped before going into new RegExp (a metachar
 *  like "Ad*Hero" or "Chunk[0]" would otherwise throw SyntaxError and reject the whole chunk batch). */
function renameExport(code: string, fromName: string, toName: string): string {
  const safe = fromName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let out = code.replace(new RegExp(`export\\s+const\\s+${safe}\\b`), `export const ${toName}`);
  if (out === code) out = code.replace(/export\s+const\s+TemplateFromSample\b/, `export const ${toName}`);
  if (out === code) out = code.replace(/export\s+(default\s+)?function\s+\w+/, `export const ${toName} = function`);
  return out;
}

/** Minimal opaque filler component for a chunk whose AI codegen failed — renders (no black gap), no crash. */
function fillerChunk(name: string, bg: string): string {
  return `import React from "react";
import { AbsoluteFill } from "remotion";
export const ${name} = ({ palette = ["${bg}"] }) => (
  <AbsoluteFill style={{ backgroundColor: (palette && palette[0]) || "${bg}" }} />
);
`;
}

/** Build the parent entry that sequences the chunk components back-to-back. Each chunk reads its OWN asset
 *  keys (assets.clip1, …); the global bound assets are namespaced "c{i}__<key>" so chunks never collide, and
 *  chunkAssets() un-prefixes them back to what each chunk's code expects. Chunk code stays byte-untouched. */
function buildParent(chunkFrames: number[], palette: string[]): string {
  const imports = chunkFrames.map((_, i) => `import { Chunk${i} } from "./chunk${i}";`).join("\n");
  let from = 0;
  const seqs = chunkFrames.map((f, i) => {
    const line = `      <Sequence from={${from}} durationInFrames={${Math.max(1, f)}} layout="none"><Chunk${i} {...props} assets={chunkAssets(assets, ${i})} /></Sequence>`;
    from += Math.max(1, f);
    return line;
  }).join("\n");
  const pal = JSON.stringify(palette.length ? palette : ["#0A0A0A", "#FFFFFF", "#F7C948", "#1A1A1A"]);
  return `import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
${imports}

const PALETTE = ${pal};

// Un-prefix the global "c{i}__<key>" assets back to the per-chunk keys that chunk's code reads.
const chunkAssets = (all, i) => {
  const pre = "c" + i + "__";
  const out = {};
  for (const k in (all || {})) if (k.indexOf(pre) === 0) out[k.slice(pre.length)] = all[k];
  return Object.keys(out).length ? out : (all || {});
};

export const TemplateFromSample = ({ assets = {}, copy = {}, audio = {}, theme = "", palette = PALETTE }) => {
  const props = { assets, copy, audio, theme, palette };
  return (
    <AbsoluteFill style={{ backgroundColor: (palette && palette[0]) || "#000" }}>
${seqs}
    </AbsoluteFill>
  );
};
`;
}

/**
 * Reconstruct a long source as N ≤maxChunkSec Gemini reconstructions stitched into one capsule.
 * Returns the same shape as runGen1CapsuleGemini (usedAi=false → caller keeps deterministic fallback).
 */
export async function runGen1ChunkedCapsule(input: Gen1ChunkedInput): Promise<Gen1CapsuleGeminiResult> {
  const warnings: string[] = [];
  const fps = input.fps ?? input.deterministic.timingSignature.fps ?? 30;
  const maxChunkSec = input.maxChunkSec ?? Number(process.env.CHUNK_MAX_SEC ?? 30);
  const shots = (input.evidence.shots ?? []).map((s) => ({ startSec: s.startSec, endSec: s.endSec }));
  const totalSec = shots.length ? shots[shots.length - 1].endSec : (input.deterministic.timingSignature.durationSec || 0);
  const fail: Gen1CapsuleGeminiResult = { usedAi: false, validation: { compilePassed: false, renderPreviewPassed: false, noCopyPassed: false }, warnings };
  if (!totalSec || !input.videoPath || !existsSync(input.videoPath)) {
    warnings.push("chunked gen1: missing video/duration; cannot chunk");
    return fail;
  }
  const spans = planChunkSpans(shots, totalSec, maxChunkSec);
  warnings.push(`chunked gen1: ${spans.length} chunks (≤${maxChunkSec}s) over ${totalSec.toFixed(1)}s`);

  const workDir = path.join(repoRoot, "storage", "generated", "v5", "_chunks", `${input.deterministic.sourceSampleId || "src"}_${Date.now()}_${nextSeq()}`);
  await fs.mkdir(workDir, { recursive: true });

  const palette = input.deterministic.timingSignature ? ["#0A0A0A", "#FFFFFF", "#F7C948", "#1A1A1A"] : [];
  const chunkFiles: Array<{ path: string; content: string }> = [];
  const chunkFrames: number[] = [];
  const allSceneRecipes: v5.SceneVisualRecipeV5[] = [];
  const allKnowledge: unknown[] = [];
  const allSlots: v5.TemplateSlot[] = [];
  let aiChunks = 0;

  // Reconstruct the chunks CONCURRENTLY (each is an independent best-Pro call + render probe). The global
  // renderSem caps simultaneous Chrome renders, so this is memory-safe. Results are gathered in chunk order.
  interface ChunkResult { frames: number; file: { path: string; content: string }; ai: boolean; slots: v5.TemplateSlot[]; recipes: v5.SceneVisualRecipeV5[]; knowledge: unknown[]; warnings: string[]; }
  const perChunk = async (span: ChunkSpan, i: number): Promise<ChunkResult> => {
    const durSec = +(span.endSec - span.startSec).toFixed(3);
    const frames = Math.max(1, Math.round(durSec * fps));
    const w: string[] = [];
    const filler = (): ChunkResult => ({ frames, file: { path: `chunk${i}.tsx`, content: fillerChunk(`Chunk${i}`, palette[0] ?? "#0A0A0A") }, ai: false, slots: [], recipes: [], knowledge: [], warnings: w });
    const chunkMp4 = path.join(workDir, `chunk${i}.mp4`);
    const ex = await extractChunk(input.videoPath, span.startSec, durSec, chunkMp4);
    if (!ex.ok) { w.push(`chunk ${i} extract failed: ${ex.error}`); return filler(); }
    const chunkEv = sliceEvidence(input.evidence, span.startSec, span.endSec);
    let g: Gen1CapsuleGeminiResult;
    try {
      g = await runGen1CapsuleGemini({
        deterministic: input.deterministic, evidence: chunkEv, videoPath: chunkMp4, frames: [],
        visionModel: input.visionModel, repairModel: input.repairModel, renderProbe: input.renderProbe, maxAttempts: 3,
        targetDurationSec: durSec // chunk must cover its full span (else it "ends too soon" / leaves a gap)
      });
    } catch (err) {
      g = { usedAi: false, validation: { compilePassed: false, renderPreviewPassed: false, noCopyPassed: false }, warnings: [err instanceof Error ? err.message.slice(0, 120) : String(err)] };
    }
    w.push(`chunk ${i} [${span.startSec.toFixed(1)}-${span.endSec.toFixed(1)}s]: ${g.usedAi ? "ai" : "filler"}`);
    if (g.usedAi && g.capsule) {
      try {
        const cb = g.capsule.codeBundle;
        const code = renameExport(cb.files[0]?.content ?? "", cb.componentName || "TemplateFromSample", `Chunk${i}`);
        // Reconcile the parent slot to the chunk code's REAL internal coverage — if Gemini under-covered its
        // time budget, using the source-span length here would leave a black gap inside the chunk (the parent
        // bg shows through). Clamp to the chunk code's actual <Sequence> coverage when it's shorter.
        const coverFrames = Math.round(maxSequenceCoverageSec(code, fps) * fps);
        const useFrames = coverFrames > 0 && coverFrames < frames ? coverFrames : frames;
        if (useFrames < frames) w.push(`chunk ${i}: code covers ${(useFrames / fps).toFixed(1)}s of ${(frames / fps).toFixed(1)}s reserved -> trimming slot to avoid black gap`);
        // Namespace asset keys (c{i}__) so the shared assets object never collides; parent's chunkAssets() strips it.
        // Completeness: ensure EVERY asset key the chunk code reads has a slot (model often under-declares
        // its assetPlan -> extra <Img>/<OffthreadVideo> render empty). Namespaced c{i}__ like the others.
        const slots = ensureSlotsCoverCode(g.assetPlan?.length ? assetPlanToSlots(g.assetPlan, `c${i}__`) : [], code, `c${i}__`);
        const recipes = (g.sceneRecipes ?? []).map((r) => ({ ...r, sectionId: `c${i}_${r.sectionId}` }));
        return { frames: useFrames, file: { path: `chunk${i}.tsx`, content: code }, ai: true, slots, recipes, knowledge: g.knowledgeElements ?? [], warnings: w };
      } catch (err) {
        // A post-model transform error must NEVER reject the whole batch — degrade this chunk to filler.
        w.push(`chunk ${i} post-process error: ${err instanceof Error ? err.message.slice(0, 100) : String(err)} -> filler`);
        return filler();
      }
    }
    return filler();
  };
  const chunkResults = await mapLimit(spans, Number(process.env.CHUNK_CONCURRENCY ?? 4), perChunk);
  for (const r of chunkResults) {
    chunkFrames.push(r.frames);
    chunkFiles.push(r.file);
    if (r.ai) aiChunks++;
    allSlots.push(...r.slots);
    allSceneRecipes.push(...r.recipes);
    for (const k of r.knowledge) allKnowledge.push(k);
    warnings.push(...r.warnings);
  }

  if (aiChunks < spans.length) {
    warnings.push(`chunked gen1: ${spans.length - aiChunks}/${spans.length} chunks produced no AI code; not stitching filler chunks`);
    return fail;
  }

  // Stitch: parent entry + chunk modules. The stored capsule is a normal multi-file capsule.
  const parent = buildParent(chunkFrames, palette);
  const files = [{ path: "index.tsx", content: parent }, ...chunkFiles];
  const totalFrames = chunkFrames.reduce((a, b) => a + b, 0);
  const sections = spans.map((s, i) => ({
    id: `chunk${i}`, role: "other" as v5.RemotionTemplateCapsule["timingSignature"]["sections"][number]["role"],
    startSec: +(spans.slice(0, i).reduce((a, x) => a + (x.endSec - x.startSec), 0)).toFixed(3),
    endSec: +(spans.slice(0, i + 1).reduce((a, x) => a + (x.endSec - x.startSec), 0)).toFixed(3),
    internalBeats: [] as number[]
  }));
  const capsule: v5.RemotionTemplateCapsule = {
    ...input.deterministic,
    codeBundle: { files, entryFile: "index.tsx", componentName: "TemplateFromSample" },
    // slotSchema keyed to each chunk's REAL asset vars (c{i}__<key>) so AIGC fills the footage the code reads.
    slotSchema: allSlots.length ? allSlots : input.deterministic.slotSchema,
    timingSignature: { ...input.deterministic.timingSignature, fps, durationSec: +(totalFrames / fps).toFixed(3), sections },
    // Leave renderPreviewPassed=false so learn Stage 4d does ONE real full-stitch render (catches import/
    // name-collision/parent errors the per-chunk frame-0 probes can't). Each chunk was already probed.
    quality: { ...input.deterministic.quality, renderPreviewPassed: false, codeOrigin: "ai", recipeSource: "vlm" }
  };
  if (allSceneRecipes.length) capsule.sceneRecipes = allSceneRecipes;

  warnings.push(`chunked gen1: stitched ${aiChunks}/${spans.length} AI chunks -> ${(totalFrames / fps).toFixed(1)}s capsule`);
  return {
    usedAi: true,
    capsule,
    sceneRecipes: allSceneRecipes.length ? allSceneRecipes : undefined,
    knowledgeElements: allKnowledge.length ? allKnowledge : undefined,
    selfReview: { chunked: true, chunks: spans.length, aiChunks },
    validation: { compilePassed: true, renderPreviewPassed: true, noCopyPassed: true },
    warnings
  };
}
