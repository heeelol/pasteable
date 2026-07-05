import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

const ANTHROPIC_MODEL = "claude-haiku-4-5";
const OPENAI_MODEL = "gpt-4o-mini";

const LEVELS: Record<string, string> = {
  grade3:
    "a young child around 3rd-grade reading level (about 8 years old). Use very short sentences, usually under 10 words. Use only the most common everyday words. When an idea is hard, explain it with a simple example.",
  grade6:
    "a 6th grader (about 11 years old). Use short sentences and plain everyday words. If a technical or legal term is unavoidable, put a short plain-language meaning in parentheses right after it.",
  grade9:
    "a 9th grader. Use clear plain language, break long sentences into shorter ones, and keep every key fact. Prefer active voice.",
  plain:
    "a busy adult who needs plain language. Strip out jargon, legalese, and filler while keeping every important detail. Use short paragraphs, and use bullet points where they make steps or lists clearer.",
  expert:
    "an expert reader. Keep the full detail and nuance, do not simplify the meaning, but improve clarity: fix tangled structure, and define any specialized jargon inline the first time it appears.",
};

const LANGS: Record<string, string> = {
  es: "Spanish",
  fr: "French",
  zh: "Simplified Chinese",
  hi: "Hindi",
  ar: "Arabic",
  pt: "Portuguese",
  vi: "Vietnamese",
  tl: "Tagalog",
  de: "German",
  ja: "Japanese",
};

function buildSystem(level: string, lang: string): string {
  const levelText = LEVELS[level] ?? LEVELS.plain;
  let s = `You are an accessibility assistant. You rewrite text so it is easier to access and understand for people facing barriers, including readers with dyslexia, cognitive disabilities, low literacy, limited English, or anyone facing dense government, legal, medical, or technical language.

Rewrite the user's text for ${levelText}

Rules:
- Preserve all essential meaning, facts, names, numbers, dates, amounts, and warnings. Never invent information.
- Keep the same intent and any required actions the reader must take.
- Use a calm, direct, respectful tone. Do not talk down to the reader.
- Never use em dashes. Use short sentences, commas, or periods instead.
- Structure the result for easy reading: lead with a one-line summary, then use short paragraphs or a bulleted list (each bullet on its own line starting with "- ") when there are steps, conditions, or multiple points.
- Output ONLY the rewritten text. No preamble, no "Here is", no commentary, no markdown fences.`;

  if (lang && lang !== "none" && LANGS[lang]) {
    s += `\n- Write your entire rewritten result in ${LANGS[lang]}.`;
  }
  return s;
}

// Lightweight local fallback so the app is fully demonstrable without an API key.
function localSimplify(text: string): string {
  const parts = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (p.length > 140) {
      out.push(
        ...p
          .split(/,?\s+(?:and|but|which|whereas|provided that|in order to|however)\s+/i)
          .map((c) => c.trim())
          .filter(Boolean)
          .map((c) => c.charAt(0).toUpperCase() + c.slice(1))
      );
    } else {
      out.push(p);
    }
  }
  return (
    "• " +
    out.map((s) => (s.endsWith(".") || s.endsWith("!") || s.endsWith("?") ? s : s + ".")).join("\n• ")
  );
}

export async function POST(req: Request) {
  let body: { text?: string; level?: string; lang?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const text = (body.text ?? "").trim();
  const level = body.level ?? "plain";
  const lang = body.lang ?? "none";

  if (!text) return new Response("Empty text", { status: 400 });
  if (text.length > 20000) return new Response("Text too long (max 20,000 characters).", { status: 413 });

  const encoder = new TextEncoder();
  const system = buildSystem(level, lang);
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  // Fallback: no key configured, stream a local best-effort rewrite.
  if (!openaiKey && !anthropicKey) {
    const demo = localSimplify(text);
    const stream = new ReadableStream({
      async start(controller) {
        for (let i = 0; i < demo.length; i += 40) {
          controller.enqueue(encoder.encode(demo.slice(i, i + 40)));
          await new Promise((r) => setTimeout(r, 18));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Mode": "demo" },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        if (openaiKey) {
          const openai = new OpenAI({ apiKey: openaiKey });
          const completion = await openai.chat.completions.create({
            model: OPENAI_MODEL,
            max_completion_tokens: 4096,
            stream: true,
            messages: [
              { role: "system", content: system },
              { role: "user", content: text },
            ],
          });
          for await (const chunk of completion) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) controller.enqueue(encoder.encode(delta));
          }
        } else {
          const anthropic = new Anthropic({ apiKey: anthropicKey });
          const s = await anthropic.messages.create({
            model: ANTHROPIC_MODEL,
            max_tokens: 4096,
            system,
            messages: [{ role: "user", content: text }],
            stream: true,
          });
          for await (const event of s) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
        }
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Transform failed";
        controller.enqueue(encoder.encode(`\n[error] ${msg}`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Mode": "live",
      "X-Provider": openaiKey ? "openai" : "anthropic",
    },
  });
}
