import type { VisualElementGraph } from "@vvst/shared";

/**
 * Build the VLM evidence-labeling prompt for the VisualElementGraph.
 *
 * Design contract (the whole point of the graph-first architecture): CV / optical-flow / OCR have
 * ALREADY located every element and given it an id + bbox track. The VLM's only job is to attach
 * SEMANTIC labels to those existing candidate ids — it must NOT invent new objects or boxes, and
 * must treat the sample purely as style evidence (never propose copying sample frames/audio/faces/
 * watermarks). This keeps localization deterministic + reproducible and uses the VLM only where it
 * is reliable (naming/role/style), avoiding the "ask a VLM to find coordinates in 1-FPS video" trap.
 *
 * This is a pure prompt builder (offline-safe, no network). The optional labeling pass that sends it
 * to Gemini is best-effort and never required for a fresh run / CI — the rule-based graph stands on
 * its own.
 */
export function buildElementLabelPrompt(graph: VisualElementGraph): { system: string; user: string; candidateIds: string[] } {
  const candidates = (graph.elements ?? []).map((e) => ({
    id: e.id,
    family: e.family,
    timeRangeSec: e.timeRangeSec,
    bbox: e.bboxTrackNorm?.[0]?.bbox,
    positionClass: e.positionClass,
    sizeClass: e.sizeClass,
    motionPattern: e.motionPattern,
    dominantColors: (e.appearance as { dominantColors?: string[] } | undefined)?.dominantColors,
    text: (e.text as { rawText?: string } | undefined)?.rawText
  }));
  const system = [
    "You label pre-located visual elements for a short-video structure-transfer engine.",
    "CV / optical-flow / OCR already located every element and gave it an id + bbox. You ONLY add semantic labels.",
    "RULES:",
    "- Refer ONLY to existing candidate ids. Do NOT invent new objects, ids, or bounding boxes.",
    "- Use the sample ONLY as style evidence; never propose copying sample frames, audio, faces, or watermarks.",
    "- Return STRICT JSON: {\"labels\":[{\"id\",\"creativeRole\",\"objectDescriptor\",\"rendererPrimitive\",\"motionIntent\",\"styleNotes\",\"confidence\"}]}.",
    "- creativeRole ∈ hero_object | subtitle | background | cta | impact_fx | watermark | unknown.",
    "- rendererPrimitive ∈ neon_hero_intro | beat_text_card | tutorial_rule_card | action_montage | impact_flash_stamp | motivation_cta | none."
  ].join("\n");
  const user = `Label each candidate id (do not add or remove ids):\n${JSON.stringify(candidates, null, 2)}`;
  return { system, user, candidateIds: candidates.map((c) => c.id) };
}

/** Validate VLM labels: drop any label whose id was not a real candidate (prevents invented boxes). */
export function sanitizeElementLabels(labels: Array<{ id?: string }>, candidateIds: string[]): Array<{ id?: string }> {
  const allowed = new Set(candidateIds);
  return (labels ?? []).filter((l) => l.id && allowed.has(l.id));
}
