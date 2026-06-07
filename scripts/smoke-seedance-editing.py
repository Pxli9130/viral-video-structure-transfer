import json, time, urllib.request
BASE="http://127.0.0.1:3000"
def req(m,p,b=None,t=2400):
    d=json.dumps(b).encode() if b is not None else None
    r=urllib.request.Request(BASE+p,data=d,method=m,headers={"content-type":"application/json"})
    with urllib.request.urlopen(r,timeout=t) as resp: return json.loads(resp.read().decode()).get("data",{})
t0=time.time()
print("=== GENERATE editing (existing capsule tpl_asset_19x0eeo) with Seedance video fill ===",flush=True)
gr=req("POST","/api/v5/generations",{
  "projectId":"proj_smoke_seedance",
  "brief":{"theme":"暗黑机能风运动鞋","aspectRatio":"9:16","variant":"high_click","sellingPoints":["碳板缓震","防水鞋面","夜跑反光","轻量科技"]},
  "options":{"templateCapsuleId":"tpl_asset_19x0eeo"}
},t=3000)
print(f"  done in {int(time.time()-t0)}s: {gr.get('generationId')} readiness={gr.get('scorecard',{}).get('readinessLevel')} url={gr.get('finalVideoUrl')}",flush=True)
import os,shutil
gid=gr.get("generationId")
if gid:
    src=f"storage/generated/v5/generations/{gid}"
    json.dump(gr,open("/tmp/smoke_gr.json","w"),ensure_ascii=False,indent=2)
    print(f"  artifacts: {src}",flush=True)
