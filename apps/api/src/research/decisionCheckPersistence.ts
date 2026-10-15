import type { Pool, PoolClient } from "pg";
import type { CreatePreTradeDecisionCheckRequest, PreTradeDecisionCheckData } from "../../../../packages/contracts/src/decisionContext.js";
import { DECISION_CHECK_SCHEMA_VERSION } from "../../../../packages/contracts/src/decisionContext.js";
import type { ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import { RESEARCH_WRITE_SCHEMA_VERSION } from "../../../../packages/contracts/src/research.js";
import { canonicalJson, validDecisionReviewDueOn, validateManualDecisionSourceBindings,
  validateOrdinaryResearchChangeBinding } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import {
  researchReportDecisionNotCapturedState,
  validateResearchReportDecisionState,
  type ResearchReportDecisionBinding,
  type ResearchReportDecisionState
} from "../../../../packages/contracts/src/decisionContextBrowser.js";
import {
  annualConditionalDecisionNotCapturedState,
  validateAnnualConditionalDecisionState,
  type AnnualConditionalDecisionState,
  type AnnualConditionalDecisionSubmission
} from "../../../../packages/contracts/src/annualConditionalDecision.js";
import {
  decisionSnapshotNotCapturedState,
  validateDecisionSnapshotState,
  type DecisionSnapshotBinding,
  type DecisionSnapshotState
} from "../../../../packages/contracts/src/decisionSnapshot.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { formalDecisionNotCapturedState } from "../../../../packages/contracts/src/formalDecision.js";
import { readDecisionReviewDueOn, type DecisionCheckRow } from "./decisionReviewMappers.js";
import { actorRequest, sameResearchWriteActor } from "./writePersistence.js";

export type ReviewedAtRequestSemantics =
  | { kind: "omitted" }
  | { kind: "null" }
  | { kind: "timestamp"; value: string };

export interface DecisionCheckRequestSemantics {
  reviewedAt: ReviewedAtRequestSemantics;
  reviewDueOn?: string;
  manualSourceBindings?: CreatePreTradeDecisionCheckRequest["manualSourceBindings"];
  researchChangeBinding?: CreatePreTradeDecisionCheckRequest["researchChangeBinding"];
  decisionSnapshotBinding?: DecisionSnapshotBinding;
  conditionalDecision?: AnnualConditionalDecisionSubmission;
  researchReportBinding?: ResearchReportDecisionBinding;
  formalDecision?: CreatePreTradeDecisionCheckRequest["formalDecision"];
}

export interface DecisionCheckAuditRecord {
  envelope: ResearchWriteEnvelope<PreTradeDecisionCheckData>;
  requestSemantics: DecisionCheckRequestSemantics | null;
}

export function decisionCheckRequestSemantics(request: CreatePreTradeDecisionCheckRequest): DecisionCheckRequestSemantics {
  if (request.reviewDueOn !== undefined && !validDecisionReviewDueOn(request.reviewDueOn))
    throw new Error("reviewDueOn must be a valid calendar date");
  const reviewedAt: ReviewedAtRequestSemantics = !Object.hasOwn(request, "reviewedAt") || request.reviewedAt === undefined
    ? { kind: "omitted" }
    : request.reviewedAt === null
      ? { kind: "null" }
      : { kind: "timestamp", value: new Date(request.reviewedAt as string).toISOString() };
  return {
    reviewedAt,
    ...(request.reviewDueOn === undefined ? {} : { reviewDueOn: request.reviewDueOn }),
    ...(request.manualSourceBindings === undefined ? {} : { manualSourceBindings: request.manualSourceBindings }),
    ...(request.researchChangeBinding === undefined ? {} : { researchChangeBinding: request.researchChangeBinding }),
    ...(request.decisionSnapshotBinding === undefined ? {} : { decisionSnapshotBinding: request.decisionSnapshotBinding }),
    ...(request.conditionalDecision === undefined ? {} : { conditionalDecision: request.conditionalDecision }),
    ...(request.researchReportBinding === undefined ? {} : { researchReportBinding: request.researchReportBinding }),
    ...(request.formalDecision === undefined ? {} : { formalDecision: request.formalDecision })
  };
}

export function sameDecisionCheckPayload(
  existingAudit: DecisionCheckAuditRecord,
  request: CreatePreTradeDecisionCheckRequest,
  requestSemantics: DecisionCheckRequestSemantics,
  symbol: string,
  actor: AuthenticatedResearchActor
): boolean {
  const existing = existingAudit.envelope.data;
  return sameResearchWriteActor(existingAudit.envelope, actorRequest(actor, request.idempotencyKey))
    && existing.symbol === symbol
    && existing.decisionContextSchemaVersion === request.decisionContextSchemaVersion
    && existing.contextId === request.contextId
    && existing.contextHash === request.contextHash
    && existing.actionIntent === request.actionIntent
    && existing.humanCheckResult === request.humanCheckResult
    && existing.userFinalDecision === (request.userFinalDecision ?? null)
    && existing.reviewDueOn === request.reviewDueOn
    && sameRequestSemantics(existingAudit.requestSemantics, requestSemantics)
    && existing.audit.idempotencyKey === request.idempotencyKey
    && existing.audit.actorType === actor.actorType
    && existing.audit.actorId === actor.actorId
    && existing.audit.correlationId === null;
}

export async function findExistingStock(
  client: Pick<Pool | PoolClient, "query">,
  market: string,
  code: string
): Promise<{ id: string; market: string; code: string; symbol: string; name: string | null } | null> {
  const result = await client.query<{ id: string; market: string; code: string; symbol: string; name: string | null }>(
    `select id, market, code, symbol, name from stocks where market = $1 and code = $2 limit 1`,
    [market, code]
  );
  return result.rows[0] ?? null;
}

export async function findDecisionCheckAuditByIdempotencyKey(
  client: Pick<Pool | PoolClient, "query">,
  idempotencyKey: string
): Promise<DecisionCheckAuditRecord | null> {
  const result = await client.query<{
    before_payload: DecisionCheckRequestSemantics | null;
    after_payload: PreTradeDecisionCheckData;
    persisted_raw_payload: unknown;
    actor_type: "user" | "system" | "migration" | "test";
    actor_id: string | null;
    correlation_id: string | null;
    created_at: Date | string;
  }>(
    `select audit.before_payload, audit.after_payload, checks.raw_payload as persisted_raw_payload,
            audit.actor_type, audit.actor_id, audit.correlation_id, audit.created_at
       from research_write_audit_events audit
       join pre_trade_decision_checks checks on checks.id::text = audit.target_id
      where audit.idempotency_key = $1 and audit.event_type = 'decision_check_created'
        and audit.target_table = 'pre_trade_decision_checks' limit 1`,
    [idempotencyKey]
  );
  const row = result.rows[0];
  if (!row) return null;
  readDecisionReviewDueOn(row.persisted_raw_payload, row.after_payload);
  const requestSemantics = isRequestSemantics(row.before_payload) ? row.before_payload : null;
  const replayableRequestSemantics = requestSemantics
    && (requestSemantics.decisionSnapshotBinding !== undefined
      && !decisionSnapshotMatchesBinding(row.after_payload, requestSemantics.decisionSnapshotBinding)
      || requestSemantics.conditionalDecision !== undefined
      && !conditionalDecisionMatchesSubmission(row.after_payload, requestSemantics.conditionalDecision)
      || requestSemantics.researchReportBinding !== undefined
      && !researchReportDecisionMatchesBinding(row.after_payload, requestSemantics.researchReportBinding)
      || canonicalJson(requestSemantics.manualSourceBindings ?? null)
        !== canonicalJson(row.after_payload.manualSourceBindings ?? null)
      || canonicalJson(requestSemantics.researchChangeBinding ?? null)
        !== canonicalJson(row.after_payload.researchChangeBinding ?? null)
      || canonicalJson((row.persisted_raw_payload as { researchChangeBinding?: unknown } | null)?.researchChangeBinding ?? null)
        !== canonicalJson(row.after_payload.researchChangeBinding ?? null))
    ? null
    : requestSemantics;
  return {
    requestSemantics: replayableRequestSemantics,
    envelope: {
      schemaVersion: RESEARCH_WRITE_SCHEMA_VERSION,
      status: "succeeded",
      asOf: new Date(row.created_at).toISOString(),
      source: { actorType: row.actor_type, actorId: row.actor_id, correlationId: row.correlation_id },
      data: normalizeDecisionCheck(row.after_payload),
      message: "Idempotent write already recorded."
    }
  };
}

export function rowToDecisionCheck(
  row: DecisionCheckRow,
  request: CreatePreTradeDecisionCheckRequest,
  actor: AuthenticatedResearchActor,
  decisionSnapshot: DecisionSnapshotState,
  conditionalDecision?: AnnualConditionalDecisionState,
  researchReportDecision: ResearchReportDecisionState = researchReportDecisionNotCapturedState()
): PreTradeDecisionCheckData {
  return {
    id: String(row.id), market: row.market, code: row.code, symbol: row.symbol,
    decisionContextSchemaVersion: request.decisionContextSchemaVersion,
    decisionCheckSchemaVersion: DECISION_CHECK_SCHEMA_VERSION,
    contextId: request.contextId, contextHash: request.contextHash,
    actionIntent: row.action_intent, humanCheckResult: request.humanCheckResult,
    userFinalDecision: row.user_final_decision, checkedAt: new Date(row.checked_at).toISOString(), decisionSnapshot, conditionalDecision,
    ...(request.reviewDueOn === undefined ? {} : { reviewDueOn: request.reviewDueOn }),
    ...(request.manualSourceBindings === undefined ? {} : { manualSourceBindings: request.manualSourceBindings }),
    ...(request.researchChangeBinding === undefined ? {} : { researchChangeBinding: request.researchChangeBinding }),
    researchReportDecision,
    formalDecision: formalDecisionNotCapturedState(),
    audit: { actorType: actor.actorType, actorId: actor.actorId, idempotencyKey: request.idempotencyKey, correlationId: null },
    safety: { createsOrder: false, createsTrade: false, mutatesCash: false, writesFee: false, mutatesPosition: false, callsBroker: false }
  };
}

function sameRequestSemantics(existing: DecisionCheckRequestSemantics | null, requested: DecisionCheckRequestSemantics): boolean {
  if (!existing || existing.reviewedAt.kind !== requested.reviewedAt.kind) return false;
  if ((existing.reviewDueOn ?? null) !== (requested.reviewDueOn ?? null)) return false;
  if (canonicalJson(existing.manualSourceBindings ?? null) !== canonicalJson(requested.manualSourceBindings ?? null)) return false;
  if (canonicalJson(existing.researchChangeBinding ?? null) !== canonicalJson(requested.researchChangeBinding ?? null)) return false;
  if (existing.reviewedAt.kind === "timestamp" && requested.reviewedAt.kind === "timestamp"
    && existing.reviewedAt.value !== requested.reviewedAt.value) return false;
  if (existing.decisionSnapshotBinding === undefined || requested.decisionSnapshotBinding === undefined) {
    if (existing.decisionSnapshotBinding !== requested.decisionSnapshotBinding) return false;
  } else if (canonicalJson(existing.decisionSnapshotBinding) !== canonicalJson(requested.decisionSnapshotBinding)) {
    return false;
  }
  if (existing.conditionalDecision === undefined || requested.conditionalDecision === undefined) {
    if (existing.conditionalDecision !== requested.conditionalDecision) return false;
  } else if (canonicalJson(existing.conditionalDecision) !== canonicalJson(requested.conditionalDecision)) {
    return false;
  }
  if (existing.researchReportBinding === undefined || requested.researchReportBinding === undefined) {
    if (existing.researchReportBinding !== requested.researchReportBinding) return false;
  } else if (canonicalJson(existing.researchReportBinding) !== canonicalJson(requested.researchReportBinding)) {
    return false;
  }
  if (existing.formalDecision === undefined || requested.formalDecision === undefined) {
    return existing.formalDecision === requested.formalDecision;
  }
  return canonicalJson(existing.formalDecision) === canonicalJson(requested.formalDecision);
}

function isRequestSemantics(value: unknown): value is DecisionCheckRequestSemantics {
  if (!value || typeof value !== "object" || !("reviewedAt" in value)) return false;
  const reviewedAt = (value as { reviewedAt?: unknown }).reviewedAt;
  if (!reviewedAt || typeof reviewedAt !== "object" || !("kind" in reviewedAt)) return false;
  const kind = (reviewedAt as { kind?: unknown }).kind;
  const reviewedAtValid = kind === "omitted" || kind === "null" || (kind === "timestamp" && typeof (reviewedAt as { value?: unknown }).value === "string");
  if (!reviewedAtValid) return false;
  if ((value as { reviewDueOn?: unknown }).reviewDueOn !== undefined
    && !validDecisionReviewDueOn((value as { reviewDueOn?: unknown }).reviewDueOn)) return false;
  const manualSourceBindings = (value as { manualSourceBindings?: unknown }).manualSourceBindings;
  if (manualSourceBindings !== undefined) {
    const errors: string[] = [];
    validateManualDecisionSourceBindings(manualSourceBindings, "manualSourceBindings", errors);
    if (errors.length > 0) return false;
  }
  const researchChangeBinding = (value as { researchChangeBinding?: unknown }).researchChangeBinding;
  if (researchChangeBinding !== undefined) {
    const errors: string[] = [];
    validateOrdinaryResearchChangeBinding(researchChangeBinding, "researchChangeBinding", errors);
    if (errors.length > 0) return false;
  }
  const binding = (value as { decisionSnapshotBinding?: unknown }).decisionSnapshotBinding;
  if (binding !== undefined && (typeof binding !== "object" || binding === null)) return false;
  const conditional = (value as { conditionalDecision?: unknown }).conditionalDecision;
  if (conditional !== undefined && (typeof conditional !== "object" || conditional === null)) return false;
  const reportBinding = (value as { researchReportBinding?: unknown }).researchReportBinding;
  if (reportBinding !== undefined && (typeof reportBinding !== "object" || reportBinding === null)) return false;
  const formalDecision = (value as { formalDecision?: unknown }).formalDecision;
  return formalDecision === undefined || typeof formalDecision === "object" && formalDecision !== null;
}

function normalizeDecisionCheck(value: PreTradeDecisionCheckData): PreTradeDecisionCheckData {
  if (value.reviewDueOn !== undefined && !validDecisionReviewDueOn(value.reviewDueOn))
    throw new Error("persisted reviewDueOn is invalid");
  if (value.manualSourceBindings !== undefined) {
    const errors: string[] = [];
    validateManualDecisionSourceBindings(value.manualSourceBindings, "manualSourceBindings", errors);
    if (errors.length) throw new Error(`persisted manual source binding is invalid: ${errors.join("; ")}`);
  }
  if (value.researchChangeBinding !== undefined) {
    const errors: string[] = [];
    validateOrdinaryResearchChangeBinding(value.researchChangeBinding, "researchChangeBinding", errors);
    if (errors.length || value.researchChangeBinding.symbol !== value.symbol
      || value.researchChangeBinding.previousDecisionCheckId === value.id)
      throw new Error(`persisted ordinary research change binding is invalid: ${errors.join("; ")}`);
  }
  const snapshot = value.decisionSnapshot;
  const validation = validateDecisionSnapshotState(snapshot);
  const normalized = validation.ok
    ? { ...value, decisionSnapshot: validation.value }
    : { ...value, decisionSnapshot: decisionSnapshotNotCapturedState() };
  const conditional = validateAnnualConditionalDecisionState(value.conditionalDecision);
  const withConditional = conditional.ok
    ? { ...normalized, conditionalDecision: conditional.value }
    : { ...normalized, conditionalDecision: annualConditionalDecisionNotCapturedState() };
  const report = value.researchReportDecision === undefined
    ? { ok: true as const, value: researchReportDecisionNotCapturedState() }
    : validateResearchReportDecisionState(value.researchReportDecision);
  if (!report.ok) {
    throw new Error(`persisted research-report decision binding failed validation: ${report.errors.join("; ")}`);
  }
  return {
    ...withConditional,
    researchReportDecision: report.value,
    formalDecision: value.formalDecision ?? formalDecisionNotCapturedState()
  };
}

function decisionSnapshotMatchesBinding(
  decision: PreTradeDecisionCheckData,
  binding: DecisionSnapshotBinding
): boolean {
  const validation = validateDecisionSnapshotState(decision.decisionSnapshot);
  if (!validation.ok || validation.value.availability !== "preserved" || !validation.value.snapshot) return false;
  const snapshot = validation.value.snapshot;
  if (snapshot.candidateSymbol !== decision.symbol
    || snapshot.decisionContext.contextId !== decision.contextId
    || snapshot.decisionContext.contextHash !== decision.contextHash) return false;
  const actual: DecisionSnapshotBinding = {
    schemaVersion: snapshot.schemaVersion,
    portfolioContext: {
      state: snapshot.portfolioContext.state,
      contextId: snapshot.portfolioContext.envelope?.contextId ?? null,
      portfolioSnapshotId: snapshot.portfolioContext.envelope?.portfolioSnapshotId ?? null,
      accountScopeId: snapshot.portfolioContext.envelope?.accountScopeId ?? null
    },
    riskImpact: {
      availability: snapshot.riskImpact.availability,
      impactId: snapshot.riskImpact.envelope?.impactId ?? null,
      calculationVersion: snapshot.riskImpact.envelope?.calculationVersion ?? null,
      contextId: snapshot.riskImpact.envelope?.contextId ?? null,
      portfolioSnapshotId: snapshot.riskImpact.envelope?.portfolioSnapshotId ?? null,
      candidateSymbol: snapshot.riskImpact.envelope?.candidateSymbol ?? null,
      hypotheticalAmount: snapshot.riskImpact.envelope?.hypotheticalAmount ?? null
    }
  };
  return canonicalJson(actual) === canonicalJson(binding);
}

function conditionalDecisionMatchesSubmission(
  decision: PreTradeDecisionCheckData,
  submission: AnnualConditionalDecisionSubmission
): boolean {
  const validation = validateAnnualConditionalDecisionState(decision.conditionalDecision);
  return validation.ok && validation.value.availability === "preserved"
    && canonicalJson(validation.value.preview) === canonicalJson(submission.preview)
    && canonicalJson(validation.value.judgment) === canonicalJson(submission.judgment);
}

function researchReportDecisionMatchesBinding(
  decision: PreTradeDecisionCheckData,
  binding: ResearchReportDecisionBinding
): boolean {
  const validation = validateResearchReportDecisionState(decision.researchReportDecision);
  return validation.ok && validation.value.availability === "preserved"
    && canonicalJson(validation.value.binding) === canonicalJson(binding);
}
