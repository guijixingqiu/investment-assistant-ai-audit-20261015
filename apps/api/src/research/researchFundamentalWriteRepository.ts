import {factIdentity,factIdentityKey,canonicalPeriod} from "../../../../packages/contracts/src/researchFactIdentity.js";
import { verifyStructuredAssertion } from "./researchAssertionVerification.js";
import type { Pool } from "pg";
import type {
  CreateResearchFundamentalValueRequest,
  ResearchFundamentalValueData
} from "../../../../packages/contracts/src/researchFundamentals.js";
import type { ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import { normalizeMarketCode } from "../market/freshness.js";
import {
  IdempotencyConflictError,
  ResearchFundamentalError,
  type AuthenticatedResearchActor
} from "./domain.js";
import { requestFingerprint } from "./deepResearchGate.js";
import {
  assertCurrentStructuredSourceMaterial,
  findResearchFundamentalById,
  rowToResearchFundamentalValue
} from "./researchFundamentalRepository.js";
import { assertCandidateMembershipWriteBinding, sameBoundResearchWriteReplay } from "./researchWriteBinding.js";
import { sourceOriginalAvailabilities, type SourceSnapshotStoreOptions } from "./researchSourceSnapshotRepository.js";
import {
  actorRequest,
  findAuditByIdempotencyKey,
  insertWriteAudit,
  isUniqueViolation,
  upsertStock,
  writeEnvelope
} from "./writePersistence.js";

export async function createResearchFundamentalValue(
  pool: Pool,
  membershipId: string,
  request: CreateResearchFundamentalValueRequest,
  actor: AuthenticatedResearchActor,
  now = new Date(),
  sourceStore?:SourceSnapshotStoreOptions
): Promise<ResearchWriteEnvelope<ResearchFundamentalValueData>> {
  if (request.assertion?.category === "actual" && request.periodEnd > now.toISOString().slice(0,10)) throw new ResearchFundamentalError(422, "FUTURE_ACTUAL", "actual period cannot be in the future");
  if(request.assertion?.verification)throw new ResearchFundamentalError(422,"SERVER_VERIFICATION_ONLY","verification metadata cannot be provided by a client");
  const a=request.assertion;
  if(a && (a.category==="guidance")!==!!a.guidance)throw new ResearchFundamentalError(422,"GUIDANCE_CATEGORY_MISMATCH","guidance metadata is required only for guidance");
  if(a?.guidance && a.guidance.expectedVerificationDate<=request.periodEnd)throw new ResearchFundamentalError(422,"GUIDANCE_FOLLOWUP_BEFORE_PERIOD","research follow-up date must be after target period end");
  // Server metadata is added to a private copy; retry fingerprints retain the client request.
  request=structuredClone(request);
  const fingerprint = requestFingerprint("research_fundamental_value_create", {
    actor,
    membershipId,
    request
  });
  const auditRequest = actorRequest(actor, request.idempotencyKey);
  const client = await pool.connect();
  try {
    await client.query("begin");
    let replay = await findAuditByIdempotencyKey<ResearchFundamentalValueData>(
      client,
      request.idempotencyKey,
      "research_fundamental_value_created"
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
    const source = await assertCurrentStructuredSourceMaterial(client, membershipId, request.sourceMaterialId, actor, now);
    if (source.symbol !== normalized.symbol) {
      throw new ResearchFundamentalError(409, "SOURCE_SYMBOL_CONFLICT", "source material does not match the current candidate symbol");
    }
    replay = await findAuditByIdempotencyKey<ResearchFundamentalValueData>(
      client,
      request.idempotencyKey,
      "research_fundamental_value_created"
    );
    if (replay) {
      if (!sameBoundResearchWriteReplay(replay, actor, { ...request, membershipId }, fingerprint)) throw idempotencyConflict();
      await client.query("commit");
      return replay.envelope;
    }

    const verification = await verifyStructuredAssertion(client, request.sourceMaterialId, request, actor.actorId, now.toISOString());
    const revision = await replacementRevision(client, membershipId, request, actor);
    const inserted = await client.query<{ id: string }>(
      `insert into research_fundamental_values
        (candidate_membership_id, captured_membership_version, source_material_id, metric,
         period_kind, period_start, period_end, currency, unit_scale, scope, value_status,
         reported_value, comparability, comparability_reason, amendment_kind, replaces_value_id,
         revision, created_at, assertion_metadata, verification_status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::numeric, $13, $14, $15, $16, $17, $18, $19::jsonb, $20)
       returning id`,
      [
        membershipId,
        request.membershipVersion,
        request.sourceMaterialId,
        request.metric,
        request.periodKind,
        request.periodStart,
        request.periodEnd,
        request.currency,
        request.unitScale,
        request.scope,
        request.valueStatus,
        request.value,
        request.comparability,
        request.comparabilityReason,
        request.amendmentKind,
        request.replacesValueId,
        revision,
        now,
        request.assertion ? JSON.stringify(request.assertion) : null,
        verification
      ]
    );
    const row = await findResearchFundamentalById(client, membershipId, inserted.rows[0].id, actor);
    if (!row) throw new ResearchFundamentalError(503, "FUNDAMENTAL_READ_BACK_FAILED", "created fundamental value could not be read back");
    const availability=await sourceOriginalAvailabilities(client,membershipId,actor,row.citation_snapshot_id==null?[]:[{
      snapshotId:String(row.citation_snapshot_id),rawSha256:String(row.snapshot_raw_sha256),
      byteLength:Number(row.snapshot_byte_length),textSha256:String(row.citation_snapshot_text_sha256)}],sourceStore);
    const originalAvailability=row.citation_snapshot_id==null?undefined:availability.get(String(row.citation_snapshot_id));
    if(row.citation_snapshot_id!=null&&originalAvailability!=="available")
      throw new ResearchFundamentalError(409,"SOURCE_ORIGINAL_UNAVAILABLE","verified original article is required to record a current fact");
    const data = rowToResearchFundamentalValue(row, now, originalAvailability);
    const stock = await upsertStock(client, normalized.market, normalized.code, normalized.symbol, null);
    const auditAsOf = await insertWriteAudit(client, {
      eventType: "research_fundamental_value_created",
      request: auditRequest,
      stock,
      targetTable: "research_fundamental_values",
      targetId: data.id,
      beforePayload: null,
      afterPayload: data,
      requestFingerprint: fingerprint,
      candidateMembershipId: membershipId,
      candidateMembershipVersion: request.membershipVersion
    });
    await client.query("commit");
    return writeEnvelope(auditRequest, data, `Structured issuer fundamental for ${normalized.symbol} created.`, auditAsOf);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      const replay = await findAuditByIdempotencyKey<ResearchFundamentalValueData>(
        pool,
        request.idempotencyKey,
        "research_fundamental_value_created"
      );
      if (replay && sameBoundResearchWriteReplay(replay, actor, { ...request, membershipId }, fingerprint)) return replay.envelope;
      throw idempotencyConflict();
    }
    throw error;
  } finally {
    client.release();
  }
}

async function replacementRevision(
  client: Parameters<typeof findResearchFundamentalById>[0],
  membershipId: string,
  request: CreateResearchFundamentalValueRequest,
  actor: AuthenticatedResearchActor
): Promise<number> {
  if (request.replacesValueId === null) return 1;
  const prior = await findResearchFundamentalById(client, membershipId, request.replacesValueId, actor, true);
  if (!prior || prior.value_replaced) {
    throw new ResearchFundamentalError(409, "REPLACEMENT_CONFLICT", "replacement target must be the current value in its source chain");
  }
  const economicIdentity=(metric:string,kind:"duration"|"instant",start:string|null,end:string,currency:string,scale:number,scope:string,a:ResearchFundamentalValueData["assertion"])=>factIdentityKey(factIdentity({symbol:"bound-membership",membershipVersion:request.membershipVersion,metric,period:canonicalPeriod(kind,start,end),currency:currency==="XXX"?null:currency,unitScale:scale,accountingScope:scope,businessScope:a?.businessScope??"unknown",measurementBasis:a?.measurementBasis??"financial_statement",unit:a?.unit??"currency",category:a?.category??"actual",mix:a?.mix,guidance:a?.guidance}));
  const sameChain = Number(prior.captured_membership_version)===request.membershipVersion && economicIdentity(prior.metric,prior.period_kind,calendarDate(prior.period_start),calendarDate(prior.period_end)!,prior.currency,Number(prior.unit_scale),prior.scope,prior.assertion_metadata??undefined)===economicIdentity(request.metric,request.periodKind,request.periodStart,request.periodEnd,request.currency,request.unitScale,request.scope,request.assertion);
  if (!sameChain) {
    throw new ResearchFundamentalError(409, "REPLACEMENT_CHAIN_CONFLICT", "replacement must preserve the same membership, source, metric, period, scope, currency, and unit");
  }
  return Number(prior.revision) + 1;
}

function calendarDate(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function idempotencyConflict(): IdempotencyConflictError {
  return new IdempotencyConflictError("idempotency key or replacement chain already exists with different structured fundamental semantics");
}
