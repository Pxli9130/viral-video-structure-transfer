#!/usr/bin/env node
// Dry-run generator: build a CreativeEffectSpec from evidence, generate a Remotion effect proposal
// (Gemini if enabled, else local fallback), validate it, write reports. NEVER modifies production
// source (apps/api/remotion/effects/generated) or the EffectKnowledgeBase in dry-run.
//
// Flags: --case <id> --sample <p> --analysis <p> --template <p> --recipe <p> --contact-sheet <p>
//        --out <dir> --dry-run --repair --json --strict
//        --apply (register a validated effect: generated source + KB + manifest)
//        --promote (with --apply: let this generated effect OVERRIDE the motif's built-in)
//        --force (overwrite an existing generated dir) --allow-failed-proposal (exit 0 without applying)

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildDeterministicCreativeEffectSpecFromEvidence,
  defaultEffectKbPath,
  generateRemotionEffectProposal,
  loadEffectKnowledgeBase,
  readGeneratedEffectProposal,
  repairGeneratedEffectProposal,
  saveEffectKnowledgeBase,
  upsertEffectKnowledgeEntry,
  writeGeneratedEffectProposal
} from "@vvst/shared";
import { validateGeneratedEffect } from "./validate-generated-effect.mjs";
import { buildGeneratedManifestSource, selectManifestEntries } from "./update-generated-effect-manifest.mjs";

const GENERATED_DIR = "apps/api/remotion/effects/generated";

function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_]/g, "_");
}

export function applyGeneratedEffect(ROOT, proposalDir, proposal, validation, caseId, force, promote) {
  let effectId = sanitizeId(proposal.effectId);
  const genRoot = path.join(ROOT, GENERATED_DIR);
  let destDir = path.join(genRoot, effectId);
  if (existsSync(destDir) && !force) {
    let n = 2;
    while (existsSync(path.join(genRoot, `${effectId}_${n}`))) n += 1;
    effectId = `${effectId}_${n}`;
    destDir = path.join(genRoot, effectId);
  }
  mkdirSync(destDir, { recursive: true });
  for (const f of ["index.tsx", "schema.ts", "fixture.json", "README.md", "proposal-metadata.json", "validation-report.json"]) {
    const src = path.join(proposalDir, f);
    if (existsSync(src)) copyFileSync(src, path.join(destDir, f));
  }
  // KB entry (source=generated). componentPath is relative to repo root.
  const componentPath = `${GENERATED_DIR}/${effectId}/index.tsx`;
  let requiredProps = ["width", "height", "fps", "durationSec"];
  try {
    const fx = JSON.parse(proposal.files["fixture.json"]);
    requiredProps = Object.keys(fx).filter((k) => k !== "proceduralFallback");
  } catch {
    /* keep default */
  }
  const entry = {
    id: effectId,
    motifFamily: proposal.motifFamily,
    effectName: proposal.effectName,
    componentName: proposal.componentName,
    componentPath,
    propsSchemaPath: `${GENERATED_DIR}/${effectId}/schema.ts`,
    source: "generated",
    provider: proposal.provider,
    validationStatus: validation.validationStatus,
    // Apply registers the effect; it only OVERRIDES the motif's built-in (in selection + the static
    // runtime manifest) when explicitly promoted. Default apply = registered-but-not-promoted.
    promoted: promote === true,
    defaultExport: validation.exportStyle === "default",
    learnedFromSamples: [caseId],
    applicableWhen: [proposal.motifFamily],
    avoidWhen: [],
    requiredProps,
    createdAt: proposal.createdAt
  };
  const kbPath = defaultEffectKbPath();
  saveEffectKnowledgeBase(upsertEffectKnowledgeEntry(loadEffectKnowledgeBase(kbPath), entry), kbPath);
  // Regenerate the static manifest (only valid + on-disk generated effects).
  const manifestEntries = selectManifestEntries(loadEffectKnowledgeBase(kbPath), genRoot);
  writeFileSync(path.join(genRoot, "effect-manifest.ts"), buildGeneratedManifestSource(manifestEntries), "utf8");
  return { effectId, destDir, componentPath, manifestEntries: manifestEntries.map((e) => e.id) };
}

const ROOT = process.cwd();
function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
function readJson(p) {
  try {
    return p && existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined;
  } catch {
    return undefined;
  }
}

function evidenceFromAnalysis(analysis, template) {
  if (!analysis && !template) return { evidenceSummary: undefined };
  const ev = analysis?.evidenceTimeline ?? {};
  const ocrText = Array.isArray(analysis?.ocr) ? analysis.ocr.map((o) => (typeof o === "string" ? o : o?.text)).filter(Boolean) : [];
  const typo = ev.typographyEvidence ?? analysis?.typographyEvidence ?? [];
  const visualForms = (ev.visualElementGraph?.elements ?? []).map((e) => e?.family).filter(Boolean);
  const palette = analysis?.palette ?? ev.stats?.dominantPalette ?? [];
  const techniqueKeywords = [
    ...(template?.techniqueAtoms ?? []).map((a) => a?.type).filter(Boolean),
    ...visualForms
  ];
  return {
    ocrText,
    palette,
    techniqueKeywords,
    visualForms,
    videoType: template?.videoType ?? analysis?.videoType,
    bpm: ev.beatGrid?.bpm ?? ev.stats?.bpm,
    evidenceSummary: `clips=${(ev.shots ?? []).length} typo=${typo.length} palette=${JSON.stringify(palette).slice(0, 80)}`
  };
}

async function main() {
  const caseId = arg("--case", "unnamed-case");
  const analysisPath = arg("--analysis") ?? `docs/artifacts/learned_samples_max/${caseId}/analysis.json`;
  const templatePath = arg("--template");
  const recipePath = arg("--recipe");
  const contactSheet = arg("--contact-sheet");
  const outDir = path.resolve(ROOT, arg("--out", `docs/artifacts/codegen/${caseId}`));
  const strict = process.argv.includes("--strict");
  const asJson = process.argv.includes("--json");
  mkdirSync(outDir, { recursive: true });

  const analysis = readJson(path.resolve(ROOT, analysisPath));
  const template = readJson(templatePath ? path.resolve(ROOT, templatePath) : "");
  const recipe = readJson(recipePath ? path.resolve(ROOT, recipePath) : "");

  const ev = evidenceFromAnalysis(analysis, template);
  const spec = buildDeterministicCreativeEffectSpecFromEvidence({
    caseId,
    ocrText: ev.ocrText,
    palette: ev.palette,
    techniqueKeywords: ev.techniqueKeywords,
    visualForms: ev.visualForms,
    videoType: ev.videoType,
    bpm: ev.bpm,
    createdAt: "2026-06-02T00:00:00.000Z"
  });
  writeFileSync(path.join(outDir, "creative-effect-spec.json"), `${JSON.stringify(spec, null, 2)}\n`);
  writeFileSync(
    path.join(outDir, "creative-effect-spec.md"),
    `# CreativeEffectSpec — ${caseId}\n\n- motifFamily: ${spec.motifFamily}\n- effectName: ${spec.effectName}\n- ${spec.visualDescription}\n\nEvidence: ${ev.evidenceSummary ?? "(none — generic motif)"}\n`
  );

  const result = await generateRemotionEffectProposal({
    spec,
    evidenceSummary: ev.evidenceSummary,
    contactSheetPathMeta: contactSheet ? { fileName: path.basename(contactSheet) } : undefined,
    recipeContext: recipe?.global ? { width: recipe.global.width, height: recipe.global.height, fps: recipe.global.fps, durationSec: recipe.global.durationSec, palette: recipe.global.palette } : undefined,
    productTheme: recipe?.productTheme ? { name: recipe.productTheme.name, category: recipe.productTheme.category, cta: recipe.productTheme.cta } : undefined
  });

  const proposalDir = path.join(outDir, "proposal");
  writeGeneratedEffectProposal(result.proposal, proposalDir);
  writeFileSync(path.join(proposalDir, "gemini-prompt.txt"), result.prompt, "utf8");
  if (result.rawResponse) writeFileSync(path.join(proposalDir, "gemini-raw-response.txt"), result.rawResponse, "utf8");

  const providerLog = {
    provider: result.provider,
    model: result.model ?? null,
    promptHash: result.promptHash,
    status: result.status,
    error: result.error ?? null
  };
  writeFileSync(path.join(outDir, "provider-call-log.json"), `${JSON.stringify(providerLog, null, 2)}\n`);

  let validation = validateGeneratedEffect(proposalDir, { previewAttempt: false });

  // --repair: up to 2 Gemini repair attempts (only when Gemini is enabled). Each attempt's artifacts
  // are written to repair-attempt-N/; never modifies production source. Skipped (recorded) when off.
  const repairLog = [];
  if (process.argv.includes("--repair") && validation.validationStatus === "fail") {
    let current = result.proposal;
    for (let attempt = 1; attempt <= 2 && validation.validationStatus === "fail"; attempt += 1) {
      const repair = await repairGeneratedEffectProposal(current, [...validation.failedChecks, ...validation.exactErrors]);
      repairLog.push({ attempt, status: repair.status, error: repair.error ?? null });
      if (repair.status === "repair_skipped") break;
      const attemptDir = path.join(outDir, `repair-attempt-${attempt}`);
      writeGeneratedEffectProposal(repair.proposal, attemptDir);
      const attemptValidation = validateGeneratedEffect(attemptDir, { previewAttempt: false });
      writeFileSync(path.join(attemptDir, "validation-report.json"), `${JSON.stringify(attemptValidation, null, 2)}\n`);
      current = repair.proposal;
      validation = attemptValidation;
      if (attemptValidation.validationStatus !== "fail") {
        writeGeneratedEffectProposal(repair.proposal, proposalDir);
      }
    }
  }

  // Re-validate the actual final proposalDir files so the written report + apply decision always
  // match what is on disk (after any repair copy-back).
  validation = validateGeneratedEffect(proposalDir, { previewAttempt: false });
  writeFileSync(path.join(proposalDir, "validation-report.json"), `${JSON.stringify(validation, null, 2)}\n`);
  writeFileSync(path.join(outDir, "validation-report.json"), `${JSON.stringify(validation, null, 2)}\n`);
  if (repairLog.length) writeFileSync(path.join(outDir, "repair-log.json"), `${JSON.stringify(repairLog, null, 2)}\n`);

  // --apply: register a VALIDATED generated effect into production (generated source + KB + manifest).
  const doApply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");
  const promote = process.argv.includes("--promote");
  const allowFailed = process.argv.includes("--allow-failed-proposal");
  let applied = null;
  if (doApply) {
    if (validation.safeToApply) {
      const finalProposal = readGeneratedEffectProposal(proposalDir);
      applied = applyGeneratedEffect(ROOT, proposalDir, finalProposal, validation, caseId, force, promote);
      console.log(
        `[generate-effect] APPLIED generated effect "${applied.effectId}" -> ${applied.componentPath}; promoted=${promote} manifest=[${applied.manifestEntries.join(",")}]` +
          (promote ? "" : " (registered but NOT promoted — built-in still wins; re-run with --promote to override)")
      );
    } else if (!allowFailed) {
      console.error(`[generate-effect] --apply refused: validation=${validation.validationStatus} (not safe). Use --allow-failed-proposal to override (still will not copy).`);
      process.exit(1);
    } else {
      console.log("[generate-effect] validation not safe; --allow-failed-proposal set, so exiting 0 WITHOUT applying (never copies unvalidated code).");
    }
  }

  const summary = {
    case: caseId,
    motifFamily: spec.motifFamily,
    provider: result.provider,
    proposalStatus: result.status,
    validationStatus: validation.validationStatus,
    safeToApply: validation.safeToApply,
    applied: Boolean(applied),
    appliedEffectId: applied?.effectId ?? null,
    promoted: Boolean(applied) && promote,
    dryRun: !doApply,
    productionSourceModified: Boolean(applied),
    kbModified: Boolean(applied)
  };
  if (asJson) console.log(JSON.stringify(summary, null, 2));
  else
    console.log(
      `[generate-effect] case=${caseId} motif=${spec.motifFamily} provider=${result.provider} proposal=${result.status} validation=${validation.validationStatus} safeToApply=${validation.safeToApply} (dry-run, no production source modified)`
    );

  if (strict && validation.validationStatus === "fail") process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith("generate-effect-from-sample.mjs");
if (isMain) main();

export { main };
