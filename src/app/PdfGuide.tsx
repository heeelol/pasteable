"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSpeech } from "./useSpeech";

type Step = { heading: string; anchor: string; explanation: string; emoji: string };
type Rect = { x: number; y: number; w: number; h: number };
type PageData = { items: { str: string; x: number; y: number; w: number; h: number }[]; wrapper: HTMLDivElement; overlay: HTMLDivElement };
type Loc = { page: number; rect: Rect } | null;
type Status = "idle" | "rendering" | "analyzing" | "ready" | "error";

const MAX_PAGES = 25;

function findAnchor(pages: PageData[], anchor: string): Loc {
  const want = anchor.toLowerCase().replace(/\s+/g, " ").trim();
  if (want.length < 3) return null;
  const tries = [want, want.split(" ").slice(0, 6).join(" ")];
  for (const probe of tries) {
    for (let p = 0; p < pages.length; p++) {
      const items = pages[p].items;
      let concat = "";
      const charItem: number[] = [];
      items.forEach((it, idx) => {
        if (concat.length) { concat += " "; charItem.push(-1); }
        for (let k = 0; k < it.str.length; k++) charItem.push(idx);
        concat += it.str;
      });
      const at = concat.toLowerCase().indexOf(probe);
      if (at === -1) continue;
      const used = new Set<number>();
      for (let c = at; c < at + probe.length && c < charItem.length; c++) {
        if (charItem[c] >= 0) used.add(charItem[c]);
      }
      if (!used.size) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      used.forEach((i) => {
        const it = items[i];
        x0 = Math.min(x0, it.x); y0 = Math.min(y0, it.y);
        x1 = Math.max(x1, it.x + it.w); y1 = Math.max(y1, it.y + it.h);
      });
      return { page: p, rect: { x: x0 - 3, y: y0 - 3, w: x1 - x0 + 6, h: y1 - y0 + 6 } };
    }
  }
  return null;
}

export default function PdfGuide({ lang }: { lang: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [fileName, setFileName] = useState("");
  const [title, setTitle] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState("");
  const [over, setOver] = useState(false);
  const [mode, setMode] = useState<"key" | "full">("full");

  const { speak, stop } = useSpeech(lang);
  const docTextRef = useRef("");

  const viewerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<PageData[]>([]);
  const locsRef = useRef<Loc[]>([]);
  const markersRef = useRef<(HTMLButtonElement | null)[]>([]);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const jumpRef = useRef<(i: number) => void>(() => {});
  jumpRef.current = (i: number) => setStepIndex(i);

  const renderMarkers = useCallback(() => {
    const pages = pagesRef.current;
    const locs = locsRef.current;
    pages.forEach((p) => { p.overlay.innerHTML = ""; });
    highlightRef.current = null;
    const markers: (HTMLButtonElement | null)[] = [];
    locs.forEach((loc, i) => {
      if (!loc || !pages[loc.page]) { markers[i] = null; return; }
      const m = document.createElement("button");
      m.className = "pdf-marker";
      m.type = "button";
      m.textContent = String(i + 1);
      m.setAttribute("aria-label", `Go to step ${i + 1}`);
      m.style.left = loc.rect.x + "px";
      m.style.top = loc.rect.y + "px";
      m.onclick = (e) => { e.stopPropagation(); jumpRef.current(i); };
      pages[loc.page].overlay.appendChild(m);
      markers[i] = m;
    });
    markersRef.current = markers;
  }, []);

  const drawHighlight = useCallback((idx: number) => {
    const pages = pagesRef.current;
    if (highlightRef.current) { highlightRef.current.remove(); highlightRef.current = null; }
    markersRef.current.forEach((m, j) => { if (m) m.classList.toggle("active", j === idx); });
    const loc = locsRef.current[idx];
    if (!loc || !pages[loc.page]) return;
    const box = document.createElement("div");
    box.className = "hl";
    box.style.left = loc.rect.x + "px";
    box.style.top = loc.rect.y + "px";
    box.style.width = loc.rect.w + "px";
    box.style.height = loc.rect.h + "px";
    pages[loc.page].overlay.appendChild(box);
    highlightRef.current = box;
    const wrap = pages[loc.page].wrapper;
    const cont = viewerRef.current;
    if (cont) {
      const contRect = cont.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const target = cont.scrollTop + (wrapRect.top - contRect.top) + loc.rect.y - 90;
      cont.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    }
  }, []);

  useEffect(() => { if (status === "ready") drawHighlight(stepIndex); }, [stepIndex, status, drawHighlight]);

  // auto-play: read each step aloud and advance
  useEffect(() => {
    if (status !== "ready" || !playing) return;
    const s = steps[stepIndex];
    if (!s) { setPlaying(false); return; }
    speak(`${s.heading}. ${s.explanation}`, () => {
      setStepIndex((i) => {
        if (i < steps.length - 1) return i + 1;
        setPlaying(false);
        return i;
      });
    });
  }, [playing, stepIndex, status, steps, speak]);

  // keyboard navigation
  useEffect(() => {
    if (status !== "ready") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "ArrowRight") { e.preventDefault(); setStepIndex((i) => Math.min(steps.length - 1, i + 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setStepIndex((i) => Math.max(0, i - 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, steps.length]);

  const analyze = useCallback(async (docText: string, m: "key" | "full", initial: boolean) => {
    setErr(""); stop(); setPlaying(false); setStatus("analyzing");
    try {
      const res = await fetch("/api/guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: docText, lang, mode: m }),
      });
      const g = await res.json();
      if (g.error) { setErr(g.error); setStatus(initial ? "error" : "ready"); return; }
      const gSteps: Step[] = g.steps ?? [];
      locsRef.current = gSteps.map((s) => findAnchor(pagesRef.current, s.anchor));
      renderMarkers();
      setTitle(g.title ?? "Your document, in plain words");
      setSteps(gSteps);
      setStepIndex(0);
      setStatus("ready");
    } catch {
      setErr("Could not analyze this document.");
      setStatus(initial ? "error" : "ready");
    }
  }, [lang, renderMarkers, stop]);

  const changeMode = useCallback((m: "key" | "full") => {
    if (m === mode) return;
    setMode(m);
    if (docTextRef.current && status !== "rendering" && status !== "analyzing") {
      analyze(docTextRef.current, m, false);
    }
  }, [mode, status, analyze]);

  const loadPdf = useCallback(async (file: File) => {
    setErr("");
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { setErr("Please choose a PDF file."); return; }
    stop(); setPlaying(false);
    setFileName(file.name);
    setStatus("rendering");
    setSteps([]); setStepIndex(0); setTitle("");
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const data = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({ data }).promise;
      const container = viewerRef.current!;
      container.innerHTML = "";
      const N = Math.min(doc.numPages, MAX_PAGES);
      const colWidth = container.clientWidth || 620;
      const pages: PageData[] = [];

      for (let n = 1; n <= N; n++) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2, Math.max(0.6, (colWidth - 26) / base.width));
        const viewport = page.getViewport({ scale });
        const wrapper = document.createElement("div");
        wrapper.className = "pdf-page";
        wrapper.style.width = viewport.width + "px";
        wrapper.style.height = viewport.height + "px";
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const overlay = document.createElement("div");
        overlay.className = "pdf-overlay";
        wrapper.appendChild(canvas);
        wrapper.appendChild(overlay);
        container.appendChild(wrapper);
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        const tc = await page.getTextContent();
        const items = tc.items
          .filter((it): it is import("pdfjs-dist/types/src/display/api").TextItem => "str" in it)
          .map((it) => {
            const t = pdfjs.Util.transform(viewport.transform, it.transform);
            const fh = Math.hypot(t[1], t[3]) || 10;
            return { str: it.str, x: t[4], y: t[5] - fh, w: (it.width || 0) * scale, h: fh * 1.18 };
          })
          .filter((it) => it.str.trim().length > 0);
        pages.push({ items, wrapper, overlay });
      }
      pagesRef.current = pages;

      const docText = pages.map((p) => p.items.map((i) => i.str).join(" ")).join("\n\n").trim();
      if (docText.length < 40) { setErr("This PDF has no selectable text (it may be a scan), so it can't be walked through yet."); setStatus("error"); return; }

      docTextRef.current = docText;
      await analyze(docText, mode, true);
    } catch {
      setErr("Could not open that PDF. Try another file.");
      setStatus("error");
    }
  }, [analyze, mode, stop]);

  const togglePlay = useCallback(() => {
    if (playing) { setPlaying(false); stop(); }
    else setPlaying(true);
  }, [playing, stop]);

  const reset = useCallback(() => { stop(); setPlaying(false); pagesRef.current = []; setStatus("idle"); }, [stop]);

  const step = steps[stepIndex];
  const hasLoc = status === "ready" && locsRef.current[stepIndex] != null;

  return (
    <section className="bench" style={{ paddingTop: 44 }} aria-label="Guided PDF walkthrough" id="guide">
      <div className="wrap">
        <div className="guide-head">
          <div className="section-label" style={{ marginBottom: 0 }}>
            <h2>Walk me through a PDF</h2>
            <p>Upload a form or contract. Get guided, step by step, with each part highlighted and explained aloud.</p>
          </div>
          <div className="mode-toggle" role="group" aria-label="Walkthrough depth">
            <button className="mode-btn" aria-pressed={mode === "key"} onClick={() => changeMode("key")} title="A curated handful of the most important points">Key points</button>
            <button className="mode-btn" aria-pressed={mode === "full"} onClick={() => changeMode("full")} title="Every important point, clause by clause">Comprehensive</button>
          </div>
        </div>

        {status === "idle" || status === "error" ? (
          <div
            className={`drop${over ? " over" : ""}`}
            style={{ minHeight: 200 }}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) loadPdf(f); }}
            onClick={() => inputRef.current?.click()}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
            aria-label="Upload a PDF to walk through"
          >
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /><path d="M9 13h6M9 17h4" /></svg>
            <p><strong>Drop or click</strong> to choose a PDF form or contract.</p>
            {err && <p className="err" role="alert">{err}</p>}
            <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadPdf(f); e.currentTarget.value = ""; }} />
          </div>
        ) : (
          <div className="guide-grid">
            <div className="guide-doc">
              <div className="guide-doc-head">
                <span className="panel-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</span>
                <button className="iconbtn" onClick={reset}>New PDF</button>
              </div>
              <div className="guide-viewer" ref={viewerRef} />
            </div>

            <aside className="guide-panel">
              {status !== "ready" ? (
                <div className="guide-loading">
                  <span className="spinner" aria-hidden="true" />
                  <p className="big">{status === "rendering" ? "Opening the document…" : "Reading it for you…"}</p>
                  <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>Finding the parts that matter and putting them in plain words.</p>
                </div>
              ) : step ? (
                <>
                  <div className="guide-progress">
                    <span className="eyebrow">Step {stepIndex + 1} of {steps.length}</span>
                    <div className="progress-dots">
                      {steps.map((_, i) => (
                        <button key={i} className={`pdot${i === stepIndex ? " on" : ""}`} onClick={() => setStepIndex(i)} aria-label={`Go to step ${i + 1}`} />
                      ))}
                    </div>
                  </div>
                  <div className="guide-bar"><div className="guide-bar-fill" style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} /></div>
                  {title && <p className="guide-title">{title}</p>}
                  <div className="guide-step">
                    <span className="step-emoji" aria-hidden="true">{step.emoji || "📌"}</span>
                    <h3>{step.heading}</h3>
                    <p className="step-explain" aria-live="polite">{step.explanation}</p>
                    {!hasLoc && <p className="step-note">This part is in the document text; it could not be pinpointed on the page.</p>}
                  </div>
                  <div className="guide-actions">
                    <button className={`btn${playing ? " ghost" : ""}`} onClick={togglePlay}>
                      {playing ? "⏸ Pause" : "▶ Guide me through it"}
                    </button>
                    <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                      <button className="iconbtn" onClick={() => setStepIndex((i) => Math.max(0, i - 1))} disabled={stepIndex === 0} aria-label="Previous step">← Back</button>
                      <button className="iconbtn" onClick={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))} disabled={stepIndex === steps.length - 1} aria-label="Next step">Next →</button>
                    </div>
                  </div>
                  <p className="guide-hint">Tip: use the ← and → arrow keys, or click a numbered pin on the document.</p>
                </>
              ) : null}
            </aside>
          </div>
        )}
      </div>
    </section>
  );
}
