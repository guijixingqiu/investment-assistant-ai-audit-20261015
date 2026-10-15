import type { DecisionQuantEvidence } from "./decisionQuantEvidenceContract.js";
import { validateDecisionQuantEvidenceInto } from "./decisionQuantEvidenceContract.js";
import type { EvidenceItemData } from "./research.js";
import type { FactMetadata } from "./factMetadata.js";
import { validateFactMetadataInto } from "./factMetadata.js";

export const ANNUAL_DECISION_BRIEF_SCHEMA_VERSION = "2026-07-17.ios-annual-rings-decision-brief.v1";
export const ANNUAL_DECISION_BRIEF_STATUSES = ["available", "not_found", "unavailable"] as const;
export const ANNUAL_DECISION_BRIEF_READINESS = ["ready_for_three_minute_review", "research_required", "blocked"] as const;

export type AnnualDecisionBriefStatus = (typeof ANNUAL_DECISION_BRIEF_STATUSES)[number];
export type AnnualDecisionBriefReadinessState = (typeof ANNUAL_DECISION_BRIEF_READINESS)[number];

export interface AnnualDecisionBriefVariable {
  name: string;
  evidenceIds: string[];
  supportCount: number;
  counterCount: number;
  neutralCount: number;
  highestReliability: number | null;
  highestMateriality: number | null;
}

export interface AnnualDecisionBriefConflict {
  variableName: string;
  supportingEvidenceIds: string[];
  counterEvidenceIds: string[];
}

export interface AnnualDecisionBriefData {
  target: {
    membershipId: string;
    membershipVersion: number;
    membershipState: "tracked" | "paused" | "archived";
    market: "HK";
    code: string;
    symbol: string;
  };
  sourceIdentity: {
    generatedAt: string;
    researchAsOf: string | null;
    evidenceAsOf: string | null;
    quoteSnapshotId: string | null;
    decisionContextId: string;
    decisionContextHash: string;
  };
  whyNow: string | null;
  thesis: string | null;
  marketDisagreement: string | null;
  invalidationCondition: string | null;
  nextReviewOn: string | null;
  keyVariables: AnnualDecisionBriefVariable[];
  catalysts: string[];
  evidence: {
    support: EvidenceItemData[];
    counter: EvidenceItemData[];
    neutral: EvidenceItemData[];
    conflicts: AnnualDecisionBriefConflict[];
    gaps: string[];
  };
  quantEvidence: DecisionQuantEvidence;
  readiness: {
    state: AnnualDecisionBriefReadinessState;
    reasons: string[];
    hasCounterOrGap: boolean;
    threeMinuteReviewReady: boolean;
  };
}

export interface AnnualDecisionBriefEnvelope {
  schemaVersion: typeof ANNUAL_DECISION_BRIEF_SCHEMA_VERSION;
  generatedAt: string;
  status: AnnualDecisionBriefStatus;
  membershipId: string;
  requestedActorId: string;
  requestedSymbol: string | null;
  metadata: FactMetadata;
  data: AnnualDecisionBriefData | null;
  safety: {
    advisoryOnly: true;
    changesCandidateOrdering: false;
    recommendation: false;
    ranking: false;
    targetPrice: false;
    targetPosition: false;
    tradeDirection: false;
    createsOrder: false;
    createsTrade: false;
    callsBroker: false;
    mutatesOfficialPortfolio: false;
  };
  message: string;
}

export function validateAnnualDecisionBriefEnvelope(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["decision brief envelope must be an object"] };
  exactKeys(value, ["schemaVersion", "generatedAt", "status", "membershipId", "requestedActorId", "requestedSymbol", "metadata", "data", "safety", "message"], "decision brief envelope", errors);
  if (value.schemaVersion !== ANNUAL_DECISION_BRIEF_SCHEMA_VERSION) errors.push(`schemaVersion must be ${ANNUAL_DECISION_BRIEF_SCHEMA_VERSION}`);
  requireIso(value.generatedAt, "generatedAt", errors);
  if (!ANNUAL_DECISION_BRIEF_STATUSES.includes(value.status as AnnualDecisionBriefStatus)) errors.push("status must be available, not_found, or unavailable");
  requireNonEmpty(value.membershipId, "membershipId", errors);
  requireNonEmpty(value.requestedActorId, "requestedActorId", errors);
  if (!(typeof value.requestedSymbol === "string" || value.requestedSymbol === null)) errors.push("requestedSymbol must be a string or null");
  validateFactMetadataInto(value.metadata, "metadata", errors);
  validateSafety(value.safety, errors);
  requireNonEmpty(value.message, "message", errors);
  rejectForbiddenKeys(value, "decision brief", errors);

  if (value.status === "available") {
    if (!isRecord(value.data)) errors.push("available decision brief requires data");
    else validateAvailableData(value, value.data, errors);
  } else {
    if (value.data !== null) errors.push("non-available decision brief must not expose data");
    if (value.requestedSymbol !== null) errors.push("non-available decision brief must not expose requestedSymbol");
    if (isRecord(value.metadata) && value.metadata.freshness === "fresh") errors.push("non-available decision brief metadata must not be fresh");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateAvailableData(envelope: Record<string, unknown>, data: Record<string, unknown>, errors: string[]): void {
  exactKeys(data, [
    "target", "sourceIdentity", "whyNow", "thesis", "marketDisagreement", "invalidationCondition",
    "nextReviewOn", "keyVariables", "catalysts", "evidence", "quantEvidence", "readiness"
  ], "decision brief data", errors);
  validateTarget(envelope, data.target, errors);
  validateSourceIdentity(envelope, data.target, data.sourceIdentity, errors);
  for (const field of ["whyNow", "thesis", "marketDisagreement", "invalidationCondition", "nextReviewOn"]) {
    optionalNonEmpty(data[field], field, errors);
  }
  boundedStrings(data.catalysts, "catalysts", 20, errors, true);
  validateEvidence(data.evidence, errors);
  validateVariables(data.keyVariables, data.evidence, errors);
  const target = isRecord(data.target) ? data.target : null;
  validateDecisionQuantEvidenceInto(data.quantEvidence, target?.symbol, errors, envelope.generatedAt);
  validateAggregateFreshness(data.quantEvidence, envelope.metadata, errors);
  validateAggregateFixtureProvenance(data.quantEvidence, envelope.metadata, errors);
  validateReadiness(data.readiness, data, envelope.metadata, errors);
  if (isRecord(envelope.metadata) && !["fresh", "historical", "stale", "missing", "unavailable", "conflict"].includes(String(envelope.metadata.freshness))) {
    errors.push("available decision brief metadata freshness is invalid");
  }
  if (isRecord(envelope.metadata) && envelope.metadata.source !== "annual_decision_brief:candidate_intake_research_quant") {
    errors.push("available decision brief metadata source is invalid");
  }
  if (isRecord(envelope.metadata) && envelope.metadata.authority !== "research_evidence") {
    errors.push("available decision brief authority must remain research_evidence");
  }
}

function validateTarget(envelope: Record<string, unknown>, value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("target must be an object");
    return;
  }
  exactKeys(value, ["membershipId", "membershipVersion", "membershipState", "market", "code", "symbol"], "target", errors);
  if (value.membershipId !== envelope.membershipId) errors.push("target.membershipId must match envelope membershipId");
  if (!Number.isInteger(value.membershipVersion) || Number(value.membershipVersion) < 1) errors.push("target.membershipVersion must be a positive integer");
  if (!["tracked", "paused", "archived"].includes(String(value.membershipState))) errors.push("target.membershipState is invalid");
  if (value.market !== "HK" || typeof value.code !== "string" || !/^\d{5}$/.test(value.code) || value.symbol !== `HK.${value.code}`) errors.push("target must use one canonical Hong Kong identity");
  if (value.symbol !== envelope.requestedSymbol) errors.push("target.symbol must match requestedSymbol");
}

function validateSourceIdentity(
  envelope: Record<string, unknown>,
  target: unknown,
  value: unknown,
  errors: string[]
): void {
  if (!isRecord(value)) {
    errors.push("sourceIdentity must be an object");
    return;
  }
  exactKeys(value, ["generatedAt", "researchAsOf", "evidenceAsOf", "quoteSnapshotId", "decisionContextId", "decisionContextHash"], "sourceIdentity", errors);
  requireIso(value.generatedAt, "sourceIdentity.generatedAt", errors);
  if (value.generatedAt !== envelope.generatedAt) errors.push("sourceIdentity.generatedAt must match envelope generatedAt");
  optionalIso(value.researchAsOf, "sourceIdentity.researchAsOf", errors);
  optionalIso(value.evidenceAsOf, "sourceIdentity.evidenceAsOf", errors);
  optionalNonEmpty(value.quoteSnapshotId, "sourceIdentity.quoteSnapshotId", errors);
  if (typeof value.quoteSnapshotId === "string" && isRecord(target) && typeof target.symbol === "string"
    && !value.quoteSnapshotId.startsWith(`${target.symbol}:`)) {
    errors.push("sourceIdentity.quoteSnapshotId must bind the target symbol");
  }
  requireNonEmpty(value.decisionContextId, "sourceIdentity.decisionContextId", errors);
  const decisionContextHash = typeof value.decisionContextHash === "string" ? value.decisionContextHash : null;
  if (!decisionContextHash || !/^[a-f0-9]{64}$/.test(decisionContextHash)) {
    errors.push("sourceIdentity.decisionContextHash must be a SHA-256 identity");
  } else if (isRecord(target) && typeof target.symbol === "string"
    && value.decisionContextId !== `decision-context:${target.symbol}:${decisionContextHash.slice(0, 16)}`) {
    errors.push("sourceIdentity.decisionContextId must bind the target symbol and decisionContextHash");
  }
}

function validateVariables(value: unknown, evidence: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.length > 20) {
    errors.push("keyVariables must be an array of at most 20 entries");
    return;
  }
  const names = new Set<string>();
  const evidenceItems = evidenceItemsFromGroups(evidence);
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`keyVariables[${index}] must be an object`);
      return;
    }
    exactKeys(item, ["name", "evidenceIds", "supportCount", "counterCount", "neutralCount", "highestReliability", "highestMateriality"], `keyVariables[${index}]`, errors);
    requireNonEmpty(item.name, `keyVariables[${index}].name`, errors);
    if (typeof item.name === "string") {
      const normalizedName = item.name.trim();
      if (item.name !== normalizedName) errors.push(`keyVariables[${index}].name must be trimmed`);
      if (names.has(normalizedName)) errors.push("keyVariables names must be unique");
      names.add(normalizedName);
      const linked = evidenceItems.filter((evidenceItem) => evidenceItem.variableName === normalizedName);
      const linkedIds = linked.map((evidenceItem) => String(evidenceItem.id));
      if (Array.isArray(item.evidenceIds) && !sameStrings(item.evidenceIds, linkedIds)) {
        errors.push(`keyVariables[${index}].evidenceIds must match displayed evidence for the variable`);
      }
      const expectedCounts = {
        supportCount: linked.filter((evidenceItem) => evidenceItem.stance === "support").length,
        counterCount: linked.filter((evidenceItem) => evidenceItem.stance === "refute").length,
        neutralCount: linked.filter((evidenceItem) => evidenceItem.stance === "neutral").length
      };
      for (const [field, expected] of Object.entries(expectedCounts)) {
        if (item[field] !== expected) errors.push(`keyVariables[${index}].${field} must match displayed evidence`);
      }
      const expectedReliability = highestScore(linked, "reliability");
      const expectedMateriality = highestScore(linked, "materiality");
      if (item.highestReliability !== expectedReliability) errors.push(`keyVariables[${index}].highestReliability must match displayed evidence`);
      if (item.highestMateriality !== expectedMateriality) errors.push(`keyVariables[${index}].highestMateriality must match displayed evidence`);
    }
    boundedStrings(item.evidenceIds, `keyVariables[${index}].evidenceIds`, 100, errors, true);
    for (const field of ["supportCount", "counterCount", "neutralCount"]) {
      if (!Number.isInteger(item[field]) || Number(item[field]) < 0) errors.push(`keyVariables[${index}].${field} must be a non-negative integer`);
    }
    optionalScore(item.highestReliability, `keyVariables[${index}].highestReliability`, errors);
    optionalScore(item.highestMateriality, `keyVariables[${index}].highestMateriality`, errors);
  });
}

function validateEvidence(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("evidence must be an object");
    return;
  }
  exactKeys(value, ["support", "counter", "neutral", "conflicts", "gaps"], "evidence", errors);
  const ids = new Set<string>();
  const items: Record<string, unknown>[] = [];
  for (const [field, stance] of [["support", "support"], ["counter", "refute"], ["neutral", "neutral"]] as const) {
    if (!Array.isArray(value[field]) || value[field].length > 100) {
      errors.push(`evidence.${field} must be an array`);
      continue;
    }
    for (const item of value[field]) {
      if (!isRecord(item) || item.stance !== stance || typeof item.id !== "string" || item.id.length === 0) {
        errors.push(`evidence.${field} contains an invalid ${stance} item`);
        continue;
      }
      if (ids.has(item.id)) errors.push("evidence ids must be unique across stance groups");
      ids.add(item.id);
      validateEvidenceQuality(item, `evidence.${field}`, errors);
      items.push(item);
    }
  }
  boundedStrings(value.gaps, "evidence.gaps", 50, errors, true);
  if (!Array.isArray(value.conflicts)) {
    errors.push("evidence.conflicts must be an array");
  } else {
    const expectedConflicts = expectedEvidenceConflicts(items);
    const conflictNames = value.conflicts
      .filter(isRecord)
      .map((conflict) => conflict.variableName)
      .filter((name): name is string => typeof name === "string");
    if (new Set(conflictNames).size !== conflictNames.length) errors.push("evidence conflict variable names must be unique");
    if (value.conflicts.length !== expectedConflicts.size) errors.push("evidence conflicts must cover every displayed support/counter variable conflict");
    value.conflicts.forEach((conflict, index) => validateConflict(conflict, index, ids, expectedConflicts, errors));
  }
}

function validateEvidenceQuality(item: Record<string, unknown>, label: string, errors: string[]): void {
  exactKeys(item, [
    "id", "sourceType", "sourceUrl", "publishedAt", "capturedAt", "summary", "factKind",
    "variableName", "stance", "reliability", "materiality", "isRead"
  ], label, errors);
  requireNonEmpty(item.sourceType, `${label}.sourceType`, errors);
  requireNonEmpty(item.summary, `${label}.summary`, errors);
  requireIso(item.capturedAt, `${label}.capturedAt`, errors);
  optionalNonEmpty(item.sourceUrl, `${label}.sourceUrl`, errors);
  optionalIso(item.publishedAt, `${label}.publishedAt`, errors);
  optionalNonEmpty(item.variableName, `${label}.variableName`, errors);
  if (item.factKind !== "fact" && item.factKind !== "inference") errors.push(`${label}.factKind is invalid`);
  optionalScore(item.reliability, `${label}.reliability`, errors);
  optionalScore(item.materiality, `${label}.materiality`, errors);
  if (typeof item.isRead !== "boolean") errors.push(`${label}.isRead must be a boolean`);
}

function expectedEvidenceConflicts(items: Record<string, unknown>[]): Map<string, { support: string[]; counter: string[] }> {
  const names = [...new Set(items.map((item) => item.variableName).filter((name): name is string => typeof name === "string" && name.length > 0))];
  return new Map(names.flatMap((name) => {
    const support = items.filter((item) => item.variableName === name && item.stance === "support").map((item) => String(item.id));
    const counter = items.filter((item) => item.variableName === name && item.stance === "refute").map((item) => String(item.id));
    return support.length > 0 && counter.length > 0 ? [[name, { support, counter }]] : [];
  }));
}

function validateConflict(
  value: unknown,
  index: number,
  ids: Set<string>,
  expectedConflicts: Map<string, { support: string[]; counter: string[] }>,
  errors: string[]
): void {
  if (!isRecord(value)) {
    errors.push(`evidence.conflicts[${index}] must be an object`);
    return;
  }
  exactKeys(value, ["variableName", "supportingEvidenceIds", "counterEvidenceIds"], `evidence.conflicts[${index}]`, errors);
  requireNonEmpty(value.variableName, `evidence.conflicts[${index}].variableName`, errors);
  for (const field of ["supportingEvidenceIds", "counterEvidenceIds"]) {
    boundedStrings(value[field], `evidence.conflicts[${index}].${field}`, 100, errors);
    if (Array.isArray(value[field]) && value[field].some((id) => !ids.has(String(id)))) errors.push(`evidence.conflicts[${index}].${field} must reference displayed evidence`);
  }
  if (typeof value.variableName === "string") {
    const expected = expectedConflicts.get(value.variableName);
    if (!expected) {
      errors.push(`evidence.conflicts[${index}] does not represent a displayed support/counter conflict`);
    } else {
      if (!Array.isArray(value.supportingEvidenceIds) || !sameStrings(value.supportingEvidenceIds, expected.support)) {
        errors.push(`evidence.conflicts[${index}].supportingEvidenceIds must match the conflict variable support evidence`);
      }
      if (!Array.isArray(value.counterEvidenceIds) || !sameStrings(value.counterEvidenceIds, expected.counter)) {
        errors.push(`evidence.conflicts[${index}].counterEvidenceIds must match the conflict variable counter evidence`);
      }
    }
  }
}

function validateReadiness(
  value: unknown,
  data: Record<string, unknown>,
  metadata: unknown,
  errors: string[]
): void {
  if (!isRecord(value)) {
    errors.push("readiness must be an object");
    return;
  }
  exactKeys(value, ["state", "reasons", "hasCounterOrGap", "threeMinuteReviewReady"], "readiness", errors);
  if (!ANNUAL_DECISION_BRIEF_READINESS.includes(value.state as AnnualDecisionBriefReadinessState)) errors.push("readiness.state is invalid");
  boundedStrings(value.reasons, "readiness.reasons", 30, errors, true);
  if (typeof value.hasCounterOrGap !== "boolean" || typeof value.threeMinuteReviewReady !== "boolean") errors.push("readiness booleans are required");
  const evidence = data.evidence;
  const hasCounterOrGap = isRecord(evidence)
    && ((Array.isArray(evidence.counter) && evidence.counter.length > 0) || (Array.isArray(evidence.gaps) && evidence.gaps.length > 0));
  if (value.hasCounterOrGap !== hasCounterOrGap) errors.push("readiness.hasCounterOrGap must match evidence counter or gap state");
  if (value.state === "ready_for_three_minute_review" && (value.threeMinuteReviewReady !== true || !hasCounterOrGap || (Array.isArray(value.reasons) && value.reasons.length > 0))) {
    errors.push("ready decision brief requires no reasons and counter evidence or an explicit gap");
  }
  if (value.state === "ready_for_three_minute_review") {
    if (!hasReadyDecisionBriefFacts(data, metadata)) {
      errors.push("ready decision brief requires current tracked research facts, bounded quant evidence, variables, catalysts, and support evidence");
    }
  }
  if (value.state !== "ready_for_three_minute_review" && (!Array.isArray(value.reasons) || value.reasons.length === 0)) {
    errors.push("non-ready decision brief requires at least one reason");
  }
  if (value.state !== "ready_for_three_minute_review" && value.threeMinuteReviewReady !== false) errors.push("non-ready decision brief cannot be marked three-minute ready");
  if (requiresBlockedReadiness(data, metadata) && value.state !== "blocked") {
    errors.push("fail-closed decision brief facts require blocked readiness");
  }
}

function requiresBlockedReadiness(data: Record<string, unknown>, metadata: unknown): boolean {
  const target = isRecord(data.target) ? data.target : null;
  const sourceIdentity = isRecord(data.sourceIdentity) ? data.sourceIdentity : null;
  const quantEvidence = isRecord(data.quantEvidence) ? data.quantEvidence : null;
  const quantMetadata = quantEvidence && isRecord(quantEvidence.metadata) ? quantEvidence.metadata : null;
  const aggregateFreshness = isRecord(metadata) ? metadata.freshness : null;
  return target?.membershipState === "archived"
    || typeof sourceIdentity?.researchAsOf !== "string"
    || typeof sourceIdentity?.evidenceAsOf !== "string"
    || typeof sourceIdentity?.quoteSnapshotId !== "string"
    || sourceIdentity.quoteSnapshotId.trim().length === 0
    || (isRecord(metadata) && (metadata.stale === true || metadata.missing === true || metadata.conflict === true))
    || !["fresh", "historical"].includes(String(aggregateFreshness))
    || quantEvidence?.status !== "available"
    || !quantMetadata
    || typeof quantMetadata.asOf !== "string"
    || typeof quantMetadata.fetchedAt !== "string"
    || !["fresh", "historical"].includes(String(quantMetadata.freshness));
}

function hasReadyDecisionBriefFacts(data: Record<string, unknown>, metadata: unknown): boolean {
  const target = isRecord(data.target) ? data.target : null;
  const sourceIdentity = isRecord(data.sourceIdentity) ? data.sourceIdentity : null;
  const evidence = isRecord(data.evidence) ? data.evidence : null;
  const quantEvidence = isRecord(data.quantEvidence) ? data.quantEvidence : null;
  const quantMetadata = quantEvidence && isRecord(quantEvidence.metadata) ? quantEvidence.metadata : null;
  const requiredText = [data.whyNow, data.thesis, data.marketDisagreement, data.invalidationCondition];
  return target?.membershipState === "tracked"
    && typeof sourceIdentity?.researchAsOf === "string"
    && typeof sourceIdentity?.evidenceAsOf === "string"
    && typeof sourceIdentity?.quoteSnapshotId === "string" && sourceIdentity.quoteSnapshotId.trim().length > 0
    && requiredText.every((field) => typeof field === "string" && field.trim().length > 0)
    && Array.isArray(data.keyVariables) && data.keyVariables.length > 0
    && Array.isArray(data.catalysts) && data.catalysts.length > 0
    && evidence !== null && Array.isArray(evidence.support) && evidence.support.length > 0
    && quantEvidence?.status === "available"
    && quantMetadata !== null
    && typeof quantMetadata.asOf === "string"
    && typeof quantMetadata.fetchedAt === "string"
    && ["fresh", "historical"].includes(String(quantMetadata.freshness))
    && isRecord(metadata)
    && metadata.stale === false && metadata.missing === false && metadata.conflict === false
    && ["fresh", "historical"].includes(String(metadata.freshness));
}

function validateAggregateFreshness(quantEvidence: unknown, metadata: unknown, errors: string[]): void {
  if (!isRecord(quantEvidence) || !isRecord(quantEvidence.metadata) || !isRecord(metadata)) return;
  const aggregateRank = freshnessRank(metadata.freshness);
  const quantRank = freshnessRank(quantEvidence.metadata.freshness);
  if (aggregateRank !== null && quantRank !== null && aggregateRank < quantRank) {
    errors.push("decision brief aggregate freshness must not be fresher than quantEvidence.metadata.freshness");
  }
}

function validateAggregateFixtureProvenance(quantEvidence: unknown, metadata: unknown, errors: string[]): void {
  if (!isRecord(quantEvidence) || !isRecord(quantEvidence.metadata) || !isRecord(metadata)) return;
  if (quantEvidence.metadata.fixture === true && (metadata.fixture !== true || metadata.provenance !== "fixture")) {
    errors.push("decision brief aggregate metadata must preserve quant fixture provenance");
  }
}

function freshnessRank(value: unknown): number | null {
  switch (value) {
    case "fresh": return 0;
    case "historical": return 1;
    case "stale": return 2;
    case "missing": return 3;
    case "unavailable":
    case "unknown": return 4;
    case "conflict": return 5;
    default: return null;
  }
}

function evidenceItemsFromGroups(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value)) return [];
  return ["support", "counter", "neutral"].flatMap((field) => Array.isArray(value[field])
    ? value[field].filter(isRecord)
    : []);
}

function highestScore(items: Record<string, unknown>[], field: "reliability" | "materiality"): number | null {
  const scores = items.map((item) => item[field]).filter((score): score is number => typeof score === "number");
  return scores.length > 0 ? Math.max(...scores) : null;
}

function sameStrings(left: unknown[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("safety must be an object");
    return;
  }
  exactKeys(value, ["advisoryOnly", "changesCandidateOrdering", "recommendation", "ranking", "targetPrice", "targetPosition", "tradeDirection", "createsOrder", "createsTrade", "callsBroker", "mutatesOfficialPortfolio"], "safety", errors);
  if (value.advisoryOnly !== true) errors.push("safety.advisoryOnly must be true");
  for (const key of ["changesCandidateOrdering", "recommendation", "ranking", "targetPrice", "targetPosition", "tradeDirection", "createsOrder", "createsTrade", "callsBroker", "mutatesOfficialPortfolio"]) {
    if (value[key] !== false) errors.push(`safety.${key} must be false`);
  }
}

function rejectForbiddenKeys(value: unknown, field: string, errors: string[], depth = 0): void {
  if (depth > 20 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => rejectForbiddenKeys(item, field, errors, depth + 1));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (["recommendedAction", "rankingScore", "suggestedPosition", "orderRequest", "brokerAccount"].includes(key)) {
      errors.push(`${field} contains forbidden field ${key}`);
    }
    rejectForbiddenKeys(child, field, errors, depth + 1);
  }
}

function exactKeys(value: Record<string, unknown>, allowed: string[], label: string, errors: string[]): void {
  const actual = Object.keys(value);
  for (const key of actual) if (!allowed.includes(key)) errors.push(`${label} contains unsupported field ${key}`);
  for (const key of allowed) if (!(key in value)) errors.push(`${label} is missing field ${key}`);
}

function boundedStrings(value: unknown, label: string, max: number, errors: string[], allowEmpty = false): void {
  if (!Array.isArray(value) || value.length > max || (!allowEmpty && value.length === 0)
    || !value.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 1_000)
    || new Set(value).size !== value.length) errors.push(`${label} must contain bounded unique non-empty strings`);
}

function optionalScore(value: unknown, field: string, errors: string[]): void {
  if (value !== null && value !== undefined && (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 5)) errors.push(`${field} must be null or an integer from 1 to 5`);
}

function optionalNonEmpty(value: unknown, field: string, errors: string[]): void {
  if (value !== null && (typeof value !== "string" || value.trim().length === 0)) errors.push(`${field} must be null or a non-empty string`);
}

function requireNonEmpty(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${field} must be a non-empty string`);
}

function requireIso(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) errors.push(`${field} must be a valid date-time`);
}

function optionalIso(value: unknown, field: string, errors: string[]): void {
  if (value !== null) requireIso(value, field, errors);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
