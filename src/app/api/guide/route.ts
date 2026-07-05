// Turn a document's text into a COMPREHENSIVE, ordered, anchored walkthrough.
// The document is split into sections and every important point is extracted
// from each section in parallel, so coverage scales with the document instead
// of being capped at a handful of points.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

const ANTHROPIC_MODEL = "claude-haiku-4-5";
const OPENAI_MODEL = "gpt-4o-mini";

const MAX_INPUT = 80_000;   // characters of document text considered
const CHUNK_SIZE = 2_000;   // characters per section sent to the model
const CONCURRENCY = 8;
const MAX_STEPS = 80;

const LANGS: Record<string, string> = {
  es: "Spanish", fr: "French", zh: "Simplified Chinese", hi: "Hindi", ar: "Arabic",
  pt: "Portuguese", vi: "Vietnamese", tl: "Tagalog", de: "German", ja: "Japanese",
};

function system(lang: string, mode: "key" | "full"): string {
  const extraction = mode === "key"
    ? `Pick out ONLY the handful of points a regular person absolutely must not miss (aim for 5 to 8 total). Focus on the things that cost money, have a deadline, require the reader to do or sign something, take away a right, or carry real risk. Skip minor or routine details. Quality over quantity.`
    : `Go through this section clause by clause and pull out EVERY point a regular person needs to understand or act on. Be exhaustive, not selective. Do not stop at the most obvious points. Treat every numbered clause or distinct sentence as a candidate: if it contains a rule, an obligation, a fee or amount, a date or deadline, something the reader must do, provide, or sign, a right, a permission you are granting, a condition, a restriction, an automatic renewal, a penalty, a limit on liability, a change-of-terms clause, a dispute or arbitration clause, or any warning, it deserves its own step. When in doubt, include it rather than skip it. Only leave out pure filler with no meaning for a person. It is better to have too many steps than to miss something that matters.`;

  let s = `You help someone who struggles with dense text understand an important document such as a contract, terms and conditions, or a government form. You are given ONE SECTION of a longer document.

${extraction}

Return a JSON object shaped exactly like:
{ "steps": [ { "heading": "a short label for this point", "anchor": "a phrase copied WORD FOR WORD from the section text so it can be found and highlighted", "explanation": "1 to 3 short, plain sentences saying what this means and what, if anything, the reader must do", "emoji": "one emoji that pictures this point", "level": "high" } ] }

Rules:
- The "anchor" MUST be an exact substring of the section text (5 to 12 words), copied verbatim including spelling and punctuation. Pick a distinctive phrase. Do not paraphrase the anchor.
- Set "level" to one of "high", "medium", or "low", based on how much this point could affect the reader. Use "high" if it could cost them money, create a bill or fee, take away a right, lock them into an obligation, or has a deadline they could miss. Use "medium" if it is important to understand but lower stakes. Use "low" if it is routine or administrative.
- One step per distinct point. Keep every important number, date, and amount in the explanation.
- Keep the points in the order they appear in the section.
- Never use em dashes. Output ONLY the JSON object, no markdown fences.`;
  if (lang && lang !== "none" && LANGS[lang]) s += `\n- Write every "heading" and "explanation" in ${LANGS[lang]}. Keep each "anchor" in the document's original language.`;
  return s;
}

type Step = { heading: string; anchor: string; explanation: string; emoji: string; level?: "high" | "medium" | "low" };

function chunkText(text: string): string[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > CHUNK_SIZE) { chunks.push(cur); cur = ""; }
    if (p.length > CHUNK_SIZE * 1.4) {
      // hard-split an oversized paragraph on sentence boundaries
      const sents = p.split(/(?<=[.!?])\s+/);
      for (const sent of sents) {
        if (cur && cur.length + sent.length + 1 > CHUNK_SIZE) { chunks.push(cur); cur = ""; }
        cur = cur ? cur + " " + sent : sent;
      }
    } else {
      cur = cur ? cur + "\n\n" + p : p;
    }
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

function parseSteps(raw: string): Step[] {
  try {
    const obj = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim());
    const steps = Array.isArray(obj?.steps) ? obj.steps : Array.isArray(obj) ? obj : [];
    return steps.filter((s: Step) => s && s.explanation && s.anchor);
  } catch {
    return [];
  }
}

export async function POST(req: Request) {
  let body: { text?: string; lang?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const text = (body.text ?? "").trim().slice(0, MAX_INPUT);
  const lang = body.lang ?? "none";
  const mode: "key" | "full" = body.mode === "key" ? "key" : "full";
  if (text.length < 40) return Response.json({ error: "Not enough text to walk through." }, { status: 400 });

  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  // Key-points mode: a single pass over the whole document for a fast, curated
  // handful. Comprehensive mode: many small sections mined in parallel.
  const chunks = mode === "key" ? [text.slice(0, 14_000)] : chunkText(text);
  const stepCap = mode === "key" ? 8 : MAX_STEPS;

  // Demo: one point per sentence-ish, capped generously.
  if (!openaiKey && !anthropicKey) {
    const paras = text.split(/\n{2,}|(?<=[.!?])\s+/).map((p) => p.trim()).filter((p) => p.length > 25);
    const emojis = ["📌", "💵", "⏰", "✍️", "⚠️", "📞", "✅", "📄"];
    const riskWord = /\b(fee|pay|cost|\$|penalt|late|deadline|days|terminat|cancel|waive|liabilit|auto|renew)/i;
    const steps: Step[] = paras.slice(0, mode === "key" ? 8 : 30).map((p, i) => ({
      heading: `Part ${i + 1}`,
      anchor: p.split(/\s+/).slice(0, 8).join(" "),
      explanation: p.length > 170 ? p.slice(0, 168) + "…" : p,
      emoji: emojis[i % emojis.length],
      level: (riskWord.test(p) ? "high" : "medium") as "high" | "medium" | "low",
    }));
    return Response.json({ mode: "demo", title: "Document walkthrough (demo mode)", steps });
  }

  const sys = system(lang, mode);
  const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
  const anthropic = !openaiKey && anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;

  async function genSteps(chunk: string): Promise<Step[]> {
    try {
      if (openai) {
        const c = await openai.chat.completions.create({
          model: OPENAI_MODEL,
          max_completion_tokens: 1500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: sys },
            { role: "user", content: chunk },
          ],
        });
        return parseSteps(c.choices[0]?.message?.content ?? "");
      }
      if (anthropic) {
        const r = await anthropic.messages.create({
          model: ANTHROPIC_MODEL,
          max_tokens: 1500,
          system: sys,
          messages: [{ role: "user", content: chunk }],
        });
        const b = r.content.find((x) => x.type === "text");
        return parseSteps(b && b.type === "text" ? b.text : "");
      }
    } catch {
      /* fall through to empty */
    }
    return [];
  }

  try {
    const perChunk = await mapLimit(chunks, CONCURRENCY, genSteps);

    // Merge in document order, dedupe by heading+anchor.
    const seen = new Set<string>();
    const steps: Step[] = [];
    for (const group of perChunk) {
      for (const s of group) {
        const key = (s.heading + "|" + s.anchor).toLowerCase().replace(/\s+/g, " ").trim();
        if (seen.has(key)) continue;
        seen.add(key);
        steps.push(s);
        if (steps.length >= stepCap) break;
      }
      if (steps.length >= MAX_STEPS) break;
    }

    if (!steps.length) return Response.json({ error: "No steps were found in this document." }, { status: 422 });
    return Response.json({ mode: "live", title: "Your document, in plain words", steps });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Walkthrough failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}
