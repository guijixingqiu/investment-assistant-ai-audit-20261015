import type { CandidateMembershipData } from "../../../packages/contracts/src/candidateMembership.js";
import { sameWebApiAuth, type WebApiAuth, WebApiClient } from "./apiClient.js";
import {
  candidateOverviewFromEnvelope,
  failClosedCandidateOverview,
  initialCandidateOverview,
  loadingCandidateOverview,
  type CandidateOverviewRenderModel
} from "./candidateOverviewState.js";
import {
  candidateMembershipsFromEnvelope,
  failClosedCandidateMemberships,
  initialCandidateMemberships,
  loadingCandidateMemberships,
  membershipActionFailure,
  membershipActionLoading,
  membershipActionSuccess,
  type CandidateMembershipRenderModel
} from "./candidateMembershipState.js";
import {
  candidateDecisionIntakeFromEnvelope,
  failClosedCandidateDecisionIntake,
  initialCandidateDecisionIntake,
  loadingCandidateDecisionIntake,
  type CandidateDecisionIntakeRenderModel
} from "./candidateDecisionIntakeState.js";
import { input, readCandidateMembershipCreateForm } from "./view.js";

type FailureState = "unauthorized" | "not_found" | "conflict" | "malformed" | "offline" | "unavailable";

export interface CandidateWorkflowControllerDependencies {
  client: WebApiClient;
  overviewAuth: () => WebApiAuth | null;
  readAuth: () => WebApiAuth | null;
  writeAuth: () => WebApiAuth | null;
  paint: () => void;
  clearAssist: (state: FailureState, message: string, membershipId: string | null, localRecordMessage: string) => void;
  invalidatePortfolioLab: (message: string) => void;
  hasAssistPath: () => boolean;
}

export class CandidateWorkflowController {
  overview: CandidateOverviewRenderModel = initialCandidateOverview;
  overviewBusy = false;
  memberships: CandidateMembershipRenderModel = initialCandidateMemberships;
  membershipBusy = false;
  decisionIntake: CandidateDecisionIntakeRenderModel = initialCandidateDecisionIntake;
  decisionIntakeBusy = false;

  private overviewGeneration = 0;
  private membershipGeneration = 0;
  private decisionIntakeGeneration = 0;

  constructor(private readonly dependencies: CandidateWorkflowControllerDependencies) {}

  hasLoadedPath(): boolean {
    return this.decisionIntake.state !== "idle" || this.dependencies.hasAssistPath();
  }

  clearDecisionPath(state: FailureState, message: string, localRecordMessage: string): void {
    this.decisionIntakeGeneration += 1;
    this.decisionIntakeBusy = false;
    this.decisionIntake = failClosedCandidateDecisionIntake(state, message);
    this.dependencies.clearAssist(state, message, null, localRecordMessage);
  }

  invalidateAuthorization(message: string): void {
    this.overviewGeneration += 1;
    this.membershipGeneration += 1;
    this.overviewBusy = false;
    this.membershipBusy = false;
    this.overview = failClosedCandidateOverview("unauthorized", message);
    this.memberships = {
      ...failClosedCandidateMemberships("unauthorized", message),
      action: membershipActionFailure("unauthorized", message)
    };
    this.clearDecisionPath("unauthorized", message, "Runtime authorization changed; local records are hidden until current source facts reload.");
    this.dependencies.paint();
  }

  async refreshOverview(): Promise<void> {
    const currentAuth = this.dependencies.overviewAuth();
    const generation = ++this.overviewGeneration;
    if (!currentAuth) {
      this.overviewBusy = false;
      this.overview = failClosedCandidateOverview("unauthorized", "Runtime token is required before loading tracked candidates.");
      this.dependencies.paint();
      return;
    }
    this.overviewBusy = true;
    this.overview = loadingCandidateOverview();
    this.dependencies.paint();
    const result = await this.dependencies.client.loadCandidateOverview(currentAuth);
    if (generation !== this.overviewGeneration) return;
    this.overviewBusy = false;
    this.overview = result.ok ? candidateOverviewFromEnvelope(result.value) : failClosedCandidateOverview(result.state, result.reason);
    this.dependencies.paint();
  }

  async refreshMemberships(includeArchivedOverride?: boolean): Promise<void> {
    this.dependencies.invalidatePortfolioLab("Candidate membership source is refreshing; previous portfolio scenarios were discarded.");
    const currentAuth = this.dependencies.readAuth();
    const generation = ++this.membershipGeneration;
    if (!currentAuth) {
      this.membershipBusy = false;
      this.memberships = failClosedCandidateMemberships("unauthorized", "Runtime read token is required before loading candidate memberships.", this.memberships);
      this.decisionIntake = failClosedCandidateDecisionIntake("unauthorized", "Runtime read token is required before loading decision intake.");
      this.dependencies.clearAssist("unauthorized", "Runtime read token is required before loading downstream ASSIST facts.", null, "Runtime read token is required before displaying local records.");
      this.dependencies.paint();
      return;
    }
    this.membershipBusy = true;
    this.memberships = loadingCandidateMemberships(this.memberships);
    this.dependencies.paint();
    const includeArchivedInput = input("membership-include-archived") as HTMLInputElement;
    const includeArchived = includeArchivedOverride ?? includeArchivedInput.checked;
    const result = await this.dependencies.client.loadCandidateMemberships(currentAuth, includeArchived);
    if (generation !== this.membershipGeneration) return;
    this.membershipBusy = false;
    if (!sameWebApiAuth(currentAuth, this.dependencies.readAuth())) {
      this.memberships = failClosedCandidateMemberships("unauthorized", "Runtime read authorization changed during membership refresh.", this.memberships);
      this.decisionIntake = failClosedCandidateDecisionIntake("unauthorized", "Runtime read authorization changed during membership refresh.");
      this.dependencies.clearAssist("unauthorized", "Runtime read authorization changed during membership refresh.", null, "Runtime authorization changed; local records are hidden until current source facts reload.");
      this.dependencies.paint();
      return;
    }
    if (!result.ok) {
      this.memberships = failClosedCandidateMemberships(result.state, result.reason, this.memberships);
      this.decisionIntake = failClosedCandidateDecisionIntake(result.state, result.reason);
      this.dependencies.clearAssist(result.state, result.reason, null, "Membership load failed; local records are hidden until current source facts are available.");
      this.dependencies.paint();
      return;
    }
    if (includeArchivedOverride !== undefined) includeArchivedInput.checked = includeArchivedOverride;
    this.memberships = candidateMembershipsFromEnvelope(result.value, this.memberships);
    if (this.hasLoadedPath()) {
      const message = "Candidate membership source refreshed; reload decision intake before using downstream ASSIST facts.";
      this.clearDecisionPath("unavailable", message, "Membership source changed; local records are hidden until current source facts reload.");
    }
    this.dependencies.paint();
  }

  async loadDecisionIntake(membershipId: string): Promise<void> {
    this.dependencies.invalidatePortfolioLab("Decision intake is refreshing; previous quote-bound portfolio scenarios were discarded.");
    const currentAuth = this.dependencies.readAuth();
    const generation = ++this.decisionIntakeGeneration;
    if (!currentAuth) {
      this.decisionIntakeBusy = false;
      this.decisionIntake = failClosedCandidateDecisionIntake("unauthorized", "Runtime read token is required before loading decision intake.", membershipId);
      this.dependencies.clearAssist("unauthorized", "Runtime read token is required before loading downstream ASSIST facts.", membershipId, "Runtime read token is required before displaying local records.");
      this.dependencies.paint();
      return;
    }
    this.decisionIntakeBusy = true;
    this.decisionIntake = loadingCandidateDecisionIntake(membershipId);
    this.dependencies.clearAssist("unavailable", "Decision-intake source is loading; downstream ASSIST facts must reload for the current membership.", membershipId, "Decision-intake source is loading; local records are hidden until current downstream facts reload.");
    this.dependencies.paint();
    const result = await this.dependencies.client.loadCandidateDecisionIntake(currentAuth, membershipId);
    if (generation !== this.decisionIntakeGeneration) return;
    this.decisionIntakeBusy = false;
    if (!result.ok) {
      this.decisionIntake = failClosedCandidateDecisionIntake(result.state, result.reason, membershipId);
      this.dependencies.clearAssist(result.state, result.reason, membershipId, "Decision-intake load failed; local records are hidden until current source facts are available.");
    } else {
      this.decisionIntake = candidateDecisionIntakeFromEnvelope(result.value);
    }
    this.dependencies.paint();
  }

  async createMembership(): Promise<CandidateMembershipData | null> {
    this.dependencies.invalidatePortfolioLab("Candidate membership source is changing; previous portfolio scenarios were discarded.");
    const currentAuth = this.dependencies.writeAuth();
    const generation = ++this.membershipGeneration;
    if (!currentAuth) {
      this.setActionFailure("unauthorized", "Runtime write token is required before changing candidate memberships.");
      return null;
    }
    const payload = readCandidateMembershipCreateForm();
    if (!/^\d{5}$/.test(payload.code)) {
      this.setActionFailure("malformed", "Candidate membership code must be five digits.");
      return null;
    }
    this.membershipBusy = true;
    this.memberships = { ...this.memberships, action: membershipActionLoading(payload.restoreArchived ? "Restoring archived membership." : "Creating candidate membership.") };
    this.dependencies.paint();
    const result = await this.dependencies.client.createCandidateMembership(currentAuth, payload);
    if (generation !== this.membershipGeneration) return null;
    this.membershipBusy = false;
    if (!result.ok) {
      this.setActionFailure(result.state, result.reason);
      return null;
    }
    if (!sameWebApiAuth(currentAuth, this.dependencies.writeAuth())) {
      this.setActionFailure("unauthorized", "Runtime write authorization changed before membership readback.");
      return null;
    }
    this.memberships = { ...this.memberships, action: membershipActionSuccess(result.value.result, `${result.value.result}: ${result.value.message}`) };
    await this.refreshMemberships(true);
    const written = result.value.data;
    const matches = this.memberships.memberships.filter((item) => item.id === written.id
      && item.actorId === written.actorId && item.market === written.market && item.code === written.code
      && item.symbol === written.symbol && item.state === written.state && item.version === written.version);
    if (matches.length !== 1 || written.state === "archived" || !sameWebApiAuth(currentAuth, this.dependencies.writeAuth())) {
      this.setActionFailure("conflict", "Membership write result is UNKNOWN until one exact active id, symbol, version, actor, and authorization fresh-read matches.");
      return null;
    }
    this.dependencies.client.confirmCandidateMembershipCreate(currentAuth, payload);
    return matches[0];
  }

  async updateMembershipState(membershipId: string, state: "tracked" | "paused" | "archived", version: number): Promise<void> {
    this.dependencies.invalidatePortfolioLab("Candidate membership version is changing; previous portfolio scenarios were discarded.");
    const currentAuth = this.dependencies.writeAuth();
    const generation = ++this.membershipGeneration;
    if (!currentAuth) {
      this.setActionFailure("unauthorized", "Runtime write token is required before changing candidate memberships.");
      return;
    }
    this.membershipBusy = true;
    this.memberships = { ...this.memberships, action: membershipActionLoading(`Submitting ${state} with server version ${version}.`) };
    this.dependencies.paint();
    const result = await this.dependencies.client.updateCandidateMembershipState(currentAuth, membershipId, state, version);
    if (generation !== this.membershipGeneration) return;
    this.membershipBusy = false;
    if (!result.ok) {
      this.setActionFailure(result.state, result.reason);
      return;
    }
    this.memberships = { ...this.memberships, action: membershipActionSuccess(result.value.result, `${result.value.result}: ${result.value.message}`) };
    await this.refreshMemberships();
  }

  private setActionFailure(state: FailureState, message: string): void {
    this.memberships = { ...this.memberships, action: membershipActionFailure(state, message) };
    this.dependencies.paint();
  }
}
