import type { Pool, PoolClient } from "pg";
import type { CreatePostDecisionReviewRequest, PostDecisionReviewData } from "../../../../packages/contracts/src/decisionReview.js";
import type { ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import { normalizeMarketCode } from "../market/freshness.js";
import {
  AnnualReviewLearningMismatchError,
  DailyTrackingReviewMismatchError,
  DecisionCheckNotFoundError,
  IdempotencyConflictError,
  PostDecisionReviewChronologyError,
  PostDecisionPortfolioReviewMismatchError,
  SymbolMismatchError,
  type AuthenticatedResearchActor
} from "./domain.js";
import {
  annualReviewLearningMatchesRequest,
  annualReviewLearningNotCapturedState,
  captureAnnualReviewLearningState,
  captureManualReviewLearningState,
  validateAnnualReviewLearningState
} from "../../../../packages/contracts/src/annualReviewLearning.js";
import { findCandidateMembershipByIdForUpdateNowait } from "./candidateMembershipPersistence.js";
import { refreshAnnualConditionalDecisionMonitorFromAuthoritativeFacts } from "./annualConditionalDecisionService.js";
import { rowToDecisionCheckFromRawPayload, rowToPostDecisionReview, type PostDecisionReviewRow } from "./decisionReviewMappers.js";
import {
  findDecisionCheckForReview,
  findReviewAuditByIdempotencyKey,
  reviewRequestSemantics,
  sameReviewPayload
} from "./decisionReviewPersistence.js";
import {
  resolvePostDecisionPortfolioReview,
  type PostDecisionPortfolioReviewResolutionOptions
} from "./postDecisionPortfolioReviewBinding.js";
import { actorRequest, insertWriteAudit, isUniqueViolation, writeEnvelope } from "./writePersistence.js";
import { validatePostDecisionPortfolioReviewState } from "../../../../packages/contracts/src/postDecisionPortfolioReview.js";
import type { QuantEvidenceRuntimeOptions } from "./quantEvidenceSource.js";
import { readBoundTodayResearchReport } from "./todayReviewDueReportSnapshot.js";

type PostDecisionReviewResolutionOptions = PostDecisionPortfolioReviewResolutionOptions & {
  quantEvidence?: QuantEvidenceRuntimeOptions | null;
  readDailyTrackingReport?: typeof readBoundTodayResearchReport;
};

export async function createPostDecisionReview(
  pool: Pool,
  market: string,
  code: string,
  decisionCheckId: string,
  request: CreatePostDecisionReviewRequest,
  actor: AuthenticatedResearchActor,
  portfolioReviewOptions?: PostDecisionReviewResolutionOptions
): Promise<ResearchWriteEnvelope<PostDecisionReviewData>> {
  const normalized = normalizeMarketCode(market, code);
  const requestSemantics = reviewRequestSemantics(request);
  const existing = await findReviewAuditByIdempotencyKey(pool, request.idempotencyKey);
  if (existing) {
    if (!sameReviewPayload(existing, request, requestSemantics, normalized.symbol, decisionCheckId, actor)) {
      throw new IdempotencyConflictError("idempotency key already used with a different post-decision-review payload");
    }
    await assertReviewReplayIntegrity(pool, existing.envelope.data, normalized.market, normalized.code, decisionCheckId, actor, request);
    return existing.envelope;
  }

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    const check = await findDecisionCheckForReview(client, normalized.market, normalized.code, decisionCheckId, actor);
    if (!check) throw new DecisionCheckNotFoundError();
    if (check.market !== normalized.market || check.code !== normalized.code || check.symbol !== normalized.symbol) {
      throw new SymbolMismatchError();
    }
    const decision = rowToDecisionCheckFromRawPayload(check);
    let portfolioReview: Awaited<ReturnType<typeof resolvePostDecisionPortfolioReview>>;
    try {
      portfolioReview = await resolvePostDecisionPortfolioReview(
        client,
        String(check.id),
        check.symbol,
        decision.decisionSnapshot!,
        request.portfolioReviewBinding,
        portfolioReviewOptions
      );
    } catch (error) {
      const replay = await findReviewAuditByIdempotencyKey(client, request.idempotencyKey);
      if (replay && sameReviewPayload(replay, request, requestSemantics, normalized.symbol, decisionCheckId, actor)) {
        await assertReviewReplayIntegrity(client, replay.envelope.data, normalized.market, normalized.code, decisionCheckId, actor, request);
        return replay.envelope;
      }
      throw error;
    }

    await client.query("begin");
    transactionStarted = true;
    const transactionCheck = await findDecisionCheckForReview(client, normalized.market, normalized.code, decisionCheckId, actor);
    if (!transactionCheck) throw new DecisionCheckNotFoundError();
    const transactionDecision = rowToDecisionCheckFromRawPayload(transactionCheck);
    if (transactionCheck.stock_id !== check.stock_id
      || transactionCheck.market !== check.market
      || transactionCheck.code !== check.code
      || transactionCheck.symbol !== check.symbol
      || canonicalJson(transactionDecision.decisionSnapshot) !== canonicalJson(decision.decisionSnapshot)) {
      throw new PostDecisionPortfolioReviewMismatchError("decision snapshot changed before portfolio review persistence");
    }
    if (request.dailyTrackingBinding
      && canonicalJson(transactionDecision.researchReportDecision)
      !== canonicalJson(decision.researchReportDecision)) {
      throw new DailyTrackingReviewMismatchError("research-report decision binding changed before daily-tracking review persistence");
    }
    const replay = await findReviewAuditByIdempotencyKey(client, request.idempotencyKey);
    if (replay) {
      if (!sameReviewPayload(replay, request, requestSemantics, normalized.symbol, decisionCheckId, actor)) {
        throw new IdempotencyConflictError("idempotency key already used with a different post-decision-review payload");
      }
      await assertReviewReplayIntegrity(client, replay.envelope.data, normalized.market, normalized.code, decisionCheckId, actor, request);
      await client.query("commit");
      transactionStarted = false;
      return replay.envelope;
    }
    const reviewedAtForInsert = resolveReviewTimestampForInsert(
      request,
      requestSemantics,
      transactionDecision.checkedAt,
      portfolioReviewOptions?.now ?? new Date()
    );
    await assertDailyTrackingReviewCurrent(
      client,
      transactionCheck,
      transactionDecision,
      request,
      actor,
      portfolioReviewOptions
    );
    const reviewLearning = await resolveAnnualReviewLearning(
      client,
      String(transactionCheck.id),
      transactionDecision,
      request,
      actor,
      portfolioReviewOptions
    );
    const inserted = await client.query<PostDecisionReviewRow>(
      `insert into post_decision_reviews
        (decision_check_id, actor_type, actor_id, outcome, outcome_evidence,
         review_note, reviewed_at, idempotency_key, correlation_id, raw_payload, portfolio_review_snapshot)
       values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()), $8, $9, $10::jsonb, $11::jsonb)
       returning id, decision_check_id, actor_type, actor_id, outcome, outcome_evidence,
                 review_note, reviewed_at, idempotency_key, correlation_id, created_at, raw_payload, portfolio_review_snapshot`,
      [
        String(transactionCheck.id),
        actor.actorType,
        actor.actorId,
        request.outcome,
        request.outcomeEvidence ?? null,
        request.reviewNote ?? null,
        reviewedAtForInsert,
        request.idempotencyKey,
        null,
        JSON.stringify({
          source: "post-decision-review-api",
          advisoryOnly: true,
          noOrder: true,
          noTrade: true,
          noCashMutation: true,
          noFeeWrite: true,
          noPositionMutation: true,
          noBrokerCall: true,
          dailyTrackingBinding: request.dailyTrackingBinding ?? null,
          portfolioReviewCaptured: portfolioReview.availability === "preserved",
          reviewLearning
        }),
        JSON.stringify(portfolioReview)
      ]
    );
    const review = rowToPostDecisionReview(
      { ...inserted.rows[0], market: transactionCheck.market, code: transactionCheck.code, symbol: transactionCheck.symbol },
      transactionDecision
    );
    if (request.portfolioReviewBinding && review.portfolioReview.availability !== "preserved") {
      throw new Error("persisted post-decision portfolio review failed integrity validation before success");
    }
    if (request.reviewLearning && !annualReviewLearningMatchesRequest(review.reviewLearning, request.reviewLearning)) {
      throw new Error("persisted annual review learning failed integrity validation before success");
    }
    const auditAsOf = await insertWriteAudit(client, {
      eventType: "post_decision_review_created",
      request: { idempotencyKey: request.idempotencyKey, actorType: actor.actorType, actorId: actor.actorId, correlationId: null },
      stock: { id: String(transactionCheck.stock_id), market: transactionCheck.market, code: transactionCheck.code, symbol: transactionCheck.symbol },
      targetTable: "post_decision_reviews",
      targetId: String(inserted.rows[0].id),
      beforePayload: { decisionCheckId: String(check.id), ...requestSemantics },
      afterPayload: review
    });
    await client.query("commit");
    transactionStarted = false;
    return writeEnvelope(actorRequest(actor, request.idempotencyKey), review, `Post-decision review for ${normalized.symbol} recorded without creating an order, trade, cash movement, fee, position mutation, or broker call.`, auditAsOf);
  } catch (error) {
    if (transactionStarted) {
      await client.query("rollback");
    }
    if (isUniqueViolation(error)) {
      const replay = await findReviewAuditByIdempotencyKey(pool, request.idempotencyKey);
      if (replay && sameReviewPayload(replay, request, requestSemantics, normalized.symbol, decisionCheckId, actor)) {
        await assertReviewReplayIntegrity(pool, replay.envelope.data, normalized.market, normalized.code, decisionCheckId, actor, request);
        return replay.envelope;
      }
      throw new IdempotencyConflictError("idempotency key already used with a different post-decision-review payload");
    }
    throw error;
  } finally {
    client.release();
  }
}

function resolveReviewTimestampForInsert(
  request: CreatePostDecisionReviewRequest,
  semantics: ReturnType<typeof reviewRequestSemantics>,
  checkedAt: string,
  now: Date
): string | null {
  const checked = Date.parse(checkedAt);
  if (!Number.isFinite(checked) || checked > now.getTime()) throw new PostDecisionReviewChronologyError();
  if (semantics.reviewedAt.kind !== "timestamp") return null;
  let reviewed = Date.parse(semantics.reviewedAt.value);
  const entered = request.reviewedAt;
  if (typeof entered === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entered)) {
    // A calendar-only entry names a Hong Kong review day, not midnight UTC.
    // On the check's own day, use its actual instant rather than rejecting a
    // legitimate same-day review for being earlier than the check's clock time.
    const dayStart = Date.parse(`${entered}T00:00:00+08:00`);
    const calendarDay = (instant: number) => new Date(instant + 8 * 60 * 60_000).toISOString().slice(0, 10);
    if (!Number.isFinite(dayStart) || calendarDay(dayStart) !== entered) throw new PostDecisionReviewChronologyError();
    reviewed = entered === calendarDay(checked) ? checked : dayStart;
  }
  if (!Number.isFinite(reviewed) || reviewed < checked || reviewed > now.getTime()) {
    throw new PostDecisionReviewChronologyError();
  }
  return new Date(reviewed).toISOString();
}

async function assertReviewReplayIntegrity(
  client: Parameters<typeof findDecisionCheckForReview>[0],
  review: PostDecisionReviewData,
  market: string,
  code: string,
  decisionCheckId: string,
  actor: AuthenticatedResearchActor,
  request: CreatePostDecisionReviewRequest
): Promise<void> {
  if (!request.portfolioReviewBinding && !request.reviewLearning && !request.dailyTrackingBinding) return;
  const check = await findDecisionCheckForReview(client, market, code, decisionCheckId, actor);
  if (!check) throw new DecisionCheckNotFoundError();
  const decision = rowToDecisionCheckFromRawPayload(check);
  assertDailyTrackingReviewBinding(decision, request);
  if (request.portfolioReviewBinding) {
    const validation = validatePostDecisionPortfolioReviewState(
      review.portfolioReview,
      decision.decisionSnapshot,
      decisionCheckId,
      check.symbol
    );
    if (!validation.ok || validation.value.availability !== "preserved") {
      throw new IdempotencyConflictError("idempotent post-decision portfolio review audit failed integrity validation");
    }
  }
  if (request.reviewLearning && !annualReviewLearningMatchesRequest(review.reviewLearning, request.reviewLearning)) {
    throw new IdempotencyConflictError("idempotent annual review learning audit failed integrity validation");
  }
  if (request.reviewLearning) {
    const learningValidation = validateAnnualReviewLearningState(
      review.reviewLearning,
      decisionCheckId,
      decision.decisionSnapshot,
      decision.conditionalDecision
    );
    if (!learningValidation.ok) {
      throw new IdempotencyConflictError("idempotent annual review learning snapshot failed decision binding validation");
    }
  }
}

async function assertDailyTrackingReviewCurrent(
  client: Parameters<typeof findDecisionCheckForReview>[0],
  check: NonNullable<Awaited<ReturnType<typeof findDecisionCheckForReview>>>,
  decision: ReturnType<typeof rowToDecisionCheckFromRawPayload>,
  request: CreatePostDecisionReviewRequest,
  actor: AuthenticatedResearchActor,
  options?: PostDecisionReviewResolutionOptions
): Promise<void> {
  const preserved = assertDailyTrackingReviewBinding(decision, request);
  if (!preserved) return;
  try {
    await (options?.readDailyTrackingReport ?? readBoundTodayResearchReport)(
      client,
      preserved,
      { market: check.market, code: check.code, symbol: check.symbol, checkedAt: check.checked_at },
      actor,
      options?.now ?? new Date()
    );
  } catch (error) {
    if (error instanceof DailyTrackingReviewMismatchError) throw error;
    throw new DailyTrackingReviewMismatchError();
  }
}

function assertDailyTrackingReviewBinding(
  decision: ReturnType<typeof rowToDecisionCheckFromRawPayload>,
  request: CreatePostDecisionReviewRequest
) {
  if (!request.dailyTrackingBinding) return null;
  const preserved = decision.researchReportDecision?.availability === "preserved"
    ? decision.researchReportDecision.binding
    : null;
  if (!preserved
    || canonicalJson(request.dailyTrackingBinding) !== canonicalJson(preserved)) {
      throw new DailyTrackingReviewMismatchError("preserved report decisions require the exact daily-tracking binding");
  }
  return preserved;
}

async function resolveAnnualReviewLearning(
  client: PoolClient,
  decisionCheckId: string,
  decision: ReturnType<typeof rowToDecisionCheckFromRawPayload>,
  request: CreatePostDecisionReviewRequest,
  actor: AuthenticatedResearchActor,
  options?: PostDecisionReviewResolutionOptions
) {
  if (!request.reviewLearning) {
    if (decision.conditionalDecision?.availability === "preserved") {
      throw new AnnualReviewLearningMismatchError("preserved conditional decision reviews require human review learning");
    }
    return annualReviewLearningNotCapturedState();
  }
  const learning = request.reviewLearning;
  if (learning.kind === "ordinary_manual") {
    if (actor.actorType !== "user" || decision.conditionalDecision?.availability === "preserved"
      || decision.researchReportDecision?.availability === "preserved"
      || learning.decisionCheckId !== decisionCheckId)
      throw new AnnualReviewLearningMismatchError("ordinary manual learning requires the same user check without a conditional or report decision");
    let membership: Awaited<ReturnType<typeof findCandidateMembershipByIdForUpdateNowait>>;
    try {
      membership = await findCandidateMembershipByIdForUpdateNowait(client, actor, learning.membershipId);
    } catch (error) {
      if ((error as { code?: string })?.code === "55P03")
        throw new AnnualReviewLearningMismatchError("candidate membership is busy; retry the same review request");
      throw error;
    }
    if (!membership || Number(membership.version) !== learning.membershipVersion
      || !["tracked", "paused"].includes(membership.state) || membership.symbol !== decision.symbol
      || membership.actor_id !== actor.actorId
      || !Number.isFinite(Date.parse(String(membership.created_at)))
      || Date.parse(String(membership.created_at)) > Date.parse(decision.checkedAt))
      throw new AnnualReviewLearningMismatchError("ordinary manual learning membership, version, actor or symbol changed before review save");
    return captureManualReviewLearningState(learning);
  }
  if (!options) throw new AnnualReviewLearningMismatchError("authoritative review-learning read options are unavailable");
  const decisionSnapshot = decision.decisionSnapshot!;
  const decisionSnapshotId = decisionSnapshot.availability === "preserved"
    ? decisionSnapshot.snapshot?.snapshotId
    : null;
  const conditionalPreviewId = decision.conditionalDecision?.availability === "preserved"
    ? decision.conditionalDecision.preview?.previewId
    : null;
  if (learning.decisionCheckId !== decisionCheckId || learning.decisionSnapshotId !== decisionSnapshotId
    || learning.conditionalPreviewId !== conditionalPreviewId) {
    throw new AnnualReviewLearningMismatchError();
  }
  const refreshed = await refreshAnnualConditionalDecisionMonitorFromAuthoritativeFacts(
    client,
    decision.conditionalDecision,
    actor,
    { ...options, now: options.now ?? new Date() }
  );
  if (!refreshed || refreshed.availability !== "preserved" || !refreshed.monitor) {
    throw new AnnualReviewLearningMismatchError("preserved conditional decision facts are unavailable for review learning");
  }
  try {
    return captureAnnualReviewLearningState(
      learning,
      refreshed.monitor,
      decisionSnapshot,
      refreshed
    );
  } catch {
    throw new AnnualReviewLearningMismatchError();
  }
}
