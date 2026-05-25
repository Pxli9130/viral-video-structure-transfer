# Fixture 004 — Synthetic static poster

**Purpose:** Anchor the "no motion / no motif" end of the spectrum. A motion
graphics analyzer that fires confidence on truly static frames is suspicious.

**Bug class guarded:**
- analyzer must score motion < 0.015 and layout stability > 0.6, so
  `static_poster` wins.
- renderer atom selection must NOT suggest a procedural ribbon for a
  motionless slate.

**Expected motif:** `static_poster` (occasionally `product_card`, which is
allowed via `anyOf`).

**Expected failure if analyzer regresses:**
- any ribbon or orbit motif scores ≥0.3 → the heuristic is fabricating
  motion where there is none.

**License / source:** Deterministic, OpenCV+ffmpeg generated.
