import type { DecisionReviewHistoryEnvelope, PostDecisionReviewData } from "../../../packages/contracts/src/decisionReview.js";
import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";
import type { ResearchReportDecisionBinding } from "../../../packages/contracts/src/researchReportDecision.js";
import type { TodayActionInboxEnvelope, TodayActionInboxItemKind, TodayMaterialChangeDispositionState } from "../../../packages/contracts/src/todayActionInbox.js";
import { sameWebApiAuth, type WebApiAuth } from "./apiClient.js";
import type { CockpitDestination, ExactCockpitMembership } from "./dailyResearchCockpit.js";
import {
  acceptTodayActionInboxEnvelope,
  cockpitFailureMessage,
  confirmsDailyTrackingReviewHistory,
  dailyTrackingReviewCheckIdentity,
  dailyTrackingReviewTarget,
  dailyTrackingTargetMatchesCheck,
  exactFormalDecisionTrackingItem,
  exactResolvedDailyTrackingItem,
  formalDecisionReportBinding,
  freshTodayActionItem,
  requestJson,
  todayItemDisplayState,
  writeTodayMaterialChangeDisposition,
  type DailyTrackingReviewCheck,
  type DailyTrackingReviewTarget
} from "./dailyResearchCockpitData.js";
interface TodayActionReviewWorkflowDependencies {
  readAuth: () => WebApiAuth | null;
  writeAuth: () => WebApiAuth | null;
  decisionAuth: () => WebApiAuth | null;
  currentMembership: () => ExactCockpitMembership | null;
  openMembership: (membership: ExactCockpitMembership, destination: CockpitDestination) => Promise<void>;
  prepareFormalDecision: (binding: ResearchReportDecisionBinding) => Promise<void>;
  activateDailyTrackingReview: (target: DailyTrackingReviewTarget) => string;
  activateOrdinaryReview: (item: TodayActionInboxEnvelope["items"][number], actorId: string) => string;
  invalidateDailyTrackingReview: (target: DailyTrackingReviewTarget) => void;
  isBusy: () => boolean;
  setBusy: (busy: boolean) => void;
  renderCockpit: () => void;
}
interface ActiveDailyTrackingReview {
  target: DailyTrackingReviewTarget;
  checkIdentity: string;
  readAuth: WebApiAuth;
  decisionAuth: WebApiAuth;
}
export function todayActionDestination(
  kind: TodayActionInboxItemKind,
  sourceLane?: TodayActionInboxEnvelope["items"][number]["source"]["lane"]
): CockpitDestination {
  return kind === "source_failure" && sourceLane === "market_quote" ? "market"
    : kind === "source_failure" && sourceLane === "review_due" ? "review"
    : kind === "formal_decision_due" ? "decision"
    : ["review_due", "daily_tracking"].includes(kind) ? "review"
      : kind === "research_profile_review_due" ? "research_profile" : "research";
}
export function todayActionCanOpen(item: TodayActionInboxEnvelope["items"][number]): boolean {
  if (item.state === "expired") return false;
  return todayItemDisplayState(item) !== "blocked"
    || item.kind === "source_failure";
}
export class TodayActionReviewWorkflow {
  private documentRef: Document | null = null;
  private today: TodayActionInboxEnvelope | null = null;
  private message = "Refresh to load a fresh cross-symbol action inbox.";
  private generation = 0;
  private retryKeys = new Map<string, { fingerprint: string; key: string; snoozedUntil: string | null }>();
  private adoptedReport: { binding: ResearchReportDecisionBinding; readAuth: WebApiAuth; decisionAuth: WebApiAuth } | null = null;
  private dailyTrackingReview: ActiveDailyTrackingReview | null = null;
  constructor(private readonly dependencies: TodayActionReviewWorkflowDependencies) {}
  mount(documentRef: Document): void {
    this.documentRef = documentRef;
    this.element("today-inbox-refresh")?.addEventListener("click", () => void this.refresh());
    this.element("today-inbox-list")?.addEventListener("click", (event) => void this.routeClick(event));
  }
  invalidateAuthorization(message: string): void {
    this.generation += 1;
    this.today = null;
    this.retryKeys.clear();
    this.adoptedReport = null;
    this.clearDailyTrackingReview();
    this.message = `${message} Previous Today actions were cleared.`;
  }

  async refresh(): Promise<void> {
    const auth = this.dependencies.readAuth();
    const generation = ++this.generation;
    this.today = null;
    this.adoptedReport = null;
    this.clearDailyTrackingReview();
    if (!auth) {
      this.message = "Read authorization is required. Previous Today actions were cleared.";
      this.render();
      return;
    }
    this.message = "Loading a fresh Today action inbox…";
    this.dependencies.setBusy(true);
    this.render();
    try {
      const value = await requestJson("/api/mobile/research/today/inbox", auth, { cache: "no-store" });
      if (generation !== this.generation) return;
      this.today = acceptTodayActionInboxEnvelope(value);
      this.message = this.today.message;
    } catch (error) {
      if (generation !== this.generation) return;
      this.today = null;
      this.message = `${cockpitFailureMessage(error)} Previous Today actions were cleared.`;
    } finally {
      if (generation === this.generation) {
        this.dependencies.setBusy(false);
        this.render();
      }
    }
  }

  adoptedReportBinding(membership: ExactCockpitMembership | null): ResearchReportDecisionBinding | null {
    const adopted = this.adoptedReport;
    if (!adopted || !membership || !sameWebApiAuth(adopted.readAuth, this.dependencies.readAuth())
      || !sameWebApiAuth(adopted.decisionAuth, this.dependencies.decisionAuth())
      || adopted.binding.membershipId !== membership.id || adopted.binding.membershipVersion !== membership.version
      || adopted.binding.symbol !== membership.symbol) {
      this.adoptedReport = null;
      return null;
    }
    return adopted.binding;
  }

  matchesAdoptedReportBinding(binding: ResearchReportDecisionBinding, membership: ExactCockpitMembership | null): boolean {
    const current = this.adoptedReportBinding(membership);
    return current !== null && canonicalJson(current) === canonicalJson(binding);
  }

  async completeFormalDecision(binding: ResearchReportDecisionBinding, decisionCheckId: string): Promise<void> {
    if (!this.adoptedReport || canonicalJson(this.adoptedReport.binding) !== canonicalJson(binding)) {
      throw new Error("Fresh decision readback no longer matches the explicitly adopted report.");
    }
    this.adoptedReport = null;
    await this.refresh();
    try {
      if (!this.today) throw new Error("Fresh Today is unavailable after the decision write.");
      exactFormalDecisionTrackingItem(this.today, binding, decisionCheckId);
    } catch (error) {
      this.today = null;
      this.message = `Decision was preserved, but Today tracking continuity is UNKNOWN: ${error instanceof Error ? error.message : "fresh tracking read failed"}`;
      this.render();
      throw new Error(this.message, { cause: error });
    }
  }

  hasDailyTrackingReview(): boolean { return this.dailyTrackingReview !== null; }

  hideDailyTrackingReviewUntilReadback(reviewId: string): void {
    if (!this.dailyTrackingReview) throw new Error("The DAILY_TRACKING selection is unavailable after review write.");
    this.today = null;
    this.message = `Review ${reviewId} may have been written. The old Today action was hidden; use the same explicit submission to retry fresh review history and Today resolved readback.`;
    this.render();
  }

  async prepareDailyTrackingReview(check: DailyTrackingReviewCheck): Promise<ResearchReportDecisionBinding> {
    const selected = this.dailyTrackingReview;
    if (!selected || this.dependencies.isBusy()) throw new Error("A fresh DAILY_TRACKING selection is required before review submission.");
    const generation = ++this.generation;
    this.today = null;
    this.message = "Fresh-reading the exact DAILY_TRACKING item before explicit review submission…";
    this.dependencies.setBusy(true);
    this.render();
    try {
      this.assertDailyTrackingSelectionCurrent(selected, check);
      const fresh = await freshTodayActionItem(selected.target.item, selected.readAuth, this.dependencies.readAuth);
      if (generation !== this.generation || this.dailyTrackingReview !== selected) throw new Error("Daily tracking selection changed during fresh read.");
      const target = dailyTrackingReviewTarget(fresh.envelope, fresh.item);
      if (canonicalJson(target.reportBinding) !== canonicalJson(selected.target.reportBinding)
        || target.requestedActorId !== selected.target.requestedActorId
        || target.decisionCheckId !== selected.target.decisionCheckId) {
        throw new Error("Fresh DAILY_TRACKING actor, check, report, or pack binding changed before submission.");
      }
      this.assertDailyTrackingSelectionCurrent(selected, check);
      this.today = fresh.envelope;
      this.dailyTrackingReview = { ...selected, target };
      this.message = `Fresh DAILY_TRACKING check ${target.decisionCheckId} and report ${target.reportBinding.reportId} v${target.reportBinding.reportVersion} confirmed; review still requires explicit submission.`;
      return target.reportBinding;
    } catch (error) {
      if (generation === this.generation && this.dailyTrackingReview === selected) {
        this.today = null;
        this.clearDailyTrackingReview();
        this.message = `Daily tracking review blocked: ${cockpitFailureMessage(error)} Previous review success was cleared.`;
      }
      throw error;
    } finally {
      if (generation === this.generation) {
        this.dependencies.setBusy(false);
        this.render();
      }
    }
  }

  async completeDailyTrackingReview(
    history: DecisionReviewHistoryEnvelope,
    review: PostDecisionReviewData,
    check: DailyTrackingReviewCheck
  ): Promise<void> {
    const selected = this.dailyTrackingReview;
    if (!selected || this.dependencies.isBusy()) throw new Error("The DAILY_TRACKING selection is unavailable after review write.");
    try {
      this.assertDailyTrackingSelectionCurrent(selected, check);
      if (!confirmsDailyTrackingReviewHistory(history, review, selected.target, selected.checkIdentity)) {
        throw new Error("Fresh review history did not confirm the exact DAILY_TRACKING reviewId and immutable check binding.");
      }
    } catch (error) {
      this.today = null;
      this.clearDailyTrackingReview();
      this.message = `Daily tracking review confirmation failed: ${cockpitFailureMessage(error)} Previous success was cleared.`;
      this.render();
      throw error;
    }
    const generation = ++this.generation;
    this.today = null;
    this.message = `Review ${review.id} was written; fresh-reading Today before showing success…`;
    this.dependencies.setBusy(true);
    this.render();
    let receivedFreshToday = false;
    try {
      const envelope = acceptTodayActionInboxEnvelope(await requestJson("/api/mobile/research/today/inbox", selected.readAuth, { cache: "no-store" }));
      receivedFreshToday = true;
      if (generation !== this.generation || this.dailyTrackingReview !== selected) throw new Error("Daily tracking selection changed during Today readback.");
      this.assertDailyTrackingSelectionCurrent(selected, check);
      exactResolvedDailyTrackingItem(envelope, selected.target, review);
      this.today = envelope;
      this.dailyTrackingReview = null;
      this.message = `Fresh review history and Today confirmed review ${review.id}; the exact DAILY_TRACKING item is resolved.`;
    } catch (error) {
      if (generation === this.generation) {
        this.today = null;
        if (receivedFreshToday && this.dailyTrackingReview === selected) this.clearDailyTrackingReview();
        this.message = `Review write is preserved, but success remains UNKNOWN until fresh Today confirms the exact resolved reviewId: ${cockpitFailureMessage(error)}`;
      }
      throw error;
    } finally {
      if (generation === this.generation) {
        this.dependencies.setBusy(false);
        this.render();
      }
    }
  }

  renderView(): void {
    const list = this.element("today-inbox-list");
    const status = this.element("today-inbox-status");
    const host = this.element("today-action-inbox");
    if (status) status.textContent = this.message;
    if (!(list instanceof HTMLUListElement)) return;
    const items = this.today?.items ?? [];
    if (host) host.dataset.state = this.today === null ? "unknown"
      : items.some((item) => item.state === "new" && todayItemDisplayState(item) !== "blocked") ? "actionable"
        : items.some((item) => todayItemDisplayState(item) === "blocked") ? "blocked"
          : items.some((item) => item.state === "later") ? "later"
          : items.length ? "completed" : "empty";
    const scopeNote = this.documentRef!.querySelector("[data-today-inbox-scope]") ?? this.documentRef!.createElement("p");
    scopeNote.setAttribute("data-today-inbox-scope", "true");
    scopeNote.textContent = "Today 根据已存资料整理待办；暂无待办不代表外部信息没有变化，请按研究档案中的监控清单继续核对。";
    if (!scopeNote.isConnected) list.parentElement?.insertBefore(scopeNote, list);
    const renderRow = (item: TodayActionInboxEnvelope["items"][number]): HTMLLIElement => {
      const row = this.documentRef!.createElement("li");
      const state = todayItemDisplayState(item);
      const summary = this.documentRef!.createElement("p");
      summary.textContent = `${state} · ${item.kind} · ${item.state} · ${item.symbol} · membership ${item.membership.id} v${item.membership.version}`;
      const title = this.documentRef!.createElement("strong");
      title.textContent = item.title;
      const detail = this.documentRef!.createElement("p");
      detail.textContent = `${item.summary} Source ${item.source.sourceType}; freshness ${item.source.freshness}; cutoff ${item.source.asOf ?? item.source.effectiveAt ?? "not captured"}.`;
      const button = this.documentRef!.createElement("button");
      button.type = "button";
      button.dataset.todayItemId = item.id;
      button.dataset.todayActionState = item.state;
      button.dataset.todayDisplayState = state;
      button.disabled = !todayActionCanOpen(item);
      button.textContent = state === "blocked" && item.source.lane === "market_quote" ? "Open Market to retry"
        : state === "blocked" && item.source.lane === "review_due" ? "Open Review to retry"
        : state === "blocked" && todayActionCanOpen(item) ? "Open Research to retry"
        : state === "blocked" ? "Blocked by source"
        : item.state === "expired" ? "来源已过期，等待新版本"
        : item.kind === "formal_decision_due" ? "采用当前已确认报告"
          : item.kind === "research_profile_review_due" ? "Review research profile"
          : `Open in ${["review_due", "daily_tracking"].includes(item.kind) ? "Review" : "Research"}`;
      row.append(title, summary, detail, button);
      const dispositionStates = item.source.sourceFingerprint === null ? []
        : item.kind === "material_change" && item.state === "resolved" ? ["new"] as const
          : item.state === "later" ? item.kind === "material_change" ? ["new", "resolved"] as const : ["new"] as const
            : item.state === "new" ? item.kind === "material_change" ? ["later", "resolved"] as const : ["later"] as const : [];
      if (dispositionStates.length) {
        row.append(...dispositionStates.map((dispositionState) => {
          const disposition = this.documentRef!.createElement("button");
          disposition.type = "button";
          disposition.dataset.todayDispositionItemId = item.id;
          disposition.dataset.todayDispositionState = dispositionState;
          disposition.disabled = item.state === dispositionState;
          disposition.textContent = dispositionState === "later" ? "稍后 24 小时" : dispositionState === "new" ? "立即恢复" : "已处理";
          return disposition;
        }));
      }
      return row;
    };
    const blocked = (item: TodayActionInboxEnvelope["items"][number]): boolean => todayItemDisplayState(item) === "blocked";
    list.replaceChildren(
      ...items.filter((item) => item.state === "new" && !blocked(item)).map(renderRow),
      ...[
        { label: "稍后处理", group: items.filter((item) => item.state === "later" && !blocked(item)) },
        { label: "已完成", group: items.filter((item) => item.state === "resolved" && !blocked(item)) },
        { label: "已过期", group: items.filter((item) => item.state === "expired" && !blocked(item)) },
        { label: "受阻 / 数据源失败", group: items.filter(blocked) }
      ].filter((entry) => entry.group.length).map((entry) => {
        const group = this.documentRef!.createElement("li");
        const details = this.documentRef!.createElement("details");
        const summary = this.documentRef!.createElement("summary");
        summary.textContent = `${entry.label}（${entry.group.length}）`;
        const rows = this.documentRef!.createElement("ul");
        rows.replaceChildren(...entry.group.map(renderRow));
        details.append(summary, rows);
        group.append(details);
        return group;
      })
    );
    const refresh = this.element("today-inbox-refresh");
    if (refresh instanceof HTMLButtonElement) refresh.disabled = this.dependencies.isBusy();
  }

  private async routeClick(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const dispositionButton = target.closest("button[data-today-disposition-item-id]");
    if (dispositionButton instanceof HTMLButtonElement) {
      const state = dispositionButton.dataset.todayDispositionState;
      if (state === "new" || state === "later" || state === "resolved") await this.disposition(dispositionButton.dataset.todayDispositionItemId ?? "", state);
      return;
    }
    const openButton = target.closest("button[data-today-item-id]");
    if (!(openButton instanceof HTMLButtonElement) || !this.today || this.dependencies.isBusy()) return;
    const matches = this.today.items.filter((item) => item.id === openButton.dataset.todayItemId);
    if (matches.length !== 1 || !todayActionCanOpen(matches[0])) return;
    const expected = matches[0];
    const auth = this.dependencies.readAuth();
    const decisionAuth = this.dependencies.decisionAuth();
    const generation = ++this.generation;
    this.today = null;
    this.adoptedReport = null;
    this.clearDailyTrackingReview();
    this.message = `Fresh-reading ${expected.id} before navigation…`;
    this.dependencies.setBusy(true);
    this.render();
    try {
      if (!auth) throw new Error("Read authorization is required.");
      const fresh = await freshTodayActionItem(expected, auth, this.dependencies.readAuth);
      if (generation !== this.generation) return;
      if (!todayActionCanOpen(fresh.item)) throw new Error("Blocked/source-failure Today items cannot be opened.");
      this.today = fresh.envelope;
      const destination = todayActionDestination(fresh.item.kind, fresh.item.source.lane);
      const reportBinding = fresh.item.kind === "formal_decision_due" ? formalDecisionReportBinding(fresh.envelope, fresh.item) : null;
      const dailyTracking = fresh.item.kind === "daily_tracking" && fresh.item.state === "new" ? dailyTrackingReviewTarget(fresh.envelope, fresh.item) : null;
      const ordinaryReview = fresh.item.kind === "review_due" ? fresh.item : null;
      if ((reportBinding || dailyTracking) && !decisionAuth) throw new Error("Decision-write authorization is required before adopting a report-bound action.");
      await this.dependencies.openMembership(fresh.item.membership, destination);
      if (generation !== this.generation) return;
      if (reportBinding) await this.dependencies.prepareFormalDecision(reportBinding);
      if (generation !== this.generation) return;
      if (!sameWebApiAuth(auth, this.dependencies.readAuth()) || !sameWebApiAuth(decisionAuth, this.dependencies.decisionAuth())) {
        throw new Error("Authorization changed during Today navigation.");
      }
      if (reportBinding) this.adoptedReport = { binding: reportBinding, readAuth: auth, decisionAuth: decisionAuth! };
      if (dailyTracking) {
        const checkIdentity = this.dependencies.activateDailyTrackingReview(dailyTracking);
        this.dailyTrackingReview = { target: dailyTracking, checkIdentity, readAuth: auth, decisionAuth: decisionAuth! };
      }
      if (ordinaryReview) this.dependencies.activateOrdinaryReview(ordinaryReview, fresh.envelope.requestedActorId);
      this.message = reportBinding
        ? `已显式采用当前已确认报告 ${reportBinding.reportId} v${reportBinding.reportVersion}；正式决定仍需单独提交。`
        : dailyTracking
          ? `已打开正式决定检查 ${dailyTracking.decisionCheckId} 的每日跟踪；复盘仍需显式提交。`
          : ordinaryReview
            ? `已打开同一决定检查 ${ordinaryReview.reviewEvent?.sourceEventId} 的复盘；提交仍需显式确认。`
          : `Opened ${fresh.item.symbol} membership ${fresh.item.membership.id} v${fresh.item.membership.version} in existing ${destination === "market" ? "Market" : destination === "review" ? "Review" : destination === "research_profile" ? "Research profile" : "Research"} controls.`;
    } catch (error) {
      if (generation !== this.generation) return;
      this.today = null;
      this.message = `Navigation blocked: ${cockpitFailureMessage(error)} Previous Today actions were cleared.`;
    } finally {
      if (generation === this.generation) this.dependencies.setBusy(false);
    }
    this.render();
  }

  private async disposition(itemId: string, state: TodayMaterialChangeDispositionState): Promise<void> {
    if (!this.today || this.dependencies.isBusy()) return;
    const matches = this.today.items.filter((item) => item.id === itemId);
    if (matches.length !== 1) return;
    const envelope = this.today;
    const item = matches[0];
    const readAuth = this.dependencies.readAuth();
    const writeAuth = this.dependencies.writeAuth();
    const generation = ++this.generation;
    const scope = `disposition:${item.id}:${state}`;
    const fingerprint = JSON.stringify([item.id, item.membership.version, item.source.sourceFingerprint, state]);
    const reservation = this.retryKeys.get(scope);
    const snoozedUntil = state === "later" ? reservation?.fingerprint === fingerprint ? reservation.snoozedUntil : new Date(Date.now() + 86_400_000).toISOString() : null;
    const idempotencyKey = this.retryKey(scope, fingerprint, snoozedUntil);
    this.today = null;
    this.message = `Submitting explicit ${state === "later" ? "稍后" : state === "new" ? "立即恢复" : "已处理"} and waiting for a fresh exact Today readback…`;
    this.dependencies.setBusy(true);
    this.render();
    try {
      if (!readAuth || !writeAuth) throw new Error("Read and research-write authorization are required.");
      const result = await writeTodayMaterialChangeDisposition({
        envelope, item, state, snoozedUntil, idempotencyKey, readAuth, writeAuth,
        currentReadAuth: this.dependencies.readAuth,
        currentWriteAuth: this.dependencies.writeAuth
      });
      if (generation !== this.generation) return;
      this.today = result.envelope;
      this.retryKeys.delete(scope);
      this.message = `Fresh readback confirmed ${item.symbol} Today action as ${state === "later" ? "稍后" : state === "new" ? "待处理" : "已处理"}.`;
    } catch (error) {
      if (generation !== this.generation) return;
      this.today = null;
      this.message = `Disposition blocked: ${cockpitFailureMessage(error)} Previous Today success was cleared; retry keeps the same idempotency key.`;
    } finally {
      if (generation === this.generation) this.dependencies.setBusy(false);
    }
    this.render();
  }

  private assertDailyTrackingSelectionCurrent(selected: ActiveDailyTrackingReview, check: DailyTrackingReviewCheck): void {
    const membership = this.dependencies.currentMembership();
    if (!sameWebApiAuth(selected.readAuth, this.dependencies.readAuth())
      || !sameWebApiAuth(selected.decisionAuth, this.dependencies.decisionAuth())
      || !membership || membership.id !== selected.target.item.membership.id
      || membership.version !== selected.target.item.membership.version
      || membership.symbol !== selected.target.item.symbol
      || dailyTrackingReviewCheckIdentity(check) !== selected.checkIdentity
      || !dailyTrackingTargetMatchesCheck(selected.target, check)) {
      throw new Error("Daily tracking actor, authorization, symbol, membership, check, report, or pack binding drifted.");
    }
  }

  private clearDailyTrackingReview(): void {
    const selected = this.dailyTrackingReview;
    this.dailyTrackingReview = null;
    if (selected) this.dependencies.invalidateDailyTrackingReview(selected.target);
  }

  private retryKey(scope: string, fingerprint: string, snoozedUntil: string | null): string {
    const current = this.retryKeys.get(scope);
    if (current?.fingerprint === fingerprint) return current.key;
    const key = crypto.randomUUID();
    this.retryKeys.set(scope, { fingerprint, key, snoozedUntil });
    return key;
  }

  private render(): void { this.dependencies.renderCockpit(); }
  private element(id: string): HTMLElement | null { return this.documentRef?.getElementById(id) ?? null; }
}
