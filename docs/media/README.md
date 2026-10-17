# README Demo Media

These files are curated previews from the author's competition submission. Original recordings and full-resolution outputs remain unchanged in the local submission export.

| File | Content | Duration / size |
| --- | --- | --- |
| [generated-example-1.mp4](generated-example-1.mp4) | Skincare product campaign; viewing copy of `final.mp4`. | 18.43 seconds; 5.67 MiB |
| [generated-example-2.mp4](generated-example-2.mp4) | AI bookkeeping app campaign; viewing copy of `final 1.mp4`. | 31.18 seconds; 3.28 MiB |
| [generated-example-1.jpg](generated-example-1.jpg) | Frame from the skincare output at 5 seconds. | README poster |
| [generated-example-2.jpg](generated-example-2.jpg) | Frame from the bookkeeping output at 8 seconds. | README poster |
| [dashboard-walkthrough.jpg](dashboard-walkthrough.jpg) | Frame from `v5-final-demo-2.5x.mp4` at 3 minutes. | Walkthrough poster |
| [project-walkthrough.jpg](project-walkthrough.jpg) | Frame from `Video Project 4.mp4` at 2 minutes. | Walkthrough poster |
| [dashboard-capture-644.pdf](dashboard-capture-644.pdf) | Original submission UI screenshot, FireShot Capture 644. | 11.80 MiB |
| [dashboard-capture-643.pdf](dashboard-capture-643.pdf) | Original submission UI screenshot, FireShot Capture 643. | 9.89 MiB |
| [excellent-project-award.jpg](excellent-project-award.jpg) | Original Excellent Project certificate for Peixuan Li's individual submission to the 2026 ByteDance AI Full-Stack Challenge. | Certificate photograph |

The MP4 viewing copies retain the full duration and audio, encoded as 720 × 1280 H.264 video with AAC audio and fast-start metadata. Their original on-screen copy is in Chinese. Source outputs are 1080 × 1920 and approximately 20.59 MiB and 17.40 MiB respectively.

## Walkthrough recordings

The [README's demo section](../../README.md#demo-videos) links both labeled cards and their thumbnails to the uploaded recordings:

- **[V5 dashboard walkthrough on YouTube](https://youtu.be/VW6gEjYOQBI):** `v5-final-demo-2.5x.mp4`, 8:16, approximately 152.61 MiB.
- **[Project walkthrough on YouTube](https://youtu.be/8X0cOFVYbG0):** `Video Project 4.mp4`, 7:56, approximately 980.06 MiB.

Both originals exceed GitHub's 100 MiB regular-file limit, so they are kept outside the curated repository media. See [GitHub's large-file documentation](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github).

Screenshot PDFs preserve the full original submission captures. Their UI content remains in Chinese; the README prose and editable architecture diagram are in English.

## Regenerate a viewing copy

Run from the repository root, substituting the input and output paths:

```bash
ffmpeg -i /path/to/original.mp4 \
  -vf scale=720:-2 -c:v libx264 -preset medium -crf 23 \
  -c:a aac -b:a 96k -movflags +faststart \
  docs/media/generated-example-1.mp4
```

The `.gitignore` allows only the named curated files in this directory. Add a deliberate exception when introducing another preview.
