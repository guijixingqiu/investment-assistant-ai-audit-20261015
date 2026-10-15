import { readResearchFinancialRequirement } from "./researchFinancialRequirementRepository.js";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import { evidencePackFingerprint } from "./deepResearchGate.js";
import type { Pool, PoolClient } from "pg";
import type {
  DeepResearchDecisionData,
  DeepResearchReportData,
  FrozenResearchEvidenceContext,
  FrozenResearchInvalidationReason,
  ResearchEvidencePackData,
  ResearchMaterialData
} from "../../../../packages/contracts/src/deepResearch.js";
import {
  currentHongKongDate,
  latestCompletedHongKongSession,
  readLatestDailyTechnicalSnapshot
} from "../market/dailyBarsRepository.js";
import { DeepResearchGateError, type AuthenticatedResearchActor } from "./domain.js";
import { frozenEvidencePackInvalidatedBy } from "./deepResearchGate.js";
import type { CurrentFrozenResearchEvidence } from "./deepResearchEventBinding.js";
import { researchStockMaterials } from "../../../../packages/contracts/src/researchEvent.js";
import { readCurrentResearchValuationScenarios } from "./researchValuationScenarioRepository.js";
import { readResearchEvents } from "./researchEventRepository.js";
import { readLatestGeelySalesMonitor } from "./geelySalesMonitorRepository.js";
import { readLatestGclPvPriceMonitor } from "./gclPvPriceMonitorRepository.js";
import { readResearchContextSnapshot } from "./researchContextRepository.js";
import { readLatestWeinsteinEvidenceBinding } from "../market/weinsteinTechnicalSnapshotRepository.js";
import { sourceOriginalAvailabilities } from "./researchSourceSnapshotRepository.js";
import {assertFrozenMaterialOriginals} from "./deepResearchMaterialOriginals.js";
import type {
  DeepResearchDecisionRow,
  DeepResearchReportRow,
  EvidencePackRow,
  ResearchMaterialRow
} from "./deepResearchMappers.js";
import {
  rowToDeepResearchDecision,
  rowToDeepResearchReport,
  rowToEvidencePack,
  rowToResearchMaterial
} from "./deepResearchMappers.js";

interface EvidencePackCurrentMembership {
  id: string;
  version: number;
  state: "tracked" | "paused" | "archived";
  market: string;
  code: string;
  symbol: string;
}

export async function readResearchMaterials(
  client: Pick<Pool | PoolClient, "query">,
  profileId: string,
  membershipId: string | null,
  now: Date,
  asOf?: Date,
  materialId?: string
): Promise<ResearchMaterialData[]> {
  const result = await client.query<ResearchMaterialRow>(
    `select rm.id, rm.candidate_membership_id, rm.evidence_item_id as evidence_id, rm.replaces_material_id, rm.revision,
            case when exists (select 1 from research_materials child where child.replaces_material_id = rm.id ${asOf ? "and child.created_at < $3::timestamptz + interval '1 millisecond'" : ""})
                 then 'replaced' else 'current' end as revision_state,
            rp.market, rp.code, rp.symbol,
            rm.material_kind, rm.title, rm.content_text, ei.source_type, ei.source_url,
            ei.published_at, ei.captured_at, ei.raw_payload->'futuFinancialSource' as futu_financial_source,
            rm.content_fingerprint, rm.claim_type,
            rm.verification_status, rm.rights_status, rm.source_version, rm.valid_until,
            ei.summary, ei.variable_name, ei.stance, ei.reliability, ei.materiality, ei.is_read,
            rm.citation_document_id, rm.citation_page_number, rm.citation_page_text_sha256,
            rm.citation_snapshot_id,rm.citation_snapshot_membership_version,rm.citation_snapshot_text_sha256,
            rm.citation_start_utf16,rm.citation_end_utf16,rm.citation_excerpt_sha256,
            s.raw_sha256 as snapshot_raw_sha256,s.byte_length as snapshot_byte_length,
            s.media_type as snapshot_media_type,s.canonical_url as snapshot_canonical_url,
            s.response_url as snapshot_response_url
       from research_materials rm
       join research_profiles rp on rp.id = rm.research_profile_id
       join evidence_items ei on ei.id = rm.evidence_item_id
       left join research_source_snapshots s on s.id=rm.citation_snapshot_id
         and s.candidate_membership_id=rm.candidate_membership_id
         and s.captured_membership_version=rm.citation_snapshot_membership_version
         and s.text_sha256=rm.citation_snapshot_text_sha256
      where rm.research_profile_id = $1
        and ei.source_type <> 'personal_research_note'
        and ${asOf ? "rm.created_at < $3::timestamptz + interval '1 millisecond' and (rm.deleted_at is null or rm.deleted_at >= $3::timestamptz + interval '1 millisecond')" : "rm.deleted_at is null"}
        and (rm.candidate_membership_id = $2::bigint
          or (rm.candidate_membership_id is null and rm.rights_status <> 'user_provided'))
        ${materialId ? `and rm.id = $${asOf ? 4 : 3}::bigint` : ""}
      order by rm.created_at asc, rm.id asc`,
    [profileId, membershipId, ...(asOf ? [asOf] : []), ...(materialId ? [materialId] : [])]
  );
  return result.rows.map((row) => rowToResearchMaterial(row, now));
}

export async function readEvidencePackInvalidatedBy(
  client: Pick<Pool | PoolClient, "query">,
  profileId: string,
  pack: ResearchEvidencePackData,
  actor: AuthenticatedResearchActor,
  membership: EvidencePackCurrentMembership,
  now: Date,
  currentEvidence?: CurrentFrozenResearchEvidence,
  currentWeinstein?: FrozenResearchEvidenceContext["weinstein"],
  sourceStore?:import("./researchSourceSnapshotRepository.js").SourceSnapshotStoreOptions
): Promise<FrozenResearchInvalidationReason[]> {
  const originals=pack.items.filter(item=>item.snapshotCitation&&item.snapshotOriginal);
  const availability=await sourceOriginalAvailabilities(client,membership.id,actor,originals.map(item=>({
    snapshotId:item.snapshotCitation!.snapshotId,rawSha256:item.snapshotOriginal!.rawSha256,
    byteLength:item.snapshotOriginal!.byteLength,textSha256:item.snapshotCitation!.textSha256
  })),sourceStore);
  const originalReasons:FrozenResearchInvalidationReason[]=[];
  if(originals.some(item=>availability.get(item.snapshotCitation!.snapshotId)==="unavailable"))
    originalReasons.push("source_original_unavailable");
  if(originals.some(item=>availability.get(item.snapshotCitation!.snapshotId)!=="available"
    && availability.get(item.snapshotCitation!.snapshotId)!=="unavailable"))
    originalReasons.push("source_original_unknown");
  if (pack.researchMode === "limited") {
    const reasons: FrozenResearchInvalidationReason[] = [...originalReasons];
    if (actor.actorType !== "user") reasons.push("actor_changed");
    if (pack.membershipId !== membership.id || pack.membershipVersion !== membership.version || pack.symbol !== membership.symbol) reasons.push("membership_version_changed");
    if (membership.state === "archived") reasons.push("membership_state_changed");
    const events = await readResearchEvents(client, profileId, membership.id, membership.version, now);
    const items = researchStockMaterials((await readResearchMaterials(client, profileId, membership.id, now))
      .filter((item) => item.revisionState === "current"), events);
    const materialReasons=limitedMaterialCurrentness(pack,items,now);
    reasons.push(...materialReasons);
    if(pack.materialSelectionMode==="explicit"&&materialReasons.length===0)try{
      await assertFrozenMaterialOriginals(client,membership.id,actor,pack.items,sourceStore,true);
    }catch{reasons.push(sourceStore?"source_original_unavailable":"source_original_unknown");}
    if (await researchSnapshotBodyChanged(client,pack.items)) reasons.push("source_version_review_required");
    return [...new Set(reasons)];
  }
  const v2Selection=pack.frozenResearchContext?.selectedValuationMethods;
  const valuationMethods = currentEvidence || v2Selection ? [] : await readCurrentResearchValuationScenarios(
    client,
    membership.id,
    actor,
    membership.version,
    membership.state,
    now,
    sourceStore
  );
  const providerId=v2Selection?.find(entry=>entry.basisKind==="provider")?.scenario.id;
  const fcffId=v2Selection?.find(entry=>entry.basisKind==="fcff")?.scenario.id;
  const currentProvider=providerId&&sourceStore
    ? await (await import("./researchValuationProviderScenarioRepository.js")).readProviderValuationScenarioById(
      client,membership.id,providerId,actor,now,sourceStore) : null;
  const currentFcff=fcffId
    ? (await (await import("./researchValuationFcffScenarioRepository.js")).readFcffScenarioSets(
      client,membership.id,actor,now,sourceStore)).find(scenario=>scenario.id===fcffId)??null : null;
  const currentContext=currentEvidence?null:await readResearchContextSnapshot(
    client,membership.id,actor,now,sourceStore);
  const current = currentEvidence ?? {
    actor: { actorType: "user" as const, actorId: actor.actorId },
    membership: {
      id: membership.id,
      version: membership.version,
      state: membership.state,
      symbol: membership.symbol
    },
    materials: (await readResearchMaterials(client, profileId, membership.id, now))
      .filter((item) => item.revisionState === "current"),
    valuationScenario: valuationMethods[0] ?? null,
    valuationMethods,
    ...(v2Selection?{providerScenario:currentProvider,fcffScenario:currentFcff}:{}),
    technical: await readLatestDailyTechnicalSnapshot(
      client,
      membership.market,
      membership.code,
      latestCompletedHongKongSession(now)
    ),
    events: await readResearchEvents(
      client,
      profileId,
      membership.id,
      membership.version,
      now
    ),
    operatingMonitor: membership.symbol === "HK.00175"
      ? await readLatestGeelySalesMonitor(client, profileId, membership.id, membership.version, null, now)
      : membership.symbol === "HK.03800"
        ? await readLatestGclPvPriceMonitor(client, profileId, membership.id, membership.version, null, now)
        : null,
    researchContext: currentContext?.peerSourceIssues?.length ? null : (currentContext?.data ?? null)
  };
  const authoritativeWeinstein = currentWeinstein
    ?? await readLatestWeinsteinEvidenceBinding(client, membership.symbol, currentHongKongDate(now));
  const reasons=frozenEvidencePackInvalidatedBy(
    pack.frozenResearchContext,
    pack.items,
    {
      ...current,
      ...(authoritativeWeinstein ? { weinstein: authoritativeWeinstein } : {}),
      materials: researchStockMaterials(current.materials, current.events)
    },
    now
  );
  const currentRequirement=await readResearchFinancialRequirement(client,membership.id,actor,now,sourceStore);
  const boundRequirement=pack.frozenResearchContext?.financialRequirement;
  if(boundRequirement && (currentRequirement.status!=="available"
    || canonicalJson(currentRequirement.data)!==canonicalJson(boundRequirement))
    || !boundRequirement && currentRequirement.status==="available") reasons.push("financial_requirement_changed");
  reasons.push(...originalReasons);
  if (await researchSnapshotBodyChanged(client,pack.items)) reasons.push("source_version_review_required");
  return reasons;
}

/** Legacy limited packs remain all-material snapshots; explicit packs bind only their frozen selection. */
export function limitedMaterialCurrentness(pack:ResearchEvidencePackData,
  currentItems:ResearchMaterialData[],now:Date):FrozenResearchInvalidationReason[]{
  const explicit=pack.researchMode==="limited"&&pack.materialSelectionMode==="explicit";
  const currentById=new Map(currentItems.map(item=>[item.id,item]));
  const selected=explicit?pack.items.map(item=>currentById.get(item.id)).filter(
    (item):item is ResearchMaterialData=>!!item):currentItems;
  const missing=explicit&&selected.length!==pack.items.length;
  const changed=missing||evidencePackFingerprint(pack.membershipId,pack.membershipVersion,pack.items,
    undefined,explicit?"limited":undefined,explicit?"explicit":undefined)
    !==evidencePackFingerprint(pack.membershipId,pack.membershipVersion,selected,
      undefined,explicit?"limited":undefined,explicit?"explicit":undefined);
  const blocked=explicit&&selected.some(item=>item.freshness!=="fresh"
    ||item.verificationStatus==="conflict"||item.verificationStatus==="rejected"
    ||!["user_provided","authorized_public"].includes(item.rightsStatus));
  return [...(changed||blocked?["material_set_changed" as const]:[]),
    ...([...pack.items,...selected].some(item=>Date.parse(item.validUntil)<=now.getTime())
      ?["material_source_stale" as const]:[])];
}

export async function researchSnapshotBodyChanged(client:Pick<Pool | PoolClient,"query">,
  materials:ResearchMaterialData[]):Promise<boolean> {
  const ids=materials.map(item=>item.snapshotCitation?.snapshotId).filter((id):id is string=>!!id);
  if(!ids.length)return false;
  const result=await client.query<{changed:boolean}>(`select exists(
    select 1 from research_source_snapshots s join research_source_snapshots newer
      on newer.candidate_membership_id=s.candidate_membership_id and newer.canonical_url=s.canonical_url
      and (newer.captured_at,newer.id)>(s.captured_at,s.id) and newer.text_sha256<>s.text_sha256
    where s.id=any($1::bigint[])) as changed`,[ids]);
  return result.rows[0]?.changed===true;
}

export async function readEvidencePack(
  client: Pick<Pool | PoolClient, "query">,
  packId: string,
  profileId: string,
  now: Date
): Promise<ResearchEvidencePackData | null> {
  const result = await client.query<EvidencePackRow>(
    `select ep.id, ep.candidate_membership_id, ep.candidate_membership_version,
            rp.market, rp.code, rp.symbol, ep.version, ep.pack_fingerprint, ep.frozen_at, ep.items,
            ep.frozen_research_context, ep.research_mode, ep.material_selection_mode,
            coalesce(ep.redaction_checksum = research_evidence_pack_redaction_checksum(ep), false) as redaction_checksum_valid
       from research_evidence_packs ep
       join research_profiles rp on rp.id = ep.research_profile_id
      where ep.id = $1 and ep.research_profile_id = $2
      limit 1`,
    [packId, profileId]
  );
  return result.rows[0] ? verifiedEvidencePack(result.rows[0], now) : null;
}

export async function readLatestEvidencePack(
  client: Pick<Pool | PoolClient, "query">,
  profileId: string,
  membershipId: string,
  membershipVersion: number,
  now: Date
): Promise<ResearchEvidencePackData | null> {
  const result = await client.query<EvidencePackRow>(
    `select ep.id, ep.candidate_membership_id, ep.candidate_membership_version,
            rp.market, rp.code, rp.symbol, ep.version, ep.pack_fingerprint, ep.frozen_at, ep.items,
            ep.frozen_research_context, ep.research_mode, ep.material_selection_mode,
            coalesce(ep.redaction_checksum = research_evidence_pack_redaction_checksum(ep), false) as redaction_checksum_valid
       from research_evidence_packs ep
       join research_profiles rp on rp.id = ep.research_profile_id
      where ep.research_profile_id = $1
        and ep.candidate_membership_id = $2
        and ep.candidate_membership_version = $3
      order by ep.version desc, ep.id desc
      limit 1`,
    [profileId, membershipId, membershipVersion]
  );
  return result.rows[0] ? verifiedEvidencePack(result.rows[0], now) : null;
}

export async function readEvidencePackRows(
  client: Pick<Pool | PoolClient, "query">,
  profileId: string,
  membershipId: string
): Promise<EvidencePackRow[]> {
  const result = await client.query<EvidencePackRow>(
    `select ep.id, ep.candidate_membership_id, ep.candidate_membership_version,
            rp.market, rp.code, rp.symbol, ep.version, ep.pack_fingerprint, ep.frozen_at, ep.items,
            ep.frozen_research_context, ep.research_mode, ep.material_selection_mode,
            coalesce(ep.redaction_checksum = research_evidence_pack_redaction_checksum(ep), false) as redaction_checksum_valid
       from research_evidence_packs ep
       join research_profiles rp on rp.id = ep.research_profile_id
      where ep.research_profile_id = $1
        and ep.candidate_membership_id = $2
      order by ep.version desc, ep.id desc`,
    [profileId, membershipId]
  );
  for (const row of result.rows) assertEvidencePackRedactionReceipt(row);
  return result.rows;
}

function verifiedEvidencePack(row: EvidencePackRow, now: Date): ResearchEvidencePackData {
  assertEvidencePackRedactionReceipt(row);
  return rowToEvidencePack(row, now);
}

function assertEvidencePackRedactionReceipt(row: EvidencePackRow): void {
  if (row.items.some((item) => item.sourceType === "deleted") && !row.redaction_checksum_valid) {
    throw new DeepResearchGateError(`evidence pack ${row.id} failed redaction receipt verification`);
  }
}

export async function readDeepResearchReport(
  client: Pick<Pool | PoolClient, "query">,
  reportId: string,
  profileId: string
): Promise<DeepResearchReportData | null> {
  const result = await client.query<DeepResearchReportRow>(
    `select id, evidence_pack_id, version, report_contract_version, report_fingerprint,
            status, report_payload, gate_failures, created_at
       from deep_research_reports
      where id = $1 and research_profile_id = $2 and deleted_at is null
      limit 1`,
    [reportId, profileId]
  );
  return result.rows[0] ? rowToDeepResearchReport(result.rows[0]) : null;
}

export async function readDeepResearchReportForReplay(
  client: Pick<Pool | PoolClient, "query">,
  reportId: string,
  membershipId: string
): Promise<DeepResearchReportData | null> {
  const result = await client.query<DeepResearchReportRow>(
    `select report.id, report.evidence_pack_id, report.version, report.report_contract_version,
            report.report_fingerprint, report.status, report.report_payload, report.gate_failures, report.created_at
       from deep_research_reports report
       join research_evidence_packs pack on pack.id = report.evidence_pack_id
      where report.id = $1 and pack.candidate_membership_id = $2 and report.deleted_at is null
      limit 1`,
    [reportId, membershipId]
  );
  return result.rows[0] ? rowToDeepResearchReport(result.rows[0]) : null;
}

export async function readLatestDeepResearchReport(
  client: Pick<Pool | PoolClient, "query">,
  profileId: string,
  membershipId: string,
  membershipVersion: number
): Promise<DeepResearchReportData | null> {
  const result = await client.query<DeepResearchReportRow>(
    `select dr.id, dr.evidence_pack_id, dr.version, dr.report_contract_version,
            dr.report_fingerprint, dr.status, dr.report_payload, dr.gate_failures, dr.created_at
       from deep_research_reports dr
       join research_evidence_packs ep on ep.id = dr.evidence_pack_id
      where dr.research_profile_id = $1
        and ep.candidate_membership_id = $2
        and ep.candidate_membership_version = $3
        and dr.deleted_at is null
      order by dr.version desc, dr.id desc
      limit 1`,
    [profileId, membershipId, membershipVersion]
  );
  return result.rows[0] ? rowToDeepResearchReport(result.rows[0]) : null;
}

export async function readDeepResearchReportRows(
  client: Pick<Pool | PoolClient, "query">,
  profileId: string,
  membershipId: string,
  asOf?: Date
): Promise<DeepResearchReportRow[]> {
  const result = await client.query<DeepResearchReportRow>(
    `select dr.id, dr.evidence_pack_id, dr.version, dr.report_contract_version,
            dr.report_fingerprint, dr.status, dr.report_payload, dr.gate_failures, dr.created_at
       from deep_research_reports dr
       join research_evidence_packs ep on ep.id = dr.evidence_pack_id
      where dr.research_profile_id = $1
        and ep.candidate_membership_id = $2
        and ${asOf ? "dr.created_at < $3::timestamptz + interval '1 millisecond' and (dr.deleted_at is null or dr.deleted_at >= $3::timestamptz + interval '1 millisecond')" : "dr.deleted_at is null"}
      order by dr.version desc, dr.id desc
      limit 50`,
    [profileId, membershipId, ...(asOf ? [asOf] : [])]
  );
  return result.rows;
}

export async function readDeepResearchDecision(
  client: Pick<Pool | PoolClient, "query">,
  reportId: string
): Promise<DeepResearchDecisionData | null> {
  const result = await client.query<DeepResearchDecisionRow>(
    `select id, report_id, decision, note, actor_type, actor_id, created_at
       from deep_research_report_decisions
      where report_id = $1
      limit 1`,
    [reportId]
  );
  return result.rows[0] ? rowToDeepResearchDecision(result.rows[0]) : null;
}

export async function readDeepResearchDecisionRows(
  client: Pick<Pool | PoolClient, "query">,
  profileId: string,
  membershipId: string
): Promise<DeepResearchDecisionRow[]> {
  const result = await client.query<DeepResearchDecisionRow>(
    `select decision.id, decision.report_id, decision.decision, decision.note,
            decision.actor_type, decision.actor_id, decision.created_at
       from deep_research_report_decisions decision
       join deep_research_reports report on report.id = decision.report_id
       join research_evidence_packs pack on pack.id = report.evidence_pack_id
      where report.research_profile_id = $1
        and pack.candidate_membership_id = $2
        and report.deleted_at is null
        and report.id in (
          select bounded_report.id
            from deep_research_reports bounded_report
            join research_evidence_packs bounded_pack
              on bounded_pack.id = bounded_report.evidence_pack_id
           where bounded_report.research_profile_id = $1
             and bounded_pack.candidate_membership_id = $2
             and bounded_report.deleted_at is null
           order by bounded_report.version desc, bounded_report.id desc
           limit 50
        )
      order by report.version desc, report.id desc
      limit 50`,
    [profileId, membershipId]
  );
  return result.rows;
}
