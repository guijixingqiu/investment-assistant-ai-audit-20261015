import type {
  AnnualConditionalJudgment,
  AnnualConditionalPortfolioObservationCondition
} from "../../../packages/contracts/src/annualConditionalDecisionContract.js";
import type { AnnualReviewLearningRequest } from "../../../packages/contracts/src/annualReviewLearning.js";
import type { AnnualConsoleInputs, ResearchEvidenceFields, ResearchProfileFields } from "./investmentControlConsoleApiClient.js";
import { parseAnnualPortfolioLabAmountText } from "./annualPortfolioLabApiClient.js";

export function readResearchProfileFields(documentRef: Document = document): ResearchProfileFields {
  return {
    name: optionalText(documentRef, "research-editor-name"),
    currentView: text(documentRef, "research-editor-current-view"),
    currentThesis: text(documentRef, "research-editor-current-thesis"),
    marketDisagreement: optionalText(documentRef, "research-editor-market-disagreement"),
    invalidationCondition: optionalText(documentRef, "research-editor-invalidation"),
    nextReviewOn: optionalText(documentRef, "research-editor-next-review"),
    keyVariables: lines(documentRef, "research-editor-key-variables"),
    catalysts: lines(documentRef, "research-editor-catalysts"),
    evidenceGaps: lines(documentRef, "research-editor-evidence-gaps")
  };
}

export function readResearchEvidenceFields(documentRef: Document = document): ResearchEvidenceFields {
  return {
    sourceType: text(documentRef, "research-evidence-source-type"),
    sourceUrl: optionalText(documentRef, "research-evidence-source-url"),
    publishedAt: optionalText(documentRef, "research-evidence-published-at"),
    summary: text(documentRef, "research-evidence-summary"),
    factKind: value(documentRef, "research-evidence-fact-kind") === "inference" ? "inference" : "fact",
    variableName: optionalText(documentRef, "research-evidence-variable"),
    stance: stance(documentRef),
    reliability: optionalInteger(documentRef, "research-evidence-reliability"),
    materiality: optionalInteger(documentRef, "research-evidence-materiality"),
    isRead: checked(documentRef, "research-evidence-read")
  };
}

export function readAnnualConsoleInputs(documentRef: Document = document): AnnualConsoleInputs {
  return {
    valuation: {
      metricCurrency: text(documentRef, "annual-metric-currency"), baseMetricPerShare: number(documentRef, "annual-base-metric"),
      annualGrowthRate: number(documentRef, "annual-growth-rate"),
      horizonYears: number(documentRef, "annual-horizon-years"),
      terminalMultiple: number(documentRef, "annual-terminal-multiple"),
      annualDiscountRate: number(documentRef, "annual-discount-rate"),
      netCashPerShare: number(documentRef, "annual-net-cash"),
      growthRateStep: number(documentRef, "annual-growth-step"),
      multipleStep: number(documentRef, "annual-multiple-step")
    },
    quantFilter: {
      maxDrawdownMagnitude: number(documentRef, "annual-max-drawdown"),
      maxTurnoverOneWay: number(documentRef, "annual-max-turnover"),
      minTradeCount: number(documentRef, "annual-min-trades")
    },
    scenarioAmounts: parseAnnualPortfolioLabAmountText(value(documentRef, "annual-scenario-amounts")) ?? [],
    selectedPortfolioScenarioIndex: number(documentRef, "annual-selected-scenario")
  };
}

export function readAnnualConditionalJudgment(documentRef: Document = document): AnnualConditionalJudgment {
  const condition = readPortfolioObservation(documentRef);
  return {
    confidence: confidence(documentRef),
    assumptions: lines(documentRef, "annual-condition-assumptions"),
    invalidationConditions: lines(documentRef, "annual-condition-invalidations"),
    portfolioObservationConditions: condition ? [condition] : [],
    observationWindow: {
      startsOn: value(documentRef, "annual-observation-start"),
      endsOn: value(documentRef, "annual-observation-end")
    },
    reviewOn: value(documentRef, "annual-review-on"),
    workflowState: workflowState(documentRef)
  };
}

export function readAnnualReviewLearningFields(documentRef: Document = document): Pick<AnnualReviewLearningRequest,
  "judgmentCorrection" | "processLesson" | "nextResearchQuestion"> {
  return {
    judgmentCorrection: text(documentRef, "annual-review-judgment-correction"),
    processLesson: text(documentRef, "annual-review-process-lesson"),
    nextResearchQuestion: optionalText(documentRef, "annual-review-next-question")
  };
}

function readPortfolioObservation(documentRef: Document): AnnualConditionalPortfolioObservationCondition | null {
  if (!checked(documentRef, "annual-portfolio-condition-enabled")) return null;
  const metricValue = value(documentRef, "annual-portfolio-condition-metric");
  const comparisonValue = value(documentRef, "annual-portfolio-condition-comparison");
  return {
    metric: metricValue === "scenario_largest_position_weight" || metricValue === "scenario_hhi"
      ? metricValue : "scenario_candidate_weight",
    comparison: comparisonValue === "at_or_below" ? "at_or_below" : "at_or_above",
    threshold: number(documentRef, "annual-portfolio-condition-threshold"),
    rationale: text(documentRef, "annual-portfolio-condition-rationale"),
    purpose: "human_review_trigger_only"
  };
}

function stance(documentRef: Document): "support" | "refute" | "neutral" {
  const current = value(documentRef, "research-evidence-stance");
  return current === "support" || current === "refute" ? current : "neutral";
}

function confidence(documentRef: Document): "low" | "medium" | "high" {
  const current = value(documentRef, "annual-condition-confidence");
  return current === "low" || current === "high" ? current : "medium";
}

function workflowState(documentRef: Document): AnnualConditionalJudgment["workflowState"] {
  const current = value(documentRef, "annual-condition-workflow-state");
  if (current === "await_condition" || current === "judgment_formed" || current === "stop_following") return current;
  return "continue_research";
}

function input(documentRef: Document, id: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const element = documentRef.getElementById(id);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) {
    throw new Error(`missing control #${id}`);
  }
  return element;
}

function value(documentRef: Document, id: string): string { return input(documentRef, id).value; }
function text(documentRef: Document, id: string): string { return value(documentRef, id).trim(); }
function optionalText(documentRef: Document, id: string): string | null { return text(documentRef, id) || null; }
function checked(documentRef: Document, id: string): boolean { return (input(documentRef, id) as HTMLInputElement).checked; }
function number(documentRef: Document, id: string): number { return Number(value(documentRef, id)); }
function optionalInteger(documentRef: Document, id: string): number | null { const raw = value(documentRef, id); return raw === "" ? null : Number(raw); }
function lines(documentRef: Document, id: string): string[] { return value(documentRef, id).split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }
