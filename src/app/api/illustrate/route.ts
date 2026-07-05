// Generate one simple illustration that helps explain the clarified text.
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) return Response.json({ error: "Nothing to illustrate." }, { status: 400 });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return Response.json(
      { error: "Picture generation needs an OpenAI API key (OPENAI_API_KEY) on the server." },
      { status: 501 }
    );
  }

  const prompt = `A simple, friendly, flat vector illustration that helps someone who struggles with reading understand this information. Clean, warm, minimal, high-contrast, plenty of white space, no text or letters in the image. Depict the key idea concretely. The information: ${text.slice(0, 800)}`;

  const openai = new OpenAI({ apiKey: openaiKey });

  // Prefer gpt-image-1 (returns base64, self-contained). Fall back to dall-e-3 (returns a URL).
  try {
    const r = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      quality: "low",
    });
    const b64 = r.data?.[0]?.b64_json;
    if (b64) return Response.json({ image: `data:image/png;base64,${b64}` });
    const url = r.data?.[0]?.url;
    if (url) return Response.json({ image: url });
    return Response.json({ error: "No image was returned." }, { status: 502 });
  } catch {
    try {
      const r = await openai.images.generate({
        model: "dall-e-3",
        prompt,
        size: "1024x1024",
        n: 1,
      });
      const url = r.data?.[0]?.url;
      if (url) return Response.json({ image: url });
      return Response.json({ error: "No image was returned." }, { status: 502 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Image generation failed";
      return Response.json({ error: msg }, { status: 500 });
    }
  }
}
