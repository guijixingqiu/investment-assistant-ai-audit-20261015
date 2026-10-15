import {
  conditionalDecisionSnapshotBindingFromPreview,
  conditionalHumanCheckResult,
  type AnnualConditionalDecisionPreviewEnvelope,
  type AnnualConditionalDecisionSubmission,
  type AnnualConditionalJudgment
} from "../../../packages/contracts/src/annualConditionalDecisionContract.js";
import type { AnnualValuationQuantWorkbenchEnvelope } from "../../../packages/contracts/src/annualValuationQuantWorkbench.js";
import type { CandidateDecisionIntakeEnvelope } from "../../../packages/contracts/src/candidateDecisionIntake.js";
import {
  ANNUAL_REVIEW_LEARNING_SCHEMA_VERSION,
  validateAnnualReviewLearningRequest,
  type AnnualReviewLearningRequest
} from "../../../packages/contracts/src/annualReviewLearning.js";
import type { DecisionContextEnvelope, PreTradeDecisionCheckData } from "../../../packages/contracts/src/decisionContextBrowser.js";
import type { DecisionReviewHistoryEnvelope, PostDecisionReviewData } from "../../../packages/contracts/src/decisionReview.js";
import type { DecisionActionIntent, ResearchProfileEnvelope } from "../../../packages/contracts/src/research.js";
import type { PortfolioDecisionContextEnvelope } from "../../../packages/contracts/src/portfolioDecisionContextBrowser.js";
import type { DecisionSnapshotBinding } from "../../../packages/contracts/src/decisionSnapshotContract.js";
import { sameWebApiAuth, type WebApiAuth } from "./apiClient.js";
import type { WebFailureState } from "./decisionJourneyIngress.js";
import {
  InvestmentControlConsoleApiClient,
  type AnnualConsoleInputs,
  type InvestmentConsoleSourceBinding,
  type ResearchEvidenceFields,
  type ResearchProfileFields
} from "./investmentControlConsoleApiClient.js";
import { validateAnnualConditionalDecisionSubmissionForBrowser } from "./annualConditionalDecisionBrowser.js";
import { validateSubmittedDecisionResponse, validateSubmittedReviewLearning } from "./investmentControlConsoleResponseValidation.js";

export type InvestmentConsoleLaneState = "idle" | "ready" | "loading" | "available" | "succeeded" | WebFailureState;
export type InvestmentConsoleTab = "sources" | "valuation" | "conditions" | "diagnostics";

export interface InvestmentControlConsoleSource extends InvestmentConsoleSourceBinding {
  sourceKey: string;
  decisionContext: DecisionContextEnvelope;
  research: ResearchProfileEnvelope;
  reviewHistory: DecisionReviewHistoryEnvelope;
  quoteState: string;
  portfolio: PortfolioDecisionContextEnvelope | null;
}

export interface InvestmentConsoleLane<T> {
  state: InvestmentConsoleLaneState;
  message: string;
  value: T | null;
}

export interface InvestmentControlConsoleDependencies {
  api?: InvestmentControlConsoleApiClient;
  readAuth: () => WebApiAuth | null;
  writeAuth: () => WebApiAuth | null;
  currentSource: () => InvestmentControlConsoleSource | null;
  reloadAfterResearchWrite: (membershipId: string) => Promise<void>;
  render: () => void;
}

export class InvestmentControlConsoleController {
  activeTab: InvestmentConsoleTab = "sources";
  research: InvestmentConsoleLane<ResearchProfileEnvelope["data"]> = lane("idle", "Load an exact candidate and membership source.");
  valuation: InvestmentConsoleLane<AnnualValuationQuantWorkbenchEnvelope> = lane("idle", "Run a user-input valuation and quant inspection.");
  /**
   * Exact registered-quant run readback: the existing candidate decision-intake
   * envelope whose context carries the frozen historical quant evidence. It is
   * rendered independently of any user valuation scenario or filter input.
   */
  registeredQuant: InvestmentConsoleLane<CandidateDecisionIntakeEnvelope> = lane("idle", "No registered quantitative research run is retained.");
  conditional: InvestmentConsoleLane<AnnualConditionalDecisionPreviewEnvelope> = lane("idle", "Load a source-bound conditional preview.");
  conditionalBound = false;
  lastFailure: { lane: string; state: WebFailureState; message: string } | null = null;

  private readonly api: InvestmentControlConsoleApiClient;
  private sourceKey: string | null = null;
  private generation = 0;

  constructor(private readonly dependencies: InvestmentControlConsoleDependencies) {
    this.api = dependencies.api ?? new InvestmentControlConsoleApiClient();
  }

  get busy(): boolean { return this.research.state === "loading" || this.valuation.state === "loading" || this.registeredQuant.state === "loading" || this.conditional.state === "loading"; }
  invalidateAuthorizationRetries(): void { this.api.invalidateAuthorizationRetries(); }
  syncSource(): void {
    const source = this.dependencies.currentSource();
    if (source?.sourceKey === this.sourceKey) return;
    this.generation += 1;
    this.sourceKey = source?.sourceKey ?? null;
    this.conditionalBound = false;
    this.valuation = lane("idle", source ? "Current source loaded; no valuation run is retained." : "Current source is unavailable; valuation facts are cleared.");
    // Source drift clears registered-run evidence: it belongs to one exact
    // membership.
    this.registeredQuant = lane("idle", source ? "Current source loaded; no registered research evidence is retained." : "Current source is unavailable; registered research evidence is cleared.");
    this.conditional = lane("idle", source ? "Current source loaded; no conditional preview is retained." : "Current source is unavailable; conditional facts are cleared.");
    this.research = source?.research.data
      ? { state: "ready", message: `Research editor bound to ${source.symbol} membership ${source.membershipId} version ${source.membershipVersion}.`, value: source.research.data }
      : lane(source ? "unavailable" : "idle", source ? "A validated loaded research profile is required before editing." : "Load an exact candidate and membership source.");
  }

  clear(state: WebFailureState, message: string): void {
    this.generation += 1;
    this.sourceKey = null;
    this.conditionalBound = false;
    this.research = lane(state, message);
    this.valuation = lane(state, `${message} Prior valuation success was cleared.`);
    this.registeredQuant = lane(state, `${message} Prior registered research evidence was cleared.`);
    this.conditional = lane(state, `${message} Prior conditional success was cleared.`);
    this.lastFailure = { lane: "source", state, message };
    this.dependencies.render();
  }

  invalidateComputed(message: string): void {
    this.generation += 1;
    this.conditionalBound = false;
    this.valuation = lane("idle", `${message} Prior valuation success was cleared.`);
    this.conditional = lane("idle", `${message} Prior conditional success was cleared.`);
    this.dependencies.render();
  }

  /**
   * A registered run publishes only registered-run evidence. Derived previews
   * computed from earlier quant evidence are cleared by `invalidateComputed`,
   * while user valuation inputs and retained run history stay untouched.
   */
  invalidateRegisteredQuant(message: string): void {
    this.generation += 1;
    this.registeredQuant = lane("idle", `${message} Prior registered research evidence was cleared.`);
    this.dependencies.render();
  }

  setTab(tab: string): void {
    if (tab === "sources" || tab === "valuation" || tab === "conditions" || tab === "diagnostics") this.activeTab = tab;
    this.dependencies.render();
  }

  setConditionalBound(bound: boolean): void {
    this.conditionalBound = bound && this.conditional.state === "available" && this.conditional.value !== null;
    this.dependencies.render();
  }

  async saveResearchProfile(fields: ResearchProfileFields): Promise<void> {
    const source = this.validResearchSource();
    const auth = this.dependencies.writeAuth();
    if (!auth) return this.fail("research", "unauthorized", "Runtime research-write authorization is required.");
    if (!source) return this.fail("research", "unavailable", "A validated source-bound research profile is required before saving.");
    this.invalidateForResearchAttempt("Research profile write started.");
    const generation = this.generation;
    const sourceKey = source.sourceKey;
    this.research = lane("loading", "Saving the source-bound research profile.");
    this.dependencies.render();
    const result = await this.api.updateResearchProfile(auth, source, fields);
    if (!this.responseIsCurrent(generation, sourceKey, auth, this.dependencies.writeAuth())) return;
    if (!result.ok) return this.fail("research", result.state, result.reason);
    this.research = { state: "succeeded", message: result.value.message, value: { profile: result.value.data, evidence: source.research.data!.evidence, suggestions: source.research.data!.suggestions } };
    this.dependencies.render();
    await this.dependencies.reloadAfterResearchWrite(source.membershipId);
  }

  async addResearchEvidence(fields: ResearchEvidenceFields): Promise<void> {
    const source = this.validResearchSource();
    const auth = this.dependencies.writeAuth();
    if (!auth) return this.fail("research", "unauthorized", "Runtime research-write authorization is required.");
    if (!source) return this.fail("research", "unavailable", "A validated source-bound research profile is required before adding evidence.");
    this.invalidateForResearchAttempt("Research evidence write started.");
    const generation = this.generation;
    const sourceKey = source.sourceKey;
    this.research = lane("loading", "Adding evidence to the exact source-bound profile.");
    this.dependencies.render();
    const result = await this.api.createResearchEvidence(auth, source, fields);
    if (!this.responseIsCurrent(generation, sourceKey, auth, this.dependencies.writeAuth())) return;
    if (!result.ok) return this.fail("research", result.state, result.reason);
    this.research = { state: "succeeded", message: result.value.message, value: null };
    this.dependencies.render();
    await this.dependencies.reloadAfterResearchWrite(source.membershipId);
  }

  async loadValuation(inputs: AnnualConsoleInputs): Promise<void> {
    const source = this.currentBoundSource();
    const auth = this.dependencies.readAuth();
    this.invalidateComputed("Valuation inputs or source are being evaluated.");
    const generation = this.generation;
    if (!auth) return this.fail("valuation", "unauthorized", "Runtime read authorization is required for valuation and quant facts.");
    if (!source) return this.fail("valuation", "unavailable", "Load an exact non-archived membership and current decision context first.");
    this.valuation = lane("loading", "Loading valuation and quant facts for the current source.");
    this.dependencies.render();
    const result = await this.api.loadValuationQuant(auth, source, inputs);
    if (!this.responseIsCurrent(generation, source.sourceKey, auth, this.dependencies.readAuth())) return;
    if (!result.ok) return this.fail("valuation", result.state, result.reason);
    this.valuation = { state: "available", message: result.value.message, value: result.value };
    this.dependencies.render();
  }

  /**
   * Explicit registered quantitative research run. The operation is
   * preregistered and fixed, so no user valuation scenario or quant filter is
   * parsed or required; the response is the existing candidate decision-intake
   * envelope for this exact membership.
   */
  async runRegisteredValuation(): Promise<void> {
    const source = this.currentBoundSource();
    const writeAuth = this.dependencies.writeAuth();
    // A new run clears older derived valuation and conditional previews whose
    // quant evidence may have changed; user inputs and history are preserved.
    this.invalidateComputed("A registered quantitative research run is being submitted.");
    this.invalidateRegisteredQuant("A registered quantitative research run is being submitted.");
    const generation = this.generation;
    if (!writeAuth) return this.fail("registeredQuant", "unauthorized", "Runtime research-write authorization is required to run registered research.");
    if (!source) return this.fail("registeredQuant", "unavailable", "Load an exact non-archived membership first.");
    this.registeredQuant = lane("loading", "Running the registered quantitative research operation for the current source membership.");
    this.dependencies.render();
    const result = await this.api.runRegisteredValuationQuant(writeAuth, source);
    if (!this.responseIsCurrent(generation, source.sourceKey, writeAuth, this.dependencies.writeAuth())) return;
    if (!result.ok) return this.fail("registeredQuant", result.state, result.reason);
    this.registeredQuant = { state: "available", message: result.value.message, value: result.value };
    this.dependencies.render();
  }

  async loadConditional(inputs: AnnualConsoleInputs): Promise<void> {
    const source = this.currentBoundSource();
    const auth = this.dependencies.readAuth();
    this.invalidateComputed("Conditional preview inputs or source are being evaluated.");
    const generation = this.generation;
    if (!auth) return this.fail("conditional", "unauthorized", "Runtime read authorization is required for a conditional preview.");
    if (!source) return this.fail("conditional", "unavailable", "Load an exact non-archived membership and current decision context first.");
    this.conditional = lane("loading", "Loading a canonical conditional decision preview.");
    this.dependencies.render();
    const result = await this.api.loadConditionalPreview(auth, source, inputs);
    if (!this.responseIsCurrent(generation, source.sourceKey, auth, this.dependencies.readAuth())) return;
    if (!result.ok) return this.fail("conditional", result.state, result.reason);
    const identity = result.value.data?.decisionBrief.data?.sourceIdentity;
    if (!identity || identity.decisionContextId !== source.decisionContext.contextId || identity.decisionContextHash !== source.decisionContext.contextHash) {
      return this.fail("conditional", "conflict", "Conditional preview decision-context identity does not match the current Web source.");
    }
    this.conditional = { state: "available", message: result.value.message, value: result.value };
    this.conditionalBound = true;
    this.dependencies.render();
  }

  async decisionSubmission(judgment: AnnualConditionalJudgment): Promise<{
    conditionalDecision: AnnualConditionalDecisionSubmission;
    decisionSnapshotBinding: DecisionSnapshotBinding;
    humanCheckResult: "ready_to_consider" | "blocked" | "needs_more_evidence";
  } | null> {
    if (!this.conditionalBound) return null;
    const source = this.currentBoundSource();
    const preview = this.conditional.value;
    if (!source || this.conditional.state !== "available" || !preview) throw new Error("A current source-bound conditional preview is required.");
    const generation = this.generation;
    const conditionalDecision = { preview, judgment };
    const validation = await validateAnnualConditionalDecisionSubmissionForBrowser(conditionalDecision);
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    if (generation !== this.generation || this.currentBoundSource()?.sourceKey !== source.sourceKey || this.conditional.value !== preview) {
      throw new Error("Conditional preview source changed while the submission binding was being validated.");
    }
    const binding = conditionalDecisionSnapshotBindingFromPreview(preview);
    if (!binding) throw new Error("Conditional preview does not contain a current portfolio and selected risk binding.");
    return { conditionalDecision, decisionSnapshotBinding: binding, humanCheckResult: conditionalHumanCheckResult(judgment.workflowState) };
  }

  async matchesDecisionResponse(
    check: PreTradeDecisionCheckData,
    payload: { actionIntent: DecisionActionIntent; humanCheckResult: "ready_to_consider" | "blocked" | "needs_more_evidence"; userFinalDecision: string | null; conditionalDecision?: AnnualConditionalDecisionSubmission },
    binding: DecisionSnapshotBinding
  ): Promise<boolean> {
    return (await validateSubmittedDecisionResponse(check, payload, binding)).ok
      && this.currentBoundSource()?.sourceKey === this.sourceKey;
  }

  reviewLearningRequest(
    check: PreTradeDecisionCheckData,
    fields: Pick<AnnualReviewLearningRequest, "judgmentCorrection" | "processLesson" | "nextResearchQuestion">
  ): AnnualReviewLearningRequest | undefined {
    const conditional = check.conditionalDecision;
    if (conditional?.availability !== "preserved") return undefined;
    const snapshotId = check.decisionSnapshot?.availability === "preserved" ? check.decisionSnapshot.snapshot?.snapshotId : null;
    const previewId = conditional.preview?.previewId ?? null;
    if (!snapshotId || !previewId) throw new Error("Review learning requires the immutable decision snapshot and conditional preview identities.");
    const request: AnnualReviewLearningRequest = {
      schemaVersion: ANNUAL_REVIEW_LEARNING_SCHEMA_VERSION,
      decisionCheckId: check.id,
      decisionSnapshotId: snapshotId,
      conditionalPreviewId: previewId,
      judgmentCorrection: fields.judgmentCorrection.trim(),
      processLesson: fields.processLesson.trim(),
      nextResearchQuestion: fields.nextResearchQuestion?.trim() || null
    };
    const validation = validateAnnualReviewLearningRequest(request);
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    return request;
  }

  matchesReviewLearningResponse(review: PostDecisionReviewData, check: PreTradeDecisionCheckData, request?: AnnualReviewLearningRequest): boolean {
    return validateSubmittedReviewLearning(review, check, request).ok;
  }

  private validResearchSource(): InvestmentControlConsoleSource | null {
    const source = this.currentBoundSource();
    return source && source.research.data?.profile.symbol === source.symbol ? source : null;
  }

  private currentBoundSource(): InvestmentControlConsoleSource | null {
    const source = this.dependencies.currentSource();
    return source && source.sourceKey === this.sourceKey && source.membershipState !== "archived" ? source : null;
  }

  private responseIsCurrent(generation: number, sourceKey: string, auth: WebApiAuth, currentAuth: WebApiAuth | null): boolean {
    if (generation === this.generation && sourceKey === this.dependencies.currentSource()?.sourceKey && sameWebApiAuth(auth, currentAuth)) return true;
    this.fail("source", "conflict", "The response was hidden because authorization or source identity changed while the request was in flight.");
    return false;
  }

  private invalidateForResearchAttempt(message: string): void {
    this.generation += 1;
    this.conditionalBound = false;
    this.valuation = lane("idle", `${message} Prior valuation success was cleared.`);
    this.conditional = lane("idle", `${message} Prior conditional success was cleared.`);
  }

  private fail(target: "research" | "valuation" | "registeredQuant" | "conditional" | "source", state: WebFailureState, message: string): void {
    if (target === "research") this.research = lane(state, message);
    if (target === "valuation") this.valuation = lane(state, message);
    if (target === "registeredQuant") this.registeredQuant = lane(state, message);
    if (target === "conditional") { this.conditional = lane(state, message); this.conditionalBound = false; }
    if (target === "source") {
      this.research = lane(state, message);
      this.valuation = lane(state, `${message} Prior valuation success was cleared.`);
      this.registeredQuant = lane(state, `${message} Prior registered research evidence was cleared.`);
      this.conditional = lane(state, `${message} Prior conditional success was cleared.`);
      this.conditionalBound = false;
    }
    this.lastFailure = { lane: target, state, message };
    this.dependencies.render();
  }
}

function lane<T>(state: InvestmentConsoleLaneState, message: string): InvestmentConsoleLane<T> { return { state, message, value: null }; }
