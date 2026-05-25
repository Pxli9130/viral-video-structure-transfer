import type { RenderOutput, RendererTarget, Timeline } from "@vvst/shared";
import { nowIso, stableId } from "@vvst/shared";

export interface RendererAdapter {
  target: RendererTarget;
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
  target: RendererTarget = "html_preview";

  async render(timeline: Timeline, generationId: string): Promise<RenderOutput> {
    const clips = timeline.clips
      .map((clip, index) => {
        const subtitleLayer = clip.layers.find((layer) => layer.kind === "subtitle");
        const subtitle = escapeHtml(clip.subtitleText ?? subtitleLayer?.text ?? clip.visualIntent ?? `Clip ${index + 1}`);
        const role = escapeHtml(clip.role);
        const fill = clip.gapFillStrategy && clip.gapFillStrategy !== "none" ? ` / ${escapeHtml(clip.gapFillStrategy)}` : "";
        const sourceTag = clip.sourceAssetId ? "source video shot" : clip.type === "text_card" ? "text card" : clip.type;
        return `<article class="clip">
  <div class="frame">
    <strong>${subtitle}</strong>
    <span>${role}${fill}</span>
  </div>
  <p>${escapeHtml(sourceTag)} · ${clip.durationSec.toFixed(1)}s</p>
</article>`;
      })
      .join("\n");

    const previewHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Timeline Preview · ${escapeHtml(timeline.id)}</title>
  <style>
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #f8fafc; color: #172033; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    .meta { color: #475569; font-size: 13px; margin-bottom: 24px; }
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
    <p class="meta">${escapeHtml(timeline.aspectRatio)} · ${timeline.durationSec.toFixed(1)}s · target: ${escapeHtml(timeline.rendererTarget)}</p>
    <div class="grid">${clips}</div>
  </main>
</body>
</html>`;

    return {
      renderId: stableId("render", generationId, timeline.id),
      generationId,
      rendererTarget: this.target,
      status: "completed",
      previewHtml,
      createdAt: nowIso()
    };
  }
}

export class MockRenderer implements RendererAdapter {
  target: RendererTarget = "mock_preview";

  async render(timeline: Timeline, generationId: string): Promise<RenderOutput> {
    return {
      renderId: stableId("render_mock", generationId, timeline.id),
      generationId,
      rendererTarget: this.target,
      status: "completed",
      previewHtml: `<p>Mock preview for timeline ${timeline.id} (${timeline.durationSec}s).</p>`,
      createdAt: nowIso()
    };
  }
}
