// apps/web/src/v5/V5Dashboard.tsx
// Self-contained spec_v5 demo dashboard driving /api/v5/*. Mounted via the #v5 hash route so it does
// not touch the V4 App. Flow: pick sample assets -> Learn -> browse KB -> select elements + target
// assets + brief -> Generate -> see composition / gap / scorecard / final video.
import { useCallback, useEffect, useMemo, useState } from "react";

const API = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || "";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { "content-type": "application/json" }, ...init });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => res.statusText)}`);
  return (await res.json()) as T;
}

type AssetRow = { id: string; role: string; type: string; filename: string; hasPath: boolean; tags: string[] };
type KbElement = { id: string; kind: string; name: string; description: string; tags: string[]; source: { sourceSampleId: string }; reusablePolicy: string };
type Gate = { id: string; name: string; status: "pass" | "fail" | "warn"; priority?: string; message?: string };
type Scorecard = { gates: Gate[]; rubricCoverage: Array<{ rubricItem: string; status: string }>; demoReady?: boolean; warnings: string[] };
type GenResult = {
  generationId: string;
  finalVideoUrl?: string;
  scorecard: Scorecard;
  composition: { sections: Array<{ id: string; role: string; startSec: number; endSec: number; plannedText?: string }>; stylePlan: { palette: string[] } };
  gapReport: { gaps: Array<{ slotId: string; status: string; selectedRepair: string; impact: string }> };
};

const card: React.CSSProperties = { background: "#13151a", border: "1px solid #262a33", borderRadius: 10, padding: 16, marginBottom: 16 };
const btn: React.CSSProperties = { background: "#2b6cff", color: "#fff", border: 0, borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontWeight: 600 };
const tag: React.CSSProperties = { display: "inline-block", fontSize: 11, padding: "2px 8px", borderRadius: 99, background: "#1d2430", color: "#9fb3d1", marginRight: 6 };
const gateColor = (s: string) => (s === "pass" ? "#1f9d55" : s === "fail" ? "#d6324a" : "#b78a14");

export function V5Dashboard() {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [kb, setKb] = useState<KbElement[]>([]);
  const [sampleIds, setSampleIds] = useState<string[]>([]);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [selectedEls, setSelectedEls] = useState<string[]>([]);
  const [theme, setTheme] = useState("portable fan high-click ad");
  const [sellingPoints, setSellingPoints] = useState("small, quiet, long battery");
  const [useAi, setUseAi] = useState(false);
  const [autoRender, setAutoRender] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<GenResult | null>(null);

  const refreshKb = useCallback(async () => {
    const r = await api<{ elements: KbElement[] }>("/api/v5/kb/elements");
    setKb(r.elements);
  }, []);

  const refreshAssets = useCallback(async () => {
    const r = await api<{ assets: AssetRow[] }>("/api/v5/assets");
    setAssets(r.assets);
  }, []);

  useEffect(() => {
    refreshAssets().catch((e) => setErr(String(e)));
    refreshKb().catch(() => undefined);
  }, [refreshAssets, refreshKb]);

  const videoAssets = useMemo(() => assets.filter((a) => a.type === "video" && a.hasPath), [assets]);
  const targetAssets = useMemo(() => assets.filter((a) => a.type === "image" || a.type === "video"), [assets]);

  const toggle = (arr: string[], set: (v: string[]) => void, id: string) =>
    set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };

  const learn = () =>
    run("learn", async () => {
      const r = await api<{ learned: Array<{ sampleId: string; storedElements?: number; gen1?: string; error?: string }>; kbSize: number }>(
        "/api/v5/learn-samples",
        { method: "POST", body: JSON.stringify({ sampleAssetIds: sampleIds, options: { runGen1Ai: useAi } }) }
      );
      setLog(r.learned.map((l) => (l.error ? `✗ ${l.sampleId}: ${l.error}` : `✓ ${l.sampleId}: ${l.storedElements} elements (gen1=${l.gen1})`)));
      await refreshKb();
    });

  const generate = () =>
    run("generate", async () => {
      const res = await api<GenResult>("/api/v5/generations", {
        method: "POST",
        body: JSON.stringify({
          projectId: "proj_v5_ui",
          brief: { theme, variant: "high_click", targetDurationSec: 16, aspectRatio: "9:16", sellingPoints: sellingPoints.split(",").map((s) => s.trim()).filter(Boolean) },
          targetAssetIds: targetIds,
          selectedElementIds: selectedEls.length ? selectedEls : undefined,
          options: { autoRender, runGen1Ai: useAi, runGen2Ai: useAi }
        })
      });
      setResult(res);
    });

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24, color: "#e6edf6", fontFamily: "Inter, system-ui, sans-serif" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>V5 — Program-KB Dual Codegen</h1>
        <div>
          <label style={{ marginRight: 12, fontSize: 13 }}>
            <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} /> AI Gen1/Gen2
          </label>
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={autoRender} onChange={(e) => setAutoRender(e.target.checked)} /> render final.mp4
          </label>
        </div>
      </header>

      {err && <div style={{ ...card, borderColor: "#d6324a", color: "#ffb3bf" }}>错误: {err}</div>}

      {/* 1. Learn */}
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>1 · Learn — 选择样本视频</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {videoAssets.length === 0 && <span style={{ color: "#7c8aa0" }}>没有可用样本视频（先在 V4 上传，或确认 /api/v5/assets）。</span>}
          {videoAssets.map((a) => (
            <button key={a.id} onClick={() => toggle(sampleIds, setSampleIds, a.id)} style={{ ...tag, cursor: "pointer", background: sampleIds.includes(a.id) ? "#2b6cff" : "#1d2430", color: sampleIds.includes(a.id) ? "#fff" : "#9fb3d1", padding: "6px 10px" }}>
              {a.filename}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <button style={{ ...btn, opacity: sampleIds.length && !busy ? 1 : 0.5 }} disabled={!sampleIds.length || !!busy} onClick={learn}>
            {busy === "learn" ? "学习中…" : `Learn ${sampleIds.length} 个样本`}
          </button>
        </div>
        {log.length > 0 && <pre style={{ marginTop: 12, color: "#9fb3d1", fontSize: 12, whiteSpace: "pre-wrap" }}>{log.join("\n")}</pre>}
      </section>

      {/* 2. KB + select */}
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>2 · Knowledge Base — {kb.length} elements（点选用于合成）</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
          {kb.map((e) => (
            <div key={e.id} onClick={() => toggle(selectedEls, setSelectedEls, e.id)} style={{ border: `1px solid ${selectedEls.includes(e.id) ? "#2b6cff" : "#262a33"}`, borderRadius: 8, padding: 10, cursor: "pointer", background: selectedEls.includes(e.id) ? "#16243f" : "#0f1117" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{e.name}</div>
              <div style={{ marginTop: 4 }}><span style={tag}>{e.kind}</span><span style={tag}>{e.reusablePolicy}</span></div>
              <div style={{ fontSize: 11, color: "#7c8aa0", marginTop: 6 }}>{e.description.slice(0, 80)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 3. Generate */}
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>3 · Generate — brief + target assets</h2>
        <div style={{ display: "grid", gap: 10, maxWidth: 640 }}>
          <label style={{ fontSize: 13 }}>主题<input value={theme} onChange={(e) => setTheme(e.target.value)} style={{ width: "100%", marginTop: 4, padding: 8, background: "#0f1117", border: "1px solid #262a33", borderRadius: 6, color: "#e6edf6" }} /></label>
          <label style={{ fontSize: 13 }}>卖点（逗号分隔）<input value={sellingPoints} onChange={(e) => setSellingPoints(e.target.value)} style={{ width: "100%", marginTop: 4, padding: 8, background: "#0f1117", border: "1px solid #262a33", borderRadius: 6, color: "#e6edf6" }} /></label>
          <div style={{ fontSize: 13 }}>目标素材：
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
              {targetAssets.map((a) => (
                <button key={a.id} onClick={() => toggle(targetIds, setTargetIds, a.id)} style={{ ...tag, cursor: "pointer", background: targetIds.includes(a.id) ? "#2b6cff" : "#1d2430", color: targetIds.includes(a.id) ? "#fff" : "#9fb3d1", padding: "6px 10px" }}>{a.filename}</button>
              ))}
            </div>
          </div>
          <button style={{ ...btn, opacity: kb.length && !busy ? 1 : 0.5 }} disabled={!kb.length || !!busy} onClick={generate}>
            {busy === "generate" ? "生成中…（含渲染可能数十秒）" : "Generate video"}
          </button>
        </div>
      </section>

      {/* 4. Result */}
      {result && (
        <section style={card}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>
            4 · Result · {result.generationId} · {result.scorecard.demoReady ? <span style={{ color: "#1f9d55" }}>demoReady ✓</span> : <span style={{ color: "#b78a14" }}>not demoReady</span>}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: result.finalVideoUrl ? "320px 1fr" : "1fr", gap: 20 }}>
            {result.finalVideoUrl && (
              <video src={`${API}${result.finalVideoUrl}`} controls style={{ width: 320, borderRadius: 10, background: "#000" }} />
            )}
            <div>
              <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Composition</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {result.composition.sections.map((s) => (
                  <span key={s.id} style={{ ...tag, background: "#1d2430" }}>{s.role} {s.startSec}-{s.endSec}s{s.plannedText ? `: ${s.plannedText}` : ""}</span>
                ))}
              </div>
              <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Gap report</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {result.gapReport.gaps.map((g, i) => (
                  <span key={i} style={{ ...tag, background: g.status === "missing" ? "#3a2030" : "#1d2430" }}>{g.slotId}: {g.status}→{g.selectedRepair}</span>
                ))}
              </div>
              <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Scorecard ({result.scorecard.gates.filter((g) => g.status === "pass").length}/{result.scorecard.gates.length} pass)</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {result.scorecard.gates.map((g) => (
                  <span key={g.id} title={`${g.name}${g.message ? " — " + g.message : ""}`} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: gateColor(g.status), color: "#fff" }}>{g.id}</span>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}
      <footer style={{ color: "#54607a", fontSize: 12, marginTop: 8 }}>spec_v5 · learn → KB → select → compose → render → evaluate · AI Gen1/Gen2 gated by GEMINI_API_KEY</footer>
    </div>
  );
}
