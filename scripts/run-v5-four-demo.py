#!/usr/bin/env python3
# One-off demo orchestrator: for 4 test_videos, learn (DEFAULT pipeline = AI capsule codegen +
# render validation) then generate from that video's OWN template, each with a distinct theme.
# Keeps ALL artifacts (learn + generate, not just the final mp4) in an individual per-run folder.
import json, os, shutil, time, urllib.request

BASE = "http://127.0.0.1:3000"
ROOT = "/home/pxli/viral-video-structure-transfer"
OUT = os.path.join(ROOT, "storage", "demo-runs")
GEN_DIR = os.path.join(ROOT, "storage", "generated", "v5", "generations")
LEARN_DIR = os.path.join(ROOT, "storage", "generated", "v5", "learn")

# (filename, run label, theme) — 4 distinct themes.
RUNS = [
    ("editing.mov",        "run1-editing",       "AI 视频剪辑神器 教程广告"),
    ("marketing.mov",      "run2-marketing",     "极简智能手表 新品发布"),
    ("motion_graph_1.mov", "run3-motiongraph1",  "加密钱包 · 安全转账广告"),
    ("motion_graph_2.mov", "run4-motiongraph2",  "暴汗能量饮料 爆发力广告"),
]

def req(method, path, body=None, timeout=600):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method, headers={"content-type": "application/json"})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        j = json.loads(resp.read().decode())
    return j.get("data", j)

def copytree(src, dst):
    if os.path.isdir(src):
        shutil.copytree(src, dst, dirs_exist_ok=True)

def main():
    os.makedirs(OUT, exist_ok=True)
    assets = req("GET", "/api/v5/assets")["assets"]
    by_name = {}
    for a in assets:
        if a.get("type") == "video" and a.get("hasPath") and a["filename"] not in by_name:
            by_name[a["filename"]] = a["id"]
    manifest = []
    for fname, label, theme in RUNS:
        run_dir = os.path.join(OUT, label)
        os.makedirs(os.path.join(run_dir, "learn"), exist_ok=True)
        os.makedirs(os.path.join(run_dir, "generate"), exist_ok=True)
        asset_id = by_name.get(fname)
        rec = {"video": fname, "assetId": asset_id, "theme": theme, "ts": int(time.time())}
        print(f"\n=== {label} | {fname} -> {asset_id} | theme: {theme} ===", flush=True)
        if not asset_id:
            rec["error"] = "asset not found"; manifest.append(rec)
            json.dump(rec, open(os.path.join(run_dir, "summary.json"), "w"), ensure_ascii=False, indent=2); continue
        # 1) LEARN (no options -> default pipeline: AI capsule codegen + render validation)
        lr = req("POST", "/api/v5/learn-samples", {"sampleAssetIds": [asset_id]}, timeout=600)
        learned = lr["learned"][0]
        json.dump(lr, open(os.path.join(run_dir, "learn-response.json"), "w"), ensure_ascii=False, indent=2)
        cap = learned.get("templateCapsuleId")
        rec.update({"templateCapsuleId": cap, "templateCode": learned.get("templateCode"),
                    "templateCompiles": learned.get("templateCompiles"), "templateRenders": learned.get("templateRenders")})
        print(f"  learned: code={learned.get('templateCode')} renders={learned.get('templateRenders')} cap={cap}", flush=True)
        copytree(os.path.join(LEARN_DIR, asset_id), os.path.join(run_dir, "learn"))
        if not cap:
            rec["error"] = learned.get("error", "no capsule"); manifest.append(rec)
            json.dump(rec, open(os.path.join(run_dir, "summary.json"), "w"), ensure_ascii=False, indent=2); continue
        # 2) GENERATE from THIS video's own template, with its theme
        gr = req("POST", "/api/v5/generations", {
            "projectId": f"proj_demo_{label}",
            "brief": {"theme": theme, "aspectRatio": "9:16", "variant": "high_click",
                      "sellingPoints": ["亮点一", "亮点二", "亮点三"]},
            "options": {"templateCapsuleId": cap}
        }, timeout=900)
        json.dump(gr, open(os.path.join(run_dir, "generate-response.json"), "w"), ensure_ascii=False, indent=2)
        gen_id = gr.get("generationId")
        sc = gr.get("scorecard", {})
        rec.update({"generationId": gen_id, "usedTemplateCode": gr.get("usedTemplateCode"),
                    "finalVideoUrl": gr.get("finalVideoUrl"), "readiness": sc.get("readinessLevel"),
                    "demoReady": sc.get("demoReady"), "noCopy": (sc.get("safety") or {}).get("details")})
        print(f"  generated: {gen_id} usedTemplateCode={gr.get('usedTemplateCode')} readiness={sc.get('readinessLevel')}", flush=True)
        if gen_id:
            copytree(os.path.join(GEN_DIR, gen_id), os.path.join(run_dir, "generate"))
        json.dump(rec, open(os.path.join(run_dir, "summary.json"), "w"), ensure_ascii=False, indent=2)
        manifest.append(rec)
    json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), ensure_ascii=False, indent=2)
    print("\n=== DONE. manifest: storage/demo-runs/manifest.json ===", flush=True)
    for m in manifest:
        print(f"  {m['video']}: code={m.get('templateCode')} renders={m.get('templateRenders')} "
              f"-> {m.get('generationId')} ({m.get('readiness')}) {m.get('finalVideoUrl')}", flush=True)

if __name__ == "__main__":
    main()
