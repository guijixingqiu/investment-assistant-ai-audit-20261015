import type { MarketDiscoveryCandidate, MarketDiscoveryEnvelope, MarketDiscoveryQualificationEnvelope, NoticeLeadDiscoveryItem, OfficialAnnouncementDiscoveryItem } from "../../../packages/contracts/src/marketDiscovery.js";
import type { ResearchReportDecisionBinding } from "../../../packages/contracts/src/researchReportDecision.js";
import type { DecisionReviewHistoryEnvelope, PostDecisionReviewData } from "../../../packages/contracts/src/decisionReview.js";
import type { TodayActionInboxEnvelope } from "../../../packages/contracts/src/todayActionInbox.js";
import { sameWebApiAuth, type WebApiAuth } from "./apiClient.js";
import {
  acceptMarketDiscoveryEnvelope,
  acceptMarketDiscoveryQualification,
  cockpitFailureMessage,
  requestJson,
  type DailyTrackingReviewCheck,
  type DailyTrackingReviewTarget
} from "./dailyResearchCockpitData.js";
import { TodayActionReviewWorkflow } from "./todayActionReviewWorkflow.js";
export { acceptMarketDiscoveryEnvelope, acceptMarketDiscoveryQualification, acceptTodayActionInboxEnvelope, todayItemDisplayState } from "./dailyResearchCockpitData.js";
export interface ExactCockpitMembership {
  id: string;
  version: number;
  symbol: string;
}
export function suggestedInformationLeadEventKind(
  item: Pick<NoticeLeadDiscoveryItem, "kind" | "title">
): "announcement" | "financial_report" | "corporate_action" | "major_news" {
  if (item.kind === "major_news") return "major_news";
  const title = item.title.toLowerCase();
  if (["annual results", "interim results", "quarterly results", "annual report",
    "年度业绩", "中期业绩", "季度业绩", "年报", "中报"].some((keyword) => title.includes(keyword))) {
    return "financial_report";
  }
  if (["dividend", "share repurchase", "buy-back", "rights issue", "placing",
    "派息", "股息", "回购", "供股", "配股", "股份拆细", "股份合并"].some((keyword) => title.includes(keyword))) {
    return "corporate_action";
  }
  return "announcement";
}
export type CockpitDestination = "market" | "research" | "research_profile" | "decision" | "review";
interface DailyResearchCockpitDependencies {
  readAuth: () => WebApiAuth | null;
  writeAuth: () => WebApiAuth | null;
  decisionAuth: () => WebApiAuth | null;
  currentSymbol: () => string | null;
  currentMembership: () => ExactCockpitMembership | null;
  openMembership: (membership: ExactCockpitMembership, destination: CockpitDestination) => Promise<void>;
  prepareFormalDecision: (binding: ResearchReportDecisionBinding) => Promise<void>;
  continueQualifiedCandidate: (candidate: MarketDiscoveryCandidate) => Promise<void>;
  continueOfficialAnnouncement: (item: OfficialAnnouncementDiscoveryItem) => Promise<"onboarding" | "prepared">;
  activateDailyTrackingReview: (target: DailyTrackingReviewTarget) => string;
  activateOrdinaryReview: (item: TodayActionInboxEnvelope["items"][number], actorId: string) => string;
  invalidateDailyTrackingReview: (target: DailyTrackingReviewTarget) => void;
}
export class DailyResearchCockpit {
  private documentRef: Document | null = null;
  private discovery: MarketDiscoveryEnvelope | null = null;
  private qualification: MarketDiscoveryQualificationEnvelope | null = null;
  private qualifiedCandidate: MarketDiscoveryCandidate | null = null;
  private marketMessage = "Refresh to load current market discovery without ranking or recommendation.";
  private qualificationMessage = "Explicitly qualify one current candidate before adding it to Research.";
  private marketGeneration = 0;
  private qualificationGeneration = 0;
  private busy = false;
  private readonly todayWorkflow: TodayActionReviewWorkflow;
  constructor(private readonly dependencies: DailyResearchCockpitDependencies) {
    this.todayWorkflow = new TodayActionReviewWorkflow({
      ...dependencies,
      isBusy: () => this.busy,
      setBusy: (busy) => { this.busy = busy; },
      renderCockpit: () => this.render()
    });
  }

  mount(documentRef: Document = document): void {
    this.documentRef = documentRef;
    this.todayWorkflow.mount(documentRef);
    this.element("market-discovery-refresh")?.addEventListener("click", () => void this.refreshMarket());
    this.element("market-discovery-list")?.addEventListener("click", (event) => void this.routeMarketClick(event));
    this.element("market-information-list")?.addEventListener("click", (event) => void this.routeMarketClick(event));
    this.element("market-announcement-list")?.addEventListener("click", (event) => void this.routeMarketClick(event));
    this.element("market-qualification-output")?.addEventListener("click", (event) => void this.routeQualificationClick(event));
    this.render();
  }

  invalidateAuthorization(message: string): void {
    this.todayWorkflow.invalidateAuthorization(message);
    this.marketGeneration += 1;
    this.qualificationGeneration += 1;
    this.discovery = null;
    this.qualification = null;
    this.qualifiedCandidate = null;
    this.busy = false;
    this.marketMessage = `${message} Discovery is UNKNOWN until a fresh read.`;
    this.qualificationMessage = `${message} Previous qualification was cleared.`;
    this.render();
  }

  invalidateMarketContinuation(message: string): void {
    this.todayWorkflow.invalidateAuthorization(message);
    this.marketGeneration += 1;
    this.qualificationGeneration += 1;
    this.discovery = null;
    this.qualification = null;
    this.qualifiedCandidate = null;
    this.busy = false;
    this.marketMessage = `${message} Previous discovery and announcement continuation were cleared.`;
    this.qualificationMessage = `${message} Previous qualification was cleared.`;
    this.render();
  }

  refreshToday(): Promise<void> { return this.todayWorkflow.refresh(); }

  adoptedReportBinding(membership: ExactCockpitMembership | null): ResearchReportDecisionBinding | null {
    return this.todayWorkflow.adoptedReportBinding(membership);
  }

  matchesAdoptedReportBinding(binding: ResearchReportDecisionBinding, membership: ExactCockpitMembership | null): boolean {
    return this.todayWorkflow.matchesAdoptedReportBinding(binding, membership);
  }

  async completeFormalDecision(binding: ResearchReportDecisionBinding, decisionCheckId: string): Promise<void> {
    return this.todayWorkflow.completeFormalDecision(binding, decisionCheckId);
  }

  hasDailyTrackingReview(): boolean { return this.todayWorkflow.hasDailyTrackingReview(); }

  hideDailyTrackingReviewUntilReadback(reviewId: string): void {
    this.todayWorkflow.hideDailyTrackingReviewUntilReadback(reviewId);
  }

  async prepareDailyTrackingReview(check: DailyTrackingReviewCheck): Promise<ResearchReportDecisionBinding> {
    return this.todayWorkflow.prepareDailyTrackingReview(check);
  }

  showAnnouncementContinuation(message: string): void {
    this.marketMessage = message;
    this.render();
  }

  async completeDailyTrackingReview(
    history: DecisionReviewHistoryEnvelope,
    review: PostDecisionReviewData,
    check: DailyTrackingReviewCheck
  ): Promise<void> {
    return this.todayWorkflow.completeDailyTrackingReview(history, review, check);
  }

  async refreshMarket(): Promise<void> {
    if (this.busy) return;
    const generation = ++this.marketGeneration;
    this.qualificationGeneration += 1;
    this.discovery = null;
    this.qualification = null;
    this.qualifiedCandidate = null;
    this.marketMessage = "Loading a fresh discovery snapshot…";
    this.qualificationMessage = "Qualification cleared while discovery refreshes.";
    this.busy = true;
    this.render();
    try {
      const symbol = this.dependencies.currentSymbol() ?? "HK.00175";
      const value = await requestJson(`/api/mobile/market/discovery?symbol=${encodeURIComponent(symbol)}`, null, { cache: "no-store" });
      if (generation !== this.marketGeneration) return;
      this.discovery = acceptMarketDiscoveryEnvelope(value, symbol);
      this.marketMessage = `Discovery available · ${this.discovery.eligibility.message} Candidates ${this.discovery.candidates.source} fetched ${this.discovery.candidates.fetchedAt}; OpenD information ${this.discovery.notices.source} fetched ${this.discovery.notices.fetchedAt}; announcements ${this.discovery.announcements.source} fetched ${this.discovery.announcements.fetchedAt}. ${this.discovery.message}`;
      this.qualificationMessage = "Choose one candidate and explicitly run qualification. API order is not a ranking.";
    } catch (error) {
      if (generation !== this.marketGeneration) return;
      this.discovery = null;
      this.marketMessage = `Discovery UNKNOWN · ${cockpitFailureMessage(error)} Partial, unavailable, stale, or malformed facts were cleared.`;
    } finally {
      if (generation === this.marketGeneration) {
        this.busy = false;
        this.render();
      }
    }
  }

  private async qualify(candidate: MarketDiscoveryCandidate): Promise<void> {
    if (this.busy) return;
    const auth = this.dependencies.readAuth();
    const discovery = this.discovery;
    const generation = ++this.qualificationGeneration;
    this.qualification = null;
    this.qualifiedCandidate = null;
    if (!auth || !discovery || discovery.candidates.fetchedAt === null) {
      this.qualificationMessage = "A fresh full discovery snapshot and read authorization are required. Previous qualification was cleared.";
      this.render();
      return;
    }
    this.qualificationMessage = `Qualifying ${candidate.symbol} against the exact current discovery snapshot…`;
    this.busy = true;
    this.render();
    try {
      const value = await requestJson("/api/mobile/market/discovery/qualifications", auth, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidate, discoveryFetchedAt: discovery.candidates.fetchedAt })
      });
      const qualification = await acceptMarketDiscoveryQualification(value, discovery, candidate);
      if (generation !== this.qualificationGeneration || discovery !== this.discovery) return;
      if (!sameWebApiAuth(auth, this.dependencies.readAuth())) throw new Error("Read authorization changed during qualification.");
      this.qualification = qualification;
      this.qualifiedCandidate = candidate;
      this.qualificationMessage = `Qualification available · ${this.qualification.message}`;
    } catch (error) {
      if (generation !== this.qualificationGeneration) return;
      this.qualification = null;
      this.qualifiedCandidate = null;
      this.qualificationMessage = `Qualification UNKNOWN · ${cockpitFailureMessage(error)} Conflict, drift, or partial output was cleared.`;
    } finally {
      if (generation === this.qualificationGeneration) {
        this.busy = false;
        this.render();
      }
    }
  }

  private async routeMarketClick(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const informationButton = target.closest("button[data-verify-information-id]");
    if (informationButton instanceof HTMLButtonElement && this.discovery && !this.busy) {
      const item = this.discovery.notices.items.find((candidate) => candidate.id === informationButton.dataset.verifyInformationId);
      if (item) this.prepareInformationLead(item);
      return;
    }
    const announcementButton = target.closest("button[data-continue-announcement-id]");
    if (announcementButton instanceof HTMLButtonElement && this.discovery && !this.busy) {
      const item = this.discovery.announcements.items.find((candidate) => candidate.id === announcementButton.dataset.continueAnnouncementId);
      if (item) await this.continueAnnouncement(item);
      return;
    }
    const button = target.closest("button[data-qualify-symbol]");
    if (!(button instanceof HTMLButtonElement) || !this.discovery || this.busy) return;
    const candidate = this.discovery.candidates.candidates.find((item) => item.symbol === button.dataset.qualifySymbol);
    if (candidate) await this.qualify(candidate);
  }

  private prepareInformationLead(item: NoticeLeadDiscoveryItem): void {
    const membership = this.dependencies.currentMembership();
    const ids = ["deep-material-title", "deep-material-content", "deep-material-source-type", "deep-material-source-url",
      "deep-material-published-at", "deep-material-valid-until", "deep-material-claim-type", "deep-material-verification",
      "deep-material-rights", "deep-material-source-version", "deep-material-summary", "deep-material-variable",
      "deep-material-stance", "deep-material-reliability", "deep-material-materiality", "deep-material-read",
      "deep-event-kind", "deep-event-scope"];
    const fields = Object.fromEntries(ids.map((id) => [id, this.element(id)]));
    if (!membership || membership.symbol !== item.symbol || ids.some((id) => !(fields[id] instanceof HTMLInputElement
      || fields[id] instanceof HTMLSelectElement || fields[id] instanceof HTMLTextAreaElement))) {
      this.marketMessage = `Open the exact active ${item.symbol} Research membership before preparing this lead. No draft or fact was changed.`;
      return this.render();
    }
    if (["deep-material-title", "deep-material-content", "deep-material-source-url", "deep-material-summary", "deep-material-variable"]
      .some((id) => (fields[id] as HTMLInputElement | HTMLTextAreaElement).value.trim())) {
      this.marketMessage = "The current Research material draft is not empty. Finish or clear it before replacing it with this lead.";
      return this.render();
    }
    const publishedAt = new Date(item.publishedAt);
    const validUntil = new Date(publishedAt.getTime() + 90 * 24 * 60 * 60 * 1_000);
    const eventKind = suggestedInformationLeadEventKind(item);
    const set = (id: string, value: string): void => { (fields[id] as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value = value; };
    set("deep-material-title", item.title);
    set("deep-material-source-type", `owner_verified_${eventKind}`);
    set("deep-material-source-url", item.url);
    set("deep-material-published-at", localDateTimeValue(publishedAt));
    set("deep-material-valid-until", localDateTimeValue(validUntil));
    set("deep-material-claim-type", "third_party_statement");
    set("deep-material-verification", "unverified");
    set("deep-material-rights", "unknown");
    set("deep-material-source-version", `opend-${item.kind}:${item.publishedAt}:${item.id}`);
    set("deep-material-stance", "neutral");
    set("deep-material-reliability", "");
    set("deep-material-materiality", "");
    (fields["deep-material-read"] as HTMLInputElement).checked = false;
    set("deep-event-kind", eventKind);
    set("deep-event-scope", "research_stock");
    this.marketMessage = `${eventKind.replaceAll("_", " ")} lead prepared for ${item.symbol}. Add an evidence summary, verify source and rights, then explicitly save; nothing was written.`;
    this.element("deep-research-console")?.scrollIntoView({ block: "start" });
    this.render();
  }

  private async continueAnnouncement(item: OfficialAnnouncementDiscoveryItem): Promise<void> {
    const generation = ++this.marketGeneration;
    this.busy = true;
    this.marketMessage = `Fresh-checking ${item.symbol} announcement identity before any PDF import…`;
    this.render();
    try {
      const outcome = await this.dependencies.continueOfficialAnnouncement(item);
      if (generation !== this.marketGeneration) return;
      this.marketMessage = outcome === "prepared"
        ? "Official announcement identity and membership were fresh-read. Choose the same downloaded PDF, confirm rights, then explicitly upload."
        : "Official announcement identity is retained. Explicitly Add or Restore the prepared membership; no PDF was imported.";
    } catch (error) {
      if (generation !== this.marketGeneration) return;
      this.marketMessage = `Announcement continuation UNKNOWN · ${cockpitFailureMessage(error)} No PDF was imported.`;
    } finally {
      if (generation === this.marketGeneration) this.busy = false;
      this.render();
    }
  }

  private async routeQualificationClick(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-add-qualified-symbol]");
    if (!(button instanceof HTMLButtonElement) || !this.qualification || !this.qualifiedCandidate || this.busy
      || button.dataset.addQualifiedSymbol !== this.qualifiedCandidate.symbol) return;
    const candidate = this.qualifiedCandidate;
    const generation = ++this.qualificationGeneration;
    this.qualification = null;
    this.qualifiedCandidate = null;
    this.busy = true;
    this.qualificationMessage = `Opening ${candidate.symbol} in current Market facts before any Research write…`;
    this.render();
    try {
      await this.dependencies.continueQualifiedCandidate(candidate);
      if (generation !== this.qualificationGeneration) return;
      this.qualificationMessage = `${candidate.symbol} moved to current Market facts. Review them, then explicitly add or open Research; no membership was written here.`;
    } catch (error) {
      if (generation !== this.qualificationGeneration) return;
      this.qualificationMessage = `Market continuation UNKNOWN: ${cockpitFailureMessage(error)} Run a fresh qualification before retrying.`;
    } finally {
      if (generation === this.qualificationGeneration) this.busy = false;
    }
    this.render();
  }

  private render(): void {
    if (!this.documentRef) return;
    this.todayWorkflow.renderView();
    this.setText("market-discovery-status", this.marketMessage);
    this.setText("market-qualification-status", this.qualificationMessage);
    this.renderDiscovery();
    this.renderQualification();
    const button = this.element("market-discovery-refresh");
    if (button instanceof HTMLButtonElement) button.disabled = this.busy;
  }

  private renderDiscovery(): void {
    const list = this.element("market-discovery-list");
    const information = this.element("market-information-list");
    const announcements = this.element("market-announcement-list");
    if (!(list instanceof HTMLUListElement) || !(information instanceof HTMLUListElement)
      || !(announcements instanceof HTMLUListElement)) return;
    const discovery = this.discovery;
    list.replaceChildren(...(discovery?.candidates.candidates ?? []).map((candidate) => {
      const row = this.documentRef!.createElement("li");
      const title = this.documentRef!.createElement("strong");
      title.textContent = `${candidate.symbol} ${candidate.name}`;
      const facts = this.documentRef!.createElement("p");
      facts.textContent = `Source ${discovery!.candidates.source}; screen ${discovery!.candidates.rule.id}; price ${candidate.price}; market cap ${candidate.marketCap}; turnover ${candidate.average20DayTurnover}; volume ratio ${candidate.volumeRatio}; 5-day change ${candidate.fiveDayChangePercent}%; industry ${candidate.industry ?? "UNKNOWN"}.`;
      const cutoff = this.documentRef!.createElement("p");
      cutoff.textContent = `Fresh-read response ${discovery!.generatedAt}; source fetched ${discovery!.candidates.fetchedAt}; fact cutoff ${candidate.asOf}. Age is not independently certified. ${candidate.why}`;
      const button = this.documentRef!.createElement("button");
      button.type = "button";
      button.dataset.qualifySymbol = candidate.symbol;
      button.textContent = "Explicitly qualify";
      row.append(title, facts, cutoff, button);
      return row;
    }));
    information.replaceChildren(...(discovery?.notices.items ?? []).map((item) => {
      const row = this.documentRef!.createElement("li");
      const link = this.documentRef!.createElement("a");
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = item.title;
      const detail = this.documentRef!.createElement("p");
      detail.textContent = `${item.kind === "notice" ? "公告线索" : "重大新闻线索"} · 建议带入 ${suggestedInformationLeadEventKind(item)} · ${item.source} · ${item.publishedAt} · 查询标的 ${item.symbol} · 来源关联 ${item.relatedSecurities.join(", ") || "未返回"}. 未核验，不会自动写入 Research。`;
      const button = this.documentRef!.createElement("button");
      button.type = "button";
      button.dataset.verifyInformationId = item.id;
      button.disabled = this.busy;
      button.textContent = "带到 Research 人工核验";
      row.append(link, detail, button);
      return row;
    }));
    announcements.replaceChildren(...(discovery?.announcements.items ?? []).map((item) => {
      const row = this.documentRef!.createElement("li");
      const link = this.documentRef!.createElement("a");
      link.href = item.documentUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = item.title;
      const detail = this.documentRef!.createElement("p");
      detail.textContent = `${item.symbol} · ${item.publishedDate} · ${item.category} · ${item.why}. Official link only; never auto-imported.`;
      const button = this.documentRef!.createElement("button");
      button.type = "button";
      button.dataset.continueAnnouncementId = item.id;
      button.disabled = this.busy;
      button.textContent = "Verify and continue to PDF import";
      row.append(link, detail, button);
      return row;
    }));
  }

  private renderQualification(): void {
    const output = this.element("market-qualification-output");
    if (!output) return;
    const qualification = this.qualification;
    if (!qualification || !this.qualifiedCandidate) {
      output.replaceChildren();
      return;
    }
    const lines = [
      `Binding: ${qualification.binding?.source} / ${qualification.binding?.ruleId} / cutoff ${qualification.binding?.candidateAsOf} / candidate fingerprint ${qualification.binding?.candidateFingerprint}`,
      ...qualification.facts.map((fact) => `Fact · ${fact.label}: ${fact.value} — ${fact.meaning}`),
      ...qualification.unknowns.map((item) => `Unknown · ${item}`),
      ...qualification.nextChecks.map((item) => `Next check · ${item}`),
      `Reproducibility · ${qualification.reproducibility.generationMethod}; provider ${qualification.reproducibility.provider}; model ${qualification.reproducibility.model}; prompt ${qualification.reproducibility.prompt}; tokens ${qualification.reproducibility.tokenUsage}; cost ${qualification.reproducibility.cost}`
    ];
    const fragments = lines.map((line) => {
      const paragraph = this.documentRef!.createElement("p");
      paragraph.textContent = line;
      return paragraph;
    });
    const button = this.documentRef!.createElement("button");
    button.type = "button";
    button.dataset.addQualifiedSymbol = this.qualifiedCandidate.symbol;
    button.disabled = this.busy;
    button.textContent = "Review current Market facts";
    output.replaceChildren(...fragments, button);
  }

  private element(id: string): HTMLElement | null { return this.documentRef?.getElementById(id) ?? null; }
  private setText(id: string, value: string): void { const element = this.element(id); if (element) element.textContent = value; }
}

function localDateTimeValue(value: Date): string {
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}
