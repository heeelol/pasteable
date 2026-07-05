"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const LANG_MAP: Record<string, string> = {
  es: "es-ES", fr: "fr-FR", zh: "zh-CN", hi: "hi-IN", ar: "ar-SA",
  pt: "pt-BR", vi: "vi-VN", de: "de-DE", ja: "ja-JP", tl: "fil-PH",
};

/**
 * Read-aloud with natural, emotional neural voices (OpenAI gpt-4o-mini-tts via
 * /api/tts), falling back to the browser's built-in speech if there is no key
 * or the request fails. Only one utterance plays at a time.
 *
 * - speak(text, onEnd?)  play now (interrupts anything current); onEnd fires on
 *   natural completion only (not when stopped) — used for auto-advance.
 * - toggle(text)         start, or stop if already speaking (for buttons).
 * - stop()               stop immediately.
 */
export function useSpeech(lang: string) {
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const tokenRef = useRef(0);

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
  }, []);

  const stop = useCallback(() => {
    tokenRef.current++;
    cleanupAudio();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, [cleanupAudio]);

  const browserSpeak = useCallback((text: string, token: number, onEnd?: () => void) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) { setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    if (lang !== "none" && LANG_MAP[lang]) u.lang = LANG_MAP[lang];
    u.onend = () => { if (token === tokenRef.current) { setSpeaking(false); onEnd?.(); } };
    u.onerror = () => { if (token === tokenRef.current) setSpeaking(false); };
    window.speechSynthesis.speak(u);
  }, [lang]);

  const speak = useCallback(async (text: string, onEnd?: () => void) => {
    const clean = (text || "").trim();
    if (!clean) return;
    // Interrupt anything currently playing and claim a fresh token.
    tokenRef.current++;
    cleanupAudio();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    const token = tokenRef.current;
    setSpeaking(true);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean.slice(0, 4000), lang }),
      });
      if (token !== tokenRef.current) return;
      const ct = res.headers.get("content-type") || "";
      if (res.ok && ct.includes("audio")) {
        const blob = await res.blob();
        if (token !== tokenRef.current) return;
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        const a = new Audio(url);
        audioRef.current = a;
        a.onended = () => { if (token === tokenRef.current) { cleanupAudio(); setSpeaking(false); onEnd?.(); } };
        a.onerror = () => { if (token === tokenRef.current) { cleanupAudio(); browserSpeak(clean, token, onEnd); } };
        await a.play();
        return;
      }
      browserSpeak(clean, token, onEnd);
    } catch {
      if (token === tokenRef.current) browserSpeak(clean, token, onEnd);
    }
  }, [lang, cleanupAudio, browserSpeak]);

  const toggle = useCallback((text: string) => {
    if (speaking) stop();
    else speak(text);
  }, [speaking, stop, speak]);

  useEffect(() => () => { stop(); }, [stop]);

  return { speak, toggle, stop, speaking };
}
