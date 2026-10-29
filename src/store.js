import { pool, initializeDatabase } from "./db.js";

let databaseReady;

async function ensureDatabase() {
  if (!databaseReady) {
    databaseReady = initializeDatabase().catch((error) => {
      databaseReady = null;
      throw error;
    });
  }
  await databaseReady;
}

function fromRow(row) {
  if (!row) return null;

  return {
    ...row.data,
    caseId: row.case_id,
    description: row.description,
    attributes: row.attributes,
    stages: row.stages,
    reviewStatus: row.review_status,
    reviewNote: row.review_note,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
  };
}

export async function listCases() {
  await ensureDatabase();

  const result = await pool.query(`
    SELECT *
    FROM cases
    ORDER BY updated_at DESC
  `);

  return result.rows.map(fromRow);
}

export async function getCase(id) {
  await ensureDatabase();

  const result = await pool.query(
    "SELECT * FROM cases WHERE case_id = $1",
    [id]
  );

  return fromRow(result.rows[0]);
}

export async function saveCase(record) {
  if (!record?.caseId || typeof record.caseId !== "string") {
    throw new Error("A valid caseId is required.");
  }

  await ensureDatabase();

  const existing = await getCase(record.caseId);
  const merged = {
    ...(existing ?? {}),
    ...record,
    caseId: record.caseId,
    description: record.description ?? existing?.description ?? "",
    attributes: record.attributes ?? existing?.attributes ?? {},
    stages: record.stages ?? existing?.stages ?? [],
    reviewStatus:
      record.reviewStatus ??
      existing?.reviewStatus ??
      "Pending witness review",
    reviewNote: record.reviewNote ?? existing?.reviewNote ?? "",
  };

  const result = await pool.query(
    `INSERT INTO cases (
       case_id, description, attributes, stages,
       review_status, review_note, data
     )
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7::jsonb)
     ON CONFLICT (case_id)
     DO UPDATE SET
       description = EXCLUDED.description,
       attributes = EXCLUDED.attributes,
       stages = EXCLUDED.stages,
       review_status = EXCLUDED.review_status,
       review_note = EXCLUDED.review_note,
       data = cases.data || EXCLUDED.data,
       updated_at = NOW()
     RETURNING *`,
    [
      merged.caseId,
      merged.description,
      JSON.stringify(merged.attributes),
      JSON.stringify(merged.stages),
      merged.reviewStatus,
      merged.reviewNote,
      JSON.stringify(merged),
    ]
  );

  return fromRow(result.rows[0]);
}
