import {
  computeDecisionContextHash,
  DECISION_CHECK_SCHEMA_VERSION,
  DECISION_CONTEXT_SCHEMA_VERSION,
  decisionContextHashInputFromEnvelope,
  validateManualDecisionSourceBindings,
  validateOrdinaryResearchChangeBinding,
  validateDecisionContextEnvelope,
  type DecisionContextEnvelope
} from "../../../../packages/contracts/src/decisionContext.js";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import { validateDecisionSnapshotState, type DecisionSnapshotState } from "../../../../packages/contracts/src/decisionSnapshot.js";
import {
  researchReportDecisionNotCapturedState,
  validateResearchReportDecisionState,
  type ResearchReportDecisionState
} from "../../../../packages/contracts/src/researchReportDecision.js";
import { hasFixtureDecisionContextEvidence } from "./decisionContextFixtureGuard.js";
import { readDecisionReviewDueOn } from "./decisionReviewMappers.js";
import {
  formalDecisionNotCapturedState,
  validateFormalDecisionState,
  type FormalDecisionState
} from "../../../../packages/contracts/src/formalDecision.js";

export interface TodayDecisionEvidence {
  context: DecisionContextEnvelope;
  snapshot: NonNullable<DecisionSnapshotState["snapshot"]>;
  reportDecision: ResearchReportDecisionState;
  formalDecision: FormalDecisionState;
  legacyReportBinding: boolean;
  humanCheckResult: "ready_to_consider" | "blocked" | "needs_more_evidence";
  reviewDueOn?: string;
}

export function validateTodayDecisionEvidence(
  value: { raw_payload: unknown; decision_context_snapshot: unknown; decision_snapshot: unknown;
    audit_after_payload?: unknown; checked_at?: Date | string },
  symbol: string
): TodayDecisionEvidence {
  const raw = record(value.raw_payload, "decision raw payload");
  const expectedRawKeys = [
    "source", "decisionContextSchemaVersion", "decisionCheckSchemaVersion", "contextId", "contextHash",
    "humanCheckResult", "advisoryOnly", "noOrder", "noTrade", "noCashMutation", "noFeeWrite",
    "noPositionMutation", "noBrokerCall", "conditionalDecision"
  ];
  const legacyReportBinding = !Object.hasOwn(raw, "researchReportDecision");
  const legacyFormalDecision = !Object.hasOwn(raw, "formalDecision");
  const optionalKeys = [
    ...legacyReportBinding ? [] : ["researchReportDecision"],
    ...legacyFormalDecision ? [] : ["formalDecision"],
    ...Object.hasOwn(raw, "reviewDueOn") ? ["reviewDueOn"] : [],
    ...Object.hasOwn(raw, "manualSourceBindings") ? ["manualSourceBindings"] : [],
    ...Object.hasOwn(raw, "researchChangeBinding") ? ["researchChangeBinding"] : []
  ];
  if (!hasExactKeys(raw, [...expectedRawKeys, ...optionalKeys])
    || raw.source !== "production-write-api"
    || raw.decisionContextSchemaVersion !== DECISION_CONTEXT_SCHEMA_VERSION
    || raw.decisionCheckSchemaVersion !== DECISION_CHECK_SCHEMA_VERSION
    || !["ready_to_consider", "blocked", "needs_more_evidence"].includes(String(raw.humanCheckResult))
    || raw.advisoryOnly !== true
    || ["noOrder", "noTrade", "noCashMutation", "noFeeWrite", "noPositionMutation", "noBrokerCall"]
      .some((field) => raw[field] !== true)) {
    throw new Error("decision raw payload is not the current production-write-api shape");
  }
  const reportValidation = legacyReportBinding
    ? { ok: true as const, value: researchReportDecisionNotCapturedState() }
    : validateResearchReportDecisionState(raw.researchReportDecision);
  if (!reportValidation.ok) {
    throw new Error(`decision research-report binding failed validation: ${reportValidation.errors.join("; ")}`);
  }
  const formalValidation = legacyFormalDecision
    ? { ok: true as const, value: formalDecisionNotCapturedState() }
    : validateFormalDecisionState(raw.formalDecision);
  if (!formalValidation.ok) {
    throw new Error(`decision formal-decision binding failed validation: ${formalValidation.errors.join("; ")}`);
  }
  const reviewDueOn = readDecisionReviewDueOn(raw);
  if (reviewDueOn && (reportValidation.value.availability === "preserved"
    || formalValidation.value.availability === "preserved"
    || raw.conditionalDecision !== null))
    throw new Error("ordinary reviewDueOn cannot attach to a bound decision");
  if (Object.hasOwn(raw, "manualSourceBindings")) {
    const errors: string[] = [];
    validateManualDecisionSourceBindings(raw.manualSourceBindings, "decision raw payload.manualSourceBindings", errors);
    if (errors.length) throw new Error(errors.join("; "));
    if (reportValidation.value.availability === "preserved"
      || formalValidation.value.availability === "preserved"
      || raw.conditionalDecision !== null)
      throw new Error("manual source bindings require an ordinary unbound decision");
  }
  if (Object.hasOwn(raw, "researchChangeBinding")) {
    const errors: string[] = [];
    validateOrdinaryResearchChangeBinding(raw.researchChangeBinding,
      "decision raw payload.researchChangeBinding", errors);
    if (errors.length) throw new Error(errors.join("; "));
    const binding = raw.researchChangeBinding as { symbol: string; sourcePublishedAt: string };
    if (binding.symbol !== symbol
      || reportValidation.value.availability === "preserved"
      || formalValidation.value.availability === "preserved"
      || raw.conditionalDecision !== null
      || (value.checked_at !== undefined
        && Date.parse(binding.sourcePublishedAt) > new Date(value.checked_at).getTime()))
      throw new Error("decision research change binding is not an ordinary same-company judgment");
    if (value.audit_after_payload !== undefined) {
      const audit = record(value.audit_after_payload, "decision audit afterPayload");
      if (canonicalJson(raw.researchChangeBinding) !== canonicalJson(audit.researchChangeBinding ?? null))
        throw new Error("decision research change binding differs between raw payload and audit");
    }
  } else if (value.audit_after_payload !== undefined) {
    const audit = record(value.audit_after_payload, "decision audit afterPayload");
    if (Object.hasOwn(audit, "researchChangeBinding"))
      throw new Error("decision audit has an unmatched research change binding");
  }
  const contextValidation = validateDecisionContextEnvelope(value.decision_context_snapshot);
  if (!contextValidation.ok) {
    throw new Error(`decision context snapshot failed validation: ${contextValidation.errors.join("; ")}`);
  }
  const context = value.decision_context_snapshot as DecisionContextEnvelope;
  const contextHash = computeDecisionContextHash(decisionContextHashInputFromEnvelope(context));
  if (context.requestedSymbol !== symbol || context.contextHash !== contextHash
    || context.contextId !== `decision-context:${symbol}:${contextHash.slice(0, 16)}`
    || raw.contextId !== context.contextId || raw.contextHash !== context.contextHash) {
    throw new Error("decision raw payload and canonical context identity do not match");
  }
  if (hasFixtureDecisionContextEvidence(context)) {
    throw new Error("fixture decision context cannot project a formal Today event");
  }
  const snapshotValidation = validateDecisionSnapshotState(value.decision_snapshot);
  if (!snapshotValidation.ok || snapshotValidation.value.availability !== "preserved"
    || snapshotValidation.value.snapshot === null) {
    const errors = snapshotValidation.ok ? ["decision snapshot is not preserved"] : snapshotValidation.errors;
    throw new Error(`decision snapshot failed validation: ${errors.join("; ")}`);
  }
  const snapshot = (snapshotValidation.value as DecisionSnapshotState).snapshot!;
  if (snapshot.candidateSymbol !== symbol || snapshot.decisionContext.contextId !== context.contextId
    || snapshot.decisionContext.contextHash !== context.contextHash
    || canonicalJson(snapshot.decisionContext) !== canonicalJson(context)) {
    throw new Error("preserved decision snapshot is not exactly bound to the non-fixture context");
  }
  return {
    context, snapshot, reportDecision: reportValidation.value,
    formalDecision: formalValidation.value,
    legacyReportBinding,
    humanCheckResult: raw.humanCheckResult as TodayDecisionEvidence["humanCheckResult"],
    ...(reviewDueOn === undefined ? {} : { reviewDueOn })
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  expected = [...expected].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
