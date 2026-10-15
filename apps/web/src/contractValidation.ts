import { DECISION_CHECK_SCHEMA_VERSION, HUMAN_CHECK_RESULTS, validateDecisionContextEnvelope, type DecisionContextEnvelope, type PreTradeDecisionCheckData } from "../../../packages/contracts/src/decisionContextBrowser.js";
import { DECISION_REVIEW_OUTCOMES, validateDecisionReviewHistoryEnvelope, type CreatePostDecisionReviewRequest, type DecisionReviewHistoryEnvelope, type PostDecisionReviewData } from "../../../packages/contracts/src/decisionReview.js";
import { validateMarketQuoteEnvelope, type MarketQuoteEnvelope } from "../../../packages/contracts/src/market.js";
import type { PinganSnapshotEnvelope, PinganSnapshotStatus } from "../../../packages/contracts/src/portfolioSnapshot.js";
import { validateCandidateOverviewEnvelope, type CandidateOverviewEnvelope } from "../../../packages/contracts/src/candidateOverview.js";
import { validateCandidateMembershipEnvelope, validateCandidateMembershipWriteEnvelope as validateSharedCandidateMembershipWriteEnvelope, type CandidateMembershipData, type CandidateMembershipEnvelope } from "../../../packages/contracts/src/candidateMembership.js";
import { DECISION_ACTION_INTENTS, RESEARCH_WRITE_SCHEMA_VERSION, validateResearchProfileEnvelope, type ResearchProfileEnvelope, type ResearchWriteEnvelope } from "../../../packages/contracts/src/research.js";
import { validateDecisionSnapshotStateStructure, type DecisionSnapshotBinding } from "../../../packages/contracts/src/decisionSnapshotContract.js";
import { validatePostDecisionPortfolioReviewStateStructure } from "../../../packages/contracts/src/postDecisionPortfolioReviewContract.js";
import { validateResearchReportDecisionState } from "../../../packages/contracts/src/researchReportDecision.js";
import { formalDecisionNotCapturedState, validateFormalDecisionState } from "../../../packages/contracts/src/formalDecision.js";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; reason: string };
export function validateQuote(value: unknown): ValidationResult<MarketQuoteEnvelope> {
  return normalize<MarketQuoteEnvelope>(validateMarketQuoteEnvelope(value), value, "quote");
}
export function validateResearch(value: unknown): ValidationResult<ResearchProfileEnvelope> {
  return normalize<ResearchProfileEnvelope>(validateResearchProfileEnvelope(value), value, "research");
}
export function validateDecisionContext(value: unknown): ValidationResult<DecisionContextEnvelope> {
  return normalize<DecisionContextEnvelope>(validateDecisionContextEnvelope(value), value, "decision context");
}
export function validateReviewHistory(value: unknown): ValidationResult<DecisionReviewHistoryEnvelope> {
  return normalize<DecisionReviewHistoryEnvelope>(validateDecisionReviewHistoryEnvelope(value), value, "review history");
}
export function validateCandidateOverview(value: unknown): ValidationResult<CandidateOverviewEnvelope> {
  const result = normalize<CandidateOverviewEnvelope>(validateCandidateOverviewEnvelope(value), value, "candidate overview");
  if (!result.ok) return result;
  const forbidden = findCandidateForbiddenFields(result.value);
  if (forbidden.length > 0) {
    return { ok: false, reason: `candidate overview includes forbidden portfolio or trading fields: ${forbidden.join(", ")}` };
  }
  return result;
}

export function validateCandidateMemberships(value: unknown): ValidationResult<CandidateMembershipEnvelope> {
  const result = normalize<CandidateMembershipEnvelope>(validateCandidateMembershipEnvelope(value), value, "candidate memberships");
  if (!result.ok) return result;
  const forbidden = findCandidateMembershipForbiddenFields(result.value);
  if (forbidden.length > 0) {
    return { ok: false, reason: `candidate memberships include forbidden portfolio or trading fields: ${forbidden.join(", ")}` };
  }
  return result;
}

export function validateCandidateMembershipWrite(value: unknown): ValidationResult<CandidateMembershipData> {
  const result = normalize<{ data: CandidateMembershipData }>(validateSharedCandidateMembershipWriteEnvelope(value), value, "candidate membership write");
  if (!result.ok) return result;
  const forbidden = findMembershipForbiddenFields(result.value.data, "data");
  if (forbidden.length > 0) {
    return { ok: false, reason: `candidate membership write includes forbidden portfolio or trading fields: ${forbidden.join(", ")}` };
  }
  return { ok: true, value: result.value.data };
}

export function validateDecisionCheck(value: unknown, context: DecisionContextEnvelope, binding?: DecisionSnapshotBinding): ValidationResult<PreTradeDecisionCheckData> {
  if (!isRecord(value)) return { ok: false, reason: "decision check must be an object" };
  const errors: string[] = [];
  if (value.symbol !== context.requestedSymbol) errors.push("decision check symbol must match current context");
  if (typeof value.market !== "string" || typeof value.code !== "string" || value.symbol !== `${value.market}.${value.code}`) errors.push("decision check market/code must match canonical symbol");
  if (value.decisionContextSchemaVersion !== context.schemaVersion) errors.push("decision check schema must match current context");
  if (value.decisionCheckSchemaVersion !== DECISION_CHECK_SCHEMA_VERSION) errors.push("decision check schema version is invalid");
  if (value.contextId !== context.contextId) errors.push("decision check contextId must match current context");
  if (value.contextHash !== context.contextHash) errors.push("decision check contextHash must match current context");
  if (typeof value.id !== "string" || value.id.trim().length === 0) errors.push("decision check id must be present");
  if (!DECISION_ACTION_INTENTS.includes(value.actionIntent as never)) errors.push("decision check actionIntent is invalid");
  if (!HUMAN_CHECK_RESULTS.includes(value.humanCheckResult as never)) errors.push("decision check humanCheckResult is invalid");
  if (value.userFinalDecision !== null && typeof value.userFinalDecision !== "string") errors.push("decision check userFinalDecision must be a string or null");
  if (typeof value.checkedAt !== "string" || !Number.isFinite(Date.parse(value.checkedAt))) errors.push("decision check checkedAt must be a valid date-time");
  const reportDecision = validateResearchReportDecisionState(value.researchReportDecision);
  if (!reportDecision.ok) errors.push(...reportDecision.errors);
  const formalDecision = validateFormalDecisionState(value.formalDecision ?? formalDecisionNotCapturedState());
  if (!formalDecision.ok) errors.push(...formalDecision.errors);
  else if (formalDecision.value.availability === "preserved") {
    if (!reportDecision.ok || reportDecision.value.availability !== "preserved"
      || formalDecision.value.systemRecommendation.reportId !== reportDecision.value.binding.reportId
      || formalDecision.value.systemRecommendation.reportVersion !== reportDecision.value.binding.reportVersion
      || formalDecision.value.systemRecommendation.reportFingerprint !== reportDecision.value.binding.reportFingerprint
      || formalDecision.value.differsFromSystem !== (formalDecision.value.systemRecommendation.direction !== value.actionIntent)) {
      errors.push("decision check formalDecision must exactly bind the preserved report and Owner direction");
    }
  }
  if (binding) validateDecisionSnapshotMatch(value.decisionSnapshot, context, binding, errors);
  validateAudit(value.audit, "decision check", errors);
  validateNoSideEffects(value.safety, "decision check", errors);
  return errors.length === 0 ? { ok: true, value: value as unknown as PreTradeDecisionCheckData } : { ok: false, reason: errors.join("; ") };
}

export function validatePostDecisionReview(value: unknown, checkId: string, symbol: string, submitted?: CreatePostDecisionReviewRequest): ValidationResult<PostDecisionReviewData> {
  if (!isRecord(value)) return { ok: false, reason: "review must be an object" };
  const errors: string[] = [];
  if (value.decisionCheckId !== checkId) errors.push("review decisionCheckId must match submitted check");
  if (value.symbol !== symbol) errors.push("review symbol must match current symbol");
  if (typeof value.market !== "string" || typeof value.code !== "string" || value.symbol !== `${value.market}.${value.code}`) errors.push("review market/code must match canonical symbol");
  if (typeof value.id !== "string" || value.id.trim().length === 0) errors.push("review id must be present");
  if (!DECISION_REVIEW_OUTCOMES.includes(value.outcome as never)) errors.push("review outcome is invalid");
  if (value.outcomeEvidence !== null && typeof value.outcomeEvidence !== "string") errors.push("review outcomeEvidence must be a string or null");
  if (value.reviewNote !== null && typeof value.reviewNote !== "string") errors.push("review reviewNote must be a string or null");
  if (typeof value.reviewedAt !== "string" || !Number.isFinite(Date.parse(value.reviewedAt))) errors.push("review reviewedAt must be a valid date-time");
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) errors.push("review createdAt must be a valid date-time");
  if (submitted && value.outcome !== submitted.outcome) errors.push("review outcome must match the submitted request");
  if (submitted && value.outcomeEvidence !== (submitted.outcomeEvidence ?? null)) errors.push("review outcomeEvidence must match the submitted request");
  if (submitted && value.reviewNote !== (submitted.reviewNote ?? null)) errors.push("review reviewNote must match the submitted request");
  if (submitted && value.reviewedAt !== submitted.reviewedAt) errors.push("review reviewedAt must match the submitted request");
  if (submitted && isRecord(value.audit) && value.audit.idempotencyKey !== submitted.idempotencyKey) errors.push("review audit idempotencyKey must match the submitted request");
  const portfolioReviewValidation = validatePostDecisionPortfolioReviewStateStructure(value.portfolioReview);
  if (!portfolioReviewValidation.ok) errors.push(...portfolioReviewValidation.errors);
  validateAudit(value.audit, "review", errors);
  validateNoSideEffects(value.safety, "review", errors);
  return errors.length === 0 ? { ok: true, value: value as unknown as PostDecisionReviewData } : { ok: false, reason: errors.join("; ") };
}

export function validateDecisionCheckWriteEnvelope(value: unknown, context: DecisionContextEnvelope, binding?: DecisionSnapshotBinding): ValidationResult<PreTradeDecisionCheckData> {
  const envelope = validateResearchWriteEnvelope<PreTradeDecisionCheckData>(value, "decision check write");
  if (!envelope.ok) return envelope;
  return validateDecisionCheck(envelope.value.data, context, binding);
}

function validateDecisionSnapshotMatch(value: unknown, context: DecisionContextEnvelope, binding: DecisionSnapshotBinding, errors: string[]): void {
  const validation = validateDecisionSnapshotStateStructure(value);
  if (!validation.ok) {
    errors.push(...validation.errors);
    return;
  }
  if (validation.value.availability !== "preserved" || !validation.value.snapshot) {
    errors.push("new decision check must return a preserved decision snapshot");
    return;
  }
  const snapshot = validation.value.snapshot;
  if (snapshot.candidateSymbol !== context.requestedSymbol
    || snapshot.decisionContext.contextId !== context.contextId
    || snapshot.decisionContext.contextHash !== context.contextHash) {
    errors.push("decision snapshot must preserve the submitted decision context");
  }
  const portfolio = snapshot.portfolioContext;
  if (portfolio.state !== binding.portfolioContext.state) errors.push("decision snapshot portfolio state must match submitted binding");
  if (portfolio.envelope) {
    if (portfolio.envelope.contextId !== binding.portfolioContext.contextId
      || portfolio.envelope.portfolioSnapshotId !== binding.portfolioContext.portfolioSnapshotId
      || portfolio.envelope.accountScopeId !== binding.portfolioContext.accountScopeId) {
      errors.push("decision snapshot portfolio identities must match submitted binding");
    }
  } else if (binding.portfolioContext.state !== "not_captured") {
    errors.push("decision snapshot must preserve the bound portfolio envelope");
  }
  const risk = snapshot.riskImpact;
  if (risk.availability !== binding.riskImpact.availability) errors.push("decision snapshot risk availability must match submitted binding");
  if (risk.envelope) {
    if (risk.envelope.impactId !== binding.riskImpact.impactId
      || risk.envelope.calculationVersion !== binding.riskImpact.calculationVersion
      || risk.envelope.contextId !== binding.riskImpact.contextId
      || risk.envelope.portfolioSnapshotId !== binding.riskImpact.portfolioSnapshotId
      || risk.envelope.candidateSymbol !== binding.riskImpact.candidateSymbol
      || risk.envelope.hypotheticalAmount !== binding.riskImpact.hypotheticalAmount) {
      errors.push("decision snapshot risk identities and amount must match submitted binding");
    }
  } else if (binding.riskImpact.availability !== "not_captured") {
    errors.push("decision snapshot must preserve the bound risk envelope");
  }
}

export function validatePostDecisionReviewWriteEnvelope(value: unknown, checkId: string, symbol: string): ValidationResult<PostDecisionReviewData> {
  const envelope = validateResearchWriteEnvelope<PostDecisionReviewData>(value, "post-decision review write");
  if (!envelope.ok) return envelope;
  return validatePostDecisionReview(envelope.value.data, checkId, symbol);
}

export function validatePinganSnapshotStrict(value: unknown, symbol: string): ValidationResult<PinganSnapshotEnvelope> {
  const base = validatePinganSnapshotEnvelopeBrowser(value);
  if (!base.ok) return { ok: false, reason: `Pingan snapshot failed semantic validation: ${base.errors.join("; ")}` };
  const snapshot = value as PinganSnapshotEnvelope;
  const errors: string[] = [];
  if (snapshot.requestedSymbol !== symbol) errors.push("requestedSymbol must match current symbol");
  if (snapshot.positionCount !== snapshot.positions.length) errors.push("positionCount must equal positions length");
  for (const [index, position] of snapshot.positions.entries()) {
    if (position.symbol !== symbol) errors.push(`positions[${index}].symbol must match current symbol`);
    if (position.symbol !== `${position.market}.${position.code}`) errors.push(`positions[${index}] market/code must match canonical symbol`);
  }
  if (snapshot.status === "not_approved") {
    if (snapshot.dataUse.display !== "blocked") errors.push("not_approved must block display");
    if (snapshot.dataUse.riskImpact !== "blocked") errors.push("not_approved must block risk impact");
    if (snapshot.dataUse.brokerReconciliation !== "blocked") errors.push("not_approved must block broker reconciliation");
    if (snapshot.dataUse.accountTruth !== "blocked") errors.push("not_approved must block account truth");
    if (snapshot.dataUse.accounting !== "blocked") errors.push("not_approved must block accounting authority");
    if (snapshot.dataUse.execution !== "blocked") errors.push("not_approved must block execution input");
  }
  if (snapshot.status === "available") {
    errors.push("Pingan snapshots with positions must use stale historical-only status, not available");
  }
  if (snapshot.status === "stale" && snapshot.dataUse.riskImpact !== "blocked_stale_historical_only") {
    errors.push("position-bearing Pingan snapshot must remain blocked for stale historical risk impact");
  }
  if (snapshot.status === "stale"
    && (snapshot.dataUse.brokerReconciliation !== "blocked_not_live_authoritative"
      || snapshot.dataUse.accountTruth !== "blocked_not_live_authoritative"
      || snapshot.dataUse.accounting !== "blocked_not_accounting_authority"
      || snapshot.dataUse.execution !== "blocked_not_execution_input")) {
    errors.push("position-bearing Pingan snapshot must block broker reconciliation, account truth, accounting authority, and execution input");
  }
  if (snapshot.status !== "stale"
    && (snapshot.dataUse.display !== "blocked"
      || snapshot.dataUse.riskImpact !== "blocked"
      || snapshot.dataUse.brokerReconciliation !== "blocked"
      || snapshot.dataUse.accountTruth !== "blocked"
      || snapshot.dataUse.accounting !== "blocked"
      || snapshot.dataUse.execution !== "blocked")) {
    errors.push("fail-closed Pingan snapshot must block display, risk impact, broker reconciliation, account truth, accounting authority, and execution input");
  }
  if (snapshot.safety.readOnly !== true || snapshot.safety.createsOrder || snapshot.safety.createsTrade || snapshot.safety.mutatesCash || snapshot.safety.writesFee || snapshot.safety.mutatesPosition || snapshot.safety.callsBroker) {
    errors.push("Pingan snapshot safety must prove read-only no-side-effect use");
  }
  return errors.length === 0 ? { ok: true, value: snapshot } : { ok: false, reason: errors.join("; ") };
}

function validateResearchWriteEnvelope<T>(value: unknown, label: string): ValidationResult<ResearchWriteEnvelope<T>> {
  if (!isRecord(value)) return { ok: false, reason: `${label} must be an object` };
  const errors: string[] = [];
  if (value.schemaVersion !== RESEARCH_WRITE_SCHEMA_VERSION) errors.push(`schemaVersion must be ${RESEARCH_WRITE_SCHEMA_VERSION}`);
  if (value.status !== "succeeded") errors.push("status must be succeeded");
  if (typeof value.asOf !== "string" || !Number.isFinite(Date.parse(value.asOf))) errors.push("asOf must be a valid date-time string");
  if (!isRecord(value.source)) {
    errors.push("source must be an object");
  } else {
    if (!["user", "system", "migration", "test"].includes(String(value.source.actorType))) errors.push("source.actorType is invalid");
    if (value.source.actorId !== null && typeof value.source.actorId !== "string") errors.push("source.actorId must be a string or null");
    if (value.source.correlationId !== null && typeof value.source.correlationId !== "string") errors.push("source.correlationId must be a string or null");
  }
  if (!("data" in value)) errors.push("data must be present");
  if (typeof value.message !== "string") errors.push("message must be a string");
  return errors.length === 0 ? { ok: true, value: value as unknown as ResearchWriteEnvelope<T> } : { ok: false, reason: `${label} failed semantic validation: ${errors.join("; ")}` };
}

function validatePinganSnapshotEnvelopeBrowser(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["envelope must be an object"] };
  if (value.schemaVersion !== "2026-06-27.core-1b-pingan-snapshot.v1") errors.push("schemaVersion must be 2026-06-27.core-1b-pingan-snapshot.v1");
  if (!["available", "empty", "stale", "unavailable", "unauthorized", "source_conflict", "not_approved"].includes(value.status as PinganSnapshotStatus)) errors.push("status is invalid");
  requireNonEmptyString(value.requestedSymbol, "requestedSymbol", errors);
  if (value.sourceSystem !== null && value.sourceSystem !== "pingan_imported_snapshot") errors.push("sourceSystem must be pingan_imported_snapshot or null");
  validateOptionalString(value.sourceSnapshotId, "sourceSnapshotId", errors);
  validateOptionalString(value.sourceAsOf, "sourceAsOf", errors);
  validateOptionalString(value.importedAt, "importedAt", errors);
  validateOptionalString(value.fetchedAt, "fetchedAt", errors);
  validateDateTime(value.sourceAsOf, "sourceAsOf", errors);
  validateDateTime(value.importedAt, "importedAt", errors);
  validateDateTime(value.fetchedAt, "fetchedAt", errors);
  if (value.freshness !== null && value.freshness !== "historical" && value.freshness !== "stale") errors.push("freshness must be historical, stale, or null");
  requireString(value.limitation, "limitation", errors);
  validateOptionalString(value.warning, "warning", errors);
  const positions = Array.isArray(value.positions) ? value.positions : null;
  if (!positions || !positions.every(isValidPinganPosition)) errors.push("positions must contain valid Pingan snapshot positions");
  if (typeof value.positionCount !== "number" || value.positionCount !== (positions?.length ?? -1)) errors.push("positionCount must equal positions.length");
  validatePinganDataUse(value, errors);
  validatePinganSafety(value.safety, errors);
  requireString(value.message, "message", errors);
  validatePinganStatusSemantics(value, errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function normalize<T>(result: { ok: true } | { ok: false; errors: string[] }, value: unknown, label: string): ValidationResult<T> {
  return result.ok ? { ok: true, value: value as T } : { ok: false, reason: `${label} failed semantic validation: ${result.errors.join("; ")}` };
}

function validateNoSideEffects(value: unknown, label: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${label} safety must be present`);
    return;
  }
  for (const key of ["createsOrder", "createsTrade", "mutatesCash", "writesFee", "mutatesPosition", "callsBroker"]) {
    if (value[key] !== false) errors.push(`${label} ${key} must be false`);
  }
}

function findCandidateForbiddenFields(envelope: CandidateOverviewEnvelope): string[] {
  const forbiddenNames = new Set([
    "order",
    "orderId",
    "trade",
    "tradeId",
    "fill",
    "fillId",
    "cash",
    "fee",
    "position",
    "positions",
    "holding",
    "holdings",
    "portfolio",
    "broker"
  ]);
  const found: string[] = [];
  for (const [index, candidate] of envelope.candidates.entries()) {
    for (const key of Object.keys(candidate as unknown as Record<string, unknown>)) {
      if (forbiddenNames.has(key)) found.push(`candidates[${index}].${key}`);
    }
  }
  return found;
}

function findCandidateMembershipForbiddenFields(envelope: CandidateMembershipEnvelope): string[] {
  const found: string[] = [];
  for (const [index, membership] of envelope.memberships.entries()) {
    found.push(...findMembershipForbiddenFields(membership, `memberships[${index}]`));
  }
  return found;
}

function findMembershipForbiddenFields(membership: CandidateMembershipData, prefix: string): string[] {
  const forbiddenNames = new Set([
    "order",
    "orderId",
    "trade",
    "tradeId",
    "fill",
    "fillId",
    "cash",
    "fee",
    "position",
    "positions",
    "holding",
    "holdings",
    "broker"
  ]);
  const found: string[] = [];
  for (const key of Object.keys(membership as unknown as Record<string, unknown>)) {
    if (key === "provenance" || key === "safety") continue;
    if (forbiddenNames.has(key)) found.push(`${prefix}.${key}`);
  }
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatePinganStatusSemantics(value: Record<string, unknown>, errors: string[]): void {
  const positions = Array.isArray(value.positions) ? value.positions : [];
  if (value.status === "available") {
    errors.push("Pingan snapshots with positions must use stale historical-only status, not available");
  }
  if (value.status === "stale") {
    if (value.sourceSystem !== "pingan_imported_snapshot") errors.push("sourceSystem is required for position-bearing responses");
    if (typeof value.sourceSnapshotId !== "string") errors.push("sourceSnapshotId is required for position-bearing responses");
    if (typeof value.sourceAsOf !== "string") errors.push("sourceAsOf is required for position-bearing responses");
    validateDateTime(value.sourceAsOf, "sourceAsOf", errors);
    validateDateTime(value.importedAt, "importedAt", errors);
    validateDateTime(value.fetchedAt, "fetchedAt", errors);
    if (typeof value.importedAt !== "string" && typeof value.fetchedAt !== "string") errors.push("importedAt or fetchedAt is required for position-bearing responses");
    if (value.warning === null) errors.push("warning is required for position-bearing responses");
    if (positions.length === 0) errors.push("positions are required for stale historical Pingan snapshots");
    validatePinganHistoricalOnlyDisclosure(value, errors);
    validatePinganHistoricalOnlyDataUse(value.dataUse, errors);
  } else if (positions.length !== 0) {
    errors.push("positions must be empty for fail-closed states");
  } else {
    validatePinganFailClosedDataUse(value.dataUse, errors);
  }
}

function validatePinganDataUse(value: Record<string, unknown>, errors: string[]): void {
  if (!isRecord(value.dataUse)) {
    errors.push("dataUse must be an object");
    return;
  }
  if (value.dataUse.display !== "allowed_with_warning" && value.dataUse.display !== "blocked") errors.push("dataUse.display is invalid");
  if (value.dataUse.riskImpact !== "blocked_stale_historical_only" && value.dataUse.riskImpact !== "blocked") errors.push("dataUse.riskImpact is invalid");
  if (value.dataUse.brokerReconciliation !== "blocked_not_live_authoritative" && value.dataUse.brokerReconciliation !== "blocked") errors.push("dataUse.brokerReconciliation is invalid");
  if (value.dataUse.accountTruth !== "blocked_not_live_authoritative" && value.dataUse.accountTruth !== "blocked") errors.push("dataUse.accountTruth is invalid");
  if (value.dataUse.accounting !== "blocked_not_accounting_authority" && value.dataUse.accounting !== "blocked") errors.push("dataUse.accounting is invalid");
  if (value.dataUse.execution !== "blocked_not_execution_input" && value.dataUse.execution !== "blocked") errors.push("dataUse.execution is invalid");
}

function validatePinganHistoricalOnlyDataUse(value: unknown, errors: string[]): void {
  if (!isRecord(value)) return;
  if (value.display !== "allowed_with_warning") errors.push("stale historical Pingan snapshots must use allowed_with_warning display");
  if (value.riskImpact !== "blocked_stale_historical_only") errors.push("stale historical Pingan snapshots must block stale historical risk impact");
  if (value.brokerReconciliation !== "blocked_not_live_authoritative") errors.push("stale historical Pingan snapshots must block broker reconciliation as not live authoritative");
  if (value.accountTruth !== "blocked_not_live_authoritative") errors.push("stale historical Pingan snapshots must block account truth as not live authoritative");
  if (value.accounting !== "blocked_not_accounting_authority") errors.push("stale historical Pingan snapshots must block accounting authority");
  if (value.execution !== "blocked_not_execution_input") errors.push("stale historical Pingan snapshots must block execution input");
}

function validatePinganHistoricalOnlyDisclosure(value: Record<string, unknown>, errors: string[]): void {
  const disclosure = `${String(value.limitation ?? "")} ${String(value.warning ?? "")}`.toLowerCase();
  const required: Array<[RegExp, string]> = [
    [/last[- ]imported/, "last-imported"],
    [/historical/, "historical"],
    [/not[- ]live|not live|no live/, "not-live"],
    [/not[- ]authoritative|not authoritative/, "not-authoritative"],
    [/broker[- ]reconciliation|broker reconciled|broker-reconciled|broker sync/, "no-broker-reconciliation"],
    [/account truth/, "no-account-truth"],
    [/accounting/, "no-accounting-authority"],
    [/execution/, "no-execution-input"],
    [/risk[- ]impact|risk impact/, "no-risk-impact"]
  ];
  for (const [pattern, label] of required) {
    if (!pattern.test(disclosure)) errors.push(`stale historical Pingan disclosure must include ${label}`);
  }
}

function validatePinganFailClosedDataUse(value: unknown, errors: string[]): void {
  if (!isRecord(value)) return;
  for (const key of ["display", "riskImpact", "brokerReconciliation", "accountTruth", "accounting", "execution"]) {
    if (value[key] !== "blocked") errors.push(`fail-closed Pingan snapshots must block dataUse.${key}`);
  }
}

function validatePinganSafety(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("safety must be an object");
    return;
  }
  for (const key of ["readOnly", "createsOrder", "createsTrade", "mutatesCash", "writesFee", "mutatesPosition", "callsBroker"] as const) {
    const expected = key === "readOnly";
    if (value[key] !== expected) errors.push(`safety.${key} must be ${expected}`);
  }
}

function validateAudit(value: unknown, label: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${label} audit must be present`);
    return;
  }
  if (!["user", "system", "migration", "test"].includes(String(value.actorType))) errors.push(`${label} audit actorType is invalid`);
  if (value.actorId !== null && typeof value.actorId !== "string") errors.push(`${label} audit actorId must be a string or null`);
  if (typeof value.idempotencyKey !== "string" || value.idempotencyKey.trim().length === 0) errors.push(`${label} audit idempotencyKey must be present`);
  if (value.correlationId !== null && typeof value.correlationId !== "string") errors.push(`${label} audit correlationId must be a string or null`);
}

function validateDateTime(value: unknown, field: string, errors: string[]): void {
  if (value !== null && value !== undefined && (typeof value !== "string" || !isStrictUtcDateTime(value))) {
    errors.push(`${field} must be a valid date-time`);
  }
}

function isStrictUtcDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value;
}

function isValidPinganPosition(value: unknown): boolean {
  return isRecord(value)
    && typeof value.market === "string"
    && typeof value.code === "string"
    && typeof value.symbol === "string"
    && typeof value.sourceRowId === "string"
    && value.sourceRowId.trim().length > 0
    && (typeof value.name === "string" || value.name === null)
    && typeof value.quantity === "number"
    && Number.isFinite(value.quantity)
    && value.quantity >= 0
    && (typeof value.averageCost === "number" || value.averageCost === null)
    && (typeof value.currentWeight === "number" || value.currentWeight === null)
    && (typeof value.maxWeight === "number" || value.maxWeight === null)
    && (typeof value.unrealizedPnl === "number" || value.unrealizedPnl === null)
    && (typeof value.currency === "string" || value.currency === null);
}

function requireNonEmptyString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${field} must be a non-empty string`);
}

function requireString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string") errors.push(`${field} must be a string`);
}

function validateOptionalString(value: unknown, field: string, errors: string[]): void {
  if (value !== null && typeof value !== "string") errors.push(`${field} must be a string or null`);
}
