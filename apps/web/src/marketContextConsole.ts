import {
  validateMarketQuoteEnvelope,
  validateMarketSearchEnvelope,
  type KnownHongKongStock,
  type MarketQuoteEnvelope,
  type MarketSearchEnvelope
} from "../../../packages/contracts/src/market.js";
import { type DailyTechnicalEnvelope } from "../../../packages/contracts/src/marketDaily.js";
import {
  marketEnvironmentBindsDailySession,
  marketEnvironmentFreshness,
  marketEnvironmentUsesLastCompletedObservation,
  validateMarketEnvironmentEnvelope,
  type MarketEnvironmentEnvelope,
  type MarketEnvironmentSectorFact
} from "../../../packages/contracts/src/marketEnvironment.js";
import {
  validateWeinsteinTechnicalAnalysisEnvelope,
  type WeinsteinTechnicalAnalysisEnvelope
} from "../../../packages/contracts/src/weinsteinTechnicalAnalysis.js";
import { sameWebApiAuth, type WebApiAuth } from "./apiClient.js";
import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";
import { cockpitFailureMessage, requestJson } from "./dailyResearchCockpitData.js";
import { refreshMarketContextFromProvider } from "./marketContextRefresh.js";
export interface MarketContextFacts {
  quote: MarketQuoteEnvelope;
  daily: DailyTechnicalEnvelope;
  environment: MarketEnvironmentEnvelope;
}
export type MarketResearchAction = "add" | "open";
export function acceptWeinsteinAnalysis(
  value: unknown,
  symbol: KnownHongKongStock,
  analysisAsOf: string,
  now = new Date()
): WeinsteinTechnicalAnalysisEnvelope {
  const validation = validateWeinsteinTechnicalAnalysisEnvelope(value, {
    symbol: symbol.symbol,
    analysisAsOf
  }, now);
  if (!validation.ok) throw new Error(`Weinstein analysis is malformed or drifted: ${validation.errors.join("; ")}`);
  return value as WeinsteinTechnicalAnalysisEnvelope;
}
export function acceptMarketSearch(value: unknown, query: string): MarketSearchEnvelope {
  const validation = validateMarketSearchEnvelope(value);
  if (!validation.ok) throw new Error(`Market search is malformed: ${validation.errors.join("; ")}`);
  const envelope = value as MarketSearchEnvelope;
  if (envelope.status !== "available" || envelope.query !== query
    || new Set(envelope.results.map((item) => item.symbol)).size !== envelope.results.length) {
    throw new Error("Market search is unavailable, drifted, or ambiguous.");
  }
  return envelope;
}
export async function acceptMarketContext(
  quoteValue: unknown,
  dailyValue: unknown,
  environmentValue: unknown,
  symbol: KnownHongKongStock,
  now = new Date()
): Promise<MarketContextFacts> {
  const quoteValidation = validateMarketQuoteEnvelope(quoteValue, now);
  const environmentValidation = validateMarketEnvironmentEnvelope(environmentValue, now);
  if (!quoteValidation.ok) throw new Error(`Quote is malformed: ${quoteValidation.errors.join("; ")}`);
  if (!environmentValidation.ok) throw new Error(`Market environment is malformed: ${environmentValidation.errors.join("; ")}`);
  const quote = quoteValue as MarketQuoteEnvelope;
  const daily = await acceptDailyTechnical(dailyValue, symbol);
  const environment = environmentValue as MarketEnvironmentEnvelope;
  if (!marketQuoteIsCurrentForMarketState(quote, environment, now)
    || !quote.data || quote.requestedSymbol !== symbol.symbol
    || daily.completeness !== "complete" || !daily.usableForRequestedCutoff
    || daily.dailyBars.status !== "available" || daily.technical.status !== "available"
    || daily.dailyBars.request.market !== symbol.market || daily.dailyBars.request.code !== symbol.code
    || daily.dailyBars.request.symbol !== symbol.symbol
    || environment.status !== "available" || !environment.data || environment.requestedSymbol !== symbol.symbol
    || !marketEnvironmentBindsDailySession(environment, daily.dailyBars.snapshot?.lastCompletedSession ?? "", now)) {
    throw new Error("Market context is incomplete, unavailable, stale, or bound to another symbol.");
  }
  return { quote, daily, environment };
}

function marketQuoteIsCurrentForMarketState(
  quote: MarketQuoteEnvelope,
  environment: MarketEnvironmentEnvelope,
  now: Date
): boolean {
  const environmentFreshness = marketEnvironmentFreshness(environment, now);
  if (quote.status === "live" && quote.source.providerStatus === "live") {
    return environmentFreshness === "fresh"
      || (environment.data?.marketState === "PRE_OPEN" && environmentFreshness === "closed_last_observation");
  }
  const fetchedAt = Date.parse(quote.source.fetchedAt ?? "");
  const age = now.getTime() - fetchedAt;
  return quote.status === "stale"
    && quote.source.provider === "futu"
    && quote.source.providerStatus === "stale"
    && marketEnvironmentUsesLastCompletedObservation(environment.data?.marketState ?? "")
    && environmentFreshness === "closed_last_observation"
    && Number.isFinite(fetchedAt)
    && age >= 0
    && age <= 30 * 60_000;
}
export async function readMarketContext(
  symbol: KnownHongKongStock,
  auth: WebApiAuth,
  currentAuth: () => WebApiAuth | null
): Promise<MarketContextFacts> {
  const [quote, daily, environment] = await Promise.all([
    requestJson(`/api/mobile/market/quotes/${symbol.market}/${symbol.code}`, auth, { cache: "no-store" }),
    requestJson(`/api/mobile/market/daily-bars/${symbol.market}/${symbol.code}`, auth, { cache: "no-store" }),
    requestJson(`/api/mobile/market/environment/${symbol.market}/${symbol.code}`, auth, { cache: "no-store" })
  ]);
  if (!sameWebApiAuth(auth, currentAuth())) throw new Error("Read authorization changed during current Market read.");
  return await acceptMarketContext(quote, daily, environment, symbol);
}
export class MarketContextConsole {
  private documentRef: Document | null = null;
  private searchEnvelope: MarketSearchEnvelope | null = null;
  private selected: KnownHongKongStock | null = null;
  private facts: MarketContextFacts | null = null;
  private factsAreHistorical = false;
  private weinstein: WeinsteinTechnicalAnalysisEnvelope | null = null;
  private researchAction: MarketResearchAction | null = null;
  private message = "Search and explicitly select one canonical Hong Kong stock.";
  private weinsteinMessage = "Read one complete exact-symbol Market context first.";
  private generation = 0;
  private busy = false;
  constructor(private readonly dependencies: {
    readAuth: () => WebApiAuth | null;
    writeAuth: () => WebApiAuth | null;
    resolveResearchAction: (stock: KnownHongKongStock) => Promise<MarketResearchAction>;
    openResearch: (stock: KnownHongKongStock, expected: MarketResearchAction) => Promise<"added" | "opened">;
  }) {}

  mount(documentRef: Document = document): void {
    this.documentRef = documentRef;
    this.element("market-context-search")?.addEventListener("click", () => void this.search());
    this.element("market-context-search-results")?.addEventListener("click", (event) => this.select(event));
    this.element("market-context-refresh")?.addEventListener("click", () => void this.refresh());
    this.element("market-context-provider-refresh")?.addEventListener("click", () => void this.refresh(true));
    this.element("market-weinstein-refresh")?.addEventListener("click", () => void this.refreshWeinstein());
    this.element("market-context-open-research")?.addEventListener("click", () => void this.openResearch());
    this.render();
  }
  invalidateAuthorization(message: string): void {
    this.generation += 1;
    this.busy = false;
    this.searchEnvelope = null;
    this.selected = null;
    this.facts = null;
    this.factsAreHistorical = false;
    this.weinstein = null;
    this.researchAction = null;
    this.weinsteinMessage = "Authorization changed; weekly analysis was cleared.";
    this.message = `${message} Market context is UNKNOWN until a new search and current Market read.`;
    this.render();
  }
  async prepareCandidate(stock: KnownHongKongStock): Promise<void> {
    if (this.busy) throw new Error("Market is already completing an explicit current action.");
    this.generation += 1;
    this.searchEnvelope = null;
    this.selected = stock;
    this.facts = null;
    this.factsAreHistorical = false;
    this.weinstein = null;
    this.researchAction = null;
    this.message = `${stock.symbol} came from an exact qualification. Fresh-reading current Market facts before any Research write.`;
    this.render();
    const expectedGeneration = this.generation + 1;
    await this.refresh();
    if (this.generation !== expectedGeneration || !this.facts || this.selected?.market !== stock.market
      || this.selected.code !== stock.code || this.selected.symbol !== stock.symbol) {
      throw new Error("Current Market facts could not be fresh-read for the qualified candidate.");
    }
  }
  private async search(): Promise<void> {
    if (this.busy) return;
    const input = this.element("market-context-search-input");
    const query = input instanceof HTMLInputElement ? input.value.trim() : "";
    const auth = this.dependencies.readAuth();
    const generation = ++this.generation;
    this.searchEnvelope = null;
    this.selected = null;
    this.facts = null;
    this.factsAreHistorical = false;
    this.weinstein = null;
    this.researchAction = null;
    if (!query || query.length > 80 || !auth) {
      this.message = "Market search UNKNOWN: enter 1–80 characters and provide current read authorization.";
      this.render();
      return;
    }
    this.busy = true;
    this.message = `Fresh-searching Hong Kong stock identities for “${query}”…`;
    this.render();
    try {
      const value = await requestJson(`/api/mobile/market/search?q=${encodeURIComponent(query)}`, auth, { cache: "no-store" });
      if (generation !== this.generation) return;
      if (!sameWebApiAuth(auth, this.dependencies.readAuth())) throw new Error("Read authorization changed during market search.");
      this.searchEnvelope = acceptMarketSearch(value, query);
      const source = this.searchEnvelope.scope === "futu_opend_hk_stocks"
        ? "Futu/OpenD Hong Kong stock universe"
        : "local-database fallback";
      this.message = `${this.searchEnvelope.results.length} exact result(s) from ${source}. API order is not a ranking or recommendation.`;
    } catch (error) {
      if (generation !== this.generation) return;
      this.searchEnvelope = null;
      this.selected = null;
      this.facts = null;
      this.weinstein = null;
      this.researchAction = null;
      this.message = `Market search UNKNOWN: ${cockpitFailureMessage(error)} No old result was retained.`;
    } finally {
      if (generation === this.generation) this.busy = false;
      this.render();
    }
  }
  private select(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !this.searchEnvelope || this.busy) return;
    const button = target.closest("button[data-market-context-symbol]");
    if (!(button instanceof HTMLButtonElement)) return;
    const matches = this.searchEnvelope.results.filter((item) => item.symbol === button.dataset.marketContextSymbol);
    if (matches.length !== 1) {
      this.invalidateSelection("Selection UNKNOWN: result identity is absent or ambiguous.");
      return;
    }
    this.generation += 1;
    this.selected = matches[0];
    this.facts = null;
    this.factsAreHistorical = false;
    this.weinstein = null;
    this.researchAction = null;
    this.message = `${matches[0].symbol} explicitly selected. Read current facts first; if quote or daily data is stale or missing, explicitly refresh price and daily technicals.`;
    this.render();
  }
  private async refresh(fromProvider = false): Promise<void> {
    if (this.busy) return;
    const selected = this.selected;
    const auth = this.dependencies.readAuth();
    const writeAuth = fromProvider ? this.dependencies.writeAuth() : null;
    const generation = ++this.generation;
    const previousFacts = this.facts;
    this.factsAreHistorical = previousFacts !== null;
    this.weinstein = null;
    this.researchAction = null;
    this.weinsteinMessage = "Market facts changed; read the exact weekly analysis again.";
    if (!selected || !auth || fromProvider && !writeAuth) {
      if (!selected || !auth) {
        this.facts = null;
        this.factsAreHistorical = false;
      }
      this.message = `Market context UNKNOWN: an explicit current selection and ${fromProvider ? "read plus write" : "read"} authorization are required.`;
      this.render();
      return;
    }
    this.busy = true;
    this.message = fromProvider
      ? `Explicitly refreshing ${selected.symbol} price and daily technicals, then fresh-reading all Market facts…`
      : `Reading current stored Market facts for ${selected.symbol}; partial output stays hidden…`;
    this.render();
    try {
      const facts = fromProvider ? await refreshMarketContextFromProvider({
        symbol: selected, writeAuth: writeAuth!, currentWriteAuth: this.dependencies.writeAuth,
        readAuth: auth, currentReadAuth: this.dependencies.readAuth,
        isCurrent: () => generation === this.generation && this.selected?.symbol === selected.symbol,
        readFresh: () => readMarketContext(selected, auth, this.dependencies.readAuth)
      }) : await readMarketContext(selected, auth, this.dependencies.readAuth);
      if (generation !== this.generation || this.selected?.symbol !== selected.symbol
        || !sameWebApiAuth(auth, this.dependencies.readAuth())
        || fromProvider && !sameWebApiAuth(writeAuth, this.dependencies.writeAuth())) return;
      this.facts = facts;
      this.factsAreHistorical = false;
      try {
        this.researchAction = await this.dependencies.resolveResearchAction(selected);
        if (generation !== this.generation || this.selected?.symbol !== selected.symbol || this.facts !== facts) return;
        if (!sameWebApiAuth(auth, this.dependencies.readAuth())) throw new Error("Read authorization changed during membership fresh-read.");
        this.message = this.researchAction === "add"
          ? `${selected.symbol} Market context is current. No active membership exists; click 加入研究 to make the explicit idempotent write.`
          : `${selected.symbol} Market context and one active membership are current; click 打开研究 to enter existing Research.`;
      } catch (error) {
        this.researchAction = null;
        if (!sameWebApiAuth(auth, this.dependencies.readAuth())) throw error;
        this.message = `${selected.symbol} Market context is current, but Research onboarding is UNKNOWN: ${cockpitFailureMessage(error)}`;
      }
    } catch (error) {
      if (generation !== this.generation) return;
      const identityIsCurrent = this.selected?.symbol === selected?.symbol
        && sameWebApiAuth(auth, this.dependencies.readAuth())
        && (!fromProvider || sameWebApiAuth(writeAuth, this.dependencies.writeAuth()));
      this.facts = identityIsCurrent ? previousFacts : null;
      this.factsAreHistorical = identityIsCurrent && previousFacts !== null;
      this.weinstein = null;
      this.researchAction = null;
      this.message = this.factsAreHistorical
        ? `${fromProvider ? "Market refresh outcome UNKNOWN" : "Market context UNKNOWN"}: ${cockpitFailureMessage(error)} Last valid exact-symbol facts remain visible for browsing only; Research stays disabled until a fresh read succeeds.`
        : `${fromProvider ? "Market refresh outcome UNKNOWN" : "Market context UNKNOWN"}: ${cockpitFailureMessage(error)} No safe prior facts were available; the explicit recovery action remains available.`;
    } finally {
      if (generation === this.generation) this.busy = false;
      this.render();
    }
  }
  private async refreshWeinstein(): Promise<void> {
    if (this.busy || !this.selected || !this.facts) return;
    const selected = this.selected;
    const facts = this.facts;
    const analysisAsOf = facts.daily.dailyBars.request.cutoff;
    const auth = this.dependencies.readAuth();
    const generation = ++this.generation;
    this.weinstein = null;
    if (!auth) {
      this.weinsteinMessage = "Weinstein analysis UNKNOWN: current read authorization is required.";
      this.render();
      return;
    }
    this.busy = true;
    this.weinsteinMessage = `Reading ${selected.symbol} weekly analysis for ${analysisAsOf}…`;
    this.render();
    try {
      const value = await requestJson(
        `/api/mobile/market/weinstein/${selected.market}/${selected.code}?analysisAsOf=${analysisAsOf}`,
        auth,
        { cache: "no-store" }
      );
      if (generation !== this.generation || this.selected?.symbol !== selected.symbol || this.facts !== facts) return;
      if (!sameWebApiAuth(auth, this.dependencies.readAuth())) throw new Error("Read authorization changed during Weinstein read.");
      this.weinstein = acceptWeinsteinAnalysis(value, selected, analysisAsOf);
      this.weinsteinMessage = this.weinstein.status === "available"
        ? `${selected.symbol} weekly analysis is exact and complete; it remains advisory-only.`
        : `${selected.symbol} weekly evidence is insufficient; stage and entry conclusions remain UNKNOWN.`;
    } catch (error) {
      if (generation !== this.generation) return;
      this.weinstein = null;
      this.weinsteinMessage = `Weinstein analysis UNKNOWN: ${cockpitFailureMessage(error)} No old result was retained.`;
    } finally {
      if (generation === this.generation) this.busy = false;
      this.render();
    }
  }
  private async openResearch(): Promise<void> {
    if (this.busy || !this.selected || !this.facts || !this.researchAction) return;
    const selected = this.selected;
    const expected = this.researchAction;
    const auth = this.dependencies.readAuth();
    const previousFacts = this.facts;
    const generation = ++this.generation;
    this.busy = true;
    this.message = `Fresh-reading current Market facts and exact membership before ${expected === "add" ? "adding" : "opening"} ${selected.symbol} Research…`;
    this.render();
    try {
      if (!auth) throw new Error("Read authorization is required.");
      const facts = await readMarketContext(selected, auth, this.dependencies.readAuth);
      if (generation !== this.generation || this.selected?.symbol !== selected.symbol || !sameWebApiAuth(auth, this.dependencies.readAuth())) throw new Error("Market selection or authorization changed during current Market read.");
      this.facts = facts;
      const result = await this.dependencies.openResearch(selected, expected);
      if (generation !== this.generation || this.selected?.symbol !== selected.symbol || this.facts !== facts
        || !sameWebApiAuth(auth, this.dependencies.readAuth())) throw new Error("Market selection or authorization changed during Research navigation.");
      this.message = `${selected.symbol} ${result === "added" ? "was explicitly added and" : "membership was"} fresh-read by exact id, symbol, and version, then opened in existing Research.`;
    } catch (error) {
      if (generation !== this.generation) return;
      const identityIsCurrent = auth !== null && this.selected?.symbol === selected.symbol
        && sameWebApiAuth(auth, this.dependencies.readAuth());
      this.facts = identityIsCurrent ? previousFacts : null;
      this.factsAreHistorical = identityIsCurrent && previousFacts !== null;
      this.weinstein = null;
      this.researchAction = null;
      this.message = this.factsAreHistorical
        ? `Research navigation UNKNOWN: ${cockpitFailureMessage(error)} Last valid exact-symbol facts remain visible for browsing only.`
        : `Research navigation UNKNOWN: ${cockpitFailureMessage(error)} No safe prior facts were retained.`;
    } finally {
      if (generation === this.generation) this.busy = false;
      this.render();
    }
  }
  private invalidateSelection(message: string): void {
    this.generation += 1;
    this.selected = null;
    this.facts = null;
    this.factsAreHistorical = false;
    this.weinstein = null;
    this.researchAction = null;
    this.weinsteinMessage = "Select and read one stock before weekly analysis.";
    this.message = message;
    this.render();
  }

  private render(): void {
    if (!this.documentRef) return;
    this.setText("market-context-status", this.message);
    this.setText("market-context-selection", this.selected
      ? `Selected ${this.selected.symbol} ${this.selected.name ?? "name UNKNOWN"}`
      : "No stock explicitly selected.");
    const list = this.element("market-context-search-results");
    if (list instanceof HTMLUListElement) list.replaceChildren(...(this.searchEnvelope?.results ?? []).map((item) => {
      const row = this.documentRef!.createElement("li");
      const label = this.documentRef!.createElement("span");
      label.textContent = `${item.symbol} · ${item.name ?? "name UNKNOWN"}`;
      const button = this.documentRef!.createElement("button");
      button.type = "button";
      button.dataset.marketContextSymbol = item.symbol;
      button.disabled = this.busy;
      button.textContent = "Select";
      row.append(label, button);
      return row;
    }));
    this.renderFacts();
    this.renderWeinstein();
    const refresh = this.element("market-context-refresh");
    if (refresh instanceof HTMLButtonElement) refresh.disabled = this.busy || !this.selected;
    const providerRefresh = this.element("market-context-provider-refresh");
    if (providerRefresh instanceof HTMLButtonElement) providerRefresh.disabled = this.busy || !this.selected;
    const weinsteinRefresh = this.element("market-weinstein-refresh");
    if (weinsteinRefresh instanceof HTMLButtonElement) weinsteinRefresh.disabled = this.busy || !this.facts;
    const open = this.element("market-context-open-research");
    if (open instanceof HTMLButtonElement) {
      open.disabled = this.busy || !this.facts || !this.researchAction;
      open.textContent = this.researchAction === "add" ? "加入研究" : this.researchAction === "open" ? "打开研究" : "等待精确新鲜 Market";
    }
    const search = this.element("market-context-search");
    if (search instanceof HTMLButtonElement) search.disabled = this.busy;
  }

  private renderFacts(): void {
    const output = this.element("market-context-output");
    if (!output) return;
    const facts = this.facts;
    const quoteData = facts?.quote.data;
    const snapshot = facts?.daily.dailyBars.snapshot;
    const points = facts?.daily.technical.points;
    const market = facts?.environment.data;
    if (!facts || !quoteData || !snapshot || !points || !market) {
      output.dataset.state = "unknown";
      output.textContent = "UNKNOWN · no complete exact-symbol Market context is displayed.";
      return;
    }
    const quote = facts.quote;
    const daily = facts.daily.dailyBars;
    const technical = facts.daily.technical;
    const environment = facts.environment;
    const latest = points.at(-1)!;
    const flow = market.selectedStockCapitalFlow;
    const lines = [
      ...(this.factsAreHistorical ? ["Historical display only · the latest refresh failed; Research admission is disabled until a fresh exact read succeeds."] : []),
      `Quote · ${quoteData.symbol} ${number(quoteData.price)} ${quoteData.currency}; change ${number(quoteData.changePercent)}%; source ${quote.source.provider}/${quote.source.providerStatus}; asOf ${quote.asOf}; fetched ${quote.source.fetchedAt}; freshness ${quote.metadata.freshness}.`,
      `Daily · source ${daily.source.provider}/${daily.source.endpoint}; fetched ${daily.source.fetchedAt}; requested cutoff ${daily.request.cutoff}; data cutoff ${daily.source.dataCutoffAt}; last completed session ${snapshot.lastCompletedSession}; freshness ${daily.metadata.freshness}.`,
      `Hashes · source ${daily.source.sourceContentHash}; snapshot ${snapshot.snapshotSha}; data ${snapshot.dataHash}; technical ${technical.resultHash}.`,
      `Technical ${latest.session} · MA20 ${number(latest.ma20)}; MA60 ${number(latest.ma60)}; MACD line/signal/histogram ${number(latest.macd.line)}/${number(latest.macd.signal)}/${number(latest.macd.histogram)}; Bollinger lower/middle/upper ${number(latest.bollinger20?.lower)}/${number(latest.bollinger20?.middle)}/${number(latest.bollinger20?.upper)}; RSI14 ${number(latest.rsi14)}.`,
      `Environment · source ${environment.source.provider}/${environment.source.endpoint}; asOf ${environment.asOf}; fetched ${environment.source.fetchedAt}; freshness ${marketEnvironmentFreshness(environment)}; state ${market.marketState}.`,
      ...market.indices.map((item) => `Index ${item.name} ${item.symbol} · last ${number(item.last)}; change ${number(item.changePercent)}%; turnover ${number(item.turnover)}; breadth ${item.advancers}/${item.decliners}/${item.unchanged}; asOf ${item.asOf}.`),
      `Breadth · advancers ${market.breadth.advancers}; decliners ${market.breadth.decliners}; unchanged ${market.breadth.unchanged}; advance ratio ${number(market.breadth.advanceRatio)}.`,
      `Sector leaders · returned ${market.sectors.universeCount} industry samples · ${sectors(market.sectors.leaders)}.`,
      `Sector laggards · returned ${market.sectors.universeCount} industry samples · ${sectors(market.sectors.laggards)}.`,
      flow
        ? `Selected-stock capital flow · net ${number(flow.netFlow)} ${flow.currency}; super/big/medium/small ${number(flow.superFlow)}/${number(flow.bigFlow)}/${number(flow.mediumFlow)}/${number(flow.smallFlow)}; asOf ${flow.asOf}; last valid ${flow.lastValidAt}.`
        : "Selected-stock capital flow · UNKNOWN.",
      `Risk · breadth ${market.risk.breadthSignal}; sector dispersion ${number(market.risk.sectorDispersionPercent)}%; HSI amplitude ${number(market.risk.hsiAmplitudePercent)}%.`,
      `UNKNOWN · ${market.unknowns.length ? market.unknowns.join("; ") : "none declared by the environment source"}.`
    ];
    output.dataset.state = this.factsAreHistorical ? "historical" : "available";
    output.replaceChildren(...lines.map((text) => {
      const paragraph = this.documentRef!.createElement("p");
      paragraph.textContent = text;
      return paragraph;
    }));
  }

  private renderWeinstein(): void {
    this.setText("market-weinstein-status", this.weinsteinMessage);
    const output = this.element("market-weinstein-output");
    if (!output) return;
    const result = this.weinstein;
    if (!result) {
      output.dataset.state = "unknown";
      output.textContent = "UNKNOWN · no exact weekly analysis is displayed.";
      return;
    }
    const lines = result.status === "data_insufficient" ? [
      `${result.symbol} · ${result.analysisAsOf} · DATA_INSUFFICIENT.`,
      result.summary,
      `UNKNOWN · ${result.unknowns.join("; ") || "weekly evidence is incomplete"}.`,
      `Next · ${result.nextObservations.join("; ")}.`
    ] : [
      `${result.symbol} · analysis ${result.analysisAsOf} · completed week ${result.completedWeekEnd} · score ${result.totalScore}/100 · confidence ${result.overallConfidence}.`,
      `Stages · market ${result.marketStage}/${result.marketMa30wDirection}; sector ${result.sectorStage}/${result.sectorStrength}; stock ${result.stockStage}/${result.stockStagePhase}.`,
      `30W · ${number(result.ma30w)} (${result.ma30wDirection}); price vs 30W ${number(result.priceVsMa30wPercent)}%.`,
      `Structure · breakout ${result.breakoutStatus} at ${number(result.breakoutLevel)}; volume ${result.volumeConfirmation}/${number(result.volumeRatio)}x; RS ${result.relativeStrengthStatus}; triple ${result.tripleConfirmation}.`,
      `Action frame · entry ${result.entryState}/${result.entryQuality}; holding ${result.holdingState}; exit ${result.exitWarning}; extension risk ${result.extensionRisk}; overhead supply ${result.overheadSupplyRisk}.`,
      `Score · ${result.scoreFactors.map((item) => `${item.label} ${item.score}/${item.maxScore}: ${item.assessment}`).join("; ")}.`,
      `Weekly chart · ${result.weeklyChart.length} completed points, ${result.weeklyChart[0]?.session} → ${result.weeklyChart.at(-1)?.session}.`,
      `Evidence · ${result.supportingEvidence.join("; ")}.`,
      `Counterevidence · ${result.counterevidence.join("; ")}.`,
      `UNKNOWN · ${result.unknowns.join("; ") || "none declared"}. Next · ${result.nextObservations.join("; ")}.`,
      `Identity · ${result.provider}/${result.dataset}; dataset ${result.datasetHash}; result ${result.resultHash}.`
    ];
    output.dataset.state = result.status;
    output.replaceChildren(...lines.map((text) => {
      const paragraph = this.documentRef!.createElement("p");
      paragraph.textContent = text;
      return paragraph;
    }));
  }

  private element(id: string): HTMLElement | null { return this.documentRef?.getElementById(id) ?? null; }
  private setText(id: string, value: string): void { const element = this.element(id); if (element) element.textContent = value; }
}
function number(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "UNKNOWN" : String(Math.round(value * 10_000) / 10_000);
}
function sectors(items: MarketEnvironmentSectorFact[]): string {
  return items.map((item) => `${item.name} ${number(item.changePercent)}%`).join(", ");
}

async function acceptDailyTechnical(value: unknown, symbol: KnownHongKongStock): Promise<DailyTechnicalEnvelope> {
  if (!record(value) || value.completeness !== "complete" || value.usableForRequestedCutoff !== true
    || !record(value.dailyBars) || !record(value.technical)) throw new Error("Daily technical is incomplete, stale, missing, or malformed.");
  const envelope = value as unknown as DailyTechnicalEnvelope;
  const { dailyBars: daily, technical } = envelope;
  const { request, source, snapshot } = daily;
  const points = technical.points;
  const latest = points?.at(-1);
  if (daily.status !== "available" || technical.status !== "available" || !snapshot || !points || !latest
    || !dailyRequestMatchesSymbol(request, symbol) || !dailySourceIsComplete(source, request)
    || !dailySnapshotIsComplete(snapshot, request, source)
    || technical.inputSnapshotSha !== snapshot.snapshotSha || technical.dataCutoffAt !== source.dataCutoffAt
    || latest.session !== snapshot.lastSession || !latestIndicatorsComplete(latest)) {
    throw new Error("Daily technical source or exact completed-session identity drifted.");
  }
  if (source.sourceContentHash !== await hash({ hashMethod: source.hashMethod, pageContentHashes: source.pageContentHashes })
    || snapshot.dataHash !== await hash(snapshot.bars)) throw new Error("Daily technical source or data hash drifted.");
  const { snapshotSha: _snapshotSha, ...snapshotWithoutSha } = snapshot;
  const { fetchedAt: _fetchedAt, ...sourceIdentity } = source;
  const { evaluatedAt: _evaluatedAt, ...stableEvidence } = snapshotWithoutSha.completedSessionEvidence ?? {};
  const stableSnapshot = {
    ...snapshotWithoutSha,
    completedSessionEvidence: snapshotWithoutSha.completedSessionEvidence ? stableEvidence : null
  };
  const snapshotHashes = await Promise.all([
    hash({ request, source: sourceIdentity, snapshot: stableSnapshot }),
    hash({ request, source, snapshot: snapshotWithoutSha })
  ]);
  if (!snapshotHashes.includes(String(snapshot.snapshotSha))) throw new Error("Daily snapshot hash drifted.");
  if (!sha(technical.resultHash)) throw new Error("Daily technical result identity is malformed.");
  if (technical.resultHash !== await hash({
    computationVersion: technical.computationVersion,
    parameters: technical.parameters,
    inputSnapshotSha: technical.inputSnapshotSha,
    dataCutoffAt: technical.dataCutoffAt,
    points: technical.points
  })) throw new Error("Daily technical result hash drifted.");
  return value as unknown as DailyTechnicalEnvelope;
}

function dailyRequestMatchesSymbol(
  request: DailyTechnicalEnvelope["dailyBars"]["request"],
  symbol: KnownHongKongStock
): boolean {
  return request.market === symbol.market && request.code === symbol.code && request.symbol === symbol.symbol
    && request.timeframe === "1d" && request.completedSessionsOnly === true && date(request.cutoff);
}
function dailySourceIsComplete(
  source: DailyTechnicalEnvelope["dailyBars"]["source"],
  request: DailyTechnicalEnvelope["dailyBars"]["request"]
): boolean {
  const providerCutoff = source.providerCutoff;
  return nonEmpty(source.provider) && nonEmpty(source.endpoint) && instant(source.fetchedAt)
    && date(providerCutoff) && instant(source.dataCutoffAt) && providerCutoff <= request.cutoff
    && source.hashMethod === "sha256_canonical_json_v1" && Array.isArray(source.pageContentHashes)
    && source.pageContentHashes.length > 0 && source.pageContentHashes.every(sha) && sha(source.sourceContentHash);
}
function dailySnapshotIsComplete(
  snapshot: NonNullable<DailyTechnicalEnvelope["dailyBars"]["snapshot"]>,
  request: DailyTechnicalEnvelope["dailyBars"]["request"],
  source: DailyTechnicalEnvelope["dailyBars"]["source"]
): boolean {
  const providerCutoff = source.providerCutoff;
  return sha(snapshot.snapshotSha) && sha(snapshot.dataHash) && Array.isArray(snapshot.bars)
    && snapshot.bars.length >= request.minimumBars && snapshot.barCount === snapshot.bars.length
    && snapshot.firstSession === snapshot.bars[0]?.session && snapshot.lastSession === snapshot.bars.at(-1)?.session
    && snapshot.lastCompletedSession === snapshot.lastSession && snapshot.lastCompletedSession <= request.cutoff
    && date(providerCutoff) && snapshot.lastCompletedSession <= providerCutoff;
}

function latestIndicatorsComplete(latest: unknown): boolean {
  return record(latest) && finite(latest.ma20) && finite(latest.ma60) && finite(latest.rsi14)
    && record(latest.macd) && finite(latest.macd.line) && finite(latest.macd.signal) && finite(latest.macd.histogram)
    && record(latest.bollinger20) && finite(latest.bollinger20.middle)
    && finite(latest.bollinger20.upper) && finite(latest.bollinger20.lower);
}
async function hash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function instant(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function date(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value); }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function sha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
