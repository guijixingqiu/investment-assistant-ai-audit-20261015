export const DEEP_RESEARCH_OBJECTIVE_CHECK_IDS = [
  "frozen_source_integrity", "research_question_and_cutoff", "investment_thesis",
  "fact_table_and_sources", "support_evidence", "counter_evidence", "source_conflicts",
  "unknown_items", "key_drivers_and_causal_chain", "valuation_or_implied_expectations",
  "invalidation_conditions", "change_from_previous", "portfolio_impact",
  "next_validation_questions", "model_inferences"
] as const;

export const TODAY_SOURCE_ISSUE_CODES = [
  "missing_materials",
  "stale_materials",
  "conflicting_materials",
  "unverified_materials",
  "unauthorized_rights",
  "future_source_time",
  "unfrozen_revision",
  "pack_integrity_failure",
  "report_pack_mismatch",
  "historical_evidence_pack",
  "holding_snapshot_stale",
  "holding_snapshot_conflict"
] as const;
export type TodaySourceIssueCode = (typeof TODAY_SOURCE_ISSUE_CODES)[number];

export function validateTodayResearchQualityInto(
  value: unknown,
  envelopeStatus: unknown,
  errors: string[]
): void {
  if (!record(value)) { errors.push("quality is required for source-bound Today responses"); return; }
  exact(value, ["sourceHealth", "researchStructure", "secondOpinion"], "quality", errors);
  validateSourceHealth(value.sourceHealth, envelopeStatus, errors);
  validateStructure(value.researchStructure, errors);
  if (record(value.sourceHealth) && record(value.researchStructure)
    && record(value.sourceHealth.evidencePackRef) && record(value.researchStructure.reportRef)
    && value.sourceHealth.evidencePackRef.id !== value.researchStructure.reportRef.evidencePackId) {
    errors.push("quality report does not bind the measured evidence pack");
  }
  if (!record(value.secondOpinion) || !only(value.secondOpinion, ["status", "dependencyIncluded", "reason"])
    || value.secondOpinion.status !== "not_evaluated" || value.secondOpinion.dependencyIncluded !== false
    || !bounded(value.secondOpinion.reason, 1000)) errors.push("quality.secondOpinion is invalid");
}

export function validTodayEvidencePackRef(value: unknown): boolean {
  return record(value) && only(value, ["id", "version", "packFingerprint"])
    && positiveId(value.id) && positiveInteger(value.version) && fingerprint(value.packFingerprint);
}

export function validTodayReportRef(value: unknown): boolean {
  return record(value) && only(value, ["id", "version", "evidencePackId", "status"])
    && positiveId(value.id) && positiveInteger(value.version) && positiveId(value.evidencePackId)
    && ["evidence_insufficient", "complete_pending_confirmation"].includes(String(value.status));
}

export function todayResearchBindingsMatchQuality(bindings: unknown, quality: unknown): boolean {
  if (!record(bindings) || !record(quality) || !record(quality.sourceHealth) || !record(quality.researchStructure)) return false;
  return samePackRef(bindings.evidencePackRef, quality.sourceHealth.evidencePackRef)
    && sameReportRef(bindings.reportRef, quality.researchStructure.reportRef);
}

function validateSourceHealth(value: unknown, envelopeStatus: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("quality.sourceHealth is invalid"); return; }
  exact(value, ["id", "status", "issueCodes", "totalMaterialCount", "currentMaterialCount", "evidencePackRef"], "quality.sourceHealth", errors);
  const status = String(value.status);
  if (!fingerprint(value.id) || !["healthy", "missing", "stale", "conflict", "verification_blocked", "rights_blocked", "revision_mismatch"].includes(status)) {
    errors.push("quality.sourceHealth identity or status is invalid");
  }
  const issues = value.issueCodes;
  if (!Array.isArray(issues) || issues.length > TODAY_SOURCE_ISSUE_CODES.length
    || issues.some((item) => !TODAY_SOURCE_ISSUE_CODES.includes(item as TodaySourceIssueCode))
    || new Set(issues).size !== issues.length) errors.push("quality.sourceHealth issue codes are invalid");
  if (!nonNegativeInteger(value.totalMaterialCount) || !nonNegativeInteger(value.currentMaterialCount)
    || Number(value.currentMaterialCount) > Number(value.totalMaterialCount)) {
    errors.push("quality.sourceHealth material counts are invalid");
  }
  if (value.evidencePackRef !== null && !validTodayEvidencePackRef(value.evidencePackRef)) {
    errors.push("quality.sourceHealth evidencePackRef is invalid");
  }
  if (Array.isArray(issues) && status !== sourceStatus(issues as TodaySourceIssueCode[])) {
    errors.push("quality.sourceHealth status does not match its issue-code precedence");
  }
  const expectedEnvelopeStatus = status === "stale" || status === "conflict" ? status : "available";
  if (envelopeStatus !== expectedEnvelopeStatus) {
    errors.push("quality.sourceHealth does not match Today status");
  }
}

function validateStructure(value: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("quality.researchStructure is invalid"); return; }
  exact(value, ["id", "status", "checks", "gateFailures", "reportRef"], "quality.researchStructure", errors);
  if (!fingerprint(value.id) || !["not_started", "blocked", "passed"].includes(String(value.status))) {
    errors.push("quality.researchStructure identity or status is invalid");
  }
  const checks = value.checks;
  if (!Array.isArray(checks) || checks.length !== DEEP_RESEARCH_OBJECTIVE_CHECK_IDS.length
    || checks.some((check, index) => !record(check) || !only(check, ["id", "passed"])
      || check.id !== DEEP_RESEARCH_OBJECTIVE_CHECK_IDS[index] || typeof check.passed !== "boolean")) {
    errors.push("quality.researchStructure checks are invalid");
  }
  if (!Array.isArray(value.gateFailures) || value.gateFailures.length > 250
    || value.gateFailures.some((item) => !bounded(item, 4000))) {
    errors.push("quality.researchStructure.gateFailures is invalid");
  }
  if (value.reportRef !== null && !validTodayReportRef(value.reportRef)) {
    errors.push("quality.researchStructure reportRef is invalid");
  }
  const passedCount = Array.isArray(checks) ? checks.filter((check) => record(check) && check.passed === true).length : 0;
  const noFailures = Array.isArray(value.gateFailures) && value.gateFailures.length === 0;
  if (value.status === "not_started" && (value.reportRef !== null || passedCount !== 0 || !noFailures)
    || value.status === "passed" && (passedCount !== DEEP_RESEARCH_OBJECTIVE_CHECK_IDS.length
      || !noFailures || !record(value.reportRef) || value.reportRef.status !== "complete_pending_confirmation")
    || value.status === "blocked" && (value.reportRef === null
      || passedCount === DEEP_RESEARCH_OBJECTIVE_CHECK_IDS.length || noFailures)) {
    errors.push("quality.researchStructure status does not match report checks");
  }
}

function sourceStatus(issues: TodaySourceIssueCode[]): string {
  return issues.includes("conflicting_materials") || issues.includes("holding_snapshot_conflict") ? "conflict"
    : issues.includes("stale_materials") || issues.includes("holding_snapshot_stale") ? "stale"
      : issues.includes("unauthorized_rights") ? "rights_blocked"
        : issues.includes("unverified_materials") || issues.includes("future_source_time") ? "verification_blocked"
          : issues.some((issue) => [
            "unfrozen_revision", "pack_integrity_failure", "report_pack_mismatch",
            "historical_evidence_pack"
          ].includes(issue))
            ? "revision_mismatch" : issues.includes("missing_materials") ? "missing" : "healthy";
}

function exact(value: Record<string, unknown>, keys: string[], label: string, errors: string[]): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`);
}
function only(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function bounded(value: unknown, max: number): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}
function fingerprint(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function positiveId(value: unknown): boolean {
  return typeof value === "string" && /^[1-9]\d*$/.test(value);
}
function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function samePackRef(left: unknown, right: unknown): boolean {
  return left === null && right === null || record(left) && record(right)
    && left.id === right.id && left.version === right.version && left.packFingerprint === right.packFingerprint;
}
function sameReportRef(left: unknown, right: unknown): boolean {
  return left === null && right === null || record(left) && record(right)
    && left.id === right.id && left.version === right.version
    && left.evidencePackId === right.evidencePackId && left.status === right.status;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
