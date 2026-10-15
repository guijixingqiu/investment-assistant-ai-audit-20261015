import {
  type FreezeEvidencePackRequest
} from "../../../packages/contracts/src/deepResearch.js";
import {
  validateDecisionContextEnvelope,
  type DecisionContextEnvelope
} from "../../../packages/contracts/src/decisionContextBrowser.js";
import {
  type DailyTechnicalEnvelope,
  validateDailyTechnicalEnvelope
} from "../../../packages/contracts/src/marketDaily.js";
import {
  type ResearchValuationScenariosEnvelope,
  validateResearchValuationScenariosEnvelope
} from "../../../packages/contracts/src/researchValuationScenarios.js";
import {
  frozenWeinsteinEvidenceBinding,
  type WeinsteinTechnicalAnalysisEnvelope,
  validateWeinsteinTechnicalAnalysisEnvelope
} from "../../../packages/contracts/src/weinsteinTechnicalAnalysis.js";
import type { WebApiAuth } from "./apiClient.js";
import { loadAnnualPortfolioLab } from "./annualPortfolioLabApiClient.js";
import type { DeepResearchConsoleSource } from "./deepResearchConsole.js";

export type WebFreezeBinding = Omit<FreezeEvidencePackRequest, "idempotencyKey">;

export async function readWebFreezeBinding(
  source: DeepResearchConsoleSource,
  auth: WebApiAuth,
  fetcher: typeof fetch = fetch
): Promise<WebFreezeBinding> {
  const root = `/api/mobile/research/candidate-memberships/${encodeURIComponent(source.membershipId)}`;
  const [valuationValue, dailyValue, decisionValue, portfolioResult] = await Promise.all([
    readJson(`${root}/valuation-scenarios`, auth, fetcher),
    readJson(`/api/mobile/market/daily-bars/HK/${source.code}`, auth, fetcher),
    readJson(`/api/mobile/research/decision-context/HK/${source.code}`, auth, fetcher),
    loadAnnualPortfolioLab(auth, source.membershipId, source.membershipVersion, source.symbol, [0], fetcher)
  ]);
  const valuationValidation = validateResearchValuationScenariosEnvelope(valuationValue);
  const dailyValidation = validateDailyTechnicalEnvelope(dailyValue);
  const decisionValidation = validateDecisionContextEnvelope(decisionValue);
  if (!valuationValidation.ok) throw new Error(`Valuation scenarios are malformed: ${valuationValidation.errors.join("; ")}`);
  if (!dailyValidation.ok) throw new Error(`Daily technical evidence is malformed: ${dailyValidation.errors.join("; ")}`);
  if (!decisionValidation.ok) throw new Error(`Decision quant evidence is malformed: ${decisionValidation.errors.join("; ")}`);
  const valuations = valuationValue as ResearchValuationScenariosEnvelope;
  const daily = dailyValue as DailyTechnicalEnvelope;
  const decision = decisionValue as DecisionContextEnvelope;
  if (valuations.requestedActorId !== source.actorId || valuations.membershipId !== source.membershipId
    || valuations.membershipVersion !== source.membershipVersion || valuations.membershipState === "archived"
    || valuations.symbol !== source.symbol || daily.completeness !== "complete" || !daily.usableForRequestedCutoff
    || daily.dailyBars.request.symbol !== source.symbol || !daily.dailyBars.snapshot?.snapshotSha
    || !daily.technical.resultHash) {
    throw new Error("Current valuation or daily technical evidence no longer binds the exact membership.");
  }
  const refinement = decision.quantEvidence.decisionEvidence;
  const decisionUniverse = decision.quantEvidence.identities?.hkConnectUniverse;
  const portfolioEvidence = portfolioResult.ok ? portfolioResult.value.data?.quant.evidence : null;
  const portfolioUniverse = portfolioEvidence?.source.hkConnectUniverse;
  if (decision.requestedSymbol !== source.symbol || decision.quantEvidence.status !== "available"
    || refinement?.status !== "available" || !refinement.refinementId || !decisionUniverse
    || !portfolioResult.ok || !portfolioEvidence || !portfolioUniverse) {
    throw new Error("Current exact quant and portfolio risk evidence is unavailable; refresh it before freezing.");
  }
  const methods = currentValuationMethods(valuations);
  if (methods.length !== 2) throw new Error("Both current recomputable Owner valuation methods are required before freezing.");
  const analysisAsOf = currentHongKongDate();
  const weinsteinValue = await readJson(
    `/api/mobile/market/weinstein/HK/${source.code}?analysisAsOf=${encodeURIComponent(analysisAsOf)}`,
    auth,
    fetcher
  );
  const weinsteinValidation = validateWeinsteinTechnicalAnalysisEnvelope(
    weinsteinValue,
    { symbol: source.symbol, analysisAsOf }
  );
  const weinstein = weinsteinValidation.ok
    ? frozenWeinsteinEvidenceBinding(weinsteinValue as WeinsteinTechnicalAnalysisEnvelope)
    : null;
  if (!weinstein) {
    throw new Error(`Current exact Weinstein evidence is unavailable${weinsteinValidation.ok ? "" : `: ${weinsteinValidation.errors.join("; ")}`}.`);
  }
  return {
    membershipVersion: source.membershipVersion,
    expectedScenarioId: methods[0].id,
    expectedScenarioRevision: methods[0].revision,
    expectedValuationMethods: methods.map((scenario) => ({
      scenarioId: scenario.id,
      scenarioRevision: scenario.revision,
      methodId: scenario.calculation.method.id
    })),
    expectedTechnicalSnapshotSha: daily.dailyBars.snapshot.snapshotSha,
    expectedTechnicalResultHash: daily.technical.resultHash,
    expectedWeinstein: weinstein,
    expectedQuantPortfolio: {
      decisionRefinementId: refinement.refinementId,
      decisionUniverseSnapshotId: decisionUniverse.snapshotId,
      portfolioEvidenceId: portfolioEvidence.evidenceId,
      portfolioUniverseSnapshotId: portfolioUniverse.snapshotId
    }
  };
}

function currentHongKongDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function currentValuationMethods(envelope: ResearchValuationScenariosEnvelope) {
  const current = envelope.scenarioSets
    .filter((scenario) => scenario.scenarioState === "current" && scenario.recomputable && scenario.invalidatedBy.length === 0)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || Number(right.id) - Number(left.id));
  return [...new Map(current.map((scenario) => [scenario.calculation.method.id, scenario])).values()];
}

async function readJson(path: string, auth: WebApiAuth, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(path, { cache: "no-store", headers: { [auth.headerName]: auth.token } });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Fresh read failed (${response.status}).`);
  return value;
}
