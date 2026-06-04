// contracts-v5/schemas.ts
// Tightened, ajv-2020-compileable JSON Schemas for the v5 ARTIFACT-level contracts. These supersede
// the permissive drafts in spec_v5/schemas/*.json (which were mostly {"type":"object"} with no
// required keys). Top-level additionalProperties is left open (forward-compat + opaque payloads),
// but required keys and critical enums are enforced so contract drift is caught at validation time.

const REUSABLE_POLICY = ["direct_reuse", "parametric_reuse", "regenerate_only", "procedural_recreate", "evidence_only"];
const KE_KINDS = [
  "structure_pattern", "hook_pattern", "segment_template", "rhythm_pattern", "motion_pattern",
  "transition_pattern", "typography_pattern", "layout_pattern", "palette_pattern", "visual_asset_pattern",
  "image_prompt_recipe", "audio_pattern", "sfx_pattern", "voiceover_pattern", "cta_pattern", "remotion_snippet"
];
const SECTION_ROLES = ["hook", "setup", "proof", "demo", "benefit", "transition", "cta"];
const ASPECT_RATIOS = ["9:16", "16:9", "1:1"];
const ID = "https://viral-video-structure-transfer.local/schemas/v5";

export const evidenceTimelineV5Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}/evidence-timeline-v5.schema.json`,
  title: "EvidenceTimelineV5",
  type: "object",
  required: ["id", "assetId", "video", "shots", "keyFrames", "warnings"],
  properties: {
    id: { type: "string" },
    assetId: { type: "string" },
    video: {
      type: "object",
      required: ["durationSec", "width", "height", "fps", "hasAudio"],
      properties: {
        durationSec: { type: "number" },
        width: { type: "integer" },
        height: { type: "integer" },
        fps: { type: "number" },
        aspectRatio: { type: "string" },
        hasAudio: { type: "boolean" }
      }
    },
    shots: { type: "array", items: { type: "object" } },
    keyFrames: { type: "array", items: { type: "object" } },
    textEvidence: { type: "array", items: { type: "object" } },
    speechEvidence: { type: "object" },
    audioEvidence: { type: "object" },
    motionEvidence: { type: "object" },
    contactSheetRef: { type: "string" },
    recommendedVideoInputPolicy: { type: "object" },
    warnings: { type: "array", items: { type: "string" } }
  },
  additionalProperties: true
} as const;

export const neutralReconstructionProgramSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}/neutral-reconstruction-program.schema.json`,
  title: "NeutralReconstructionProgram",
  type: "object",
  required: ["id", "sourceSampleId", "evidenceTimelineId", "typedSpec", "remotionProject", "placeholders", "timingMap", "safety"],
  properties: {
    id: { type: "string" },
    sourceSampleId: { type: "string" },
    evidenceTimelineId: { type: "string" },
    evidenceRefs: { type: "array", items: { type: "string" } },
    typedSpec: {
      type: "object",
      required: ["composition", "scenes", "globalStyle", "audioCues"],
      properties: {
        composition: {
          type: "object",
          required: ["width", "height", "fps", "durationSec", "aspectRatio"],
          properties: { aspectRatio: { enum: ASPECT_RATIOS } }
        },
        scenes: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "role", "startSec", "endSec", "layers", "evidenceRefs"],
            properties: { role: { enum: SECTION_ROLES } }
          }
        },
        globalStyle: { type: "object" },
        audioCues: { type: "array", items: { type: "object" } }
      },
      additionalProperties: true
    },
    remotionProject: {
      type: "object",
      required: ["entryFile", "componentName", "files"],
      properties: {
        entryFile: { type: "string" },
        componentName: { type: "string" },
        files: { type: "array", items: { type: "object", required: ["path", "content"] } }
      },
      additionalProperties: true
    },
    placeholders: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "kind", "required", "evidenceRefs"],
        properties: { evidenceRefs: { type: "array", items: { type: "string" } } }
      }
    },
    timingMap: { type: "array", items: { type: "object", required: ["id", "startSec", "endSec", "evidenceRefs"] } },
    learnedAssetRecipes: { type: "array", items: { type: "object" } },
    learnedAudioRecipes: { type: "array", items: { type: "object" } },
    reconstructionQuality: { type: "object" },
    safety: {
      type: "object",
      required: ["samplePixelsRemoved", "sampleTextSanitized", "sampleAudioRemoved"],
      properties: {
        samplePixelsRemoved: { type: "boolean" },
        sampleTextSanitized: { type: "boolean" },
        sampleAudioRemoved: { type: "boolean" },
        renderableSampleMaterialRefs: { type: "array", items: { type: "string" } }
      }
    }
  },
  additionalProperties: true
} as const;

export const candidateElementSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}/candidate-element.schema.json`,
  title: "CandidateElement",
  type: "object",
  required: ["id", "proposedName", "kind", "sourceProgramId", "sourceSampleId", "evidenceRefs", "summary", "reusablePolicy", "slots"],
  properties: {
    id: { type: "string" },
    proposedName: { type: "string" },
    kind: { enum: KE_KINDS },
    sourceProgramId: { type: "string" },
    sourceSampleId: { type: "string" },
    evidenceRefs: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    reusablePolicy: { enum: REUSABLE_POLICY },
    slots: { type: "array", items: { type: "object" } },
    qualityHints: { type: "array", items: { type: "string" } }
  },
  additionalProperties: true
} as const;

export const knowledgeElementSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}/knowledge-element.schema.json`,
  title: "KnowledgeElement",
  type: "object",
  required: ["id", "kind", "name", "description", "tags", "source", "reusablePolicy", "slots", "payload", "compatibility", "safety", "quality"],
  properties: {
    id: { type: "string" },
    kind: { enum: KE_KINDS },
    name: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    source: {
      type: "object",
      required: ["sourceSampleId", "reconstructionProgramId", "evidenceRefs"],
      properties: { evidenceRefs: { type: "array", items: { type: "string" } } }
    },
    reusablePolicy: { enum: REUSABLE_POLICY },
    slots: { type: "array", items: { type: "object" } },
    payload: { type: "object" },
    compatibility: {
      type: "object",
      required: ["aspectRatios", "verticals", "canCombineWith", "conflictsWith"]
    },
    safety: {
      type: "object",
      required: ["noCopyChecked", "samplePixelsRemoved", "sampleAudioRemoved", "sampleTextRemoved", "renderable"]
    },
    quality: {
      type: "object",
      required: ["confidence", "usefulness"]
    }
  },
  additionalProperties: true
} as const;

export const kbCurationDecisionSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}/kb-curation-decision.schema.json`,
  title: "KbCurationDecision",
  type: "object",
  required: ["id", "candidateId", "action"],
  properties: {
    id: { type: "string" },
    candidateId: { type: "string" },
    action: { enum: ["store_new", "merge_existing", "store_variant", "reject", "evidence_only", "pending_review"] },
    targetElementId: { type: "string" },
    parentElementId: { type: "string" },
    assignedName: { type: "string" },
    assignedKind: { enum: KE_KINDS },
    assignedTags: { type: "array", items: { type: "string" } },
    assignedCompatibility: { type: "object" },
    hardRuleResult: { type: "string" },
    embeddingMatches: { type: "array", items: { type: "object", required: ["elementId", "score"] } },
    mlJudgeReason: { type: "string" },
    reason: { type: "string" },
    createdElementId: { type: "string" }
  },
  additionalProperties: true
} as const;

export const targetAssetProfileSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}/target-asset-profile.schema.json`,
  title: "TargetAssetProfile",
  type: "object",
  required: ["id", "assetId", "kind", "labels"],
  properties: {
    id: { type: "string" },
    assetId: { type: "string" },
    kind: { enum: ["image", "video", "text", "logo", "audio"] },
    labels: { type: "array", items: { type: "string" } },
    bestSection: { enum: SECTION_ROLES }
  },
  additionalProperties: true
} as const;

export const compositionProgramSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}/composition-program.schema.json`,
  title: "CompositionProgram",
  type: "object",
  required: ["id", "projectId", "creativeBrief", "selectedElements", "composition", "sections", "stylePlan", "slotPlan", "materialPlan", "audioPlan", "explanation"],
  properties: {
    id: { type: "string" },
    projectId: { type: "string" },
    creativeBrief: { type: "object" },
    selectedElements: {
      type: "array",
      items: { type: "object", required: ["elementId", "appliedRole", "priority"] }
    },
    composition: {
      type: "object",
      required: ["width", "height", "fps", "durationSec", "aspectRatio"],
      properties: { aspectRatio: { enum: ASPECT_RATIOS } }
    },
    sections: {
      type: "array",
      items: { type: "object", required: ["id", "role", "startSec", "endSec", "purpose", "elementRefs", "requiredSlots"], properties: { role: { enum: SECTION_ROLES } } }
    },
    stylePlan: {
      type: "object",
      required: ["palette", "typographySystem", "motionIntensity", "textDensity", "pacing", "coherenceNotes"]
    },
    slotPlan: { type: "array", items: { type: "object" } },
    materialPlan: { type: "object", required: ["fills"] },
    audioPlan: { type: "object", required: ["layers"] },
    explanation: {
      type: "object",
      required: ["howElementsCombine", "whyThisStructureFitsBrief", "possibleRisks"]
    }
  },
  additionalProperties: true
} as const;

export const gapReportV5Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}/gap-report-v5.schema.json`,
  title: "GapReportV5",
  type: "object",
  required: ["id", "gaps"],
  properties: {
    id: { type: "string" },
    compositionProgramId: { type: "string" },
    gaps: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "slotId", "status", "required", "matchedAssetIds", "reason", "impact", "selectedRepair", "expectedVisualOrAudioResult"],
        properties: {
          status: { enum: ["matched", "weak_match", "missing", "not_needed_after_replan"] },
          impact: { enum: ["low", "medium", "high"] },
          selectedRepair: { enum: ["asset_reuse", "text_fill", "packaging_fill", "aigc_fill", "procedural_fill", "structure_reorder"] }
        }
      }
    }
  },
  additionalProperties: true
} as const;

export const renderRecipeV5Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}/render-recipe-v5.schema.json`,
  title: "RenderRecipeV5",
  type: "object",
  required: ["version", "composition", "layers", "audioLayers", "assets"],
  properties: {
    version: { const: "render-recipe-v5" },
    composition: {
      type: "object",
      required: ["width", "height", "fps", "durationSec", "aspectRatio"],
      properties: { aspectRatio: { enum: ASPECT_RATIOS } }
    },
    layers: { type: "array", items: { type: "object", required: ["id", "type", "startSec", "endSec"] } },
    audioLayers: { type: "array", items: { type: "object", required: ["id", "kind", "startSec"] } },
    assets: { type: "array", items: { type: "object", required: ["id", "uri", "provenance"] } }
  },
  additionalProperties: true
} as const;

export const finalVideoProgramSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}/final-video-program.schema.json`,
  title: "FinalVideoProgram",
  type: "object",
  required: ["id", "compositionProgramId", "remotionProject", "renderRecipe", "explanation", "validation"],
  properties: {
    id: { type: "string" },
    compositionProgramId: { type: "string" },
    remotionProject: { type: "object", required: ["entryFile", "componentName", "files"] },
    renderRecipe: { type: "object", required: ["version", "composition", "layers", "audioLayers", "assets"] },
    explanation: { type: "object", required: ["usedElements", "gapFillDecisions", "audioDecisions"] },
    validation: {
      type: "object",
      required: ["schemaPassed", "tsCompilePassed", "noCopyPassed", "warnings"]
    }
  },
  additionalProperties: true
} as const;

export const scorecardV5Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}/scorecard-v5.schema.json`,
  title: "ScorecardV5",
  type: "object",
  required: ["id", "generationId", "gates", "rubricCoverage", "warnings"],
  properties: {
    id: { type: "string" },
    generationId: { type: "string" },
    gates: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "status"],
        properties: { status: { enum: ["pass", "fail", "warn"] } }
      }
    },
    rubricCoverage: {
      type: "array",
      items: {
        type: "object",
        required: ["rubricItem", "status", "evidenceArtifactRefs"],
        properties: { status: { enum: ["done", "partial", "missing"] } }
      }
    },
    renderQuality: { type: "object" },
    safety: { type: "object" },
    warnings: { type: "array", items: { type: "string" } }
  },
  additionalProperties: true
} as const;

export const selectionSetSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}/selection-set.schema.json`,
  title: "SelectionSet",
  type: "object",
  required: ["id", "selected"],
  properties: {
    id: { type: "string" },
    projectId: { type: "string" },
    mode: { enum: ["manual", "assisted", "hybrid"] },
    selected: { type: "array", items: { type: "object", required: ["elementId"] } }
  },
  additionalProperties: true
} as const;

export const generationRequestV5Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${ID}/generation-request-v5.schema.json`,
  title: "GenerationRequestV5",
  type: "object",
  required: ["projectId", "brief", "targetAssetIds", "options"],
  properties: {
    projectId: { type: "string" },
    brief: { type: "object" },
    targetAssetIds: { type: "array", items: { type: "string" } },
    selectedElementIds: { type: "array", items: { type: "string" } },
    autoRecommend: { type: "boolean" },
    variant: { enum: ["high_click", "high_conversion", "high_quality"] },
    options: {
      type: "object",
      required: ["materialFill", "audioFill", "finalCodegen"],
      properties: {
        materialFill: { enum: ["off", "local", "aigc"] },
        audioFill: { enum: ["off", "procedural", "aigc"] },
        finalCodegen: { enum: ["on", "off"] },
        fallbackRender: { type: "boolean" }
      }
    }
  },
  additionalProperties: true
} as const;
