import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import { researchReportDecisionNotCapturedState } from "../../../../packages/contracts/src/researchReportDecision.js";
import { formalDecisionNotCapturedState } from "../../../../packages/contracts/src/formalDecision.js";
import { readDecisionReviewDueOn } from "./decisionReviewMappers.js";
import type { DecisionActionIntent } from "../../../../packages/contracts/src/research.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import {
  validateTodayDecisionEvidence,
  type TodayDecisionEvidence
} from "./todayReviewDueDecisionEvidence.js";

export interface TodayAuditProjection {
  audit_count: number | string;
  actor_audit_count: number | string;
  audit_actor_type: "user" | "system";
  audit_actor_id: string;
  audit_stock_id: string;
  audit_market: string;
  audit_code: string;
  audit_symbol: string;
  audit_event_type: string;
  audit_target_table: string;
  audit_target_id: string;
  audit_after_payload: unknown;
  audit_created_at: Date | string;
}

export interface DecisionProjectionRow extends TodayAuditProjection {
  id: string;
  stock_id: string;
  market: string;
  code: string;
  symbol: string;
  checked_at: Date | string;
  action_intent: DecisionActionIntent;
  user_final_decision: string | null;
  raw_payload: unknown;
  decision_context_snapshot: unknown;
  decision_snapshot: unknown;
}

export function assertTodayDecision(
  row: DecisionProjectionRow,
  market: string,
  code: string,
  symbol: string,
  actor: AuthenticatedResearchActor,
  now: Date
): TodayDecisionEvidence {
  if (row.market !== market || row.code !== code || row.symbol !== symbol || !isPositiveId(row.id)) {
    throw new Error("decision identity does not match the requested symbol");
  }
  if (Number(row.audit_count) !== 1 || Number(row.actor_audit_count) !== 1
    || row.audit_actor_type !== actor.actorType || row.audit_actor_id !== actor.actorId) {
    throw new Error("decision audit identity is missing, duplicated, or mismatched");
  }
  const evidence = validateTodayDecisionEvidence(row, symbol);
  const checkedAt = timestamp(row.checked_at, "checkedAt");
  const contextGeneratedAt = timestamp(evidence.context.generatedAt, "context generatedAt");
  const snapshotCapturedAt = timestamp(evidence.snapshot.capturedAt, "decision snapshot capturedAt");
  const auditAt = timestamp(row.audit_created_at, "decision audit createdAt");
  if (contextGeneratedAt > snapshotCapturedAt || snapshotCapturedAt > checkedAt
    || checkedAt > auditAt || auditAt > now.getTime()) {
    throw new Error("decision or audit chronology is invalid");
  }
  const audit = record(row.audit_after_payload, "decision audit afterPayload");
  if (readDecisionReviewDueOn(row.raw_payload, audit) !== evidence.reviewDueOn)
    throw new Error("decision reviewDueOn does not match its audited source");
  const raw = record(row.raw_payload, "decision raw payload");
  const hasManualSources = Object.hasOwn(raw, "manualSourceBindings");
  if (hasManualSources !== Object.hasOwn(audit, "manualSourceBindings")
    || (hasManualSources && canonicalJson(raw.manualSourceBindings) !== canonicalJson(audit.manualSourceBindings)))
    throw new Error("decision manual source bindings differ between raw payload and audit");
  if (String(row.audit_stock_id) !== String(row.stock_id)
    || row.audit_market !== market || row.audit_code !== code || row.audit_symbol !== symbol
    || row.audit_event_type !== "decision_check_created"
    || row.audit_target_table !== "pre_trade_decision_checks"
    || String(row.audit_target_id) !== String(row.id)
    || String(audit.id) !== String(row.id)
    || audit.market !== market || audit.code !== code || audit.symbol !== symbol
    || canonicalInstantValue(audit.checkedAt, "decision audit checkedAt") !== canonicalInstant(row.checked_at, "checkedAt")
    || audit.contextId !== evidence.context.contextId
    || audit.contextHash !== evidence.context.contextHash
    || audit.actionIntent !== row.action_intent
    || audit.humanCheckResult !== evidence.humanCheckResult
    || (audit.userFinalDecision ?? null) !== row.user_final_decision
    || canonicalJson(audit.decisionSnapshot) !== canonicalJson(row.decision_snapshot)
    || (!evidence.legacyReportBinding && !Object.hasOwn(audit, "researchReportDecision"))
    || canonicalJson(audit.researchReportDecision ?? researchReportDecisionNotCapturedState())
      !== canonicalJson(evidence.reportDecision)
    || canonicalJson(audit.formalDecision ?? formalDecisionNotCapturedState())
      !== canonicalJson(evidence.formalDecision)) {
    throw new Error("decision audit does not exactly bind the persisted decision");
  }
  return evidence;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function canonicalInstant(value: Date | string, field: string): string {
  return new Date(timestamp(value, field)).toISOString();
}

function canonicalInstantValue(value: unknown, field: string): string {
  if (!(typeof value === "string" || value instanceof Date)) throw new Error(`${field} is invalid`);
  return canonicalInstant(value, field);
}

function timestamp(value: Date | string, field: string): number {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`${field} is invalid`);
  return milliseconds;
}

function isPositiveId(value: unknown): boolean {
  return /^[1-9]\d*$/.test(String(value));
}
