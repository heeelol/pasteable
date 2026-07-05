// Answer a question about a document, grounded in the document text, and point
// to the clause that supports the answer so the client can highlight it.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

const ANTHROPIC_MODEL = "claude-haiku-4-5";
const OPENAI_MODEL = "gpt-4o-mini";

const LANGS: Record<string, string> = {
  es: "Spanish", fr: "French", zh: "Simplified Chinese", hi: "Hindi", ar: "Arabic",
  pt: "Portuguese", vi: "Vietnamese", tl: "Tagalog", de: "German", ja: "Japanese",
};

function system(lang: string): string {
  let s = `You answer a person's question about a document they find hard to read. Use ONLY the information in the document provided. Do not use outside knowledge or make assumptions. If the document does not answer the question, say plainly that the document does not cover it.

Answer in 1 to 4 short, plain sentences. Keep any important number, date, amount, or deadline. Be direct and reassuring. Never use em dashes.

Also provide "anchor": a phrase copied WORD FOR WORD from the document (5 to 12 words) that best supports your answer, so it can be found and highlighted. Use an empty string if no single phrase applies.

Return ONLY a JSON object: { "answer": "...", "anchor": "..." }`;
  if (lang && lang !== "none" && LANGS[lang]) s += `\n\nWrite the answer in ${LANGS[lang]}. Keep the anchor in the document's original language.`;
  return s;
}

function demoAnswer(text: string, question: string): { answer: string; anchor: string } {
  const qWords = new Set(question.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 2));
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 20);
  let best = "", bestScore = 0;
  for (const s of sentences) {
    const sl = s.toLowerCase();
    let score = 0;
    qWords.forEach((w) => { if (sl.includes(w)) score++; });
    if (score > bestScore) { bestScore = score; best = s; }
  }
  if (!best) return { answer: "Add an API key to ask questions about the document. (Demo mode.)", anchor: "" };
  return { answer: best, anchor: best.split(/\s+/).slice(0, 9).join(" ") };
}

export async function POST(req: Request) {
  let body: { text?: string; question?: string; lang?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const text = (body.text ?? "").trim().slice(0, 16_000);
  const question = (body.question ?? "").trim().slice(0, 500);
  const lang = body.lang ?? "none";
  if (!text) return Response.json({ error: "No document to ask about." }, { status: 400 });
  if (!question) return Response.json({ error: "Type a question first." }, { status: 400 });

  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!openaiKey && !anthropicKey) return Response.json({ mode: "demo", ...demoAnswer(text, question) });

  const sys = system(lang);
  const user = `Document:\n${text}\n\nQuestion: ${question}`;

  try {
    let raw = "";
    if (openaiKey) {
      const openai = new OpenAI({ apiKey: openaiKey });
      const c = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        max_completion_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      });
      raw = c.choices[0]?.message?.content ?? "";
    } else {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const r = await anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 500,
        system: sys,
        messages: [{ role: "user", content: user }],
      });
      const b = r.content.find((x) => x.type === "text");
      raw = b && b.type === "text" ? b.text : "";
    }

    let parsed: { answer?: string; anchor?: string } = {};
    try {
      parsed = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim());
    } catch {
      parsed = { answer: raw, anchor: "" };
    }
    return Response.json({ mode: "live", answer: parsed.answer ?? "", anchor: parsed.anchor ?? "" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not answer";
    return Response.json({ error: msg }, { status: 500 });
  }
}
