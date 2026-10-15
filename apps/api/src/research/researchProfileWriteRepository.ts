import type { Pool } from "pg";
import type {
  CreateEvidenceRequest,
  EvidenceItemData,
  ResearchProfileData,
  ResearchWriteEnvelope,
  UpdateResearchProfileRequest
} from "../../../../packages/contracts/src/research.js";
import { normalizeMarketCode } from "../market/freshness.js";
import {
  researchMonitorRuleErrors,
  sameResearchMonitorRuleContent,
  type ResearchMonitorRule
} from "../../../../packages/contracts/src/researchMonitorRule.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { DeepResearchGateError, IdempotencyConflictError } from "./domain.js";
import { type EvidenceRow, type ResearchProfileRow, rowToEvidence, rowToProfile } from "./researchMappers.js";
import { assertCandidateResearchWriteBinding, sameBoundResearchWriteReplay } from "./researchWriteBinding.js";
import {
  actorRequest,
  ensureResearchProfile,
  findAuditByIdempotencyKey,
  insertWriteAudit,
  isUniqueViolation,
  upsertStock,
  writeEnvelope
} from "./writePersistence.js";

export async function updateResearchProfile(
  pool: Pool,
  request: UpdateResearchProfileRequest,
  actor: AuthenticatedResearchActor
): Promise<ResearchWriteEnvelope<ResearchProfileData>> {
  if (request.monitorRules !== undefined && actor.actorType !== "user") {
    throw new DeepResearchGateError("formal monitor rules require an explicit Owner user actor");
  }
  const normalized = normalizeMarketCode(request.market, request.code);
  const auditRequest = actorRequest(actor, request.idempotencyKey);
  const requestFingerprint = profileWriteFingerprint(request, normalized, actor);
  const client = await pool.connect();
  try {
    await client.query("begin");
    let existingAudit = await findAuditByIdempotencyKey<ResearchProfileData>(client, request.idempotencyKey, "profile_updated");
    if (existingAudit) {
      if (!sameBoundResearchWriteReplay(existingAudit, actor, request, requestFingerprint)) {
        throw new IdempotencyConflictError("idempotency key already used with a different research profile payload or actor");
      }
      await client.query("commit");
      return existingAudit.envelope;
    }
    await assertCandidateResearchWriteBinding(client, actor, request, normalized);
    existingAudit = await findAuditByIdempotencyKey<ResearchProfileData>(client, request.idempotencyKey, "profile_updated");
    if (existingAudit) {
      if (!sameBoundResearchWriteReplay(existingAudit, actor, request, requestFingerprint)) {
        throw new IdempotencyConflictError("idempotency key already used with a different research profile payload or actor");
      }
      await client.query("commit");
      return existingAudit.envelope;
    }
    const stock = await upsertStock(client, normalized.market, normalized.code, normalized.symbol, request.name ?? null);
    const before = await client.query<ResearchProfileRow>(
      `select rp.id, rp.market, rp.code, rp.symbol, s.name, rp.current_view, rp.current_thesis,
              rp.market_disagreement, rp.invalidation_condition, rp.next_review_on,
              rp.key_variables, rp.catalysts, rp.evidence_gaps, rp.monitor_rules, rp.updated_at
         from research_profiles rp
         left join stocks s on s.id = rp.stock_id
        where rp.stock_id = $1
        limit 1`,
      [stock.id]
    );
    const effectiveKeyVariables = request.keyVariables ?? before.rows[0]?.key_variables ?? [];
    const confirmedAt = new Date().toISOString();
    const currentMonitorRules = before.rows[0]?.monitor_rules ?? [];
    const effectiveMonitorRules = request.monitorRules === undefined
      ? currentMonitorRules
      : resolveResearchMonitorRulesForWrite(request.monitorRules, currentMonitorRules, confirmedAt);
    const monitorRuleFailures = researchMonitorRuleErrors(effectiveMonitorRules, effectiveKeyVariables);
    if (monitorRuleFailures.length > 0) {
      throw new DeepResearchGateError(
        "research profile key variables and preserved monitor rules no longer match",
        monitorRuleFailures
      );
    }
    const updated = await client.query<ResearchProfileRow>(
      `insert into research_profiles
        (stock_id, market, code, symbol, current_view, current_thesis,
         market_disagreement, invalidation_condition, next_review_on,
         key_variables, catalysts, evidence_gaps, monitor_rules)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               coalesce($10::text[], '{}'), coalesce($11::text[], '{}'), coalesce($12::text[], '{}'), coalesce($13::jsonb, '[]'::jsonb))
       on conflict (stock_id)
       do update set current_view = excluded.current_view,
                     current_thesis = excluded.current_thesis,
                     market_disagreement = excluded.market_disagreement,
                     invalidation_condition = excluded.invalidation_condition,
                     next_review_on = excluded.next_review_on,
                     key_variables = coalesce($10::text[], research_profiles.key_variables),
                     catalysts = coalesce($11::text[], research_profiles.catalysts),
                     evidence_gaps = coalesce($12::text[], research_profiles.evidence_gaps),
                     monitor_rules = coalesce($13::jsonb, research_profiles.monitor_rules),
                     updated_at = now()
       returning id, market, code, symbol, $14::text as name, current_view, current_thesis,
                 market_disagreement, invalidation_condition, next_review_on,
                 key_variables, catalysts, evidence_gaps, monitor_rules, updated_at`,
      [
        stock.id,
        normalized.market,
        normalized.code,
        normalized.symbol,
        request.currentView,
        request.currentThesis,
        request.marketDisagreement ?? null,
        request.invalidationCondition ?? null,
        request.nextReviewOn ?? null,
        request.keyVariables ?? null,
        request.catalysts ?? null,
        request.evidenceGaps ?? null,
        request.monitorRules ? JSON.stringify(effectiveMonitorRules) : null,
        stock.name
      ]
    );
    const profile = rowToProfile(updated.rows[0]);
    const auditAsOf = await insertWriteAudit(client, {
      eventType: "profile_updated",
      request: auditRequest,
      stock,
      targetTable: "research_profiles",
      targetId: String(updated.rows[0].id),
      beforePayload: before.rows[0] ? rowToProfile(before.rows[0]) : null,
      afterPayload: profile,
      requestFingerprint,
      candidateMembershipId: request.membershipId,
      candidateMembershipVersion: request.membershipVersion
    });
    await client.query("commit");
    return writeEnvelope(auditRequest, profile, `Research profile ${normalized.symbol} saved.`, auditAsOf);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      const replay = await findAuditByIdempotencyKey<ResearchProfileData>(pool, request.idempotencyKey, "profile_updated");
      if (replay && sameBoundResearchWriteReplay(replay, actor, request, requestFingerprint)) {
        return replay.envelope;
      }
      throw new IdempotencyConflictError("idempotency key already used with a different research profile payload or actor");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function createEvidence(
  pool: Pool,
  market: string,
  code: string,
  request: CreateEvidenceRequest,
  actor: AuthenticatedResearchActor
): Promise<ResearchWriteEnvelope<EvidenceItemData>> {
  const normalized = normalizeMarketCode(market, code);
  const auditRequest = actorRequest(actor, request.idempotencyKey);
  const requestFingerprint = evidenceWriteFingerprint(request, normalized, actor);
  const client = await pool.connect();
  try {
    await client.query("begin");
    let existingAudit = await findAuditByIdempotencyKey<EvidenceItemData>(client, request.idempotencyKey, "evidence_created");
    if (existingAudit) {
      if (!sameBoundResearchWriteReplay(existingAudit, actor, request, requestFingerprint)) {
        throw new IdempotencyConflictError("idempotency key already used with a different evidence payload or actor");
      }
      await client.query("commit");
      return existingAudit.envelope;
    }
    await assertCandidateResearchWriteBinding(client, actor, request, normalized);
    existingAudit = await findAuditByIdempotencyKey<EvidenceItemData>(client, request.idempotencyKey, "evidence_created");
    if (existingAudit) {
      if (!sameBoundResearchWriteReplay(existingAudit, actor, request, requestFingerprint)) {
        throw new IdempotencyConflictError("idempotency key already used with a different evidence payload or actor");
      }
      await client.query("commit");
      return existingAudit.envelope;
    }
    const stock = await upsertStock(client, normalized.market, normalized.code, normalized.symbol, null);
    const profileId = await ensureResearchProfile(client, stock);
    const inserted = await client.query<EvidenceRow>(
      `insert into evidence_items
        (research_profile_id, source_type, source_url, published_at, summary, fact_kind,
         variable_name, stance, reliability, materiality, is_read, raw_payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
       returning id, source_type, source_url, published_at, captured_at, summary, fact_kind,
                 variable_name, stance, reliability, materiality, is_read`,
      [
        profileId,
        request.sourceType,
        request.sourceUrl ?? null,
        request.publishedAt ?? null,
        request.summary,
        request.factKind,
        request.variableName ?? null,
        request.stance,
        request.reliability ?? null,
        request.materiality ?? null,
        request.isRead ?? false,
        JSON.stringify({ source: "production-write-api" })
      ]
    );
    const evidence = rowToEvidence(inserted.rows[0]);
    const auditAsOf = await insertWriteAudit(client, {
      eventType: "evidence_created",
      request: auditRequest,
      stock,
      targetTable: "evidence_items",
      targetId: String(inserted.rows[0].id),
      beforePayload: null,
      afterPayload: evidence,
      requestFingerprint,
      candidateMembershipId: request.membershipId,
      candidateMembershipVersion: request.membershipVersion
    });
    await client.query("commit");
    return writeEnvelope(auditRequest, evidence, `Evidence for ${normalized.symbol} created.`, auditAsOf);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      const replay = await findAuditByIdempotencyKey<EvidenceItemData>(pool, request.idempotencyKey, "evidence_created");
      if (replay && sameBoundResearchWriteReplay(replay, actor, request, requestFingerprint)) {
        return replay.envelope;
      }
      throw new IdempotencyConflictError("idempotency key already used with a different evidence payload or actor");
    }
    throw error;
  } finally {
    client.release();
  }
}

export function resolveResearchMonitorRulesForWrite(
  requested: ResearchMonitorRule[], current: ResearchMonitorRule[], confirmedAt: string
): ResearchMonitorRule[] {
  const requestedVariables = new Set(requested.map((rule) => rule.variableName));
  const omittedConfirmedRule = current.find((rule) => rule.version !== undefined
    && rule.confirmedAt !== undefined && !requestedVariables.has(rule.variableName));
  if (omittedConfirmedRule) {
    throw new DeepResearchGateError("confirmed monitor rules must be explicitly disabled instead of omitted");
  }
  const currentByVariable = new Map(current.map((rule) => [rule.variableName, rule]));
  return requested.map((rule) => {
    const previous = currentByVariable.get(rule.variableName);
    if (!previous) {
      if (rule.version !== undefined || rule.confirmedAt !== undefined) {
        throw new DeepResearchGateError("new monitor rules cannot claim an existing confirmed version");
      }
      return { ...rule, version: 1, confirmedAt };
    }
    if (previous.version === undefined || previous.confirmedAt === undefined) {
      if (rule.version !== undefined || rule.confirmedAt !== undefined) {
        throw new DeepResearchGateError("legacy monitor rule requires explicit fresh confirmation");
      }
      return { ...rule, version: 1, confirmedAt };
    }
    if (rule.version === undefined || rule.confirmedAt === undefined) {
      if (sameResearchMonitorRuleContent(rule, previous)) return previous;
      throw new DeepResearchGateError("monitor rule version changed; refresh before confirming the modification");
    }
    if (rule.version !== previous.version || rule.confirmedAt !== previous.confirmedAt) {
      throw new DeepResearchGateError("monitor rule version changed; refresh before confirming the modification");
    }
    return sameResearchMonitorRuleContent(rule, previous)
      ? previous
      : { ...rule, version: rule.version + 1, confirmedAt };
  });
}

export function profileWriteFingerprint(
  request: UpdateResearchProfileRequest,
  normalized: { market: string; code: string; symbol: string },
  actor?: AuthenticatedResearchActor
): string {
  return JSON.stringify({
    operation: "profile_update",
    membershipId: request.membershipId,
    membershipVersion: request.membershipVersion,
    market: normalized.market,
    code: normalized.code,
    symbol: normalized.symbol,
    name: optionalFingerprintField(request, "name"),
    currentView: request.currentView,
    currentThesis: request.currentThesis,
    marketDisagreement: optionalFingerprintField(request, "marketDisagreement"),
    invalidationCondition: optionalFingerprintField(request, "invalidationCondition"),
    nextReviewOn: optionalFingerprintField(request, "nextReviewOn"),
    keyVariables: optionalFingerprintField(request, "keyVariables"),
    catalysts: optionalFingerprintField(request, "catalysts"),
    evidenceGaps: optionalFingerprintField(request, "evidenceGaps"),
    monitorRules: optionalFingerprintField(request, "monitorRules"),
    actor: actor ?? {
      actorType: request.actorType ?? "user",
      actorId: request.actorId ?? null
    }
  });
}

export function evidenceWriteFingerprint(
  request: CreateEvidenceRequest,
  normalized: { market: string; code: string; symbol: string },
  actor?: AuthenticatedResearchActor
): string {
  return JSON.stringify({
    operation: "evidence_create",
    membershipId: request.membershipId,
    membershipVersion: request.membershipVersion,
    market: normalized.market,
    code: normalized.code,
    symbol: normalized.symbol,
    sourceType: request.sourceType,
    sourceUrl: optionalFingerprintField(request, "sourceUrl"),
    publishedAt: optionalFingerprintField(request, "publishedAt"),
    summary: request.summary,
    factKind: request.factKind,
    variableName: optionalFingerprintField(request, "variableName"),
    stance: request.stance,
    reliability: optionalFingerprintField(request, "reliability"),
    materiality: optionalFingerprintField(request, "materiality"),
    isRead: optionalFingerprintField(request, "isRead"),
    actor: actor ?? {
      actorType: request.actorType ?? "user",
      actorId: request.actorId ?? null
    }
  });
}

function optionalFingerprintField<T extends object>(request: T, key: keyof T): { present: boolean; value: unknown } {
  const present = Object.prototype.hasOwnProperty.call(request, key);
  return { present, value: present ? request[key] ?? null : null };
}
