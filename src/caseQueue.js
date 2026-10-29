import "dotenv/config";
import { Queue } from "bullmq";

const connection = process.env.REDIS_URL
  ? {
      ...new URL(process.env.REDIS_URL),
      maxRetriesPerRequest: null,
    }
  : {
      host: "127.0.0.1",
      port: 6379,
      maxRetriesPerRequest: null,
    };

export const caseQueue = new Queue("forensic-case-processing", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: 500,
    removeOnFail: 1000,
  },
});

export async function enqueueCase(caseId, payload = {}) {
  return caseQueue.add(
    "process-case",
    { caseId, ...payload },
    {
      jobId: `case-${caseId}`,
    }
  );
}
