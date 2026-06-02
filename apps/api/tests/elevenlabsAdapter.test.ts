import { afterEach, describe, expect, it, vi } from "vitest";
import { ElevenLabsAdapter } from "../src/adapters/elevenlabs.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("ElevenLabsAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stays unavailable until live calls are explicitly enabled", async () => {
    const adapter = new ElevenLabsAdapter({ apiKey: "test-key", enabled: false });

    expect(adapter.available).toBe(false);
    expect(adapter.credentialSummary()).toMatchObject({ configured: true, enabled: false });
    await expect(adapter.listModels()).rejects.toThrow(/live calls are disabled/i);
  });

  it("rejects sample evidence audio before making a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new ElevenLabsAdapter({ apiKey: "test-key", enabled: true });

    await expect(adapter.transcribeAudio({
      audioPath: "/repo/test_videos/editing.mov",
      assetProvenance: "sample_evidence"
    })).rejects.toThrow(/sample_evidence audio/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects prompt-like text before TTS generation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new ElevenLabsAdapter({ apiKey: "test-key", enabled: true });

    await expect(adapter.generateVoiceover({
      text: "学习样例的视频结构，但不要复制样例音频"
    })).rejects.toThrow(/raw prompt/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses read-only model discovery endpoint when enabled", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.elevenlabs.io/v1/models");
      expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("test-key");
      return jsonResponse([{ model_id: "eleven_multilingual_v2", can_do_text_to_speech: true }]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new ElevenLabsAdapter({ apiKey: "test-key", enabled: true });

    await expect(adapter.listModels()).resolves.toEqual([{ model_id: "eleven_multilingual_v2", can_do_text_to_speech: true }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
