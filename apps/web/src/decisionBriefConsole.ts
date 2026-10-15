import {
  validateAnnualDecisionBriefEnvelope,
  type AnnualDecisionBriefData,
  type AnnualDecisionBriefEnvelope
} from "../../../packages/contracts/src/annualDecisionBrief.js";
import type { CandidateMembershipData } from "../../../packages/contracts/src/candidateMembership.js";
import type { EvidenceItemData } from "../../../packages/contracts/src/research.js";
import { sameWebApiAuth, type WebApiAuth, type WebFailureState } from "./apiClient.js";
import type { InvestmentControlConsoleSource } from "./investmentControlConsoleController.js";

export interface DecisionBriefSource {
  sourceKey: string;
  membershipId: string;
  membershipVersion: number;
  membershipState: "tracked" | "paused";
  market: "HK";
  code: string;
  symbol: string;
  actorId: string;
  decisionContext: InvestmentControlConsoleSource["decisionContext"];
  portfolio: InvestmentControlConsoleSource["portfolio"];
}

export type DecisionBriefUiState = "idle" | "loading" | "ready_for_three_minute_review" | "research_required" | "blocked" | WebFailureState;
export interface DecisionBriefViewState { state: DecisionBriefUiState; message: string; envelope: AnnualDecisionBriefEnvelope | null; }
type DecisionBriefResult = { ok: true; value: AnnualDecisionBriefEnvelope } | { ok: false; state: WebFailureState; reason: string };

interface DecisionBriefConsoleDependencies {
  currentSource: () => DecisionBriefSource | null;
  readAuth: () => WebApiAuth | null;
  load?: typeof loadDecisionBrief;
  render?: (state: DecisionBriefViewState) => void;
}

export function decisionBriefSource(
  source: InvestmentControlConsoleSource | null,
  memberships: CandidateMembershipData[]
): DecisionBriefSource | null {
  if (!source || source.membershipState === "archived") return null;
  const exact = memberships.filter((item) => item.id === source.membershipId && item.version === source.membershipVersion
    && item.state === source.membershipState && item.symbol === source.symbol && item.market === source.market && item.code === source.code);
  if (exact.length !== 1 || !exact[0].actorId) return null;
  return {
    sourceKey: source.sourceKey,
    membershipId: source.membershipId,
    membershipVersion: source.membershipVersion,
    membershipState: source.membershipState,
    market: source.market,
    code: source.code,
    symbol: source.symbol,
    actorId: exact[0].actorId,
    decisionContext: source.decisionContext,
    portfolio: source.portfolio
  };
}

export async function loadDecisionBrief(
  source: DecisionBriefSource,
  auth: WebApiAuth,
  fetcher: typeof fetch = fetch
): Promise<DecisionBriefResult> {
  let response: Response;
  try {
    response = await fetcher(`/api/mobile/research/candidate-memberships/${encodeURIComponent(source.membershipId)}/decision-brief`, {
      cache: "no-store",
      headers: { [auth.headerName]: auth.token }
    });
  } catch (error) {
    return { ok: false, state: "offline", reason: error instanceof Error ? error.message : "Decision brief request failed." };
  }
  const value: unknown = await response.json().catch(() => null);
  const validation = validateAnnualDecisionBriefEnvelope(value);
  if (!validation.ok) {
    return { ok: false, state: response.ok ? "malformed" : httpFailure(response.status), reason: `Decision brief response is malformed: ${validation.errors.join("; ")}` };
  }
  const envelope = value as AnnualDecisionBriefEnvelope;
  if (!response.ok || envelope.status !== "available" || !envelope.data) {
    return { ok: false, state: response.ok ? "malformed" : httpFailure(response.status), reason: envelope.message };
  }
  if (!exactBriefIdentity(envelope, source)) {
    return { ok: false, state: "conflict", reason: "Decision brief actor, membership, symbol, or source identity drifted during the fresh read." };
  }
  return { ok: true, value: envelope };
}

export class DecisionBriefConsole {
  readonly viewState: DecisionBriefViewState = {
    state: "idle",
    message: "Load one exact non-archived membership, then explicitly refresh the daily decision brief.",
    envelope: null
  };
  private documentRef: Document | null = null;
  private generation = 0;
  private busy = 0;
  private sourceKey = "";

  constructor(private readonly dependencies: DecisionBriefConsoleDependencies) {}

  mount(documentRef: Document = document): void {
    this.documentRef = documentRef;
    this.element("decision-brief-refresh")?.addEventListener("click", () => void this.refresh());
    for (const id of ["research-editor-save", "research-evidence-add"]) {
      this.element(id)?.addEventListener("click", () => this.invalidate("Research facts are being written; the previous brief was cleared. Refresh explicitly after current facts reload."));
    }
    this.syncSource();
  }

  syncSource(): void {
    const source = this.dependencies.currentSource();
    const nextKey = source ? `${source.sourceKey}:${source.actorId}` : "";
    if (nextKey === this.sourceKey) return;
    this.generation += 1;
    this.busy = 0;
    this.sourceKey = nextKey;
    this.viewState.envelope = null;
    this.viewState.state = "idle";
    this.viewState.message = source
      ? `Exact ${source.symbol} membership ${source.membershipId} v${source.membershipVersion} selected. Click Refresh for a new brief.`
      : "No exact non-archived membership and actor are bound; brief facts are UNKNOWN.";
    this.render();
  }

  invalidate(message: string): void {
    this.generation += 1;
    this.busy = 0;
    this.viewState.envelope = null;
    this.viewState.state = "idle";
    this.viewState.message = message;
    this.render();
  }

  async refresh(): Promise<void> {
    if (this.busy) return;
    this.syncSource();
    const source = this.dependencies.currentSource();
    const auth = this.dependencies.readAuth();
    this.viewState.envelope = null;
    if (!source) return this.fail("unavailable", "Load one exact non-archived membership through Decision intake first.");
    if (!auth) return this.fail("unauthorized", "Read authorization is required for a fresh daily decision brief.");
    const token = ++this.generation;
    this.busy = token;
    this.viewState.state = "loading";
    this.viewState.message = `Fresh-reading ${source.symbol} daily decision brief; old facts are hidden.`;
    this.render();
    const result = await (this.dependencies.load ?? loadDecisionBrief)(source, auth);
    if (token !== this.generation) return;
    if (!sameWebApiAuth(auth, this.dependencies.readAuth()) || !sameSource(source, this.dependencies.currentSource())) {
      this.fail("conflict", "Membership, actor, source, or authorization changed while loading; the old response was discarded.");
    } else if (!result.ok) {
      this.fail(result.state, result.reason);
    } else {
      this.viewState.envelope = result.value;
      this.viewState.state = result.value.data!.readiness.state;
      this.viewState.message = result.value.message;
    }
    if (this.busy === token) { this.busy = 0; this.render(); }
  }

  private fail(state: WebFailureState, message: string): void {
    this.viewState.envelope = null;
    this.viewState.state = state;
    this.viewState.message = `Decision brief UNKNOWN: ${message}`;
    this.render();
  }
  private render(): void {
    this.dependencies.render?.(this.viewState);
    if (this.documentRef) renderDecisionBrief(this.documentRef, this.viewState, this.dependencies.currentSource(), Boolean(this.busy));
  }
  private element(id: string): HTMLElement | null { return this.documentRef?.getElementById(id) ?? null; }
}

export function renderDecisionBrief(documentRef: Document, view: DecisionBriefViewState, source: DecisionBriefSource | null, busy: boolean): void {
  const host = documentRef.getElementById("decision-brief-console");
  const status = documentRef.getElementById("decision-brief-status");
  const output = documentRef.getElementById("decision-brief-output");
  const refresh = documentRef.getElementById("decision-brief-refresh");
  if (!host || !status || !output) return;
  host.dataset.state = view.state;
  status.textContent = `${view.state}: ${view.message}`;
  if (refresh instanceof HTMLButtonElement) refresh.disabled = busy || !source;
  output.replaceChildren();
  const data = view.envelope?.data;
  if (!data) { output.textContent = "No current daily decision brief facts are displayed."; return; }

  output.append(
    block(documentRef, `Readiness · ${data.readiness.state}`, data.readiness.threeMinuteReviewReady
      ? "Ready for an Owner three-minute review; this is not a recommendation or formal decision."
      : "Not ready for a three-minute review. Resolve the listed research or source gaps, then refresh explicitly."),
    bullets(documentRef, "Readiness reasons", data.readiness.reasons),
    block(documentRef, "Why now", data.whyNow),
    block(documentRef, "Thesis", data.thesis),
    block(documentRef, "Market disagreement", data.marketDisagreement),
    block(documentRef, "Invalidation", data.invalidationCondition),
    block(documentRef, "Next review", data.nextReviewOn),
    bullets(documentRef, "Key variables", data.keyVariables.map((item) => `${item.name} · support ${item.supportCount} · counter ${item.counterCount} · neutral ${item.neutralCount} · reliability ${item.highestReliability ?? "UNKNOWN"} · materiality ${item.highestMateriality ?? "UNKNOWN"}`)),
    bullets(documentRef, "Catalysts", data.catalysts),
    evidence(documentRef, "Support evidence", data.evidence.support),
    evidence(documentRef, "Counter evidence", data.evidence.counter),
    evidence(documentRef, "Neutral evidence", data.evidence.neutral),
    bullets(documentRef, "Source conflicts", data.evidence.conflicts.map((item) => `${item.variableName} · support ${item.supportingEvidenceIds.join(", ")} · counter ${item.counterEvidenceIds.join(", ")}`)),
    bullets(documentRef, "Evidence gaps", data.evidence.gaps),
    quant(documentRef, data.quantEvidence),
    identity(documentRef, view.envelope!, source),
    block(documentRef, "Safety boundary", "Three-minute review readiness only. No recommendation, ranking, target price, target position, direction, order, trade, broker call, or official portfolio mutation.")
  );
}

function exactBriefIdentity(envelope: AnnualDecisionBriefEnvelope, source: DecisionBriefSource): boolean {
  const data = envelope.data;
  const context = source.decisionContext;
  return Boolean(data && envelope.membershipId === source.membershipId && envelope.requestedActorId === source.actorId
    && envelope.requestedSymbol === source.symbol && data.target.membershipId === source.membershipId
    && data.target.membershipVersion === source.membershipVersion && data.target.membershipState === source.membershipState
    && data.target.market === source.market && data.target.code === source.code && data.target.symbol === source.symbol
    && data.sourceIdentity.decisionContextId === context.contextId && data.sourceIdentity.decisionContextHash === context.contextHash
    && data.sourceIdentity.researchAsOf === context.research.metadata.asOf
    && data.sourceIdentity.evidenceAsOf === context.research.evidenceAsOf
    && data.sourceIdentity.quoteSnapshotId === context.quote.snapshotId
    && JSON.stringify(data.quantEvidence) === JSON.stringify(context.quantEvidence));
}
function sameSource(left: DecisionBriefSource, right: DecisionBriefSource | null): boolean { return Boolean(right && left.sourceKey === right.sourceKey && left.actorId === right.actorId && left.membershipId === right.membershipId && left.membershipVersion === right.membershipVersion && left.membershipState === right.membershipState && left.symbol === right.symbol); }
function httpFailure(status: number): WebFailureState { if (status === 401 || status === 403) return "unauthorized"; if (status === 404) return "not_found"; if (status === 409) return "conflict"; if (status >= 500) return "unavailable"; return "malformed"; }
function block(documentRef: Document, title: string, value: string | null): HTMLElement { const section = documentRef.createElement("section"); const heading = documentRef.createElement("h4"); const body = documentRef.createElement("p"); heading.textContent = title; body.textContent = value ?? "UNKNOWN"; section.append(heading, body); return section; }
function bullets(documentRef: Document, title: string, values: string[]): HTMLElement { const section = documentRef.createElement("section"); const heading = documentRef.createElement("h4"); const list = documentRef.createElement("ul"); heading.textContent = title; list.append(...(values.length ? values : ["UNKNOWN"]).map((text) => { const item = documentRef.createElement("li"); item.textContent = text; return item; })); section.append(heading, list); return section; }
function evidence(documentRef: Document, title: string, values: EvidenceItemData[]): HTMLElement { return bullets(documentRef, title, values.map((item) => `${item.id} · ${item.summary} · ${item.sourceType} · ${item.sourceUrl ?? "source URL UNKNOWN"} · ${item.factKind}/${item.stance} · ${item.variableName ?? "variable UNKNOWN"} · reliability ${item.reliability ?? "UNKNOWN"} · materiality ${item.materiality ?? "UNKNOWN"} · captured ${item.capturedAt}`)); }
function quant(documentRef: Document, value: AnnualDecisionBriefData["quantEvidence"]): HTMLElement {
  const ids = value.identities;
  const connect = ids?.hkConnectUniverse;
  const section = bullets(documentRef, "Quant evidence and source identity", [
    `status ${value.status} · ${value.message}`,
    `source ${value.metadata.source} · freshness ${value.metadata.freshness} · provenance ${value.metadata.provenance} · authority ${value.metadata.authority} · fixture ${value.metadata.fixture}`,
    ids ? `snapshot ${ids.frozenSnapshot.snapshotId} · ${ids.frozenSnapshot.sourceClassification} · experiment ${ids.baselineExperimentIdentity} · splits ${ids.splitIds.join(", ")} · shadow ${ids.shadowPortfolioIdentity}` : "identities UNKNOWN",
    connect ? `Hong Kong Connect source ${connect.source} · snapshotId ${connect.snapshotId} · effectiveDate ${connect.effectiveDate} · capturedAt ${connect.capturedAt} · memberCount ${connect.memberCount}` : "Hong Kong Connect universe UNKNOWN",
    `sample ${value.sampleBoundary.sourceClassification} · ${value.sampleBoundary.finalTestPolicy} · universe ${value.sampleBoundary.universe.join(", ")}`,
    ...value.limitations
  ]);
  connect?.sourceUrls.forEach((sourceUrl, index) => {
    const link = documentRef.createElement("a");
    link.href = sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `Official Hong Kong Connect source ${index + 1}`;
    section.append(link);
  });
  return section;
}
function identity(documentRef: Document, envelope: AnnualDecisionBriefEnvelope, source: DecisionBriefSource | null): HTMLElement { const details = documentRef.createElement("details"); const summary = documentRef.createElement("summary"); const data = envelope.data!; summary.textContent = "Exact source identity and diagnostics"; details.append(summary, bullets(documentRef, "Binding", [`actor ${envelope.requestedActorId}`, `membership ${data.target.membershipId} v${data.target.membershipVersion} ${data.target.membershipState}`, `symbol ${data.target.symbol}`, `decision context ${data.sourceIdentity.decisionContextId} / ${data.sourceIdentity.decisionContextHash}`, `research ${data.sourceIdentity.researchAsOf ?? "UNKNOWN"} · evidence ${data.sourceIdentity.evidenceAsOf ?? "UNKNOWN"} · quote ${data.sourceIdentity.quoteSnapshotId ?? "UNKNOWN"}`, `aggregate ${envelope.metadata.source} · ${envelope.metadata.freshness} · ${envelope.metadata.provenance} · ${envelope.metadata.authority}`, `Web source ${source?.sourceKey ?? "UNKNOWN"}`])); return details; }
