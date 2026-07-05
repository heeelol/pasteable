"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ---------------- reading-level + language config ---------------- */
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

const SAMPLE = `Notwithstanding any provision herein to the contrary, the undersigned patient hereby acknowledges and consents to the administration of the aforementioned diagnostic procedure, and further affirms that the attendant risks — including but not limited to hemorrhage, infection, and adverse reaction to anesthesia — have been disclosed in a manner sufficient to constitute informed consent, and that the patient shall be solely responsible for any charges not remitted by the applicable third-party payer within thirty (30) days of the date of service.`;

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

/* ---------------- top bar toggles ---------------- */
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

export default function Page() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState<string>("plain");
  const [lang, setLang] = useState<string>("none");
  const [mode, setMode] = useState<"live" | "demo" | null>(null);
  const [err, setErr] = useState("");
  const [sweep, setSweep] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const outRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // theme + a11y toggles
  const [dark, toggleDark] = useHtmlAttr("data-theme", "cv-theme", "dark", "light");
  const [contrast, toggleContrast] = useHtmlAttr("data-contrast", "cv-contrast", "high", null);
  const [dyslexia, toggleDyslexia] = useHtmlAttr("data-dyslexia", "cv-dyslexia", "on", null);

  const beforeEase = useMemo(() => fleschEase(input), [input]);
  const afterEase = useMemo(() => fleschEase(output), [output]);

  const clarify = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setErr("");
    setOutput("");
    setBusy(true);
    setSweep(true);
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
      if (!res.ok) {
        setErr((await res.text()) || "Something went wrong.");
        setBusy(false);
        return;
      }
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
      setBusy(false);
      abortRef.current = null;
    }
  }, [input, level, lang, busy]);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setInput(t);
    } catch {
      setErr("Clipboard blocked by the browser — paste with Ctrl+V into the box instead.");
    }
  }, []);

  /* ---- text to speech ---- */
  const speak = useCallback(
    (text: string) => {
      if (!("speechSynthesis" in window)) {
        setErr("Read-aloud isn't supported in this browser.");
        return;
      }
      if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
        setSpeaking(false);
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      const map: Record<string, string> = {
        es: "es-ES", fr: "fr-FR", zh: "zh-CN", hi: "hi-IN", ar: "ar-SA",
        pt: "pt-BR", vi: "vi-VN", de: "de-DE", ja: "ja-JP", tl: "fil-PH",
      };
      if (lang !== "none" && map[lang]) u.lang = map[lang];
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      setSpeaking(true);
      speechSynthesis.speak(u);
    },
    [lang]
  );
  useEffect(() => () => { if (typeof window !== "undefined") window.speechSynthesis?.cancel(); }, []);

  const copy = useCallback((t: string) => { navigator.clipboard?.writeText(t).catch(() => {}); }, []);

  const scrollToBench = () =>
    document.getElementById("workbench")?.scrollIntoView({ behavior: "smooth" });

  return (
    <>
      <a href="#workbench" className="skip-link">Skip to the workbench</a>

      {/* top bar */}
      <header className="topbar">
        <div className="wrap topbar-inner">
          <div className="brand">
            <span className="mark" aria-hidden="true">⌘V</span>
            <span>Ctrl+V&nbsp;<span style={{ color: "var(--accent)" }}>→</span>&nbsp;Access</span>
          </div>
          <div className="toolbar">
            <button className="iconbtn" aria-pressed={dyslexia} onClick={toggleDyslexia} title="Dyslexia-friendly reading mode">Aa Dyslexia</button>
            <button className="iconbtn" aria-pressed={contrast} onClick={toggleContrast} title="High-contrast mode">◐ Contrast</button>
            <button className="iconbtn" aria-pressed={dark} onClick={toggleDark} title="Toggle dark mode">{dark ? "☀︎" : "☾"}</button>
          </div>
        </div>
      </header>

      <main>
        {/* hero */}
        <section className="hero">
          <div className="wrap">
            <p className="eyebrow">CTRL+V Hackathon · Accessibility for everyone</p>
            <h1>
              Paste anything.<br />
              Get it in a form you <span className="mk">can actually use.</span>
            </h1>
            <p className="lede">
              Dense forms, medical instructions, and legal text lock millions of people out. Paste it here
              and get a plain-language version, read aloud, translated, or described — in one paste.
            </p>
            <div className="hero-cta">
              <button className="btn" onClick={scrollToBench}>Start clarifying <span className="keycap" aria-hidden="true">Ctrl V</span></button>
              <button className="btn ghost" onClick={() => { setInput(SAMPLE); scrollToBench(); }}>Try a sample form</button>
            </div>
            <div className="audience">
              {["Dyslexia (1 in 10)", "Low literacy (~750M adults)", "New-language readers", "Screen-reader users", "Cognitive disabilities"].map((c) => (
                <span className="chip" key={c}>{c}</span>
              ))}
            </div>
          </div>
        </section>

        {/* workbench */}
        <section className="bench" id="workbench" aria-label="Clarify text">
          <div className="wrap">
            {/* controls */}
            <div className="controls">
              <div className="control-row">
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
                <button className="btn" onClick={clarify} disabled={!input.trim() || busy}>
                  {busy ? "Clarifying…" : "Clarify text"}
                </button>
              </div>
              {err && <p className="err" role="alert">{err}</p>}
            </div>

            <div className="grid2">
              {/* input */}
              <div className="panel">
                <div className="panel-head">
                  <span className="panel-title"><span className="dot" style={{ background: "var(--muted)" }} /> Paste it here</span>
                  <button className="iconbtn" onClick={pasteFromClipboard} title="Paste from clipboard">Paste</button>
                </div>
                <textarea
                  className="paste-area"
                  placeholder="Paste a form, a letter, an email, terms and conditions, a doctor's note… anything hard to read."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  aria-label="Text to clarify"
                />
                <div className="panel-foot">
                  {beforeEase !== null && (
                    <span className="count">Reading ease {beforeEase}/100 · {easeLabel(beforeEase)}</span>
                  )}
                  <span className="count">{input.length.toLocaleString()} chars</span>
                </div>
              </div>

              {/* output */}
              <div className={`panel sweep${sweep ? " go" : ""}`}>
                <div className="panel-head">
                  <span className="panel-title"><span className="dot" style={{ background: "var(--good)" }} /> Clear version</span>
                  {output && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="iconbtn" aria-pressed={speaking} onClick={() => speak(output)} title="Read aloud">{speaking ? "■ Stop" : "▶ Read"}</button>
                      <button className="iconbtn" onClick={() => copy(output)} title="Copy result">Copy</button>
                    </div>
                  )}
                </div>
                <div className="reader-out" ref={outRef} aria-live="polite">
                  {output ? (
                    <>
                      {output}
                      {busy && <span className="cursor" aria-hidden="true" />}
                    </>
                  ) : (
                    <div className="reader-empty">
                      <span className="keycap" aria-hidden="true">Ctrl V</span>
                      <span className="big">Your clear version appears here.</span>
                      <span>Pick a reading level, then press <strong>Clarify text</strong>.</span>
                    </div>
                  )}
                </div>
                {mode === "demo" && (
                  <div className="panel-foot"><span className="count">Demo mode — set an OpenAI or Anthropic API key for full AI rewrites.</span></div>
                )}
              </div>
            </div>

            {/* readability meter */}
            {afterEase !== null && beforeEase !== null && (
              <div className="meter" style={{ marginTop: 20 }} aria-label="Readability improvement">
                <div className="gauge">
                  <svg width="76" height="76" viewBox="0 0 76 76">
                    <circle cx="38" cy="38" r="32" fill="none" stroke="var(--line)" strokeWidth="8" />
                    <circle cx="38" cy="38" r="32" fill="none" stroke="var(--good)" strokeWidth="8"
                      strokeLinecap="round" strokeDasharray={`${(afterEase / 100) * 201} 201`} />
                  </svg>
                  <span className="val">{afterEase}</span>
                </div>
                <div className="txt">
                  <b>{easeLabel(afterEase)}</b>
                  <span>Reading ease of the clear version (0–100)</span>
                  {afterEase > beforeEase && (
                    <span className="delta">▲ +{afterEase - beforeEase} points easier than the original ({beforeEase})</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* image alt-text */}
        <AltTextSection speak={speak} copy={copy} speaking={speaking} />

        {/* how it works */}
        <section className="section">
          <div className="wrap">
            <p className="eyebrow">Why it matters</p>
            <h2>One paste. Many barriers removed.</h2>
            <div className="steps">
              <div className="step">
                <span className="n">01 · Understand</span>
                <h3>Plain-language rewrite</h3>
                <p>Claude rewrites dense text at the reading level you choose — from 3rd grade to expert — while keeping every fact, date, and warning.</p>
              </div>
              <div className="step">
                <span className="n">02 · Access</span>
                <h3>Hear it, translate it, describe it</h3>
                <p>Read any result aloud, get it in ten languages, or turn an image into screen-reader alt-text — for readers who can&apos;t use the original at all.</p>
              </div>
              <div className="step">
                <span className="n">03 · Read your way</span>
                <h3>Dyslexia &amp; high-contrast modes</h3>
                <p>The tool practices what it preaches: hyperlegible type, generous spacing, a dyslexia mode, high-contrast, dark mode, and full keyboard access.</p>
              </div>
            </div>
          </div>
        </section>

        <footer className="foot">
          <div className="wrap">
            Built for the CTRL+V Hackathon · Access should be a paste away.<br />
            Set in <strong>Atkinson Hyperlegible</strong>, a typeface designed for low-vision readers.
          </div>
        </footer>
      </main>
    </>
  );
}

/* ---------------- image → alt text ---------------- */
function AltTextSection({
  speak, copy, speaking,
}: {
  speak: (t: string) => void;
  copy: (t: string) => void;
  speaking: boolean;
}) {
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
    <section className="section" aria-label="Describe an image">
      <div className="wrap">
        <p className="eyebrow">For screen-reader users</p>
        <h2>Paste an image, get a description.</h2>
        <div className="grid2" style={{ marginTop: 22 }}>
          <div
            className={`drop${over ? " over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            onPaste={(e) => { const f = e.clipboardData.files[0]; if (f) handleFile(f); }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
            aria-label="Upload, drop, or paste an image to describe"
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Selected image preview" />
            ) : (
              <p style={{ fontSize: "2rem", margin: "0 0 6px" }} aria-hidden="true">🖼️</p>
            )}
            <p><strong>Drop, paste, or click</strong> to choose an image.<br />JPEG, PNG, GIF, or WebP.</p>
            <input ref={inputRef} type="file" accept="image/*" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          <div className="panel" style={{ minHeight: 220 }}>
            <div className="panel-head">
              <span className="panel-title"><span className="dot" style={{ background: "var(--accent)" }} /> Screen-reader description</span>
              {alt && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="iconbtn" aria-pressed={speaking} onClick={() => speak(`${alt}. ${long}`)}>{speaking ? "■ Stop" : "▶ Read"}</button>
                  <button className="iconbtn" onClick={() => copy(alt)}>Copy alt</button>
                </div>
              )}
            </div>
            <div className="reader-out" aria-live="polite">
              {busy ? (
                <div className="reader-empty"><span className="big">Reading the image…</span></div>
              ) : alt ? (
                <>
                  <p style={{ margin: "0 0 6px" }}><strong className="eyebrow" style={{ display: "block", marginBottom: 4 }}>Alt text</strong>{alt}</p>
                  <p style={{ margin: "14px 0 0" }}><strong className="eyebrow" style={{ display: "block", marginBottom: 4 }}>Longer description</strong>{long}</p>
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
