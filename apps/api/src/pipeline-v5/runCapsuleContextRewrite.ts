// pipeline-v5/runCapsuleContextRewrite.ts
// Context-modification stage. Takes a learned RemotionTemplateCapsule (the faithful reconstruction — its
// code is canonical) + a new theme/copy, and asks a text model to rewrite ONLY the on-screen text + colour
// content for the new campaign while keeping the exact structure / layout / motion / 3D / timing. This is
// how "same template, new theme" actually changes what you see (the reconstruction hardcodes the source's
// words; prop-binding alone can't change baked text). Code-only transform; gated on compile + render.
//
// Reliability model (why the structure below): for a CHUNKED (multi-file) capsule we rewrite each chunk
// independently. A lite text model (Doubao) often fails to emit ONE chunk cleanly (truncation / bad JSON
// escaping of a large TSX string). The old code threw away the WHOLE rewrite if any single chunk failed.
// Instead we now: (1) ask for the TSX as a plain fenced code block (no fragile JSON-string escaping),
// (2) accept several output shapes when parsing, (3) retry each chunk independently, and (4) fall a chunk
// that never parses back to its ORIGINAL code rather than abandoning the chunks that did rewrite. The
// assembled bundle is still hard-gated on compile + render, so lenient parsing can never ship broken code.

import { v5 } from "@vvst/shared";
import type { Gen1ModelFn } from "./runGen1Ai.js";
import { validateTemplateCapsule } from "./validateTemplateCapsule.js";
import { mapLimit } from "./concurrency.js";

export interface ContextRewriteResult {
  codeBundle: v5.RemotionTemplateCapsule["codeBundle"];
  usedAi: boolean;
  warnings: string[];
}

export function buildContextRewritePrompt(code: string, theme: string, sellingPoints: string[], repairErrors?: string[], extraDirective?: string): string {
  const points = sellingPoints.filter(Boolean);
  const repair = repairErrors?.length ? `\n\nYour previous reply had a problem. Fix exactly and resend the WHOLE component:\n- ${repairErrors.slice(0, 6).join("\n- ")}` : "";
  const extra = extraDirective ? `\n\nIMPORTANT EXTRA DIRECTIVE (must satisfy this):\n${extraDirective}` : "";
  return `You are given a complete Remotion v4 component that renders one specific ad video. Rewrite it for a
NEW campaign.

NEW THEME: ${theme || "(general product)"}
NEW KEY POINTS / COPY (use these, rephrased into punchy on-screen ad copy in the theme's language):
${points.length ? points.map((p) => `- ${p}`).join("\n") : "- (invent concise on-brand copy for the theme)"}

Rewrite RULES:
- Replace EVERY readable on-screen word (headlines, captions, CTAs, kinetic text, canvas fillText/strokeText,
  3D text, SVG <text>) with NEW copy that fits the new theme + key points. Nothing from the original ad's
  wording may remain.
- You MAY retheme colours (background, accents, text) to fit the new theme. Always keep STRONG contrast
  between text and its background (never render text in a colour close to its background colour).
- KEEP EVERYTHING ELSE IDENTICAL: component structure, layout, every Sequence, all animation/motion/3D,
  transitions, timing, image/video layers, fonts behaviour. Only CONTENT (words + colours) changes.
- Keep the EXACT SAME exported component name and signature as the original file (do NOT rename the export,
  do NOT add or remove exports — this file may be imported by a parent that renders it).
- Do NOT add any platform watermark / handle / follow-card. Do NOT use forbidden tokens (require/process/
  fs/eval/fetch/XMLHttpRequest/dynamic import) or remote http(s) URLs.

OUTPUT FORMAT — return the COMPLETE rewritten module as ONE fenced TypeScript-React code block and NOTHING
else (no prose before or after, no explanation, no JSON). Do NOT include any other code block, markdown
example, or commented-out triple-backtick fence inside the module — emit exactly one \`\`\`tsx ... \`\`\` block:
\`\`\`tsx
// ...the full .tsx module here, same export name/signature as the original...
\`\`\`

COMPONENT TO REWRITE:
\`\`\`tsx
${code.slice(0, 16000)}
\`\`\`${repair}${extra}`;
}

const MIN_MODULE_LEN = 24; // a bare `export const X = () => null;` is ~28 chars — don't reject tiny-but-valid chunks.

/** The name of the first exported function/const/class in a module, or null. Used to verify a rewrite kept the same export. */
export function firstExportName(code: string): string | null {
  const m = code.match(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/);
  return m?.[1] ?? null;
}

/**
 * Extract the rewritten TSX module from a model reply, tolerant of how a lite model actually answers.
 * Order of preference: (1) a fenced code block (tsx/ts/typescript/jsx/js/javascript — case-insensitive — or
 * any fence whose body looks like a module; among several blocks the LONGEST module-looking one wins, so an
 * inline example block can't shadow the real component), (2) the legacy {componentName, indexTsx} JSON shape
 * (we only ever need indexTsx — componentName is ignored downstream), (3) a bare module body. Returns null if
 * nothing component-shaped is found, or — when `expectExport` is given — if the rewrite renamed the export
 * (the parent imports it by name; a rename would only fail later at render, so reject early for a cleaner retry).
 * The caller hard-gates the result on compile + render, so over-accepting here is safe.
 */
export function extractRewrittenTsx(raw: string, expectExport?: string | null): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  // A rewritten module must export the component — the single reliable structural signal (compile gate checks the rest).
  const looksLikeModule = (s: string) => /export\s+(default\s+)?(?:async\s+)?(function|const|let|var|class)\b/.test(s);
  const accept = (s: string): string | null => {
    const body = s.trim();
    if (body.length < MIN_MODULE_LEN || !looksLikeModule(body)) return null;
    if (expectExport) {
      const got = firstExportName(body);
      if (got && got !== expectExport) return null; // renamed export — reject so the chunk retries / keeps original
    }
    return body;
  };

  // (1) Collect ALL fenced blocks (any language tag) and pick the longest one that looks like a module. This
  // tolerates dialect tags (```typescript), a leading example block, and prose around the real component.
  const candidates: string[] = [];
  const fenceRe = /```[^\n`]*\n([\s\S]*?)```/g;
  let fm: RegExpExecArray | null;
  while ((fm = fenceRe.exec(raw))) if (fm[1]) candidates.push(fm[1]);
  const moduleBlocks = candidates.filter((c) => looksLikeModule(c)).sort((a, b) => b.length - a.length);
  for (const block of moduleBlocks) {
    const ok = accept(block);
    if (ok) return ok;
  }

  // (2) Legacy JSON shape { componentName, indexTsx } — possibly wrapped in a ```json fence.
  try {
    const jsonFence = raw.match(/```json\s*([\s\S]*?)```/i);
    const jsonBody = jsonFence ? jsonFence[1] : raw;
    const s = jsonBody.indexOf("{");
    const e = jsonBody.lastIndexOf("}");
    if (s >= 0 && e > s) {
      const obj = JSON.parse(jsonBody.slice(s, e + 1)) as { indexTsx?: unknown };
      if (typeof obj.indexTsx === "string") {
        const ok = accept(obj.indexTsx);
        if (ok) return ok;
      }
    }
  } catch {
    /* not JSON — keep trying */
  }

  // (3) Bare module body (no usable fence): strip leading prose, preferring the first EXPORT (not an example const).
  if (looksLikeModule(raw)) {
    const exportIdx = raw.search(/^\s*export\s+/m);
    const anyIdx = raw.search(/^\s*(import |const |function |class )/m);
    const idx = exportIdx >= 0 ? exportIdx : anyIdx;
    const ok = accept(idx >= 0 ? raw.slice(idx) : raw);
    if (ok) return ok;
  }
  return null;
}

const PARSE_REPAIR_HINT = "Your previous reply was not a single ```tsx fenced code block — reply with ONLY the complete component inside one ```tsx ... ``` block, keeping the SAME export name, no prose, no JSON, no extra code blocks.";

/** Readable on-screen strings baked into the ORIGINAL ad code (CJK runs + ALL-CAPS latin phrases), comments
 *  stripped. Used to VERIFY a rewrite actually replaced the source's words instead of echoing them back — a
 *  rewrite that compiles+renders but still carries the source headlines is NOT a real theme transfer. */
export function sourceReadableStrings(code: string): string[] {
  const noComments = code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const set = new Set<string>();
  for (const m of noComments.matchAll(/[一-鿿]{2,}/g)) set.add(m[0]);
  for (const m of noComments.matchAll(/\b[A-Z][A-Z0-9]{2,}(?:\s+[A-Z0-9]{2,})*\b/g)) set.add(m[0]);
  return [...set].filter((s) => s.length >= 2);
}

export async function runCapsuleContextRewrite(input: {
  capsule: v5.RemotionTemplateCapsule;
  theme: string;
  sellingPoints: string[];
  model: Gen1ModelFn;
  /** Optional second model tried when `model` (e.g. a lite Doubao) can't produce a usable rewrite — typically
   *  Gemini, which is far more reliable at faithfully re-theming a whole single-file capsule. */
  fallbackModel?: Gen1ModelFn | null;
  renderProbe: (codeBundle: v5.RemotionTemplateCapsule["codeBundle"], neutralFixture: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; warnings?: string[] }>;
  maxAttempts?: number;
  /** Extra hard requirement injected into the prompt (e.g. a colour-fidelity correction or creative-knob directive). */
  extraDirective?: string;
}): Promise<ContextRewriteResult> {
  const warnings: string[] = [];
  const original = input.capsule.codeBundle;
  // Files whose on-screen text we re-theme: for a stitched multi-file (chunked) capsule the text lives in
  // the chunk modules, NOT the structural parent entry; for a single-file capsule it's the entry itself.
  const isMulti = original.files.length > 1;
  const targets = (isMulti ? original.files.filter((f) => f.path !== original.entryFile) : original.files.filter((f) => f.path === original.entryFile))
    .filter((f) => typeof f.content === "string" && f.content.length);
  if (!targets.length) return { codeBundle: original, usedAi: false, warnings: ["no text-bearing code to rewrite"] };
  const fixture = (input.capsule.fixtures?.neutralFixture ?? {}) as Record<string, unknown>;
  const maxAttempts = Math.max(1, input.maxAttempts ?? 2);
  const concurrency = Number(process.env.REWRITE_CONCURRENCY ?? 4);

  // One model call for one file, retrying that file independently up to `attempts` times. A parse failure
  // feeds a format-repair hint; on final failure returns content:null so the caller keeps the ORIGINAL chunk.
  // Try the primary model first, then (if it can't produce a usable, actually-rethemed rewrite) the fallback
  // model — each for `attempts` tries. A rewrite is rejected (and retried with a pointed directive) when it
  // still carries >=half of the source's on-screen words, so "applied" really means the theme was transferred.
  const models = [input.model, input.fallbackModel].filter((m): m is Gen1ModelFn => Boolean(m));
  const rewriteOneFile = async (f: { path: string; content: string }, attempts: number, seedErrors?: string[]): Promise<{ path: string; content: string | null; error?: string }> => {
    let lastErrors = seedErrors;
    const expectExport = firstExportName(f.content);
    const sourceWords = sourceReadableStrings(f.content);
    const residualLimit = Math.ceil(sourceWords.length * 0.5);
    for (const model of models) {
      for (let a = 0; a < attempts; a++) {
        try {
          const raw = await model(buildContextRewritePrompt(f.content, input.theme, input.sellingPoints, lastErrors, input.extraDirective));
          const tsx = extractRewrittenTsx(raw, expectExport);
          if (tsx) {
            const survived = sourceWords.filter((w) => tsx.includes(w));
            if (sourceWords.length >= 2 && survived.length >= residualLimit) {
              lastErrors = [`Your rewrite STILL contains the original ad's words — replace EVERY one with new ${input.theme || "theme"} copy, none may remain: ${survived.slice(0, 10).join(" / ")}`];
              continue;
            }
            return { path: f.path, content: tsx };
          }
          lastErrors = [PARSE_REPAIR_HINT + (expectExport ? ` The exported symbol MUST stay named "${expectExport}".` : "")];
        } catch (err) {
          lastErrors = [`model error: ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`];
        }
      }
    }
    return { path: f.path, content: null, error: lastErrors?.[0] ?? `rewrite failed (${f.path})` };
  };

  const assemble = (rewritten: Map<string, string>): v5.RemotionTemplateCapsule["codeBundle"] => ({
    files: original.files.map((f) => (rewritten.has(f.path) ? { ...f, content: rewritten.get(f.path) as string } : f)),
    entryFile: original.entryFile,
    componentName: original.componentName
  });

  // Phase 1 — rewrite every target chunk independently (each retried on its own). Failed chunks fall back to original.
  const perFile = await mapLimit(targets, concurrency, (f) => rewriteOneFile(f, maxAttempts));
  const rewritten = new Map<string, string>();
  const fellBack: { path: string; error?: string }[] = [];
  for (const r of perFile) {
    if (r.content) rewritten.set(r.path, r.content);
    else fellBack.push({ path: r.path, error: r.error });
  }
  for (const fb of fellBack) warnings.push(`chunk ${fb.path}: ${fb.error ?? "unparseable"} -> kept original chunk code`);
  if (!rewritten.size) {
    warnings.push("context rewrite failed (no chunk produced usable output); using the original (un-rethemed) capsule code.");
    return { codeBundle: original, usedAi: false, warnings };
  }

  // Phase 2 — assemble (rewritten chunks swapped in, failed ones kept original) and hard-gate on compile.
  let candidate = assemble(rewritten);
  let gate = validateTemplateCapsule({ ...input.capsule, codeBundle: candidate });
  if (gate.gates.find((g) => g.id === "T2")?.status !== "pass") {
    // Compile failed — re-rewrite ONLY the rewritten chunks once with the compile errors as repair hints
    // (an original chunk can't be the cause: it compiled when the capsule was learned).
    const compileErrs = gate.gates.filter((g) => g.id === "T2" && g.status === "fail").map((g) => g.message);
    warnings.push(`context rewrite: assembled bundle did not compile -> repair round (${compileErrs.slice(0, 2).join("; ") || "compile error"})`);
    const repairTargets = targets.filter((t) => rewritten.has(t.path));
    const repaired = await mapLimit(repairTargets, concurrency, (f) => rewriteOneFile(f, maxAttempts, compileErrs.length ? compileErrs : ["did not compile"]));
    for (const r of repaired) if (r.content) rewritten.set(r.path, r.content);
    candidate = assemble(rewritten);
    gate = validateTemplateCapsule({ ...input.capsule, codeBundle: candidate });
    if (gate.gates.find((g) => g.id === "T2")?.status !== "pass") {
      warnings.push("context rewrite produced non-compiling code after repair; using the original (un-rethemed) capsule code.");
      return { codeBundle: original, usedAi: false, warnings };
    }
  }

  // Phase 3 — render probe (final safety net): the rethemed bundle must actually render a frame.
  const probeOnce = async (bundle: v5.RemotionTemplateCapsule["codeBundle"]): Promise<{ ok: boolean; error?: string }> => {
    try {
      return await input.renderProbe(bundle, fixture);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message.slice(0, 160) : String(err) };
    }
  };
  let probe = await probeOnce(candidate);
  if (!probe.ok) {
    // One render-failure repair round (mirrors the compile-repair round): re-rewrite the rewritten chunks with
    // the render error as a hint, then probe again before giving up. Bounded cost; restores the old retry budget.
    warnings.push(`context rewrite: render failed (${probe.error ?? "unknown"}) -> repair round`);
    const renderErrs = [`render failed: ${probe.error ?? "unknown"}`];
    const repairTargets = targets.filter((t) => rewritten.has(t.path));
    const repaired = await mapLimit(repairTargets, concurrency, (f) => rewriteOneFile(f, 1, renderErrs));
    for (const r of repaired) if (r.content) rewritten.set(r.path, r.content);
    candidate = assemble(rewritten);
    const reGate = validateTemplateCapsule({ ...input.capsule, codeBundle: candidate });
    probe = reGate.gates.find((g) => g.id === "T2")?.status === "pass" ? await probeOnce(candidate) : { ok: false, error: "repair did not compile" };
    if (!probe.ok) {
      warnings.push(`context rewrite render failed after repair (${probe.error ?? "unknown"}); using the original (un-rethemed) capsule code.`);
      return { codeBundle: original, usedAi: false, warnings };
    }
  }

  if (fellBack.length) {
    warnings.push(`context rewrite applied to ${rewritten.size}/${targets.length} chunk(s); ${fellBack.length} kept original (model output unusable for those).`);
  } else {
    warnings.push(`context rewrite applied (new theme/copy; structure kept; ${rewritten.size} file(s)).`);
  }
  return { codeBundle: candidate, usedAi: true, warnings };
}
