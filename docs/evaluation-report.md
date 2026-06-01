# Evaluation Report

PR3 evaluation is split into code gates and artifact gates.

## Code Gates

- TypeScript builds for shared, renderer, API and web.
- Unit tests for shared and API.
- Remotion bundle test.
- PR3 tests for version strategies, Chinese edit patches and report endpoint wiring.

## Artifact Gates

`scripts/evaluate-final-gates.mjs` writes one `final-gates.json` per case. It checks:

- local MP4 existence and dimensions;
- recipe schema marker;
- evidence and layer linkage;
- sample-frame/audio safety;
- prompt-pollution safety;
- typography bbox/font-size transfer;
- motion/audio/media layer presence;
- primitive diversity;
- gap repair metadata;
- preview frame availability;
- provider fallback policy;
- generated asset provenance.

## Report Output

`scripts/export-showcase-report.mjs` writes:

- `docs/artifacts/showcase_report/index.html`;
- `docs/artifacts/showcase_report/showcase-report.json`;
- `final-gates.json` in each discovered case root.

The report links only existing real media. Missing videos are displayed as missing/blocked, not replaced by placeholders.

