#!/usr/bin/env python3
# Focused test of the long-video chunking path: learn editing.mov (118s -> should split into ≤30s chunks,
# N Gemini calls, stitched multi-file capsule) then generate with a distinct theme (per-chunk context rewrite).
import json, os, shutil, time, urllib.request

BASE = "http://127.0.0.1:3000"
ROOT = "/home/pxli/viral-video-structure-transfer"
OUT = os.path.join(ROOT, "storage", "demo-runs", "test-editing-assetplan")
GEN_DIR = os.path.join(ROOT, "storage", "generated", "v5", "generations")
LEARN_DIR = os.path.join(ROOT, "storage", "generated", "v5", "learn")
ASSET = "asset_19x0eeo"  # editing.mov, ~118s
THEME = "赛博朋克机能风手表"
POINTS = ["全息表盘", "钛合金骨架", "霓虹光效", "AI 健康助手"]

def req(method, path, body=None, timeout=2400):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method, headers={"content-type": "application/json"})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        j = json.loads(resp.read().decode())
    return j.get("data", j)

def copytree(src, dst):
    if os.path.isdir(src):
        shutil.copytree(src, dst, dirs_exist_ok=True)

def main():
    os.makedirs(os.path.join(OUT, "learn"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "generate"), exist_ok=True)
    t0 = time.time()
    print(f"=== LEARN {ASSET} (editing.mov 118s -> chunked) ===", flush=True)
    lr = req("POST", "/api/v5/learn-samples", {"sampleAssetIds": [ASSET]}, timeout=2400)
    json.dump(lr, open(os.path.join(OUT, "learn-response.json"), "w"), ensure_ascii=False, indent=2)
    learned = lr["learned"][0]
    cap = learned.get("templateCapsuleId")
    print(f"  learned in {int(time.time()-t0)}s: code={learned.get('templateCode')} renders={learned.get('templateRenders')} cap={cap}", flush=True)
    for w in (learned.get("warnings") or []):
        if "chunk" in w.lower(): print(f"    · {w}", flush=True)
    copytree(os.path.join(LEARN_DIR, ASSET), os.path.join(OUT, "learn"))
    if not cap:
        print("  NO CAPSULE:", learned.get("error")); return
    print(f"=== GENERATE theme={THEME} ===", flush=True)
    t1 = time.time()
    gr = req("POST", "/api/v5/generations", {
        "projectId": "proj_test_editing_chunked",
        "brief": {"theme": THEME, "aspectRatio": "9:16", "variant": "high_click", "sellingPoints": POINTS},
        "options": {"templateCapsuleId": cap}
    }, timeout=1800)
    json.dump(gr, open(os.path.join(OUT, "generate-response.json"), "w"), ensure_ascii=False, indent=2)
    gen_id = gr.get("generationId")
    sc = gr.get("scorecard", {})
    print(f"  generated in {int(time.time()-t1)}s: {gen_id} readiness={sc.get('readinessLevel')} url={gr.get('finalVideoUrl')}", flush=True)
    if gen_id:
        copytree(os.path.join(GEN_DIR, gen_id), os.path.join(OUT, "generate"))
    print("=== DONE ===", flush=True)

if __name__ == "__main__":
    main()
