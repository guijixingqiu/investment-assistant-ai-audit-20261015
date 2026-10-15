import type { AnnualConditionalDecisionSubmission } from "../../../packages/contracts/src/annualConditionalDecisionContract.js";
import type { AnnualReviewLearningRequest } from "../../../packages/contracts/src/annualReviewLearning.js";
import type { PreTradeDecisionCheckData } from "../../../packages/contracts/src/decisionContextBrowser.js";
import type { PostDecisionReviewData } from "../../../packages/contracts/src/decisionReview.js";
import type { DecisionSnapshotBinding } from "../../../packages/contracts/src/decisionSnapshotContract.js";
import type { ResearchReportDecisionBinding } from "../../../packages/contracts/src/researchReportDecision.js";
import type { DecisionActionIntent } from "../../../packages/contracts/src/research.js";
import type { FormalOwnerDecisionInput } from "../../../packages/contracts/src/formalDecision.js";
import type { CandidateDecisionIntakeRenderModel } from "./candidateDecisionIntakeState.js";
import type { CoreJourneyData } from "./coreJourneyState.js";
import {
  InvestmentControlConsoleController,
  type InvestmentControlConsoleSource,
  type InvestmentConsoleTab
} from "./investmentControlConsoleController.js";
import {
  readAnnualConditionalJudgment,
  readAnnualConsoleInputs,
  readAnnualReviewLearningFields,
  readResearchEvidenceFields,
  readResearchProfileFields
} from "./investmentControlConsoleForms.js";
import { renderInvestmentControlConsole, syncConditionalHumanCheckResult } from "./investmentControlConsoleRenderer.js";
import type { PortfolioWorkspaceViewState } from "./portfolioWorkspaceController.js";
import type { WebApiAuth, WebFailureState } from "./apiClient.js";

export interface InvestmentControlConsoleCoordinatorDependencies {
  currentData: () => CoreJourneyData | null;
  currentDecisionIntake: () => CandidateDecisionIntakeRenderModel;
  currentPortfolio: () => PortfolioWorkspaceViewState;
  readAuth: () => WebApiAuth | null;
  writeAuth: () => WebApiAuth | null;
  reloadAfterResearchWrite: (membershipId: string) => Promise<void>;
}

export interface ConsoleDecisionPreparation {
  binding: DecisionSnapshotBinding | ResearchReportDecisionBinding;
  bindingSource: "portfolio_workspace" | "conditional_preview" | "confirmed_report";
  payload: {
    actionIntent: DecisionActionIntent;
    humanCheckResult: "ready_to_consider" | "blocked" | "needs_more_evidence";
    userFinalDecision: string | null;
    conditionalDecision?: AnnualConditionalDecisionSubmission;
    formalDecision?: FormalOwnerDecisionInput;
    decisionSnapshotBinding?: DecisionSnapshotBinding;
  };
  conditionalDecision: AnnualConditionalDecisionSubmission | null;
}

export interface ConsoleReviewPreparation {
  payload: {
    outcome: "thesis_confirmed" | "thesis_weakened" | "thesis_invalidated" | "insufficient_evidence";
    outcomeEvidence: string | null;
    reviewNote: string | null;
    reviewLearning?: AnnualReviewLearningRequest;
  };
  reviewLearning: AnnualReviewLearningRequest | undefined;
}

const computedInputIds = new Set([
  "annual-metric-currency", "annual-base-metric", "annual-growth-rate", "annual-horizon-years", "annual-terminal-multiple",
  "annual-discount-rate", "annual-net-cash", "annual-growth-step", "annual-multiple-step",
  "annual-max-drawdown", "annual-max-turnover", "annual-min-trades", "annual-scenario-amounts",
  "annual-selected-scenario"
]);

export class InvestmentControlConsoleCoordinator {
  readonly controller: InvestmentControlConsoleController;

  constructor(private readonly dependencies: InvestmentControlConsoleCoordinatorDependencies) {
    this.controller = new InvestmentControlConsoleController({
      readAuth: dependencies.readAuth,
      writeAuth: dependencies.writeAuth,
      currentSource: () => this.currentSource(),
      reloadAfterResearchWrite: dependencies.reloadAfterResearchWrite,
      render: () => this.render()
    });
  }

  render(documentRef: Document = document): void {
    renderInvestmentControlConsole(
      this.controller,
      this.currentSource(),
      this.dependencies.currentData()?.submittedCheck ?? null,
      documentRef
    );
  }
  clear(state: WebFailureState, message: string): void { this.controller.clear(state, message); }
  invalidateAuthorizationRetries(): void { this.controller.invalidateAuthorizationRetries(); }
  reflectDecisionIntake(): void {
    if (this.currentSource()) { this.render(); return; }
    const intake = this.dependencies.currentDecisionIntake();
    const state = (["unauthorized", "not_found", "conflict", "malformed", "offline", "unavailable"] as const).find((value) => value === intake.state) ?? "unavailable";
    this.clear(state, intake.message);
  }
  setTab(tab: InvestmentConsoleTab): void { this.controller.setTab(tab); }
  saveResearchProfile(documentRef: Document = document): Promise<void> { return this.controller.saveResearchProfile(readResearchProfileFields(documentRef)); }
  addResearchEvidence(documentRef: Document = document): Promise<void> { return this.controller.addResearchEvidence(readResearchEvidenceFields(documentRef)); }
  loadValuation(documentRef: Document = document): Promise<void> { return this.controller.loadValuation(readAnnualConsoleInputs(documentRef)); }
  runRegisteredValuation(): Promise<void> { return this.controller.runRegisteredValuation(); }
  loadConditional(documentRef: Document = document): Promise<void> { return this.controller.loadConditional(readAnnualConsoleInputs(documentRef)); }

  setConditionalBound(bound: boolean, documentRef: Document = document): void {
    this.controller.setConditionalBound(bound);
    syncConditionalHumanCheckResult(documentRef);
  }

  inputChanged(id: string, documentRef: Document = document): void {
    if (computedInputIds.has(id)) this.controller.invalidateComputed("User inputs changed.");
    if (id === "annual-condition-workflow-state") syncConditionalHumanCheckResult(documentRef);
  }

  async prepareDecision(
    binding: DecisionSnapshotBinding,
    payload: Omit<ConsoleDecisionPreparation["payload"], "conditionalDecision">,
    researchReportBinding: ResearchReportDecisionBinding | null = null,
    documentRef: Document = document
  ): Promise<ConsoleDecisionPreparation> {
    if (researchReportBinding) return {
      binding: researchReportBinding,
      bindingSource: "confirmed_report",
      payload: { ...payload, decisionSnapshotBinding: binding },
      conditionalDecision: null
    };
    if (!this.controller.conditionalBound) return { binding, bindingSource: "portfolio_workspace", payload, conditionalDecision: null };
    const conditional = await this.controller.decisionSubmission(readAnnualConditionalJudgment(documentRef));
    if (!conditional) return { binding, bindingSource: "portfolio_workspace", payload, conditionalDecision: null };
    return {
      binding: conditional.decisionSnapshotBinding,
      bindingSource: "conditional_preview",
      payload: {
        ...payload,
        actionIntent: "watch",
        humanCheckResult: conditional.humanCheckResult,
        conditionalDecision: conditional.conditionalDecision
      },
      conditionalDecision: conditional.conditionalDecision
    };
  }

  async matchesDecisionResponse(check: PreTradeDecisionCheckData, prepared: ConsoleDecisionPreparation): Promise<boolean> {
    return prepared.conditionalDecision && "schemaVersion" in prepared.binding
      ? this.controller.matchesDecisionResponse(check, prepared.payload, prepared.binding)
      : true;
  }

  prepareReview(
    check: PreTradeDecisionCheckData,
    payload: Omit<ConsoleReviewPreparation["payload"], "reviewLearning">,
    documentRef: Document = document
  ): ConsoleReviewPreparation {
    if (check.conditionalDecision?.availability !== "preserved") return { payload, reviewLearning: undefined };
    const fields = readAnnualReviewLearningFields(documentRef);
    const hasLearning = Boolean(fields.judgmentCorrection || fields.processLesson || fields.nextResearchQuestion);
    const reviewLearning = hasLearning ? this.controller.reviewLearningRequest(check, fields) : undefined;
    return {
      payload: reviewLearning ? { ...payload, reviewLearning } : payload,
      reviewLearning
    };
  }

  matchesReviewResponse(review: PostDecisionReviewData, check: PreTradeDecisionCheckData, prepared: ConsoleReviewPreparation): boolean {
    return this.controller.matchesReviewLearningResponse(review, check, prepared.reviewLearning);
  }

  currentSource(): InvestmentControlConsoleSource | null {
    const data = this.dependencies.currentData();
    const intake = this.dependencies.currentDecisionIntake();
    if (!data?.research?.data || !data.decisionContext || !data.reviewHistory
      || !intake.membershipId || !intake.membershipVersion || !intake.membershipState
      || intake.symbol !== data.symbol.symbol || intake.membershipState === "archived") return null;
    const portfolio = this.dependencies.currentPortfolio().context;
    const sourceKey = JSON.stringify([
      intake.membershipId, intake.membershipVersion, intake.membershipState, data.symbol.symbol,
      data.decisionContext.contextId, data.decisionContext.contextHash, data.research.asOf,
      data.reviewHistory.metadata.asOf, portfolio?.status ?? null, portfolio?.contextId ?? null,
      portfolio?.portfolioSnapshotId ?? null, portfolio?.accountScopeId ?? null
    ]);
    return {
      sourceKey,
      membershipId: intake.membershipId,
      membershipVersion: intake.membershipVersion,
      membershipState: intake.membershipState,
      market: data.symbol.market,
      code: data.symbol.code,
      symbol: data.symbol.symbol,
      decisionContext: data.decisionContext,
      research: data.research,
      reviewHistory: data.reviewHistory,
      quoteState: data.quote?.status ?? "unavailable",
      portfolio
    };
  }
}
