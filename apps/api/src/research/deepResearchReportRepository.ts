import { readReportConfirmationFailures, projectReportConfirmationReadiness } from "./researchReportReadiness.js";
import type { Pool, PoolClient } from "pg";
import type {
  CreateDeepResearchReportRequest, DeleteDeepResearchReportRequest, DecideDeepResearchReportRequest,
  DeepResearchDecisionData, DeepResearchReportData, DeepResearchReportDeletionData,
  EvidenceBoundDeepResearchReportPayload,
  ResearchEvidencePackData
} from "../../../../packages/contracts/src/deepResearch.js";
import { EVIDENCE_BOUND_REPORT_CONTRACT_VERSION, LEGACY_REPORT_CONTRACT_VERSION } from "../../../../packages/contracts/src/deepResearch.js";
import {
  DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
  type CreateSynthesizedDeepResearchReportRequest,
  type SynthesizedDeepResearchReportPayload
} from "../../../../packages/contracts/src/deepResearchSynthesisReport.js";
import { deepResearchSnapshotBindsCurrentSources } from "../../../../packages/contracts/src/deepResearchSnapshot.js";
import { readCurrentDeepResearchSnapshot } from "./deepResearchSnapshotAssembler.js";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import type { ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import { DeepResearchGateError, IdempotencyConflictError, type AuthenticatedResearchActor } from "./domain.js";
import {
  deepResearchGateFailures,
  deepResearchReportFingerprint,
  evidenceBoundReportIntegrityFailures,
  evidenceBoundReportPayload,
  computedEvidencePackFingerprint,
  requestFingerprint,
  synthesizedDeepResearchReportIntegrityFailures,
  synthesizedDeepResearchReportPayload
} from "./deepResearchGate.js";
import { rowToDeepResearchDecision, rowToDeepResearchReport, type DeepResearchDecisionRow, type DeepResearchReportRow } from "./deepResearchMappers.js";
import {
  readDeepResearchDecision,
  readDeepResearchReport,
  readDeepResearchReportForReplay,
  readEvidencePack,
  readEvidencePackInvalidatedBy,
  readLatestEvidencePack
} from "./deepResearchPersistence.js";
import { assertCandidateMembershipWriteBinding, sameBoundResearchWriteReplay } from "./researchWriteBinding.js";
import { readResearchFundamentalsExport } from "./researchFundamentalRepository.js";
import { readResearchContextSnapshot } from "./researchContextRepository.js";
import type { QuantEvidenceRuntimeOptions } from "./quantEvidenceSource.js";
import type { SourceSnapshotStoreOptions } from "./researchSourceSnapshotRepository.js";
import { readResearchEvents } from "./researchEventRepository.js";
import { readLatestGeelySalesMonitor } from "./geelySalesMonitorRepository.js";
import { readLatestGclPvPriceMonitor } from "./gclPvPriceMonitorRepository.js";
import { readCurrentResearchMonitorRules } from "./researchProfileReadRepository.js";
import { readCandidateMembershipById } from "./candidateMembershipPersistence.js";
import {
  actorRequest, ensureResearchProfile, findAuditByIdempotencyKey, insertWriteAudit,
  isUniqueViolation, readExistingResearchProfileBinding, upsertStock, writeEnvelope, type ResearchWriteAuditReplay
} from "./writePersistence.js";
export async function createDeepResearchReport(
  pool: Pool,
  membershipId: string,
  request: CreateDeepResearchReportRequest | CreateSynthesizedDeepResearchReportRequest,
  actor: AuthenticatedResearchActor, now = new Date(), quantEvidence: QuantEvidenceRuntimeOptions | null = null,
  sourceStore?:SourceSnapshotStoreOptions
): Promise<ResearchWriteEnvelope<DeepResearchReportData>> {
  const boundRequest = { ...request, membershipId };
  const fingerprint = requestFingerprint("deep_research_report_create", { boundRequest, actor });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await createDeepResearchReportInTransaction(client, membershipId, request, actor, now, sourceStore);
    const failures = result.data.status === "complete_pending_confirmation"
      ? await readReportConfirmationFailures(client, membershipId, actor, now, quantEvidence, sourceStore) : [];
    await client.query("commit");
    return { ...result, data: projectReportConfirmationReadiness(result.data, failures),
      message: failures.length ? "研究草稿已保存；当前资料尚不满足正式确认条件。" : result.message };
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      const replay = await findAuditByIdempotencyKey<DeepResearchReportData>(pool, request.idempotencyKey, "deep_research_report_created");
      if (replay && sameBoundResearchWriteReplay(replay, actor, boundRequest, fingerprint)) {
        return createDeepResearchReport(pool, membershipId, request, actor, now, quantEvidence, sourceStore);
      }
      throw idempotencyConflict();
    }
    throw error;
  } finally {
    client.release();
  }
}
export async function createDeepResearchReportInTransaction(
  client: PoolClient,
  membershipId: string,
  request: CreateDeepResearchReportRequest | CreateSynthesizedDeepResearchReportRequest,
  actor: AuthenticatedResearchActor,
  now = new Date(),
  sourceStore?:SourceSnapshotStoreOptions
): Promise<ResearchWriteEnvelope<DeepResearchReportData>> {
    const boundRequest = { ...request, membershipId };
    const auditRequest = actorRequest(actor, request.idempotencyKey);
    const fingerprint = requestFingerprint("deep_research_report_create", { boundRequest, actor });
    let replay = await findAuditByIdempotencyKey<DeepResearchReportData>(client, request.idempotencyKey, "deep_research_report_created");
    if (replay) {
      return exactDeepResearchReportReplay(client, replay, actor, boundRequest, fingerprint);
    }
    const membership = await assertCandidateMembershipWriteBinding(client, actor, boundRequest);
    replay = await findAuditByIdempotencyKey<DeepResearchReportData>(
      client,
      request.idempotencyKey,
      "deep_research_report_created"
    );
    if (replay) return exactDeepResearchReportReplay(client, replay, actor, boundRequest, fingerprint);
    const stock = await upsertStock(client, membership.market, membership.code, membership.symbol, null);
    const profileId = await ensureResearchProfile(client, stock);
    const pack = await readEvidencePack(client, request.evidencePackId, profileId, now);
    if (!pack || pack.membershipId !== membershipId || pack.membershipVersion !== request.membershipVersion) {
      throw new DeepResearchGateError("evidence pack does not match the current candidate membership");
    }
    if (computedEvidencePackFingerprint(pack) !== pack.packFingerprint) {
      throw new DeepResearchGateError("evidence pack content fingerprint is invalid");
    }
    const invalidatedBy = await readEvidencePackInvalidatedBy(
      client,
      profileId,
      pack,
      actor,
      {
        id: membershipId,
        version: Number(membership.version),
        state: membership.state,
        market: membership.market,
        code: membership.code,
        symbol: membership.symbol
      },
      now,
      undefined,
      undefined,
      sourceStore
    );
    if (invalidatedBy.length > 0) {
      throw new DeepResearchGateError(
        "historical evidence pack cannot create a current deep research report",
        invalidatedBy
      );
    }
    const latestPack = await readLatestEvidencePack(
      client,
      profileId,
      membershipId,
      request.membershipVersion,
      now
    );
    if (!latestPack || latestPack.id !== pack.id) {
      throw new DeepResearchGateError(
        "only the latest exact current evidence pack can create a formalizable report"
      );
    }
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`deep-research-report:${profileId}`]
    );
    if (isSynthesisRequest(request) && request.snapshot.analysisContentVersion) {
      const current = await readCurrentDeepResearchSnapshot(client, membershipId, {
        membershipVersion: request.membershipVersion,
        evidencePackId: pack.id,
        evidencePackFingerprint: pack.packFingerprint,
        intent: request.snapshot.intent,
        analysisContentVersion: request.snapshot.analysisContentVersion
      }, actor, now, sourceStore);
      if (current.snapshotId !== request.snapshot.snapshotId) {
        throw new DeepResearchGateError("synthesis snapshot does not match current server evidence and prior judgment");
      }
    }
    const payload = isSynthesisRequest(request)
      ? synthesizedDeepResearchReportPayload(request, pack)
      : evidenceBoundReportPayload(request, pack);
    const integrityFailures = reportIntegrityFailures(payload, pack);
    if (integrityFailures.length > 0) {
      throw new DeepResearchGateError(
        "deep-research report integrity binding failed",
        integrityFailures
      );
    }
    const gateFailures = deepResearchGateFailures(payload, pack, now);
    const status = gateFailures.length === 0 ? "complete_pending_confirmation" : "evidence_insufficient";
    const reportFingerprint = deepResearchReportFingerprint(pack.id, payload);
    const inserted = await client.query<DeepResearchReportRow>(
      `insert into deep_research_reports
        (research_profile_id, evidence_pack_id, version, report_contract_version,
         report_fingerprint, status, report_payload, gate_failures)
       values ($1, $2, (select coalesce(max(version), 0) + 1 from deep_research_reports where research_profile_id = $1),
               $3, $4, $5, $6::jsonb, $7::text[])
       returning id, evidence_pack_id, version, report_contract_version, report_fingerprint,
                 status, report_payload, gate_failures, created_at`,
      [
        profileId, pack.id, request.reportContractVersion,
        reportFingerprint, status, JSON.stringify(payload), gateFailures
      ]
    );
    const data = rowToDeepResearchReport(inserted.rows[0]);
    const auditAsOf = await insertWriteAudit(client, {
      eventType: "deep_research_report_created",
      request: auditRequest,
      stock,
      targetTable: "deep_research_reports",
      targetId: data.id,
      beforePayload: null,
      afterPayload: data,
      requestFingerprint: fingerprint,
      candidateMembershipId: membershipId,
      candidateMembershipVersion: request.membershipVersion
    });
    return writeEnvelope(
      auditRequest,
      data,
      status === "complete_pending_confirmation"
        ? `Deep research report ${data.id} passed the structural gate and awaits user confirmation.`
        : `Deep research report ${data.id} remains evidence-insufficient.`,
      auditAsOf
    );
}
export async function readDeepResearchReportDeletion(
  pool: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  reportId: string,
  actor: AuthenticatedResearchActor
): Promise<DeepResearchReportDeletionData | null> {
  const membership = await readCandidateMembershipById(pool, actor, membershipId);
  if (!membership) return null;
  const result = await pool.query<{
    report_id: string; evidence_pack_id: string; report_version: number | string;
    membership_version: number | string; symbol: string; report_fingerprint: string | null;
    report_contract_version: string;
    deleted_at: Date | string;
  }>(
    `select report.id::text as report_id, report.evidence_pack_id::text as evidence_pack_id,
            report.version as report_version, report.deletion_membership_version as membership_version,
            profile.symbol, report.report_fingerprint, report.report_contract_version, report.deleted_at
       from deep_research_reports report
       join research_evidence_packs pack on pack.id = report.evidence_pack_id
       join research_profiles profile on profile.id = report.research_profile_id
      where report.id = $1 and pack.candidate_membership_id = $2
        and report.deleted_at is not null
      limit 1`,
    [reportId, membershipId]
  );
  const row = result.rows[0];
  return row ? {
    reportId: row.report_id,
    evidencePackId: row.evidence_pack_id,
    reportVersion: Number(row.report_version),
    membershipId,
    membershipVersion: Number(row.membership_version),
    symbol: row.symbol,
    reportFingerprint: deepResearchDeletionFingerprint(row.report_fingerprint, row.report_contract_version),
    deletedAt: new Date(row.deleted_at).toISOString(),
    state: "deleted"
  } : null;
}

export function deepResearchDeletionFingerprint(
  fingerprint: string | null,
  contractVersion: string
): string {
  if (fingerprint) return fingerprint;
  if (contractVersion === LEGACY_REPORT_CONTRACT_VERSION) return "UNKNOWN";
  throw new DeepResearchGateError("deleted report fingerprint is missing for a non-legacy report");
}

export async function deleteDeepResearchReport(
  pool: Pool,
  membershipId: string,
  reportId: string,
  request: DeleteDeepResearchReportRequest,
  actor: AuthenticatedResearchActor,
  now = new Date()
): Promise<ResearchWriteEnvelope<DeepResearchReportDeletionData>> {
  if (actor.actorType !== "user" || !actor.actorId) {
    throw new DeepResearchGateError("deep research report deletion requires an explicit user actor");
  }
  const boundRequest = { membershipId, membershipVersion: request.membershipVersion };
  const fingerprint = requestFingerprint("deep_research_report_delete", { membershipId, reportId, request, actor });
  const auditRequest = actorRequest(actor, request.idempotencyKey);
  const client = await pool.connect();
  try {
    await client.query("begin");
    let replay = await findAuditByIdempotencyKey<DeepResearchReportDeletionData>(client, request.idempotencyKey, "deep_research_report_deleted");
    if (replay) {
      if (!sameBoundResearchWriteReplay(replay, actor, boundRequest, fingerprint)) throw idempotencyConflict();
      await client.query("commit");
      return replay.envelope;
    }
    const membership = await assertCandidateMembershipWriteBinding(client, actor, boundRequest);
    replay = await findAuditByIdempotencyKey<DeepResearchReportDeletionData>(client, request.idempotencyKey, "deep_research_report_deleted");
    if (replay) {
      if (!sameBoundResearchWriteReplay(replay, actor, boundRequest, fingerprint)) throw idempotencyConflict();
      await client.query("commit");
      return replay.envelope;
    }
    const selected = await client.query<{
      report_id: string; evidence_pack_id: string; report_version: number | string;
      report_fingerprint: string | null; report_contract_version: string;
      deleted_at: Date | string | null; stock_id: string;
    }>(
      `select report.id::text as report_id, report.evidence_pack_id::text as evidence_pack_id,
              report.version as report_version, report.report_fingerprint, report.report_contract_version,
              report.deleted_at,
              profile.stock_id::text as stock_id
         from deep_research_reports report
         join research_evidence_packs pack on pack.id = report.evidence_pack_id
         join research_profiles profile on profile.id = report.research_profile_id
        where report.id = $1 and pack.candidate_membership_id = $2
        for update of report`,
      [reportId, membershipId]
    );
    const row = selected.rows[0];
    const storedFingerprint = row?.report_fingerprint ?? "UNKNOWN";
    const legacyFingerprintMatches = request.reportFingerprint === "UNKNOWN"
      && row?.report_fingerprint === null && row?.report_contract_version === LEGACY_REPORT_CONTRACT_VERSION;
    if (!row || row.deleted_at || !(legacyFingerprintMatches || row.report_fingerprint === request.reportFingerprint)) {
      throw new DeepResearchGateError("current exact deep research report was not found, was already deleted, or changed fingerprint");
    }
    const deletedAt = now.toISOString();
    const data: DeepResearchReportDeletionData = {
      reportId: row.report_id,
      evidencePackId: row.evidence_pack_id,
      reportVersion: Number(row.report_version),
      membershipId,
      membershipVersion: request.membershipVersion,
      symbol: membership.symbol,
      reportFingerprint: storedFingerprint,
      deletedAt,
      state: "deleted"
    };
    await client.query(
      `update deep_research_tasks
          set status = 'canceled', request_payload = request_payload - 'synthesis' - 'attemptManifest' - 'sendReceipt',
              report_id = null, error_code = 'report_deleted', claim_token = null,
              lease_expires_at = null, updated_at = $2
        where report_id = $1`,
      [reportId, now]
    );
    await client.query(
      `update research_write_audit_events
          set before_payload = null,
              after_payload = jsonb_build_object(
                'reportId', $1::text, 'reportFingerprint', $2::text,
                'deletedAt', $3::text, 'state', 'deleted'
              )
        where target_table = 'deep_research_reports' and target_id = $1
          and event_type in ('deep_research_report_created', 'research_evidence_question_attempted', 'research_evidence_question_answered')`,
      [reportId, storedFingerprint, deletedAt]
    );
    const tombstone = await client.query(
      `update deep_research_reports
          set report_payload = '{"state":"deleted"}'::jsonb, deleted_at = $2,
              deleted_by_actor_id = $3, deletion_membership_version = $4
        where id = $1 and deleted_at is null`,
      [reportId, now, actor.actorId, request.membershipVersion]
    );
    if (tombstone.rowCount !== 1) {
      throw new DeepResearchGateError("deep research report changed before deletion");
    }
    const auditAsOf = await insertWriteAudit(client, {
      eventType: "deep_research_report_deleted",
      request: auditRequest,
      stock: { id: row.stock_id, market: membership.market, code: membership.code, symbol: membership.symbol },
      targetTable: "deep_research_reports",
      targetId: reportId,
      beforePayload: { reportId, reportFingerprint: storedFingerprint, state: "active" },
      afterPayload: data,
      requestFingerprint: fingerprint,
      candidateMembershipId: membershipId,
      candidateMembershipVersion: request.membershipVersion
    });
    await client.query("commit");
    return writeEnvelope(auditRequest, data, "Deep research report body deleted; a contentless tombstone remains.", auditAsOf);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      const replay = await findAuditByIdempotencyKey<DeepResearchReportDeletionData>(pool, request.idempotencyKey, "deep_research_report_deleted");
      if (replay && sameBoundResearchWriteReplay(replay, actor, boundRequest, fingerprint)) return replay.envelope;
      throw idempotencyConflict();
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function decideDeepResearchReport(
  pool: Pool,
  membershipId: string,
  reportId: string,
  request: DecideDeepResearchReportRequest,
  actor: AuthenticatedResearchActor,
  now = new Date(),
  quantEvidence?: QuantEvidenceRuntimeOptions | null,
  sourceStore?:SourceSnapshotStoreOptions
): Promise<ResearchWriteEnvelope<DeepResearchDecisionData>> {
  if (actor.actorType !== "user") throw new DeepResearchGateError("an explicit user-scoped actor is required for the final research decision");
  const boundRequest = { ...request, membershipId };
  const auditRequest = actorRequest(actor, request.idempotencyKey);
  const fingerprint = requestFingerprint("deep_research_report_decide", { reportId, boundRequest, actor });
  const client = await pool.connect();
  try {
    await client.query("begin");
    let replay = await findAuditByIdempotencyKey<DeepResearchDecisionData>(client, request.idempotencyKey, "deep_research_report_decided");
    if (replay) {
      const envelope = await exactDeepResearchDecisionReplay(client, replay, actor, boundRequest, fingerprint, reportId);
      await client.query("commit"); return envelope;
    }
    const membership = await assertCandidateMembershipWriteBinding(client, actor, boundRequest);
    replay = await findAuditByIdempotencyKey<DeepResearchDecisionData>(
      client,
      request.idempotencyKey,
      "deep_research_report_decided"
    );
    if (replay) {
      const envelope = await exactDeepResearchDecisionReplay(client, replay, actor, boundRequest, fingerprint, reportId);
      await client.query("commit"); return envelope;
    }
    if (request.decision === "confirmed") {
      const confirmationFailures = await readReportConfirmationFailures(client, membershipId, actor, now, quantEvidence, sourceStore);
      if (confirmationFailures.length) {
        throw new DeepResearchGateError(
          "research completeness is missing, stale, drifted, or below the frozen threshold; report confirmation and formal decision are blocked",
          confirmationFailures
        );
      }
    }
    const existingBinding = await readExistingResearchProfileBinding(
      client,
      membership.market,
      membership.code,
      membership.symbol
    );
    if (!existingBinding) {
      throw new DeepResearchGateError(
        "deep research decision cannot resolve the report research profile"
      );
    }
    const { stock, profileId } = existingBinding;
    const report = await readDeepResearchReport(client, reportId, profileId);
    if (!report) throw new DeepResearchGateError("deep research report was not found for the current membership");
    if (![EVIDENCE_BOUND_REPORT_CONTRACT_VERSION, DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION].includes(report.contractVersion)
      || report.currentness.status !== "current") {
      throw new DeepResearchGateError(
        "historical or legacy research report cannot receive a formal user decision",
        report.currentness.invalidatedBy
      );
    }
    if (report.status !== "complete_pending_confirmation") {
      throw new DeepResearchGateError("evidence-insufficient research cannot be confirmed", report.gateFailures);
    }
    const pack = await readEvidencePack(client, report.evidencePackId, profileId, now);
    if (!pack || pack.membershipId !== membershipId || pack.membershipVersion !== request.membershipVersion
      || computedEvidencePackFingerprint(pack) !== pack.packFingerprint) {
      throw new DeepResearchGateError("the report evidence pack no longer matches current source-bound facts");
    }
    const invalidatedBy = await readEvidencePackInvalidatedBy(
      client,
      profileId,
      pack,
      actor,
      {
        id: membershipId,
        version: Number(membership.version),
        state: membership.state,
        market: membership.market,
        code: membership.code,
        symbol: membership.symbol
      },
      now,
      undefined,
      undefined,
      sourceStore
    );
    if (invalidatedBy.length > 0) {
      throw new DeepResearchGateError(
        "historical evidence pack cannot receive a current user decision",
        invalidatedBy
      );
    }
    const latestPack = await readLatestEvidencePack(
      client,
      profileId,
      membershipId,
      request.membershipVersion,
      now
    );
    if (!latestPack || latestPack.id !== pack.id) {
      throw new DeepResearchGateError(
        "only a report bound to the latest exact current evidence pack can receive a user decision"
      );
    }
    if (report.contractVersion === DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION) {
      const [fundamentals, context, events, operatingMonitor, monitorRules] = await Promise.all([
        readResearchFundamentalsExport(client, membershipId, actor, now, sourceStore),
        readResearchContextSnapshot(client, membershipId, actor, now, sourceStore),
        readResearchEvents(client, profileId, membershipId, request.membershipVersion, now),
        readCurrentOperatingMonitor(
          client, profileId, membershipId, request.membershipVersion, membership.symbol, now
        ),
        readCurrentResearchMonitorRules(client, membershipId, actor)
      ]);
      const reportSnapshot=(report.payload as SynthesizedDeepResearchReportPayload).snapshot;
      const referencedPeerIds=new Set([...(reportSnapshot.researchContext?.peers??[]),
        ...(reportSnapshot.selectedResearchContext?.peers??[])].map(peer=>peer.id));
      if (context.status !== "available" || context.data === null
        || context.peerSourceIssues?.some(issue=>referencedPeerIds.has(issue.peerId))
        || !deepResearchSnapshotBindsCurrentSources(reportSnapshot,
          fundamentals, context.data, events.filter((event) => event.coverageScope === "research_stock"), operatingMonitor, monitorRules))
        throw new DeepResearchGateError("the report selected snapshot no longer matches current source-bound facts", ["selected_snapshot_changed"]);
    }
    const currentFailures = deepResearchGateFailures(report.payload, pack, now);
    if (currentFailures.length > 0) throw new DeepResearchGateError("deep research report no longer passes the hard gate", currentFailures);
    if (await readDeepResearchDecision(client, report.id)) {
      throw new DeepResearchGateError("deep research report already has an immutable user decision");
    }
    const inserted = await client.query<DeepResearchDecisionRow>(
      `insert into deep_research_report_decisions
        (report_id, decision, note, actor_type, actor_id)
       values ($1, $2, $3, $4, $5)
       returning id, report_id, decision, note, actor_type, actor_id, created_at`,
      [report.id, request.decision, request.note ?? null, actor.actorType, actor.actorId]
    );
    const data = rowToDeepResearchDecision(inserted.rows[0]);
    const auditAsOf = await insertWriteAudit(client, {
      eventType: "deep_research_report_decided",
      request: auditRequest,
      stock,
      targetTable: "deep_research_report_decisions",
      targetId: data.id,
      beforePayload: null,
      afterPayload: data,
      requestFingerprint: fingerprint,
      candidateMembershipId: membershipId,
      candidateMembershipVersion: request.membershipVersion
    });
    await client.query("commit");
    return writeEnvelope(auditRequest, data, `Deep research report ${report.id} ${request.decision} by the user.`, auditAsOf);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      const replay = await findAuditByIdempotencyKey<DeepResearchDecisionData>(pool, request.idempotencyKey, "deep_research_report_decided");
      if (replay && sameBoundResearchWriteReplay(replay, actor, boundRequest, fingerprint)) {
        return decideDeepResearchReport(pool, membershipId, reportId, request, actor, now, quantEvidence);
      }
      throw idempotencyConflict();
    }
    throw error;
  } finally {
    client.release();
  }
}

async function exactDeepResearchDecisionReplay(
  client: PoolClient, replay: ResearchWriteAuditReplay<DeepResearchDecisionData>, actor: AuthenticatedResearchActor,
  boundRequest: { membershipId: string; membershipVersion: number }, fingerprint: string, reportId: string
): Promise<ResearchWriteEnvelope<DeepResearchDecisionData>> {
  if (!sameBoundResearchWriteReplay(replay, actor, boundRequest, fingerprint)) throw idempotencyConflict();
  const storedDecision = await readDeepResearchDecision(client, reportId);
  if (!storedDecision || canonicalJson(storedDecision) !== canonicalJson(replay.envelope.data)) {
    throw new DeepResearchGateError("idempotent decision replay no longer matches the immutable stored decision");
  }
  return { ...replay.envelope, data: storedDecision };
}

async function readCurrentOperatingMonitor(
  client: PoolClient,
  profileId: string,
  membershipId: string,
  membershipVersion: number,
  symbol: string,
  now: Date
) {
  if (symbol === "HK.00175") {
    return readLatestGeelySalesMonitor(client, profileId, membershipId, membershipVersion, null, now);
  }
  return symbol === "HK.03800"
    ? readLatestGclPvPriceMonitor(client, profileId, membershipId, membershipVersion, null, now)
    : null;
}
function idempotencyConflict(): IdempotencyConflictError { return new IdempotencyConflictError("idempotency key already used with a different deep-research request"); }
function sameImmutableReport(stored: DeepResearchReportData, replay: DeepResearchReportData): boolean {
  return canonicalJson({
    id: stored.id,
    evidencePackId: stored.evidencePackId,
    version: stored.version,
    contractVersion: stored.contractVersion,
    reportFingerprint: stored.reportFingerprint,
    status: stored.status,
    gateFailures: stored.gateFailures,
    payload: stored.payload,
    createdAt: stored.createdAt
  }) === canonicalJson({
    id: replay.id,
    evidencePackId: replay.evidencePackId,
    version: replay.version,
    contractVersion: replay.contractVersion,
    reportFingerprint: replay.reportFingerprint,
    status: replay.status,
    gateFailures: replay.gateFailures,
    payload: replay.payload,
    createdAt: replay.createdAt
  });
}

async function exactDeepResearchReportReplay(
  client: PoolClient, replay: ResearchWriteAuditReplay<DeepResearchReportData>, actor: AuthenticatedResearchActor,
  boundRequest: { membershipId: string; membershipVersion: number }, fingerprint: string
): Promise<ResearchWriteEnvelope<DeepResearchReportData>> {
  if (!sameBoundResearchWriteReplay(replay, actor, boundRequest, fingerprint)) throw idempotencyConflict();
  const stored = await readDeepResearchReportForReplay(client, replay.envelope.data.id, boundRequest.membershipId);
  if (!stored || !sameImmutableReport(stored, replay.envelope.data)) {
    throw new DeepResearchGateError("idempotent report replay no longer matches the immutable stored report");
  }
  return { ...replay.envelope, data: stored };
}
function isSynthesisRequest(request: CreateDeepResearchReportRequest | CreateSynthesizedDeepResearchReportRequest): request is CreateSynthesizedDeepResearchReportRequest {
  return request.reportContractVersion === DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION;
}
function reportIntegrityFailures(payload: EvidenceBoundDeepResearchReportPayload | SynthesizedDeepResearchReportPayload, pack: ResearchEvidencePackData): string[] {
  return payload.reportContractVersion === DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION
    ? synthesizedDeepResearchReportIntegrityFailures(payload, pack)
    : evidenceBoundReportIntegrityFailures(payload, pack);
}
