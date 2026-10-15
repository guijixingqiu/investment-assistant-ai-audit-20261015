import type { CandidateMembershipData } from "../../../packages/contracts/src/candidateMembership.js";
import type { KnownHongKongStock } from "../../../packages/contracts/src/market.js";
import type { OfficialAnnouncementDiscoveryItem } from "../../../packages/contracts/src/marketDiscovery.js";
import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";
import type { ResearchReportDecisionBinding } from "../../../packages/contracts/src/researchReportDecision.js";
import type { DecisionReviewHistoryEnvelope, PostDecisionReviewData } from "../../../packages/contracts/src/decisionReview.js";
import type { TodayActionInboxEnvelope } from "../../../packages/contracts/src/todayActionInbox.js";
import type { AssistWorkflowController } from "./assistWorkflowController.js";
import type { CandidateWorkflowController } from "./candidateWorkflowController.js";
import { DailyResearchCockpit, type CockpitDestination, type ExactCockpitMembership } from "./dailyResearchCockpit.js";
import { acceptMarketDiscoveryEnvelope, exactOfficialAnnouncement, OfficialAnnouncementIdentityChangedError, requestJson, type DailyTrackingReviewCheck, type DailyTrackingReviewTarget } from "./dailyResearchCockpitData.js";
import type { InvestmentControlConsoleCoordinator } from "./investmentControlConsoleCoordinator.js";
import { EvidenceConflictConsole } from "./evidenceConflictConsole.js";
import { MarketContextConsole, type MarketResearchAction } from "./marketContextConsole.js";
import { ResearchDocumentConsole } from "./researchDocumentConsole.js";
import { ResearchFutuFinancialConsole } from "./researchFutuFinancialConsole.js";
import type { ReportDocumentCitation } from "./researchDocumentValidation.js";
import { ResearchDossierConsole } from "./researchDossierConsole.js";
import { input } from "./view.js";
import { auth, candidateReadAuth, candidateWriteAuth } from "./webAuth.js";
import { sameWebApiAuth } from "./apiClient.js";

interface DailyResearchCockpitBridgeDependencies {
  candidates: CandidateWorkflowController;
  assist: AssistWorkflowController;
  investment: InvestmentControlConsoleCoordinator;
  loadJourney: () => Promise<void>;
  currentSymbol: () => string | null;
  invalidateDeepResearch: (message: string) => void;
  prepareFormalDecision: (binding: ResearchReportDecisionBinding) => Promise<void>;
  activateDailyTrackingReview: (target: DailyTrackingReviewTarget) => string;
  activateOrdinaryReview: (item: TodayActionInboxEnvelope["items"][number], actorId: string) => string;
  invalidateDailyTrackingReview: (target: DailyTrackingReviewTarget) => void;
}
type OwnerNextAction = [HTMLElement | null, string, string, string, string];

export function requireExactActiveMembership(
  memberships: CandidateMembershipData[],
  target: ExactCockpitMembership
): CandidateMembershipData {
  const matches = memberships.filter((item) => item.id === target.id && item.version === target.version
    && item.symbol === target.symbol && item.state !== "archived");
  if (matches.length !== 1) throw new Error("Fresh memberships must contain exactly one matching non-archived item.");
  return matches[0];
}

export function requireSingleActiveMembershipBySymbol(
  memberships: CandidateMembershipData[],
  symbol: string
): CandidateMembershipData {
  const matches = memberships.filter((item) => item.symbol === symbol && item.state !== "archived");
  if (matches.length !== 1) throw new Error("Fresh memberships must contain exactly one non-archived item for the target symbol.");
  return matches[0];
}

export function assetsResearchMembershipAction(
  memberships: CandidateMembershipData[],
  stock: Pick<KnownHongKongStock, "market" | "code" | "symbol">
): { kind: "open"; membership: CandidateMembershipData } | { kind: "onboard"; restoreArchived: boolean } {
  const matches = memberships.filter((item) => item.symbol === stock.symbol || (item.market === stock.market && item.code === stock.code));
  if (matches.some((item) => item.market !== stock.market || item.code !== stock.code || item.symbol !== stock.symbol)) {
    throw new Error("Fresh membership symbol identity drifted from Assets.");
  }
  const active = matches.filter((item) => item.state !== "archived");
  if (matches.length === 1 && active.length === 1) return { kind: "open", membership: active[0] };
  if (active.length === 0 && matches.length <= 1) return { kind: "onboard", restoreArchived: matches.length === 1 };
  throw new Error("Assets Research onboarding requires zero memberships, one archived membership, or one active membership.");
}

export function marketResearchAction(
  memberships: CandidateMembershipData[],
  stock: KnownHongKongStock
): { kind: "add" } | { kind: "open"; membership: CandidateMembershipData } {
  const matches = memberships.filter((item) => item.symbol === stock.symbol
    || (item.market === stock.market && item.code === stock.code));
  if (matches.some((item) => item.market !== stock.market || item.code !== stock.code || item.symbol !== stock.symbol)) {
    throw new Error("Fresh membership symbol identity drifted from Market.");
  }
  if (matches.length === 0) return { kind: "add" };
  if (matches.length !== 1 || matches[0].state === "archived") {
    throw new Error("Research onboarding requires zero memberships or exactly one active membership; archived or ambiguous matches are blocked.");
  }
  return { kind: "open", membership: matches[0] };
}

export class DailyResearchCockpitBridge {
  private documentRef: Document | null = null;
  private coreNextActionKind: string | null = null;
  private coreNextActionStage: string | null = null;
  private announcementGeneration = 0;
  private pendingOfficialAnnouncement: OfficialAnnouncementDiscoveryItem | null = null;
  private readonly conflicts: EvidenceConflictConsole;
  private readonly documents: ResearchDocumentConsole;
  private readonly futuFinancial: ResearchFutuFinancialConsole;
  private readonly marketContext: MarketContextConsole;
  private readonly dossier: ResearchDossierConsole;
  private readonly cockpit: DailyResearchCockpit;

  constructor(private readonly dependencies: DailyResearchCockpitBridgeDependencies) {
    this.conflicts = new EvidenceConflictConsole({
      readAuth: candidateReadAuth,
      writeAuth: candidateWriteAuth,
      onEvidenceChanged: dependencies.invalidateDeepResearch
    });
    this.documents = new ResearchDocumentConsole({
      readAuth: candidateReadAuth,
      writeAuth: candidateWriteAuth,
      onMaterialWrite: (material) => void this.conflicts.materialWritten(material)
    });
    this.futuFinancial = new ResearchFutuFinancialConsole(candidateReadAuth, candidateWriteAuth);
    this.marketContext = new MarketContextConsole({
      readAuth: candidateReadAuth,
      writeAuth: candidateWriteAuth,
      resolveResearchAction: (stock) => this.resolveMarketResearchAction(stock).then((action) => action.kind),
      openResearch: (stock, expected) => this.openMarketResearch(stock, expected)
    });
    this.dossier = new ResearchDossierConsole({
      readAuth: candidateReadAuth,
      writeAuth: candidateWriteAuth,
      onResearchWrite: dependencies.invalidateDeepResearch,
      openFinancialRequirementSource: (material, actorId) => this.documents.openExactFinancialRequirementSource(material, actorId)
    });
    this.cockpit = new DailyResearchCockpit({
      readAuth: candidateReadAuth,
      writeAuth: candidateWriteAuth,
      decisionAuth: auth,
      currentSymbol: dependencies.currentSymbol,
      currentMembership: () => this.currentMembership(),
      openMembership: (membership, destination) => this.openMembership(membership, destination, true),
      prepareFormalDecision: dependencies.prepareFormalDecision,
      continueQualifiedCandidate: (candidate) => this.continueQualifiedCandidate(candidate),
      continueOfficialAnnouncement: (item) => this.continueOfficialAnnouncement(item),
      activateDailyTrackingReview: dependencies.activateDailyTrackingReview,
      activateOrdinaryReview: dependencies.activateOrdinaryReview,
      invalidateDailyTrackingReview: dependencies.invalidateDailyTrackingReview
    });
  }

  mount(documentRef: Document): void {
    this.documentRef = documentRef;
    this.cockpit.mount(documentRef);
    this.marketContext.mount(documentRef);
    this.documents.mount(documentRef);
    this.futuFinancial.mount(documentRef);
    this.dossier.mount(documentRef);
    this.conflicts.mount(documentRef);
    this.element("next-action-card")?.addEventListener("click", (event) => this.routeNextAction(event));
    if (typeof MutationObserver !== "undefined") {
      const observer = new MutationObserver(() => this.renderOwnerNextAction());
      for (const id of [
        "next-action-card", "today-inbox-list", "candidate-memberships", "membership-list",
        "research-documents-console", "research-dossier-console", "evidence-conflict-console",
        "market-context-console", "deep-research-console"
      ]) {
        const element = this.element(id);
        if (element) observer.observe(element, { attributes: true, childList: true, subtree: true });
      }
    }
    this.renderOwnerNextAction();
  }

  async openResearchMembership(target: ExactCockpitMembership): Promise<void> {
    await this.openMembership(target, "research", true);
  }

  async openResearchReportCitation(target: ExactCockpitMembership, citation: ReportDocumentCitation): Promise<void> {
    await this.openMembership(target, "research", true);
    await this.documents.openExactReportCitation(citation);
  }

  invalidateAuthorization(message: string): void {
    this.announcementGeneration += 1;
    this.pendingOfficialAnnouncement = null;
    this.cockpit.invalidateAuthorization(message);
    this.marketContext.invalidateAuthorization(message);
    this.documents.invalidateAuthorization(message);
    this.futuFinancial.invalidateAuthorization(message);
    this.dossier.invalidateAuthorization(message);
    this.conflicts.invalidateAuthorization(message);
    this.renderOwnerNextAction();
  }

  invalidateAnnouncementContinuation(message: string): void {
    this.announcementGeneration += 1;
    this.pendingOfficialAnnouncement = null;
    this.cockpit.invalidateMarketContinuation(message);
    this.documents.cancelOfficialAnnouncement(message);
  }

  async resumePendingOfficialAnnouncement(membership: CandidateMembershipData): Promise<boolean> {
    const pending = this.pendingOfficialAnnouncement;
    if (!pending) return false;
    if (membership.symbol !== pending.symbol) {
      this.pendingOfficialAnnouncement = null;
      this.cockpit.showAnnouncementContinuation("Announcement continuation cleared because the explicit membership write returned another symbol.");
      return true;
    }
    try {
      const outcome = await this.continueOfficialAnnouncement(pending);
      this.cockpit.showAnnouncementContinuation(outcome === "prepared"
        ? "Exact membership readback returned to the same fresh announcement. Choose the same PDF and explicitly upload."
        : "Membership readback did not produce one exact active item; the announcement remains blocked.");
    } catch (error) {
      if (error instanceof OfficialAnnouncementIdentityChangedError) this.pendingOfficialAnnouncement = null;
      this.cockpit.showAnnouncementContinuation(`Announcement continuation UNKNOWN · ${error instanceof Error ? error.message : "Fresh read failed."} ${this.pendingOfficialAnnouncement ? "The same announcement identity is retained for explicit retry." : "The stale announcement identity was cleared."}`);
    }
    return true;
  }

  refreshToday(): Promise<void> { return this.cockpit.refreshToday(); }

  adoptedReportBinding(): ResearchReportDecisionBinding | null {
    const source = this.dependencies.investment.currentSource();
    return this.cockpit.adoptedReportBinding(source ? { id: source.membershipId, version: source.membershipVersion, symbol: source.symbol } : null);
  }

  matchesAdoptedReportBinding(binding: ResearchReportDecisionBinding): boolean {
    const source = this.dependencies.investment.currentSource();
    return this.cockpit.matchesAdoptedReportBinding(binding, source ? { id: source.membershipId, version: source.membershipVersion, symbol: source.symbol } : null);
  }

  completeFormalDecision(binding: ResearchReportDecisionBinding, decisionCheckId: string): Promise<void> {
    return this.cockpit.completeFormalDecision(binding, decisionCheckId);
  }

  hasDailyTrackingReview(): boolean { return this.cockpit.hasDailyTrackingReview(); }

  hideDailyTrackingReviewUntilReadback(reviewId: string): void {
    this.cockpit.hideDailyTrackingReviewUntilReadback(reviewId);
  }

  prepareDailyTrackingReview(check: DailyTrackingReviewCheck): Promise<ResearchReportDecisionBinding> {
    return this.cockpit.prepareDailyTrackingReview(check);
  }

  completeDailyTrackingReview(
    history: DecisionReviewHistoryEnvelope,
    review: PostDecisionReviewData,
    check: DailyTrackingReviewCheck
  ): Promise<void> {
    return this.cockpit.completeDailyTrackingReview(history, review, check);
  }

  syncMembership(): void {
    const source = this.dependencies.investment.currentSource();
    this.cockpit.adoptedReportBinding(source ? { id: source.membershipId, version: source.membershipVersion, symbol: source.symbol } : null);
    this.documents.syncMembership(source ? {
      id: source.membershipId,
      version: source.membershipVersion,
      symbol: source.symbol
    } : null);
    this.futuFinancial.syncMembership(source && source.membershipState !== "archived" ? {
      id: source.membershipId, version: source.membershipVersion, symbol: source.symbol
    } : null);
    this.dossier.syncMembership(source && source.membershipState !== "archived" ? {
      id: source.membershipId,
      version: source.membershipVersion,
      state: source.membershipState,
      symbol: source.symbol
    } : null);
    this.conflicts.syncMembership(source && source.membershipState !== "archived" ? {
      sourceKey: source.sourceKey,
      id: source.membershipId,
      version: source.membershipVersion,
      state: source.membershipState,
      market: source.market,
      code: source.code,
      symbol: source.symbol
    } : null);
    this.renderOwnerNextAction();
  }

  private ownerNextAction(): OwnerNextAction {
    const today = this.documentRef?.querySelector<HTMLElement>("#today-inbox-list button[data-today-action-state='new']:not(:disabled)")
      ?? this.documentRef?.querySelector<HTMLElement>("#today-inbox-list button[data-today-action-state='later']:not(:disabled)") ?? null;
    if (today) {
      const row = today.closest("li");
      return [today, "today", "处理 Today 的首要研究事项",
        row?.querySelector("strong")?.textContent?.trim() || "Today 已给出一项需要 Owner 处理的研究动作；进入后仍会重新读取精确身份。", "前往首要事项"];
    }
    if (this.coreNextActionKind === "submit_review") {
      return [this.element("review-submit"), "core_review", "提交当前人工判断的复盘",
        "人工判断已经记录；复盘仍需 Owner 单独明确提交，不会自动完成。", "前往复盘"];
    }
    if (["continue_with_pingan_limitation", "submit_human_check"].includes(this.coreNextActionKind ?? "")) {
      const target = this.element("decision-submit");
      const blocked = target instanceof HTMLButtonElement && target.disabled;
      return [target, "core_decision", blocked ? "人工判断暂不可用" : "提交当前人工判断",
        blocked
          ? "当前组合或风险身份尚未可靠就绪；旧事实不会被当作人工判断依据。"
          : "当前事实已达到人工判断步骤；系统只定位到表单，不会自动提交决定。",
        blocked ? "等待当前事实就绪" : "前往人工判断"];
    }

    const source = this.dependencies.investment.currentSource();
    if (!source) return this.ownerNextActionWithoutSource();

    if (this.element("investment-control-console")?.dataset.state !== "ready") {
      return [this.element("load-action"), "research_unknown", "重新读取当前研究事实",
        "当前成员的研究事实尚未完整就绪；旧事实不会被当作下一步。", "前往重新读取"];
    }

    const deep = this.element("deep-research-console");
    const deepState = deep?.dataset.state ?? "unavailable";
    const deepAction = this.ownerNextActionForDeepState(deepState);
    if (deepAction) return deepAction;
    return this.ownerNextActionForResearchPrerequisites(deepState);
  }

  private ownerNextActionWithoutSource(): OwnerNextAction {
    const memberships = this.dependencies.candidates.memberships;
    if (!["available", "empty"].includes(memberships.state)) {
      return [this.element("membership-refresh"), "membership_unknown", "重新读取研究成员",
        "成员来源尚未可靠读取；旧列表不会被当作下一步依据。", "前往重新读取"];
    }
    const symbol = this.dependencies.currentSymbol();
    const active = memberships.memberships.filter((item) => item.state !== "archived" && (!symbol || item.symbol === symbol));
    if (active.length === 1) {
      const target = this.documentRef?.querySelector<HTMLElement>(`button[data-decision-intake-membership-id='${active[0].id}']`) ?? null;
      return [target, "membership_open", `打开 ${active[0].symbol} 的现有研究`,
        "当前只有一个精确非归档研究成员；先 fresh-read 现有研究，不创建第二份成员关系。", "前往现有研究"];
    }
    if (active.length > 1) {
      return [this.element("membership-refresh"), "membership_ambiguous", "研究成员暂不能判断",
        "同一标的存在多个非归档成员，系统不会替 Owner 猜选；请重新读取后显式选择。", "前往重新读取"];
    }
    return [this.element("market-discovery-refresh"), "market_discovery", "从 Market 选择研究标的",
      "当前没有可打开的研究成员；先查看不排名的 Market 发现，再由 Owner 显式加入研究。", "前往市场发现"];
  }

  private ownerNextActionForDeepState(deepState: string): OwnerNextAction | null {
    if (["unavailable", "ready", "loading"].includes(deepState)) {
      return [this.element("deep-research-refresh"), "deep_refresh", deepState === "loading" ? "正在读取 Deep Research" : "读取 Deep Research 当前状态",
        "先读取当前材料、证据包、任务和报告身份，再决定后续动作。", "前往 Deep Research"];
    }
    if (deepState === "user_confirmation_required") {
      return [this.element("deep-report-confirm"), "report_confirm", "审阅并明确确认当前报告",
        "当前报告已完成但尚未确认；确认报告与正式决定仍是两个独立的 Owner 动作。", "前往报告确认"];
    }
    if (deepState === "rejected") {
      return [this.element("deep-material-title"), "report_rejected", "补充证据后重新准备研究",
        "当前报告已被明确驳回；先补充可追溯材料，再重新冻结和综合。", "前往补充材料"];
    }
    if (deepState === "confirmed") {
      if (["empty", "completed"].includes(this.element("today-action-inbox")?.dataset.state ?? "unknown")
        && this.coreNextActionKind === "journey_complete") {
        return [null, "research_complete", "当前研究闭环已完成",
          "报告、人工决定和复盘均已完成；没有自动交易、订单或资产写入。", "暂无新的研究动作"];
      }
      return [this.element("today-inbox-refresh"), "today_after_report", "读取报告后的正式决定与复盘下一步",
        "报告确认不等于正式决定；Today 会重新投影正式决定、跟踪和复盘连续性。", "前往刷新 Today"];
    }
    return deepState === "research_required" ? this.deepResearchTaskAction() : null;
  }

  private ownerNextActionForResearchPrerequisites(deepState: string): OwnerNextAction {
    const documents = this.element("research-documents-console");
    if (documents?.dataset.state !== "available") {
      return [this.element("research-documents-refresh"), "documents_refresh", "核对官方 PDF 原文",
        this.text("research-documents-status", "官方文档状态尚未可靠读取。"), "前往 PDF 原文"];
    }
    if (Number(documents.dataset.documentCount ?? 0) === 0) {
      return [this.element("research-document-file"), "document_import", "导入官方 PDF 原文",
        "选择文件不会自动上传、确认事实、冻结证据或生成决定。", "前往选择 PDF"];
    }
    if (Number(documents.dataset.materialCount ?? 0) === 0) {
      const target = documents.dataset.pageState === "available"
        ? this.element("research-document-quote")
        : this.documentRef?.querySelector<HTMLElement>("#research-document-list button[data-document-page-id]:not(:disabled)") ?? null;
      return [target, "document_fact", "核对 PDF 页面并确认研究事实",
        "先打开精确页并填写引用；事实仍是研究证据，不会自动进入报告或决定。", "前往核对原文"];
    }

    const dossier = this.element("research-dossier-console");
    if (dossier?.dataset.state !== "available") {
      return [this.element("research-dossier-refresh"), "dossier_refresh", "读取结构化研究档案",
        this.text("research-dossier-status", "档案事实尚未可靠读取。"), "前往研究档案"];
    }
    if (dossier.dataset.contextState !== "available") {
      return [this.element("research-dossier-context-industry"), "dossier_context", "补充行业与同业上下文",
        "把当前官方 PDF 事实绑定到行业上下文；无法比较时继续保留 UNKNOWN。", "前往行业上下文"];
    }
    if (dossier.dataset.fundamentalState !== "available") {
      return [this.element("research-dossier-fundamental-material"), "dossier_fundamental", "补齐5年财务与最新中期",
        `当前覆盖 ${dossier.dataset.fundamentalCoverage ?? "UNKNOWN"}；基本面必须绑定当前 PDF 材料，缺失值继续保留 UNKNOWN。`, "前往基本面"];
    }
    if (dossier.dataset.valuationState !== "available") {
      return [this.element("research-dossier-valuation-anchor"), "dossier_valuation", "完成两种 Owner 估值方法",
        `当前覆盖 ${dossier.dataset.valuationCoverage ?? "UNKNOWN"}；估值是 Owner 假设，不是预测、目标价、推荐或交易动作。`, "前往估值情景"];
    }

    const conflicts = this.element("evidence-conflict-console");
    if (conflicts?.dataset.state !== "available") {
      return [this.element("evidence-conflict-refresh"), "conflict_refresh", "核对证据冲突",
        "冻结前先 fresh-read 当前证据冲突；读取失败不会沿用旧结果。", "前往冲突核对"];
    }
    const conflict = this.documentRef?.querySelector<HTMLElement>("#evidence-conflict-list button[data-conflict-action='replace']") ?? null;
    if (conflict) {
      return [conflict, "conflict_resolve", "处理当前证据冲突",
        "冲突材料必须由 Owner 显式替换或继续待核；不会自动采用任一来源。", "前往证据冲突"];
    }

    if (deepState === "pack_required") {
      const freeze = this.element("deep-pack-freeze");
      if (freeze instanceof HTMLButtonElement && !freeze.disabled) {
        return [freeze, "pack_freeze", "明确冻结当前证据包",
          "冻结只绑定当前事实版本；不会自动发起综合、确认报告或形成正式决定。", "前往冻结证据"];
      }
      const market = this.element("market-context-output");
      if (market?.dataset.state !== "available") {
        const refresh = this.element("market-context-provider-refresh");
        const target = refresh instanceof HTMLButtonElement && !refresh.disabled ? refresh : this.element("market-context-search-input");
        return [target, "market_daily", "补齐价格、日线技术与市场环境",
          "先显式选择当前港股并读取真实 Market 事实；不可用时保持 UNKNOWN。", "前往 Market 核对"];
      }
      return [this.element("deep-research-refresh"), "pack_blocked", "重新读取冻结前提",
        "当前证据包仍不可冻结；请重新读取并查看缺失项或漂移原因。", "前往重新读取"];
    }

    return [this.element("deep-research-refresh"), "materials_refresh", "刷新可追溯材料",
      "已有官方事实后重新读取 Deep Research；不会自动冻结、综合或确认。", "前往 Deep Research"];
  }

  private deepResearchTaskAction(): OwnerNextAction {
    const taskState = this.element("deep-research-console")?.dataset.taskState ?? "none";
    if (taskState === "ready_to_absorb") {
      return [this.element("deep-task-absorb"), "task_absorb", "明确吸收已完成的研究结果",
        "ready_to_absorb 结果尚未写入报告；必须由 Owner 显式吸收。", "前往明确吸收"];
    }
    if (taskState === "failed") {
      const retry = this.element("deep-task-retry");
      if (retry instanceof HTMLButtonElement && !retry.disabled) {
        return [retry, "task_retry", "明确重试同一研究任务",
          "只对允许重试的同一任务、快照和请求身份开放。", "前往任务重试"];
      }
      return [this.element("deep-material-title"), "task_repair", "补充证据后重新准备研究",
        "当前任务是确定性失败，不能伪装成可重试；先修正证据，再重新冻结。", "前往补充证据"];
    }
    if (["pending", "running", "saved"].includes(taskState)) {
      return [this.element("deep-task-refresh"), "task_refresh", "恢复已保存的研究任务",
        "任务可以离开页面后继续；刷新不会重复发起。", "前往任务刷新"];
    }
    return [this.element("deep-task-start"), "task_start", "发起当前冻结证据的 Deep Research",
      "只提交当前冻结证据身份，不自动确认报告、决定或交易。", "前往发起研究"];
  }

  private routeNextAction(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.closest("button[data-owner-next-action]")) return;
    this.openOwnerNextAction();
  }

  private openOwnerNextAction(): void {
    const [target] = this.ownerNextAction();
    if (!target || target instanceof HTMLButtonElement && target.disabled) return;
    if (this.element("investment-control-console")?.contains(target)) this.dependencies.investment.setTab("sources");
    target.scrollIntoView({ block: "center" });
    target.focus({ preventScroll: true });
  }

  private renderOwnerNextAction(): void {
    const formalDecisionFields = this.element("formal-decision-fields");
    if (formalDecisionFields instanceof HTMLFieldSetElement) {
      const enabled = this.adoptedReportBinding() !== null;
      formalDecisionFields.hidden = !enabled;
      formalDecisionFields.disabled = !enabled;
    }
    const card = this.element("next-action-card");
    if (!card) return;
    const currentKind = card.dataset.kind;
    if (currentKind && !currentKind.startsWith("research_")) {
      this.coreNextActionKind = currentKind;
      this.coreNextActionStage = card.dataset.sourceStage ?? null;
    }
    const requiredStageFailure = ["quote", "research"].includes(this.coreNextActionStage ?? "")
      && ["fix_symbol", "wait_for_load", "reauthenticate", "resolve_conflict", "retry_load"].includes(this.coreNextActionKind ?? "");
    if (!this.coreNextActionKind || this.coreNextActionKind === "refresh_quote" || requiredStageFailure) return;
    const [target, kind, title, reason, label] = this.ownerNextAction();
    const actionable = Boolean(target && (!(target instanceof HTMLButtonElement) || !target.disabled));
    const identity = [kind, target?.id, target?.dataset.todayItemId, actionable].join(":");
    if (currentKind?.startsWith("research_") && card.dataset.ownerNextActionIdentity === identity) return;
    const badge = this.documentRef!.createElement("span");
    const heading = this.documentRef!.createElement("strong");
    const detail = this.documentRef!.createElement("p");
    const button = this.documentRef!.createElement("button");
    badge.textContent = actionable ? "下一步" : "暂不能判断";
    heading.textContent = title;
    detail.textContent = reason;
    button.type = "button";
    button.dataset.ownerNextAction = "true";
    button.textContent = label;
    button.disabled = !actionable;
    if (target?.id) button.setAttribute("aria-controls", target.closest<HTMLElement>("section[id]")?.id ?? target.id);
    card.dataset.kind = `research_${kind}`;
    card.dataset.operation = "none";
    card.dataset.enabled = String(actionable);
    card.dataset.ownerNextActionIdentity = identity;
    card.replaceChildren(badge, heading, detail, button);
  }

  private element(id: string): HTMLElement | null { return this.documentRef?.getElementById(id) ?? null; }
  private text(id: string, fallback: string): string { return this.element(id)?.textContent?.trim() || fallback; }

  private async openMembership(
    target: ExactCockpitMembership,
    destination: CockpitDestination,
    refresh: boolean,
    ensureCurrent: () => void = () => {}
  ): Promise<void> {
    if (refresh) await this.dependencies.candidates.refreshMemberships();
    ensureCurrent();
    const membership = requireExactActiveMembership(this.dependencies.candidates.memberships.memberships, target);
    if (destination === "market") {
      await this.marketContext.prepareCandidate({
        market: "HK", code: membership.symbol.slice(3), symbol: membership.symbol, name: null
      });
      ensureCurrent();
      this.element("market-context-console")?.scrollIntoView({ block: "start" });
      return;
    }
    input("symbol-input").value = membership.symbol;
    await this.dependencies.loadJourney();
    ensureCurrent();
    if (this.dependencies.currentSymbol() !== membership.symbol) throw new Error("Selected symbol journey failed its fresh read.");
    await this.dependencies.candidates.loadDecisionIntake(membership.id);
    ensureCurrent();
    this.dependencies.investment.reflectDecisionIntake();
    const source = this.dependencies.investment.currentSource();
    if (!source || source.membershipId !== membership.id || source.membershipVersion !== membership.version || source.symbol !== membership.symbol) {
      throw new Error("Decision intake did not bind the exact fresh membership.");
    }
    this.dependencies.investment.setTab("sources");
    if (destination === "review") {
      await this.dependencies.assist.loadHumanReviewWorkspace(membership.id);
      const review = this.dependencies.assist.humanReviewWorkspace;
      if (review.membershipId !== membership.id || !["ready", "review_limited", "empty"].includes(review.state)) {
        throw new Error("Existing Review workspace did not fresh-read the exact membership.");
      }
      document.querySelector(".forms")?.scrollIntoView({ block: "start" });
    } else if (destination === "research_profile") {
      document.getElementById("research-profile-editor")?.scrollIntoView({ block: "start" });
    } else if (destination === "research") {
      document.getElementById("investment-control-console")?.scrollIntoView({ block: "start" });
    } else {
      document.querySelector(".forms")?.scrollIntoView({ block: "start" });
    }
    this.documents.syncMembership({ id: membership.id, version: membership.version, symbol: membership.symbol });
    this.futuFinancial.syncMembership({ id: membership.id, version: membership.version, symbol: membership.symbol });
  }

  private currentMembership(): ExactCockpitMembership | null {
    const source = this.dependencies.investment.currentSource();
    return source ? { id: source.membershipId, version: source.membershipVersion, symbol: source.symbol } : null;
  }
  private async continueQualifiedCandidate(candidate: KnownHongKongStock): Promise<void> {
    await this.marketContext.prepareCandidate(candidate);
    this.element("market-context-console")?.scrollIntoView({ block: "start" });
  }

  private async continueOfficialAnnouncement(item: OfficialAnnouncementDiscoveryItem): Promise<"onboarding" | "prepared"> {
    if (this.pendingOfficialAnnouncement && canonicalJson(this.pendingOfficialAnnouncement) !== canonicalJson(item)) {
      this.pendingOfficialAnnouncement = null;
    }
    const readAuth = candidateReadAuth();
    if (!readAuth) throw new Error("Current read authorization is required.");
    const generation = ++this.announcementGeneration;
    const ensureCurrent = () => {
      if (generation !== this.announcementGeneration || !sameWebApiAuth(readAuth, candidateReadAuth())) {
        throw new Error("Announcement continuation was superseded by a symbol or authorization change.");
      }
    };
    const current = exactOfficialAnnouncement(
      acceptMarketDiscoveryEnvelope(await requestJson(`/api/mobile/market/discovery?symbol=${encodeURIComponent(item.symbol)}`, null, { cache: "no-store" }), item.symbol),
      item
    );
    ensureCurrent();
    await this.dependencies.candidates.refreshMemberships(true);
    ensureCurrent();
    if (!["available", "empty"].includes(this.dependencies.candidates.memberships.state)) {
      throw new Error("Fresh candidate memberships are unavailable; announcement continuation is UNKNOWN.");
    }
    const stock = { market: "HK" as const, code: current.symbol.slice(3), symbol: current.symbol };
    const action = assetsResearchMembershipAction(this.dependencies.candidates.memberships.memberships, stock);
    if (action.kind === "onboard") {
      ensureCurrent();
      input("membership-code").value = stock.code;
      input("membership-initial-state").value = "tracked";
      (input("membership-restore-archived") as HTMLInputElement).checked = action.restoreArchived;
      this.pendingOfficialAnnouncement = current;
      this.element("candidate-memberships")?.scrollIntoView({ block: "start" });
      return "onboarding";
    }
    ensureCurrent();
    this.documents.syncMembership(action.membership);
    this.futuFinancial.syncMembership(action.membership);
    this.documents.prepareOfficialAnnouncement(current, async (expected) => { await this.freshOfficialAnnouncement(expected); });
    this.pendingOfficialAnnouncement = null;
    this.element("research-documents-console")?.scrollIntoView({ block: "start" });
    return "prepared";
  }

  private async freshOfficialAnnouncement(expected: OfficialAnnouncementDiscoveryItem): Promise<void> {
    exactOfficialAnnouncement(
      acceptMarketDiscoveryEnvelope(await requestJson(`/api/mobile/market/discovery?symbol=${encodeURIComponent(expected.symbol)}`, null, { cache: "no-store" }), expected.symbol),
      expected
    );
  }

  private async resolveMarketResearchAction(stock: KnownHongKongStock): Promise<ReturnType<typeof marketResearchAction>> {
    const auth = candidateReadAuth();
    if (!auth) throw new Error("Current read authorization is required.");
    await this.dependencies.candidates.refreshMemberships(true);
    if (!sameWebApiAuth(auth, candidateReadAuth())) throw new Error("Read authorization changed during membership fresh-read.");
    if (this.dependencies.candidates.memberships.state !== "available") {
      if (this.dependencies.candidates.memberships.state === "empty") return { kind: "add" };
      throw new Error("Fresh candidate memberships are unavailable; Research action is UNKNOWN.");
    }
    return marketResearchAction(this.dependencies.candidates.memberships.memberships, stock);
  }

  private async openMarketResearch(stock: KnownHongKongStock, expected: MarketResearchAction): Promise<"added" | "opened"> {
    const action = await this.resolveMarketResearchAction(stock);
    if (action.kind !== expected) throw new Error("Membership state changed after Fresh Market; no stale action was applied.");
    if (action.kind === "open") {
      await this.openMembership({ id: action.membership.id, version: action.membership.version, symbol: action.membership.symbol }, "research", false);
      return "opened";
    }
    input("membership-code").value = stock.code;
    input("membership-initial-state").value = "tracked";
    (input("membership-restore-archived") as HTMLInputElement).checked = false;
    const membership = await this.dependencies.candidates.createMembership();
    if (!membership || membership.market !== stock.market || membership.code !== stock.code || membership.symbol !== stock.symbol) {
      throw new Error("Membership write result did not fresh-read the exact Market symbol, id, and version.");
    }
    await this.openMembership({ id: membership.id, version: membership.version, symbol: membership.symbol }, "research", false);
    return "added";
  }
}
