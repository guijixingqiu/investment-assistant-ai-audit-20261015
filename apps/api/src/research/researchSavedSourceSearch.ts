import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { readCandidateMembershipById } from "./candidateMembershipPersistence.js";
import { CandidateMembershipNotFoundError, ResearchDocumentError, type AuthenticatedResearchActor } from "./domain.js";
import { readResearchSourceSnapshot } from "./researchSourceSnapshotRepository.js";
import { FutuFinancialCaptureError, readFutuFinancialCapture, readFutuFinancialOriginal } from "./researchFutuFinancialStatementRepository.js";
import type { ResearchSnapshotTextCitation } from "../../../../packages/contracts/src/researchSourceCitation.js";
import { findResearchOriginalTextMatch, researchDocumentSearchQuery,
  RESEARCH_DOCUMENT_SEARCH_GLOSSARY_VERSION } from "./researchDocumentSearchText.js";

type Store = { repositoryRoot: string; rawStoreRoot?: string | null };
export type SavedSourceHit = {
  id: string; kind: "html" | "futu_material"; title: string; excerpt: string;
  snapshotId: string | null; textSha256: string | null;
  materialId: string | null; contentFingerprint: string | null;
  captureId: string | null; pageId: string | null; rawSha256: string;
  citation: ResearchSnapshotTextCitation | null;
  reviewState: "unconfirmed" | "current" | "pending_review" | "historical" | null;
  sourceLabel: string;
};
export type SavedSourceSearch = {
  schemaVersion: "2026-10-11.saved-source-search.v3";
  requestedActorId: string; membershipId: string; membershipVersion: number; symbol: string;
  query: string; glossaryVersion: typeof RESEARCH_DOCUMENT_SEARCH_GLOSSARY_VERSION | null;
  results: SavedSourceHit[]; unavailableSources: SavedSourceUnavailable[];
  laneFailures: Array<{ kind: "html" | "futu_material"; reason: "search_unavailable" }>;
};
export type SavedSourceUnavailable = {
  id: string; kind: "html" | "futu_material"; title: string;
  reason: "original_missing" | "integrity_mismatch" | "original_unreadable";
};
type HtmlRow = { id: string; normalized_text: string; text_sha256: string; raw_sha256: string;
  summary: string; canonical_url: string };
type MaterialRow = { id: string; title: string; content_text: string; content_fingerprint: string;
  raw_payload: { futuFinancialSource?: { captureId?: unknown; membershipId?: unknown; membershipVersion?: unknown;
    symbol?: unknown;
    pages?: Array<{ pageId?: unknown; rawSha256?: unknown }> } } };
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function previewExcerpt(text: string, start: number, end: number): string {
  const from = Math.max(0, start - 80);
  const to = Math.min(text.length, Math.max(end + 160, from + 320));
  return `${from ? "…" : ""}${text.slice(from, to).replace(/\s+/gu, " ")}${to < text.length ? "…" : ""}`;
}
function searchLaneFailure(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String(error.code);
  // Authorization and schema faults must fail the request, not become partial results.
  return code.startsWith("08") || ["53300", "53400", "57P01", "57014"].includes(code);
}
function laneRows<T>(result: PromiseSettledResult<{ rows: T[] }>,
  kind: SavedSourceSearch["laneFailures"][number]["kind"],
  failures: SavedSourceSearch["laneFailures"]): T[] {
  if (result.status === "fulfilled") return result.value.rows;
  if (!searchLaneFailure(result.reason)) throw result.reason;
  failures.push({ kind, reason: "search_unavailable" });
  return [];
}
function originalFailureReason(error: unknown): SavedSourceUnavailable["reason"] | null {
  if (error instanceof ResearchDocumentError) {
    if (["SNAPSHOT_NOT_FOUND", "RAW_CONTENT_MISSING"].includes(error.code)) return "original_missing";
    if (["SNAPSHOT_TEXT_DRIFT", "RAW_CONTENT_HASH_MISMATCH"].includes(error.code)) return "integrity_mismatch";
    if (error.code === "RAW_STORE_INVALID" && error.message.startsWith("content-addressed")) return "integrity_mismatch";
    if (["HTML_ARTICLE_UNAVAILABLE", "HTML_ISSUER_UNCONFIRMED", "RAW_STORE_UNAVAILABLE"].includes(error.code)) return "original_unreadable";
  }
  if (error instanceof FutuFinancialCaptureError) {
    if (["CAPTURE_NOT_FOUND", "PAGE_NOT_FOUND"].includes(error.code)) return "original_missing";
    if (["PAGE_METADATA_DRIFT", "CAPTURE_STATE_INVALID"].includes(error.code)) return "integrity_mismatch";
    if (error.code === "PAGE_ORIGINAL_INVALID") return "original_unreadable";
  }
  return null;
}

/** Read-only search of already saved originals. Every returned hit is rechecked against its original. */
export async function searchSavedSources(pool: Pool, membershipId: string, query: string,
  actor: AuthenticatedResearchActor, store: Store): Promise<SavedSourceSearch> {
  const q = query.trim();
  if (!q || q.length > 80) throw new ResearchDocumentError(400, "SEARCH_QUERY_INVALID", "search query must contain 1 to 80 characters");
  const member = await readCandidateMembershipById(pool, actor, membershipId);
  if (!member) throw new CandidateMembershipNotFoundError();
  const search = researchDocumentSearchQuery(q);
  const terms = search.terms.map(term => term.toLocaleLowerCase());
  const [html, materials] = await Promise.allSettled([pool.query<HtmlRow>(`
    select s.id::text, s.normalized_text, s.text_sha256, s.raw_sha256, s.summary, s.canonical_url
      from research_source_snapshots s join candidate_memberships m on m.id=s.candidate_membership_id
     where s.candidate_membership_id=$1 and s.actor_type=$2 and s.actor_id=$3
       and m.actor_type=$2 and m.actor_id=$3 and s.symbol=m.symbol
       and s.captured_membership_version<=m.version
       and exists(select 1 from unnest($4::text[]) term where
         position(term in lower(regexp_replace(normalize(s.normalized_text, NFKC), '[[:space:]]+', '', 'g'))) > 0)
     order by s.captured_at desc, s.id desc limit 12`,
    [membershipId, actor.actorType, actor.actorId, terms]), pool.query<MaterialRow>(`
    select rm.id::text, rm.title, rm.content_text, rm.content_fingerprint, e.raw_payload
      from research_materials rm
      join evidence_items e on e.id=rm.evidence_item_id
      join candidate_memberships m on m.id=rm.candidate_membership_id
     where rm.candidate_membership_id=$1 and m.actor_type=$2 and m.actor_id=$3
       and e.source_type='futu_opend_financial_statement_provider'
       and rm.deleted_at is null and rm.valid_until>now()
       and rm.claim_type='third_party_statement' and rm.verification_status='unverified'
       and not exists(select 1 from research_materials child where child.replaces_material_id=rm.id)
       and e.raw_payload->'futuFinancialSource'->>'membershipVersion'=m.version::text
       and exists(select 1 from unnest($4::text[]) term where
         position(term in lower(regexp_replace(normalize(rm.content_text, NFKC), '[[:space:]]+', '', 'g'))) > 0)
     order by rm.id desc limit 20`,
    [membershipId, actor.actorType, actor.actorId, terms])]);
  const results: SavedSourceHit[] = [];
  const unavailableSources: SavedSourceUnavailable[] = [];
  const laneFailures: SavedSourceSearch["laneFailures"] = [];
  for (const row of laneRows(html, "html", laneFailures)) {
    const unavailable = (reason: SavedSourceUnavailable["reason"]) => unavailableSources.push({
      id: `html:${row.id}`, kind: "html", title: row.canonical_url, reason });
    if (sha(row.normalized_text) !== row.text_sha256) { unavailable("integrity_mismatch"); continue; }
    try {
      const original = await readResearchSourceSnapshot(pool, membershipId, row.id, actor, store);
      if (original.textSha256 !== row.text_sha256 || original.rawSha256 !== row.raw_sha256
        || original.membershipVersion > Number(member.version) || original.symbol !== member.symbol) {
        unavailable("integrity_mismatch"); continue;
      }
      const match = findResearchOriginalTextMatch(row.normalized_text, terms);
      if (!match || match.endUtf16 - match.startUtf16 > 4_000) continue;
      results.push({ id: `html:${row.id}`, kind: "html", title: row.canonical_url,
        excerpt: previewExcerpt(row.normalized_text, match.startUtf16, match.endUtf16),
        snapshotId: row.id, textSha256: row.text_sha256,
        materialId: null, contentFingerprint: null, captureId: null, pageId: null,
        rawSha256: row.raw_sha256,
        citation: { kind: "source_snapshot", snapshotId: row.id, textSha256: row.text_sha256,
          startUtf16: match.startUtf16, endUtf16: match.endUtf16,
          excerptSha256: sha(match.matchedText) },
        reviewState: original.reviewState,
        sourceLabel: "已存官方网页原文" });
    } catch (error) {
      const reason = originalFailureReason(error) ?? (error instanceof TypeError ? "original_unreadable" : null);
      if (!reason) throw error;
      unavailable(reason);
    }
  }
  for (const row of laneRows(materials, "futu_material", laneFailures)) {
    const unavailable = (reason: SavedSourceUnavailable["reason"]) => unavailableSources.push({
      id: `futu_material:${row.id}`, kind: "futu_material", title: row.title, reason });
    if (sha(row.content_text) !== row.content_fingerprint) { unavailable("integrity_mismatch"); continue; }
    const source = row.raw_payload?.futuFinancialSource;
    if (!source || typeof source.captureId !== "string" || !Array.isArray(source.pages)
      || source.membershipId !== membershipId || source.membershipVersion !== Number(member.version)
      || source.symbol !== member.symbol) { unavailable("integrity_mismatch"); continue; }
    // Each metric line names its exact raw page. Do not invent a page for a title-only match.
    const line = row.content_text.split("\n").find(value =>
      findResearchOriginalTextMatch(value, terms) !== null && /原页 #(\d+)/u.test(value));
    const pageId = line?.match(/原页 #(\d+)/u)?.[1];
    const cited = source.pages.find(page => page?.pageId === pageId);
    if (!pageId) continue;
    if (!cited || typeof cited.rawSha256 !== "string") { unavailable("integrity_mismatch"); continue; }
    try {
      const capture = await readFutuFinancialCapture(pool, membershipId, source.captureId, actor, store);
      if (capture.membershipVersion !== Number(member.version) || capture.symbol !== member.symbol)
        throw new ResearchDocumentError(409, "SEARCH_IDENTITY_DRIFT", "saved financial capture identity changed");
      const page = capture.pages.find(value => value.id === pageId && value.rawSha256 === cited.rawSha256);
      if (!page) { unavailable("integrity_mismatch"); continue; }
      const original = await readFutuFinancialOriginal(pool, membershipId, capture.id, page.id, actor, store);
      if (original.page.rawSha256 !== page.rawSha256 || original.page.id !== page.id) {
        unavailable("integrity_mismatch"); continue;
      }
      results.push({ id: `futu_material:${row.id}:${pageId}`, kind: "futu_material", title: row.title,
        excerpt: line!.trim(), snapshotId: null, textSha256: null,
        materialId: row.id, contentFingerprint: row.content_fingerprint,
        captureId: capture.id, pageId, rawSha256: page.rawSha256,
        citation: null, reviewState: null,
        sourceLabel: "富途提供方材料 · 第三方声明，未核实" });
    } catch (error) {
      const reason = originalFailureReason(error);
      if (!reason) throw error;
      unavailable(reason);
    }
  }
  const fresh = await readCandidateMembershipById(pool, actor, membershipId);
  if (!fresh || Number(fresh.version) !== Number(member.version) || fresh.symbol !== member.symbol)
    throw new ResearchDocumentError(409, "SEARCH_IDENTITY_DRIFT", "research membership changed during search");
  return { schemaVersion: "2026-10-11.saved-source-search.v3", requestedActorId: actor.actorId,
    membershipId, membershipVersion: Number(member.version), symbol: member.symbol, query: q,
    glossaryVersion: search.glossaryVersion, results: results.slice(0, 20), unavailableSources,
    laneFailures };
}
