import type { Pool, PoolClient } from "pg";
import type { CreatePreTradeDecisionCheckRequest, HumanCheckResult, ManualDecisionSourceBinding,
  OrdinaryResearchChangeBinding, PreTradeDecisionCheckData, ResearchReportDecisionState,
  SavedMaterialDecisionSourceBinding } from "../../../../packages/contracts/src/decisionContext.js";
import { DECISION_CHECK_SCHEMA_VERSION } from "../../../../packages/contracts/src/decisionContext.js";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import type { ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import { normalizeMarketCode } from "../market/freshness.js";
import { ConditionalDecisionMismatchError, ContextMismatchError, DecisionSnapshotMismatchError, FixtureDecisionContextError, IdempotencyConflictError, StockFactUnavailableError, type AuthenticatedResearchActor } from "./domain.js";
import { type DecisionCheckRow } from "./decisionReviewMappers.js";
import { decisionCheckRequestSemantics, findDecisionCheckAuditByIdempotencyKey, findExistingStock, rowToDecisionCheck, sameDecisionCheckPayload } from "./decisionCheckPersistence.js";
import { readDecisionContextEnvelope } from "./decisionContextRepository.js";
import { actorRequest, insertWriteAudit, isUniqueViolation, writeEnvelope } from "./writePersistence.js";
import { resolveDecisionSnapshot, type DecisionSnapshotResolutionOptions } from "./decisionSnapshotBinding.js";
import { annualConditionalDecisionSnapshotBinding, resolveAnnualConditionalDecision } from "./annualConditionalDecisionService.js";
import { findCandidateMembershipByIdForUpdateNowait } from "./candidateMembershipPersistence.js";
import type { QuantEvidenceRuntimeOptions } from "./quantEvidenceSource.js";
import { hasFixtureDecisionContextEvidence } from "./decisionContextFixtureGuard.js";
import { researchReportDecisionNotCapturedState } from "../../../../packages/contracts/src/decisionContext.js";
import { resolveFormalDecisionSnapshots, resolveResearchReportDecisionBinding } from "./researchReportDecisionBinding.js";
import { readResearchCompletenessSnapshot } from "./researchCompletenessRepository.js";
import { researchCompletenessAllowsFormalization } from "../../../../packages/contracts/src/researchCompleteness.js";
import { formalDecisionNotCapturedState } from "../../../../packages/contracts/src/formalDecision.js";
import { readDeepResearchWorkspace } from "./deepResearchReadRepository.js";
import type { SourceSnapshotStoreOptions } from "./researchSourceSnapshotRepository.js";
import { assertCandidateMembershipWriteBinding } from "./researchWriteBinding.js";
import { readResearchMaterials } from "./deepResearchPersistence.js";
import { assertFrozenMaterialOriginals } from "./deepResearchMaterialOriginals.js";
import { researchMaterialFingerprint } from "./deepResearchGate.js";

type DecisionCheckResolutionOptions = Omit<DecisionSnapshotResolutionOptions, "quoteLiveMaxAgeSeconds"> & {
  quantEvidence?: QuantEvidenceRuntimeOptions | null;
  sourceStore?: SourceSnapshotStoreOptions;
};

export async function createDecisionCheck(
  pool: Pool, market: string, code: string, request: CreatePreTradeDecisionCheckRequest,
  actor: AuthenticatedResearchActor, liveMaxAgeSeconds: number,
  snapshotOptions?: DecisionCheckResolutionOptions
): Promise<ResearchWriteEnvelope<PreTradeDecisionCheckData>> {
  const normalized = normalizeMarketCode(market, code);
  const now = snapshotOptions?.now ?? new Date();
  const requestSemantics = decisionCheckRequestSemantics(request);
  const reportBound = request.researchReportBinding !== undefined;
  const savedMaterialBindings = request.manualSourceBindings?.filter(isSavedMaterialBinding) ?? [];
  assertSubmittedReportChronology(request, requestSemantics);
  const existing = await findDecisionCheckAuditByIdempotencyKey(pool, request.idempotencyKey);
  if (existing) {
    if (!sameDecisionCheckPayload(existing, request, requestSemantics, normalized.symbol, actor)) throw new IdempotencyConflictError();
    assertResearchReportDecisionChronology(
      existing.envelope.data.researchReportDecision,
      existing.envelope.data.checkedAt,
      existing.envelope.asOf
    );
    return existing.envelope;
  }
  const ordinaryFacts = request.conditionalDecision || reportBound || request.researchChangeBinding
    || savedMaterialBindings.length > 0
    ? null
    : await resolveOrdinaryDecisionFacts(pool, normalized, request, liveMaxAgeSeconds, snapshotOptions);
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (request.conditionalDecision) {
      await client.query("set transaction isolation level read committed");
      const target = request.conditionalDecision.preview.data?.decisionBrief.data?.target;
      if (!target) throw new ConditionalDecisionMismatchError("conditional decision candidate binding is unavailable");
      let membership: Awaited<ReturnType<typeof findCandidateMembershipByIdForUpdateNowait>>;
      try {
        membership = await findCandidateMembershipByIdForUpdateNowait(client, actor, target.membershipId);
      } catch (error) {
        if (isLockUnavailable(error)) {
          throw new ConditionalDecisionMismatchError("candidate facts are busy; retry after the current candidate or research write finishes");
        }
        throw error;
      }
      if (!membership || membership.version !== target.membershipVersion || membership.state !== "tracked"
        || membership.symbol !== normalized.symbol) {
        throw new ConditionalDecisionMismatchError("candidate membership, version, lifecycle, or symbol changed before submission");
      }
    } else {
      await client.query("set transaction isolation level repeatable read");
    }
    if (request.researchChangeBinding)
      await assertOrdinaryResearchChangeBinding(client, normalized.symbol, request.researchChangeBinding,
        actor, now, requestSemantics.reviewedAt.kind === "timestamp"
          ? new Date(requestSemantics.reviewedAt.value) : now, snapshotOptions?.sourceStore);
    if (savedMaterialBindings.length)
      await assertSavedMaterialDecisionSources(client, normalized, savedMaterialBindings,
        actor, now, requestSemantics.reviewedAt.kind === "timestamp"
          ? new Date(requestSemantics.reviewedAt.value) : now, snapshotOptions?.sourceStore);
    const researchReportDecision = request.researchReportBinding
      ? await resolveResearchReportDecisionBinding(
        client,
        normalized,
        request.researchReportBinding,
        actor,
        now
      )
      : researchReportDecisionNotCapturedState();
    if (researchReportDecision.availability === "preserved" && researchReportDecision.binding) {
      const completeness = await readResearchCompletenessSnapshot(
        client,
        researchReportDecision.binding.membershipId,
        actor,
        now,
        snapshotOptions?.quantEvidence
      );
      if (completeness.status !== "available" || !researchCompletenessAllowsFormalization(completeness.data)) {
        throw new DecisionSnapshotMismatchError(
          "formal decision requires a current server-bound research completeness snapshot at or above the frozen threshold"
        );
      }
    }
    const transactionFacts = request.researchReportBinding || request.researchChangeBinding
      || savedMaterialBindings.length > 0
      ? await resolveOrdinaryDecisionFacts(client, normalized, request, liveMaxAgeSeconds, snapshotOptions)
      : ordinaryFacts;
    const formalDecision = request.researchReportBinding && request.formalDecision
      ? {
          availability: "preserved" as const,
          ...(await resolveFormalDecisionSnapshots(
            client,
            normalized,
            request.researchReportBinding,
            request.formalDecision,
            request.actionIntent,
            transactionFacts!.decisionSnapshot,
            actor,
            now
          )),
          limitation: "System recommendation, explicit Owner decision, and any personal-risk override are preserved separately; none creates an order, trade, or asset mutation."
        }
      : formalDecisionNotCapturedState();
    const replay = await findDecisionCheckAuditByIdempotencyKey(client, request.idempotencyKey);
    if (replay) {
      if (!sameDecisionCheckPayload(replay, request, requestSemantics, normalized.symbol, actor)) throw new IdempotencyConflictError();
      assertResearchReportDecisionChronology(
        replay.envelope.data.researchReportDecision,
        replay.envelope.data.checkedAt,
        replay.envelope.asOf
      );
      await client.query("commit");
      return replay.envelope;
    }
    const conditionalSubmission = request.conditionalDecision;
    const { context, conditionalDecision, decisionSnapshot, stock } = conditionalSubmission
      ? await resolveConditionalDecisionFacts(
        client, normalized, request, conditionalSubmission, actor, liveMaxAgeSeconds, snapshotOptions
      )
      : transactionFacts!;
    await client.query("select id from stocks where id = $1 for update", [stock.id]);
    const inserted = await client.query<DecisionCheckRow>(
      `insert into pre_trade_decision_checks
        (stock_id, market, code, symbol, legacy_id, action_intent, verdict, requested_price,
         requested_quantity, current_price, current_quantity, average_cost, market_value,
         current_weight, user_final_decision, checked_at, raw_payload, decision_context_snapshot, decision_snapshot)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, coalesce($16::timestamptz, now()), $17::jsonb, $18::jsonb, $19::jsonb)
       returning id, market, code, symbol, action_intent, verdict, requested_price,
                 requested_quantity, current_price, current_quantity, average_cost, market_value,
                 current_weight, user_final_decision, checked_at, raw_payload, decision_context_snapshot, decision_snapshot`,
      [stock.id, normalized.market, normalized.code, normalized.symbol, `candidate:${request.idempotencyKey}`, request.actionIntent,
       legacyVerdict(request.humanCheckResult), null, null, null, null, null, null, null, request.userFinalDecision ?? null,
       requestSemantics.reviewedAt.kind === "timestamp" ? requestSemantics.reviewedAt.value : null,
       JSON.stringify({ source: "production-write-api", decisionContextSchemaVersion: request.decisionContextSchemaVersion,
         decisionCheckSchemaVersion: DECISION_CHECK_SCHEMA_VERSION, contextId: request.contextId, contextHash: request.contextHash,
         humanCheckResult: request.humanCheckResult, advisoryOnly: true, noOrder: true, noTrade: true, noCashMutation: true,
         noFeeWrite: true, noPositionMutation: true, noBrokerCall: true,
         conditionalDecision: conditionalDecision ?? null,
         researchReportDecision, formalDecision,
         ...(request.manualSourceBindings === undefined ? {} : { manualSourceBindings: request.manualSourceBindings }),
         ...(request.researchChangeBinding === undefined ? {} : { researchChangeBinding: request.researchChangeBinding }),
         ...(request.reviewDueOn === undefined ? {} : { reviewDueOn: request.reviewDueOn }) }), JSON.stringify(context), JSON.stringify(decisionSnapshot)]
    );
    const decision = rowToDecisionCheck(
      inserted.rows[0], request, actor, decisionSnapshot, conditionalDecision, researchReportDecision
    );
    decision.formalDecision = formalDecision;
    const auditAsOf = await insertWriteAudit(client, { eventType: "decision_check_created", request: { idempotencyKey: request.idempotencyKey, actorType: actor.actorType, actorId: actor.actorId, correlationId: null }, stock,
      targetTable: "pre_trade_decision_checks", targetId: String(inserted.rows[0].id), beforePayload: requestSemantics, afterPayload: decision });
    assertDecisionWriteChronology(context.generatedAt, decisionSnapshot.snapshot?.capturedAt, decision.checkedAt, auditAsOf);
    assertResearchReportDecisionChronology(researchReportDecision, decision.checkedAt, auditAsOf);
    await client.query("commit");
    return writeEnvelope(actorRequest(actor, request.idempotencyKey), decision, `Human pre-trade check for ${normalized.symbol} recorded without creating an order, trade, cash movement, fee, or position mutation.`, auditAsOf);
  } catch (error) {
    await client.query("rollback");
    if (isUniqueViolation(error)) {
      if (reportBound) {
        const concurrentReplay = await findDecisionCheckAuditByIdempotencyKey(pool, request.idempotencyKey);
        if (!concurrentReplay) throw new IdempotencyConflictError();
        return createDecisionCheck(
          pool, market, code, request, actor, liveMaxAgeSeconds, snapshotOptions
        );
      }
      const replay = await findDecisionCheckAuditByIdempotencyKey(pool, request.idempotencyKey);
      if (replay && sameDecisionCheckPayload(replay, request, requestSemantics, normalized.symbol, actor)) return replay.envelope;
      throw new IdempotencyConflictError();
    }
    throw error;
  } finally { client.release(); }
}

function assertSubmittedReportChronology(
  request: CreatePreTradeDecisionCheckRequest,
  semantics: ReturnType<typeof decisionCheckRequestSemantics>
): void {
  if (!request.researchReportBinding || semantics.reviewedAt.kind !== "timestamp") return;
  assertResearchReportDecisionChronology(
    {
      availability: "preserved",
      binding: request.researchReportBinding,
      limitation: "Validated submitted research-report binding."
    },
    semantics.reviewedAt.value,
    semantics.reviewedAt.value
  );
}

export function assertResearchReportDecisionChronology(
  researchReportDecision: ResearchReportDecisionState,
  checkedAt: string,
  auditCreatedAt: string
): void {
  if (researchReportDecision.availability !== "preserved") return;
  const timeline = [researchReportDecision.binding?.decidedAt, checkedAt, auditCreatedAt]
    .map((value) => typeof value === "string" ? Date.parse(value) : Number.NaN);
  if (timeline.some((value) => !Number.isFinite(value))
    || timeline.some((value, index) => index > 0 && value < timeline[index - 1]!)) {
    throw new DecisionSnapshotMismatchError(
      "report-bound decision must satisfy report.decidedAt <= checkedAt <= audit.createdAt"
    );
  }
}

async function resolveOrdinaryDecisionFacts(
  pool: Pick<Pool | PoolClient, "query">,
  normalized: ReturnType<typeof normalizeMarketCode>,
  request: CreatePreTradeDecisionCheckRequest,
  liveMaxAgeSeconds: number,
  snapshotOptions?: DecisionCheckResolutionOptions
) {
  const context = await readDecisionContextEnvelope(
    pool, normalized.market, normalized.code, liveMaxAgeSeconds, snapshotOptions?.now,
    snapshotOptions?.quantEvidence?.decision ?? null
  );
  assertCurrentContext(context, request);
  assertNonFixtureContext(context);
  // The exact current research change is verified in this transaction; an older
  // research-profile evidence row is not required to make that ordinary path usable.
  const savedOnly = request.manualSourceBindings?.length
    && request.manualSourceBindings.every(isSavedMaterialBinding);
  if (!request.researchReportBinding && !request.researchChangeBinding && !savedOnly)
    assertAvailableResearchEvidence(context);
  if (request.manualSourceBindings) {
    for (const selected of request.manualSourceBindings) {
      if (isSavedMaterialBinding(selected)) continue;
      const matches = context.research.evidence.filter((item) => item.id === selected.evidenceId
        && item.sourceType === selected.sourceType
        && item.sourceUrl === (selected.sourceUrl ?? null));
      if (matches.length !== 1) throw new DecisionSnapshotMismatchError(
        "selected manual source must match exactly one item in the frozen decision context"
      );
    }
  }
  const decisionSnapshot = await resolveDecisionSnapshot(
    pool,
    context,
    request.decisionSnapshotBinding,
    decisionSnapshotOptions(snapshotOptions, liveMaxAgeSeconds)
  );
  const stock = await findExistingStock(pool, normalized.market, normalized.code);
  if (!stock) throw new StockFactUnavailableError();
  return { context, conditionalDecision: undefined, decisionSnapshot, stock };
}

function isSavedMaterialBinding(value: ManualDecisionSourceBinding): value is SavedMaterialDecisionSourceBinding {
  return value.bindingKind === "saved_material";
}

async function assertSavedMaterialDecisionSources(
  client: PoolClient, normalized: ReturnType<typeof normalizeMarketCode>,
  bindings: SavedMaterialDecisionSourceBinding[], actor: AuthenticatedResearchActor,
  now: Date, decisionAt: Date, sourceStore?: SourceSnapshotStoreOptions
): Promise<void> {
  const first = bindings[0];
  if (!first || actor.actorType !== "user" || !sourceStore
    || bindings.some(binding => binding.membershipId !== first.membershipId
      || binding.membershipVersion !== first.membershipVersion)
    || new Set(bindings.map(binding => binding.materialId)).size !== bindings.length)
    throw new DecisionSnapshotMismatchError("selected saved materials need one exact Owner membership and readable originals");
  const membership = await assertCandidateMembershipWriteBinding(client, actor, first);
  if (membership.state !== "tracked" || membership.symbol !== normalized.symbol
    || membership.market !== normalized.market || membership.code !== normalized.code)
    throw new DecisionSnapshotMismatchError("saved materials do not belong to this current Owner company");
  const profile = await client.query<{ id: string }>(
    "select id::text from research_profiles where market=$1 and code=$2 limit 1",
    [normalized.market, normalized.code]);
  if (profile.rows.length !== 1) throw new DecisionSnapshotMismatchError("saved material research profile is unavailable");
  const privateRows = await client.query<{ id: string }>(
    `select id::text from research_materials where candidate_membership_id=$1::bigint
       and id=any($2::bigint[]) and deleted_at is null`,
    [first.membershipId, bindings.map(binding => binding.materialId)]);
  if (privateRows.rows.length !== bindings.length)
    throw new DecisionSnapshotMismatchError("selected materials are not all saved under this Owner membership");
  const materials = await readResearchMaterials(client, profile.rows[0]!.id, first.membershipId, now);
  const selected = bindings.map(binding => {
    const material = materials.find(item => item.id === binding.materialId);
    if (!material || material.revision !== binding.materialRevision
      || material.contentFingerprint !== binding.materialFingerprint
      || researchMaterialFingerprint(material.contentText) !== material.contentFingerprint
      || material.symbol !== normalized.symbol || material.revisionState !== "current"
      || material.freshness !== "fresh" || Date.parse(material.validUntil) <= now.getTime()
      || Date.parse(material.capturedAt) > decisionAt.getTime()
      || material.publishedAt !== null && Date.parse(material.publishedAt) > decisionAt.getTime()
      || ["conflict", "rejected"].includes(material.verificationStatus)
      || !["user_provided", "authorized_public"].includes(material.rightsStatus)
      || material.title !== binding.title || material.sourceType !== binding.sourceType
      || material.sourceUrl !== binding.sourceUrl || !savedOriginalCoordinatesMatch(material, binding))
      throw new DecisionSnapshotMismatchError("selected saved material revision or original coordinates changed");
    return material;
  });
  await assertFrozenMaterialOriginals(client, first.membershipId, actor, selected, sourceStore, true);
}

function savedOriginalCoordinatesMatch(
  material: Awaited<ReturnType<typeof readResearchMaterials>>[number],
  binding: SavedMaterialDecisionSourceBinding
): boolean {
  if (binding.sourceType === "owner_provided_pdf" || binding.sourceType === "issuer_public_pdf") {
    return material.citation?.documentId === binding.documentId
      && material.citation?.pageNumber === binding.pageNumber
      && material.citation?.pageTextSha256 === binding.contentSha256
      && material.sourceVersion === `pdf:${binding.documentPdfSha256}:p${binding.pageNumber}:${binding.contentSha256.slice(0,16)}`;
  }
  if (binding.sourceType === "issuer_public_html") {
    return material.snapshotCitation?.snapshotId === binding.snapshotId
      && material.snapshotCitation?.textSha256 === binding.contentSha256
      && material.snapshotOriginal?.rawSha256 === binding.snapshotRawSha256;
  }
  return binding.sourceType === "futu_opend_financial_statement_provider"
    && binding.contentSha256 === material.contentFingerprint
    && material.futuFinancialSource !== undefined && material.futuFinancialSource !== null;
}

async function assertOrdinaryResearchChangeBinding(
  client: Pick<Pool | PoolClient, "query">,
  symbol: string,
  binding: OrdinaryResearchChangeBinding,
  actor: AuthenticatedResearchActor,
  now: Date,
  decisionAt: Date,
  sourceStore?: SourceSnapshotStoreOptions
): Promise<void> {
  if (actor.actorType !== "user" || binding.symbol !== symbol)
    throw new DecisionSnapshotMismatchError("ordinary research change must belong to the current Owner and company");
  const workspace = await readDeepResearchWorkspace(client, binding.membershipId, actor, now, {
    accountScopeId: null, currentPortfolioEnabled: false, currentPortfolioMaxAgeSeconds: 300,
    sourceStore
  });
  const target = workspace.data?.target;
  const reasoning = workspace.data?.operatingReasoning;
  const update = reasoning?.researchUpdate;
  const change = update?.change;
  const fact = reasoning?.facts.find((item) => item.id === binding.selectedFactId);
  const source = fact?.source;
  const material = workspace.data?.materials.find((item) => item.id === binding.sourceMaterialId);
  if (!target || target.membershipId !== binding.membershipId
    || target.membershipVersion !== binding.membershipVersion || target.symbol !== symbol
    || !reasoning || reasoning.actorId !== actor.actorId
    || update?.membershipId !== binding.membershipId || update.membershipVersion !== binding.membershipVersion
    || update.symbol !== symbol || update.id !== binding.changeId
    || update.reasoningFingerprint !== binding.reasoningFingerprint
    || change?.id !== binding.changeId || change.afterFingerprint !== binding.reasoningFingerprint
    || !change.changedFactIds.includes(binding.selectedFactId)
    || !change.sourceIds.includes(binding.sourceMaterialId)
    || update.nextQuestion !== binding.nextQuestion
    || !fact || fact.membershipId !== binding.membershipId
    || fact.membershipVersion !== binding.membershipVersion || fact.symbol !== symbol
    || !source || source.materialId !== binding.sourceMaterialId
    || source.revision !== binding.sourceMaterialRevision
    || source.contentFingerprint !== binding.sourceContentFingerprint
    || source.publishedAt !== binding.sourcePublishedAt
    || fact.period.end !== binding.factPeriodEnd
    || !material || material.revision !== binding.sourceMaterialRevision
    || material.contentFingerprint !== binding.sourceContentFingerprint
    || material.revisionState !== "current" || material.freshness !== "fresh"
    || Date.parse(source.publishedAt) > now.getTime()
    || Date.parse(source.publishedAt) > decisionAt.getTime()
    || Date.parse(source.validUntil) <= now.getTime())
    throw new DecisionSnapshotMismatchError("selected research change, fact or exact source is no longer current");

  const previous = await client.query<{
    id: string; checked_at: Date | string; user_final_decision: string | null;
    raw_payload: unknown; audit_after_payload: unknown; audit_actor_type: string; audit_actor_id: string;
  }>(`select checks.id, checks.checked_at, checks.user_final_decision, checks.raw_payload,
             audit.after_payload as audit_after_payload, audit.actor_type as audit_actor_type,
             audit.actor_id as audit_actor_id
        from pre_trade_decision_checks checks
        join research_write_audit_events audit on audit.target_id = checks.id::text
         and audit.event_type = 'decision_check_created' and audit.target_table = 'pre_trade_decision_checks'
       where checks.id = $1 and checks.market = $2 and checks.code = $3 and checks.symbol = $4
         and checks.deleted_at is null and audit.actor_type = $5 and audit.actor_id = $6
       limit 2`, [binding.previousDecisionCheckId, symbol.split(".")[0], symbol.split(".")[1],
      symbol, actor.actorType, actor.actorId]);
  const prior = previous.rows.length === 1 ? previous.rows[0] : null;
  const raw = prior?.raw_payload && typeof prior.raw_payload === "object"
    ? prior.raw_payload as Record<string, unknown> : null;
  const audited = prior?.audit_after_payload && typeof prior.audit_after_payload === "object"
    ? prior.audit_after_payload as Partial<PreTradeDecisionCheckData> : null;
  const checkedAt = prior ? new Date(prior.checked_at).toISOString() : "";
  if (!prior || !raw || !audited || !prior.user_final_decision?.trim()
    || raw.source !== "production-write-api" || raw.conditionalDecision != null
    || (raw.researchReportDecision as { availability?: string } | undefined)?.availability === "preserved"
    || (raw.formalDecision as { availability?: string } | undefined)?.availability === "preserved"
    || audited.id !== prior.id || audited.symbol !== symbol
    || audited.userFinalDecision !== prior.user_final_decision || audited.checkedAt !== checkedAt
    || audited.audit?.actorType !== actor.actorType || audited.audit.actorId !== actor.actorId
    || !Number.isFinite(Date.parse(change.effectiveAt)) || Date.parse(change.effectiveAt) > decisionAt.getTime()
    || Date.parse(checkedAt) >= decisionAt.getTime()
    || Date.parse(checkedAt) > now.getTime())
    throw new DecisionSnapshotMismatchError("previous ordinary judgment is unavailable or does not precede this new judgment");
  const newer = await client.query<{ id: string }>(`select checks.id
      from pre_trade_decision_checks checks
      join research_write_audit_events audit on audit.target_id = checks.id::text
       and audit.event_type = 'decision_check_created' and audit.target_table = 'pre_trade_decision_checks'
      join pre_trade_decision_checks previous_check on previous_check.id = $6::bigint
       and previous_check.market = checks.market and previous_check.code = checks.code
       and previous_check.symbol = checks.symbol and previous_check.deleted_at is null
     where checks.market = $1 and checks.code = $2 and checks.symbol = $3
       and checks.deleted_at is null and audit.actor_type = $4 and audit.actor_id = $5
       and (checks.checked_at, checks.id) > (previous_check.checked_at, previous_check.id)
       and nullif(btrim(checks.user_final_decision), '') is not null
       and checks.raw_payload->>'conditionalDecision' is null
       and checks.raw_payload->'researchReportDecision'->>'availability' is distinct from 'preserved'
       and checks.raw_payload->'formalDecision'->>'availability' is distinct from 'preserved'
     limit 1`, [symbol.split(".")[0], symbol.split(".")[1], symbol,
      actor.actorType, actor.actorId, prior.id]);
  if (newer.rows.length)
    throw new DecisionSnapshotMismatchError("a newer ordinary judgment exists; select the current previous judgment");
}

async function resolveConditionalDecisionFacts(
  client: PoolClient,
  normalized: ReturnType<typeof normalizeMarketCode>,
  request: CreatePreTradeDecisionCheckRequest,
  submission: NonNullable<CreatePreTradeDecisionCheckRequest["conditionalDecision"]>,
  actor: AuthenticatedResearchActor,
  liveMaxAgeSeconds: number,
  snapshotOptions?: DecisionCheckResolutionOptions
) {
  const context = await readDecisionContextEnvelope(
    client, normalized.market, normalized.code, liveMaxAgeSeconds, snapshotOptions?.now,
    snapshotOptions?.quantEvidence?.decision ?? null
  );
  assertCurrentContext(context, request);
  assertNonFixtureContext(context);
  assertAvailableResearchEvidence(context);
  const conditionalDecision = await resolveAnnualConditionalDecision(
    client, submission, actor, conditionalOptions(snapshotOptions, liveMaxAgeSeconds)
  );
  const source = submission.preview.data?.decisionBrief.data?.sourceIdentity;
  const expectedBinding = annualConditionalDecisionSnapshotBinding(submission.preview);
  if (!source || source.decisionContextId !== request.contextId || source.decisionContextHash !== request.contextHash
    || canonicalJson(expectedBinding) !== canonicalJson(request.decisionSnapshotBinding)) {
    throw new ConditionalDecisionMismatchError("conditional preview, decision context, and immutable snapshot bindings do not match");
  }
  const decisionSnapshot = await resolveDecisionSnapshot(
    client,
    context,
    request.decisionSnapshotBinding,
    decisionSnapshotOptions(snapshotOptions, liveMaxAgeSeconds)
  );
  const stock = await findExistingStock(client, normalized.market, normalized.code);
  if (!stock) throw new StockFactUnavailableError();
  return { context, conditionalDecision, decisionSnapshot, stock };
}

function assertNonFixtureContext(
  context: Awaited<ReturnType<typeof readDecisionContextEnvelope>>
): void {
  if (hasFixtureDecisionContextEvidence(context)) {
    throw new FixtureDecisionContextError();
  }
}

function assertAvailableResearchEvidence(
  context: Awaited<ReturnType<typeof readDecisionContextEnvelope>>
): void {
  if (context.research.status !== "available") {
    throw new DecisionSnapshotMismatchError(
      "human decision without a bound current report requires current available research evidence"
    );
  }
}

function assertCurrentContext(
  context: Awaited<ReturnType<typeof readDecisionContextEnvelope>>,
  request: CreatePreTradeDecisionCheckRequest
): void {
  if (context.schemaVersion !== request.decisionContextSchemaVersion
    || context.contextId !== request.contextId || context.contextHash !== request.contextHash) {
    throw new ContextMismatchError();
  }
}

function conditionalOptions(
  options: DecisionCheckResolutionOptions | undefined,
  quoteLiveMaxAgeSeconds: number
) {
  if (!options) throw new ConditionalDecisionMismatchError("conditional decision authoritative read options are unavailable");
  return {
    accountScopeId: options.accountScopeId,
    pinganCurrentMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds,
    quoteLiveMaxAgeSeconds,
    quantEvidence: options.quantEvidence ?? null,
    now: options.now ?? new Date()
  };
}

function decisionSnapshotOptions(
  options: DecisionCheckResolutionOptions | undefined,
  quoteLiveMaxAgeSeconds: number
): DecisionSnapshotResolutionOptions | undefined {
  if (!options) return undefined;
  return {
    accountScopeId: options.accountScopeId,
    pinganCurrentMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds,
    quoteLiveMaxAgeSeconds,
    now: options.now
  };
}

function isLockUnavailable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "55P03";
}

function assertDecisionWriteChronology(
  contextGeneratedAt: string,
  snapshotCapturedAt: string | undefined,
  checkedAt: string,
  auditCreatedAt: string
): void {
  const timeline = [contextGeneratedAt, snapshotCapturedAt, checkedAt, auditCreatedAt]
    .map((value) => typeof value === "string" ? Date.parse(value) : Number.NaN);
  if (timeline.some((value) => !Number.isFinite(value))
    || timeline.some((value, index) => index > 0 && value < timeline[index - 1]!)) {
    throw new DecisionSnapshotMismatchError(
      "decision must satisfy context.generatedAt <= snapshot.capturedAt <= checkedAt <= audit.createdAt"
    );
  }
}

function legacyVerdict(result: HumanCheckResult): "pass" | "block" | "needs_review" {
  return result === "ready_to_consider" ? "pass" : result === "blocked" ? "block" : "needs_review";
}
