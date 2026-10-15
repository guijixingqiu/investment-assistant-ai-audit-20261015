import type { PortfolioDecisionPosition } from "../../../packages/contracts/src/portfolioDecisionContextBrowser.js";
import type { CandidateMembershipData } from "../../../packages/contracts/src/candidateMembership.js";
import { annualPortfolioLabPairSummary } from "../../../packages/contracts/src/annualPortfolioLabPairSummary.js";
import type { PortfolioWorkspaceViewState } from "./portfolioWorkspaceController.js";

export function renderPortfolioWorkspace(state: PortfolioWorkspaceViewState, documentRef: Document = document): void {
  const host = documentRef.getElementById("portfolio-decision-workspace");
  if (!host) return;
  host.dataset.state = state.state;
  setText(documentRef, "portfolio-workspace-status", `${state.state}: ${state.message}`);
  setText(documentRef, "portfolio-position-count", portfolioPositionCountText(state.context));
  setText(documentRef, "portfolio-market-value", money(state.context?.summary.marketValue.amount ?? null));
  setText(documentRef, "portfolio-cash", "unknown");
  setText(documentRef, "portfolio-concentration", concentrationText(state));
  setText(documentRef, "portfolio-snapshot-time", state.context?.portfolioAsOf ?? "unknown");

  renderPositions(documentRef, state.context?.positions ?? [], state.context?.status === "available" ? state.context.contextId : null);
  renderGaps(documentRef, state.context?.gaps ?? (state.state === "idle" ? [] : [state.message]));
  renderRisk(documentRef, state);
  renderLab(documentRef, state);
  renderComparedLab(documentRef, state);

  const refresh = documentRef.getElementById("portfolio-refresh");
  if (refresh instanceof HTMLButtonElement) refresh.disabled = state.contextBusy;
  const calculate = documentRef.getElementById("portfolio-risk-run");
  if (calculate instanceof HTMLButtonElement) {
    calculate.disabled = state.riskBusy || state.context?.dataUse.advisoryRiskImpact !== "allowed_current_development_only";
  }
  const lab = documentRef.getElementById("portfolio-lab-run");
  if (lab instanceof HTMLButtonElement) {
    const labBlockedByPortfolio = Boolean(state.context && !["available", "stale"].includes(state.context.status));
    lab.disabled = state.contextBusy || state.riskBusy || state.labBusy || labBlockedByPortfolio;
  }
  const compare = documentRef.getElementById("portfolio-lab-compare-run");
  const comparisonMembership = documentRef.getElementById("portfolio-lab-compare-membership");
  if (compare instanceof HTMLButtonElement) {
    compare.disabled = !state.lab || state.comparedLabBusy
      || !(comparisonMembership instanceof HTMLSelectElement && comparisonMembership.value);
  }
}

export function renderPortfolioLabComparisonMemberships(
  memberships: CandidateMembershipData[],
  currentMembershipId: string | null,
  documentRef: Document = document
): void {
  const select = documentRef.getElementById("portfolio-lab-compare-membership");
  if (!(select instanceof HTMLSelectElement)) return;
  const selected = select.value;
  const targets = memberships.filter((membership) => membership.state === "tracked" && membership.id !== currentMembershipId);
  const placeholder = documentRef.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select another tracked stock";
  const options = targets.map((membership) => {
    const option = documentRef.createElement("option");
    option.value = membership.id;
    option.textContent = `${membership.symbol} · ${membership.research.name ?? "unnamed"}`;
    return option;
  });
  select.replaceChildren(placeholder, ...options);
  select.value = targets.some((membership) => membership.id === selected) ? selected : "";
}

export function portfolioPositionCountText(context: PortfolioWorkspaceViewState["context"]): string {
  if (!context || !["available", "stale", "partial", "zero_position"].includes(context.status)) return "unknown";
  return String(context.summary.positionCount);
}

function renderLab(documentRef: Document, state: PortfolioWorkspaceViewState): void {
  const host = documentRef.getElementById("portfolio-lab-result");
  if (!host) return;
  host.replaceChildren();
  host.dataset.state = state.lab ? "available" : state.labBusy ? "loading" : "idle";
  const lab = state.lab?.data;
  if (!lab) {
    host.textContent = state.labBusy
      ? "Loading account-bound scenarios."
      : "Select an exact candidate membership and enter user amounts to compare scenarios.";
    return;
  }
  const identity = documentRef.createElement("p");
  identity.textContent = `Pingan ${lab.sourceIdentity.portfolioAsOf} · snapshot ${lab.sourceIdentity.portfolioSnapshotId} · account ${lab.sourceIdentity.accountScopeId} · Futu ${lab.sourceIdentity.quote.quoteTime}`;
  const grid = documentRef.createElement("div");
  grid.className = "portfolio-lab-grid";
  grid.append(labScenarioCard(documentRef, "Current", [
    ["Market value", money(lab.current.totalMarketValue)],
    ["Candidate weight", percent(lab.current.candidateWeight)],
    ["Largest position", percent(lab.current.largestPositionWeight)],
    ["HHI", number(lab.current.hhi)],
    ["Historical volatility", metricPercent(lab.current.historical.annualizedVolatility, lab.current.historical.status)],
    ["Historical tail loss", metricPercent(lab.current.historical.historicalTailLossMagnitude, lab.current.historical.status)],
    ["Candidate risk contribution", metricPercent(lab.current.historical.candidateRiskContribution, lab.current.historical.status)]
  ]));
  lab.scenarios.forEach((scenario) => grid.append(labScenarioCard(documentRef, `User scenario ${scenario.sourceIndex + 1}`, [
    ["User amount", money(scenario.hypotheticalAmount)],
    ["Candidate weight", percent(scenario.riskImpact.scenario.candidateWeight)],
    ["Weight change", percent(scenario.comparison.candidateWeightChange)],
    ["HHI change", number(scenario.comparison.hhiChange)],
    ["Historical volatility change", metricPercent(scenario.historical.annualizedVolatilityChange, scenario.historical.status)],
    ["Historical tail-loss change", metricPercent(scenario.historical.historicalTailLossChange, scenario.historical.status)],
    ["Candidate risk contribution change", metricPercent(scenario.historical.candidateRiskContributionChange, scenario.historical.status)]
  ])));
  const evidence = documentRef.createElement("p");
  const connect = lab.quant.evidence?.source.hkConnectUniverse;
  evidence.textContent = `Quant coverage ${lab.quant.coverage.status}: required ${lab.quant.coverage.requiredSymbols.join(", ")}; missing ${lab.quant.coverage.missingSymbols.join(", ") || "none"}. Hong Kong Connect ${connect ? `${connect.effectiveDate} · ${connect.memberCount} members · ${connect.snapshotId}` : "UNKNOWN"}. Correlation ${lab.quant.correlations.status}; stability ${lab.quant.correlations.stability}. Liquidity ${lab.quant.candidateLiquidity.status}; board lot ${lab.quant.candidateLiquidity.boardLot ?? "not captured"}; non-zero costs ${lab.quant.candidateLiquidity.nonZeroCosts ?? "not captured"}.`;
  const connectIdentity = connect ? documentRef.createElement("details") : null;
  if (connect && connectIdentity) {
    const summary = documentRef.createElement("summary");
    const identity = documentRef.createElement("p");
    summary.textContent = "Full Hong Kong Connect source identity";
    identity.textContent = `source ${connect.source} · snapshotId ${connect.snapshotId} · effectiveDate ${connect.effectiveDate} · capturedAt ${connect.capturedAt} · memberCount ${connect.memberCount}`;
    connectIdentity.append(summary, identity);
    connect.sourceUrls.forEach((sourceUrl, index) => {
      const link = documentRef.createElement("a");
      link.href = sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `Official source ${index + 1}`;
      connectIdentity.append(link);
    });
  }
  const boundary = documentRef.createElement("p");
  boundary.textContent = "Scenario order is user-selected. Cash, funding source, sector and foregone return remain explicit gaps; no preferred case, ranking, amount, weight, direction or order is generated.";
  host.append(identity, grid, evidence, ...(connectIdentity ? [connectIdentity] : []), boundary);
}

function renderComparedLab(documentRef: Document, state: PortfolioWorkspaceViewState): void {
  setText(documentRef, "portfolio-lab-compare-status", state.comparedLabMessage);
  const host = documentRef.getElementById("portfolio-lab-compare-result");
  if (!host) return;
  host.replaceChildren();
  host.dataset.state = state.comparedLab ? "available" : state.comparedLabBusy ? "loading" : "idle";
  const current = state.lab?.data;
  const compared = state.comparedLab?.data;
  if (!current || !compared) {
    host.textContent = state.comparedLabBusy ? "Loading cross-stock portfolio risk." : "No cross-stock comparison loaded.";
    return;
  }
  const identity = documentRef.createElement("p");
  identity.textContent = `${current.target.symbol} membership ${current.target.membershipId} v${current.target.membershipVersion} ↔ ${compared.target.symbol} membership ${compared.target.membershipId} v${compared.target.membershipVersion} · Pingan ${current.sourceIdentity.portfolioAsOf} · snapshot ${current.sourceIdentity.portfolioSnapshotId}`;
  const grid = documentRef.createElement("div");
  grid.className = "portfolio-lab-grid";
  const pair = annualPortfolioLabPairSummary(current, compared);
  const evidence = documentRef.createElement("p");
  if (pair) {
    if (pair.quantEvidenceId === null) {
      host.dataset.state = "partial";
      evidence.textContent = "Joint historical quant risk: UNKNOWN. The two stocks do not share one exact quant evidence version; only concentration scenarios from the exact Pingan snapshot are shown.";
    } else {
      evidence.textContent = `Shared quant evidence ${pair.quantEvidenceId} · cutoff ${current.quant.evidence?.source.dataCutoff ?? "UNKNOWN"}.`;
    }
    grid.append(labScenarioCard(documentRef, "Current selected pair", [
      ["Combined weight", percent(pair.current.selectedWeight)],
      ["Largest position", percent(pair.current.largestPositionWeight)],
      ["HHI", number(pair.current.hhi)],
      ["Historical volatility", metricPercent(pair.current.historical.annualizedVolatility, pair.current.historical.status)],
      ["Stress / tail loss", `${metricPercent(pair.current.historical.historicalStressLossMagnitude, pair.current.historical.status)} · ${metricPercent(pair.current.historical.historicalTailLossMagnitude, pair.current.historical.status)}`],
      ["Combined risk contribution", metricPercent(pair.current.historical.candidateRiskContribution, pair.current.historical.status)]
    ]));
    pair.scenarios.forEach((scenario) => grid.append(labScenarioCard(documentRef, `Add ${money(scenario.amountPerStock)} to each stock`, [
      ["Combined added amount", money(scenario.combinedAddedAmount)],
      ["Combined weight / change", `${percent(scenario.selectedWeight)} · ${percent(scenario.selectedWeightChange)}`],
      ["Largest position / change", `${percent(scenario.largestPositionWeight)} · ${percent(scenario.largestPositionWeightChange)}`],
      ["HHI / change", `${number(scenario.hhi)} · ${number(scenario.hhiChange)}`],
      ["Historical volatility / change", `${metricPercent(scenario.historical.annualizedVolatility, scenario.historical.status)} · ${metricPercent(scenario.annualizedVolatilityChange, scenario.historical.status)}`],
      ["Stress / tail change", `${metricPercent(scenario.historicalStressLossChange, scenario.historical.status)} · ${metricPercent(scenario.historicalTailLossChange, scenario.historical.status)}`],
      ["Combined risk contribution / change", `${metricPercent(scenario.historical.candidateRiskContribution, scenario.historical.status)} · ${metricPercent(scenario.selectedRiskContributionChange, scenario.historical.status)}`]
    ])));
  } else {
    evidence.textContent = "Joint comparison is unavailable because the portfolio or scenario identity changed.";
    grid.append(labScenarioCard(documentRef, "Joint risk unavailable", [["Reason", "The two reads no longer share one exact portfolio snapshot, amount order, or quant evidence window."]]));
  }
  const boundary = documentRef.createElement("p");
  boundary.textContent = "Same-amount joint research scenario; no ranking, recommendation, candidate ordering, decision or portfolio fact is changed.";
  host.append(identity, evidence, grid, boundary);
}

function labScenarioCard(documentRef: Document, title: string, rows: Array<[string, string]>): HTMLElement {
  const card = documentRef.createElement("section");
  card.className = "portfolio-lab-scenario";
  const heading = documentRef.createElement("h3");
  heading.textContent = title;
  card.append(heading, ...rows.map(([label, value]) => riskLine(documentRef, label, value)));
  return card;
}

export function metricPercent(value: number | null, _status: string): string {
  return value === null ? "UNKNOWN" : percent(value);
}

function renderPositions(documentRef: Document, positions: PortfolioDecisionPosition[], contextId: string | null): void {
  const body = documentRef.getElementById("portfolio-position-rows");
  if (!body) return;
  body.replaceChildren(...positions.map((position) => {
    const row = documentRef.createElement("tr");
    for (const [index, value] of [
      `${position.symbol}${position.name ? ` ${position.name}` : ""}`,
      number(position.quantity),
      money(position.averageCost, position.currency),
      money(position.latestPrice, position.currency),
      money(position.marketValue, position.currency),
      percent(position.marketWeight),
      money(position.unrealizedPnl, position.currency),
      `${position.quote.status}${position.quote.quoteAsOf ? ` · ${position.quote.quoteAsOf}` : ""}`
    ].entries()) {
      const cell = documentRef.createElement("td");
      cell.textContent = value;
      if (index === 0 && contextId) {
        const action = documentRef.createElement("button");
        action.type = "button";
        action.dataset.assetsResearchSymbol = position.symbol;
        action.dataset.assetsResearchSourceKey = `pingan:${contextId}:${position.symbol}`;
        action.textContent = "到 Research 看当前报告组合影响";
        cell.append(documentRef.createElement("br"), action);
      }
      row.append(cell);
    }
    return row;
  }));
}

function renderGaps(documentRef: Document, gaps: string[]): void {
  const list = documentRef.getElementById("portfolio-gaps");
  if (!list) return;
  list.replaceChildren(...gaps.map((gap) => {
    const item = documentRef.createElement("li");
    item.textContent = gap;
    return item;
  }));
}

function renderRisk(documentRef: Document, state: PortfolioWorkspaceViewState): void {
  const host = documentRef.getElementById("portfolio-risk-result");
  if (!host) return;
  const impact = state.riskImpact;
  host.dataset.state = impact?.status ?? "idle";
  if (!impact) {
    host.textContent = state.context?.dataUse.advisoryRiskImpact === "allowed_current_development_only"
      ? "Enter a user-provided amount to inspect exposure changes."
      : "Risk impact is blocked until the portfolio and all required quotes are current.";
    return;
  }
  if (impact.status !== "available") {
    host.textContent = `${impact.status}: ${impact.message}${impact.gaps.length ? ` ${impact.gaps.join(" ")}` : ""}`;
    return;
  }
  host.replaceChildren(
    riskLine(documentRef, "User amount", money(impact.hypotheticalAmount)),
    riskLine(documentRef, "Already held", impact.current.alreadyHeld ? "yes" : "no"),
    riskLine(documentRef, "Current exposure", `${money(impact.current.marketValue)} · ${percent(impact.current.weight)}`),
    riskLine(documentRef, "Scenario exposure", `${money(impact.scenario.candidateMarketValue)} · ${percent(impact.scenario.candidateWeight)}`),
    riskLine(documentRef, "Weight change", percent(impact.scenario.weightChange)),
    riskLine(documentRef, "Largest position", percent(impact.scenario.largestPositionWeight)),
    riskLine(documentRef, "Scenario HHI", number(impact.scenario.hhi))
  );
}

function riskLine(documentRef: Document, label: string, value: string): HTMLElement {
  const line = documentRef.createElement("div");
  const term = documentRef.createElement("strong");
  term.textContent = label;
  const detail = documentRef.createElement("span");
  detail.textContent = value;
  line.append(term, detail);
  return line;
}

function concentrationText(state: PortfolioWorkspaceViewState): string {
  const concentration = state.context?.summary.concentration;
  if (!concentration || concentration.status !== "available") return "unknown";
  return `largest ${percent(concentration.largestPositionWeight)} · top 3 ${percent(concentration.topThreeWeight)} · HHI ${number(concentration.hhi)}`;
}

function setText(documentRef: Document, id: string, value: string): void {
  const element = documentRef.getElementById(id);
  if (element) element.textContent = value;
}

function number(value: number | null): string {
  return value === null ? "unknown" : new Intl.NumberFormat("en-HK", { maximumFractionDigits: 4 }).format(value);
}

function money(value: number | null, currency: string | null = "HKD"): string {
  return value === null ? "unknown" : `${currency ?? "HKD"} ${new Intl.NumberFormat("en-HK", { maximumFractionDigits: 2 }).format(value)}`;
}

function percent(value: number | null): string {
  return value === null ? "unknown" : `${(value * 100).toFixed(2)}%`;
}
