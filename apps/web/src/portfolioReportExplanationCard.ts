import {
  validatePortfolioReportExplanationEnvelope,
  type PortfolioReportExplanationEnvelope
} from "../../../packages/contracts/src/portfolioReportExplanation.js";
import { sameWebApiAuth, type WebApiAuth, type WebFailureState } from "./apiClient.js";
import { auth, candidateReadAuth } from "./webAuth.js";

export interface PortfolioReportMembership {
  membershipId: string;
  membershipVersion: number;
  membershipState: "tracked" | "paused";
  symbol: string;
}

export type PortfolioReportExplanationUiState = "idle" | "loading" | "available" | WebFailureState;

export interface PortfolioReportExplanationViewState {
  state: PortfolioReportExplanationUiState;
  message: string;
  envelope: PortfolioReportExplanationEnvelope | null;
}

export type PortfolioReportExplanationResponse =
  | { ok: true; value: PortfolioReportExplanationEnvelope }
  | { ok: false; state: WebFailureState; reason: string };

interface PortfolioReportExplanationControllerDependencies {
  currentMembership: () => PortfolioReportMembership | null;
  readAuth: () => WebApiAuth | null;
  scenarioAmount: () => number | null;
  load?: typeof loadPortfolioReportExplanation;
  render: (state: PortfolioReportExplanationViewState) => void;
}

export function parsePortfolioReportScenarioAmount(value: string): number | null {
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000_000_000 ? amount : null;
}

export async function loadPortfolioReportExplanation(
  requestAuth: WebApiAuth,
  membership: PortfolioReportMembership,
  scenarioAmount: number,
  fetcher: typeof fetch = fetch
): Promise<PortfolioReportExplanationResponse> {
  if (!validMembership(membership) || !validAmount(scenarioAmount)) {
    return { ok: false, state: "malformed", reason: "An exact membership and one non-negative user scenario amount are required." };
  }
  const query = new URLSearchParams({ scenarioAmount: String(scenarioAmount) });
  let response: Response;
  try {
    response = await fetcher(
      `/api/mobile/research/candidate-memberships/${encodeURIComponent(membership.membershipId)}/portfolio-report-explanation?${query.toString()}`,
      { headers: { [requestAuth.headerName]: requestAuth.token } }
    );
  } catch (error) {
    return { ok: false, state: "offline", reason: error instanceof Error ? error.message : "Portfolio report explanation request failed." };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, state: httpFailureState(response.status), reason: "Portfolio report explanation response is not valid JSON." };
  }
  const validation = validatePortfolioReportExplanationEnvelope(payload);
  if (!validation.ok) {
    return { ok: false, state: response.ok ? "malformed" : httpFailureState(response.status), reason: validation.errors.join("; ") };
  }
  const envelope = payload as PortfolioReportExplanationEnvelope;
  if (envelope.membershipId !== membership.membershipId) {
    return { ok: false, state: "conflict", reason: "Portfolio report explanation membership changed during the fresh read." };
  }
  if (!response.ok || envelope.status !== "available" || !envelope.data) {
    return { ok: false, state: failureState(envelope.status, response.status), reason: envelope.message };
  }
  if (envelope.requestedSymbol !== membership.symbol
    || envelope.data.binding.membershipVersion !== membership.membershipVersion
    || envelope.data.binding.membershipState !== membership.membershipState
    || envelope.data.scenarios.length !== 1
    || envelope.data.scenarios[0]?.userInputAmount !== scenarioAmount) {
    return { ok: false, state: "conflict", reason: "Portfolio report explanation identity or scenario changed during the fresh read." };
  }
  return { ok: true, value: envelope };
}

export class PortfolioReportExplanationController {
  readonly viewState: PortfolioReportExplanationViewState = {
    state: "idle",
    message: "Select and load an exact membership, then enter one scenario amount for a fresh read.",
    envelope: null
  };
  private generation = 0;

  constructor(private readonly dependencies: PortfolioReportExplanationControllerDependencies) {}

  invalidate(message: string): void {
    this.generation += 1;
    this.viewState.state = "idle";
    this.viewState.message = message;
    this.viewState.envelope = null;
    this.dependencies.render(this.viewState);
  }

  async refresh(): Promise<void> {
    const generation = ++this.generation;
    const membership = this.dependencies.currentMembership();
    const requestAuth = this.dependencies.readAuth();
    const scenarioAmount = this.dependencies.scenarioAmount();
    this.viewState.envelope = null;
    if (!membership) return this.fail("unavailable", "Load one exact non-archived membership through Decision intake before reading this explanation.");
    if (!requestAuth) return this.fail("unauthorized", "Read authorization is required for the fresh portfolio report explanation.");
    if (scenarioAmount === null) return this.fail("malformed", "Enter one non-negative scenario amount explicitly.");
    this.viewState.state = "loading";
    this.viewState.message = `Fresh-reading the report-bound portfolio explanation for ${membership.symbol}.`;
    this.dependencies.render(this.viewState);
    const loader = this.dependencies.load ?? loadPortfolioReportExplanation;
    const result = await loader(requestAuth, membership, scenarioAmount);
    if (generation !== this.generation) return;
    const currentMembership = this.dependencies.currentMembership();
    if (!sameWebApiAuth(requestAuth, this.dependencies.readAuth())
      || !sameMembership(membership, currentMembership)
      || this.dependencies.scenarioAmount() !== scenarioAmount) {
      this.fail("conflict", "Membership, authorization, or scenario input changed during the fresh read; the old result was discarded.");
      return;
    }
    if (!result.ok) {
      this.fail(result.state, result.reason);
      return;
    }
    this.viewState.state = "available";
    this.viewState.message = result.value.message;
    this.viewState.envelope = result.value;
    this.dependencies.render(this.viewState);
  }

  private fail(state: WebFailureState, message: string): void {
    this.viewState.state = state;
    this.viewState.message = message;
    this.viewState.envelope = null;
    this.dependencies.render(this.viewState);
  }
}

export function selectedPortfolioReportMembership(documentRef: Document): PortfolioReportMembership | null {
  const bridge = documentRef.getElementById("selected-candidate-decision-bridge");
  const intake = documentRef.getElementById("candidate-decision-intake");
  if (!bridge || !intake || bridge.dataset.canOpenDecisionIntake !== "true"
    || !["tracked", "paused"].includes(bridge.dataset.membershipState ?? "")
    || !["ready", "review_required"].includes(intake.dataset.state ?? "")) return null;
  const membership = {
    membershipId: bridge.dataset.membershipId ?? "",
    membershipVersion: Number(bridge.dataset.membershipVersion),
    membershipState: bridge.dataset.membershipState as PortfolioReportMembership["membershipState"],
    symbol: bridge.dataset.symbol ?? ""
  };
  if (!validMembership(membership) || intake.dataset.membershipId !== membership.membershipId) return null;
  const matches = [...documentRef.querySelectorAll<HTMLElement>("#membership-list [data-membership-id]")].filter((item) =>
    item.dataset.membershipId === membership.membershipId
    && Number(item.dataset.version) === membership.membershipVersion
    && item.dataset.state === membership.membershipState
    && item.dataset.symbol === membership.symbol
  );
  return matches.length === 1 ? membership : null;
}

export function mountPortfolioReportExplanationCard(documentRef: Document = document): PortfolioReportExplanationController | null {
  const host = documentRef.getElementById("portfolio-report-explanation");
  const button = documentRef.getElementById("portfolio-report-explanation-read");
  const amount = documentRef.getElementById("portfolio-report-scenario-amount");
  if (!host || !(button instanceof HTMLButtonElement) || !(amount instanceof HTMLInputElement)) return null;
  const controller = new PortfolioReportExplanationController({
    currentMembership: () => selectedPortfolioReportMembership(documentRef),
    readAuth: () => candidateReadAuth() ?? auth(),
    scenarioAmount: () => parsePortfolioReportScenarioAmount(amount.value),
    render: (state) => renderPortfolioReportExplanationCard(documentRef, state)
  });
  button.addEventListener("click", () => void controller.refresh());
  documentRef.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.closest("button[data-assets-research-symbol]")) return;
    amount.value = "";
    controller.invalidate("Assets-to-Research source is refreshing; enter a new scenario amount after the exact membership opens.");
  });
  amount.addEventListener("input", () => controller.invalidate("Scenario input changed; the previous explanation was discarded."));
  for (const id of ["membership-read-header-name", "membership-read-token", "auth-header-name", "auth-token"]) {
    documentRef.getElementById(id)?.addEventListener("input", () => controller.invalidate("Read authorization changed; the previous explanation was discarded."));
  }
  let observedSource = sourceKey(selectedPortfolioReportMembership(documentRef));
  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(() => {
      const next = sourceKey(selectedPortfolioReportMembership(documentRef));
      if (next === observedSource) return;
      observedSource = next;
      controller.invalidate("Selected membership changed; the previous explanation was discarded.");
    }).observe(documentRef.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-state", "data-membership-id", "data-membership-version", "data-symbol"]
    });
  }
  renderPortfolioReportExplanationCard(documentRef, controller.viewState);
  return controller;
}

export function renderPortfolioReportExplanationCard(
  documentRef: Document,
  state: PortfolioReportExplanationViewState
): void {
  const host = documentRef.getElementById("portfolio-report-explanation");
  const status = documentRef.getElementById("portfolio-report-explanation-status");
  const output = documentRef.getElementById("portfolio-report-explanation-output");
  const button = documentRef.getElementById("portfolio-report-explanation-read");
  if (!host || !status || !output || !(button instanceof HTMLButtonElement)) return;
  host.dataset.state = state.state;
  status.textContent = `${state.state}: ${state.message}`;
  button.disabled = state.state === "loading";
  output.replaceChildren();
  const data = state.envelope?.data;
  if (!data) {
    output.textContent = state.state === "loading"
      ? "Fresh read in progress; no previous success is displayed."
      : "No current report-bound portfolio explanation is displayed.";
    return;
  }
  const conclusion = documentRef.createElement("h4");
  conclusion.textContent = data.holdings.candidate.status === "held"
    ? `Currently held at ${percent(data.holdings.candidate.weight)} of visible market value.`
    : "Not currently held in the exact current Pingan portfolio.";
  const report = documentRef.createElement("p");
  report.textContent = `Current report ${data.binding.reportId} v${data.binding.reportVersion} · evidence pack ${data.binding.evidencePackId} v${data.binding.evidencePackVersion}.`;
  const cards = documentRef.createElement("div");
  cards.className = "portfolio-lab-grid";
  cards.append(summaryCard(documentRef, "Current holdings", [
    ["Candidate", data.holdings.candidate.status],
    ["Candidate weight", percent(data.holdings.candidate.weight)],
    ["Largest position", percent(data.holdings.concentration.largestPositionWeight)],
    ["Top three", percent(data.holdings.concentration.topThreeWeight)],
    ["HHI", number(data.holdings.concentration.hhi)]
  ]));
  cards.append(summaryCard(documentRef, "Versioned quant risk", [
    ["HK Connect universe", `${data.quantRisk.hkConnectUniverse.effectiveDate} · ${data.quantRisk.hkConnectUniverse.memberCount} members`],
    ["Evidence", data.quantRisk.evidenceId],
    ["Observation window", `${data.quantRisk.source.observationStartDate} to ${data.quantRisk.source.observationEndDate}`],
    ["Annualized volatility", number(data.quantRisk.currentHistorical.annualizedVolatility ?? 0)],
    ["Historical stress / tail", `${number(data.quantRisk.currentHistorical.historicalStressLossMagnitude ?? 0)} / ${number(data.quantRisk.currentHistorical.historicalTailLossMagnitude ?? 0)}`],
    ["Correlation stability", data.quantRisk.correlations.stability],
    ["Median turnover", number(data.quantRisk.candidateLiquidity.medianDailyTurnover ?? 0)],
    ["Board lot", String(data.quantRisk.candidateLiquidity.boardLot ?? "not_captured")]
  ]));
  for (const [index, scenario] of data.scenarios.entries()) cards.append(summaryCard(documentRef, `User scenario ${index + 1}`, [
    ["User amount", money(scenario.userInputAmount)],
    ["Candidate weight", percent(scenario.candidateWeight)],
    ["Candidate delta", signedPercent(scenario.candidateWeightChange)],
    ["Largest-position delta", signedPercent(scenario.largestPositionWeightChange)],
    ["HHI delta", signedNumber(scenario.hhiChange)],
    ["Historical volatility delta", signedNumber(data.quantRisk.scenarios[index]?.historical.annualizedVolatilityChange ?? 0)],
    ["Historical stress / tail delta", `${signedNumber(data.quantRisk.scenarios[index]?.historical.historicalStressLossChange ?? 0)} / ${signedNumber(data.quantRisk.scenarios[index]?.historical.historicalTailLossChange ?? 0)}`]
  ]));
  cards.append(summaryCard(documentRef, "Still UNKNOWN", [
    ["Cash", data.unknowns.cash],
    ["Funding source", data.unknowns.fundingSource],
    ["Sector", data.unknowns.sector],
    ["Opportunity cost", data.unknowns.opportunityCost]
  ]));
  const details = documentRef.createElement("details");
  const summary = documentRef.createElement("summary");
  summary.textContent = "Exact source identity";
  const identity = documentRef.createElement("p");
  identity.textContent = `Membership ${data.binding.membershipId} v${data.binding.membershipVersion} · account ${data.binding.accountScopeId} · portfolio ${data.binding.portfolioSnapshotId} as of ${data.binding.portfolioAsOf} · Futu quote ${data.binding.quote.snapshotId} at ${data.binding.quote.quoteTime} · quant snapshot ${data.quantRisk.source.snapshotId}.`;
  details.append(summary, identity);
  const boundary = documentRef.createElement("p");
  boundary.textContent = "Read-only neutral explanation. It creates no recommendation, ranking, amount suggestion, target, direction, order, trade, report write, decision write, or portfolio mutation.";
  output.append(conclusion, report, cards, details, boundary);
}

function summaryCard(documentRef: Document, title: string, rows: Array<[string, string]>): HTMLElement {
  const card = documentRef.createElement("section");
  card.className = "portfolio-lab-scenario";
  const heading = documentRef.createElement("h4");
  heading.textContent = title;
  card.append(heading, ...rows.map(([label, value]) => {
    const line = documentRef.createElement("div");
    const term = documentRef.createElement("strong");
    const detail = documentRef.createElement("span");
    term.textContent = label;
    detail.textContent = value;
    line.append(term, detail);
    return line;
  }));
  return card;
}

function validMembership(value: PortfolioReportMembership): boolean {
  return /^[1-9]\d*$/.test(value.membershipId) && Number.isSafeInteger(value.membershipVersion)
    && value.membershipVersion > 0 && ["tracked", "paused"].includes(value.membershipState)
    && /^HK\.\d{5}$/.test(value.symbol);
}
function validAmount(value: number): boolean { return Number.isFinite(value) && value >= 0 && value <= 1_000_000_000_000; }
function sameMembership(left: PortfolioReportMembership, right: PortfolioReportMembership | null): boolean {
  return Boolean(right && left.membershipId === right.membershipId
    && left.membershipVersion === right.membershipVersion && left.membershipState === right.membershipState
    && left.symbol === right.symbol);
}
function sourceKey(value: PortfolioReportMembership | null): string | null {
  return value ? `${value.membershipId}:${value.membershipVersion}:${value.membershipState}:${value.symbol}` : null;
}
function failureState(status: PortfolioReportExplanationEnvelope["status"], httpStatus: number): WebFailureState {
  if (status === "unauthorized" || httpStatus === 401 || httpStatus === 403) return "unauthorized";
  if (status === "not_found" || httpStatus === 404) return "not_found";
  if (status === "blocked" || httpStatus === 409) return "conflict";
  if (status === "malformed" || httpStatus === 400 || httpStatus === 422) return "malformed";
  return "unavailable";
}
function httpFailureState(status: number): WebFailureState {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  return status === 503 ? "unavailable" : "malformed";
}
function number(value: number): string { return new Intl.NumberFormat("en-HK", { maximumFractionDigits: 4 }).format(value); }
function money(value: number): string { return `HKD ${new Intl.NumberFormat("en-HK", { maximumFractionDigits: 2 }).format(value)}`; }
function percent(value: number): string { return `${(value * 100).toFixed(2)}%`; }
function signedPercent(value: number): string { return `${value >= 0 ? "+" : ""}${percent(value)}`; }
function signedNumber(value: number): string { return `${value >= 0 ? "+" : ""}${number(value)}`; }

if (typeof document !== "undefined") mountPortfolioReportExplanationCard(document);
