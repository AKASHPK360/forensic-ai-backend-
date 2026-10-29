import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";

const client = process.env.GROQ_API_KEY
  ? new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1"
    })
  : null;

const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

export function aiAvailable() {
  return Boolean(client || gemini);
}

export async function transcribeAudio(filePath) {
  if (!client) {
    const error = new Error(
      "Speech transcription is not configured. Add GROQ_API_KEY to backend .env."
    );
    error.status = 503;
    throw error;
  }

  const result = await client.audio.transcriptions.create({
    file: await import("node:fs").then(fs => fs.createReadStream(filePath)),
    model: process.env.GROQ_TRANSCRIPTION_MODEL || "whisper-large-v3",language: "en",
    response_format: "json"
  });

  return { text: result.text || "", provider: "Groq Whisper" };
}

export async function extractAttributes(statement) {
  const instruction = `
Extract only facial details explicitly stated by the witness.
Never infer missing traits.
Use "Not confirmed" for absent or unclear attributes.
Return valid JSON with these keys:
face_shape, jawline, eyes, eyebrows, nose, mouth, hair,
facial_hair, uncertainty_notes.
The first eight values must be strings.
uncertainty_notes must be an array of strings.
This is a transcription aid, not identity verification.
`;

  let raw;
  let provider;

  if (gemini) {
    const response = await gemini.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
      contents: `${instruction}\nWitness statement:\n${statement}`,
      config: {
        temperature: 0,
        responseMimeType: "application/json"
      }
    });

    raw = response.text || "{}";
    provider = "Gemini";
  } else if (client) {
    const completion = await client.chat.completions.create({
      model: process.env.GROQ_CHAT_MODEL || "llama-3.3-70b-versatile",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: instruction },
        { role: "user", content: statement }
      ]
    });

    raw = completion.choices[0]?.message?.content || "{}";
    provider = "Groq Llama";
  } else {
    return {
      provider: "local-rule-fallback",
      simulated: true,
      attributes: ruleExtract(statement)
    };
  }

  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch {
    const error = new Error("The language model returned invalid JSON.");
    error.status = 502;
    throw error;
  }

  const keys = [
    "face_shape", "jawline", "eyes", "eyebrows",
    "nose", "mouth", "hair", "facial_hair"
  ];

  const attributes = Object.fromEntries(
    keys.map(key => [
      key,
      typeof parsed[key] === "string"
        ? parsed[key].trim().slice(0, 300) || "Not confirmed"
        : "Not confirmed"
    ])
  );

  attributes.uncertainty_notes = Array.isArray(parsed.uncertainty_notes)
    ? parsed.uncertainty_notes
        .filter(item => typeof item === "string")
        .slice(0, 20)
    : [];

  return { provider, simulated: false, attributes };
}

function ruleExtract(statement) {
  const text = statement.toLowerCase();

  const find = (patterns, value, fallback = "Not confirmed") =>
    patterns.some(pattern => text.includes(pattern)) ? value : fallback;

  return {
    face_shape: find(
      ["oval face", "oval-shaped face"], "Oval",
      find(["round face"], "Round", find(["square face"], "Square"))
    ),
    jawline: find(
      ["narrow jaw", "narrow jawline"], "Narrow",
      find(["broad jaw", "wide jaw"], "Broad")
    ),
    eyes: find(
      ["almond eyes", "almond-shaped eyes"], "Almond-shaped",
      find(["small eyes"], "Small")
    ),
    eyebrows: find(
      ["thick eyebrows", "thick brows"], "Thick",
      find(["thin eyebrows", "thin brows"], "Thin")
    ),
    nose: find(
      ["broad nose", "wide nose"], "Broad",
      find(["small nose"], "Small")
    ),
    mouth: find(
      ["thin lips"], "Thin lips",
      find(["full lips"], "Full lips")
    ),
    hair: find(
      ["long hair"], "Long",
      find(["short hair", "short dark hair"], "Short")
    ),
    facial_hair: find(
      ["beard"], "Beard mentioned",
      find(["moustache", "mustache"], "Moustache mentioned")
    ),
    uncertainty_notes: [
      "Fallback keyword extraction is active; results are not model-generated."
    ]
  };
}
