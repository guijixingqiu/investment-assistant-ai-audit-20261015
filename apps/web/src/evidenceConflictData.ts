import {
  validateCreateResearchMaterialRequest,
  validateDeepResearchWorkspaceEnvelope,
  validateResearchMaterialData,
  type CreateResearchMaterialRequest,
  type DeepResearchWorkspaceEnvelope,
  type ResearchMaterialData
} from "../../../packages/contracts/src/deepResearch.js";
import { validateResearchWriteEnvelopeBase } from "../../../packages/contracts/src/research.js";
import type { WebApiAuth } from "./apiClient.js";

export interface EvidenceConflictMembership {
  sourceKey: string;
  id: string;
  version: number;
  state: "tracked" | "paused";
  market: "HK";
  code: string;
  symbol: string;
}

export interface ReplacementResult {
  workspace: DeepResearchWorkspaceEnvelope;
  material: ResearchMaterialData;
  reconciled: boolean;
}

interface ReplacementOptions {
  membership: EvidenceConflictMembership;
  actorId: string;
  target: ResearchMaterialData;
  request: CreateResearchMaterialRequest;
  readAuth: WebApiAuth;
  writeAuth: WebApiAuth;
  ensureCurrent: () => void;
  fetcher?: typeof fetch;
}

export function acceptEvidenceConflictWorkspace(
  value: unknown,
  membership: EvidenceConflictMembership,
  actorId?: string
): DeepResearchWorkspaceEnvelope {
  const validation = validateDeepResearchWorkspaceEnvelope(value);
  if (!validation.ok) throw new Error(`Workspace is malformed: ${validation.errors.join("; ")}`);
  const envelope = value as DeepResearchWorkspaceEnvelope;
  const target = envelope.data?.target;
  if (envelope.status !== "available" || !target
    || envelope.membershipId !== membership.id || envelope.requestedSymbol !== membership.symbol
    || target.membershipId !== membership.id || target.membershipVersion !== membership.version
    || target.membershipState !== membership.state || target.market !== membership.market
    || target.code !== membership.code || target.symbol !== membership.symbol
    || actorId !== undefined && envelope.requestedActorId !== actorId) {
    throw new Error("Workspace no longer binds the exact membership, version, state, symbol, or actor.");
  }
  for (const conflict of currentEvidenceConflicts(envelope)) relatedMaterialRevisions(envelope, conflict);
  return envelope;
}

export function currentEvidenceConflicts(workspace: DeepResearchWorkspaceEnvelope): ResearchMaterialData[] {
  return (workspace.data?.materials ?? []).filter((material) => material.revisionState === "current"
    && (material.verificationStatus === "conflict" || material.verificationStatus === "rejected"));
}

export function relatedMaterialRevisions(
  workspace: DeepResearchWorkspaceEnvelope,
  target: ResearchMaterialData
): ResearchMaterialData[] {
  const byId = new Map((workspace.data?.materials ?? []).map((material) => [material.id, material]));
  const related: ResearchMaterialData[] = [];
  const visited = new Set([target.id]);
  let parentId = target.replacesMaterialId;
  while (parentId) {
    if (visited.has(parentId)) throw new Error("Material replacement chain is cyclic or ambiguous.");
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) throw new Error("Material replacement chain is incomplete.");
    related.push(parent);
    parentId = parent.replacesMaterialId;
  }
  return related;
}

export function exactCurrentConflict(
  workspace: DeepResearchWorkspaceEnvelope,
  expected: ResearchMaterialData
): ResearchMaterialData {
  const matches = currentEvidenceConflicts(workspace).filter((material) => sameMaterialIdentity(material, expected));
  if (matches.length !== 1) throw new Error("The selected current conflict changed or became ambiguous.");
  return matches[0];
}

export function sameMaterialIdentity(left: ResearchMaterialData, right: ResearchMaterialData): boolean {
  return left.id === right.id && left.evidenceId === right.evidenceId && left.symbol === right.symbol
    && left.revision === right.revision && left.revisionState === right.revisionState
    && left.contentFingerprint === right.contentFingerprint && left.sourceType === right.sourceType
    && left.sourceUrl === right.sourceUrl && left.sourceVersion === right.sourceVersion
    && left.verificationStatus === right.verificationStatus
    && JSON.stringify(left.citation ?? null) === JSON.stringify(right.citation ?? null);
}

export function safeHttpsSource(material: ResearchMaterialData): string | null {
  if (!material.sourceUrl) return null;
  try { return new URL(material.sourceUrl).protocol === "https:" ? material.sourceUrl : null; } catch { return null; }
}

export async function readEvidenceConflictWorkspace(
  membership: EvidenceConflictMembership,
  auth: WebApiAuth,
  actorId?: string,
  fetcher: typeof fetch = fetch
): Promise<DeepResearchWorkspaceEnvelope> {
  const value = await requestJson(
    `/api/mobile/research/candidate-memberships/${encodeURIComponent(membership.id)}/deep-research`,
    auth,
    { cache: "no-store" },
    fetcher
  );
  return acceptEvidenceConflictWorkspace(value, membership, actorId);
}

export async function replaceEvidenceConflict(options: ReplacementOptions): Promise<ReplacementResult> {
  const fetcher = options.fetcher ?? fetch;
  const validation = validateCreateResearchMaterialRequest(options.request);
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  const before = await readEvidenceConflictWorkspace(options.membership, options.readAuth, options.actorId, fetcher);
  options.ensureCurrent();
  const reconciled = reconcileExistingReplacement(before, options.target, options.request);
  if (reconciled) return { workspace: before, material: reconciled, reconciled: true };
  const target = exactCurrentConflict(before, options.target);
  if (options.request.membershipId !== options.membership.id || options.request.membershipVersion !== options.membership.version
    || options.request.replacesMaterialId !== target.id || options.request.sourceType !== target.sourceType
    || (options.request.sourceUrl ?? null) !== target.sourceUrl || options.request.rightsStatus !== target.rightsStatus
    || options.request.claimType !== target.claimType || options.request.sourceVersion === target.sourceVersion) {
    throw new Error("Replacement request does not preserve the exact membership, source, rights, claim, or revision identity.");
  }
  if (target.sourceType === "owner_provided_pdf") throw new Error("PDF replacements must use the exact-page confirmed-fact control.");
  if (target.sourceUrl && !safeHttpsSource(target)) throw new Error("Unsafe non-HTTPS material sources cannot be replaced from this Web control.");
  let value: unknown;
  try {
    value = await requestJson(
      `/api/mobile/research/profiles/${options.membership.market}/${options.membership.code}/materials`,
      options.writeAuth,
      { method: "POST", headers: {
        "content-type": "application/json",
        "x-research-expected-actor-id": options.actorId
      }, body: JSON.stringify(options.request) },
      fetcher
    );
  } catch (error) {
    if (error instanceof EvidenceConflictHttpError && error.status < 500) throw error;
    return recoverReplacement(options, before, error, fetcher);
  }
  options.ensureCurrent();
  let material: ResearchMaterialData;
  try { material = acceptReplacementWrite(value, options.actorId, target, options.request); }
  catch (error) { return recoverReplacement(options, before, error, fetcher); }
  const after = await readEvidenceConflictWorkspace(options.membership, options.readAuth, options.actorId, fetcher);
  options.ensureCurrent();
  assertReplacementReadback(before, after, target, material);
  return { workspace: after, material, reconciled: false };
}

export function acceptReplacementWrite(
  value: unknown,
  actorId: string,
  target: ResearchMaterialData,
  request: CreateResearchMaterialRequest
): ResearchMaterialData {
  const errors = validateResearchWriteEnvelopeBase(value, "write envelope");
  if (errors.length || !record(value) || !record(value.source) || !validateResearchMaterialData(value.data).ok) {
    throw new Error(`Replacement response is malformed: ${errors.join("; ") || "material data is invalid"}`);
  }
  const material = value.data as ResearchMaterialData;
  if (value.source.actorType !== "user" || value.source.actorId !== actorId || value.source.correlationId !== null
    || material.id === target.id || material.replacesMaterialId !== target.id
    || material.revision !== target.revision + 1 || material.revisionState !== "current"
    || !materialMatchesRequest(material, request)) {
    throw new Error("Replacement response does not bind the exact actor, target revision, or submitted evidence.");
  }
  return material;
}

export function assertReplacementReadback(
  before: DeepResearchWorkspaceEnvelope,
  after: DeepResearchWorkspaceEnvelope,
  target: ResearchMaterialData,
  material: ResearchMaterialData
): void {
  const materials = after.data?.materials ?? [];
  if (materials.filter((candidate) => sameMaterialIdentity(candidate, material)).length !== 1
    || materials.filter((candidate) => sameReplacedIdentity(candidate, target)).length !== 1) {
    throw new Error("Fresh workspace did not return the exact new current material and replaced conflict revision.");
  }
  const oldPack = before.data?.latestPack;
  const newPack = after.data?.latestPack;
  if (oldPack && (newPack?.id !== oldPack.id || newPack.packFingerprint !== oldPack.packFingerprint
    || newPack.currentness.status !== "historical" || !newPack.currentness.invalidatedBy.includes("material_set_changed"))) {
    throw new Error("The previous evidence pack was not fresh-read as historical after the material change.");
  }
  const oldReport = before.data?.latestReport;
  const newReport = after.data?.latestReport;
  if (oldReport && (newReport?.id !== oldReport.id || newReport.version !== oldReport.version
    || newReport.reportFingerprint !== oldReport.reportFingerprint || newReport.currentness.status !== "historical"
    || !newReport.currentness.evidencePackInvalidatedBy.includes("material_set_changed"))) {
    throw new Error("The previous report was not fresh-read as historical after the material change.");
  }
}

export async function requestJson(
  path: string,
  auth: WebApiAuth,
  init: RequestInit | undefined,
  fetcher: typeof fetch = fetch
): Promise<unknown> {
  let response: Response;
  try {
    const headers = new Headers(init?.headers);
    headers.set("accept", "application/json");
    headers.set(auth.headerName, auth.token);
    response = await fetcher(path, { ...init, headers });
  } catch (error) {
    throw new Error(error instanceof Error ? `Offline: ${error.message}` : "Offline: request failed.", { cause: error });
  }
  const value = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new EvidenceConflictHttpError(response.status, failureMessage(value, response.status));
  if (value === null) throw new Error("Response is not valid JSON.");
  return value;
}

export class EvidenceConflictHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function materialMatchesRequest(material: ResearchMaterialData, request: CreateResearchMaterialRequest): boolean {
  return material.title === request.title && material.contentText === request.contentText
    && material.sourceType === request.sourceType && material.sourceUrl === (request.sourceUrl ?? null)
    && material.publishedAt === request.publishedAt && material.claimType === request.claimType
    && material.verificationStatus === request.verificationStatus && material.rightsStatus === request.rightsStatus
    && material.sourceVersion === request.sourceVersion && material.validUntil === request.validUntil
    && material.summary === request.summary && material.variableName === (request.variableName ?? null)
    && material.stance === request.stance && material.reliability === (request.reliability ?? null)
    && material.materiality === (request.materiality ?? null) && material.isRead === (request.isRead ?? false);
}

function sameReplacedIdentity(material: ResearchMaterialData, target: ResearchMaterialData): boolean {
  return sameMaterialIdentity(material, { ...target, revisionState: "replaced" });
}

function reconcileExistingReplacement(
  workspace: DeepResearchWorkspaceEnvelope,
  target: ResearchMaterialData,
  request: CreateResearchMaterialRequest
): ResearchMaterialData | null {
  const materials = workspace.data?.materials ?? [];
  const replaced = materials.filter((material) => sameReplacedIdentity(material, target));
  if (replaced.length === 0) return null;
  if (replaced.length !== 1) throw new Error("The replaced target became ambiguous during idempotent readback.");
  const children = materials.filter((material) => material.revisionState === "current" && material.replacesMaterialId === target.id);
  if (children.length !== 1 || children[0].revision !== target.revision + 1 || !materialMatchesRequest(children[0], request)) {
    throw new Error("Fresh workspace could not reconcile exactly one current child with the original replacement intent.");
  }
  assertReplacementReadback(workspace, workspace, target, children[0]);
  return children[0];
}

async function recoverReplacement(
  options: ReplacementOptions,
  before: DeepResearchWorkspaceEnvelope,
  cause: unknown,
  fetcher: typeof fetch
): Promise<ReplacementResult> {
  options.ensureCurrent();
  try {
    const workspace = await readEvidenceConflictWorkspace(options.membership, options.readAuth, options.actorId, fetcher);
    options.ensureCurrent();
    const material = reconcileExistingReplacement(workspace, options.target, options.request);
    if (!material) throw new Error("The original target is still current.");
    return { workspace, material, reconciled: true };
  } catch (readbackError) {
    throw new Error(`Replacement response was unresolved (${failureMessage(cause, 503)}) and bounded fresh readback did not reconcile it: ${failureMessage(readbackError, 503)}`, { cause: readbackError });
  }
}

function failureMessage(value: unknown, status: number): string {
  if (!record(value)) return `HTTP ${status}`;
  const details = [value.message, ...(Array.isArray(value.errors) ? value.errors : [])]
    .filter((item): item is string => typeof item === "string");
  return details.join("; ") || `HTTP ${status}`;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
