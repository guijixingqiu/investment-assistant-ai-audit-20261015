import { canonicalJson, type PreTradeDecisionCheckData } from "../../../packages/contracts/src/decisionContextBrowser.js";
import {
  validateResearchReportDecisionBinding,
  type ResearchReportDecisionBinding
} from "../../../packages/contracts/src/researchReportDecision.js";
import type { DecisionReviewHistoryEnvelope, PostDecisionReviewData, RecordedDecisionCheckReviewState } from "../../../packages/contracts/src/decisionReview.js";
import {
  validateMarketDiscoveryEnvelope,
  validateMarketDiscoveryQualificationEnvelope,
  type MarketDiscoveryCandidate,
  type MarketDiscoveryEnvelope,
  type MarketDiscoveryQualificationEnvelope,
  type OfficialAnnouncementDiscoveryItem
} from "../../../packages/contracts/src/marketDiscovery.js";
import {
  validateTodayActionInboxEnvelope,
  validateTodayMaterialChangeDispositionRequest,
  validateTodayMaterialChangeDispositionWrite,
  type TodayActionInboxEnvelope,
  type TodayActionInboxItem,
  type TodayMaterialChangeDispositionState,
  type TodayMaterialChangeDispositionWrite
} from "../../../packages/contracts/src/todayActionInbox.js";
import { sameWebApiAuth, type WebApiAuth } from "./apiClient.js";

export type DailyTrackingReviewCheck = PreTradeDecisionCheckData | RecordedDecisionCheckReviewState;

export interface DailyTrackingReviewTarget {
  item: TodayActionInboxItem;
  requestedActorId: string;
  decisionCheckId: string;
  reportBinding: ResearchReportDecisionBinding;
}

export function acceptTodayActionInboxEnvelope(value: unknown, now = new Date()): TodayActionInboxEnvelope {
  const validation = validateTodayActionInboxEnvelope(value, now);
  if (!validation.ok) throw new Error(`Today action inbox response is malformed: ${validation.errors.join("; ")}`);
  const envelope = value as TodayActionInboxEnvelope;
  if (envelope.status !== "available" && envelope.status !== "empty") {
    throw new Error(envelope.message || "Today action inbox is unavailable.");
  }
  return envelope;
}

export function acceptMarketDiscoveryEnvelope(value: unknown, expectedSymbol = "HK.00175", now = new Date()): MarketDiscoveryEnvelope {
  const validation = validateMarketDiscoveryEnvelope(value, expectedSymbol, now);
  if (!validation.ok) throw new Error(`Market discovery response is malformed: ${validation.errors.join("; ")}`);
  const envelope = value as MarketDiscoveryEnvelope;
  if (envelope.candidates.status !== "available" || envelope.announcements.status !== "available") {
    throw new Error(`Discovery ${envelope.status} UNKNOWN: ${envelope.message} Partial or unavailable facts are blocked and cleared.`);
  }
  return envelope;
}

export class OfficialAnnouncementIdentityChangedError extends Error {}

export function exactOfficialAnnouncement(
  envelope: MarketDiscoveryEnvelope,
  expected: OfficialAnnouncementDiscoveryItem
): OfficialAnnouncementDiscoveryItem {
  const identity = canonicalJson(expected);
  const matches = envelope.announcements.items.filter((item) => canonicalJson(item) === identity);
  if (matches.length !== 1) throw new OfficialAnnouncementIdentityChangedError("Official announcement identity changed; no old link or metadata was continued.");
  return matches[0];
}

export async function acceptMarketDiscoveryQualification(
  value: unknown,
  discovery: MarketDiscoveryEnvelope,
  candidate: MarketDiscoveryCandidate
): Promise<MarketDiscoveryQualificationEnvelope> {
  const validation = validateMarketDiscoveryQualificationEnvelope(value);
  if (!validation.ok) throw new Error(`Market qualification response is malformed: ${validation.errors.join("; ")}`);
  const envelope = value as MarketDiscoveryQualificationEnvelope;
  const binding = envelope.binding;
  if (envelope.status !== "available" || !binding
    || envelope.symbol !== candidate.symbol
    || binding.discoveryFetchedAt !== discovery.candidates.fetchedAt
    || binding.candidateAsOf !== candidate.asOf) {
    throw new Error(`Qualification ${envelope.status} UNKNOWN: ${envelope.message} Binding drifted; no old or partial result is retained.`);
  }
  return envelope;
}

export function todayItemDisplayState(item: TodayActionInboxItem): "actionable" | "blocked" | "resolved" {
  if (item.kind === "source_failure" || item.state === "blocked") return "blocked";
  if (item.state === "resolved" || item.state === "expired") return "resolved";
  return "actionable";
}

export function formalDecisionReportBinding(
  envelope: TodayActionInboxEnvelope,
  item: TodayActionInboxItem
): ResearchReportDecisionBinding {
  const event = item.reviewEvent;
  if (item.kind !== "formal_decision_due" || item.state !== "new" || event?.type !== "FORMAL_DECISION_DUE") {
    throw new Error("Only a fresh FORMAL_DECISION_DUE item can adopt a confirmed report.");
  }
  const validation = validateResearchReportDecisionBinding(event.reportBinding);
  if (!validation.ok) throw new Error(`Confirmed report binding is malformed: ${validation.errors.join("; ")}`);
  const binding = validation.value;
  if (binding.membershipId !== item.membership.id || binding.membershipVersion !== item.membership.version
    || binding.symbol !== item.symbol || binding.reportDecisionId !== event.sourceEventId
    || binding.decidedAt !== event.effectiveAt || binding.reportDecisionActorId !== envelope.requestedActorId
    || event.stateActor.actorId !== envelope.requestedActorId || item.source.id !== event.id
    || item.source.version !== Number(event.sourceEventId)) {
    throw new Error("Confirmed report binding drifted from the exact Today actor, membership, report, pack, or source event.");
  }
  return binding;
}

export function exactFormalDecisionTrackingItem(
  envelope: TodayActionInboxEnvelope,
  binding: ResearchReportDecisionBinding,
  decisionCheckId: string
): TodayActionInboxItem {
  const matches = envelope.status === "available" ? envelope.items.filter((item) => {
    const event = item.reviewEvent;
    return item.kind === "daily_tracking" && item.state === "new"
      && item.membership.id === binding.membershipId
      && item.membership.version === binding.membershipVersion
      && item.membership.symbol === binding.symbol && item.symbol === binding.symbol
      && event?.type === "DAILY_TRACKING" && event.sourceEventId === decisionCheckId
      && event.bindings.decisionCheckId === decisionCheckId && event.bindings.reviewId === null
      && event.researchReport.availability === "preserved"
      && canonicalJson(event.researchReport.binding) === canonicalJson(binding)
      && event.stateActor.actorId === envelope.requestedActorId
      && item.source.id === event.id && item.source.version === Number(decisionCheckId);
  }) : [];
  if (matches.length !== 1) {
    throw new Error("Fresh Today did not expose exactly one decision-check and report-bound DAILY_TRACKING item.");
  }
  return matches[0];
}

export function dailyTrackingReviewTarget(
  envelope: TodayActionInboxEnvelope,
  item: TodayActionInboxItem
): DailyTrackingReviewTarget {
  const event = item.reviewEvent;
  if (item.kind !== "daily_tracking" || item.state !== "new" || event?.type !== "DAILY_TRACKING"
    || event.state !== "new" || event.bindings.reviewId !== null
    || event.bindings.decisionCheckId !== event.sourceEventId
    || event.researchReport.availability !== "preserved") {
    throw new Error("Only a fresh unresolved DAILY_TRACKING item can open explicit review submission.");
  }
  const validation = validateResearchReportDecisionBinding(event.researchReport.binding);
  if (!validation.ok) throw new Error(`Daily tracking report binding is malformed: ${validation.errors.join("; ")}`);
  const binding = validation.value;
  if (binding.membershipId !== item.membership.id || binding.membershipVersion !== item.membership.version
    || binding.symbol !== item.symbol || item.membership.symbol !== item.symbol
    || binding.reportDecisionActorId !== envelope.requestedActorId
    || event.stateActor.actorId !== envelope.requestedActorId
    || item.source.lane !== "review_due" || item.source.id !== event.id
    || item.source.version !== Number(event.sourceEventId)
    || item.source.effectiveAt !== event.effectiveAt) {
    throw new Error("Daily tracking actor, membership, decision check, report, pack, or source binding drifted.");
  }
  return { item, requestedActorId: envelope.requestedActorId, decisionCheckId: event.sourceEventId, reportBinding: binding };
}

export function dailyTrackingReviewCheckIdentity(check: DailyTrackingReviewCheck): string {
  return canonicalJson({
    id: check.id, market: check.market, code: check.code, symbol: check.symbol,
    decisionContextSchemaVersion: check.decisionContextSchemaVersion,
    decisionCheckSchemaVersion: check.decisionCheckSchemaVersion,
    contextId: check.contextId, contextHash: check.contextHash,
    actionIntent: check.actionIntent, humanCheckResult: check.humanCheckResult,
    userFinalDecision: check.userFinalDecision, checkedAt: check.checkedAt,
    decisionSnapshot: check.decisionSnapshot ?? null,
    conditionalDecision: check.conditionalDecision ?? null,
    researchReportDecision: check.researchReportDecision,
    formalDecision: check.formalDecision
  });
}

export function dailyTrackingTargetMatchesCheck(
  target: DailyTrackingReviewTarget,
  check: DailyTrackingReviewCheck
): boolean {
  const event = target.item.reviewEvent;
  return event?.type === "DAILY_TRACKING"
    && check.id === target.decisionCheckId && check.market === "HK"
    && check.code === target.item.symbol.split(".")[1] && check.symbol === target.item.symbol
    && check.actionIntent === event.humanDecision.actionIntent
    && check.humanCheckResult === event.humanDecision.humanCheckResult
    && check.userFinalDecision === event.humanDecision.userFinalDecision
    && check.researchReportDecision.availability === "preserved"
    && canonicalJson(check.researchReportDecision.binding) === canonicalJson(target.reportBinding)
    && check.formalDecision.availability === "preserved";
}

export function confirmsDailyTrackingReviewHistory(
  history: DecisionReviewHistoryEnvelope,
  response: PostDecisionReviewData,
  target: DailyTrackingReviewTarget,
  checkIdentity: string
): boolean {
  if (history.requestedSymbol !== target.item.symbol || history.metadata.freshness !== "fresh"
    || history.metadata.stale || history.metadata.missing || history.metadata.conflict
    || response.id.length === 0 || response.decisionCheckId !== target.decisionCheckId
    || response.symbol !== target.item.symbol || response.audit.actorType !== "user"
    || response.audit.actorId !== target.requestedActorId) return false;
  const checks = history.checks.filter((check) => check.id === target.decisionCheckId);
  if (checks.length !== 1 || dailyTrackingReviewCheckIdentity(checks[0]) !== checkIdentity
    || !dailyTrackingTargetMatchesCheck(target, checks[0])) return false;
  const reviews = checks[0].reviews.filter((review) => review.id === response.id);
  return reviews.length === 1 && canonicalJson(reviews[0]) === canonicalJson(response);
}

export function exactResolvedDailyTrackingItem(
  envelope: TodayActionInboxEnvelope,
  target: DailyTrackingReviewTarget,
  review: PostDecisionReviewData
): TodayActionInboxItem {
  const matches = envelope.status === "available" ? envelope.items.filter((item) => {
    const event = item.reviewEvent;
    return item.id === target.item.id && item.kind === "daily_tracking" && item.state === "resolved"
      && item.symbol === target.item.symbol
      && canonicalJson(item.membership) === canonicalJson(target.item.membership)
      && item.source.lane === target.item.source.lane && item.source.id === target.item.source.id
      && item.source.version === target.item.source.version && item.source.effectiveAt === target.item.source.effectiveAt
      && event?.type === "DAILY_TRACKING" && event.state === "resolved"
      && event.sourceEventId === target.decisionCheckId
      && event.bindings.decisionCheckId === target.decisionCheckId && event.bindings.reviewId === review.id
      && event.stateActor.actorId === target.requestedActorId
      && event.stateReason === `post_decision_review:${review.outcome}`
      && event.researchReport.availability === "preserved"
      && canonicalJson(event.researchReport.binding) === canonicalJson(target.reportBinding)
      && envelope.requestedActorId === target.requestedActorId
      && review.audit.actorType === "user" && review.audit.actorId === target.requestedActorId;
  }) : [];
  if (matches.length !== 1) {
    throw new Error("Fresh Today did not resolve the exact DAILY_TRACKING item with the submitted reviewId.");
  }
  return matches[0];
}

export function sameTodayActionItemIdentity(
  expected: TodayActionInboxItem,
  current: TodayActionInboxItem,
  expectedState = expected.state
): boolean {
  return current.id === expected.id && current.kind === expected.kind && current.state === expectedState
    && current.symbol === expected.symbol
    && current.membership.id === expected.membership.id
    && current.membership.version === expected.membership.version
    && current.membership.symbol === expected.membership.symbol
    && current.source.lane === expected.source.lane
    && current.source.id === expected.source.id
    && current.source.version === expected.source.version
    && current.source.sourceFingerprint === expected.source.sourceFingerprint
    && canonicalJson(current.researchTarget) === canonicalJson(expected.researchTarget)
    && canonicalJson(current.reviewEvent) === canonicalJson(expected.reviewEvent);
}

export async function freshTodayActionItem(
  expected: TodayActionInboxItem,
  auth: WebApiAuth,
  currentAuth: () => WebApiAuth | null,
  expectedState = expected.state
): Promise<{ envelope: TodayActionInboxEnvelope; item: TodayActionInboxItem }> {
  const envelope = acceptTodayActionInboxEnvelope(await requestJson("/api/mobile/research/today/inbox", auth, { cache: "no-store" }));
  if (!sameWebApiAuth(auth, currentAuth())) throw new Error("Read authorization changed during the fresh Today read.");
  const matches = envelope.items.filter((item) => item.id === expected.id);
  if (matches.length !== 1 || !sameTodayActionItemIdentity(expected, matches[0], expectedState)) {
    throw new Error("Today item identity changed; the stale action was discarded.");
  }
  return { envelope, item: matches[0] };
}

export async function writeTodayMaterialChangeDisposition(options: {
  envelope: TodayActionInboxEnvelope;
  item: TodayActionInboxItem;
  state: TodayMaterialChangeDispositionState;
  snoozedUntil?: string | null;
  idempotencyKey: string;
  readAuth: WebApiAuth;
  writeAuth: WebApiAuth;
  currentReadAuth: () => WebApiAuth | null;
  currentWriteAuth: () => WebApiAuth | null;
}): Promise<{ envelope: TodayActionInboxEnvelope; item: TodayActionInboxItem; write: TodayMaterialChangeDispositionWrite }> {
  const { envelope, item, state, idempotencyKey, readAuth, writeAuth, currentReadAuth, currentWriteAuth } = options;
  const snoozedUntil = state === "later" ? options.snoozedUntil ?? new Date(Date.now() + 86_400_000).toISOString() : null;
  const transitionAllowed = ["new", "later"].includes(item.state) && ["new", "later"].includes(state)
    || item.kind === "material_change" && item.state === "resolved" && state === "new"
    || item.kind === "material_change" && ["new", "later"].includes(item.state) && state === "resolved";
  if (!transitionAllowed || item.source.sourceFingerprint === null) {
    throw new Error("Only a current exact Today action can be explicitly deferred, restored, or handled.");
  }
  const request = {
    itemId: item.id,
    membershipVersion: item.membership.version,
    sourceFingerprint: item.source.sourceFingerprint,
    state,
    snoozedUntil,
    idempotencyKey
  };
  const requestValidation = validateTodayMaterialChangeDispositionRequest(request);
  if (!requestValidation.ok) throw new Error(`Today disposition request is malformed: ${requestValidation.errors.join("; ")}`);
  const value = await requestJson("/api/mobile/research/today/inbox/material-dispositions", writeAuth, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!sameWebApiAuth(writeAuth, currentWriteAuth())) throw new Error("Research-write authorization changed during Today disposition.");
  const validation = validateTodayMaterialChangeDispositionWrite(value);
  if (!validation.ok) throw new Error(`Today disposition response is malformed: ${validation.errors.join("; ")}`);
  const write = value as TodayMaterialChangeDispositionWrite;
  if (write.source.actorType !== "user" || write.source.actorId !== envelope.requestedActorId
    || write.data.itemId !== item.id || write.data.membershipId !== item.membership.id
    || write.data.membershipVersion !== item.membership.version || write.data.symbol !== item.symbol
    || write.data.sourceId !== item.source.id || write.data.sourceVersion !== item.source.version
    || write.data.sourceFingerprint !== item.source.sourceFingerprint || write.data.state !== state
    || write.data.snoozedUntil !== snoozedUntil) {
    throw new Error("Today disposition response drifted from the exact action.");
  }
  const readback = await freshTodayActionItem(item, readAuth, currentReadAuth, state);
  if (!sameWebApiAuth(writeAuth, currentWriteAuth())) throw new Error("Research-write authorization changed before Today disposition readback completed.");
  return { ...readback, write };
}

export async function requestJson(path: string, auth: WebApiAuth | null, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (auth) headers.set(auth.headerName, auth.token);
  const response = await fetch(path, { ...init, headers });
  const value = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof value?.message === "string" ? value.message : `HTTP ${response.status}`);
  return value;
}

export function cockpitFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}
