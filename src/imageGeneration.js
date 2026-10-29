import { createHash } from "node:crypto";
import { pool } from "./db.js";

const MODEL = "@cf/black-forest-labs/flux-1-schnell";
export function imageGenerationAvailable() {
  return Boolean(
    process.env.CLOUDFLARE_API_TOKEN &&
    process.env.CLOUDFLARE_ACCOUNT_ID
  );
}

export function normalizeAttributes(attributes = {}) {
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([, value]) => value != null && String(value).trim())
      .map(([key, value]) => [
        key.trim().toLowerCase(),
        String(value).trim().replace(/\s+/g, " ").toLowerCase()
      ])
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

export function sketchCacheKey(attributes = {}, stage = "initial") {
  const normalized = normalizeAttributes(attributes);

  return createHash("sha256")
    .update(JSON.stringify({
      model: MODEL,
      stage: String(stage || "initial").trim().toLowerCase(),
      attributes: normalized,
      promptVersion: 2
    }))
    .digest("hex");
}

export async function generateSketch(attributes = {}, stage = "initial") {
  const cacheKey = sketchCacheKey(attributes, stage);

  // Reuse a previously generated image for identical inputs.
  const cached = await pool.query(
    "SELECT image_base64 FROM sketch_cache WHERE cache_key = $1",
    [cacheKey]
  );

  if (cached.rows.length) {
    console.log("Sketch cache hit:", cacheKey);
    return cached.rows[0].image_base64;
  }

  console.log("Sketch cache miss; requesting image generation.");
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!token || !accountId) {
    throw new Error(
      "Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in backend/.env"
    );
  }

  const normalized = normalizeAttributes(attributes);
  const entries = Object.entries(normalized);

  if (!entries.length) {
    throw new Error("Facial attributes are required.");
  }

  const description = entries
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");

  const headwear = normalized.headwear || normalized.hat || normalized.head_covering || "";
  const hasSpecifiedHeadwear = Boolean(headwear) &&
    !["unknown", "not confirmed", "none", "no hat", "no headwear", "not specified"].includes(headwear);

  const prompt =
    "Create a fictional monochrome pencil-style forensic composite illustration. " +
    "Use a centered, front-facing head, neutral expression, plain white background, " +
    "consistent proportions, clear facial features, and hand-drawn graphite lines. " +
    "Follow these witness-provided attributes closely: " + description + ". " +
    (hasSpecifiedHeadwear
      ? (
          "IMPORTANT HEADWEAR REQUIREMENT: Clearly draw the specified headwear on top of the person's head: " +
          headwear + ". The hat must be fully visible, recognizable, and positioned naturally above the forehead. " +
          "Do not omit, hide, crop out, or replace the hat with hair. Preserve the specified hat colour and brim. "
        )
      : "Do not invent hats, headwear, or accessories when they are not specified. ") +
    "Do not add other unnecessary accessories or dramatic lighting. " +
    "Stage: " + String(stage || "initial") + ". " +
    "This is a fictional illustration, not an identification of a real person.";

  const url =
    `https://api.cloudflare.com/client/v4/accounts/${accountId}` +
    `/ai/run/${MODEL}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt,
      steps: 4,
    })
  });

  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const data = await response.json();

    if (!response.ok || !data.success) {
      const details = (data.errors || [])
        .map(error => error.message)
        .join("; ");

      console.error("Cloudflare image API failed:", response.status, details);

      throw new Error(
        details || `Cloudflare image API returned HTTP ${response.status}`
      );
    }

    if (data.result?.image) {
      const image = data.result.image;
      await pool.query(
        `INSERT INTO sketch_cache (cache_key, image_base64, stage)
         VALUES ($1, $2, $3)
         ON CONFLICT (cache_key) DO NOTHING`,
        [cacheKey, image, String(stage || "initial")]
      );
      return image;
    }

    throw new Error("Cloudflare returned no image.");
  }

  if (!response.ok) {
    throw new Error(`Cloudflare image API returned HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (!buffer.length) {
    throw new Error("Cloudflare returned an empty image.");
  }

  const image = buffer.toString("base64");

  await pool.query(
    `INSERT INTO sketch_cache (cache_key, image_base64, stage)
     VALUES ($1, $2, $3)
     ON CONFLICT (cache_key) DO NOTHING`,
    [cacheKey, image, String(stage || "initial")]
  );

  return image;
}
