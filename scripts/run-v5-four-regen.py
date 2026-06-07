#!/usr/bin/env python3
# Regenerate the 4 demo videos from their EXISTING capsules (no re-learn) with real selling points,
# now that every image slot gets a distinct scene-aware AIGC visual. Updates each run's generate/ folder.
import json, os, shutil, time, urllib.request

BASE = "http://127.0.0.1:3000"
ROOT = "/home/pxli/viral-video-structure-transfer"
OUT = os.path.join(ROOT, "storage", "demo-runs")
GEN_DIR = os.path.join(ROOT, "storage", "generated", "v5", "generations")

RUNS = [
    ("run1-editing",      "tpl_asset_19x0eeo", "AI 视频剪辑神器",        ["自动卡点", "智能字幕", "一键成片", "云端协作"]),
    ("run2-marketing",    "tpl_asset_9uos04",  "极简智能手表",          ["7天超长续航", "血氧心率监测", "50米防水", "100+ 表盘"]),
    ("run3-motiongraph1", "tpl_asset_1fs9uam", "加密钱包 · 安全转账",    ["冷存储私钥", "秒级到账", "支持 50 条链", "0 手续费"]),
    ("run4-motiongraph2", "tpl_asset_e23t87",  "暴汗能量饮料",          ["200mg 咖啡因", "0 糖 0 卡", "3 秒提神", "荔枝海盐口味"]),
]

def post(path, body, timeout=900):
    r = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), method="POST", headers={"content-type": "application/json"})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read().decode()).get("data", {})

def main():
    manifest = []
    for label, cap, theme, points in RUNS:
        run_dir = os.path.join(OUT, label)
        gen_out = os.path.join(run_dir, "generate")
        print(f"\n=== {label} | {cap} | {theme} ===", flush=True)
        gr = post("/api/v5/generations", {
            "projectId": f"proj_demo_{label}",
            "brief": {"theme": theme, "aspectRatio": "9:16", "variant": "high_click", "sellingPoints": points},
            "options": {"templateCapsuleId": cap}
        })
        gen_id = gr.get("generationId")
        nassets = len(gr.get("generatedAssets") or [])
        sc = gr.get("scorecard", {})
        json.dump(gr, open(os.path.join(run_dir, "generate-response.json"), "w"), ensure_ascii=False, indent=2)
        if os.path.isdir(gen_out):
            shutil.rmtree(gen_out)
        if gen_id and os.path.isdir(os.path.join(GEN_DIR, gen_id)):
            shutil.copytree(os.path.join(GEN_DIR, gen_id), gen_out)
        rec = {"video": label, "templateCapsuleId": cap, "theme": theme, "generationId": gen_id,
               "aigcImages": nassets, "readiness": sc.get("readinessLevel"),
               "finalVideoUrl": gr.get("finalVideoUrl"), "ts": int(time.time())}
        json.dump(rec, open(os.path.join(run_dir, "summary.json"), "w"), ensure_ascii=False, indent=2)
        manifest.append(rec)
        print(f"  {gen_id}: aigcImages={nassets} readiness={sc.get('readinessLevel')} url={gr.get('finalVideoUrl')}", flush=True)
    json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), ensure_ascii=False, indent=2)
    print("\n=== DONE ===", flush=True)
    for m in manifest:
        print(f"  {m['video']}: {m['aigcImages']} real images -> {m['generationId']} ({m['readiness']}) {m['finalVideoUrl']}", flush=True)

if __name__ == "__main__":
    main()
