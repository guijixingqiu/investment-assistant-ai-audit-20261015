import type { PreTradeDecisionCheckData } from "../../../packages/contracts/src/decisionContextBrowser.js";
import type { FactMetadata } from "../../../packages/contracts/src/factMetadata.js";
import type { ResearchProfileData } from "../../../packages/contracts/src/research.js";
import type { AnnualQuantProductView } from "../../../packages/contracts/src/annualValuationQuantWorkbench.js";
import {
  type InvestmentControlConsoleController,
  type InvestmentControlConsoleSource,
  type InvestmentConsoleTab
} from "./investmentControlConsoleController.js";

const tabs: InvestmentConsoleTab[] = ["sources", "valuation", "conditions", "diagnostics"];
const failureStates = ["unauthorized", "not_found", "conflict", "malformed", "offline", "unavailable"] as const;
const calendarCompletenessQualifier = "模拟执行只声明下一个可观察交易日开盘（next observed session open）；交易所日历完整性未验证（calendarCompleteness=unknown），历史配置中的 earliestExecution 仅作兼容字段。";

export function renderInvestmentControlConsole(
  controller: InvestmentControlConsoleController,
  source: InvestmentControlConsoleSource | null,
  submittedCheck: PreTradeDecisionCheckData | null,
  documentRef: Document = document
): void {
  const host = documentRef.getElementById("investment-control-console");
  if (!host) return;
  controller.syncSource();
  const state = controller.busy ? "loading" : activeConsoleFailure(controller, source !== null) ?? (source ? "ready" : "unavailable");
  host.dataset.state = state;
  setText(documentRef, "investment-console-source-status", source
    ? `${source.symbol} · membership ${source.membershipId} v${source.membershipVersion} · context ${source.decisionContext.contextId}`
    : "No exact candidate, membership, research, and decision-context binding is loaded.");
  setText(documentRef, "investment-console-health", state);
  renderTabs(documentRef, controller.activeTab);
  renderSourceRows(documentRef, source, controller);
  renderResearchEditor(documentRef, source, controller);
  renderValuation(documentRef, controller);
  renderConditional(documentRef, controller);
  renderLearning(documentRef, source);
  renderFailureMatrix(documentRef, controller);
  renderReleaseDiagnostics(documentRef, source);
  renderReviewLearningFields(documentRef, submittedCheck);
}

function activeConsoleFailure(controller: InvestmentControlConsoleController, hasSource: boolean): typeof failureStates[number] | null {
  const lanes = [controller.research, controller.valuation, controller.registeredQuant, controller.conditional];
  const latest = controller.lastFailure;
  if (latest && failureStates.includes(latest.state as typeof failureStates[number])) {
    if (latest.lane === "source" && !hasSource) return latest.state as typeof failureStates[number];
    const lane = latest.lane === "research" ? controller.research
      : latest.lane === "valuation" ? controller.valuation
        : latest.lane === "conditional" ? controller.conditional : null;
    if (lane?.state === latest.state) return latest.state as typeof failureStates[number];
  }
  return lanes.find((lane) => failureStates.includes(lane.state as typeof failureStates[number]))?.state as typeof failureStates[number] | undefined ?? null;
}

export function syncConditionalHumanCheckResult(documentRef: Document = document): void {
  const bind = checkbox(documentRef, "annual-conditional-bind");
  const workflow = optionalInput(documentRef, "annual-condition-workflow-state");
  const result = optionalInput(documentRef, "decision-result");
  if (!bind?.checked || !workflow || !result) return;
  result.value = workflow.value === "judgment_formed" ? "ready_to_consider"
    : workflow.value === "stop_following" ? "blocked" : "needs_more_evidence";
}

function renderTabs(documentRef: Document, active: InvestmentConsoleTab): void {
  for (const tab of tabs) {
    const button = documentRef.getElementById(`investment-console-tab-${tab}`);
    const panel = documentRef.getElementById(`investment-console-panel-${tab}`);
    if (button) {
      button.setAttribute("aria-selected", String(tab === active));
      button.setAttribute("tabindex", tab === active ? "0" : "-1");
    }
    if (panel) panel.hidden = tab !== active;
  }
}

function renderSourceRows(documentRef: Document, source: InvestmentControlConsoleSource | null, controller: InvestmentControlConsoleController): void {
  const body = documentRef.getElementById("investment-console-source-rows");
  if (!body) return;
  const research = source?.research.metadata;
  const quote = source?.decisionContext.quote.metadata;
  const quant = source?.decisionContext.quantEvidence.metadata;
  const portfolio = source?.portfolio;
  const rows: Array<[string, string, string, string]> = [
    ["Candidate membership", source?.membershipState ?? "unavailable", source ? `${source.membershipId} · version ${source.membershipVersion}` : "cleared", "actor-scoped candidate facts"],
    ["Research profile", research?.freshness ?? controller.research.state, metadataIdentity(research), research?.authority ?? "unavailable"],
    [quoteSourceLabel(source?.decisionContext.quote.source), source?.quoteState ?? "unavailable", metadataIdentity(quote), quote?.authority ?? "market_data"],
    ["Decision context", source ? "available" : "unavailable", source?.decisionContext.contextId ?? "cleared", "decision_context"],
    ["Pingan portfolio", portfolio?.status ?? "unavailable", portfolio ? `${portfolio.portfolioSnapshotId ?? "no snapshot"} · ${portfolio.accountScopeId ?? "no account scope"}` : "cleared", portfolio?.portfolioSource ? `${portfolio.portfolioSource} · development/local beta only` : "local_beta_only"],
    ["Quant evidence", source?.decisionContext.quantEvidence.status ?? "unavailable", metadataIdentity(quant), quant?.authority ?? "research_evidence"],
    ["Conditional preview", controller.conditional.state, controller.conditional.value?.previewId ?? "cleared", "human_judgment_only"],
    ["Review history", source ? source.reviewHistory.metadata.freshness : "unavailable", metadataIdentity(source?.reviewHistory.metadata), "append_only_human_review"]
  ];
  body.replaceChildren(...rows.map((row) => tableRow(documentRef, row, row[1])));
}

function renderResearchEditor(documentRef: Document, source: InvestmentControlConsoleSource | null, controller: InvestmentControlConsoleController): void {
  const profile = source?.research.data?.profile ?? null;
  const sourceKey = source?.sourceKey ?? "";
  const editor = documentRef.querySelector<HTMLElement>("[data-testid='research-profile-editor']");
  if (editor && editor.dataset.sourceKey !== sourceKey) {
    editor.dataset.sourceKey = sourceKey;
    writeProfileFields(documentRef, profile);
  }
  setText(documentRef, "research-editor-status", `${controller.research.state}: ${controller.research.message}`);
  setText(documentRef, "research-evidence-status", `${controller.research.state}: ${controller.research.message}`);
  const disabled = !profile || controller.busy || source?.membershipState === "archived";
  for (const id of profileControlIds) setDisabled(documentRef, id, disabled);
  for (const id of evidenceControlIds) setDisabled(documentRef, id, disabled);
  setDisabled(documentRef, "research-editor-save", disabled);
  setDisabled(documentRef, "research-evidence-add", disabled);
}

function renderValuation(documentRef: Document, controller: InvestmentControlConsoleController): void {
  // The user-computed valuation scenario owns the shared status once available;
  // otherwise an explicit registered run (or its loading/failure state) stays
  // visible instead of being hidden behind the idle user valuation lane.
  const lane = controller.valuation.state === "available" || controller.registeredQuant.state === "idle"
    ? controller.valuation
    : controller.registeredQuant;
  setText(documentRef, "annual-valuation-status", `${lane.state}: ${lane.message}`);
  setDisabled(documentRef, "annual-valuation-run", controller.busy);
  setDisabled(documentRef, "annual-valuation-registered-run", controller.busy);
  const output = documentRef.getElementById("annual-valuation-output");
  const sensitivity = documentRef.getElementById("annual-sensitivity-rows");
  const filter = documentRef.getElementById("annual-quant-filter-rows");
  const limitations = documentRef.getElementById("annual-valuation-limitations");
  if (!output || !sensitivity || !filter || !limitations) return;
  output.dataset.state = lane.state;
  output.replaceChildren();
  sensitivity.replaceChildren();
  filter.replaceChildren();
  limitations.replaceChildren();
  const data = controller.valuation.value?.data;
  const registered = controller.registeredQuant.value;
  const registeredEvidence = registered?.status === "available"
    ? registered.decisionContext?.quantEvidence ?? null
    : null;
  if ((!data || controller.valuation.state !== "available") && !registeredEvidence) {
    output.textContent = lane.message;
    return;
  }
  // Registered-run evidence is rendered from the existing decision context and
  // never requires a user scenario or filter input.
  if (!data || controller.valuation.state !== "available") {
    const evidence = registeredEvidence;
    if (!evidence) {
      output.textContent = lane.message;
      return;
    }
    output.replaceChildren(
      metric(documentRef, "Registered quant evidence", `${controller.registeredQuant.state} · ${evidence.status} · ${evidence.sampleBoundary.sourceClassification}`),
      metric(documentRef, "Historical data cutoff", evidence.decisionEvidence?.source?.observationEndDate ?? "not captured"),
      metric(documentRef, "Registered run timestamp", evidence.identities?.generatedAt ?? "not captured"),
      metric(documentRef, "Registered run message", controller.registeredQuant.message),
      metric(documentRef, "Quant evidence message", evidence.message),
      ...quantDecisionEvidenceMetrics(documentRef, evidence)
    );
    // Missing-history, sample-boundary and calendar limits stay visible for a
    // registered-only render instead of being suppressed with the empty state.
    limitations.replaceChildren(
      ...[...evidence.limitations, evidence.sampleBoundary.limitation, calendarCompletenessQualifier].map((item) => listItem(documentRef, item))
    );
    return;
  }
  const valuation = data.valuation;
  const quant = data.quant;
  const range = valuation.outputs?.valueRange;
  const margin = valuation.outputs?.scenarioMarginOfSafety;
  output.replaceChildren(
    metric(documentRef, "Quote", valuation.quote ? `${valuation.quote.currency} ${formatNumber(valuation.quote.price)} · ${valuation.quote.source} · ${valuation.quote.quoteTime}` : valuation.status),
    metric(documentRef, "Projected metric / share", `${formatNumber(valuation.outputs?.projectedMetricPerShare)} ${valuation.inputs.metricCurrency ?? "UNKNOWN"}`),
    metric(documentRef, "Scenario present value / share", `${formatNumber(valuation.outputs?.scenarioPresentValuePerShare)} ${valuation.inputs.metricCurrency ?? "UNKNOWN"}`),
    metric(documentRef, "Implied annual expectation", valuation.outputs?.impliedAnnualGrowthRateAtCurrentPrice === null || valuation.outputs === null ? "not computable" : formatPercent(valuation.outputs.impliedAnnualGrowthRateAtCurrentPrice)),
    metric(documentRef, "Owner scenario attention range", range ? `${formatNumber(range.low)}–${formatNumber(range.high)} ${valuation.inputs.metricCurrency ?? "UNKNOWN"} · not a target price` : "not captured"),
    metric(documentRef, "Price vs Owner range", margin ? `${margin.position} · low/base/high margin ${formatPercent(margin.low)} / ${formatPercent(margin.base)} / ${formatPercent(margin.high)} · not a trade signal` : "not captured"),
    metric(documentRef, "Quant evidence", `${quant.status} · ${quant.model.sourceClassification}`),
    metric(documentRef, "Historical data cutoff", quant.model.dataCutoff ?? "not captured"),
    metric(documentRef, "Registered run timestamp", quant.evidence.identities?.generatedAt ?? "not captured"),
    metric(documentRef, "Quant evidence message", quant.evidence.message),
    ...quantDecisionEvidenceMetrics(documentRef, quant.evidence),
    metric(documentRef, "Benchmark", `${quant.diagnostics.benchmark.status} · ${quant.diagnostics.benchmark.limitation}`), metric(documentRef, "Sample size", `${quant.diagnostics.sampleSize.status} · ${quant.diagnostics.sampleSize.limitation}`),
    metric(documentRef, "Concentration", `${quant.diagnostics.concentration.status} · ${quant.diagnostics.concentration.limitation}`),
    metric(documentRef, "Parameter search", `${quant.diagnostics.parameterNeighborhood.status} · ${quant.diagnostics.parameterNeighborhood.limitation}`),
    metric(documentRef, "Frozen identities", `${quant.model.snapshotId ?? "not captured"} · ${quant.model.codeIdentity ?? "not captured"}`)
  );
  sensitivity.replaceChildren(...(valuation.sensitivity?.cells ?? []).map((cell) => tableRow(documentRef, [
    formatPercent(cell.annualGrowthRate), formatNumber(cell.terminalMultiple), formatNumber(cell.presentValuePerShare)
  ])));
  filter.replaceChildren(...quant.filter.samples.map((sample) => tableRow(documentRef, [
    sample.sampleId, formatPercent(sample.maxDrawdownMagnitude), formatNumber(sample.turnoverOneWay), String(sample.tradeCount), sample.allCriteriaMatched ? "matched" : "not matched"
  ], sample.allCriteriaMatched ? "matched" : "not_matched")));
  const items = [...valuation.limitations, ...quant.limitations, ...Object.values(quant.diagnostics).map((item) => item.limitation)];
  items.push(calendarCompletenessQualifier);
  limitations.replaceChildren(...items.map((item) => listItem(documentRef, item)));
}

/**
 * Main quant section facts. Values come only from the existing workbench
 * envelope (the same fields the iOS renderer uses); a missing sample field is
 * shown as explicitly unavailable instead of being recomputed or hidden.
 */
function quantDecisionEvidenceMetrics(documentRef: Document, evidence: AnnualQuantProductView["evidence"]): HTMLElement[] {
  const decisionEvidence = evidence.decisionEvidence;
  if (!decisionEvidence || decisionEvidence.status !== "available") {
    return [metric(documentRef, "Registered quant details", `not available · ${decisionEvidence?.status ?? "not_captured"} · 旧量化样本和实验不会被倒填` )];
  }
  const source = decisionEvidence.source;
  const rows = [metric(
    documentRef,
    "Simulated observation range",
    source
      ? `${source.observationStartDate}~${source.observationEndDate} · ${source.sourceClassification} / ${source.adjustment} · ${decisionEvidence.samples.length} samples · cutoff ${source.dataCutoff}`
      : `${decisionEvidence.samples.length} samples · observation range not captured`
  )];
  for (const sample of decisionEvidence.samples) {
    const metrics = sample.metrics;
    const performance = `annualized ${formatPercent(metrics.simulatedAnnualizedReturn)} · round trips ${metrics.simulatedClosedRoundTripCount ?? "UNKNOWN"} · win rate ${formatPercent(metrics.simulatedWinRate)}`;
    rows.push(metric(
      documentRef,
      `Sample ${sample.id} (${sample.start}~${sample.end}, ${sample.role})`,
      `simulated return ${formatPercent(metrics.simulatedTotalReturn)} · ${performance} · max drawdown ${formatPercent(metrics.simulatedMaxDrawdown)} · Sharpe ${formatNumber(metrics.simulatedSharpe)} · trades ${metrics.simulatedTradeCount} · total fees ${formatNumber(metrics.simulatedTotalFees)} HKD · one-way turnover ${formatPercent(metrics.simulatedTurnoverOneWay)} · average gross exposure ${formatPercent(metrics.simulatedAverageGrossExposure)} · accounting audit ${metrics.accountingAuditStatus}`
    ));
  }
  rows.push(metric(documentRef, "Final-test boundary", evidence.sampleBoundary.finalTestPolicy === "locked_report_only_no_tuning"
    ? "retrospective locked report only; no prospective out-of-sample claim or parameter tuning"
    : "final-test policy unavailable; prospective out-of-sample status not established"));
  const comparison = evidence.comparison;
  if (comparison) {
    rows.push(metric(documentRef, "实验选择", `基准方案先固定，其他参数只作对照诊断；最终测试不参与选参 · 选参区间 ${comparison.selectionWindow.start}~${comparison.selectionWindow.end}`));
    if (comparison.experiments.length === 0) rows.push(metric(documentRef, "Compared experiments", "not captured"));
    for (const experiment of comparison.experiments) {
      rows.push(metric(
        documentRef,
        `Experiment ${experiment.id} · ${experiment.disposition}`,
        `${experiment.reason} · selection-window metrics ${comparison.selectionWindow.start}~${comparison.selectionWindow.end} · ${experiment.signal.name}: buy previous-close return ≤ ${formatPercent(experiment.signal.buyWhenPreviousCloseReturnLte)}, sell ≥ ${formatPercent(experiment.signal.sellWhenPreviousCloseReturnGte)} · simulated return ${formatPercent(experiment.metrics.totalReturn)} · drawdown ${formatPercent(experiment.metrics.maxDrawdown)} · trades ${experiment.metrics.tradeCount} · closed round trips ${experiment.metrics.closedRoundTripCount} · fees ${formatNumber(experiment.metrics.totalFees)} HKD · one-way turnover ${formatPercent(experiment.metrics.turnoverOneWay)} · final test used for selection: ${experiment.finalTestUsedForSelection}`
      ));
    }
    rows.push(metric(documentRef, "Benchmark basis", `${comparison.benchmark.name} (${comparison.benchmark.symbol}) · ${comparison.returnBasis} · price-only benchmark and dividend-inclusive net-fee strategy returns are not equivalent`));
    for (const period of comparison.benchmark.periods) {
      rows.push(metric(documentRef, `Benchmark ${period.id} (${period.start}~${period.end})`, `strategy ${formatPercent(period.simulatedStrategyTotalReturn)} · benchmark ${formatPercent(period.benchmarkTotalReturn)} · arithmetic difference ${formatPercent(period.difference)} · parameter selection: ${period.usedForParameterSelection}`));
    }
  } else {
    rows.push(metric(documentRef, "Experiment comparison", "not captured in this accepted snapshot; no later reconstruction"));
  }
  const robustness = decisionEvidence.robustness;
  rows.push(metric(documentRef, "Registration and robustness", robustness
    ? `${robustness.registrationTiming} · preregistered ${robustness.preregistered} · prospective holdout ${robustness.prospectiveHoldoutClaim} · final-test parameter selection ${robustness.finalTestUsedForParameterSelection} · final-test threshold fitting ${robustness.finalTestUsedForAcceptanceThresholdFitting}`
    : "not captured"));
  rows.push(metric(documentRef, "Failed/rejected experiment record", robustness
    ? `${robustness.failedExperiments.status} · ${robustness.failedExperiments.experimentIds.join(", ") || "no IDs recorded"} · ${robustness.failedExperiments.limitation}`
    : "not captured"));
  const formal = decisionEvidence.formalEvidence;
  if (formal) {
    rows.push(metric(documentRef, "Candidate research rule", `${formal.candidateResearchRule.ruleVersion} · universe ${formal.candidateResearchRule.universeVersion} · cutoff ${formal.candidateResearchRule.cutoff} · eligibility ${formal.candidateResearchRule.eligibilityEvidenceStatus} · ${formal.candidateResearchRule.limitations.join(" ")}`));
    for (const check of formal.checks) {
      rows.push(metric(documentRef, `Formal check ${check.id}`, `${check.status} · ${check.identity ?? "identity not captured"} · ${check.limitation}`));
    }
  } else {
    rows.push(metric(documentRef, "Formal evidence checks", "not captured in this accepted snapshot"));
  }
  const execution = decisionEvidence.execution;
  rows.push(metric(documentRef, "Execution assumptions", execution
    ? `signal ${execution.signalTiming} · earliest ${execution.earliestExecution} · same-bar ${execution.allowsSameBarExecution} · margin ${execution.allowsMargin} · board lot ${execution.boardLot} · non-zero costs ${execution.nonZeroCosts} · suspension ${execution.suspensionHandling} · zero volume ${execution.zeroVolumeHandling} · missing price ${execution.missingPriceHandling}`
    : "not captured"));
  for (const limitation of decisionEvidence.limitations) rows.push(metric(documentRef, "Quant evidence limitation", limitation));
  return rows;
}

function renderConditional(documentRef: Document, controller: InvestmentControlConsoleController): void {
  setText(documentRef, "annual-conditional-status", `${controller.conditional.state}: ${controller.conditional.message}`);
  setDisabled(documentRef, "annual-conditional-run", controller.busy);
  const bind = checkbox(documentRef, "annual-conditional-bind");
  if (!bind) return;
  bind.disabled = controller.conditional.state !== "available";
  bind.checked = controller.conditionalBound;
  const output = documentRef.getElementById("annual-conditional-output");
  if (!output) return;
  output.dataset.state = controller.conditional.state;
  output.replaceChildren();
  const preview = controller.conditional.value;
  if (!preview?.data || controller.conditional.state !== "available") {
    output.textContent = controller.conditional.message;
    return;
  }
  const scenario = preview.data.portfolioLab.data?.scenarios[preview.data.selectedPortfolioScenarioIndex];
  output.replaceChildren(
    metric(documentRef, "Preview", preview.previewId ?? "unavailable"),
    metric(documentRef, "Candidate", preview.requestedSymbol ?? "unavailable"),
    metric(documentRef, "Decision brief", preview.data.decisionBrief.data?.readiness.state ?? preview.data.decisionBrief.status),
    metric(documentRef, "Valuation", preview.data.valuationQuant.data?.valuation.status ?? preview.data.valuationQuant.status),
    metric(documentRef, "Selected user amount", scenario ? `HKD ${formatNumber(scenario.hypotheticalAmount)}` : "unavailable"),
    metric(documentRef, "Portfolio observation", scenario ? `weight ${formatPercent(scenario.riskImpact.scenario.candidateWeight)} · HHI ${formatNumber(scenario.riskImpact.scenario.hhi)}` : "unavailable"),
    metric(documentRef, "Safety", "human review only · no automatic transition · no execution")
  );
  syncConditionalHumanCheckResult(documentRef);
}

function renderLearning(documentRef: Document, source: InvestmentControlConsoleSource | null): void {
  const summary = source?.reviewHistory.learningSummary;
  setText(documentRef, "annual-learning-status", summary?.availability ?? "learning_not_captured");
  const counts = documentRef.getElementById("annual-learning-counts");
  const details = documentRef.getElementById("annual-learning-details");
  if (!counts || !details) return;
  counts.replaceChildren();
  details.replaceChildren();
  if (!summary) {
    details.textContent = "No validated actor-scoped learning summary is present; historical gaps are not reconstructed.";
    return;
  }
  counts.replaceChildren(
    metric(documentRef, "Eligible reviews", String(summary.counts.eligibleReviews)),
    metric(documentRef, "Captured learning", String(summary.counts.capturedLearningRecords)),
    metric(documentRef, "Not captured", String(summary.counts.notCapturedLearningRecords)),
    metric(documentRef, "Minimum sample", String(summary.minimumSampleSize))
  );
  const lines = [summary.limitation,
    ...summary.confidenceOutcomes.map((row) => `${row.confidence}: ${row.total} review(s); ${Object.entries(row.outcomes).map(([key, value]) => `${key}=${value}`).join(", ")}`),
    ...summary.repeatedProcessLessons.map((item) => `Repeated process lesson (${item.count}): ${item.processLesson}`),
    ...summary.quantSampleLimitations.map((item) => `Quant boundary: ${item.sourceClassification}; ${item.finalTestPolicy}; ${item.boundaryLimitation}`)
  ];
  details.replaceChildren(...lines.map((line) => listItem(documentRef, line)));
}

function renderFailureMatrix(documentRef: Document, controller: InvestmentControlConsoleController): void {
  const body = documentRef.getElementById("investment-console-failure-rows");
  if (!body) return;
  body.replaceChildren(...failureStates.map((state) => tableRow(documentRef, [
    state,
    controller.lastFailure?.state === state ? `${controller.lastFailure.lane}: ${controller.lastFailure.message}` : "not last observed",
    failurePolicy(state)
  ], controller.lastFailure?.state === state ? "observed" : state)));
}

function renderReleaseDiagnostics(documentRef: Document, source: InvestmentControlConsoleSource | null): void {
  const body = documentRef.getElementById("investment-console-release-rows");
  if (!body) return;
  const rows: Array<[string, string, string]> = [
    ["Research writes", source ? "source_bound" : "blocked", "Profile and evidence writes require exact actor-scoped membership identity and version."],
    ["Pingan current portfolio", source?.portfolio?.status ?? "unavailable", "Approved for current local development and Local Beta only; no production, accounting, or broker authority."],
    ["Migration / fixture / shadow facts", "blocked_from_current_authority", "Never promoted to current holdings, account truth, official review, or execution input."],
    ["Read-only candidate release", "completed", "Reviewed exact-head GET-only evidence, database write denial, backup, restore, rollback, and private ingress remain historical release evidence."],
    ["Full production", "NO_GO", "No promotion, production write, broker access, official portfolio mutation, publish, deploy, or cutover is enabled here."],
    ["Orders and trades", "NOT_USED", "No order, trade, fill, cash, fee, position, or broker route is available from this console."]
  ];
  body.replaceChildren(...rows.map((row) => tableRow(documentRef, row, row[1])));
}

function renderReviewLearningFields(documentRef: Document, check: PreTradeDecisionCheckData | null): void {
  const fieldset = documentRef.getElementById("annual-review-learning-fields") as HTMLFieldSetElement | null;
  if (!fieldset) return;
  const enabled = check?.conditionalDecision?.availability === "preserved";
  fieldset.disabled = !enabled;
  const checkId = enabled ? check?.id ?? "" : "";
  if (fieldset.dataset.checkId === checkId) return;
  fieldset.dataset.checkId = checkId;
  for (const id of ["annual-review-judgment-correction", "annual-review-process-lesson", "annual-review-next-question"]) input(documentRef, id).value = "";
}

function writeProfileFields(documentRef: Document, profile: ResearchProfileData | null): void {
  const values: Record<string, string> = {
    "research-editor-name": profile?.name ?? "",
    "research-editor-next-review": profile?.nextReviewOn ?? "",
    "research-editor-current-view": profile?.currentView ?? "",
    "research-editor-current-thesis": profile?.currentThesis ?? "",
    "research-editor-market-disagreement": profile?.marketDisagreement ?? "",
    "research-editor-invalidation": profile?.invalidationCondition ?? "",
    "research-editor-key-variables": (profile?.keyVariables ?? []).join("\n"),
    "research-editor-catalysts": (profile?.catalysts ?? []).join("\n"),
    "research-editor-evidence-gaps": (profile?.evidenceGaps ?? []).join("\n")
  };
  for (const [id, value] of Object.entries(values)) input(documentRef, id).value = value;
}

function metadataIdentity(metadata?: FactMetadata | null): string {
  return metadata ? `${metadata.source} · as-of ${metadata.asOf ?? "missing"} · fetched ${metadata.fetchedAt ?? "missing"}` : "cleared";
}
function quoteSourceLabel(source: string | null | undefined): string { return source === "futu" ? "Futu quote" : source === "fixture" ? "Fixture quote" : source === "cache" ? "Cache quote" : source ? `${source} quote` : "Quote"; }
function failurePolicy(state: typeof failureStates[number]): string {
  if (state === "unauthorized") return "Clear facts and block empty-success claims until scoped authorization reloads.";
  if (state === "not_found") return "Clear facts and preserve absence as absence, not an empty successful result.";
  if (state === "conflict") return "Clear facts and require an exact source and identity reload before restoring success.";
  if (state === "malformed") return "Reject JSON, schema, identity, hash, or recomputation drift before display.";
  if (state === "offline") return "Clear network-derived facts; local-only state stays separately labelled.";
  return "Clear facts and expose dependency or repository unavailability without fallback data.";
}

function tableRow(documentRef: Document, cells: string[], state?: string): HTMLTableRowElement {
  const row = documentRef.createElement("tr");
  if (state) row.dataset.state = state;
  row.append(...cells.map((value) => { const cell = documentRef.createElement("td"); cell.textContent = value; return cell; }));
  return row;
}

function metric(documentRef: Document, label: string, value: string): HTMLElement {
  const wrapper = documentRef.createElement("div");
  const term = documentRef.createElement("strong");
  const detail = documentRef.createElement("span");
  term.textContent = label;
  detail.textContent = value;
  wrapper.append(term, detail);
  return wrapper;
}

function listItem(documentRef: Document, value: string): HTMLLIElement { const item = documentRef.createElement("li"); item.textContent = value; return item; }
function formatNumber(value: number | null | undefined): string { return value === null || value === undefined ? "unavailable" : new Intl.NumberFormat("en-HK", { maximumFractionDigits: 6 }).format(value); }
function formatPercent(value: number | null | undefined): string { return value === null || value === undefined ? "unavailable" : `${(value * 100).toFixed(2)}%`; }
function input(documentRef: Document, id: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement { return documentRef.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement; }
function optionalInput(documentRef: Document, id: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null { return documentRef.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null; }
function checkbox(documentRef: Document, id: string): HTMLInputElement | null { return documentRef.getElementById(id) as HTMLInputElement | null; }
function setText(documentRef: Document, id: string, value: string): void { const element = documentRef.getElementById(id); if (element) element.textContent = value; }
function setDisabled(documentRef: Document, id: string, disabled: boolean): void { const element = documentRef.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement | null; if (element) element.disabled = disabled; }

const profileControlIds = [
  "research-editor-name", "research-editor-next-review", "research-editor-current-view", "research-editor-current-thesis",
  "research-editor-market-disagreement", "research-editor-invalidation", "research-editor-key-variables",
  "research-editor-catalysts", "research-editor-evidence-gaps"
];
const evidenceControlIds = [
  "research-evidence-source-type", "research-evidence-published-at", "research-evidence-source-url", "research-evidence-summary",
  "research-evidence-fact-kind", "research-evidence-stance", "research-evidence-variable", "research-evidence-reliability",
  "research-evidence-materiality", "research-evidence-read"
];
