import type { Pool, PoolClient } from "pg";
import {
  ANNUAL_CONDITIONAL_DECISION_SCHEMA_VERSION,
  annualConditionalDecisionSafety,
  computeAnnualConditionalDecisionPreviewId,
  conditionalDecisionSnapshotBindingFromPreview,
  evaluateAnnualConditionalDecisionMonitor,
  validateAnnualConditionalDecisionPreviewEnvelope,
  validateAnnualConditionalDecisionSubmission,
  type AnnualConditionalCurrentFacts,
  type AnnualConditionalDecisionPreviewEnvelope,
  type AnnualConditionalDecisionState,
  type AnnualConditionalDecisionSubmission
} from "../../../../packages/contracts/src/annualConditionalDecision.js";
import type { AnnualPortfolioLabRequestInput } from "../../../../packages/contracts/src/annualPortfolioLab.js";
import type { PortfolioDecisionContextEnvelope } from "../../../../packages/contracts/src/portfolioDecisionContext.js";
import type { DecisionContextEnvelope } from "../../../../packages/contracts/src/decisionContext.js";
import type { DecisionSnapshotBinding } from "../../../../packages/contracts/src/decisionSnapshot.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { ConditionalDecisionMismatchError } from "./domain.js";
import { annualDecisionBriefFromIntake } from "./annualDecisionBriefService.js";
import { annualPortfolioLabFromFacts, parseAnnualPortfolioLabQuery } from "./annualPortfolioLabService.js";
import {
  annualPortfolioLabQuantEvidenceConfigurationUnavailable,
  loadAnnualPortfolioLabQuantEvidence
} from "./annualPortfolioLabQuantEvidence.js";
import type { QuantEvidenceRuntimeOptions } from "./quantEvidenceSource.js";
import {
  annualValuationQuantWorkbenchFromIntake,
  parseAnnualValuationQuantWorkbenchQuery,
  type AnnualValuationQuantWorkbenchInput
} from "./annualValuationQuantWorkbenchService.js";
import { readAuthorizedPortfolioDecisionContext } from "./authorizedPortfolioDecisionContext.js";
import { readCandidateDecisionIntakeEnvelope } from "./candidateDecisionIntakeRepository.js";

type Queryable = Pick<Pool | PoolClient, "query">;

export interface AnnualConditionalDecisionPreviewInput {
  valuationQuant: AnnualValuationQuantWorkbenchInput;
  portfolioLab: AnnualPortfolioLabRequestInput;
  selectedPortfolioScenarioIndex: number;
}

export interface AnnualConditionalDecisionReadOptions {
  accountScopeId: string | null;
  pinganCurrentMaxAgeSeconds: number;
  quoteLiveMaxAgeSeconds: number;
  now: Date;
  quantEvidence?: QuantEvidenceRuntimeOptions | null;
}

export function parseAnnualConditionalDecisionPreviewQuery(query: Record<string, unknown>):
  | { ok: true; value: AnnualConditionalDecisionPreviewInput }
  | { ok: false; errors: string[] } {
  const selectedPortfolioScenarioIndex = queryInteger(query.selectedPortfolioScenarioIndex);
  const valuationKeys = [
    "metricCurrency", "baseMetricPerShare", "annualGrowthRate", "horizonYears", "terminalMultiple", "annualDiscountRate",
    "netCashPerShare", "growthRateStep", "multipleStep", "maxDrawdownMagnitude", "maxTurnoverOneWay", "minTradeCount"
  ];
  const valuationQuery = Object.fromEntries(valuationKeys.map((key) => [key, query[key]]));
  const valuation = parseAnnualValuationQuantWorkbenchQuery(valuationQuery);
  const portfolio = parseAnnualPortfolioLabQuery({ scenarioAmount: query.scenarioAmount });
  const unsupported = Object.keys(query).filter((key) => !valuationKeys.includes(key)
    && key !== "scenarioAmount" && key !== "selectedPortfolioScenarioIndex");
  const errors = [
    ...unsupported.map((key) => `unsupported conditional decision preview query field ${key}`),
    ...(valuation.ok ? [] : valuation.errors),
    ...(portfolio.ok ? [] : portfolio.errors)
  ];
  if (!Number.isInteger(selectedPortfolioScenarioIndex) || selectedPortfolioScenarioIndex < 0
    || portfolio.ok && selectedPortfolioScenarioIndex >= portfolio.value.scenarioAmounts.length) {
    errors.push("selectedPortfolioScenarioIndex must identify one submitted portfolio scenario");
  }
  return errors.length === 0 && valuation.ok && portfolio.ok
    ? { ok: true, value: { valuationQuant: valuation.value, portfolioLab: portfolio.value, selectedPortfolioScenarioIndex } }
    : { ok: false, errors };
}

export async function readAnnualConditionalDecisionPreview(
  queryable: Queryable,
  membershipId: string,
  actor: AuthenticatedResearchActor,
  input: AnnualConditionalDecisionPreviewInput,
  options: AnnualConditionalDecisionReadOptions
): Promise<AnnualConditionalDecisionPreviewEnvelope> {
  if (!options.accountScopeId) {
    return annualConditionalDecisionPreviewFailClosedEnvelope(
      options.now.toISOString(), membershipId, actor.actorId, "unauthorized", "Current Pingan portfolio account scope authorization is required."
    );
  }
  try {
    const intake = await readCandidateDecisionIntakeEnvelope(
      queryable, membershipId, actor, options.quoteLiveMaxAgeSeconds, options.now, options.quantEvidence?.decision ?? null
    );
    if (intake.status !== "available") {
      return annualConditionalDecisionPreviewFailClosedEnvelope(
        options.now.toISOString(), membershipId, actor.actorId,
        intake.status === "not_found" ? "not_found" : "unavailable", intake.message
      );
    }
    const portfolio = await readAuthorizedPortfolioDecisionContext(queryable, {
      accountScopeId: options.accountScopeId,
      pinganCurrentMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds,
      quoteLiveMaxAgeSeconds: options.quoteLiveMaxAgeSeconds
    }, options.now, "conditional decision preview");
    const quantOptions = options.quantEvidence?.annualPortfolioLab;
    const quant = quantOptions
      ? await loadAnnualPortfolioLabQuantEvidence(quantOptions, options.now)
      : annualPortfolioLabQuantEvidenceConfigurationUnavailable();
    return annualConditionalDecisionPreviewFromFacts(intake, portfolio, input, quant, options.now);
  } catch {
    return annualConditionalDecisionPreviewFailClosedEnvelope(
      options.now.toISOString(), membershipId, actor.actorId, "unavailable", "Conditional decision preview source facts are unavailable."
    );
  }
}

export async function resolveAnnualConditionalDecision(
  queryable: Queryable,
  submission: AnnualConditionalDecisionSubmission | undefined,
  actor: AuthenticatedResearchActor,
  options: AnnualConditionalDecisionReadOptions
): Promise<AnnualConditionalDecisionState | undefined> {
  if (!submission) return undefined;
  const submittedValidation = validateAnnualConditionalDecisionSubmission(submission);
  if (!submittedValidation.ok) throw new ConditionalDecisionMismatchError(submittedValidation.errors.join("; "));
  const input = annualConditionalDecisionPreviewInput(submission.preview);
  const current = await readAnnualConditionalDecisionPreview(
    queryable, submission.preview.membershipId, actor, input, options
  );
  const currentValidation = validateAnnualConditionalDecisionPreviewEnvelope(current);
  if (!currentValidation.ok || current.status !== "available" || current.previewId !== submission.preview.previewId) {
    throw new ConditionalDecisionMismatchError("candidate, research, valuation, quant, portfolio, or risk facts changed or became unavailable");
  }
  const monitor = evaluateAnnualConditionalDecisionMonitor(
    submission.preview,
    submission.judgment,
    annualConditionalCurrentFacts(current, options.now)
  );
  return {
    availability: "preserved",
    preview: submission.preview,
    judgment: submission.judgment,
    monitor,
    limitation: "The exact user-confirmed conditional preview and human judgment are append-only; later facts can request human review but cannot overwrite or transition this decision."
  };
}

export function refreshAnnualConditionalDecisionMonitor(
  state: AnnualConditionalDecisionState | undefined,
  facts: AnnualConditionalCurrentFacts
): AnnualConditionalDecisionState | undefined {
  if (!state || state.availability !== "preserved" || !state.preview || !state.judgment) return state;
  return { ...state, monitor: evaluateAnnualConditionalDecisionMonitor(state.preview, state.judgment, facts) };
}

export async function refreshAnnualConditionalDecisionMonitorFromAuthoritativeFacts(
  queryable: Queryable,
  state: AnnualConditionalDecisionState | undefined,
  actor: AuthenticatedResearchActor,
  options: AnnualConditionalDecisionReadOptions
): Promise<AnnualConditionalDecisionState | undefined> {
  if (!state || state.availability !== "preserved" || !state.preview || !state.judgment) return state;
  let facts: AnnualConditionalCurrentFacts;
  try {
    if (!options.accountScopeId) throw new Error("portfolio account scope is unavailable");
    const input = annualConditionalDecisionPreviewInput(state.preview);
    const intake = await readCandidateDecisionIntakeEnvelope(
      queryable,
      state.preview.membershipId,
      actor,
      options.quoteLiveMaxAgeSeconds,
      options.now,
      options.quantEvidence?.decision ?? null
    );
    if (intake.status !== "available") throw new Error("candidate decision intake is unavailable");
    const portfolio = await readAuthorizedPortfolioDecisionContext(
      queryable,
      {
        accountScopeId: options.accountScopeId,
        pinganCurrentMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds,
        quoteLiveMaxAgeSeconds: options.quoteLiveMaxAgeSeconds
      },
      options.now,
      "conditional decision monitor"
    );
    const quantOptions = options.quantEvidence?.annualPortfolioLab;
    const quant = quantOptions
      ? await loadAnnualPortfolioLabQuantEvidence(quantOptions, options.now)
      : annualPortfolioLabQuantEvidenceConfigurationUnavailable();
    const current: AnnualConditionalDecisionPreviewEnvelope = {
      ...state.preview,
      generatedAt: options.now.toISOString(),
      previewId: null,
      data: {
        decisionBrief: annualDecisionBriefFromIntake(intake, options.now),
        valuationQuant: annualValuationQuantWorkbenchFromIntake(intake, input.valuationQuant, options.now),
        portfolioLab: annualPortfolioLabFromFacts(intake, portfolio, input.portfolioLab, quant, options.now),
        selectedPortfolioScenarioIndex: input.selectedPortfolioScenarioIndex
      }
    };
    facts = annualConditionalCurrentFacts(current, options.now);
  } catch {
    facts = annualConditionalCurrentFacts(
      annualConditionalDecisionPreviewFailClosedEnvelope(
        options.now.toISOString(),
        state.preview.membershipId,
        actor.actorId,
        "unavailable",
        "Current conditional-decision facts are unavailable for human review."
      ),
      options.now
    );
  }
  return refreshAnnualConditionalDecisionMonitor(state, facts);
}

export function annualConditionalDecisionSnapshotBinding(
  preview: AnnualConditionalDecisionPreviewEnvelope
): DecisionSnapshotBinding {
  const binding = conditionalDecisionSnapshotBindingFromPreview(preview);
  if (!binding) {
    throw new ConditionalDecisionMismatchError("conditional decision preview does not contain one current portfolio and risk binding");
  }
  return binding;
}

export function annualConditionalCurrentFacts(
  source: AnnualConditionalDecisionPreviewEnvelope | { decisionContext: DecisionContextEnvelope | null; portfolio: PortfolioDecisionContextEnvelope | null },
  now: Date
): AnnualConditionalCurrentFacts {
  if ("status" in source) return annualConditionalPreviewCurrentFacts(source, now);
  return annualConditionalContextCurrentFacts(source, now);
}

function annualConditionalPreviewCurrentFacts(
  source: AnnualConditionalDecisionPreviewEnvelope,
  now: Date
): AnnualConditionalCurrentFacts {
  return {
    evaluatedAt: now.toISOString(),
    ...conditionalCandidateCurrentFacts(source),
    ...conditionalValuationQuantCurrentFacts(source),
    ...conditionalPortfolioCurrentFacts(source)
  };
}

function conditionalCandidateCurrentFacts(source: AnnualConditionalDecisionPreviewEnvelope) {
  const target = source.data?.decisionBrief.data?.target;
  const brief = source.data?.decisionBrief.data?.sourceIdentity;
  return {
    membershipId: target?.membershipId ?? null,
    membershipVersion: target?.membershipVersion ?? null,
    membershipState: target?.membershipState ?? null,
    decisionContextId: brief?.decisionContextId ?? null,
    decisionContextHash: brief?.decisionContextHash ?? null
  };
}

function conditionalValuationQuantCurrentFacts(source: AnnualConditionalDecisionPreviewEnvelope) {
  const valuation = source.data?.valuationQuant.data?.valuation;
  const quant = source.data?.valuationQuant.data?.quant;
  return {
    valuationQuoteSnapshotId: valuation?.quote?.snapshotId ?? null,
    valuationQuotePrice: valuation?.quote?.price ?? null,
    valuationCalculationVersion: valuation?.method.calculationVersion ?? null,
    quantSnapshotId: quant?.model.snapshotId ?? null,
    quantSnapshotHash: quant?.model.snapshotHash ?? null,
    quantModelVersion: quant?.model.modelVersion ?? null,
    quantCodeIdentity: quant?.model.codeIdentity ?? null
  };
}

function conditionalPortfolioCurrentFacts(source: AnnualConditionalDecisionPreviewEnvelope) {
  const lab = source.data?.portfolioLab.data;
  const portfolio = lab?.sourceIdentity;
  const scenario = lab?.scenarios[source.data?.selectedPortfolioScenarioIndex ?? -1];
  return {
    portfolioLabQuantEvidenceId: lab?.quant.evidence?.evidenceId ?? null,
    portfolioContextId: portfolio?.portfolioContextId ?? null,
    portfolioSnapshotId: portfolio?.portfolioSnapshotId ?? null,
    riskImpactId: scenario?.riskImpact.impactId ?? null,
    scenarioCandidateWeight: scenario?.riskImpact.scenario.candidateWeight ?? null,
    scenarioLargestPositionWeight: scenario?.riskImpact.scenario.largestPositionWeight ?? null,
    scenarioHhi: scenario?.riskImpact.scenario.hhi ?? null
  };
}

function annualConditionalContextCurrentFacts(
  source: { decisionContext: DecisionContextEnvelope | null; portfolio: PortfolioDecisionContextEnvelope | null },
  now: Date
): AnnualConditionalCurrentFacts {
  return {
    ...emptyAnnualConditionalCurrentFacts(now),
    decisionContextId: source.decisionContext?.contextId ?? null,
    decisionContextHash: source.decisionContext?.contextHash ?? null,
    portfolioContextId: source.portfolio?.status === "available" ? source.portfolio.contextId : null,
    portfolioSnapshotId: source.portfolio?.status === "available" ? source.portfolio.portfolioSnapshotId : null
  };
}

function emptyAnnualConditionalCurrentFacts(now: Date): AnnualConditionalCurrentFacts {
  return {
    evaluatedAt: now.toISOString(),
    membershipId: null, membershipVersion: null, membershipState: null,
    decisionContextId: null, decisionContextHash: null,
    valuationQuoteSnapshotId: null, valuationQuotePrice: null, valuationCalculationVersion: null,
    quantSnapshotId: null, quantSnapshotHash: null, quantModelVersion: null, quantCodeIdentity: null,
    portfolioLabQuantEvidenceId: null, portfolioContextId: null, portfolioSnapshotId: null,
    riskImpactId: null, scenarioCandidateWeight: null, scenarioLargestPositionWeight: null, scenarioHhi: null
  };
}

function annualConditionalDecisionPreviewFromFacts(
  intake: Awaited<ReturnType<typeof readCandidateDecisionIntakeEnvelope>>,
  portfolio: PortfolioDecisionContextEnvelope,
  input: AnnualConditionalDecisionPreviewInput,
  quant: Awaited<ReturnType<typeof loadAnnualPortfolioLabQuantEvidence>>,
  now: Date
): AnnualConditionalDecisionPreviewEnvelope {
  const brief = annualDecisionBriefFromIntake(intake, now);
  const valuationQuant = annualValuationQuantWorkbenchFromIntake(intake, input.valuationQuant, now);
  const portfolioLab = annualPortfolioLabFromFacts(intake, portfolio, input.portfolioLab, quant, now);
  const status = brief.status === "available" && valuationQuant.status === "available" && portfolioLab.status === "available"
    ? "available"
    : brief.status === "not_found" || valuationQuant.status === "not_found" || portfolioLab.status === "not_found"
      ? "not_found"
      : brief.status === "unavailable" || valuationQuant.status === "unavailable" || portfolioLab.status === "unavailable"
        ? "unavailable"
        : "blocked";
  if (status !== "available") {
    return annualConditionalDecisionPreviewFailClosedEnvelope(
      now.toISOString(), intake.membershipId, intake.requestedActorId, status,
      "Conditional decision preview is blocked until the decision brief, valuation, quant, current portfolio, and selected risk scenario are all available."
    );
  }
  const base: AnnualConditionalDecisionPreviewEnvelope = {
    schemaVersion: ANNUAL_CONDITIONAL_DECISION_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    status: "available",
    previewId: null,
    membershipId: intake.membershipId,
    requestedActorId: intake.requestedActorId,
    requestedSymbol: intake.requestedSymbol,
    data: { decisionBrief: brief, valuationQuant, portfolioLab, selectedPortfolioScenarioIndex: input.selectedPortfolioScenarioIndex },
    safety: annualConditionalDecisionSafety(),
    message: `Frozen conditional-decision preview for ${intake.requestedSymbol}; confirmation remains a human judgment only.`
  };
  const preview = { ...base, previewId: computeAnnualConditionalDecisionPreviewId(base) };
  const validation = validateAnnualConditionalDecisionPreviewEnvelope(preview);
  return validation.ok ? preview : annualConditionalDecisionPreviewFailClosedEnvelope(
    now.toISOString(), intake.membershipId, intake.requestedActorId, "blocked",
    `Conditional decision preview could not bind every required fact: ${validation.errors.join("; ")}`
  );
}

function annualConditionalDecisionPreviewInput(
  preview: AnnualConditionalDecisionPreviewEnvelope
): AnnualConditionalDecisionPreviewInput {
  const valuation = preview.data?.valuationQuant.data?.valuation.inputs;
  const quantFilter = preview.data?.valuationQuant.data?.quant.filter.criteria;
  const scenarios = preview.data?.portfolioLab.data?.scenarios ?? [];
  if (!valuation || !quantFilter || scenarios.length === 0 || !preview.data) {
    throw new ConditionalDecisionMismatchError("conditional decision preview inputs are unavailable");
  }
  return {
    valuationQuant: { valuation, quantFilter },
    portfolioLab: { scenarioAmounts: scenarios.map((scenario) => scenario.hypotheticalAmount) },
    selectedPortfolioScenarioIndex: preview.data.selectedPortfolioScenarioIndex
  };
}

export function annualConditionalDecisionPreviewFailClosedEnvelope(
  generatedAt: string,
  membershipId: string,
  actorId: string,
  status: Exclude<AnnualConditionalDecisionPreviewEnvelope["status"], "available">,
  message: string
): AnnualConditionalDecisionPreviewEnvelope {
  return {
    schemaVersion: ANNUAL_CONDITIONAL_DECISION_SCHEMA_VERSION,
    generatedAt,
    status,
    previewId: null,
    membershipId,
    requestedActorId: actorId,
    requestedSymbol: null,
    data: null,
    safety: annualConditionalDecisionSafety(),
    message
  };
}

function queryInteger(value: unknown): number {
  if (typeof value !== "string" || value.trim() !== value || !/^(0|[1-9]\d*)$/.test(value)) return Number.NaN;
  return Number(value);
}
