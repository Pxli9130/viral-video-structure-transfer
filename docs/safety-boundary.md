# Safety Boundary

The product promise is structure transfer without unauthorized sample reuse.

## Non-Negotiable Checks

- `sampleFrameCopyAllowed` must be `false` for normal sample references.
- `sampleAudioCopyAllowed` must be `false`.
- Source/sample watermarks must not be reproduced.
- Prompt instructions such as "15 秒高转化", "学习样例" or "不复制样例" must not leak into visible text.
- Missing material must be a gap or a generated/user/procedural replacement with provenance.

## Honest Failure

If render output is missing, the repo must not create placeholder MP4s. It should write or report:

- missing `final.mp4`;
- missing `final.remotion.mp4`;
- `render-blocked.json` when the reason is known;
- failed/blocked G1-G20 gate entries.

## Validation Surfaces

- `scripts/evaluate-final-gates.mjs` evaluates G1-G20 for one case.
- `scripts/export-showcase-report.mjs` builds a static report without fabricating media.
- API report endpoints expose evidence and recipe details for audit.

