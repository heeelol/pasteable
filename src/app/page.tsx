"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PdfGuide from "./PdfGuide";
import { useSpeech } from "./useSpeech";

/* ---------------- config ---------------- */
const LEVELS = [
  { id: "grade3", label: "Grade 3" },
  { id: "grade6", label: "Grade 6" },
  { id: "grade9", label: "Grade 9" },
  { id: "plain", label: "Plain adult" },
  { id: "expert", label: "Expert" },
] as const;

const LANGS = [
  { id: "none", label: "Keep language" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "zh", label: "Chinese (Simpl.)" },
  { id: "hi", label: "Hindi" },
  { id: "ar", label: "Arabic" },
  { id: "pt", label: "Portuguese" },
  { id: "vi", label: "Vietnamese" },
  { id: "tl", label: "Tagalog" },
  { id: "de", label: "German" },
  { id: "ja", label: "Japanese" },
];

const SAMPLE = `Notwithstanding any provision herein to the contrary, the undersigned patient hereby acknowledges and consents to the administration of the aforementioned diagnostic procedure, and further affirms that the attendant risks, including but not limited to hemorrhage, infection, and adverse reaction to anesthesia, have been disclosed in a manner sufficient to constitute informed consent, and that the patient shall be solely responsible for any charges not remitted by the applicable third-party payer within thirty (30) days of the date of service.`;

type Visual = { summary: string; points: { text: string; emoji: string }[] };

/* ---------------- readability (Flesch Reading Ease) ---------------- */
function syllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!word) return 0;
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const m = word.match(/[aeiouy]{1,2}/g);
  return m ? m.length : 1;
}
function fleschEase(text: string): number | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  if (words.length < 4 || sentences.length === 0) return null;
  const syl = words.reduce((a, w) => a + syllables(w), 0);
  const score = 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syl / words.length);
  return Math.max(0, Math.min(100, Math.round(score)));
}
function easeLabel(score: number): string {
  if (score >= 80) return "Very easy to read";
  if (score >= 60) return "Easy to read";
  if (score >= 45) return "Fairly clear";
  if (score >= 30) return "Difficult";
  return "Very difficult";
}

/* ---------------- toggles ---------------- */
function useHtmlAttr(attr: string, storageKey: string, onValue: string, offValue: string | null) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(document.documentElement.getAttribute(attr) === onValue);
  }, [attr, onValue]);
  const toggle = useCallback(() => {
    const el = document.documentElement;
    const next = el.getAttribute(attr) === onValue ? offValue : onValue;
    if (next === null) el.removeAttribute(attr);
    else el.setAttribute(attr, next);
    try {
      localStorage.setItem(storageKey, next ?? "");
    } catch {}
    setOn(next === onValue);
  }, [attr, onValue, offValue, storageKey]);
  return [on, toggle] as const;
}

/* ---------------- inline icons ---------------- */
const IconSun = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>);
const IconMoon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>);
const IconUpload = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M8 7l4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></svg>);

export default function Page() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState<string>("plain");
  const [lang, setLang] = useState<string>("none");
  const [mode, setMode] = useState<"live" | "demo" | null>(null);
  const [err, setErr] = useState("");
  const [sweep, setSweep] = useState(false);

  const [tab, setTab] = useState<"read" | "visual">("read");
  const [visual, setVisual] = useState<Visual | null>(null);
  const [visualBusy, setVisualBusy] = useState(false);
  const [illus, setIllus] = useState("");
  const [illusBusy, setIllusBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [over, setOver] = useState(false);

  const outRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [dark, toggleDark] = useHtmlAttr("data-theme", "cv-theme", "dark", "light");
  const [contrast, toggleContrast] = useHtmlAttr("data-contrast", "cv-contrast", "high", null);
  const [dyslexia, toggleDyslexia] = useHtmlAttr("data-dyslexia", "cv-dyslexia", "on", null);

  const beforeEase = useMemo(() => fleschEase(input), [input]);
  const afterEase = useMemo(() => fleschEase(output), [output]);

  const resetResults = () => { setVisual(null); setIllus(""); };

  const clarify = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setErr(""); setOutput(""); resetResults(); setBusy(true); setSweep(true);
    setTimeout(() => setSweep(false), 750);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, level, lang }),
        signal: ctrl.signal,
      });
      if (!res.ok) { setErr((await res.text()) || "Something went wrong."); setBusy(false); return; }
      setMode((res.headers.get("X-Mode") as "live" | "demo") ?? null);
      const reader = res.body?.getReader();
      const dec = new TextDecoder();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          setOutput((o) => o + dec.decode(value, { stream: true }));
          if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr("Network error. Please try again.");
    } finally {
      setBusy(false); abortRef.current = null;
    }
  }, [input, level, lang, busy]);

  /* ---- file upload ---- */
  const handleUpload = useCallback(async (file: File) => {
    setErr("");
    const name = file.name.toLowerCase();
    const isText = file.type.startsWith("text/") || /\.(txt|md|markdown|csv|tsv|json|log|xml|html?)$/.test(name);
    if (isText) {
      const t = await file.text();
      setInput(t.slice(0, 20000));
      resetResults();
      return;
    }
    setUploadBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: fd });
      const data = await res.json();
      if (data.error) setErr(data.error);
      else { setInput((data.text ?? "").slice(0, 20000)); resetResults(); }
    } catch {
      setErr("Could not read that file. Try pasting the text instead.");
    } finally {
      setUploadBusy(false);
    }
  }, []);

  /* ---- visual + illustration ---- */
  const loadVisual = useCallback(async () => {
    const text = (output || input).trim();
    if (!text) { setErr("Clarify some text first, then open the Visual view."); return; }
    setVisualBusy(true); setErr("");
    try {
      const res = await fetch("/api/visual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang }),
      });
      const data = await res.json();
      if (data.error) setErr(data.error);
      else setVisual({ summary: data.summary ?? "", points: data.points ?? [] });
    } catch {
      setErr("Could not build the visual summary.");
    } finally {
      setVisualBusy(false);
    }
  }, [output, input, lang]);

  const openVisual = useCallback(() => {
    setTab("visual");
    if (!visual && !visualBusy && (output || input).trim()) loadVisual();
  }, [visual, visualBusy, output, input, loadVisual]);

  const illustrate = useCallback(async () => {
    const text = (output || input).trim();
    if (!text) return;
    setIllusBusy(true); setErr("");
    try {
      const res = await fetch("/api/illustrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: visual?.summary || text }),
      });
      const data = await res.json();
      if (data.error) setErr(data.error);
      else setIllus(data.image ?? "");
    } catch {
      setErr("Could not generate a picture.");
    } finally {
      setIllusBusy(false);
    }
  }, [output, input, visual]);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) { setInput(t); resetResults(); }
    } catch {
      setErr("Clipboard blocked by the browser. Paste with Ctrl+V into the box instead.");
    }
  }, []);

  const { toggle, speaking } = useSpeech(lang);

  const copy = useCallback((t: string) => { navigator.clipboard?.writeText(t).catch(() => {}); }, []);
  const scrollToBench = () => document.getElementById("workbench")?.scrollIntoView({ behavior: "smooth" });

  return (
    <>
      <a href="#workbench" className="skip-link">Skip to the workbench</a>

      <header className="topbar">
        <div className="wrap topbar-inner">
          <div className="brand">
            <span className="glyph" aria-hidden="true">⌤</span>
            <span>Pasteable</span>
          </div>
          <div className="toolbar">
            <button className="iconbtn" aria-pressed={dyslexia} onClick={toggleDyslexia} title="Dyslexia-friendly reading mode">Dyslexia</button>
            <button className="iconbtn" aria-pressed={contrast} onClick={toggleContrast} title="High-contrast mode">Contrast</button>
            <button className="iconbtn" aria-pressed={dark} onClick={toggleDark} title="Toggle dark mode" aria-label="Toggle dark mode">
              {dark ? <IconSun /> : <IconMoon />}
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* hero */}
        <section className="hero">
          <div className="wrap hero-grid">
            <div>
              <p className="eyebrow">Accessibility · Plain language, pictures, and voice</p>
              <h1>Paste anything. Read it <span className="mark">your way.</span></h1>
              <p className="lede">
                Dense forms, letters, and fine print shouldn&apos;t decide who gets to understand them.
                Paste or upload the hard text and get a clear version, in pictures, read aloud, or translated.
              </p>
              <div className="hero-cta">
                <button className="btn" onClick={scrollToBench}>Paste something <span className="keycap" aria-hidden="true">Ctrl V</span></button>
                <button className="btn ghost" onClick={() => { setInput(SAMPLE); resetResults(); scrollToBench(); }}>Try a sample form</button>
              </div>
              <p className="who">
                For readers with <b>dyslexia</b>, <b>low literacy</b>, <b>limited English</b>, a <b>cognitive disability</b>, or a <b>screen reader</b>, the barrier is the same dense wall of text. Fix the text, and it&apos;s theirs.
              </p>
            </div>

            <div className="specimen" aria-hidden="true">
              <span className="spec-tag">What you paste</span>
              <p className="spec-before">
                “…the undersigned shall be solely responsible for any charges not remitted by the applicable third-party payer within thirty (30) days of the date of service.”
              </p>
              <div className="spec-arrow"><span>Pasteable</span><span className="line" /><span>Grade 6</span></div>
              <span className="spec-tag">What you get</span>
              <p className="spec-after">
                Pay any part of the bill your <span className="mark">insurance doesn&apos;t cover within 30 days</span> of your visit.
              </p>
              <div className="spec-foot">
                <span className="pill">🖼️ Pictures</span>
                <span className="pill">🔊 Read aloud</span>
                <span className="pill">🌐 10 languages</span>
              </div>
            </div>
          </div>
        </section>

        {/* workbench */}
        <section className="bench" id="workbench" aria-label="Clarify text">
          <div className="wrap">
            <div className="section-label">
              <h2>The workbench</h2>
              <p>Paste or upload on the left. Choose how it should read. Get it on the right.</p>
            </div>

            <div className="controls">
              <div className="field">
                <label id="lvl-label">Reading level</label>
                <div className="levels" role="group" aria-labelledby="lvl-label">
                  {LEVELS.map((l) => (
                    <button key={l.id} className="level" aria-pressed={level === l.id} onClick={() => setLevel(l.id)}>{l.label}</button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label htmlFor="lang">Translate to</label>
                <select id="lang" className="select" value={lang} onChange={(e) => setLang(e.target.value)}>
                  {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </div>
              <button className="btn" onClick={clarify} disabled={!input.trim() || busy} style={{ marginLeft: "auto" }}>
                {busy ? "Clarifying…" : "Clarify text"}
              </button>
            </div>
            {err && <p className="err" role="alert">{err}</p>}

            <div className="grid2">
              {/* input */}
              <div
                className={`panel${over ? " drop-over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
              >
                <div className="panel-head">
                  <span className="panel-title"><span className="dot" style={{ background: "var(--muted)" }} /> Paste or upload</span>
                  <div className="panel-actions">
                    <button className="iconbtn" onClick={() => fileRef.current?.click()} disabled={uploadBusy} title="Upload a PDF, Word, or text file">
                      <IconUpload /> {uploadBusy ? "Reading…" : "Upload"}
                    </button>
                    <button className="iconbtn" onClick={pasteFromClipboard} title="Paste from clipboard">Paste</button>
                  </div>
                  <input ref={fileRef} type="file" hidden accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,.xml,.html,.htm,.pdf,.docx,text/*,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.currentTarget.value = ""; }} />
                </div>
                <textarea
                  className="paste-area"
                  placeholder="Paste a form, a letter, an email, terms and conditions, a doctor's note… or drop a PDF or Word file here."
                  value={input}
                  onChange={(e) => { setInput(e.target.value); resetResults(); }}
                  aria-label="Text to clarify"
                />
                <div className="panel-foot">
                  {beforeEase !== null && <span className="count">Reading ease {beforeEase}/100 · {easeLabel(beforeEase)}</span>}
                  <span className="count right">{input.length.toLocaleString()} chars</span>
                </div>
              </div>

              {/* output */}
              <div className={`panel sweep${sweep ? " go" : ""}`}>
                <div className="panel-head">
                  <div className="tabs" role="tablist" aria-label="Output view">
                    <button role="tab" aria-selected={tab === "read"} className="tab" onClick={() => setTab("read")}>Read</button>
                    <button role="tab" aria-selected={tab === "visual"} className="tab" onClick={openVisual}>Visual</button>
                  </div>
                  {tab === "read" && output && (
                    <div className="panel-actions">
                      <button className="iconbtn" aria-pressed={speaking} onClick={() => toggle(output)} title="Read aloud">{speaking ? "Stop" : "Read"}</button>
                      <button className="iconbtn" onClick={() => copy(output)} title="Copy result">Copy</button>
                    </div>
                  )}
                </div>

                {tab === "read" ? (
                  <div className="reader-out" ref={outRef} aria-live="polite">
                    {output ? (
                      <>{output}{busy && <span className="cursor" aria-hidden="true" />}</>
                    ) : (
                      <div className="reader-empty">
                        <span className="keycap" aria-hidden="true">Ctrl V</span>
                        <span className="big">Your clear version appears here.</span>
                        <span>Pick a reading level, then press Clarify text.</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="reader-out visual-pane">
                    {visualBusy ? (
                      <div className="reader-empty"><span className="big">Drawing it out…</span></div>
                    ) : visual ? (
                      <>
                        {visual.summary && <p className="visual-summary">{visual.summary}</p>}
                        <div className="cards">
                          {visual.points.map((p, i) => (
                            <button className="card" key={i} onClick={() => toggle(p.text)} title="Tap to read aloud">
                              <span className="card-emoji" aria-hidden="true">{p.emoji || "•"}</span>
                              <span className="card-text">{p.text}</span>
                              <span className="card-say" aria-hidden="true">▶</span>
                            </button>
                          ))}
                        </div>
                        <div className="illus-row">
                          {illus ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className="illus" src={illus} alt="Illustration of the summary" />
                          ) : (
                            <button className="btn ghost" onClick={illustrate} disabled={illusBusy}>
                              {illusBusy ? "Drawing a picture…" : "🎨 Generate a picture"}
                            </button>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="reader-empty">
                        <span className="big">A picture-based summary appears here.</span>
                        <span>Clarify some text, then open this view.</span>
                        {(output || input).trim() && <button className="btn ghost" style={{ marginTop: 8 }} onClick={loadVisual}>Build the visual summary</button>}
                      </div>
                    )}
                  </div>
                )}

                {mode === "demo" && tab === "read" && <div className="panel-foot"><span className="count">Demo mode. Set an OpenAI or Anthropic API key for full AI rewrites.</span></div>}
              </div>
            </div>

            {afterEase !== null && beforeEase !== null && (
              <div className="meter" aria-label="Readability improvement">
                <div className="gauge">
                  <svg width="72" height="72" viewBox="0 0 72 72">
                    <circle cx="36" cy="36" r="30" fill="none" stroke="var(--line)" strokeWidth="7" />
                    <circle cx="36" cy="36" r="30" fill="none" stroke="var(--good)" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(afterEase / 100) * 188} 188`} />
                  </svg>
                  <span className="val">{afterEase}</span>
                </div>
                <div className="txt">
                  <b>{easeLabel(afterEase)}</b>
                  <span>Reading ease of the clear version (0 to 100)</span>
                  {afterEase > beforeEase && <span className="delta">+{afterEase - beforeEase} points easier than the original ({beforeEase})</span>}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* guided PDF walkthrough */}
        <PdfGuide lang={lang} />

        {/* image alt-text */}
        <AltTextSection toggle={toggle} copy={copy} speaking={speaking} />

        {/* features */}
        <section className="features">
          <div className="wrap">
            <div className="section-label">
              <h2>One paste. Many barriers gone.</h2>
              <p>The same wall of text, made usable for very different readers.</p>
            </div>
            <div className="feature-grid">
              <div className="feature">
                <span className="ficon" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M4 12h10M4 17h13" /></svg>
                </span>
                <h3>Plain language, in pictures</h3>
                <p>Choose a reading level from 3rd grade to expert. Get a clear rewrite and an easy-read view that pairs each key point with a picture, plus an optional AI illustration.</p>
              </div>
              <div className="feature">
                <span className="ficon" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></svg>
                </span>
                <h3>Hear it, translate it, describe it</h3>
                <p>Play any result aloud, get it in ten languages, or drop in an image and receive screen-reader alt-text, for readers who can&apos;t use the original at all.</p>
              </div>
              <div className="feature">
                <span className="ficon" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 0 0 18" fill="currentColor" stroke="none" /></svg>
                </span>
                <h3>Reads the way you do</h3>
                <p>Pasteable practices what it preaches: hyperlegible type, a dyslexia mode, high-contrast and dark modes, full keyboard access, and a live readability score.</p>
              </div>
            </div>
          </div>
        </section>

        <footer className="foot">
          <div className="wrap">
            <span>Pasteable. Access should be a paste away.</span>
            <span>Set in <a href="https://brailleinstitute.org/freefont" target="_blank" rel="noreferrer">Atkinson Hyperlegible</a>, a typeface designed for low-vision readers.</span>
          </div>
        </footer>
      </main>
    </>
  );
}

/* ---------------- image → alt text ---------------- */
function AltTextSection({ toggle, copy, speaking }: { toggle: (t: string) => void; copy: (t: string) => void; speaking: boolean; }) {
  const [preview, setPreview] = useState("");
  const [alt, setAlt] = useState("");
  const [long, setLong] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    setErr("");
    if (!file.type.startsWith("image/")) { setErr("Please choose an image file."); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setPreview(dataUrl); setAlt(""); setLong(""); setBusy(true);
      try {
        const res = await fetch("/api/alt-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl }),
        });
        const data = await res.json();
        if (data.error) setErr(data.error);
        else { setAlt(data.alt ?? ""); setLong(data.long ?? ""); }
      } catch {
        setErr("Could not reach the description service.");
      } finally { setBusy(false); }
    };
    reader.readAsDataURL(file);
  }, []);

  return (
    <section className="bench" style={{ paddingTop: 44 }} aria-label="Describe an image">
      <div className="wrap">
        <div className="section-label">
          <h2>Paste an image, get a description</h2>
          <p>For blind and low-vision readers using a screen reader.</p>
        </div>
        <div className="grid2">
          <div
            className={`drop${over ? " over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            onPaste={(e) => { const f = e.clipboardData.files[0]; if (f) handleFile(f); }}
            onClick={() => inputRef.current?.click()}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
            aria-label="Upload, drop, or paste an image to describe"
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Selected image preview" />
            ) : (
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5" /><circle cx="8.5" cy="8.5" r="1.6" /><path d="m21 15-4.5-4.5L5 21" /></svg>
            )}
            <p><strong>Drop, paste, or click</strong> to choose an image.<br />JPEG, PNG, GIF, or WebP.</p>
            <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          <div className="panel" style={{ minHeight: 220 }}>
            <div className="panel-head">
              <span className="panel-title"><span className="dot" style={{ background: "var(--accent)" }} /> Screen-reader description</span>
              {alt && (
                <div className="panel-actions">
                  <button className="iconbtn" aria-pressed={speaking} onClick={() => toggle(`${alt}. ${long}`)}>{speaking ? "Stop" : "Read"}</button>
                  <button className="iconbtn" onClick={() => copy(alt)}>Copy alt</button>
                </div>
              )}
            </div>
            <div className="reader-out" aria-live="polite">
              {busy ? (
                <div className="reader-empty"><span className="big">Reading the image…</span></div>
              ) : alt ? (
                <>
                  <p style={{ margin: "0 0 4px" }}><span className="eyebrow" style={{ display: "block", marginBottom: 5 }}>Alt text</span>{alt}</p>
                  <p style={{ margin: "16px 0 0" }}><span className="eyebrow" style={{ display: "block", marginBottom: 5 }}>Longer description</span>{long}</p>
                </>
              ) : err ? (
                <p className="err" role="alert">{err}</p>
              ) : (
                <div className="reader-empty"><span className="big">Choose an image to describe it.</span></div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
