export const structureTemplateSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://viral-video-structure-transfer.local/schemas/structure-template.schema.json",
  title: "StructureTemplate",
  type: "object",
  required: [
    "schemaVersion",
    "id",
    "name",
    "vertical",
    "sourceExample",
    "summary",
    "segments",
    "packaging",
    "rhythm",
    "qualityRules",
    "structureAtoms",
    "editingTechniques",
    "sourcePolicy"
  ],
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "string", const: "1.1" },
    id: { type: "string", minLength: 1 },
    projectId: { type: "string" },
    name: { type: "string", minLength: 1 },
    vertical: {
      type: "string",
      enum: ["b2b_marketing_mg", "vlog", "talking_head", "cutting_beat", "short_drama", "generic"]
    },
    sourceExample: { $ref: "#/$defs/sourceExample" },
    summary: { type: "string", minLength: 1 },
    targetDurationSec: { type: "number", minimum: 1 },
    aspectRatio: { type: "string", enum: ["9:16", "16:9", "1:1", "4:5"] },
    segments: { type: "array", minItems: 1, items: { $ref: "#/$defs/segment" } },
    packaging: { $ref: "#/$defs/packaging" },
    rhythm: { $ref: "#/$defs/rhythm" },
    qualityRules: { type: "array", minItems: 1, items: { $ref: "#/$defs/qualityRule" } },
    structureAtoms: { type: "array", minItems: 1, items: { $ref: "#/$defs/structureAtom" } },
    editingTechniques: { type: "array", items: { $ref: "#/$defs/editingTechnique" } },
    qualityRationale: { type: "string" },
    replacementPolicy: { $ref: "#/$defs/replacementPolicy" },
    sourcePolicy: { $ref: "#/$defs/sourcePolicy" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  },
  $defs: {
    sourceExample: {
      type: "object",
      required: ["assetId", "durationSec"],
      additionalProperties: false,
      properties: {
        assetId: { type: "string" },
        filename: { type: "string" },
        durationSec: { type: "number", minimum: 0 },
        width: { type: "integer", minimum: 1 },
        height: { type: "integer", minimum: 1 },
        fps: { type: "number", minimum: 0 },
        thumbnailPath: { type: "string" }
      }
    },
    segment: {
      type: "object",
      required: ["id", "role", "startSec", "endSec", "intent", "shots", "requiredSlots"],
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        role: { type: "string", enum: ["hook", "body", "proof", "transition", "cta", "other"] },
        startSec: { type: "number", minimum: 0 },
        endSec: { type: "number", minimum: 0 },
        intent: { type: "string" },
        pacing: { type: "string", enum: ["slow", "medium", "fast", "variable"] },
        sourceRationale: { type: "string" },
        requiredSlots: { type: "array", items: { $ref: "#/$defs/slot" } },
        shots: { type: "array", items: { $ref: "#/$defs/shot" } },
        packagingRefs: { type: "array", items: { type: "string" } }
      }
    },
    shot: {
      type: "object",
      required: ["id", "startSec", "endSec", "shotType", "visualIntent"],
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        startSec: { type: "number", minimum: 0 },
        endSec: { type: "number", minimum: 0 },
        shotType: {
          type: "string",
          enum: ["product_closeup", "usage_scene", "comparison", "lifestyle_scene", "text_card", "background", "cta", "unknown"]
        },
        visualIntent: { type: "string" },
        motion: { type: "string" },
        transitionIn: { type: "string" },
        transitionOut: { type: "string" },
        textOverlay: { type: "string" }
      }
    },
    slot: {
      type: "object",
      required: ["id", "slotType", "required", "description"],
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        slotType: {
          type: "string",
          enum: [
            "hook_visual",
            "product_closeup",
            "usage_scene",
            "comparison_scene",
            "proof_visual",
            "cta_visual",
            "text_or_subtitle",
            "background",
            "other"
          ]
        },
        required: { type: "boolean" },
        description: { type: "string" },
        preferredAssetTags: { type: "array", items: { type: "string" } },
        fallbackAllowed: { type: "boolean" }
      }
    },
    packaging: {
      type: "object",
      required: ["style", "subtitle", "cards", "transitions"],
      additionalProperties: false,
      properties: {
        style: { type: "string", enum: ["clean", "bold", "mg_motion", "cinematic", "ugc", "generic"] },
        subtitle: {
          type: "object",
          required: ["density", "position"],
          additionalProperties: false,
          properties: {
            density: { type: "string", enum: ["low", "medium", "high"] },
            position: { type: "string" },
            fontHint: { type: "string" },
            safeArea: { type: "string" }
          }
        },
        cards: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "purpose", "style"],
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              purpose: { type: "string" },
              style: { type: "string" }
            }
          }
        },
        stickers: { type: "array", items: { type: "string" } },
        transitions: { type: "array", items: { type: "string" } },
        coverSuggestion: { type: "string" }
      }
    },
    rhythm: {
      type: "object",
      required: ["averageShotDurationSec", "pace", "climaxPosition"],
      additionalProperties: false,
      properties: {
        averageShotDurationSec: { type: "number", minimum: 0 },
        pace: { type: "string", enum: ["slow", "medium", "fast", "variable"] },
        climaxPosition: { type: "string" },
        beatNotes: { type: "string" }
      }
    },
    qualityRule: {
      type: "object",
      required: ["id", "rule", "reason"],
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        rule: { type: "string" },
        reason: { type: "string" },
        severity: { type: "string", enum: ["info", "warning", "critical"] }
      }
    },
    structureAtom: {
      type: "object",
      required: ["id", "role", "name", "description", "applicableWhen"],
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        role: { type: "string", enum: ["hook", "body", "proof", "transition", "cta", "packaging"] },
        name: { type: "string" },
        description: { type: "string" },
        applicableWhen: { type: "string" },
        requiresSlots: { type: "array", items: { type: "string" } },
        replacementPolicy: { type: "string" },
        sourceSegmentIds: { type: "array", items: { type: "string" } }
      }
    },
    editingTechnique: {
      type: "object",
      required: ["id", "name", "description"],
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        params: { type: "object", additionalProperties: true }
      }
    },
    replacementPolicy: {
      type: "object",
      additionalProperties: false,
      properties: {
        allowSourceVideoReuse: { type: "boolean" },
        allowTextCardSubstitution: { type: "boolean" },
        allowAigcPlaceholder: { type: "boolean" },
        notes: { type: "string" }
      }
    },
    sourcePolicy: {
      type: "object",
      required: ["sampleSource", "commercialUse", "doNotCopyOriginalContent"],
      additionalProperties: false,
      properties: {
        sampleSource: {
          type: "string",
          enum: ["open_download_or_user_uploaded", "user_authorized", "demo_only", "unknown"]
        },
        commercialUse: { type: "boolean" },
        doNotCopyOriginalContent: { type: "boolean" },
        notes: { type: "string" }
      }
    }
  }
} as const;

export const generationRequestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://viral-video-structure-transfer.local/schemas/generation-request.schema.json",
  title: "GenerationRequest",
  type: "object",
  required: ["schemaVersion", "projectId", "inputMode", "prompt", "target"],
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "string", const: "1.1" },
    requestId: { type: "string" },
    projectId: { type: "string", minLength: 1 },
    inputMode: { type: "string", enum: ["video_plus_prompt", "brief_assets", "prompt_only"] },
    selectedTemplateIds: { type: "array", items: { type: "string" } },
    knowledgeBaseScope: {
      type: "object",
      additionalProperties: false,
      properties: {
        vertical: { type: "string", enum: ["b2b_marketing_mg", "vlog", "talking_head", "cutting_beat", "short_drama", "generic"] },
        preferLatest: { type: "boolean" },
        allowedAtomRoles: { type: "array", items: { type: "string" } }
      }
    },
    sourceVideo: { $ref: "#/$defs/assetRef" },
    assets: { type: "array", items: { $ref: "#/$defs/assetRef" } },
    prompt: { type: "string", minLength: 1 },
    brief: { $ref: "#/$defs/brief" },
    target: { $ref: "#/$defs/target" },
    controls: { $ref: "#/$defs/controls" },
    constraints: { $ref: "#/$defs/constraints" }
  },
  allOf: [
    {
      if: { properties: { inputMode: { const: "video_plus_prompt" } }, required: ["inputMode"] },
      then: { required: ["sourceVideo"] }
    }
  ],
  $defs: {
    assetRef: {
      type: "object",
      required: ["assetId", "role"],
      additionalProperties: false,
      properties: {
        assetId: { type: "string" },
        role: { type: "string", enum: ["source_video", "user_image", "user_text", "generated_background", "example_video"] },
        manualTags: { type: "array", items: { type: "string" } },
        notes: { type: "string" }
      }
    },
    brief: {
      type: "object",
      additionalProperties: false,
      properties: {
        topic: { type: "string" },
        productName: { type: "string" },
        targetAudience: { type: "string" },
        sellingPoints: { type: "array", items: { type: "string" } },
        tone: { type: "string" },
        cta: { type: "string" },
        forbiddenContent: { type: "array", items: { type: "string" } }
      }
    },
    target: {
      type: "object",
      required: ["vertical", "targetDurationSec", "aspectRatio", "outputMode"],
      additionalProperties: false,
      properties: {
        vertical: { type: "string", enum: ["b2b_marketing_mg", "vlog", "talking_head", "cutting_beat", "short_drama", "generic"] },
        targetDurationSec: { type: "number", minimum: 3, maximum: 300 },
        aspectRatio: { type: "string", enum: ["9:16", "16:9", "1:1", "4:5"] },
        outputMode: { type: "string", enum: ["storyboard_preview", "mp4_render"] }
      }
    },
    controls: {
      type: "object",
      additionalProperties: false,
      properties: {
        pace: { type: "string", enum: ["slow", "medium", "fast"] },
        hookIntensity: { type: "string", enum: ["safe", "strong", "aggressive"] },
        packagingStyle: { type: "string", enum: ["clean", "bold", "mg_motion"] },
        ctaStyle: { type: "string", enum: ["soft", "direct"] },
        allowAigcPlaceholder: { type: "boolean" },
        allowReorder: { type: "boolean" }
      }
    },
    constraints: {
      type: "object",
      additionalProperties: false,
      properties: {
        doNotUseSampleVisuals: { type: "boolean" },
        mustUseSourceVideo: { type: "boolean" },
        maxClips: { type: "integer", minimum: 1 },
        notes: { type: "string" }
      }
    }
  }
} as const;

export const timelineSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://viral-video-structure-transfer.local/schemas/timeline.schema.json",
  title: "Timeline",
  type: "object",
  required: [
    "schemaVersion",
    "id",
    "generationId",
    "targetDurationSec",
    "aspectRatio",
    "rendererTarget",
    "clips",
    "mapping",
    "gapReport",
    "fillPlan",
    "storyboard"
  ],
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "string", const: "1.1" },
    id: { type: "string", minLength: 1 },
    projectId: { type: "string" },
    generationId: { type: "string", minLength: 1 },
    targetDurationSec: { type: "number", minimum: 1 },
    aspectRatio: { type: "string", enum: ["9:16", "16:9", "1:1", "4:5"] },
    rendererTarget: { type: "string", enum: ["mock_preview", "html_preview", "ffmpeg", "remotion", "hyperframes"] },
    clips: { type: "array", minItems: 1, items: { $ref: "#/$defs/clip" } },
    mapping: { type: "array", items: { $ref: "#/$defs/mapping" } },
    gapReport: { type: "array", items: { $ref: "#/$defs/gap" } },
    fillPlan: { type: "array", items: { $ref: "#/$defs/fillAction" } },
    storyboard: { type: "array", minItems: 1, items: { $ref: "#/$defs/storyboardItem" } },
    renderPlan: { $ref: "#/$defs/renderPlan" },
    migrationExplanation: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
    createdAt: { type: "string" }
  },
  $defs: {
    clip: {
      type: "object",
      required: ["id", "startSec", "durationSec", "role", "visualIntent", "layers"],
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        sourceSlotId: { type: "string" },
        sourceSegmentId: { type: "string" },
        startSec: { type: "number", minimum: 0 },
        durationSec: { type: "number", exclusiveMinimum: 0 },
        role: { type: "string", enum: ["hook", "body", "proof", "transition", "cta", "other"] },
        visualIntent: { type: "string" },
        transitionIn: { type: "string" },
        transitionOut: { type: "string" },
        layers: { type: "array", minItems: 1, items: { $ref: "#/$defs/layer" } },
        gapFillStrategy: {
          type: "string",
          enum: ["none", "reuse_with_crop_zoom", "text_card", "packaging_overlay", "reorder_structure", "aigc_placeholder"]
        }
      }
    },
    layer: {
      type: "object",
      required: ["id", "type", "startOffsetSec", "durationSec"],
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        type: {
          type: "string",
          enum: ["video", "image", "text_card", "subtitle", "shape", "sticker", "generated_placeholder", "background"]
        },
        assetId: { type: "string" },
        sourceShotId: { type: "string" },
        startOffsetSec: { type: "number", minimum: 0 },
        durationSec: { type: "number", exclusiveMinimum: 0 },
        text: { type: "string" },
        style: { type: "object", additionalProperties: true },
        transform: { type: "object", additionalProperties: true },
        placeholderPrompt: { type: "string" }
      }
    },
    mapping: {
      type: "object",
      required: ["sourceId", "targetClipId", "status", "explanation"],
      additionalProperties: false,
      properties: {
        sourceId: { type: "string" },
        sourceType: { type: "string", enum: ["segment", "slot", "atom", "technique"] },
        targetClipId: { type: "string" },
        status: { type: "string", enum: ["matched", "weak_match", "missing_filled"] },
        explanation: { type: "string" },
        usedAssetIds: { type: "array", items: { type: "string" } }
      }
    },
    gap: {
      type: "object",
      required: ["id", "slotId", "gapType", "severity", "impact"],
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        slotId: { type: "string" },
        gapType: {
          type: "string",
          enum: ["hook_visual", "product_closeup", "usage_scene", "comparison_scene", "proof_visual", "cta_visual", "text_or_subtitle", "background", "other"]
        },
        severity: { type: "string", enum: ["low", "medium", "high"] },
        impact: { type: "string" },
        recommendedStrategies: {
          type: "array",
          items: { type: "string", enum: ["reuse_with_crop_zoom", "text_card", "packaging_overlay", "reorder_structure", "aigc_placeholder"] }
        }
      }
    },
    fillAction: {
      type: "object",
      required: ["id", "gapId", "strategy", "description", "resultClipId"],
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        gapId: { type: "string" },
        strategy: {
          type: "string",
          enum: ["reuse_with_crop_zoom", "text_card", "packaging_overlay", "reorder_structure", "aigc_placeholder"]
        },
        description: { type: "string" },
        resultClipId: { type: "string" },
        sourceAssetIds: { type: "array", items: { type: "string" } },
        aigcPrompt: { type: "string" }
      }
    },
    storyboardItem: {
      type: "object",
      required: ["clipId", "timeRange", "shotDescription", "subtitle", "assetUsage", "packaging"],
      additionalProperties: false,
      properties: {
        clipId: { type: "string" },
        timeRange: { type: "string" },
        shotDescription: { type: "string" },
        subtitle: { type: "string" },
        assetUsage: { type: "string" },
        packaging: { type: "string" },
        rationale: { type: "string" }
      }
    },
    renderPlan: {
      type: "object",
      additionalProperties: false,
      properties: {
        width: { type: "integer", minimum: 1 },
        height: { type: "integer", minimum: 1 },
        fps: { type: "number", minimum: 1 },
        background: { type: "string" },
        notes: { type: "string" },
        adapterOptions: { type: "object", additionalProperties: true }
      }
    }
  }
} as const;
