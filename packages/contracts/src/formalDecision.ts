export const FORMAL_DECISION_DIRECTIONS = [
  "buy", "watch", "add", "hold", "reduce", "sell", "abandon", "wait_for_evidence"
] as const;

export type FormalDecisionDirection = (typeof FORMAL_DECISION_DIRECTIONS)[number];

export const FORMAL_PERSONAL_RISK_WARNING_CODES = [
  "candidate_weight_above_limit",
  "largest_position_weight_above_limit",
  "portfolio_hhi_above_limit",
  "unrealized_loss_above_budget"
] as const;

export type FormalPersonalRiskWarningCode = (typeof FORMAL_PERSONAL_RISK_WARNING_CODES)[number];

export interface FormalPersonalRiskLimits {
  maxCandidateWeight: number | null;
  maxLargestPositionWeight: number | null;
  maxPortfolioHhi: number | null;
  maxUnrealizedLossHkd: number | null;
}

export interface FormalPersonalRiskConfirmation {
  limits: FormalPersonalRiskLimits;
  overrideReason: string | null;
  secondConfirmed: boolean;
}

export interface FormalPersonalRiskWarning {
  code: FormalPersonalRiskWarningCode;
  actual: number;
  limit: number;
}

export interface FormalPersonalRiskAssessment {
  status: "not_requested" | "available" | "partial" | "unavailable";
  warnings: FormalPersonalRiskWarning[];
  unavailableMetrics: FormalPersonalRiskWarningCode[];
  requiresOverride: boolean;
  limitation: string;
}

export interface FormalPersonalRiskFacts {
  candidateWeight: number | null;
  largestPositionWeight: number | null;
  portfolioHhi: number | null;
  unrealizedLossHkd: number | null;
}

export interface FormalOwnerDecisionInput {
  reason: string;
  horizon: string;
  priceConditions: string;
  positionRange: string;
  mainRisks: string;
  invalidationConditions: string;
  reviewOn: string;
  divergenceReason: string | null;
  positionBasis: "research_only";
  personalRisk?: FormalPersonalRiskConfirmation;
}

export interface FormalSystemRecommendationSnapshot {
  source: "deep_research_report_advice_layer";
  direction: FormalDecisionDirection;
  conclusion: string;
  confidence: "low" | "medium" | "high" | "UNKNOWN";
  horizon: string;
  priceConditions: string[];
  priceRange: string;
  researchPositionRange: string;
  assumptions: string[];
  scenarios: string[];
  risks: string[];
  invalidationConditions: string[];
  nextQuestion: string;
  versionChange: string;
  reportId: string;
  reportVersion: number;
  reportFingerprint: string;
  nonExecuting: true;
}

export type FormalDecisionState =
  | {
      availability: "preserved";
      systemRecommendation: FormalSystemRecommendationSnapshot;
      ownerDecision: FormalOwnerDecisionInput;
      differsFromSystem: boolean;
      personalRiskAssessment?: FormalPersonalRiskAssessment;
      limitation: string;
    }
  | {
      availability: "not_captured";
      systemRecommendation: null;
      ownerDecision: null;
      differsFromSystem: null;
      personalRiskAssessment?: null;
      limitation: string;
    };

export function formalDecisionNotCapturedState(): FormalDecisionState {
  return {
    availability: "not_captured",
    systemRecommendation: null,
    ownerDecision: null,
    differsFromSystem: null,
    limitation: "This historical decision did not capture separate system-recommendation and Owner-decision snapshots; they are not reconstructed."
  };
}

export function validateFormalOwnerDecisionInput(
  value: unknown,
  field = "formalDecision",
  requirePersonalRisk = false
): { ok: true; value: FormalOwnerDecisionInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: [`${field} must be an object`] };
  exactWithOptional(value, [
    "reason", "horizon", "priceConditions", "positionRange", "mainRisks",
    "invalidationConditions", "reviewOn", "divergenceReason", "positionBasis"
  ], ["personalRisk"], field, errors);
  for (const key of ["reason", "horizon", "priceConditions", "positionRange", "mainRisks", "invalidationConditions"] as const) {
    text(value[key], `${field}.${key}`, errors);
  }
  if (typeof value.reviewOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.reviewOn)
    || !Number.isFinite(Date.parse(`${value.reviewOn}T00:00:00Z`))
    || new Date(`${value.reviewOn}T00:00:00Z`).toISOString().slice(0, 10) !== value.reviewOn) errors.push(`${field}.reviewOn must be a valid YYYY-MM-DD calendar date`);
  if (value.divergenceReason !== null) text(value.divergenceReason, `${field}.divergenceReason`, errors);
  if (value.positionBasis !== "research_only") errors.push(`${field}.positionBasis must be research_only`);
  if (value.personalRisk === undefined) {
    if (requirePersonalRisk) errors.push(`${field}.personalRisk is required`);
  } else validatePersonalRiskConfirmation(value.personalRisk, `${field}.personalRisk`, errors);
  return errors.length ? { ok: false, errors } : { ok: true, value: value as unknown as FormalOwnerDecisionInput };
}

export function validateFormalDecisionState(
  value: unknown,
  field = "formalDecision"
): { ok: true; value: FormalDecisionState } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: [`${field} must be an object`] };
  exactWithOptional(value, ["availability", "systemRecommendation", "ownerDecision", "differsFromSystem", "limitation"], ["personalRiskAssessment"], field, errors);
  text(value.limitation, `${field}.limitation`, errors);
  if (value.availability === "not_captured") {
    if (value.systemRecommendation !== null || value.ownerDecision !== null || value.differsFromSystem !== null
      || value.personalRiskAssessment !== undefined && value.personalRiskAssessment !== null) {
      errors.push(`${field} not_captured values must be null`);
    }
  } else if (value.availability === "preserved") {
    systemRecommendation(value.systemRecommendation, `${field}.systemRecommendation`, errors);
    const owner = validateFormalOwnerDecisionInput(value.ownerDecision, `${field}.ownerDecision`);
    if (!owner.ok) errors.push(...owner.errors);
    if (typeof value.differsFromSystem !== "boolean") errors.push(`${field}.differsFromSystem must be boolean`);
    if (record(value.systemRecommendation) && value.differsFromSystem === true
      && owner.ok && owner.value.divergenceReason === null) errors.push(`${field}.ownerDecision.divergenceReason is required when directions differ`);
    if (value.personalRiskAssessment !== undefined) {
      validatePersonalRiskAssessment(value.personalRiskAssessment, `${field}.personalRiskAssessment`, errors);
      if (owner.ok) validatePersonalRiskCoherence(owner.value.personalRisk, value.personalRiskAssessment, `${field}.personalRiskAssessment`, errors);
    } else if (owner.ok && owner.value.personalRisk !== undefined) errors.push(`${field}.personalRiskAssessment is required with current personal-risk inputs`);
  } else errors.push(`${field}.availability must be preserved or not_captured`);
  return errors.length ? { ok: false, errors } : { ok: true, value: value as unknown as FormalDecisionState };
}

export function evaluateFormalPersonalRisk(
  limits: FormalPersonalRiskLimits,
  facts: FormalPersonalRiskFacts
): FormalPersonalRiskAssessment {
  const configured = riskMetrics(limits, facts).filter((metric) => metric.limit !== null);
  if (configured.length === 0) return {
    status: "not_requested", warnings: [], unavailableMetrics: [], requiresOverride: false,
    limitation: "No personal risk limit was supplied for this formal decision."
  };
  const warnings: FormalPersonalRiskWarning[] = [];
  const unavailableMetrics: FormalPersonalRiskWarningCode[] = [];
  for (const metric of configured) {
    if (metric.actual === null) unavailableMetrics.push(metric.code);
    else if (metric.actual > metric.limit!) warnings.push({ code: metric.code, actual: metric.actual, limit: metric.limit! });
  }
  const status = unavailableMetrics.length === 0 ? "available"
    : unavailableMetrics.length === configured.length ? "unavailable" : "partial";
  return {
    status,
    warnings,
    unavailableMetrics,
    requiresOverride: warnings.length > 0 || unavailableMetrics.length > 0,
    limitation: "Personal limits are Owner inputs checked against the exact decision snapshot; warnings are advisory and never create an order, trade, or asset mutation."
  };
}

function riskMetrics(limits: FormalPersonalRiskLimits, facts: FormalPersonalRiskFacts): Array<{ code: FormalPersonalRiskWarningCode; actual: number | null; limit: number | null }> {
  return [
    { code: "candidate_weight_above_limit", actual: facts.candidateWeight, limit: limits.maxCandidateWeight },
    { code: "largest_position_weight_above_limit", actual: facts.largestPositionWeight, limit: limits.maxLargestPositionWeight },
    { code: "portfolio_hhi_above_limit", actual: facts.portfolioHhi, limit: limits.maxPortfolioHhi },
    { code: "unrealized_loss_above_budget", actual: facts.unrealizedLossHkd, limit: limits.maxUnrealizedLossHkd }
  ];
}

function validatePersonalRiskConfirmation(value: unknown, field: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${field} must be an object`); return; }
  exact(value, ["limits", "overrideReason", "secondConfirmed"], field, errors);
  validatePersonalRiskLimits(value.limits, `${field}.limits`, errors);
  if (value.overrideReason !== null) text(value.overrideReason, `${field}.overrideReason`, errors);
  if (typeof value.secondConfirmed !== "boolean") errors.push(`${field}.secondConfirmed must be boolean`);
}

function validatePersonalRiskLimits(value: unknown, field: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${field} must be an object`); return; }
  exact(value, ["maxCandidateWeight", "maxLargestPositionWeight", "maxPortfolioHhi", "maxUnrealizedLossHkd"], field, errors);
  for (const key of ["maxCandidateWeight", "maxLargestPositionWeight", "maxPortfolioHhi"] as const) {
    if (value[key] !== null && (!finite(value[key]) || Number(value[key]) < 0 || Number(value[key]) > 1)) {
      errors.push(`${field}.${key} must be between 0 and 1 or null`);
    }
  }
  if (value.maxUnrealizedLossHkd !== null && (!finite(value.maxUnrealizedLossHkd) || Number(value.maxUnrealizedLossHkd) < 0)) {
    errors.push(`${field}.maxUnrealizedLossHkd must be non-negative or null`);
  }
}

function validatePersonalRiskAssessment(value: unknown, field: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${field} must be an object`); return; }
  exact(value, ["status", "warnings", "unavailableMetrics", "requiresOverride", "limitation"], field, errors);
  if (!["not_requested", "available", "partial", "unavailable"].includes(String(value.status))) errors.push(`${field}.status is invalid`);
  if (!Array.isArray(value.warnings)) errors.push(`${field}.warnings must be an array`);
  else value.warnings.forEach((warning, index) => validatePersonalRiskWarning(warning, `${field}.warnings[${index}]`, errors));
  if (!Array.isArray(value.unavailableMetrics)
    || value.unavailableMetrics.some((code) => !FORMAL_PERSONAL_RISK_WARNING_CODES.includes(code as FormalPersonalRiskWarningCode))
    || new Set(value.unavailableMetrics).size !== value.unavailableMetrics.length) errors.push(`${field}.unavailableMetrics is invalid`);
  if (typeof value.requiresOverride !== "boolean") errors.push(`${field}.requiresOverride must be boolean`);
  text(value.limitation, `${field}.limitation`, errors);
  if (Array.isArray(value.warnings) && Array.isArray(value.unavailableMetrics)
    && value.requiresOverride !== (value.warnings.length > 0 || value.unavailableMetrics.length > 0)) {
    errors.push(`${field}.requiresOverride must match warnings and unavailable metrics`);
  }
  if (value.status === "not_requested" && (Array.isArray(value.warnings) && value.warnings.length > 0
    || Array.isArray(value.unavailableMetrics) && value.unavailableMetrics.length > 0)) errors.push(`${field}.not_requested must be empty`);
  if (value.status === "available" && Array.isArray(value.unavailableMetrics) && value.unavailableMetrics.length > 0) errors.push(`${field}.available must not contain unavailable metrics`);
}

function validatePersonalRiskWarning(value: unknown, field: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${field} must be an object`); return; }
  exact(value, ["code", "actual", "limit"], field, errors);
  if (!FORMAL_PERSONAL_RISK_WARNING_CODES.includes(value.code as FormalPersonalRiskWarningCode)) errors.push(`${field}.code is invalid`);
  if (!finite(value.actual) || Number(value.actual) < 0) errors.push(`${field}.actual must be non-negative`);
  if (!finite(value.limit) || Number(value.limit) < 0) errors.push(`${field}.limit must be non-negative`);
  if (finite(value.actual) && finite(value.limit) && value.actual <= value.limit) errors.push(`${field}.actual must exceed limit`);
}

function validatePersonalRiskCoherence(
  confirmation: FormalPersonalRiskConfirmation | undefined,
  assessment: unknown,
  field: string,
  errors: string[]
): void {
  if (!confirmation || !record(assessment)) { errors.push(`${field} requires exact Owner personal-risk inputs`); return; }
  const requiresOverride = assessment.requiresOverride === true;
  if (requiresOverride && (confirmation.overrideReason === null || confirmation.secondConfirmed !== true)) {
    errors.push(`${field} warnings require an override reason and second confirmation`);
  }
  if (!requiresOverride && (confirmation.overrideReason !== null || confirmation.secondConfirmed !== false)) {
    errors.push(`${field} clear or unrequested risk must not claim an override`);
  }
}

function systemRecommendation(value: unknown, field: string, errors: string[]): void {
  if (!record(value)) { errors.push(`${field} must be an object`); return; }
  exact(value, [
    "source", "direction", "conclusion", "confidence", "horizon", "priceConditions",
    "priceRange", "researchPositionRange", "assumptions", "scenarios", "risks",
    "invalidationConditions", "nextQuestion", "versionChange", "reportId", "reportVersion",
    "reportFingerprint", "nonExecuting"
  ], field, errors);
  if (value.source !== "deep_research_report_advice_layer") errors.push(`${field}.source is invalid`);
  direction(value.direction, `${field}.direction`, errors);
  for (const key of ["conclusion", "horizon", "priceRange", "researchPositionRange", "nextQuestion", "versionChange", "reportId"] as const) {
    text(value[key], `${field}.${key}`, errors);
  }
  if (!["low", "medium", "high", "UNKNOWN"].includes(String(value.confidence))) errors.push(`${field}.confidence is invalid`);
  for (const key of ["priceConditions", "assumptions", "scenarios", "risks", "invalidationConditions"] as const) strings(value[key], `${field}.${key}`, errors);
  if (!Number.isSafeInteger(value.reportVersion) || Number(value.reportVersion) <= 0) errors.push(`${field}.reportVersion must be positive`);
  if (typeof value.reportFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.reportFingerprint)) errors.push(`${field}.reportFingerprint must be sha256`);
  if (value.nonExecuting !== true) errors.push(`${field}.nonExecuting must be true`);
}

function direction(value: unknown, field: string, errors: string[]): void {
  if (!FORMAL_DECISION_DIRECTIONS.includes(value as FormalDecisionDirection)) errors.push(`${field} is invalid`);
}
function text(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || !value.trim() || value.length > 4000) errors.push(`${field} must be a non-empty string up to 4000 characters`);
}
function strings(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length > 50 || value.some((item) => typeof item !== "string" || !item.trim() || item.length > 4000)) errors.push(`${field} is invalid`);
}
function exact(value: Record<string, unknown>, keys: string[], field: string, errors: string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) errors.push(`${field} has unexpected or missing keys`);
}
function exactWithOptional(value: Record<string, unknown>, required: string[], optional: string[], field: string, errors: string[]): void {
  const actual = Object.keys(value).sort();
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) || actual.some((key) => !allowed.has(key))) {
    errors.push(`${field} has unexpected or missing keys`);
  }
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
