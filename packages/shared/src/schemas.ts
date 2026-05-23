export const projectSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://viral-video-structure-transfer.local/schemas/project.schema.json",
  title: "Project",
  type: "object",
  required: ["id", "name", "vertical", "aspectRatio", "targetDurationSec", "createdAt", "updatedAt"],
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    name: { type: "string", minLength: 1 },
    vertical: { enum: ["b2b_marketing_mg", "vlog", "talking_head", "beat_cut", "short_drama", "ecommerce"] },
    aspectRatio: { enum: ["9:16", "16:9", "1:1"] },
    targetDurationSec: { type: "number", minimum: 5, maximum: 180 },
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;

export const assetAnalysisSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://viral-video-structure-transfer.local/schemas/asset-analysis.schema.json",
  title: "VideoAnalysisResult",
  type: "object",
  required: ["id", "assetId", "projectId", "purpose", "metadata", "keyframes", "shots", "warnings", "analyzerMode", "createdAt"],
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    assetId: { type: "string" },
    projectId: { type: "string" },
    purpose: { enum: ["sample", "source"] },
    metadata: {
      type: "object",
      required: ["durationSec"],
      additionalProperties: true,
      properties: {
        durationSec: { type: "number", minimum: 0 },
        width: { type: "number", minimum: 1 },
        height: { type: "number", minimum: 1 },
        fps: { type: "number", minimum: 0 },
        hasAudio: { type: "boolean" },
        codec: { type: "string" }
      }
    },
    keyframes: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "timeSec"],
        additionalProperties: true,
        properties: {
          id: { type: "string" },
          timeSec: { type: "number", minimum: 0 },
          path: { type: "string" },
          description: { type: "string" },
          tags: { type: "array", items: { type: "string" } }
        }
      }
    },
    shots: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "startSec", "endSec", "durationSec", "tags", "confidence"],
        additionalProperties: true,
        properties: {
          id: { type: "string" },
          startSec: { type: "number", minimum: 0 },
          endSec: { type: "number", minimum: 0 },
          durationSec: { type: "number", minimum: 0 },
          thumbnailPath: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          notes: { type: "string" }
        }
      }
    },
    transcript: {
      type: "array",
      items: {
        type: "object",
        required: ["startSec", "endSec", "text"],
        additionalProperties: true,
        properties: {
          startSec: { type: "number" },
          endSec: { type: "number" },
          text: { type: "string" }
        }
      }
    },
    ocr: { type: "array", items: { type: "object", additionalProperties: true } },
    warnings: { type: "array", items: { type: "string" } },
    analyzerMode: { enum: ["mock", "ffmpeg", "ffmpeg_opencv", "ffmpeg_vlm_asr"] },
    createdAt: { type: "string" }
  }
} as const;

const knowledgeAtomBody = {
  type: "object",
  required: ["id", "projectId", "templateId", "role", "category", "name", "description", "applicableVerticals", "usageRules"],
  additionalProperties: true,
  properties: {
    id: { type: "string" },
    projectId: { type: "string" },
    templateId: { type: "string" },
    role: { enum: ["hook", "setup", "body", "proof", "transition", "cta"] },
    category: {
      enum: [
        "hook_pattern",
        "rhythm_pattern",
        "subtitle_style",
        "packaging_pattern",
        "transition_pattern",
        "cta_pattern",
        "gap_fill_strategy",
        "shot_pattern"
      ]
    },
    name: { type: "string" },
    description: { type: "string" },
    applicableVerticals: { type: "array", items: { type: "string" } },
    usageRules: { type: "string" },
    exampleMapping: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
} as const;

export const knowledgeAtomSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://viral-video-structure-transfer.local/schemas/knowledge-atom.schema.json",
  title: "KnowledgeAtom",
  ...knowledgeAtomBody
} as const;

export const structureTemplateSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://viral-video-structure-transfer.local/schemas/structure-template.schema.json",
  title: "StructureTemplate",
  type: "object",
  required: [
    "id",
    "projectId",
    "name",
    "vertical",
    "sourceSampleIds",
    "segments",
    "requiredSlots",
    "rhythm",
    "packaging",
    "structureAtoms",
    "editingTechniques",
    "replacementPolicy",
    "qualityRationale",
    "sourcePolicy",
    "createdAt"
  ],
  additionalProperties: true,
  properties: {
    id: { type: "string" },
    projectId: { type: "string" },
    name: { type: "string" },
    vertical: { type: "string" },
    sourceSampleIds: { type: "array", items: { type: "string" } },
    targetDurationSec: { type: "number" },
    segments: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "role", "startRatio", "endRatio", "intent", "slots"],
        additionalProperties: true,
        properties: {
          id: { type: "string" },
          role: { enum: ["hook", "setup", "body", "proof", "transition", "cta"] },
          startRatio: { type: "number", minimum: 0, maximum: 1 },
          endRatio: { type: "number", minimum: 0, maximum: 1 },
          intent: { type: "string" },
          scriptPattern: { type: "string" },
          slots: { type: "array", items: { type: "string" } },
          recommendedDurationSec: { type: "number" }
        }
      }
    },
    requiredSlots: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "role", "slotType", "required", "description"],
        additionalProperties: true,
        properties: {
          id: { type: "string" },
          role: { enum: ["hook", "setup", "body", "proof", "transition", "cta"] },
          slotType: {
            enum: [
              "hook_visual",
              "product_closeup",
              "usage_scene",
              "comparison",
              "proof_visual",
              "cta_visual",
              "subtitle_text",
              "title_card",
              "transition",
              "background"
            ]
          },
          required: { type: "boolean" },
          description: { type: "string" },
          preferredTags: { type: "array", items: { type: "string" } },
          fallbackStrategies: {
            type: "array",
            items: {
              enum: ["reuse_with_crop_zoom", "text_card", "packaging_overlay", "reorder_structure", "aigc_placeholder"]
            }
          }
        }
      }
    },
    rhythm: {
      type: "object",
      required: ["pace", "averageShotDurationSec"],
      additionalProperties: true,
      properties: {
        pace: { enum: ["slow", "medium", "fast", "mixed"] },
        averageShotDurationSec: { type: "number" },
        peakTimeRatio: { type: "number" },
        notes: { type: "string" }
      }
    },
    packaging: {
      type: "object",
      additionalProperties: true,
      properties: {
        subtitleStyle: { type: "string" },
        titleCardStyle: { type: "string" },
        overlayStyle: { type: "string" },
        transitionStyle: { type: "string" },
        coverStyle: { type: "string" }
      }
    },
    structureAtoms: { type: "array", items: knowledgeAtomBody },
    editingTechniques: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "category", "description"],
        additionalProperties: true,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          category: { type: "string" },
          description: { type: "string" },
          usageRules: { type: "string" }
        }
      }
    },
    replacementPolicy: {
      type: "object",
      additionalProperties: true,
      properties: {
        doNotCopySampleVisuals: { type: "boolean" },
        allowedTransfer: { type: "array", items: { type: "string" } },
        forbiddenTransfer: { type: "array", items: { type: "string" } }
      }
    },
    qualityRationale: { type: "string" },
    sourcePolicy: {
      type: "object",
      required: ["sampleSource", "commercialUse"],
      additionalProperties: true,
      properties: {
        sampleSource: { enum: ["user_authorized", "open_download_or_user_uploaded", "demo_only", "unknown"] },
        commercialUse: { type: "boolean" },
        notes: { type: "string" }
      }
    },
    createdAt: { type: "string" }
  }
} as const;

export const generationRequestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://viral-video-structure-transfer.local/schemas/generation-request.schema.json",
  title: "GenerationRequest",
  type: "object",
  required: ["projectId", "inputMode", "prompt", "target"],
  additionalProperties: false,
  properties: {
    projectId: { type: "string" },
    inputMode: { enum: ["video_plus_prompt", "brief_assets", "prompt_only"] },
    sourceVideo: {
      type: "object",
      required: ["assetId"],
      additionalProperties: true,
      properties: {
        assetId: { type: "string" },
        analysisId: { type: "string" }
      }
    },
    selectedTemplateIds: { type: "array", items: { type: "string" } },
    selectedAtomIds: { type: "array", items: { type: "string" } },
    assets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          assetId: { type: "string" },
          role: { type: "string" }
        }
      }
    },
    prompt: { type: "string", minLength: 1 },
    target: {
      type: "object",
      required: ["vertical", "aspectRatio", "targetDurationSec", "outputMode"],
      additionalProperties: true,
      properties: {
        vertical: { type: "string" },
        aspectRatio: { enum: ["9:16", "16:9", "1:1"] },
        targetDurationSec: { type: "number", minimum: 5, maximum: 180 },
        outputMode: { enum: ["storyboard_preview", "mp4_render", "timeline_only"] }
      }
    },
    controls: {
      type: "object",
      additionalProperties: true,
      properties: {
        pace: { enum: ["slow", "medium", "fast"] },
        hookIntensity: { enum: ["safe", "strong", "aggressive"] },
        packagingStyle: { enum: ["clean", "bold", "mg_motion"] },
        ctaStyle: { enum: ["soft", "direct"] },
        allowAigcPlaceholder: { type: "boolean" }
      }
    },
    constraints: {
      type: "object",
      additionalProperties: true,
      properties: {
        forbiddenWords: { type: "array", items: { type: "string" } },
        mustMention: { type: "array", items: { type: "string" } },
        noSampleVisualCopy: { type: "boolean" }
      }
    }
  },
  allOf: [
    {
      if: { properties: { inputMode: { const: "video_plus_prompt" } } },
      then: { required: ["sourceVideo"] }
    }
  ]
} as const;

export const timelineSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://viral-video-structure-transfer.local/schemas/timeline.schema.json",
  title: "Timeline",
  type: "object",
  required: ["id", "projectId", "generationId", "durationSec", "aspectRatio", "rendererTarget", "clips", "mapping", "gapReport", "fillPlan", "createdAt"],
  additionalProperties: true,
  properties: {
    id: { type: "string" },
    projectId: { type: "string" },
    generationId: { type: "string" },
    durationSec: { type: "number", minimum: 0 },
    aspectRatio: { enum: ["9:16", "16:9", "1:1"] },
    rendererTarget: { enum: ["mock_preview", "html_preview", "ffmpeg", "remotion", "hyperframes"] },
    clips: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "role", "startSec", "durationSec", "type", "layers"],
        additionalProperties: true,
        properties: {
          id: { type: "string" },
          role: { enum: ["hook", "setup", "body", "proof", "transition", "cta"] },
          startSec: { type: "number", minimum: 0 },
          durationSec: { type: "number", minimum: 0 },
          type: { enum: ["video", "image", "text_card", "generated_card", "placeholder"] },
          sourceAssetId: { type: "string" },
          sourceShotId: { type: "string" },
          visualIntent: { type: "string" },
          scriptText: { type: "string" },
          subtitleText: { type: "string" },
          transitionIn: { type: "string" },
          transitionOut: { type: "string" },
          layers: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "kind"],
              additionalProperties: true,
              properties: {
                id: { type: "string" },
                kind: { enum: ["base_visual", "subtitle", "title_bar", "sticker", "arrow", "highlight", "background", "audio"] },
                text: { type: "string" },
                style: { type: "object" },
                timing: { type: "object" }
              }
            }
          },
          gapFillStrategy: {
            enum: ["none", "reuse_with_crop_zoom", "text_card", "packaging_overlay", "reorder_structure", "aigc_placeholder"]
          }
        }
      }
    },
    mapping: {
      type: "array",
      items: {
        type: "object",
        required: ["templateSegmentId", "atomIds", "targetClipIds", "explanation"],
        additionalProperties: true,
        properties: {
          templateSegmentId: { type: "string" },
          atomIds: { type: "array", items: { type: "string" } },
          targetClipIds: { type: "array", items: { type: "string" } },
          explanation: { type: "string" }
        }
      }
    },
    gapReport: {
      type: "array",
      items: {
        type: "object",
        required: ["slotId", "status", "severity", "reason", "impact"],
        additionalProperties: true,
        properties: {
          slotId: { type: "string" },
          status: { enum: ["matched", "weak_match", "missing"] },
          severity: { enum: ["low", "medium", "high"] },
          reason: { type: "string" },
          impact: { type: "string" }
        }
      }
    },
    fillPlan: {
      type: "array",
      items: {
        type: "object",
        required: ["slotId", "strategy", "reason", "targetClipId"],
        additionalProperties: true,
        properties: {
          slotId: { type: "string" },
          strategy: { enum: ["reuse_with_crop_zoom", "text_card", "packaging_overlay", "reorder_structure", "aigc_placeholder"] },
          reason: { type: "string" },
          targetClipId: { type: "string" },
          rendererInstructions: { type: "object", additionalProperties: true }
        }
      }
    },
    renderPlan: { type: "object", additionalProperties: true },
    warnings: { type: "array", items: { type: "string" } },
    createdAt: { type: "string" }
  }
} as const;

export const jobSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://viral-video-structure-transfer.local/schemas/job.schema.json",
  title: "Job",
  type: "object",
  required: ["id", "type", "status", "progress", "steps", "createdAt", "updatedAt"],
  additionalProperties: true,
  properties: {
    id: { type: "string" },
    type: { enum: ["analysis", "template_extraction", "generation", "render", "export"] },
    status: { enum: ["queued", "running", "completed", "failed", "cancelled"] },
    progress: { type: "number", minimum: 0, maximum: 100 },
    steps: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "status"],
        additionalProperties: true,
        properties: {
          name: { type: "string" },
          status: { enum: ["queued", "running", "completed", "failed", "skipped"] },
          message: { type: "string" }
        }
      }
    },
    inputSummary: { type: "object", additionalProperties: true },
    outputRefs: { type: "object", additionalProperties: true },
    error: { type: "object", additionalProperties: true },
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;
