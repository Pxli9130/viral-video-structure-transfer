# Ideal editing.mov outputs v2

用于把 `editing.mov` 作为回归测试。核心不是复制原片内容，而是迁移 moving-material style grammar：moving hero object、dark moving background、beat-synced CJK typography、action montage、hard cuts、BGM beat grid、CTA。

Current latest output metrics:
```json
{
  "durationSec": 14.967,
  "sizeBytes": 416115,
  "streams": [
    {
      "type": "video",
      "codec": "h264",
      "width": 720,
      "height": 1280,
      "fps": "30/1",
      "durationSec": 14.967
    },
    {
      "type": "audio",
      "codec": "aac",
      "width": null,
      "height": null,
      "fps": "0/0",
      "durationSec": 14.953
    }
  ],
  "hasAudio": true,
  "hasVideo": true,
  "blackBgRatio": 0.882,
  "redYellowRatio": 0.012,
  "motionDiffMean": 0.025,
  "cutLikeCount": 0,
  "sampledFrames": 60
}
```

Ideal v2 metrics:
```json
{
  "durationSec": 15.0,
  "sizeBytes": 1948006,
  "streams": [
    {
      "type": "video",
      "codec": "h264",
      "width": 720,
      "height": 1280,
      "fps": "30/1",
      "durationSec": 15.0
    },
    {
      "type": "audio",
      "codec": "aac",
      "width": null,
      "height": null,
      "fps": "0/0",
      "durationSec": 15.0
    }
  ],
  "hasAudio": true,
  "hasVideo": true,
  "blackBgRatio": 0.789,
  "redYellowRatio": 0.075,
  "motionDiffMean": 0.195,
  "cutLikeCount": 19,
  "sampledFrames": 60
}
```
