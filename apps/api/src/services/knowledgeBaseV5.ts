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
  limit?: number;
  offset?: number;
}

function emptyFile(): KnowledgeBaseFile {
  return { version: "knowledge-base.v5", elements: [], decisions: [], capsules: [] };
}

/** Stable hard-rule signature: re-learning the same sample's same kind+payload merges. */
function candidateSignature(c: v5.CandidateElement): string {
  const payloadKey = JSON.stringify(c.payload ?? {});
  return createHash("sha1").update(`${c.sourceSampleId}|${c.kind}|${payloadKey}`).digest("hex");
}

function elementSignature(e: v5.KnowledgeElement): string {
  const payloadKey = JSON.stringify(e.payload ?? {});
  return createHash("sha1").update(`${e.source.sourceSampleId}|${e.kind}|${payloadKey}`).digest("hex");
}

function defaultCompatibility(c: v5.CandidateElement): v5.CompatibilityV5 {
  const aspectRatios = (c.payload?.aspectRatio ? [String(c.payload.aspectRatio)] : ["9:16"]) as string[];
  return { aspectRatios, verticals: ["marketing"], canCombineWith: [], conflictsWith: [] };
}

function candidateToElement(
  c: v5.CandidateElement,
  action: v5.KbDecisionAction,
  assignedName?: string
): v5.KnowledgeElement {
  const evidenceOnly = action === "evidence_only" || c.reusablePolicy === "evidence_only";
  const style =
    c.kind === "typography_pattern"
      ? { palette: (c.payload?.palette as string[]) ?? undefined, typography: (c.payload?.typographySystem as string) ?? undefined }
      : undefined;
  return {
    id: `ke_${c.id.replace(/^cand_/, "")}`,
    kind: c.kind,
    name: assignedName ?? c.proposedName,
    description: c.summary,
    tags: Array.from(new Set([c.kind.replace(/_pattern$/, ""), ...(c.qualityHints ?? [])])).slice(0, 8),
    source: {
      sourceSampleId: c.sourceSampleId,
      reconstructionProgramId: c.sourceProgramId,
      evidenceRefs: c.evidenceRefs
    },
    reusablePolicy: evidenceOnly ? "evidence_only" : c.reusablePolicy,
    slots: c.slots,
    payload: c.payload ?? {},
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
    }
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
    if (query.kind) items = items.filter((e) => e.kind === query.kind);
    if (query.tag) items = items.filter((e) => e.tags.includes(query.tag as string));
    if (query.sourceSampleId) items = items.filter((e) => e.source.sourceSampleId === query.sourceSampleId);
    if (query.q) {
      const q = query.q.toLowerCase();
      items = items.filter((e) =>
        [e.name, e.description, e.kind, ...e.tags].some((s) => String(s).toLowerCase().includes(q))
      );
    }
    const offset = query.offset ?? 0;
    return query.limit ? items.slice(offset, offset + query.limit) : items.slice(offset);
  }

  /** Lightweight token-overlap search (embedding search is P1). */
  search(queryText: string, filters: { kind?: v5.KnowledgeElementKindV5[] } = {}): v5.KnowledgeElement[] {
    const terms = queryText.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = this.data.elements
      .filter((e) => !filters.kind || filters.kind.includes(e.kind))
      .map((e) => {
        const hay = [e.name, e.description, e.kind, ...e.tags].join(" ").toLowerCase();
        const score = terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
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

  /** Curate one candidate: hard-rule dedupe + safety, write decision (+ element when stored). */
  curate(candidate: v5.CandidateElement): { decision: v5.KbCurationDecision; element?: v5.KnowledgeElement } {
    const sig = candidateSignature(candidate);
    const existing = this.data.elements.find((e) => elementSignature(e) === sig);
    const decisionId = `kbd_${candidate.id.replace(/^cand_/, "")}`;

    if (existing) {
      const decision: v5.KbCurationDecision = {
        id: decisionId,
        candidateId: candidate.id,
        action: "merge_existing",
        targetElementId: existing.id,
        hardRuleResult: "same sourceSampleId+kind+payload signature",
        reason: "Exact re-learn of an already-stored element."
      };
      // bump reuse evidence on merge
      existing.source.evidenceRefs = Array.from(new Set([...existing.source.evidenceRefs, ...candidate.evidenceRefs])).slice(0, 24);
      this.data.decisions.push(decision);
      this.save();
      return { decision, element: existing };
    }

    const evidenceOnly = candidate.reusablePolicy === "evidence_only";
    const action: v5.KbDecisionAction = evidenceOnly ? "evidence_only" : "store_new";
    const element = candidateToElement(candidate, action);
    this.data.elements.push(element);
    const decision: v5.KbCurationDecision = {
      id: decisionId,
      candidateId: candidate.id,
      action,
      createdElementId: element.id,
      assignedName: element.name,
      assignedKind: element.kind,
      hardRuleResult: evidenceOnly ? "raw sample material -> evidence_only" : "new unique signature",
      reason: evidenceOnly ? "Stored as evidence-only (not reusable in final)." : "Stored as new reusable element."
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
