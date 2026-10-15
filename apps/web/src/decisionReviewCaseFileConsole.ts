import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";
import {
  validateDecisionReviewHistoryEnvelope,
  type DecisionReviewDeletionData,
  type DecisionReviewHistoryEnvelope,
  type RecordedDecisionCheckReviewState
} from "../../../packages/contracts/src/decisionReview.js";
import {
  validateDeepResearchWorkspaceEnvelope,
  type DeepResearchDecisionData,
  type DeepResearchReportData,
  type DeepResearchWorkspaceEnvelope,
  type ResearchEvidencePackData
} from "../../../packages/contracts/src/deepResearch.js";
import type { ResearchReportDecisionBinding } from "../../../packages/contracts/src/researchReportDecision.js";
import { sameWebApiAuth, type WebApiAuth, type WebDecisionReviewHistoryResponse } from "./apiClient.js";
import { requestJson } from "./evidenceConflictData.js";
import type { CanonicalSecuritySymbol } from "./securitySymbol.js";

interface Dependencies {
  currentSymbol: () => CanonicalSecuritySymbol | null;
  readAuth: () => WebApiAuth | null;
  loadHistory: (symbol: CanonicalSecuritySymbol, auth: WebApiAuth) => Promise<WebDecisionReviewHistoryResponse>;
  installHistory: (history: DecisionReviewHistoryEnvelope | null) => void;
}

interface ReopenedReport {
  binding: ResearchReportDecisionBinding;
  report: DeepResearchReportData;
  pack: ResearchEvidencePackData;
  decision: DeepResearchDecisionData;
  generatedAt: string;
}

export class DecisionReviewCaseFileConsole {
  private documentRef: Document | null = null;
  private symbol = "";
  private history: DecisionReviewHistoryEnvelope | null = null;
  private reopened: ReopenedReport | null = null;
  private message = "Load a Hong Kong stock to read its append-only decision and review case file.";
  private generation = 0;
  private busy = false;

  constructor(private readonly dependencies: Dependencies) {}

  mount(documentRef: Document = document): void {
    this.documentRef = documentRef;
    this.element("decision-review-case-refresh")?.addEventListener("click", () => void this.refresh());
    this.element("decision-review-case-output")?.addEventListener("click", (event) => void this.reopen(event));
    this.sync(null);
  }

  sync(history: DecisionReviewHistoryEnvelope | null): void {
    const symbol = this.dependencies.currentSymbol()?.symbol ?? "";
    if (symbol !== this.symbol) {
      this.symbol = symbol;
      this.generation += 1;
      this.history = null;
      this.reopened = null;
      this.message = symbol ? "Refresh the exact append-only review case file." : "Load a Hong Kong stock to read its case file.";
    }
    if (!this.busy && history?.requestedSymbol === symbol) {
      if (this.history !== history) this.reopened = null;
      this.history = history;
    } else if (!this.busy && history === null) {
      this.history = null;
      this.reopened = null;
      if (symbol) this.message = "Refresh the exact append-only review case file.";
    }
    this.render();
  }

  invalidate(message: string): void {
    this.generation += 1;
    this.busy = false;
    this.history = null;
    this.reopened = null;
    this.message = `${message} Previous case-file facts were cleared.`;
    this.render();
  }

  private async refresh(): Promise<void> {
    await this.run("Case-file refresh", async (source, auth, generation) => {
      const history = await this.freshHistory(source, auth, generation);
      this.history = history;
      this.dependencies.installHistory(history);
      this.message = history.checks.length
        ? `Fresh append-only case file loaded: ${history.checks.length} decision check(s).`
        : history.message;
    });
  }

  private async reopen(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-review-report-binding]");
    if (!(button instanceof HTMLButtonElement) || !button.dataset.reviewReportBinding) return;
    const expectedKey = button.dataset.reviewReportBinding;
    await this.run("Historical report reopen", async (source, auth, generation) => {
      const history = await this.freshHistory(source, auth, generation);
      const binding = exactReportBinding(history, expectedKey);
      const workspace = await requestJson(
        `/api/mobile/research/candidate-memberships/${encodeURIComponent(binding.membershipId)}/deep-research`,
        auth,
        { cache: "no-store" }
      );
      this.ensureCurrent(source, auth, generation);
      this.reopened = acceptHistoricalReportReopen(workspace, binding, source);
      this.history = history;
      this.dependencies.installHistory(history);
      this.message = `Reopened exact report ${binding.reportId} v${binding.reportVersion} and its confirmed user decision. No current facts were substituted.`;
    });
  }

  private async freshHistory(
    source: CanonicalSecuritySymbol,
    auth: WebApiAuth,
    generation: number
  ): Promise<DecisionReviewHistoryEnvelope> {
    const result = await this.dependencies.loadHistory(source, auth);
    this.ensureCurrent(source, auth, generation);
    if (!result.ok) throw new Error(result.reason);
    return acceptCaseFileHistory(result.value, source);
  }

  private async run(
    label: string,
    action: (source: CanonicalSecuritySymbol, auth: WebApiAuth, generation: number) => Promise<void>
  ): Promise<void> {
    if (this.busy) return;
    const source = this.dependencies.currentSymbol();
    const auth = this.dependencies.readAuth();
    if (!source || !auth) {
      this.invalidate("A canonical symbol and research-read authorization are required.");
      return;
    }
    const generation = ++this.generation;
    this.busy = true;
    this.history = null;
    this.reopened = null;
    this.dependencies.installHistory(null);
    this.message = `${label} is fresh-reading exact identities…`;
    this.render();
    try { await action(source, auth, generation); }
    catch (error) {
      if (generation !== this.generation) return;
      this.history = null;
      this.reopened = null;
      this.dependencies.installHistory(null);
      this.message = `${label} blocked: ${error instanceof Error ? error.message : "case file unavailable"}. Old facts remain hidden.`;
    } finally {
      if (generation === this.generation) this.busy = false;
      this.render();
    }
  }

  private ensureCurrent(source: CanonicalSecuritySymbol, auth: WebApiAuth, generation: number): void {
    if (generation !== this.generation || this.dependencies.currentSymbol()?.symbol !== source.symbol
      || !sameWebApiAuth(auth, this.dependencies.readAuth())) {
      throw new Error("Symbol or authorization changed during the case-file read");
    }
  }

  private render(): void {
    if (!this.documentRef) return;
    const host = this.element("decision-review-case-file");
    if (host) host.dataset.state = this.busy ? "loading" : this.history ? "available" : this.symbol ? "idle" : "unavailable";
    this.setText("decision-review-case-status", this.message);
    const refresh = this.element("decision-review-case-refresh");
    if (refresh instanceof HTMLButtonElement) refresh.disabled = this.busy || !this.symbol;
    renderCaseFile(this.documentRef, this.element("decision-review-case-output"), this.history, this.reopened, this.busy);
  }

  private element(id: string): HTMLElement | null { return this.documentRef?.getElementById(id) ?? null; }
  private setText(id: string, value: string): void { const element = this.element(id); if (element) element.textContent = value; }
}

export function acceptCaseFileHistory(
  value: unknown,
  source: CanonicalSecuritySymbol
): DecisionReviewHistoryEnvelope {
  const validation = validateDecisionReviewHistoryEnvelope(value);
  if (!validation.ok) throw new Error(`Review history is malformed: ${validation.errors.join("; ")}`);
  const history = value as DecisionReviewHistoryEnvelope;
  if (history.requestedSymbol !== source.symbol || history.checks.some((check) => check.symbol !== source.symbol)) {
    throw new Error("Review history no longer binds the selected symbol");
  }
  return history;
}

export function acceptHistoricalReportReopen(
  value: unknown,
  binding: ResearchReportDecisionBinding,
  source: CanonicalSecuritySymbol
): ReopenedReport {
  const validation = validateDeepResearchWorkspaceEnvelope(value);
  if (!validation.ok) throw new Error(`Deep Research workspace is malformed: ${validation.errors.join("; ")}`);
  const workspace = value as DeepResearchWorkspaceEnvelope;
  const target = workspace.data?.target;
  if (workspace.status !== "available" || !target || workspace.requestedSymbol !== source.symbol
    || workspace.membershipId !== binding.membershipId || target.membershipId !== binding.membershipId
    || target.symbol !== source.symbol || binding.symbol !== source.symbol
    || workspace.requestedActorId !== binding.reportDecisionActorId) {
    throw new Error("Historical report workspace no longer binds the exact actor, membership, or symbol");
  }
  const reports = workspace.data!.reports.filter((report) => report.id === binding.reportId
    && report.version === binding.reportVersion && report.evidencePackId === binding.evidencePackId
    && report.contractVersion === binding.contractVersion && report.reportFingerprint === binding.reportFingerprint);
  const packs = workspace.data!.evidencePacks.filter((pack) => pack.id === binding.evidencePackId
    && pack.membershipId === binding.membershipId && pack.membershipVersion === binding.membershipVersion
    && pack.symbol === binding.symbol && pack.packFingerprint === binding.evidencePackFingerprint);
  const decisions = workspace.data!.decisions.filter((decision) => decision.id === binding.reportDecisionId
    && decision.reportId === binding.reportId && decision.decision === binding.reportDecision
    && decision.actorType === binding.reportDecisionActorType && decision.actorId === binding.reportDecisionActorId
    && decision.decidedAt === binding.decidedAt);
  if (reports.length !== 1 || packs.length !== 1 || decisions.length !== 1) {
    throw new Error("Exact historical report, evidence pack, or confirmed decision is absent or ambiguous");
  }
  return { binding, report: reports[0], pack: packs[0], decision: decisions[0], generatedAt: workspace.generatedAt };
}

function exactReportBinding(history: DecisionReviewHistoryEnvelope, key: string): ResearchReportDecisionBinding {
  const matches = history.checks.flatMap((check) => check.researchReportDecision.availability === "preserved"
    && caseFileBindingKey(check.researchReportDecision.binding) === key ? [check.researchReportDecision.binding] : []);
  if (matches.length !== 1) throw new Error("Historical report binding changed, disappeared, or became ambiguous");
  return matches[0];
}

function caseFileBindingKey(binding: ResearchReportDecisionBinding): string { return canonicalJson(binding); }

function renderCaseFile(
  documentRef: Document,
  output: HTMLElement | null,
  history: DecisionReviewHistoryEnvelope | null,
  reopened: ReopenedReport | null,
  busy: boolean
): void {
  if (!output) return;
  output.replaceChildren();
  if (!history) { output.textContent = "No fresh decision/review case file is displayed."; return; }
  const identity = documentRef.createElement("p");
  identity.textContent = `${history.requestedSymbol} · ${history.checks.length} checks · source ${history.metadata.source} · as of ${history.metadata.asOf ?? "UNKNOWN"} · freshness ${history.metadata.freshness}`;
  output.append(identity);
  for (const check of history.checks) output.append(renderCheck(documentRef, check, history.checks, busy));
  for (const deletion of history.deletions ?? []) {
    const receipt = documentRef.createElement("p");
    receipt.textContent = decisionReviewDeletionSummary(deletion);
    output.append(receipt);
  }
  if (reopened) output.append(renderReopenedReport(documentRef, reopened));
  const safety = documentRef.createElement("p");
  safety.textContent = "Read-only historical case file. Missing snapshots are not reconstructed from current facts; no decision, portfolio, broker, order, or trade is changed.";
  output.append(safety);
}

export function decisionReviewDeletionSummary(deletion: DecisionReviewDeletionData): string {
  return `删除凭证 ${deletion.kind} · check ${deletion.decisionCheckId} · review ${deletion.reviewId ?? "not_applicable"} · recorded ${deletion.recordedAt} · deleted ${deletion.deletedAt} · ${deletion.state}`;
}

export function formalDecisionContinuitySummary(
  check: RecordedDecisionCheckReviewState,
  checks: RecordedDecisionCheckReviewState[],
  now = new Date()
): string | null {
  const formal = checks.filter((candidate) => candidate.researchReportDecision.availability === "preserved"
    && candidate.formalDecision.availability === "preserved");
  if (!formal.includes(check) || formal.length === 0) return null;
  const latest = [...formal].sort((left, right) => Date.parse(right.checkedAt) - Date.parse(left.checkedAt)
    || right.id.localeCompare(left.id))[0];
  if (latest.id !== check.id) return `已被正式决定 #${latest.id} 替代`;
  const review = [...check.reviews].sort((left, right) => Date.parse(right.reviewedAt) - Date.parse(left.reviewedAt)
    || right.id.localeCompare(left.id))[0];
  if (review && (review.outcome === "thesis_weakened" || review.outcome === "thesis_invalidated")) {
    return `当前正式决定已${review.outcome === "thesis_invalidated" ? "失效" : "弱化"} · 等待 Owner 新决定`;
  }
  const reviewOn = check.formalDecision.availability === "preserved"
    ? Date.parse(`${check.formalDecision.ownerDecision.reviewOn}T00:00:00`)
    : Number.NaN;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (Number.isFinite(reviewOn) && reviewOn <= today && (!review || Date.parse(review.reviewedAt) < reviewOn)) {
    return "当前正式决定 · 复核日期已到";
  }
  if (!review) return "当前正式决定 · 待复盘";
  return `当前正式决定 · 已复盘 · ${review.outcome}`;
}

function renderCheck(
  documentRef: Document,
  check: RecordedDecisionCheckReviewState,
  checks: RecordedDecisionCheckReviewState[],
  busy: boolean
): HTMLElement {
  const details = documentRef.createElement("details");
  const summary = documentRef.createElement("summary");
  summary.textContent = `Check ${check.id} · ${check.humanCheckResult} · ${check.checkedAt}${check.reviewDueOn ? ` · 复盘 ${check.reviewDueOn}（香港时间）` : ""} · ${check.reviews.length} review(s)`;
  const headline = documentRef.createElement("p");
  headline.textContent = `Intent ${check.actionIntent} · context ${check.contextId}/${check.contextHash} · final note ${check.userFinalDecision ?? "not captured"}`;
  const snapshots = documentRef.createElement("p");
  snapshots.textContent = `Decision snapshot ${check.decisionSnapshot.availability} · conditional decision ${check.conditionalDecision.availability} · report binding ${check.researchReportDecision.availability}`;
  details.append(summary);
  const continuity = formalDecisionContinuitySummary(check, checks);
  if (continuity) {
    const status = documentRef.createElement("p");
    status.textContent = continuity;
    details.append(status);
  }
  details.append(headline, snapshots);
  if (check.researchReportDecision.availability === "preserved") {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.dataset.reviewReportBinding = caseFileBindingKey(check.researchReportDecision.binding);
    button.disabled = busy;
    button.textContent = `Reopen exact historical report ${check.researchReportDecision.binding.reportId} v${check.researchReportDecision.binding.reportVersion}`;
    details.append(button);
  }
  for (const review of check.reviews) {
    const reviewDetails = documentRef.createElement("details");
    const reviewSummary = documentRef.createElement("summary");
    reviewSummary.textContent = `Review ${review.id} · ${review.outcome} · ${review.reviewedAt}`;
    const learning = review.reviewLearning.snapshot;
    const portfolio = review.portfolioReview.snapshot;
    const reviewText = documentRef.createElement("p");
    reviewText.textContent = `Evidence ${review.outcomeEvidence ?? "not captured"} · note ${review.reviewNote ?? "not captured"}`;
    const preserved = documentRef.createElement("p");
    preserved.textContent = `Portfolio ${portfolio ? `${portfolio.comparison.status}/${portfolio.comparison.comparisonId}` : review.portfolioReview.limitation} · learning ${learning ? `${learning.judgmentCorrection} / ${learning.processLesson} / next: ${learning.nextResearchQuestion ?? "not captured"}` : review.reviewLearning.limitation}`;
    reviewDetails.append(reviewSummary, reviewText, preserved);
    details.append(reviewDetails);
  }
  const exact = documentRef.createElement("details");
  const exactSummary = documentRef.createElement("summary");
  exactSummary.textContent = "Exact frozen record and identities";
  const pre = documentRef.createElement("pre");
  pre.textContent = JSON.stringify(check, null, 2);
  exact.append(exactSummary, pre);
  details.append(exact);
  return details;
}

function renderReopenedReport(documentRef: Document, reopened: ReopenedReport): HTMLElement {
  const details = documentRef.createElement("details");
  details.open = true;
  const summary = documentRef.createElement("summary");
  summary.textContent = `Reopened report ${reopened.report.id} v${reopened.report.version} · ${reopened.report.currentness.status}`;
  const thesis = documentRef.createElement("p");
  thesis.textContent = `Frozen conclusion/thesis: ${reportConclusion(reopened.report)}`;
  const identity = documentRef.createElement("p");
  identity.textContent = `Pack ${reopened.pack.id}/${reopened.pack.packFingerprint} · decision ${reopened.decision.id} confirmed by ${reopened.decision.actorId} at ${reopened.decision.decidedAt} · fresh read ${reopened.generatedAt}`;
  const exact = documentRef.createElement("pre");
  exact.textContent = JSON.stringify({ binding: reopened.binding, report: reopened.report, pack: reopened.pack, decision: reopened.decision }, null, 2);
  details.append(summary, thesis, identity, exact);
  return details;
}

function reportConclusion(report: DeepResearchReportData): string {
  const payload = report.payload as DeepResearchReportData["payload"] & { adviceLayer?: { conclusion?: string } };
  return payload.adviceLayer?.conclusion ?? payload.investmentThesis;
}
