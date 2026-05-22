import type { RenderOutput, Timeline } from "@vvst/shared";
import { nowIso, stableId } from "@vvst/shared";

export interface RendererAdapter {
  target: "mock_preview" | "html_preview" | "ffmpeg" | "remotion" | "hyperframes";
  render(timeline: Timeline, generationId: string): Promise<RenderOutput>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export class HtmlPreviewRenderer implements RendererAdapter {
  target = "html_preview" as const;

  async render(timeline: Timeline, generationId: string): Promise<RenderOutput> {
    const clips = timeline.clips
      .map((clip, index) => {
        const subtitle = escapeHtml(
          clip.layers.find((layer) => layer.type === "subtitle")?.text ?? clip.visualIntent ?? `Clip ${index + 1}`
        );
        const source = escapeHtml(clip.role);
        const fill = clip.gapFillStrategy && clip.gapFillStrategy !== "none" ? ` / ${escapeHtml(clip.gapFillStrategy)}` : "";
        return `<article class="clip">
  <div class="frame">
    <strong>${subtitle}</strong>
    <span>${source}${fill}</span>
  </div>
  <p>${escapeHtml(clip.sourceSegmentId ?? clip.role)} · ${clip.durationSec}s</p>
</article>`;
      })
      .join("\n");

    const previewHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Timeline Preview</title>
  <style>
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #f8fafc; color: #172033; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px; }
    h1 { font-size: 28px; margin: 0 0 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
    .clip { border: 1px solid #d7dee8; border-radius: 8px; background: #fff; overflow: hidden; }
    .frame { aspect-ratio: 9 / 16; display: flex; flex-direction: column; justify-content: end; gap: 12px; padding: 18px; background: linear-gradient(160deg, #0f766e, #111827 70%); color: white; }
    .frame strong { font-size: 20px; line-height: 1.15; }
    .frame span { font-size: 12px; opacity: 0.8; }
    p { margin: 12px; font-size: 13px; color: #64748b; }
  </style>
</head>
<body>
  <main>
    <h1>Timeline Preview</h1>
    <div class="grid">${clips}</div>
  </main>
</body>
</html>`;

    return {
      renderId: stableId("render", generationId, timeline.id),
      generationId,
      rendererTarget: this.target,
      status: "succeeded",
      previewHtml,
      createdAt: nowIso()
    };
  }
}

export class MockRenderer implements RendererAdapter {
  target = "mock_preview" as const;

  async render(timeline: Timeline, generationId: string): Promise<RenderOutput> {
    return {
      renderId: stableId("render_mock", generationId, timeline.id),
      generationId,
      rendererTarget: this.target,
      status: "succeeded",
      previewHtml: "<p>Mock preview generated.</p>",
      createdAt: nowIso()
    };
  }
}
