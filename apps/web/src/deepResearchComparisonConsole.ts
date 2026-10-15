import type { AnnualConditionalFactChange } from "../../../packages/contracts/src/annualConditionalDecisionContract.js";
import type { CandidateMembershipData } from "../../../packages/contracts/src/candidateMembership.js";
import type {
  DecisionReviewHistoryEnvelope,
  PostDecisionReviewData,
  RecordedDecisionCheckReviewState
} from "../../../packages/contracts/src/decisionReview.js";
import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";
import { isRfc3339DateTime } from "../../../packages/contracts/src/factMetadata.js";
import {
  validateDeepResearchWorkspaceEnvelope,
  type DeepResearchReportData,
  type DeepResearchWorkspaceEnvelope
} from "../../../packages/contracts/src/deepResearch.js";
import type { ExactCockpitMembership } from "./dailyResearchCockpit.js";
import {
  deepResearchReportFullDetails,
  selectedDeepResearchReportSummary,
  type DeepResearchReportSummary
} from "./deepResearchReportSummary.js";
import { reportDocumentCitationsForSelection, type ReportDocumentCitation } from "./researchDocumentValidation.js";
import { sameWebApiAuth, type WebApiAuth, type WebDecisionReviewHistoryResponse } from "./apiClient.js";

interface ComparisonSide {
  membership: CandidateMembershipData;
  workspace: DeepResearchWorkspaceEnvelope;
  history: DecisionReviewHistoryEnvelope | null;
  historyMessage: string;
}

export class DeepResearchComparisonConsole {
  private documentRef: Document | null = null;
  private left: ComparisonSide | null = null;
  private right: ComparisonSide | null = null;
  private busy = false;
  private generation = 0;
  private membershipSignature = "";
  private message = "选择两个不同的当前 membership 后读取精确报告版本。";

  constructor(private readonly dependencies: {
    memberships: () => CandidateMembershipData[];
    refreshMemberships: () => Promise<void>;
    readAuth: () => WebApiAuth | null;
    loadDecisionReviewHistory: (membership: CandidateMembershipData, auth: WebApiAuth) => Promise<WebDecisionReviewHistoryResponse>;
    openDeepResearch: (membership: ExactCockpitMembership) => Promise<void>;
    openDecisionReview: (membership: ExactCockpitMembership) => Promise<void>;
    openCitation: (membership: ExactCockpitMembership, citation: ReportDocumentCitation) => Promise<void>;
    fetcher?: typeof fetch;
  }) {}

  mount(documentRef: Document = document): void {
    this.documentRef = documentRef;
    this.element("deep-compare-load")?.addEventListener("click", () => void this.load());
    for (const id of ["deep-compare-left-membership", "deep-compare-right-membership"]) {
      this.element(id)?.addEventListener("change", () => this.clear("股票选择已变化；旧比较已清除。"));
    }
    for (const id of ["deep-compare-left-report", "deep-compare-right-report"]) {
      this.element(id)?.addEventListener("change", () => this.render());
    }
    this.element("deep-research-comparison-console")?.addEventListener("click", (event) => void this.route(event));
    this.syncMemberships();
  }

  syncMemberships(): void {
    const memberships = this.dependencies.memberships().filter((item) => item.state !== "archived");
    const signature = JSON.stringify(memberships.map((item) => [item.id, item.version, item.symbol, item.state]));
    if (signature === this.membershipSignature) return;
    this.membershipSignature = signature;
    this.generation += 1;
    this.busy = false;
    this.left = null;
    this.right = null;
    this.clearReportSelections();
    for (const [id, offset] of [["deep-compare-left-membership", 0], ["deep-compare-right-membership", 1]] as const) {
      const select = this.element(id);
      if (!(select instanceof HTMLSelectElement)) continue;
      const previous = select.value;
      select.replaceChildren(...memberships.map((membership) => option(this.documentRef!, membership)));
      select.value = memberships.some((item) => item.id === previous) ? previous : memberships[offset]?.id ?? "";
    }
    this.message = memberships.length >= 2
      ? "选择两个不同的当前 membership 后读取精确报告版本。"
      : "至少需要两个当前 membership 才能比较报告。";
    this.render();
  }

  private async load(): Promise<void> {
    if (this.busy) return;
    const reportSelections = {
      left: this.select("deep-compare-left-report").value,
      right: this.select("deep-compare-right-report").value
    };
    this.busy = true;
    const token = ++this.generation;
    this.left = null;
    this.right = null;
    this.message = "正在 fresh-read 两个 membership 和报告历史…";
    this.render();
    try {
      await this.dependencies.refreshMemberships();
      if (token !== this.generation) return;
      const auth = this.dependencies.readAuth();
      const memberships = this.dependencies.memberships().filter((item) => item.state !== "archived");
      const leftMembership = exactMembership(memberships, this.select("deep-compare-left-membership").value);
      const rightMembership = exactMembership(memberships, this.select("deep-compare-right-membership").value);
      if (!auth) throw new Error("Read authorization is required.");
      if (leftMembership.id === rightMembership.id) throw new Error("请选择两个不同的 membership。");
      const [leftValue, rightValue, leftHistory, rightHistory] = await Promise.all([
        this.readWorkspace(leftMembership.id, auth),
        this.readWorkspace(rightMembership.id, auth),
        this.dependencies.loadDecisionReviewHistory(leftMembership, auth),
        this.dependencies.loadDecisionReviewHistory(rightMembership, auth)
      ]);
      if (token !== this.generation || !sameWebApiAuth(auth, this.dependencies.readAuth())) {
        throw new Error("Membership or authorization changed while reports were loading.");
      }
      this.left = comparisonSide(leftMembership, acceptComparisonWorkspace(leftValue, leftMembership), leftHistory);
      this.right = comparisonSide(rightMembership, acceptComparisonWorkspace(rightValue, rightMembership), rightHistory);
      this.installReports("left", this.left, reportSelections.left);
      this.installReports("right", this.right, reportSelections.right);
      this.message = "已读取两个精确 membership 的不可变报告历史；请选择版本比较或回到单股工作区。";
    } catch (error) {
      if (token === this.generation) this.message = error instanceof Error ? error.message : "报告比较读取失败。";
    } finally {
      if (token === this.generation) {
        this.busy = false;
        this.render();
      }
    }
  }

  private async route(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLElement) || this.busy) return;
    const button = target.closest<HTMLButtonElement>("button[data-compare-side]");
    if (!button) return;
    const side = button.dataset.compareSide === "left" ? this.left : this.right;
    if (!side) return;
    try {
      this.busy = true;
      this.render();
      const membership = exactIdentity(side.membership);
      const citationKey = button.dataset.citationKey;
      let actionMessage: string | null = null;
      if (citationKey) {
        const report = this.selectedReport(button.dataset.compareSide === "left" ? "left" : "right", side);
        const citations = reportDocumentCitationsForSelection(side.workspace, membership, reportIdentity(report));
        const citation = citations.find((item) => item.key === citationKey);
        if (!citation) throw new Error("所选报告引用身份已变化。");
        await this.dependencies.openCitation(membership, citation);
      } else if (button.dataset.thenReportCheckId) {
        const name = button.dataset.compareSide === "left" ? "left" : "right";
        const check = side.history?.checks.find((item) => item.id === button.dataset.thenReportCheckId);
        if (!check) throw new Error("该历史决定已不在当前读取的历史结果中，请重新读取报告历史。");
        this.select(`deep-compare-${name}-report`).value = historicalCheckReportKey(side, check);
        actionMessage = `已在${name === "left" ? "左侧" : "右侧"}打开决定 #${check.id} 当时绑定的报告版本；这是历史只读回溯，不改动当前报告、组合或现金事实。`;
      } else if (button.dataset.compareAction === "decision-review") {
        await this.dependencies.openDecisionReview(membership);
      } else {
        await this.dependencies.openDeepResearch(membership);
      }
      this.message = actionMessage ?? (button.dataset.compareAction === "decision-review"
        ? `已进入 ${membership.symbol} 的现有决定与复盘工作区；提交仍需 Owner 明确点击。`
        : `已进入 ${membership.symbol} 的现有单股 Deep Research 操作区；任务动作仍需 Owner 明确点击。`);
    } catch (error) {
      this.message = error instanceof Error ? error.message : "无法打开精确 Research 来源。";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private render(): void {
    if (!this.documentRef) return;
    const host = this.element("deep-research-comparison-console");
    if (host) host.dataset.state = this.busy ? "loading" : this.left && this.right ? "available" : "idle";
    this.text("deep-compare-status", this.message);
    const load = this.element("deep-compare-load");
    if (load instanceof HTMLButtonElement) load.disabled = this.busy || this.dependencies.memberships().filter((item) => item.state !== "archived").length < 2;
    this.renderSide("left", this.left);
    this.renderSide("right", this.right);
    this.renderDiff();
  }

  private renderDiff(): void {
    const output = this.element("deep-compare-diff-output");
    if (!output) return;
    output.replaceChildren();
    if (!this.left || !this.right) { output.textContent = "明确选择两侧报告后显示结构化差异。"; return; }
    try {
      const left = selectedDeepResearchReportSummary(this.left.workspace.data, reportIdentity(this.selectedReport("left", this.left)));
      const right = selectedDeepResearchReportSummary(this.right.workspace.data, reportIdentity(this.selectedReport("right", this.right)));
      if (!left || !right) throw new Error("所选报告身份已变化。请重新读取后比较。");
      const comparison = compareDeepResearchReportSummaries(left, right);
      const heading = this.documentRef!.createElement("h4");
      heading.textContent = `${this.left.membership.symbol} ↔ ${this.right.membership.symbol} 结构化差异`;
      const sourceLimits = [
        comparisonWorkspaceFreshnessLine(this.left.membership.symbol, this.left.workspace),
        comparisonWorkspaceFreshnessLine(this.right.membership.symbol, this.right.workspace)
      ].filter((value): value is string => value !== null);
      const sourceState = this.documentRef!.createElement("p");
      sourceState.textContent = sourceLimits.join("；");
      const changed = this.documentRef!.createElement("p");
      changed.textContent = `不同：${comparison.changed.join("、") || "未发现结构化差异"}`;
      const unchanged = this.documentRef!.createElement("p");
      unchanged.textContent = `相同：${comparison.unchanged.join("、") || "无"}`;
      const limitations = comparison.limitations.length > 0 ? this.documentRef!.createElement("p") : null;
      if (limitations) {
        limitations.dataset.compareLimitations = "available";
        limitations.textContent = `可比性限制：${comparison.limitations.join("；")}`;
      }
      const boundary = this.documentRef!.createElement("p");
      boundary.textContent = "两边保留各自 cutoff、pack 与 fingerprint；内容相同或不同不代表投资优劣；各家公司的财务期间、指标定义与币种保持独立，仍需逐项核对，本比较不代表跨公司指标可比，价格文字未作数值比较；差异只供研究，不表示排名或交易方向。可暂不选择，保留现金，先核实关键条件；本比较不生成交易信号，也不改动任何组合或现金事实。";
      output.append(heading, ...(sourceLimits.length > 0 ? [sourceState] : []), ...(limitations ? [limitations] : []), changed, unchanged, boundary);
    } catch (error) {
      output.textContent = error instanceof Error ? error.message : "所选报告暂不可比较。";
    }
  }

  private renderSide(name: "left" | "right", side: ComparisonSide | null): void {
    const output = this.element(`deep-compare-${name}-output`);
    if (!output) return;
    output.replaceChildren();
    if (!side) { output.textContent = "尚未读取报告。"; return; }
    const open = this.documentRef!.createElement("button");
    open.type = "button";
    open.dataset.compareSide = name;
    open.textContent = `进入 ${side.membership.symbol} Deep Research 操作区`;
    open.disabled = this.busy;
    let report: DeepResearchReportData;
    try { report = this.selectedReport(name, side); } catch (error) {
      output.textContent = error instanceof Error ? error.message : "所选报告不可用。";
      output.append(open);
      return;
    }
    const summary = selectedDeepResearchReportSummary(side.workspace.data, reportIdentity(report));
    if (!summary) { output.textContent = "报告或证据包精确身份不可用。"; output.append(open); return; }
    const sourceLimit = comparisonWorkspaceFreshnessLine(side.membership.symbol, side.workspace);
    if (sourceLimit) {
      const warning = this.documentRef!.createElement("p");
      warning.textContent = sourceLimit;
      output.append(warning);
    }
    output.append(...summaryNodes(this.documentRef!, side.membership, summary));
    output.append(deepResearchReportFullDetails(this.documentRef!, summary));
    if (side.history) output.append(...historyNodes(this.documentRef!, side.history, name, this.busy));
    else {
      const history = this.documentRef!.createElement("p");
      history.textContent = side.historyMessage;
      output.append(history);
    }
    output.append(open);
    const decisionReview = this.documentRef!.createElement("button");
    decisionReview.type = "button";
    decisionReview.dataset.compareSide = name;
    decisionReview.dataset.compareAction = "decision-review";
    decisionReview.textContent = `进入 ${side.membership.symbol} 决定与复盘`;
    decisionReview.disabled = this.busy;
    output.append(decisionReview);
    for (const citation of reportDocumentCitationsForSelection(side.workspace, exactIdentity(side.membership), reportIdentity(report))) {
      const button = this.documentRef!.createElement("button");
      button.type = "button";
      button.dataset.compareSide = name;
      button.dataset.citationKey = citation.key;
      button.textContent = `重开 PDF #${citation.documentId} 第 ${citation.pageNumber} 页 · ${citation.statement}`;
      button.disabled = this.busy;
      output.append(button);
    }
  }

  private installReports(name: "left" | "right", side: ComparisonSide, previousSelection: string): void {
    const select = this.select(`deep-compare-${name}-report`);
    const reports = availableReports(side.workspace);
    const placeholder = this.documentRef!.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "明确选择一个报告版本";
    select.replaceChildren(placeholder, ...reports.map((report) => {
      const node = this.documentRef!.createElement("option");
      node.value = reportKey(report);
      node.textContent = `${side.membership.symbol} · report #${report.id} v${report.version} · cutoff ${report.payload.cutoffAt}`;
      return node;
    }));
    select.value = reports.some((report) => reportKey(report) === previousSelection) ? previousSelection : "";
  }

  private selectedReport(name: "left" | "right", side: ComparisonSide): DeepResearchReportData {
    const key = this.select(`deep-compare-${name}-report`).value;
    if (!key) throw new Error("请明确选择一个精确报告版本后再比较。");
    const reports = availableReports(side.workspace).filter((report) => reportKey(report) === key);
    if (reports.length !== 1) throw new Error("所选精确报告版本不存在或已变化。");
    return reports[0];
  }

  private async readWorkspace(id: string, auth: WebApiAuth): Promise<unknown> {
    const response = await (this.dependencies.fetcher ?? fetch)(
      `/api/mobile/research/candidate-memberships/${encodeURIComponent(id)}/deep-research`,
      { cache: "no-store", headers: { [auth.headerName]: auth.token } }
    );
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Deep Research workspace fresh read failed (${response.status}).`);
    return value;
  }

  private clear(message: string): void {
    this.generation += 1; this.busy = false; this.left = null; this.right = null;
    this.clearReportSelections(); this.message = message; this.render();
  }
  private clearReportSelections(): void {
    for (const id of ["deep-compare-left-report", "deep-compare-right-report"]) {
      const select = this.element(id); if (select instanceof HTMLSelectElement) select.replaceChildren();
    }
  }
  private element(id: string): HTMLElement | null { return this.documentRef?.getElementById(id) ?? null; }
  private select(id: string): HTMLSelectElement { const value = this.element(id); if (!(value instanceof HTMLSelectElement)) throw new Error(`${id} is unavailable.`); return value; }
  private text(id: string, value: string): void { const node = this.element(id); if (node) node.textContent = value; }
}

export function acceptComparisonWorkspace(value: unknown, membership: CandidateMembershipData): DeepResearchWorkspaceEnvelope {
  const validation = validateDeepResearchWorkspaceEnvelope(value);
  if (!validation.ok) throw new Error(`Deep Research workspace is malformed: ${validation.errors.join("; ")}`);
  const workspace = value as DeepResearchWorkspaceEnvelope;
  const target = workspace.data?.target;
  if (workspace.status !== "available" || !target || workspace.requestedActorId !== membership.actorId
    || workspace.membershipId !== membership.id || workspace.requestedSymbol !== membership.symbol
    || target.membershipId !== membership.id || target.membershipVersion !== membership.version
    || target.membershipState !== membership.state || target.symbol !== membership.symbol) {
    throw new Error("Deep Research workspace no longer binds the exact current membership.");
  }
  return workspace;
}

function availableReports(workspace: DeepResearchWorkspaceEnvelope): DeepResearchReportData[] {
  return [...(workspace.data?.reports ?? [])]
    .filter((report) => selectedDeepResearchReportSummary(workspace.data, reportIdentity(report)) !== null)
    .sort((left, right) => right.version - left.version || Number(right.id) - Number(left.id));
}
function exactMembership(memberships: CandidateMembershipData[], id: string): CandidateMembershipData {
  const matches = memberships.filter((item) => item.id === id && item.state !== "archived");
  if (matches.length !== 1) throw new Error("Fresh memberships no longer contain one exact active selection.");
  return matches[0];
}
function exactIdentity(value: CandidateMembershipData): ExactCockpitMembership { return { id: value.id, version: value.version, symbol: value.symbol }; }
function reportIdentity(report: DeepResearchReportData) { return { id: report.id, version: report.version, reportFingerprint: report.reportFingerprint }; }
function reportKey(report: DeepResearchReportData): string { return JSON.stringify([report.id, report.version, report.reportFingerprint]); }

/**
 * 把一条已保存的历史决定精确映射回当前加载工作区里的同一份报告版本。
 * 只用保存时的 binding 做全字段匹配：membership id/version/symbol、report id/version/contract/fingerprint、pack id/fingerprint。
 * 缺失、已删除或身份变化的报告一律视为不可用，不用最新报告替代，也不要求报告 currentness 为 current（历史只读回溯允许 historical）。
 */
export function historicalCheckReportKey(side: ComparisonSide, check: RecordedDecisionCheckReviewState): string {
  const binding = check.researchReportDecision.availability === "preserved" ? check.researchReportDecision.binding : null;
  if (!binding) throw new Error(`决定 #${check.id} 未保存报告绑定，无法定位当时报告（不作重建，也不以最新报告替代）。`);
  if (binding.membershipId !== side.membership.id || binding.membershipVersion !== side.membership.version
    || binding.symbol !== side.membership.symbol) {
    throw new Error(`决定 #${check.id} 绑定的 membership 身份与当前加载的工作区不一致，不打开报告。`);
  }
  const data = side.workspace.data;
  const reports = (data?.reports ?? []).filter((report) => report.id === binding.reportId
    && report.version === binding.reportVersion && report.reportFingerprint === binding.reportFingerprint
    && report.contractVersion === binding.contractVersion && report.evidencePackId === binding.evidencePackId);
  const report = reports.length === 1 ? reports[0] : null;
  const packs = (data?.evidencePacks ?? []).filter((pack) => pack.id === binding.evidencePackId
    && pack.packFingerprint === binding.evidencePackFingerprint);
  if (!report || packs.length !== 1 || !selectedDeepResearchReportSummary(data, reportIdentity(report))) {
    throw new Error(`决定 #${check.id} 当时绑定的报告 report #${binding.reportId} v${binding.reportVersion} 已不在当前加载的历史工作区中（可能已删除或身份已变化）；不以下一版或最新报告替代。`);
  }
  return reportKey(report);
}
function option(documentRef: Document, membership: CandidateMembershipData): HTMLOptionElement {
  const node = documentRef.createElement("option");
  node.value = membership.id;
  node.textContent = `${membership.symbol} · membership ${membership.id} v${membership.version}`;
  return node;
}
function summaryNodes(documentRef: Document, membership: CandidateMembershipData, summary: DeepResearchReportSummary): HTMLElement[] {
  const values = [
    `${membership.symbol} · membership ${membership.id} v${membership.version}`,
    `report #${summary.reportId} v${summary.reportVersion} · ${summary.reportFingerprint}`,
    `pack #${summary.evidencePackId} v${summary.evidencePackVersion} · ${summary.evidencePackFingerprint}`,
    `cutoff ${summary.cutoffAt} · direction ${summary.direction ?? "UNKNOWN"} · confidence ${summary.confidence}`,
    `结论：${summary.conclusion}`,
    `前版变化：${summary.changeFromPrevious || "UNKNOWN"}`
  ];
  return values.map((value, index) => { const node = documentRef.createElement(index === 0 ? "h4" : "p"); node.textContent = value; return node; });
}

function comparisonSide(
  membership: CandidateMembershipData,
  workspace: DeepResearchWorkspaceEnvelope,
  history: WebDecisionReviewHistoryResponse
): ComparisonSide {
  return history.ok
    ? { membership, workspace, history: history.value, historyMessage: "" }
    : { membership, workspace, history: null, historyMessage: `${membership.symbol} 决定/复盘历史暂不可用：${history.reason}` };
}

const NOT_RECORDED = "尚未记录";

export function comparisonDecisionHistoryLines(history: DecisionReviewHistoryEnvelope): string[] {
  const reviews = history.checks.flatMap((check) => check.reviews);
  const latestCheck = [...history.checks].sort((left, right) => Date.parse(right.checkedAt) - Date.parse(left.checkedAt))[0];
  const latestReview = [...reviews].sort((left, right) => Date.parse(right.reviewedAt) - Date.parse(left.reviewedAt))[0];
  return [
    `决定与复盘：${history.checks.length} 次决定 · ${reviews.length} 次复盘`,
    latestCheck
      ? `最近决定 #${latestCheck.id} · Owner方向 ${latestCheck.actionIntent} · ${latestCheck.checkedAt} · 正式快照 ${latestCheck.formalDecision.availability}`
        + (latestCheck.formalDecision.availability === "preserved"
          ? `（当时系统建议方向 ${latestCheck.formalDecision.systemRecommendation.direction}${latestCheck.formalDecision.differsFromSystem ? "，Owner 方向与系统建议不一致" : ""}）`
          : `（当时系统判断与个人决定的结构化字段${NOT_RECORDED}；如有历史原文，见下方记录）`)
      : "最近决定：尚无已记录历史，不等于无风险。",
    latestReview
      ? `最近复盘 #${latestReview.id} · ${latestReview.outcome} · ${latestReview.reviewedAt} · 判断修正 ${latestReview.reviewLearning.snapshot ? "见下方复盘原文（可能包含当时遗漏或低估的反证）" : `${NOT_RECORDED}，不作重建`}`
      : "最近复盘：尚无已记录历史。",
    `历史来源 ${history.metadata.source} · 截止 ${history.metadata.asOf ?? "UNKNOWN"} · ${history.metadata.freshness}`
  ];
}

export function comparisonWorkspaceFreshnessLine(
  symbol: string,
  workspace: DeepResearchWorkspaceEnvelope
): string | null {
  const metadata = workspace.metadata;
  if (metadata.freshness === "fresh" && !metadata.stale && !metadata.missing && !metadata.conflict) return null;
  const states = [
    metadata.conflict ? "冲突" : null,
    metadata.stale ? "过期" : null,
    metadata.missing ? "缺失" : null
  ].filter((value): value is string => value !== null);
  return `${symbol} 来源限制：${states.join("、") || metadata.freshness} · 截止 ${metadata.asOf ?? "UNKNOWN"} · ${metadata.message}`;
}

export function compareDeepResearchReportSummaries(
  left: DeepResearchReportSummary,
  right: DeepResearchReportSummary
): { changed: string[]; unchanged: string[]; limitations: string[] } {
  const fields: Array<[string, unknown, unknown]> = [
    ["结论与方向", [left.conclusion, left.direction, left.confidence, left.applicableUntil, left.horizonStatement], [right.conclusion, right.direction, right.confidence, right.applicableUntil, right.horizonStatement]],
    ["研究问题与论点", [left.researchQuestion, left.investmentThesis], [right.researchQuestion, right.investmentThesis]],
    ["长期观点", left.longTerm, right.longTerm],
    ["中短期观点", left.mediumShortTerm, right.mediumShortTerm],
    ["价格条件与情景", [left.priceConditions, left.priceRange, left.researchPositionRange, left.assumptions, left.scenarios], [right.priceConditions, right.priceRange, right.researchPositionRange, right.assumptions, right.scenarios]],
    ["绑定证据", left.evidence, right.evidence],
    ["反证与待核实", [left.counterevidence, left.unknowns], [right.counterevidence, right.unknowns]],
    ["来源冲突", [left.sourceConflictAssessment, left.sourceConflicts], [right.sourceConflictAssessment, right.sourceConflicts]],
    ["下一步核实", [left.nextValidationQuestions, left.nextQuestion], [right.nextValidationQuestions, right.nextQuestion]],
    ["量化与组合风险", left.quantPortfolio, right.quantPortfolio]
  ];
  const comparison = fields.reduce((result, [label, leftValue, rightValue]) => {
    result[canonicalJson(leftValue) === canonicalJson(rightValue) ? "unchanged" : "changed"].push(label);
    return result;
  }, { changed: [] as string[], unchanged: [] as string[] });
  const limitations: string[] = [];
  for (const [side, summary] of [["左侧", left], ["右侧", right]] as const) {
    if (summary.reportStatus !== "evidence_insufficient" && summary.missingCount <= 0) continue;
    const states = [
      summary.reportStatus === "evidence_insufficient" ? "报告状态为证据不足" : null,
      summary.missingCount > 0 ? `${summary.missingCount} 项待核实` : null
    ].filter((value): value is string => value !== null);
    limitations.push(`${side}研究资料仍待补齐（${states.join(" · ")}）`);
  }
  const leftCutoff = rfc3339Instant(left.cutoffAt);
  const rightCutoff = rfc3339Instant(right.cutoffAt);
  if (leftCutoff === null || rightCutoff === null) {
    const unusable = [
      leftCutoff === null ? `左侧「${left.cutoffAt.trim() || "缺失"}」` : null,
      rightCutoff === null ? `右侧「${right.cutoffAt.trim() || "缺失"}」` : null
    ].filter((value): value is string => value !== null);
    limitations.push(`研究资料截止时点不可用：${unusable.join("、")}，无法判断两侧是否使用同一资料截止点。`);
  } else if (leftCutoff === rightCutoff) {
    comparison.unchanged.push("截止日期");
  } else {
    comparison.changed.push("截止日期");
    limitations.push(`研究资料截止时点不同：左侧「${left.cutoffAt.trim()}」 · 右侧「${right.cutoffAt.trim()}」（仅代表资料覆盖时点，不是财务报告期）。`);
  }
  return { changed: comparison.changed, unchanged: comparison.unchanged, limitations };
}

function rfc3339Instant(value: string): number | null {
  const text = value.trim();
  if (!isRfc3339DateTime(text)) return null;
  const instant = Date.parse(text);
  return Number.isFinite(instant) ? instant : null;
}

function historyNodes(
  documentRef: Document,
  history: DecisionReviewHistoryEnvelope,
  name: "left" | "right",
  disabled: boolean
): HTMLElement[] {
  const nodes: HTMLElement[] = comparisonDecisionHistoryLines(history).map((value) => paragraph(documentRef, value));
  const details = documentRef.createElement("details");
  const title = documentRef.createElement("summary");
  title.textContent = "展开完整正式决定与复盘历史（当时已知 vs 后来复盘）";
  details.append(title);
  details.append(paragraph(
    documentRef,
    "以下时间线只使用每条决定与该次复盘保存时的不可变 payload：先看当时保存的报告/系统判断、冻结条件与 Owner 决定，再看后来复盘观察到的证据变化与判断修正。未保存的内容显示「尚未记录」，不使用当前市值、最新报告或事后数据回填当时判断。"
  ));
  for (const check of history.checks) details.append(historyCheckCard(documentRef, check, name, disabled));
  nodes.push(details);
  return nodes;
}

function historyCheckCard(
  documentRef: Document,
  check: RecordedDecisionCheckReviewState,
  name: "left" | "right",
  disabled: boolean
): HTMLElement {
  const card = documentRef.createElement("article");
  const heading = documentRef.createElement("h5");
  heading.textContent = `决定 #${check.id} · Owner方向 ${check.actionIntent} · ${check.checkedAt}`;
  card.append(heading);
  const thenHeading = documentRef.createElement("h6");
  thenHeading.textContent = "当时（该决定保存的报告与系统判断）";
  card.append(thenHeading, ...thenNodes(documentRef, check));
  if (check.researchReportDecision.availability === "preserved" && check.researchReportDecision.binding) {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.dataset.compareSide = name;
    button.dataset.thenReportCheckId = check.id;
    button.textContent = `查看决定 #${check.id} 当时报告与来源`;
    button.disabled = disabled;
    card.append(button);
  }
  const laterHeading = documentRef.createElement("h6");
  laterHeading.textContent = "后来（该决定各次复盘保存的观察与修正）";
  card.append(laterHeading);
  if (check.reviews.length === 0) {
    card.append(paragraph(documentRef, `复盘：${NOT_RECORDED}（此决定仍在待跟踪 / 复盘，尚无已记录复盘）。`));
  } else for (const review of check.reviews) card.append(...reviewNodes(documentRef, review));
  card.append(checkProvenance(documentRef, check));
  return card;
}

function thenNodes(documentRef: Document, check: RecordedDecisionCheckReviewState): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const formal = check.formalDecision;
  // 系统判断与「你当时的决定」都直接显示保存原文（check.formalDecision.systemRecommendation / check.formalDecision.ownerDecision），不做摘要或截断。
  if (formal.availability === "preserved") {
    const system = formal.systemRecommendation;
    const owner = formal.ownerDecision;
    nodes.push(paragraph(documentRef, `系统 / 报告判断：${system.direction} · 信心 ${system.confidence} · 期限 ${text(system.horizon)} · 结论 ${text(system.conclusion)}`));
    nodes.push(paragraph(documentRef, `当时条件：价格条件 ${listText(system.priceConditions)} · 价格区间 ${text(system.priceRange)} · 研究仓位范围 ${text(system.researchPositionRange)}`));
    nodes.push(paragraph(documentRef, `当时假设（保存原文）：${listText(system.assumptions)}`));
    nodes.push(paragraph(documentRef, `当时情景（保存原文）：${listText(system.scenarios)}`));
    nodes.push(paragraph(documentRef, `当时主要风险（保存原文）：${listText(system.risks)}`));
    nodes.push(paragraph(documentRef, `当时失效条件（保存原文）：${listText(system.invalidationConditions)}`));
    nodes.push(paragraph(documentRef, `当时下一步核实问题（保存原文）：${text(system.nextQuestion)}`));
    nodes.push(paragraph(documentRef, `你当时的决定：${check.actionIntent} · ${formal.differsFromSystem ? "你当时的方向与当时系统建议不一致" : "你当时的方向与当时系统建议一致"} · 原因 ${text(owner.reason)} · 期限 ${text(owner.horizon)} · 价格条件 ${text(owner.priceConditions)} · 研究仓位 ${text(owner.positionRange)} · 主要风险 ${text(owner.mainRisks)} · 失效条件 ${text(owner.invalidationConditions)} · 复核日 ${owner.reviewOn}`));
    if (formal.differsFromSystem) {
      nodes.push(paragraph(documentRef, `分歧理由（保存原文）：${full(owner.divergenceReason)}`));
    }
    const confirmation = owner.personalRisk;
    const assessment = formal.personalRiskAssessment;
    if (confirmation || assessment) {
      nodes.push(paragraph(documentRef, confirmation
        ? `当时保存的个人风险覆盖说明：覆盖原因 ${full(confirmation.overrideReason)} · 二次确认 ${confirmation.secondConfirmed ? "已确认" : "未确认"}`
        : `当时保存的个人风险覆盖说明：${NOT_RECORDED}`));
    }
    if (assessment) {
      nodes.push(paragraph(documentRef, `当时保存的个人风险评估：状态 ${assessment.status} · 需要覆盖 ${assessment.requiresOverride ? "是" : "否"} · 触发告警 ${assessment.warnings.length > 0 ? assessment.warnings.map((warning) => `${warning.code} 实际 ${warning.actual} 超过上限 ${warning.limit}`).join("；") : "无"} · 指标不可用 ${assessment.unavailableMetrics.join("、") || "无"} · 说明 ${assessment.limitation}`));
    }
  } else {
    nodes.push(paragraph(documentRef, `系统 / 报告判断：${NOT_RECORDED}（该历史决定未单独保存系统建议快照，不作重建）。`));
    const legacyDecision = full(check.userFinalDecision);
    nodes.push(paragraph(documentRef, legacyDecision === NOT_RECORDED
      ? `你当时的决定：${NOT_RECORDED}（当时的原因、分歧与风险条件未保存；现有 Owner方向 ${check.actionIntent} 只是索引字段，不作为当时理由解释）。`
      : `你当时的决定（历史未结构化原文）：${legacyDecision} · 该历史决定未分别保存系统建议与 Owner 决定的字段结构，无法区分哪里是系统判断、哪里是你自己的表述。`));
    nodes.push(paragraph(documentRef, `限制说明：${formal.limitation}`));
  }
  const judgment = check.conditionalDecision.judgment;
  if (check.conditionalDecision.availability === "preserved" && judgment) {
    nodes.push(paragraph(documentRef, `当时冻结条件（研判）：状态 ${judgment.workflowState} · 信心 ${judgment.confidence} · 复核日 ${judgment.reviewOn} · 观察窗口 ${judgment.observationWindow.startsOn} 至 ${judgment.observationWindow.endsOn}`));
    nodes.push(paragraph(documentRef, `当时假设（冻结原文）：${listText(judgment.assumptions)}`));
    nodes.push(paragraph(documentRef, `当时失效条件（冻结原文）：${listText(judgment.invalidationConditions)}`));
    nodes.push(paragraph(documentRef, judgment.portfolioObservationConditions.length > 0
      ? `当时组合观察触发条件（仅供人工复核触发；metric / comparison 为保存时原始枚举值）：${judgment.portfolioObservationConditions.map((condition) => `${condition.metric} ${condition.comparison} ${condition.threshold} · 理由 ${condition.rationale.trim() || NOT_RECORDED}`).join("；")}`
      : `当时组合观察触发条件：${NOT_RECORDED}`));
  } else {
    nodes.push(paragraph(documentRef, `当时冻结条件（研判）：${NOT_RECORDED}（未保存的假设、失效条件、组合观察触发条件与观察窗口不作重建，此处也无法提供）。`));
  }
  return nodes;
}

function reviewNodes(documentRef: Document, review: PostDecisionReviewData): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  nodes.push(paragraph(documentRef, `复盘 #${review.id} · 结果 ${review.outcome} · ${review.reviewedAt}`));
  nodes.push(paragraph(documentRef, `后来证据与结果依据：${full(review.outcomeEvidence)} · 复盘备注：${full(review.reviewNote)}`));
  const learning = review.reviewLearning.availability === "preserved" ? review.reviewLearning.snapshot : null;
  const manualLearning = review.reviewLearning.availability === "ordinary_manual_preserved"
    ? review.reviewLearning.snapshot : null;
  if (manualLearning) {
    nodes.push(paragraph(documentRef, "事实变化：普通人工复盘没有条件监控快照；人工学习不是已验证财务证据。"));
    nodes.push(paragraph(documentRef, `判断修正（人工原文）：${text(manualLearning.judgmentCorrection)}`));
    nodes.push(paragraph(documentRef, `过程教训（人工原文）：${text(manualLearning.processLesson)}`));
    nodes.push(paragraph(documentRef, `下一研究问题（人工原文）：${full(manualLearning.nextResearchQuestion)}`));
  } else if (learning) {
    const changes = learning.monitor.changes;
    nodes.push(paragraph(documentRef, changes.length > 0
      ? `证据字段变化（当时冻结值 → 复盘时值，${changes.length} 项全部列出）：${changes.map(factChangeText).join("；")}`
      : `证据字段变化：该次复盘的冻结监控未记录字段变化（评估时点 ${learning.monitor.evaluatedAt} · 监控状态 ${learning.monitor.state}）`));
    nodes.push(paragraph(documentRef, `判断修正（该次复盘原文，可能包含当时遗漏或低估的反证）：${text(learning.judgmentCorrection)}`));
    nodes.push(paragraph(documentRef, `过程教训（保存原文）：${text(learning.processLesson)}`));
    nodes.push(paragraph(documentRef, `下一步研究问题（保存原文）：${full(learning.nextResearchQuestion)}`));
  } else {
    nodes.push(paragraph(documentRef, `后来证据变化与判断修正：${NOT_RECORDED}（该次复盘未保存修正 payload，不作重建）· 说明：${review.reviewLearning.limitation}`));
    nodes.push(paragraph(documentRef, `过程教训：${NOT_RECORDED} · 下一步研究问题：${NOT_RECORDED}`));
  }
  const details = documentRef.createElement("details");
  const summary = documentRef.createElement("summary");
  summary.textContent = "展开本次复盘来源与精确标识";
  details.append(summary,
    paragraph(documentRef, `复盘 review #${review.id} · 决定 check #${review.decisionCheckId} · 范围 ${review.market}.${review.code} ${review.symbol} · 记录时间 ${review.createdAt}`),
    paragraph(documentRef, `记录者 ${review.audit.actorType}${review.audit.actorId ? ` ${review.audit.actorId}` : ""} · 幂等键 ${review.audit.idempotencyKey} · 关联 ${review.audit.correlationId ?? NOT_RECORDED}`),
    paragraph(documentRef, learning
      ? `学习快照：reviewLearning ${review.reviewLearning.availability} · 冻结事实时点 ${learning.reviewedFactsAt} · decisionSnapshot ${learning.decisionSnapshotId} · conditionalPreview ${learning.conditionalPreviewId} · 监控状态 ${learning.monitor.state} · 监控原因 ${learning.monitor.reasons.join("、") || "无"}`
      : manualLearning
        ? `学习快照：reviewLearning ${review.reviewLearning.availability} · membership ${manualLearning.membershipId} v${manualLearning.membershipVersion} · 无条件监控或报告快照`
        : `学习快照：reviewLearning ${review.reviewLearning.availability} · ${review.reviewLearning.limitation}`));
  nodes.push(details);
  return nodes;
}

function checkProvenance(documentRef: Document, check: RecordedDecisionCheckReviewState): HTMLElement {
  const details = documentRef.createElement("details");
  const summary = documentRef.createElement("summary");
  summary.textContent = "展开本决定来源与精确标识";
  const binding = check.researchReportDecision.binding;
  details.append(summary,
    paragraph(documentRef, `决定 check #${check.id} · context ${check.contextId} · hash ${check.contextHash} · humanCheckResult ${check.humanCheckResult} · userFinalDecision ${check.userFinalDecision ?? NOT_RECORDED}`),
    paragraph(documentRef, binding
      ? `绑定报告 report #${binding.reportId} v${binding.reportVersion} · pack #${binding.evidencePackId} · ${binding.reportFingerprint}`
      : `绑定报告：${NOT_RECORDED}`),
    paragraph(documentRef, `快照可用性：decisionSnapshot ${check.decisionSnapshot.availability} · conditionalDecision ${check.conditionalDecision.availability} · formalDecision ${check.formalDecision.availability} · 说明 ${check.decisionSnapshot.limitation}`));
  const snapshot = check.decisionSnapshot.snapshot;
  if (snapshot) {
    details.append(paragraph(documentRef, `decisionSnapshot ${snapshot.snapshotId} · 捕获于 ${snapshot.capturedAt} · ${snapshot.candidateSymbol} · 组合事实 ${snapshot.portfolioContext.state} · 风险影响 ${snapshot.riskImpact.availability}`));
  }
  if (check.conditionalDecision.preview) {
    details.append(paragraph(documentRef, `conditionalPreview ${check.conditionalDecision.preview.previewId ?? NOT_RECORDED} · 生成于 ${check.conditionalDecision.preview.generatedAt}`));
  }
  if (check.formalDecision.availability === "preserved") {
    details.append(paragraph(documentRef, `formalDecision report #${check.formalDecision.systemRecommendation.reportId} v${check.formalDecision.systemRecommendation.reportVersion} · ${check.formalDecision.systemRecommendation.reportFingerprint}`));
  }
  return details;
}

function factChangeText(change: AnnualConditionalFactChange): string {
  return `${change.reason} ${change.field}：${change.frozenValue ?? NOT_RECORDED} → ${change.currentValue ?? NOT_RECORDED}${change.detail ? `（${text(change.detail)}）` : ""}`;
}

function paragraph(documentRef: Document, value: string): HTMLParagraphElement {
  const node = documentRef.createElement("p");
  node.textContent = value;
  return node;
}

function text(value: string): string {
  return value.trim() || NOT_RECORDED;
}

function full(value: string | null): string {
  return value === null ? NOT_RECORDED : text(value);
}

function listText(values: readonly string[]): string {
  const items = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return items.length > 0 ? items.join("；") : NOT_RECORDED;
}
