#!/usr/bin/env python3
# Full 4-video re-run with the AIGC footage pipeline: learn (chunked Gen1 + assetPlan for "missing 素材")
# then generate with a RANDOM DISTINCT theme each (context-rewrite + Seedance t2v for mediaKind=video slots
# + AIGC stills for the rest). Runs the videos CONCURRENTLY (VIDEO_CONCURRENCY, default 2) — within-video
# parallelism (chunks/Seedance/stills/rewrite) is handled server-side; the global render semaphore + the
# per-request AIGC cap keep memory/rate-limit bounded. Keeps all artifacts per run.
import json, os, shutil, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "http://127.0.0.1:3000"
ROOT = "/home/pxli/viral-video-structure-transfer"
OUT = os.path.join(ROOT, "storage", "demo-runs-aigc")
GEN_DIR = os.path.join(ROOT, "storage", "generated", "v5", "generations")
LEARN_DIR = os.path.join(ROOT, "storage", "generated", "v5", "learn")

# (filename, run label, RANDOM distinct theme, selling points)
RUNS = [
    ("editing.mov",        "run1-editing",      "暗黑机能风运动鞋",   ["碳板缓震", "防水鞋面", "夜跑反光", "轻量科技"]),
    ("marketing.mov",      "run2-marketing",    "野生蓝莓气泡水",     ["0 糖 0 卡", "真实果汁", "微醺气泡", "冷萃工艺"]),
    ("motion_graph_1.mov", "run3-motiongraph1", "量子计算云服务",     ["百万 QPS", "毫秒延迟", "弹性扩容", "金融级安全"]),
    ("motion_graph_2.mov", "run4-motiongraph2", "深空探索手游",       ["开放宇宙", "实时星战", "万人同服", "次世代画质"]),
]

def req(method, path, body=None, timeout=3600):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method, headers={"content-type": "application/json"})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        j = json.loads(resp.read().decode())
    return j.get("data", j)  # endpoint may or may not wrap in "data"

def copytree(src, dst):
    if os.path.isdir(src):
        shutil.copytree(src, dst, dirs_exist_ok=True)

def run_one(fname, label, theme, points, asset_id):
    run_dir = os.path.join(OUT, label)
    os.makedirs(os.path.join(run_dir, "learn"), exist_ok=True)
    os.makedirs(os.path.join(run_dir, "generate"), exist_ok=True)
    rec = {"video": fname, "assetId": asset_id, "theme": theme, "ts": int(time.time())}
    print(f"[{label}] START | {fname} -> {asset_id} | theme: {theme}", flush=True)
    if not asset_id:
        rec["error"] = "asset not found"; return rec
    t0 = time.time()
    lr = req("POST", "/api/v5/learn-samples", {"sampleAssetIds": [asset_id]}, timeout=3000)
    json.dump(lr, open(os.path.join(run_dir, "learn-response.json"), "w"), ensure_ascii=False, indent=2)
    learned = lr["learned"][0]
    cap = learned.get("templateCapsuleId")
    print(f"[{label}] learned in {int(time.time()-t0)}s: code={learned.get('templateCode')} renders={learned.get('templateRenders')} cap={cap}", flush=True)
    copytree(os.path.join(LEARN_DIR, asset_id), os.path.join(run_dir, "learn"))
    rec.update({"templateCapsuleId": cap, "templateCode": learned.get("templateCode"), "templateRenders": learned.get("templateRenders")})
    if not cap:
        rec["error"] = learned.get("error", "no capsule"); return rec
    t1 = time.time()
    gr = req("POST", "/api/v5/generations", {
        "projectId": f"proj_aigc_{label}",
        "brief": {"theme": theme, "aspectRatio": "9:16", "variant": "high_click", "sellingPoints": points},
        "options": {"templateCapsuleId": cap}
    }, timeout=4800)
    json.dump(gr, open(os.path.join(run_dir, "generate-response.json"), "w"), ensure_ascii=False, indent=2)
    gen_id = gr.get("generationId")
    sc = gr.get("scorecard", {})
    rec.update({"generationId": gen_id, "readiness": sc.get("readinessLevel"), "finalVideoUrl": gr.get("finalVideoUrl")})
    print(f"[{label}] generated in {int(time.time()-t1)}s: {gen_id} readiness={sc.get('readinessLevel')} url={gr.get('finalVideoUrl')}", flush=True)
    if gen_id:
        copytree(os.path.join(GEN_DIR, gen_id), os.path.join(run_dir, "generate"))
    json.dump(rec, open(os.path.join(run_dir, "summary.json"), "w"), ensure_ascii=False, indent=2)
    return rec

def main():
    os.makedirs(OUT, exist_ok=True)
    assets = req("GET", "/api/v5/assets")["assets"]
    by_name = {}
    for a in assets:
        if a.get("type") == "video" and a.get("hasPath") and a["filename"] not in by_name:
            by_name[a["filename"]] = a["id"]
    conc = int(os.environ.get("VIDEO_CONCURRENCY", "2"))
    print(f"=== running {len(RUNS)} videos, {conc} concurrent ===", flush=True)
    manifest = []
    with ThreadPoolExecutor(max_workers=conc) as ex:
        futs = {ex.submit(run_one, fn, lb, th, pts, by_name.get(fn)): lb for fn, lb, th, pts in RUNS}
        for fut in as_completed(futs):
            try:
                manifest.append(fut.result())
            except Exception as e:
                manifest.append({"label": futs[fut], "error": str(e)})
                print(f"[{futs[fut]}] FAILED: {e}", flush=True)
    json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), ensure_ascii=False, indent=2)
    print("\n=== DONE ===", flush=True)
    for m in manifest:
        print(f"  {m.get('video')}: code={m.get('templateCode')} -> {m.get('generationId')} ({m.get('readiness')}) theme={m.get('theme')}", flush=True)

if __name__ == "__main__":
    main()
