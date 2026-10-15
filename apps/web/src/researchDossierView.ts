import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";
import type { CreateResearchCompletenessRequest } from "../../../packages/contracts/src/researchCompleteness.js";
import {
  RESEARCH_INDUSTRY_DIMENSIONS,
  RESEARCH_MACRO_DIMENSIONS,
  type CreateResearchContextRequest,
  type ResearchContextDriver,
  type ResearchContextNumericFact,
  type ResearchContextPeer,
  type ResearchPeerCitation,
  type ResearchOperatingKpi
} from "../../../packages/contracts/src/researchContext.js";
import type { CreateResearchFundamentalValueRequest } from "../../../packages/contracts/src/researchFundamentals.js";
import type { CreateResearchValuationScenarioRequest } from "../../../packages/contracts/src/researchValuationScenarios.js";
import type { AnnualValuationMethodId } from "../../../packages/contracts/src/annualValuationQuantWorkbench.js";
import type { ResearchMaterialData } from "../../../packages/contracts/src/researchMaterial.js";
import { localDateTimeToIso } from "./researchDocumentTransport.js";
import {
  currentPdfMaterials,
  currentFundamentalMaterials,
  currentFinancialRequirementMaterials,
  eligibleValuationAnchors,
  type CreateResearchFinancialRequirementRequest,
  type ResearchDossierMembership,
  type ResearchDossierSnapshot
} from "./researchDossierData.js";

export interface ResearchDossierDraft<T> {
  logicalFingerprint: string;
  request: Omit<T, "idempotencyKey">;
}

export interface ResearchDossierViewState {
  membership: ResearchDossierMembership | null;
  snapshot: ResearchDossierSnapshot | null;
  message: string;
  busy: boolean;
  selectedFinancialSourceIds?: ReadonlySet<string>;
}

export function completenessDossierDraft(
  snapshot: ResearchDossierSnapshot,
  membership: ResearchDossierMembership,
  now = new Date()
): ResearchDossierDraft<CreateResearchCompletenessRequest> {
  const externalSections = ["valuation", "quant", "weinstein", "risks", "counterevidence", "conflicts"].map((section) => ({
    section: section as CreateResearchCompletenessRequest["externalSections"][number]["section"],
    status: "unknown" as const,
    coverage: { achieved: 0, required: 1 },
    sourceBindings: [],
    gaps: [`${section} is derived by the server and remains UNKNOWN until exact readback`]
  }));
  const expiries = [
    ...snapshot.fundamentals.values.filter((item) => item.valueState === "current").map((item) => item.source.validUntil),
    ...(snapshot.financialRequirement?.data ? [snapshot.financialRequirement.data.validUntil] : []),
    ...(snapshot.context.data ? [snapshot.context.data.validUntil] : [])
  ].filter((value) => Date.parse(value) > now.getTime()).sort((left, right) => Date.parse(left) - Date.parse(right));
  const request = {
    membershipVersion: membership.version,
    baseSnapshotId: snapshot.completeness?.latestSnapshotId ?? null,
    expectedFundamentalsDataCutoffAt: snapshot.fundamentals.dataCutoffAt,
    expectedResearchContextId: snapshot.context.status === "available" ? snapshot.context.data?.id ?? null : null,
    externalSections,
    validUntil: expiries[0] ?? new Date(now.getTime() + 30 * 86_400_000).toISOString(),
    ownerConfirmed: true as const
  };
  return {
    logicalFingerprint: canonicalJson(["completeness", membership, request.baseSnapshotId,
      request.expectedFundamentalsDataCutoffAt,
      snapshot.financialRequirement?.data?.id ?? null,
      request.expectedResearchContextId]),
    request
  };
}

export function financialRequirementDossierDraft(
  documentRef: Document,
  snapshot: ResearchDossierSnapshot,
  membership: ResearchDossierMembership,
  selectedIds: ReadonlySet<string>,
  now = new Date()
): ResearchDossierDraft<CreateResearchFinancialRequirementRequest> {
  const eligible = currentFinancialRequirementMaterials(snapshot);
  const selected = eligible.filter(item => selectedIds.has(item.id))
    .sort((left, right) => BigInt(left.id) < BigInt(right.id) ? -1 : 1);
  if (selected.length !== selectedIds.size || selected.length < 1 || selected.length > 4) {
    throw new Error("请从当前已保存原文中选择 1–4 份资料，逐份打开核对。 ");
  }
  const yearEnd = required(documentRef, "research-financial-requirement-year-end");
  const annualEnd = required(documentRef, "research-financial-requirement-annual-end");
  const interimStart = required(documentRef, "research-financial-requirement-interim-start");
  const interimEnd = required(documentRef, "research-financial-requirement-interim-end");
  const asOf = instant(documentRef, "research-financial-requirement-as-of", "核对截至时间");
  const nextReviewAt = instant(documentRef, "research-financial-requirement-next-review", "下一次复核时间");
  if (!financialRequirementPeriodsValid(yearEnd, annualEnd, interimStart, interimEnd, asOf)) {
    throw new Error("请核对财政年结、最新年度与同一或下一财政年度的中期期数。 ");
  }
  if (Date.parse(asOf) > now.getTime() || Date.parse(nextReviewAt) <= now.getTime()
    || Date.parse(nextReviewAt) <= Date.parse(asOf)) {
    throw new Error("核对截至时间不能在未来，下一次复核时间须晚于当前时间。 ");
  }
  const confirmed = documentRef.getElementById("research-financial-requirement-confirm");
  if (!(confirmed instanceof HTMLInputElement) || !confirmed.checked) {
    throw new Error("请对照所选原文，并明确确认期数核对。 ");
  }
  const request = {
    membershipVersion: membership.version,
    baseRequirementId: snapshot.financialRequirement?.latestRequirementId ?? null,
    sourceMaterials: selected.map(item => ({ materialId: item.id,
      materialRevision: item.revision, contentFingerprint: item.contentFingerprint })),
    fiscalYearEnd: yearEnd,
    latestRequiredAnnualPeriodEnd: annualEnd,
    latestRequiredInterimPeriodStart: interimStart,
    latestRequiredInterimPeriodEnd: interimEnd,
    asOf, nextReviewAt,
    ownerConfirmed: true as const
  };
  return { logicalFingerprint: canonicalJson(["financial-requirement", membership,
    selected.map(sourceIdentity), request]), request };
}

export function financialRequirementPeriodsValid(
  yearEnd: string, annualEnd: string, interimStart: string, interimEnd: string, asOf: string
): boolean {
  const calendarDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  const year = Number(annualEnd.slice(0, 4));
  const previousEnd = `${String(year - 1).padStart(4, "0")}-${yearEnd}`;
  const nextEnd = `${String(year + 1).padStart(4, "0")}-${yearEnd}`;
  const intervalDays = (Date.parse(`${interimEnd}T00:00:00.000Z`)
    - Date.parse(`${interimStart}T00:00:00.000Z`)) / 86_400_000;
  if (!(/^\d{2}-\d{2}$/.test(yearEnd) && yearEnd !== "02-29"
    && calendarDate(`2024-${yearEnd}`) && year > 1 && year < 9999
    && [annualEnd, previousEnd, nextEnd, interimStart, interimEnd].every(calendarDate)
    && annualEnd.endsWith(yearEnd))) return false;
  const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000)
    .toISOString().slice(0, 10);
  return ((interimStart === nextDay(previousEnd) && interimEnd < annualEnd)
    || (interimStart === nextDay(annualEnd) && interimEnd < nextEnd))
    && interimStart <= interimEnd
    && intervalDays >= 27 && intervalDays < 364
    && annualEnd <= asOf.slice(0, 10) && interimEnd <= asOf.slice(0, 10);
}

export function contextDossierDraft(
  documentRef: Document,
  snapshot: ResearchDossierSnapshot,
  membership: ResearchDossierMembership
): ResearchDossierDraft<CreateResearchContextRequest> {
  const source = selectedPdfMaterial(documentRef, "research-dossier-context-material", snapshot);
  if (!source.citation) throw new Error("The selected context source has no exact PDF page citation.");
  const asOf = instant(documentRef, "research-dossier-context-as-of", "Context as-of");
  const cutoffAt = instant(documentRef, "research-dossier-context-cutoff", "Context cutoff");
  const requestedValidUntil = instant(documentRef, "research-dossier-context-valid-until", "Context valid-until");
  const validUntil = Date.parse(requestedValidUntil) < Date.parse(source.validUntil) ? requestedValidUntil : source.validUntil;
  const citation = {
    ...source.citation,
    sourceType: source.sourceType,
    sourceUrl: source.sourceUrl,
    sourceVersion: source.sourceVersion
  };
  const provenance = {
    sourceType: source.sourceType,
    sourceVersion: source.sourceVersion,
    capturedAt: source.capturedAt,
    classification: "user_provided" as const
  };
  const current = snapshot.context.data;
  const entryKind = input(documentRef, "research-dossier-context-kind").value;
  let selectedFacts = [...(current?.selectedFacts ?? [])];
  let peerFacts = [...(current?.peerFacts ?? [])];
  let peers = [...(current?.peers ?? [])];
  let operatingKpis = [...(current?.operatingKpis ?? [])];
  let macroDrivers = current?.macroDrivers ?? [];
  let industryDrivers = current?.industryDrivers ?? [];
  if (entryKind === "selected_fact") {
    const valueText = optional(documentRef, "research-dossier-context-value");
    const currencyText = optional(documentRef, "research-dossier-context-currency");
    const metric = required(documentRef, "research-dossier-context-metric");
    const itemId = selectedFacts.find((item) => item.symbol === membership.symbol && item.metric === metric)?.id
      ?? nextResearchContextItemId([...selectedFacts, ...peerFacts]);
    selectedFacts = selectedFacts.filter((item) => item.id !== itemId
      && !(item.symbol === membership.symbol && item.metric === metric));
    selectedFacts.push({
      id: itemId,
      selectedSymbol: membership.symbol,
      symbol: membership.symbol,
      metric,
      value: valueText,
      unit: required(documentRef, "research-dossier-context-unit"),
      currency: currencyText ? currencyText.toUpperCase() : null,
      asOf,
      cutoffAt,
      validUntil,
      citation,
      provenance
    });
  } else if (entryKind === "peer_fact") {
    const peerSymbol = required(documentRef, "research-dossier-context-peer-symbol").toUpperCase();
    const peerStatus = input(documentRef, "research-dossier-context-peer-status").value;
    if (peerStatus !== "included" && peerStatus !== "excluded") {
      throw new Error("Choose whether this sourced peer is included or excluded.");
    }
    const valueText = optional(documentRef, "research-dossier-context-value");
    const currencyText = optional(documentRef, "research-dossier-context-currency");
    const metric = required(documentRef, "research-dossier-context-metric");
    const itemId = peerFacts.find((item) => item.symbol === peerSymbol && item.metric === metric)?.id
      ?? nextResearchContextItemId([...selectedFacts, ...peerFacts]);
    const fact: ResearchContextNumericFact = {
      id: itemId,
      selectedSymbol: membership.symbol,
      symbol: peerSymbol,
      metric,
      value: valueText,
      unit: required(documentRef, "research-dossier-context-unit"),
      currency: currencyText ? currencyText.toUpperCase() : null,
      asOf, cutoffAt, validUntil, citation, provenance
    };
    const peer: ResearchContextPeer = {
      id: peers.find((item) => item.symbol === peerSymbol)?.id ?? itemId,
      selectedSymbol: membership.symbol,
      symbol: peerSymbol,
      name: required(documentRef, "research-dossier-context-peer-name"),
      status: peerStatus,
      reason: required(documentRef, "research-dossier-context-peer-reason"),
      asOf, cutoffAt, validUntil, citation, provenance
    };
    peerFacts = peerFacts.filter((item) => item.id !== fact.id
      && !(item.symbol === peerSymbol && item.metric === metric));
    peerFacts.push(fact);
    peers = peers.filter((item) => item.id !== peer.id && item.symbol !== peer.symbol);
    peers.push(peer);
  } else if (entryKind === "operating_kpi") {
    const valueStatus = input(documentRef, "research-dossier-context-kpi-value-status").value as ResearchOperatingKpi["valueStatus"];
    const comparability = input(documentRef, "research-dossier-context-kpi-comparability").value as ResearchOperatingKpi["comparability"];
    const category = input(documentRef, "research-dossier-context-kpi-category").value as ResearchOperatingKpi["category"];
    const metric = required(documentRef, "research-dossier-context-metric");
    const periodEnd = required(documentRef, "research-dossier-context-kpi-period-end");
    const existingKpi = operatingKpis.find((item) => item.category === category && item.metric === metric && item.periodEnd === periodEnd);
    const kpi: ResearchOperatingKpi = {
      id: existingKpi?.id ?? nextResearchContextItemId(operatingKpis),
      selectedSymbol: membership.symbol,
      category,
      metric,
      periodStart: required(documentRef, "research-dossier-context-kpi-period-start"),
      periodEnd,
      valueStatus,
      value: valueStatus === "reported" ? required(documentRef, "research-dossier-context-value") : null,
      unit: required(documentRef, "research-dossier-context-unit"),
      comparability,
      comparabilityReason: comparability === "not_comparable"
        ? required(documentRef, "research-dossier-context-kpi-comparability-reason") : null,
      asOf, cutoffAt, validUntil, citation, provenance
    };
    operatingKpis = operatingKpis.filter((item) => item.id !== kpi.id
      && !(item.category === category && item.metric === metric && item.periodEnd === periodEnd));
    operatingKpis.push(kpi);
  } else if (entryKind === "macro" || entryKind === "industry") {
    const dimension = required(documentRef, "research-dossier-context-dimension") as ResearchContextDriver["dimension"];
    const existing = [...macroDrivers, ...industryDrivers].find((item) => (
      item.kind === entryKind && item.dimension === dimension
    ));
    const driver: ResearchContextDriver = {
      id: existing?.id ?? nextResearchContextItemId([...macroDrivers, ...industryDrivers]),
      selectedSymbol: membership.symbol,
      kind: entryKind,
      dimension,
      impact: input(documentRef, "research-dossier-context-impact").value as ResearchContextDriver["impact"],
      statement: required(documentRef, "research-dossier-context-statement"),
      thesisRelevance: required(documentRef, "research-dossier-context-thesis-relevance"),
      asOf,
      cutoffAt,
      validUntil,
      citation,
      provenance
    };
    macroDrivers = macroDrivers.filter((item) => item.id !== driver.id
      && !(item.kind === entryKind && item.dimension === dimension));
    industryDrivers = industryDrivers.filter((item) => item.id !== driver.id
      && !(item.kind === entryKind && item.dimension === dimension));
    if (entryKind === "macro") macroDrivers.push(driver);
    else industryDrivers.push(driver);
  } else {
    throw new Error("Context entry type is invalid.");
  }
  const request = {
    baseContextId: current?.id ?? null,
    membershipVersion: membership.version,
    selectedSymbol: membership.symbol,
    industry: required(documentRef, "research-dossier-context-industry"),
    selectedFacts,
    peerFacts,
    peers,
    operatingKpis,
    macroDrivers,
    industryDrivers,
    unknowns: lines(documentRef, "research-dossier-context-unknowns", 100),
    provenance,
    asOf,
    cutoffAt,
    validUntil
  };
  return {
    logicalFingerprint: canonicalJson(["context", membership, sourceIdentity(source), { ...request, baseContextId: null }]),
    request
  };
}

export function nextResearchContextItemId(items: Array<{ id: string }>): string {
  return String(Math.max(0, ...items.map((item) => Number(item.id)).filter(Number.isSafeInteger)) + 1);
}

export function fundamentalDossierDraft(
  documentRef: Document,
  snapshot: ResearchDossierSnapshot,
  membership: ResearchDossierMembership
): ResearchDossierDraft<CreateResearchFundamentalValueRequest> {
  const source = selectedFundamentalMaterial(documentRef, snapshot);
  const valueStatus = input(documentRef, "research-dossier-fundamental-status").value as CreateResearchFundamentalValueRequest["valueStatus"];
  const periodKind = input(documentRef, "research-dossier-fundamental-period-kind").value as CreateResearchFundamentalValueRequest["periodKind"];
  const comparability = input(documentRef, "research-dossier-fundamental-comparability").value as CreateResearchFundamentalValueRequest["comparability"];
  const assertion: CreateResearchFundamentalValueRequest["assertion"] = source.sourceType === "issuer_public_html" ? (() => {
    const citation = source.snapshotCitation, original = source.snapshotOriginal;
    if (!citation || !original || !source.sourceUrl || valueStatus !== "reported") throw new Error("The saved HTML passage is unavailable or cannot support this value.");
    const requiredFields = ["rawValue", "metric", "period", "currency", "unitScale", "scope", "businessScope", "measurementBasis", "category"];
    for (const field of requiredFields) {
      const control = documentRef.querySelector<HTMLInputElement>(`[data-fundamental-confirm="${field}"]`);
      if (!control?.checked) throw new Error(`Explicit ${field} structure confirmation is required.`);
    }
    const sourceChecked = input(documentRef, "research-dossier-fundamental-source-checked") as HTMLInputElement;
    if (!sourceChecked.checked) throw new Error("Confirm review of the saved original and selected passage.");
    const rawValueText = required(documentRef, "research-dossier-fundamental-raw-value");
    if (!source.contentText.includes(rawValueText)) throw new Error("The exact source number is absent from the selected passage.");
    return {
      unit: "currency", measurementBasis: input(documentRef, "research-dossier-fundamental-measurement-basis").value as "financial_statement" | "issuer_sales" | "issued_shares",
      businessScope: required(documentRef, "research-dossier-fundamental-business-scope"),
      category: input(documentRef, "research-dossier-fundamental-category").value as "actual" | "guidance",
      sourceUrl: source.sourceUrl,
      limitation: required(documentRef, "research-dossier-fundamental-limitation"), sourceChecked: true,
      structureConfirmation: { confirmedFields: ["metric", "period", "currency", "unitScale", "scope"] },
      snapshotTextBinding: { snapshotId: citation.snapshotId, textSha256: citation.textSha256,
        startUtf16: citation.startUtf16, endUtf16: citation.endUtf16, excerptSha256: citation.excerptSha256,
        sourceExcerpt: source.contentText, rawValueText }
    };
  })() : undefined;
  const request = {
    membershipVersion: membership.version,
    sourceMaterialId: source.id,
    metric: input(documentRef, "research-dossier-fundamental-metric").value as CreateResearchFundamentalValueRequest["metric"],
    periodKind,
    periodStart: periodKind === "duration" ? required(documentRef, "research-dossier-fundamental-period-start") : null,
    periodEnd: required(documentRef, "research-dossier-fundamental-period-end"),
    currency: required(documentRef, "research-dossier-fundamental-currency").toUpperCase(),
    unitScale: Number(input(documentRef, "research-dossier-fundamental-unit-scale").value),
    scope: input(documentRef, "research-dossier-fundamental-scope").value as CreateResearchFundamentalValueRequest["scope"],
    valueStatus,
    value: valueStatus === "reported" ? required(documentRef, "research-dossier-fundamental-value") : null,
    comparability,
    comparabilityReason: comparability === "not_comparable" ? required(documentRef, "research-dossier-fundamental-comparability-reason") : null,
    amendmentKind: "initial" as const,
    replacesValueId: null,
    ownerConfirmed: true as const,
    ...(assertion ? {assertion} : {})
  };
  return { logicalFingerprint: canonicalJson(["fundamental", membership, sourceIdentity(source), request]), request };
}

export function valuationDossierDraft(
  documentRef: Document,
  snapshot: ResearchDossierSnapshot,
  membership: ResearchDossierMembership
): ResearchDossierDraft<CreateResearchValuationScenarioRequest> {
  const methodId = input(documentRef, "research-dossier-valuation-method").value as AnnualValuationMethodId;
  const anchorId = required(documentRef, "research-dossier-valuation-anchor");
  const anchors = eligibleValuationAnchors(snapshot, methodId).filter((item) => item.id === anchorId);
  if (anchors.length !== 1) throw new Error("The valuation anchor is no longer exactly current and eligible.");
  const current = snapshot.valuations.scenarioSets.filter((item) => item.scenarioState === "current" && item.anchor.id === anchorId);
  if (current.length > 1) throw new Error("The selected anchor has ambiguous current valuation scenarios.");
  const request = {
    membershipVersion: membership.version,
    symbol: membership.symbol,
    anchorValueId: anchorId,
    replacesScenarioSetId: current[0]?.id ?? null,
    assumptions: {
      methodId,
      metricCurrency: required(documentRef, "research-dossier-valuation-currency").toUpperCase(),
      baseMetricPerShare: number(documentRef, "research-dossier-valuation-base"),
      annualGrowthRate: number(documentRef, "research-dossier-valuation-growth"),
      horizonYears: number(documentRef, "research-dossier-valuation-years"),
      terminalMultiple: number(documentRef, "research-dossier-valuation-multiple"),
      annualDiscountRate: number(documentRef, "research-dossier-valuation-discount"),
      netCashPerShare: number(documentRef, "research-dossier-valuation-net-cash"),
      growthRateStep: number(documentRef, "research-dossier-valuation-growth-step"),
      multipleStep: number(documentRef, "research-dossier-valuation-multiple-step")
    },
    ownerConfirmed: true as const
  };
  return {
    logicalFingerprint: canonicalJson(["valuation", membership, anchors[0], { ...request, replacesScenarioSetId: null }]),
    request
  };
}

export function renderResearchDossier(documentRef: Document, state: ResearchDossierViewState): void {
  const host = documentRef.getElementById("research-dossier-console");
  const status = documentRef.getElementById("research-dossier-status");
  const membership = documentRef.getElementById("research-dossier-membership");
  const output = documentRef.getElementById("research-dossier-output");
  if (!host || !status || !membership || !output) return;
  host.dataset.state = state.busy ? "loading" : state.snapshot ? "available" : state.membership ? "idle" : "blocked";
  host.dataset.contextState = state.snapshot?.context.data ? "available" : "missing";
  const financialCoverage = state.snapshot?.fundamentals.financialCoverage ?? null;
  host.dataset.fundamentalState = financialCoverage?.status === "available" ? "available" : "missing";
  host.dataset.fundamentalCoverage = financialCoverage
    ? `${financialCoverage.completeAnnualPeriods}/${financialCoverage.requiredAnnualPeriods} annual · interim ${financialCoverage.latestInterimPeriodEnd ?? "UNKNOWN"} ${financialCoverage.latestInterimStatus}`
    : "UNKNOWN";
  const valuationMethodCount = new Set(state.snapshot?.valuations.scenarioSets
    .filter((item) => item.scenarioState === "current" && item.recomputable)
    .map((item) => item.calculation.method.id) ?? []).size;
  host.dataset.valuationState = valuationMethodCount === 2 ? "available" : "missing";
  host.dataset.valuationCoverage = `${valuationMethodCount}/2 methods`;
  membership.textContent = state.membership
    ? `${state.membership.symbol} · membership ${state.membership.id} v${state.membership.version} · ${state.membership.state}`
    : "No exact non-archived membership selected";
  status.textContent = state.message;
  for (const id of ["research-dossier-refresh", "research-dossier-context-save", "research-dossier-fundamental-save", "research-dossier-valuation-save", "research-dossier-completeness-save", "research-financial-requirement-save"]) {
    const button = documentRef.getElementById(id);
    if (button instanceof HTMLButtonElement) button.disabled = state.busy || !state.membership || id !== "research-dossier-refresh" && !state.snapshot;
  }
  const deep = documentRef.getElementById("research-dossier-open-deep-research");
  if (deep instanceof HTMLButtonElement) deep.disabled = state.busy || !state.membership;
  if (!state.snapshot) {
    renderFinancialRequirementSources(documentRef, null, state.selectedFinancialSourceIds);
    renderFinancialRequirementResult(documentRef, null);
    output.replaceChildren(documentRef.createTextNode("Current dossier facts are UNKNOWN until a fresh exact read succeeds."));
    return;
  }
  populateSelections(documentRef, state.snapshot);
  renderFinancialRequirementSources(documentRef, state.snapshot, state.selectedFinancialSourceIds);
  renderFinancialRequirementResult(documentRef, state.snapshot);
  documentRef.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
    "#research-financial-requirement-sources input, #research-financial-requirement-sources button"
  ).forEach(control => { control.disabled = state.busy; });
  syncContextEntryFields(documentRef);
  output.replaceChildren(
    section(documentRef, "Research coverage and gaps", completenessLines(state.snapshot)),
    section(documentRef, "Research context", contextLines(state.snapshot)),
    section(documentRef, "Fundamentals and derivations", fundamentalLines(state.snapshot)),
    section(documentRef, "Valuation scenarios", valuationLines(state.snapshot))
  );
}

function renderFinancialRequirementResult(documentRef: Document, snapshot: ResearchDossierSnapshot | null): void {
  const output = documentRef.getElementById("research-financial-requirement-output");
  if (!output) return;
  const envelope = snapshot?.financialRequirement;
  if (!envelope) {
    output.textContent = "财务资料期数核对暂不可读；当前仍待核验。";
  } else if (envelope.status === "not_found") {
    output.textContent = "尚未保存财务资料期数核对；财务覆盖仍待核验。";
  } else if (envelope.status === "unavailable" || !envelope.data) {
    output.textContent = `先前核对已失效或来源暂不可用。${envelope.gaps.map(financialRequirementGapText).join("；") || "请重新读取来源并核对。"}`;
  } else {
    const data = envelope.data;
    output.textContent = `已保存人工核对：财政年结 ${data.fiscalYearEnd}；截至 ${data.asOf}，应有年度至 ${data.latestRequiredAnnualPeriodEnd}、中期 ${data.latestRequiredInterimPeriodStart} 至 ${data.latestRequiredInterimPeriodEnd}。下次复核 ${data.nextReviewAt}；当前有效至 ${data.validUntil}。引用 ${data.sources.length} 份已保存原文。${envelope.gaps.length ? `仍有缺口：${envelope.gaps.map(financialRequirementGapText).join("；")}` : "财务覆盖仍以实际财务值和缺口为准。"}`;
  }
}

function financialRequirementGapText(gap: string): string {
  if (gap.includes("has not been checked")) return "尚未核对截至日期应有的财务资料";
  if (gap.includes("membership version changed")) return "当前公司资料版本已变化";
  if (gap.includes("expired")) return "期数核对或来源复核已到期";
  if (gap.includes("as-of is in the future")) return "核对截至时间尚未到来";
  if (gap.startsWith("source material ")) return "所选原文已变化或暂不可打开";
  if (gap.includes("annual period is absent")) return "所选原文未出现应有年度的期末日期";
  if (gap.includes("interim period is absent")) return "所选原文未出现应有中期的期末日期";
  return "所选原文与期间尚需重新核对";
}

function renderFinancialRequirementSources(
  documentRef: Document,
  snapshot: ResearchDossierSnapshot | null,
  selected: ReadonlySet<string> = new Set()
): void {
  const list = documentRef.getElementById("research-financial-requirement-sources");
  const status = documentRef.getElementById("research-financial-requirement-source-status");
  if (!(list instanceof HTMLUListElement) || !status) return;
  const materials = snapshot ? currentFinancialRequirementMaterials(snapshot) : [];
  status.textContent = snapshot
    ? materials.length ? `可逐份核对 ${materials.length} 条当前已保存原文。` : "当前没有可核对的已保存官方原文；请先在资料与原文中保存并确认来源。"
    : "请先读取当前公司的已保存原文。";
  list.replaceChildren(...materials.map(material => {
    const row = documentRef.createElement("li");
    const label = documentRef.createElement("label");
    const check = documentRef.createElement("input");
    check.type = "checkbox";
    check.value = material.id;
    check.checked = selected.has(material.id);
    check.dataset.financialRequirementSource = material.id;
    const kind = material.snapshotCitation ? "已保存网页段落" : `已保存 PDF 第 ${material.citation?.pageNumber ?? "?"} 页`;
    const claim = material.claimType === "verified_fact" ? "已核实事实"
      : material.claimType === "third_party_statement" ? "第三方陈述或规则" : "发行人声明";
    const name = documentRef.createElement("span");
    name.textContent = `${material.title} · ${claim} · ${kind}`;
    label.append(check, name);
    const open = documentRef.createElement("button");
    open.type = "button";
    open.textContent = "打开原文核对";
    open.dataset.financialRequirementOpen = material.id;
    row.append(label, open);
    return row;
  }));
}

function completenessLines(snapshot: ResearchDossierSnapshot): string[] {
  const completeness = snapshot.completeness;
  if (!completeness || completeness.status !== "available" || !completeness.data) {
    return [`Coverage UNKNOWN · ${completeness?.message ?? "no current exact coverage snapshot"}`];
  }
  const financialSource = completeness.data.sections.find(item => item.section === "financials")
    ?.sourceBindings.find(source => source.sourceType === "financial_requirement");
  return [
    `${completeness.data.score.availableSections}/${completeness.data.score.totalSections} domains · ${completeness.data.status} · valid until ${completeness.data.validUntil}`,
    ...completeness.data.sections.map((item) =>
      `${item.section}: ${item.status} · ${item.coverage.achieved}/${item.coverage.required}${item.gaps.length ? ` · gaps ${item.gaps.join("; ")}` : ""}`
    ),
    ...(financialSource ? [`财务资料期数核对来源：#${financialSource.sourceId} · 核对截至 ${financialSource.asOf} · 有效至 ${financialSource.validUntil}`] : [])
  ];
}

export function syncContextEntryFields(documentRef: Document): void {
  const kind = input(documentRef, "research-dossier-context-kind").value;
  const targets = kind === "selected_fact" ? ["fact"]
    : kind === "peer_fact" ? ["fact", "peer"]
      : kind === "operating_kpi" ? ["fact", "kpi"] : ["driver"];
  for (const element of documentRef.querySelectorAll<HTMLElement>("[data-research-dossier-context-entry]")) {
    element.hidden = !targets.includes(element.dataset.researchDossierContextEntry ?? "");
  }
  if (targets.includes("driver")) {
    const dimensions = kind === "industry" ? RESEARCH_INDUSTRY_DIMENSIONS : RESEARCH_MACRO_DIMENSIONS;
    setOptions(documentRef, "research-dossier-context-dimension", dimensions.map((value) => ({ value, label: value })), "No dimension");
  }
}

function populateSelections(documentRef: Document, snapshot: ResearchDossierSnapshot): void {
  const materials = currentPdfMaterials(snapshot);
  const materialOptions = materials.map((item) => ({ value: item.id, label: `Material ${item.id} r${item.revision} · document ${item.citation?.documentId} p${item.citation?.pageNumber} · ${item.title}` }));
  setOptions(documentRef, "research-dossier-context-material", materialOptions, "No exact current PDF material");
  setOptions(documentRef, "research-dossier-fundamental-material", currentFundamentalMaterials(snapshot).map(item => ({
    value: item.id, label: item.sourceType === "issuer_public_html"
      ? `Saved HTML material ${item.id} · snapshot ${item.snapshotCitation?.snapshotId} · ${item.title}`
      : `PDF material ${item.id} · document ${item.citation?.documentId} p${item.citation?.pageNumber} · ${item.title}`
  })), "No exact current source material");
  const methodId = input(documentRef, "research-dossier-valuation-method").value as AnnualValuationMethodId;
  setOptions(documentRef, "research-dossier-valuation-anchor", eligibleValuationAnchors(snapshot, methodId).map((item) => ({
    value: item.id,
    label: `Fundamental ${item.id} r${item.revision} · ${item.metric} ${item.periodEnd} · ${item.value} ${item.currency}`
  })), "No eligible current fundamental anchor");
}

function contextSourceLabel(citation: ResearchPeerCitation): string {
  const owner = citation.sourceMembership ? ` · source ${citation.sourceMembership.symbol}` : "";
  return "documentId" in citation
    ? `document ${citation.documentId} p${citation.pageNumber} · page SHA ${citation.pageTextSha256}${owner}`
    : `saved ${citation.sourceType} material ${citation.materialId} r${citation.materialRevision}${owner}`;
}

function contextLines(snapshot: ResearchDossierSnapshot): string[] {
  const context = snapshot.context.data;
  const lines = context ? [
    `CURRENT context ${context.id} · ${context.industry} · cutoff ${context.cutoffAt} · valid until ${context.validUntil}`,
    ...context.selectedFacts.map((item) => `Fact ${item.id}: ${item.metric}=${item.value ?? "UNKNOWN"} ${item.unit} · period ${item.periodStart ?? "point/legacy"}..${item.periodEnd ?? "UNKNOWN"} · ${contextSourceLabel(item.citation)}`),
    ...context.peers.map((item) => `Peer ${item.symbol}/${item.name}: ${item.status}${snapshot.context.peerSourceIssues?.some((issue) => issue.peerId === item.id) ? " · source stale/unavailable; select a new saved original" : ""} · ${item.reason} · ${"kind" in item.citation && item.citation.kind === "saved_material"
      ? `saved ${item.citation.sourceType} material ${item.citation.materialId} r${item.citation.materialRevision}`
      : "documentId" in item.citation ? `document ${item.citation.documentId} p${item.citation.pageNumber}`
        : "source unavailable"} · cutoff ${item.cutoffAt}`),
    ...context.peerFacts.map((item) => `Peer fact ${item.symbol}/${item.metric}: ${item.value ?? "UNKNOWN"} ${item.unit} · period ${item.periodStart ?? "point/legacy"}..${item.periodEnd ?? "UNKNOWN"} · ${contextSourceLabel(item.citation)}${snapshot.context.peerFactSourceIssues?.some(issue => issue.factId === item.id) ? " · source stale/unavailable" : ""}`),
    ...context.operatingKpis.map((item) => `KPI ${item.category}/${item.metric} ${item.periodStart}–${item.periodEnd}: ${item.value ?? "UNKNOWN"} ${item.unit} · ${item.comparability}`),
    ...context.macroDrivers.map((item) => `Macro ${item.id}/${item.dimension}: ${item.impact} · ${item.statement} · thesis ${item.thesisRelevance} · document ${item.citation.documentId} p${item.citation.pageNumber}`),
    ...context.industryDrivers.map((item) => `Industry ${item.id}/${item.dimension}: ${item.impact} · ${item.statement} · thesis ${item.thesisRelevance} · document ${item.citation.documentId} p${item.citation.pageNumber}`),
    ...context.comparisons.map((item) => {
      const peer = context.peers.find(candidate => candidate.symbol === item.peerSymbol);
      const selectedFact = context.selectedFacts.find(fact => fact.id === item.selectedFactId);
      const peerFact = context.peerFacts.find(fact => fact.id === item.peerFactId);
      const periodComparable = selectedFact?.periodEnd !== undefined
        && selectedFact.periodEnd === peerFact?.periodEnd
        && selectedFact.periodStart === peerFact?.periodStart;
      return `Comparison ${item.peerSymbol}/${item.metric}: ${peer?.status === "excluded"
        ? `excluded (${peer.reason})` : peer?.status !== "included"
          ? "UNKNOWN (peer inclusion not established)"
          : snapshot.context.peerSourceIssues?.some(issue => issue.peerId === peer.id)
            ? "UNKNOWN (peer inclusion source stale/unavailable)"
          : snapshot.context.peerFactSourceIssues?.some(issue => issue.factId === item.peerFactId)
            ? "UNKNOWN (peer fact source stale/unavailable)"
          : item.status === "available" && periodComparable ? `delta ${item.delta}`
            : `UNKNOWN (${item.reason ?? "measurement period is not disclosed"})`}`;
    }),
    `Change: ${snapshot.context.changeSummary?.changedSections.join(", ") || "initial snapshot / no changed section"}`,
    `Unknowns: ${context.unknowns.join("; ") || "none recorded"}`
  ] : ["CURRENT context UNKNOWN; no fresh current snapshot exists."];
  lines.push(...snapshot.context.history.map((item) => `History r${item.revision}: context ${item.id} · previous ${item.previousContextId ?? "none"} · cutoff ${item.cutoffAt}`));
  return lines;
}

function fundamentalLines(snapshot: ResearchDossierSnapshot): string[] {
  const coverage = snapshot.fundamentals.financialCoverage;
  const coverageLines = [
    `Financial coverage: ${coverage.completeAnnualPeriods}/${coverage.requiredAnnualPeriods} complete annual periods · latest interim ${coverage.latestInterimPeriodEnd ?? "UNKNOWN"} ${coverage.latestInterimStatus}`,
    ...coverage.gaps.map((gap) => `Financial gap: ${gap}`)
  ];
  const values = snapshot.fundamentals.values.map((item) =>
    `${item.valueState === "current" ? "CURRENT" : "HISTORICAL"} value ${item.id} r${item.revision} · ${item.metric} ${item.periodEnd} · ${item.value ?? "UNKNOWN"} ${item.currency} ×${item.unitScale} · ${item.comparability} · ${item.source.kind === "source_snapshot" ? `snapshot ${item.source.snapshotCitation.snapshotId} · original ${item.source.originalAvailability} · review ${item.source.snapshotReviewState}` : `document ${item.source.documentId} p${item.source.pageNumber}`} · material ${item.source.materialId} r${item.source.materialRevision}`
  );
  const derivations = snapshot.fundamentals.derivations.map((item) =>
    `Derivation ${item.kind}/${item.periodEnd || "UNKNOWN"}: ${item.status === "available" ? item.value : `UNKNOWN (${item.reason})`} · ${item.formulaVersion} · inputs ${item.inputValueIds.join(",") || "none"}`
  );
  return [...coverageLines, ...(values.length ? values : ["Fundamental values UNKNOWN; none recorded."]), ...(derivations.length ? derivations : ["Derivations UNKNOWN; no current inputs."])];
}

function valuationLines(snapshot: ResearchDossierSnapshot): string[] {
  return snapshot.valuations.scenarioSets.length ? snapshot.valuations.scenarioSets.map((item) =>
    `${item.scenarioState === "current" ? "CURRENT" : "HISTORICAL"} scenario ${item.id} r${item.revision} · anchor ${item.anchor.id}/${item.anchor.metric} · recomputable ${item.recomputable} · invalidated ${item.invalidatedBy.join(",") || "none"} · projected ${item.calculation.projectedMetricPerShare} · present value ${item.calculation.scenarioPresentValuePerShare} ${item.assumptions.values.metricCurrency}`
  ) : ["Valuation scenario UNKNOWN; none recorded."];
}

function section(documentRef: Document, title: string, lines: string[]): HTMLElement {
  const section = documentRef.createElement("section");
  const heading = documentRef.createElement("h4");
  const list = documentRef.createElement("ul");
  heading.textContent = title;
  list.append(...lines.map((line) => { const item = documentRef.createElement("li"); item.textContent = line; return item; }));
  section.append(heading, list);
  return section;
}

function setOptions(documentRef: Document, id: string, options: Array<{ value: string; label: string }>, empty: string): void {
  const select = documentRef.getElementById(id);
  if (!(select instanceof HTMLSelectElement)) return;
  const selected = select.value;
  select.replaceChildren(...(options.length ? options : [{ value: "", label: empty }]).map((item) => {
    const option = documentRef.createElement("option"); option.value = item.value; option.textContent = item.label; return option;
  }));
  if (options.some((item) => item.value === selected)) select.value = selected;
}

function selectedPdfMaterial(documentRef: Document, id: string, snapshot: ResearchDossierSnapshot): ResearchMaterialData {
  const selected = required(documentRef, id);
  const matches = currentPdfMaterials(snapshot).filter((item) => item.id === selected);
  if (matches.length !== 1) throw new Error("The selected PDF material is no longer exactly current, fresh, or citation-bound.");
  return matches[0];
}
function selectedFundamentalMaterial(documentRef: Document, snapshot: ResearchDossierSnapshot): ResearchMaterialData {
  const selected = required(documentRef, "research-dossier-fundamental-material");
  const matches = currentFundamentalMaterials(snapshot).filter(item => item.id === selected);
  if (matches.length !== 1) throw new Error("The selected source material is no longer exactly current and citation-bound.");
  return matches[0];
}
function sourceIdentity(value: ResearchMaterialData): unknown { return [value.id, value.revision, value.contentFingerprint, value.sourceVersion, value.validUntil, value.citation]; }
function input(documentRef: Document, id: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement { const value = documentRef.getElementById(id); if (!(value instanceof HTMLInputElement || value instanceof HTMLSelectElement || value instanceof HTMLTextAreaElement)) throw new Error(`Missing #${id}.`); return value; }
function required(documentRef: Document, id: string): string { const value = input(documentRef, id).value.trim(); if (!value) throw new Error(`${id} is required.`); return value; }
function optional(documentRef: Document, id: string): string | null { return input(documentRef, id).value.trim() || null; }
function instant(documentRef: Document, id: string, label: string): string { return localDateTimeToIso(required(documentRef, id), label); }
function number(documentRef: Document, id: string): number { const value = Number(required(documentRef, id)); if (!Number.isFinite(value)) throw new Error(`${id} must be a finite number.`); return value; }
function lines(documentRef: Document, id: string, max: number): string[] { const values = input(documentRef, id).value.split("\n").map((item) => item.trim()).filter(Boolean); if (values.length > max) throw new Error(`${id} has too many lines.`); return values; }
