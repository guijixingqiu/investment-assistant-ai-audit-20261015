import type { ImportResearchDocumentMetadata, ResearchDocumentData } from "../../../packages/contracts/src/researchDocument.js";
import { sameWebApiAuth, type WebApiAuth } from "./apiClient.js";
import type { ExactCockpitMembership } from "./dailyResearchCockpit.js";

export async function fetchResearchDocumentJson(path: string, auth: WebApiAuth, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set(auth.headerName, auth.token);
  const response = await fetch(path, { ...init, headers });
  const value = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new ResearchDocumentHttpError(response.status, typeof value?.code === "string" ? value.code : null, typeof value?.message === "string" ? value.message : `HTTP ${response.status}`);
  return value;
}

export async function fetchResearchDocumentPdf(
  membership: ExactCockpitMembership,
  document: ResearchDocumentData,
  auth: WebApiAuth
): Promise<Uint8Array> {
  const response = await fetch(`${documentListPath(membership.id)}/${encodeURIComponent(document.id)}/content`, {
    headers: { accept: "application/pdf", [auth.headerName]: auth.token }
  });
  if (!response.ok) {
    const value = await response.json().catch(() => null) as Record<string, unknown> | null;
    throw new ResearchDocumentHttpError(response.status, typeof value?.code === "string" ? value.code : null, typeof value?.message === "string" ? value.message : `HTTP ${response.status}`);
  }
  if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("application/pdf")) throw new Error("Blocked: PDF content type mismatch.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== document.byteLength || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-"
    || await researchDocumentSha256(bytes) !== document.pdfSha256) throw new Error("Blocked: PDF content length, signature, or SHA-256 drift was detected.");
  return bytes;
}

export function documentMultipart(metadata: ImportResearchDocumentMetadata, file: File): { body: Blob; contentType: string } {
  const boundary = `----ias-${crypto.randomUUID()}`;
  const filename = researchDocumentMultipartFilename(file.name);
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: new Blob([
      `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`,
      file,
      `\r\n--${boundary}--\r\n`
    ])
  };
}

export function researchDocumentMultipartFilename(value: string): string {
  const supplied = value.replace(/["\r\n]/g, "_");
  const leaf = supplied.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const sanitized = [...leaf].filter((character) => { const code = character.codePointAt(0) ?? 0; return code > 31 && code !== 127; }).join("").trim();
  if (!sanitized || sanitized.length > 500) throw new Error("PDF filename must contain 1 to 500 safe display characters.");
  return sanitized;
}

export function openPdfBytes(bytes: Uint8Array, filename: string, pageNumber: number | null, download: boolean): void {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = pageNumber === null ? url : `${url}#page=${pageNumber}`;
  if (download) anchor.download = filename;
  else { anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; }
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

class ResearchDocumentHttpError extends Error {
  constructor(readonly status: number, readonly code: string | null, message: string) { super(message); }
}

export function documentFailureMessage(error: unknown): string {
  if (error instanceof ResearchDocumentHttpError) {
    if (error.code === "RAW_CONTENT_MISSING") return "CAS content is missing; no stale content is shown.";
    if (error.code === "RAW_CONTENT_HASH_MISMATCH" || error.code === "RAW_CONTENT_HASH_CONFLICT") return "CAS content hash drift was detected; content actions are blocked.";
    if (error.code === "RAW_STORE_INVALID") return "CAS path/store failed secure-path validation; content actions are blocked.";
    if (error.code === "RAW_STORE_UNAVAILABLE") return "CAS store is unavailable; no old content is shown.";
    return `${error.code ? `${error.code}: ` : ""}${error.message}`;
  }
  return error instanceof Error ? error.message : "Request failed.";
}

export function documentListPath(membershipId: string): string { return `/api/mobile/research/candidate-memberships/${encodeURIComponent(membershipId)}/documents`; }
export function membershipKey(value: ExactCockpitMembership | null): string | null { return value ? `${value.id}:v${value.version}:${value.symbol}` : null; }
export function sameResearchDocumentOperationContext(
  expectedMembership: ExactCockpitMembership,
  currentMembership: ExactCockpitMembership | null,
  expectedAuth: WebApiAuth,
  currentAuth: WebApiAuth | null
): boolean {
  return membershipKey(expectedMembership) === membershipKey(currentMembership) && sameWebApiAuth(expectedAuth, currentAuth);
}
export function assertResearchDocumentOperationCurrent(
  expectedMembership: ExactCockpitMembership,
  currentMembership: ExactCockpitMembership | null,
  expectedAuth: WebApiAuth,
  currentAuth: WebApiAuth | null
): void {
  if (!sameResearchDocumentOperationContext(expectedMembership, currentMembership, expectedAuth, currentAuth)) {
    throw new Error("Blocked: current membership or authorization changed during the operation.");
  }
}
export function localDateTimeToIso(value: string, label: string): string { const timestamp = Date.parse(value); if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid date and time.`); return new Date(timestamp).toISOString(); }
export function occurrences(haystack: string, needle: string): number { if (!needle) return 0; let count = 0; let index = 0; while ((index = haystack.indexOf(needle, index)) !== -1) { count += 1; index += needle.length; } return count; }
export function fail(message: string): never { throw new Error(message); }
export async function researchDocumentSha256(bytes: Uint8Array): Promise<string> { const copy = new Uint8Array(bytes.length); copy.set(bytes); return [...new Uint8Array(await crypto.subtle.digest("SHA-256", copy))].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
