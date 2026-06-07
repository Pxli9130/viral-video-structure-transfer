#!/usr/bin/env python3
# Export every learned RemotionTemplateCapsule's actual Remotion code + metadata into an individual,
# human-readable directory: storage/remotion-templates/<capsuleId>/{index.tsx, capsule-meta.json,
# scene-recipes.json, README.md}. Also exports each demo-run's AS-RENDERED remotion project (capsule
# code + the bound fixture used to render) when present.
import json, os, shutil

ROOT = "/home/pxli/viral-video-structure-transfer"
KB = os.path.join(ROOT, "storage", "kb", "knowledge-base.json")
OUT = os.path.join(ROOT, "storage", "remotion-templates")
DEMO = os.path.join(ROOT, "storage", "demo-runs")

def writef(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

def learn_response_kinds():
    # Authoritative ai/deterministic_fallback per capsule, from each run's learn-response.json.
    kinds = {}
    if os.path.isdir(DEMO):
        for run in os.listdir(DEMO):
            lr = os.path.join(DEMO, run, "learn-response.json")
            if os.path.isfile(lr):
                try:
                    for l in json.load(open(lr)).get("learned", []):
                        if l.get("templateCapsuleId"):
                            kinds[l["templateCapsuleId"]] = l.get("templateCode")
                except Exception:
                    pass
    return kinds

def code_kind(cap, kinds):
    # authoritative: the capsule records its own provenance
    co = cap.get("quality", {}).get("codeOrigin")
    if co in ("ai", "deterministic"):
        return co
    k = kinds.get(cap["id"])
    if k:
        return "ai" if k == "ai" else "deterministic"
    return "ai" if cap.get("quality", {}).get("renderPreviewPassed") else "deterministic"

def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT, exist_ok=True)
    kb = json.load(open(KB))
    caps = kb.get("capsules", [])
    kinds = learn_response_kinds()
    index = []
    for cap in caps:
        cid = cap["id"]
        d = os.path.join(OUT, cid)
        os.makedirs(d, exist_ok=True)
        # 1) the actual Remotion template code (one or more .tsx files)
        for f in cap.get("codeBundle", {}).get("files", []):
            writef(os.path.join(d, f["path"]), f["content"])
        kind = code_kind(cap, kinds)
        nlines = sum(len(f["content"].splitlines()) for f in cap.get("codeBundle", {}).get("files", []))
        # 2) metadata (without the bulky code blob)
        meta = {k: v for k, v in cap.items() if k != "codeBundle"}
        meta["codeBundle_files"] = [f["path"] for f in cap.get("codeBundle", {}).get("files", [])]
        meta["componentName"] = cap.get("codeBundle", {}).get("componentName")
        meta["codeKind"] = kind
        writef(os.path.join(d, "capsule-meta.json"), json.dumps(meta, ensure_ascii=False, indent=2))
        # 3) per-scene visual recipes (what makes it look like its source)
        writef(os.path.join(d, "scene-recipes.json"), json.dumps(cap.get("sceneRecipes", []), ensure_ascii=False, indent=2))
        # 4) readme
        sr = cap.get("sceneRecipes", [])
        moods = ", ".join(r.get("grading", {}).get("mood", "?") for r in sr)
        q = cap.get("quality", {})
        readme = (
            f"# {cid}\n\n"
            f"- **source video (sample):** `{cap.get('sourceSampleId')}`\n"
            f"- **project:** `{cap.get('projectId')}`\n"
            f"- **component:** `{cap.get('codeBundle', {}).get('componentName')}` in `{cap.get('codeBundle', {}).get('entryFile')}`\n"
            f"- **code origin:** **{kind}** (ai = Gemini-generated TSX promoted through compile+render+no-copy gates; "
            f"deterministic = built-in recipe-driven emitter)\n"
            f"- **lines of TSX:** {nlines}\n"
            f"- **slots:** {len(cap.get('slotSchema', []))} | **duration:** {cap.get('timingSignature', {}).get('durationSec')}s "
            f"| fps {cap.get('timingSignature', {}).get('fps')}\n"
            f"- **quality:** compiles={q.get('compilePassed')} renders={q.get('renderPreviewPassed')} no-copy={q.get('noCopyTemplatePassed')}\n"
            f"- **per-scene grading moods (source look):** {moods}\n\n"
            f"`index.tsx` is the reusable, props-driven Remotion template — ALL content comes from props "
            f"(assets/copy/audio/theme/palette); it contains no sample pixels/text/paths. `scene-recipes.json` "
            f"is the content-neutral per-scene visual recipe derived from the source's keyframes.\n"
        )
        writef(os.path.join(d, "README.md"), readme)
        index.append({"id": cid, "sourceSampleId": cap.get("sourceSampleId"), "codeKind": kind,
                      "tsxLines": nlines, "slots": len(cap.get("slotSchema", [])),
                      "durationSec": cap.get("timingSignature", {}).get("durationSec"),
                      "sceneMoods": [r.get("grading", {}).get("mood") for r in sr]})

    # 5) as-rendered remotion project per demo run (capsule code + bound fixture actually used)
    if os.path.isdir(DEMO):
        for run in sorted(os.listdir(DEMO)):
            fvp = os.path.join(DEMO, run, "generate", "final-video-program.json")
            if not os.path.isfile(fvp):
                continue
            prog = json.load(open(fvp))
            rp = prog.get("remotionProject", {})
            rd = os.path.join(OUT, "_rendered", run)
            for f in rp.get("files", []):
                writef(os.path.join(rd, f["path"]), f["content"])
            writef(os.path.join(rd, "bound-props.fixture.json"), json.dumps(rp.get("fixture", {}), ensure_ascii=False, indent=2))

    writef(os.path.join(OUT, "INDEX.json"), json.dumps(index, ensure_ascii=False, indent=2))
    print(f"exported {len(caps)} template(s) to storage/remotion-templates/")
    for it in index:
        print(f"  {it['id']}: {it['codeKind']} TSX, {it['tsxLines']} lines, {it['slots']} slots, moods={it['sceneMoods']}")

if __name__ == "__main__":
    main()
