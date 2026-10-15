import type { Pool, PoolClient } from "pg";
import {
  deriveResearchEventAssessment,
  researchEventMonitorRuleBindingMatchesCurrent,
  type CreateResearchEventRequest,
  type ResearchAnnouncementEventData,
  type ResearchEventHoldingBinding,
  type ResearchEventKind,
  type ResearchEventMonitorRuleBinding,
  type ResearchEventSource
} from "../../../../packages/contracts/src/researchEvent.js";
import { researchMonitorRuleErrors, type ResearchMonitorRule } from "../../../../packages/contracts/src/researchMonitorRule.js";
import { validatePinganCurrentPortfolioEnvelope } from "../../../../packages/contracts/src/pinganCurrentPortfolio.js";
import type { ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import { OWNER_VERIFIED_HOLDING_LOGIC_SOURCE_TYPE } from "../../../../packages/contracts/src/researchMaterial.js";
import { readPinganCurrentPortfolioEnvelope } from "../portfolio/pinganCurrentPortfolioRepository.js";
import { evidencePackBlockers, requestFingerprint } from "./deepResearchGate.js";
import { readResearchMaterials } from "./deepResearchPersistence.js";
import {
  CandidateMembershipConflictError,
  DeepResearchGateError,
  IdempotencyConflictError,
  type AuthenticatedResearchActor
} from "./domain.js";
import { assertCandidateMembershipWriteBinding, sameBoundResearchWriteReplay } from "./researchWriteBinding.js";
import {
  actorRequest,
  findAuditByIdempotencyKey,
  insertWriteAudit,
  isUniqueViolation,
  writeEnvelope
} from "./writePersistence.js";

interface ResearchEventOptions {
  now?: Date;
  pinganCurrentPortfolioEnabled: boolean;
  pinganCurrentMaxAgeSeconds: number;
  accountScopeId: string | null;
}

interface ResearchEventRow {
  id: string;
  event_version: number | string;
  event_fingerprint: string;
  candidate_membership_id: string;
  candidate_membership_version: number | string;
  market: "HK";
  code: string;
  symbol: string;
  event_kind: ResearchEventKind;
  coverage_scope: "research_stock" | "current_holding";
  key_variable: string;
  importance: "unknown" | "low" | "medium" | "high";
  importance_reasons: string[];
  hypothesis_impact: "supports" | "weakens" | "unknown";
  monitor_rule_binding: ResearchEventMonitorRuleBinding | null;
  holding_binding: ResearchEventHoldingBinding | null;
  created_at: Date | string;
  material_id: string;
  evidence_id: string;
  source_type: string;
  source_url: string | null;
  published_at: Date | string;
  captured_at: Date | string;
  claim_type: ResearchEventSource["claimType"];
  verification_status: ResearchEventSource["verificationStatus"];
  rights_status: ResearchEventSource["rightsStatus"];
  source_version: string;
  content_fingerprint: string;
  valid_until: Date | string;
  revision: number | string;
  revision_state: "current" | "replaced";
  variable_name: string;
  stance: ResearchEventSource["stance"];
  reliability: number | null;
  materiality: number | null;
}

export async function createResearchEvent(
  pool: Pool,
  membershipId: string,
  request: CreateResearchEventRequest,
  actor: AuthenticatedResearchActor,
  options: ResearchEventOptions
): Promise<ResearchWriteEnvelope<ResearchAnnouncementEventData>> {
  const now = options.now ?? new Date();
  const boundRequest = { ...request, membershipId };
  const auditRequest = actorRequest(actor, request.idempotencyKey);
  const auditFingerprint = requestFingerprint("research_event_create", {
    actor,
    accountScopeId: options.accountScopeId,
    request: boundRequest
  });
  const client = await pool.connect();
  try {
    await client.query("begin");
    let replay = await findAuditByIdempotencyKey<ResearchAnnouncementEventData>(client, request.idempotencyKey, "research_event_created");
    if (replay) {
      if (!sameBoundResearchWriteReplay(replay, actor, boundRequest, auditFingerprint)) throw idempotencyConflict();
      await client.query("commit");
      return replay.envelope;
    }
    const membership = await assertCandidateMembershipWriteBinding(client, actor, boundRequest);
    replay = await findAuditByIdempotencyKey<ResearchAnnouncementEventData>(client, request.idempotencyKey, "research_event_created");
    if (replay) {
      if (!sameBoundResearchWriteReplay(replay, actor, boundRequest, auditFingerprint)) throw idempotencyConflict();
      await client.query("commit");
      return replay.envelope;
    }
    if (request.coverageScope === "research_stock" && membership.state !== "tracked") {
      throw new CandidateMembershipConflictError("research-stock events require a tracked candidate membership");
    }
    const profile = await lockResearchProfile(client, membership.market, membership.code);
    if (!profile) throw new DeepResearchGateError("research profile is missing for the selected candidate");
    const material = (await readResearchMaterials(client, profile.id, membershipId, now))
      .find((item) => item.id === request.materialId);
    if (!material) throw new DeepResearchGateError("event material is missing from the selected research profile");
    const failures = eventMaterialFailures(material, profile.key_variables, request.coverageScope, now);
    if (failures.length) throw new DeepResearchGateError("event material is not eligible", failures);
    const source = sourceFromMaterial(material);
    const monitorRuleBinding = resolveMonitorRuleBinding(request, profile, source.variableName);
    const holdingBinding = request.coverageScope === "current_holding"
      ? await currentHoldingBinding(client, membership.symbol, options, now)
      : null;
    const assessment = deriveResearchEventAssessment(source, request.eventKind, request.coverageScope);
    const eventVersion = await nextEventVersion(client, profile.id);
    const identity = {
      eventVersion,
      membershipId,
      membershipVersion: request.membershipVersion,
      market: "HK" as const,
      code: membership.code,
      symbol: membership.symbol,
      eventKind: request.eventKind,
      coverageScope: request.coverageScope,
      keyVariable: source.variableName,
      ...assessment,
      source,
      monitorRuleBinding,
      holdingBinding
    };
    const eventFingerprint = researchEventFingerprint(identity);
    const inserted = await client.query<{ id: string; created_at: Date | string }>(
      `insert into research_events
        (research_profile_id, material_id, candidate_membership_id, candidate_membership_version,
         event_version, event_kind, coverage_scope, key_variable, importance, importance_reasons,
         hypothesis_impact, event_fingerprint, monitor_rule_binding, holding_binding)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text[], $11, $12, $13::jsonb, $14::jsonb)
       returning id, created_at`,
      [
        profile.id, material.id, membershipId, request.membershipVersion, eventVersion,
        request.eventKind, request.coverageScope, source.variableName, assessment.importance,
        assessment.importanceReasons, assessment.hypothesisImpact, eventFingerprint,
        monitorRuleBinding === null ? null : JSON.stringify(monitorRuleBinding),
        holdingBinding === null ? null : JSON.stringify(holdingBinding)
      ]
    );
    const data: ResearchAnnouncementEventData = {
      id: String(inserted.rows[0].id),
      eventFingerprint,
      ...identity,
      createdAt: iso(inserted.rows[0].created_at),
      safety: eventSafety()
    };
    const auditAsOf = await insertWriteAudit(client, {
      eventType: "research_event_created",
      request: auditRequest,
      stock: { id: profile.stock_id, market: membership.market, code: membership.code, symbol: membership.symbol },
      targetTable: "research_events",
      targetId: data.id,
      beforePayload: null,
      afterPayload: data,
      requestFingerprint: auditFingerprint,
      candidateMembershipId: membershipId,
      candidateMembershipVersion: request.membershipVersion
    });
    await client.query("commit");
    return writeEnvelope(auditRequest, data, `Research event ${data.id} for ${membership.symbol} created.`, auditAsOf);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      const replay = await findAuditByIdempotencyKey<ResearchAnnouncementEventData>(pool, request.idempotencyKey, "research_event_created");
      if (replay && sameBoundResearchWriteReplay(replay, actor, boundRequest, auditFingerprint)) return replay.envelope;
      throw idempotencyConflict();
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function readResearchEvents(
  client: Pick<Pool | PoolClient, "query">,
  profileId: string,
  membershipId: string,
  membershipVersion: number,
  now: Date
): Promise<ResearchAnnouncementEventData[]> {
  const result = await client.query<ResearchEventRow>(
    `select re.id, re.event_version, re.event_fingerprint, re.candidate_membership_id,
            re.candidate_membership_version, rp.market, rp.code, rp.symbol, re.event_kind,
            re.coverage_scope, re.key_variable, re.importance, re.importance_reasons,
            re.hypothesis_impact, re.monitor_rule_binding, re.holding_binding, re.created_at,
            rm.id as material_id, ei.id as evidence_id, ei.source_type, ei.source_url,
            ei.published_at, ei.captured_at, rm.claim_type, rm.verification_status,
            rm.rights_status, rm.source_version, rm.content_fingerprint, rm.valid_until,
            rm.revision,
            case when exists (
              select 1 from research_materials child where child.replaces_material_id = rm.id
            ) then 'replaced' else 'current' end as revision_state,
            ei.variable_name, ei.stance, ei.reliability, ei.materiality
       from research_events re
       join research_profiles rp on rp.id = re.research_profile_id
       join research_materials rm on rm.id = re.material_id
       join evidence_items ei on ei.id = rm.evidence_item_id
      where re.research_profile_id = $1
        and re.candidate_membership_id = $2
        and re.candidate_membership_version = $3
        and rm.deleted_at is null
        and (rm.candidate_membership_id = re.candidate_membership_id
          or (rm.candidate_membership_id is null and rm.rights_status <> 'user_provided'))
      order by re.event_version asc, re.id asc`,
    [profileId, membershipId, membershipVersion]
  );
  return result.rows.map((row) => {
    const data = rowToResearchEvent(row, now);
    if (researchEventFingerprint(identityFromEvent(data)) !== data.eventFingerprint) {
      throw new DeepResearchGateError(`research event ${data.id} failed content-address verification`);
    }
    return data;
  });
}

export function researchEventFingerprint(
  identity: Omit<ResearchAnnouncementEventData, "id" | "eventFingerprint" | "createdAt" | "safety">
): string {
  const { freshness: _freshness, revisionState: _revisionState, ...source } = identity.source;
  const { monitorRuleBinding, ...event } = identity;
  return requestFingerprint("research_event_identity", monitorRuleBinding === null
    ? { ...event, source }
    : { ...event, source, monitorRuleBinding });
}

function eventMaterialFailures(
  material: Awaited<ReturnType<typeof readResearchMaterials>>[number],
  keyVariables: string[],
  coverageScope: CreateResearchEventRequest["coverageScope"],
  now: Date
): string[] {
  const failures = evidencePackBlockers([material], now);
  if (material.verificationStatus !== "verified") failures.push("event material is not verified");
  if (material.revisionState !== "current") failures.push("event material has been replaced");
  if (material.claimType === "model_inference") failures.push("model inference cannot be used as raw event evidence");
  if ((coverageScope === "current_holding") !== (material.sourceType === OWNER_VERIFIED_HOLDING_LOGIC_SOURCE_TYPE)) {
    failures.push("event material source type does not match its coverage scope");
  }
  if (!material.variableName) failures.push("event material must bind a key research variable");
  else if (!keyVariables.includes(material.variableName)) failures.push(`event variable ${material.variableName} is not registered on the research profile`);
  return [...new Set(failures)];
}

async function currentHoldingBinding(
  client: PoolClient,
  symbol: string,
  options: ResearchEventOptions,
  now: Date
): Promise<ResearchEventHoldingBinding> {
  if (!options.pinganCurrentPortfolioEnabled || !options.accountScopeId) {
    throw new DeepResearchGateError("current-holding event requires the enabled account-scoped Pingan Local Beta source");
  }
  const portfolio = await readPinganCurrentPortfolioEnvelope(client, {
    accountScopeId: options.accountScopeId,
    tradingMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds,
    now
  });
  if (!validatePinganCurrentPortfolioEnvelope(portfolio).ok || portfolio.status !== "current"
    || !portfolio.snapshotId || !portfolio.sourceBatchId || !portfolio.sourceAsOf || !portfolio.accountScopeId) {
    throw new DeepResearchGateError(`current-holding source is not current and valid (${portfolio.status})`);
  }
  const position = portfolio.positions.find((item) => item.symbol === symbol);
  if (!position) throw new DeepResearchGateError(`${symbol} is not present in the current account-scoped holding snapshot`);
  return {
    accountScopeId: portfolio.accountScopeId,
    snapshotId: portfolio.snapshotId,
    sourceBatchId: portfolio.sourceBatchId,
    sourceAsOf: portfolio.sourceAsOf,
    positionSourceRowId: position.sourceRowId
  };
}

async function lockResearchProfile(
  client: PoolClient,
  market: string,
  code: string
): Promise<{ id: string; stock_id: string; key_variables: string[]; monitor_rules: ResearchMonitorRule[] } | null> {
  const result = await client.query<{ id: string; stock_id: string; key_variables: string[]; monitor_rules: ResearchMonitorRule[] }>(
    `select id, stock_id, key_variables, monitor_rules
       from research_profiles
      where market = $1 and code = $2
      for update`,
    [market, code]
  );
  return result.rows[0] ?? null;
}

function resolveMonitorRuleBinding(
  request: CreateResearchEventRequest,
  profile: { key_variables: string[]; monitor_rules: ResearchMonitorRule[] },
  variableName: string
): ResearchEventMonitorRuleBinding | null {
  const binding = request.monitorRuleBinding ?? null;
  if (binding === null) return null;
  const rules = profile.monitor_rules ?? [];
  const failures = researchMonitorRuleErrors(rules, profile.key_variables ?? []);
  if (failures.length || !researchEventMonitorRuleBindingMatchesCurrent(
    binding, rules, request.eventKind, variableName
  )) throw new DeepResearchGateError("event monitor rule is stale, disabled, or mismatched", failures);
  return binding;
}

async function nextEventVersion(client: PoolClient, profileId: string): Promise<number> {
  const result = await client.query<{ version: number | string }>(
    `select coalesce(max(event_version), 0) + 1 as version
       from research_events
      where research_profile_id = $1`,
    [profileId]
  );
  return Number(result.rows[0].version);
}

function sourceFromMaterial(material: Awaited<ReturnType<typeof readResearchMaterials>>[number]): ResearchEventSource {
  if(material.publishedAt===null)throw new DeepResearchGateError("an event requires a known publication time; an OpenD capture time is not publication");
  return {
    materialId: material.id,
    evidenceId: material.evidenceId,
    sourceType: material.sourceType,
    sourceUrl: material.sourceUrl,
    publishedAt: material.publishedAt,
    capturedAt: material.capturedAt,
    claimType: material.claimType,
    verificationStatus: material.verificationStatus,
    rightsStatus: material.rightsStatus,
    sourceVersion: material.sourceVersion,
    contentFingerprint: material.contentFingerprint,
    validUntil: material.validUntil,
    freshness: material.freshness,
    revision: material.revision,
    revisionState: material.revisionState,
    variableName: material.variableName ?? "",
    stance: material.stance,
    reliability: material.reliability,
    materiality: material.materiality
  };
}

function rowToResearchEvent(row: ResearchEventRow, now: Date): ResearchAnnouncementEventData {
  const validUntil = iso(row.valid_until);
  const source: ResearchEventSource = {
    materialId: String(row.material_id),
    evidenceId: String(row.evidence_id),
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    publishedAt: iso(row.published_at),
    capturedAt: iso(row.captured_at),
    claimType: row.claim_type,
    verificationStatus: row.verification_status,
    rightsStatus: row.rights_status,
    sourceVersion: row.source_version,
    contentFingerprint: row.content_fingerprint,
    validUntil,
    freshness: Date.parse(validUntil) > now.getTime() ? "fresh" : "stale",
    revision: Number(row.revision),
    revisionState: row.revision_state,
    variableName: row.variable_name,
    stance: row.stance,
    reliability: row.reliability,
    materiality: row.materiality
  };
  return {
    id: String(row.id),
    eventVersion: Number(row.event_version),
    eventFingerprint: row.event_fingerprint,
    membershipId: String(row.candidate_membership_id),
    membershipVersion: Number(row.candidate_membership_version),
    market: row.market,
    code: row.code,
    symbol: row.symbol,
    eventKind: row.event_kind,
    coverageScope: row.coverage_scope,
    keyVariable: row.key_variable,
    importance: row.importance,
    importanceReasons: row.importance_reasons,
    hypothesisImpact: row.hypothesis_impact,
    source,
    monitorRuleBinding: row.monitor_rule_binding,
    holdingBinding: row.holding_binding,
    createdAt: iso(row.created_at),
    safety: eventSafety()
  };
}

function identityFromEvent(
  event: ResearchAnnouncementEventData
): Omit<ResearchAnnouncementEventData, "id" | "eventFingerprint" | "createdAt" | "safety"> {
  const { id: _id, eventFingerprint: _fingerprint, createdAt: _createdAt, safety: _safety, ...identity } = event;
  return identity;
}

function eventSafety(): ResearchAnnouncementEventData["safety"] {
  return {
    createsOrder: false,
    createsTrade: false,
    mutatesCash: false,
    writesFee: false,
    mutatesPosition: false,
    callsBroker: false,
    productionWrite: false
  };
}

function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function idempotencyConflict(): IdempotencyConflictError {
  return new IdempotencyConflictError("idempotency key or event material delivery already exists with different source-bound facts");
}
