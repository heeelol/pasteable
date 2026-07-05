// Turn a document's text into an ordered, anchored walkthrough.
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
  let s = `You help someone who struggles with dense text understand an important document, like a contract, terms and conditions, or a government form. Walk them through it in order.

Return a JSON object shaped exactly like:
{ "title": "a short plain title for the document", "steps": [ { "heading": "a short label for this part", "anchor": "a short phrase copied WORD FOR WORD from the document text so it can be found and highlighted", "explanation": "1 to 3 short, plain sentences telling the reader what this part means and what, if anything, they must do", "emoji": "one emoji that pictures this step" } ] }

Rules:
- The "anchor" MUST be an exact substring of the document text (5 to 12 words), copied verbatim, including original spelling and punctuation. Do not paraphrase the anchor. Pick a distinctive phrase.
- Cover the parts that matter most to a regular person: what they are agreeing to, money and fees, deadlines and dates, what they must do or sign, their rights, and any warnings or risks.
- 4 to 9 steps, in the order they appear in the document.
- Keep every important number, date, and amount in the explanation.
- Never use em dashes. Output ONLY the JSON object, no markdown fences.`;
  if (lang && lang !== "none" && LANGS[lang]) s += `\n- Write "title", every "heading", and every "explanation" in ${LANGS[lang]}. Keep each "anchor" in the document's original language.`;
  return s;
}

type Step = { heading: string; anchor: string; explanation: string; emoji: string };

export async function POST(req: Request) {
  let body: { text?: string; lang?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  const lang = body.lang ?? "none";
  if (text.length < 40) return Response.json({ error: "Not enough text to walk through." }, { status: 400 });

  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!openaiKey && !anthropicKey) {
    // Demo: split into a few chunks and anchor on the first words of each.
    const paras = text.split(/\n{2,}|(?<=[.!?])\s+/).map((p) => p.trim()).filter((p) => p.length > 30).slice(0, 6);
    const emojis = ["📌", "💵", "⏰", "✍️", "⚠️", "📞"];
    const steps: Step[] = paras.map((p, i) => ({
      heading: `Part ${i + 1}`,
      anchor: p.split(/\s+/).slice(0, 8).join(" "),
      explanation: p.length > 160 ? p.slice(0, 158) + "…" : p,
      emoji: emojis[i % emojis.length],
    }));
    return Response.json({ mode: "demo", title: "Document walkthrough (demo mode)", steps });
  }

  try {
    let raw = "";
    const content = text.slice(0, 14000);
    if (openaiKey) {
      const openai = new OpenAI({ apiKey: openaiKey });
      const c = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        max_completion_tokens: 1600,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system(lang) },
          { role: "user", content },
        ],
      });
      raw = c.choices[0]?.message?.content ?? "";
    } else {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const r = await anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 1600,
        system: system(lang),
        messages: [{ role: "user", content }],
      });
      const b = r.content.find((x) => x.type === "text");
      raw = b && b.type === "text" ? b.text : "";
    }

    let parsed: { title?: string; steps?: Step[] };
    try {
      parsed = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim());
    } catch {
      return Response.json({ error: "Could not build a walkthrough for this document." }, { status: 502 });
    }
    const steps = Array.isArray(parsed.steps)
      ? parsed.steps.filter((s) => s && s.explanation).slice(0, 9)
      : [];
    if (!steps.length) return Response.json({ error: "No steps were found in this document." }, { status: 422 });
    return Response.json({ mode: "live", title: parsed.title ?? "Document walkthrough", steps });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Walkthrough failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}
