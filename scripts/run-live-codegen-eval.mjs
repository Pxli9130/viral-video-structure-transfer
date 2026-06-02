#!/usr/bin/env node
// Live codegen-layer eval for the expected_codegen_eval_bundle.
//
// This script intentionally uses real Gemini HTTP for the visual/codegen-layer inference step.
// It does not apply generated Remotion code to production source. Optional ElevenLabs absence is
// treated as an audio fallback signal, not a visual/codegen failure.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildDeterministicCreativeEffectSpecFromEvidence,
  generateRemotionEffectProposal,
  selectEffect,
  validateCreativeEffectSpec,
  writeGeneratedEffectProposal
} from "@vvst/shared";
import { validateGeneratedEffect } from "./validate-generated-effect.mjs";

const ROOT = process.cwd();
const DEFAULT_BUNDLE = path.join(ROOT, "expected_codegen_eval_bundle");
const DEFAULT_OUT = path.join(ROOT, "docs/artifacts/codegen-live-eval");

const CONTACT_SHEETS = {
  marketing: "marketing_contact.jpg",
  motion_graph_1: "motion_graph_1_contact.jpg",
  motion_graph_2: "motion_graph_2_contact.jpg",
  editing: "editing_contact.jpg"
};

const CASE_ORDER = ["marketing", "motion_graph_1", "motion_graph_2", "editing"];

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(name);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function loadDotEnv(file = path.join(ROOT, ".env")) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function extractJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Gemini response did not contain a JSON object.");
  }
}

function compactExpectedForPrompt(caseId, expected, audioSummary, visualSummary) {
  return {
    caseId,
    source: {
      durationSec: expected.source?.durationSec,
      width: expected.source?.width,
      height: expected.source?.height,
      fps: expected.source?.fps,
      aspectRatio: expected.source?.aspectRatio
    },
    expectedEvalAssertions: expected.evalAssertions ?? [],
    audio: audioSummary?.[caseId],
    visualChanges: visualSummary?.[caseId],
    hardRules: {
      samplePixelsAllowedInFinal: false,
      sampleAudioAllowedInFinal: false,
      platformChromeEvidenceOnly: true,
      elevenLabsOptional: true
    }
  };
}

function buildLayerPrompt(caseId, expected, audioSummary, visualSummary) {
  const compact = compactExpectedForPrompt(caseId, expected, audioSummary, visualSummary);
  return [
    "You are evaluating and generating reusable codegen-layer plans for a video-structure transfer engine.",
    "Analyze the attached contact sheet and the deterministic audio/visual summaries.",
    "Return STRICT JSON only. Do not output markdown.",
    "",
    "Safety boundary:",
    "- The sample video is structure evidence only.",
    "- Do not copy raw sample frames, sample audio, logos, watermarks, platform UI, author handles, or source brand names.",
    "- Do not condition on sample filenames or paths.",
    "- ElevenLabs audio is optional. If unavailable, produce procedural audio and providerFallbackReason='elevenlabs_optional' or 'elevenlabs_not_configured_or_unavailable'.",
    "",
    "Allowed motifFamily values:",
    "- poster_ribbon_marketing",
    "- card_orbit_motion_graph",
    "- blue_spotlight_ui_pitch",
    "- beat_cut_chinese_editing_tutorial",
    "- split_screen_compare",
    "- generic_motion_graph",
    "",
    "Return exactly this JSON shape:",
    "{",
    '  "caseId": "marketing",',
    '  "motifEvidence": {',
    '    "ocrText": [],',
    '    "palette": [],',
    '    "techniqueKeywords": [],',
    '    "visualForms": [],',
    '    "videoType": "",',
    '    "bpm": 120',
    "  },",
    '  "observedVisualGrammar": { "motifFamily": "", "summary": "", "timeline": [] },',
    '  "creativeEffectSpec": {',
    '    "version": "creative-effect-spec.v1",',
    '    "id": "",',
    '    "motifFamily": "",',
    '    "effectName": "",',
    '    "visualDescription": "",',
    '    "motionBehavior": [],',
    '    "transitionBehavior": [],',
    '    "requiredProps": [],',
    '    "forbiddenOverfitRules": []',
    "  },",
    '  "effectSelection": { "effectProgramIds": [], "effectNames": [], "source": "built_in", "fallbackReason": null },',
    '  "codegenLayers": [',
    '    { "id": "", "type": "media|motion_atom|text|transition|audio", "kind": "", "startSec": 0, "durationSec": 1, "zIndex": 0, "expectedRenderer": "", "params": {} }',
    "  ],",
    '  "audioFallback": { "policy": "procedural", "providerFallbackReason": "elevenlabs_optional" },',
    '  "safety": {',
    '    "samplePixelsAllowedInFinal": false,',
    '    "sampleAudioAllowedInFinal": false,',
    '    "platformWatermarksCopied": false,',
    '    "sampleBrandCopied": false,',
    '    "samplePathOrFilenameConditionals": false',
    "  },",
    '  "assertionNotes": []',
    "}",
    "",
    `Case package:\n${JSON.stringify(compact, null, 2)}`
  ].join("\n");
}

async function geminiJsonWithImage({ prompt, imagePath, model, apiKey, baseUrl }) {
  const url = `${baseUrl.replace(/\/$/, "")}/models/${model}:generateContent`;
  const imageData = readFileSync(imagePath).toString("base64");
  const startedAt = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType: "image/jpeg", data: imageData } }
          ]
        }
      ],
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
    })
  });
  const elapsedMs = Date.now() - startedAt;
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}: ${raw.slice(0, 500)}`);
  }
  const data = JSON.parse(raw);
  const text =
    data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ??
    "";
  if (!text.trim()) throw new Error("Gemini returned no text content.");
  return { json: extractJson(text), raw, text, httpStatus: res.status, elapsedMs };
}

function layerCounts(layers) {
  const counts = { media: 0, text: 0, motion_atom: 0, transition: 0, audio: 0 };
  for (const layer of layers ?? []) {
    if (counts[layer?.type] !== undefined) counts[layer.type] += 1;
  }
  return counts;
}

function includesAny(value, terms) {
  const text = JSON.stringify(value ?? {}).toLowerCase();
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function semanticChecks(caseId, actual) {
  const checks = [];
  const text = JSON.stringify(actual?.codegenLayers ?? actual ?? {}).toLowerCase();
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });
  if (caseId === "marketing") {
    add("semantic_light_poster", /white|light|warm|poster|exhibition/.test(text), "white/light poster background");
    add("semantic_ribbon", /ribbon|silk|satin|s-curve|sweep/.test(text), "visible ribbon/silk sweep");
    add("semantic_ribbon_color_cycle", /blue|purple|pink|orange|yellow|green|cyan|color.*keyframe|hue/.test(text), "ribbon color changes over time");
    add("semantic_no_generic_dark", !/generic dark template|dark tech template/.test(text), "not generic dark template");
  } else if (caseId === "motion_graph_1") {
    add("semantic_card_stack_orbit_scatter", /card/.test(text) && /orbit|stack|scatter/.test(text), "card stack/orbit/scatter");
    add("semantic_many_cards", /8|9|10|11|12|cardcount|min/.test(text), "8+ cards indicated");
    add("semantic_neon_outline", /neon|magenta|polygon|outline/.test(text), "magenta neon outline");
    add("semantic_hero_typography", /hero|big typography|huge|uppercase|rewrite|dream/.test(text), "hero typography section");
    add("semantic_red_tunnel", /red.*tunnel|tunnel.*word|v-shaped/.test(text), "red tunnel word reveal");
  } else if (caseId === "motion_graph_2") {
    add("semantic_blue_spotlight", /blue|spotlight|orb|bloom/.test(text), "blue spotlight/orb");
    add("semantic_search_typewriter", /search|prompt|typewriter/.test(text), "search/prompt typewriter");
    add("semantic_ui_panels", /ui|dashboard|payment|checkout|panel|website/.test(text), "UI/dashboard panels");
    add("semantic_not_red_orbit", !/red card.?orbit|card_orbit_motion_graph/.test(text), "not red card orbit motif");
  } else if (caseId === "editing") {
    add("semantic_chinese_kinetic", /chinese|中文|汉字|kinetic|beat_cut|title/.test(text), "Chinese kinetic typography");
    add("semantic_black_cards", /black|teaching|title card/.test(text), "black teaching cards");
    add("semantic_red_yellow_white", /red|yellow|white|灰|grey|gray/.test(text), "red/yellow/white/grey palette");
    add("semantic_hard_cuts_fx", /hard|beat|flash|glitch|whip|impact/.test(text), "hard beat cuts + flash/glitch/whip");
  }
  return checks;
}

function evaluateCase({ caseId, expected, llmJson, localSpec, selection, validation }) {
  const expectedMotif = expected.creativeEffectSpec?.motifFamily;
  const acceptedIds = expected.effectSelection?.acceptedEffectProgramIds ?? [];
  const expectedMin = expected.expectedCodegenLayers?.minimumLayerCounts ?? {};
  const layers = llmJson.codegenLayers ?? [];
  const counts = layerCounts(layers);
  const selectedIds = selection.effectProgramIds ?? [];
  const llmIds = llmJson.effectSelection?.effectProgramIds ?? [];
  const allIds = [...selectedIds, ...llmIds];
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });

  add("motif_local_matches_expected", localSpec.motifFamily === expectedMotif, `local=${localSpec.motifFamily}, expected=${expectedMotif}`);
  add(
    "motif_llm_matches_expected",
    llmJson.creativeEffectSpec?.motifFamily === expectedMotif || llmJson.observedVisualGrammar?.motifFamily === expectedMotif,
    `llmSpec=${llmJson.creativeEffectSpec?.motifFamily}, llmObserved=${llmJson.observedVisualGrammar?.motifFamily}, expected=${expectedMotif}`
  );
  add("creative_effect_spec_valid", validateCreativeEffectSpec(localSpec).valid, "local CreativeEffectSpec validates");
  add("effect_program_motif_specific", allIds.some((id) => acceptedIds.includes(id)), `selected=${JSON.stringify(allIds)}, accepted=${JSON.stringify(acceptedIds)}`);
  add("not_generic_template", !includesAny({ localSpec, selection, layers }, expected.effectSelection?.mustRejectIfOnly ?? []), `mustRejectIfOnly=${JSON.stringify(expected.effectSelection?.mustRejectIfOnly ?? [])}`);

  for (const [type, min] of Object.entries(expectedMin)) {
    add(`layer_count_${type}`, counts[type] >= min, `${type}: actual=${counts[type]} expected>=${min}`);
  }

  add(
    "audio_fallback_optional",
    counts.audio >= 1 &&
      /elevenlabs_optional|elevenlabs_not_configured_or_unavailable|procedural/i.test(
        JSON.stringify([llmJson.audioFallback, layers.filter((l) => l.type === "audio")])
      ),
    "ElevenLabs absence must be procedural/optional fallback"
  );
  add("safety_no_sample_pixels", llmJson.safety?.samplePixelsAllowedInFinal === false, "sample pixels not allowed");
  add("safety_no_sample_audio", llmJson.safety?.sampleAudioAllowedInFinal === false, "sample audio not allowed");
  add("safety_no_platform_copy", llmJson.safety?.platformWatermarksCopied === false, "platform watermarks/UI not copied");
  add("safety_no_filename_conditionals", llmJson.safety?.samplePathOrFilenameConditionals === false, "no filename/path conditionals");

  const forbiddenOutputText = JSON.stringify({ layers, proposalValidation: validation ?? {} });
  add("no_forbidden_sample_literals", !/\/mnt\/data\/|test_videos\/|marketing\.mov|motion_graph_1\.mov|motion_graph_2\.mov|editing\.mov|fen?da|douyin|xiaohongshu|小红书|抖音/i.test(forbiddenOutputText), "output layers/generated proposal do not contain sample paths/platform/source literals");

  // Grade the actual LIVE Remotion code generation (the second Gemini call), when not skipped.
  if (validation) {
    add("proposal_live_generated", validation.status === "gemini_ok", `live Remotion codegen status=${validation.status} (gemini_ok = real LLM component accepted; provider_error/invalid_response = fell back to local fallback)`);
    add("proposal_static_safe", validation.safeToApply === true && validation.validationStatus !== "fail", `generated component validation=${validation.validationStatus} safeToApply=${validation.safeToApply}`);
  }

  checks.push(...semanticChecks(caseId, llmJson));

  const failures = checks.filter((c) => !c.ok).map((c) => c.id);
  return { pass: failures.length === 0, failures, checks, layerCounts: counts };
}

function mdTable(rows) {
  return rows.map((row) => `| ${row.map((cell) => String(cell).replace(/\|/g, "\\|")).join(" | ")} |`).join("\n");
}

function addPureCheck(checks, id, ok, detail, severity = "report") {
  checks.push({ id, ok: Boolean(ok), detail, severity });
}

function fixtureContractStatus(parsedProposal) {
  if (!parsedProposal?.files?.["fixture.json"]) return { ok: false, detail: "no parsed proposal fixtureJson" };
  try {
    const fixture = JSON.parse(parsedProposal.files["fixture.json"]);
    const assetsOk = Array.isArray(fixture.assets) && fixture.assets.length === 0;
    const fallbackOk = fixture.proceduralFallback === true;
    return {
      ok: assetsOk && fallbackOk,
      detail: `assets=${Array.isArray(fixture.assets) ? fixture.assets.length : "missing"}, proceduralFallback=${fixture.proceduralFallback}`
    };
  } catch (error) {
    return { ok: false, detail: `fixture parse failed: ${error.message}` };
  }
}

function evaluatePureCodegenOutput(output) {
  const checks = [];
  const layer = output.layerPlan;
  const proposal = output.remotionProposal;
  const pure = proposal?.pureGeminiOutput;
  const parsedProposal = pure?.parsedProposal;
  const fixture = fixtureContractStatus(parsedProposal);
  const rawOrParsed = JSON.stringify({
    layerPlan: layer?.parsedJson,
    remotionProposalRaw: pure?.rawResponse,
    parsedProposal
  });
  const forbiddenSampleMatch = rawOrParsed.match(/\/mnt\/data\/|test_videos\/|marketing\.mov|motion_graph_1\.mov|motion_graph_2\.mov|editing\.mov|fen?da|douyin|xiaohongshu|小红书|抖音/i);

  addPureCheck(checks, "layer_plan_raw_recorded", typeof layer?.rawResponse === "string" && layer.rawResponse.length > 0, "Gemini layer-plan raw API response recorded");
  addPureCheck(checks, "layer_plan_parsed_object", Boolean(layer?.parsedJson && typeof layer.parsedJson === "object"), "Gemini layer-plan parsed JSON recorded");
  addPureCheck(checks, "remotion_raw_recorded", typeof pure?.rawResponse === "string" && pure.rawResponse.length > 0, pure?.rawResponse ? "Gemini Remotion raw text recorded" : `no Remotion raw text; status=${pure?.status ?? "missing"}`);
  addPureCheck(checks, "remotion_envelope_valid", pure?.envelopeValidation?.valid === true, pure?.envelopeValidation ? `valid=${pure.envelopeValidation.valid}; errors=${(pure.envelopeValidation.errors ?? []).join(";") || "none"}` : "no envelope validation");
  addPureCheck(checks, "remotion_contract_safe", Array.isArray(pure?.contractViolations) && pure.contractViolations.length === 0, `contractViolations=${JSON.stringify(pure?.contractViolations ?? null)}`);
  addPureCheck(checks, "remotion_fixture_fallback_safe", fixture.ok, fixture.detail);
  addPureCheck(
    checks,
    "pure_output_no_sample_literals",
    !forbiddenSampleMatch,
    forbiddenSampleMatch ? `matched forbidden literal "${forbiddenSampleMatch[0]}"` : "pure Gemini output does not contain sample paths/platform/source literals"
  );
  addPureCheck(checks, "pre_gate_only_not_final_success", true, `downstream proposal status remains ${proposal?.downstreamStatus ?? "skipped"}; existing strict gates still decide final eval`);

  const failures = checks.filter((c) => !c.ok);
  return {
    schema: "pure-codegen-output-eval.v1",
    reportOnly: true,
    pass: failures.length === 0,
    failures: failures.map((f) => f.id),
    checks
  };
}

function buildPureMarkdownReport(report) {
  const rows = report.cases.map((c) => [
    c.caseId,
    c.eval.pass ? "PASS" : `REPORT_FAIL: ${c.eval.failures.join(", ")}`,
    c.remotionProposal?.pureGeminiOutput?.status ?? "missing",
    c.remotionProposal?.downstreamStatus ?? "skipped",
    c.eval.checks.filter((check) => !check.ok).map((check) => `${check.id}: ${check.detail}`).join("; ") || "none"
  ]);
  return [
    "# Pure Codegen Output Eval Report",
    "",
    `- Run dir: \`${report.runDir}\``,
    `- Gemini model: \`${report.model}\``,
    "- Scope: report-only eval of pure Gemini outputs before downstream gates transform, repair, fallback, promote, or reject them.",
    "- This report does not decide final success and does not disable motif/effect/strict gates.",
    "",
    mdTable([
      ["Case", "Report-only result", "Pure Remotion status", "Downstream proposal status", "Pure-output gaps"],
      ["---", "---", "---", "---", "---"],
      ...rows
    ]),
    "",
    "## Details",
    "",
    report.cases.map((c) => [
      `### ${c.caseId}`,
      "",
      ...c.eval.checks.map((check) => `- ${check.ok ? "PASS" : "FAIL"} ${check.id}: ${check.detail}`)
    ].join("\n")).join("\n\n"),
    ""
  ].join("\n");
}

function buildMarkdownReport(report) {
  const caseRows = report.cases.map((c) => [
    c.caseId,
    c.expectedMotif,
    c.localSpec.motifFamily,
    c.llmMotif,
    c.selection.effectProgramIds.join(", "),
    c.proposal?.status ?? "skipped",
    c.eval.pass ? "PASS" : `FAIL: ${c.eval.failures.join(", ")}`
  ]);
  return [
    "# Live Codegen Eval Report",
    "",
    `- Run dir: \`${report.runDir}\``,
    `- Gemini model: \`${report.model}\``,
    `- Live HTTP calls: ${report.liveHttpCalls}`,
    `- Passed: ${report.passed}/${report.total}`,
    `- ElevenLabs policy: optional; procedural audio fallback accepted.`,
    "",
    "## Cases",
    "",
    mdTable([
      ["Case", "Expected motif", "Local motif", "LLM motif", "Selected effect ids", "Proposal", "Result"],
      ["---", "---", "---", "---", "---", "---", "---"],
      ...caseRows
    ]),
    "",
    "## Failures",
    "",
    report.cases
      .map((c) => {
        const failed = c.eval.checks.filter((check) => !check.ok);
        if (!failed.length) return `### ${c.caseId}\n\n- none`;
        return [`### ${c.caseId}`, "", ...failed.map((f) => `- ${f.id}: ${f.detail}`)].join("\n");
      })
      .join("\n\n"),
    "",
    "## Notes",
    "",
    "- The LLM layer-plan step uses the contact sheet image via Gemini `generateContent` HTTP.",
    "- The Remotion proposal step is dry-run only and is validated statically; no generated effect is applied or promoted.",
    "- Audio provider failure or missing ElevenLabs key is not counted as a visual/codegen failure when procedural audio fallback is present.",
    ""
  ].join("\n");
}

async function main() {
  if (!flag("--no-dotenv")) loadDotEnv();
  process.env.CREATIVE_EFFECT_GEMINI = process.env.CREATIVE_EFFECT_GEMINI ?? "1";
  process.env.ALLOW_CLOUD_PROVIDERS = process.env.ALLOW_CLOUD_PROVIDERS ?? "1";
  const bundleDir = path.resolve(ROOT, arg("--expected-dir", DEFAULT_BUNDLE));
  const outRoot = path.resolve(ROOT, arg("--out", DEFAULT_OUT));
  const runId = arg("--run-id", new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"));
  const runDir = path.join(outRoot, runId);
  const model = arg("--model", process.env.GEMINI_CODEGEN_EVAL_MODEL ?? process.env.GEMINI_CODEGEN_MODEL ?? process.env.AI_GEMINI_MODEL ?? "gemini-2.5-pro");
  const baseUrl = (process.env.GEMINI_API_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const skipProposal = flag("--skip-remotion-proposal");
  const strict = flag("--strict");

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured. Live codegen eval requires real Gemini HTTP.");
  }
  if (!existsSync(bundleDir)) throw new Error(`Expected bundle not found: ${bundleDir}`);
  mkdirSync(runDir, { recursive: true });

  const expectedPath = path.join(bundleDir, "expected_codegen_layers_eval.json");
  const expectedAll = readJson(expectedPath);
  const audioSummary = readJson(path.join(bundleDir, "video_analysis/audio_summary.json"));
  const visualSummary = readJson(path.join(bundleDir, "video_analysis/visual_change_summary.json"));

  const cases = [];
  const pureOutputs = [];
  let liveHttpCalls = 0;
  for (const caseId of CASE_ORDER) {
    const expected = expectedAll.cases[caseId];
    if (!expected) continue;
    const caseDir = path.join(runDir, caseId);
    mkdirSync(caseDir, { recursive: true });
    const imagePath = path.join(bundleDir, "video_analysis", CONTACT_SHEETS[caseId]);
    const prompt = buildLayerPrompt(caseId, expected, audioSummary, visualSummary);
    writeFileSync(path.join(caseDir, "live-codegen-prompt.txt"), prompt, "utf8");

    console.log(`[live-codegen-eval] ${caseId}: Gemini layer-plan HTTP (${model})`);
    const live = await geminiJsonWithImage({ prompt, imagePath, model, apiKey, baseUrl });
    liveHttpCalls += 1;
    writeFileSync(path.join(caseDir, "gemini-layer-plan.raw.json"), live.raw, "utf8");
    writeFileSync(path.join(caseDir, "actual-codegen-layers.json"), `${JSON.stringify(live.json, null, 2)}\n`, "utf8");

    const motifEvidence = live.json.motifEvidence ?? {};
    const localSpec = buildDeterministicCreativeEffectSpecFromEvidence({
      id: `ces_live_${caseId}`,
      caseId,
      ocrText: motifEvidence.ocrText ?? [],
      palette: motifEvidence.palette ?? [],
      techniqueKeywords: motifEvidence.techniqueKeywords ?? [],
      visualForms: motifEvidence.visualForms ?? [],
      videoType: motifEvidence.videoType,
      bpm: motifEvidence.bpm,
      createdAt: "2026-06-02T00:00:00.000Z"
    });
    const selection = selectEffect({ motifFamily: localSpec.motifFamily, preferGenerated: true, strictEffectCoverage: true });
    writeFileSync(path.join(caseDir, "creative-effect-spec.local.json"), `${JSON.stringify(localSpec, null, 2)}\n`, "utf8");
    writeFileSync(path.join(caseDir, "effect-selection.local.json"), `${JSON.stringify(selection, null, 2)}\n`, "utf8");

    let proposal = null;
    let pureRemotionProposal = {
      downstreamStatus: skipProposal ? "skipped" : "not_called",
      downstreamProvider: skipProposal ? "skipped" : "not_called",
      pureGeminiOutput: { status: skipProposal ? "not_called" : "not_called", error: skipProposal ? "--skip-remotion-proposal" : undefined }
    };
    if (!skipProposal) {
      console.log(`[live-codegen-eval] ${caseId}: Gemini Remotion proposal HTTP (${model})`);
      const proposalResult = await generateRemotionEffectProposal(
        {
          spec: localSpec,
          evidenceSummary: live.json.observedVisualGrammar?.summary,
          contactSheetPathMeta: { fileName: path.basename(imagePath), note: "contact sheet used for style evidence only" },
          recipeContext: expected.expectedCodegenLayers?.compositionTarget,
          productTheme: { name: "Eval target product", category: "structure-transfer-eval", cta: "Learn more" }
        },
        { env: { ...process.env, GEMINI_CODEGEN_MODEL: model } }
      );
      if (proposalResult.status === "gemini_ok" || proposalResult.status === "provider_error" || proposalResult.status === "invalid_response") {
        liveHttpCalls += 1;
      }
      const proposalDir = path.join(caseDir, "proposal");
      writeGeneratedEffectProposal(proposalResult.proposal, proposalDir);
      writeFileSync(path.join(proposalDir, "gemini-prompt.txt"), proposalResult.prompt, "utf8");
      if (proposalResult.rawResponse) writeFileSync(path.join(proposalDir, "gemini-raw-response.txt"), proposalResult.rawResponse, "utf8");
      pureRemotionProposal = {
        downstreamStatus: proposalResult.status,
        downstreamProvider: proposalResult.provider,
        model: proposalResult.model ?? null,
        promptHash: proposalResult.promptHash,
        error: proposalResult.error ?? null,
        pureGeminiOutput: proposalResult.pureGeminiOutput ?? {
          status: proposalResult.rawResponse ? "raw_received" : "not_called",
          rawResponse: proposalResult.rawResponse
        }
      };
      const validation = validateGeneratedEffect(proposalDir, { previewAttempt: false });
      writeFileSync(path.join(proposalDir, "validation-report.json"), `${JSON.stringify(validation, null, 2)}\n`, "utf8");
      proposal = {
        status: proposalResult.status,
        provider: proposalResult.provider,
        model: proposalResult.model ?? null,
        promptHash: proposalResult.promptHash,
        validationStatus: validation.validationStatus,
        safeToApply: validation.safeToApply,
        failedChecks: validation.failedChecks,
        exactErrors: validation.exactErrors
      };
      writeFileSync(path.join(caseDir, "proposal-summary.json"), `${JSON.stringify(proposal, null, 2)}\n`, "utf8");
    }

    const pureOutput = {
      schema: "pure-codegen-output.v1",
      caseId,
      model,
      layerPlan: {
        rawResponse: live.raw,
        extractedText: live.text,
        parsedJson: live.json,
        httpStatus: live.httpStatus,
        elapsedMs: live.elapsedMs
      },
      remotionProposal: pureRemotionProposal
    };
    const pureEval = evaluatePureCodegenOutput(pureOutput);
    const pureWithEval = { ...pureOutput, reportOnlyEval: pureEval };
    pureOutputs.push(pureWithEval);
    writeFileSync(path.join(caseDir, "pure-codegen-output.json"), `${JSON.stringify(pureWithEval, null, 2)}\n`, "utf8");
    writeFileSync(path.join(caseDir, "pure-codegen-output.md"), buildPureMarkdownReport({ runDir, model, cases: [pureWithEval].map((item) => ({ ...item, eval: item.reportOnlyEval })) }), "utf8");

    const evalResult = evaluateCase({
      caseId,
      expected,
      llmJson: live.json,
      localSpec,
      selection,
      validation: proposal
    });
    writeFileSync(path.join(caseDir, "eval-result.json"), `${JSON.stringify(evalResult, null, 2)}\n`, "utf8");
    cases.push({
      caseId,
      expectedMotif: expected.creativeEffectSpec?.motifFamily,
      llmMotif: live.json.creativeEffectSpec?.motifFamily ?? live.json.observedVisualGrammar?.motifFamily ?? null,
      localSpec,
      selection,
      proposal,
      eval: evalResult,
      liveHttp: { model, layerPlanHttpStatus: live.httpStatus, layerPlanElapsedMs: live.elapsedMs }
    });
  }

  const passed = cases.filter((c) => c.eval.pass).length;
  const report = {
    schema: "live-codegen-eval-report.v1",
    runDir,
    bundleDir,
    model,
    liveHttpCalls,
    total: cases.length,
    passed,
    failed: cases.length - passed,
    strict,
    cases
  };
  writeFileSync(path.join(runDir, "CODEGEN_LIVE_EVAL_REPORT.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(path.join(runDir, "CODEGEN_LIVE_EVAL_REPORT.md"), buildMarkdownReport(report), "utf8");
  const pureReport = {
    schema: "pure-codegen-output-eval-report.v1",
    reportOnly: true,
    runDir,
    bundleDir,
    model,
    total: pureOutputs.length,
    passed: pureOutputs.filter((c) => c.reportOnlyEval.pass).length,
    failed: pureOutputs.filter((c) => !c.reportOnlyEval.pass).length,
    cases: pureOutputs.map((item) => ({ ...item, eval: item.reportOnlyEval }))
  };
  writeFileSync(path.join(runDir, "PURE_CODEGEN_OUTPUT_EVAL_REPORT.json"), `${JSON.stringify(pureReport, null, 2)}\n`, "utf8");
  writeFileSync(path.join(runDir, "PURE_CODEGEN_OUTPUT_EVAL_REPORT.md"), buildPureMarkdownReport(pureReport), "utf8");
  writeFileSync(path.join(outRoot, "latest-run.txt"), `${runDir}\n`, "utf8");
  console.log(`[live-codegen-eval] ${passed}/${cases.length} PASS -> ${runDir}`);
  if (strict && passed !== cases.length) process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith("run-live-codegen-eval.mjs");
if (isMain) main().catch((error) => {
  console.error(`[live-codegen-eval] failed: ${error?.message ?? error}`);
  process.exit(1);
});
