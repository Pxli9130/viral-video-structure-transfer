// services/knowledgeBaseV5.ts
// Self-contained, file-backed Knowledge Base for spec_v5. Kept independent of the V4 storage Database
// so V5 runs in parallel without disturbing V4 (mirrors engine/effectKnowledgeBase.ts's JSON-manifest
// approach). P0 curation is hard-rule only (embedding/ML judge is P1 and degrades gracefully per
// routing-and-fallbacks.md §4): exact re-learn of the same sample+kind merges instead of duplicating
// (test-plan regression: "KB duplicates explode"); raw sample material is stored evidence_only.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { v5 } from "@vvst/shared";

export interface KnowledgeBaseFile {
  version: "knowledge-base.v5";
  elements: v5.KnowledgeElement[];
  decisions: v5.KbCurationDecision[];
  /** Level-1 assets: full reusable Remotion template capsules (the default generation object). */
  capsules?: v5.RemotionTemplateCapsule[];
}

export interface CapsuleQuery {
  sourceSampleId?: string;
  projectId?: string;
  tag?: string;
  q?: string;
}

export interface KbQuery {
  kind?: v5.KnowledgeElementKindV5;
  tag?: string;
  sourceSampleId?: string;
  q?: string;
  status?: NonNullable<v5.KnowledgeElement["lifecycle"]>["status"] | "all";
  limit?: number;
  offset?: number;
}

function emptyFile(): KnowledgeBaseFile {
  return { version: "knowledge-base.v5", elements: [], decisions: [], capsules: [] };
}

function nowIso(): string {
  return new Date().toISOString();
}

function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").replace(/\s+/g, " ").trim();
}

function payloadString(c: v5.CandidateElement): string {
  const p = c.payload ?? {};
  const retrieval = typeof p.retrievalText === "string" ? p.retrievalText : "";
  const category = typeof p.category === "string" ? p.category : "";
  const subcategory = typeof p.subcategory === "string" ? p.subcategory : "";
  return [
    c.kind,
    category,
    subcategory,
    c.proposedName,
    c.summary,
    ...(c.qualityHints ?? []),
    retrieval,
    stableJson(p).slice(0, 2000),
    c.slots.map((s) => `${s.kind}:${s.required}:${s.replacementPolicy}:${s.sectionId ?? ""}`).join(" ")
  ].filter(Boolean).join(" ");
}

function elementText(e: v5.KnowledgeElement): string {
  return [
    e.kind,
    e.category,
    e.subcategory,
    e.name,
    e.description,
    ...e.tags,
    e.signatures?.retrievalText,
    stableJson(e.payload ?? {}).slice(0, 2000),
    e.slots.map((s) => `${s.kind}:${s.required}:${s.replacementPolicy}:${s.sectionId ?? ""}`).join(" ")
  ].filter(Boolean).join(" ");
}

function slotSignature(slots: v5.PlaceholderSlotV5[]): string {
  return sha1(stableJson(slots.map((s) => ({ kind: s.kind, required: s.required, replacementPolicy: s.replacementPolicy, safetyPolicy: s.safetyPolicy, sectionId: s.sectionId }))));
}

function audioCueSignature(c: v5.CandidateElement): string | undefined {
  const recipe = c.audioRecipe;
  const payload = c.payload ?? {};
  const cues = recipe?.cuePoints ?? (Array.isArray(payload.audioCues) ? payload.audioCues : Array.isArray(payload.cues) ? payload.cues : undefined);
  if (!Array.isArray(cues) || !cues.length) return undefined;
  return sha1(stableJson(cues.map((cue) => {
    const rec = cue && typeof cue === "object" ? cue as Record<string, unknown> : {};
    return { t: typeof rec.t === "number" ? Math.round(rec.t * 10) / 10 : undefined, type: rec.type, role: rec.role };
  })));
}

function audioRhythmSignature(c: v5.CandidateElement): string | undefined {
  const recipe = c.audioRecipe;
  const payload = c.payload ?? {};
  const rawCurve = recipe?.energyCurve ?? (Array.isArray(payload.energyCurve) ? payload.energyCurve : undefined);
  const bpm = typeof recipe?.bpm === "number" ? recipe.bpm : typeof payload.bpm === "number" ? payload.bpm : undefined;
  if (!rawCurve?.length && bpm === undefined) return undefined;
  const curve = (rawCurve ?? [])
    .map((item) => {
      const rec = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const t = typeof rec.t === "number" ? rec.t : typeof rec.timeSec === "number" ? rec.timeSec : undefined;
      const value = typeof rec.value === "number" ? rec.value : typeof rec.energy === "number" ? rec.energy : undefined;
      if (t === undefined || value === undefined) return undefined;
      return { t: Math.round(t * 2) / 2, value: Math.round(Math.max(0, Math.min(1, value)) * 5) / 5 };
    })
    .filter(Boolean)
    .slice(0, 32);
  return sha1(stableJson({ bpm: bpm === undefined ? undefined : Math.round(bpm), curve }));
}

function remotionSignature(c: v5.CandidateElement): string | undefined {
  const payload = c.payload ?? {};
  const ref = c.remotionSnippet?.snippetRef ?? payload.remotionCodeHash ?? payload.snippetHash ?? payload.capsuleId;
  if (!ref && !c.remotionSnippet?.componentName) return undefined;
  return sha1(stableJson({ ref, componentName: c.remotionSnippet?.componentName }));
}

function candidateSignatures(c: v5.CandidateElement): NonNullable<v5.KnowledgeElement["signatures"]> {
  const retrievalText = payloadString(c);
  return {
    payloadHash: sha1(stableJson({ kind: c.kind, category: c.payload?.category, subcategory: c.payload?.subcategory, payload: c.payload ?? {} })),
    normalizedText: normalizeText(retrievalText),
    retrievalText,
    slotSchemaHash: slotSignature(c.slots),
    remotionHash: remotionSignature(c),
    audioCueHash: audioCueSignature(c),
    audioRhythmHash: audioRhythmSignature(c)
  };
}

function tokenFreq(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of normalizeText(text).split(/\s+/).filter((x) => x.length > 1)) out.set(t, (out.get(t) ?? 0) + 1);
  return out;
}

function cosineText(a: string, b: string): number {
  const av = tokenFreq(a), bv = tokenFreq(b);
  if (!av.size || !bv.size) return 0;
  let dot = 0, an = 0, bn = 0;
  for (const v of av.values()) an += v * v;
  for (const v of bv.values()) bn += v * v;
  for (const [k, v] of av) dot += v * (bv.get(k) ?? 0);
  return dot / Math.sqrt(an * bn || 1);
}

function jaccard(a: string[], b: string[]): number {
  const as = new Set(a.map(normalizeText).filter(Boolean));
  const bs = new Set(b.map(normalizeText).filter(Boolean));
  if (!as.size && !bs.size) return 1;
  let inter = 0;
  for (const x of as) if (bs.has(x)) inter++;
  return inter / Math.max(1, new Set([...as, ...bs]).size);
}

function extractList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v)).filter(Boolean);
}

function timingSimilarity(c: v5.CandidateElement, e: v5.KnowledgeElement): number {
  const cp = c.payload ?? {};
  const ep = e.payload ?? {};
  const cd = typeof cp.durationSec === "number" ? cp.durationSec : undefined;
  const ed = typeof ep.durationSec === "number" ? ep.durationSec : undefined;
  if (cd === undefined || ed === undefined) return 0.5;
  return Math.max(0, 1 - Math.abs(cd - ed) / Math.max(cd, ed, 1));
}

function structuredSimilarity(c: v5.CandidateElement, e: v5.KnowledgeElement, sig: NonNullable<v5.KnowledgeElement["signatures"]>): number {
  const slot = sig.slotSchemaHash && e.signatures?.slotSchemaHash && sig.slotSchemaHash === e.signatures.slotSchemaHash ? 1 : jaccard(c.slots.map((s) => String(s.kind)), e.slots.map((s) => String(s.kind)));
  const motion = jaccard(extractList(c.payload?.motion ?? c.payload?.motionMotifs), extractList(e.payload?.motion ?? e.payload?.motionMotifs));
  const audio = sig.audioCueHash && e.signatures?.audioCueHash && sig.audioCueHash === e.signatures.audioCueHash ? 1 : jaccard(extractList(c.payload?.audioCues), extractList(e.payload?.audioCues));
  const rhythm = sig.audioRhythmHash && e.signatures?.audioRhythmHash ? (sig.audioRhythmHash === e.signatures.audioRhythmHash ? 1 : 0.35) : 0.5;
  const remotion = sig.remotionHash && e.signatures?.remotionHash && sig.remotionHash === e.signatures.remotionHash ? 1 : 0.5;
  const tags = jaccard(c.qualityHints ?? [], e.tags ?? []);
  return 0.22 * slot + 0.18 * timingSimilarity(c, e) + 0.17 * motion + 0.14 * audio + 0.14 * rhythm + 0.08 * remotion + 0.07 * tags;
}

function sourceContextScore(c: v5.CandidateElement, e: v5.KnowledgeElement): number {
  return c.sourceSampleId === e.source.sourceSampleId ? 1 : 0.65;
}

function defaultCompatibility(c: v5.CandidateElement): v5.CompatibilityV5 {
  const aspectRatios = (c.payload?.aspectRatio ? [String(c.payload.aspectRatio)] : ["9:16"]) as string[];
  return { aspectRatios, verticals: ["marketing"], canCombineWith: [], conflictsWith: [] };
}

function candidateToElement(
  c: v5.CandidateElement,
  action: v5.KbDecisionAction,
  assignedName?: string,
  relation?: NonNullable<v5.KnowledgeElement["relations"]>[number]
): v5.KnowledgeElement {
  const evidenceOnly = action === "evidence_only" || c.reusablePolicy === "evidence_only";
  const style =
    c.kind === "typography_pattern"
      ? { palette: (c.payload?.palette as string[]) ?? undefined, typography: (c.payload?.typographySystem as string) ?? undefined }
      : undefined;
  const signatures = candidateSignatures(c);
  const createdAt = nowIso();
  return {
    id: `ke_${c.id.replace(/^cand_/, "")}`,
    kind: c.kind,
    category: typeof c.payload?.category === "string" ? c.payload.category : undefined,
    subcategory: typeof c.payload?.subcategory === "string" ? c.payload.subcategory : undefined,
    name: assignedName ?? c.proposedName,
    description: c.summary,
    tags: Array.from(new Set([c.kind.replace(/_pattern$/, ""), ...(c.qualityHints ?? [])])).slice(0, 8),
    facets: typeof c.payload?.facets === "object" && c.payload?.facets ? c.payload.facets as Record<string, unknown> : undefined,
    source: {
      sourceSampleId: c.sourceSampleId,
      reconstructionProgramId: c.sourceProgramId,
      evidenceRefs: c.evidenceRefs
    },
    reusablePolicy: evidenceOnly ? "evidence_only" : c.reusablePolicy,
    slots: c.slots,
    payload: c.payload ?? {},
    signatures,
    embedding: {
      model: "local-text-sde",
      version: "v1",
      vectorRef: `local:${signatures.payloadHash}`,
      retrievalText: signatures.retrievalText,
      createdAt
    },
    relations: relation ? [relation] : undefined,
    style,
    compatibility: defaultCompatibility(c),
    assetRecipe: c.assetRecipe,
    audioRecipe: c.audioRecipe,
    safety: {
      noCopyChecked: true,
      samplePixelsRemoved: true,
      sampleAudioRemoved: true,
      sampleTextRemoved: true,
      renderable: !evidenceOnly
    },
    quality: {
      confidence: 0.6,
      usefulness: c.kind === "hook_pattern" || c.kind === "cta_pattern" ? 0.85 : 0.7,
      reuseCount: 0
    },
    lifecycle: { status: "active", version: 1, createdAt, updatedAt: createdAt }
  };
}

export class KnowledgeBaseV5 {
  private readonly filePath: string;
  private data: KnowledgeBaseFile;

  constructor(storageDir: string) {
    this.filePath = path.join(storageDir, "kb", "knowledge-base.json");
    this.data = this.load();
  }

  private load(): KnowledgeBaseFile {
    if (existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as KnowledgeBaseFile;
        if (parsed && Array.isArray(parsed.elements)) {
          return { version: "knowledge-base.v5", elements: parsed.elements, decisions: parsed.decisions ?? [], capsules: parsed.capsules ?? [] };
        }
      } catch {
        /* fall through to empty */
      }
    }
    return emptyFile();
  }

  private save(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  list(query: KbQuery = {}): v5.KnowledgeElement[] {
    let items = this.data.elements;
    if (query.status && query.status !== "all") items = items.filter((e) => (e.lifecycle?.status ?? "active") === query.status);
    if (!query.status) items = items.filter((e) => (e.lifecycle?.status ?? "active") === "active");
    if (query.kind) items = items.filter((e) => e.kind === query.kind);
    if (query.tag) items = items.filter((e) => e.tags.includes(query.tag as string));
    if (query.sourceSampleId) items = items.filter((e) => e.source.sourceSampleId === query.sourceSampleId);
    if (query.q) {
      const q = query.q.toLowerCase();
      items = items.filter((e) =>
        [e.name, e.description, e.kind, e.category, e.subcategory, e.signatures?.retrievalText, ...e.tags].some((s) => String(s ?? "").toLowerCase().includes(q))
      );
    }
    const offset = query.offset ?? 0;
    return query.limit ? items.slice(offset, offset + query.limit) : items.slice(offset);
  }

  /** Lightweight token-overlap search (embedding search is P1). */
  search(queryText: string, filters: { kind?: v5.KnowledgeElementKindV5[] } = {}): v5.KnowledgeElement[] {
    const terms = normalizeText(queryText).split(/\s+/).filter(Boolean);
    const scored = this.data.elements
      .filter((e) => (e.lifecycle?.status ?? "active") === "active")
      .filter((e) => !filters.kind || filters.kind.includes(e.kind))
      .map((e) => {
        const hay = normalizeText(elementText(e));
        const keyword = terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
        const score = keyword + cosineText(queryText, hay);
        return { e, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.map((x) => x.e);
  }

  getDecisions(): v5.KbCurationDecision[] {
    return [...this.data.decisions];
  }

  // ---- Level-1: template capsules (the default generation object) ----

  saveTemplateCapsule(capsule: v5.RemotionTemplateCapsule): v5.RemotionTemplateCapsule {
    if (!this.data.capsules) this.data.capsules = [];
    this.data.capsules = [...this.data.capsules.filter((c) => c.id !== capsule.id), capsule];
    this.save();
    return capsule;
  }

  getTemplateCapsule(id: string): v5.RemotionTemplateCapsule | undefined {
    return (this.data.capsules ?? []).find((c) => c.id === id);
  }

  listTemplateCapsules(query: CapsuleQuery = {}): v5.RemotionTemplateCapsule[] {
    let items = this.data.capsules ?? [];
    if (query.sourceSampleId) items = items.filter((c) => c.sourceSampleId === query.sourceSampleId);
    if (query.projectId) items = items.filter((c) => c.projectId === query.projectId);
    if (query.tag) items = items.filter((c) => c.tags.includes(query.tag as string));
    if (query.q) {
      const q = query.q.toLowerCase();
      items = items.filter((c) => [c.name, c.description, ...c.tags].some((s) => String(s ?? "").toLowerCase().includes(q)));
    }
    return [...items];
  }

  searchTemplateCapsules(queryText: string): v5.RemotionTemplateCapsule[] {
    const terms = queryText.toLowerCase().split(/\s+/).filter(Boolean);
    return (this.data.capsules ?? [])
      .map((c) => {
        const hay = [c.name, c.description, ...c.tags, ...c.motionSignature.motifs].join(" ").toLowerCase();
        return { c, score: terms.reduce((a, t) => a + (hay.includes(t) ? 1 : 0), 0) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c);
  }

  /** The most recent capsule (default template for same_template generation). */
  latestTemplateCapsule(sourceSampleId?: string): v5.RemotionTemplateCapsule | undefined {
    const list = this.listTemplateCapsules(sourceSampleId ? { sourceSampleId } : {});
    return list[list.length - 1];
  }

  saveKnowledgeElements(elements: v5.KnowledgeElement[]): void {
    for (const e of elements) {
      this.data.elements = [...this.data.elements.filter((x) => x.id !== e.id), e];
    }
    this.save();
  }

  private findSdeMatch(candidate: v5.CandidateElement): {
    signature: NonNullable<v5.KnowledgeElement["signatures"]>;
    best?: { element: v5.KnowledgeElement; score: number; embeddingCosine: number; structuredScore: number };
    exact?: v5.KnowledgeElement;
    matches: Array<{ elementId: string; score: number }>;
  } {
    const signature = candidateSignatures(candidate);
    const candidates = this.data.elements.filter((e) => (e.lifecycle?.status ?? "active") === "active" && e.kind === candidate.kind);
    const exact = candidates.find((e) => {
      const es = e.signatures;
      if (!es) return false;
      return (
        es.payloadHash === signature.payloadHash ||
        (Boolean(signature.remotionHash) && es.remotionHash === signature.remotionHash) ||
        (Boolean(signature.audioCueHash) && es.audioCueHash === signature.audioCueHash && es.slotSchemaHash === signature.slotSchemaHash)
      );
    });
    const scored = candidates
      .filter((e) => e.id !== exact?.id)
      .map((element) => {
        const embeddingCosine = cosineText(signature.retrievalText, element.signatures?.retrievalText ?? elementText(element));
        const structuredScore = structuredSimilarity(candidate, element, signature);
        const score = 0.5 * embeddingCosine + 0.35 * structuredScore + 0.15 * sourceContextScore(candidate, element);
        return { element, score, embeddingCosine, structuredScore };
      })
      .sort((a, b) => b.score - a.score);
    return {
      signature,
      exact,
      best: scored[0],
      matches: scored.slice(0, 5).map((s) => ({ elementId: s.element.id, score: Number(s.score.toFixed(4)) }))
    };
  }

  /** Curate one candidate: hard-rule dedupe + safety, write decision (+ element when stored). */
  curate(candidate: v5.CandidateElement): { decision: v5.KbCurationDecision; element?: v5.KnowledgeElement } {
    const sde = this.findSdeMatch(candidate);
    const existing = sde.exact ?? (sde.best && sde.best.score >= 0.94 ? sde.best.element : undefined);
    const decisionId = `kbd_${candidate.id.replace(/^cand_/, "")}`;

    if (existing) {
      const decision: v5.KbCurationDecision = {
        id: decisionId,
        candidateId: candidate.id,
        action: "merge_existing",
        targetElementId: existing.id,
        hardRuleResult: sde.exact ? "same kind + hard signature match" : "SDE score >= 0.94",
        embeddingMatches: sde.matches,
        reason: sde.exact ? "Exact signature duplicate of an already-stored element." : "SDE classified this candidate as an existing element."
      };
      // bump reuse evidence on merge
      existing.source.evidenceRefs = Array.from(new Set([...existing.source.evidenceRefs, ...candidate.evidenceRefs])).slice(0, 24);
      existing.tags = Array.from(new Set([...existing.tags, ...(candidate.qualityHints ?? [])])).slice(0, 16);
      existing.quality.reuseCount = (existing.quality.reuseCount ?? 0) + 1;
      existing.lifecycle = { status: existing.lifecycle?.status ?? "active", version: (existing.lifecycle?.version ?? 1) + 1, createdAt: existing.lifecycle?.createdAt ?? nowIso(), updatedAt: nowIso() };
      this.data.decisions.push(decision);
      this.save();
      return { decision, element: existing };
    }

    const evidenceOnly = candidate.reusablePolicy === "evidence_only";
    const variantOf = !evidenceOnly && sde.best && sde.best.score >= 0.72 ? sde.best.element : undefined;
    const action: v5.KbDecisionAction = evidenceOnly ? "evidence_only" : variantOf ? "store_variant" : "store_new";
    const relation = variantOf
      ? { type: "variant_of" as const, targetElementId: variantOf.id, confidence: Number(sde.best!.score.toFixed(4)), reason: "SDE score in variant range." }
      : undefined;
    const element = candidateToElement(candidate, action, undefined, relation);
    this.data.elements.push(element);
    const decision: v5.KbCurationDecision = {
      id: decisionId,
      candidateId: candidate.id,
      action,
      ...(variantOf ? { parentElementId: variantOf.id } : {}),
      createdElementId: element.id,
      assignedName: element.name,
      assignedKind: element.kind,
      embeddingMatches: sde.matches,
      hardRuleResult: evidenceOnly ? "raw sample material -> evidence_only" : variantOf ? "SDE score in variant range" : "no hard or semantic duplicate",
      reason: evidenceOnly ? "Stored as evidence-only (not reusable in final)." : variantOf ? `Stored as useful variant of ${variantOf.id}.` : "Stored as new reusable element."
    };
    this.data.decisions.push(decision);
    this.save();
    return { decision, element };
  }

  curateMany(candidates: v5.CandidateElement[]): {
    decisions: v5.KbCurationDecision[];
    elements: v5.KnowledgeElement[];
  } {
    const decisions: v5.KbCurationDecision[] = [];
    const elements: v5.KnowledgeElement[] = [];
    for (const c of candidates) {
      const { decision, element } = this.curate(c);
      decisions.push(decision);
      if (element) elements.push(element);
    }
    return { decisions, elements };
  }
}
