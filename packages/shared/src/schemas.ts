// Decision (locked 2026-05-23): schemas in this file are kept SEMANTICALLY EQUIVALENT to
// spec_v2/schemas/*.json rather than byte-identical. Two intentional differences:
//   1. structure-template uses an inlined knowledgeAtom body here to sidestep AJV's
//      "duplicate $id" error that fires when both knowledge-atom.schema.json and the
//      inlined items would carry the same $id at runtime.
//   2. timeline's rendererInstructions makes additionalProperties: true explicit so that
//      renderer-specific keys (e.g. drawtext params) round-trip through validation.
// Both schemas validate identical data; see spec_v2/implementation-status.md §3 for the
// full rationale and §7 "Known intentional deviations".

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

const ribbonMotionGeometrySchema = {
  type: "object",
  required: ["surfaceType", "pathFamily", "axis", "depthBehavior", "layoutRelation", "textRelation"],
  additionalProperties: true,
  properties: {
    surfaceType: { enum: ["thin_line", "wide_band", "textured_band", "particle_trail"] },
    pathFamily: { enum: ["vertical_helix", "planar_orbit", "diagonal_sweep", "horizontal_wave", "spiral_in", "wave_loop", "unknown"] },
    axis: { enum: ["screen_y", "screen_z", "screen_x", "diagonal", "unknown"] },
    depthBehavior: { enum: ["flat", "perspective_only", "front_back_crossing", "occlusion_with_title"] },
    layoutRelation: { enum: ["around_title", "background_only", "foreground_sweep", "border_frame"] },
    textRelation: { enum: ["text_on_ribbon", "near_ribbon", "none"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidenceFrames: { type: "array", items: { type: "number" } },
    turns: { type: "number" },
    radiusX: { type: "number" },
    radiusZ: { type: "number" },
    pitchY: { type: "number" }
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
    sourceFilename: { type: "string" },
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
    createdAt: { type: "string" },
    primaryMotif: { type: "object", additionalProperties: true },
    motifCandidates: { type: "array", items: { type: "object", additionalProperties: true } },
    motionGeometry: {
      type: "object",
      additionalProperties: true,
      properties: {
        ribbonMotion: ribbonMotionGeometrySchema
      }
    },
    evidenceTimeline: { type: "object", additionalProperties: true }
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
    role: { enum: ["hook", "setup", "body", "proof", "transition", "cta", "global"] },
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
    videoType: { type: "string" },
    visualStyle: {
      type: "object",
      additionalProperties: true,
      properties: {
        background: { type: "string" },
        layout: { type: "string" },
        motionAsset: { type: "string" },
        colorProgression: { type: "array", items: { type: "string" } },
        typography: { type: "string" },
        ribbonMotion: ribbonMotionGeometrySchema
      }
    },
    excludeSegments: {
      type: "array",
      items: {
        type: "object",
        required: ["startSec", "endSec", "reason"],
        additionalProperties: true,
        properties: {
          startSec: { type: "number", minimum: 0 },
          endSec: { type: "number", minimum: 0 },
          reason: { type: "string" }
        }
      }
    },
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
          role: { enum: ["hook", "setup", "body", "proof", "transition", "cta", "global"] },
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
          role: { enum: ["hook", "setup", "body", "proof", "transition", "cta", "global"] },
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
              "background",
              "audio"
            ]
          },
          required: { type: "boolean" },
          description: { type: "string" },
          preferredTags: { type: "array", items: { type: "string" } },
          fallbackStrategies: {
            type: "array",
            items: {
              enum: [
                "reuse_with_crop_zoom",
                "text_card",
                "packaging_overlay",
                "reorder_structure",
                "procedural_generation",
                "aigc_placeholder",
                "aigc_generated_asset",
                "proxy_placeholder",
                "user_asset_replace",
                "aigc_generated_material",
                "prompt_copy",
                "target_source_clips_by_motion",
                "procedural_dynamic_proxy"
              ]
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
    sampleReferenceAssetId: { type: "string" },
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
    targetAssets: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "kind"],
        additionalProperties: true,
        properties: {
          id: { type: "string" },
          kind: { enum: ["image", "video", "logo", "copy", "cta_info", "background_image"] },
          role: { type: "string" },
          path: { type: "string" },
          url: { type: "string" },
          text: { type: "string" },
          filename: { type: "string" },
          mimeType: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          metadata: { type: "object", additionalProperties: true }
        }
      }
    },
    replacementBindings: {
      type: "array",
      items: {
        type: "object",
        required: ["slotId", "assetId"],
        additionalProperties: true,
        properties: {
          slotId: { type: "string" },
          assetId: { type: "string" },
          applyMotionFromSlot: { type: "boolean" },
          createdAt: { type: "string" }
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
        allowAigcPlaceholder: { type: "boolean" },
        allowAigcMaterialGeneration: { type: "boolean" },
        allowExternalAigcProvider: { type: "boolean" },
        creativeMode: { enum: ["explainable_demo", "final_creative", "high_fidelity_style"] },
        subtitleGenerationMode: { enum: ["off", "prompt_only", "ark_doubao"] },
        subtitleDensity: { enum: ["minimal", "medium", "dense"] },
        stylePreset: { enum: ["sample_like", "clean_premium", "white_poster", "bold_mg"] },
        ctaTiming: { enum: ["early", "default", "late"] },
        ribbon: { type: "object", additionalProperties: true }
      }
    },
    constraints: {
      type: "object",
      additionalProperties: true,
      properties: {
        forbiddenWords: { type: "array", items: { type: "string" } },
        mustMention: { type: "array", items: { type: "string" } },
        noSampleVisualCopy: { type: "boolean" },
        sampleAssetReuse: { enum: ["disabled", "authorized"] }
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

export const aigcMaterialFillConfigSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://viral-video-structure-transfer.local/schemas/aigc-material-fill-config.schema.json",
  title: "AigcMaterialFillConfig",
  type: "object",
  required: [
    "enabled",
    "provider",
    "maxAssetsPerRun",
    "allowExternalUpload",
    "allowSampleFramesToProvider",
    "requireUserApprovalBeforeRender",
    "cacheEnabled"
  ],
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" },
    provider: { enum: ["mock_provider", "google_gemini_image", "local_folder_provider", "volcengine_seedream", "ark_seedance_provider_stub", "image_provider", "copy_provider", "none"] },
    maxAssetsPerRun: { type: "number", minimum: 0 },
    maxCostUsd: { type: "number", minimum: 0 },
    allowExternalUpload: { type: "boolean" },
    allowSampleFramesToProvider: { type: "boolean" },
    requireUserApprovalBeforeRender: { type: "boolean" },
    cacheEnabled: { type: "boolean" }
  }
} as const;

export const materialGenerationBriefSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://viral-video-structure-transfer.local/schemas/material-generation-brief.schema.json",
  title: "MaterialGenerationBrief",
  type: "object",
  required: [
    "id",
    "projectId",
    "generationId",
    "slotId",
    "visualFormFamily",
    "visualForm",
    "assetType",
    "count",
    "targetTheme",
    "styleConstraints",
    "structureConstraints",
    "negativePrompts",
    "evidenceRefs",
    "privacyPolicy"
  ],
  additionalProperties: true,
  properties: {
    id: { type: "string" },
    projectId: { type: "string" },
    generationId: { type: "string" },
    slotId: { type: "string" },
    visualFormFamily: { type: "string" },
    visualForm: { type: "string" },
    assetType: { enum: ["image", "image_set", "short_video", "copy", "logo_placeholder"] },
    count: { type: "number", minimum: 1 },
    targetTheme: { type: "string" },
    targetBrand: { type: "string" },
    targetAudience: { type: "string" },
    copyContext: { type: "array", items: { type: "string" } },
    promptPack: { type: "array", items: { type: "string" } },
    styleConstraints: { type: "object", additionalProperties: true },
    structureConstraints: { type: "object", additionalProperties: true },
    negativePrompts: { type: "array", items: { type: "string" } },
    evidenceRefs: { type: "object", additionalProperties: true },
    privacyPolicy: { type: "object", additionalProperties: true }
  }
} as const;

export const generatedAssetCandidateSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://viral-video-structure-transfer.local/schemas/generated-asset-candidate.schema.json",
  title: "GeneratedAssetCandidate",
  type: "object",
  required: ["id", "briefId", "slotId", "provider", "model", "type", "materialRole", "path", "prompt", "provenance", "quality"],
  additionalProperties: true,
  properties: {
    id: { type: "string" },
    briefId: { type: "string" },
    slotId: { type: "string" },
    provider: { enum: ["mock_provider", "google_gemini_image", "local_folder_provider", "volcengine_seedream", "ark_seedance_provider_stub", "image_provider", "copy_provider", "none"] },
    model: { type: "string" },
    type: { enum: ["image", "video", "copy"] },
    materialRole: { const: "aigc_generated_material" },
    path: { type: "string" },
    prompt: { type: "string" },
    negativePrompt: { type: "string" },
    provenance: { type: "object", additionalProperties: true },
    quality: { type: "object", additionalProperties: true }
  }
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
    rendererTarget: { enum: ["html_preview", "ffmpeg", "remotion", "hyperframes"] },
    clips: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "role", "startSec", "durationSec", "type", "layers"],
        additionalProperties: true,
        properties: {
          id: { type: "string" },
          role: { enum: ["hook", "setup", "body", "proof", "transition", "cta", "global"] },
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
          previewFrame: { type: "string" },
          sourceEvidenceFrame: { type: "string" },
          layers: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "kind"],
              additionalProperties: true,
              properties: {
                id: { type: "string" },
                kind: { enum: ["base_visual", "subtitle", "title_bar", "sticker", "arrow", "highlight", "background", "audio", "moving_material", "moving_video", "ticker", "beat_bars", "text", "text_overlay", "transition"] },
                text: { type: "string" },
                style: { type: "object" },
                timing: { type: "object" }
              }
            }
          },
          gapFillStrategy: {
            enum: [
              "none",
              "reuse_with_crop_zoom",
              "text_card",
              "packaging_overlay",
              "reorder_structure",
              "procedural_generation",
              "aigc_placeholder",
              "aigc_generated_asset",
              "proxy_placeholder",
              "user_asset_replace",
              "aigc_generated_material",
              "prompt_copy",
              "target_source_clips_by_motion",
              "procedural_dynamic_proxy"
            ]
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
          strategy: {
            enum: [
              "reuse_with_crop_zoom",
              "text_card",
              "packaging_overlay",
              "reorder_structure",
              "procedural_generation",
              "aigc_placeholder",
              "aigc_generated_asset",
              "proxy_placeholder",
              "user_asset_replace",
              "aigc_generated_material",
              "prompt_copy",
              "target_source_clips_by_motion",
              "procedural_dynamic_proxy"
            ]
          },
          reason: { type: "string" },
          targetClipId: { type: "string" },
          rendererInstructions: { type: "object", additionalProperties: true }
        }
      }
    },
    replacementSlots: {
      type: "array",
      items: {
        type: "object",
        required: ["slotId", "semanticLabel", "visualForm", "status", "acceptedAssetTypes"],
        additionalProperties: true,
        properties: {
          slotId: { type: "string" },
          semanticLabel: { type: "string" },
          visualForm: { type: "string" },
          status: { enum: ["missing", "proxy_generated", "user_replaced", "rendered"] },
          acceptedAssetTypes: { type: "array", items: { enum: ["image", "video", "gif", "logo", "copy", "glb", "lottie"] } },
          boundAssetId: { type: "string" },
          placeholderSpec: { type: "object", additionalProperties: true },
          motionSpec: { type: "object", additionalProperties: true },
          applyMotionFromSlot: { type: "boolean" },
          rendererBackend: { type: "string" },
          targetClipId: { type: "string" }
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
