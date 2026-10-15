import type { Pool, PoolClient } from "pg";
import {
  RESEARCH_FUNDAMENTALS_SCHEMA_VERSION,
  buildResearchFinancialCoverage,
  toResearchFundamentalsExport,
  researchFundamentalCurrentlyUsable,
  type ResearchFundamentalsExport,
  type ResearchFundamentalsEnvelope,
  type ResearchFundamentalValueData
} from "../../../../packages/contracts/src/researchFundamentals.js";
import {
  CandidateMembershipNotFoundError,
  ResearchFundamentalError,
  type AuthenticatedResearchActor
} from "./domain.js";
import { readCandidateMembershipById } from "./candidateMembershipPersistence.js";
import { readResearchFinancialRequirement } from "./researchFinancialRequirementRepository.js";
import { deriveResearchFundamentals } from "./researchFundamentalDerivations.js";
import { sourceOriginalAvailabilities, type SourceOriginalAvailability, type SourceSnapshotStoreOptions } from "./researchSourceSnapshotRepository.js";

export interface ResearchFundamentalRow {
  id: string;
  candidate_membership_id: string;
  captured_membership_version: number | string;
  symbol: string;
  metric: ResearchFundamentalValueData["metric"];
  period_kind: ResearchFundamentalValueData["periodKind"];
  period_start: Date | string | null;
  period_end: Date | string;
  currency: string;
  unit_scale: number | string;
  scope: ResearchFundamentalValueData["scope"];
  value_status: ResearchFundamentalValueData["valueStatus"];
  reported_value: string | null;
  comparability: ResearchFundamentalValueData["comparability"];
  comparability_reason: string | null;
  amendment_kind: ResearchFundamentalValueData["amendmentKind"];
  replaces_value_id: string | null;
  revision: number | string;
  created_at: Date | string;
  source_material_id: string;
  material_revision: number | string;
  material_valid_until: Date | string;
  material_source_version: string;
  citation_document_id: string | null;
  citation_page_number: number | string | null;
  citation_page_text_sha256: string | null;
  document_pdf_sha256: string | null;
  citation_snapshot_id?: string | null;
  citation_snapshot_membership_version?: number | string | null;
  citation_snapshot_text_sha256?: string | null;
  citation_start_utf16?: number | string | null;
  citation_end_utf16?: number | string | null;
  citation_excerpt_sha256?: string | null;
  snapshot_raw_sha256?: string | null;
  snapshot_byte_length?: number | string | null;
  snapshot_media_type?: string | null;
  snapshot_canonical_url?: string | null;
  snapshot_response_url?: string | null;
  snapshot_pending_review?: boolean;
  verification_status?: ResearchFundamentalValueData["provenance"]["verificationStatus"];
  assertion_metadata?: ResearchFundamentalValueData["assertion"] | null;
  material_claim_type?: string;
  material_verification_status?: string;
  material_published_at?: Date | string | null;
  value_replaced: boolean;
  material_superseded: boolean;
  lifecycle_status?:"RETRACTED"|"INVALID"|null;
}

export async function readResearchFundamentals(
  pool: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  actor: AuthenticatedResearchActor,
  now = new Date(),
  asOf?: Date,
  sourceStore?: SourceSnapshotStoreOptions
): Promise<ResearchFundamentalsEnvelope> {
  const membership = await readCandidateMembershipById(pool, actor, membershipId);
  if (!membership) throw new CandidateMembershipNotFoundError();
  const result = await pool.query<ResearchFundamentalRow>(
    `${fundamentalSelect(!!asOf)}
      where fv.candidate_membership_id = $1
        and cm.actor_type = $2
        and cm.actor_id = $3
        and ${asOf ? "fv.created_at < $4::timestamptz + interval '1 millisecond' and rm.created_at < $4::timestamptz + interval '1 millisecond' and (rm.deleted_at is null or rm.deleted_at >= $4::timestamptz + interval '1 millisecond')" : "rm.deleted_at is null"}
      order by fv.period_end desc, fv.metric asc, fv.revision desc, fv.id desc`,
    [membershipId, actor.actorType, actor.actorId, ...(asOf ? [asOf] : [])]
  );
  const availability=await sourceOriginalAvailabilities(pool,membershipId,actor,
    result.rows.filter(row=>row.citation_snapshot_id!=null).map(row=>({snapshotId:String(row.citation_snapshot_id),
      rawSha256:String(row.snapshot_raw_sha256),byteLength:Number(row.snapshot_byte_length),
      textSha256:String(row.citation_snapshot_text_sha256)})),sourceStore);
  const values = result.rows.map((row) => rowToResearchFundamentalValue(row, now,
    row.citation_snapshot_id==null?undefined:availability.get(String(row.citation_snapshot_id))));
  const metadata = researchFundamentalsMetadata(values);
  const requirement = asOf ? null : await readResearchFinancialRequirement(pool,membershipId,actor,now,sourceStore);
  return {
    schemaVersion: RESEARCH_FUNDAMENTALS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    dataCutoffAt: metadata.dataCutoffAt,
    asOf: metadata.asOf,
    provenance: "research_only",
    status: "available",
    requestedActorId: actor.actorId,
    membershipId,
    membershipVersion: Number(membership.version),
    symbol: membership.symbol,
    values,
    derivations: deriveResearchFundamentals(values),
    financialCoverage: buildResearchFinancialCoverage(values,requirement?.status==="available"?requirement.data!:undefined)
  };
}

export function researchFundamentalsMetadata(
  values: ResearchFundamentalValueData[]
): { dataCutoffAt: string | null; asOf: string | null } {
  const current = values.filter(researchFundamentalCurrentlyUsable);
  return {
    dataCutoffAt: current.reduce<string | null>((latest, value) => latest === null || value.createdAt > latest ? value.createdAt : latest, null),
    asOf: current.reduce<string | null>((latest, value) => latest === null || value.periodEnd > latest ? value.periodEnd : latest, null)
  };
}

export async function readResearchFundamentalsExport(
  pool: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  actor: AuthenticatedResearchActor,
  now = new Date(),
  sourceStore?: SourceSnapshotStoreOptions
): Promise<ResearchFundamentalsExport> {
  const envelope = await readResearchFundamentals(pool, membershipId, actor, now, undefined, sourceStore);
  const values = envelope.values.filter(researchFundamentalCurrentlyUsable);
  return toResearchFundamentalsExport({
    ...envelope,
    values,
    derivations: deriveResearchFundamentals(values),
    financialCoverage: buildResearchFinancialCoverage(values,envelope.financialCoverage.requirement)
  });
}

export async function findResearchFundamentalById(
  client: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  valueId: string,
  actor: AuthenticatedResearchActor,
  forUpdate = false
): Promise<ResearchFundamentalRow | null> {
  const result = await client.query<ResearchFundamentalRow>(
    `${fundamentalSelect()}
      where fv.id = $1
        and fv.candidate_membership_id = $2
        and cm.actor_type = $3
        and cm.actor_id = $4
        and rm.deleted_at is null
      ${forUpdate ? "for update of fv" : ""}
      limit 1`,
    [valueId, membershipId, actor.actorType, actor.actorId]
  );
  return result.rows[0] ?? null;
}

export async function assertCurrentStructuredSourceMaterial(
  client: PoolClient,
  membershipId: string,
  materialId: string,
  actor: AuthenticatedResearchActor,
  now = new Date()
): Promise<{ materialId: string; symbol: string }> {
  const result = await client.query<{ material_id: string; symbol: string; superseded: boolean; valid_until: Date | string; document_id:string|null;source_lead_id:string|null;source_type:string; snapshot_pending_review:boolean }>(
    `select rm.id as material_id, cm.symbol, rm.valid_until,rd.id document_id,rd.source_lead_id,ei.source_type,
            case when s.id is null then false else exists (
              select 1 from research_source_snapshots newer
               where newer.candidate_membership_id=s.candidate_membership_id and newer.canonical_url=s.canonical_url
                 and (newer.captured_at,newer.id)>(s.captured_at,s.id) and newer.text_sha256<>s.text_sha256
            ) end as snapshot_pending_review,
            exists (select 1 from research_materials child where child.replaces_material_id = rm.id) as superseded
       from research_materials rm
       join evidence_items ei on ei.id = rm.evidence_item_id
       left join research_documents rd
         on rd.id = rm.citation_document_id
        and rd.candidate_membership_id = rm.candidate_membership_id
       left join research_document_pages rdp
         on rdp.document_id = rm.citation_document_id
        and rdp.page_number = rm.citation_page_number
        and rdp.text_sha256 = rm.citation_page_text_sha256
       left join research_source_snapshots s on s.id=rm.citation_snapshot_id
         and s.candidate_membership_id=rm.candidate_membership_id
         and s.captured_membership_version=rm.citation_snapshot_membership_version
         and s.text_sha256=rm.citation_snapshot_text_sha256
       join candidate_memberships cm on cm.id = rm.candidate_membership_id
      where rm.id = $1
        and rm.candidate_membership_id = $2
        and cm.actor_type = $3
        and cm.actor_id = $4
        and rm.deleted_at is null
        and ei.source_type in ('owner_provided_pdf','issuer_public_pdf','issuer_public_html')
        and rm.claim_type = 'issuer_statement'
        and rm.verification_status = 'unverified'
        and ((ei.source_type='owner_provided_pdf' and rm.rights_status='user_provided')
          or (ei.source_type in ('issuer_public_pdf','issuer_public_html') and rm.rights_status='authorized_public'))
        and ((ei.source_type in ('owner_provided_pdf','issuer_public_pdf') and rd.id is not null and rdp.document_id is not null)
          or (ei.source_type='issuer_public_html' and s.id is not null and s.actor_type=cm.actor_type
            and s.actor_id=cm.actor_id and s.symbol=cm.symbol and s.captured_membership_version=cm.version))
      for update of rm`,
    [materialId, membershipId, actor.actorType, actor.actorId]
  );
  const source = result.rows[0];
  if (!source) {
    throw new ResearchFundamentalError(404, "SOURCE_MATERIAL_NOT_FOUND", "current original-source material and citation were not found for this actor and membership");
  }
  if (source.superseded) {
    throw new ResearchFundamentalError(409, "SOURCE_MATERIAL_SUPERSEDED", "superseded material cannot source a new structured fundamental value");
  }
  if (Date.parse(String(source.valid_until)) <= now.getTime())
    throw new ResearchFundamentalError(409,"SOURCE_MATERIAL_STALE","expired source material cannot support a new structured value");
  if (source.snapshot_pending_review) throw new ResearchFundamentalError(409, "SOURCE_VERSION_REVIEW_REQUIRED", "official article body changed after this material was confirmed");
  if(source.source_lead_id){
    const lead=(await client.query<{active_trusted_document_id:string|null;pending_review_document_id:string|null;review_state:string}>(`select l.active_trusted_document_id,l.pending_review_document_id,coalesce((select review_state from research_document_review_events where document_id=$2 order by event_sequence desc limit 1),d.review_state) review_state from research_source_leads l join research_documents d on d.id=$2 and d.source_lead_id=l.lead_id where l.lead_id=$1 for update of l`,[source.source_lead_id,source.document_id])).rows[0];
    if(!lead||String(lead.active_trusted_document_id)!==String(source.document_id)||lead.pending_review_document_id!==null||lead.review_state!=="TRUSTED")throw new ResearchFundamentalError(409,"DOCUMENT_REVIEW_REQUIRED","source-intake document must be active and trusted with no pending version before a structured fact can be written");
  }
  return { materialId: String(source.material_id), symbol: source.symbol };
}

export function rowToResearchFundamentalValue(
  row: ResearchFundamentalRow,
  now = new Date(),
  originalAvailability:SourceOriginalAvailability="unknown"
): ResearchFundamentalValueData {
  const validUntil = new Date(row.material_valid_until).toISOString();
  const freshness = Date.parse(validUntil) > now.getTime() ? "fresh" : "stale";
  const publishedInstant = row.material_published_at == null
    ? NaN : new Date(row.material_published_at).getTime();
  return {
    id: String(row.id),
    membershipId: String(row.candidate_membership_id),
    membershipVersionAtWrite: Number(row.captured_membership_version),
    symbol: row.symbol,
    metric: row.metric,
    periodKind: row.period_kind,
    periodStart: row.period_start === null ? null : calendarDate(row.period_start),
    periodEnd: calendarDate(row.period_end),
    currency: row.currency,
    unitScale: Number(row.unit_scale),
    scope: row.scope,
    valueStatus: row.value_status,
    value: row.reported_value === null ? null : canonicalDecimal(row.reported_value),
    comparability: row.comparability,
    comparabilityReason: row.comparability_reason,
    amendmentKind: row.amendment_kind,
    replacesValueId: row.replaces_value_id === null ? null : String(row.replaces_value_id),
    revision: Number(row.revision),
    valueState: row.lifecycle_status==="RETRACTED"?"retracted":row.lifecycle_status==="INVALID"?"invalid":row.value_replaced
      ? "replaced"
      : row.material_superseded || row.snapshot_pending_review
        ? "historical_source_superseded"
        : freshness === "stale"
          ? "historical_source_stale"
          : "current",
    ...(row.assertion_metadata ? { assertion: readableAssertion(row.assertion_metadata) } : {}),
    provenance: {
      factKind: "issuer_reported",
      transcription: "owner_manual",
      verificationStatus: row.verification_status ?? "unverified"
    },
    source: {
      materialId: String(row.source_material_id),
      materialRevision: Number(row.material_revision),
      materialRevisionState: row.material_superseded ? "superseded" : "current",
      validUntil,
      freshness,
      materialSourceVersion: row.material_source_version,
      ...(row.citation_snapshot_id != null ? {kind:"source_snapshot" as const,
        snapshotReviewState:row.snapshot_pending_review?"pending_review" as const:"current" as const,
        originalAvailability,snapshotCitation:{kind:"source_snapshot" as const,
        snapshotId:String(row.citation_snapshot_id),textSha256:String(row.citation_snapshot_text_sha256),
        startUtf16:Number(row.citation_start_utf16),endUtf16:Number(row.citation_end_utf16),
        excerptSha256:String(row.citation_excerpt_sha256)},snapshotOriginal:{rawSha256:String(row.snapshot_raw_sha256),
          byteLength:Number(row.snapshot_byte_length),mediaType:"text/html" as const,
          canonicalUrl:String(row.snapshot_canonical_url),responseUrl:String(row.snapshot_response_url)}}
        : {documentId: String(row.citation_document_id),
        documentPdfSha256: String(row.document_pdf_sha256),pageNumber: Number(row.citation_page_number),
        pageTextSha256: String(row.citation_page_text_sha256)}),
      ...(row.material_claim_type ? {sourceClassification: row.material_claim_type,
        verificationStatus: row.material_verification_status,
        ...(Number.isFinite(publishedInstant)
          ? { publishedAt: new Date(publishedInstant).toISOString() } : {})} : {})
    },
    createdAt: new Date(row.created_at).toISOString()
  };
}

function fundamentalSelect(asOf=false): string {
  return `select fv.id, fv.candidate_membership_id, fv.captured_membership_version, cm.symbol,
                 fv.metric, fv.period_kind,
                 to_char(fv.period_start, 'YYYY-MM-DD') as period_start,
                 to_char(fv.period_end, 'YYYY-MM-DD') as period_end,
                 fv.currency,
                 fv.unit_scale, fv.scope, fv.value_status, fv.reported_value::text,
                 fv.verification_status, fv.assertion_metadata, rm.claim_type as material_claim_type, rm.verification_status as material_verification_status, ei.published_at as material_published_at,
                 fv.comparability, fv.comparability_reason, fv.amendment_kind,
                 fv.replaces_value_id, fv.revision, fv.created_at, fv.source_material_id,
                 rm.revision as material_revision, rm.valid_until as material_valid_until,
                 rm.source_version as material_source_version,
                 rm.citation_document_id, rm.citation_page_number, rm.citation_page_text_sha256,
                 rm.citation_snapshot_id,rm.citation_snapshot_membership_version,rm.citation_snapshot_text_sha256,
                 rm.citation_start_utf16,rm.citation_end_utf16,rm.citation_excerpt_sha256,
                 s.raw_sha256 as snapshot_raw_sha256,s.byte_length as snapshot_byte_length,
                 s.media_type as snapshot_media_type,s.canonical_url as snapshot_canonical_url,
                 s.response_url as snapshot_response_url,
                 case when s.id is null then false else exists (
                   select 1 from research_source_snapshots newer
                    where newer.candidate_membership_id=s.candidate_membership_id and newer.canonical_url=s.canonical_url
                      and (newer.captured_at,newer.id)>(s.captured_at,s.id) and newer.text_sha256<>s.text_sha256
                      ${asOf ? "and newer.captured_at < $4::timestamptz + interval '1 millisecond'" : ""}
                 ) end as snapshot_pending_review,
                 rd.pdf_sha256 as document_pdf_sha256, lifecycle.status as lifecycle_status,
                 exists (
                   select 1 from research_fundamental_values child
                    where child.replaces_value_id = fv.id ${asOf ? "and child.created_at < $4::timestamptz + interval '1 millisecond'" : ""}
                 ) as value_replaced,
                 exists (
                   select 1 from research_materials material_child
                    where material_child.replaces_material_id = rm.id ${asOf ? "and material_child.created_at < $4::timestamptz + interval '1 millisecond'" : ""}
                 ) as material_superseded
            from research_fundamental_values fv
            left join lateral (select status from research_fundamental_assertion_lifecycle e where e.fundamental_value_id=fv.id ${asOf ? "and e.created_at < $4::timestamptz + interval '1 millisecond'" : ""} order by e.created_at desc,e.id desc limit 1) lifecycle on true
            join candidate_memberships cm on cm.id = fv.candidate_membership_id
            join research_materials rm on rm.id = fv.source_material_id
            join evidence_items ei on ei.id = rm.evidence_item_id
            left join research_documents rd on rd.id = rm.citation_document_id
            left join research_source_snapshots s on s.id=rm.citation_snapshot_id
              and s.candidate_membership_id=rm.candidate_membership_id
              and s.captured_membership_version=rm.citation_snapshot_membership_version
              and s.text_sha256=rm.citation_snapshot_text_sha256
            join lateral (select true as valid where
              (rm.citation_document_id is not null and rd.id is not null)
              or (rm.citation_snapshot_id is not null and s.id is not null)) original_source on true`;
}

function calendarDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function canonicalDecimal(value: string): string {
  const canonical = value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return canonical === "-0" ? "0" : canonical;
}

/** Older verification records did not prove a table region or an explicit per-field confirmation. */
function readableAssertion(assertion:NonNullable<ResearchFundamentalValueData["assertion"]>) {
  const result=structuredClone(assertion),v=result.verification;
  if(v&&!result.structureBinding?.structureExcerpt){
    v.structureVerification="unverified";
    v.checks={metric:false,period:false,currency:false,unitScale:false,scope:false};
    v.taxonomyConfirmedBy=null;
  }
  if(v?.structureVerification==="owner_confirmed"&&!v.ownerConfirmation)v.structureVerification="unverified";
  return result;
}
