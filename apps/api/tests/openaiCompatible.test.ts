import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMockVideoAnalysis } from "@vvst/shared";
import { OpenAICompatibleAIAdapter } from "../src/adapters/openaiCompatible.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("OpenAICompatibleAIAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls chat-completions and merges structure enrichment", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe("test-model");
      expect(body.response_format).toEqual({ type: "json_object" });
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
      return jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                templateName: "高密度卖点结构",
                hookIntent: "三秒内展示核心利益点",
                bodyIntent: "每个镜头承接一个卖点",
                proofIntent: "用对比卡强化可信度",
                ctaIntent: "结尾给出直接行动",
                atomNames: ["强 hook", "快节奏", "高密字幕", "证明卡", "直接 CTA", "缺口补卡"],
                qualityRationale: "信息密度高且可迁移",
                pace: "slow",
                packagingSubtitleStyle: "大字号双行字幕"
              })
            }
          }
        ]
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OpenAICompatibleAIAdapter({
      baseUrl: "https://llm.example/v1",
      apiKey: "test-key",
      model: "test-model"
    });
    const analysis = buildMockVideoAnalysis({
      assetId: "sample",
      projectId: "project",
      purpose: "sample",
      durationSec: 15
    });
    const template = await adapter.extractStructure({
      analysis,
      projectId: "project",
      vertical: "b2b_marketing_mg"
    });

    expect(fetchMock).toHaveBeenCalledWith("https://llm.example/v1/chat/completions", expect.any(Object));
    expect(template.name).toContain("LLM · 高密度卖点结构");
    expect(template.rhythm.pace).toBe("slow");
    expect(template.segments.find((segment) => segment.role === "hook")?.intent).toBe("三秒内展示核心利益点");
    expect(template.structureAtoms.map((atom) => atom.name)).toContain("高密字幕");
  });

  it("falls back to deterministic template when the LLM call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream failed", { status: 500 }))
    );
    const adapter = new OpenAICompatibleAIAdapter({
      baseUrl: "https://llm.example/v1",
      apiKey: "test-key",
      model: "test-model"
    });
    const analysis = buildMockVideoAnalysis({
      assetId: "sample",
      projectId: "project",
      purpose: "sample",
      durationSec: 15
    });

    const template = await adapter.extractStructure({
      analysis,
      projectId: "project",
      vertical: "b2b_marketing_mg"
    });

    expect(template.qualityRationale).toContain("OpenAI-compatible LLM failed");
    expect(template.structureAtoms.length).toBeGreaterThan(0);
  });
});
