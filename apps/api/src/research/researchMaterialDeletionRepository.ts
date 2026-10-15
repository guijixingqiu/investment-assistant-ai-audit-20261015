import type { Pool, PoolClient } from "pg";
import type {
  DeleteResearchMaterialRequest,
  ResearchMaterialData,
  ResearchMaterialDeletionData
} from "../../../../packages/contracts/src/deepResearch.js";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import type { ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import { DeepResearchGateError, IdempotencyConflictError } from "./domain.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { requestFingerprint } from "./deepResearchGate.js";
import {
  assertCandidateMembershipWriteBinding,
  sameBoundResearchWriteReplay
} from "./researchWriteBinding.js";
import {
  actorRequest,
  findAuditByIdempotencyKey,
  insertWriteAudit,
  isUniqueViolation,
  writeEnvelope
} from "./writePersistence.js";

export async function readResearchMaterialDeletion(
  pool: Pick<Pool, "query">,
  membershipId: string,
  materialId: string,
  actor: AuthenticatedResearchActor
): Promise<ResearchMaterialDeletionData | null> {
  const result = await pool.query<{
    material_id: string; evidence_id: string; membership_id: string;
    membership_version: number | string; symbol: string;
    content_fingerprint: string; deleted_at: Date | string;
  }>(
    `select rm.id as material_id, rm.evidence_item_id as evidence_id,
            rm.candidate_membership_id as membership_id,
            rm.deletion_membership_version as membership_version,
            cm.symbol, rm.content_fingerprint, rm.deleted_at
       from research_materials rm
       join candidate_memberships cm on cm.id = rm.candidate_membership_id
      where rm.id = $1 and rm.candidate_membership_id = $2
        and cm.actor_type = $3 and cm.actor_id = $4
        and rm.deleted_at is not null`,
    [materialId, membershipId, actor.actorType, actor.actorId]
  );
  const row = result.rows[0];
  return row ? {
    materialId: String(row.material_id), evidenceId: String(row.evidence_id),
    membershipId: String(row.membership_id), membershipVersion: Number(row.membership_version),
    symbol: row.symbol, contentFingerprint: row.content_fingerprint,
    deletedAt: new Date(row.deleted_at).toISOString(), state: "deleted"
  } : null;
}

export async function deleteResearchMaterial(
  pool: Pool,
  membershipId: string,
  materialId: string,
  request: DeleteResearchMaterialRequest,
  actor: AuthenticatedResearchActor,
  now = new Date()
): Promise<ResearchWriteEnvelope<ResearchMaterialDeletionData>> {
  if (actor.actorType !== "user" || !actor.actorId) {
    throw new DeepResearchGateError("research material deletion requires an explicit user actor");
  }
  const boundRequest = { membershipId, membershipVersion: request.membershipVersion };
  const fingerprint = requestFingerprint("research_material_delete", { membershipId, materialId, request, actor });
  const auditRequest = actorRequest(actor, request.idempotencyKey);
  const client = await pool.connect();
  try {
    await client.query("begin");
    let replay = await findAuditByIdempotencyKey<ResearchMaterialDeletionData>(client, request.idempotencyKey, "research_material_deleted");
    if (replay) return await commitReplay(client, replay, actor, boundRequest, fingerprint);
    await assertCandidateMembershipWriteBinding(client, actor, boundRequest);
    replay = await findAuditByIdempotencyKey<ResearchMaterialDeletionData>(client, request.idempotencyKey, "research_material_deleted");
    if (replay) return await commitReplay(client, replay, actor, boundRequest, fingerprint);
    const material = await client.query<{
      material_id: string; evidence_id: string; stock_id: string; market: string;
      code: string; symbol: string; content_fingerprint: string; deleted_at: Date | string | null;
    }>(
      `select rm.id as material_id, rm.evidence_item_id as evidence_id,
              stock.id as stock_id, rp.market, rp.code, rp.symbol,
              rm.content_fingerprint, rm.deleted_at
         from research_materials rm
         join research_profiles rp on rp.id = rm.research_profile_id
         join stocks stock on stock.id = rp.stock_id
         join evidence_items ei on ei.id = rm.evidence_item_id
        where rm.id = $1 and rm.candidate_membership_id = $2
          and (rm.rights_status = 'user_provided'
            or (rm.rights_status = 'authorized_public' and ei.source_type = 'issuer_public_html'))
        for update of rm, ei`,
      [materialId, membershipId]
    );
    const row = material.rows[0];
    if (!row || row.deleted_at) throw new DeepResearchGateError("deletable Owner research material was not found or is already deleted");
    const deletedAt = now.toISOString();
    await client.query(
      `update evidence_items
          set source_type = 'deleted', source_url = null, summary = '[deleted]',
              variable_name = null, stance = 'neutral', reliability = null,
              materiality = null, is_read = true, raw_payload = $2::jsonb
        where id = $1`,
      [row.evidence_id, JSON.stringify({
        state: "deleted", materialId: String(row.material_id),
        contentFingerprint: row.content_fingerprint, deletedAt
      })]
    );
    await client.query(
      `update research_materials
          set title = '[deleted]', content_text = '[deleted]',
              verification_status = 'rejected', rights_status = 'unknown',
              citation_document_id = null, citation_page_number = null,
              citation_page_text_sha256 = null, citation_snapshot_id = null,
              citation_snapshot_membership_version = null, citation_snapshot_text_sha256 = null,
              citation_start_utf16 = null, citation_end_utf16 = null, citation_excerpt_sha256 = null,
              deleted_at = $2,
              deleted_by_actor_id = $3, deletion_membership_version = $4
        where id = $1`,
      [materialId, deletedAt, actor.actorId, request.membershipVersion]
    );
    const data: ResearchMaterialDeletionData = {
      materialId: String(row.material_id), evidenceId: String(row.evidence_id),
      membershipId, membershipVersion: request.membershipVersion, symbol: row.symbol,
      contentFingerprint: row.content_fingerprint, deletedAt, state: "deleted"
    };
    await client.query(
      `update research_write_audit_events
          set before_payload = null, after_payload = $2::jsonb
        where event_type = 'research_material_created'
          and target_table = 'research_materials' and target_id = $1`,
      [materialId, JSON.stringify(data)]
    );
    await redactPersistedMaterialCopies(client, membershipId, materialId, row.content_fingerprint, now);
    const auditAsOf = await insertWriteAudit(client, {
      eventType: "research_material_deleted", request: auditRequest,
      stock: { id: String(row.stock_id), market: row.market, code: row.code, symbol: row.symbol },
      targetTable: "research_materials", targetId: materialId,
      beforePayload: { materialId: String(row.material_id), evidenceId: String(row.evidence_id), contentFingerprint: row.content_fingerprint, state: "active" },
      afterPayload: data, requestFingerprint: fingerprint,
      candidateMembershipId: membershipId, candidateMembershipVersion: request.membershipVersion
    });
    await client.query("commit");
    return writeEnvelope(auditRequest, data, "Research material body and persisted source copies deleted; contentless tombstones remain.", auditAsOf);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      const replay = await findAuditByIdempotencyKey<ResearchMaterialDeletionData>(pool, request.idempotencyKey, "research_material_deleted");
      if (replay && sameBoundResearchWriteReplay(replay, actor, boundRequest, fingerprint)) return replay.envelope;
      throw idempotencyConflict();
    }
    throw error;
  } finally {
    client.release();
  }
}

export function redactResearchMaterialCopies(value: unknown, materialId: string, contentFingerprint: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => redactResearchMaterialCopies(item, materialId, contentFingerprint));
    return canonicalJson(items) === canonicalJson(value) ? value : items;
  }
  if (!record(value)) return value;
  if (value.id === materialId && value.contentFingerprint === contentFingerprint
    && typeof value.contentText === "string" && typeof value.evidenceId === "string") {
    return researchMaterialTombstone(value as unknown as ResearchMaterialData);
  }
  const removeProviderReference = record(value.providerOperatingReference)
    && Array.isArray(value.providerOperatingReference.periods)
    && value.providerOperatingReference.periods.some(period => record(period)
      && Array.isArray(period.materialMatches)
      && period.materialMatches.some(match => record(match)
        && match.id === materialId && match.contentFingerprint === contentFingerprint));
  const next = Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "providerOperatingReference" || !removeProviderReference)
    .map(([key, item]) => [
    key, redactResearchMaterialCopies(item, materialId, contentFingerprint)
    ]));
  if (canonicalJson(next) === canonicalJson(value)) return value;
  if (typeof next.packFingerprint === "string" && Array.isArray(next.items) && record(next.currentness)) {
    const invalidatedBy = Array.isArray(next.currentness.invalidatedBy) ? next.currentness.invalidatedBy : [];
    next.currentness = {
      status: "historical",
      invalidatedBy: [...new Set([...invalidatedBy, "material_set_changed"])]
    };
  }
  return next;
}

function researchMaterialTombstone(item: ResearchMaterialData): ResearchMaterialData {
  return {
    ...item, title: "[deleted]", contentText: "[deleted]", sourceType: "deleted", sourceUrl: null,
    verificationStatus: "rejected", rightsStatus: "unknown", summary: "[deleted]", variableName: null,
    stance: "neutral", reliability: null, materiality: null, isRead: true, citation: null,
    snapshotCitation:null,snapshotOriginal:null
  };
}

async function redactPersistedMaterialCopies(
  client: PoolClient, membershipId: string, materialId: string, contentFingerprint: string, now: Date
): Promise<void> {
  const needle = JSON.stringify([{ id: materialId, contentFingerprint }]);
  const providerNeedle = JSON.stringify([{ materialMatches: [{ id: materialId, contentFingerprint }] }]);
  const packs = await client.query<{ pack_id: string }>(
    `update research_evidence_packs
        set items = redact_research_material_copies(items, $2, $3)
      where candidate_membership_id = $1 and items @> $4::jsonb
      returning id::text as pack_id`,
    [membershipId, materialId, contentFingerprint, needle]
  );
  const packIds = packs.rows.map((pack) => pack.pack_id);
  if (packIds.length > 0) {
    await client.query(
      `update deep_research_tasks
          set request_payload = case
                when status in ('pending', 'running', 'ready_to_absorb', 'failed')
                  then (redact_research_material_copies(request_payload, $3, $4) - 'synthesis' - 'attemptManifest' - 'sendReceipt') #- '{snapshot,providerOperatingReference}'
                else redact_research_material_copies(request_payload, $3, $4) #- '{snapshot,providerOperatingReference}'
              end,
              status = case when status in ('pending', 'running', 'ready_to_absorb', 'failed') then 'canceled' else status end,
              report_id = case when status in ('pending', 'running', 'ready_to_absorb', 'failed') then null else report_id end,
              error_code = case when status in ('pending', 'running', 'ready_to_absorb', 'failed') then 'material_deleted' else error_code end,
              claim_token = case when status in ('pending', 'running', 'ready_to_absorb', 'failed') then null else claim_token end,
              lease_expires_at = case when status in ('pending', 'running', 'ready_to_absorb', 'failed') then null else lease_expires_at end,
              completed_at = case when status in ('pending', 'running', 'ready_to_absorb', 'failed') then $5 else completed_at end,
              updated_at = $5
        where candidate_membership_id = $1 and evidence_pack_id = any($2::bigint[])`,
      [membershipId, packIds, materialId, contentFingerprint, now]
    );
    await client.query(
      `update deep_research_reports
          set report_payload = redact_research_material_copies(report_payload, $2, $3) #- '{snapshot,providerOperatingReference}'
        where evidence_pack_id = any($1::bigint[]) and deleted_at is null
          and report_payload is distinct from
            (redact_research_material_copies(report_payload, $2, $3) #- '{snapshot,providerOperatingReference}')`,
      [packIds, materialId, contentFingerprint]
    );
  }
  await client.query(
    `update research_write_audit_events
        set before_payload = case when before_payload #> '{payload,snapshot,providerOperatingReference,periods}' @> $4::jsonb
              then redact_research_material_copies(before_payload, $2, $3) #- '{payload,snapshot,providerOperatingReference}'
              else redact_research_material_copies(before_payload, $2, $3) end,
            after_payload = case when after_payload #> '{payload,snapshot,providerOperatingReference,periods}' @> $4::jsonb
              then redact_research_material_copies(after_payload, $2, $3) #- '{payload,snapshot,providerOperatingReference}'
              else redact_research_material_copies(after_payload, $2, $3) end
      where candidate_membership_id = $1`,
    [membershipId, materialId, contentFingerprint, providerNeedle]
  );
}

async function commitReplay(
  client: PoolClient,
  replay: NonNullable<Awaited<ReturnType<typeof findAuditByIdempotencyKey<ResearchMaterialDeletionData>>>>,
  actor: AuthenticatedResearchActor,
  boundRequest: { membershipId: string; membershipVersion: number },
  fingerprint: string
): Promise<ResearchWriteEnvelope<ResearchMaterialDeletionData>> {
  if (!sameBoundResearchWriteReplay(replay, actor, boundRequest, fingerprint)) throw idempotencyConflict();
  await client.query("commit");
  return replay.envelope;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function idempotencyConflict(): IdempotencyConflictError {
  return new IdempotencyConflictError("idempotency key or material content/version already exists with different source-bound facts");
}
