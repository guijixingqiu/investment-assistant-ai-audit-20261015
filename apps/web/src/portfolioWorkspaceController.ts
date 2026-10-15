import type {
  PortfolioDecisionContextEnvelope,
  PortfolioRiskImpactEnvelope
} from "../../../packages/contracts/src/portfolioDecisionContextBrowser.js";
import { validatePortfolioRiskImpactBindingForBrowser } from "../../../packages/contracts/src/portfolioDecisionContextBrowser.js";
import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";
import { validateDecisionSnapshotStateForBrowser } from "../../../packages/contracts/src/decisionSnapshotBrowser.js";
import {
  DECISION_SNAPSHOT_SCHEMA_VERSION,
  portfolioSnapshotStateFromContextStatus,
  validateDecisionSnapshotBinding,
  type DecisionSnapshotBinding
} from "../../../packages/contracts/src/decisionSnapshotContract.js";
import { sameWebApiAuth, type WebApiAuth, type WebApiClient, type WebFailureState } from "./apiClient.js";
import type { CanonicalSecuritySymbol } from "./securitySymbol.js";
import type { PreTradeDecisionCheckData } from "../../../packages/contracts/src/decisionContextBrowser.js";
import {
  buildPostDecisionPortfolioReviewBindingForBrowser,
  type PostDecisionPortfolioReviewBinding
} from "../../../packages/contracts/src/postDecisionPortfolioReviewBrowser.js";
import type { AnnualPortfolioLabEnvelope } from "../../../packages/contracts/src/annualPortfolioLabBrowser.js";
import { loadAnnualPortfolioLab, type WebAnnualPortfolioLabResponse } from "./annualPortfolioLabApiClient.js";
export type PortfolioWorkspaceUiState = "idle" | "loading" | "available" | "stale" | "partial" | "zero_position" | "empty" | "conflict" | "unauthorized" | "not_found" | "offline" | "unavailable" | "malformed";

export interface PortfolioWorkspaceViewState {
  state: PortfolioWorkspaceUiState;
  message: string;
  context: PortfolioDecisionContextEnvelope | null;
  riskImpact: PortfolioRiskImpactEnvelope | null;
  lab: AnnualPortfolioLabEnvelope | null;
  comparedLab: AnnualPortfolioLabEnvelope | null;
  comparedLabMessage: string;
  contextBusy: boolean;
  riskBusy: boolean;
  labBusy: boolean;
  comparedLabBusy: boolean;
}

export interface PortfolioLabMembershipIdentity {
  membershipId: string;
  membershipVersion: number;
  symbol: string;
}

export interface PortfolioWorkspaceDependencies {
  client: WebApiClient;
  auth: () => WebApiAuth | null;
  currentSymbol: () => CanonicalSecuritySymbol | null;
  currentMembership: () => { membershipId: string | null; membershipVersion: number | null; symbol: string | null };
  currentMembershipById?: (membershipId: string) => PortfolioLabMembershipIdentity | null;
  portfolioLabLoader?: (auth: WebApiAuth, membershipId: string, membershipVersion: number, symbol: string, scenarioAmounts: number[]) => Promise<WebAnnualPortfolioLabResponse>;
  render: (state: PortfolioWorkspaceViewState) => void;
}

export class PortfolioWorkspaceController {
  private generation = 0;
  private riskGeneration = 0;
  private labGeneration = 0;
  private comparedLabGeneration = 0;
  private contextAuth: WebApiAuth | null = null;
  readonly viewState: PortfolioWorkspaceViewState = {
    state: "idle",
    message: "Load a candidate to read the current portfolio.",
    context: null,
    riskImpact: null,
    lab: null,
    comparedLab: null,
    comparedLabMessage: "Select another tracked membership to compare the same user amounts.",
    contextBusy: false,
    riskBusy: false,
    labBusy: false,
    comparedLabBusy: false
  };

  constructor(private readonly dependencies: PortfolioWorkspaceDependencies) {}

  get busy(): boolean {
    return this.viewState.contextBusy || this.viewState.riskBusy || this.viewState.labBusy;
  }

  render(): void {
    this.dependencies.render(this.viewState);
  }

  decisionSnapshotBinding(): DecisionSnapshotBinding {
    if (this.busy) throw new Error("Decision-time portfolio facts are still loading.");
    const context = this.viewState.context;
    const boundContext = context && context.status !== "unauthorized" && context.accountScopeId
      ? context
      : null;
    if (boundContext && !this.hasCurrentContextAuth()) {
      throw new Error("Read authorization changed; visible portfolio facts are no longer authorized.");
    }
    const risk = boundContext && this.viewState.riskImpact?.status === "available"
      ? this.viewState.riskImpact
      : null;
    const binding: DecisionSnapshotBinding = {
      schemaVersion: DECISION_SNAPSHOT_SCHEMA_VERSION,
      portfolioContext: boundContext ? {
        state: portfolioSnapshotStateFromContextStatus(boundContext.status),
        contextId: boundContext.contextId,
        portfolioSnapshotId: boundContext.portfolioSnapshotId,
        accountScopeId: boundContext.accountScopeId
      } : {
        state: "not_captured",
        contextId: null,
        portfolioSnapshotId: null,
        accountScopeId: null
      },
      riskImpact: risk ? {
        availability: "captured",
        impactId: risk.impactId,
        calculationVersion: risk.calculationVersion,
        contextId: risk.contextId,
        portfolioSnapshotId: risk.portfolioSnapshotId,
        candidateSymbol: risk.candidateSymbol,
        hypotheticalAmount: risk.hypotheticalAmount
      } : {
        availability: "not_captured",
        impactId: null,
        calculationVersion: null,
        contextId: null,
        portfolioSnapshotId: null,
        candidateSymbol: null,
        hypotheticalAmount: null
      }
    };
    const validation = validateDecisionSnapshotBinding(binding);
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    return binding;
  }

  matchesDecisionSnapshotBinding(expected: DecisionSnapshotBinding): boolean {
    if (this.busy) return false;
    try {
      return canonicalJson(this.decisionSnapshotBinding()) === canonicalJson(expected);
    } catch {
      return false;
    }
  }

  async postDecisionPortfolioReviewBinding(
    check: PreTradeDecisionCheckData
  ): Promise<PostDecisionPortfolioReviewBinding | undefined> {
    if (this.busy) {
      throw new Error("Review-time portfolio facts are still loading.");
    }
    const generation = this.generation;
    const riskGeneration = this.riskGeneration;
    const context = this.viewState.context;
    const contextAuth = this.contextAuth;
    const decisionValidation = await validateDecisionSnapshotStateForBrowser(check.decisionSnapshot);
    if (!decisionValidation.ok) throw new Error(decisionValidation.errors.join("; "));
    const decisionPortfolio = decisionValidation.value.availability === "preserved"
      ? decisionValidation.value.snapshot?.portfolioContext.envelope ?? null
      : null;
    const decisionHasPositionFacts = Boolean(
      decisionPortfolio && ["available", "stale", "partial", "zero_position"].includes(decisionPortfolio.status)
    );
    const reviewHasAuthorizedScope = Boolean(
      context && context.status !== "unauthorized" && context.accountScopeId
    );
    if (reviewHasAuthorizedScope && !this.hasCurrentContextAuth()) {
      throw new Error("Read authorization changed; review-time portfolio facts are no longer authorized.");
    }
    const binding = decisionHasPositionFacts && context && reviewHasAuthorizedScope
      ? await buildPostDecisionPortfolioReviewBindingForBrowser(check.id, decisionValidation.value, context)
      : undefined;
    if (generation !== this.generation
      || riskGeneration !== this.riskGeneration
      || context !== this.viewState.context
      || !sameWebApiAuth(contextAuth, this.contextAuth)
      || (binding !== undefined && !this.hasCurrentContextAuth())
      || this.viewState.contextBusy
      || this.viewState.riskBusy) {
      throw new Error("Review-time portfolio facts changed while the binding was being verified.");
    }
    return binding;
  }

  async matchesPostDecisionPortfolioReviewBinding(
    check: PreTradeDecisionCheckData,
    expected: PostDecisionPortfolioReviewBinding | undefined
  ): Promise<boolean> {
    if (this.busy) return false;
    try {
      const current = await this.postDecisionPortfolioReviewBinding(check);
      return canonicalJson(current ?? null) === canonicalJson(expected ?? null);
    } catch {
      return false;
    }
  }

  clear(message: string): void {
    this.generation += 1;
    this.riskGeneration += 1;
    this.labGeneration += 1;
    this.clearComparedLabState(message);
    this.viewState.state = "idle";
    this.viewState.message = message;
    this.viewState.context = null;
    this.viewState.riskImpact = null;
    this.viewState.lab = null;
    this.contextAuth = null;
    this.viewState.contextBusy = false;
    this.viewState.riskBusy = false;
    this.viewState.labBusy = false;
    this.render();
  }

  invalidateLab(message: string): void {
    const hadVisibleOrPendingLab = Boolean(this.viewState.lab) || this.viewState.labBusy;
    this.labGeneration += 1;
    this.clearComparedLabState(message);
    this.viewState.lab = null;
    this.viewState.labBusy = false;
    if (!hadVisibleOrPendingLab) return;
    this.viewState.state = this.viewState.context?.status ?? "idle";
    this.viewState.message = message;
    this.render();
  }

  async load(): Promise<void> {
    const symbol = this.dependencies.currentSymbol();
    const auth = this.dependencies.auth();
    const generation = ++this.generation;
    this.riskGeneration += 1;
    this.labGeneration += 1;
    this.clearComparedLabState("Current portfolio is refreshing; the previous cross-stock comparison was discarded.");
    this.viewState.context = null;
    this.viewState.riskImpact = null;
    this.viewState.lab = null;
    this.contextAuth = null;
    this.viewState.contextBusy = false;
    this.viewState.riskBusy = false;
    this.viewState.labBusy = false;
    if (!symbol) {
      this.viewState.state = "idle";
      this.viewState.message = "Load a canonical Hong Kong candidate before reading portfolio context.";
      this.render();
      return;
    }
    if (!auth) {
      this.viewState.state = "unauthorized";
      this.viewState.message = "Read authorization is required for the account-scoped Pingan portfolio.";
      this.render();
      return;
    }

    this.viewState.state = "loading";
    this.viewState.message = `Loading current portfolio for ${symbol.symbol}.`;
    this.viewState.contextBusy = true;
    this.render();
    const result = await this.dependencies.client.loadPortfolioDecisionContext(auth);
    if (generation !== this.generation) return;
    this.viewState.contextBusy = false;
    if (!sameWebApiAuth(auth, this.dependencies.auth())) {
      this.failClosedForAuthChange("Read authorization changed while the portfolio was loading; previous facts were discarded.");
      return;
    }
    if (!result.ok) {
      this.viewState.state = failureState(result.state);
      this.viewState.message = result.reason;
      this.viewState.context = null;
      this.render();
      return;
    }
    this.viewState.context = result.value;
    this.contextAuth = { ...auth };
    this.viewState.state = result.value.status;
    this.viewState.message = result.value.message;
    this.render();
  }

  async calculateRisk(hypotheticalAmount: number): Promise<void> {
    const symbol = this.dependencies.currentSymbol();
    const auth = this.dependencies.auth();
    const context = this.viewState.context;
    const generation = ++this.riskGeneration;
    this.labGeneration += 1;
    this.viewState.riskImpact = null;
    this.viewState.lab = null;
    this.viewState.labBusy = false;
    if (!symbol || !context) {
      this.clear("Current candidate and portfolio context are required before risk calculation.");
      return;
    }
    if (!auth || !sameWebApiAuth(this.contextAuth, auth)) {
      this.failClosedForAuthChange("Read authorization changed; portfolio facts were cleared before risk calculation.");
      return;
    }
    if (!Number.isFinite(hypotheticalAmount) || hypotheticalAmount < 0) {
      this.viewState.message = "Hypothetical amount must be a non-negative number."; this.render(); return;
    }
    if (context.dataUse.advisoryRiskImpact !== "allowed_current_development_only") {
      this.viewState.message = "Risk impact remains blocked for this portfolio state."; this.render(); return;
    }
    this.viewState.riskBusy = true;
    this.render();
    const result = await this.dependencies.client.loadPortfolioRiskImpact(auth, symbol, hypotheticalAmount, context);
    if (generation !== this.riskGeneration) return;
    this.viewState.riskBusy = false;
    if (!sameWebApiAuth(auth, this.dependencies.auth()) || !sameWebApiAuth(this.contextAuth, auth)) {
      this.failClosedForAuthChange("Read authorization changed while risk impact was loading; previous facts were discarded.");
      return;
    }
    if (!result.ok) {
      this.viewState.state = failureState(result.state);
      this.viewState.context = null;
      this.viewState.riskImpact = null;
      this.contextAuth = null;
      this.viewState.message = result.reason;
      this.render();
      return;
    }
    if (result.value.status !== "available") {
      this.viewState.state = "unavailable";
      this.viewState.context = null;
      this.viewState.riskImpact = result.value;
      this.contextAuth = null;
      this.viewState.message = result.value.message;
      this.render();
      return;
    }
    const binding = validatePortfolioRiskImpactBindingForBrowser(result.value, context, symbol.symbol, hypotheticalAmount);
    if (!binding.ok) {
      this.viewState.state = "conflict";
      this.viewState.context = null;
      this.viewState.riskImpact = null;
      this.contextAuth = null;
      this.viewState.message = binding.errors.join("; ");
      this.render();
      return;
    }
    this.viewState.riskImpact = result.value;
    this.viewState.message = result.value.message;
    this.render();
  }
  async calculateLab(scenarioAmounts: number[]): Promise<void> {
    if (this.viewState.contextBusy || this.viewState.riskBusy) return;
    const symbol = this.dependencies.currentSymbol();
    const membership = this.dependencies.currentMembership();
    const auth = this.dependencies.auth();
    const generation = ++this.generation;
    const labGeneration = ++this.labGeneration;
    this.clearComparedLabState("Current stock scenarios are refreshing; the previous cross-stock comparison was discarded.");
    this.riskGeneration += 1;
    this.viewState.lab = null;
    this.viewState.riskImpact = null;
    this.viewState.labBusy = false;
    if (!symbol || !membership.membershipId || !membership.membershipVersion || membership.symbol !== symbol.symbol) {
      this.viewState.state = "unavailable";
      this.viewState.message = "Load the exact selected candidate membership before running the portfolio lab.";
      this.render();
      return;
    }
    if (!auth) {
      this.failClosedForAuthChange("Read authorization is required for the account-bound portfolio lab.");
      return;
    }
    if (this.viewState.context && !sameWebApiAuth(this.contextAuth, auth)) { this.failClosedForAuthChange("Read authorization changed; portfolio facts were cleared before running the portfolio lab."); return; }
    if (this.viewState.context && !["available", "stale"].includes(this.viewState.context.status)) { this.viewState.state = this.viewState.context.status; this.viewState.message = "Portfolio lab remains blocked for this portfolio state."; this.render(); return; }
    if (scenarioAmounts.length < 1 || scenarioAmounts.length > 4
      || scenarioAmounts.some((amount) => !Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_000)) {
      this.viewState.state = "malformed";
      this.viewState.message = "Enter one to four non-negative user amounts in source order.";
      this.render();
      return;
    }
    this.viewState.labBusy = true;
    this.viewState.message = `Loading account-bound portfolio scenarios for ${symbol.symbol}.`;
    this.render();
    const loader = this.dependencies.portfolioLabLoader ?? loadAnnualPortfolioLab;
    const result = await loader(auth, membership.membershipId, membership.membershipVersion, symbol.symbol, scenarioAmounts);
    if (generation !== this.generation || labGeneration !== this.labGeneration) return;
    this.viewState.labBusy = false;
    const currentMembership = this.dependencies.currentMembership();
    if (!sameWebApiAuth(auth, this.dependencies.auth())) {
      this.failClosedForAuthChange("Portfolio lab source identity changed in flight; all previous scenarios were discarded.");
      return;
    }
    if (currentMembership.membershipId !== membership.membershipId
      || currentMembership.membershipVersion !== membership.membershipVersion
      || currentMembership.symbol !== membership.symbol || this.dependencies.currentSymbol()?.symbol !== symbol.symbol) {
      this.failClosedForSourceChange("Portfolio lab membership, version, or symbol changed in flight; all previous scenarios were discarded.");
      return;
    }
    if (!result.ok || !result.value.data) {
      this.viewState.state = result.ok ? "unavailable" : failureState(result.state);
      this.viewState.context = null;
      this.viewState.riskImpact = null;
      this.viewState.lab = null;
      this.contextAuth = null;
      this.viewState.message = result.ok ? result.value.message : result.reason;
      this.render();
      return;
    }
    this.viewState.context = result.value.data.portfolio;
    this.contextAuth = { ...auth };
    this.viewState.lab = result.value;
    this.viewState.state = "available";
    this.viewState.message = result.value.message;
    this.render();
  }

  async compareLab(target: PortfolioLabMembershipIdentity, scenarioAmounts: number[]): Promise<void> {
    if (this.viewState.labBusy || this.viewState.comparedLabBusy) return;
    const currentMembership = this.dependencies.currentMembership();
    const currentLab = this.viewState.lab?.data;
    const auth = this.dependencies.auth();
    if (!currentLab || !currentMembership.membershipId || !currentMembership.membershipVersion
      || currentLab.target.membershipId !== currentMembership.membershipId
      || currentLab.target.membershipVersion !== currentMembership.membershipVersion
      || currentLab.target.symbol !== currentMembership.symbol) {
      this.invalidateComparedLab("Load the current stock portfolio lab before comparing another stock.");
      return;
    }
    if (!auth || !validPortfolioLabComparisonInput(target, currentMembership.membershipId, scenarioAmounts)) {
      this.invalidateComparedLab("Select another exact tracked membership and one to four valid user amounts.");
      return;
    }
    const generation = ++this.comparedLabGeneration;
    this.viewState.comparedLab = null;
    this.viewState.comparedLabBusy = true;
    this.viewState.comparedLabMessage = `Loading the same user amounts for ${target.symbol}.`;
    this.render();
    const loader = this.dependencies.portfolioLabLoader ?? loadAnnualPortfolioLab;
    const result = await loader(auth, target.membershipId, target.membershipVersion, target.symbol, scenarioAmounts);
    if (generation !== this.comparedLabGeneration) return;
    this.viewState.comparedLabBusy = false;
    const freshCurrent = this.dependencies.currentMembership();
    const freshTarget = this.dependencies.currentMembershipById?.(target.membershipId) ?? null;
    if (!sameWebApiAuth(auth, this.dependencies.auth())
      || this.viewState.lab?.data !== currentLab
      || freshCurrent.membershipId !== currentMembership.membershipId
      || freshCurrent.membershipVersion !== currentMembership.membershipVersion
      || freshCurrent.symbol !== currentMembership.symbol
      || !freshTarget || freshTarget.membershipVersion !== target.membershipVersion || freshTarget.symbol !== target.symbol) {
      this.invalidateComparedLab("Membership, authorization, or current portfolio scenarios changed in flight; the comparison was discarded.");
      return;
    }
    if (!result.ok || !result.value.data) {
      this.viewState.comparedLab = null;
      this.viewState.comparedLabMessage = result.ok ? result.value.message : result.reason;
      this.render();
      return;
    }
    const compared = result.value.data;
    if (compared.target.membershipId !== target.membershipId
      || compared.target.membershipVersion !== target.membershipVersion
      || compared.target.symbol !== target.symbol
      || compared.sourceIdentity.accountScopeId !== currentLab.sourceIdentity.accountScopeId
      || compared.sourceIdentity.portfolioSnapshotId !== currentLab.sourceIdentity.portfolioSnapshotId
      || compared.sourceIdentity.portfolioAsOf !== currentLab.sourceIdentity.portfolioAsOf) {
      this.invalidateComparedLab("The two reads do not share one exact Pingan portfolio snapshot; reload the current stock before comparing.");
      return;
    }
    this.viewState.comparedLab = result.value;
    this.viewState.comparedLabMessage = `Compared ${currentLab.target.symbol} and ${target.symbol} on one exact Pingan portfolio snapshot.`;
    this.render();
  }

  invalidateComparedLab(message: string): void {
    this.clearComparedLabState(message);
    this.render();
  }

  private clearComparedLabState(message: string): void {
    this.comparedLabGeneration += 1;
    this.viewState.comparedLab = null;
    this.viewState.comparedLabBusy = false;
    this.viewState.comparedLabMessage = message;
  }
  private hasCurrentContextAuth(): boolean {
    return Boolean(this.contextAuth && sameWebApiAuth(this.contextAuth, this.dependencies.auth()));
  }

  private failClosedForAuthChange(message: string): void {
    this.generation += 1;
    this.riskGeneration += 1;
    this.labGeneration += 1;
    this.clearComparedLabState(message);
    this.viewState.state = "unauthorized";
    this.viewState.message = message;
    this.viewState.context = null;
    this.viewState.riskImpact = null;
    this.viewState.lab = null;
    this.contextAuth = null;
    this.viewState.contextBusy = false;
    this.viewState.riskBusy = false;
    this.viewState.labBusy = false;
    this.render();
  }

  private failClosedForSourceChange(message: string): void {
    this.generation += 1;
    this.riskGeneration += 1;
    this.labGeneration += 1;
    this.clearComparedLabState(message);
    this.viewState.state = "conflict";
    this.viewState.message = message;
    this.viewState.context = null;
    this.viewState.riskImpact = null;
    this.viewState.lab = null;
    this.contextAuth = null;
    this.viewState.contextBusy = false;
    this.viewState.riskBusy = false;
    this.viewState.labBusy = false;
    this.render();
  }
}

function failureState(state: WebFailureState): PortfolioWorkspaceUiState {
  return state;
}

function validPortfolioLabComparisonInput(
  target: PortfolioLabMembershipIdentity,
  currentMembershipId: string,
  scenarioAmounts: number[]
): boolean {
  return /^[1-9]\d*$/.test(target.membershipId)
    && target.membershipId !== currentMembershipId
    && Number.isSafeInteger(target.membershipVersion)
    && target.membershipVersion >= 1
    && /^HK\.\d{5}$/.test(target.symbol)
    && scenarioAmounts.length >= 1
    && scenarioAmounts.length <= 4
    && scenarioAmounts.every((amount) => Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000_000_000);
}
