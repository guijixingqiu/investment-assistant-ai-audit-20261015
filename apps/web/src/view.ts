import type { CandidateOverviewRenderModel } from "./candidateOverviewState.js";
import { nextMembershipStates, type CandidateMembershipRenderModel } from "./candidateMembershipState.js";
import type { CandidateMembershipData } from "../../../packages/contracts/src/candidateMembership.js";
import type { DecisionReviewOutcome } from "../../../packages/contracts/src/decisionReview.js";
import type { DecisionActionIntent } from "../../../packages/contracts/src/research.js";
import { validateFormalOwnerDecisionInput, type FormalOwnerDecisionInput } from "../../../packages/contracts/src/formalDecision.js";
import type { CoreJourneyNextAction } from "./coreJourneyNextAction.js";
import type { StageState } from "./coreJourneyState.js";
import type { ReviewFeedbackCard } from "./reviewFeedback.js";

export interface RenderModel {
  stages: StageState[];
  symbol: string | null;
  details: string[];
  authMemoryOnly: boolean;
  decisionEnabled: boolean;
  reviewEnabled: boolean;
  busy: boolean;
  nextAction: CoreJourneyNextAction;
  reviewFeedback: ReviewFeedbackCard;
  candidateOverview: CandidateOverviewRenderModel;
  candidateBusy: boolean;
  candidateMemberships: CandidateMembershipRenderModel;
  membershipBusy: boolean;
}

export function render(model: RenderModel): void {
  setText("current-symbol", model.symbol ?? "尚未读取标的");
  setText("auth-mode", model.authMemoryOnly ? "鉴权仅保存在本次运行内存" : "尚未提供本次运行鉴权");
  const stages = byId("stages");
  stages.innerHTML = "";
  for (const stage of model.stages) {
    const item = document.createElement("li");
    item.className = `stage stage-${stage.state}`;
    item.dataset.testid = `stage-${stage.id}`;
    item.setAttribute("data-state", stage.state);
    item.innerHTML = `<strong>${escapeHtml(stageLabel(stage.id))}</strong><span>${escapeHtml(stateLabel(stage.state))}</span><p>${escapeHtml(stage.message)}</p>`;
    stages.append(item);
  }
  const nextAction = byId("next-action-card");
  nextAction.dataset.testid = "core-next-action-card";
  nextAction.setAttribute("data-kind", model.nextAction.kind);
  nextAction.setAttribute("data-operation", model.nextAction.operation);
  nextAction.setAttribute("data-enabled", String(model.nextAction.enabled));
  nextAction.setAttribute("data-source-stage", model.nextAction.sourceStage ?? "none");
  nextAction.innerHTML = [
    `<span>${escapeHtml(nextActionLabel(model.nextAction.kind))}</span>`,
    `<strong>${escapeHtml(model.nextAction.title)}</strong>`,
    `<p>${escapeHtml(model.nextAction.explanation)}</p>`
  ].join("");
  const reviewFeedback = byId("review-feedback-card");
  reviewFeedback.dataset.testid = "review-feedback-card";
  reviewFeedback.setAttribute("data-state", model.reviewFeedback.state);
  reviewFeedback.setAttribute("data-readonly", "true");
  reviewFeedback.innerHTML = [
    `<span>${escapeHtml(model.reviewFeedback.state)}</span>`,
    `<strong>${escapeHtml(model.reviewFeedback.title)}</strong>`,
    `<p>${escapeHtml(model.reviewFeedback.detail)}</p>`,
    `<ul>${model.reviewFeedback.items.map((item) => `<li data-kind="${escapeHtml(item.kind)}"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></li>`).join("")}</ul>`
  ].join("");
  const details = byId("details");
  details.innerHTML = "";
  for (const detail of model.details) {
    const item = document.createElement("li");
    item.textContent = detail;
    details.append(item);
  }
  setDisabled("load-action", model.busy);
  setDisabled("candidate-refresh", model.candidateBusy || model.busy);
  setDisabled("membership-refresh", model.membershipBusy || model.busy);
  setDisabled("membership-create", model.membershipBusy || model.busy);
  setDisabled("decision-submit", !model.decisionEnabled || model.busy);
  setDisabled("review-submit", !model.reviewEnabled || model.busy);
  renderCandidateOverview(model.candidateOverview);
  renderCandidateMemberships(model.candidateMemberships, model.membershipBusy || model.busy);
}

function stageLabel(id: StageState["id"]): string {
  return { quote: "行情", research: "研究证据", pingan: "平安历史组合背景", decision: "人工判断", review: "判断后复盘" }[id];
}

function stateLabel(state: StageState["state"]): string {
  return {
    loading: "读取中", ready: "已就绪", limited: "受限", stale: "已陈旧", empty: "暂无事实",
    unavailable: "不可用", unauthorized: "未授权", not_found: "未找到", conflict: "冲突",
    malformed: "格式错误", offline: "离线", completed: "已完成", pending: "待处理"
  }[state];
}

function nextActionLabel(kind: CoreJourneyNextAction["kind"]): string {
  return {
    fix_symbol: "修正标的", wait_for_load: "等待读取", reauthenticate: "补充鉴权", resolve_conflict: "处理冲突",
    retry_load: "重新读取", refresh_quote: "刷新行情", refresh_research: "刷新研究",
    continue_with_pingan_limitation: "带限制继续", submit_human_check: "提交人工判断",
    submit_review: "提交复盘", journey_complete: "本轮完成"
  }[kind];
}

export function readDecisionForm(requireFormalDecision = false): { actionIntent: DecisionActionIntent; humanCheckResult: "ready_to_consider" | "blocked" | "needs_more_evidence"; userFinalDecision: string | null; formalDecision?: FormalOwnerDecisionInput } {
  const actionIntent = (input(requireFormalDecision ? "formal-decision-action" : "decision-action").value || "watch") as DecisionActionIntent;
  const formalDecision = requireFormalDecision ? {
    reason: input("formal-decision-reason").value.trim(),
    horizon: input("formal-decision-horizon").value.trim(),
    priceConditions: input("formal-decision-price-conditions").value.trim(),
    positionRange: input("formal-decision-position-range").value.trim(),
    mainRisks: input("formal-decision-risks").value.trim(),
    invalidationConditions: input("formal-decision-invalidations").value.trim(),
    reviewOn: input("formal-decision-review-on").value,
    divergenceReason: nullable(input("formal-decision-divergence").value),
    positionBasis: "research_only" as const,
    personalRisk: {
      limits: {
        maxCandidateWeight: optionalNumber("formal-risk-candidate-weight", 100),
        maxLargestPositionWeight: optionalNumber("formal-risk-largest-weight", 100),
        maxPortfolioHhi: optionalNumber("formal-risk-hhi"),
        maxUnrealizedLossHkd: optionalNumber("formal-risk-loss-budget")
      },
      overrideReason: nullable(input("formal-risk-override-reason").value),
      secondConfirmed: false
    }
  } : undefined;
  if (formalDecision) {
    const validation = validateFormalOwnerDecisionInput(formalDecision, "formalDecision", true);
    if (!validation.ok) throw new Error(validation.errors.join("; "));
  }
  return {
    actionIntent,
    humanCheckResult: (input("decision-result").value || "needs_more_evidence") as "ready_to_consider" | "blocked" | "needs_more_evidence",
    userFinalDecision: formalDecision?.reason ?? nullable(input("decision-note").value),
    ...(formalDecision ? { formalDecision } : {})
  };
}

export function readReviewForm(): { outcome: DecisionReviewOutcome; outcomeEvidence: string | null; reviewNote: string | null } {
  return {
    outcome: (input("review-outcome").value || "insufficient_evidence") as DecisionReviewOutcome,
    outcomeEvidence: nullable(input("review-evidence").value),
    reviewNote: nullable(input("review-note").value)
  };
}

export function readCandidateMembershipCreateForm(): { code: string; initialState: "tracked" | "paused"; restoreArchived: boolean } {
  const state = input("membership-initial-state").value === "paused" ? "paused" : "tracked";
  return {
    code: input("membership-code").value.trim(),
    initialState: state,
    restoreArchived: checkbox("membership-restore-archived").checked
  };
}

export function input(id: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  return byId(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function optionalNumber(id: string, divisor = 1): number | null {
  const raw = input(id).value.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${id} must be a finite number`);
  return value / divisor;
}

function setText(id: string, text: string): void {
  byId(id).textContent = text;
}

function setDisabled(id: string, disabled: boolean): void {
  (byId(id) as HTMLButtonElement).disabled = disabled;
}

function renderCandidateOverview(model: CandidateOverviewRenderModel): void {
  const section = byId("candidate-overview");
  section.setAttribute("data-state", model.state);
  const status = byId("candidate-status");
  status.textContent = model.generatedAt ? `${model.message} Generated ${model.generatedAt}.` : model.message;
  const list = byId("candidate-list");
  list.innerHTML = "";
  if (model.candidates.length === 0) {
    const empty = document.createElement("li");
    empty.className = "candidate-empty";
    empty.dataset.testid = "candidate-empty-state";
    empty.textContent = `${model.state}: ${model.message}`;
    list.append(empty);
    return;
  }
  for (const candidate of model.candidates) {
    const item = document.createElement("li");
    item.className = `candidate-card quote-${candidate.quote.status}`;
    item.dataset.testid = "candidate-card";
    item.setAttribute("data-symbol", candidate.symbol);
    item.setAttribute("data-quote-state", candidate.quote.status);

    const title = document.createElement("strong");
    title.textContent = candidate.name ? `${candidate.symbol} ${candidate.name}` : candidate.symbol;

    const facts = document.createElement("dl");
    facts.append(
      fact("Research updated", candidate.researchUpdatedAt),
      fact("Next review", candidate.nextReviewOn ?? "not scheduled"),
      fact("Review due", candidate.reviewDue ? "yes" : "no"),
      fact("Evidence", String(candidate.evidenceCount)),
      fact("Latest evidence", candidate.latestEvidenceCapturedAt ?? "missing"),
      fact("Pending suggestions", String(candidate.pendingSuggestionCount)),
      fact("Quote", quoteLabel(candidate))
    );

    const action = document.createElement("button");
    action.type = "button";
    action.dataset.testid = "candidate-open";
    action.dataset.candidateSymbol = candidate.symbol;
    action.textContent = "Open";

    item.append(title, facts, action);
    list.append(item);
  }
}

function renderCandidateMemberships(model: CandidateMembershipRenderModel, busy: boolean): void {
  const section = byId("candidate-memberships");
  section.setAttribute("data-state", model.state);
  section.setAttribute("data-include-archived", String(model.includeArchived));
  section.setAttribute("data-action-state", model.action.state);
  const status = byId("membership-status");
  status.textContent = model.generatedAt ? `${model.message} Generated ${model.generatedAt}.` : model.message;
  const actionStatus = byId("membership-action-status");
  actionStatus.textContent = model.action.message;
  const list = byId("membership-list");
  list.innerHTML = "";
  if (model.memberships.length === 0) {
    const empty = document.createElement("li");
    empty.className = "membership-empty";
    empty.dataset.testid = "membership-empty-state";
    empty.textContent = `${model.state}: ${model.message}`;
    list.append(empty);
    return;
  }
  for (const membership of model.memberships) {
    const item = document.createElement("li");
    item.className = `membership-card membership-${membership.state} quote-${membership.quote.status} research-${membership.research.status}`;
    item.dataset.testid = "membership-card";
    item.setAttribute("data-membership-id", membership.id);
    item.setAttribute("data-symbol", membership.symbol);
    item.setAttribute("data-state", membership.state);
    item.setAttribute("data-version", String(membership.version));
    item.setAttribute("data-research-state", membership.research.status);
    item.setAttribute("data-quote-state", membership.quote.status);

    const title = document.createElement("strong");
    title.textContent = membership.research.name ? `${membership.symbol} ${membership.research.name}` : membership.symbol;

    const facts = document.createElement("dl");
    facts.append(
      fact("State", membership.state),
      fact("Version", String(membership.version)),
      fact("Updated", membership.updatedAt),
      fact("Archived", membership.archivedAt ?? "not archived"),
      fact("Research", membership.research.status === "available" ? `available; ${membership.research.profileUpdatedAt}` : "missing"),
      fact("Quote", membershipQuoteLabel(membership)),
      fact("Provenance", `${membership.provenance.membership}; ${membership.provenance.research}; ${membership.provenance.quotes}; portfolio ${membership.provenance.portfolio}`),
      fact("Safety", safetyLabel(membership))
    );

    const actions = document.createElement("div");
    actions.className = "membership-actions";
    const openResearch = document.createElement("button");
    openResearch.type = "button";
    openResearch.dataset.testid = "membership-open-research";
    openResearch.dataset.openResearchMembershipId = membership.id;
    openResearch.dataset.openResearchMembershipVersion = String(membership.version);
    openResearch.dataset.openResearchSymbol = membership.symbol;
    openResearch.disabled = busy || membership.state === "archived";
    openResearch.textContent = "Open Research";
    actions.append(openResearch);
    for (const state of nextMembershipStates(membership)) {
      const action = document.createElement("button");
      action.type = "button";
      action.dataset.testid = `membership-${state}`;
      action.dataset.membershipId = membership.id;
      action.dataset.membershipAction = state;
      action.dataset.membershipVersion = String(membership.version);
      action.disabled = busy;
      action.textContent = state === "tracked" && membership.state === "archived" ? "Restore tracked" : state[0].toUpperCase() + state.slice(1);
      actions.append(action);
    }

    item.append(title, facts, actions);
    list.append(item);
  }
}

function fact(label: string, value: string): HTMLElement {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  term.textContent = label;
  detail.textContent = value;
  wrapper.append(term, detail);
  return wrapper;
}

function quoteLabel(candidate: CandidateOverviewRenderModel["candidates"][number]): string {
  const source = candidate.quote.source ?? "missing source";
  const fetchedAt = candidate.quote.fetchedAt ?? "missing fetched time";
  const stale = candidate.quote.staleReason ? `; ${candidate.quote.staleReason}` : "";
  return `${candidate.quote.status}; ${source}; ${fetchedAt}${stale}`;
}

function membershipQuoteLabel(membership: CandidateMembershipData): string {
  const source = membership.quote.source ?? "missing source";
  const fetchedAt = membership.quote.fetchedAt ?? "missing fetched time";
  const stale = membership.quote.staleReason ? `; ${membership.quote.staleReason}` : "";
  return `${membership.quote.status}; ${source}; ${fetchedAt}${stale}`;
}

function safetyLabel(membership: CandidateMembershipData): string {
  const unsafe = Object.entries(membership.safety).filter(([, value]) => value !== false).map(([key]) => key);
  return unsafe.length === 0 ? "no orders, trades, cash, fees, positions, or broker calls" : `invalid side effects: ${unsafe.join(", ")}`;
}

function checkbox(id: string): HTMLInputElement {
  return byId(id) as HTMLInputElement;
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}
