import { isRfc3339DateTime } from "./factMetadata.js";

export interface TodayActionInboxResearchTaskRef {
  id: string;
  requestFingerprint: string;
  evidencePackId: string;
  evidencePackFingerprint: string;
  completedAt: string | null;
}

export function validateTodayActionInboxResearchTarget(
  value: Record<string, unknown>,
  index: number,
  errors: string[]
): void {
  const label = `items[${index}].researchTarget`;
  exact(value, ["itemId", "preferredLayer", "report", "task"], label, errors);
  if (!bounded(value.itemId, 500)) errors.push(`${label}.itemId is invalid`);
  if (!["evidence", "portfolio"].includes(String(value.preferredLayer))) errors.push(`${label}.preferredLayer is invalid`);
  if (value.report !== null) {
    if (!record(value.report)) errors.push(`${label}.report must be null or an object`);
    else {
      exact(value.report, ["id", "version", "evidencePackId"], `${label}.report`, errors);
      if (!bounded(value.report.id, 100)) errors.push(`${label}.report.id is invalid`);
      if (!bounded(value.report.evidencePackId, 100)) errors.push(`${label}.report.evidencePackId is invalid`);
      if (!Number.isSafeInteger(value.report.version) || Number(value.report.version) < 1) errors.push(`${label}.report.version is invalid`);
    }
  }
  validateTask(value.task, record(value.report) ? value.report.evidencePackId : undefined, index, errors);
}

function validateTask(
  value: unknown,
  reportEvidencePackId: unknown,
  index: number,
  errors: string[]
): void {
  if (value === null) return;
  if (!record(value)) {
    errors.push(`items[${index}].researchTarget.task must be null or an object`);
    return;
  }
  const label = `items[${index}].researchTarget.task`;
  const allowed = new Set(["id", "requestFingerprint", "evidencePackId", "evidencePackFingerprint", "completedAt"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`);
  if (!bounded(value.id, 100)) errors.push(`${label}.id is invalid`);
  if (!bounded(value.evidencePackId, 100)) errors.push(`${label}.evidencePackId is invalid`);
  if (!sha(value.requestFingerprint)) errors.push(`${label}.requestFingerprint is invalid`);
  if (!sha(value.evidencePackFingerprint)) errors.push(`${label}.evidencePackFingerprint is invalid`);
  if (value.completedAt !== null && !instant(value.completedAt)) errors.push(`${label}.completedAt is invalid`);
  if (reportEvidencePackId !== undefined && reportEvidencePackId !== value.evidencePackId) {
    errors.push(`items[${index}].researchTarget task and report evidence packs do not match`);
  }
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function bounded(value: unknown, max: number): boolean { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function sha(value: unknown): boolean { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function instant(value: unknown): boolean { return typeof value === "string" && isRfc3339DateTime(value) && Number.isFinite(Date.parse(value)); }
function exact(value: Record<string, unknown>, expected: string[], label: string, errors: string[]): void {
  const actual = Object.keys(value).sort();
  const target = [...expected].sort();
  if (actual.length !== target.length || actual.some((key, index) => key !== target[index])) errors.push(`${label} has unexpected or missing keys`);
}
