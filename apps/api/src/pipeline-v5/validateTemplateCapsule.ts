// pipeline-v5/validateTemplateCapsule.ts
// Part 3 — validate a RemotionTemplateCapsule: parse/compile the template code, scan it for any sample
// asset/audio/video path or copied sample text, confirm props/slot schema + required slots, and emit
// T-gates. Static checks here; the actual neutral-preview render (T8) is performed by the learn/render
// path and folded back into capsule.quality.

import ts from "typescript";
import { v5 } from "@vvst/shared";

// Quoted specifiers / patterns that must never appear in reusable template code.
const SAMPLE_PATH_RE = /(["'`])(?:[^"'`]*\/)?(?:sample|samples|sample_assets|original|originals)\//i;
const MEDIA_URL_RE = /(["'`])(?:https?:)?\/\/[^"'`]+\.(?:mp3|wav|m4a|aac|mp4|mov|webm|m3u8)\1/i;
// ANY literal http(s) URL — all media must come from props; stock-image URLs (e.g. unsplash) are content.
const LITERAL_HTTP_RE = /(["'`])https?:\/\/[^"'`\s)]+\1/i;
const LOCAL_MEDIA_RE = /(?:<Audio|<Video|<OffthreadVideo)[^>]*\bsrc\s*=\s*["'`][^"'`{][^"'`]*["'`]/i; // literal (non-prop) audio/video src
const FORBIDDEN_API_RE = /\b(require\(|process\.|child_process|fs\.|eval\(|fetch\(|XMLHttpRequest|import\s*\()/;
const LONG_TEXT_LITERAL_RE = />\s*([^<>{}\n]{60,})\s*</g; // a >=60-char literal JSX text node (possible copied sample copy)
// Readable text baked into a <canvas> draw (fillText/strokeText) or a 3D <Text>/textGeometry — the
// multimodal codegen path can otherwise hardcode the SAMPLE's words here, bypassing the JSX-text scan.
const CANVAS_TEXT_RE = /\b(?:fillText|strokeText)\s*\(\s*(["'`])((?:[^"'`\\]|\\.){8,})\1/;

function parseCompiles(content: string): { ok: boolean; error?: string } {
  try {
    const sf = ts.createSourceFile("template.tsx", content, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
    // typescript records syntactic diagnostics on the source file (internal but stable for syntax).
    const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
    if (diags.length) {
      return { ok: false, error: ts.flattenDiagnosticMessageText(diags[0].messageText, "\n").slice(0, 200) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : String(err) };
  }
}

export function validateTemplateCapsule(capsule: v5.RemotionTemplateCapsule): v5.TemplateValidationResult {
  const gates: v5.TemplateGateResult[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const g = (id: string, name: string, status: "pass" | "warn" | "fail", message: string) => {
    gates.push({ id, name, status, message });
    if (status === "fail") errors.push(`${id} ${name}: ${message}`);
    if (status === "warn") warnings.push(`${id} ${name}: ${message}`);
  };

  // T1 capsule exists
  const hasCode = Boolean(capsule.codeBundle?.files?.length && capsule.codeBundle.entryFile);
  g("T1", "Template capsule exists", hasCode ? "pass" : "fail", hasCode ? `${capsule.codeBundle.files.length} file(s)` : "no code bundle");

  const entry = capsule.codeBundle?.files?.find((f) => f.path === capsule.codeBundle.entryFile) ?? capsule.codeBundle?.files?.[0];
  const code = capsule.codeBundle?.files?.map((f) => f.content).join("\n") ?? "";

  // T2 template code compiles (syntax)
  const compile = entry ? parseCompiles(entry.content) : { ok: false, error: "no entry file" };
  g("T2", "Template code compiles", compile.ok ? "pass" : "fail", compile.ok ? "syntax OK" : `parse error: ${compile.error}`);

  // T3 props schema exists
  g("T3", "Props schema exists", capsule.propsSchema && Object.keys(capsule.propsSchema).length ? "pass" : "fail", capsule.propsSchema ? "present" : "missing");

  // T4 slot schema exists
  g("T4", "Slot schema exists", Array.isArray(capsule.slotSchema) && capsule.slotSchema.length ? "pass" : "fail", `${capsule.slotSchema?.length ?? 0} slots`);

  // T5 no sample asset path in code
  const samplePath = SAMPLE_PATH_RE.test(code);
  g("T5", "No sample asset path in code", samplePath ? "fail" : "pass", samplePath ? "found a sample/original asset path literal" : "none");

  // T6 no literal media URL / external URL in code (all media must come from props)
  const mediaUrl = MEDIA_URL_RE.test(code);
  const localMedia = LOCAL_MEDIA_RE.test(code);
  const literalHttp = LITERAL_HTTP_RE.test(code);
  g("T6", "No literal media/external URL in code", mediaUrl || localMedia || literalHttp ? "fail" : "pass", literalHttp ? "literal http(s) URL — media must come from props (no stock-image links)" : mediaUrl ? "literal media URL" : localMedia ? "literal <Audio/Video src>" : "none (props-driven)");

  // forbidden runtime APIs (sandbox safety)
  const forbidden = FORBIDDEN_API_RE.test(code);
  if (forbidden) g("T6b", "No unsafe runtime API", "fail", "uses require/process/fs/eval/fetch/import()");

  // T7 required slots listed
  const requiredCount = (capsule.slotSchema ?? []).filter((s) => s.required).length;
  g("T7", "Required slots listed", capsule.slotSchema?.length ? "pass" : "warn", `${requiredCount} required of ${capsule.slotSchema?.length ?? 0}`);

  // T8 neutral preview renderable — verified by the render path; reflect capsule.quality if known.
  g("T8", "Neutral preview renderable", capsule.quality.renderPreviewPassed ? "pass" : "warn", capsule.quality.renderPreviewPassed ? "rendered" : "not yet rendered (verified at render time)");

  // T9 no copied sample text in code — JSX text nodes OR canvas/3D text baked as literals.
  const longLiterals: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(LONG_TEXT_LITERAL_RE);
  while ((m = re.exec(code))) longLiterals.push(m[1].trim());
  const suspiciousText = longLiterals.filter((t) => !/^[\s{}().,;:+\-*/<>=&|?]+$/.test(t));
  const canvasText = CANVAS_TEXT_RE.test(code); // hardcoded readable text inside fillText/strokeText
  g("T9", "No copied sample text in code", canvasText ? "fail" : suspiciousText.length ? "warn" : "pass", canvasText ? "literal text baked into a canvas/3D draw — feed it from a copy prop" : suspiciousText.length ? `${suspiciousText.length} long literal text node(s) — verify not sample copy` : "content is props-driven");

  // T10 template safe for reuse (composite)
  const safeFlags =
    capsule.safety.samplePixelsReusable === false &&
    capsule.safety.sampleAudioReusable === false &&
    capsule.safety.sampleTextReusable === false &&
    capsule.safety.onlyTemplateCodeReusable === true;
  const safe = !samplePath && !mediaUrl && !localMedia && !literalHttp && !forbidden && !canvasText && safeFlags;
  g("T10", "Template safe for reuse", safe ? "pass" : "fail", safe ? "code reusable, no sample content" : "unsafe — see T5/T6/T9/safety flags");

  const passed = gates.every((x) => x.status !== "fail");
  return { passed, errors, warnings, gates };
}
