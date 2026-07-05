// Turn clarified text into an "easy-read" set of illustrated key points.
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
  let s = `You turn text into an "easy-read" summary for people with low literacy, cognitive disabilities, or limited reading. Easy-read pairs each short idea with a picture.

Return a JSON object shaped exactly like:
{ "summary": "one short sentence capturing the whole thing", "points": [ { "text": "one short, plain idea (max ~14 words)", "emoji": "a single emoji that best pictures this idea" } ] }

Rules:
- 3 to 6 points. Each point is ONE idea, in plain words, keeping any important number, date, or action.
- Choose the clearest, most literal emoji for each point (money -> 💵, deadline -> ⏰, doctor -> 🩺, sign here -> ✍️, warning -> ⚠️, phone -> 📞, and so on).
- Never use em dashes. Output ONLY the JSON object, no markdown fences.`;
  if (lang && lang !== "none" && LANGS[lang]) s += `\n- Write summary and every point in ${LANGS[lang]}.`;
  return s;
}

type Visual = { summary: string; points: { text: string; emoji: string }[] };

function demo(text: string): Visual {
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean).slice(0, 5);
  const emojis = ["📄", "✅", "⏰", "💵", "⚠️"];
  return {
    summary: "A quick, picture-based summary (demo mode).",
    points: sentences.map((s, i) => ({ text: s.length > 90 ? s.slice(0, 88) + "…" : s, emoji: emojis[i % emojis.length] })),
  };
}

export async function POST(req: Request) {
  let body: { text?: string; lang?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  const lang = body.lang ?? "none";
  if (!text) return Response.json({ error: "Nothing to summarize." }, { status: 400 });

  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!openaiKey && !anthropicKey) return Response.json({ mode: "demo", ...demo(text) });

  try {
    let raw = "";
    if (openaiKey) {
      const openai = new OpenAI({ apiKey: openaiKey });
      const c = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        max_completion_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system(lang) },
          { role: "user", content: text.slice(0, 8000) },
        ],
      });
      raw = c.choices[0]?.message?.content ?? "";
    } else {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const r = await anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 800,
        system: system(lang),
        messages: [{ role: "user", content: text.slice(0, 8000) }],
      });
      const b = r.content.find((x) => x.type === "text");
      raw = b && b.type === "text" ? b.text : "";
    }

    let parsed: Visual;
    try {
      parsed = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim());
    } catch {
      return Response.json({ mode: "live", ...demo(text) });
    }
    const points = Array.isArray(parsed.points) ? parsed.points.filter((p) => p && p.text).slice(0, 6) : [];
    return Response.json({ mode: "live", summary: parsed.summary ?? "", points });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Visual summary failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}
