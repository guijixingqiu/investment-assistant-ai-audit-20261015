import { sha256Hex } from "../../../packages/contracts/src/sha256.js";
import type { ResearchSourceSnapshotData, ResearchSourceSnapshotListItem } from "../../../packages/contracts/src/researchSourceSnapshot.js";
import type { ResearchMaterialData } from "../../../packages/contracts/src/researchMaterial.js";
import { validResearchMaterial } from "../../../packages/contracts/src/researchMaterial.js";
import type { WebApiAuth } from "./apiClient.js";

export type SnapshotMembership = { id: string; version: number; symbol: string };
export type SnapshotSpan = { snapshotId: string; textSha256: string; startUtf16: number;
  endUtf16: number; excerptSha256: string; excerpt: string };

const sha = sha256Hex;
const path = (membership: SnapshotMembership) =>
  `/api/mobile/research/candidate-memberships/${encodeURIComponent(membership.id)}/source-snapshots`;

function headers(auth: WebApiAuth, contentType = false): Headers {
  const value = new Headers({ [auth.headerName]: auth.token });
  if (contentType) value.set("content-type", "application/json");
  return value;
}

async function snapshotJson<T>(url: string, auth: WebApiAuth, init: RequestInit, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(url, { ...init, cache: "no-store", headers: init.headers ?? headers(auth) });
  if (!response.ok) throw new Error(`Stored source request failed: HTTP ${response.status}.`);
  const parsed: unknown = await response.json();
  if (!parsed || typeof parsed !== "object" || (parsed as {ok?: unknown}).ok !== true || !("data" in parsed)) {
    throw new Error("Stored source response is malformed.");
  }
  return (parsed as {data: T}).data;
}

export function validSnapshotIdentity(value: ResearchSourceSnapshotListItem,
                                      membership: SnapshotMembership, requireText: boolean): value is ResearchSourceSnapshotData {
  const text = (value as ResearchSourceSnapshotData).normalizedText;
  return /^[1-9]\d*$/.test(value.id) && value.membershipId === membership.id
    && Number.isSafeInteger(value.membershipVersion) && value.membershipVersion > 0
    && value.membershipVersion <= membership.version && value.symbol === membership.symbol
    && value.sourceCategory === "issuer_public_html" && value.mediaType === "text/html"
    && /^https:\/\//.test(value.canonicalUrl) && /^https:\/\//.test(value.responseUrl)
    && /^[a-f0-9]{64}$/.test(value.rawSha256) && /^[a-f0-9]{64}$/.test(value.textSha256)
    && Number.isSafeInteger(value.byteLength) && value.byteLength > 0
    && value.extractionVersion === "parse5-visible-nfc-v1" && value.offsetUnit === "utf16_code_unit"
    && ["unconfirmed", "current", "pending_review", "historical"].includes(value.reviewState)
    && (!requireText || typeof text === "string" && sha(text) === value.textSha256);
}

export async function listStoredSources(membership: SnapshotMembership, auth: WebApiAuth,
                                        fetcher: typeof fetch = fetch): Promise<ResearchSourceSnapshotListItem[]> {
  const values = await snapshotJson<ResearchSourceSnapshotListItem[]>(path(membership), auth,
    { headers: headers(auth) }, fetcher);
  if (!Array.isArray(values) || !values.every(item => validSnapshotIdentity(item, membership, false))) {
    throw new Error("Stored source list identity is invalid.");
  }
  return values;
}

export async function readStoredSource(membership: SnapshotMembership, id: string, auth: WebApiAuth,
                                       fetcher: typeof fetch = fetch): Promise<ResearchSourceSnapshotData> {
  if (!/^[1-9]\d*$/.test(id)) throw new Error("Stored source ID is invalid.");
  const value = await snapshotJson<ResearchSourceSnapshotData>(`${path(membership)}/${encodeURIComponent(id)}`,
    auth, { headers: headers(auth) }, fetcher);
  if (value.id !== id || !validSnapshotIdentity(value, membership, true)) {
    throw new Error("Stored source text or identity changed.");
  }
  return value;
}

export async function verifyStoredSourceOriginal(membership: SnapshotMembership,
                                                 snapshot: ResearchSourceSnapshotData, auth: WebApiAuth,
                                                 fetcher: typeof fetch = fetch): Promise<void> {
  if (!validSnapshotIdentity(snapshot, membership, true)) throw new Error("Stored source identity is invalid.");
  const response = await fetcher(`${path(membership)}/${encodeURIComponent(snapshot.id)}/content`,
    { cache: "no-store", headers: headers(auth) });
  if (!response.ok) throw new Error(`Stored source original unavailable: HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const rawHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (response.headers.get("x-source-raw-sha256") !== snapshot.rawSha256
    || bytes.byteLength !== snapshot.byteLength || rawHash !== snapshot.rawSha256) {
    throw new Error("Stored source original bytes do not match the captured SHA-256.");
  }
}

export function selectedStoredSourceSpan(snapshot: ResearchSourceSnapshotData, selection: Selection): SnapshotSpan {
  const text = snapshot.normalizedText;
  if (!text || selection.rangeCount !== 1) throw new Error("Select one span in the stored source text.");
  const range = selection.getRangeAt(0);
  const pre = selection.anchorNode?.parentElement;
  if (range.startContainer !== range.endContainer || range.startContainer.nodeType !== Node.TEXT_NODE
    || !pre || pre.textContent !== text) throw new Error("Selection must stay inside one stored source text block.");
  const startUtf16 = range.startOffset, endUtf16 = range.endOffset;
  const excerpt = text.slice(startUtf16, endUtf16);
  const split = (offset: number) => {
    const before = text.charCodeAt(offset - 1), after = text.charCodeAt(offset);
    return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
  };
  if (startUtf16 < 0 || endUtf16 > text.length || endUtf16 <= startUtf16
    || excerpt.length > 4000 || !excerpt.trim() || split(startUtf16) || split(endUtf16)) {
    throw new Error("Select a non-empty complete span of at most 4000 UTF-16 units.");
  }
  return { snapshotId: snapshot.id, textSha256: snapshot.textSha256,
    startUtf16, endUtf16, excerptSha256: sha(excerpt), excerpt };
}

export async function captureStoredSource(membership: SnapshotMembership, url: string,
                                          idempotencyKey: string, auth: WebApiAuth,
                                          fetcher: typeof fetch = fetch): Promise<ResearchSourceSnapshotData> {
  const value = await snapshotJson<ResearchSourceSnapshotData>(path(membership), auth,
    { method: "POST", headers: headers(auth, true), body: JSON.stringify({membershipVersion:membership.version,url,idempotencyKey}) }, fetcher);
  if (!validSnapshotIdentity(value, membership, true) || value.membershipVersion !== membership.version) {
    throw new Error("Captured source did not bind this membership.");
  }
  return value;
}

export async function confirmStoredSourceMaterial(membership: SnapshotMembership,
                                                  snapshot: ResearchSourceSnapshotData, span: SnapshotSpan,
                                                  validUntil: string, idempotencyKey: string,
                                                  auth: WebApiAuth, fetcher: typeof fetch = fetch): Promise<ResearchMaterialData> {
  if (snapshot.membershipVersion !== membership.version || !["unconfirmed", "current"].includes(snapshot.reviewState)
    || !snapshot.publishedAt
    || span.snapshotId !== snapshot.id || span.textSha256 !== snapshot.textSha256
    || snapshot.normalizedText?.slice(span.startUtf16, span.endUtf16) !== span.excerpt
    || sha(span.excerpt) !== span.excerptSha256) throw new Error("Stored source selection is stale.");
  const write = await snapshotJson<{schemaVersion:string;status:string;source:{actorType:string;actorId:string};data:ResearchMaterialData}>(
    `${path(membership)}/${encodeURIComponent(snapshot.id)}/materials`, auth,
    { method: "POST", headers: headers(auth, true), body: JSON.stringify({membershipVersion:membership.version,
      startUtf16:span.startUtf16,endUtf16:span.endUtf16,validUntil,ownerConfirmed:true,idempotencyKey}) }, fetcher);
  const material = write.data;
  if (write.schemaVersion !== "2026-06-18.research-write.v1" || write.status !== "succeeded"
    || write.source.actorType !== "user" || !validResearchMaterial(material)
    || material.symbol !== membership.symbol || material.sourceType !== "issuer_public_html"
    || material.contentText !== span.excerpt || material.snapshotCitation?.snapshotId !== span.snapshotId
    || material.snapshotCitation?.excerptSha256 !== span.excerptSha256
    || material.snapshotOriginal?.rawSha256 !== snapshot.rawSha256) {
    throw new Error("Stored source material write response is invalid.");
  }
  return material;
}
