import { describe, expect, it } from "vitest";
import {
  groundingDinoDetectionsToVisualElementGraph,
  normalizePaddleOcrRows,
  ocrRowsToTypographyEvidence,
  resolveModelRoute,
  sam2MaskTracksToVisualElementGraph,
  cotrackerPointTracksToVisualElementGraph,
  scoreTechniqueAtomsWithEmbeddingSimilarities,
  typographyEvidenceToTextLayerHints,
  validateProviderDecisionSafety,
  type TechniqueAtom
} from "../index.js";

function atomFixture(id: string, visualPattern: string): TechniqueAtom {
  return {
    id,
    name: id,
    category: "motion_atom",
    sourceSampleId: "sample_heavy_provider_test",
    sourceEvidenceRefs: ["evidence://sample_heavy_provider_test/mock"],
    visualPattern,
    timingPattern: "fast beat synced",
    requiredAssets: ["generated"],
    renderer: { preferred: "remotion_recipe_compose", component: "ParametricRibbonSurface" },
    fallbackComponent: "TypographyLayoutSequence",
    transferRules: ["transfer geometry only"],
    qualityHints: ["no sample pixels"],
    confidence: 0.8
  };
}

describe("heavy local provider routing and output normalization", () => {
  it("keeps heavy OCR/grounding/retrieval providers optional and falls back offline", () => {
    const ocr = resolveModelRoute("ocr", {
      env: {},
      localCapabilities: {
        "package:paddleocr": false,
        "package:paddle": false,
        "package:easyocr": true
      }
    });
    const grounding = resolveModelRoute("visual_grounding", {
      env: {},
      localCapabilities: {
        "package:groundingdino": false,
        "package:sam2": false,
        "package:cotracker": false
      }
    });
    const retrieval = resolveModelRoute("knowledge_retrieval", {
      env: {},
      localCapabilities: { "package:FlagEmbedding": false }
    });

    expect(ocr.selectedProvider).toBe("easyocr_current");
    expect(ocr.fallbackReason).toContain("paddleocr_vl");
    expect(ocr.fallbackReason).toContain("disabledByEnv=ENABLE_HEAVY_LOCAL_ML");
    expect(grounding.selectedProvider).toBe("opencv_flow_ocr_heuristic");
    expect(grounding.rejectedProviders.map((item) => item.provider)).toEqual(["grounding_dino", "sam2", "cotracker3"]);
    expect(grounding.consumesSamplePixelsLocally).toBe(true);
    expect(grounding.consumesSampleAudioLocally).toBe(false);
    expect(grounding.consumesSamplePixelsExternally).toBe(false);
    expect(retrieval.selectedProvider).toBe("keyword_filter");
    expect(retrieval.mediaAccessPolicy.samplePixelsAllowed).toBe(false);
    expect([ocr, grounding, retrieval].flatMap((decision) => validateProviderDecisionSafety(decision))).toEqual([]);
  });

  it("records package and weight fallback reasons when heavy local gates are enabled", () => {
    const packageMissing = resolveModelRoute("ocr", {
      env: { ENABLE_HEAVY_LOCAL_ML: "1", ENABLE_PADDLEOCR_VL: "1", ENABLE_PADDLEOCR: "1" },
      localCapabilities: {
        "package:paddleocr": false,
        "package:paddle": false,
        "package:easyocr": true
      }
    });
    expect(packageMissing.selectedProvider).toBe("easyocr_current");
    expect(packageMissing.rejectedProviders[0]).toMatchObject({
      provider: "paddleocr_vl",
      reason: expect.stringContaining("packageMissing=paddleocr,paddle")
    });

    const weightsMissing = resolveModelRoute("visual_grounding", {
      env: { ENABLE_HEAVY_LOCAL_ML: "1", ENABLE_GROUNDING_DINO: "1" },
      localCapabilities: {
        "package:groundingdino": true,
        "package:sam2": false,
        "package:cotracker": false,
        "weight:GROUNDING_DINO_CONFIG": false,
        "weight:GROUNDING_DINO_WEIGHTS": false
      }
    });
    expect(weightsMissing.selectedProvider).toBe("opencv_flow_ocr_heuristic");
    expect(weightsMissing.rejectedProviders[0].reason).toContain("weightsMissing=GROUNDING_DINO_CONFIG,GROUNDING_DINO_WEIGHTS");

    const adapterMissing = resolveModelRoute("knowledge_retrieval", {
      env: {
        ENABLE_HEAVY_LOCAL_ML: "1",
        ENABLE_BGE_M3: "1",
        BGE_M3_MODEL_PATH: "/tmp/bge-m3"
      },
      localCapabilities: {
        "package:FlagEmbedding": true,
        "weight:BGE_M3_MODEL_PATH": true
      }
    });
    expect(adapterMissing.selectedProvider).toBe("keyword_filter");
    expect(adapterMissing.rejectedProviders[0].reason).toContain("no runtime adapter is implemented");
  });

  it("normalizes mocked PaddleOCR output into typography evidence and text-layer hints", () => {
    const rows = normalizePaddleOcrRows(
      [
        {
          text: "现在入手",
          bbox: [[72, 820], [980, 820], [980, 960], [72, 960]],
          score: 0.93
        }
      ],
      { imageSize: { width: 1080, height: 1920 }, frameId: "shot_010", timeSec: 7.5, providerSource: "paddleocr_vl" }
    );
    const typography = ocrRowsToTypographyEvidence(rows, "paddle");
    const hints = typographyEvidenceToTextLayerHints(typography);

    expect(rows[0].bboxNorm).toEqual([0.067, 0.427, 0.841, 0.073]);
    expect(typography[0]).toMatchObject({
      text: "现在入手",
      layoutRole: "center_title",
      providerSource: "paddleocr_vl",
      confidence: 0.93
    });
    expect(hints[0].bboxNorm).toEqual({ x: 0.067, y: 0.427, w: 0.841, h: 0.073 });
    expect(hints[0].fontSizeRatio).toBeCloseTo(0.073);
  });

  it("normalizes mocked GroundingDINO detections into visual element graph nodes", () => {
    const graph = groundingDinoDetectionsToVisualElementGraph(
      [
        { label: "vertical 3d ribbon", score: 0.88, box: [100, 80, 540, 1200], frameId: "frame_004", timeSec: 2.2 },
        { label: "product hero object", score: 0.77, box: [0.25, 0.2, 0.5, 0.42], timeSec: 2.2 }
      ],
      { imageSize: { width: 1080, height: 1920 }, providerSource: "grounding_dino" }
    );

    expect(graph.heavyTracker).toBe("grounding_dino");
    expect(graph.elements).toHaveLength(2);
    expect(graph.elements[0]).toMatchObject({
      family: "ribbon",
      bboxTrackNorm: [{ t: 2.2, bbox: [0.093, 0.042, 0.407, 0.583] }],
      providerSource: "grounding_dino"
    });
    expect(graph.elements[1].family).toBe("hero_object");
  });

  it("converts mocked SAM2 boxes and CoTracker points into tracks without renderable sample pixels", () => {
    const masks = sam2MaskTracksToVisualElementGraph(
      [
        {
          id: "mask_hero",
          label: "foreground product",
          boxes: [
            { t: 0, bbox: [200, 300, 700, 900] },
            { t: 1, bbox: [260, 340, 760, 940] }
          ],
          frameIds: ["f0", "f1"],
          confidence: 0.86
        }
      ],
      { imageSize: { width: 1000, height: 1000 } }
    );
    const tracks = cotrackerPointTracksToVisualElementGraph([
      {
        id: "track_hero",
        label: "hero object",
        frames: [
          { t: 0, points: [[0.3, 0.3], [0.45, 0.5]] },
          { t: 1, points: [[0.36, 0.32], [0.5, 0.54]] }
        ]
      }
    ]);

    expect(masks.elements[0].bboxTrackNorm).toHaveLength(2);
    expect(masks.elements[0].appearance?.maskSource).toBe("geometry_only");
    expect(tracks.elements[0].pointTracks).toHaveLength(2);
    expect(tracks.elements[0].motionPattern).toBe("point_track");
    expect(tracks.elements[0].bboxTrackNorm?.[0].bbox[2]).toBeGreaterThan(0.15);
  });

  it("ranks TechniqueAtoms from mocked BGE-M3 embedding similarities", () => {
    const atoms = [
      atomFixture("ribbon_atom", "3d ribbon surface"),
      atomFixture("subtitle_atom", "kinetic typography subtitle")
    ];
    const results = scoreTechniqueAtomsWithEmbeddingSimilarities(
      atoms,
      [1, 0, 0],
      {
        ribbon_atom: [0.98, 0.02, 0],
        subtitle_atom: [0.1, 0.9, 0]
      }
    );

    expect(results[0]).toMatchObject({
      atomId: "ribbon_atom",
      matchedFields: ["embedding"]
    });
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });
});
