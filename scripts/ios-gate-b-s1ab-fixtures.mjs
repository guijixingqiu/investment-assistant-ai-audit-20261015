import { readFile } from "node:fs/promises";

import {
  DAILY_CONTENT_HASH_METHOD,
  dailyBarsSnapshotHash,
  dailySourceContentHash,
  sha256Canonical,
  validateDailyTechnicalEnvelope
} from "../dist/packages/contracts/src/marketDaily.js";
import { hkexCompletedSessionEvidenceVersion } from "../dist/packages/contracts/src/marketDailyCalendarEvidence.js";
import {
  ANNUAL_VALUATION_CALCULATION_VERSION,
  ANNUAL_VALUATION_PRESENT_VALUE_FORMULA,
  ANNUAL_ADJUSTED_NET_ASSET_CALCULATION_VERSION,
  ANNUAL_ADJUSTED_NET_ASSET_VALUE_FORMULA,
  calculateAnnualValuationScenarioGrid
} from "../dist/packages/contracts/src/annualValuationQuantWorkbench.js";
import {
  validateResearchValuationScenariosEnvelope
} from "../dist/packages/contracts/src/researchValuationScenarios.js";
import {
  frozenWeinsteinEvidenceBinding,
  validateWeinsteinTechnicalAnalysisEnvelope
} from "../dist/packages/contracts/src/weinsteinTechnicalAnalysis.js";
import { RESEARCH_FUNDAMENTALS_SCHEMA_VERSION } from "../dist/packages/contracts/src/researchFundamentals.js";
import {
  RESEARCH_COMPLETENESS_SCHEMA_VERSION,
  RESEARCH_COMPLETENESS_SECTIONS,
  buildResearchCompletenessSnapshot,
  validateResearchCompletenessEnvelope
} from "../dist/packages/contracts/src/researchCompleteness.js";
import {
  validateDeepResearchReportData,
  validateDeepResearchWorkspaceEnvelope
} from "../dist/packages/contracts/src/deepResearch.js";
import {
  DEEP_RESEARCH_TASK_SCHEMA_VERSION,
  deepResearchTaskSafety,
  validateCreateDeepResearchTaskRequest,
  validateDeepResearchTaskEnvelope
} from "../dist/packages/contracts/src/deepResearchTask.js";
import { CLOUD_AI_PROVIDER_POLICY_VERSION } from "../dist/packages/contracts/src/cloudAiPolicy.js";
import {
  TODAY_ACTION_INBOX_SCHEMA_VERSION,
  validateTodayActionInboxEnvelope
} from "../dist/packages/contracts/src/todayActionInbox.js";
import { getDailyTechnicalEnvelope } from "../dist/apps/api/src/market/dailyBarsService.js";
import { calculateTechnicalAnalysis } from "../dist/apps/api/src/market/technicalIndicators.js";
import { calculateWeinsteinTechnicalAnalysis } from "../dist/apps/api/src/market/weinsteinTechnicalAnalysis.js";
import {
  deepResearchGateFailures,
  deepResearchReportFingerprint,
  evidencePackFingerprint,
  researchMaterialFingerprint
} from "../dist/apps/api/src/research/deepResearchGate.js";
import { synthesizedReportFixturePayload } from "../tests/unit/deep-research-synthesis-fixture.mjs";

const membershipId = "1";
const membershipVersion = 3;
const actorId = "candidate-write-token-principal";
const symbol = "HK.09926";
const market = "HK";
const code = "09926";
const generatedAt = "2026-07-31T01:00:00.000Z";
const cutoff = "2026-07-30";
const materialId = "7";
const materialRevision = 2;
const scenarioId = "51";
const scenarioRevision = 1;
const packId = "31";
const packVersion = 1;

export async function createS1abFixtureState() {
  const today = JSON.parse(await readFile(new URL(
    "../apps/ios/AnnualRingsGateA/Tests/AnnualRingsGateATests/Fixtures/today-research.json",
    import.meta.url
  ), "utf8"));
  const memberships = JSON.parse(await readFile(new URL(
    "../apps/ios/AnnualRingsGateA/Tests/AnnualRingsGateATests/Fixtures/candidate-memberships.json",
    import.meta.url
  ), "utf8"));
  const technical = await createTechnicalEnvelope();
  const weinstein = createWeinsteinFixture();
  const scenario = createScenario();
  const adjustedScenario = createAdjustedScenario(scenario);
  const material = createMaterial();
  const context = createContext([scenario, adjustedScenario], technical, weinstein);
  const pack = createPack(material, context);
  const completeness = createCompletenessEnvelope();
  const scenarioEnvelope = {
    schemaVersion: "2026-07-30.research-valuation-scenarios.v1",
    generatedAt,
    status: "available",
    requestedActorId: actorId,
    membershipId,
    membershipVersion,
    membershipState: "tracked",
    symbol,
    fundamentalsSchemaVersion: RESEARCH_FUNDAMENTALS_SCHEMA_VERSION,
    scenarioSets: [scenario, adjustedScenario]
  };
  assertValid(validateDailyTechnicalEnvelope(technical), "S1AB technical fixture");
  assertValid(validateWeinsteinTechnicalAnalysisEnvelope(weinstein, {
    symbol, analysisAsOf: cutoff
  }), "S1AB Weinstein fixture");
  if (technical.dailyBars.source.provider !== "fixture"
      || technical.dailyBars.metadata.provenance !== "fixture"
      || technical.dailyBars.metadata.authority !== "research_evidence"
      || technical.dailyBars.metadata.fixture !== true) {
    throw new Error("S1AB technical fixture must remain explicitly non-real");
  }
  assertValid(validateResearchValuationScenariosEnvelope(scenarioEnvelope), "S1AB scenario fixture");
  const initialWorkspace = workspaceEnvelope({
    materials: [material],
    packs: [],
    latestPack: null,
    completionState: "pack_required",
    reasons: ["evidence_pack_required"]
  });
  assertValid(validateDeepResearchWorkspaceEnvelope(initialWorkspace), "S1AB initial workspace fixture");
  const frozenWorkspace = workspaceEnvelope({
    materials: [material],
    packs: [pack],
    latestPack: pack,
    completionState: "research_required",
    reasons: ["deep_research_report_required"]
  });
  assertValid(validateDeepResearchWorkspaceEnvelope(frozenWorkspace), "S1AB frozen workspace fixture");
  const initialToday = todayForState(today, "needs_evidence_pack", null);
  const frozenToday = todayForState(today, "needs_research", pack);
  return {
    today: {
      initial: initialToday,
      frozen: frozenToday
    },
    memberships: {
      ...memberships,
      includeArchived: false
    },
    technical,
    weinstein,
    scenarioEnvelope,
    completeness,
    workspace: {
      initial: initialWorkspace,
      frozen: frozenWorkspace
    },
    pack,
    writeEnvelope: (asOf = "2026-07-31T01:00:02.000Z") => ({
      schemaVersion: "2026-06-18.research-write.v1",
      status: "succeeded",
      asOf,
      source: {
        actorType: "user",
        actorId,
        correlationId: "s1ab-ui-freeze-1"
      },
      data: pack,
      message: "S1AB fixture-only freeze write; no production fact was mutated."
    }),
    emptyInbox: emptyActionInbox()
  };
}

function createCompletenessEnvelope() {
  const validUntil = "2026-09-30T00:00:00.000Z";
  const available = new Set(["financials", "kpi", "peers", "valuation", "quant", "weinstein", "risks"]);
  const sourceType = {
    financials: "fundamentals", kpi: "fundamentals", peers: "research_context",
    valuation: "valuation", quant: "quant", weinstein: "weinstein", risks: "risk"
  };
  const sections = RESEARCH_COMPLETENESS_SECTIONS.map((section) => available.has(section) ? {
    section, status: "available", coverage: { achieved: 1, required: 1 },
    sourceBindings: [{
      sourceType: sourceType[section], sourceId: `${section}-fixture`, sourceVersion: "s1a-v1",
      asOf: "2026-07-31T00:30:00.000Z", validUntil
    }], gaps: []
  } : {
    section, status: "unknown", coverage: { achieved: 0, required: 1 },
    sourceBindings: [], gaps: [`${section} remains UNKNOWN in this fixture`]
  });
  const data = buildResearchCompletenessSnapshot({
    id: "71", membershipId, membershipVersion, symbol, actorId, validUntil, createdAt: generatedAt
  }, sections.slice(0, 3), sections.slice(3));
  const envelope = {
    schemaVersion: RESEARCH_COMPLETENESS_SCHEMA_VERSION,
    generatedAt,
    status: "available",
    membershipId,
    requestedActorId: actorId,
    requestedSymbol: symbol,
    latestSnapshotId: data.id,
    data,
    message: "S1A fixture-only completeness snapshot permits explicit Owner report confirmation."
  };
  assertValid(validateResearchCompletenessEnvelope(envelope), "S1A completeness fixture");
  return envelope;
}

export async function createS1acFixtureState() {
  const base = await createS1abFixtureState();
  const payload = synthesizedReportFixturePayload(base.pack);
  const context = base.pack.frozenResearchContext;
  const taskRequest = {
    membershipVersion: base.pack.membershipVersion,
    evidencePackId: base.pack.id,
    idempotencyKey: "s1ac-fixture-task",
    reportContractVersion: payload.reportContractVersion,
    evidencePackBinding: {
      id: base.pack.id,
      version: base.pack.version,
      fingerprint: base.pack.packFingerprint,
      membershipId: base.pack.membershipId,
      membershipVersion: base.pack.membershipVersion,
      symbol: base.pack.symbol,
      frozenAt: base.pack.frozenAt,
      contextVersion: context.bindingVersion,
      valuation: {
        scenarioId: context.valuationScenario.id,
        scenarioRevision: context.valuationScenario.revision,
        assumptions: context.valuationScenario.assumptions,
        calculationVersion: context.valuationScenario.calculation.method.calculationVersion
      },
      technical: {
        snapshotSha: context.technical.dailyBars.snapshot.snapshotSha,
        resultHash: context.technical.technical.resultHash,
        dataCutoffAt: context.technical.dailyBars.source.dataCutoffAt,
        adjustment: context.technical.dailyBars.request.adjustment,
        computationVersion: context.technical.technical.computationVersion
      }
    },
    intent: structuredClone(payload.snapshot.intent)
  };
  assertValid(validateCreateDeepResearchTaskRequest(taskRequest), "S1AC task request");
  const gateFailures = deepResearchGateFailures(
    payload,
    base.pack,
    new Date("2026-07-31T02:00:00.000Z")
  );
  const report = {
    id: "41",
    evidencePackId: base.pack.id,
    version: 1,
    contractVersion: payload.reportContractVersion,
    reportFingerprint: deepResearchReportFingerprint(base.pack.id, payload),
    currentness: {
      status: "current",
      invalidatedBy: [],
      evidencePackInvalidatedBy: []
    },
    status: gateFailures.length === 0 ? "complete_pending_confirmation" : "evidence_insufficient",
    gateFailures,
    payload,
    createdAt: "2026-07-31T01:05:00.000Z"
  };
  assertValid(validateDeepResearchReportData(report), "S1AC synthesized report");
  const finalWorkspace = workspaceEnvelope({
    materials: base.pack.items,
    packs: [base.pack],
    latestPack: base.pack,
    latestReport: report,
    reports: [report],
    completionState: "user_confirmation_required",
    reasons: []
  });
  assertValid(validateDeepResearchWorkspaceEnvelope(finalWorkspace), "S1AC final workspace");
  const finalToday = todayForReportState(base.today.frozen, base.pack, report);
  const state = {
    ...base,
    taskRequest,
    reportRequest: taskRequest,
    report,
    today: {
      initial: base.today.frozen,
      final: finalToday
    },
    workspace: {
      initial: base.workspace.frozen,
      final: finalWorkspace
    },
    taskEnvelope: (taskRequest, status) => {
      assertValid(validateCreateDeepResearchTaskRequest(taskRequest), "S1AC task request");
      if (!["pending", "ready_to_absorb", "succeeded"].includes(status)) {
        throw new Error(`S1AC unsupported task status: ${status}`);
      }
      state.taskRequest = taskRequest;
      const snapshot = payload.snapshotBinding;
      const completed = status !== "pending";
      const synthesis = completed ? {
        snapshotId: snapshot.snapshotId,
        reportContractVersion: payload.reportContractVersion,
        provider: payload.reproducibility.provider,
        model: payload.reproducibility.model,
        promptVersion: payload.reproducibility.prompt,
        tokenUsage: payload.reproducibility.tokenUsage,
        cost: payload.reproducibility.cost,
        sendManifest: {
          purpose: "deep_research_synthesis",
          policyVersion: CLOUD_AI_PROVIDER_POLICY_VERSION,
          provider: payload.reproducibility.provider,
          model: payload.reproducibility.model,
          snapshotId: snapshot.snapshotId,
          membershipId: snapshot.membershipId,
          membershipVersion: snapshot.membershipVersion,
          symbol: snapshot.symbol,
          evidencePackId: snapshot.evidencePackId,
          evidencePackVersion: snapshot.evidencePackVersion,
          evidencePackFingerprint: snapshot.evidencePackFingerprint,
          selectedMaterialIds: taskRequest.intent.selectedMaterialIds,
          includedStructuredSections: taskRequest.intent.includedStructuredSections,
          payloadFields: ["selectedSnapshot", "exactSourceBindings"],
          sourceBindingCount: 1,
          requestBodySha256: "e".repeat(64),
          fullPdfSent: false,
          credentialsSent: false,
          officialAssetFactsSent: false
        }
      } : null;
      const updatedAt = status === "pending"
        ? "2026-07-31T01:05:00.000Z"
        : status === "ready_to_absorb"
          ? "2026-07-31T01:05:05.000Z"
          : "2026-07-31T01:05:06.000Z";
      const envelope = {
        schemaVersion: DEEP_RESEARCH_TASK_SCHEMA_VERSION,
        generatedAt: updatedAt,
        status: "available",
        membershipId,
        requestedActorId: actorId,
        data: {
          id: "91",
          previousTaskId: null,
          membershipId,
          membershipVersion,
          evidencePackId: base.pack.id,
          evidencePackFingerprint: base.pack.packFingerprint,
          intent: taskRequest.intent,
          requestFingerprint: sha256Canonical(taskRequest),
          generationMethod: "deepseek_chat_completions_selected_snapshot",
          modelUsage: synthesis?.tokenUsage ?? "UNKNOWN",
          snapshotBinding: completed ? snapshot : null,
          status,
          attemptCount: completed ? 1 : 0,
          synthesis,
          report: status === "succeeded" ? {
            id: report.id,
            version: report.version,
            evidencePackId: report.evidencePackId,
            reportFingerprint: report.reportFingerprint
          } : null,
          errorCode: null,
          createdAt: "2026-07-31T01:05:00.000Z",
          startedAt: completed ? "2026-07-31T01:05:00.100Z" : null,
          completedAt: completed ? updatedAt : null,
          updatedAt
        },
        message: `S1AC fixture-only task is ${status}.`,
        safety: deepResearchTaskSafety()
      };
      assertValid(
        validateDeepResearchTaskEnvelope(envelope, new Date("2026-07-31T02:00:00.000Z")),
        "S1AC task envelope"
      );
      return envelope;
    }
  };
  return state;
}

export async function createS1adFixtureState() {
  const base = await createS1acFixtureState();
  const decision = {
    id: "61",
    reportId: base.report.id,
    decision: "confirmed",
    note: "你从今日事项中确认了这份报告。",
    actorType: "user",
    actorId,
    decidedAt: "2026-07-31T01:06:00.000Z"
  };
  const afterDecisionWorkspace = workspaceEnvelope({
    materials: base.pack.items,
    packs: [base.pack],
    latestPack: base.pack,
    latestReport: base.report,
    reports: [base.report],
    userDecision: decision,
    decisions: [decision],
    completionState: "confirmed",
    reasons: []
  });
  assertValid(validateDeepResearchWorkspaceEnvelope(afterDecisionWorkspace), "S1AD decided workspace");
  const confirmedToday = todayForConfirmedReportState(base.today.final, base.pack, base.report, decision);
  const formalDecisionDue = formalDecisionDueInbox(base.pack, base.report, decision);
  assertValid(validateTodayActionInboxEnvelope(base.emptyInbox), "S1AD initial action inbox");
  assertValid(validateTodayActionInboxEnvelope(formalDecisionDue), "S1AD final action inbox");
  return {
    ...base,
    today: {
      initial: base.today.final,
      final: confirmedToday
    },
    workspace: {
      initial: base.workspace.final,
      final: afterDecisionWorkspace
    },
    decision,
    decisionWriteEnvelope: (asOf = "2026-07-31T01:06:01.000Z") => ({
      schemaVersion: "2026-06-18.research-write.v1",
      status: "succeeded",
      asOf,
      source: {
        actorType: "user",
        actorId,
        correlationId: "s1ad-ui-report-confirm-1"
      },
      data: decision,
      message: "S1AD fixture-only report decision; no formal portfolio decision or trade was created."
    }),
    inbox: {
      initial: base.emptyInbox,
      final: formalDecisionDue
    }
  };
}

function createMaterial() {
  return {
    id: materialId,
    evidenceId: "17",
    market,
    code,
    symbol,
    materialKind: "text",
    title: "Owner-provided issuer disclosure page",
    contentText: "Fixture-only issuer disclosure used to prove the evidence freeze handoff.",
    sourceType: "owner_provided_pdf",
    sourceUrl: null,
    publishedAt: "2026-07-24T08:00:00.000Z",
    capturedAt: "2026-07-24T08:05:00.000Z",
    contentFingerprint: researchMaterialFingerprint(
      "Fixture-only issuer disclosure used to prove the evidence freeze handoff."
    ),
    claimType: "issuer_statement",
    verificationStatus: "verified",
    rightsStatus: "user_provided",
    sourceVersion: "2026-07-v2",
    replacesMaterialId: null,
    revision: materialRevision,
    revisionState: "current",
    validUntil: "2026-08-24T08:00:00.000Z",
    freshness: "fresh",
    summary: "Fixture-only issuer statement for the current material revision.",
    variableName: "revenue_growth",
    stance: "support",
    reliability: null,
    materiality: null,
    isRead: true,
    citation: {
      documentId: "8",
      pageNumber: 5,
      pageTextSha256: "b".repeat(64)
    }
  };
}

function createScenario() {
  const assumptions = {
    metricCurrency: "HKD",
    baseMetricPerShare: 12.5,
    annualGrowthRate: 0.1,
    horizonYears: 3,
    terminalMultiple: 18,
    annualDiscountRate: 0.12,
    netCashPerShare: 2,
    growthRateStep: 0.03,
    multipleStep: 2
  };
  const grid = calculateAnnualValuationScenarioGrid(assumptions);
  if (!grid) throw new Error("S1AB scenario grid could not be calculated");
  const calculation = {
    method: {
      id: "discounted_forward_metric_multiple_user_scenario",
      calculationVersion: ANNUAL_VALUATION_CALCULATION_VERSION,
      presentValueFormula: ANNUAL_VALUATION_PRESENT_VALUE_FORMULA,
      rounding: "decimal_places_6"
    },
    projectedMetricPerShare: grid.projectedMetricPerShare,
    scenarioPresentValuePerShare: grid.scenarioPresentValuePerShare,
    diagonal: [
      { scenario: "bear", ...grid.cells[0] },
      { scenario: "base", ...grid.cells[4] },
      { scenario: "bull", ...grid.cells[8] }
    ],
    matrix: {
      growthRates: grid.growthRates,
      terminalMultiples: grid.terminalMultiples,
      cells: grid.cells
    }
  };
  return {
    id: scenarioId,
    membershipId,
    membershipVersionAtWrite: membershipVersion,
    symbol,
    revision: scenarioRevision,
    replacesScenarioSetId: null,
    scenarioState: "current",
    recomputable: true,
    invalidatedBy: [],
    anchorOriginalAvailability: "available",
    anchor: {
      id: "41",
      membershipId,
      membershipVersionAtWrite: membershipVersion,
      symbol,
      metric: "revenue",
      periodKind: "duration",
      periodStart: "2025-01-01",
      periodEnd: "2025-12-31",
      currency: "HKD",
      unitScale: 1_000_000,
      scope: "consolidated",
      valueStatus: "reported",
      value: "120",
      comparability: "comparable",
      comparabilityReason: null,
      amendmentKind: "initial",
      replacesValueId: null,
      revision: 1,
      valueState: "current",
      provenance: {
        factKind: "issuer_reported",
        transcription: "owner_manual",
        verificationStatus: "unverified"
      },
      source: {
        materialId,
        materialRevision,
        materialRevisionState: "current",
        validUntil: "2026-08-24T08:00:00.000Z",
        freshness: "fresh",
        materialSourceVersion: "2026-07-v2",
        documentId: "8",
        documentPdfSha256: "c".repeat(64),
        pageNumber: 5,
        pageTextSha256: "b".repeat(64)
      },
      createdAt: "2026-07-31T00:55:00.000Z",
      anchorRole: "cited_context_only_not_calculation_input"
    },
    assumptions: {
      authority: "owner",
      derivation: "manual_not_derived_from_citation",
      values: assumptions
    },
    calculation,
    safety: {
      advisoryOnly: true,
      forecast: false,
      recommendation: false,
      automaticSignal: false,
      createsOrder: false,
      callsBroker: false,
      mutatesOfficialPortfolio: false
    },
    createdAt: "2026-07-31T00:56:00.000Z"
  };
}

function createAdjustedScenario(base) {
  const assumptions = {
    methodId: "adjusted_net_asset_value_user_scenario",
    metricCurrency: "HKD",
    baseMetricPerShare: 10,
    annualGrowthRate: 0.05,
    horizonYears: 3,
    terminalMultiple: 0.9,
    annualDiscountRate: 0.1,
    netCashPerShare: 1,
    growthRateStep: 0.02,
    multipleStep: 0.1
  };
  const grid = calculateAnnualValuationScenarioGrid(assumptions);
  if (!grid) throw new Error("S1AB adjusted scenario grid could not be calculated");
  return {
    ...structuredClone(base),
    id: "52",
    anchor: {
      ...structuredClone(base.anchor),
      id: "42",
      metric: "total_assets",
      periodKind: "instant",
      periodStart: null
    },
    pairedAnchor: {
      ...structuredClone(base.anchor),
      id: "43",
      metric: "total_liabilities",
      periodKind: "instant",
      periodStart: null,
      value: "40"
    },
    assumptions: { authority: "owner", derivation: "manual_not_derived_from_citation", values: assumptions },
    calculation: {
      method: {
        id: assumptions.methodId,
        calculationVersion: ANNUAL_ADJUSTED_NET_ASSET_CALCULATION_VERSION,
        presentValueFormula: ANNUAL_ADJUSTED_NET_ASSET_VALUE_FORMULA,
        rounding: "decimal_places_6",
        applicability: {
          ownerConfirmed: true,
          companyDataBasis: "reported_balance_sheet_net_assets_per_share",
          requiredAnchorMetrics: ["total_assets", "total_liabilities"],
          pairedAnchorValueId: "43",
          limitation: "Fixture-only adjusted net asset value method."
        }
      },
      projectedMetricPerShare: grid.projectedMetricPerShare,
      scenarioPresentValuePerShare: grid.scenarioPresentValuePerShare,
      diagonal: [0, 4, 8].map((index, offset) => ({
        scenario: ["bear", "base", "bull"][offset],
        ...grid.cells[index]
      })),
      matrix: { growthRates: grid.growthRates, terminalMultiples: grid.terminalMultiples, cells: grid.cells }
    },
    createdAt: "2026-07-31T00:57:00.000Z"
  };
}

async function createTechnicalEnvelope() {
  const lastCompletedSession = previousCalendarDate(cutoff);
  const bars = Array.from({ length: 120 }, (_, index) => {
    const session = new Date(
      Date.parse(`${lastCompletedSession}T00:00:00.000Z`) - (119 - index) * 86_400_000
    ).toISOString().slice(0, 10);
    const close = 80 + index * 0.15 + Math.sin(index / 5);
    const volume = 10_000 + index * 10;
    return {
      session,
      open: close - 0.2,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume,
      turnover: volume * close,
      suspension: false
    };
  });
  const expectedSessions = bars.map((bar) => bar.session);
  const pageContentHashes = [sha256Canonical({ fixtureOnly: true, bars })];
  const providerResult = {
    status: "available",
    provider: "fixture",
    endpoint: "fixture_only_s1ab_today_freeze",
    fetchedAt: new Date("2026-07-30T08:30:00.000Z"),
    providerCutoff: cutoff,
    dataCutoffAt: `${lastCompletedSession}T16:10:00+08:00`,
    lastCompletedSession,
    calendar: {
      id: "HKEX",
      version: hkexCompletedSessionEvidenceVersion(cutoff, expectedSessions),
      timezone: "Asia/Hong_Kong"
    },
    expectedSessions,
    rights: "confirmed",
    retention: "confirmed",
    derivedUse: "confirmed",
    hashMethod: DAILY_CONTENT_HASH_METHOD,
    rawBytesCaptured: false,
    pageContentHashes,
    sourceContentHash: dailySourceContentHash(DAILY_CONTENT_HASH_METHOD, pageContentHashes),
    bars,
    gaps: [],
    message: "Fixture-only deterministic technical evidence; not real runtime evidence."
  };
  const evidence = {
    source: "independent_hkex_calendar",
    fixture: false,
    calendar: providerResult.calendar,
    cutoff,
    lastCompletedSession,
    marketCloseAt: `${lastCompletedSession}T16:10:00+08:00`,
    evaluatedAt: `${lastCompletedSession}T16:30:00+08:00`,
    completedThroughCutoff: true,
    completedSessions: expectedSessions
  };
  const envelope = await getDailyTechnicalEnvelope(
    { name: "fixture", async getDailyBars() { return providerResult; } },
    market,
    code,
    cutoff,
    evidence
  );
  const fetchedAt = envelope.dailyBars.source.fetchedAt.replace(".000Z", "Z");
  const source = { ...envelope.dailyBars.source, fetchedAt };
  const metadata = envelope.dailyBars.metadata
    ? { ...envelope.dailyBars.metadata, fetchedAt }
    : envelope.dailyBars.metadata;
  const snapshot = envelope.dailyBars.snapshot;
  if (!snapshot) return envelope;
  const { snapshotSha: _snapshotSha, ...snapshotWithoutSha } = snapshot;
  const snapshotSha = dailyBarsSnapshotHash(
    envelope.dailyBars.request,
    source,
    snapshotWithoutSha
  );
  const dailyBars = {
    ...envelope.dailyBars,
    source,
    metadata,
    snapshot: { ...snapshotWithoutSha, snapshotSha }
  };
  return {
    ...envelope,
    dailyBars,
    technical: calculateTechnicalAnalysis(dailyBars)
  };
}

function createWeinsteinFixture() {
  return calculateWeinsteinTechnicalAnalysis({
    provider: "futu_opend",
    endpoint: "weinstein-weekly",
    rights: "confirmed",
    retention: "confirmed",
    derivedUse: "confirmed",
    fetchedAt: "2026-07-30T01:00:00.000Z",
    analysisAsOf: cutoff,
    sectorIdentityAsOf: cutoff,
    stock: weeklySeries(symbol, "吉利汽车", 10, 0.012, 2_000_000, "forward_qfq_research_only"),
    marketBenchmark: weeklySeries("HK.800000", "恒生指数", 30_000, -0.002, 10_000_000, "none_index_or_sector"),
    sectorBenchmark: weeklySeries("HK.LIST123", "汽车行业", 1_000, 0.006, 5_000_000, "none_index_or_sector")
  });
}

function weeklySeries(seriesSymbol, name, initial, growth, volume, adjustment) {
  const end = Date.parse("2026-07-24T00:00:00.000Z");
  const bars = Array.from({ length: 60 }, (_, index) => {
    const trendWeeks = Math.max(0, index - 39);
    const close = initial * (1 + growth) ** trendWeeks * (1 + Math.sin(index * 2 * Math.PI / 3) * 0.01);
    return {
      session: new Date(end - (59 - index) * 7 * 86_400_000).toISOString().slice(0, 10),
      open: close * 0.99,
      high: close * 1.02,
      low: close * 0.98,
      close,
      volume: volume * (index === 59 ? 2 : 1)
    };
  });
  return { symbol: seriesSymbol, name, adjustment, bars };
}

function createContext(valuationMethods, technical, weinstein) {
  const frozenWeinstein = frozenWeinsteinEvidenceBinding(weinstein);
  if (!frozenWeinstein) throw new Error("S1AB Weinstein fixture could not be frozen");
  return {
    bindingVersion: "2026-07-30.s1d-frozen-technical-evidence.v1",
    actor: { actorType: "user", actorId },
    membership: { id: membershipId, version: membershipVersion, state: "tracked", symbol },
    researchContext: {
      id: "61",
      membershipId,
      membershipVersion,
      selectedSymbol: symbol,
      cutoffAt: generatedAt,
      validUntil: "2027-01-31T01:00:00.000Z",
      contentHash: "6".repeat(64)
    },
    valuationScenario: valuationMethods.at(-1),
    valuationMethods,
    technical,
    weinstein: frozenWeinstein,
    unboundSources: Object.fromEntries([
      "macro", "industry", "event", "risk", "counterevidence"
    ].map((key) => [key, { status: "source_missing", value: "UNKNOWN" }]))
  };
}

function createPack(material, context) {
  const pack = {
    id: packId,
    membershipId,
    membershipVersion,
    market,
    code,
    symbol,
    version: packVersion,
    frozenAt: "2026-07-31T01:00:02.000Z",
    items: [material],
    frozenResearchContext: context,
    currentness: { status: "current", invalidatedBy: [] }
  };
  return {
    ...pack,
    packFingerprint: evidencePackFingerprint(membershipId, membershipVersion, pack.items, context)
  };
}

function workspaceEnvelope({
  materials,
  packs,
  latestPack,
  latestReport = null,
  reports = [],
  userDecision = null,
  decisions = [],
  completionState,
  reasons
}) {
  return {
    schemaVersion: "2026-07-30.deep-research-beta.v5",
    generatedAt,
    status: "available",
    membershipId,
    requestedActorId: actorId,
    requestedSymbol: symbol,
    metadata: {
      source: "deep_research",
      asOf: generatedAt,
      fetchedAt: generatedAt,
      freshness: "fresh",
      provenance: "research_only",
      authority: "research_evidence",
      stale: false,
      missing: false,
      conflict: false,
      fixture: true,
      correctionOf: null,
      replaces: null,
      message: "S1AB fixture-only workspace; not real runtime evidence."
    },
    data: {
      target: {
        membershipId,
        membershipVersion,
        membershipState: "tracked",
        market,
        code,
        symbol
      },
      materials,
      events: [],
      latestGeelySalesMonitor: null,
      latestGclPvPriceMonitor: null,
      latestPack,
      evidencePacks: packs,
      latestReport,
      reports,
      userDecision,
      decisions,
      classification: {
        verifiedFactMaterialIds: [],
        issuerStatementMaterialIds: [materialId],
        thirdPartyStatementMaterialIds: [],
        modelInferenceMaterialIds: [],
        userDecisionId: userDecision?.id ?? null
      },
      completion: {
        state: completionState,
        deepResearchComplete: completionState === "confirmed",
        reasons
      }
    },
    message: latestPack
      ? "S1AB fixture fresh GET returned the immutable current evidence pack."
      : "S1AB fixture fresh GET returned pack_required without inventing a pack."
  };
}

function todayForState(base, state, pack) {
  const today = structuredClone(base);
  today.requestedActorId = actorId;
  today.generatedAt = pack ? "2026-07-31T01:00:03.000Z" : generatedAt;
  today.message = pack
    ? "1 bounded Today item for HK.09926; evidence frozen, research report is next."
    : "1 bounded Today item for HK.09926; evidence freeze is required.";
  const item = today.items[0];
  const material = pack?.items[0] ?? createMaterial();
  if (item.bindings.factRefs[0]) {
    item.bindings.factRefs[0] = {
      ...item.bindings.factRefs[0],
      sourceType: material.sourceType,
      sourceVersion: material.sourceVersion,
      revision: material.revision,
      contentFingerprint: material.contentFingerprint,
      publishedAt: material.publishedAt,
      capturedAt: material.capturedAt,
      validUntil: material.validUntil,
      verificationStatus: material.verificationStatus,
      rightsStatus: material.rightsStatus
    };
  }
  item.id = `action:${membershipId}:v${membershipVersion}:${state}`;
  item.trackingState = state;
  item.title = pack ? "Create the evidence-bound research report" : "Freeze the current evidence version";
  item.summary = pack
    ? "The current evidence pack is fresh; create the deterministic two-layer research report."
    : "Research materials changed after the latest frozen evidence pack.";
  item.nextCheckpoint = pack ? "Edit and explicitly save the two-layer report draft." : "Freeze the current verified material revision.";
  item.versionChange = pack ? "Evidence pack #31 v1 is current; research is the next explicit operation." : "Issuer source changed from 2026-07-v1 to 2026-07-v2.";
  item.bindings.evidencePackRef = pack
    ? { id: pack.id, version: pack.version, packFingerprint: pack.packFingerprint }
    : null;
  today.quality.sourceHealth.status = pack ? "healthy" : "revision_mismatch";
  today.quality.sourceHealth.issueCodes = pack ? [] : ["unfrozen_revision"];
  today.quality.sourceHealth.evidencePackRef = pack
    ? { id: pack.id, version: pack.version, packFingerprint: pack.packFingerprint }
    : null;
  return today;
}

function todayForReportState(base, pack, report) {
  const today = structuredClone(base);
  today.generatedAt = "2026-07-31T01:05:03.000Z";
  today.message = "1 bounded Today item for HK.09926; report is complete and awaits Owner confirmation.";
  const item = today.items[0];
  item.id = `action:${membershipId}:v${membershipVersion}:awaiting_user_confirmation`;
  item.trackingState = "awaiting_user_confirmation";
  item.title = "Confirm or reject the deep-research version";
  item.summary = "The evidence-bound report is complete and awaits an explicit Owner confirmation or rejection.";
  item.nextCheckpoint = "Review the exact report and explicitly confirm or reject it.";
  item.versionChange = `Report #${report.id} v${report.version} is current and bound to evidence pack #${pack.id} v${pack.version}.`;
  item.bindings.evidencePackRef = {
    id: pack.id,
    version: pack.version,
    packFingerprint: pack.packFingerprint
  };
  item.bindings.reportRef = {
    id: report.id,
    version: report.version,
    evidencePackId: report.evidencePackId,
    status: report.status
  };
  item.reportRevision = {
    current: {
      id: report.id,
      version: report.version,
      evidencePackId: report.evidencePackId,
      reportFingerprint: report.reportFingerprint
    },
    previous: null,
    declaredChange: "Owner saved the first evidence-bound report version.",
    changedSections: ["结论"],
    unchangedSections: [],
    bindingChanged: null
  };
  today.quality.sourceHealth.status = "healthy";
  today.quality.sourceHealth.issueCodes = [];
  today.quality.sourceHealth.evidencePackRef = item.bindings.evidencePackRef;
  today.quality.researchStructure.status = "passed";
  today.quality.researchStructure.checks = today.quality.researchStructure.checks.map((check) => ({
    ...check,
    passed: true
  }));
  today.quality.researchStructure.gateFailures = [];
  today.quality.researchStructure.reportRef = item.bindings.reportRef;
  return today;
}

function todayForConfirmedReportState(base, pack, report, decision) {
  const today = structuredClone(base);
  today.generatedAt = "2026-07-31T01:06:02.000Z";
  today.message = "1 bounded Today item for HK.09926; Owner confirmed the report and formal decision is still due.";
  const item = today.items[0];
  item.id = `report:${report.id}:v${report.version}`;
  item.category = "research_change";
  item.trackingState = "confirmed";
  item.title = "Formal decision due for the confirmed research report";
  item.summary = "The Owner confirmed the evidence-bound report; formal decision remains a separate explicit step.";
  item.nextCheckpoint = "Review the exact report and decide separately whether a formal decision is due.";
  item.versionChange = `Report #${report.id} v${report.version} was confirmed without auto-adoption.`;
  item.bindings.decisionRef = {
    id: decision.id,
    reportId: decision.reportId,
    decision: decision.decision,
    decidedAt: decision.decidedAt
  };
  item.bindings.reportRef = {
    id: report.id,
    version: report.version,
    evidencePackId: report.evidencePackId,
    status: report.status
  };
  item.bindings.evidencePackRef = {
    id: pack.id,
    version: pack.version,
    packFingerprint: pack.packFingerprint
  };
  item.reportRevision = {
    current: {
      id: report.id,
      version: report.version,
      evidencePackId: report.evidencePackId,
      reportFingerprint: report.reportFingerprint
    },
    previous: null,
    declaredChange: "Owner confirmed the report; no automatic formal decision was created.",
    changedSections: ["Owner decision"],
    unchangedSections: [],
    bindingChanged: false
  };
  today.quality.sourceHealth.status = "healthy";
  today.quality.sourceHealth.issueCodes = [];
  today.quality.sourceHealth.evidencePackRef = item.bindings.evidencePackRef;
  today.quality.researchStructure.status = "passed";
  today.quality.researchStructure.checks = today.quality.researchStructure.checks.map((check) => ({
    ...check,
    passed: true
  }));
  today.quality.researchStructure.gateFailures = [];
  today.quality.researchStructure.reportRef = item.bindings.reportRef;
  return today;
}

function formalDecisionDueInbox(pack, report, decision) {
  const decidedAt = decision.decidedAt;
  const eventId = `FORMAL_DECISION_DUE|${symbol}|${decision.id}|${decidedAt}`;
  const binding = {
    bindingVersion: "2026-07-30.s1f-report-formal-decision-binding.v1",
    membershipId,
    membershipVersion,
    symbol,
    evidencePackId: pack.id,
    evidencePackFingerprint: pack.packFingerprint,
    reportId: report.id,
    reportVersion: report.version,
    contractVersion: report.contractVersion,
    reportFingerprint: report.reportFingerprint,
    reportDecisionId: decision.id,
    reportDecision: decision.decision,
    reportDecisionActorType: decision.actorType,
    reportDecisionActorId: decision.actorId,
    decidedAt
  };
  const event = {
    id: eventId,
    type: "FORMAL_DECISION_DUE",
    subject: symbol,
    sourceEventId: decision.id,
    effectiveAt: decidedAt,
    priority: { severity: "attention", dueAt: decidedAt },
    state: "new",
    stateChangedAt: decidedAt,
    stateActor: { actorType: "user", actorId },
    stateReason: "confirmed_report_not_adopted",
    reportBinding: binding
  };
  return {
    schemaVersion: TODAY_ACTION_INBOX_SCHEMA_VERSION,
    generatedAt: "2026-07-31T01:06:03.000Z",
    status: "available",
    requestedActorId: actorId,
    metadata: {
      source: "today_action_inbox",
      asOf: decidedAt,
      fetchedAt: "2026-07-31T01:06:03.000Z",
      freshness: "fresh",
      provenance: "fixture",
      authority: "research_evidence",
      stale: false,
      missing: false,
      conflict: false,
      fixture: true,
      correctionOf: null,
      replaces: null,
      message: "Fixture-only formal-decision-due projection; no formal decision was auto-submitted."
    },
    trackedMembershipCount: 1,
    omittedMembershipCount: 0,
    items: [{
      id: `inbox:event:review_due:${membershipId}:${eventId}`,
      order: 1,
      kind: "formal_decision_due",
      priority: "action",
      state: "new",
      symbol,
      membership: { id: membershipId, version: membershipVersion, symbol },
      source: {
        lane: "review_due",
        id: eventId,
        version: Number(decision.id),
        status: "available",
        sourceType: "today_review_due_projection",
        effectiveAt: decidedAt,
        asOf: decidedAt,
        fetchedAt: "2026-07-31T01:06:03.000Z",
        validUntil: null,
        freshness: "fresh",
        sourceFingerprint: report.reportFingerprint
      },
      title: "Formal decision due",
      summary: "Owner confirmed the report; review a separate formal decision explicitly. No order or trade was created.",
      researchTarget: null,
      reviewEvent: event
    }],
    omittedItemCount: 0,
    message: "One exact formal decision due event is available; no formal decision was auto-submitted.",
    safety: {
      advisoryOnly: true,
      createsOrder: false,
      createsTrade: false,
      mutatesCash: false,
      writesFee: false,
      mutatesPosition: false,
      callsBroker: false,
      productionWrite: false
    }
  };
}

function emptyActionInbox() {
  return {
    schemaVersion: TODAY_ACTION_INBOX_SCHEMA_VERSION,
    generatedAt,
    status: "empty",
    requestedActorId: actorId,
    metadata: {
      source: "today_action_inbox",
      asOf: null,
      fetchedAt: generatedAt,
      freshness: "missing",
      provenance: "fixture",
      authority: "research_evidence",
      stale: false,
      missing: true,
      conflict: false,
      fixture: true,
      correctionOf: null,
      replaces: null,
      message: "No separate inbox event is needed for this focused Today research-feed journey."
    },
    trackedMembershipCount: 0,
    omittedMembershipCount: 0,
    items: [],
    omittedItemCount: 0,
    message: "当前没有额外的跨标的行动收件箱事项。",
    safety: {
      advisoryOnly: true,
      createsOrder: false,
      createsTrade: false,
      mutatesCash: false,
      writesFee: false,
      mutatesPosition: false,
      callsBroker: false,
      productionWrite: false
    }
  };
}

function previousCalendarDate(value) {
  return new Date(Date.parse(`${value}T00:00:00.000Z`) - 86_400_000)
    .toISOString().slice(0, 10);
}

function assertValid(result, label) {
  if (!result.ok) throw new Error(`${label} invalid: ${result.errors.join("; ")}`);
}
