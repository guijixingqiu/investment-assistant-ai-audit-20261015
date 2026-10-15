import type { AnnualDecisionBriefEnvelope } from "./annualDecisionBrief.js";
import type { AnnualPortfolioLabEnvelope } from "./annualPortfolioLab.js";
import type { AnnualValuationQuantWorkbenchEnvelope } from "./annualValuationQuantWorkbench.js";
import {
  DECISION_SNAPSHOT_SCHEMA_VERSION,
  type DecisionSnapshotBinding
} from "./decisionSnapshotContract.js";

export const ANNUAL_CONDITIONAL_DECISION_SCHEMA_VERSION =
  "2026-07-17.annual-conditional-decision.v1";

export const ANNUAL_CONDITIONAL_DECISION_CONFIDENCE = ["low", "medium", "high"] as const;
export const ANNUAL_CONDITIONAL_WORKFLOW_STATES = [
  "continue_research",
  "await_condition",
  "judgment_formed",
  "stop_following"
] as const;
export const ANNUAL_CONDITIONAL_MONITOR_REASONS = [
  "candidate_facts_changed",
  "candidate_facts_unavailable",
  "decision_context_changed",
  "decision_context_unavailable",
  "valuation_facts_changed",
  "valuation_facts_unavailable",
  "quant_facts_changed",
  "quant_facts_unavailable",
  "portfolio_lab_quant_changed",
  "portfolio_lab_quant_unavailable",
  "portfolio_facts_changed",
  "portfolio_facts_unavailable",
  "risk_facts_changed",
  "risk_facts_unavailable",
  "portfolio_observation_met",
  "portfolio_observation_unavailable",
  "review_date_due",
  "observation_window_ended"
] as const;
export const ANNUAL_CONDITIONAL_PORTFOLIO_METRICS = [
  "scenario_candidate_weight",
  "scenario_largest_position_weight",
  "scenario_hhi"
] as const;
export const ANNUAL_CONDITIONAL_PORTFOLIO_COMPARISONS = ["at_or_above", "at_or_below"] as const;

export type AnnualConditionalDecisionConfidence =
  (typeof ANNUAL_CONDITIONAL_DECISION_CONFIDENCE)[number];
export type AnnualConditionalWorkflowState =
  (typeof ANNUAL_CONDITIONAL_WORKFLOW_STATES)[number];
export type AnnualConditionalMonitorReason =
  (typeof ANNUAL_CONDITIONAL_MONITOR_REASONS)[number];
export type AnnualConditionalPortfolioMetric =
  (typeof ANNUAL_CONDITIONAL_PORTFOLIO_METRICS)[number];
export type AnnualConditionalPortfolioComparison =
  (typeof ANNUAL_CONDITIONAL_PORTFOLIO_COMPARISONS)[number];

export interface AnnualConditionalPortfolioObservationCondition {
  metric: AnnualConditionalPortfolioMetric;
  comparison: AnnualConditionalPortfolioComparison;
  threshold: number;
  rationale: string;
  purpose: "human_review_trigger_only";
}

export interface AnnualConditionalDecisionPreviewData {
  decisionBrief: AnnualDecisionBriefEnvelope;
  valuationQuant: AnnualValuationQuantWorkbenchEnvelope;
  portfolioLab: AnnualPortfolioLabEnvelope;
  selectedPortfolioScenarioIndex: number;
}

export interface AnnualConditionalDecisionPreviewEnvelope {
  schemaVersion: typeof ANNUAL_CONDITIONAL_DECISION_SCHEMA_VERSION;
  generatedAt: string;
  status: "available" | "blocked" | "not_found" | "malformed" | "unauthorized" | "unavailable";
  previewId: string | null;
  membershipId: string;
  requestedActorId: string;
  requestedSymbol: string | null;
  data: AnnualConditionalDecisionPreviewData | null;
  safety: AnnualConditionalDecisionSafety;
  message: string;
}

export interface AnnualConditionalJudgment {
  confidence: AnnualConditionalDecisionConfidence;
  assumptions: string[];
  invalidationConditions: string[];
  portfolioObservationConditions: AnnualConditionalPortfolioObservationCondition[];
  observationWindow: {
    startsOn: string;
    endsOn: string;
  };
  reviewOn: string;
  workflowState: AnnualConditionalWorkflowState;
}

export interface AnnualConditionalDecisionSubmission {
  preview: AnnualConditionalDecisionPreviewEnvelope;
  judgment: AnnualConditionalJudgment;
}

export interface AnnualConditionalDecisionMonitor {
  evaluatedAt: string;
  state: "watching" | "human_review_required";
  reasons: AnnualConditionalMonitorReason[];
  changes: AnnualConditionalFactChange[];
  currentFacts: Omit<AnnualConditionalCurrentFacts, "evaluatedAt">;
  invalidationReminder: "human_observation_required";
  humanReviewRequested: boolean;
  automaticDecision: false;
  automaticWorkflowTransition: false;
  createsOrder: false;
  createsTrade: false;
  callsBroker: false;
}

export interface AnnualConditionalFactChange {
  reason: AnnualConditionalMonitorReason;
  field: string;
  frozenValue: string | null;
  currentValue: string | null;
  detail: string;
}

export interface AnnualConditionalDecisionSafety {
  advisoryOnly: true;
  humanJudgmentOnly: true;
  changesCandidateOrdering: false;
  recommendation: false;
  ranking: false;
  score: false;
  targetPrice: false;
  targetPosition: false;
  tradeDirection: false;
  suggestedAmount: false;
  automaticDecision: false;
  automaticWorkflowTransition: false;
  createsOrder: false;
  createsTrade: false;
  callsBroker: false;
  mutatesOfficialPortfolio: false;
  productionWrite: false;
}

export interface AnnualConditionalDecisionState {
  availability: "preserved" | "conditional_decision_not_captured";
  preview: AnnualConditionalDecisionPreviewEnvelope | null;
  judgment: AnnualConditionalJudgment | null;
  monitor: AnnualConditionalDecisionMonitor | null;
  limitation: string;
}

export interface AnnualConditionalCurrentFacts {
  evaluatedAt: string;
  membershipId: string | null;
  membershipVersion: number | null;
  membershipState: "tracked" | "paused" | "archived" | null;
  decisionContextId: string | null;
  decisionContextHash: string | null;
  valuationQuoteSnapshotId: string | null;
  valuationQuotePrice: number | null;
  valuationCalculationVersion: string | null;
  quantSnapshotId: string | null;
  quantSnapshotHash: string | null;
  quantModelVersion: string | null;
  quantCodeIdentity: string | null;
  portfolioLabQuantEvidenceId: string | null;
  portfolioContextId: string | null;
  portfolioSnapshotId: string | null;
  riskImpactId: string | null;
  scenarioCandidateWeight: number | null;
  scenarioLargestPositionWeight: number | null;
  scenarioHhi: number | null;
}

export function validateAnnualConditionalDecisionPreviewStructure(
  value: unknown
): { ok: true; value: AnnualConditionalDecisionPreviewEnvelope } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["conditional decision preview must be an object"] };
  exactKeys(value, [
    "schemaVersion", "generatedAt", "status", "previewId", "membershipId", "requestedActorId",
    "requestedSymbol", "data", "safety", "message"
  ], "conditional decision preview", errors);
  if (value.schemaVersion !== ANNUAL_CONDITIONAL_DECISION_SCHEMA_VERSION) errors.push("conditional decision preview schemaVersion is invalid");
  isoInstant(value.generatedAt, "conditional decision preview generatedAt", errors);
  if (!["available", "blocked", "not_found", "malformed", "unauthorized", "unavailable"].includes(String(value.status))) {
    errors.push("conditional decision preview status is invalid");
  }
  nonEmpty(value.membershipId, "conditional decision preview membershipId", errors);
  nonEmpty(value.requestedActorId, "conditional decision preview requestedActorId", errors);
  nullableString(value.requestedSymbol, "conditional decision preview requestedSymbol", errors);
  nullableString(value.previewId, "conditional decision preview previewId", errors);
  nonEmpty(value.message, "conditional decision preview message", errors);
  validateAnnualConditionalDecisionSafety(value.safety, errors);
  rejectForbiddenKeys(value, "conditional decision preview", errors);
  if (value.status === "available") validateAvailablePreview(value, errors);
  else if (value.data !== null || value.previewId !== null || value.requestedSymbol !== null) {
    errors.push("non-available conditional decision preview must clear data, previewId, and requestedSymbol");
  }
  return errors.length === 0
    ? { ok: true, value: value as unknown as AnnualConditionalDecisionPreviewEnvelope }
    : { ok: false, errors };
}

export function validateAnnualConditionalDecisionSubmissionStructure(
  value: unknown
): { ok: true; value: AnnualConditionalDecisionSubmission } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["conditionalDecision must be an object"] };
  exactKeys(value, ["preview", "judgment"], "conditionalDecision", errors);
  const preview = validateAnnualConditionalDecisionPreviewStructure(value.preview);
  if (!preview.ok) errors.push(...preview.errors);
  else if (preview.value.status !== "available") errors.push("conditionalDecision.preview must be available");
  validateAnnualConditionalJudgment(value.judgment, errors);
  return errors.length === 0
    ? { ok: true, value: value as unknown as AnnualConditionalDecisionSubmission }
    : { ok: false, errors };
}

export function validateAnnualConditionalDecisionStateStructure(
  value: unknown
): { ok: true; value: AnnualConditionalDecisionState } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["conditionalDecision must be an object"] };
  exactKeys(value, ["availability", "preview", "judgment", "monitor", "limitation"], "conditionalDecision", errors);
  nonEmpty(value.limitation, "conditionalDecision.limitation", errors);
  if (value.availability === "conditional_decision_not_captured") {
    if (value.preview !== null || value.judgment !== null || value.monitor !== null) {
      errors.push("conditional decision not captured state must not expose preview, judgment, or monitor facts");
    }
    if (typeof value.limitation !== "string" || !value.limitation.includes("not reconstructed")) {
      errors.push("conditional decision not captured limitation must disclose no reconstruction");
    }
  } else if (value.availability === "preserved") {
    const preview = validateAnnualConditionalDecisionPreviewStructure(value.preview);
    if (!preview.ok) errors.push(...preview.errors);
    else if (preview.value.status !== "available") errors.push("preserved conditional decision preview must be available");
    validateAnnualConditionalJudgment(value.judgment, errors);
    validateAnnualConditionalDecisionMonitor(value.monitor, errors);
    if (preview.ok && isRecord(value.judgment)
      && Array.isArray(value.judgment.portfolioObservationConditions)
      && isRecord(value.judgment.observationWindow)
      && isRecord(value.monitor) && isRecord(value.monitor.currentFacts)
      && typeof value.monitor.evaluatedAt === "string") {
      const expected = evaluateAnnualConditionalDecisionMonitor(
        preview.value,
        value.judgment as unknown as AnnualConditionalJudgment,
        {
          evaluatedAt: value.monitor.evaluatedAt,
          ...value.monitor.currentFacts
        } as unknown as AnnualConditionalCurrentFacts
      );
      if (!sameJsonValue(value.monitor, expected)) {
        errors.push("conditionalDecision.monitor must recompute from the frozen judgment and current fact identities");
      }
    }
  } else {
    errors.push("conditionalDecision.availability is invalid");
  }
  return errors.length === 0
    ? { ok: true, value: value as unknown as AnnualConditionalDecisionState }
    : { ok: false, errors };
}

export function annualConditionalDecisionSafety(): AnnualConditionalDecisionSafety {
  return {
    advisoryOnly: true,
    humanJudgmentOnly: true,
    changesCandidateOrdering: false,
    recommendation: false,
    ranking: false,
    score: false,
    targetPrice: false,
    targetPosition: false,
    tradeDirection: false,
    suggestedAmount: false,
    automaticDecision: false,
    automaticWorkflowTransition: false,
    createsOrder: false,
    createsTrade: false,
    callsBroker: false,
    mutatesOfficialPortfolio: false,
    productionWrite: false
  };
}

export function annualConditionalDecisionNotCapturedState(): AnnualConditionalDecisionState {
  return {
    availability: "conditional_decision_not_captured",
    preview: null,
    judgment: null,
    monitor: null,
    limitation: "This historical conditional decision was not captured and is not reconstructed from current candidate, research, valuation, quant, portfolio, or risk facts."
  };
}

export function conditionalDecisionSnapshotBindingFromPreview(
  preview: AnnualConditionalDecisionPreviewEnvelope
): DecisionSnapshotBinding | null {
  const lab = preview.data?.portfolioLab.data;
  const scenario = lab?.scenarios[preview.data?.selectedPortfolioScenarioIndex ?? -1];
  const portfolio = lab?.portfolio;
  const risk = scenario?.riskImpact;
  if (!portfolio || portfolio.status !== "available" || !portfolio.contextId
    || !portfolio.portfolioSnapshotId || !portfolio.accountScopeId
    || !risk || risk.status !== "available" || !risk.impactId || !risk.calculationVersion
    || !risk.contextId || !risk.portfolioSnapshotId || !risk.candidateSymbol
    || risk.hypotheticalAmount === null) return null;
  return {
    schemaVersion: DECISION_SNAPSHOT_SCHEMA_VERSION,
    portfolioContext: {
      state: "current",
      contextId: portfolio.contextId,
      portfolioSnapshotId: portfolio.portfolioSnapshotId,
      accountScopeId: portfolio.accountScopeId
    },
    riskImpact: {
      availability: "captured",
      impactId: risk.impactId,
      calculationVersion: risk.calculationVersion,
      contextId: risk.contextId,
      portfolioSnapshotId: risk.portfolioSnapshotId,
      candidateSymbol: risk.candidateSymbol,
      hypotheticalAmount: risk.hypotheticalAmount
    }
  };
}

export function evaluateAnnualConditionalDecisionMonitor(
  preview: AnnualConditionalDecisionPreviewEnvelope,
  judgment: AnnualConditionalJudgment,
  facts: AnnualConditionalCurrentFacts
): AnnualConditionalDecisionMonitor {
  const reasons: AnnualConditionalMonitorReason[] = [];
  const changes: AnnualConditionalFactChange[] = [];
  const identities = previewFactIdentities(preview);
  const addChange = (
    reason: AnnualConditionalMonitorReason,
    field: string,
    frozenValue: string | null,
    currentValue: string | null,
    detail: string
  ) => {
    if (!reasons.includes(reason)) reasons.push(reason);
    changes.push({ reason, field, frozenValue, currentValue, detail });
  };
  const compareIdentity = (
    field: string,
    frozenValue: string | null,
    currentValue: string | null,
    unavailableReason: AnnualConditionalMonitorReason,
    changedReason: AnnualConditionalMonitorReason
  ) => {
    if (currentValue === null) {
      addChange(
        unavailableReason, field, frozenValue, null,
        `${field} is unavailable in current facts; only a human review is requested and the saved judgment is unchanged.`
      );
    } else if (currentValue !== frozenValue) {
      addChange(
        changedReason, field, frozenValue, currentValue,
        `${field} changed from the frozen fact; only a human review is requested and the saved judgment is unchanged.`
      );
    }
  };
  compareIdentity("candidate", identities.candidate, candidateIdentity(facts), "candidate_facts_unavailable", "candidate_facts_changed");
  compareIdentity("decision_context", identities.decisionContext, decisionContextIdentity(facts), "decision_context_unavailable", "decision_context_changed");
  compareIdentity("valuation", identities.valuation, valuationIdentity(facts), "valuation_facts_unavailable", "valuation_facts_changed");
  compareIdentity("quant", identities.quant, quantIdentity(facts), "quant_facts_unavailable", "quant_facts_changed");
  compareIdentity(
    "portfolio_lab_quant", identities.portfolioLabQuant, facts.portfolioLabQuantEvidenceId,
    "portfolio_lab_quant_unavailable", "portfolio_lab_quant_changed"
  );
  compareIdentity("portfolio", identities.portfolio, portfolioIdentity(facts), "portfolio_facts_unavailable", "portfolio_facts_changed");
  compareIdentity("risk_impact", identities.riskImpactId, facts.riskImpactId, "risk_facts_unavailable", "risk_facts_changed");

  const today = facts.evaluatedAt.slice(0, 10);
  if (today >= judgment.observationWindow.startsOn && today <= judgment.observationWindow.endsOn) {
    for (const condition of judgment.portfolioObservationConditions) {
      const currentValue = portfolioMetricValue(condition.metric, facts);
      const thresholdIdentity = `${condition.comparison}:${condition.threshold}`;
      if (currentValue === null) {
        addChange(
          "portfolio_observation_unavailable", condition.metric, thresholdIdentity, null,
          `${condition.metric} is unavailable for the user-defined review threshold; no direction or workflow change is generated.`
        );
      } else if (condition.comparison === "at_or_above"
        ? currentValue >= condition.threshold
        : currentValue <= condition.threshold) {
        addChange(
          "portfolio_observation_met", condition.metric, thresholdIdentity, String(currentValue),
          `${condition.metric} met the user-defined human-review threshold; it is not a target position, recommendation, or trade direction.`
        );
      }
    }
  }
  if (today >= judgment.reviewOn) {
    addChange(
      "review_date_due", "review_on", judgment.reviewOn, today,
      "The user-defined review date is due; the saved judgment remains unchanged until human review."
    );
  }
  if (today >= judgment.observationWindow.endsOn) {
    addChange(
      "observation_window_ended", "observation_window_ends_on", judgment.observationWindow.endsOn, today,
      "The user-defined observation window ended; the saved judgment remains unchanged until human review."
    );
  }
  const { evaluatedAt: _evaluatedAt, ...currentFacts } = facts;
  return {
    evaluatedAt: facts.evaluatedAt,
    state: reasons.length === 0 ? "watching" : "human_review_required",
    reasons,
    changes,
    currentFacts,
    invalidationReminder: "human_observation_required",
    humanReviewRequested: reasons.length > 0,
    automaticDecision: false,
    automaticWorkflowTransition: false,
    createsOrder: false,
    createsTrade: false,
    callsBroker: false
  };
}

export function conditionalHumanCheckResult(
  workflowState: AnnualConditionalWorkflowState
): "ready_to_consider" | "blocked" | "needs_more_evidence" {
  if (workflowState === "judgment_formed") return "ready_to_consider";
  if (workflowState === "stop_following") return "blocked";
  return "needs_more_evidence";
}

function validateAvailablePreview(envelope: Record<string, unknown>, errors: string[]): void {
  if (!isRecord(envelope.data)) {
    errors.push("available conditional decision preview requires data");
    return;
  }
  if (typeof envelope.previewId !== "string" || !/^annual-conditional-preview:[a-f0-9]{64}$/.test(envelope.previewId)) {
    errors.push("available conditional decision preview requires a canonical previewId");
  }
  if (typeof envelope.requestedSymbol !== "string" || !/^HK\.\d{5}$/.test(envelope.requestedSymbol)) {
    errors.push("available conditional decision preview requires one canonical Hong Kong symbol");
  }
  exactKeys(envelope.data, ["decisionBrief", "valuationQuant", "portfolioLab", "selectedPortfolioScenarioIndex"], "conditional decision preview data", errors);
  const brief = recordAt(envelope.data, "decisionBrief");
  const valuation = recordAt(envelope.data, "valuationQuant");
  const lab = recordAt(envelope.data, "portfolioLab");
  if (!brief || !valuation || !lab) {
    errors.push("conditional decision preview requires decision brief, valuation quant, and portfolio lab envelopes");
    return;
  }
  validatePreviewSourceEnvelopes(envelope, brief, valuation, lab, errors);
  const briefData = recordAt(brief, "data");
  const valuationData = recordAt(valuation, "data");
  const labData = recordAt(lab, "data");
  validatePreviewTargets(envelope, briefData, valuationData, labData, errors);
  validatePreviewBriefFacts(briefData, errors);
  validatePreviewValuationFacts(valuationData, errors);
  validatePreviewPortfolioFacts(
    envelope,
    envelope.data.selectedPortfolioScenarioIndex,
    labData,
    errors
  );
  validatePreviewCrossSourceIdentities(briefData, valuationData, labData, errors);
}

function validatePreviewSourceEnvelopes(
  envelope: Record<string, unknown>,
  brief: Record<string, unknown>,
  valuation: Record<string, unknown>,
  lab: Record<string, unknown>,
  errors: string[]
): void {
  if (brief.status !== "available" || valuation.status !== "available" || lab.status !== "available") {
    errors.push("conditional decision preview source envelopes must all be available");
  }
  for (const source of [brief, valuation, lab]) {
    if (source.membershipId !== envelope.membershipId || source.requestedActorId !== envelope.requestedActorId
      || source.requestedSymbol !== envelope.requestedSymbol) {
      errors.push("conditional decision preview source envelope identities must match");
    }
  }
}

function validatePreviewTargets(
  envelope: Record<string, unknown>,
  briefData: Record<string, unknown> | null,
  valuationData: Record<string, unknown> | null,
  labData: Record<string, unknown> | null,
  errors: string[]
): void {
  const briefTarget = recordAt(briefData, "target");
  const valuationTarget = recordAt(valuationData, "target");
  const labTarget = recordAt(labData, "target");
  if (![briefTarget, valuationTarget, labTarget].every((target) => target
    && target.membershipId === envelope.membershipId
    && target.symbol === envelope.requestedSymbol
    && target.membershipVersion === briefTarget?.membershipVersion)) {
    errors.push("conditional decision preview must bind one candidate membership version and symbol");
  }
  if (![briefTarget, valuationTarget, labTarget].every((target) => target?.membershipState === "tracked")) {
    errors.push("conditional decision preview requires one tracked candidate lifecycle across every source");
  }
}

function validatePreviewBriefFacts(briefData: Record<string, unknown> | null, errors: string[]): void {
  const briefReadiness = recordAt(briefData, "readiness");
  if (briefReadiness?.state !== "ready_for_three_minute_review") errors.push("conditional decision preview requires a ready decision brief");
  const evidence = recordAt(briefData, "evidence");
  if (!evidence || !Array.isArray(evidence.support) || evidence.support.length === 0
    || ((!Array.isArray(evidence.counter) || evidence.counter.length === 0)
      && (!Array.isArray(evidence.gaps) || evidence.gaps.length === 0))) {
    errors.push("conditional decision preview requires supporting evidence plus counter evidence or an explicit gap");
  }
}

function validatePreviewValuationFacts(valuationData: Record<string, unknown> | null, errors: string[]): void {
  const valuationFacts = recordAt(valuationData, "valuation");
  const quantFacts = recordAt(valuationData, "quant");
  if (valuationFacts?.status !== "available" || quantFacts?.status !== "available") {
    errors.push("conditional decision preview requires available valuation and canonical quant evidence");
  }
}

function validatePreviewPortfolioFacts(
  envelope: Record<string, unknown>,
  selectedPortfolioScenarioIndex: unknown,
  labData: Record<string, unknown> | null,
  errors: string[]
): void {
  const scenarios = Array.isArray(labData?.scenarios) ? labData.scenarios : [];
  if (!Number.isInteger(selectedPortfolioScenarioIndex)
    || Number(selectedPortfolioScenarioIndex) < 0
    || Number(selectedPortfolioScenarioIndex) >= scenarios.length) {
    errors.push("conditional decision preview selected portfolio scenario index is invalid");
  }
  const scenario = scenarios[Number(selectedPortfolioScenarioIndex)];
  const risk = recordAt(scenario, "riskImpact");
  if (!isRecord(scenario) || typeof scenario.scenarioId !== "string" || risk?.status !== "available"
    || typeof risk.impactId !== "string") {
    errors.push("conditional decision preview requires one available bound portfolio risk scenario");
  }
  const labSource = recordAt(labData, "sourceIdentity");
  if (risk && labSource && (risk.contextId !== labSource.portfolioContextId
    || risk.portfolioSnapshotId !== labSource.portfolioSnapshotId
    || risk.candidateSymbol !== envelope.requestedSymbol)) {
    errors.push("conditional decision preview portfolio and risk identities must match");
  }
}

function validatePreviewCrossSourceIdentities(
  briefData: Record<string, unknown> | null,
  valuationData: Record<string, unknown> | null,
  labData: Record<string, unknown> | null,
  errors: string[]
): void {
  const briefSource = recordAt(briefData, "sourceIdentity");
  const valuationSource = recordAt(valuationData, "sourceIdentity");
  const labSource = recordAt(labData, "sourceIdentity");
  if (!briefSource || !valuationSource || !labSource
    || briefSource.decisionContextId !== valuationSource.decisionContextId
    || briefSource.decisionContextHash !== valuationSource.decisionContextHash
    || briefSource.decisionContextId !== labSource.decisionContextId
    || briefSource.decisionContextHash !== labSource.decisionContextHash) {
    errors.push("conditional decision preview decision context identities must match across every source");
  }
}

function validateAnnualConditionalJudgment(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("conditionalDecision.judgment must be an object");
    return;
  }
  exactKeys(value, [
    "confidence", "assumptions", "invalidationConditions", "portfolioObservationConditions",
    "observationWindow", "reviewOn", "workflowState"
  ], "conditionalDecision.judgment", errors);
  if (!ANNUAL_CONDITIONAL_DECISION_CONFIDENCE.includes(value.confidence as AnnualConditionalDecisionConfidence)) errors.push("conditional judgment confidence is invalid");
  boundedStrings(value.assumptions, "conditional judgment assumptions", 20, errors);
  boundedStrings(value.invalidationConditions, "conditional judgment invalidationConditions", 20, errors);
  validatePortfolioObservationConditions(value.portfolioObservationConditions, errors);
  if (!isRecord(value.observationWindow)) errors.push("conditional judgment observationWindow must be an object");
  else {
    exactKeys(value.observationWindow, ["startsOn", "endsOn"], "conditional judgment observationWindow", errors);
    calendarDate(value.observationWindow.startsOn, "conditional judgment observationWindow.startsOn", errors);
    calendarDate(value.observationWindow.endsOn, "conditional judgment observationWindow.endsOn", errors);
    if (typeof value.observationWindow.startsOn === "string" && typeof value.observationWindow.endsOn === "string"
      && value.observationWindow.startsOn > value.observationWindow.endsOn) errors.push("conditional judgment observation window is reversed");
  }
  calendarDate(value.reviewOn, "conditional judgment reviewOn", errors);
  if (isRecord(value.observationWindow) && typeof value.reviewOn === "string"
    && typeof value.observationWindow.startsOn === "string" && typeof value.observationWindow.endsOn === "string"
    && (value.reviewOn < value.observationWindow.startsOn || value.reviewOn > value.observationWindow.endsOn)) {
    errors.push("conditional judgment reviewOn must fall inside the observation window");
  }
  if (!ANNUAL_CONDITIONAL_WORKFLOW_STATES.includes(value.workflowState as AnnualConditionalWorkflowState)) errors.push("conditional judgment workflowState is invalid");
  rejectForbiddenKeys(value, "conditional judgment", errors);
}

function validateAnnualConditionalDecisionMonitor(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("conditionalDecision.monitor must be an object");
    return;
  }
  exactKeys(value, [
    "evaluatedAt", "state", "reasons", "changes", "currentFacts", "invalidationReminder", "humanReviewRequested",
    "automaticDecision", "automaticWorkflowTransition", "createsOrder", "createsTrade", "callsBroker"
  ], "conditionalDecision.monitor", errors);
  isoInstant(value.evaluatedAt, "conditionalDecision.monitor.evaluatedAt", errors);
  if (value.state !== "watching" && value.state !== "human_review_required") errors.push("conditional decision monitor state is invalid");
  if (!Array.isArray(value.reasons) || value.reasons.some((reason) => !ANNUAL_CONDITIONAL_MONITOR_REASONS.includes(reason as AnnualConditionalMonitorReason))
    || new Set(value.reasons).size !== value.reasons.length) errors.push("conditional decision monitor reasons are invalid");
  if (value.state === "watching" && (Array.isArray(value.reasons) && value.reasons.length !== 0 || value.humanReviewRequested !== false)) errors.push("watching monitor cannot request a review");
  if (value.state === "human_review_required" && (Array.isArray(value.reasons) && value.reasons.length === 0 || value.humanReviewRequested !== true)) errors.push("review-required monitor needs reasons and a human review request");
  if (!Array.isArray(value.changes) || value.changes.length > 50) {
    errors.push("conditional decision monitor changes must be a bounded array");
  } else {
    value.changes.forEach((change, index) => validateMonitorChange(change, index, errors));
  }
  if (!isRecord(value.currentFacts)) errors.push("conditional decision monitor currentFacts must be an object");
  else {
    const currentFacts = value.currentFacts;
    const stringFields = [
      "membershipId", "membershipState", "decisionContextId", "decisionContextHash",
      "valuationQuoteSnapshotId", "valuationCalculationVersion", "quantSnapshotId", "quantSnapshotHash",
      "quantModelVersion", "quantCodeIdentity", "portfolioLabQuantEvidenceId", "portfolioContextId",
      "portfolioSnapshotId", "riskImpactId"
    ];
    const numberFields = ["scenarioCandidateWeight", "scenarioLargestPositionWeight", "scenarioHhi"];
    exactKeys(currentFacts, ["membershipVersion", "valuationQuotePrice", ...stringFields, ...numberFields], "conditionalDecision.monitor.currentFacts", errors);
    for (const field of stringFields) nullableString(currentFacts[field], `conditionalDecision.monitor.currentFacts.${field}`, errors);
    if (currentFacts.membershipVersion !== null
      && (!Number.isInteger(currentFacts.membershipVersion) || Number(currentFacts.membershipVersion) < 1)) {
      errors.push("conditionalDecision.monitor.currentFacts.membershipVersion must be null or a positive integer");
    }
    if (currentFacts.membershipState !== null
      && !["tracked", "paused", "archived"].includes(String(currentFacts.membershipState))) {
      errors.push("conditionalDecision.monitor.currentFacts.membershipState is invalid");
    }
    if (currentFacts.valuationQuotePrice !== null
      && (typeof currentFacts.valuationQuotePrice !== "number"
        || !Number.isFinite(currentFacts.valuationQuotePrice)
        || currentFacts.valuationQuotePrice <= 0)) {
      errors.push("conditionalDecision.monitor.currentFacts.valuationQuotePrice must be null or a finite positive number");
    }
    for (const field of numberFields) unitIntervalOrNull(
      currentFacts[field], `conditionalDecision.monitor.currentFacts.${field}`, errors
    );
    for (const [label, fields] of [
      ["candidate", ["membershipId", "membershipVersion", "membershipState"]],
      ["decision context", ["decisionContextId", "decisionContextHash"]],
      ["valuation", ["valuationQuoteSnapshotId", "valuationQuotePrice", "valuationCalculationVersion"]],
      ["quant", ["quantSnapshotId", "quantSnapshotHash", "quantModelVersion", "quantCodeIdentity"]],
      ["portfolio", ["portfolioContextId", "portfolioSnapshotId"]],
      ["risk", ["riskImpactId", "scenarioCandidateWeight", "scenarioLargestPositionWeight", "scenarioHhi"]]
    ] as const) {
      const present = fields.filter((field) => currentFacts[field] !== null).length;
      if (present !== 0 && present !== fields.length) {
        errors.push(`conditionalDecision.monitor.currentFacts ${label} identity must be complete or unavailable`);
      }
    }
  }
  if (value.invalidationReminder !== "human_observation_required") errors.push("conditional decision invalidation reminder must require human observation");
  for (const field of ["automaticDecision", "automaticWorkflowTransition", "createsOrder", "createsTrade", "callsBroker"]) {
    if (value[field] !== false) errors.push(`conditionalDecision.monitor.${field} must be false`);
  }
}

function validateAnnualConditionalDecisionSafety(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("conditional decision safety must be an object");
    return;
  }
  const keys = [
    "advisoryOnly", "humanJudgmentOnly", "changesCandidateOrdering", "recommendation", "ranking", "score",
    "targetPrice", "targetPosition", "tradeDirection", "suggestedAmount", "automaticDecision",
    "automaticWorkflowTransition", "createsOrder", "createsTrade", "callsBroker", "mutatesOfficialPortfolio", "productionWrite"
  ];
  exactKeys(value, keys, "conditional decision safety", errors);
  if (value.advisoryOnly !== true || value.humanJudgmentOnly !== true) errors.push("conditional decision must remain human-judgment advisory only");
  for (const key of keys.slice(2)) if (value[key] !== false) errors.push(`conditional decision safety.${key} must be false`);
}

function previewFactIdentities(preview: AnnualConditionalDecisionPreviewEnvelope) {
  const target = preview.data?.decisionBrief.data?.target;
  const brief = preview.data?.decisionBrief.data?.sourceIdentity;
  const valuation = preview.data?.valuationQuant.data?.valuation;
  const quant = preview.data?.valuationQuant.data?.quant;
  const lab = preview.data?.portfolioLab.data?.sourceIdentity;
  const labQuant = preview.data?.portfolioLab.data?.quant;
  const scenario = preview.data?.portfolioLab.data?.scenarios[preview.data?.selectedPortfolioScenarioIndex ?? -1];
  return {
    candidate: joinedIdentity([target?.membershipId, target?.membershipVersion, target?.membershipState]),
    decisionContext: joinedIdentity([brief?.decisionContextId, brief?.decisionContextHash]),
    valuation: joinedIdentity([
      valuation?.quote?.snapshotId,
      valuation?.quote?.price,
      valuation?.method.calculationVersion
    ]),
    quant: joinedIdentity([
      quant?.model.snapshotId,
      quant?.model.snapshotHash,
      quant?.model.modelVersion,
      quant?.model.codeIdentity
    ]),
    portfolioLabQuant: labQuant?.evidence?.evidenceId ?? null,
    portfolio: joinedIdentity([lab?.portfolioContextId, lab?.portfolioSnapshotId]),
    riskImpactId: scenario?.riskImpact.impactId ?? null
  };
}

function candidateIdentity(facts: AnnualConditionalCurrentFacts): string | null {
  return joinedIdentity([facts.membershipId, facts.membershipVersion, facts.membershipState]);
}

function decisionContextIdentity(facts: AnnualConditionalCurrentFacts): string | null {
  return joinedIdentity([facts.decisionContextId, facts.decisionContextHash]);
}

function valuationIdentity(facts: AnnualConditionalCurrentFacts): string | null {
  return joinedIdentity([
    facts.valuationQuoteSnapshotId,
    facts.valuationQuotePrice,
    facts.valuationCalculationVersion
  ]);
}

function quantIdentity(facts: AnnualConditionalCurrentFacts): string | null {
  return joinedIdentity([
    facts.quantSnapshotId,
    facts.quantSnapshotHash,
    facts.quantModelVersion,
    facts.quantCodeIdentity
  ]);
}

function portfolioIdentity(facts: AnnualConditionalCurrentFacts): string | null {
  return joinedIdentity([facts.portfolioContextId, facts.portfolioSnapshotId]);
}

function joinedIdentity(values: Array<string | number | null | undefined>): string | null {
  return values.some((value) => value === null || value === undefined || String(value).trim().length === 0)
    ? null
    : values.map(String).join("|");
}

function portfolioMetricValue(
  metric: AnnualConditionalPortfolioMetric,
  facts: AnnualConditionalCurrentFacts
): number | null {
  if (metric === "scenario_candidate_weight") return facts.scenarioCandidateWeight;
  if (metric === "scenario_largest_position_weight") return facts.scenarioLargestPositionWeight;
  return facts.scenarioHhi;
}

function exactKeys(value: Record<string, unknown>, allowed: string[], label: string, errors: string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${label} contains unsupported field ${key}`);
  for (const key of allowed) if (!(key in value)) errors.push(`${label} is missing field ${key}`);
}

function validatePortfolioObservationConditions(value: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    errors.push("conditional judgment portfolioObservationConditions must contain 1 to 10 user-defined review triggers");
    return;
  }
  const identities = new Set<string>();
  value.forEach((condition, index) => {
    if (!isRecord(condition)) {
      errors.push(`conditional judgment portfolio observation ${index} must be an object`);
      return;
    }
    exactKeys(
      condition,
      ["metric", "comparison", "threshold", "rationale", "purpose"],
      `conditional judgment portfolio observation ${index}`,
      errors
    );
    if (!ANNUAL_CONDITIONAL_PORTFOLIO_METRICS.includes(condition.metric as AnnualConditionalPortfolioMetric)) {
      errors.push(`conditional judgment portfolio observation ${index} metric is invalid`);
    }
    if (!ANNUAL_CONDITIONAL_PORTFOLIO_COMPARISONS.includes(condition.comparison as AnnualConditionalPortfolioComparison)) {
      errors.push(`conditional judgment portfolio observation ${index} comparison is invalid`);
    }
    unitInterval(condition.threshold, `conditional judgment portfolio observation ${index} threshold`, errors);
    if (typeof condition.rationale !== "string" || condition.rationale !== condition.rationale.trim()
      || condition.rationale.length < 1 || condition.rationale.length > 500) {
      errors.push(`conditional judgment portfolio observation ${index} rationale must be bounded trimmed text`);
    }
    if (condition.purpose !== "human_review_trigger_only") {
      errors.push(`conditional judgment portfolio observation ${index} must remain a human-review trigger only`);
    }
    const identity = `${condition.metric}|${condition.comparison}|${condition.threshold}`;
    if (identities.has(identity)) errors.push("conditional judgment portfolio observations must be unique");
    identities.add(identity);
    rejectForbiddenKeys(condition, `conditional judgment portfolio observation ${index}`, errors);
  });
}

function validateMonitorChange(value: unknown, index: number, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`conditional decision monitor change ${index} must be an object`);
    return;
  }
  exactKeys(value, ["reason", "field", "frozenValue", "currentValue", "detail"], `conditional decision monitor change ${index}`, errors);
  if (!ANNUAL_CONDITIONAL_MONITOR_REASONS.includes(value.reason as AnnualConditionalMonitorReason)) {
    errors.push(`conditional decision monitor change ${index} reason is invalid`);
  }
  nonEmpty(value.field, `conditional decision monitor change ${index} field`, errors);
  nullableString(value.frozenValue, `conditional decision monitor change ${index} frozenValue`, errors);
  nullableString(value.currentValue, `conditional decision monitor change ${index} currentValue`, errors);
  if (typeof value.detail !== "string" || value.detail !== value.detail.trim()
    || value.detail.length < 1 || value.detail.length > 1_000) {
    errors.push(`conditional decision monitor change ${index} detail must be bounded trimmed text`);
  }
  rejectForbiddenKeys(value, `conditional decision monitor change ${index}`, errors);
}

function unitInterval(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    errors.push(`${label} must be a finite number from 0 through 1`);
  }
}

function unitIntervalOrNull(value: unknown, label: string, errors: string[]): void {
  if (value !== null) unitInterval(value, label, errors);
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((item, index) => sameJsonValue(item, right[index]));
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && sameJsonValue(left[key], right[key]));
  }
  return false;
}

function boundedStrings(value: unknown, label: string, max: number, errors: string[]): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > max
    || !value.every((item) => typeof item === "string" && item === item.trim() && item.length > 0 && item.length <= 1_000)
    || new Set(value).size !== value.length) errors.push(`${label} must contain bounded unique trimmed strings`);
}

function calendarDate(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.push(`${label} must be YYYY-MM-DD`);
    return;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    errors.push(`${label} must be YYYY-MM-DD`);
  }
}

function isoInstant(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) errors.push(`${label} must be an ISO date-time`);
}

function nullableString(value: unknown, label: string, errors: string[]): void {
  if (value !== null && (typeof value !== "string" || value.trim().length === 0)) errors.push(`${label} must be null or a non-empty string`);
}

function nonEmpty(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${label} must be a non-empty string`);
}

function rejectForbiddenKeys(value: unknown, label: string, errors: string[], depth = 0): void {
  if (depth > 24 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => rejectForbiddenKeys(item, label, errors, depth + 1));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (["recommendedAction", "rankingScore", "suggestedPosition", "orderRequest", "brokerAccount", "automaticTransition"].includes(key)) errors.push(`${label} contains forbidden field ${key}`);
    rejectForbiddenKeys(child, label, errors, depth + 1);
  }
}

function recordAt(value: unknown, key: string): Record<string, unknown> | null {
  return isRecord(value) && isRecord(value[key]) ? value[key] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
