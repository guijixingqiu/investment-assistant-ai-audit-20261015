import type { PoolClient } from "pg";
import type {
  CreateEvidenceRequest,
  UpdateResearchProfileRequest
} from "../../../../packages/contracts/src/research.js";
import type { CreateResearchContextRequest, ResearchContextSnapshotData } from "../../../../packages/contracts/src/researchContext.js";
import {
  CandidateMembershipConflictError,
  CandidateMembershipNotFoundError,
  CandidateMembershipVersionConflictError
} from "./domain.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { findCandidateMembershipByIdForUpdate } from "./candidateMembershipPersistence.js";
import type { CandidateMembershipRow } from "./candidateMembershipMappers.js";

export interface CandidateBoundResearchWrite {
  membershipId: string;
  membershipVersion: number;
}

export async function assertCandidateResearchWriteBinding(
  client: PoolClient,
  actor: AuthenticatedResearchActor,
  request: CandidateBoundResearchWrite,
  normalized: { market: string; code: string; symbol: string }
): Promise<CandidateMembershipRow> {
  const membership = await assertCandidateMembershipWriteBinding(client, actor, request);
  if (membership.market !== normalized.market || membership.code !== normalized.code || membership.symbol !== normalized.symbol) {
    throw new CandidateMembershipConflictError("candidate membership does not match the requested research symbol");
  }
  return membership;
}

export async function assertCandidateMembershipWriteBinding(
  client: PoolClient,
  actor: AuthenticatedResearchActor,
  request: CandidateBoundResearchWrite
): Promise<CandidateMembershipRow> {
  const membership = await findCandidateMembershipByIdForUpdate(client, actor, request.membershipId);
  if (!membership) throw new CandidateMembershipNotFoundError();
  if (Number(membership.version) !== request.membershipVersion) {
    throw new CandidateMembershipVersionConflictError("candidate membership version is stale; refresh before writing research facts");
  }
  if (membership.state === "archived") {
    throw new CandidateMembershipConflictError("archived candidate membership cannot accept research writes");
  }
  return membership;
}

export function preservesCurrentResearchContextItems(current: ResearchContextSnapshotData, request: CreateResearchContextRequest): boolean {
  const preservesFacts = (facts: ResearchContextSnapshotData["selectedFacts"], next: CreateResearchContextRequest["selectedFacts"]) =>
    facts.every((fact) => next.some((candidate) => candidate.id === fact.id
      || (candidate.symbol === fact.symbol && candidate.metric === fact.metric
        && candidate.periodStart === fact.periodStart && candidate.periodEnd === fact.periodEnd)));
  const preservesDrivers = (drivers: ResearchContextSnapshotData["macroDrivers"], next: CreateResearchContextRequest["macroDrivers"]) =>
    drivers.every((driver) => next.some((candidate) => candidate.id === driver.id));
  const preservesById = <T extends { id: string }>(items: T[], next: T[]) =>
    items.every((item) => next.some((candidate) => candidate.id === item.id));
  return preservesFacts(current.selectedFacts, request.selectedFacts)
    && preservesFacts(current.peerFacts, request.peerFacts)
    && preservesById(current.peers, request.peers)
    && preservesById(current.operatingKpis, request.operatingKpis)
    && preservesDrivers(current.macroDrivers, request.macroDrivers)
    && preservesDrivers(current.industryDrivers, request.industryDrivers);
}

export function sameBoundResearchWriteReplay<TData>(
  existing: {
    envelope: { source: { actorType: string; actorId: string | null; correlationId: string | null } };
    requestFingerprint: string | null;
    candidateMembershipId: string | null;
    candidateMembershipVersion: number | null;
  },
  actor: AuthenticatedResearchActor,
  request: Pick<UpdateResearchProfileRequest | CreateEvidenceRequest | CandidateBoundResearchWrite, "membershipId" | "membershipVersion">,
  requestFingerprint: string
): boolean {
  return existing.envelope.source.actorType === actor.actorType
    && existing.envelope.source.actorId === actor.actorId
    && existing.envelope.source.correlationId === null
    && existing.requestFingerprint === requestFingerprint
    && existing.candidateMembershipId === request.membershipId
    && existing.candidateMembershipVersion === request.membershipVersion;
}
