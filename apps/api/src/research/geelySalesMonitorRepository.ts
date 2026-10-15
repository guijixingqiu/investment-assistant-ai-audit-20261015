import type { Pool, PoolClient } from "pg";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import {
  buildGeelySalesAssessment,
  geelySalesSafety,
  type CreateGeelySalesMonitorRequest,
  type GeelySalesMonitorData,
  type GeelySalesObservation,
  type GeelySalesSourceEvent,
  validateGeelySalesMonitorData
} from "../../../../packages/contracts/src/geelySalesMonitor.js";
import type { ResearchAnnouncementEventData } from "../../../../packages/contracts/src/researchEvent.js";
import type { ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import {
  CandidateMembershipConflictError,
  DeepResearchGateError,
  IdempotencyConflictError,
  type AuthenticatedResearchActor
} from "./domain.js";
import {
  validateCurrentHoldingEventBindings,
  type CurrentHoldingReadOptions
} from "./currentHoldingResearchBinding.js";
import { requestFingerprint } from "./deepResearchGate.js";
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
  observations_payload: GeelySalesObservation[];
  assessment_payload: GeelySalesMonitorData["assessment"];
  created_at: Date | string;
}

interface EventLocatorRow {
  id: string;
  research_profile_id: string;
  candidate_membership_id: string;
  candidate_membership_version: number | string;
}

export async function createGeelySalesMonitor(
  pool: Pool,
  membershipId: string,
  request: CreateGeelySalesMonitorRequest,
  actor: AuthenticatedResearchActor,
  holdingOptions: CurrentHoldingReadOptions,
  now = new Date()
): Promise<ResearchWriteEnvelope<GeelySalesMonitorData>> {
  const normalizedRequest = {
    ...request,
    observations: [...request.observations].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
  };
  const boundRequest = { ...normalizedRequest, membershipId };
  const auditRequest = actorRequest(actor, request.idempotencyKey);
  const auditFingerprint = requestFingerprint("geely_sales_monitor_create", { actor, request: boundRequest });
  const inputFingerprint = requestFingerprint("geely_sales_monitor_input", {
    actor,
    membershipId,
    membershipVersion: normalizedRequest.membershipVersion,
    period: normalizedRequest.period,
    observations: normalizedRequest.observations
  });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const replay = await findAuditByIdempotencyKey<GeelySalesMonitorData>(client, request.idempotencyKey, "geely_sales_monitor_created");
    if (replay) {
      if (!sameBoundResearchWriteReplay(replay, actor, boundRequest, auditFingerprint)) throw idempotencyConflict();
      assertCurrentMonitor(replay.envelope.data, now);
      await assertCurrentSources(client, replay.envelope.data, holdingOptions, now);
      await client.query("commit");
      return replay.envelope;
    }
    const membership = await assertCandidateMembershipWriteBinding(client, actor, boundRequest);
    if (membership.state !== "tracked" || membership.symbol !== "HK.00175") {
      throw new CandidateMembershipConflictError("Geely sales monitoring requires the tracked HK.00175 candidate");
    }
    if (normalizedRequest.period > now.toISOString().slice(0, 7)) {
      throw new DeepResearchGateError("Geely sales monitor period cannot be in the future");
    }
    const profile = await lockProfile(client, membership.market, membership.code);
    if (!profile || !profile.key_variables.includes("new_energy_vehicle_sales")) {
      throw new DeepResearchGateError("Geely research profile must register new_energy_vehicle_sales");
    }
    const events = await readAuthorizedEvents(client, normalizedRequest.observations.map((item) => item.eventId), actor, now);
    const eventById = new Map(events.map((event) => [event.id, event]));
    validateSourceBindings(normalizedRequest, eventById, membership.symbol, membershipId);
    await assertCurrentHoldingEventBindings(client, events, holdingOptions, now);
    const observations = normalizedRequest.observations.map((item): GeelySalesObservation => ({
      ...item,
      sourceEvent: sourceEvent(eventById.get(item.eventId)!)
    }));
    const assessment = buildGeelySalesAssessment(observations, normalizedRequest.period);
    const runVersion = await nextRunVersion(client, profile.id);
    const identity = {
      runVersion,
      membershipId,
      membershipVersion: normalizedRequest.membershipVersion,
      market: "HK" as const,
      code: "00175" as const,
      symbol: "HK.00175" as const,
      period: normalizedRequest.period,
      observations,
      assessment
    };
    const runFingerprint = geelySalesMonitorFingerprint(identity);
    const inserted = await client.query<{ id: string; created_at: Date | string }>(
      `insert into geely_sales_monitor_runs
        (research_profile_id, candidate_membership_id, candidate_membership_version, run_version,
         period, input_fingerprint, run_fingerprint, source_event_ids, observations_payload, assessment_payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8::bigint[], $9::jsonb, $10::jsonb)
       returning id, created_at`,
      [
        profile.id, membershipId, normalizedRequest.membershipVersion, runVersion, normalizedRequest.period,
        inputFingerprint, runFingerprint, [...eventById.keys()],
        JSON.stringify(observations), JSON.stringify(assessment)
      ]
    );
    const data: GeelySalesMonitorData = {
      id: String(inserted.rows[0].id),
      runFingerprint,
      ...identity,
      createdAt: iso(inserted.rows[0].created_at),
      safety: geelySalesSafety()
    };
    assertCurrentMonitor(data, now);
    const auditAsOf = await insertWriteAudit(client, {
      eventType: "geely_sales_monitor_created",
      request: auditRequest,
      stock: { id: profile.stock_id, market: membership.market, code: membership.code, symbol: membership.symbol },
      targetTable: "geely_sales_monitor_runs",
      targetId: data.id,
      beforePayload: null,
      afterPayload: data,
      requestFingerprint: auditFingerprint,
      candidateMembershipId: membershipId,
      candidateMembershipVersion: normalizedRequest.membershipVersion
    });
    await client.query("commit");
    return writeEnvelope(auditRequest, data, `Geely sales monitor ${data.id} created.`, auditAsOf);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      const replay = await findAuditByIdempotencyKey<GeelySalesMonitorData>(pool, request.idempotencyKey, "geely_sales_monitor_created");
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

export async function readLatestGeelySalesMonitor(
  client: Pick<Pool | PoolClient, "query">,
  profileId: string,
  membershipId: string,
  membershipVersion: number,
  holdingOptions: CurrentHoldingReadOptions | null,
  now = new Date()
): Promise<GeelySalesMonitorData | null> {
  const result = await client.query<MonitorRow>(
    `select id, run_version, run_fingerprint, candidate_membership_id,
            candidate_membership_version, period, observations_payload,
            assessment_payload, created_at
       from geely_sales_monitor_runs
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
    code: "00175" as const,
    symbol: "HK.00175" as const,
    period: row.period,
    observations: row.observations_payload,
    assessment: row.assessment_payload
  };
  const data: GeelySalesMonitorData = {
    id: String(row.id),
    runFingerprint: row.run_fingerprint,
    ...identity,
    createdAt: iso(row.created_at),
    safety: geelySalesSafety()
  };
  assertCurrentMonitor(data, now);
  await assertCurrentSources(client, data, holdingOptions, now);
  return data;
}

export function geelySalesMonitorFingerprint(
  identity: Omit<GeelySalesMonitorData, "id" | "runFingerprint" | "createdAt" | "safety">
): string {
  return requestFingerprint("geely_sales_monitor_identity", identity);
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
  if (locators.rows.length !== ids.length) throw new DeepResearchGateError("one or more sales source events are missing or unauthorized");
  const groups = new Map<string, EventLocatorRow>();
  for (const row of locators.rows) groups.set(`${row.research_profile_id}:${row.candidate_membership_id}:${row.candidate_membership_version}`, row);
  const events: ResearchAnnouncementEventData[] = [];
  // ponytail: bounded Local Beta N+1 (max 200 source rows); batch SQL only if measured source volume grows.
  for (const row of groups.values()) {
    events.push(...await readResearchEvents(client, row.research_profile_id, row.candidate_membership_id, Number(row.candidate_membership_version), now));
  }
  const requested = new Set(ids);
  return events.filter((event) => requested.has(event.id));
}

function validateSourceBindings(
  request: CreateGeelySalesMonitorRequest,
  events: Map<string, ResearchAnnouncementEventData>,
  targetSymbol: string,
  membershipId: string
): void {
  const symbolsByEntity = new Map<string, Set<string>>();
  const entitiesBySymbol = new Map<string, Set<string>>();
  const targetIssuers = new Set(request.observations.filter((item) => item.entityRole === "target").map((item) => item.issuerId));
  if (targetIssuers.size !== 1 || targetIssuers.has(null)) {
    throw new DeepResearchGateError("all target observations must bind one Geely issuer identity");
  }
  for (const observation of request.observations) {
    const event = events.get(observation.eventId);
    if (!event || event.source.freshness !== "fresh" || event.source.revisionState !== "current"
      || event.source.verificationStatus !== "verified"
      || !["user_provided", "authorized_public"].includes(event.source.rightsStatus)
      || event.keyVariable !== "new_energy_vehicle_sales"
      || event.coverageScope !== "research_stock") {
      throw new DeepResearchGateError(`sales observation ${observation.entityId} lacks a current eligible source event`);
    }
    if (observation.entityRole === "target" && (
      event.symbol !== targetSymbol
      || event.membershipId !== membershipId
      || event.membershipVersion !== request.membershipVersion
    )) {
      throw new DeepResearchGateError("target observations must bind the requested HK.00175 candidate membership version");
    }
    if (observation.entityRole === "peer" && event.symbol === targetSymbol) {
      throw new DeepResearchGateError("peer observations must bind a non-target security event");
    }
    if (observation.entityRole !== "industry") {
      const symbols = symbolsByEntity.get(observation.issuerId!) ?? new Set<string>();
      symbols.add(event.symbol);
      symbolsByEntity.set(observation.issuerId!, symbols);
      const entities = entitiesBySymbol.get(event.symbol) ?? new Set<string>();
      entities.add(observation.issuerId!);
      entitiesBySymbol.set(event.symbol, entities);
    }
  }
  if ([...symbolsByEntity].some(([, symbols]) => symbols.size !== 1)) {
    throw new DeepResearchGateError("one issuer cannot mix source-event security identities");
  }
  if ([...entitiesBySymbol].some(([, entities]) => entities.size !== 1)) {
    throw new DeepResearchGateError("one security source cannot represent multiple issuer identities");
  }
}

function sourceEvent(event: ResearchAnnouncementEventData): GeelySalesSourceEvent {
  return {
    eventId: event.id,
    eventVersion: event.eventVersion,
    eventFingerprint: event.eventFingerprint,
    symbol: event.symbol,
    eventKind: event.eventKind,
    materialId: event.source.materialId,
    materialFingerprint: event.source.contentFingerprint,
    sourceType: event.source.sourceType,
    sourceUrl: event.source.sourceUrl,
    publishedAt: event.source.publishedAt,
    capturedAt: event.source.capturedAt,
    validUntil: event.source.validUntil,
    rightsStatus: event.source.rightsStatus as GeelySalesSourceEvent["rightsStatus"],
    verificationStatus: "verified",
    sourceVersion: event.source.sourceVersion,
    revision: event.source.revision,
    keyVariable: event.keyVariable,
    hypothesisImpact: event.hypothesisImpact
  };
}

function assertCurrentMonitor(data: GeelySalesMonitorData, now: Date): void {
  const { id: _id, runFingerprint, createdAt: _createdAt, safety: _safety, ...identity } = data;
  const validation = validateGeelySalesMonitorData(data);
  if (!validation.ok || geelySalesMonitorFingerprint(identity) !== runFingerprint) {
    throw new DeepResearchGateError(`Geely sales monitor ${data.id} failed content-address verification`, validation.ok ? [] : validation.errors);
  }
  if (data.observations.some((item) => Date.parse(item.sourceEvent.validUntil) <= now.getTime())) {
    throw new DeepResearchGateError(`Geely sales monitor ${data.id} has stale source evidence`);
  }
}

async function assertCurrentSources(
  client: Pick<Pool | PoolClient, "query">,
  data: GeelySalesMonitorData,
  holdingOptions: CurrentHoldingReadOptions | null,
  now: Date
): Promise<void> {
  const events = await readCurrentMonitorSourceEvents(client, data.observations.map((item) => item.eventId), now);
  if ([...events.values()].some((event) => event.coverageScope !== "research_stock")) {
    throw new DeepResearchGateError(`Geely sales monitor ${data.id} contains a non-research-stock source event`);
  }
  if (data.observations.some((item) => canonicalJson(sourceEvent(events.get(item.eventId)!)) !== canonicalJson(item.sourceEvent))) {
    throw new DeepResearchGateError(`Geely sales monitor ${data.id} source event revision no longer matches`);
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
    "select coalesce(max(run_version), 0) + 1 as version from geely_sales_monitor_runs where research_profile_id = $1",
    [profileId]
  );
  return Number(result.rows[0].version);
}

function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function idempotencyConflict(): IdempotencyConflictError { return new IdempotencyConflictError("idempotency key or Geely sales input already exists with different facts"); }
