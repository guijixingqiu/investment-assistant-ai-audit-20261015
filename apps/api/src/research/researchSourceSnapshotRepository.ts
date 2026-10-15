import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { CaptureResearchSourceSnapshotRequest, ResearchSourceSnapshotData, ResearchSourceSnapshotListItem } from "../../../../packages/contracts/src/researchSourceSnapshot.js";
import { RESEARCH_SOURCE_SNAPSHOT_OFFSET_UNIT } from "../../../../packages/contracts/src/researchSourceSnapshot.js";
import type { ResearchSnapshotTextCitation } from "../../../../packages/contracts/src/researchSourceCitation.js";
import { readCandidateMembershipById } from "./candidateMembershipPersistence.js";
import { CandidateMembershipNotFoundError, CandidateMembershipVersionConflictError, ResearchDocumentError,
  type AuthenticatedResearchActor } from "./domain.js";
import { storeResearchRawBytes, readResearchRawBytes } from "./researchDocumentCas.js";
import { fetchOfficialHtmlSnapshot } from "./researchSourceSnapshot.js";
import { extractGeelyOfficialHtml } from "./researchSourceSnapshotHtml.js";
import { assertCandidateMembershipWriteBinding } from "./researchWriteBinding.js";
import { canonicalSourceUrl, supportedOfficialHtmlUrl } from "../../../../packages/contracts/src/researchSourceIntake.js";

export type SourceSnapshotStoreOptions = { repositoryRoot: string; rawStoreRoot?: string | null; fetchImpl?: typeof fetch;
  maxBytes?: number; availabilityCache?: Map<string,SourceOriginalAvailability> };
export type SourceOriginalAvailability = "available" | "unavailable" | "unknown";
export type SourceOriginalIdentity = { snapshotId:string; rawSha256:string; byteLength:number; textSha256:string };

/** Verify each immutable original once per read, without changing the stored assertion. */
export async function sourceOriginalAvailabilities(client:Pick<Pool | PoolClient,"query">,membershipId:string,
  actor:AuthenticatedResearchActor,identities:SourceOriginalIdentity[],options?:SourceSnapshotStoreOptions
):Promise<Map<string,SourceOriginalAvailability>> {
  const result=new Map<string,SourceOriginalAvailability>();
  const unique=new Map<string,SourceOriginalIdentity>();
  for(const identity of identities){
    const previous=unique.get(identity.snapshotId);
    if(previous && (previous.rawSha256!==identity.rawSha256 || previous.byteLength!==identity.byteLength
      || previous.textSha256!==identity.textSha256))result.set(identity.snapshotId,"unavailable");
    else unique.set(identity.snapshotId,identity);
  }
  for(const [id,identity] of unique){
    if(result.has(id))continue;
    const key=JSON.stringify([membershipId,actor.actorType,actor.actorId,id,identity.rawSha256,identity.byteLength,identity.textSha256]);
    const cached=options?.availabilityCache?.get(key);
    if(cached){result.set(id,cached);continue;}
    if(!options){result.set(id,"unknown");continue;}
    try {
      const snapshot=await readResearchSourceSnapshot(client,membershipId,id,actor,options);
      result.set(id,snapshot.rawSha256===identity.rawSha256 && snapshot.byteLength===identity.byteLength
        && snapshot.textSha256===identity.textSha256?"available":"unavailable");
    } catch(error) {
      if(error instanceof ResearchDocumentError && error.code==="RAW_STORE_UNAVAILABLE"){
        result.set(id,"unknown");
      } else if(error instanceof ResearchDocumentError && ["RAW_CONTENT_MISSING","RAW_CONTENT_HASH_MISMATCH",
        "RAW_STORE_INVALID","SNAPSHOT_TEXT_DRIFT"].includes(error.code)) {
        result.set(id,"unavailable");
      } else throw error;
    }
    options.availabilityCache?.set(key,result.get(id)!);
  }
  return result;
}
type SnapshotRow = {
  id: string; candidate_membership_id: string; captured_membership_version: number; symbol: string;
  source_category: "issuer_public_html"; canonical_url: string; response_url: string; publisher: string;
  published_at: Date | string | null; captured_at: Date | string; media_type: "text/html";
  raw_sha256: string; byte_length: number; normalized_text: string; text_sha256: string;
  extraction_version: "parse5-visible-nfc-v1"; summary: string; request_fingerprint: string;
};
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const iso = (value: Date | string) => new Date(value).toISOString();
const offsetBoundary = (value:string,offset:number) => {
  const before=value.charCodeAt(offset-1),after=value.charCodeAt(offset);
  return !(before>=0xD800 && before<=0xDBFF && after>=0xDC00 && after<=0xDFFF);
};
const map = (row: SnapshotRow): ResearchSourceSnapshotData => ({ id: String(row.id), membershipId: String(row.candidate_membership_id),
  membershipVersion: Number(row.captured_membership_version), symbol: row.symbol, sourceCategory: row.source_category,
  canonicalUrl: row.canonical_url, responseUrl: row.response_url, publisher: row.publisher,
  publishedAt: row.published_at ? iso(row.published_at) : null, capturedAt: iso(row.captured_at),
  mediaType: row.media_type, rawSha256: row.raw_sha256, byteLength: Number(row.byte_length),
  normalizedText: row.normalized_text, textSha256: row.text_sha256, extractionVersion: row.extraction_version,
  offsetUnit: RESEARCH_SOURCE_SNAPSHOT_OFFSET_UNIT, summary: row.summary,
  reviewState: "unconfirmed", rawChangeOnly: false });

async function withReviewState(client: Pick<Pool | PoolClient,"query">, row: SnapshotRow): Promise<ResearchSourceSnapshotData> {
  const result = await client.query<{text_sha256:string;raw_sha256:string;confirmed_same:boolean;confirmed_any:boolean}>(
    `select latest.text_sha256,latest.raw_sha256,
      exists(select 1 from research_materials m join research_source_snapshots cited on cited.id=m.citation_snapshot_id
        where cited.candidate_membership_id=$1 and cited.canonical_url=$2 and cited.text_sha256=latest.text_sha256
          and m.deleted_at is null and not exists(
            select 1 from research_source_snapshots intervening
             where intervening.candidate_membership_id=cited.candidate_membership_id
               and intervening.canonical_url=cited.canonical_url
               and (intervening.captured_at,intervening.id)>(cited.captured_at,cited.id)
               and intervening.text_sha256<>cited.text_sha256)) confirmed_same,
      exists(select 1 from research_materials m join research_source_snapshots cited on cited.id=m.citation_snapshot_id
        where cited.candidate_membership_id=$1 and cited.canonical_url=$2 and m.deleted_at is null) confirmed_any
     from research_source_snapshots latest where latest.candidate_membership_id=$1 and latest.canonical_url=$2
     order by latest.captured_at desc,latest.id desc limit 1`,[row.candidate_membership_id,row.canonical_url]);
  const latest=result.rows[0];
  const diverged=await client.query<{changed:boolean}>(`select exists(select 1 from research_source_snapshots newer
    where newer.candidate_membership_id=$1 and newer.canonical_url=$2
      and (newer.captured_at,newer.id)>($3::timestamptz,$4::bigint)
      and newer.text_sha256<>$5) as changed`,[row.candidate_membership_id,row.canonical_url,row.captured_at,row.id,row.text_sha256]);
  const prior=await client.query<{raw_sha256:string;text_sha256:string}>(`select raw_sha256,text_sha256
    from research_source_snapshots where candidate_membership_id=$1 and canonical_url=$2
      and (captured_at,id)<($3::timestamptz,$4::bigint)
    order by captured_at desc,id desc limit 1`,[row.candidate_membership_id,row.canonical_url,row.captured_at,row.id]);
  const reviewState = diverged.rows[0]?.changed || !latest || latest.text_sha256!==row.text_sha256 ? "historical"
    : latest.confirmed_same ? "current" : latest.confirmed_any ? "pending_review" : "unconfirmed";
  return {...map(row),reviewState,rawChangeOnly:!!prior.rows[0]
    && prior.rows[0].text_sha256===row.text_sha256 && prior.rows[0].raw_sha256!==row.raw_sha256};
}

export async function captureResearchSourceSnapshot(pool: Pool, membershipId: string,
  request: CaptureResearchSourceSnapshotRequest, actor: AuthenticatedResearchActor,
  options: SourceSnapshotStoreOptions, now = new Date()): Promise<ResearchSourceSnapshotData> {
  if (actor.actorType !== "user") throw new ResearchDocumentError(422, "OWNER_ACTOR_REQUIRED", "official HTML capture requires a user actor");
  let canonicalUrl: string;
  try { canonicalUrl = canonicalSourceUrl(request.url); }
  catch { throw new ResearchDocumentError(422, "UNSUPPORTED_HTML_SOURCE", "official HTML URL must be a supported canonical HTTPS address"); }
  const requestFingerprint = sha(JSON.stringify({ actor, membershipId,
    membershipVersion: request.membershipVersion, url: canonicalUrl }));
  const replay = async (): Promise<ResearchSourceSnapshotData | null> => {
    const existing = await pool.query<SnapshotRow>(`select * from research_source_snapshots
      where actor_type=$1 and actor_id=$2 and idempotency_key=$3`, [actor.actorType, actor.actorId, request.idempotencyKey]);
    const row = existing.rows[0];
    if (!row) return null;
    if (row.request_fingerprint !== requestFingerprint || row.candidate_membership_id !== membershipId
      || Number(row.captured_membership_version) !== request.membershipVersion)
      throw new ResearchDocumentError(409, "SNAPSHOT_IDEMPOTENCY_CONFLICT", "idempotency key already binds another capture");
    return readResearchSourceSnapshot(pool, membershipId, String(row.id), actor, options);
  };
  // Replays use the immutable original, even when the issuer site has changed or is offline.
  const existing = await replay();
  if (existing) return existing;
  const membership = await readCandidateMembershipById(pool, actor, membershipId);
  if (!membership) throw new CandidateMembershipNotFoundError();
  if (Number(membership.version) !== request.membershipVersion) throw new CandidateMembershipVersionConflictError("stale membership version");
  if (!supportedOfficialHtmlUrl(canonicalUrl, membership.symbol))
    throw new ResearchDocumentError(422, "UNSUPPORTED_HTML_SOURCE", "issuer HTML URL is outside the registered path and symbol");
  const captured = await fetchOfficialHtmlSnapshot(request.url, membership.symbol, options.fetchImpl, options.maxBytes);
  const extracted = extractGeelyOfficialHtml(captured.bytes);
  if (!extracted.publishedAt || Date.parse(extracted.publishedAt) > now.getTime())
    throw new ResearchDocumentError(422, "HTML_PUBLICATION_UNVERIFIED", "official article publication date was not established");
  const rawSha256 = sha(captured.bytes);
  await storeResearchRawBytes(options.rawStoreRoot, options.repositoryRoot, rawSha256, captured.bytes);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await assertCandidateMembershipWriteBinding(client, actor, { membershipId, membershipVersion: request.membershipVersion });
    const existing = await client.query<SnapshotRow>(`select * from research_source_snapshots
      where actor_type=$1 and actor_id=$2 and idempotency_key=$3 for share`, [actor.actorType, actor.actorId, request.idempotencyKey]);
    if (existing.rows[0]) {
      if (existing.rows[0].request_fingerprint !== requestFingerprint)
        throw new ResearchDocumentError(409, "SNAPSHOT_IDEMPOTENCY_CONFLICT", "idempotency key already binds another capture");
      await client.query("commit");
      return readResearchSourceSnapshot(pool, membershipId, String(existing.rows[0].id), actor, options);
    }
    const inserted = await client.query<SnapshotRow>(`insert into research_source_snapshots
      (candidate_membership_id,captured_membership_version,actor_type,actor_id,symbol,source_category,
       canonical_url,response_url,publisher,published_at,captured_at,media_type,raw_sha256,byte_length,
       normalized_text,text_sha256,extraction_version,summary,idempotency_key,request_fingerprint)
      values ($1,$2,$3,$4,$5,'issuer_public_html',$6,$7,$8,$9,$10,'text/html',$11,$12,$13,$14,$15,$16,$17,$18)
      returning *`, [membershipId,request.membershipVersion,actor.actorType,actor.actorId,membership.symbol,
      captured.canonicalUrl,captured.responseUrl,"Geely Auto official global",extracted.publishedAt,now,
      rawSha256,captured.bytes.length,extracted.normalizedText,extracted.textSha256,extracted.extractionVersion,
      extracted.summary,request.idempotencyKey,requestFingerprint]);
    await client.query("commit");
    return readResearchSourceSnapshot(pool, membershipId, String(inserted.rows[0]!.id), actor, options);
  } catch (error) {
    await client.query("rollback");
    if ((error as {code?:string}).code === "23505") {
      const winner = await replay();
      if (winner) return winner;
    }
    throw error;
  }
  finally { client.release(); }
}

export async function readResearchSourceSnapshot(client: Pick<Pool | PoolClient, "query">, membershipId: string,
  snapshotId: string, actor: AuthenticatedResearchActor, options: SourceSnapshotStoreOptions): Promise<ResearchSourceSnapshotData> {
  const result = await client.query<SnapshotRow>(`select s.* from research_source_snapshots s
    join candidate_memberships cm on cm.id=s.candidate_membership_id
    where s.id=$1 and s.candidate_membership_id=$2 and cm.actor_type=$3 and cm.actor_id=$4
      and s.actor_type=$3 and s.actor_id=$4 and s.symbol=cm.symbol`, [snapshotId,membershipId,actor.actorType,actor.actorId]);
  const row = result.rows[0];
  if (!row) throw new ResearchDocumentError(404, "SNAPSHOT_NOT_FOUND", "source snapshot is not available for this actor and membership");
  const bytes = await readResearchRawBytes(options.rawStoreRoot, options.repositoryRoot, row.raw_sha256, Number(row.byte_length));
  const extracted = extractGeelyOfficialHtml(bytes);
  if (extracted.normalizedText !== row.normalized_text || extracted.textSha256 !== row.text_sha256
    || extracted.extractionVersion !== row.extraction_version || extracted.summary !== row.summary)
    throw new ResearchDocumentError(409, "SNAPSHOT_TEXT_DRIFT", "stored normalized text differs from captured original bytes");
  return withReviewState(client,row);
}

export async function readResearchSourceSnapshotOriginal(client: Pick<Pool | PoolClient,"query">,membershipId:string,
  snapshotId:string,actor:AuthenticatedResearchActor,options:SourceSnapshotStoreOptions):Promise<{snapshot:ResearchSourceSnapshotData;bytes:Buffer}> {
  const snapshot=await readResearchSourceSnapshot(client,membershipId,snapshotId,actor,options);
  const bytes=await readResearchRawBytes(options.rawStoreRoot,options.repositoryRoot,snapshot.rawSha256,snapshot.byteLength);
  return {snapshot,bytes};
}

export async function listResearchSourceSnapshots(client: Pick<Pool | PoolClient,"query">,membershipId:string,
  actor:AuthenticatedResearchActor):Promise<ResearchSourceSnapshotListItem[]> {
  const rows=await client.query<SnapshotRow>(`select s.* from research_source_snapshots s
    join candidate_memberships cm on cm.id=s.candidate_membership_id
    where s.candidate_membership_id=$1 and cm.actor_type=$2 and cm.actor_id=$3
      and s.actor_type=$2 and s.actor_id=$3 and s.symbol=cm.symbol
    order by s.captured_at desc,s.id desc limit 100`,[membershipId,actor.actorType,actor.actorId]);
  const result:ResearchSourceSnapshotListItem[]=[];
  for(const row of rows.rows){const {normalizedText,...item}=await withReviewState(client,row);result.push(item);}
  return result;
}

export async function assertSnapshotCitation(client: PoolClient, membershipId: string, membershipVersion: number,
  actor: AuthenticatedResearchActor, citation: ResearchSnapshotTextCitation, excerpt: string): Promise<{
    responseUrl:string;publishedAt:string;rawSha256:string;byteLength:number;mediaType:"text/html";canonicalUrl:string}> {
  const result = await client.query<{ normalized_text: string; text_sha256: string; response_url:string; published_at:Date|string|null; raw_sha256:string;
    byte_length:number;media_type:"text/html";canonical_url:string;pending_review:boolean }>(`select s.normalized_text,s.text_sha256,s.response_url,s.published_at,s.raw_sha256,
      s.byte_length,s.media_type,s.canonical_url,
      exists(select 1 from research_source_snapshots newer where newer.candidate_membership_id=s.candidate_membership_id
        and newer.canonical_url=s.canonical_url and (newer.captured_at,newer.id)>(s.captured_at,s.id)
        and newer.text_sha256<>s.text_sha256) pending_review
    from research_source_snapshots s join candidate_memberships cm on cm.id=s.candidate_membership_id
    where s.id=$1 and s.candidate_membership_id=$2 and s.captured_membership_version=$3
      and s.actor_type=$4 and s.actor_id=$5 and cm.actor_type=$4 and cm.actor_id=$5
      and cm.version=$3 and s.text_sha256=$6 and s.symbol=cm.symbol`,
  [citation.snapshotId,membershipId,membershipVersion,actor.actorType,actor.actorId,citation.textSha256]);
  const row = result.rows[0];
  if (!row || row.pending_review || sha(row.normalized_text) !== row.text_sha256
    || !Number.isSafeInteger(citation.startUtf16) || citation.startUtf16<0
    || !Number.isSafeInteger(citation.endUtf16) || citation.endUtf16<=citation.startUtf16
    || citation.endUtf16 > row.normalized_text.length
    || !offsetBoundary(row.normalized_text,citation.startUtf16) || !offsetBoundary(row.normalized_text,citation.endUtf16)
    || row.normalized_text.slice(citation.startUtf16,citation.endUtf16) !== excerpt
    || sha(excerpt) !== citation.excerptSha256)
    throw new ResearchDocumentError(409, "SNAPSHOT_CITATION_MISMATCH", "excerpt is not the selected original text span");
  if (!row.published_at) throw new ResearchDocumentError(409, "SNAPSHOT_PUBLICATION_UNKNOWN", "source publication date is unavailable");
  return {responseUrl:row.response_url,publishedAt:iso(row.published_at),rawSha256:row.raw_sha256,
    byteLength:Number(row.byte_length),mediaType:row.media_type,canonicalUrl:row.canonical_url};
}
