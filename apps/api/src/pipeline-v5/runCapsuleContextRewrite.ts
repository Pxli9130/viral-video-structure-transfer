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
  /** True if ANY target chunk could NOT be cleanly rewritten by the LLM (fell back to a targeted text-swap or
   *  kept the original). The caller uses this to decide whether the deterministic layout safety net (de-overlap)
   *  is needed: in LLM-primary mode a fully-clean rewrite is trusted and the hard rules are skipped. */
  hadFallback: boolean;
}

export function buildContextRewritePrompt(code: string, theme: string, sellingPoints: string[], repairErrors?: string[], extraDirective?: string, customNL?: string): string {
  const points = sellingPoints.filter(Boolean);
  const repair = repairErrors?.length ? `\n\nYour previous reply had a problem. Fix exactly and resend the WHOLE component:\n- ${repairErrors.slice(0, 6).join("\n- ")}` : "";
  const extra = extraDirective ? `\n\nIMPORTANT EXTRA DIRECTIVE (must satisfy this):\n${extraDirective}` : "";
  // The user's freeform instruction is the HIGHEST-priority directive — the LLM should modify the code to
  // satisfy it (it overrides the generic rules where they conflict, e.g. "字幕更少" / "把卖点提前" / "清掉残留英文").
  const userReq = customNL && customNL.trim()
    ? `\n\n========== USER REQUIREMENT (HIGHEST PRIORITY — satisfy this exactly, it overrides the generic rules where they conflict) ==========\n${customNL.trim()}\n========== end user requirement ==========`
    : "";
  return `You are given a complete Remotion v4 component that renders one specific ad video. Rewrite it for a
NEW campaign.

NEW THEME: ${theme || "(general product)"}
NEW KEY POINTS / COPY (use these, rephrased into punchy on-screen ad copy in the theme's language):
${points.length ? points.map((p) => `- ${p}`).join("\n") : "- (invent concise on-brand copy for the theme)"}

Rewrite RULES:
- Replace EVERY readable on-screen word (headlines, captions, CTAs, kinetic text, canvas fillText/strokeText,
  3D text, SVG <text>) with NEW copy that fits the new theme + key points. Nothing from the original ad's
  wording may remain.
- FIT THE FRAME (9:16 portrait): the big animated HEADLINE must stay SHORT — at most ~6 Chinese characters or
  ~14 latin characters — so it renders on ONE line WITHOUT overflowing the screen width. If a large headline
  text node has no width-fit/wrap style, ALSO add maxWidth 92% + word-wrap and reduce its fontSize so it never
  gets clipped at the edges. Keep secondary captions short too.
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
\`\`\`${repair}${extra}${userReq}`;
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

/**
 * TARGETED fallback for a chunk whose FULL rewrite failed (a large chunk makes a lite model truncate/garble the
 * whole-module reply → unparseable → the chunk would otherwise keep the SOURCE's baked words, e.g. hardcoded
 * sneaker product titles "NMD R1 Speed"). Instead of re-emitting the whole module, ask ONLY for a small
 * {original->replacement} map for the readable source strings (tiny output = reliable, no truncation), then
 * DETERMINISTICALLY swap those string literals / JSX text in the code. Returns the re-texted code or null.
 */
/** Human-readable DISPLAY string literals in the code (headlines, captions, product names like "NMD R1 Speed",
 *  prices like "$180", CJK) — excludes css values, paths/urls, and bare code identifiers. Broader than
 *  sourceReadableStrings (which is CJK + ALL-CAPS only) so it also catches mixed-case product titles. */
export function displayStrings(code: string): string[] {
  const noComments = code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const set = new Set<string>();
  // Only ' and " delimiters — NOT backtick. A template literal `a${x}b` next to another one makes a naive
  // backtick-pair span the CODE between them (e.g. `, color: textCol, … textShadow:`), which the sweep would
  // then splice into and corrupt → the whole rewrite gets reverted. Dynamic backtick text can't be swapped anyway.
  for (const m of noComments.matchAll(/(['"])((?:\\.|(?!\1)[^\\]){2,64})\1/g)) {
    const s = m[2];
    if (!/[A-Za-z一-鿿]/.test(s)) continue;                                            // must contain a letter / CJK
    if (/[<>{}=]/.test(s)) continue;                                                   // JSX / SVG-attribute fragment, not display text
    if (/[`]|\$\{|^\s*,|[A-Za-z-]\s*:\s*['"]/.test(s)) continue;                       // mis-captured CODE (style object / between-literals span), not display text
    if (/^[./]|\/\/|\\|\.(tsx?|jsx?|png|jpe?g|mp4|mov|svg|css|woff2?)\b|^https?:/i.test(s)) continue;   // real paths / files / urls (keeps "$100k/mo", "24/7")
    if (/(?:^|[^a-z])(?:px|em|rem|vh|vw|deg|fr)\b|%|rgba?\(|hsla?\(|#[0-9a-fA-F]{3,8}\b|linear-gradient|solid|dashed|center|space-between|flex-|absolute|relative|sticky|hidden|cover|contain|sans-serif|monospace|inherit|translate|rotate|scale|ease|cubic-bezier|bold|italic|uppercase|lowercase|pointer/i.test(s)) continue; // css-ish
    if (/^[a-z][a-zA-Z0-9_]*$/.test(s)) continue;                                              // single camelCase identifier (prop key)
    if (/\s/.test(s) || /[一-鿿]/.test(s) || /^\$?\d/.test(s) || /^[A-Z][A-Za-z0-9]/.test(s)) set.add(s.trim()); // display-like
  }
  return [...set].filter((s) => s.length >= 2);
}

export async function retextChunk(code: string, theme: string, sellingPoints: string[], models: Gen1ModelFn[]): Promise<string | null> {
  const words = displayStrings(code).slice(0, 40);
  if (!words.length) return null;
  const prompt =
    `You are re-theming an ad video to a NEW product. Below is a JSON array of the ORIGINAL on-screen text ` +
    `strings (headlines, captions, product names, prices). For the NEW theme "${theme || "the product"}"` +
    `${sellingPoints.filter(Boolean).length ? ` (key selling points: ${sellingPoints.filter(Boolean).join(", ")})` : ""}, ` +
    `give a SHORT, punchy replacement for EACH string IN THE THEME'S LANGUAGE — big headlines <= 6 Chinese / 14 latin ` +
    `chars; keep numbers/prices realistic for the NEW product; NOTHING from the original product may remain. ` +
    `Return ONLY a JSON object mapping each original string to its replacement, no prose:\n${JSON.stringify(words)}`;
  for (const model of models) {
    let raw: string;
    try { raw = await model(prompt); } catch { continue; }
    let map: Record<string, unknown>;
    try {
      const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
      if (s < 0 || e <= s) continue;
      map = JSON.parse(raw.slice(s, e + 1)) as Record<string, unknown>;
    } catch { continue; }
    let out = code, changed = 0;
    // Replace longest-first so a substring word doesn't partially clobber a longer one.
    for (const w of [...words].sort((a, b) => b.length - a.length)) {
      const repl = map[w];
      if (typeof repl !== "string" || !repl.trim() || repl === w) continue;
      const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const quoted = new RegExp(`(['"\`])${esc}\\1`, "g");
      const before = out;
      out = out.replace(quoted, (_m, q) => `${q}${repl}${q}`);        // string literals
      if (out === before) out = out.split(w).join(repl);              // bare JSX text fallback
      if (out !== before) changed++;
    }
    if (changed) return out;
  }
  return null;
}

/** JSX text nodes (`>Layout.dev<`, `>$100k/mo<`) — display text that lives BETWEEN tags, not in a quoted
 *  literal, so displayStrings (quoted-only) misses it. These are exactly the brand/metric leftovers a
 *  succeeded-but-unchanged rewrite keeps. */
export function jsxTextNodes(code: string): string[] {
  const noComments = code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const set = new Set<string>();
  for (const m of noComments.matchAll(/>([^<>{}\n]{2,50})</g)) {
    const s = m[1].trim();
    if (!/[A-Za-z一-鿿]/.test(s)) continue;                                  // must read as text
    if (/[=]/.test(s) || /^https?:/i.test(s)) continue;
    if (/\.(tsx?|jsx?|png|jpe?g|mp4|mov|svg|css|woff2?)\b/i.test(s)) continue;
    if (/^[a-z][a-zA-Z0-9_]*$/.test(s)) continue;                            // bare identifier
    set.add(s);
  }
  // Display-prop ATTRIBUTE values (`text="$100k/mo"`, `label="built"`, `title="…"`) — display copy passed to a
  // component, missed by both the >text< node scan and the quoted-literal scan's css/path filters.
  for (const m of noComments.matchAll(/\b(?:text|label|title|caption|heading|headline|subtitle|placeholder)\s*=\s*(['"])((?:\\.|(?!\1)[^\\]){2,50})\1/g)) {
    const s = m[2].trim();
    if (/[一-鿿]/.test(s) || /[A-Za-z]/.test(s) || /\d/.test(s)) set.add(s);
  }
  return [...set].filter((s) => s.length >= 2);
}

/**
 * GLOBAL theme-sweep (Phase 1.7) — the safety net that runs on EVERY chunk regardless of whether its full
 * rewrite "succeeded". A lite model often returns a chunk that PARSES (so it's accepted) yet leaves English
 * source copy untouched — e.g. "Create a high-end online sneaker marketplace", the brand "Layout.dev", the
 * metric "$100k/mo". Those never hit the fellBack-only retext. Here we collect ALL on-screen text (quoted
 * literals + JSX text nodes), ask the model for replacements ONLY for the strings that DON'T fit the new
 * theme, and deterministically swap them. Returns swept code or null if nothing was off-theme/changed.
 */
async function askSweepMap(model: Gen1ModelFn, words: string[], theme: string, sellingPoints: string[]): Promise<Record<string, string> | null> {
  const prompt =
    `You are auditing the on-screen text of an ad video that was re-themed to the NEW product "${theme || "the product"}"` +
    `${sellingPoints.filter(Boolean).length ? ` (selling points: ${sellingPoints.filter(Boolean).join(", ")})` : ""}. ` +
    `Below is a JSON array of on-screen text strings still in the code. Any string that does NOT clearly belong to the ` +
    `new product MUST be replaced — that includes leftover English source copy, other brand names, off-topic feature ` +
    `names (e.g. "Clip Editor", "Lip Sync", "sneaker", "marketplace"), and stale metrics/prices. Return a JSON object ` +
    `mapping EACH such string to a SHORT replacement in the theme's language that fits "${theme || "the product"}" — big ` +
    `headlines <= 6 Chinese / 14 latin chars, feature names short, numbers realistic for the new product. Strings that ` +
    `ALREADY fit the new product: leave them OUT. If every string already fits, return {}. Return ONLY the JSON object:\n` +
    JSON.stringify(words);
  let raw: string;
  try { raw = await model(prompt); } catch { return null; }
  try {
    const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
    if (s < 0 || e <= s) return null;
    const obj = JSON.parse(raw.slice(s, e + 1)) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v !== "string") continue;
      // Sanitize: a replacement carrying a quote / backtick / newline would UNTERMINATE the string literal it is
      // spliced into (parse error -> the whole rewrite gets reverted to the original). Strip those + clamp length.
      const clean = v.replace(/[\r\n]+/g, " ").replace(/['"`\\]/g, "").trim().slice(0, 48);
      if (clean && clean !== k) out[k] = clean;
    }
    return out;
  } catch { return null; }
}

export async function themeSweepText(code: string, theme: string, sellingPoints: string[], models: Gen1ModelFn[]): Promise<string | null> {
  const all = [...new Set([...displayStrings(code), ...jsxTextNodes(code)])].slice(0, 80);
  if (!all.length) return null;
  const themeCJK = /[一-鿿]/.test(theme);
  const applyMap = (src: string, words: string[], map: Record<string, string>): { out: string; changed: number } => {
    let out = src, changed = 0;
    for (const w of [...words].sort((a, b) => b.length - a.length)) {
      const repl = map[w];
      if (!repl) continue;
      const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const before = out;
      out = out.replace(new RegExp(`(['"\`])${esc}\\1`, "g"), (_m, q) => `${q}${repl}${q}`);   // quoted literal
      if (out === before) out = out.split(w).join(repl);                                         // JSX text node / bare
      if (out !== before) changed++;
    }
    return { out, changed };
  };
  let out = code, total = 0, pending = all;
  // Run each model in turn; after the first pass, only RESIDUAL off-theme strings (still present, and — for a CJK
  // theme — still pure-latin, i.e. un-rethemed) are handed to the next (typically more reliable) model. This stops a
  // lite model that maps only the headlines and returns from leaving a whole marquee of English feature names behind.
  for (const model of models) {
    if (!pending.length) break;
    const map = await askSweepMap(model, pending, theme, sellingPoints);
    if (map && Object.keys(map).length) {
      const r = applyMap(out, pending, map);
      out = r.out; total += r.changed;
    }
    pending = pending.filter((w) => out.includes(w) && (!themeCJK || (!/[一-鿿]/.test(w) && /[A-Za-z]/.test(w))));
  }
  return total ? out : null;
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
  /** Freeform user instruction injected as the HIGHEST-priority directive of the rewrite prompt (LLM-primary mode). */
  customNL?: string;
  /** Where the deterministic theme-sweep (Phase 1.7) runs. "all" (default) sweeps every chunk — the legacy
   *  always-on hard rule. "fallback" sweeps ONLY chunks the LLM could not cleanly rewrite (fell back), so a
   *  successful LLM rewrite is trusted and never post-processed by the deterministic text rule. */
  sweepScope?: "all" | "fallback";
}): Promise<ContextRewriteResult> {
  const warnings: string[] = [];
  const original = input.capsule.codeBundle;
  // Files whose on-screen text we re-theme: for a stitched multi-file (chunked) capsule the text lives in
  // the chunk modules, NOT the structural parent entry; for a single-file capsule it's the entry itself.
  const isMulti = original.files.length > 1;
  const targets = (isMulti ? original.files.filter((f) => f.path !== original.entryFile) : original.files.filter((f) => f.path === original.entryFile))
    .filter((f) => typeof f.content === "string" && f.content.length);
  if (!targets.length) return { codeBundle: original, usedAi: false, warnings: ["no text-bearing code to rewrite"], hadFallback: true };
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
          const raw = await model(buildContextRewritePrompt(f.content, input.theme, input.sellingPoints, lastErrors, input.extraDirective, input.customNL));
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

  // Robust fallback for when the FULL LLM rewrite can't produce compiling/rendering TSX (it asks the model to
  // regenerate whole modules, which is fragile). Rather than ship the SOURCE-language on-screen text, apply the
  // DETERMINISTIC theme-sweep (quoted-literal string-content swaps — compile-safe) to the ORIGINAL, already-
  // compiling code so the visible copy ("Video Generator", "online sneaker marketplace"…) still becomes the new
  // theme. Gated on compile + render before shipping; falls back to raw original only if even that fails.
  const sweptOriginalFallback = async (reason: string): Promise<ContextRewriteResult> => {
    const sweptMap = new Map<string, string>();
    await Promise.all(targets.map(async (t) => {
      const out = await themeSweepText(t.content, input.theme, input.sellingPoints, models).catch(() => null);
      if (out && out !== t.content) sweptMap.set(t.path, out);
    }));
    if (sweptMap.size) {
      const sweptBundle: v5.RemotionTemplateCapsule["codeBundle"] = {
        files: original.files.map((f) => (sweptMap.has(f.path) ? { ...f, content: sweptMap.get(f.path) as string } : f)),
        entryFile: original.entryFile,
        componentName: original.componentName
      };
      const compiles = validateTemplateCapsule({ ...input.capsule, codeBundle: sweptBundle }).gates.find((g) => g.id === "T2")?.status === "pass";
      if (compiles) {
        const probe = await input.renderProbe(sweptBundle, fixture).catch(() => ({ ok: false as const }));
        if (probe.ok) {
          warnings.push(`${reason}; applied deterministic theme-sweep to the original code (${sweptMap.size} file(s)) so on-screen text reflects the new theme.`);
          return { codeBundle: sweptBundle, usedAi: true, warnings, hadFallback: true };
        }
      }
    }
    warnings.push(`${reason}; using the original (un-rethemed) capsule code.`);
    return { codeBundle: original, usedAi: false, warnings, hadFallback: true };
  };

  // Phase 1 — rewrite every target chunk independently (each retried on its own). Failed chunks fall back to original.
  const perFile = await mapLimit(targets, concurrency, (f) => rewriteOneFile(f, maxAttempts));
  const rewritten = new Map<string, string>();
  const fellBack: { path: string; error?: string }[] = [];
  for (const r of perFile) {
    if (r.content) rewritten.set(r.path, r.content);
    else fellBack.push({ path: r.path, error: r.error });
  }
  // Chunks the LLM rewrote cleanly in Phase 1 — in "fallback" sweep mode these are TRUSTED (the deterministic
  // theme-sweep never touches them; only chunks that fall back below get the hard-rule cleanup).
  const phase1Clean = new Set(rewritten.keys());
  const hadAnyFallback = () => fellBack.length > 0 || targets.some((t) => !phase1Clean.has(t.path));
  // Phase 1.5 — for chunks whose FULL rewrite failed (large chunk → model truncates/garbles the whole module),
  // try a TARGETED text swap so the source's baked words (e.g. hardcoded sneaker titles "NMD R1 Speed") don't
  // leak into the new-theme video. Re-texted chunks move out of fellBack; the bundle is still compile/render-gated.
  if (fellBack.length) {
    const retexted = await mapLimit(fellBack, concurrency, async (fb) => {
      const f = targets.find((t) => t.path === fb.path);
      const swapped = f ? await retextChunk(f.content, input.theme, input.sellingPoints, models).catch(() => null) : null;
      return { path: fb.path, content: swapped };
    });
    const stillFailed: typeof fellBack = [];
    for (const fb of fellBack) {
      const rt = retexted.find((x) => x.path === fb.path);
      if (rt?.content) { rewritten.set(fb.path, rt.content); warnings.push(`chunk ${fb.path}: full rewrite failed -> targeted text swap applied (source words replaced for new theme)`); }
      else stillFailed.push(fb);
    }
    fellBack.length = 0;
    fellBack.push(...stillFailed);
  }
  for (const fb of fellBack) warnings.push(`chunk ${fb.path}: ${fb.error ?? "unparseable"} -> kept original chunk code`);
  if (!rewritten.size) return await sweptOriginalFallback("context rewrite failed (no chunk produced usable output)");

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
      return await sweptOriginalFallback("context rewrite produced non-compiling code after repair");
    }
  }

  // Phase 2.5 — GLOBAL theme-sweep over EVERY target, AFTER the bundle COMPILES. A chunk whose full rewrite
  // parsed but left English source copy/brands/metrics ("online sneaker marketplace", "$100k/mo") never reaches
  // the fellBack-only retext; this catches those by swapping just the off-theme on-screen strings. Running it
  // POST-compile (not before Phase 2) is the fix for the leftover-headline bug: previously a single chunk that
  // only needed the Phase-2 compile-repair made the swept bundle fail to compile, reverting the WHOLE sweep and
  // leaving the source-language headline. Now the sweep runs on already-compiling code and stands on its own.
  {
    // In LLM-primary mode (sweepScope "fallback") the deterministic sweep only cleans chunks the LLM could NOT
    // rewrite cleanly (phase1Clean excluded). Default "all" sweeps every chunk.
    const sweepTargets = input.sweepScope === "fallback" ? targets.filter((t) => !phase1Clean.has(t.path)) : targets;
    const preSweep = new Map(rewritten);                                  // snapshot to revert to if the sweep breaks compile
    let sweptCount = 0;
    const swept = await mapLimit(sweepTargets, concurrency, async (t) => {
      const cur = rewritten.get(t.path) ?? t.content;
      const out = await themeSweepText(cur, input.theme, input.sellingPoints, models).catch(() => null);
      return { path: t.path, content: out };
    });
    for (const s of swept) if (s.content) { rewritten.set(s.path, s.content); sweptCount++; }
    if (sweptCount) {
      // Keep the swept code only if it still compiles, else revert to the pre-sweep (already-compiling) rewrite.
      const sweptOk = validateTemplateCapsule({ ...input.capsule, codeBundle: assemble(rewritten) }).gates.find((g) => g.id === "T2")?.status === "pass";
      if (sweptOk) warnings.push(`theme-sweep: removed leftover off-theme on-screen text in ${sweptCount} chunk(s).`);
      else { for (const [k, v] of preSweep) rewritten.set(k, v); for (const k of [...rewritten.keys()]) if (!preSweep.has(k)) rewritten.delete(k); warnings.push(`theme-sweep reverted (would not compile; kept the rethemed code).`); }
      candidate = assemble(rewritten);
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
      return await sweptOriginalFallback(`context rewrite render failed after repair (${probe.error ?? "unknown"})`);
    }
  }

  if (fellBack.length) {
    warnings.push(`context rewrite applied to ${rewritten.size}/${targets.length} chunk(s); ${fellBack.length} kept original (model output unusable for those).`);
  } else {
    warnings.push(`context rewrite applied (new theme/copy; structure kept; ${rewritten.size} file(s)).`);
  }
  return { codeBundle: candidate, usedAi: true, warnings, hadFallback: hadAnyFallback() };
}
