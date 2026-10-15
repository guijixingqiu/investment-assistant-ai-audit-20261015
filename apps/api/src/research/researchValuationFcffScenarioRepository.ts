import type { Pool, PoolClient } from "pg";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import type { ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import { calculateFcffScenario, fcffCreateRequestErrors, fcffPublishedHongKongDay,
  FCFF_CALCULATION_VERSION,
  FCFF_METHOD_ID, type CreateResearchFcffScenarioRequest, type FcffScenarioCalculation,
  type FcffSourcePreview, type FcffSourceSelection, type ResearchFcffScenarioSetData,
  fcffProviderCreateRequestErrors, type CreateResearchProviderFcffScenarioRequest,
  type FcffProviderReference, type ResearchProviderFcffScenarioSetData }
  from "../../../../packages/contracts/src/researchValuationFcff.js";
import { normalizeMarketCode } from "../market/freshness.js";
import { currentHongKongDate } from "../market/dailyBarsRepository.js";
import { readCandidateMembershipById } from "./candidateMembershipPersistence.js";
import { requestFingerprint } from "./deepResearchGate.js";
import { CandidateMembershipNotFoundError, IdempotencyConflictError, ResearchValuationScenarioError,
  type AuthenticatedResearchActor } from "./domain.js";
import { fcffAssumptionsMatchSources, readFcffSourcePreview } from "./researchValuationFcff.js";
import { readFcffProviderReference } from "./researchValuationFcffProviderReference.js";
import { assertCandidateMembershipWriteBinding, sameBoundResearchWriteReplay } from "./researchWriteBinding.js";
import type { SourceSnapshotStoreOptions } from "./researchSourceSnapshotRepository.js";
import { actorRequest, findAuditByIdempotencyKey, insertWriteAudit, isUniqueViolation,
  upsertStock, writeEnvelope } from "./writePersistence.js";

type Reader = Pick<Pool | PoolClient, "query">;
type Payload = { methodId: typeof FCFF_METHOD_ID; sourceSelection: FcffSourceSelection;
  sourceFingerprint: string; historicalOriginals: FcffSourcePreview;
  assumptions: CreateResearchFcffScenarioRequest["assumptions"];
  bridgeClassification: CreateResearchFcffScenarioRequest["bridgeClassification"] };
type Row = { id: string; candidate_membership_id: string; captured_membership_version: number;
  anchor_value_id: string;
  revision: number; replaces_scenario_set_id: string | null; scenario_replaced: boolean;
  assumption_payload: Payload; calculation_payload: FcffScenarioCalculation;
  calculation_version: string; created_at: Date | string; symbol: string };

function selection(): string { return `select vs.id::text,vs.candidate_membership_id::text,
  vs.captured_membership_version,vs.anchor_value_id::text,vs.revision,vs.replaces_scenario_set_id::text,
  vs.assumption_payload,vs.calculation_payload,vs.calculation_version,vs.created_at,cm.symbol,
  exists(select 1 from research_valuation_scenario_sets child where child.replaces_scenario_set_id=vs.id) as scenario_replaced
  from research_valuation_scenario_sets vs
  join candidate_memberships cm on cm.id=vs.candidate_membership_id
  where vs.candidate_membership_id=$1 and cm.actor_type=$2 and cm.actor_id=$3
    and vs.basis_kind='issuer' and vs.calculation_version='${FCFF_CALCULATION_VERSION}'`; }

async function mapRow(client: Reader, row: Row, version: number, state: string,
  actor: AuthenticatedResearchActor, now: Date, store?: SourceSnapshotStoreOptions): Promise<ResearchFcffScenarioSetData> {
  const payload = row.assumption_payload;
  let preview: FcffSourcePreview | null = null;
  try { preview = await readFcffSourcePreview(client, String(row.candidate_membership_id),
    payload.sourceSelection, actor, now, store); } catch { /* Current sources remain unavailable. */ }
  const invalidatedBy = fcffScenarioInvalidations(row, preview, version, state);
  return { id: String(row.id), membershipId: String(row.candidate_membership_id),
    membershipVersionAtWrite: Number(row.captured_membership_version), symbol: row.symbol,
    revision: Number(row.revision), replacesScenarioSetId: row.replaces_scenario_set_id,
    scenarioState: row.scenario_replaced ? "replaced" : "current",
    recomputable: invalidatedBy.length === 0, invalidatedBy,
    sourceSelection: payload.sourceSelection, sourceFingerprint: payload.sourceFingerprint,
    historicalOriginals: payload.historicalOriginals,
    assumptions: { authority: "owner", values: payload.assumptions,
      bridgeClassification: payload.bridgeClassification }, calculation: row.calculation_payload,
    safety: { advisoryOnly: true, forecast: true, recommendation: false, automaticSignal: false,
      createsOrder: false, callsBroker: false, mutatesOfficialPortfolio: false },
    createdAt: new Date(row.created_at).toISOString() };
}

export function fcffScenarioInvalidations(row: Pick<Row, "scenario_replaced" | "captured_membership_version"
  | "assumption_payload" | "calculation_version" | "calculation_payload">,
  preview: FcffSourcePreview | null, version: number, state: string): ResearchFcffScenarioSetData["invalidatedBy"] {
  const payload = row.assumption_payload;
  const invalidatedBy: ResearchFcffScenarioSetData["invalidatedBy"] = [];
  if (row.scenario_replaced) invalidatedBy.push("scenario_replaced");
  if (Number(row.captured_membership_version) !== version) invalidatedBy.push("membership_version_changed");
  if (state === "archived") invalidatedBy.push("membership_archived");
  if (!preview || preview.status !== "available") invalidatedBy.push("fcff_source_unavailable");
  else if (preview.sourceFingerprint !== payload.sourceFingerprint
    || canonicalJson(preview) !== canonicalJson(payload.historicalOriginals)
    || !fcffAssumptionsMatchSources(payload.assumptions, payload.bridgeClassification, preview))
    invalidatedBy.push("fcff_source_changed");
  const recomputed = calculateFcffScenario(payload.assumptions);
  if (payload.methodId !== FCFF_METHOD_ID || row.calculation_version !== FCFF_CALCULATION_VERSION
    || !recomputed || canonicalJson(recomputed) !== canonicalJson(row.calculation_payload))
    invalidatedBy.push("fcff_calculation_invalid");
  return invalidatedBy;
}

export async function readFcffScenarioSets(client: Reader, membershipId: string,
  actor: AuthenticatedResearchActor, now = new Date(), store?: SourceSnapshotStoreOptions): Promise<ResearchFcffScenarioSetData[]> {
  const member = await readCandidateMembershipById(client, actor, membershipId);
  if (!member) throw new CandidateMembershipNotFoundError();
  const rows = (await client.query<Row>(`${selection()} order by vs.created_at desc,vs.id desc`,
    [membershipId, actor.actorType, actor.actorId])).rows
    .filter((row) => row.calculation_version === FCFF_CALCULATION_VERSION);
  return Promise.all(rows.map((row) => mapRow(client, row, Number(member.version), member.state, actor, now, store)));
}

type ProviderPayload = { methodId: typeof FCFF_METHOD_ID;
  selection: CreateResearchProviderFcffScenarioRequest["selection"];
  sourceFingerprint: string; assumptions: CreateResearchProviderFcffScenarioRequest["assumptions"];
  bridgeReasons: CreateResearchProviderFcffScenarioRequest["bridgeReasons"] };
type ProviderRow = Omit<Row, "anchor_value_id" | "assumption_payload"> & {
  assumption_payload: ProviderPayload; provider_basis: FcffProviderReference;
  material_deleted: boolean; material_replaced: boolean;
  material_valid_until: Date | string; material_revision: number;
  material_content_fingerprint: string;
};
function providerSelection(): string { return `select vs.id::text,vs.candidate_membership_id::text,
  vs.captured_membership_version,vs.revision,vs.replaces_scenario_set_id::text,
  vs.assumption_payload,vs.calculation_payload,vs.calculation_version,vs.provider_basis,
  vs.created_at,cm.symbol,rm.deleted_at is not null as material_deleted,
  exists(select 1 from research_materials child where child.replaces_material_id=rm.id) as material_replaced,
  rm.valid_until as material_valid_until,rm.revision as material_revision,
  rm.content_fingerprint as material_content_fingerprint,
  exists(select 1 from research_valuation_scenario_sets child where child.replaces_scenario_set_id=vs.id) as scenario_replaced
  from research_valuation_scenario_sets vs
  join candidate_memberships cm on cm.id=vs.candidate_membership_id
  join research_materials rm on rm.id=vs.provider_source_material_id
  where vs.candidate_membership_id=$1 and cm.actor_type=$2 and cm.actor_id=$3
    and vs.basis_kind='provider' and vs.calculation_version='${FCFF_CALCULATION_VERSION}'`; }

async function providerRowToScenario(reader: Reader, row: ProviderRow, version: number,
  state: string, actor: AuthenticatedResearchActor, now: Date,
  store?: SourceSnapshotStoreOptions): Promise<ResearchProviderFcffScenarioSetData> {
  const payload = row.assumption_payload;
  const invalidatedBy: ResearchProviderFcffScenarioSetData["invalidatedBy"] = [];
  if (row.scenario_replaced) invalidatedBy.push("scenario_replaced");
  if (Number(row.captured_membership_version) !== version) invalidatedBy.push("membership_version_changed");
  if (state === "archived") invalidatedBy.push("membership_archived");
  if (!store || row.material_deleted || row.material_replaced
    || Number(row.material_revision) !== row.provider_basis.materialRevision
    || row.material_content_fingerprint !== row.provider_basis.materialFingerprint
    || new Date(row.material_valid_until).getTime() <= now.getTime())
    invalidatedBy.push("fcff_source_unavailable");
  else try {
    const current = await readFcffProviderReference(reader, String(row.candidate_membership_id),
      payload.selection, actor, store, now);
    if (current.sourceFingerprint !== payload.sourceFingerprint
      || canonicalJson(current) !== canonicalJson(row.provider_basis))
      invalidatedBy.push("fcff_source_changed");
  } catch { invalidatedBy.push("fcff_source_unavailable"); }
  const recalculated = calculateFcffScenario(payload.assumptions);
  if (!recalculated || row.calculation_version !== FCFF_CALCULATION_VERSION
    || payload.methodId !== FCFF_METHOD_ID
    || canonicalJson(recalculated) !== canonicalJson(row.calculation_payload))
    invalidatedBy.push("fcff_calculation_invalid");
  return { id: String(row.id), membershipId: String(row.candidate_membership_id),
    membershipVersionAtWrite: Number(row.captured_membership_version), symbol: row.symbol,
    revision: Number(row.revision), replacesScenarioSetId: row.replaces_scenario_set_id,
    scenarioState: row.scenario_replaced ? "replaced" : "current",
    recomputable: invalidatedBy.length === 0, invalidatedBy,
    providerReference: row.provider_basis,
    assumptions: { authority: "owner", values: payload.assumptions,
      bridgeReasons: payload.bridgeReasons }, calculation: row.calculation_payload,
    safety: { advisoryOnly: true, forecast: true, recommendation: false, automaticSignal: false,
      createsOrder: false, callsBroker: false, mutatesOfficialPortfolio: false },
    createdAt: new Date(row.created_at).toISOString() };
}

export async function readProviderFcffScenarioSets(reader: Reader, membershipId: string,
  actor: AuthenticatedResearchActor, now = new Date(), store?: SourceSnapshotStoreOptions):
  Promise<ResearchProviderFcffScenarioSetData[]> {
  const member = await readCandidateMembershipById(reader, actor, membershipId);
  if (!member) throw new CandidateMembershipNotFoundError();
  const rows = (await reader.query<ProviderRow>(`${providerSelection()} order by vs.created_at desc,vs.id desc`,
    [membershipId, actor.actorType, actor.actorId])).rows;
  return Promise.all(rows.map((row) => providerRowToScenario(reader, row, Number(member.version),
    member.state, actor, now, store)));
}

export async function createProviderFcffScenario(pool: Pool, membershipId: string,
  request: CreateResearchProviderFcffScenarioRequest, actor: AuthenticatedResearchActor,
  now = new Date(), store?: SourceSnapshotStoreOptions):
  Promise<ResearchWriteEnvelope<ResearchProviderFcffScenarioSetData>> {
  const errors = fcffProviderCreateRequestErrors(request);
  if (errors.length) throw new ResearchValuationScenarioError(422, "FCFF_PROVIDER_REQUEST_INVALID", errors.join(", "));
  if (request.assumptions.valuationCutoff > currentHongKongDate(now))
    throw new ResearchValuationScenarioError(422, "FCFF_FUTURE_CUTOFF", "valuation cutoff is in the future");
  if (!store) throw new ResearchValuationScenarioError(503, "FCFF_PROVIDER_ORIGINAL_UNAVAILABLE", "saved originals are unavailable");
  const fingerprint = requestFingerprint("research_provider_fcff_scenario_create", { actor, membershipId, request });
  const auditRequest = actorRequest(actor, request.idempotencyKey);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const replay = await findAuditByIdempotencyKey<ResearchProviderFcffScenarioSetData>(client,
      request.idempotencyKey, "research_valuation_scenario_created");
    if (replay) {
      if (!sameBoundResearchWriteReplay(replay, actor, { ...request, membershipId }, fingerprint))
        throw new IdempotencyConflictError("provider FCFF key has different semantics");
      await client.query("commit"); return replay.envelope;
    }
    const member = await assertCandidateMembershipWriteBinding(client, actor,
      { membershipId, membershipVersion: request.membershipVersion });
    if (member.symbol !== request.symbol) throw new ResearchValuationScenarioError(409,
      "SYMBOL_CONFLICT", "candidate membership changed");
    const reference = await readFcffProviderReference(client, membershipId, request.selection, actor, store, now);
    if (reference.rows.length === 0 || reference.sourceFingerprint !== request.sourceFingerprint
      || request.assumptions.currency !== reference.currency
      || request.assumptions.valuationCutoff < fcffPublishedHongKongDay(reference.capturedAt)!)
      throw new ResearchValuationScenarioError(409, "FCFF_PROVIDER_SOURCE_CHANGED", "provider source or currency changed");
    if (reference.shareReference && [reference.shareReference.issuedPublishedAt,
      reference.shareReference.treasuryPublishedAt].some((publishedAt) => {
      const day = fcffPublishedHongKongDay(publishedAt);
      return day === null || day > request.assumptions.valuationCutoff;
    })) throw new ResearchValuationScenarioError(409, "FCFF_SHARE_PUBLICATION_UNKNOWN",
      "share reference was not demonstrably public by the valuation cutoff");
    const calculation = calculateFcffScenario(request.assumptions);
    if (!calculation) throw new ResearchValuationScenarioError(422, "FCFF_NOT_CALCULABLE", "Owner scenario is incomplete");
    const prior = request.replacesScenarioSetId === null ? null : (await client.query<ProviderRow>(
      `${providerSelection()} and vs.id=$4 for update of vs`,
      [membershipId, actor.actorType, actor.actorId, request.replacesScenarioSetId])).rows[0];
    if (request.replacesScenarioSetId !== null && (!prior || prior.scenario_replaced))
      throw new ResearchValuationScenarioError(409, "FCFF_REVISION_CONFLICT", "load the current source-bound revision");
    if (request.replacesScenarioSetId === null) {
      const current = (await client.query<ProviderRow>(`${providerSelection()}
        and not exists(select 1 from research_valuation_scenario_sets child
          where child.replaces_scenario_set_id=vs.id) order by vs.id desc limit 1 for update of vs`,
        [membershipId, actor.actorType, actor.actorId])).rows[0];
      if (current) throw new ResearchValuationScenarioError(409, "FCFF_REVISION_REQUIRED", "revise the current FCFF scenario");
    }
    const payload: ProviderPayload = { methodId: FCFF_METHOD_ID, selection: request.selection,
      sourceFingerprint: reference.sourceFingerprint, assumptions: request.assumptions,
      bridgeReasons: request.bridgeReasons };
    const inserted = await client.query<{ id: string }>(`insert into research_valuation_scenario_sets
      (candidate_membership_id,captured_membership_version,anchor_value_id,replaces_scenario_set_id,
       revision,assumption_payload,calculation_version,calculation_payload,created_at,basis_kind,
       provider_financial_capture_id,provider_valuation_capture_id,provider_source_material_id,provider_basis)
      values($1,$2,null,$3,$4,$5::jsonb,$6,$7::jsonb,$8,'provider',$9,null,$10,$11::jsonb)
      returning id::text`, [membershipId, request.membershipVersion, request.replacesScenarioSetId,
      prior ? Number(prior.revision) + 1 : 1, JSON.stringify(payload), FCFF_CALCULATION_VERSION,
      JSON.stringify(calculation), now, request.selection.financialCaptureId,
      request.selection.sourceMaterialId, JSON.stringify(reference)]);
    const saved = (await readProviderFcffScenarioSets(client, membershipId, actor, now, store))
      .find((item) => item.id === inserted.rows[0]?.id);
    if (!saved?.recomputable) throw new ResearchValuationScenarioError(503, "FCFF_READBACK_FAILED", "provider FCFF readback failed");
    const stock = await upsertStock(client, normalizedMarket(member.symbol), member.symbol.slice(3), member.symbol, null);
    const auditAsOf = await insertWriteAudit(client, { eventType: "research_valuation_scenario_created",
      request: auditRequest, stock, targetTable: "research_valuation_scenario_sets", targetId: saved.id,
      beforePayload: null, afterPayload: saved, requestFingerprint: fingerprint,
      candidateMembershipId: membershipId, candidateMembershipVersion: request.membershipVersion });
    await client.query("commit");
    return writeEnvelope(auditRequest, saved, "Owner-confirmed third-party reference FCFF scenario created.", auditAsOf);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      const replay = await findAuditByIdempotencyKey<ResearchProviderFcffScenarioSetData>(pool,
        request.idempotencyKey, "research_valuation_scenario_created");
      if (replay) {
        if (sameBoundResearchWriteReplay(replay, actor, { ...request, membershipId }, fingerprint))
          return replay.envelope;
        throw new IdempotencyConflictError("provider FCFF key has different semantics");
      }
      throw new ResearchValuationScenarioError(409, "FCFF_CHAIN_CONFLICT", "FCFF revision chain changed");
    }
    throw error;
  } finally { client.release(); }
}

function normalizedMarket(symbol: string): "HK" { if (!symbol.startsWith("HK.")) throw new Error("invalid market"); return "HK"; }

export async function createFcffScenario(pool: Pool, membershipId: string,
  request: CreateResearchFcffScenarioRequest, actor: AuthenticatedResearchActor,
  now = new Date(), store?: SourceSnapshotStoreOptions): Promise<ResearchWriteEnvelope<ResearchFcffScenarioSetData>> {
  const errors = fcffCreateRequestErrors(request);
  if (errors.length) throw new ResearchValuationScenarioError(422, "FCFF_REQUEST_INVALID", errors.join(", "));
  if (request.assumptions.valuationCutoff > currentHongKongDate(now))
    throw new ResearchValuationScenarioError(422, "FCFF_FUTURE_CUTOFF",
      "valuation cutoff cannot be later than the current Hong Kong date");
  const fingerprint = requestFingerprint("research_fcff_scenario_create", { actor, membershipId, request });
  const auditRequest = actorRequest(actor, request.idempotencyKey);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const historicalReplay = await findAuditByIdempotencyKey<ResearchFcffScenarioSetData>(client,
      request.idempotencyKey, "research_valuation_scenario_created");
    if (historicalReplay) {
      if (!sameBoundResearchWriteReplay(historicalReplay, actor, { ...request, membershipId }, fingerprint))
        throw new IdempotencyConflictError("FCFF idempotency key already has different semantics");
      await client.query("commit");
      return historicalReplay.envelope;
    }
    const member = await assertCandidateMembershipWriteBinding(client, actor,
      { membershipId, membershipVersion: request.membershipVersion });
    const normalized = normalizeMarketCode(member.market, member.code);
    if (normalized.symbol !== request.symbol || member.symbol !== request.symbol)
      throw new ResearchValuationScenarioError(409, "SYMBOL_CONFLICT", "candidate membership changed");
    const replay = await findAuditByIdempotencyKey<ResearchFcffScenarioSetData>(client,
      request.idempotencyKey, "research_valuation_scenario_created");
    if (replay) {
      if (!sameBoundResearchWriteReplay(replay, actor, { ...request, membershipId }, fingerprint))
        throw new IdempotencyConflictError("FCFF idempotency key already has different semantics");
      await client.query("commit");
      return replay.envelope;
    }
    const preview = await readFcffSourcePreview(client, membershipId, request.sourceSelection, actor, now, store);
    if (preview.status !== "available" || preview.membershipVersion !== request.membershipVersion
      || preview.symbol !== request.symbol || preview.sourceFingerprint !== request.sourceFingerprint)
      throw new ResearchValuationScenarioError(409, "FCFF_SOURCE_CHANGED",
        "current original facts differ from the Owner-confirmed draft");
    const unpublished = preview.facts.filter((fact) => {
      const publishedDay = fcffPublishedHongKongDay(fact.publishedAt);
      return publishedDay === null || publishedDay > request.assumptions.valuationCutoff;
    });
    if (unpublished.length) throw new ResearchValuationScenarioError(409,
      "FCFF_PUBLICATION_CUTOFF_UNVERIFIED",
      "selected original facts have unknown publication dates or became public after the valuation cutoff");
    if (!fcffAssumptionsMatchSources(request.assumptions, request.bridgeClassification, preview))
      throw new ResearchValuationScenarioError(409, "FCFF_SOURCE_CHANGED",
        "current bridge values differ from the Owner-confirmed draft");
    const calculation = calculateFcffScenario(request.assumptions);
    if (!calculation) throw new ResearchValuationScenarioError(422, "FCFF_NOT_CALCULABLE",
      "forecast, terminal, bridge or sensitivity cannot produce finite common equity value");
    const prior = request.replacesScenarioSetId === null ? null : (await client.query<Row>(
      `${selection()} and vs.id=$4 for update of vs`,
      [membershipId, actor.actorType, actor.actorId, request.replacesScenarioSetId])).rows[0];
    if (request.replacesScenarioSetId !== null && (!prior || prior.scenario_replaced))
      throw new ResearchValuationScenarioError(409, "FCFF_REVISION_CONFLICT",
        "revision must replace the current FCFF scenario");
    if (request.replacesScenarioSetId === null) {
      const current = (await client.query<Row>(`${selection()}
        and not exists(select 1 from research_valuation_scenario_sets child
          where child.replaces_scenario_set_id=vs.id)
        order by vs.id desc limit 1 for update of vs`,
        [membershipId, actor.actorType, actor.actorId])).rows[0];
      if (current) throw new ResearchValuationScenarioError(409, "FCFF_REVISION_REQUIRED",
        "revise the current FCFF scenario to preserve its history");
    }
    const payload: Payload = { methodId: FCFF_METHOD_ID, sourceSelection: request.sourceSelection,
      sourceFingerprint: request.sourceFingerprint, historicalOriginals: preview,
      assumptions: request.assumptions, bridgeClassification: request.bridgeClassification };
    const inserted = await client.query<{ id: string }>(`insert into research_valuation_scenario_sets
      (candidate_membership_id,captured_membership_version,anchor_value_id,replaces_scenario_set_id,
       revision,assumption_payload,calculation_version,calculation_payload,created_at,basis_kind)
      values($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,'issuer') returning id::text`,
      [membershipId, request.membershipVersion,
        prior?.anchor_value_id ?? request.sourceSelection.bridgeValueIds.cashAndEquivalents,
        request.replacesScenarioSetId, prior ? Number(prior.revision) + 1 : 1,
        JSON.stringify(payload), FCFF_CALCULATION_VERSION, JSON.stringify(calculation), now]);
    const data = (await readFcffScenarioSets(client, membershipId, actor, now, store))
      .find((value) => value.id === inserted.rows[0]?.id);
    if (!data?.recomputable) throw new ResearchValuationScenarioError(503, "FCFF_READBACK_FAILED",
      "saved FCFF scenario failed current-source or calculation read-back");
    const stock = await upsertStock(client, normalized.market, normalized.code, normalized.symbol, null);
    const auditAsOf = await insertWriteAudit(client, { eventType: "research_valuation_scenario_created",
      request: auditRequest, stock, targetTable: "research_valuation_scenario_sets", targetId: data.id,
      beforePayload: null, afterPayload: data, requestFingerprint: fingerprint,
      candidateMembershipId: membershipId, candidateMembershipVersion: request.membershipVersion });
    await client.query("commit");
    return writeEnvelope(auditRequest, data, "Owner-confirmed source-bound FCFF scenario created.", auditAsOf);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      const replay = await findAuditByIdempotencyKey<ResearchFcffScenarioSetData>(pool,
        request.idempotencyKey, "research_valuation_scenario_created");
      if (replay) {
        if (sameBoundResearchWriteReplay(replay, actor, { ...request, membershipId }, fingerprint))
          return replay.envelope;
        throw new IdempotencyConflictError("FCFF idempotency key already has different semantics");
      }
      throw new ResearchValuationScenarioError(409, "FCFF_CHAIN_CONFLICT",
        "FCFF anchor already has a root scenario or successor");
    }
    throw error;
  } finally { client.release(); }
}
