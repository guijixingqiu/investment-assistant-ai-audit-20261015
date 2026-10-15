import type { Pool, PoolClient } from "pg";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import {
  buildGclPvPriceAssessment,
  gclPvPriceSafety,
  type CreateGclPvPriceMonitorRequest,
  type GclPvContextObservation,
  type GclPvPriceMonitorData,
  type GclPvPriceObservation,
  type GclPvSourceEvent,
  validateGclPvPriceMonitorData
} from "../../../../packages/contracts/src/gclPvPriceMonitor.js";
import type { ResearchAnnouncementEventData } from "../../../../packages/contracts/src/researchEvent.js";
import type { ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import {
  CandidateMembershipConflictError,
  DeepResearchGateError,
  IdempotencyConflictError,
  type AuthenticatedResearchActor
} from "./domain.js";
import { requestFingerprint } from "./deepResearchGate.js";
import {
  validateCurrentHoldingEventBindings,
  type CurrentHoldingReadOptions
} from "./currentHoldingResearchBinding.js";
import { readResearchEvents } from "./researchEventRepository.js";
import { readCurrentMonitorSourceEvents } from "./monitorSourceEvents.js";
import { assertCandidateMembershipWriteBinding, sameBoundResearchWriteReplay } from "./researchWriteBinding.js";
import {
  actorRequest,
  findAuditByIdempotencyKey,
  insertWriteAudit,
  isUniqueViolation,
  writeEnvelope
} from "./writePersistence.js";

interface MonitorRow {
  id: string;
  run_version: number | string;
  run_fingerprint: string;
  candidate_membership_id: string;
  candidate_membership_version: number | string;
  period: string;
  reference_period: string;
  price_observations_payload: GclPvPriceObservation[];
  context_observations_payload: GclPvContextObservation[];
  assessment_payload: GclPvPriceMonitorData["assessment"];
  created_at: Date | string;
}

interface EventLocatorRow {
  id: string;
  research_profile_id: string;
  candidate_membership_id: string;
  candidate_membership_version: number | string;
}

export async function createGclPvPriceMonitor(
  pool: Pool,
  membershipId: string,
  request: CreateGclPvPriceMonitorRequest,
  actor: AuthenticatedResearchActor,
  holdingOptions: CurrentHoldingReadOptions,
  now = new Date()
): Promise<ResearchWriteEnvelope<GclPvPriceMonitorData>> {
  const normalizedRequest = {
    ...request,
    priceObservations: sorted(request.priceObservations),
    contextObservations: sorted(request.contextObservations)
  };
  const boundRequest = { ...normalizedRequest, membershipId };
  const auditRequest = actorRequest(actor, request.idempotencyKey);
  const auditFingerprint = requestFingerprint("gcl_pv_price_monitor_create", { actor, request: boundRequest });
  const inputFingerprint = requestFingerprint("gcl_pv_price_monitor_input", {
    actor,
    membershipId,
    membershipVersion: normalizedRequest.membershipVersion,
    period: normalizedRequest.period,
    referencePeriod: normalizedRequest.referencePeriod,
    priceObservations: normalizedRequest.priceObservations,
    contextObservations: normalizedRequest.contextObservations
  });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const replay = await findAuditByIdempotencyKey<GclPvPriceMonitorData>(client, request.idempotencyKey, "gcl_pv_price_monitor_created");
    if (replay) {
      if (!sameBoundResearchWriteReplay(replay, actor, boundRequest, auditFingerprint)) throw idempotencyConflict();
      assertCurrentMonitor(replay.envelope.data, now);
      await assertCurrentSources(client, replay.envelope.data, holdingOptions, now);
      await client.query("commit");
      return replay.envelope;
    }
    const membership = await assertCandidateMembershipWriteBinding(client, actor, boundRequest);
    if (membership.state !== "tracked" || membership.symbol !== "HK.03800") {
      throw new CandidateMembershipConflictError("GCL photovoltaic monitoring requires the tracked HK.03800 candidate");
    }
    if (normalizedRequest.period > now.toISOString().slice(0, 10)) {
      throw new DeepResearchGateError("GCL photovoltaic monitor period cannot be in the future");
    }
    const profile = await lockProfile(client, membership.market, membership.code);
    if (!profile || !profile.key_variables.includes("polysilicon_price")) {
      throw new DeepResearchGateError("GCL research profile must register polysilicon_price");
    }
    const inputs = [...normalizedRequest.priceObservations, ...normalizedRequest.contextObservations];
    const events = await readAuthorizedEvents(client, inputs.map((item) => item.eventId), actor, now);
    const eventById = new Map(events.map((event) => [event.id, event]));
    validateSourceBindings(normalizedRequest, eventById, membership.symbol, membershipId);
    await assertCurrentHoldingEventBindings(client, events, holdingOptions, now);
    const priceObservations = normalizedRequest.priceObservations.map((item): GclPvPriceObservation => ({
      ...item,
      normalizedCnyPerWatt: round(item.value * item.conversionFactorToCnyPerWatt),
      sourceEvent: sourceEvent(eventById.get(item.eventId)!)
    }));
    const contextObservations = normalizedRequest.contextObservations.map((item): GclPvContextObservation => ({
      ...item,
      sourceEvent: sourceEvent(eventById.get(item.eventId)!)
    }));
    const assessment = buildGclPvPriceAssessment(
      priceObservations,
      contextObservations,
      normalizedRequest.period,
      normalizedRequest.referencePeriod
    );
    const runVersion = await nextRunVersion(client, profile.id);
    const identity = {
      runVersion,
      membershipId,
      membershipVersion: normalizedRequest.membershipVersion,
      market: "HK" as const,
      code: "03800" as const,
      symbol: "HK.03800" as const,
      period: normalizedRequest.period,
      referencePeriod: normalizedRequest.referencePeriod,
      priceObservations,
      contextObservations,
      assessment
    };
    const runFingerprint = gclPvPriceMonitorFingerprint(identity);
    const inserted = await client.query<{ id: string; created_at: Date | string }>(
      `insert into gcl_pv_price_monitor_runs
        (research_profile_id, candidate_membership_id, candidate_membership_version, run_version,
         period, reference_period, input_fingerprint, run_fingerprint, source_event_ids,
         price_observations_payload, context_observations_payload, assessment_payload)
       values ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9::bigint[], $10::jsonb, $11::jsonb, $12::jsonb)
       returning id, created_at`,
      [
        profile.id, membershipId, normalizedRequest.membershipVersion, runVersion,
        normalizedRequest.period, normalizedRequest.referencePeriod, inputFingerprint, runFingerprint,
        [...eventById.keys()], JSON.stringify(priceObservations), JSON.stringify(contextObservations),
        JSON.stringify(assessment)
      ]
    );
    const data: GclPvPriceMonitorData = {
      id: String(inserted.rows[0].id),
      runFingerprint,
      ...identity,
      createdAt: iso(inserted.rows[0].created_at),
      safety: gclPvPriceSafety()
    };
    assertCurrentMonitor(data, now);
    const auditAsOf = await insertWriteAudit(client, {
      eventType: "gcl_pv_price_monitor_created",
      request: auditRequest,
      stock: { id: profile.stock_id, market: membership.market, code: membership.code, symbol: membership.symbol },
      targetTable: "gcl_pv_price_monitor_runs",
      targetId: data.id,
      beforePayload: null,
      afterPayload: data,
      requestFingerprint: auditFingerprint,
      candidateMembershipId: membershipId,
      candidateMembershipVersion: normalizedRequest.membershipVersion
    });
    await client.query("commit");
    return writeEnvelope(auditRequest, data, `GCL photovoltaic price monitor ${data.id} created.`, auditAsOf);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      const replay = await findAuditByIdempotencyKey<GclPvPriceMonitorData>(pool, request.idempotencyKey, "gcl_pv_price_monitor_created");
      if (replay && sameBoundResearchWriteReplay(replay, actor, boundRequest, auditFingerprint)) {
        assertCurrentMonitor(replay.envelope.data, now);
        await assertCurrentSources(pool, replay.envelope.data, holdingOptions, now);
        return replay.envelope;
      }
      throw idempotencyConflict();
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function readLatestGclPvPriceMonitor(
  client: Pick<Pool | PoolClient, "query">,
  profileId: string,
  membershipId: string,
  membershipVersion: number,
  holdingOptions: CurrentHoldingReadOptions | null,
  now = new Date()
): Promise<GclPvPriceMonitorData | null> {
  const result = await client.query<MonitorRow>(
    `select id, run_version, run_fingerprint, candidate_membership_id,
            candidate_membership_version, period::text, reference_period::text,
            price_observations_payload, context_observations_payload,
            assessment_payload, created_at
       from gcl_pv_price_monitor_runs
      where research_profile_id = $1
        and candidate_membership_id = $2
        and candidate_membership_version = $3
      order by run_version desc, id desc
      limit 1`,
    [profileId, membershipId, membershipVersion]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  const identity = {
    runVersion: Number(row.run_version),
    membershipId: String(row.candidate_membership_id),
    membershipVersion: Number(row.candidate_membership_version),
    market: "HK" as const,
    code: "03800" as const,
    symbol: "HK.03800" as const,
    period: row.period,
    referencePeriod: row.reference_period,
    priceObservations: row.price_observations_payload,
    contextObservations: row.context_observations_payload,
    assessment: row.assessment_payload
  };
  const data: GclPvPriceMonitorData = {
    id: String(row.id),
    runFingerprint: row.run_fingerprint,
    ...identity,
    createdAt: iso(row.created_at),
    safety: gclPvPriceSafety()
  };
  assertCurrentMonitor(data, now);
  await assertCurrentSources(client, data, holdingOptions, now);
  return data;
}

export function gclPvPriceMonitorFingerprint(
  identity: Omit<GclPvPriceMonitorData, "id" | "runFingerprint" | "createdAt" | "safety">
): string {
  return requestFingerprint("gcl_pv_price_monitor_identity", identity);
}

async function readAuthorizedEvents(
  client: PoolClient,
  eventIds: string[],
  actor: AuthenticatedResearchActor,
  now: Date
): Promise<ResearchAnnouncementEventData[]> {
  const ids = [...new Set(eventIds)];
  const locators = await client.query<EventLocatorRow>(
    `select re.id, re.research_profile_id, re.candidate_membership_id, re.candidate_membership_version
       from research_events re
       join candidate_memberships cm on cm.id = re.candidate_membership_id
      where re.id = any($1::bigint[])
        and cm.actor_type = $2
        and cm.actor_id = $3`,
    [ids, actor.actorType, actor.actorId]
  );
  if (locators.rows.length !== ids.length) throw new DeepResearchGateError("one or more GCL source events are missing or unauthorized");
  const groups = new Map<string, EventLocatorRow>();
  for (const row of locators.rows) groups.set(`${row.research_profile_id}:${row.candidate_membership_id}:${row.candidate_membership_version}`, row);
  const events: ResearchAnnouncementEventData[] = [];
  // ponytail: bounded Local Beta N+1 (max 150 source rows); batch SQL only if measured source volume grows.
  for (const row of groups.values()) {
    events.push(...await readResearchEvents(client, row.research_profile_id, row.candidate_membership_id, Number(row.candidate_membership_version), now));
  }
  const requested = new Set(ids);
  return events.filter((event) => requested.has(event.id));
}

function validateSourceBindings(
  request: CreateGclPvPriceMonitorRequest,
  events: Map<string, ResearchAnnouncementEventData>,
  targetSymbol: string,
  membershipId: string
): void {
  const expected = [
    ...request.priceObservations.map((item) => ({ eventId: item.eventId, variable: `${item.stage}_price` })),
    ...request.contextObservations.map((item) => ({ eventId: item.eventId, variable: item.metric }))
  ];
  for (const input of expected) {
    const event = events.get(input.eventId);
    if (!event || event.symbol !== targetSymbol || event.membershipId !== membershipId
      || event.membershipVersion !== request.membershipVersion || event.coverageScope !== "current_holding"
      || !event.holdingBinding || event.source.freshness !== "fresh"
      || event.source.revisionState !== "current" || event.source.verificationStatus !== "verified"
      || !["user_provided", "authorized_public"].includes(event.source.rightsStatus)
      || event.keyVariable !== input.variable) {
      throw new DeepResearchGateError(`GCL observation ${input.variable} lacks a current eligible HK.03800 source event`);
    }
  }
}

function sourceEvent(event: ResearchAnnouncementEventData): GclPvSourceEvent {
  return {
    eventId: event.id,
    eventVersion: event.eventVersion,
    eventFingerprint: event.eventFingerprint,
    symbol: event.symbol,
    eventKind: event.eventKind,
    coverageScope: "current_holding",
    holdingBinding: event.holdingBinding!,
    materialId: event.source.materialId,
    materialFingerprint: event.source.contentFingerprint,
    sourceType: event.source.sourceType,
    sourceUrl: event.source.sourceUrl,
    publishedAt: event.source.publishedAt,
    capturedAt: event.source.capturedAt,
    validUntil: event.source.validUntil,
    rightsStatus: event.source.rightsStatus as GclPvSourceEvent["rightsStatus"],
    verificationStatus: "verified",
    sourceVersion: event.source.sourceVersion,
    revision: event.source.revision,
    keyVariable: event.keyVariable,
    hypothesisImpact: event.hypothesisImpact
  };
}

function assertCurrentMonitor(data: GclPvPriceMonitorData, now: Date): void {
  const { id: _id, runFingerprint, createdAt: _createdAt, safety: _safety, ...identity } = data;
  const validation = validateGclPvPriceMonitorData(data);
  if (!validation.ok || gclPvPriceMonitorFingerprint(identity) !== runFingerprint) {
    throw new DeepResearchGateError(`GCL photovoltaic monitor ${data.id} failed content-address verification`, validation.ok ? [] : validation.errors);
  }
  if ([...data.priceObservations, ...data.contextObservations].some((item) => Date.parse(item.sourceEvent.validUntil) <= now.getTime())) {
    throw new DeepResearchGateError(`GCL photovoltaic monitor ${data.id} has stale source evidence`);
  }
}

async function assertCurrentSources(
  client: Pick<Pool | PoolClient, "query">,
  data: GclPvPriceMonitorData,
  holdingOptions: CurrentHoldingReadOptions | null,
  now: Date
): Promise<void> {
  const inputs = [...data.priceObservations, ...data.contextObservations];
  const events = await readCurrentMonitorSourceEvents(client, inputs.map((item) => item.eventId), now);
  if (inputs.some((item) => canonicalJson(sourceEvent(events.get(item.eventId)!)) !== canonicalJson(item.sourceEvent))) {
    throw new DeepResearchGateError(`GCL photovoltaic monitor ${data.id} source event revision no longer matches`);
  }
  if (holdingOptions) {
    await assertCurrentHoldingEventBindings(client, [...events.values()], holdingOptions, now);
  }
}

async function assertCurrentHoldingEventBindings(
  client: Pick<Pool | PoolClient, "query">,
  events: ResearchAnnouncementEventData[],
  options: CurrentHoldingReadOptions,
  now: Date
): Promise<void> {
  const failure = await validateCurrentHoldingEventBindings(client, events, options, now);
  if (failure) throw new DeepResearchGateError(failure.message);
}

async function lockProfile(client: PoolClient, market: string, code: string): Promise<{ id: string; stock_id: string; key_variables: string[] } | null> {
  const result = await client.query<{ id: string; stock_id: string; key_variables: string[] }>(
    "select id, stock_id, key_variables from research_profiles where market = $1 and code = $2 for update",
    [market, code]
  );
  return result.rows[0] ?? null;
}

async function nextRunVersion(client: PoolClient, profileId: string): Promise<number> {
  const result = await client.query<{ version: number | string }>(
    "select coalesce(max(run_version), 0) + 1 as version from gcl_pv_price_monitor_runs where research_profile_id = $1",
    [profileId]
  );
  return Number(result.rows[0].version);
}

function sorted<T>(items: T[]): T[] { return [...items].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))); }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000; }
function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function idempotencyConflict(): IdempotencyConflictError { return new IdempotencyConflictError("idempotency key or GCL photovoltaic price input already exists with different facts"); }
