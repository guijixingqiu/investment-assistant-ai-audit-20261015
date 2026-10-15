import type { PreTradeDecisionCheckData } from "../../../packages/contracts/src/decisionContextBrowser.js";
import type { DecisionReviewOutcome, PostDecisionReviewData } from "../../../packages/contracts/src/decisionReview.js";
import type { AnnualReviewLearningRequest } from "../../../packages/contracts/src/annualReviewLearning.js";
import type { ResearchReportDecisionBinding } from "../../../packages/contracts/src/researchReportDecision.js";
import { sameWebApiAuth, type WebApiAuth, type WebApiClient } from "./apiClient.js";
import type { PortfolioWorkspaceController } from "./portfolioWorkspaceController.js";
import type { CanonicalSecuritySymbol } from "./securitySymbol.js";
import { deriveCoreJourneyStages, type CoreJourneyData, type StageState } from "./coreJourneyState.js";
import type { DailyResearchCockpitBridge } from "./dailyResearchCockpitBridge.js";
import type { InvestmentControlConsoleCoordinator } from "./investmentControlConsoleCoordinator.js";
import { captureDecisionSubmissionIdentity, matchesDecisionSubmissionIdentity, type DecisionSubmissionIdentity } from "./decisionSubmission.js";

type ReviewForm = {
  outcome: DecisionReviewOutcome;
  outcomeEvidence: string | null;
  reviewNote: string | null;
  reviewLearning?: AnnualReviewLearningRequest;
};

type ReviewWriteResult = Awaited<ReturnType<WebApiClient["submitReview"]>>;

export type PostDecisionPortfolioReviewSubmissionResult =
  | (ReviewWriteResult & { clearHistory: boolean })
  | null;

export async function submitPostDecisionPortfolioReview(
  client: Pick<WebApiClient, "submitReview">,
  portfolio: Pick<PortfolioWorkspaceController, "load" | "postDecisionPortfolioReviewBinding" | "matchesPostDecisionPortfolioReviewBinding">,
  symbol: CanonicalSecuritySymbol,
  check: PreTradeDecisionCheckData,
  auth: () => WebApiAuth | null,
  form: ReviewForm,
  isCurrent: () => boolean,
  acceptsResponse: (review: PostDecisionReviewData) => boolean | Promise<boolean> = () => true,
  prepareDailyTrackingBinding?: () => Promise<ResearchReportDecisionBinding>
): Promise<PostDecisionPortfolioReviewSubmissionResult> {
  const submissionAuth = auth();
  if (!submissionAuth) {
    return {
      ok: false,
      state: "unauthorized",
      reason: "Runtime authorization is required before review submission.",
      clearHistory: false
    };
  }
  await portfolio.load();
  if (!isCurrent()) return null;

  let portfolioReviewBinding;
  try {
    portfolioReviewBinding = await portfolio.postDecisionPortfolioReviewBinding(check);
  } catch (error) {
    return {
      ok: false,
      state: "conflict",
      reason: error instanceof Error ? error.message : "Review-time portfolio facts could not be bound.",
      clearHistory: false
    };
  }

  if (!sameWebApiAuth(submissionAuth, auth())) {
    return {
      ok: false,
      state: "unauthorized",
      reason: "Runtime authorization changed before review submission.",
      clearHistory: false
    };
  }
  let dailyTrackingBinding: ResearchReportDecisionBinding | undefined;
  try {
    dailyTrackingBinding = await prepareDailyTrackingBinding?.();
  } catch (error) {
    return {
      ok: false,
      state: "conflict",
      reason: error instanceof Error ? error.message : "Daily tracking binding changed before review submission.",
      clearHistory: true
    };
  }
  if (!isCurrent()) return null;
  if (!sameWebApiAuth(submissionAuth, auth())) {
    return {
      ok: false,
      state: "unauthorized",
      reason: "Runtime authorization changed during the DAILY_TRACKING fresh recheck.",
      clearHistory: true
    };
  }
  const payload = {
    ...form,
    ...(portfolioReviewBinding ? { portfolioReviewBinding } : {}),
    ...(dailyTrackingBinding ? { dailyTrackingBinding } : {})
  };
  const result = await client.submitReview(symbol, check, submissionAuth, payload);
  if (!isCurrent()) return null;
  if (!sameWebApiAuth(submissionAuth, auth())) {
    return {
      ok: false,
      state: "conflict",
      reason: "The review response was hidden because runtime authorization changed while submission was in flight. Reload current facts before continuing.",
      clearHistory: true
    };
  }
  if (result.ok && !await portfolio.matchesPostDecisionPortfolioReviewBinding(check, portfolioReviewBinding)) {
    return {
      ok: false,
      state: "conflict",
      reason: "The review was recorded, but the visible review-time portfolio facts changed before confirmation. Refresh the current candidate before displaying that recorded review.",
      clearHistory: true
    };
  }
  if (result.ok && !await acceptsResponse(result.value)) {
    return {
      ok: false,
      state: "conflict",
      reason: "The review response did not match the submitted source-bound learning fields.",
      clearHistory: true
    };
  }
  return { ...result, clearHistory: !result.ok };
}

interface PostDecisionReviewSubmissionControllerDependencies {
  client: WebApiClient;
  portfolio: PortfolioWorkspaceController;
  dailyTracking: DailyResearchCockpitBridge;
  investment: InvestmentControlConsoleCoordinator;
  currentData: () => CoreJourneyData | null;
  auth: () => WebApiAuth | null;
  readAuth: () => WebApiAuth | null;
  readForm: () => Omit<ReviewForm, "reviewLearning">;
  currentGeneration: () => number;
  nextGeneration: () => number;
  setBusy: (busy: boolean) => void;
  paint: (stages?: StageState[], details?: string[]) => void;
  details: () => string[];
  onDailyTrackingReviewCompleted?: (history: NonNullable<CoreJourneyData["reviewHistory"]>, review: PostDecisionReviewData, check: PreTradeDecisionCheckData) => void;
}

export class PostDecisionReviewSubmissionController {
  private pendingDailyTracking: { data: CoreJourneyData; check: PreTradeDecisionCheckData; review: PostDecisionReviewData } | null = null;

  constructor(private readonly dependencies: PostDecisionReviewSubmissionControllerDependencies) {}

  async submit(): Promise<void> {
    const data = this.dependencies.currentData();
    if (!data?.submittedCheck || !this.dependencies.auth()) return;
    const check = data.submittedCheck;
    const dailyTracking = this.dependencies.dailyTracking.hasDailyTrackingReview();
    const pending = dailyTracking && this.pendingDailyTracking?.data === data && this.pendingDailyTracking.check === check
      ? this.pendingDailyTracking : null;
    if (!pending) this.pendingDailyTracking = null;
    let prepared;
    if (!pending) {
      try {
        prepared = this.dependencies.investment.prepareReview(check, this.dependencies.readForm());
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Review learning fields are malformed.";
        data.submittedReview = null;
        this.dependencies.paint([...deriveCoreJourneyStages(data).slice(0, 4), { id: "review", title: "Post-decision review", state: "malformed", message: reason }], [reason, ...this.dependencies.details()]);
        return;
      }
    }
    const generation = this.dependencies.nextGeneration();
    this.dependencies.setBusy(true);
    this.dependencies.paint(undefined, this.dependencies.details());
    const result: PostDecisionPortfolioReviewSubmissionResult = pending ? { ok: true, value: pending.review, clearHistory: false } : await submitPostDecisionPortfolioReview(
      this.dependencies.client,
      this.dependencies.portfolio,
      data.symbol,
      check,
      this.dependencies.auth,
      prepared!.payload,
      () => generation === this.dependencies.currentGeneration() && this.dependencies.currentData()?.submittedCheck === check,
      (review) => this.dependencies.investment.matchesReviewResponse(review, check, prepared!),
      dailyTracking ? () => this.dependencies.dailyTracking.prepareDailyTrackingReview(check) : undefined
    );
    if (!result || generation !== this.dependencies.currentGeneration()) return;
    this.dependencies.setBusy(false);
    if (!result.ok) {
      data.submittedReview = null;
      if (result.clearHistory) data.reviewHistory = null;
      this.dependencies.paint([...deriveCoreJourneyStages(data).slice(0, 4), { id: "review", title: "Post-decision review", state: result.state, message: result.reason }], [result.reason, ...this.dependencies.details()]);
      return;
    }
    if (dailyTracking && !pending) {
      this.pendingDailyTracking = { data, check, review: result.value };
      this.dependencies.dailyTracking.hideDailyTrackingReviewUntilReadback(result.value.id);
    }
    if (!dailyTracking) data.submittedReview = result.value;
    const historyRefresh = await this.refreshHistoryAfterWrite(data.symbol, generation);
    if (!historyRefresh || !this.matchesIdentity(historyRefresh.identity)) return;
    const historyRefreshMessage = historyRefresh.message;
    if (dailyTracking) {
      const history = data.reviewHistory;
      if (historyRefreshMessage || !history) {
        data.submittedReview = null;
        const recovery = `Review ${result.value.id} may have been written; the old Today action remains hidden. Use the same explicit submission to retry fresh history and Today resolved readback.`;
        this.dependencies.paint(undefined, [historyRefreshMessage ? `${recovery} ${historyRefreshMessage}` : recovery, ...this.dependencies.details()]);
        return;
      }
      try {
        await this.dependencies.dailyTracking.completeDailyTrackingReview(history, result.value, check);
      } catch (error) {
        data.submittedReview = null;
        this.dependencies.paint(undefined, [error instanceof Error ? error.message : "Daily tracking Today readback is UNKNOWN.", ...this.dependencies.details()]);
        return;
      }
      if (!this.matchesIdentity(historyRefresh.identity)) return;
      const currentAuth = this.dependencies.auth();
      if (!currentAuth) return;
      this.dependencies.client.confirmReviewSubmission(result.value, currentAuth);
      this.pendingDailyTracking = null;
      data.submittedReview = result.value;
      this.dependencies.onDailyTrackingReviewCompleted?.(history, result.value, check);
    }
    this.dependencies.paint(undefined, historyRefreshMessage ? [historyRefreshMessage, ...this.dependencies.details()] : this.dependencies.details());
  }

  async refreshHistoryAfterWrite(symbol: CoreJourneyData["symbol"], generation: number): Promise<{ message: string | null; identity: DecisionSubmissionIdentity } | null> {
    const expectedData = this.dependencies.currentData();
    if (!expectedData?.decisionContext) return null;
    const identity = captureDecisionSubmissionIdentity(generation, expectedData, this.sourceKey());
    const isCurrent = () => this.matchesIdentity(identity);
    const completed = (message: string | null) => ({
      message,
      identity: captureDecisionSubmissionIdentity(generation, expectedData, this.sourceKey())
    });
    const currentAuth = this.dependencies.readAuth();
    if (!currentAuth) {
      if (!isCurrent()) return null;
      expectedData.reviewHistory = null;
      return completed("Review history refresh failed: runtime authorization is required before reading append-only history.");
    }
    const result = await this.dependencies.client.loadDecisionReviewHistory(symbol, currentAuth);
    if (!isCurrent()) return null;
    if (!sameWebApiAuth(currentAuth, this.dependencies.readAuth())) {
      expectedData.reviewHistory = null;
      return completed("Review history refresh failed: runtime authorization changed while history was loading.");
    }
    if (!result.ok) {
      expectedData.reviewHistory = null;
      return completed(`Review history refresh failed: ${result.reason}`);
    }
    expectedData.reviewHistory = result.value;
    return completed(null);
  }

  private sourceKey(): string | null { return this.dependencies.investment.currentSource()?.sourceKey ?? null; }
  private matchesIdentity(identity: DecisionSubmissionIdentity): boolean {
    return matchesDecisionSubmissionIdentity(identity, {
      generation: this.dependencies.currentGeneration(),
      data: this.dependencies.currentData(),
      sourceKey: this.sourceKey()
    });
  }
}
