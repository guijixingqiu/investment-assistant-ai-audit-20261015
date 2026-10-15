import type { FactMetadata } from "./factMetadata.js";
import { validateFactMetadataInto } from "./factMetadata.js";
import { researchMonitorRuleErrors, type ResearchMonitorRule } from "./researchMonitorRule.js";
export const RESEARCH_PROFILE_SCHEMA_VERSION = "2026-06-17.gate-b.v1";
export const RESEARCH_WRITE_SCHEMA_VERSION = "2026-06-18.research-write.v1";
export const EVIDENCE_STANCES = ["support", "refute", "neutral"] as const;
export const FACT_KINDS = ["fact", "inference"] as const;
export const SUGGESTION_STATUSES = ["pending", "accepted", "rejected"] as const;
import { FORMAL_DECISION_DIRECTIONS } from "./formalDecision.js";
export const DECISION_ACTION_INTENTS = FORMAL_DECISION_DIRECTIONS;
export const DECISION_VERDICTS = ["pass", "block", "needs_review"] as const;
export type EvidenceStance = (typeof EVIDENCE_STANCES)[number];
export type FactKind = (typeof FACT_KINDS)[number];
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];
export type DecisionActionIntent = (typeof FORMAL_DECISION_DIRECTIONS)[number];
export type DecisionVerdict = (typeof DECISION_VERDICTS)[number];
export interface ResearchProfileData {
  market: string;
  code: string;
  symbol: string;
  name: string | null;
  currentView: string;
  currentThesis: string;
  marketDisagreement: string | null;
  invalidationCondition: string | null;
  nextReviewOn: string | null;
  keyVariables?: string[];
  catalysts?: string[];
  evidenceGaps?: string[];
  monitorRules?: ResearchMonitorRule[];
}
export interface EvidenceItemData {
  id: string;
  sourceType: string;
  sourceUrl: string | null;
  publishedAt: string | null;
  capturedAt: string;
  summary: string;
  factKind: FactKind;
  variableName: string | null;
  stance: EvidenceStance;
  reliability: number | null;
  materiality?: number | null;
  isRead: boolean;
}
export interface AiUpdateSuggestionData {
  id: string;
  status: SuggestionStatus;
  summary: string;
  supports: string[];
  weakens: string[];
  counterEvidence: string[];
  changedVariables: string[];
  missingEvidence: string[];
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface ResearchProfileEnvelope {
  schemaVersion: typeof RESEARCH_PROFILE_SCHEMA_VERSION;
  asOf: string;
  requestedSymbol: string;
  metadata: FactMetadata;
  data: {
    profile: ResearchProfileData;
    evidence: EvidenceItemData[];
    suggestions: AiUpdateSuggestionData[];
  } | null;
  message: string;
}

export interface ResearchWriteEnvelope<TData> {
  schemaVersion: typeof RESEARCH_WRITE_SCHEMA_VERSION;
  status: "succeeded";
  asOf: string;
  source: {
    actorType: "user" | "system" | "migration" | "test";
    actorId: string | null;
    correlationId: string | null;
  };
  data: TData;
  message: string;
}

export interface UpdateResearchProfileRequest {
  market: string;
  code: string;
  membershipId: string;
  membershipVersion: number;
  name?: string | null;
  currentView: string;
  currentThesis: string;
  marketDisagreement?: string | null;
  invalidationCondition?: string | null;
  nextReviewOn?: string | null;
  keyVariables?: string[];
  catalysts?: string[];
  evidenceGaps?: string[];
  monitorRules?: ResearchMonitorRule[];
  idempotencyKey: string;
  actorType?: "user" | "system" | "migration" | "test";
  actorId?: string | null;
  correlationId?: string | null;
}

export interface CreateEvidenceRequest {
  membershipId: string;
  membershipVersion: number;
  sourceType: string;
  sourceUrl?: string | null;
  publishedAt?: string | null;
  summary: string;
  factKind: FactKind;
  variableName?: string | null;
  stance: EvidenceStance;
  reliability?: number | null;
  materiality?: number | null;
  isRead?: boolean;
  idempotencyKey: string;
  actorType?: "user" | "system" | "migration" | "test";
  actorId?: string | null;
  correlationId?: string | null;
}

export interface DecideAiSuggestionRequest {
  action: "accepted" | "rejected";
  note?: string | null;
  idempotencyKey?: string;
}

export interface CreateDecisionCheckRequest {
  actionIntent: DecisionActionIntent;
  verdict: DecisionVerdict;
  requestedPrice?: number | null;
  requestedQuantity?: number | null;
  currentPrice?: number | null;
  currentQuantity?: number | null;
  averageCost?: number | null;
  marketValue?: number | null;
  currentWeight?: number | null;
  userFinalDecision?: string | null;
  checkedAt?: string | null;
  idempotencyKey: string;
  actorType?: "user" | "system" | "migration" | "test";
  actorId?: string | null;
  correlationId?: string | null;
}

export interface DecisionCheckData {
  id: string;
  market: string;
  code: string;
  symbol: string;
  actionIntent: DecisionActionIntent;
  verdict: DecisionVerdict;
  requestedPrice: number | null;
  requestedQuantity: number | null;
  currentPrice: number | null;
  currentQuantity: number | null;
  averageCost: number | null;
  marketValue: number | null;
  currentWeight: number | null;
  userFinalDecision: string | null;
  checkedAt: string;
}

export function validateUpdateResearchProfileRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["request must be an object"] };
  rejectUnknownKeys(value, "request", [
    "market",
    "code",
    "membershipId",
    "membershipVersion",
    "name",
    "currentView",
    "currentThesis",
    "marketDisagreement",
    "invalidationCondition",
    "nextReviewOn",
    "keyVariables",
    "catalysts",
    "evidenceGaps",
    "monitorRules",
    "idempotencyKey"
  ], errors);
  requireNonEmptyString(value.market, "market", errors);
  requireNonEmptyString(value.code, "code", errors);
  validateCandidateWriteBinding(value, errors);
  requireNonEmptyString(value.currentView, "currentView", errors);
  requireNonEmptyString(value.currentThesis, "currentThesis", errors);
  validateOptionalString(value.name, "name", errors);
  validateOptionalString(value.marketDisagreement, "marketDisagreement", errors);
  validateOptionalString(value.invalidationCondition, "invalidationCondition", errors);
  validateOptionalString(value.nextReviewOn, "nextReviewOn", errors);
  validateOptionalBoundedStringArray(value.keyVariables, "keyVariables", errors);
  validateOptionalBoundedStringArray(value.catalysts, "catalysts", errors);
  validateOptionalBoundedStringArray(value.evidenceGaps, "evidenceGaps", errors);
  errors.push(...researchMonitorRuleErrors(value.monitorRules, value.keyVariables));
  validateWriteMeta(value, errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateCreateEvidenceRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["request must be an object"] };
  rejectUnknownKeys(value, "request", [
    "membershipId",
    "membershipVersion",
    "sourceType",
    "sourceUrl",
    "publishedAt",
    "summary",
    "factKind",
    "variableName",
    "stance",
    "reliability",
    "materiality",
    "isRead",
    "idempotencyKey"
  ], errors);
  requireNonEmptyString(value.sourceType, "sourceType", errors);
  requireNonEmptyString(value.summary, "summary", errors);
  validateCandidateWriteBinding(value, errors);
  if (!FACT_KINDS.includes(value.factKind as FactKind)) errors.push("factKind must be fact or inference");
  if (!EVIDENCE_STANCES.includes(value.stance as EvidenceStance)) errors.push("stance must be support, refute, or neutral");
  validateOptionalString(value.sourceUrl, "sourceUrl", errors);
  validateOptionalString(value.publishedAt, "publishedAt", errors);
  validateOptionalString(value.variableName, "variableName", errors);
  if (value.reliability !== undefined && value.reliability !== null && (!Number.isInteger(value.reliability) || Number(value.reliability) < 1 || Number(value.reliability) > 5)) {
    errors.push("reliability must be null or an integer between 1 and 5");
  }
  if (value.materiality !== undefined && value.materiality !== null && (!Number.isInteger(value.materiality) || Number(value.materiality) < 1 || Number(value.materiality) > 5)) {
    errors.push("materiality must be null or an integer between 1 and 5");
  }
  if (value.isRead !== undefined && typeof value.isRead !== "boolean") errors.push("isRead must be a boolean");
  validateWriteMeta(value, errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateDecideAiSuggestionRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["request must be an object"] };
  rejectUnknownKeys(value, "request", ["action", "note", "idempotencyKey"], errors);
  if (value.action !== "accepted" && value.action !== "rejected") {
    errors.push("action must be accepted or rejected");
  }
  validateOptionalString(value.note, "note", errors);
  if (value.idempotencyKey !== undefined) {
    requireNonEmptyString(value.idempotencyKey, "idempotencyKey", errors);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateCreateDecisionCheckRequest(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["request must be an object"] };
  if (!DECISION_ACTION_INTENTS.includes(value.actionIntent as DecisionActionIntent)) errors.push(`actionIntent must be one of ${DECISION_ACTION_INTENTS.join(", ")}`);
  if (!DECISION_VERDICTS.includes(value.verdict as DecisionVerdict)) errors.push("verdict must be pass, block, or needs_review");
  for (const key of ["requestedPrice", "requestedQuantity", "currentPrice", "currentQuantity", "averageCost", "marketValue", "currentWeight"]) {
    validateOptionalNumber(value[key], key, errors);
  }
  validateOptionalString(value.userFinalDecision, "userFinalDecision", errors);
  validateOptionalString(value.checkedAt, "checkedAt", errors);
  validateWriteMeta(value, errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateResearchProfileWriteEnvelope(
  value: unknown,
  requestedSymbol?: string
): { ok: true } | { ok: false; errors: string[] } {
  const errors = validateResearchWriteEnvelopeBase(value, "write envelope");
  if (isRecord(value) && isValidProfile(value.data)) {
    validateProfileCanonicalIdentity(value.data, "data", errors);
    if (requestedSymbol !== undefined && value.data.symbol !== requestedSymbol) {
      errors.push("data.profile identity must match requestedSymbol");
    }
  } else {
    errors.push("data must be a valid research profile");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateEvidenceWriteEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors = validateResearchWriteEnvelopeBase(value, "write envelope");
  if (!isRecord(value) || !isValidEvidence(value.data)) {
    errors.push("data must be a valid evidence item");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateResearchProfileEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["envelope must be an object"] };
  }

  if (value.schemaVersion !== RESEARCH_PROFILE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${RESEARCH_PROFILE_SCHEMA_VERSION}`);
  }
  if (typeof value.asOf !== "string") {
    errors.push("asOf must be an ISO string");
  }
  if (typeof value.requestedSymbol !== "string" || value.requestedSymbol.length === 0) {
    errors.push("requestedSymbol must be a non-empty string");
  }
  if (typeof value.message !== "string") {
    errors.push("message must be a string");
  }
  validateFactMetadataInto(value.metadata, "metadata", errors);

  if (value.data !== null) {
    if (!isRecord(value.data)) {
      errors.push("data must be null or an object");
    } else {
      if (!isValidProfile(value.data.profile)) {
        errors.push("data.profile must be a valid research profile");
      } else {
        validateProfileIdentity(value.requestedSymbol, value.data.profile, errors);
      }
      if (!Array.isArray(value.data.evidence) || !value.data.evidence.every(isValidEvidence)) {
        errors.push("data.evidence must be an array of valid evidence items");
      }
      if (!Array.isArray(value.data.suggestions) || !value.data.suggestions.every(isValidSuggestion)) {
        errors.push("data.suggestions must be an array of valid AI suggestions");
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateProfileIdentity(requestedSymbol: unknown, profile: ResearchProfileData, errors: string[]): void {
  const canonicalSymbol = `${profile.market}.${profile.code}`;
  if (profile.symbol !== canonicalSymbol || profile.symbol !== requestedSymbol) {
    errors.push("data.profile identity must match requestedSymbol");
  }
}

function validateProfileCanonicalIdentity(profile: ResearchProfileData, field: string, errors: string[]): void {
  if (profile.symbol !== `${profile.market}.${profile.code}`) {
    errors.push(`${field}.symbol must equal canonical market/code identity`);
  }
}

function isValidProfile(value: unknown): value is ResearchProfileData {
  return isRecord(value)
    && typeof value.market === "string"
    && typeof value.code === "string"
    && typeof value.symbol === "string"
    && (typeof value.name === "string" || value.name === null)
    && typeof value.currentView === "string"
    && typeof value.currentThesis === "string"
    && (typeof value.marketDisagreement === "string" || value.marketDisagreement === null)
    && (typeof value.invalidationCondition === "string" || value.invalidationCondition === null)
    && (typeof value.nextReviewOn === "string" || value.nextReviewOn === null)
    && isOptionalBoundedStringArray(value.keyVariables)
    && isOptionalBoundedStringArray(value.catalysts)
    && isOptionalBoundedStringArray(value.evidenceGaps)
    && researchMonitorRuleErrors(value.monitorRules, value.keyVariables).length === 0;
}

function isValidEvidence(value: unknown): value is EvidenceItemData {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.sourceType === "string"
    && (typeof value.sourceUrl === "string" || value.sourceUrl === null)
    && (typeof value.publishedAt === "string" || value.publishedAt === null)
    && typeof value.capturedAt === "string"
    && typeof value.summary === "string"
    && FACT_KINDS.includes(value.factKind as FactKind)
    && (typeof value.variableName === "string" || value.variableName === null)
    && EVIDENCE_STANCES.includes(value.stance as EvidenceStance)
    && (value.reliability === null || (Number.isInteger(value.reliability) && Number(value.reliability) >= 1 && Number(value.reliability) <= 5))
    && (value.materiality === undefined || value.materiality === null || (Number.isInteger(value.materiality) && Number(value.materiality) >= 1 && Number(value.materiality) <= 5))
    && typeof value.isRead === "boolean";
}

function isValidSuggestion(value: unknown): value is AiUpdateSuggestionData {
  return isRecord(value)
    && typeof value.id === "string"
    && SUGGESTION_STATUSES.includes(value.status as SuggestionStatus)
    && typeof value.summary === "string"
    && isStringArray(value.supports)
    && isStringArray(value.weakens)
    && isStringArray(value.counterEvidence)
    && isStringArray(value.changedVariables)
    && isStringArray(value.missingEvidence)
    && typeof value.createdAt === "string"
    && (typeof value.decidedAt === "string" || value.decidedAt === null)
    && (typeof value.decisionNote === "string" || value.decisionNote === null);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, key: string, errors: string[]) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${key} must be a non-empty string`);
  }
}

function validateOptionalString(value: unknown, key: string, errors: string[]) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    errors.push(`${key} must be null or a string`);
  }
}

function validateOptionalBoundedStringArray(value: unknown, key: string, errors: string[]) {
  if (value !== undefined && !isBoundedStringArray(value)) {
    errors.push(`${key} must be an array of at most 20 unique non-empty strings`);
  }
}

function isOptionalBoundedStringArray(value: unknown): boolean {
  return value === undefined || isBoundedStringArray(value);
}

function isBoundedStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= 20
    && value.every((item) => typeof item === "string" && item === item.trim() && item.length > 0 && item.length <= 500)
    && new Set(value).size === value.length;
}

function validateOptionalNumber(value: unknown, key: string, errors: string[]) {
  if (value !== undefined && value !== null && !isNumber(value)) {
    errors.push(`${key} must be null or a number`);
  }
}

function validateWriteMeta(value: Record<string, unknown>, errors: string[]) {
  requireNonEmptyString(value.idempotencyKey, "idempotencyKey", errors);
  if (value.actorType !== undefined && !["user", "system", "migration", "test"].includes(String(value.actorType))) {
    errors.push("actorType must be user, system, migration, or test");
  }
  validateOptionalString(value.actorId, "actorId", errors);
  validateOptionalString(value.correlationId, "correlationId", errors);
}

function validateCandidateWriteBinding(value: Record<string, unknown>, errors: string[]): void {
  if (typeof value.membershipId !== "string" || !/^[1-9]\d*$/.test(value.membershipId)) {
    errors.push("membershipId must be a canonical positive integer string");
  }
  if (!Number.isInteger(value.membershipVersion) || Number(value.membershipVersion) < 1) {
    errors.push("membershipVersion must be a positive integer");
  }
}

function rejectUnknownKeys(value: Record<string, unknown>, label: string, allowedKeys: string[], errors: string[]): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`);
  }
}

export function validateResearchWriteEnvelopeBase(value: unknown, field: string): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return [`${field} must be an object`];
  if (value.schemaVersion !== RESEARCH_WRITE_SCHEMA_VERSION) errors.push("schemaVersion must be research write schema");
  if (value.status !== "succeeded") errors.push("status must be succeeded");
  requireNonEmptyString(value.asOf, "asOf", errors);
  if (typeof value.asOf === "string" && !Number.isFinite(Date.parse(value.asOf))) {
    errors.push("asOf must be a valid date-time");
  }
  validateWriteSource(value.source, "source", errors);
  if (typeof value.message !== "string" || value.message.trim().length === 0) {
    errors.push("message must be a non-empty string");
  }
  return errors;
}

function validateWriteSource(value: unknown, field: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return;
  }
  if (!["user", "system", "migration", "test"].includes(String(value.actorType))) {
    errors.push(`${field}.actorType is invalid`);
  }
  validateOptionalString(value.actorId, `${field}.actorId`, errors);
  validateOptionalString(value.correlationId, `${field}.correlationId`, errors);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
