// Natural, emotional, multilingual text-to-speech via OpenAI gpt-4o-mini-tts.
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

// Warm, human voices. gpt-4o-mini-tts speaks the language of the input text,
// so no per-language voice switching is needed.
const VOICE = "nova";
const INSTRUCTIONS =
  "Voice: warm, calm, and friendly, like a kind person helping someone understand something important. Tone: reassuring and patient, never rushed or robotic. Pace: gentle and clear, with natural pauses at commas and periods. Emotion: encouraging and supportive.";

export async function POST(req: Request) {
  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const text = (body.text ?? "").trim().slice(0, 4000);
  if (!text) return Response.json({ error: "Nothing to read." }, { status: 400 });

  const openaiKey = process.env.OPENAI_API_KEY;
  // No key: signal the client to use the built-in browser voice instead.
  if (!openaiKey) return Response.json({ fallback: true }, { status: 501 });

  try {
    const openai = new OpenAI({ apiKey: openaiKey });
    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: VOICE,
      input: text,
      instructions: INSTRUCTIONS,
      response_format: "mp3",
    });
    const buf = Buffer.from(await speech.arrayBuffer());
    return new Response(buf, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "TTS failed";
    // Let the client fall back to the browser voice on any failure.
    return Response.json({ error: msg, fallback: true }, { status: 502 });
  }
}
