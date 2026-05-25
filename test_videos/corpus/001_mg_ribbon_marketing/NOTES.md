# Fixture 001 — MG ribbon marketing (real)

**Purpose:** Anchor fixture for the real-world motif this project was tuned on.

**Bug class guarded:**
- analyzer must classify wide colorful ribbon surfaces as `wide_surface_ribbon_2_5d`
  (or the adjacent `textured_3d_band`), not as static poster or particle trail.
- analyzer must detect the social-platform UI tail near the end and exclude it
  from the transferable structure.

**Expected motif:** `wide_surface_ribbon_2_5d` (occasionally `textured_3d_band` when
the analyzer leans on edge density).

**Expected failure if analyzer regresses:**
- primary motif collapses to `static_poster` → renderer would pick text-card
  fallback instead of `wide_3d_ribbon_surface`. Manual demos would still look
  okay (thanks to fixture marketing VLM data) but the motif identification
  story would be broken.
- excludeSegments empty → 15.7-18.4s 小红书 UI would leak into transferable
  structure and into rendered output.

**License / source:** demo_only. `test_videos/marketing.mov` is the original
sample fed to the engine. Not redistributable; therefore `originUrl=null` and
`videoIsReference=true` so corpus runner reads from `../../marketing.mov`
rather than expecting a copy inside this dir.

**Negative expectations:** primary motif must NOT be `static_poster` or
`particle_trail`. The motif could plausibly slide into either category if the
analyzer over-weights layout stability or under-weights band width.
