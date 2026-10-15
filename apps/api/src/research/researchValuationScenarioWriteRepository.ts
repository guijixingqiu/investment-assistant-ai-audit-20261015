import type { Pool } from "pg";
import {
  ANNUAL_ADJUSTED_NET_ASSET_CALCULATION_VERSION,
  ANNUAL_ADJUSTED_NET_ASSET_VALUE_FORMULA,
  ANNUAL_VALUATION_CALCULATION_VERSION,
  ANNUAL_VALUATION_PRESENT_VALUE_FORMULA,
  calculateAnnualValuationScenarioGrid,
  annualValuationMethodId,
  type AnnualValuationScenarioInput,
  type CreateResearchValuationScenarioRequest,
  type ResearchValuationCalculation,
  type ResearchValuationScenarioSetData
} from "../../../../packages/contracts/src/index.js";
import type { ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import { normalizeMarketCode } from "../market/freshness.js";
import {
  IdempotencyConflictError,
  ResearchValuationScenarioError,
  type AuthenticatedResearchActor
} from "./domain.js";
import { requestFingerprint } from "./deepResearchGate.js";
import { issuerBasisMatchesPreview, readIssuerNavBasisPreview } from "./researchValuationIssuerBasis.js";
import { validResearchValuationIssuerBasisBinding } from "../../../../packages/contracts/src/researchValuationIssuerBasis.js";
import {
  assertCurrentValuationAnchor,
  findResearchValuationScenarioById,
  issuerBasisAvailableForScenario,
  rowToResearchValuationScenario,
  scenarioAnchorOriginalAvailabilities,
  type ResearchValuationScenarioRow
} from "./researchValuationScenarioRepository.js";
import { assertCandidateMembershipWriteBinding, sameBoundResearchWriteReplay } from "./researchWriteBinding.js";
import { type SourceSnapshotStoreOptions } from "./researchSourceSnapshotRepository.js";
import {
  actorRequest,
  findAuditByIdempotencyKey,
  insertWriteAudit,
  isUniqueViolation,
  upsertStock,
  writeEnvelope
} from "./writePersistence.js";

export async function createResearchValuationScenario(
  pool: Pool,
  membershipId: string,
  request: CreateResearchValuationScenarioRequest,
  actor: AuthenticatedResearchActor,
  now = new Date(),
  sourceStore?:SourceSnapshotStoreOptions
): Promise<ResearchWriteEnvelope<ResearchValuationScenarioSetData>> {
  const fingerprint = requestFingerprint("research_valuation_scenario_create", {
    actor,
    membershipId,
    request
  });
  const auditRequest = actorRequest(actor, request.idempotencyKey);
  const client = await pool.connect();
  try {
    await client.query("begin");
    let replay = await findAuditByIdempotencyKey<ResearchValuationScenarioSetData>(
      client,
      request.idempotencyKey,
      "research_valuation_scenario_created"
    );
    if (replay) {
      if (!sameBoundResearchWriteReplay(replay, actor, { ...request, membershipId }, fingerprint)) throw idempotencyConflict();
      await client.query("commit");
      return replay.envelope;
    }
    const membership = await assertCandidateMembershipWriteBinding(
      client,
      actor,
      { membershipId, membershipVersion: request.membershipVersion }
    );
    const normalized = normalizeMarketCode(membership.market, membership.code);
    if (request.symbol !== normalized.symbol || membership.symbol !== normalized.symbol) {
      throw new ResearchValuationScenarioError(409, "SYMBOL_CONFLICT", "request symbol does not match the current candidate membership");
    }
    replay = await findAuditByIdempotencyKey<ResearchValuationScenarioSetData>(
      client,
      request.idempotencyKey,
      "research_valuation_scenario_created"
    );
    if (replay) {
      if (!sameBoundResearchWriteReplay(replay, actor, { ...request, membershipId }, fingerprint)) throw idempotencyConflict();
      await client.query("commit");
      return replay.envelope;
    }
    const anchor = await assertCurrentValuationAnchor(
      client, membershipId, request.anchorValueId, actor, request.membershipVersion,
      request.symbol, annualValuationMethodId(request.assumptions), now, sourceStore
    );
    assertValuationAssumptionsMatchAnchor(request.assumptions, anchor);
    if (request.issuerBasis) {
      const basis = request.issuerBasis;
      const preview = await readIssuerNavBasisPreview(client, membershipId, request.anchorValueId, actor, now, sourceStore);
      if (!validResearchValuationIssuerBasisBinding(basis)
        || request.assumptions.methodId !== "adjusted_net_asset_value_user_scenario"
        || request.assumptions.shareBasis !== "basic" || request.assumptions.netCashPerShare !== 0
        || !issuerBasisMatchesPreview(basis, preview)
        || basis.adoptionMode === "source_value"
          && request.assumptions.baseMetricPerShare !== preview.proposedBaseMetricPerShare) {
        throw new ResearchValuationScenarioError(409, "ISSUER_BASIS_DRIFT",
          "issuer NAV source draft changed or lacks an exact confirmed ordinary equity basis");
      }
    }
    const calculation = {
      ...valuationCalculation(request.assumptions, anchor.navPairedAnchor?.id),
      ...(request.issuerBasis ? { issuerBasis: request.issuerBasis } : {})
    };
    const revision = await replacementRevision(client, membershipId, request, actor);
    const inserted = await client.query<{ id: string }>(
      `insert into research_valuation_scenario_sets
        (candidate_membership_id, captured_membership_version, anchor_value_id,
         replaces_scenario_set_id, revision, assumption_payload, calculation_version,
         calculation_payload, created_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9)
       returning id`,
      [
        membershipId,
        request.membershipVersion,
        request.anchorValueId,
        request.replacesScenarioSetId,
        revision,
        JSON.stringify(request.assumptions),
        calculation.method.calculationVersion,
        JSON.stringify(calculation),
        now
      ]
    );
    const row = await findResearchValuationScenarioById(client, membershipId, inserted.rows[0].id, actor);
    if (!row) {
      throw new ResearchValuationScenarioError(503, "SCENARIO_READ_BACK_FAILED", "created valuation scenario could not be read back");
    }
    const availability = await scenarioAnchorOriginalAvailabilities(client, membershipId, actor, [row], now, sourceStore);
    const issuerBasisAvailable = request.issuerBasis
      ? await issuerBasisAvailableForScenario(client, membershipId, actor, row, now, sourceStore) : false;
    const data = rowToResearchValuationScenario(
      row,
      Number(membership.version),
      membership.state,
      now,
      availability.get(String(row.id)),
      anchor.navPairedAnchor,
      issuerBasisAvailable
    );
    if (!data.recomputable) {
      throw new ResearchValuationScenarioError(503, "SCENARIO_READ_BACK_FAILED",
        "created valuation scenario sources became unavailable before read-back");
    }
    const stock = await upsertStock(client, normalized.market, normalized.code, normalized.symbol, null);
    const auditAsOf = await insertWriteAudit(client, {
      eventType: "research_valuation_scenario_created",
      request: auditRequest,
      stock,
      targetTable: "research_valuation_scenario_sets",
      targetId: data.id,
      beforePayload: null,
      afterPayload: data,
      requestFingerprint: fingerprint,
      candidateMembershipId: membershipId,
      candidateMembershipVersion: request.membershipVersion
    });
    await client.query("commit");
    return writeEnvelope(auditRequest, data, `Owner-assumption valuation scenario for ${normalized.symbol} created.`, auditAsOf);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      const replay = await findAuditByIdempotencyKey<ResearchValuationScenarioSetData>(
        pool,
        request.idempotencyKey,
        "research_valuation_scenario_created"
      );
      if (replay && sameBoundResearchWriteReplay(replay, actor, { ...request, membershipId }, fingerprint)) return replay.envelope;
      throw new ResearchValuationScenarioError(
        409,
        "SCENARIO_CHAIN_CONFLICT",
        "this anchor already has a root scenario or the replacement already has a successor"
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

export function assertValuationAssumptionsMatchAnchor(
  assumptions: AnnualValuationScenarioInput,
  anchor: Pick<ResearchValuationScenarioRow, "currency" | "metric">
): void {
  if (assumptions.metricCurrency !== anchor.currency) {
    throw new ResearchValuationScenarioError(
      409, "VALUATION_CURRENCY_CONFLICT",
      "valuation currency must match the cited fundamental; no currency conversion is available"
    );
  }
  if (anchor.metric === "profit_attributable_to_owners" && assumptions.netCashPerShare !== 0) {
    throw new ResearchValuationScenarioError(
      422, "NET_CASH_DOUBLE_COUNT",
      "profit per share times an equity P/E multiple already represents equity value; net cash per share must be zero"
    );
  }
}

export function valuationCalculation(
  assumptions: CreateResearchValuationScenarioRequest["assumptions"],
  pairedAnchorValueId?: string
): ResearchValuationCalculation {
  const grid = calculateAnnualValuationScenarioGrid(assumptions);
  if (!grid) {
    throw new ResearchValuationScenarioError(
      422,
      "ASSUMPTIONS_NOT_CALCULABLE",
      "Owner assumptions do not produce a finite positive base scenario"
    );
  }
  const adjusted = annualValuationMethodId(assumptions) === "adjusted_net_asset_value_user_scenario";
  const values = [grid.cells[0], grid.cells[4], grid.cells[8]].map((cell) => cell.presentValuePerShare);
  return {
    method: {
      id: adjusted ? "adjusted_net_asset_value_user_scenario" : "discounted_forward_metric_multiple_user_scenario",
      calculationVersion: adjusted ? ANNUAL_ADJUSTED_NET_ASSET_CALCULATION_VERSION : ANNUAL_VALUATION_CALCULATION_VERSION,
      presentValueFormula: adjusted ? ANNUAL_ADJUSTED_NET_ASSET_VALUE_FORMULA : ANNUAL_VALUATION_PRESENT_VALUE_FORMULA,
      rounding: "decimal_places_6",
      applicability: adjusted ? {
        ownerConfirmed: true,
        companyDataBasis: "reported_balance_sheet_net_assets_per_share",
        requiredAnchorMetrics: ["total_assets", "total_liabilities"],
        ...(pairedAnchorValueId ? { pairedAnchorValueId } : {}),
        limitation: "The Owner selected an asset-backed method from reported balance-sheet context; the per-share basis and adjustments remain Owner assumptions."
      } : {
        ownerConfirmed: true,
        companyDataBasis: "forward_operating_metric_per_share",
        requiredAnchorMetrics: ["revenue", "profit_attributable_to_owners"],
        limitation: "The Owner selected a forward operating-metric method; the per-share basis and forward assumptions remain Owner assumptions."
      }
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
    },
    valueRange: {
      low: Math.min(...values),
      high: Math.max(...values),
      interpretation: "research_scenario_range_not_target_price"
    }
  };
}

async function replacementRevision(
  client: Parameters<typeof findResearchValuationScenarioById>[0],
  membershipId: string,
  request: CreateResearchValuationScenarioRequest,
  actor: AuthenticatedResearchActor
): Promise<number> {
  if (request.replacesScenarioSetId === null) return 1;
  const prior = await findResearchValuationScenarioById(
    client,
    membershipId,
    request.replacesScenarioSetId,
    actor,
    true
  );
  if (!prior || prior.scenario_replaced) {
    throw new ResearchValuationScenarioError(409, "SCENARIO_REPLACEMENT_CONFLICT", "replacement target must be the current scenario set");
  }
  if (String(prior.id) !== request.anchorValueId) {
    throw new ResearchValuationScenarioError(409, "SCENARIO_ANCHOR_CONFLICT", "scenario revision must preserve the same cited anchor");
  }
  return Number(prior.scenario_revision) + 1;
}

function idempotencyConflict(): IdempotencyConflictError {
  return new IdempotencyConflictError("idempotency key already exists with different valuation scenario semantics");
}
