import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthenticatedResearchActor } from "../research/domain.js";

export const RESEARCH_EXPECTED_ACTOR_HEADER_NAME = "x-research-expected-actor-id";

export interface ResearchAuthOptions {
  writeAuthToken: string | null;
  writeAuthHeaderName: string;
  stagingReadOnlyAuthToken?: string | null;
  stagingReadOnlyAuthHeaderName?: string;
  authSigningKey?: string | null;
  authVerificationKeys?: string[];
  authRevokedTokenIds?: Set<string>;
  requireWriteAuth: boolean;
  writeActorId: string;
  pinganSnapshotAccountScopesByActor?: Record<string, string>;
  allowLegacyWriteTokenForScopedLanes?: boolean;
}

export function authenticateWrite(
  headers: Record<string, string | string[] | undefined>,
  options: ResearchAuthOptions,
  requiredScope: ResearchWriteLaneScope | "write" = "write"
): AuthenticatedResearchActor | null {
  const headerValue = headers[options.writeAuthHeaderName.toLowerCase()];
  const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const scopedActor = authenticateScopedToken(provided, options, requiredScope);
  if (scopedActor) return expectedActorMatches(headers, scopedActor) ? scopedActor : null;
  const actorId = options.writeActorId.trim();
  if (!isValidActorId(actorId)) return null;
  if (!options.requireWriteAuth) {
    const actor = { actorType: "system", actorId } as const;
    return expectedActorMatches(headers, actor) ? actor : null;
  }
  if (requiredScope !== "write" && options.allowLegacyWriteTokenForScopedLanes !== true) return null;
  if (!options.writeAuthToken) return null;
  if (provided !== options.writeAuthToken) return null;
  const actor = { actorType: "system", actorId } as const;
  return expectedActorMatches(headers, actor) ? actor : null;
}

function expectedActorMatches(
  headers: Record<string, string | string[] | undefined>,
  actor: AuthenticatedResearchActor
): boolean {
  const headerValue = headers[RESEARCH_EXPECTED_ACTOR_HEADER_NAME];
  const expected = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return expected === undefined || expected.trim() === actor.actorId;
}

export function authenticateReadOnly(
  headers: Record<string, string | string[] | undefined>,
  options: ResearchAuthOptions
): AuthenticatedResearchActor | null {
  const headerName = options.stagingReadOnlyAuthHeaderName?.trim();
  if (!headerName) return null;
  const headerValue = headers[headerName.toLowerCase()];
  const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const scopedActor = authenticateScopedToken(provided, options, "read");
  if (scopedActor) return scopedActor;
  const token = options.stagingReadOnlyAuthToken?.trim();
  if (!token) return null;
  const actorId = options.writeActorId.trim();
  if (!isValidActorId(actorId)) return null;
  return provided === token ? { actorType: "system", actorId } : null;
}

export interface ScopedResearchTokenPayload {
  version: 1 | 2;
  actorId: string;
  scopes: ResearchTokenScope[];
  expiresAt: number;
  tokenId?: string;
  issuedAt?: number;
}

export type ResearchWriteLaneScope = "candidate_write" | "research_write" | "review_write";
export type ResearchTokenScope = "read" | "write" | ResearchWriteLaneScope;

const MAX_READ_ONLY_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_WRITE_TOKEN_TTL_SECONDS = 15 * 60;

export function createScopedResearchToken(payload: ScopedResearchTokenPayload, signingKey: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `v1.${encodedPayload}.${sign(encodedPayload, signingKey)}`;
}

function authenticateScopedToken(
  token: string | undefined,
  options: ResearchAuthOptions,
  requiredScope: "read" | "write" | ResearchWriteLaneScope,
  nowSeconds = Math.floor(Date.now() / 1000)
): AuthenticatedResearchActor | null {
  const signingKeys = [options.authSigningKey, ...(options.authVerificationKeys ?? [])]
    .filter((key): key is string => typeof key === "string" && key.length >= 32);
  if (!token || signingKeys.length === 0) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  if (!signingKeys.some((key) => sameSignature(parts[2], sign(parts[1], key)))) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Partial<ScopedResearchTokenPayload>;
    if ((payload.version !== 1 && payload.version !== 2) || typeof payload.actorId !== "string" || !isValidActorId(payload.actorId.trim())) return null;
    if (!Array.isArray(payload.scopes) || !payload.scopes.every(isResearchTokenScope)) return null;
    if (typeof payload.expiresAt !== "number" || !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= nowSeconds) return null;
    if (payload.version === 2) {
      if (typeof payload.tokenId !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(payload.tokenId)) return null;
      if (typeof payload.issuedAt !== "number" || !Number.isSafeInteger(payload.issuedAt) || payload.issuedAt > nowSeconds) return null;
      const maxTtl = payload.scopes.every((scope) => scope === "read")
        ? MAX_READ_ONLY_TOKEN_TTL_SECONDS
        : MAX_WRITE_TOKEN_TTL_SECONDS;
      if (payload.expiresAt - payload.issuedAt > maxTtl) return null;
      if (options.authRevokedTokenIds?.has(payload.tokenId)) return null;
    }
    if (requiredScope === "read" && !payload.scopes.includes("read")) return null;
    const allowed = payload.scopes.includes(requiredScope);
    return allowed ? { actorType: "user", actorId: payload.actorId.trim() } : null;
  } catch {
    return null;
  }
}

function isResearchTokenScope(scope: unknown): scope is ResearchTokenScope {
  return scope === "read" || scope === "write" || scope === "candidate_write" || scope === "research_write" || scope === "review_write";
}

function isValidActorId(value: string): boolean {
  return value.length > 0 && value.length <= 200;
}

function sign(encodedPayload: string, signingKey: string): string {
  return createHmac("sha256", signingKey).update(encodedPayload).digest("base64url");
}

function sameSignature(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

export function derivePinganSnapshotAccountScope(
  actor: AuthenticatedResearchActor,
  options: ResearchAuthOptions
): string | null {
  const configuredScope = options.pinganSnapshotAccountScopesByActor?.[actor.actorId]?.trim();
  if (configuredScope) return configuredScope;
  if (actor.actorType === "system" && actor.actorId === options.writeActorId) return "owner-main";
  return null;
}
