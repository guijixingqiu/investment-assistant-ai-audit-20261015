import type { Pool } from "pg";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import {
  type EvidenceBoundDeepResearchReportPayload,
  type DeepResearchDecisionData
} from "../../../../packages/contracts/src/deepResearch.js";
import type { SynthesizedDeepResearchReportPayload } from "../../../../packages/contracts/src/deepResearchSynthesisReport.js";
import {
  RESEARCH_REPORT_DECISION_BINDING_VERSION,
  type ResearchReportDecisionBinding
} from "../../../../packages/contracts/src/researchReportDecision.js";
import {
  todayFormalDecisionDueIdentity,
  type TodayFormalDecisionDueEvent
} from "../../../../packages/contracts/src/todayReviewDue.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import {
  deepResearchGateFailures,
  deepResearchReportHasFormalRecommendation,
  deepResearchReportIntegrityFailures,
  deepResearchReportFingerprint,
  evidencePackFingerprint,
  isFormalizableDeepResearchReportContractVersion
} from "./deepResearchGate.js";
import {
  readDeepResearchDecision,
  readDeepResearchReport,
  readEvidencePack,
  readEvidencePackInvalidatedBy,
  readLatestDeepResearchReport,
  readLatestEvidencePack
} from "./deepResearchPersistence.js";
import { readExistingResearchProfileBinding } from "./writePersistence.js";
import { assertTodayDecision, type DecisionProjectionRow } from "./todayDecisionProjection.js";

type FormalDecisionDueDependencies = {
  readProfile: typeof readExistingResearchProfileBinding;
  readLatestPack: typeof readLatestEvidencePack;
  readLatestReport: typeof readLatestDeepResearchReport;
  readPack: typeof readEvidencePack;
  readReport: typeof readDeepResearchReport;
  readInvalidatedBy: typeof readEvidencePackInvalidatedBy;
  readDecision: typeof readDeepResearchDecision;
};

const formalDecisionDueDependencies: FormalDecisionDueDependencies = {
  readProfile: readExistingResearchProfileBinding,
  readLatestPack: readLatestEvidencePack,
  readLatestReport: readLatestDeepResearchReport,
  readPack: readEvidencePack,
  readReport: readDeepResearchReport,
  readInvalidatedBy: readEvidencePackInvalidatedBy,
  readDecision: readDeepResearchDecision
};

interface MembershipRow {
  id: string;
  actor_type: "user" | "system";
  actor_id: string;
  market: string;
  code: string;
  symbol: string;
  state: "tracked" | "paused" | "archived";
  version: number | string;
}

interface DecisionAuditRow {
  audit_count: number | string;
  actor_audit_count: number | string;
  stock_id: string;
  market: string;
  code: string;
  symbol: string;
  event_type: string;
  target_table: string;
  target_id: string;
  candidate_membership_id: string | null;
  candidate_membership_version: number | string | null;
  after_payload: unknown;
  created_at: Date | string;
}

// eslint-disable-next-line complexity -- one read preserves the exact report-decision binding.
export async function readTodayFormalDecisionDue(
  pool: Pool,
  market: string,
  code: string,
  actor: AuthenticatedResearchActor,
  now: Date,
  dependencies = formalDecisionDueDependencies
): Promise<TodayFormalDecisionDueEvent | null> {
  if (actor.actorType !== "user" || !actor.actorId) return null;
  const symbol = `${market}.${code}`;
  const memberships = await pool.query<MembershipRow>(
    `select id, actor_type, actor_id, market, code, symbol, state, version
       from candidate_memberships
      where actor_type = $1 and actor_id = $2 and market = $3 and code = $4 and symbol = $5
      order by id desc
      limit 2`,
    [actor.actorType, actor.actorId, market, code, symbol]
  );
  if (memberships.rows.length === 0) return null;
  if (memberships.rows.length !== 1) throw new Error("current actor-scoped membership is ambiguous");
  const membership = memberships.rows[0]!;
  assertCurrentMembership(membership, market, code, symbol, actor);
  const membershipVersion = Number(membership.version);
  const profile = await dependencies.readProfile(pool, market, code, symbol);
  if (!profile) return null;
  const latestPack = await dependencies.readLatestPack(pool, profile.profileId, String(membership.id), membershipVersion, now);
  if (!latestPack) return null;
  const latestReport = await dependencies.readLatestReport(pool, profile.profileId, String(membership.id), membershipVersion);
  if (!latestReport) return null;
  const pack = await dependencies.readPack(pool, latestPack.id, profile.profileId, now);
  const report = await dependencies.readReport(pool, latestReport.id, profile.profileId);
  if (!pack || !report) throw new Error("latest report or evidence pack disappeared during projection");
  const invalidatedBy = await dependencies.readInvalidatedBy(
    pool, profile.profileId, pack, actor,
    { id: String(membership.id), version: membershipVersion, state: membership.state,
      market, code, symbol }, now
  );
  if (pack.id !== latestPack.id || pack.version !== latestPack.version
    || pack.membershipId !== String(membership.id)
    || pack.membershipVersion !== membershipVersion || pack.symbol !== symbol
    || pack.packFingerprint !== latestPack.packFingerprint) {
    throw new Error("latest evidence pack identity is corrupted");
  }
  if (invalidatedBy.length > 0) return null;
  if (evidencePackFingerprint(pack.membershipId, pack.membershipVersion, pack.items,
    pack.frozenResearchContext ?? undefined, pack.researchMode) !== pack.packFingerprint) {
    throw new Error("latest evidence pack fingerprint is corrupted");
  }
  if (report.id !== latestReport.id || report.version !== latestReport.version
    || report.evidencePackId !== pack.id
    || report.reportFingerprint !== latestReport.reportFingerprint) {
    throw new Error("latest report identity is corrupted");
  }
  if (!isFormalizableDeepResearchReportContractVersion(report.contractVersion)
    || report.status !== "complete_pending_confirmation" || report.gateFailures.length !== 0
    || report.currentness.status !== "current") return null;
  const payload = report.payload as EvidenceBoundDeepResearchReportPayload | SynthesizedDeepResearchReportPayload;
  if (payload.reportContractVersion !== report.contractVersion
    || deepResearchReportFingerprint(report.evidencePackId, payload) !== report.reportFingerprint) {
    throw new Error("latest report fingerprint is corrupted");
  }
  if (deepResearchReportIntegrityFailures(payload, pack).length > 0) {
    throw new Error("latest report integrity is corrupted");
  }
  if (deepResearchGateFailures(payload, pack, now).length > 0) return null;
  if (!deepResearchReportHasFormalRecommendation(payload)) return null;

  const decision = await dependencies.readDecision(pool, report.id);
  if (!decision || decision.decision !== "confirmed" || decision.actorType !== "user"
    || decision.actorId !== actor.actorId || decision.reportId !== report.id) return null;
  const audit = await readDecisionAudit(pool, decision, membership, profile.stock.id, actor, now);
  const binding: ResearchReportDecisionBinding = {
    bindingVersion: RESEARCH_REPORT_DECISION_BINDING_VERSION,
    membershipId: String(membership.id), membershipVersion, symbol,
    evidencePackId: pack.id, evidencePackFingerprint: pack.packFingerprint,
    reportId: report.id, reportVersion: report.version,
    contractVersion: report.contractVersion, reportFingerprint: report.reportFingerprint,
    reportDecisionId: decision.id, reportDecision: "confirmed",
    reportDecisionActorType: "user", reportDecisionActorId: decision.actorId,
    decidedAt: decision.decidedAt
  };
  if (await hasExactAuditedAdoption(pool, market, code, symbol, actor, binding, now)) return null;
  if (instant(pack.frozenAt) > instant(report.createdAt)
    || instant(report.createdAt) > instant(decision.decidedAt)
    || instant(decision.decidedAt) > instant(audit.created_at)) {
    throw new Error("confirmed report chronology is invalid");
  }
  return {
    id: todayFormalDecisionDueIdentity(symbol, decision.id, decision.decidedAt),
    type: "FORMAL_DECISION_DUE", subject: symbol, sourceEventId: decision.id,
    effectiveAt: decision.decidedAt,
    priority: { severity: "attention", dueAt: decision.decidedAt },
    state: "new", stateChangedAt: decision.decidedAt,
    stateActor: { actorType: "user", actorId: decision.actorId },
    stateReason: "confirmed_report_not_adopted", reportBinding: binding
  };
}

async function readDecisionAudit(
  pool: Pool,
  decision: DeepResearchDecisionData,
  membership: MembershipRow,
  stockId: string,
  actor: AuthenticatedResearchActor,
  now: Date
): Promise<DecisionAuditRow> {
  const result = await pool.query<DecisionAuditRow>(
    `select count(*)::int as audit_count,
            count(*) filter (where actor_type = $2 and actor_id is not distinct from $3)::int as actor_audit_count,
            min(stock_id)::text as stock_id, min(market) as market, min(code) as code,
            min(symbol) as symbol, min(event_type::text) as event_type,
            min(target_table) as target_table, min(target_id) as target_id,
            min(candidate_membership_id)::text as candidate_membership_id,
            min(candidate_membership_version) as candidate_membership_version,
            (jsonb_agg(after_payload order by id)->0) as after_payload,
            min(created_at) as created_at
       from research_write_audit_events
      where event_type = 'deep_research_report_decided'
        and target_table = 'deep_research_report_decisions' and target_id = $1`,
    [decision.id, actor.actorType, actor.actorId]
  );
  const row = result.rows[0];
  if (!row || Number(row.audit_count) !== 1 || Number(row.actor_audit_count) !== 1
    || String(row.stock_id) !== String(stockId) || row.market !== membership.market
    || row.code !== membership.code || row.symbol !== membership.symbol
    || row.event_type !== "deep_research_report_decided"
    || row.target_table !== "deep_research_report_decisions" || String(row.target_id) !== decision.id
    || String(row.candidate_membership_id) !== String(membership.id)
    || Number(row.candidate_membership_version) !== Number(membership.version)
    || canonicalJson(row.after_payload) !== canonicalJson(decision)
    || instant(row.created_at) < instant(decision.decidedAt)
    || instant(row.created_at) > now.getTime()) {
    throw new Error("confirmed report decision audit is missing, duplicated, or mismatched");
  }
  return row;
}

async function hasExactAuditedAdoption(
  pool: Pool,
  market: string,
  code: string,
  symbol: string,
  actor: AuthenticatedResearchActor,
  binding: ResearchReportDecisionBinding,
  now: Date
): Promise<boolean> {
  const result = await pool.query<DecisionProjectionRow>(
    `select checks.id, checks.stock_id, checks.market, checks.code, checks.symbol, checks.checked_at,
            checks.action_intent, checks.user_final_decision, checks.raw_payload,
            checks.decision_context_snapshot, checks.decision_snapshot,
            audit.audit_count, audit.actor_audit_count, audit.audit_actor_type,
            audit.audit_actor_id, audit.audit_stock_id, audit.audit_market, audit.audit_code,
            audit.audit_symbol, audit.audit_event_type, audit.audit_target_table,
            audit.audit_target_id, audit.audit_after_payload, audit.audit_created_at
       from pre_trade_decision_checks checks
       join lateral (
         select count(*)::int as audit_count,
                count(*) filter (where candidate.actor_type = $3 and candidate.actor_id is not distinct from $4)::int as actor_audit_count,
                min(candidate.actor_type) as audit_actor_type, min(candidate.actor_id) as audit_actor_id,
                min(candidate.stock_id)::text as audit_stock_id, min(candidate.market) as audit_market,
                min(candidate.code) as audit_code, min(candidate.symbol) as audit_symbol,
                min(candidate.event_type::text) as audit_event_type, min(candidate.target_table) as audit_target_table,
                min(candidate.target_id) as audit_target_id,
                (jsonb_agg(candidate.after_payload order by candidate.id)->0) as audit_after_payload,
                min(candidate.created_at) as audit_created_at
           from research_write_audit_events candidate
          where candidate.event_type = 'decision_check_created'
            and candidate.target_table = 'pre_trade_decision_checks'
            and candidate.target_id = checks.id::text
       ) audit on true
      where checks.market = $1 and checks.code = $2 and checks.symbol = $5
        and checks.deleted_at is null
        and checks.raw_payload->'researchReportDecision'->'binding'->>'reportDecisionId' = $6
      order by checks.checked_at desc, checks.id desc`,
    [market, code, actor.actorType, actor.actorId, symbol, binding.reportDecisionId]
  );
  if (result.rows.length === 0) return false;
  for (const row of result.rows) {
    const evidence = assertTodayDecision(row, market, code, symbol, actor, now);
    if (evidence.reportDecision.availability !== "preserved"
      || canonicalJson(evidence.reportDecision.binding) !== canonicalJson(binding)) {
      throw new Error("matching report adoption is malformed or does not exactly bind current facts");
    }
  }
  return true;
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function assertCurrentMembership(
  membership: MembershipRow,
  market: string,
  code: string,
  symbol: string,
  actor: AuthenticatedResearchActor
): void {
  if (membership.actor_type !== actor.actorType || membership.actor_id !== actor.actorId
    || membership.market !== market || membership.code !== code || membership.symbol !== symbol
    || membership.state === "archived" || !positiveInteger(membership.version)) {
    throw new Error("current actor-scoped membership is malformed");
  }
}

function instant(value: Date | string): number {
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(result)) throw new Error("invalid chronology instant");
  return result;
}
