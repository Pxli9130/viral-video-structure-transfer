#!/usr/bin/env python3
# Verify P1 (marketing white bg preserved) + P0 chunking on motion_graph_2 (39s -> chunks, black tail gone).
import json, os, shutil, time, urllib.request

BASE = "http://127.0.0.1:3000"
ROOT = "/home/pxli/viral-video-structure-transfer"
OUT = os.path.join(ROOT, "storage", "demo-runs")
GEN_DIR = os.path.join(ROOT, "storage", "generated", "v5", "generations")
LEARN_DIR = os.path.join(ROOT, "storage", "generated", "v5", "learn")

RUNS = [
    ("asset_9uos04", "test-marketing-p1", "极简智能手表", ["7天超长续航", "血氧心率监测", "50米防水", "100+ 表盘"]),
    ("asset_e23t87", "test-motion2-chunk", "暴汗能量饮料", ["200mg 咖啡因", "0 糖 0 卡", "3 秒提神", "荔枝海盐口味"]),
]

def req(method, path, body=None, timeout=2400):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method, headers={"content-type": "application/json"})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read().decode()).get("data", {})

def copytree(src, dst):
    if os.path.isdir(src):
        shutil.copytree(src, dst, dirs_exist_ok=True)

def main():
    for asset, label, theme, points in RUNS:
        run_dir = os.path.join(OUT, label)
        os.makedirs(os.path.join(run_dir, "learn"), exist_ok=True)
        os.makedirs(os.path.join(run_dir, "generate"), exist_ok=True)
        t0 = time.time()
        print(f"\n=== LEARN {label} ({asset}) ===", flush=True)
        lr = req("POST", "/api/v5/learn-samples", {"sampleAssetIds": [asset]}, timeout=2400)
        json.dump(lr, open(os.path.join(run_dir, "learn-response.json"), "w"), ensure_ascii=False, indent=2)
        learned = lr["learned"][0]
        cap = learned.get("templateCapsuleId")
        print(f"  learned in {int(time.time()-t0)}s: code={learned.get('templateCode')} renders={learned.get('templateRenders')} cap={cap}", flush=True)
        for w in (learned.get("warnings") or []):
            if "chunk" in w.lower(): print(f"    · {w}", flush=True)
        copytree(os.path.join(LEARN_DIR, asset), os.path.join(run_dir, "learn"))
        if not cap:
            print("  NO CAPSULE:", learned.get("error")); continue
        t1 = time.time()
        print(f"=== GENERATE {label} theme={theme} ===", flush=True)
        gr = req("POST", "/api/v5/generations", {
            "projectId": f"proj_{label}",
            "brief": {"theme": theme, "aspectRatio": "9:16", "variant": "high_click", "sellingPoints": points},
            "options": {"templateCapsuleId": cap}
        }, timeout=1800)
        json.dump(gr, open(os.path.join(run_dir, "generate-response.json"), "w"), ensure_ascii=False, indent=2)
        gen_id = gr.get("generationId")
        sc = gr.get("scorecard", {})
        print(f"  generated in {int(time.time()-t1)}s: {gen_id} readiness={sc.get('readinessLevel')} url={gr.get('finalVideoUrl')}", flush=True)
        if gen_id:
            copytree(os.path.join(GEN_DIR, gen_id), os.path.join(run_dir, "generate"))
    print("\n=== DONE ===", flush=True)

if __name__ == "__main__":
    main()
