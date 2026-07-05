# Pasteable

**Paste anything you can't read, and get it back in a form you can use.**

Live: **https://pasteable-phi.vercel.app**

Dense forms, contracts, and fine print lock out a huge number of people. About 130 million US adults read at or below a sixth grade level, one in five people has dyslexia, and millions more read in a second language or use a screen reader. Pasteable turns that wall of text into something usable: plain language, pictures, voice, translation, and a guided walkthrough that explains a real document right on the page.

## What it does

- **Plain-language rewrite** at a reading level you choose, from Grade 3 to Expert, streamed live, keeping every fact, date, amount, and warning.
- **Live readability score** (Flesch Reading Ease) so you can see the text get easier as it changes.
- **Easy-read pictures**, where the result becomes short points each paired with a pictogram, plus an optional AI illustration.
- **Natural read-aloud** in a warm, emotional voice, and **translation** into ten languages.
- **Image to description**, turning any image into screen-reader alt text and a longer description.
- **Guided, risk-rated PDF walkthrough** (the centerpiece): upload a document and Pasteable renders the real pages, marks every important part on the page and color-codes it by risk, walks you through it out loud one part at a time, and answers questions grounded strictly in the document.
- **Accessible by design**: set in Atkinson Hyperlegible, with a dyslexia mode, high contrast, dark mode, and full keyboard access.

## The guided walkthrough

The document engine is what sets Pasteable apart. For each important clause, the model returns a verbatim anchor phrase; the app finds that phrase in the rendered PDF text layer, computes its bounding box, and draws a highlight synced to a step panel. Long documents are split into sections and mined in parallel so nothing gets dropped. You can switch between a quick key-points pass and an exhaustive clause-by-clause pass, filter to only the parts that could hurt you, auto-play the whole walkthrough hands-free, or just ask the document a question and have it point to the answer.

## Tech stack

- **Next.js** (App Router) and **TypeScript**, deployed on **Vercel**
- **OpenAI**: `gpt-4o-mini` (rewrites, extraction, walkthrough, Q&A), vision (image descriptions), `gpt-image-1` (illustrations), `gpt-4o-mini-tts` (voice). Provider-flexible: also runs on **Anthropic Claude**.
- **pdf.js** for client-side PDF rendering and text extraction; **unpdf** and **mammoth** for server-side extraction
- **Web Speech API** as a read-aloud fallback

## Running locally

```bash
git clone https://github.com/heeelol/pasteable.git
cd pasteable
npm install
cp .env.example .env.local   # add one API key (see below)
npm run dev                   # http://localhost:3000
```

### Environment variables

Add **one** key to `.env.local`. The app prefers OpenAI when both are set, and runs in a limited "demo mode" if neither is present.

```
OPENAI_API_KEY=        # https://platform.openai.com/api-keys  (uses gpt-4o-mini)
ANTHROPIC_API_KEY=     # https://console.anthropic.com          (uses claude-haiku-4-5)
```

Image generation and the natural voice require an OpenAI key specifically.

## Deploying

Import the repo on Vercel, add `OPENAI_API_KEY` as an environment variable for Production, and deploy. Env vars only apply to builds created after they are set, so redeploy if you add the key later.

---

Built for the CTRL+V Hackathon.
