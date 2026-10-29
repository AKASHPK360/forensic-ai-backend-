import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://localhost:5432/forensic_ai",
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cases (
      case_id TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
      stages JSONB NOT NULL DEFAULT '[]'::jsonb,
      review_status TEXT NOT NULL DEFAULT 'Pending witness review',
      review_note TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS case_jobs (
      job_id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      result JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sketch_cache (
      cache_key TEXT PRIMARY KEY,
      image_base64 TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'initial',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_case_jobs_status
      ON case_jobs(status);

    CREATE INDEX IF NOT EXISTS idx_case_jobs_case_id
      ON case_jobs(case_id);
  `);

  console.log("PostgreSQL tables are ready.");
}
