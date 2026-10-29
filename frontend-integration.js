// Copy this file into your Vite frontend as src/api.js.
// Example: import { extractAttributes, saveCase, exportPdfReport } from "./api.js";
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options.headers }
  });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    const payload = contentType.includes("application/json") ? await response.json() : {};
    throw new Error(payload.error || payload.message || `Request failed (${response.status})`);
  }
  return contentType.includes("application/json") ? response.json() : response.blob();
}

export const getHealth = () => request("/api/health");

export const extractAttributes = (statement) =>
  request("/api/extract-attributes", { method: "POST", body: JSON.stringify({ statement }) });

export const saveCase = (payload) =>
  request("/api/cases", { method: "POST", body: JSON.stringify(payload) });

export const getCase = (caseId) =>
  request(`/api/cases/${encodeURIComponent(caseId)}`);

export const updateReview = (caseId, reviewStatus, reviewNote) =>
  request(`/api/cases/${encodeURIComponent(caseId)}/review`, {
    method: "PATCH", body: JSON.stringify({ reviewStatus, reviewNote })
  });

export const transcribeAudio = (audioFile) => {
  const form = new FormData();
  form.append("audio", audioFile);
  return request("/api/transcribe", { method: "POST", body: form });
};

export async function exportPdfReport(payload) {
  const blob = await request("/api/report", { method: "POST", body: JSON.stringify(payload) });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(payload.caseId || "forensic-case").replace(/[^a-zA-Z0-9_-]/g, "_")}-report.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
