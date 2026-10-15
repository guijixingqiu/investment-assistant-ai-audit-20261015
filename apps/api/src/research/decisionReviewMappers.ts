import type { HumanCheckResult, PreTradeDecisionCheckData } from "../../../../packages/contracts/src/decisionContext.js";
import {
  DECISION_CHECK_SCHEMA_VERSION,
  DECISION_CONTEXT_SCHEMA_VERSION,
  validDecisionReviewDueOn,
  validateManualDecisionSourceBindings,
  validateOrdinaryResearchChangeBinding,
  validateDecisionContextEnvelope,
  type DecisionContextEnvelope
} from "../../../../packages/contracts/src/decisionContext.js";
import type { PostDecisionReviewData } from "../../../../packages/contracts/src/decisionReview.js";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import { reviewNoSideEffectSafety } from "../../../../packages/contracts/src/decisionReview.js";
import {
  annualReviewLearningNotCapturedState,
  validateAnnualReviewLearningState
} from "../../../../packages/contracts/src/annualReviewLearning.js";
import {
  decisionSnapshotBindingFromState,
  decisionSnapshotNotCapturedState,
  sameDecisionSnapshotBinding,
  validateDecisionSnapshotState,
  type DecisionSnapshotState
} from "../../../../packages/contracts/src/decisionSnapshot.js";
import {
  researchReportDecisionNotCapturedState,
  validateResearchReportDecisionState,
  type ResearchReportDecisionState
} from "../../../../packages/contracts/src/decisionContext.js";
import {
  annualConditionalDecisionNotCapturedState,
  conditionalDecisionSnapshotBindingFromPreview,
  conditionalHumanCheckResult,
  validateAnnualConditionalDecisionState,
  type AnnualConditionalDecisionState
} from "../../../../packages/contracts/src/annualConditionalDecision.js";
import {
  normalizePostDecisionPortfolioReviewState,
  portfolioReviewNotCapturedState,
  validatePostDecisionPortfolioReviewState
} from "../../../../packages/contracts/src/postDecisionPortfolioReview.js";
import { formalDecisionNotCapturedState, validateFormalDecisionState } from "../../../../packages/contracts/src/formalDecision.js";

export interface DecisionCheckRow {
  id: string;
  stock_id?: string;
  market: string;
  code: string;
  symbol: string;
  action_intent: PreTradeDecisionCheckData["actionIntent"];
  verdict: "pass" | "block" | "needs_review";
  requested_price: string | null;
  requested_quantity: string | null;
  current_price: string | null;
  current_quantity: string | null;
  average_cost: string | null;
  market_value: string | null;
  current_weight: string | null;
  user_final_decision: string | null;
  checked_at: Date | string;
  raw_payload?: unknown;
  audit_count?: number | string;
  audit_after_payload?: unknown;
  decision_context_snapshot?: unknown;
  decision_snapshot?: unknown;
}

export interface PostDecisionReviewRow {
  id: string;
  decision_check_id: string;
  market?: string;
  code?: string;
  symbol?: string;
  actor_type: "user" | "system" | "migration" | "test";
  actor_id: string | null;
  outcome: "thesis_confirmed" | "thesis_weakened" | "thesis_invalidated" | "insufficient_evidence";
  outcome_evidence: string | null;
  review_note: string | null;
  reviewed_at: Date | string;
  idempotency_key: string;
  correlation_id: string | null;
  created_at: Date | string;
  raw_payload?: unknown;
  portfolio_review_snapshot?: unknown;
}

export function rowToDecisionCheckFromRawPayload(row: DecisionCheckRow): PreTradeDecisionCheckData {
  if (row.audit_count !== undefined && Number(row.audit_count) !== 1)
    throw new Error("decision audit count is not exactly one");
  const raw = isRecord(row.raw_payload) ? row.raw_payload : {};
  const reviewDueOn = readDecisionReviewDueOn(row.raw_payload, row.audit_after_payload);
  const manualSourceBindings = readDecisionManualSourceBindings(row.raw_payload, row.audit_after_payload);
  const researchChangeBinding = readDecisionResearchChangeBinding(row.raw_payload, row.audit_after_payload);
  const decision: PreTradeDecisionCheckData = {
    id: String(row.id),
    market: row.market,
    code: row.code,
    symbol: row.symbol,
    decisionContextSchemaVersion: DECISION_CONTEXT_SCHEMA_VERSION,
    decisionCheckSchemaVersion: DECISION_CHECK_SCHEMA_VERSION,
    contextId: stringOr(raw.contextId, "context_snapshot_unavailable"),
    contextHash: stringOr(raw.contextHash, "context_snapshot_unavailable"),
    actionIntent: row.action_intent,
    humanCheckResult: humanCheckResultFromLegacy(row.verdict, raw.humanCheckResult),
    userFinalDecision: row.user_final_decision,
    checkedAt: new Date(row.checked_at).toISOString(),
    ...(reviewDueOn === undefined ? {} : { reviewDueOn }),
    ...(manualSourceBindings === undefined ? {} : { manualSourceBindings }),
    ...(researchChangeBinding === undefined ? {} : { researchChangeBinding }),
    researchReportDecision: researchReportDecisionNotCapturedState(),
    formalDecision: formalDecisionNotCapturedState(),
    audit: { actorType: "system", actorId: null, idempotencyKey: "", correlationId: null },
    safety: reviewNoSideEffectSafety()
  };
  decision.decisionSnapshot = preservedDecisionSnapshotState(row.decision_snapshot, decision);
  decision.conditionalDecision = preservedConditionalDecisionState(raw.conditionalDecision, decision);
  decision.researchReportDecision = preservedResearchReportDecisionState(raw, decision);
  decision.formalDecision = preservedFormalDecisionState(raw);
  if (researchChangeBinding && (researchChangeBinding.symbol !== decision.symbol
    || researchChangeBinding.previousDecisionCheckId === decision.id
    || Date.parse(researchChangeBinding.sourcePublishedAt) > Date.parse(decision.checkedAt)))
    throw new Error("decision research change binding identity or chronology is invalid");
  return decision;
}

function readDecisionResearchChangeBinding(rawPayload: unknown, auditAfterPayload?: unknown) {
  const read = (payload: unknown, label: string) => {
    if (!isRecord(payload) || !Object.hasOwn(payload, "researchChangeBinding")) return undefined;
    const errors: string[] = [];
    validateOrdinaryResearchChangeBinding(payload.researchChangeBinding,
      `${label}.researchChangeBinding`, errors);
    if (errors.length) throw new Error(errors.join("; "));
    return payload.researchChangeBinding as NonNullable<PreTradeDecisionCheckData["researchChangeBinding"]>;
  };
  const raw = read(rawPayload, "decision raw payload");
  if (auditAfterPayload !== undefined) {
    const audit = read(auditAfterPayload, "decision audit afterPayload");
    if (canonicalJson(raw ?? null) !== canonicalJson(audit ?? null))
      throw new Error("decision research change binding differs between raw payload and audit");
  }
  return raw;
}

function readDecisionManualSourceBindings(rawPayload: unknown, auditAfterPayload?: unknown) {
  const read = (payload: unknown, label: string) => {
    if (!isRecord(payload) || !Object.hasOwn(payload, "manualSourceBindings")) return undefined;
    const errors: string[] = [];
    validateManualDecisionSourceBindings(payload.manualSourceBindings, `${label}.manualSourceBindings`, errors);
    if (errors.length) throw new Error(errors.join("; "));
    return payload.manualSourceBindings as NonNullable<PreTradeDecisionCheckData["manualSourceBindings"]>;
  };
  const raw = read(rawPayload, "decision raw payload");
  if (auditAfterPayload !== undefined) {
    const audit = read(auditAfterPayload, "decision audit afterPayload");
    if (canonicalJson(raw ?? null) !== canonicalJson(audit ?? null))
      throw new Error("decision manual source bindings differ between raw payload and audit");
  }
  return raw;
}

export function readDecisionReviewDueOn(rawPayload: unknown, auditAfterPayload?: unknown): string | undefined {
  const read = (payload: unknown, label: string) => {
    if (!isRecord(payload) || !Object.hasOwn(payload, "reviewDueOn")) return undefined;
    if (!validDecisionReviewDueOn(payload.reviewDueOn)) throw new Error(`${label} reviewDueOn is invalid`);
    return payload.reviewDueOn;
  };
  const rawDate = read(rawPayload, "decision raw payload");
  if (auditAfterPayload !== undefined) {
    if (!isRecord(auditAfterPayload)) throw new Error("decision audit afterPayload is invalid");
    const auditDate = read(auditAfterPayload, "decision audit afterPayload");
    if (rawDate !== auditDate) throw new Error("decision reviewDueOn differs between raw payload and audit");
  }
  return rawDate;
}

function preservedFormalDecisionState(raw: Record<string, unknown>) {
  if (!Object.hasOwn(raw, "formalDecision")) return formalDecisionNotCapturedState();
  const validation = validateFormalDecisionState(raw.formalDecision);
  if (!validation.ok) throw new Error(`persisted formal decision failed validation: ${validation.errors.join("; ")}`);
  return validation.value;
}

function preservedResearchReportDecisionState(
  raw: Record<string, unknown>,
  decision: PreTradeDecisionCheckData
): ResearchReportDecisionState {
  if (!Object.hasOwn(raw, "researchReportDecision")) return researchReportDecisionNotCapturedState();
  const validation = validateResearchReportDecisionState(raw.researchReportDecision);
  if (!validation.ok) {
    throw new Error(`persisted research-report decision binding failed validation: ${validation.errors.join("; ")}`);
  }
  if (validation.value.availability === "preserved"
    && validation.value.binding.symbol !== decision.symbol) {
    throw new Error("persisted research-report decision binding symbol does not match the decision check");
  }
  return validation.value;
}

function preservedConditionalDecisionState(
  value: unknown,
  decision: PreTradeDecisionCheckData
): AnnualConditionalDecisionState {
  const validation = validateAnnualConditionalDecisionState(value);
  if (!validation.ok) return annualConditionalDecisionNotCapturedState();
  const conditional = validation.value;
  if (conditional.availability !== "preserved") return conditional;
  const preview = conditional.preview;
  const judgment = conditional.judgment;
  const source = preview?.data?.decisionBrief.data?.sourceIdentity;
  const expectedBinding = preview ? conditionalDecisionSnapshotBindingFromPreview(preview) : null;
  const actualBinding = decisionSnapshotBindingFromState(decision.decisionSnapshot);
  if (!preview || !judgment || preview.requestedSymbol !== decision.symbol
    || source?.decisionContextId !== decision.contextId || source.decisionContextHash !== decision.contextHash
    || decision.actionIntent !== "watch"
    || decision.humanCheckResult !== conditionalHumanCheckResult(judgment.workflowState)
    || !expectedBinding || !actualBinding || !sameDecisionSnapshotBinding(expectedBinding, actualBinding)) {
    return annualConditionalDecisionNotCapturedState();
  }
  return conditional;
}

export function decisionContextSnapshotState(row: DecisionCheckRow, decision: PreTradeDecisionCheckData) {
  if (isValidPreservedDecisionContextSnapshot(row.decision_context_snapshot, decision)) {
    return {
      availability: "preserved" as const,
      envelope: row.decision_context_snapshot,
      limitation: "Exact recorded decision context snapshot is preserved from check submission time."
    };
  }
  return {
    availability: "context_snapshot_unavailable" as const,
    envelope: null,
    limitation: "Historical decision context snapshot is unavailable for this older check; it is not reconstructed from current quote, research, portfolio, or suggestion data."
  };
}

export function preservedDecisionSnapshotState(value: unknown, decision: PreTradeDecisionCheckData): DecisionSnapshotState {
  const validation = validateDecisionSnapshotState(value);
  if (validation.ok && validation.value.availability === "preserved") {
    const snapshot = validation.value.snapshot;
    if (snapshot
      && snapshot.candidateSymbol === decision.symbol
      && snapshot.decisionContext.schemaVersion === decision.decisionContextSchemaVersion
      && snapshot.decisionContext.contextId === decision.contextId
      && snapshot.decisionContext.contextHash === decision.contextHash) {
      return validation.value;
    }
  }
  return decisionSnapshotNotCapturedState();
}

export function rowToPostDecisionReview(
  row: PostDecisionReviewRow,
  decision: PreTradeDecisionCheckData
): PostDecisionReviewData {
  const portfolioReview = validatedPortfolioReviewState(row, decision.decisionSnapshot!);
  const reviewLearning = validatedReviewLearningState(row, decision);
  return {
    id: String(row.id),
    decisionCheckId: String(row.decision_check_id),
    market: row.market ?? "",
    code: row.code ?? "",
    symbol: row.symbol ?? "",
    outcome: row.outcome,
    outcomeEvidence: row.outcome_evidence,
    reviewNote: row.review_note,
    reviewedAt: new Date(row.reviewed_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    portfolioReview,
    reviewLearning,
    audit: {
      actorType: row.actor_type,
      actorId: row.actor_id,
      idempotencyKey: row.idempotency_key,
      correlationId: row.correlation_id
    },
    safety: reviewNoSideEffectSafety()
  };
}

function validatedReviewLearningState(
  row: PostDecisionReviewRow,
  decision: PreTradeDecisionCheckData
) {
  const raw = isRecord(row.raw_payload) ? row.raw_payload : {};
  const value = raw.reviewLearning ?? annualReviewLearningNotCapturedState();
  const validation = validateAnnualReviewLearningState(
    value,
    String(row.decision_check_id),
    decision.decisionSnapshot,
    decision.conditionalDecision
  );
  if (!validation.ok) {
    throw new Error(`persisted annual review learning failed validation: ${validation.errors.join("; ")}`);
  }
  return validation.value;
}

function validatedPortfolioReviewState(row: PostDecisionReviewRow, decisionSnapshot: DecisionSnapshotState) {
  if (row.portfolio_review_snapshot === undefined || row.portfolio_review_snapshot === null) {
    return portfolioReviewNotCapturedState();
  }
  const validation = validatePostDecisionPortfolioReviewState(
    row.portfolio_review_snapshot,
    decisionSnapshot,
    String(row.decision_check_id),
    row.symbol ?? ""
  );
  if (!validation.ok) {
    throw new Error(`persisted post-decision portfolio review failed validation: ${validation.errors.join("; ")}`);
  }
  return validation.value;
}

function isValidPreservedDecisionContextSnapshot(value: unknown, decision: PreTradeDecisionCheckData): value is DecisionContextEnvelope {
  if (!validateDecisionContextEnvelope(value).ok) return false;
  const envelope = value as DecisionContextEnvelope;
  return envelope.schemaVersion === decision.decisionContextSchemaVersion
    && envelope.contextId === decision.contextId
    && envelope.contextHash === decision.contextHash
    && envelope.requestedSymbol === decision.symbol;
}

function humanCheckResultFromLegacy(verdict: DecisionCheckRow["verdict"], rawValue: unknown): HumanCheckResult {
  if (rawValue === "ready_to_consider" || rawValue === "blocked" || rawValue === "needs_more_evidence") return rawValue;
  if (verdict === "pass") return "ready_to_consider";
  if (verdict === "block") return "blocked";
  return "needs_more_evidence";
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
