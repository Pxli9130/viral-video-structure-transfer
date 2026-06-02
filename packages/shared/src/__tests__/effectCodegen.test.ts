import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDeterministicCreativeEffectSpecFromEvidence,
  buildGeminiEffectPrompt,
  generateRemotionEffectProposal,
  readGeneratedEffectProposal,
  repairGeneratedEffectProposal,
  validateGeneratedEffectProposalEnvelope,
  writeGeneratedEffectProposal
} from "../index.js";

const spec = buildDeterministicCreativeEffectSpecFromEvidence({
  caseId: "marketing",
  techniqueKeywords: ["ribbon_sweep", "poster_layout", "gallery_cta"],
  palette: ["white", "cream"],
  createdAt: "2026-06-02T00:00:00.000Z"
});

const VALID_GEMINI_JSON = JSON.stringify({
  effectId: "RibbonGenV1",
  componentName: "RibbonPosterSweep",
  indexTsx: 'import React from "react";\nexport const RibbonPosterSweep = () => null;\nexport default RibbonPosterSweep;\n',
  schemaTs: "export interface RibbonPosterSweepProps { width: number; }\n",
  fixtureJson: '{"durationSec":15,"width":720,"height":1280,"fps":30,"assets":[],"texts":[],"colors":["#fff"],"beats":[0],"proceduralFallback":true}',
  readmeMd: "# RibbonPosterSweep\nprops\n",
  safetyNotes: ["props-driven"]
});

const VALID_ZOD_GEMINI_JSON = JSON.stringify({
  effectId: "RibbonGenZodV1",
  componentName: "RibbonPosterSweep",
  indexTsx: 'import React from "react";\nimport type { RibbonPosterSweepProps } from "./schema";\nexport const RibbonPosterSweep: React.FC<RibbonPosterSweepProps> = (props) => <div>{props.colors?.[0]}</div>;\nexport default RibbonPosterSweep;\n',
  schemaTs: 'import { z } from "zod";\nexport const CreativeEffectAssetSchema = z.object({ id: z.string(), src: z.string().optional(), role: z.string().optional(), type: z.string().optional() });\nexport const CreativeEffectTextSchema = z.object({ id: z.string().optional(), text: z.string(), role: z.string().optional() });\nexport const RibbonPosterSweepPropsSchema = z.object({ width: z.number().optional().default(1080), height: z.number().optional().default(1920), fps: z.number().optional().default(30), durationSec: z.number().optional().default(8), assets: z.array(CreativeEffectAssetSchema).optional().default([]), texts: z.array(CreativeEffectTextSchema).optional().default([]), colors: z.array(z.string()).optional().default([]), beats: z.array(z.number()).optional().default([]), stylePack: z.unknown().optional(), productTheme: z.unknown().optional(), proceduralFallback: z.boolean().optional().default(true) });\nexport type RibbonPosterSweepProps = z.infer<typeof RibbonPosterSweepPropsSchema>;\n',
  fixtureJson: '{"durationSec":15,"width":720,"height":1280,"fps":30,"assets":[],"texts":[],"colors":["#fff"],"beats":[0],"proceduralFallback":true}',
  readmeMd: "# RibbonPosterSweep\nprops\n",
  safetyNotes: ["props-driven"]
});

describe("GeneratedEffectProposal envelope (P1)", () => {
  it("requires all four files", () => {
    expect(validateGeneratedEffectProposalEnvelope({}).valid).toBe(false);
    const bad = validateGeneratedEffectProposalEnvelope({
      version: "generated-effect-proposal.v1",
      effectId: "x",
      effectName: "X",
      componentName: "X",
      motifFamily: "poster_ribbon_marketing",
      provider: "local_fallback",
      promptHash: "abc",
      safetyNotes: [],
      createdAt: "t",
      files: { "index.tsx": "x", "schema.ts": "x", "fixture.json": "x" }
    });
    expect(bad.valid).toBe(false);
    expect(bad.errors.join()).toMatch(/README\.md/);
  });

  it("writes and reads a proposal stably", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "proposal-"));
    try {
      const { proposal } = { proposal: {
        version: "generated-effect-proposal.v1" as const,
        effectId: "e1",
        motifFamily: "poster_ribbon_marketing" as const,
        effectName: "RibbonPosterSweep",
        componentName: "RibbonPosterSweep",
        files: { "index.tsx": "a", "schema.ts": "b", "fixture.json": "{}", "README.md": "c" },
        provider: "local_fallback" as const,
        promptHash: "h",
        safetyNotes: [],
        createdAt: "t"
      } };
      writeGeneratedEffectProposal(proposal, dir);
      const round = readGeneratedEffectProposal(dir);
      expect(round.files["index.tsx"]).toBe("a");
      expect(round.componentName).toBe("RibbonPosterSweep");
      expect(validateGeneratedEffectProposalEnvelope(round).valid).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Gemini codegen prompt (P2)", () => {
  const { prompt } = buildGeminiEffectPrompt({ spec });
  it("includes the safety denylist", () => {
    expect(prompt).toContain("no fs");
    expect(prompt).toContain("no process.env");
    expect(prompt).toContain("test_videos/");
    expect(prompt).toContain("no fetch");
  });
  it("includes motif-specific requirements + strict JSON ask", () => {
    expect(prompt).toContain("ribbon/silk sweep");
    expect(prompt).toContain("STRICT JSON");
    expect(prompt).toContain('"indexTsx"');
  });
  it("includes the safe Zod schema contract and fixture fallback contract", () => {
    expect(prompt).toContain("ZOD-ENABLED GENERATED EFFECT CONTRACT");
    expect(prompt).toContain('import { z } from "zod";');
    expect(prompt).toContain("RibbonPosterSweepPropsSchema");
    expect(prompt).toContain("fixtureJson MUST include");
    expect(prompt).toContain("assets: []");
    expect(prompt).toContain("proceduralFallback: true");
  });
  it("embeds the authoritative codegen layer plan when provided", () => {
    const planned = buildGeminiEffectPrompt({
      spec,
      codegenLayerPlan: {
        durationSec: 23,
        layers: [
          {
            id: "section_hero",
            type: "text",
            role: "hero",
            startSec: 0,
            durationSec: 6,
            semanticTags: ["poster", "headline"],
            params: { copy: "Launch" }
          },
          {
            id: "transition_sweep",
            type: "transition",
            role: "ribbon_sweep",
            startSec: 6,
            durationSec: 1,
            semanticTags: ["ribbon", "sweep"]
          }
        ],
        audio: { policy: "procedural" }
      }
    }).prompt;
    expect(planned).toContain("CODEGEN LAYER PLAN");
    expect(planned).toContain("fixtureJson.durationSec MUST equal 23");
    expect(planned).toContain('"role":"hero"');
    expect(planned).toContain("NEVER render debug/placeholder text");
    expect(planned).toContain("audio = { policy: \"procedural\"");
  });
  it("contains no secrets/api keys", () => {
    expect(prompt).not.toMatch(/AIza|x-goog-api-key|GEMINI_API_KEY/);
  });
});

describe("generateRemotionEffectProposal (P3)", () => {
  it("Gemini disabled -> local_fallback proposal", async () => {
    const r = await generateRemotionEffectProposal({ spec }, { env: {}, createdAt: "t" });
    expect(r.status).toBe("local_fallback");
    expect(r.provider).toBe("local_fallback");
    expect(validateGeneratedEffectProposalEnvelope(r.proposal).valid).toBe(true);
  });

  it("Gemini mocked valid -> proposal written (gemini_ok)", async () => {
    const r = await generateRemotionEffectProposal({ spec }, { geminiCall: async () => VALID_GEMINI_JSON, createdAt: "t" });
    expect(r.status).toBe("gemini_ok");
    expect(r.provider).toBe("gemini");
    expect(r.proposal.componentName).toBe("RibbonPosterSweep");
    expect(validateGeneratedEffectProposalEnvelope(r.proposal).valid).toBe(true);
    expect(r.pureGeminiOutput?.status).toBe("parsed_contract_pass");
  });

  it("Gemini mocked valid zod schema -> proposal written (gemini_ok)", async () => {
    const r = await generateRemotionEffectProposal({ spec }, { geminiCall: async () => VALID_ZOD_GEMINI_JSON, createdAt: "t" });
    expect(r.status).toBe("gemini_ok");
    expect(r.provider).toBe("gemini");
    expect(r.pureGeminiOutput?.status).toBe("parsed_contract_pass");
    expect(r.pureGeminiOutput?.contractViolations).toEqual([]);
  });

  it("Gemini mocked zod outside schema -> local fallback with pure output recorded", async () => {
    const unsafe = JSON.stringify({
      ...JSON.parse(VALID_GEMINI_JSON),
      indexTsx: 'import React from "react";\nimport { z } from "zod";\nexport const RibbonPosterSweep = () => null;\nexport default RibbonPosterSweep;\n'
    });
    const r = await generateRemotionEffectProposal({ spec }, { geminiCall: async () => unsafe, createdAt: "t" });
    expect(r.status).toBe("invalid_response");
    expect(r.provider).toBe("local_fallback");
    expect(r.pureGeminiOutput?.status).toBe("parsed_contract_failed");
    expect(r.pureGeminiOutput?.contractViolations).toContain("zod_import_outside_schema");
  });

  it("Gemini mocked malformed JSON -> repair attempted then local fallback (invalid_response)", async () => {
    const r = await generateRemotionEffectProposal({ spec }, { geminiCall: async () => "totally not json {unbalanced", createdAt: "t" });
    expect(r.status).toBe("invalid_response");
    expect(r.provider).toBe("local_fallback");
    expect(r.rawResponse).toContain("totally not json");
  });

  it("Gemini error -> explicit provider_error recorded", async () => {
    const r = await generateRemotionEffectProposal(
      { spec },
      {
        geminiCall: async () => {
          throw new Error("boom");
        },
        createdAt: "t"
      }
    );
    expect(r.status).toBe("provider_error");
    expect(r.error).toContain("boom");
    expect(validateGeneratedEffectProposalEnvelope(r.proposal).valid).toBe(true);
  });
});

describe("repairGeneratedEffectProposal (P5)", () => {
  it("mocked unsafe code is repaired (identity preserved)", async () => {
    const base = (await generateRemotionEffectProposal({ spec }, { env: {}, createdAt: "t" })).proposal;
    const fixed = JSON.stringify({
      effectId: "ignored",
      componentName: "ignored",
      indexTsx: 'import React from "react";\nexport const X = (p: { width: number }) => null;\nexport default X;\n',
      schemaTs: "export interface XProps { width: number; }\n",
      fixtureJson: '{"durationSec":15,"width":720,"height":1280,"fps":30,"assets":[],"texts":[],"colors":["#fff"],"beats":[0],"proceduralFallback":true}',
      readmeMd: "# X\n",
      safetyNotes: []
    });
    const r = await repairGeneratedEffectProposal(base, ["forbidden_module_import"], { geminiCall: async () => fixed, createdAt: "t" });
    expect(r.status).toBe("repaired");
    // identity (componentName/effectId) preserved from the original proposal
    expect(r.proposal.componentName).toBe(base.componentName);
    expect(r.proposal.effectId).toBe(base.effectId);
    expect(validateGeneratedEffectProposalEnvelope(r.proposal).valid).toBe(true);
  });

  it("failed repair keeps original proposal and is not marked repaired", async () => {
    const base = (await generateRemotionEffectProposal({ spec }, { env: {}, createdAt: "t" })).proposal;
    const r = await repairGeneratedEffectProposal(base, ["x"], { geminiCall: async () => "still not json {", createdAt: "t" });
    expect(r.status).toBe("repair_failed");
    expect(r.proposal).toBe(base);
  });

  it("repair is skipped (recorded) when Gemini is disabled", async () => {
    const base = (await generateRemotionEffectProposal({ spec }, { env: {}, createdAt: "t" })).proposal;
    const r = await repairGeneratedEffectProposal(base, ["x"], { env: {} });
    expect(r.status).toBe("repair_skipped");
    expect(r.error).toMatch(/Gemini disabled/);
  });
});
