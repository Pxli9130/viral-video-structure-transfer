# Fixture 003 — Synthetic thin orbit

**Purpose:** This is the most important fixture in the suite. It exists to
prevent the historical bug where thin 2D arc lines were misclassified as
`wide_surface_ribbon_2_5d` and triggered the wide ribbon renderer atom.

**Bug class guarded:**
- analyzer must NEVER classify thin stroke-only motion as a wide ribbon
  surface; band width should stay low (≤35px in our heuristic).
- renderer atom selection must NEVER suggest `wide_3d_ribbon_surface` for
  this input.

**Expected motif:** `orbit_line_2d` is the canonical class. On a quiet white
background with only thin strokes moving, the analyzer may instead lean
`static_poster` because layout stability dominates. Either is acceptable
*provided* it is NOT a wide ribbon.

**Expected failure if analyzer regresses:**
- primary motif becomes `wide_surface_ribbon_2_5d` → the wide-ribbon
  heuristic is over-firing on thin colored geometry. The thin/wide
  distinction is the renderer-bug-of-record this whole regression set
  exists to prevent.
- bandWidthEstimate exceeds 35px → review the run-length detection.

**License / source:** Deterministic, OpenCV+ffmpeg generated.
