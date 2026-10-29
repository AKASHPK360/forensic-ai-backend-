import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "bullmq";
import { pool, initializeDatabase } from "./db.js";
import { saveCase, getCase } from "./store.js";
import { extractAttributes } from "./ai.js";
import { generateSketch } from "./imageGeneration.js";

const connection = process.env.REDIS_URL
  ? {
      host: new URL(process.env.REDIS_URL).hostname,
      port: Number(new URL(process.env.REDIS_URL).port || 6379),
      username: new URL(process.env.REDIS_URL).username || undefined,
      password: new URL(process.env.REDIS_URL).password || undefined,
      maxRetriesPerRequest: null,
    }
  : {
      host: "127.0.0.1",
      port: 6379,
      maxRetriesPerRequest: null,
    };

const resultsDir = path.resolve("uploads/results");

await fs.mkdir(resultsDir, { recursive: true });
await initializeDatabase();

const worker = new Worker(
  "forensic-case-processing",
  async (job) => {
    const { caseId, description = "", attributes = {}, stage = "initial" } =
      job.data;

    if (!caseId) throw new Error("Case ID is required.");

    const jobId = String(job.id);
    let imagePath;

    try {
      await pool.query(
        `INSERT INTO case_jobs
           (job_id, case_id, status, progress)
         VALUES ($1, $2, 'processing', 10)
         ON CONFLICT (job_id)
         DO UPDATE SET status = 'processing',
                       progress = 10,
                       error = NULL,
                       updated_at = NOW()`,
        [jobId, caseId]
      );

      await job.updateProgress(10);

      const existing = await getCase(caseId);

      if (!existing) {
        await saveCase({
          caseId,
          description,
          attributes,
          stages: [],
        });
      }

      let facialAttributes = attributes;

      if (!facialAttributes || Object.keys(facialAttributes).length === 0) {
        if (!description.trim()) {
          throw new Error("A witness description is required.");
        }

        facialAttributes = await extractAttributes(description);
      }

      if (!facialAttributes || Object.keys(facialAttributes).length === 0) {
        throw new Error("No facial attributes could be extracted.");
      }

      await pool.query(
        `UPDATE case_jobs
         SET progress = 40, updated_at = NOW()
         WHERE job_id = $1`,
        [jobId]
      );

      await job.updateProgress(40);

      const imageBase64 = await generateSketch(facialAttributes, stage);

      const safeCaseId = caseId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const filename = `${safeCaseId}-${jobId.replace(/[^a-zA-Z0-9_-]/g, "_")}.jpg`;

      imagePath = path.join(resultsDir, filename);

      await fs.writeFile(imagePath, Buffer.from(imageBase64, "base64"));

      const current = await getCase(caseId);

      await saveCase({
        ...current,
        caseId,
        description: description || current?.description || "",
        attributes: facialAttributes,
        data: {
          ...(current?.data || {}),
          sketchFile: filename,
          sketchStage: stage,
          sketchGeneratedAt: new Date().toISOString(),
        },
      });

      const result = {
        caseId,
        stage,
        sketchFile: filename,
        attributes: facialAttributes,
      };

      await pool.query(
        `UPDATE case_jobs
         SET status = 'completed',
             progress = 100,
             result = $2::jsonb,
             error = NULL,
             updated_at = NOW()
         WHERE job_id = $1`,
        [jobId, JSON.stringify(result)]
      );

      await job.updateProgress(100);

      console.log(`Completed forensic case: ${caseId}`);
      return result;
    } catch (error) {
      await pool.query(
        `UPDATE case_jobs
         SET status = 'failed',
             error = $2,
             updated_at = NOW()
         WHERE job_id = $1`,
        [jobId, String(error.message || error).slice(0, 2000)]
      ).catch((dbError) => {
        console.error("Could not update job status:", dbError.message);
      });

      throw error;
    }
  },
  {
    connection,
    concurrency: 2,
  }
);

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed.`);
});

worker.on("failed", (job, error) => {
  console.error(`Job ${job?.id ?? "unknown"} failed: ${error.message}`);
});

worker.on("error", (error) => {
  console.error("Worker error:", error.message);
});

async function shutdown() {
  console.log("Stopping forensic worker...");
  await worker.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("Forensic worker ready. Concurrency: 2.");
