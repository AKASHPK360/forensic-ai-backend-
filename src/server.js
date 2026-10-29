import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { aiAvailable, extractAttributes, transcribeAudio } from "./ai.js";
import { getCase, listCases, saveCase } from "./store.js";
import { createPdfReport } from "./report.js";
import { imageGenerationAvailable, generateSketch } from "./imageGeneration.js";
import { enqueueCase } from "./caseQueue.js";
import { pool } from "./db.js";


const here = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(here, "../uploads");
await fs.mkdir(uploadDir, { recursive: true });

const app = express();
const port = Number(process.env.PORT || 4000);
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
      "http://127.0.0.1:5175"
    ];
    const configuredOrigin = process.env.FRONTEND_ORIGIN;
    if (!origin || allowedOrigins.includes(origin) || origin === configuredOrigin) {
      return callback(null, true);
    }
    return callback(new Error("Origin not allowed by CORS"));
  },
  methods: ["GET", "POST", "PATCH", "OPTIONS"]
}));
app.use(express.json({ limit: "1mb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }));

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => {
      const ext = file.originalname.includes(".")
        ? "." + file.originalname.split(".").pop().toLowerCase()
        : "";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(["audio/webm", "audio/wav", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/x-wav", "audio/mp3", "audio/m4a"]);
    if (allowed.has(file.mimetype) || /^audio\//.test(file.mimetype)) cb(null, true);
    else cb(new Error("Upload must be an audio file."));
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "forensic-ai-backend",
    aiConfigured: aiAvailable(),
    imageGeneration: imageGenerationAvailable() ? "configured" : "not configured",
    warning: "Prototype only. Do not submit real case data without security, consent, and retention controls."
  });
});

app.get("/api/cases", async (_req, res, next) => {
  try { res.json({ cases: await listCases() }); } catch (e) { next(e); }
});

app.get("/api/cases/:caseId", async (req, res, next) => {
  try {
    const record = await getCase(req.params.caseId);
    if (!record) return res.status(404).json({ error: "Case not found." });
    res.json({ case: record });
  } catch (e) { next(e); }
});

app.post("/api/cases", async (req, res, next) => {
  try {
    const { caseId, description = "", attributes = {}, stages = [], reviewStatus = "Pending witness review", reviewNote = "" } = req.body || {};
    if (typeof caseId !== "string" || !caseId.trim()) return res.status(400).json({ error: "caseId is required." });
    if (typeof description !== "string" || description.length > 12000) return res.status(400).json({ error: "description must be a string of at most 12000 characters." });
    const record = await saveCase({ caseId: caseId.trim().slice(0, 100), description, attributes, stages, reviewStatus, reviewNote });
    res.status(201).json({ case: record });
  } catch (e) { next(e); }
});

app.patch("/api/cases/:caseId/review", async (req, res, next) => {
  try {
    const existing = await getCase(req.params.caseId);
    if (!existing) return res.status(404).json({ error: "Save the case before updating its review." });
    const reviewStatus = typeof req.body?.reviewStatus === "string" ? req.body.reviewStatus.slice(0, 100) : existing.reviewStatus;
    const reviewNote = typeof req.body?.reviewNote === "string" ? req.body.reviewNote.slice(0, 5000) : existing.reviewNote;
    res.json({ case: await saveCase({ ...existing, reviewStatus, reviewNote }) });
  } catch (e) { next(e); }
});

app.post("/api/transcribe", upload.single("audio"), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: "Attach an audio file using the 'audio' field." });
  try {
    const result = await transcribeAudio(req.file.path);
    res.json(result);
  } catch (e) { next(e); }
  finally { await fs.rm(req.file.path, { force: true }).catch(() => {}); }
});

app.post("/api/extract-attributes", async (req, res, next) => {
  try {
    const statement = req.body?.statement;
    if (typeof statement !== "string" || !statement.trim()) return res.status(400).json({ error: "statement is required." });
    if (statement.length > 12000) return res.status(400).json({ error: "statement must be at most 12000 characters." });
    res.json(await extractAttributes(statement.trim()));
  } catch (e) { next(e); }
});

app.post("/api/generate-sketch", async (req, res) => {
  try {
    const { caseId, stage, attributes } = req.body || {};

    if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
      return res.status(400).json({ error: "Valid facial attributes are required." });
    }

    const image = await generateSketch(attributes, stage);

    res.json({
      ok: true,
      caseId: typeof caseId === "string" ? caseId : null,
      stage: typeof stage === "string" ? stage : "initial",
      image: "data:image/jpeg;base64," + image
    });
  } catch (error) {
    console.error("Sketch generation failed:", error.stack || error.message || error);
    res.status(502).json({
      error: "Image generation failed",
      details: error.message || "Unknown error"
    });
  }
});

app.post("/api/report", async (req, res, next) => {
  try {
    const record = req.body || {};
    if (typeof record.caseId !== "string" || !record.caseId.trim()) return res.status(400).json({ error: "caseId is required." });
    createPdfReport(record, res);
  } catch (e) { next(e); }
});


// Batch upload: each text statement becomes an independent background job.
const batchUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== ".txt") {
      const error = new Error("Batch upload currently accepts .txt witness statements only.");
      error.status = 400;
      return cb(error);
    }
    cb(null, true);
  },
});

app.post("/api/cases/batch", batchUpload.array("files", 10), async (req, res, next) => {
  const created = [];

  try {
    if (!req.files?.length) {
      return res.status(400).json({ error: "Upload at least one .txt witness statement." });
    }

    for (const file of req.files) {
      const description = file.buffer.toString("utf8").trim();

      if (!description) {
        created.push({
          filename: file.originalname,
          status: "rejected",
          error: "The statement file is empty.",
        });
        continue;
      }

      if (description.length > 12000) {
        created.push({
          filename: file.originalname,
          status: "rejected",
          error: "The statement exceeds the 12,000-character limit.",
        });
        continue;
      }

      const caseId = `CASE-${randomUUID()}`;

      await saveCase({
        caseId,
        description,
        attributes: {},
        stages: [],
        reviewStatus: "Pending witness review",
        reviewNote: "",
      });

      const jobId = `case-${caseId}`;

      await pool.query(
        `INSERT INTO case_jobs (job_id, case_id, status, progress)
         VALUES ($1, $2, 'queued', 0)
         ON CONFLICT (job_id) DO NOTHING`,
        [jobId, caseId]
      );

      try {
        await enqueueCase(caseId, { description });
        created.push({
          filename: file.originalname,
          caseId,
          jobId,
          status: "queued",
        });
      } catch (queueError) {
        await pool.query(
          `UPDATE case_jobs
           SET status = 'failed', error = $2, updated_at = NOW()
           WHERE job_id = $1`,
          [jobId, String(queueError.message || queueError).slice(0, 2000)]
        );

        created.push({
          filename: file.originalname,
          caseId,
          jobId,
          status: "failed",
          error: "Could not enqueue this case.",
        });
      }
    }

    res.status(202).json({
      message: "Batch accepted. Each case is processed independently.",
      total: req.files.length,
      cases: created,
    });
  } catch (error) {
    next(error);
  }
});

// Check the latest background-processing status for a case.

app.get("/api/results/:filename", async (req, res, next) => {
  try {
    const filename = req.params.filename;

    if (!/^[a-zA-Z0-9_-]+\.jpg$/.test(filename)) {
      return res.status(400).json({ error: "Invalid result filename." });
    }

    const resultsDir = path.resolve(here, "../uploads/results");
    const filePath = path.join(resultsDir, filename);
    const file = await fs.readFile(filePath);

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(404).json({ error: "Sketch image not found." });
    }
    next(error);
  }
});

app.get("/api/cases/:caseId/job", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT job_id, case_id, status, progress, error, result,
              created_at, updated_at
       FROM case_jobs
       WHERE case_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [req.params.caseId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "No background job found for this case." });
    }

    res.json({ job: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err?.message || err);
  const status = Number(err?.status) || (err instanceof multer.MulterError ? 400 : 500);
  res.status(status).json({ error: status === 500 ? "Internal server error." : err.message });
});

app.listen(port, () => console.log(`Forensic AI backend listening on http://localhost:${port}`));
