import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

const ANTHROPIC_MODEL = "claude-haiku-4-5";
const OPENAI_MODEL = "gpt-4o-mini";

const MEDIA = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type Media = (typeof MEDIA)[number];

const SYSTEM =
  'You write image descriptions for blind and low-vision people who use screen readers. Return a JSON object with exactly two string keys: "alt" and "long". "alt" is a concise alt attribute under 125 characters, describing the essential content and any text visible in the image. "long" is a 2-4 sentence description with more detail, including any readable text transcribed and the apparent purpose of the image. Output ONLY the JSON object, no markdown fences, no commentary.';

export async function POST(req: Request) {
  let body: { dataUrl?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  const dataUrl = body.dataUrl ?? "";
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return Response.json({ error: "Send a base64 image data URL." }, { status: 400 });

  const media = match[1].toLowerCase() as Media;
  const data = match[2];
  if (!MEDIA.includes(media)) {
    return Response.json({ error: "Use a JPEG, PNG, GIF, or WebP image." }, { status: 415 });
  }
  if (data.length > 6_000_000) {
    return Response.json({ error: "Image too large (max ~4MB)." }, { status: 413 });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!openaiKey && !anthropicKey) {
    return Response.json({
      mode: "demo",
      alt: "Short alt text (demo): a photo. Add an API key to generate real screen-reader descriptions.",
      long: "Demo mode is active because no API key is set on the server. With an OpenAI or Anthropic key, the model reads the image and writes both a concise alt attribute and a longer description for screen-reader users.",
    });
  }

  try {
    let raw = "";
    let provider = "";

    if (openaiKey) {
      provider = "openai";
      const openai = new OpenAI({ apiKey: openaiKey });
      const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        max_completion_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this image for a screen reader." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      });
      raw = completion.choices[0]?.message?.content ?? "";
    } else {
      provider = "anthropic";
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const res = await anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 700,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: media, data } },
              { type: "text", text: "Describe this image for a screen reader." },
            ],
          },
        ],
      });
      const textBlock = res.content.find((b) => b.type === "text");
      raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
    }

    let parsed: { alt?: string; long?: string } = {};
    try {
      parsed = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim());
    } catch {
      parsed = { alt: raw.slice(0, 125), long: raw };
    }

    return Response.json({
      mode: "live",
      provider,
      alt: parsed.alt ?? "",
      long: parsed.long ?? "",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Alt-text failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}
