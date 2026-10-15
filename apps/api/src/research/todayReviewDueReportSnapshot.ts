import type { Pool, PoolClient } from "pg";
import {
  EVIDENCE_BOUND_REPORT_CONTRACT_VERSION,
  LEGACY_REPORT_CONTRACT_VERSION,
  validateCreateDeepResearchReportRequest,
  validateDeepResearchDecisionData,
  type DeepResearchReportData,
  type DeepResearchDecisionData,
  type EvidenceBoundDeepResearchReportPayload,
  type FrozenResearchEvidenceContext,
  type ResearchEvidencePackData,
  type ResearchMaterialData
} from "../../../../packages/contracts/src/deepResearch.js";
import {
  DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
  type SynthesizedDeepResearchReportPayload
} from "../../../../packages/contracts/src/deepResearchSynthesisReport.js";
import type { ResearchReportDecisionBinding } from "../../../../packages/contracts/src/researchReportDecision.js";
import type { TodayReviewDueEvent } from "../../../../packages/contracts/src/todayReviewDue.js";
import {
  deepResearchReportFingerprint,
  deepResearchReportIntegrityFailures,
  evidencePackFingerprint
} from "./deepResearchGate.js";
import {
  readEvidencePackInvalidatedBy,
  readLatestDeepResearchReport,
  readLatestEvidencePack
} from "./deepResearchPersistence.js";
import type { AuthenticatedResearchActor } from "./domain.js";

interface ReportProjectionRow {
  membership_id: string; membership_actor_type: "user" | "system"; membership_actor_id: string;
  membership_market: string; membership_code: string; membership_symbol: string;
  membership_state: "tracked" | "paused" | "archived"; membership_version: number | string;
  profile_id: string;
  pack_id: string; pack_membership_id: string; pack_membership_version: number | string;
  pack_market: "HK"; pack_code: string; pack_symbol: string; pack_version: number | string;
  pack_fingerprint: string; pack_frozen_at: Date | string;
  pack_items: ResearchMaterialData[]; pack_frozen_research_context: FrozenResearchEvidenceContext | null;
  report_id: string; report_evidence_pack_id: string; report_version: number | string;
  report_contract_version: string | null; report_fingerprint: string | null;
  report_status: "evidence_insufficient" | "complete_pending_confirmation";
  report_payload: unknown; report_gate_failures: string[]; report_created_at: Date | string;
  report_decision_id: string; report_decision_report_id: string;
  report_decision: "confirmed" | "rejected"; report_decision_note: string | null;
  report_decision_actor_type: "user"; report_decision_actor_id: string;
  report_decided_at: Date | string;
}

type BoundReportCurrentnessDependencies = {
  readLatestPack: typeof readLatestEvidencePack;
  readLatestReport: typeof readLatestDeepResearchReport;
  readInvalidatedBy: typeof readEvidencePackInvalidatedBy;
};

const boundReportCurrentnessDependencies: BoundReportCurrentnessDependencies = {
  readLatestPack: readLatestEvidencePack,
  readLatestReport: readLatestDeepResearchReport,
  readInvalidatedBy: readEvidencePackInvalidatedBy
};

interface BoundReportSnapshot {
  id: string;
  evidencePackId: string;
  version: number;
  contractVersion: string;
  reportFingerprint: string;
  status: "evidence_insufficient" | "complete_pending_confirmation";
  gateFailures: string[];
  payload: unknown;
  createdAt: string;
}

interface ValidatedBoundSnapshot {
  researchReport: TodayReviewDueEvent["researchReport"];
  pack: ResearchEvidencePackData;
  report: BoundReportSnapshot;
}

export class BoundReportNoLongerCurrentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoundReportNoLongerCurrentError";
  }
}

export async function readBoundTodayResearchReport(
  pool: Pick<Pool | PoolClient, "query">,
  binding: ResearchReportDecisionBinding,
  decision: { market: string; code: string; symbol: string; checkedAt: Date | string },
  actor: AuthenticatedResearchActor,
  now: Date,
  dependencies = boundReportCurrentnessDependencies
): Promise<TodayReviewDueEvent["researchReport"]> {
  const result = await pool.query<ReportProjectionRow>(
    `select membership.id::text as membership_id,
            membership.actor_type as membership_actor_type, membership.actor_id as membership_actor_id,
            membership.market as membership_market, membership.code as membership_code,
            membership.symbol as membership_symbol, membership.state as membership_state,
            membership.version as membership_version, profile.id::text as profile_id,
            pack.id::text as pack_id, pack.candidate_membership_id::text as pack_membership_id,
            pack.candidate_membership_version as pack_membership_version,
            profile.market as pack_market, profile.code as pack_code, profile.symbol as pack_symbol,
            pack.version as pack_version, pack.pack_fingerprint,
            pack.frozen_at as pack_frozen_at, pack.items as pack_items,
            pack.frozen_research_context as pack_frozen_research_context,
            report.id::text as report_id, report.evidence_pack_id::text as report_evidence_pack_id,
            report.version as report_version, report.report_contract_version,
            report.report_fingerprint, report.status as report_status,
            report.report_payload, report.gate_failures as report_gate_failures,
            report.created_at as report_created_at,
            report_decision.id::text as report_decision_id,
            report_decision.report_id::text as report_decision_report_id,
            report_decision.decision as report_decision,
            report_decision.note as report_decision_note,
            report_decision.actor_type as report_decision_actor_type,
            report_decision.actor_id as report_decision_actor_id,
            report_decision.created_at as report_decided_at
       from candidate_memberships membership
       join research_evidence_packs pack on pack.candidate_membership_id = membership.id
       join research_profiles profile on profile.id = pack.research_profile_id
       join deep_research_reports report
         on report.evidence_pack_id = pack.id and report.research_profile_id = profile.id
       join deep_research_report_decisions report_decision on report_decision.report_id = report.id
      where membership.id = $1 and pack.id = $2 and report.id = $3 and report_decision.id = $4
        and report.deleted_at is null
      limit 2`,
    [binding.membershipId, binding.evidencePackId, binding.reportId, binding.reportDecisionId]
  );
  if (result.rows.length !== 1) throw new Error("bound decision-time report identity is missing or ambiguous");
  const row = result.rows[0]!;
  if (!row.pack_frozen_research_context || !("weinstein" in row.pack_frozen_research_context)) {
    throw new BoundReportNoLongerCurrentError("bound evidence pack uses a historical frozen-context contract");
  }
  const validated = validateBoundSnapshot(row, binding, decision, actor, now);
  await assertExactCurrentBoundSnapshot(
    pool, row, validated.pack, validated.report,
    binding, actor, now, dependencies
  );
  return validated.researchReport;
}

function validateBoundSnapshot(
  row: ReportProjectionRow,
  binding: ResearchReportDecisionBinding,
  decision: { market: string; code: string; symbol: string; checkedAt: Date | string },
  actor: AuthenticatedResearchActor,
  now: Date
): ValidatedBoundSnapshot {
  const pack: ResearchEvidencePackData = {
    id: String(row.pack_id), membershipId: String(row.pack_membership_id),
    membershipVersion: Number(row.pack_membership_version), market: row.pack_market,
    code: row.pack_code, symbol: row.pack_symbol, version: Number(row.pack_version),
    packFingerprint: row.pack_fingerprint, frozenAt: iso(row.pack_frozen_at),
    items: row.pack_items, frozenResearchContext: row.pack_frozen_research_context,
    currentness: { status: "current", invalidatedBy: [] }
  };
  const report: BoundReportSnapshot = {
    id: String(row.report_id), evidencePackId: String(row.report_evidence_pack_id),
    version: Number(row.report_version),
    contractVersion: row.report_contract_version === EVIDENCE_BOUND_REPORT_CONTRACT_VERSION
      ? EVIDENCE_BOUND_REPORT_CONTRACT_VERSION
      : row.report_contract_version === DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION
        ? DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION
        : LEGACY_REPORT_CONTRACT_VERSION,
    reportFingerprint: row.report_fingerprint ?? "UNKNOWN",
    status: row.report_status, gateFailures: row.report_gate_failures,
    payload: row.report_payload,
    createdAt: iso(row.report_created_at)
  };
  const reportDecision: DeepResearchDecisionData = {
    id: String(row.report_decision_id), reportId: String(row.report_decision_report_id),
    decision: row.report_decision, note: row.report_decision_note,
    actorType: row.report_decision_actor_type, actorId: row.report_decision_actor_id,
    decidedAt: iso(row.report_decided_at)
  };
  const reportDecisionValidation = validateDeepResearchDecisionData(reportDecision);
  if (!Array.isArray(pack.items) || pack.items.length === 0 || !pack.frozenResearchContext
    || !reportDecisionValidation.ok) {
    throw new Error(`bound decision-time stored payload failed validation: ${[
      ...reportDecisionValidation.ok ? [] : reportDecisionValidation.errors
    ].join("; ") || "pack items or frozen context missing"}`);
  }
  assertExactBoundIdentities(row, pack, report, reportDecision, binding, decision, actor);
  assertBoundFingerprints(pack, report, binding);
  const payload = report.payload as EvidenceBoundDeepResearchReportPayload | SynthesizedDeepResearchReportPayload;
  assertBoundPayload(payload, pack, report, binding);
  if (Date.parse(payload.adviceLayer.applicableUntil) <= now.getTime()) {
    throw new BoundReportNoLongerCurrentError("bound report advice is no longer applicable");
  }
  assertChronology(pack.frozenAt, report.createdAt, reportDecision.decidedAt, decision.checkedAt, now);
  return {
    pack,
    report,
    researchReport: {
      availability: "preserved", binding, investmentThesis: payload.investmentThesis,
      invalidationConditions: payload.invalidationConditions,
      nextValidationQuestion: payload.nextValidationQuestions[0] ?? "UNKNOWN",
      limitation: "Decision-time snapshot from the exact-current adopted report; open Research to fresh-read the same bound facts."
    }
  };
}

async function assertExactCurrentBoundSnapshot(
  pool: Pick<Pool | PoolClient, "query">,
  row: ReportProjectionRow,
  pack: ResearchEvidencePackData,
  report: BoundReportSnapshot,
  binding: ResearchReportDecisionBinding,
  actor: AuthenticatedResearchActor,
  now: Date,
  dependencies: BoundReportCurrentnessDependencies
): Promise<void> {
  const membershipVersion = Number(row.membership_version);
  if (row.membership_state === "archived" || membershipVersion !== binding.membershipVersion) {
    throw new BoundReportNoLongerCurrentError("bound report membership is no longer exact-current");
  }
  const [latestPack, latestReport, invalidatedBy] = await Promise.all([
    dependencies.readLatestPack(
      pool, String(row.profile_id), binding.membershipId, membershipVersion, now
    ),
    dependencies.readLatestReport(
      pool, String(row.profile_id), binding.membershipId, membershipVersion
    ),
    dependencies.readInvalidatedBy(
      pool,
      String(row.profile_id),
      pack,
      actor,
      {
        id: binding.membershipId,
        version: membershipVersion,
        state: row.membership_state,
        market: row.membership_market,
        code: row.membership_code,
        symbol: row.membership_symbol
      },
      now
    )
  ]);
  if (!latestPack) {
    throw new Error("latest evidence pack is unavailable");
  }
  if (latestPack.id !== binding.evidencePackId
    || latestPack.currentness.status !== "current"
    || latestPack.currentness.invalidatedBy.length !== 0) {
    throw new BoundReportNoLongerCurrentError("bound evidence pack is no longer exact-current");
  }
  if (latestPack.version !== pack.version
    || latestPack.packFingerprint !== binding.evidencePackFingerprint) {
    throw new Error("latest evidence pack identity is corrupted");
  }
  assertLatestReport(latestReport, report, binding);
  if (invalidatedBy.length !== 0) {
    throw new BoundReportNoLongerCurrentError("bound material or technical sources have drifted");
  }
}

function assertLatestReport(
  latestReport: DeepResearchReportData | null,
  report: BoundReportSnapshot,
  binding: ResearchReportDecisionBinding
): void {
  if (!latestReport) {
    throw new Error("latest report is unavailable");
  }
  if (latestReport.id !== binding.reportId
    || latestReport.currentness.status !== "current"
    || latestReport.currentness.invalidatedBy.length !== 0
    || latestReport.currentness.evidencePackInvalidatedBy.length !== 0) {
    throw new BoundReportNoLongerCurrentError("bound report is no longer exact-current");
  }
  if (latestReport.evidencePackId !== binding.evidencePackId
    || latestReport.version !== report.version
    || latestReport.contractVersion !== binding.contractVersion
    || latestReport.reportFingerprint !== binding.reportFingerprint) {
    throw new Error("latest report identity is corrupted");
  }
}

function assertExactBoundIdentities(
  row: ReportProjectionRow,
  pack: ResearchEvidencePackData,
  report: BoundReportSnapshot,
  reportDecision: DeepResearchDecisionData,
  binding: ResearchReportDecisionBinding,
  decision: { market: string; code: string; symbol: string },
  actor: AuthenticatedResearchActor
): void {
  if (row.membership_actor_type !== actor.actorType || row.membership_actor_id !== actor.actorId
    || row.membership_market !== decision.market || row.membership_code !== decision.code
    || row.membership_symbol !== decision.symbol || String(row.membership_id) !== binding.membershipId
    || Number(row.membership_version) !== binding.membershipVersion
    || pack.membershipId !== binding.membershipId || pack.membershipVersion !== binding.membershipVersion
    || pack.symbol !== binding.symbol || pack.id !== binding.evidencePackId
    || pack.packFingerprint !== binding.evidencePackFingerprint || report.id !== binding.reportId
    || report.evidencePackId !== binding.evidencePackId || report.version !== binding.reportVersion
    || report.contractVersion !== binding.contractVersion || report.reportFingerprint !== binding.reportFingerprint
    || report.status !== "complete_pending_confirmation" || report.gateFailures.length !== 0
    || reportDecision.id !== binding.reportDecisionId || reportDecision.reportId !== binding.reportId
    || reportDecision.decision !== binding.reportDecision || reportDecision.actorType !== binding.reportDecisionActorType
    || reportDecision.actorId !== actor.actorId || reportDecision.actorId !== binding.reportDecisionActorId
    || reportDecision.decidedAt !== iso(binding.decidedAt)) {
    throw new Error("bound decision-time report identities do not exactly match the formal decision binding");
  }
}

function assertBoundFingerprints(
  pack: ResearchEvidencePackData,
  report: BoundReportSnapshot,
  binding: ResearchReportDecisionBinding
): void {
  if (evidencePackFingerprint(pack.membershipId, pack.membershipVersion, pack.items, pack.frozenResearchContext)
      !== pack.packFingerprint) throw new Error("bound decision-time evidence-pack fingerprint is invalid");
  if (report.reportFingerprint !== binding.reportFingerprint) {
    throw new Error("bound decision-time report fingerprint does not match the formal decision binding");
  }
}

function assertBoundPayload(
  payload: EvidenceBoundDeepResearchReportPayload | SynthesizedDeepResearchReportPayload,
  pack: ResearchEvidencePackData,
  report: BoundReportSnapshot,
  binding: ResearchReportDecisionBinding
): void {
  const payloadValidation = payload.reportContractVersion === EVIDENCE_BOUND_REPORT_CONTRACT_VERSION
    ? validateCreateDeepResearchReportRequest({
    membershipVersion: binding.membershipVersion,
    evidencePackId: binding.evidencePackId,
    idempotencyKey: "today-report-read-validation",
    reportContractVersion: payload.reportContractVersion,
    evidencePackBinding: payload.evidencePackBinding,
    reproducibility: payload.reproducibility,
    adviceLayer: payload.adviceLayer,
    researchLayer: {
      fundamentals: payload.researchLayer?.fundamentals,
      eventsAndCatalysts: payload.researchLayer?.eventsAndCatalysts,
      risks: payload.researchLayer?.risks,
      counterevidence: payload.researchLayer?.counterevidence,
      unknowns: payload.researchLayer?.unknowns,
      sourceConflicts: payload.researchLayer?.sourceConflicts,
      nextValidationQuestions: payload.researchLayer?.nextValidationQuestions
    },
    changeFromPrevious: payload.changeFromPrevious
    })
    : { ok: true as const };
  if (payload.reportContractVersion !== report.contractVersion
    || !payloadValidation.ok
    || deepResearchReportFingerprint(report.evidencePackId, payload) !== report.reportFingerprint
    || deepResearchReportIntegrityFailures(payload, pack).length > 0) {
    throw new Error("bound decision-time report fingerprint or pack binding is invalid");
  }
}

function assertChronology(
  frozenAt: string,
  reportCreatedAt: string,
  reportDecidedAt: string,
  checkedAt: Date | string,
  now: Date
): void {
  const chronology = [frozenAt, reportCreatedAt, reportDecidedAt, iso(checkedAt)]
    .map((value) => Date.parse(value));
  if (chronology.some((value) => !Number.isFinite(value))
    || chronology.some((value, index) => index > 0 && value < chronology[index - 1]!)
    || chronology.at(-1)! > now.getTime()) throw new Error("bound decision-time report chronology is invalid");
}

function iso(value: Date | string): string {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("bound decision-time timestamp is invalid");
  return new Date(timestamp).toISOString();
}
