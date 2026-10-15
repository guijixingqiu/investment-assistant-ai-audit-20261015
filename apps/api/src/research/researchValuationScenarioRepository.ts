import type { Pool, PoolClient } from "pg";
import {
  RESEARCH_FUNDAMENTALS_SCHEMA_VERSION,
  RESEARCH_VALUATION_SCENARIOS_SCHEMA_VERSION,
  type ResearchFundamentalValueData,
  type ResearchValuationCalculation,
  type ResearchValuationScenarioSetData,
  type ResearchValuationScenariosEnvelope
} from "../../../../packages/contracts/src/index.js";
import {
  CandidateMembershipNotFoundError,
  ResearchValuationScenarioError,
  type AuthenticatedResearchActor
} from "./domain.js";
import { readCandidateMembershipById } from "./candidateMembershipPersistence.js";
import { issuerBasisMatchesPreview, issuerFactOriginalAvailable, readIssuerNavBasisPreview } from "./researchValuationIssuerBasis.js";
import {
  readResearchFundamentals,
  rowToResearchFundamentalValue,
  type ResearchFundamentalRow
} from "./researchFundamentalRepository.js";
import { sourceOriginalAvailabilities, type SourceOriginalAvailability, type SourceSnapshotStoreOptions } from "./researchSourceSnapshotRepository.js";
import {readProviderValuationScenarioSets} from "./researchValuationProviderScenarioRepository.js";
import {readFcffScenarioSets,readProviderFcffScenarioSets} from "./researchValuationFcffScenarioRepository.js";

export type ResearchValuationScenarioRow = ResearchFundamentalRow & {
  scenario_id: string;
  scenario_membership_version: number | string;
  scenario_revision: number | string;
  replaces_scenario_set_id: string | null;
  assumption_payload: ResearchValuationScenarioSetData["assumptions"]["values"];
  calculation_payload: ResearchValuationCalculation;
  scenario_created_at: Date | string;
  scenario_replaced: boolean;
};

export async function readResearchValuationScenarios(
  pool: Pool,
  membershipId: string,
  actor: AuthenticatedResearchActor,
  now = new Date(),
  sourceStore?:SourceSnapshotStoreOptions
): Promise<ResearchValuationScenariosEnvelope> {
  const membership = await readCandidateMembershipById(pool, actor, membershipId);
  if (!membership) throw new CandidateMembershipNotFoundError();
  const result = await pool.query<ResearchValuationScenarioRow>(
    `${valuationScenarioSelect()}
      where vs.candidate_membership_id = $1
        and vs.basis_kind = 'issuer'
        and vs.calculation_version <> '2026-10-12.discounted-fcff-to-common-equity.v2'
        and cm.actor_type = $2
        and cm.actor_id = $3
        and rm.deleted_at is null
      order by vs.created_at desc, vs.id desc`,
    [membershipId, actor.actorType, actor.actorId]
  );
  const availability=await scenarioAnchorOriginalAvailabilities(pool,membershipId,actor,result.rows,now,sourceStore);
  const paired = await readNavPairedAnchors(pool, membershipId, actor, result.rows, now, sourceStore);
  const issuerBasis = await issuerBasisCurrentness(pool, membershipId, actor, result.rows, now, sourceStore);
  const fcffScenarioSets = await readFcffScenarioSets(pool,membershipId,actor,now,sourceStore);
  const providerFcffScenarioSets = await readProviderFcffScenarioSets(pool,membershipId,actor,now,sourceStore);
  return {
    schemaVersion: RESEARCH_VALUATION_SCENARIOS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    status: "available",
    requestedActorId: actor.actorId,
    membershipId,
    membershipVersion: Number(membership.version),
    membershipState: membership.state,
    symbol: membership.symbol,
    fundamentalsSchemaVersion: RESEARCH_FUNDAMENTALS_SCHEMA_VERSION,
    scenarioSets: result.rows.map((row) => rowToResearchValuationScenario(
      row,
      Number(membership.version),
      membership.state,
      now,
      availability.get(String(row.id)),
      paired.get(String(row.calculation_payload.method.applicability?.pairedAnchorValueId)),
      issuerBasis.get(String(row.scenario_id))
    )),
    providerScenarioSets:await readProviderValuationScenarioSets(pool,membershipId,actor,now,sourceStore),
    ...(fcffScenarioSets.length ? { fcffScenarioSets } : {}),
    ...(providerFcffScenarioSets.length ? { providerFcffScenarioSets } : {})
  };
}

export async function findResearchValuationScenarioById(
  client: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  scenarioSetId: string,
  actor: AuthenticatedResearchActor,
  forUpdate = false
): Promise<ResearchValuationScenarioRow | null> {
  const result = await client.query<ResearchValuationScenarioRow>(
    `${valuationScenarioSelect()}
      where vs.id = $1
        and vs.basis_kind = 'issuer'
        and vs.calculation_version <> '2026-10-12.discounted-fcff-to-common-equity.v2'
        and vs.candidate_membership_id = $2
        and cm.actor_type = $3
        and cm.actor_id = $4
        and rm.deleted_at is null
      ${forUpdate ? "for update of vs" : ""}
      limit 1`,
    [scenarioSetId, membershipId, actor.actorType, actor.actorId]
  );
  return result.rows[0] ?? null;
}

export async function readLatestResearchValuationScenario(
  client: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  actor: AuthenticatedResearchActor,
  currentMembershipVersion: number,
  membershipState: "tracked" | "paused" | "archived",
  now = new Date(),
  sourceStore?:SourceSnapshotStoreOptions
): Promise<ResearchValuationScenarioSetData | null> {
  return (await readCurrentResearchValuationScenarios(
    client, membershipId, actor, currentMembershipVersion, membershipState, now, sourceStore
  ))[0] ?? null;
}

export async function readCurrentResearchValuationScenarios(
  client: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  actor: AuthenticatedResearchActor,
  currentMembershipVersion: number,
  membershipState: "tracked" | "paused" | "archived",
  now = new Date(),
  sourceStore?:SourceSnapshotStoreOptions
): Promise<ResearchValuationScenarioSetData[]> {
  const result = await client.query<ResearchValuationScenarioRow>(
    `${valuationScenarioSelect()}
      where vs.candidate_membership_id = $1
        and vs.basis_kind = 'issuer'
        and vs.calculation_version <> '2026-10-12.discounted-fcff-to-common-equity.v2'
        and cm.actor_type = $2
        and cm.actor_id = $3
        and rm.deleted_at is null
      order by vs.created_at desc, vs.id desc`,
    [membershipId, actor.actorType, actor.actorId]
  );
  const availability=await scenarioAnchorOriginalAvailabilities(client,membershipId,actor,result.rows,now,sourceStore);
  const paired = await readNavPairedAnchors(client, membershipId, actor, result.rows, now, sourceStore);
  const issuerBasis = await issuerBasisCurrentness(client, membershipId, actor, result.rows, now, sourceStore);
  const current = result.rows
    .map((row) => rowToResearchValuationScenario(
      row,
      currentMembershipVersion,
      membershipState,
      now,
      availability.get(String(row.id)),
      paired.get(String(row.calculation_payload.method.applicability?.pairedAnchorValueId)),
      issuerBasis.get(String(row.scenario_id))
    ))
    .filter((scenario) => scenario.scenarioState === "current" && scenario.recomputable);
  const byMethod = new Map<ResearchValuationScenarioSetData["calculation"]["method"]["id"], ResearchValuationScenarioSetData>();
  for (const scenario of current) {
    if (!byMethod.has(scenario.calculation.method.id)) byMethod.set(scenario.calculation.method.id, scenario);
  }
  return [...byMethod.values()];
}

export async function assertCurrentValuationAnchor(
  client: PoolClient,
  membershipId: string,
  anchorValueId: string,
  actor: AuthenticatedResearchActor,
  expectedMembershipVersion: number,
  expectedSymbol: string,
  methodId: "discounted_forward_metric_multiple_user_scenario" | "adjusted_net_asset_value_user_scenario",
  now = new Date(),
  sourceStore?:SourceSnapshotStoreOptions
): Promise<ResearchFundamentalRow & { navPairedAnchor?: ResearchFundamentalValueData }> {
  const result = await client.query<ResearchFundamentalRow & {
    material_source_type: string;
    material_claim_type: string;
    material_verification_status: string;
    material_rights_status: string;
  }>(
    `${fundamentalAnchorSelect()},
            ei.source_type as material_source_type,
            rm.claim_type as material_claim_type,
            rm.verification_status as material_verification_status,
            rm.rights_status as material_rights_status,
            ei.published_at as material_published_at
       from research_fundamental_values fv
       join candidate_memberships cm on cm.id = fv.candidate_membership_id
       join research_materials rm on rm.id = fv.source_material_id
       join evidence_items ei on ei.id = rm.evidence_item_id
       left join research_documents rd on rd.id = rm.citation_document_id
       left join research_document_pages rdp
         on rdp.document_id = rm.citation_document_id
        and rdp.page_number = rm.citation_page_number
        and rdp.text_sha256 = rm.citation_page_text_sha256
       left join research_source_snapshots s on s.id=rm.citation_snapshot_id
         and s.candidate_membership_id=rm.candidate_membership_id
         and s.captured_membership_version=rm.citation_snapshot_membership_version
         and s.text_sha256=rm.citation_snapshot_text_sha256
      where fv.id = $1
        and fv.candidate_membership_id = $2
        and cm.actor_type = $3
        and cm.actor_id = $4
        and rm.deleted_at is null
        and ((rd.id is not null and rdp.document_id is not null) or s.id is not null)
      for update of fv, rm`,
    [anchorValueId, membershipId, actor.actorType, actor.actorId]
  );
  const anchor = result.rows[0];
  if (!anchor) {
    throw new ResearchValuationScenarioError(
      404,
      "ANCHOR_NOT_FOUND",
      "valuation anchor was not found for the current actor and membership"
    );
  }
  if (Number(anchor.captured_membership_version) !== expectedMembershipVersion) {
    throw conflict(
      "ANCHOR_MEMBERSHIP_VERSION_CONFLICT",
      "valuation anchor must have been recorded at the current candidate membership version"
    );
  }
  if (anchor.symbol !== expectedSymbol) {
    throw conflict("ANCHOR_SYMBOL_CONFLICT", "valuation anchor symbol does not match the current candidate membership");
  }
  const eligibleMetrics = methodId === "adjusted_net_asset_value_user_scenario"
    ? ["total_assets", "total_liabilities"]
    : ["revenue", "profit_attributable_to_owners"];
  if (!eligibleMetrics.includes(anchor.metric)) {
    throw conflict("ANCHOR_METRIC_INELIGIBLE", "valuation anchor does not support the Owner-selected valuation method");
  }
  if (anchor.value_replaced) throw conflict("ANCHOR_REPLACED", "a replaced fundamental value cannot anchor a valuation scenario");
  if (anchor.value_status !== "reported" || anchor.reported_value === null) {
    throw conflict("ANCHOR_NOT_REPORTED", "valuation anchor must be an issuer-reported value, not unknown");
  }
  if (anchor.comparability !== "comparable" || anchor.comparability_reason !== null) {
    throw conflict("ANCHOR_NOT_COMPARABLE", "valuation anchor must be explicitly comparable");
  }
  if (anchor.material_superseded) throw conflict("ANCHOR_SOURCE_SUPERSEDED", "superseded source material cannot anchor a valuation scenario");
  if (anchor.snapshot_pending_review) throw conflict("ANCHOR_SOURCE_SUPERSEDED", "changed official article needs Owner review before it can anchor valuation");
  if(anchor.citation_snapshot_id!=null){
    const availability=await scenarioOriginalAvailabilities(client,membershipId,actor,[anchor],sourceStore);
    if(availability.get(String(anchor.citation_snapshot_id))!=="available")
      throw conflict("ANCHOR_SOURCE_ORIGINAL_UNAVAILABLE","verified official article original is required to anchor valuation");
  } else if (!await issuerFactOriginalAvailable(client, membershipId, rowToResearchFundamentalValue(anchor, now), sourceStore)) {
    throw conflict("ANCHOR_SOURCE_ORIGINAL_UNAVAILABLE", "cited PDF bytes and page must be readable to anchor valuation");
  }
  if (new Date(anchor.material_valid_until).getTime() <= now.getTime()) {
    throw conflict("ANCHOR_SOURCE_STALE", "expired source material cannot anchor a valuation scenario");
  }
  if (!["owner_provided_pdf","issuer_public_html"].includes(anchor.material_source_type)
    || anchor.material_claim_type !== "issuer_statement"
    || anchor.material_verification_status !== "unverified"
    || anchor.material_rights_status !== (anchor.material_source_type==="issuer_public_html"?"authorized_public":"user_provided")) {
    throw conflict("ANCHOR_SOURCE_INVALID", "valuation anchor source no longer satisfies the S1A citation boundary");
  }
  if (methodId === "adjusted_net_asset_value_user_scenario") {
    const fundamentals = await readResearchFundamentals(client, membershipId, actor, now, undefined, sourceStore);
    const basis = rowToResearchFundamentalValue(anchor, now);
    if (basis.periodKind !== "instant" || basis.periodStart !== null) {
      throw conflict("METHOD_ANCHOR_INAPPLICABLE", "adjusted net asset value requires a balance-sheet date anchor");
    }
    const companionMetric = anchor.metric === "total_assets" ? "total_liabilities" : "total_assets";
    const companion = fundamentals.values.find((value) =>
      value.metric === companionMetric
        && matchesBalanceSheetBasis(value, basis, expectedMembershipVersion, expectedSymbol));
    if (!companion) {
      throw conflict(
        "METHOD_ANCHOR_INAPPLICABLE",
        "adjusted net asset value requires current comparable assets and liabilities with the same date, currency, unit and scope"
      );
    }
    if (!await issuerFactOriginalAvailable(client, membershipId, companion, sourceStore)) {
      throw conflict("METHOD_ANCHOR_INAPPLICABLE", "paired balance-sheet original page is unavailable");
    }
    return { ...anchor, navPairedAnchor: companion };
  }
  return anchor;
}

async function readNavPairedAnchors(
  client: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  actor: AuthenticatedResearchActor,
  rows: ResearchValuationScenarioRow[],
  now: Date,
  sourceStore?: SourceSnapshotStoreOptions
): Promise<Map<string, ResearchFundamentalValueData>> {
  const ids = new Set(rows
    .filter((row) => row.assumption_payload.methodId === "adjusted_net_asset_value_user_scenario")
    .map((row) => row.calculation_payload.method.applicability?.pairedAnchorValueId)
    .filter((id): id is string => typeof id === "string" && /^[1-9]\d*$/.test(id)));
  if (ids.size === 0) return new Map();
  const fundamentals = await readResearchFundamentals(client, membershipId, actor, now, undefined, sourceStore);
  const paired = new Map<string, ResearchFundamentalValueData>();
  for (const value of fundamentals.values) {
    if (ids.has(value.id) && !["retracted", "invalid"].includes(value.valueState)
      && await issuerFactOriginalAvailable(client, membershipId, value, sourceStore)) paired.set(value.id, value);
  }
  return paired;
}

function matchesBalanceSheetBasis(
  value: ResearchFundamentalValueData,
  basis: ResearchFundamentalValueData,
  membershipVersion: number,
  symbol: string
): boolean {
  return value.periodKind === "instant" && value.periodStart === null
    && value.membershipId === basis.membershipId
    && value.periodEnd === basis.periodEnd && value.currency === basis.currency
    && value.unitScale === basis.unitScale && value.scope === basis.scope
    && value.membershipVersionAtWrite === membershipVersion && value.symbol === symbol
    && value.valueState === "current"
    && (value.source.kind !== "source_snapshot" || value.source.originalAvailability === "available")
    && value.valueStatus === "reported" && value.value !== null
    && value.comparability === "comparable" && value.comparabilityReason === null;
}

export function rowToResearchValuationScenario(
  row: ResearchValuationScenarioRow,
  currentMembershipVersion: number,
  membershipState: "tracked" | "paused" | "archived",
  now = new Date(),
  originalAvailability:SourceOriginalAvailability="unknown",
  pairedAnchor?: ResearchFundamentalValueData,
  issuerBasisAvailable = false
): ResearchValuationScenarioSetData {
  const anchor = rowToResearchFundamentalValue(row, now, originalAvailability);
  const invalidatedBy: ResearchValuationScenarioSetData["invalidatedBy"] = [];
  if (row.scenario_replaced) invalidatedBy.push("scenario_replaced");
  if (Number(row.scenario_membership_version) !== currentMembershipVersion) invalidatedBy.push("membership_version_changed");
  if (membershipState === "archived") invalidatedBy.push("membership_archived");
  if (anchor.valueState === "replaced") invalidatedBy.push("anchor_replaced");
  if (anchor.source.materialRevisionState === "superseded") invalidatedBy.push("anchor_source_superseded");
  if (anchor.source.kind === "source_snapshot" && anchor.source.snapshotReviewState === "pending_review")
    invalidatedBy.push("anchor_source_review_required");
  if (originalAvailability !== "available")
    invalidatedBy.push("anchor_source_original_unavailable");
  if (anchor.valueState === "historical_source_stale") invalidatedBy.push("anchor_source_stale");
  if (anchor.valueStatus !== "reported" || anchor.value === null) invalidatedBy.push("anchor_not_reported");
  if (anchor.comparability !== "comparable" || anchor.comparabilityReason !== null) invalidatedBy.push("anchor_not_comparable");
  if (!["revenue", "profit_attributable_to_owners", "total_assets", "total_liabilities"].includes(anchor.metric)) invalidatedBy.push("anchor_metric_ineligible");
  const methodId = row.assumption_payload.methodId ?? "discounted_forward_metric_multiple_user_scenario";
  const eligibleMetrics = methodId === "adjusted_net_asset_value_user_scenario"
    ? ["total_assets", "total_liabilities"]
    : ["revenue", "profit_attributable_to_owners"];
  if (!eligibleMetrics.includes(anchor.metric)) invalidatedBy.push("method_anchor_inapplicable");
  const pairedId = row.calculation_payload.method.applicability?.pairedAnchorValueId;
  if (methodId === "adjusted_net_asset_value_user_scenario") {
    if (!pairedId) invalidatedBy.push("nav_pair_unbound");
    else if (!pairedAnchor || pairedAnchor.id !== pairedId || pairedAnchor.id === anchor.id
      || !["total_assets", "total_liabilities"].includes(anchor.metric)
      || pairedAnchor.metric === anchor.metric
      || !matchesBalanceSheetBasis(pairedAnchor, anchor, currentMembershipVersion, row.symbol)) {
      invalidatedBy.push("nav_pair_unavailable");
    }
  }
  if (row.calculation_payload.issuerBasis && !issuerBasisAvailable) invalidatedBy.push("issuer_basis_unavailable");
  return {
    id: String(row.scenario_id),
    membershipId: String(row.candidate_membership_id),
    membershipVersionAtWrite: Number(row.scenario_membership_version),
    symbol: row.symbol,
    revision: Number(row.scenario_revision),
    replacesScenarioSetId: row.replaces_scenario_set_id === null ? null : String(row.replaces_scenario_set_id),
    scenarioState: row.scenario_replaced ? "replaced" : "current",
    recomputable: invalidatedBy.length === 0,
    invalidatedBy,
    anchor: asValuationAnchor(anchor, !!row.calculation_payload.issuerBasis),
    anchorOriginalAvailability: originalAvailability,
    ...(row.calculation_payload.issuerBasis ? {
      issuerBasisCurrentness: issuerBasisAvailable ? "available" as const : "unavailable" as const
    } : {}),
    ...(methodId === "adjusted_net_asset_value_user_scenario" ? {
      pairedAnchor: pairedAnchor ? asValuationAnchor(pairedAnchor, !!row.calculation_payload.issuerBasis) : null
    } : {}),
    assumptions: {
      authority: "owner",
      derivation: row.calculation_payload.issuerBasis
        ? "issuer_nav_source_draft_owner_confirmed" : "manual_not_derived_from_citation",
      values: row.assumption_payload
    },
    calculation: row.calculation_payload,
    safety: {
      advisoryOnly: true,
      forecast: false,
      recommendation: false,
      automaticSignal: false,
      createsOrder: false,
      callsBroker: false,
      mutatesOfficialPortfolio: false
    },
    createdAt: new Date(row.scenario_created_at).toISOString()
  };
}

function asValuationAnchor(value: ResearchFundamentalValueData, sourceInput: boolean): ResearchValuationScenarioSetData["anchor"] {
  const { assertion: _assertion, ...fact } = value;
  return { ...fact, anchorRole: sourceInput ? "issuer_nav_source_draft_input"
    : "cited_context_only_not_calculation_input" };
}

export async function issuerBasisAvailableForScenario(
  client: Pick<Pool | PoolClient, "query">, membershipId: string,
  actor: AuthenticatedResearchActor, row: ResearchValuationScenarioRow,
  now: Date, sourceStore?: SourceSnapshotStoreOptions
): Promise<boolean> {
  const saved = row.calculation_payload.issuerBasis;
  if (!saved) return false;
  const preview = await readIssuerNavBasisPreview(client, membershipId, String(row.id), actor, now, sourceStore);
  return issuerBasisMatchesPreview(saved, preview);
}

async function issuerBasisCurrentness(
  client: Pick<Pool | PoolClient, "query">, membershipId: string,
  actor: AuthenticatedResearchActor, rows: ResearchValuationScenarioRow[],
  now: Date, sourceStore?: SourceSnapshotStoreOptions
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();
  for (const row of rows) {
    if (row.calculation_payload.issuerBasis) {
      results.set(String(row.scenario_id), await issuerBasisAvailableForScenario(
        client, membershipId, actor, row, now, sourceStore));
    }
  }
  return results;
}

async function scenarioOriginalAvailabilities(client:Pick<Pool|PoolClient,"query">,membershipId:string,
  actor:AuthenticatedResearchActor,rows:ResearchFundamentalRow[],sourceStore?:SourceSnapshotStoreOptions
):Promise<Map<string,SourceOriginalAvailability>> {
  return sourceOriginalAvailabilities(client,membershipId,actor,rows.filter(row=>row.citation_snapshot_id!=null)
    .map(row=>({snapshotId:String(row.citation_snapshot_id),rawSha256:String(row.snapshot_raw_sha256),
      byteLength:Number(row.snapshot_byte_length),textSha256:String(row.citation_snapshot_text_sha256)})),sourceStore);
}

export async function scenarioAnchorOriginalAvailabilities(
  client: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  actor: AuthenticatedResearchActor,
  rows: ResearchFundamentalRow[],
  now: Date,
  sourceStore?: SourceSnapshotStoreOptions
): Promise<Map<string, SourceOriginalAvailability>> {
  const snapshots = await scenarioOriginalAvailabilities(client, membershipId, actor, rows, sourceStore);
  const availability = new Map<string, SourceOriginalAvailability>();
  for (const row of rows) {
    const value = rowToResearchFundamentalValue(row, now);
    availability.set(String(row.id), row.citation_snapshot_id == null
      ? await issuerFactOriginalAvailable(client, membershipId, value, sourceStore) ? "available" : "unavailable"
      : snapshots.get(String(row.citation_snapshot_id)) ?? "unknown");
  }
  return availability;
}

function valuationScenarioSelect(): string {
  return `${fundamentalAnchorSelect()},
                 vs.id as scenario_id,
                 vs.captured_membership_version as scenario_membership_version,
                 vs.revision as scenario_revision,
                 vs.replaces_scenario_set_id,
                 vs.assumption_payload,
                 vs.calculation_payload,
                 vs.created_at as scenario_created_at,
                 exists (
                   select 1 from research_valuation_scenario_sets child
                    where child.replaces_scenario_set_id = vs.id
                 ) as scenario_replaced
            from research_valuation_scenario_sets vs
            join candidate_memberships cm on cm.id = vs.candidate_membership_id
            join research_fundamental_values fv on fv.id = vs.anchor_value_id
            join research_materials rm on rm.id = fv.source_material_id
            left join research_documents rd on rd.id = rm.citation_document_id
            left join research_source_snapshots s on s.id=rm.citation_snapshot_id
              and s.candidate_membership_id=rm.candidate_membership_id
              and s.captured_membership_version=rm.citation_snapshot_membership_version
              and s.text_sha256=rm.citation_snapshot_text_sha256
            join lateral (select true as valid where
              (rm.citation_document_id is not null and rd.id is not null)
              or (rm.citation_snapshot_id is not null and s.id is not null)) original_source on true`;
}

function fundamentalAnchorSelect(): string {
  return `select fv.id, fv.candidate_membership_id, fv.captured_membership_version, cm.symbol,
                 fv.metric, fv.period_kind,
                 to_char(fv.period_start, 'YYYY-MM-DD') as period_start,
                 to_char(fv.period_end, 'YYYY-MM-DD') as period_end,
                 fv.currency, fv.unit_scale, fv.scope, fv.value_status, fv.reported_value::text,
                 fv.comparability, fv.comparability_reason, fv.amendment_kind,
                 fv.replaces_value_id, fv.revision, fv.created_at, fv.source_material_id,
                 rm.revision as material_revision, rm.valid_until as material_valid_until,
                 rm.source_version as material_source_version,
                 rm.citation_document_id, rm.citation_page_number, rm.citation_page_text_sha256,
                 rm.citation_snapshot_id,rm.citation_snapshot_membership_version,rm.citation_snapshot_text_sha256,
                 rm.citation_start_utf16,rm.citation_end_utf16,rm.citation_excerpt_sha256,
                 s.raw_sha256 as snapshot_raw_sha256,s.byte_length as snapshot_byte_length,
                 s.media_type as snapshot_media_type,s.canonical_url as snapshot_canonical_url,
                 s.response_url as snapshot_response_url,
                 case when s.id is null then false else exists (
                   select 1 from research_source_snapshots newer
                    where newer.candidate_membership_id=s.candidate_membership_id and newer.canonical_url=s.canonical_url
                      and (newer.captured_at,newer.id)>(s.captured_at,s.id) and newer.text_sha256<>s.text_sha256
                 ) end as snapshot_pending_review,
                 rd.pdf_sha256 as document_pdf_sha256,
                 exists (
                   select 1 from research_fundamental_values value_child
                    where value_child.replaces_value_id = fv.id
                 ) as value_replaced,
                 exists (
                   select 1 from research_materials material_child
                    where material_child.replaces_material_id = rm.id
                 ) as material_superseded`;
}

function conflict(code: string, message: string): ResearchValuationScenarioError {
  return new ResearchValuationScenarioError(409, code, message);
}
