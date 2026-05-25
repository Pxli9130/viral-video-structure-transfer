# Fixture 005 — Synthetic platform UI tail

**Purpose:** Force the analyzer to find a tail segment to exclude from the
transferable creative structure. Real-world variant: profile pages, "follow
me" outros, recording-app stingers.

**Bug class guarded:**
- excludeSegments empty when the last 2-3s is a clearly different layout/
  palette than the creative bed. If we don't detect this, the tail visuals
  leak into the rendered new video and copy unauthorized branding.

**Expected exclude segment:** tail starting around 11-14s, reason should
contain at least one of: `platform`, `ui`, `tail`, `outro`, `recording`.

**Expected failure if analyzer regresses:**
- excludeSegments empty → likely cause: the head/tail HSV diff threshold is
  too high, or the layout stability comparison broke.
- exclude segment placed in the middle instead of tail → anchor logic broke.

**License / source:** Deterministic, OpenCV+ffmpeg generated. 13s of soft
animated bands followed by a 3s mock profile page.
