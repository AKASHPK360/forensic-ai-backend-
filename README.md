# Forensic AI — Backend API

This backend matches the uploaded React/Vite Witness-to-Sketch frontend. It adds case persistence, attribute extraction, optional Groq transcription and Llama extraction, PDF report export, and a health endpoint.

## Important truth about this prototype

- Without `GROQ_API_KEY`, `/api/extract-attributes` uses a local keyword fallback and clearly reports `simulated: true`.
- With `GROQ_API_KEY`, `/api/transcribe` uses Groq Whisper and `/api/extract-attributes` uses the configured Groq chat model.
- `/api/generate-sketch` intentionally returns HTTP 501 until an image provider is configured and reviewed. The current frontend's SVG is still a placeholder, not a real AI sketch.
- This starter stores cases in `data/cases.json` for a local demo. It is not a production database and has no authentication. Do not use real witness statements or sensitive case data until authentication, authorization, encryption, audit logs, consent, retention/deletion, and appropriate legal review are implemented.

## 1. Requirements

- Node.js 18+
- npm

## 2. Start the backend

From this folder:

```bash
npm install
cp .env.example .env
npm run dev
```

Backend base URL: `http://localhost:4000`

Check it:

```bash
curl http://localhost:4000/api/health
```

## 3. Optional Groq setup

Open `.env` and set `GROQ_API_KEY` to your own key. Keep it in this backend `.env`; never put it in React/Vite variables or frontend source.

You may also change `GROQ_CHAT_MODEL` and `GROQ_TRANSCRIPTION_MODEL` to models available to your Groq account. Restart the backend after changing `.env`.

## 4. Connect the Vite frontend

The uploaded frontend's current buttons call local demo functions (`parseDemo`, `exportReport`, and local state). Merely starting this backend will not change those buttons. A helper called `frontend-integration.js` is included in this bundle. Copy it into your frontend as `src/api.js`, then wire the handlers:

### Extract attributes

In `App.jsx`, import:

```jsx
import { extractAttributes } from "./api.js";
```

Replace the `onClick={parseDemo}` handler with a handler that calls the API:

```jsx
const extractFromBackend = async () => {
  try {
    setStatus("Processing");
    setNotice("Sending the witness description to the backend...");
    const result = await extractAttributes(description);
    const a = result.attributes;
    setAttributes([
      ["Face shape", a.face_shape, "face_shape"],
      ["Jawline", a.jawline, "jawline"],
      ["Eyes", a.eyes, "eyes"],
      ["Eyebrows", a.eyebrows, "eyebrows"],
      ["Nose", a.nose, "nose"],
      ["Mouth / lips", a.mouth, "mouth"],
      ["Hair", a.hair, "hair"],
      ["Facial hair", a.facial_hair, "facial_hair"]
    ]);
    setTranscribed(true);
    setStatus(result.simulated ? "Fallback mode" : "Backend connected");
    setNotice(result.simulated
      ? "Backend keyword fallback used; configure Groq for model-based extraction."
      : `Attributes extracted by ${result.provider}. Human confirmation is required.`);
  } catch (error) {
    setNotice(`Backend error: ${error.message}`);
  }
};
```

Then change:

```jsx
onClick={parseDemo}
```

to:

```jsx
onClick={extractFromBackend}
```

### Save case

Import `saveCase` and call it from the Case Details save button:

```jsx
await saveCase({
  caseId,
  description,
  attributes: Object.fromEntries(attributes.map(([label, value, key]) => [key, value])),
  stages: stages.map((s, i) => ({ stage: s.title, accepted: Boolean(accepted[i]) })),
  reviewStatus,
  reviewNote
});
```

Wrap the call in `try/catch` and show success/error in `notice`.

### Export PDF

Import `exportPdfReport` and replace the JSON-only export button handler with:

```jsx
exportPdfReport({
  caseId,
  description,
  attributes: Object.fromEntries(attributes.map(([label, value, key]) => [key, value])),
  stages: stages.map((s, i) => ({ stage: s.title, accepted: Boolean(accepted[i]) })),
  reviewStatus,
  reviewNote
}).catch(error => setNotice(`PDF export failed: ${error.message}`));
```

### Vite environment

Create `.env` in the frontend folder:

```env
VITE_API_BASE_URL=http://localhost:4000
```

Restart `npm run dev` after editing environment variables.

## 5. API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Backend and AI configuration status |
| GET | `/api/cases` | List saved local demo cases |
| GET | `/api/cases/:caseId` | Get one case |
| POST | `/api/cases` | Create/update a case |
| PATCH | `/api/cases/:caseId/review` | Update review state and note |
| POST | `/api/transcribe` | Audio upload field `audio`; requires Groq key |
| POST | `/api/extract-attributes` | Extract structured attributes from `{ "statement": "..." }` |
| POST | `/api/generate-sketch` | Explicitly unconfigured placeholder endpoint; returns 501 |
| POST | `/api/report` | Generate PDF from case JSON |

## 6. Quick API tests

```bash
curl http://localhost:4000/api/health

curl -X POST http://localhost:4000/api/extract-attributes \\
  -H 'Content-Type: application/json' \\
  -d '{"statement":"The witness recalls an oval face, thick eyebrows, short dark hair, and a narrow jaw."}'

curl -X POST http://localhost:4000/api/cases \\
  -H 'Content-Type: application/json' \\
  -d '{"caseId":"FAI-2026-0018","description":"Synthetic demo witness statement","attributes":{"face_shape":"Oval"},"reviewStatus":"Pending witness review","reviewNote":""}'

curl -X POST http://localhost:4000/api/report \\
  -H 'Content-Type: application/json' \\
  -d '{"caseId":"FAI-2026-0018","description":"Synthetic demo witness statement","attributes":{"face_shape":"Oval"},"stages":[],"reviewStatus":"Pending witness review","reviewNote":""}' \\
  --output demo-report.pdf
```

## Data flow

1. React sends the witness statement to `POST /api/extract-attributes`.
2. Backend uses Groq Llama when configured, otherwise a labelled local keyword fallback.
3. The frontend lets a human edit and confirm the returned attributes.
4. React sends case details and review state to `/api/cases`.
5. PDF report generation uses `/api/report`.
6. Audio transcription is a separate `/api/transcribe` route; the current UI microphone button only checks permission and does not record/upload audio.
7. Image generation remains unconfigured; the current SVG is only an illustration.
