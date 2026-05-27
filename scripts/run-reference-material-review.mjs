#!/usr/bin/env node
// Automation runner for /review-reference-material.
// Handles the deterministic slices of the Phase A–O review prompt
// (see docs/review-prompts/reference-material-fix.md) and emits a structured
// JSON dump that the slash-command agent reads. Never exits non-zero on
// content findings — only on its own internal errors — so the agent step
// always runs.

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot, artifactRoot } from "./artifact-paths.mjs";

const SCRIPT_VERSION = "1.0.0";
const editingDir = path.join(artifactRoot, "editing_case");
const productDemoDir = path.join(artifactRoot, "product_demo");
const reviewDir = path.join(artifactRoot, "review");
const latestRunPath = path.join(reviewDir, "_latest_run.json");

const STDOUT_TAIL_BYTES = 4000;
const ARTIFACT_FILES = [
  { name: "analysis.editing.json", required: true },
  { name: "generation-result.json", required: true },
  { name: "timeline.json", required: true },
  { name: "gap-report.json", required: true },
  { name: "fill-plan.json", required: true },
  { name: "replacement-slots.json", required: true },
  { name: "render.mp4", required: true },
  { name: "contact_sheet.png", required: true },
  { name: "preview_frames", required: true, kind: "dir" },
  { name: "report.md", required: true },
  { name: "index.html", required: true },
  { name: "evaluation.editing.json", required: false },
  { name: "source-evidence-frames", required: false, kind: "dir" },
  { name: "blocked-material-report.json", required: false },
  { name: "ui-manifest.json", required: false }
];

const PHASE_A_COMMANDS = [
  { id: "git_status", argv: ["git", "status", "--short"], timeoutMs: 30_000 },
  { id: "npm_build", argv: ["npm", "run", "build"], timeoutMs: 10 * 60_000 },
  { id: "npm_test", argv: ["npm", "test"], timeoutMs: 15 * 60_000 },
  {
    id: "validate_schemas",
    argv: ["npm", "run", "validate:schemas"],
    timeoutMs: 5 * 60_000
  },
  {
    id: "run_editing_case",
    argv: ["node", "scripts/run-editing-case.mjs"],
    timeoutMs: 10 * 60_000
  }
];

const TEST_FILE_PATTERNS = [
  /editing/i,
  /gap/i,
  /replacement/i,
  /sample.*reuse/i,
  /reference.*material/i,
  /slot.*map/i,
  /proxy/i
];

const SECRET_PATTERNS = [
  "/home/pxli",
  "GEMINI_API_KEY",
  ".env",
  "AIza",
  "ark-"
];

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return {
    iso: d.toISOString(),
    compact: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(
      d.getUTCHours()
    )}${pad(d.getUTCMinutes())}`
  };
}

function tailString(buf, maxBytes) {
  if (buf.length <= maxBytes) return buf;
  return `…[truncated ${buf.length - maxBytes} bytes]…\n${buf.slice(-maxBytes)}`;
}

function runCommand({ argv, timeoutMs, env }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdoutBuf = "";
    let stderrBuf = "";
    let timedOut = false;
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd: repoRoot,
        env: { ...process.env, ...(env ?? {}) },
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (err) {
      resolve({
        exitCode: null,
        signal: null,
        durationMs: 0,
        stdoutTail: "",
        stderrTail: String(err?.message ?? err),
        spawnError: true
      });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {}
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdoutBuf += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBuf += String(chunk);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        signal: null,
        durationMs: Date.now() - started,
        stdoutTail: tailString(stdoutBuf, STDOUT_TAIL_BYTES),
        stderrTail: tailString(stderrBuf + `\n[spawn error] ${err.message}`, STDOUT_TAIL_BYTES),
        spawnError: true
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        signal: signal ?? null,
        durationMs: Date.now() - started,
        stdoutTail: tailString(stdoutBuf, STDOUT_TAIL_BYTES),
        stderrTail: tailString(stderrBuf, STDOUT_TAIL_BYTES),
        timedOut,
        spawnError: false
      });
    });
  });
}

function resolveFfprobeBin() {
  const explicit = process.env.FFPROBE_PATH;
  if (explicit && explicit !== "ffprobe") return explicit;
  const condaBase = process.env.CONDA_BASE ?? "/home/pxli/anaconda3";
  const condaEnv = process.env.VIRAL_CONDA_ENV ?? "viral";
  const condaBin = path.join(condaBase, "envs", condaEnv, "bin", "ffprobe");
  return existsSync(condaBin) ? condaBin : "ffprobe";
}

async function probeRender(renderPath) {
  if (!existsSync(renderPath)) return { exists: false };
  const ffprobe = resolveFfprobeBin();
  const result = await runCommand({
    argv: [
      ffprobe,
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,width,height,r_frame_rate,duration",
      "-show_entries",
      "format=duration,size,bit_rate",
      "-of",
      "json",
      renderPath
    ],
    timeoutMs: 30_000
  });
  if (result.exitCode !== 0) {
    return {
      exists: true,
      ffprobeError: true,
      stderrTail: result.stderrTail,
      stdoutTail: result.stdoutTail
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdoutTail);
  } catch (err) {
    return {
      exists: true,
      ffprobeError: true,
      parseError: String(err?.message ?? err),
      stdoutTail: result.stdoutTail
    };
  }
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  const format = parsed.format ?? {};
  let fps = null;
  if (video?.r_frame_rate) {
    const [n, d] = String(video.r_frame_rate).split("/").map(Number);
    if (Number.isFinite(n) && Number.isFinite(d) && d !== 0) fps = n / d;
  }
  return {
    exists: true,
    duration: format.duration ? Number(format.duration) : null,
    size: format.size ? Number(format.size) : null,
    bitrate: format.bit_rate ? Number(format.bit_rate) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    videoCodec: video?.codec_name ?? null,
    fps,
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name ?? null,
    ffprobeBin: ffprobe
  };
}

function statSafe(p) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

async function probeArtifacts() {
  const dirExists = existsSync(editingDir);
  const items = [];
  for (const spec of ARTIFACT_FILES) {
    const full = path.join(editingDir, spec.name);
    const stat = statSafe(full);
    const item = {
      name: spec.name,
      required: spec.required,
      kind: spec.kind ?? "file",
      exists: Boolean(stat),
      sizeBytes: stat?.isFile() ? stat.size : null,
      mtime: stat ? stat.mtime.toISOString() : null
    };
    if (spec.kind === "dir" && stat?.isDirectory()) {
      try {
        const entries = await readdir(full);
        item.entryCount = entries.length;
        item.sample = entries.slice(0, 8);
      } catch (err) {
        item.readError = String(err?.message ?? err);
      }
    }
    items.push(item);
  }
  return {
    editingCaseExists: dirExists,
    editingCasePath: path.relative(repoRoot, editingDir),
    items
  };
}

async function probePreviewFrames() {
  const dir = path.join(editingDir, "preview_frames");
  if (!existsSync(dir)) return { exists: false, count: 0, samples: [] };
  let entries = [];
  try {
    entries = await readdir(dir);
  } catch (err) {
    return { exists: true, readError: String(err?.message ?? err) };
  }
  const samples = entries.slice(0, 12).map((name) => {
    const full = path.join(dir, name);
    const st = statSafe(full);
    return {
      name,
      sizeBytes: st?.isFile() ? st.size : null
    };
  });
  return { exists: true, count: entries.length, samples };
}

function secretGrepArgs(rootDirs) {
  const orPattern = SECRET_PATTERNS.map((p) =>
    p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("|");
  return [
    "grep",
    "-RIn",
    "--binary-files=without-match",
    "-E",
    orPattern,
    ...rootDirs
  ];
}

async function runSecretGrep() {
  const dirs = [editingDir, productDemoDir].filter((d) => existsSync(d));
  if (dirs.length === 0) {
    return { ran: false, reason: "No artifact directories to scan", matches: [] };
  }
  const argv = secretGrepArgs(dirs);
  const result = await runCommand({ argv, timeoutMs: 60_000 });
  // grep exits 1 when no matches — that's success for us.
  const ok = result.exitCode === 0 || result.exitCode === 1;
  if (!ok) {
    return {
      ran: true,
      ok: false,
      argv,
      exitCode: result.exitCode,
      stderrTail: result.stderrTail,
      matches: []
    };
  }
  const lines = result.stdoutTail.split("\n").filter(Boolean).slice(0, 200);
  const matches = lines.map((line) => {
    const m = line.match(/^([^:]+):(\d+):(.*)$/);
    if (!m) return { raw: line };
    return {
      path: path.relative(repoRoot, m[1]),
      line: Number(m[2]),
      snippet: m[3].slice(0, 240)
    };
  });
  return {
    ran: true,
    ok: true,
    argv,
    matchCount: lines.length,
    truncated: lines.length === 200,
    matches
  };
}

async function walkDir(root, predicate, acc = []) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      await walkDir(full, predicate, acc);
    } else if (entry.isFile() && predicate(entry.name, full)) {
      acc.push(path.relative(repoRoot, full));
    }
  }
  return acc;
}

async function inventoryTests() {
  const roots = [
    path.join(repoRoot, "packages", "shared", "src", "__tests__"),
    path.join(repoRoot, "apps", "api", "tests")
  ];
  const matches = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const found = await walkDir(root, (name) =>
      /\.(test|spec)\.(ts|js|mjs|tsx)$/.test(name) &&
      TEST_FILE_PATTERNS.some((re) => re.test(name))
    );
    matches.push(...found);
  }
  // Also do a coarse content grep inside the test roots for the expected gate names,
  // so the agent can spot whether tests exist by name but the assertions don't.
  const gateNames = [
    "sample_reference_cannot_satisfy_visual_slots",
    "mock_asset_cannot_satisfy_visual_slots",
    "asset_without_path_cannot_satisfy_visual_slots",
    "authorized_sample_reuse_can_match_visual_slots",
    "gap_detected_when_no_target_assets",
    "sample_visual_not_reused_without_authorization",
    "mock_asset_not_counted_as_match",
    "interactive_gap_fill_non_empty",
    "proxy_placeholder_rendered",
    "timeline_preview_has_real_or_proxy_frames",
    "unresolved_visual_slots_count"
  ];
  const gateHits = {};
  const testSearchRoots = [
    "packages/shared/src/__tests__",
    "apps/api/tests"
  ].filter((rel) => existsSync(path.join(repoRoot, rel)));
  for (const gate of gateNames) {
    if (testSearchRoots.length === 0) {
      gateHits[gate] = [];
      continue;
    }
    const argv = [
      "grep",
      "-RIl",
      "--include=*.ts",
      "--include=*.tsx",
      "--include=*.js",
      "--include=*.mjs",
      "--exclude-dir=dist",
      "--exclude-dir=node_modules",
      "-F",
      gate,
      ...testSearchRoots
    ];
    const result = await runCommand({ argv, timeoutMs: 30_000 });
    if (result.exitCode === 0) {
      gateHits[gate] = result.stdoutTail
        .split("\n")
        .filter(Boolean)
        .slice(0, 5)
        .map((f) => path.relative(repoRoot, path.resolve(repoRoot, f)));
    } else {
      gateHits[gate] = [];
    }
  }
  return { matchingFiles: matches, gateNameHits: gateHits };
}

async function captureGitInfo() {
  const sha = await runCommand({
    argv: ["git", "rev-parse", "HEAD"],
    timeoutMs: 10_000
  });
  const branch = await runCommand({
    argv: ["git", "rev-parse", "--abbrev-ref", "HEAD"],
    timeoutMs: 10_000
  });
  return {
    sha: sha.exitCode === 0 ? sha.stdoutTail.trim() : null,
    branch: branch.exitCode === 0 ? branch.stdoutTail.trim() : null
  };
}

function summariseForStdout(report) {
  const lines = [];
  lines.push("=== reference-material review runner ===");
  lines.push(`runId        : ${report.runId}`);
  lines.push(`timestamp    : ${report.timestamp}`);
  lines.push(`git          : ${report.git.branch ?? "?"}@${(report.git.sha ?? "").slice(0, 8)}`);
  lines.push("");
  lines.push("-- Phase A (commands) --");
  for (const cmd of report.phaseA.commands) {
    const tag = cmd.skipped
      ? "skipped"
      : cmd.spawnError
        ? "SPAWN_ERR"
        : cmd.timedOut
          ? "TIMEOUT"
          : cmd.exitCode === 0
            ? "ok"
            : `exit=${cmd.exitCode}`;
    const dur = cmd.skipped ? "" : `${(cmd.durationMs / 1000).toFixed(1)}s`;
    lines.push(`  ${cmd.id.padEnd(18)} ${tag.padEnd(10)} ${dur}`);
  }
  lines.push("");
  lines.push("-- Phase B (artifacts) --");
  for (const item of report.phaseB.items) {
    const tag = item.exists ? `ok ${item.sizeBytes ?? item.entryCount ?? ""}` : "MISSING";
    const req = item.required ? "" : " (optional)";
    lines.push(`  ${item.name.padEnd(34)} ${tag}${req}`);
  }
  lines.push("");
  if (report.phaseI?.exists) {
    const i = report.phaseI;
    lines.push(
      `-- Phase I (render.mp4): ${i.duration?.toFixed?.(2) ?? "?"}s  ${i.width}x${i.height}  ${i.fps?.toFixed?.(2) ?? "?"}fps  audio=${i.hasAudio}  size=${i.size}`
    );
  } else {
    lines.push("-- Phase I (render.mp4): MISSING --");
  }
  lines.push("");
  lines.push(
    `-- Phase M (secret grep): ${report.phaseM.ran ? `${report.phaseM.matchCount ?? 0} matches` : "skipped"}`
  );
  if (report.phaseM.matches?.length) {
    for (const m of report.phaseM.matches.slice(0, 5)) {
      lines.push(`    ${m.path ?? m.raw}${m.line ? `:${m.line}` : ""}`);
    }
  }
  lines.push("");
  lines.push(
    `-- Phase L (test inventory): ${report.phaseL.matchingFiles.length} matching test files`
  );
  for (const f of report.phaseL.matchingFiles.slice(0, 8)) {
    lines.push(`    ${f}`);
  }
  lines.push("");
  lines.push(`dump written to: ${path.relative(repoRoot, latestRunPath)}`);
  return lines.join("\n");
}

async function main() {
  const { iso, compact } = nowStamp();
  const runId = `refmat-${compact}-${Math.random().toString(36).slice(2, 6)}`;
  const skipPhaseA = process.argv.includes("--skip-phase-a");

  await mkdir(reviewDir, { recursive: true });

  const git = await captureGitInfo();

  const phaseAResults = [];
  if (skipPhaseA) {
    for (const cmd of PHASE_A_COMMANDS) {
      phaseAResults.push({
        id: cmd.id,
        argv: cmd.argv,
        skipped: true,
        reason: "--skip-phase-a flag set"
      });
    }
  } else {
    for (const cmd of PHASE_A_COMMANDS) {
      const result = await runCommand({ argv: cmd.argv, timeoutMs: cmd.timeoutMs });
      phaseAResults.push({
        id: cmd.id,
        argv: cmd.argv,
        ...result
      });
    }
  }

  const phaseB = await probeArtifacts();
  const phaseI = await probeRender(path.join(editingDir, "render.mp4"));
  const phaseJ = await probePreviewFrames();
  const phaseM = await runSecretGrep();
  const phaseL = await inventoryTests();

  const report = {
    runId,
    timestamp: iso,
    compactStamp: compact,
    scriptVersion: SCRIPT_VERSION,
    cwd: repoRoot,
    git,
    promptPath: path.relative(
      repoRoot,
      path.join(repoRoot, "docs", "review-prompts", "reference-material-fix.md")
    ),
    expectedReportPath: path.relative(
      repoRoot,
      path.join(reviewDir, `reference_material_fix_review.${compact}.md`)
    ),
    latestReportPath: path.relative(
      repoRoot,
      path.join(reviewDir, "reference_material_fix_review.latest.md")
    ),
    phaseA: { commands: phaseAResults },
    phaseB,
    phaseI,
    phaseJ_previewFrames: phaseJ,
    phaseM,
    phaseL
  };

  await writeFile(latestRunPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(summariseForStdout(report));
}

export { SCRIPT_VERSION };

const argv = process.argv.slice(2);
if (argv.includes("--print-config")) {
  console.log(
    JSON.stringify(
      {
        scriptVersion: SCRIPT_VERSION,
        scriptPath: fileURLToPath(import.meta.url),
        repoRoot,
        editingDir,
        productDemoDir,
        reviewDir,
        latestRunPath,
        commands: PHASE_A_COMMANDS,
        artifacts: ARTIFACT_FILES
      },
      null,
      2
    )
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[run-reference-material-review] fatal:", err);
  process.exit(2);
});
