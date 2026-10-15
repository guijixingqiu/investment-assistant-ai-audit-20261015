export const DEFAULT_API_BASE_URL = "";
export const DEFAULT_AUTH_HEADER_NAME = "x-research-write-token";
export const DEFAULT_CANDIDATE_READ_AUTH_HEADER_NAME = "x-research-read-token";
export const DEFAULT_CANDIDATE_WRITE_AUTH_HEADER_NAME = "x-research-write-token";

export function normalizeLoopbackApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return DEFAULT_API_BASE_URL;
  const url = new URL(trimmed);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "http:" || (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1")) {
    throw new Error("Web development proxy accepts only loopback http API origins.");
  }
  return url.toString().replace(/\/+$/, "");
}
