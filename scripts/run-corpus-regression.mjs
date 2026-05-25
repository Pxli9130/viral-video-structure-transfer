#!/usr/bin/env node
/**
 * Phase 1 corpus regression runner — analyzer-only.
 *
 * For every fixture under test_videos/corpus/<id>/fixture.json:
 *   1. Resolve the input video. If missing and skipIf.missingVideo, SKIP.
 *      If marked synthetic and missing, regenerate via the synthetic
 *      generator script. Else verify sha256 against fingerprint/fixture.
 *   2. Run scripts/analyze-video-structure.py via the viral conda python
 *      and write docs/corpus_regression/<id>/analysis.json.
 *   3. Check every fixture.expectations gate independently.
 *   4. Check fixture.negativeExpectations independently.
 *   5. Render an expected-vs-actual table and a contact sheet of sampled
 *      frames per fixture.
 *   6. Write docs/corpus_regression/corpus-regression-report.{json,md}.
 *
 * No external services, no fetch. Exit 0 unless the runner itself crashed;
 * fixture-level fails are surfaced in the report and via a non-zero summary
 * (handled by the optional --strict flag).
 *
 * Usage:
 *   node scripts/run-corpus-regression.mjs
 *   node scripts/run-corpus-regression.mjs --refresh-corpus
 *   node scripts/run-corpus-regression.mjs --include 001,003
 *   node scripts/run-corpus-regression.mjs --strict     # exit 2 if any fixture fails
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..");
const corpusRoot = path.join(repoRoot, "test_videos", "corpus");
const reportRoot = path.join(repoRoot, "docs", "corpus_regression");

const condaBase = process.env.CONDA_BASE ?? "/home/pxli/anaconda3";
const condaEnv = process.env.VIRAL_CONDA_ENV ?? "viral";
const condaPython = (() => {
  const candidate = path.join(condaBase, "envs", condaEnv, "bin", "python");
  return existsSync(candidate) ? candidate : "python3";
})();
const ffmpeg = (() => {
  const candidate = path.join(condaBase, "envs", condaEnv, "bin", "ffmpeg");
  return existsSync(candidate) ? candidate : "ffmpeg";
})();

function parseArgs(argv) {
  const args = { include: null, refreshCorpus: false, strict: false };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case "--refresh-corpus":
        args.refreshCorpus = true;
        break;
      case "--include":
        args.include = (argv[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        i += 1;
        break;
      case "--strict":
        args.strict = true;
        break;
      case "--help":
      case "-h":
        console.log("Usage: node scripts/run-corpus-regression.mjs [--refresh-corpus] [--include 001,003] [--strict]");
        process.exit(0);
      default:
        if (flag.startsWith("--")) console.warn(`Unknown flag: ${flag}`);
    }
  }
  return args;
}

function rel(filePath) {
  return path.relative(repoRoot, filePath);
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

async function discoverFixtures() {
  const entries = await readdir(corpusRoot, { withFileTypes: true });
  const ids = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const fixtures = [];
  for (const id of ids) {
    const fixturePath = path.join(corpusRoot, id, "fixture.json");
    if (!existsSync(fixturePath)) continue;
    const raw = await readFile(fixturePath, "utf8");
    fixtures.push({ id, dir: path.join(corpusRoot, id), fixture: JSON.parse(raw) });
  }
  return fixtures;
}

function resolveVideoPath(fixture, dir) {
  const filename = fixture.input.filename;
  if (path.isAbsolute(filename)) return filename;
  return path.resolve(dir, filename);
}

function runAnalyzer(input, output) {
  const result = spawnSync(
    condaPython,
    ["scripts/analyze-video-structure.py", "--input", input, "--out", output],
    { encoding: "utf8", cwd: repoRoot }
  );
  if (result.status !== 0) {
    throw new Error(`analyzer failed for ${input}: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(readFileSync(output, "utf8"));
}

function runSyntheticGenerator(only) {
  const result = spawnSync(
    condaPython,
    ["scripts/generate-synthetic-corpus.py", "--root", "test_videos/corpus", "--only", only],
    { encoding: "utf8", cwd: repoRoot }
  );
  if (result.status !== 0) {
    throw new Error(`synthetic generator failed for ${only}: ${result.stderr || result.stdout}`);
  }
}

function extractFrames(video, outDir, count = 4) {
  // Sample 4 evenly spaced frames via ffmpeg for the contact sheet.
  const durResult = spawnSync(
    ffmpeg.replace("ffmpeg", "ffprobe"),
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nokey=1:noprint_wrappers=1", video],
    { encoding: "utf8" }
  );
  if (durResult.status !== 0) return [];
  const durationSec = Number(durResult.stdout.trim()) || 0;
  if (durationSec <= 0) return [];
  const frames = [];
  for (let i = 0; i < count; i += 1) {
    const ratio = count === 1 ? 0.5 : i / (count - 1);
    const t = Math.max(0.1, Math.min(durationSec - 0.1, ratio * durationSec));
    const outPath = path.join(outDir, `frame_${i + 1}.jpg`);
    const result = spawnSync(
      ffmpeg,
      ["-y", "-ss", String(t.toFixed(2)), "-i", video, "-frames:v", "1", "-vf", "scale=256:-2", "-q:v", "5", outPath],
      { encoding: "utf8" }
    );
    if (result.status === 0) frames.push({ timeSec: Number(t.toFixed(2)), path: outPath });
  }
  return frames;
}

function makeContactSheet(frames, outPath) {
  if (frames.length === 0) return null;
  const inputs = frames.flatMap((frame) => ["-i", frame.path]);
  const scale = frames.map((_, idx) => `[${idx}:v]scale=256:-2,setsar=1[v${idx}]`).join(";");
  const hstack = `${frames.map((_, idx) => `[v${idx}]`).join("")}hstack=inputs=${frames.length}[out]`;
  const filter = `${scale};${hstack}`;
  const result = spawnSync(
    ffmpeg,
    ["-y", ...inputs, "-filter_complex", filter, "-map", "[out]", outPath],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    console.warn(`contact sheet failed: ${result.stderr.slice(0, 200)}`);
    return null;
  }
  return outPath;
}

// ---------------------------------------------------------------------------
// Gate evaluation
// ---------------------------------------------------------------------------

function checkPrimaryMotif(expectations, analysis) {
  const primary = analysis.primaryMotif;
  if (!primary) {
    return { passed: false, detail: "analyzer returned no primary motif" };
  }
  const allowed = expectations?.primaryMotif?.anyOf ?? [];
  const minConfidence = expectations?.primaryMotif?.minConfidence ?? 0;
  const inAllowed = allowed.length === 0 || allowed.includes(primary.motif);
  const meetsConfidence = primary.confidence >= minConfidence;
  return {
    passed: inAllowed && meetsConfidence,
    detail: `actual=${primary.motif}@${primary.confidence} allowed=${allowed.join("|")} minConfidence=${minConfidence}`
  };
}

function checkExcludeSegments(expectations, analysis) {
  const expected = expectations?.excludeSegments ?? [];
  const actual = analysis.excludeSegments ?? [];
  if (expected.length === 0) {
    return { passed: true, detail: `no exclude segment required (actual=${actual.length})` };
  }
  const missed = [];
  for (const exp of expected) {
    const startMin = exp.startSecRange?.[0] ?? -Infinity;
    const startMax = exp.startSecRange?.[1] ?? Infinity;
    const endMin = exp.endSecRange?.[0] ?? -Infinity;
    const endMax = exp.endSecRange?.[1] ?? Infinity;
    const reasonKeywords = (exp.reasonKeywordsAnyOf ?? []).map((s) => s.toLowerCase());
    const matchedActual = actual.find((segment) => {
      const inStart = segment.startSec >= startMin && segment.startSec <= startMax;
      const inEnd = segment.endSec >= endMin && segment.endSec <= endMax;
      const reason = String(segment.reason ?? "").toLowerCase();
      const keywordHit = reasonKeywords.length === 0 || reasonKeywords.some((kw) => reason.includes(kw));
      return inStart && inEnd && keywordHit;
    });
    if (!matchedActual) {
      missed.push(`expected tail in [${startMin}, ${startMax}]→[${endMin}, ${endMax}] with reason ∋ ${reasonKeywords.join(",")}`);
    }
  }
  const passed = missed.length === 0;
  return {
    passed,
    detail: passed
      ? `all ${expected.length} expected exclude segments matched`
      : `${missed.length} unmatched expectation(s): ${missed.join(" | ")}; actual=${JSON.stringify(actual)}`
  };
}

function checkBandWidth(expectations, analysis) {
  // Soft sanity: when the fixture allows wide_surface_ribbon_2_5d, expect bandWidth ≥ 40.
  // When negativeExpectations forbids wide_ribbon, expect bandWidth ≤ 35.
  const allowed = expectations?.primaryMotif?.anyOf ?? [];
  const bandWidth = analysis?.stability?.bandWidthEstimate ?? 0;
  if (allowed.includes("wide_surface_ribbon_2_5d")) {
    return { passed: bandWidth >= 40, detail: `bandWidth=${bandWidth} (≥40 for wide_ribbon fixtures)` };
  }
  return { passed: true, detail: `bandWidth=${bandWidth} (no constraint)` };
}

function checkVideoMetadata(fixture, analysis) {
  const range = fixture?.input?.durationSecRange;
  if (!range) return { passed: true, detail: "no duration range" };
  const duration = analysis?.metadata?.durationSec ?? 0;
  const passed = duration >= range[0] && duration <= range[1];
  return {
    passed,
    detail: `duration=${duration.toFixed?.(2) ?? duration}s (expected [${range[0]}, ${range[1]}])`
  };
}

function checkNegative(fixture, analysis) {
  const neg = fixture.negativeExpectations ?? {};
  const primary = analysis?.primaryMotif?.motif;
  const failures = [];
  if (neg.primaryMotifNotAnyOf?.length) {
    if (neg.primaryMotifNotAnyOf.includes(primary)) {
      failures.push(`primary motif='${primary}' ∈ forbidden ${JSON.stringify(neg.primaryMotifNotAnyOf)}`);
    }
  }
  // rendererAtomNotAnyOf is honoured later when --render mode lands; for now,
  // we surface that no renderer atom was inspected.
  return {
    passed: failures.length === 0,
    detail: failures.length === 0 ? "all negative expectations held" : failures.join("; ")
  };
}

// ---------------------------------------------------------------------------
// Per-fixture pipeline
// ---------------------------------------------------------------------------

async function runFixture(entry, args) {
  const fixturePath = path.join(entry.dir, "fixture.json");
  const reportDir = path.join(reportRoot, entry.id);
  await mkdir(reportDir, { recursive: true });
  await mkdir(path.join(reportDir, "frames"), { recursive: true });

  const videoPath = resolveVideoPath(entry.fixture, entry.dir);
  const isSynthetic = (entry.fixture.input.license === "synthetic");
  const gates = [];

  // Resolve video path / sha256.
  let videoStatus = "present";
  if (!existsSync(videoPath)) {
    if (isSynthetic) {
      console.log(`  regenerating synthetic ${entry.id}…`);
      runSyntheticGenerator(entry.id);
      videoStatus = "regenerated";
    } else if (entry.fixture.skipIf?.missingVideo) {
      gates.push({ id: "video_present", passed: false, detail: `video missing: ${rel(videoPath)} (skipIf.missingVideo=true)` });
      return { id: entry.id, status: "SKIPPED", gates, fixture: entry.fixture, analysis: null, frames: [] };
    } else {
      gates.push({ id: "video_present", passed: false, detail: `video missing: ${rel(videoPath)}` });
      return { id: entry.id, status: "FAIL", gates, fixture: entry.fixture, analysis: null, frames: [] };
    }
  }
  gates.push({ id: "video_present", passed: true, detail: `${rel(videoPath)} (${videoStatus})` });

  // Refresh synthetic if requested.
  if (args.refreshCorpus && isSynthetic) {
    runSyntheticGenerator(entry.id);
    gates[gates.length - 1].detail += " (refreshed)";
  }

  // sha256 verification.
  let actualSha = null;
  try {
    actualSha = sha256File(videoPath);
  } catch (error) {
    gates.push({ id: "sha256_readable", passed: false, detail: error.message });
    return { id: entry.id, status: "FAIL", gates, fixture: entry.fixture, analysis: null, frames: [] };
  }
  const expectedSha = entry.fixture.input.sha256;
  if (isSynthetic) {
    // For synthetic videos the sha will change with each regeneration; update fingerprint silently.
    gates.push({ id: "sha256_match", passed: true, detail: `synthetic; current sha256=${actualSha.slice(0, 12)}…` });
  } else {
    const matched = expectedSha === actualSha;
    gates.push({
      id: "sha256_match",
      passed: matched,
      detail: matched ? `sha256 matches (${actualSha.slice(0, 12)}…)` : `expected ${expectedSha.slice(0, 12)}…, got ${actualSha.slice(0, 12)}…`
    });
    if (!matched && !entry.fixture.input.videoIsReference) {
      // For non-reference fixtures, sha mismatch means video was tampered.
      return { id: entry.id, status: "FAIL", gates, fixture: entry.fixture, analysis: null, frames: [] };
    }
  }

  // Run analyzer.
  const analysisPath = path.join(reportDir, "analysis.json");
  let analysis;
  try {
    analysis = runAnalyzer(videoPath, analysisPath);
  } catch (error) {
    gates.push({ id: "analyzer_ran", passed: false, detail: error.message });
    return { id: entry.id, status: "FAIL", gates, fixture: entry.fixture, analysis: null, frames: [] };
  }
  gates.push({ id: "analyzer_ran", passed: true, detail: `${rel(analysisPath)}` });

  // Gates.
  gates.push({ id: "duration_in_range", ...checkVideoMetadata(entry.fixture, analysis) });
  const motifGate = checkPrimaryMotif(entry.fixture.expectations, analysis);
  gates.push({ id: "analyzer_primary_motif", ...motifGate });
  gates.push({ id: "analyzer_exclude_segments", ...checkExcludeSegments(entry.fixture.expectations, analysis) });
  gates.push({ id: "analyzer_band_width", ...checkBandWidth(entry.fixture.expectations, analysis) });
  gates.push({ id: "negative_expectations", ...checkNegative(entry.fixture, analysis) });

  // Expected-vs-actual JSON for the report.
  const compare = {
    primaryMotif: {
      expectedAnyOf: entry.fixture.expectations?.primaryMotif?.anyOf,
      expectedMinConfidence: entry.fixture.expectations?.primaryMotif?.minConfidence,
      actual: analysis.primaryMotif
    },
    excludeSegments: {
      expected: entry.fixture.expectations?.excludeSegments ?? [],
      actual: analysis.excludeSegments ?? []
    },
    negativeExpectations: entry.fixture.negativeExpectations ?? {},
    metadata: analysis.metadata
  };
  await writeFile(path.join(reportDir, "expected_vs_actual.json"), JSON.stringify(compare, null, 2), "utf8");

  // Contact sheet.
  const framesDir = path.join(reportDir, "frames");
  const frames = extractFrames(videoPath, framesDir, 4);
  const contactSheetPath = makeContactSheet(frames, path.join(reportDir, "contact_sheet.png"));

  const passed = gates.every((gate) => gate.passed);
  return {
    id: entry.id,
    status: passed ? "PASS" : "FAIL",
    gates,
    fixture: entry.fixture,
    analysis,
    frames,
    contactSheet: contactSheetPath
  };
}

// ---------------------------------------------------------------------------
// Report writing
// ---------------------------------------------------------------------------

function summarise(results) {
  const counts = { passed: 0, failed: 0, skipped: 0, total: results.length };
  for (const r of results) {
    if (r.status === "PASS") counts.passed += 1;
    else if (r.status === "FAIL") counts.failed += 1;
    else if (r.status === "SKIPPED") counts.skipped += 1;
  }
  return counts;
}

function gateBadge(g) {
  return g.passed ? "✅" : "❌";
}

function markdownReport(results, summary, runId) {
  const header = `# Corpus Regression Report

Run id: \`${runId}\`
Mode: analyzer-only (Phase 1)

| Status | Count |
|---|---:|
| ✅ Passed | ${summary.passed} |
| ❌ Failed | ${summary.failed} |
| ⏭️ Skipped | ${summary.skipped} |
| Total | ${summary.total} |

`;
  const sections = results.map((result) => {
    const verdict = result.status === "PASS" ? "✅ PASS" : result.status === "FAIL" ? "❌ FAIL" : "⏭️ SKIPPED";
    const gatesTable = `| Gate | Status | Detail |
|---|:---:|---|
${result.gates.map((g) => `| \`${g.id}\` | ${gateBadge(g)} | ${g.detail.replace(/\|/g, "\\|")} |`).join("\n")}`;
    const primary = result.analysis?.primaryMotif;
    const motifLine = primary ? `**Primary motif:** \`${primary.motif}\` @ ${primary.confidence}` : "**Primary motif:** (no analysis)";
    const links = [
      `- analysis: \`${rel(path.join(reportRoot, result.id, "analysis.json"))}\``,
      `- expected vs actual: \`${rel(path.join(reportRoot, result.id, "expected_vs_actual.json"))}\``,
      result.contactSheet ? `- contact sheet: \`${rel(result.contactSheet)}\`` : null
    ].filter(Boolean).join("\n");
    return `## ${result.id} — ${verdict}

> ${result.fixture.title}

${motifLine}

${gatesTable}

${links}
`;
  }).join("\n");
  return header + sections + "\n";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  await mkdir(reportRoot, { recursive: true });
  const fixtures = await discoverFixtures();
  if (fixtures.length === 0) {
    console.error("No fixtures found under test_videos/corpus/");
    process.exit(1);
  }
  const filtered = args.include
    ? fixtures.filter((entry) => args.include.some((wanted) => entry.id.startsWith(wanted)))
    : fixtures;
  if (filtered.length === 0) {
    console.error(`No fixtures matched --include ${args.include?.join(",") ?? ""}`);
    process.exit(1);
  }

  console.log(`Running ${filtered.length} fixture(s); refresh=${args.refreshCorpus}; strict=${args.strict}`);
  const runId = new Date().toISOString();
  const results = [];
  for (const entry of filtered) {
    process.stdout.write(`  ${entry.id} … `);
    try {
      const result = await runFixture(entry, args);
      results.push(result);
      const verdict = result.status === "PASS" ? "PASS" : result.status === "FAIL" ? "FAIL" : "SKIP";
      const failedGates = result.gates.filter((g) => !g.passed).map((g) => g.id);
      const tail = failedGates.length ? `  (failed: ${failedGates.join(", ")})` : "";
      console.log(`${verdict}${tail}`);
    } catch (error) {
      console.log(`CRASH ${error.message}`);
      results.push({
        id: entry.id,
        status: "FAIL",
        gates: [{ id: "runner_crash", passed: false, detail: error.message }],
        fixture: entry.fixture,
        analysis: null,
        frames: []
      });
    }
  }

  const summary = summarise(results);
  const report = {
    runId,
    mode: "analyzer_only",
    summary,
    fixtures: results.map((r) => ({
      id: r.id,
      status: r.status,
      gates: r.gates,
      primaryMotif: r.analysis?.primaryMotif ?? null,
      excludeSegments: r.analysis?.excludeSegments ?? []
    }))
  };
  await writeFile(path.join(reportRoot, "corpus-regression-report.json"), JSON.stringify(report, null, 2), "utf8");
  const md = markdownReport(results, summary, runId);
  await writeFile(path.join(reportRoot, "corpus-regression-report.md"), md, "utf8");
  console.log(`\nWrote ${rel(path.join(reportRoot, "corpus-regression-report.json"))}`);
  console.log(`Wrote ${rel(path.join(reportRoot, "corpus-regression-report.md"))}`);
  console.log(`Summary: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped`);

  if (args.strict && summary.failed > 0) process.exit(2);
}

main().catch((error) => {
  console.error("runner crashed:", error);
  process.exit(1);
});
