import { canonicalSourceUrl, supportedOfficialHtmlUrl } from "../../../../packages/contracts/src/researchSourceIntake.js";
import { ResearchDocumentError } from "./domain.js";

export const MAX_OFFICIAL_HTML_BYTES = 2 * 1024 * 1024;

export async function fetchOfficialHtmlSnapshot(url: string, symbol: string, fetchImpl: typeof fetch = fetch,
  maxBytes = MAX_OFFICIAL_HTML_BYTES): Promise<{ bytes: Buffer; canonicalUrl: string; responseUrl: string; mediaType: "text/html" }> {
  const canonicalUrl = canonicalSourceUrl(url);
  if (!supportedOfficialHtmlUrl(canonicalUrl, symbol)) throw new ResearchDocumentError(422, "UNSUPPORTED_HTML_SOURCE", "issuer HTML URL is outside the registered path and symbol");
  const initialOrigin = new URL(canonicalUrl).origin;
  let current = canonicalUrl;
  let response: Response;
  for (let redirects = 0;; redirects++) {
    response = await fetchImpl(current, { headers: { accept: "text/html", "accept-language": "en-US,en;q=0.9",
      "user-agent": "InvestmentAssistantResearch/1.0 (+official issuer research)" }, redirect: "manual", cache: "no-store",
      signal: AbortSignal.timeout(12_000) });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    if (redirects >= 2 || !location) throw new ResearchDocumentError(422, "REDIRECT_REVIEW", "official HTML redirect chain needs review");
    let next: string;
    try { next = canonicalSourceUrl(new URL(location, current).toString()); }
    catch { throw new ResearchDocumentError(422, "REDIRECT_REVIEW", "invalid official HTML redirect"); }
    if (new URL(next).origin !== initialOrigin || !supportedOfficialHtmlUrl(next, symbol))
      throw new ResearchDocumentError(422, "REDIRECT_REVIEW", "HTML redirected outside the registered issuer path");
    current = next;
  }
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("text/html"))
    throw new ResearchDocumentError(415, "HTML_CONTENT_TYPE", "source did not return text/html");
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new ResearchDocumentError(413, "HTML_TOO_LARGE", "official HTML exceeds capture limit");
  if (!response.body) throw new ResearchDocumentError(422, "HTML_EMPTY", "official HTML response is empty");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new ResearchDocumentError(413, "HTML_TOO_LARGE", "official HTML exceeds capture limit");
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (!bytes.length || !/^\s*<!doctype html|^\s*<html/i.test(bytes.subarray(0, 128).toString("utf8")))
    throw new ResearchDocumentError(415, "HTML_BODY_INVALID", "source body is not an HTML document");
  return { bytes, canonicalUrl, responseUrl: current, mediaType: "text/html" };
}
