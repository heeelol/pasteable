// Extract readable text from an uploaded file (PDF, DOCX, or plain text).
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Send the file as multipart form data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file received." }, { status: 400 });
  }
  if (file.size > 15_000_000) {
    return Response.json({ error: "File too large (max 15MB)." }, { status: 413 });
  }

  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  try {
    // DOCX
    if (name.endsWith(".docx") || file.type.includes("officedocument.wordprocessingml")) {
      const { value } = await mammoth.extractRawText({ buffer: buf });
      return Response.json({ text: clean(value), kind: "docx" });
    }

    // PDF (unpdf is serverless-friendly; no worker or filesystem needed)
    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text: raw } = await extractText(pdf, { mergePages: true });
      const text = clean(Array.isArray(raw) ? raw.join("\n") : raw);
      if (!text) return Response.json({ error: "That PDF has no selectable text (it may be a scan). Try pasting the text." }, { status: 422 });
      return Response.json({ text, kind: "pdf" });
    }

    // Plain text and friends
    if (
      file.type.startsWith("text/") ||
      /\.(txt|md|markdown|csv|tsv|json|log|rtf|html?|xml)$/.test(name)
    ) {
      return Response.json({ text: clean(buf.toString("utf-8")), kind: "text" });
    }

    return Response.json(
      { error: "Unsupported file type. Upload a PDF, Word (.docx), or text file, or paste the text." },
      { status: 415 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not read that file.";
    return Response.json({ error: msg }, { status: 500 });
  }
}

function clean(t: string): string {
  return t.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
