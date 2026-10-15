import type { Pool, PoolClient } from "pg";
import {FUTU_FINANCIAL_STATEMENT_SOURCE,validFutuFinancialMaterialSource,type FutuFinancialMaterialSource} from "../../../../packages/contracts/src/researchFutuFinancialStatement.js";
import type {
  CreateResearchMaterialRequest,
  DeepResearchWorkspaceEnvelope,
  ResearchMaterialData
} from "../../../../packages/contracts/src/deepResearch.js";
import {
  OWNER_PROVIDED_PDF_SOURCE_TYPE,
  ISSUER_PUBLIC_PDF_SOURCE_TYPE,
  ISSUER_PUBLIC_HTML_SOURCE_TYPE,
  OWNER_OCR_CORRECTION_NOTE_SOURCE_TYPE,
  OWNER_ASSISTANT_REPORT_CORRECTION_SOURCE_TYPE,
  OWNER_REPORT_REVIEW_CORRECTION_SOURCE_TYPE,
  OWNER_PRIOR_JUDGMENT_NOTE_SOURCE_TYPE,
  ownerPriorJudgmentNoteFields,
  validateCreateResearchMaterialRequest
} from "../../../../packages/contracts/src/deepResearch.js";
import { isSnapshotTextCitation } from "../../../../packages/contracts/src/researchSourceCitation.js";
import type { ResearchSourceCitation } from "../../../../packages/contracts/src/researchSourceCitation.js";
import { assertSnapshotCitation } from "./researchSourceSnapshotRepository.js";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import type { ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import { normalizeMarketCode } from "../market/freshness.js";
import { DeepResearchGateError, IdempotencyConflictError } from "./domain.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { requestFingerprint, researchMaterialFingerprint } from "./deepResearchGate.js";
import type { ResearchMaterialRow } from "./deepResearchMappers.js";
import { rowToResearchMaterial } from "./deepResearchMappers.js";
import {
  assertCandidateResearchWriteBinding,
  sameBoundResearchWriteReplay
} from "./researchWriteBinding.js";
import { readBoundTodayResearchReport } from "./todayReviewDueReportSnapshot.js";
import { readDeepResearchWorkspace } from "./deepResearchReadRepository.js";
import {
  actorRequest,
  ensureResearchProfile,
  findAuditByIdempotencyKey,
  insertWriteAudit,
  isUniqueViolation,
  upsertStock,
  writeEnvelope
} from "./writePersistence.js";

// eslint-disable-next-line complexity -- one transaction keeps validation, idempotency and persistence atomic.
export async function createResearchMaterial(
  pool: Pool,
  market: string,
  code: string,
  request: CreateResearchMaterialRequest,
  actor: AuthenticatedResearchActor,
  now = new Date(),
  citation: ResearchSourceCitation | null = null,
  futuFinancialSource:FutuFinancialMaterialSource|null = null
): Promise<ResearchWriteEnvelope<ResearchMaterialData>> {
  const ocrNote = request.sourceType === OWNER_OCR_CORRECTION_NOTE_SOURCE_TYPE;
  const priorJudgmentNote = request.sourceType === OWNER_PRIOR_JUDGMENT_NOTE_SOURCE_TYPE;
  const pdf = [OWNER_PROVIDED_PDF_SOURCE_TYPE,ISSUER_PUBLIC_PDF_SOURCE_TYPE,OWNER_OCR_CORRECTION_NOTE_SOURCE_TYPE].includes(request.sourceType);
  const html = request.sourceType === ISSUER_PUBLIC_HTML_SOURCE_TYPE;
  const futu=request.sourceType===FUTU_FINANCIAL_STATEMENT_SOURCE;
  if(futu!==Boolean(futuFinancialSource)||futu && (!validFutuFinancialMaterialSource(futuFinancialSource)
    ||futuFinancialSource!.membershipId!==request.membershipId||futuFinancialSource!.membershipVersion!==request.membershipVersion
    ||request.publishedAt!==null||request.sourceUrl!==null||request.claimType!=="third_party_statement"
    ||request.verificationStatus!=="unverified"||request.rightsStatus!=="user_provided"))
    throw new DeepResearchGateError("OpenD materials require a server-derived saved-original source");
  if ((pdf || html) !== (citation !== null) || (html && !isSnapshotTextCitation(citation))
    || (pdf && isSnapshotTextCitation(citation))) {
    throw new DeepResearchGateError("formal source materials require their matching original citation path");
  }
  if (request.rightsStatus === "user_provided" && actor.actorType !== "user") {
    throw new DeepResearchGateError("user-provided research material requires an explicit user actor");
  }
  if (request.sourceType === "personal_research_note"
    && (actor.actorType !== "user" || request.claimType !== "model_inference"
      || request.verificationStatus !== "unverified" || request.rightsStatus !== "user_provided"
      || citation !== null || request.replacesMaterialId)) {
    throw new DeepResearchGateError("personal research note must remain an isolated Owner draft");
  }
  if (!priorJudgmentNote && request.priorDecisionBinding !== undefined)
    throw new DeepResearchGateError("prior judgment binding is reserved for Owner prior judgment notes");
  if (ocrNote && (actor.actorType !== "user" || request.claimType !== "model_inference"
    || request.verificationStatus !== "unverified" || request.rightsStatus !== "user_provided"
    || request.sourceUrl !== null || request.isRead !== true || request.summary !== "人工 OCR 校对备注，尚未核验原文或事实")) {
    throw new DeepResearchGateError("OCR correction notes must remain cited, user-authored, unverified drafts");
  }
  if (request.publishedAt!==null && Date.parse(request.publishedAt) > now.getTime()) {
    throw new DeepResearchGateError("research material cannot be captured before its publication time");
  }
  const normalized = normalizeMarketCode(market, code);
  if (priorJudgmentNote) {
    const binding = request.priorDecisionBinding;
    if (!validateCreateResearchMaterialRequest(request).ok || !binding || actor.actorType !== "user"
      || citation !== null || futuFinancialSource !== null) {
      throw new DeepResearchGateError("Owner prior judgment note requires an exact private excerpt selection");
    }
    const expected = ownerPriorJudgmentNoteFields(normalized.symbol, binding);
    if (request.title !== expected.title || request.contentText !== expected.contentText
      || request.summary !== expected.summary || request.sourceVersion !== expected.sourceVersion
      || request.publishedAt !== expected.publishedAt) {
      throw new DeepResearchGateError("Owner prior judgment note must preserve its exact selected excerpt and source identity");
    }
  }
  const auditRequest = actorRequest(actor, request.idempotencyKey);
  const fingerprint = researchMaterialCreateFingerprint(normalized, request, actor, citation, futuFinancialSource);
  const client = await pool.connect();
  try {
    await client.query("begin");
    let replay = await findAuditByIdempotencyKey<ResearchMaterialData>(client, request.idempotencyKey, "research_material_created");
    if (replay) {
      if (!sameBoundResearchWriteReplay(replay, actor, request, fingerprint)) throw idempotencyConflict();
      await client.query("commit");
      return replay.envelope;
    }
    await assertCandidateResearchWriteBinding(client, actor, request, normalized);
    if (priorJudgmentNote) await assertOwnerPriorJudgmentBinding(client, request, actor, normalized);
    if (ocrNote) await assertOcrCorrectionCitation(client, request, actor, citation);
    let snapshotOriginal: ResearchMaterialData["snapshotOriginal"] = null;
    if (html && isSnapshotTextCitation(citation)) {
      const source = await assertSnapshotCitation(client, request.membershipId, request.membershipVersion, actor, citation, request.contentText);
      snapshotOriginal={rawSha256:source.rawSha256,byteLength:source.byteLength,mediaType:source.mediaType,
        canonicalUrl:source.canonicalUrl,responseUrl:source.responseUrl};
      const expectedVersion = `html:snapshot-${citation.snapshotId}:${source.rawSha256}:${citation.textSha256.slice(0,16)}:${citation.startUtf16}-${citation.endUtf16}`;
      if (request.sourceUrl !== source.responseUrl || request.publishedAt !== source.publishedAt
        || request.sourceVersion !== expectedVersion || request.summary !== request.contentText.slice(0,300)
        || request.claimType !== "issuer_statement" || request.verificationStatus !== "unverified"
        || request.rightsStatus !== "authorized_public" || request.isRead !== true)
        throw new DeepResearchGateError("HTML material must preserve its confirmed original and server-derived summary");
    }
    await assertOwnerAssistantCorrectionBinding(client, request, actor, now);
    await assertOwnerReportCorrectionBinding(client, request, actor, now);
    replay = await findAuditByIdempotencyKey<ResearchMaterialData>(client, request.idempotencyKey, "research_material_created");
    if (replay) {
      if (!sameBoundResearchWriteReplay(replay, actor, request, fingerprint)) throw idempotencyConflict();
      await client.query("commit");
      return replay.envelope;
    }

    const stock = await upsertStock(client, normalized.market, normalized.code, normalized.symbol, null);
    const profileId = await ensureResearchProfile(client, stock);
    const materialMembershipId = researchMaterialMembershipId(request);
    const revision = await nextMaterialRevision(client, profileId, materialMembershipId, request, citation);
    const contentFingerprint = researchMaterialFingerprint(request.contentText);
    const evidence = await client.query<{ id: string; captured_at: Date | string }>(
      `insert into evidence_items
        (research_profile_id, source_type, source_url, published_at, captured_at, summary, fact_kind,
         variable_name, stance, reliability, materiality, is_read, raw_payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
       returning id, captured_at`,
      [
        profileId,
        request.sourceType,
        request.sourceUrl ?? null,
        request.publishedAt,
        now,
        request.summary,
        request.claimType === "model_inference" ? "inference" : "fact",
        request.variableName ?? null,
        request.stance,
        request.reliability ?? null,
        request.materiality ?? null,
        request.isRead ?? false,
        JSON.stringify({
          source: "research-material-api",
          claimType: request.claimType,
          contentFingerprint,
          ownerCorrectionBinding: request.ownerCorrectionBinding ?? null,
          assistantCorrectionBinding: request.assistantCorrectionBinding ?? null,
          ...(request.priorDecisionBinding === undefined ? {} : { priorDecisionBinding: request.priorDecisionBinding })
          ,...(futuFinancialSource?{futuFinancialSource}:{})
        })
      ]
    );
    const material = await client.query<{ id: string }>(
      `insert into research_materials
        (research_profile_id, candidate_membership_id, evidence_item_id, replaces_material_id, revision, material_kind, title, content_text, content_fingerprint,
         claim_type, verification_status, rights_status, source_version, valid_until,
         citation_document_id, citation_page_number, citation_page_text_sha256,
         citation_snapshot_id,citation_snapshot_membership_version,citation_snapshot_text_sha256,
         citation_start_utf16,citation_end_utf16,citation_excerpt_sha256)
       values ($1, $2, $3, $4, $5, 'text', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
         $17,$18,$19,$20,$21,$22)
       returning id`,
      [
        profileId,
        materialMembershipId,
        evidence.rows[0].id,
        request.replacesMaterialId ?? null,
        revision,
        request.title,
        request.contentText,
        contentFingerprint,
        request.claimType,
        request.verificationStatus,
        request.rightsStatus,
        request.sourceVersion,
        request.validUntil,
        citation && !isSnapshotTextCitation(citation) ? citation.documentId : null,
        citation && !isSnapshotTextCitation(citation) ? citation.pageNumber : null,
        citation && !isSnapshotTextCitation(citation) ? citation.pageTextSha256 : null,
        citation && isSnapshotTextCitation(citation) ? citation.snapshotId : null,
        citation && isSnapshotTextCitation(citation) ? request.membershipVersion : null,
        citation && isSnapshotTextCitation(citation) ? citation.textSha256 : null,
        citation && isSnapshotTextCitation(citation) ? citation.startUtf16 : null,
        citation && isSnapshotTextCitation(citation) ? citation.endUtf16 : null,
        citation && isSnapshotTextCitation(citation) ? citation.excerptSha256 : null
      ]
    );
    const data = rowToResearchMaterial({
      id: material.rows[0].id,
      candidate_membership_id: materialMembershipId,
      evidence_id: evidence.rows[0].id,
      replaces_material_id: request.replacesMaterialId ?? null,
      revision,
      revision_state: "current",
      market: normalized.market as "HK",
      code: normalized.code,
      symbol: normalized.symbol,
      material_kind: "text",
      title: request.title,
      content_text: request.contentText,
      source_type: request.sourceType,
      source_url: request.sourceUrl ?? null,
      published_at: request.publishedAt,
      captured_at: evidence.rows[0].captured_at,
      content_fingerprint: contentFingerprint,
      claim_type: request.claimType,
      verification_status: request.verificationStatus,
      rights_status: request.rightsStatus,
      source_version: request.sourceVersion,
      valid_until: request.validUntil,
      summary: request.summary,
      variable_name: request.variableName ?? null,
      stance: request.stance,
      reliability: request.reliability ?? null,
      materiality: request.materiality ?? null,
      is_read: request.isRead ?? false,
      citation_document_id: citation && !isSnapshotTextCitation(citation) ? citation.documentId : null,
      citation_page_number: citation && !isSnapshotTextCitation(citation) ? citation.pageNumber : null,
      citation_page_text_sha256: citation && !isSnapshotTextCitation(citation) ? citation.pageTextSha256 : null,
      citation_snapshot_id: citation && isSnapshotTextCitation(citation) ? citation.snapshotId : null,
      citation_snapshot_membership_version: citation && isSnapshotTextCitation(citation) ? request.membershipVersion : null,
      citation_snapshot_text_sha256: citation && isSnapshotTextCitation(citation) ? citation.textSha256 : null,
      citation_start_utf16: citation && isSnapshotTextCitation(citation) ? citation.startUtf16 : null,
      citation_end_utf16: citation && isSnapshotTextCitation(citation) ? citation.endUtf16 : null,
      citation_excerpt_sha256: citation && isSnapshotTextCitation(citation) ? citation.excerptSha256 : null,
      snapshot_raw_sha256:snapshotOriginal?.rawSha256??null,
      snapshot_byte_length:snapshotOriginal?.byteLength??null,
      snapshot_media_type:snapshotOriginal?.mediaType??null,
      snapshot_canonical_url:snapshotOriginal?.canonicalUrl??null,
      snapshot_response_url:snapshotOriginal?.responseUrl??null
      ,futu_financial_source:futuFinancialSource
    } satisfies ResearchMaterialRow, now);
    const auditAsOf = await insertWriteAudit(client, {
      eventType: "research_material_created",
      request: auditRequest,
      stock,
      targetTable: "research_materials",
      targetId: data.id,
      beforePayload: request.ownerCorrectionBinding
        ? { ownerCorrectionBinding: request.ownerCorrectionBinding }
        : request.assistantCorrectionBinding
          ? { assistantCorrectionBinding: request.assistantCorrectionBinding }
          : request.priorDecisionBinding
            ? { priorDecisionBinding: request.priorDecisionBinding }
          : null,
      afterPayload: data,
      requestFingerprint: fingerprint,
      candidateMembershipId: request.membershipId,
      candidateMembershipVersion: request.membershipVersion
    });
    await client.query("commit");
    return writeEnvelope(auditRequest, data, `Research material for ${normalized.symbol} created.`, auditAsOf);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      const replay = await findAuditByIdempotencyKey<ResearchMaterialData>(pool, request.idempotencyKey, "research_material_created");
      if (replay && sameBoundResearchWriteReplay(replay, actor, request, fingerprint)) return replay.envelope;
      throw idempotencyConflict();
    }
    throw error;
  } finally {
    client.release();
  }
}

export { deleteResearchMaterial, readResearchMaterialDeletion } from "./researchMaterialDeletionRepository.js";

async function assertOwnerPriorJudgmentBinding(
  client: PoolClient,
  request: CreateResearchMaterialRequest,
  actor: AuthenticatedResearchActor,
  normalized: { market: string; code: string; symbol: string }
): Promise<void> {
  const binding = request.priorDecisionBinding;
  if (!binding || actor.actorType !== "user")
    throw new DeepResearchGateError("Owner prior judgment note requires an explicit user actor");
  const result = await client.query<{ checked_at: Date | string }>(
    `select checks.checked_at
       from pre_trade_decision_checks checks
       join stocks stock on stock.id = checks.stock_id
      where checks.id = $1 and checks.deleted_at is null
        and checks.market = $2 and checks.code = $3 and checks.symbol = $4
        and stock.market = $2 and stock.code = $3 and stock.symbol = $4
        and date_trunc('milliseconds', checks.checked_at) = $5::text::timestamptz
        and strpos(checks.user_final_decision, $6::text) > 0
        and coalesce(checks.raw_payload->'conditionalDecision', 'null'::jsonb) = 'null'::jsonb
        and coalesce(checks.raw_payload #>> '{researchReportDecision,availability}', 'not_captured') = 'not_captured'
        and coalesce(checks.raw_payload #> '{researchReportDecision,binding}', 'null'::jsonb) = 'null'::jsonb
        and coalesce(checks.raw_payload #>> '{formalDecision,availability}', 'not_captured') = 'not_captured'
        and coalesce(checks.raw_payload #> '{formalDecision,systemRecommendation}', 'null'::jsonb) = 'null'::jsonb
        and coalesce(checks.raw_payload #> '{formalDecision,ownerDecision}', 'null'::jsonb) = 'null'::jsonb
        and (select count(*) from research_write_audit_events audit
              where audit.event_type = 'decision_check_created'
                and audit.target_table = 'pre_trade_decision_checks'
                and audit.target_id = checks.id::text
                and audit.actor_type = $7 and audit.actor_id is not distinct from $8
                and audit.after_payload->>'id' = checks.id::text
                and audit.after_payload->>'symbol' = checks.symbol
                and audit.after_payload->>'checkedAt' = $5::text
                and audit.after_payload->>'userFinalDecision' = checks.user_final_decision) = 1
      for share of checks`,
    [binding.decisionCheckId, normalized.market, normalized.code, normalized.symbol,
      binding.checkedAt, binding.excerpt, actor.actorType, actor.actorId]
  );
  if (result.rows.length !== 1 || new Date(result.rows[0]!.checked_at).toISOString() !== binding.checkedAt)
    throw new DeepResearchGateError("Owner prior judgment source is missing, changed, or is not an ordinary same-actor check");
}

async function assertOwnerAssistantCorrectionBinding(
  client: PoolClient,
  request: CreateResearchMaterialRequest,
  actor: AuthenticatedResearchActor,
  now: Date
): Promise<void> {
  if (request.sourceType !== OWNER_ASSISTANT_REPORT_CORRECTION_SOURCE_TYPE) return;
  const binding = request.assistantCorrectionBinding;
  if (!binding || actor.actorType !== "user") {
    throw new DeepResearchGateError("Owner assistant correction requires an explicit user and exact report binding");
  }
  const workspace = await readDeepResearchWorkspace(client, request.membershipId, actor, now, {
    accountScopeId: null,
    currentPortfolioEnabled: false,
    currentPortfolioMaxAgeSeconds: 300,
    enforceCurrentHoldingBindings: false
  });
  const data = workspace.data;
  if (workspace.status !== "available" || !data
    || !ownerAssistantCorrectionBindingMatches(request, data)) {
    throw new DeepResearchGateError("Owner assistant correction report or evidence pack is no longer exact-current");
  }
}

export function ownerAssistantCorrectionBindingMatches(
  request: CreateResearchMaterialRequest,
  data: NonNullable<DeepResearchWorkspaceEnvelope["data"]>
): boolean {
  const binding = request.assistantCorrectionBinding;
  const pack = data.latestPack;
  const report = data.latestReport;
  return binding !== undefined
    && data.target.membershipId === request.membershipId
    && data.target.membershipVersion === request.membershipVersion
    && data.target.membershipState !== "archived"
    && pack?.id === binding.evidencePackId
    && pack.packFingerprint === binding.evidencePackFingerprint
    && pack.currentness.status === "current"
    && pack.currentness.invalidatedBy.length === 0
    && report?.id === binding.reportId
    && report.version === binding.reportVersion
    && report.reportFingerprint === binding.reportFingerprint
    && report.evidencePackId === binding.evidencePackId
    && report.currentness.status === "current"
    && report.currentness.invalidatedBy.length === 0
    && report.currentness.evidencePackInvalidatedBy.length === 0;
}
async function assertOwnerReportCorrectionBinding(
  client: PoolClient,
  request: CreateResearchMaterialRequest,
  actor: AuthenticatedResearchActor,
  now: Date
): Promise<void> {
  if (request.sourceType !== OWNER_REPORT_REVIEW_CORRECTION_SOURCE_TYPE) return;
  const binding = request.ownerCorrectionBinding;
  if (!binding || actor.actorType !== "user" || actor.actorId !== binding.reportBinding.reportDecisionActorId
    || request.membershipId !== binding.reportBinding.membershipId
    || request.membershipVersion !== binding.reportBinding.membershipVersion) {
    throw new DeepResearchGateError("Owner report correction requires the exact user, membership, report and review binding");
  }
  const lockedCheck = await client.query<{ id: string }>(
    `select checks.id from pre_trade_decision_checks checks
       join stocks stock on stock.id = checks.stock_id
      where checks.id = $1 and checks.deleted_at is null for update of stock, checks`,
    [binding.decisionCheckId]
  );
  if (lockedCheck.rows.length !== 1) {
    throw new DeepResearchGateError("Owner report correction decision check is missing");
  }
  const reviews = await client.query<{
    id: string;
    decision_check_id: string;
    outcome: string;
    reviewed_at: Date | string;
    market: string;
    code: string;
    symbol: string;
    checked_at: Date | string;
  }>(
    `select review.id, review.decision_check_id, review.outcome, review.reviewed_at,
            checks.market, checks.code, checks.symbol, checks.checked_at
       from post_decision_reviews review
       join pre_trade_decision_checks checks on checks.id = review.decision_check_id
      where review.id = $1 and checks.id = $2
        and review.deleted_at is null and checks.deleted_at is null
        and review.actor_type = $3 and review.actor_id is not distinct from $4
        and exists (
          select 1 from research_write_audit_events check_audit
           where check_audit.event_type = 'decision_check_created' and check_audit.target_table = 'pre_trade_decision_checks'
             and check_audit.target_id = checks.id::text
             and check_audit.actor_type = $3 and check_audit.actor_id is not distinct from $4
        )
        and not exists (
          select 1 from pre_trade_decision_checks newer
           where newer.market = checks.market and newer.code = checks.code and newer.symbol = checks.symbol
             and newer.deleted_at is null
             and (newer.checked_at, newer.id) > (checks.checked_at, checks.id)
             and exists (
               select 1 from research_write_audit_events newer_audit
                where newer_audit.event_type = 'decision_check_created' and newer_audit.target_table = 'pre_trade_decision_checks'
                  and newer_audit.target_id = newer.id::text
                  and newer_audit.actor_type = $3 and newer_audit.actor_id is not distinct from $4
             )
        )
        and not exists (
          select 1 from post_decision_reviews newer
           where newer.decision_check_id = review.decision_check_id
             and newer.deleted_at is null
             and newer.actor_type = review.actor_type
             and newer.actor_id is not distinct from review.actor_id
             and (newer.reviewed_at, newer.created_at, newer.id)
                 > (review.reviewed_at, review.created_at, review.id)
        )
      for update of review`,
    [binding.reviewId, binding.decisionCheckId, actor.actorType, actor.actorId]
  ); const review = reviews.rows[0];
  if (reviews.rows.length !== 1 || !review
    || review.outcome !== binding.reviewOutcome
    || new Date(review.reviewed_at).toISOString() !== new Date(binding.reviewedAt).toISOString()
    || review.symbol !== binding.reportBinding.symbol) {
    throw new DeepResearchGateError("Owner report correction review is missing, stale or no longer latest");
  }
  const audits = await client.query<{ before_payload: { dailyTrackingBinding?: unknown } | null }>(
    `select before_payload
       from research_write_audit_events
      where event_type = 'post_decision_review_created'
        and target_table = 'post_decision_reviews' and target_id = $1
        and actor_type = $2 and actor_id is not distinct from $3
      order by id`,
    [binding.reviewId, actor.actorType, actor.actorId]
  );
  if (audits.rows.length !== 1
    || canonicalJson(audits.rows[0]?.before_payload?.dailyTrackingBinding)
      !== canonicalJson(binding.reportBinding)) {
    throw new DeepResearchGateError("Owner report correction review audit does not match the exact report binding");
  }
  try {
    await readBoundTodayResearchReport(
      client,
      binding.reportBinding,
      {
        market: review.market,
        code: review.code,
        symbol: review.symbol,
        checkedAt: review.checked_at
      },
      actor,
      now
    );
  } catch {
    throw new DeepResearchGateError("Owner report correction report binding is no longer exact and current");
  }
}

export function researchMaterialCreateFingerprint(
  normalized: { market: string; code: string; symbol: string },
  request: CreateResearchMaterialRequest,
  actor: AuthenticatedResearchActor,
  citation: ResearchSourceCitation | null,
  futuFinancialSource:FutuFinancialMaterialSource|null = null
): string {
  return requestFingerprint("research_material_create", { normalized, request, actor, citation,
    ...(futuFinancialSource?{futuFinancialSource}:{}) });
}

export function researchMaterialMembershipId(
  request: Pick<CreateResearchMaterialRequest, "membershipId" | "rightsStatus"> & Pick<Partial<CreateResearchMaterialRequest>, "sourceType">
): string | null {
  return request.rightsStatus === "user_provided" ||
    (request.rightsStatus === "authorized_public" && [ISSUER_PUBLIC_PDF_SOURCE_TYPE,ISSUER_PUBLIC_HTML_SOURCE_TYPE].includes(request.sourceType ?? ""))
    ? request.membershipId
    : null;
}

function idempotencyConflict(): IdempotencyConflictError {
  return new IdempotencyConflictError("idempotency key or material content/version already exists with different source-bound facts");
}

async function assertOcrCorrectionCitation(
  client: PoolClient,
  request: CreateResearchMaterialRequest,
  actor: AuthenticatedResearchActor,
  citation: ResearchSourceCitation | null
): Promise<void> {
  if (!citation || isSnapshotTextCitation(citation)) throw new DeepResearchGateError("OCR correction note requires a PDF page citation");
  const result = await client.query<{
    pdf_sha256: string; published_at: Date | string; normalized_text: string;
    text_sha256: string; ocr_applied: boolean;
  }>(
    `select rd.pdf_sha256, rd.published_at, p.normalized_text, p.text_sha256, p.ocr_applied
       from research_documents rd
       join research_document_pages p on p.document_id=rd.id and p.page_number=$3
       join candidate_memberships cm on cm.id=rd.candidate_membership_id
      where rd.id=$2 and rd.candidate_membership_id=$1
        and cm.actor_type=$4 and cm.actor_id=$5 and cm.version=$6
        and rd.captured_membership_version<=cm.version
      limit 1`,
    [request.membershipId, citation.documentId, citation.pageNumber, actor.actorType, actor.actorId, request.membershipVersion]
  );
  const page = result.rows[0];
  if (!page || !page.ocr_applied || page.text_sha256 !== citation.pageTextSha256
    || researchMaterialFingerprint(page.normalized_text) !== citation.pageTextSha256
    || new Date(page.published_at).toISOString() !== request.publishedAt
    || request.sourceVersion !== `ocr-note:pdf:${page.pdf_sha256}:p${citation.pageNumber}:${page.text_sha256.slice(0, 16)}:${researchMaterialFingerprint(request.contentText).slice(0, 16)}`) {
    throw new DeepResearchGateError("OCR correction note no longer matches its original PDF page and OCR text");
  }
}

async function nextMaterialRevision(
  client: PoolClient,
  profileId: string,
  membershipId: string | null,
  request: CreateResearchMaterialRequest,
  citation: ResearchSourceCitation | null
): Promise<number> {
  if (!request.replacesMaterialId) return 1;
  const result = await client.query<{
    revision: number | string;
    source_type: string;
    source_url: string | null;
    source_version: string;
    replaced: boolean;
    citation_document_id: string | null;
    citation_page_number: number | string | null;
    citation_page_text_sha256: string | null;
  }>(
    `select rm.revision, rm.source_version, ei.source_type, ei.source_url,
            rm.citation_document_id, rm.citation_page_number, rm.citation_page_text_sha256,
            exists (select 1 from research_materials child where child.replaces_material_id = rm.id) as replaced
       from research_materials rm
       join evidence_items ei on ei.id = rm.evidence_item_id
      where rm.id = $1
        and rm.research_profile_id = $2
        and rm.candidate_membership_id is not distinct from $3::bigint
        and rm.deleted_at is null
      for update of rm`,
    [request.replacesMaterialId, profileId, membershipId]
  );
  const parent = result.rows[0];
  if (!parent || parent.replaced) throw new DeepResearchGateError("replaced material must be a current material in the same research profile");
  if (parent.source_type !== request.sourceType || parent.source_url !== (request.sourceUrl ?? null)) {
    throw new DeepResearchGateError("material revisions must retain the same source type and URL");
  }
  if (request.sourceType === OWNER_OCR_CORRECTION_NOTE_SOURCE_TYPE
    && (!citation || isSnapshotTextCitation(citation)
      || String(parent.citation_document_id) !== citation.documentId
      || Number(parent.citation_page_number) !== citation.pageNumber
      || parent.citation_page_text_sha256 !== citation.pageTextSha256)) {
    throw new DeepResearchGateError("OCR correction revisions must retain the same original PDF page and OCR text");
  }
  if (parent.source_version === request.sourceVersion) throw new DeepResearchGateError("material revisions require a new source version");
  return Number(parent.revision) + 1;
}
