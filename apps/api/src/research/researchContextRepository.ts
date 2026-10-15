import { assertOperatingModelReferences } from "./researchOperatingModelRepository.js";
import { Pool, type PoolClient } from "pg";
import { makeFactMetadata, type FactMetadata } from "../../../../packages/contracts/src/factMetadata.js";
import {
  RESEARCH_CONTEXT_SCHEMA_VERSION,
  RESEARCH_CONTEXT_SECTIONS,
  buildResearchContextComparisons,
  researchContextContentHash,
  type ResearchPeerSourceIssue,
  type ResearchPeerFactSourceIssue,
  type CreateResearchContextRequest,
  type ResearchContextChangeSummary,
  type ResearchContextEnvelope,
  type ResearchContextHistoryEntry,
  type ResearchContextInvalidationReason,
  type ResearchContextCitation,
  type ResearchContextSourceMembership,
  type ResearchPeerCitation,
  type ResearchContextSnapshotData,
  validateCreateResearchContextRequest,
  validateResearchContextSnapshotData
} from "../../../../packages/contracts/src/researchContext.js";
import { RESEARCH_WRITE_SCHEMA_VERSION, type ResearchWriteEnvelope } from "../../../../packages/contracts/src/research.js";
import { requestFingerprint, researchMaterialFingerprint } from "./deepResearchGate.js";
import { assertCandidateMembershipWriteBinding, preservesCurrentResearchContextItems } from "./researchWriteBinding.js";
import { IdempotencyConflictError, type AuthenticatedResearchActor } from "./domain.js";
import { readResearchMaterials } from "./deepResearchPersistence.js";
import { assertFrozenMaterialOriginals } from "./deepResearchMaterialOriginals.js";
import { canonicalJson } from "../../../../packages/contracts/src/decisionContextBrowser.js";
import { findDocumentById } from "./researchDocumentRepository.js";
import { readResearchDocumentBytes } from "./researchDocumentCas.js";

export class ResearchContextError extends Error {
  readonly statusCode: 400 | 404 | 409 | 422 | 503;
  readonly code: string;

  constructor(statusCode: ResearchContextError["statusCode"], code: string, message: string) {
    super(message);
    this.name = "ResearchContextError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface ResearchContextRow {
  id: string;
  candidate_membership_id: string;
  captured_membership_version: number | string;
  actor_type: "user" | "system";
  actor_id: string;
  selected_symbol: string;
  industry: string;
  as_of: Date | string;
  cutoff_at: Date | string;
  valid_until: Date | string;
  context_payload: unknown;
  created_at: Date | string;
  request_fingerprint: string;
}

interface ResearchContextReadRow extends ResearchContextRow {
  membership_symbol: string;
  membership_version: number | string;
  previous_context_id: string | null;
  revision: number | string;
  total_count: number | string;
}

const RESEARCH_CONTEXT_HISTORY_LIMIT = 20;

export async function createResearchContextSnapshot(
  pool: Pool | PoolClient,
  membershipId: string,
  request: CreateResearchContextRequest,
  actor: AuthenticatedResearchActor,
  now = new Date(),
  fingerprintOverride?: string,
  sourceStore?:import("./researchSourceSnapshotRepository.js").SourceSnapshotStoreOptions
): Promise<ResearchWriteEnvelope<ResearchContextSnapshotData>> {
  const validation = validateCreateResearchContextRequest(request);
  if (!validation.ok) throw new ResearchContextError(400, "INVALID_CONTEXT", validation.errors.join("; "));
  const contextSources = [
    request,
    ...request.selectedFacts,
    ...request.peerFacts,
    ...request.peers,
    ...request.operatingKpis,
    ...request.macroDrivers,
    ...request.industryDrivers
  ];
  if (contextSources.some((source) => [source.asOf, source.cutoffAt, source.provenance.capturedAt]
    .some((instant) => Date.parse(instant) > now.getTime()))) {
    throw new ResearchContextError(409, "FUTURE_CONTEXT", "future research context cannot become current");
  }
  if (Date.parse(request.validUntil) <= now.getTime()
    || [...request.selectedFacts, ...request.peerFacts, ...request.peers, ...request.operatingKpis, ...request.macroDrivers, ...request.industryDrivers]
      .some((fact) => Date.parse(fact.validUntil) <= now.getTime())) {
    throw new ResearchContextError(409, "STALE_CONTEXT", "stale research context cannot become current");
  }
  const fingerprint = fingerprintOverride ?? requestFingerprint("research_context_create", { actor, membershipId, request });
  const ownsTransaction = pool instanceof Pool;
  const client: PoolClient = ownsTransaction ? await pool.connect() : pool as PoolClient;
  try {
    if (ownsTransaction) await client.query("begin");
    const membership = await assertCandidateMembershipWriteBinding(client, actor, {
      membershipId,
      membershipVersion: request.membershipVersion
    });
    if (membership.symbol !== request.selectedSymbol) {
      throw new ResearchContextError(409, "SYMBOL_CONFLICT", "context selectedSymbol does not match the candidate membership");
    }
    const existing = await findByIdempotency(client, actor, request.idempotencyKey);
    if (existing) {
      if (existing.request_fingerprint !== fingerprint) throw idempotencyConflict();
      if (ownsTransaction) await client.query("commit");
      return writeEnvelope(rowToResearchContextSnapshot(existing, now), actor, "Research context write replayed.");
    }
    const latest = await findLatest(client, membershipId, actor);
    if ((latest?.id ?? null) !== request.baseContextId) {
      throw new ResearchContextError(409, "CONTEXT_VERSION_CONFLICT", "research context base no longer matches the current snapshot");
    }
    if (latest && Date.parse(request.cutoffAt) < new Date(latest.cutoff_at).getTime()) {
      throw new ResearchContextError(409, "CONTEXT_CUTOFF_REGRESSION", "research context cutoff cannot move backwards");
    }
    const latestData = latest && rowToResearchContextSnapshot(latest, now);
    if (latestData && contextInvalidations(latest, latestData, membership.symbol, Number(membership.version), now).length === 0 && !preservesCurrentResearchContextItems(latestData, request)) throw new ResearchContextError(409, "CONTEXT_ITEM_OMISSION", "a current research context update must preserve unaffected facts and drivers");
    const currentBase = latestData && latest
      && request.baseContextId === String(latest.id)
      && contextInvalidations(latest, latestData, membership.symbol, Number(membership.version), now).length === 0
      ? latestData : null;
    await assertResearchContextCitations(client, membershipId, request, actor, now, sourceStore, currentBase);
    if (request.operatingModel) await assertOperatingModelReferences(client, membershipId, request, actor, now, sourceStore);
    const payload = {
      ...((request.operatingModel ?? latestData?.operatingModel) ? { operatingModel: request.operatingModel ?? latestData?.operatingModel } : {}),
      selectedSymbol: request.selectedSymbol,
      industry: request.industry,
      selectedFacts: request.selectedFacts,
      peerFacts: request.peerFacts,
      peers: request.peers,
      operatingKpis: request.operatingKpis,
      macroDrivers: request.macroDrivers,
      industryDrivers: request.industryDrivers,
      unknowns: request.unknowns,
      provenance: request.provenance,
      asOf: request.asOf,
      cutoffAt: request.cutoffAt,
      validUntil: request.validUntil
    };
    const inserted = await client.query<{ id: string; created_at: Date | string }>(
      `insert into research_context_snapshots
        (candidate_membership_id, captured_membership_version, actor_type, actor_id,
         selected_symbol, industry, as_of, cutoff_at, valid_until, context_payload,
         idempotency_key, request_fingerprint, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
       returning id, created_at`,
      [
        membershipId,
        request.membershipVersion,
        actor.actorType,
        actor.actorId,
        request.selectedSymbol,
        request.industry,
        request.asOf,
        request.cutoffAt,
        request.validUntil,
        JSON.stringify(payload),
        request.idempotencyKey,
        fingerprint,
        now
      ]
    );
    const row = await findById(client, String(inserted.rows[0]?.id), actor);
    if (!row) throw new ResearchContextError(503, "CONTEXT_READ_BACK_FAILED", "created research context could not be read back");
    if (ownsTransaction) await client.query("commit");
    return writeEnvelope(
      rowToResearchContextSnapshot(row, now),
      actor,
      `Research context for ${request.selectedSymbol} ${latest ? "updated" : "created"}.`
    );
  } catch (error) {
    if (ownsTransaction) await client.query("rollback");
    if (ownsTransaction && isUniqueViolation(error)) {
      const replay = await findByIdempotency(pool, actor, request.idempotencyKey);
      if (replay?.request_fingerprint === fingerprint) return writeEnvelope(rowToResearchContextSnapshot(replay, now), actor, "Research context write replayed.");
      throw idempotencyConflict();
    }
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
}

export async function readResearchContextSnapshot(
  pool: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  actor: AuthenticatedResearchActor,
  now = new Date(),
  sourceStore?: import("./researchSourceSnapshotRepository.js").SourceSnapshotStoreOptions
): Promise<ResearchContextEnvelope> {
  const generatedAt = now.toISOString();
  const result = await pool.query<ResearchContextReadRow>(
    `select cm.symbol as membership_symbol, cm.version as membership_version,
            context.id, context.candidate_membership_id, context.captured_membership_version,
            context.actor_type, context.actor_id, context.selected_symbol, context.industry,
            context.as_of, context.cutoff_at, context.valid_until, context.context_payload,
            context.created_at, context.request_fingerprint, context.previous_context_id,
            context.revision, context.total_count
       from candidate_memberships cm
       left join lateral (
         select *
           from (
             select id, candidate_membership_id, captured_membership_version, actor_type, actor_id,
                    selected_symbol, industry, as_of, cutoff_at, valid_until, context_payload,
                    created_at, request_fingerprint,
                    lag(id) over (order by cutoff_at, id) as previous_context_id,
                    row_number() over (order by cutoff_at, id) as revision,
                    count(*) over () as total_count
               from research_context_snapshots
              where candidate_membership_id = cm.id
                and actor_type = cm.actor_type and actor_id = cm.actor_id
           ) ranked
          order by cutoff_at desc, id desc
          limit ${RESEARCH_CONTEXT_HISTORY_LIMIT}
       ) context on true
      where cm.id = $1 and cm.actor_type = $2 and cm.actor_id = $3
      order by context.cutoff_at desc nulls last, context.id desc nulls last`,
    [membershipId, actor.actorType, actor.actorId]
  );
  const row = result.rows[0];
  if (!row) return unavailableResearchContext(generatedAt, membershipId, actor.actorId, "not_found", "candidate membership was not found", null);
  const membership = { symbol: row.membership_symbol, version: Number(row.membership_version) };
  if (!row.id) return unavailableResearchContext(generatedAt, membershipId, actor.actorId, "not_found", "research context is missing", membership.symbol);
  let data: ResearchContextSnapshotData;
  try {
    data = rowToResearchContextSnapshot(row, now);
  } catch {
    return unavailableResearchContext(generatedAt, membershipId, actor.actorId, "unavailable", "stored research context payload is malformed", membership.symbol);
  }
  let invalidatedBy: ResearchContextInvalidationReason[];
  try {
    invalidatedBy = contextInvalidations(row, data, membership.symbol, Number(membership.version), now);
  } catch {
    return unavailableResearchContext(generatedAt, membershipId, actor.actorId, "unavailable", "stored research context payload is malformed", membership.symbol);
  }
  const current = { ...data, currentness: { status: invalidatedBy.length === 0 ? "current" as const : "historical" as const, invalidatedBy } };
  const validation = validateResearchContextSnapshotData(current);
  if (!validation.ok) return unavailableResearchContext(generatedAt, membershipId, actor.actorId, "unavailable", validation.errors.join("; "), membership.symbol);
  let snapshots: { row: ResearchContextReadRow; data: ResearchContextSnapshotData }[];
  try {
    snapshots = result.rows.filter((candidate) => candidate.id).map((candidate) => ({
      row: candidate,
      data: rowToResearchContextSnapshot(candidate, now)
    }));
  } catch {
    return unavailableResearchContext(generatedAt, membershipId, actor.actorId, "unavailable", "stored research context history is malformed", membership.symbol);
  }
  const history = snapshots.map(({ row: candidate, data: snapshot }) => contextHistoryEntry(candidate, snapshot));
  const historyHasMore = Number(row.total_count) > history.length;
  if (invalidatedBy.length > 0) return unavailableResearchContext(
    generatedAt,
    membershipId,
    actor.actorId,
    "unavailable",
    `research context is not current: ${invalidatedBy.join(", ")}`,
    membership.symbol,
    history,
    historyHasMore
  );
  const changeSummary = summarizeResearchContextChange(snapshots[1]?.data ?? null, current);
  const peerSourceIssues = await readPeerSourceIssues(pool, membershipId, membership.version,
    current.peers, now, actor, sourceStore);
  const peerFactSourceIssues = await readPeerFactSourceIssues(pool, membershipId, membership.version,
    current.peerFacts, now, actor, sourceStore);
  return {
    schemaVersion: RESEARCH_CONTEXT_SCHEMA_VERSION,
    generatedAt,
    status: "available",
    membershipId,
    requestedActorId: actor.actorId,
    requestedSymbol: membership.symbol,
    metadata: contextMetadata(generatedAt, "fresh", "Research context is source-bound, research-only context without recommendations or actions."),
    data: current,
    peerSourceIssues,
    peerFactSourceIssues,
    contentHash: researchContextContentHash(current),
    history,
    historyHasMore,
    changeSummary,
    message: peerSourceIssues.length || peerFactSourceIssues.length
      ? `Industry and peer context for ${membership.symbol}; ${peerSourceIssues.length} peer reason and ${peerFactSourceIssues.length} peer fact source(s) need repair.`
      : `Industry and peer context for ${membership.symbol}.`
  };
}

export const readResearchContext = readResearchContextSnapshot;

/** Recheck exact saved sources before a selected context item becomes cloud input. */
export async function assertSelectedResearchContextPages(
  pool: Pick<Pool | PoolClient, "query">, membershipId: string, membershipVersion: number,
  items: Array<ResearchContextSnapshotData["selectedFacts"][number] | ResearchContextSnapshotData["peers"][number]>,
  actor?: AuthenticatedResearchActor,
  sourceStore?: import("./researchSourceSnapshotRepository.js").SourceSnapshotStoreOptions
): Promise<void> {
  if (items.length === 0) return;
  const citations = items.map(item => item.citation).filter(isPdfPeerCitation);
  const materialCitations = items.map(item => item.citation).filter(isSavedMaterialPeerCitation);
  await assertPeerMaterialCitations(pool,membershipId,membershipVersion,materialCitations,new Date(),actor,sourceStore);
  await assertPdfCitations(pool,membershipId,membershipVersion,citations,actor,"SELECTED_CONTEXT_SOURCE_CHANGED",sourceStore);
}

async function assertPdfCitations(client: Pick<Pool | PoolClient, "query">, membershipId: string,
  membershipVersion: number, citations: ResearchContextCitation[], actor: AuthenticatedResearchActor | undefined,
  code: string, sourceStore?:import("./researchSourceSnapshotRepository.js").SourceSnapshotStoreOptions): Promise<void> {
  if (citations.length === 0) return;
  const groups = new Map<string, { source: ResearchContextSourceMembership | undefined; citations: ResearchContextCitation[] }>();
  for (const citation of citations) {
    const key = citation.sourceMembership?.membershipId ?? membershipId;
    const group = groups.get(key) ?? { source: citation.sourceMembership, citations: [] };
    if (canonicalJson(group.source ?? null) !== canonicalJson(citation.sourceMembership ?? null))
      throw new ResearchContextError(409,code,"conflicting source membership identities");
    group.citations.push(citation);
    groups.set(key,group);
  }
  for (const group of groups.values()) {
    const source = await resolveSourceMembership(client,membershipId,membershipVersion,group.source,actor,code);
    const unique = [...new Map(group.citations.map(citation => [
      `${citation.documentId}:${citation.pageNumber}:${citation.pageTextSha256}:${citation.sourceVersion}`,citation
    ])).values()];
    if (code === "CITATION_CONFLICT" && group.source === undefined) {
      const legacy = await client.query<{ requested_count: number | string; matched_count: number | string }>(
        `with requested(document_id, page_number, page_text_sha256) as (
           select * from unnest($1::bigint[], $2::integer[], $3::text[])
         )
         select count(*)::int as requested_count,
                count(*) filter (where page.document_id is not null
                  and document.candidate_membership_id = $4::bigint
                  and document.captured_membership_version = $5::integer
                  and document.source_classification = 'owner_declared_official'
                  and document.rights_status = 'user_provided')::int as matched_count
           from requested
           left join research_document_pages page on page.document_id = requested.document_id
             and page.page_number = requested.page_number
             and page.text_sha256 = requested.page_text_sha256
           left join research_documents document on document.id = page.document_id`,
        [unique.map(item => item.documentId),unique.map(item => item.pageNumber),
          unique.map(item => item.pageTextSha256),source.membershipId,source.membershipVersion]);
      if (Number(legacy.rows[0]?.matched_count) !== unique.length
        || Number(legacy.rows[0]?.requested_count) !== unique.length)
        throw new ResearchContextError(409,code,"research context citations are missing or bound to another membership");
      continue;
    }
    const result = await client.query<{ matched_count: number | string }>(
      `with requested(document_id, page_number, page_text_sha256, source_version) as (
         select * from unnest($1::bigint[], $2::integer[], $3::text[], $4::text[])
       )
       select count(*) filter (where page.document_id is not null
         and document.candidate_membership_id = $5::bigint
         and document.captured_membership_version = $6::integer
         and document.source_classification = 'owner_declared_official'
         and document.rights_status = 'user_provided'
         and document.source_version = requested.source_version)::int as matched_count
         from requested
         left join research_document_pages page on page.document_id = requested.document_id
           and page.page_number = requested.page_number
           and page.text_sha256 = requested.page_text_sha256
         left join research_documents document on document.id = page.document_id`,
      [unique.map(item => item.documentId), unique.map(item => item.pageNumber),
        unique.map(item => item.pageTextSha256), unique.map(item => item.sourceVersion),
        source.membershipId, source.membershipVersion]
    );
    if (Number(result.rows[0]?.matched_count) !== unique.length)
      throw new ResearchContextError(409, code, "selected research context PDF page, version or rights changed for its source membership");
    if (group.source) {
      if (!actor || !sourceStore)
        throw new ResearchContextError(409,"PEER_SOURCE_UNAVAILABLE","peer PDF original store is unavailable");
      for (const citation of unique) {
        const document = await findDocumentById(client,source.membershipId,citation.documentId,actor);
        if (!document || document.source_version !== citation.sourceVersion)
          throw new ResearchContextError(409,code,"peer PDF original identity changed");
        try {
          await readResearchDocumentBytes(sourceStore.rawStoreRoot,sourceStore.repositoryRoot,
            document.pdf_sha256,Number(document.byte_length));
        } catch {
          throw new ResearchContextError(409,"PEER_SOURCE_UNAVAILABLE","peer PDF original could not be reopened");
        }
      }
    }
  }
}

async function resolveSourceMembership(client: Pick<Pool | PoolClient,"query">,
  rootMembershipId: string, rootVersion: number, source: ResearchContextSourceMembership | undefined,
  actor: AuthenticatedResearchActor | undefined, code: string): Promise<ResearchContextSourceMembership> {
  if (!source) return {membershipId:rootMembershipId,membershipVersion:rootVersion,symbol:""};
  if (!actor) throw new ResearchContextError(409,code,"peer source actor is unavailable");
  const found = (await client.query<{id:string}>(
    `select id::text from candidate_memberships where id=$1 and version=$2 and symbol=$3
       and actor_type=$4 and actor_id=$5 and state='tracked' limit 1`,
    [source.membershipId,source.membershipVersion,source.symbol,actor.actorType,actor.actorId])).rows[0];
  if (!found) throw new ResearchContextError(409,code,"peer source membership changed or is not owned by the current actor");
  return source;
}
export const persistResearchContext = createResearchContextSnapshot;

export function rowToResearchContextSnapshot(row: ResearchContextRow, now = new Date()): ResearchContextSnapshotData {
  const payload = row.context_payload as Omit<CreateResearchContextRequest, "membershipVersion" | "idempotencyKey">;
  return {
    id: String(row.id),
    membershipId: String(row.candidate_membership_id),
    membershipVersion: Number(row.captured_membership_version),
    ...(payload.operatingModel ? { operatingModel: payload.operatingModel } : {}),
    selectedSymbol: payload.selectedSymbol,
    industry: payload.industry,
    selectedFacts: payload.selectedFacts,
    peerFacts: payload.peerFacts,
    peers: payload.peers ?? [],
    operatingKpis: payload.operatingKpis ?? [],
    macroDrivers: payload.macroDrivers,
    industryDrivers: payload.industryDrivers,
    unknowns: payload.unknowns,
    provenance: payload.provenance,
    asOf: payload.asOf,
    cutoffAt: payload.cutoffAt,
    validUntil: payload.validUntil,
    comparisons: buildResearchContextComparisons(payload.selectedFacts, payload.peerFacts),
    createdAt: new Date(row.created_at).toISOString(),
    currentness: { status: "current", invalidatedBy: [] },
    safety: {
      recommendation: false,
      ranking: false,
      automaticSignal: false,
      createsOrder: false,
      callsBroker: false,
      mutatesOfficialPortfolio: false
    }
  };
}

type SavedPeerCitation = Extract<ResearchPeerCitation,{kind:"saved_material"}>;
async function readPeerSourceIssues(client:Pick<Pool|PoolClient,"query">,membershipId:string,
  membershipVersion:number,peers:ResearchContextSnapshotData["peers"],now:Date,
  actor:AuthenticatedResearchActor,
  sourceStore?:import("./researchSourceSnapshotRepository.js").SourceSnapshotStoreOptions
):Promise<ResearchPeerSourceIssue[]>{
  const issues:ResearchPeerSourceIssue[]=[];
  for(const peer of peers){
    if(!isSavedMaterialPeerCitation(peer.citation) && !peer.citation.sourceMembership)continue;
    try{
      if(isSavedMaterialPeerCitation(peer.citation))
        await assertPeerMaterialCitations(client,membershipId,membershipVersion,
          [peer.citation],now,actor,sourceStore);
      else await assertPdfCitations(client,membershipId,membershipVersion,[peer.citation],actor,
        "PEER_SOURCE_CHANGED",sourceStore);
    }
    catch(error){
      if(!(error instanceof ResearchContextError)
        || !["PEER_SOURCE_CHANGED","PEER_SOURCE_UNAVAILABLE"].includes(error.code))throw error;
      const changed=error.code==="PEER_SOURCE_CHANGED";
      issues.push({peerId:peer.id,symbol:peer.symbol,status:changed?"stale":"unavailable",
        reason:changed?"material_changed":"original_unavailable"});
    }
  }
  return issues;
}

async function readPeerFactSourceIssues(client:Pick<Pool|PoolClient,"query">,membershipId:string,
  membershipVersion:number,facts:ResearchContextSnapshotData["peerFacts"],now:Date,
  actor:AuthenticatedResearchActor,
  sourceStore?:import("./researchSourceSnapshotRepository.js").SourceSnapshotStoreOptions
):Promise<ResearchPeerFactSourceIssue[]>{
  const issues:ResearchPeerFactSourceIssue[]=[];
  for(const fact of facts){
    if(!isSavedMaterialPeerCitation(fact.citation)&&!fact.citation.sourceMembership)continue;
    try{
      if(isSavedMaterialPeerCitation(fact.citation))
        await assertPeerMaterialCitations(client,membershipId,membershipVersion,
          [fact.citation],now,actor,sourceStore);
      else await assertPdfCitations(client,membershipId,membershipVersion,
        [fact.citation],actor,"PEER_SOURCE_CHANGED",sourceStore);
    }catch(error){
      if(!(error instanceof ResearchContextError)
        ||!["PEER_SOURCE_CHANGED","PEER_SOURCE_UNAVAILABLE"].includes(error.code))throw error;
      const changed=error.code==="PEER_SOURCE_CHANGED";
      issues.push({factId:fact.id,symbol:fact.symbol,status:changed?"stale":"unavailable",
        reason:changed?"material_changed":"original_unavailable"});
    }
  }
  return issues;
}
function isSavedMaterialPeerCitation(value:ResearchPeerCitation):value is SavedPeerCitation{
  return "kind" in value && value.kind === "saved_material";
}
function isPdfPeerCitation(value:ResearchPeerCitation):value is ResearchContextCitation{
  return !isSavedMaterialPeerCitation(value);
}

async function assertPeerMaterialCitations(client:Pick<Pool|PoolClient,"query">,membershipId:string,
  membershipVersion:number,citations:SavedPeerCitation[],now:Date,actor?:AuthenticatedResearchActor,
  sourceStore?:import("./researchSourceSnapshotRepository.js").SourceSnapshotStoreOptions):Promise<void>{
  if(citations.length===0)return;
  for(const citation of citations){
    const sourceMember=await resolveSourceMembership(client,membershipId,membershipVersion,
      citation.sourceMembership,actor,"PEER_SOURCE_CHANGED");
    const profile=(await client.query<{id:string}>(
      `select research_profile_id::text as id from research_materials
        where candidate_membership_id=$1 and id=$2 limit 1`,
      [sourceMember.membershipId,citation.materialId])).rows[0];
    if(!profile)throw new ResearchContextError(409,"PEER_SOURCE_CHANGED","saved peer material is missing");
    const materials=await readResearchMaterials(client,profile.id,sourceMember.membershipId,now);
    const item=materials.find(candidate=>candidate.id===citation.materialId);
    if(!item||(citation.sourceMembership&&item.symbol!==sourceMember.symbol)
      ||item.revision!==citation.materialRevision||item.contentFingerprint!==citation.contentFingerprint
      ||item.sourceVersion!==citation.sourceVersion||item.sourceType!==citation.sourceType
      ||item.sourceUrl!==citation.sourceUrl||item.revisionState!=="current"||item.freshness!=="fresh"
      ||Date.parse(item.validUntil)<=now.getTime()
      ||item.contentFingerprint!==researchMaterialFingerprint(item.contentText))
      throw new ResearchContextError(409,"PEER_SOURCE_CHANGED","saved peer material identity or currentness changed");
    if(citation.sourceType==="issuer_public_html"){
      const found=item.snapshotCitation,original=item.snapshotOriginal,expected=citation.snapshotCitation;
      if(!found||!original||!expected||found.kind!==expected.kind||found.snapshotId!==expected.snapshotId
        ||found.textSha256!==expected.textSha256||found.startUtf16!==expected.startUtf16
        ||found.endUtf16!==expected.endUtf16||found.excerptSha256!==expected.excerptSha256
        ||original.rawSha256!==citation.snapshotRawSha256||original.responseUrl!==citation.sourceUrl
        ||item.rightsStatus!=="authorized_public"||item.publishedAt===null)
        throw new ResearchContextError(409,"PEER_SOURCE_CHANGED","saved HTML peer locator changed");
      const snapshot=(await client.query<{captured_membership_version:number}>(`
        select captured_membership_version from research_source_snapshots
         where id=$1 and candidate_membership_id=$2 and text_sha256=$3 limit 1`,
        [expected.snapshotId,sourceMember.membershipId,expected.textSha256])).rows[0];
      if(!snapshot||snapshot.captured_membership_version>sourceMember.membershipVersion)
        throw new ResearchContextError(409,"PEER_SOURCE_CHANGED","saved HTML peer membership version changed");
    }else{
      const source=item.futuFinancialSource,expected=citation.providerOriginal;
      if(!source||!expected||source.captureId!==expected.captureId
        ||source.membershipId!==sourceMember.membershipId
        ||source.membershipVersion!==sourceMember.membershipVersion
        ||!source.pages.some(page=>page.pageId===expected.pageId&&page.rawSha256===expected.rawSha256
          &&page.reportSha256===expected.reportSha256)
        ||item.claimType!=="third_party_statement"||item.verificationStatus!=="unverified"
        ||item.rightsStatus!=="user_provided"||item.publishedAt!==null)
        throw new ResearchContextError(409,"PEER_SOURCE_CHANGED","saved provider peer locator changed");
    }
    if(actor){
      if(!sourceStore)throw new ResearchContextError(409,"PEER_SOURCE_UNAVAILABLE","saved peer original store is unavailable");
      try{await assertFrozenMaterialOriginals(client,sourceMember.membershipId,actor,[item],sourceStore);}
      catch{throw new ResearchContextError(409,"PEER_SOURCE_UNAVAILABLE","saved peer original could not be reopened");}
    }
  }
}

async function assertResearchContextCitations(
  client: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  request: CreateResearchContextRequest,
  actor: AuthenticatedResearchActor,
  now: Date,
  sourceStore?:import("./researchSourceSnapshotRepository.js").SourceSnapshotStoreOptions,
  currentBase?:ResearchContextSnapshotData|null
): Promise<void> {
  const changedPeerFacts = request.peerFacts.filter(fact => !currentBase?.peerFacts.some(saved =>
    canonicalJson(saved)===canonicalJson(fact)));
  const changedPeers = request.peers.filter(peer => !currentBase?.peers.some(saved =>
    canonicalJson(saved)===canonicalJson(peer)));
  const citations = [
    ...request.selectedFacts,
    ...changedPeerFacts,
    ...changedPeers,
    ...request.operatingKpis,
    ...request.macroDrivers,
    ...request.industryDrivers
  ].map((item) => item.citation).filter(isPdfPeerCitation);
  const materialCitations = [...changedPeers,...changedPeerFacts]
    .map(item => item.citation).filter(isSavedMaterialPeerCitation);
  await assertPeerMaterialCitations(client,membershipId,request.membershipVersion,materialCitations,now,actor,sourceStore);
  await assertPdfCitations(client,membershipId,request.membershipVersion,citations,actor,
    "CITATION_CONFLICT",sourceStore);
}

async function findById(client: Pick<Pool | PoolClient, "query">, id: string, actor: AuthenticatedResearchActor): Promise<ResearchContextRow | null> {
  const result = await client.query<ResearchContextRow>(
    `select id, candidate_membership_id, captured_membership_version, actor_type, actor_id,
            selected_symbol, industry, as_of, cutoff_at, valid_until, context_payload,
            created_at, request_fingerprint
       from research_context_snapshots
      where id = $1 and actor_type = $2 and actor_id = $3
      limit 1`,
    [id, actor.actorType, actor.actorId]
  );
  return result.rows[0] ?? null;
}

export async function findByIdempotency(client: Pick<Pool | PoolClient, "query">, actor: AuthenticatedResearchActor, key: string): Promise<ResearchContextRow | null> {
  const result = await client.query<ResearchContextRow>(
    `select id, candidate_membership_id, captured_membership_version, actor_type, actor_id,
            selected_symbol, industry, as_of, cutoff_at, valid_until, context_payload,
            created_at, request_fingerprint
       from research_context_snapshots
      where actor_type = $1 and actor_id = $2 and idempotency_key = $3
      limit 1`,
    [actor.actorType, actor.actorId, key]
  );
  return result.rows[0] ?? null;
}

async function findLatest(
  client: Pick<Pool | PoolClient, "query">,
  membershipId: string,
  actor: AuthenticatedResearchActor
): Promise<ResearchContextRow | null> {
  const result = await client.query<ResearchContextRow>(
    `select id, candidate_membership_id, captured_membership_version, actor_type, actor_id,
            selected_symbol, industry, as_of, cutoff_at, valid_until, context_payload,
            created_at, request_fingerprint
       from research_context_snapshots
      where candidate_membership_id = $1 and actor_type = $2 and actor_id = $3
      order by cutoff_at desc, id desc
      limit 1`,
    [membershipId, actor.actorType, actor.actorId]
  );
  return result.rows[0] ?? null;
}

function contextInvalidations(row: ResearchContextRow, data: ResearchContextSnapshotData, membershipSymbol: string, membershipVersion: number, now: Date): ResearchContextInvalidationReason[] {
  const reasons = new Set<ResearchContextInvalidationReason>();
  if (row.selected_symbol !== membershipSymbol || data.selectedSymbol !== membershipSymbol) reasons.add("symbol_mismatch");
  if (Number(row.captured_membership_version) !== membershipVersion) reasons.add("membership_version_mismatch");
  if (!sameInstant(row.as_of, data.asOf) || !sameInstant(row.cutoff_at, data.cutoffAt) || !sameInstant(row.valid_until, data.validUntil)
    || data.selectedFacts.some((fact) => fact.selectedSymbol !== membershipSymbol || Date.parse(fact.cutoffAt) > Date.parse(data.cutoffAt))
    || data.peerFacts.some((fact) => fact.selectedSymbol !== membershipSymbol || Date.parse(fact.cutoffAt) > Date.parse(data.cutoffAt))
    || data.peers.some((peer) => peer.selectedSymbol !== membershipSymbol || Date.parse(peer.cutoffAt) > Date.parse(data.cutoffAt))
    || data.operatingKpis.some((kpi) => kpi.selectedSymbol !== membershipSymbol || Date.parse(kpi.cutoffAt) > Date.parse(data.cutoffAt))
    || data.macroDrivers.some((driver) => driver.selectedSymbol !== membershipSymbol || Date.parse(driver.cutoffAt) > Date.parse(data.cutoffAt))
    || data.industryDrivers.some((driver) => driver.selectedSymbol !== membershipSymbol || Date.parse(driver.cutoffAt) > Date.parse(data.cutoffAt))) reasons.add("cutoff_or_symbol_mismatch");
  if (Date.parse(String(row.valid_until)) <= now.getTime() || Date.parse(data.validUntil) <= now.getTime()
    || [...data.selectedFacts, ...data.peerFacts, ...data.peers, ...data.operatingKpis, ...data.macroDrivers, ...data.industryDrivers].some((fact) => Date.parse(fact.validUntil) <= now.getTime())) reasons.add("stale");
  return [...reasons];
}

function unavailableResearchContext(
  generatedAt: string,
  membershipId: string,
  actorId: string,
  status: "not_found" | "unavailable",
  message: string,
  symbol: string | null,
  history: ResearchContextHistoryEntry[] = [],
  historyHasMore = false
): ResearchContextEnvelope {
  return {
    schemaVersion: RESEARCH_CONTEXT_SCHEMA_VERSION,
    generatedAt,
    status,
    membershipId,
    requestedActorId: actorId,
    requestedSymbol: symbol,
    metadata: contextMetadata(generatedAt, status === "not_found" ? "missing" : "unavailable", message),
    data: null,
    history,
    historyHasMore,
    changeSummary: null,
    message
  };
}

function contextHistoryEntry(row: ResearchContextReadRow, data: ResearchContextSnapshotData): ResearchContextHistoryEntry {
  return {
    id: data.id,
    previousContextId: row.previous_context_id === null ? null : String(row.previous_context_id),
    revision: Number(row.revision),
    industry: data.industry,
    cutoffAt: data.cutoffAt,
    validUntil: data.validUntil,
    createdAt: data.createdAt,
    itemCounts: {
      selectedFacts: data.selectedFacts.length,
      peerFacts: data.peerFacts.length,
      peers: data.peers.length,
      operatingKpis: data.operatingKpis.length,
      macroDrivers: data.macroDrivers.length,
      industryDrivers: data.industryDrivers.length,
      unknowns: data.unknowns.length
    }
  };
}

function summarizeResearchContextChange(
  previous: ResearchContextSnapshotData | null,
  current: ResearchContextSnapshotData
): ResearchContextChangeSummary {
  if (!previous) return {
    previousContextId: null,
    currentContextId: current.id,
    changedSections: [],
    unchangedSections: []
  };
  const values = {
    industry: [previous.industry, current.industry],
    selected_facts: [previous.selectedFacts, current.selectedFacts],
    peer_facts: [previous.peerFacts, current.peerFacts],
    peers: [previous.peers, current.peers],
    operating_kpis: [[previous.operatingKpis, previous.operatingModel ?? null], [current.operatingKpis, current.operatingModel ?? null]],
    macro_drivers: [previous.macroDrivers, current.macroDrivers],
    industry_drivers: [previous.industryDrivers, current.industryDrivers],
    unknowns: [previous.unknowns, current.unknowns],
    timeline: [
      { asOf: previous.asOf, cutoffAt: previous.cutoffAt, validUntil: previous.validUntil },
      { asOf: current.asOf, cutoffAt: current.cutoffAt, validUntil: current.validUntil }
    ],
    provenance: [previous.provenance, current.provenance]
  } as const;
  const changedSections = RESEARCH_CONTEXT_SECTIONS.filter((section) =>
    semanticResearchContextJson(values[section][0]) !== semanticResearchContextJson(values[section][1])
  );
  return {
    previousContextId: previous.id,
    currentContextId: current.id,
    changedSections,
    unchangedSections: RESEARCH_CONTEXT_SECTIONS.filter((section) => !changedSections.includes(section))
  };
}

function semanticResearchContextJson(value: unknown): string {
  return JSON.stringify(semanticResearchContextValue(value));
}

function semanticResearchContextValue(value: unknown, key = ""): unknown {
  if (typeof value === "string" && ["asOf", "cutoffAt", "validUntil", "createdAt", "capturedAt"].includes(key)) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : value;
  }
  if (Array.isArray(value)) {
    const normalized = value.map((item) => semanticResearchContextValue(item));
    return normalized.sort((left, right) => semanticSortKey(left).localeCompare(semanticSortKey(right)));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((childKey) => [
    childKey,
    semanticResearchContextValue((value as Record<string, unknown>)[childKey], childKey)
  ]));
}

function semanticSortKey(value: unknown): string {
  return value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).id === "string"
    ? `id:${String((value as Record<string, unknown>).id)}`
    : JSON.stringify(value);
}

function contextMetadata(asOf: string, freshness: FactMetadata["freshness"], message: string): FactMetadata {
  return makeFactMetadata({
    source: "research_context_snapshots",
    asOf,
    fetchedAt: asOf,
    freshness,
    provenance: freshness === "unavailable" ? "unavailable" : "research_only",
    authority: freshness === "unavailable" ? "unavailable" : "research_evidence",
    stale: freshness === "stale",
    missing: freshness === "missing",
    conflict: false,
    fixture: false,
    correctionOf: null,
    replaces: null,
    message
  });
}

export function writeEnvelope(data: ResearchContextSnapshotData, actor: AuthenticatedResearchActor, message: string): ResearchWriteEnvelope<ResearchContextSnapshotData> {
  return {
    schemaVersion: RESEARCH_WRITE_SCHEMA_VERSION,
    status: "succeeded",
    asOf: data.createdAt,
    source: { actorType: actor.actorType, actorId: actor.actorId, correlationId: null },
    data,
    message
  };
}

function sameInstant(value: Date | string, expected: string): boolean {
  return Number.isFinite(new Date(value).getTime()) && new Date(value).getTime() === Date.parse(expected);
}

function idempotencyConflict(): IdempotencyConflictError {
  return new IdempotencyConflictError("idempotency key already exists with different research context semantics");
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}
