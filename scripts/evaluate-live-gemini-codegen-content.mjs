#!/usr/bin/env node
// Content-focused evaluation for Gemini live HTTP codegen-layer returns.
//
// This intentionally ignores local motif gates, registry selection, and strict layer-count gates.
// It compares the Gemini-returned plan content against the expected visual grammar:
// elements, layout/location, color, motion, timeline coverage, audio fallback, and copy safety.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CASES = ["marketing", "motion_graph_1", "motion_graph_2", "editing"];
const ACCEPTED_AUDIO_FALLBACK_REASONS = new Set([
  "elevenlabs_optional",
  "elevenlabs_not_configured_or_unavailable"
]);

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function maybeReadJson(file) {
  return existsSync(file) ? readJson(file) : null;
}

function ensureParentDir(file) {
  mkdirSync(path.dirname(file), { recursive: true });
}

function getDefaultRunDir() {
  const latest = path.join(ROOT, "docs/artifacts/codegen-live-eval/latest-run.txt");
  if (existsSync(latest)) {
    const runId = readFileSync(latest, "utf8").trim();
    if (runId) return path.join(ROOT, "docs/artifacts/codegen-live-eval", runId);
  }
  return path.join(ROOT, "docs/artifacts/codegen-live-eval/live-http-20260602");
}

function layers(actual) {
  return Array.isArray(actual?.codegenLayers) ? actual.codegenLayers : [];
}

function layerCounts(actual) {
  const counts = { media: 0, text: 0, motion_atom: 0, transition: 0, audio: 0, other: 0 };
  for (const layer of layers(actual)) {
    if (Object.hasOwn(counts, layer?.type)) counts[layer.type] += 1;
    else counts.other += 1;
  }
  return counts;
}

function maxEndSec(actual) {
  let max = 0;
  for (const layer of layers(actual)) {
    const start = Number(layer?.startSec ?? 0);
    const duration = Number(layer?.durationSec ?? 0);
    if (Number.isFinite(start) && Number.isFinite(duration)) {
      max = Math.max(max, start + duration);
    }
  }
  return Number(max.toFixed(2));
}

function blob(value) {
  return JSON.stringify(value ?? {}).toLowerCase();
}

function has(actual, pattern) {
  return pattern.test(blob(actual));
}

function hasLayer(actual, pattern) {
  return pattern.test(blob(layers(actual)));
}

function getLayer(actual, predicate) {
  return layers(actual).find(predicate);
}

function getLayers(actual, predicate) {
  return layers(actual).filter(predicate);
}

function getParam(layer, key) {
  return layer?.params?.[key];
}

function hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const raw = m[1];
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16)
  };
}

function isLightHex(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b >= 210;
}

function uniqueColors(value) {
  const matches = JSON.stringify(value ?? {}).match(/#[0-9a-fA-F]{6}/g) ?? [];
  return [...new Set(matches.map((c) => c.toUpperCase()))];
}

function maxNumericParam(actual, keys) {
  let max = 0;
  for (const layer of layers(actual)) {
    for (const key of keys) {
      const value = getParam(layer, key);
      if (typeof value === "number") max = Math.max(max, value);
      if (value && typeof value === "object") {
        for (const nested of Object.values(value)) {
          if (typeof nested === "number") max = Math.max(max, nested);
        }
      }
    }
  }
  return max;
}

function add(checks, id, category, severity, status, expected, actual, evidence = []) {
  checks.push({
    id,
    category,
    severity,
    status,
    expected,
    actual,
    evidence: Array.isArray(evidence) ? evidence.filter(Boolean) : [evidence].filter(Boolean)
  });
}

function passFail(condition) {
  return condition ? "pass" : "fail";
}

function passWeakFail(condition, weakCondition) {
  if (condition) return "pass";
  return weakCondition ? "weak" : "fail";
}

function acceptedAudioFallback(actual) {
  const fallback = actual?.audioFallback;
  return (
    fallback?.policy === "procedural" &&
    ACCEPTED_AUDIO_FALLBACK_REASONS.has(fallback?.providerFallbackReason)
  );
}

function safeNoCopy(actual) {
  const safety = actual?.safety ?? {};
  const forbiddenLiteral = /(douyin|抖音|fenda|watermark|author handle|小红书|xiaohongshu|platform ui)/i.test(
    JSON.stringify(layers(actual))
  );
  return (
    safety.samplePixelsAllowedInFinal === false &&
    safety.sampleAudioAllowedInFinal === false &&
    safety.platformWatermarksCopied === false &&
    safety.sampleBrandCopied === false &&
    safety.samplePathOrFilenameConditionals === false &&
    !forbiddenLiteral
  );
}

function commonChecks(caseId, actual, expectedCase, checks) {
  const duration = maxEndSec(actual);
  const expectedDuration = expectedCase?.expectedCodegenLayers?.compositionTarget?.durationSec;
  const expectedMinDuration = caseId === "editing" ? 45 : expectedDuration ? expectedDuration * 0.88 : null;

  add(
    checks,
    "gemini_return_case_id",
    "return_format",
    "minor",
    actual?.caseId === caseId ? "pass" : "weak",
    `Gemini return caseId should match requested case '${caseId}'.`,
    `returned '${actual?.caseId ?? "missing"}'`,
    actual?.caseId === caseId ? [] : ["Visual grammar may still be correct; this is a return-format issue."]
  );

  add(
    checks,
    "timeline_duration_coverage",
    "timeline",
    "critical",
    expectedMinDuration == null ? "pass" : passFail(duration >= expectedMinDuration),
    caseId === "editing"
      ? "Generated editing tutorial should compress source to roughly 45-60s while preserving repeated alternation."
      : `Returned plan should cover the expected duration around ${expectedDuration}s.`,
    `${duration}s returned layer coverage`,
    [`expected minimum used by this eval: ${expectedMinDuration ?? "n/a"}s`]
  );

  add(
    checks,
    "audio_optional_fallback",
    "audio",
    "important",
    passFail(acceptedAudioFallback(actual)),
    "ElevenLabs unavailable must not fail visual/codegen eval; procedural fallback is acceptable.",
    JSON.stringify(actual?.audioFallback ?? null),
    []
  );

  add(
    checks,
    "sample_copy_safety",
    "safety",
    "critical",
    passFail(safeNoCopy(actual)),
    "Do not copy sample pixels/audio/platform chrome/brands/filenames.",
    JSON.stringify(actual?.safety ?? null),
    []
  );
}

function evaluateMarketing(actual, expectedCase) {
  const checks = [];
  commonChecks("marketing", actual, expectedCase, checks);

  const bg = getLayer(actual, (l) => l.id === "background" || l.kind === "solid_color");
  const bgColor = getParam(bg, "color");
  const ribbon = getLayer(actual, (l) => /ribbon/i.test(`${l.id} ${l.kind}`));
  const ribbonColors = uniqueColors(ribbon);
  const year = getLayer(actual, (l) => /date|year|main/i.test(`${l.id} ${blob(l.params)}`));
  const yearPos = getParam(year, "position");
  const yearColor = getParam(year, "color") ?? getParam(year, "fontColor");
  const hasDarkEndSlate = layers(actual).some(
    (l) =>
      Number(l.startSec ?? 0) >= 14.5 &&
      (/end|slate|cta|search/i.test(`${l.id} ${l.kind} ${blob(l.params)}`) ||
        /dark|#111111|#000000|grey|gray/i.test(`${l.kind} ${blob(l.params)}`))
  );

  add(
    checks,
    "light_poster_background",
    "color",
    "critical",
    passFail(isLightHex(bgColor) || has(actual, /\blight\b|white|warm white|poster canvas/)),
    "White/light poster background for the first 80%.",
    bgColor ? `background color ${bgColor}` : "no explicit light background layer",
    [actual?.observedVisualGrammar?.summary]
  );

  add(
    checks,
    "fixed_poster_typography",
    "layout",
    "critical",
    passFail(getLayers(actual, (l) => l.type === "text").length >= 4),
    "Fixed exhibition poster hierarchy with multiple readable text blocks.",
    `${getLayers(actual, (l) => l.type === "text").length} text layers`,
    getLayers(actual, (l) => l.type === "text").map((l) => `${l.id}@${JSON.stringify(l.params?.position ?? null)}`)
  );

  add(
    checks,
    "satin_ribbon_s_curve",
    "motion",
    "critical",
    passFail(Boolean(ribbon) && /s_curve|serpentine|s-curve|satin|silk|sweep/i.test(blob(ribbon))),
    "Large 2.5D satin/silk ribbon sweeping in an S-curve.",
    ribbon ? `${ribbon.id}:${ribbon.kind}` : "missing ribbon layer",
    ribbon ? [JSON.stringify(ribbon.params)] : []
  );

  add(
    checks,
    "ribbon_color_cycle",
    "color",
    "critical",
    passFail(ribbonColors.length >= 4 || has(ribbon, /colorgradient|color keyframe|animated/)),
    "Ribbon hue should change over time: grey -> blue/purple -> pink/orange -> yellow/green/cyan.",
    `${ribbonColors.length} explicit ribbon colors`,
    ribbonColors
  );

  add(
    checks,
    "large_blue_year_lower_left",
    "layout",
    "important",
    passWeakFail(yearPos?.x <= 0.35 && yearPos?.y >= 0.65 && /#?1f4bff|blue/i.test(`${yearColor ?? ""}`), yearPos?.y >= 0.65),
    "Large blue year/number block should sit near lower-left.",
    `position=${JSON.stringify(yearPos ?? null)}, color=${yearColor ?? "missing"}`,
    year ? [year.id, JSON.stringify(year.params)] : []
  );

  add(
    checks,
    "dark_cta_end_slate",
    "structure",
    "important",
    passFail(hasDarkEndSlate),
    "Final 2-3s may enter a dark CTA/search end slate.",
    hasDarkEndSlate ? "dark/end-slate cue found" : "only fade_out found; no dark CTA/search slate layer",
    layers(actual)
      .filter((l) => Number(l.startSec ?? 0) >= 14.5)
      .map((l) => `${l.id}:${l.type}:${l.kind}`)
  );

  add(
    checks,
    "not_generic_dark_template",
    "safety",
    "critical",
    passFail(!has(actual, /generic dark template|dark tech template/)),
    "Must not degrade into a generic dark template.",
    "No generic-dark wording found in Gemini return.",
    []
  );

  return checks;
}

function evaluateMotionGraph1(actual, expectedCase) {
  const checks = [];
  commonChecks("motion_graph_1", actual, expectedCase, checks);

  const cardCount = maxNumericParam(actual, ["numCards", "cardCount"]);
  const hasStack = has(actual, /stack|cascade|shuffle/);
  const hasOrbit = has(actual, /orbit/);
  const hasScatter = has(actual, /scatter|offscreen|corner/);
  const transitionCount = getLayers(actual, (l) => l.type === "transition").length;

  add(
    checks,
    "black_red_magenta_palette",
    "color",
    "critical",
    passFail(has(actual, /#8b0000|#4b0000|#ff00ff|magenta|red background|dark red|black/)),
    "Black/red/magenta motion-graph palette.",
    uniqueColors(actual).join(", "),
    [actual?.observedVisualGrammar?.summary]
  );

  add(
    checks,
    "card_stack_orbit_scatter",
    "motion",
    "critical",
    passWeakFail(cardCount >= 8 && hasStack && hasOrbit && hasScatter, cardCount >= 8 && hasStack && hasOrbit),
    "8-12 rounded media cards should stack -> orbit -> scatter.",
    `max card count=${cardCount}, stack=${hasStack}, orbit=${hasOrbit}, scatter=${hasScatter}`,
    getLayers(actual, (l) => /card/i.test(`${l.id} ${l.kind} ${blob(l.params)}`)).map((l) => `${l.id}:${l.kind}:${JSON.stringify(l.params)}`)
  );

  add(
    checks,
    "center_white_words",
    "text",
    "important",
    passFail(getLayers(actual, (l) => l.type === "text" && /scene[12]|title/i.test(l.id)).length >= 2),
    "Short center words should reveal one by one in early card section.",
    `${getLayers(actual, (l) => l.type === "text").length} text layers total`,
    getLayers(actual, (l) => l.type === "text").slice(0, 4).map((l) => `${l.id}:${blob(l.params).slice(0, 120)}`)
  );

  add(
    checks,
    "red_title_panel",
    "structure",
    "important",
    passFail(has(actual, /#8b0000|red background|stomp|hero/)),
    "Red big-title panel section.",
    "red/hero cues in returned layers",
    []
  );

  add(
    checks,
    "feature_list_scroll",
    "motion",
    "important",
    passWeakFail(has(actual, /scrolling_list|feature list|feature_scroll/), has(actual, /scroll/)),
    "Large grey feature-list scroll.",
    "feature-list/scroll cue check",
    getLayers(actual, (l) => /scroll|feature/i.test(`${l.id} ${l.kind}`)).map((l) => `${l.id}:${l.kind}`)
  );

  add(
    checks,
    "neon_polygon_cursor_labels",
    "motion",
    "important",
    passWeakFail(has(actual, /polygon/) && has(actual, /#ff00ff|magenta|neon/ ) && has(actual, /cursor|label|sarah|will/), has(actual, /polygon/) && has(actual, /#ff00ff|magenta|neon/)),
    "Magenta neon polygon/frame with cursor labels.",
    `polygon=${has(actual, /polygon/)}, neon=${has(actual, /#ff00ff|magenta|neon/)}, cursorLabel=${has(actual, /cursor|label|sarah|will/)}`,
    getLayers(actual, (l) => /neon|shape|polygon/i.test(`${l.id} ${l.kind} ${blob(l.params)}`)).map((l) => `${l.id}:${l.kind}:${JSON.stringify(l.params)}`)
  );

  add(
    checks,
    "hero_image_huge_typography",
    "structure",
    "important",
    passFail(has(actual, /background_video|hero_3d|parallax|huge|uppercase/)),
    "Full-screen hero image with huge white typography.",
    "hero/parallax cues in returned layers",
    getLayers(actual, (l) => /hero|background_video/i.test(`${l.id} ${l.kind}`)).map((l) => `${l.id}:${l.kind}`)
  );

  add(
    checks,
    "red_tunnel_word_reveal",
    "motion",
    "important",
    passFail(has(actual, /tunnel/) && has(actual, /#4b0000|red tunnel|backgroundcolor/)),
    "Red tunnel word reveal.",
    "tunnel and dark-red background cues found",
    getLayers(actual, (l) => /tunnel/i.test(`${l.id} ${l.kind}`)).map((l) => `${l.id}:${JSON.stringify(l.params)}`)
  );

  add(
    checks,
    "logo_end_slate",
    "structure",
    "important",
    passFail(has(actual, /logo/) && has(actual, /#ffffff|white background|end slate/)),
    "White/grey logo end slate separate from card section.",
    "logo and white/end cues",
    getLayers(actual, (l) => /logo|scene8/i.test(`${l.id} ${l.kind}`)).map((l) => `${l.id}:${l.kind}:${JSON.stringify(l.params)}`)
  );

  add(
    checks,
    "explicit_card_and_red_wipe_transitions",
    "motion",
    "important",
    passWeakFail(transitionCount >= 2 || has(actual, /card_scatter_transition|red_section_wipe/), has(actual, /hard cut|major shift|transition/)),
    "Card scatter transition and red section wipe should be explicitly represented.",
    `${transitionCount} transition layers`,
    actual?.observedVisualGrammar?.timeline?.map((t) => t.description) ?? []
  );

  return checks;
}

function evaluateMotionGraph2(actual, expectedCase) {
  const checks = [];
  commonChecks("motion_graph_2", actual, expectedCase, checks);

  const gridAssets = getLayer(actual, (l) => l.id === "ui_grid_assembly")?.params?.assets?.length ?? 0;

  add(
    checks,
    "black_blue_spotlight_palette",
    "color",
    "critical",
    passFail(has(actual, /blue|spotlight|#0b5cff|#3ea7ff|black|dark/)),
    "Black/blue SaaS pitch palette with soft spotlight.",
    uniqueColors(actual).join(", "),
    [actual?.observedVisualGrammar?.summary]
  );

  add(
    checks,
    "search_bar_typewriter",
    "motion",
    "critical",
    passFail(has(actual, /search_prompt_typewriter|typewriter|search_bar/)),
    "Prompt/search bar typewriter should appear.",
    "search/typewriter cue check",
    getLayers(actual, (l) => /search|typewriter/i.test(`${l.id} ${l.kind} ${blob(l.params)}`)).map((l) => `${l.id}:${l.kind}:${JSON.stringify(l.params)}`)
  );

  add(
    checks,
    "floating_ui_dashboard_payment_panels",
    "structure",
    "critical",
    passWeakFail(
      has(actual, /dashboard/) && has(actual, /payment|checkout/) && has(actual, /panel|ui|grid/),
      has(actual, /dashboard|product cards|authentication|ui components|grid|product_screenshot/)
    ),
    "Floating dashboard/search/payment/product panels.",
    `dashboard=${has(actual, /dashboard/)}, paymentOrCheckout=${has(actual, /payment|checkout/)}, uiPanel=${has(actual, /panel|ui|grid|product_screenshot/)}`,
    [actual?.observedVisualGrammar?.summary]
  );

  add(
    checks,
    "blue_orb_light_sweep_transition",
    "motion",
    "important",
    passWeakFail(has(actual, /orb|arrow/) && has(actual, /spotlight_sweep|light sweep|bloom/), has(actual, /spotlight_sweep|animated_blue_spotlight|light sweep|bloom/)),
    "Blue orb/light sweep transition with bloom.",
    `orb=${has(actual, /orb|arrow/)}, sweep=${has(actual, /spotlight_sweep|light sweep|bloom/)}`,
    getLayers(actual, (l) => /transition|spotlight|sweep/i.test(`${l.id} ${l.kind} ${blob(l.params)}`)).map((l) => `${l.id}:${l.kind}:${JSON.stringify(l.params)}`)
  );

  add(
    checks,
    "website_hero_mockup",
    "structure",
    "important",
    passWeakFail(has(actual, /full-screen ui mockup|website hero|product_screenshot|ui_showcase/), has(actual, /mockup|screenshot|ui_showcase/)),
    "Website hero mockup/product screen.",
    "website/mockup cue check",
    getLayers(actual, (l) => /ui_showcase|screenshot|mockup/i.test(`${l.id} ${l.kind} ${blob(l.params)}`)).map((l) => `${l.id}:${l.kind}`)
  );

  add(
    checks,
    "ui_grid_collage",
    "structure",
    "important",
    passWeakFail(gridAssets >= 6, gridAssets >= 4 || has(actual, /grid collage|ui_grid|grid_layout/)),
    "UI grid collage with several panels, ideally 6-9.",
    `${gridAssets} explicit grid assets`,
    getLayers(actual, (l) => /grid/i.test(`${l.id} ${l.kind} ${blob(l.params)}`)).map((l) => `${l.id}:${l.kind}:${JSON.stringify(l.params)}`)
  );

  add(
    checks,
    "sequential_pitch_text",
    "text",
    "important",
    passWeakFail(getLayers(actual, (l) => l.type === "text").length >= 5 && has(actual, /sequential|closing|pitch/), getLayers(actual, (l) => l.type === "text").length >= 4),
    "Sequential pitch text should continue across hook, features, and closing.",
    `${getLayers(actual, (l) => l.type === "text").length} text layers`,
    getLayers(actual, (l) => l.type === "text").map((l) => `${l.id}:${l.startSec}-${Number(l.startSec ?? 0) + Number(l.durationSec ?? 0)}`)
  );

  add(
    checks,
    "blue_logo_end_slate",
    "structure",
    "important",
    passFail(has(actual, /logo_reveal|logo/) && has(actual, /glow|blue|spotlight/)),
    "Blue logo end slate.",
    "logo/glow/blue cue check",
    getLayers(actual, (l) => /logo/i.test(`${l.id} ${l.kind} ${blob(l.params)}`)).map((l) => `${l.id}:${l.kind}:${JSON.stringify(l.params)}`)
  );

  add(
    checks,
    "not_red_card_orbit_template",
    "safety",
    "critical",
    passFail(!hasLayer(actual, /card_orbit|red tunnel|#8b0000|#4b0000/)),
    "Must not reuse motion_graph_1 red card-orbit template.",
    hasLayer(actual, /card_orbit|red tunnel|#8b0000|#4b0000/)
      ? "red-card-orbit/tunnel cue found in codegen layers"
      : "No red-card-orbit/tunnel cues found in codegen layers.",
    []
  );

  return checks;
}

function evaluateEditing(actual, expectedCase) {
  const checks = [];
  commonChecks("editing", actual, expectedCase, checks);

  const blackCardCount = getLayers(actual, (l) => /solid_color/i.test(l.kind) && /#000000|black/i.test(blob(l.params))).length;
  const mediaCount = getLayers(actual, (l) => l.type === "media").length;
  const titleTextCount = getLayers(actual, (l) => l.type === "text" && /kinetic|title/i.test(`${l.kind} ${l.id}`)).length;

  add(
    checks,
    "chinese_kinetic_tutorial",
    "text",
    "critical",
    passWeakFail(has(actual, /chinese|中文|heavy chinese|kinetic/), titleTextCount >= 2),
    "Chinese kinetic tutorial text should be primary, not ordinary English subtitles.",
    `${titleTextCount} kinetic/title text layers`,
    [actual?.observedVisualGrammar?.summary]
  );

  add(
    checks,
    "black_cards_alternate_with_clips",
    "structure",
    "critical",
    passFail(blackCardCount >= 2 && mediaCount >= 2),
    "Black teaching cards should alternate with target/example clips.",
    `black cards=${blackCardCount}, media clips=${mediaCount}`,
    layers(actual).map((l) => `${l.startSec}-${Number(l.startSec ?? 0) + Number(l.durationSec ?? 0)} ${l.id}:${l.type}:${l.kind}`)
  );

  add(
    checks,
    "red_yellow_white_gray_big_type",
    "color",
    "critical",
    passWeakFail(has(actual, /#ff0000|red/) && has(actual, /#ffff00|#ffd400|yellow/) && has(actual, /#ffffff|white/), has(actual, /#ff0000|red/) && has(actual, /#ffff00|#ffd400|yellow|#ffffff|white/)),
    "Large red/yellow/white/grey block typography.",
    uniqueColors(actual).join(", "),
    getLayers(actual, (l) => l.type === "text").map((l) => `${l.id}:${JSON.stringify(l.params)}`)
  );

  add(
    checks,
    "hard_beat_cuts_flash_glitch",
    "motion",
    "critical",
    passWeakFail(has(actual, /beat|hard cut|flash|glitch/) && getLayers(actual, (l) => l.type === "transition").length >= 1, has(actual, /beat|flash|glitch/)),
    "Hard beat cuts with impact flash/glitch.",
    `${getLayers(actual, (l) => l.type === "transition").length} transition layers`,
    getLayers(actual, (l) => /transition|flash|glitch|beat/i.test(`${l.id} ${l.kind} ${blob(l.params)}`)).map((l) => `${l.id}:${l.type}:${l.kind}:${JSON.stringify(l.params)}`)
  );

  add(
    checks,
    "whip_cut_impact",
    "motion",
    "important",
    passFail(hasLayer(actual, /whip|impact/)),
    "Whip cut / impact transition layer should be represented.",
    hasLayer(actual, /whip|impact/) ? "whip/impact cue found in codegen layers" : "No whip/impact cue in returned layer params.",
    []
  );

  add(
    checks,
    "slash_title_bars",
    "layout",
    "important",
    passFail(has(actual, /slash|title bar|diagonal|bar_pop/)),
    "Slash/title bars should pop over black cards or clips.",
    "No slash/title-bar cue found.",
    []
  );

  add(
    checks,
    "lower_left_teaching_subtitles",
    "layout",
    "important",
    passFail(has(actual, /lower-left|lower left|subtitle|teaching subtitle/)),
    "Lower-left teaching subtitles/annotations should appear.",
    "No lower-left subtitle cue found.",
    []
  );

  add(
    checks,
    "does_not_copy_platform_or_movie",
    "safety",
    "critical",
    passFail(!hasLayer(actual, /douyin|抖音|fenda|movie frames|author handle|watermark/)),
    "Do not copy Douyin UI, author handle, FENDA watermark, or movie frames.",
    hasLayer(actual, /douyin|抖音|fenda|movie frames|author handle|watermark/)
      ? "forbidden platform/movie literal found in returned layers"
      : "No forbidden platform/movie literals found in returned layers.",
    []
  );

  return checks;
}

function evaluateCase(caseId, actual, expectedCase) {
  const checks =
    caseId === "marketing"
      ? evaluateMarketing(actual, expectedCase)
      : caseId === "motion_graph_1"
        ? evaluateMotionGraph1(actual, expectedCase)
        : caseId === "motion_graph_2"
          ? evaluateMotionGraph2(actual, expectedCase)
          : evaluateEditing(actual, expectedCase);

  const judged = checks.filter((c) => c.severity !== "minor");
  const criticalFails = judged.filter((c) => c.severity === "critical" && c.status === "fail");
  const criticalWeaks = judged.filter((c) => c.severity === "critical" && c.status === "weak");
  const importantFails = judged.filter((c) => c.severity === "important" && c.status === "fail");
  const importantWeaks = judged.filter((c) => c.severity === "important" && c.status === "weak");
  const passCount = judged.filter((c) => c.status === "pass").length;
  const score = judged.length ? Number((passCount / judged.length).toFixed(2)) : 0;
  const result =
    criticalFails.length > 0
      ? "fail"
      : criticalWeaks.length > 0 || importantFails.length > 0 || importantWeaks.length >= 2
        ? "weak"
        : "pass";

  return {
    caseId,
    result,
    score,
    requestedVsReturnedCaseId: actual?.caseId ?? null,
    returnedDurationSec: maxEndSec(actual),
    layerCounts: layerCounts(actual),
    observedSummary: actual?.observedVisualGrammar?.summary ?? "",
    notJudged: {
      motifFamily: actual?.observedVisualGrammar?.motifFamily ?? null,
      effectProgramIds: actual?.effectSelection?.effectProgramIds ?? [],
      note: "Motif/gate/effect-registry selection is recorded for context only and is not part of this content verdict."
    },
    checks
  };
}

function statusCn(status) {
  if (status === "pass") return "通过";
  if (status === "weak") return "偏弱";
  return "失败";
}

function resultCn(result) {
  if (result === "pass") return "PASS";
  if (result === "weak") return "WEAK";
  return "FAIL";
}

function summarizeIssues(caseResult) {
  return caseResult.checks
    .filter((c) => c.severity !== "minor" && c.status !== "pass")
    .map((c) => `${c.id}: ${c.actual}`)
    .slice(0, 4)
    .join("; ");
}

function renderMarkdown({ runDir, bundlePath, liveReport, results }) {
  const liveCalls = liveReport?.liveHttpCalls ?? "unknown";
  const model = liveReport?.model ?? "unknown";
  const pass = results.filter((r) => r.result === "pass").length;
  const weak = results.filter((r) => r.result === "weak").length;
  const fail = results.filter((r) => r.result === "fail").length;

  const lines = [];
  lines.push("# Gemini Codegen Content Eval Report");
  lines.push("");
  lines.push(`- Run dir: \`${runDir}\``);
  lines.push(`- Expected bundle: \`${bundlePath}\``);
  lines.push(`- Gemini model: \`${model}\``);
  lines.push(`- Live HTTP calls from run: \`${liveCalls}\``);
  lines.push("- Verdict scope: direct Gemini returned layer plans only.");
  lines.push("- Ignored for pass/fail: local motif gates, EffectRegistry selection, strict minimum layer counts, exact JSON format differences.");
  lines.push("- ElevenLabs policy: optional; procedural audio fallback is accepted.");
  lines.push(`- Result summary: PASS=${pass}, WEAK=${weak}, FAIL=${fail}`);
  lines.push("");
  lines.push("## Case Summary");
  lines.push("");
  lines.push("| Case | Verdict | Score | Returned duration | Layer counts | Main gaps |");
  lines.push("| --- | --- | ---: | ---: | --- | --- |");
  for (const result of results) {
    lines.push(
      `| ${result.caseId} | ${resultCn(result.result)} | ${result.score} | ${result.returnedDurationSec}s | ${JSON.stringify(
        result.layerCounts
      )} | ${summarizeIssues(result).replace(/\|/g, "/") || "none"} |`
    );
  }

  lines.push("");
  lines.push("## Details");
  for (const result of results) {
    lines.push("");
    lines.push(`### ${result.caseId} - ${resultCn(result.result)}`);
    lines.push("");
    lines.push(`Returned caseId: \`${result.requestedVsReturnedCaseId}\``);
    lines.push(`Returned summary: ${result.observedSummary}`);
    lines.push("");
    lines.push("| Status | Category | Severity | Check | Actual |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const check of result.checks) {
      lines.push(
        `| ${statusCn(check.status)} | ${check.category} | ${check.severity} | ${check.expected.replace(/\|/g, "/")} | ${check.actual
          .replace(/\n/g, " ")
          .replace(/\|/g, "/")} |`
      );
    }
  }

  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- `WEAK` means the core structure is recognizably there, but important content details are missing, underspecified, or placed incorrectly.");
  lines.push("- `FAIL` means at least one critical content requirement is missing, such as timeline coverage or core visual grammar.");
  lines.push("- This report records motif/effect ids only in JSON context; it does not use them to pass/fail a case.");
  return `${lines.join("\n")}\n`;
}

const runDir = path.resolve(arg("--run-dir", getDefaultRunDir()));
const bundlePath = path.resolve(arg("--bundle", path.join(ROOT, "expected_codegen_eval_bundle", "expected_codegen_layers_eval.json")));
const outMd = path.resolve(arg("--out-md", path.join(runDir, "CODEGEN_GEMINI_CONTENT_EVAL_REPORT.md")));
const outJson = path.resolve(arg("--out-json", path.join(runDir, "CODEGEN_GEMINI_CONTENT_EVAL_REPORT.json")));
const expectedRoot = readJson(bundlePath);
const expectedCases = expectedRoot.cases ?? expectedRoot;
const liveReport = maybeReadJson(path.join(runDir, "CODEGEN_LIVE_EVAL_REPORT.json"));

const results = [];
for (const caseId of CASES) {
  const actualPath = path.join(runDir, caseId, "actual-codegen-layers.json");
  if (!existsSync(actualPath)) {
    throw new Error(`Missing Gemini return file: ${actualPath}`);
  }
  const actual = readJson(actualPath);
  results.push(evaluateCase(caseId, actual, expectedCases[caseId]));
}

const report = {
  generatedAt: new Date().toISOString(),
  runDir,
  bundlePath,
  scope: {
    judged: "Gemini live HTTP returned codegen layer content",
    ignoredForVerdict: ["local motif gate", "EffectRegistry gate", "strict layer-count gate", "exact return format differences"],
    elevenLabsPolicy: "optional_procedural_audio_fallback_accepted"
  },
  liveHttp: {
    model: liveReport?.model ?? null,
    liveHttpCalls: liveReport?.liveHttpCalls ?? null
  },
  results
};

const markdown = renderMarkdown({ runDir, bundlePath, liveReport, results });
ensureParentDir(outJson);
ensureParentDir(outMd);
writeFileSync(outJson, JSON.stringify(report, null, 2));
writeFileSync(outMd, markdown);

if (outMd !== path.join(runDir, "CODEGEN_GEMINI_CONTENT_EVAL_REPORT.md")) {
  writeFileSync(path.join(runDir, "CODEGEN_GEMINI_CONTENT_EVAL_REPORT.md"), markdown);
}
if (outJson !== path.join(runDir, "CODEGEN_GEMINI_CONTENT_EVAL_REPORT.json")) {
  writeFileSync(path.join(runDir, "CODEGEN_GEMINI_CONTENT_EVAL_REPORT.json"), JSON.stringify(report, null, 2));
}

console.log(`Wrote ${outMd}`);
