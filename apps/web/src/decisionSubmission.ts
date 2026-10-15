import type { PreTradeDecisionCheckData } from "../../../packages/contracts/src/decisionContextBrowser.js";
import { sameWebApiAuth, type WebApiAuth, type WebApiClient, type WebFailureState } from "./apiClient.js";
import type { CoreJourneyData } from "./coreJourneyState.js";
import type { ConsoleDecisionPreparation } from "./investmentControlConsoleCoordinator.js";

type DecisionWriteResult = Awaited<ReturnType<WebApiClient["submitDecisionCheck"]>>;

export interface DecisionSubmissionIdentity {
  generation: number;
  data: CoreJourneyData;
  symbol: string;
  decisionContext: NonNullable<CoreJourneyData["decisionContext"]>;
  contextId: string;
  contextHash: string;
  sourceKey: string | null;
}

export interface CurrentDecisionSubmissionState {
  generation: number;
  data: CoreJourneyData | null;
  sourceKey: string | null;
}

export interface DecisionSubmissionDependencies {
  submissionAuth: WebApiAuth;
  currentAuth: () => WebApiAuth | null;
  isCurrent: () => boolean;
  onStale: () => void;
  prepare: () => Promise<ConsoleDecisionPreparation>;
  preparedBindingMatches: (prepared: ConsoleDecisionPreparation) => boolean;
  submit: (prepared: ConsoleDecisionPreparation) => Promise<DecisionWriteResult>;
  acceptsResponse: (check: PreTradeDecisionCheckData, prepared: ConsoleDecisionPreparation) => boolean | Promise<boolean>;
}

export function captureDecisionSubmissionIdentity(
  generation: number,
  data: CoreJourneyData,
  sourceKey: string | null
): DecisionSubmissionIdentity {
  const decisionContext = data.decisionContext;
  if (!decisionContext) throw new Error("A decision context is required to capture decision submission identity.");
  return {
    generation,
    data,
    symbol: data.symbol.symbol,
    decisionContext,
    contextId: decisionContext.contextId,
    contextHash: decisionContext.contextHash,
    sourceKey
  };
}

export function matchesDecisionSubmissionDataIdentity(
  expected: DecisionSubmissionIdentity,
  current: Pick<CurrentDecisionSubmissionState, "generation" | "data">
): boolean {
  const context = current.data?.decisionContext;
  return current.generation === expected.generation
    && current.data === expected.data
    && current.data?.symbol.symbol === expected.symbol
    && context === expected.decisionContext
    && context?.contextId === expected.contextId
    && context.contextHash === expected.contextHash;
}

export function matchesDecisionSubmissionIdentity(
  expected: DecisionSubmissionIdentity,
  current: CurrentDecisionSubmissionState
): boolean {
  return matchesDecisionSubmissionDataIdentity(expected, current)
    && current.sourceKey === expected.sourceKey;
}

export async function runDecisionSubmission(
  dependencies: DecisionSubmissionDependencies
): Promise<DecisionWriteResult | null> {
  let prepared: ConsoleDecisionPreparation;
  try {
    prepared = await dependencies.prepare();
    if (!dependencies.isCurrent()) return stale(dependencies);
    if (!dependencies.preparedBindingMatches(prepared)) {
      throw new Error("Current portfolio facts no longer match the decision submission.");
    }
  } catch (error) {
    if (!dependencies.isCurrent()) return stale(dependencies);
    return failure(
      "conflict",
      error instanceof Error ? error.message : "Current portfolio or conditional facts could not be bound to the decision."
    );
  }

  if (!dependencies.isCurrent()) return stale(dependencies);
  if (!sameWebApiAuth(dependencies.submissionAuth, dependencies.currentAuth())) {
    return failure("conflict", "Runtime authorization changed before decision submission.");
  }
  const result = await dependencies.submit(prepared);
  if (!dependencies.isCurrent()) return stale(dependencies);
  if (!sameWebApiAuth(dependencies.submissionAuth, dependencies.currentAuth())) {
    return failure("conflict", "The decision response was hidden because runtime authorization changed while submission was in flight. Reload current facts before continuing.");
  }
  if (!result.ok) return result;
  if (!dependencies.preparedBindingMatches(prepared)) {
    return failure("conflict", "The human decision was recorded, but the visible portfolio or risk facts changed before confirmation. Refresh the current candidate before displaying that recorded snapshot.");
  }
  if (!dependencies.isCurrent()) return stale(dependencies);
  const accepted = await dependencies.acceptsResponse(result.value, prepared);
  if (!dependencies.isCurrent()) return stale(dependencies);
  return accepted
    ? result
    : failure("conflict", "The human decision was recorded, but the visible portfolio or risk facts changed before confirmation. Refresh the current candidate before displaying that recorded snapshot.");
}

function stale(dependencies: Pick<DecisionSubmissionDependencies, "onStale">): null {
  dependencies.onStale();
  return null;
}

function failure(state: WebFailureState, reason: string): Extract<DecisionWriteResult, { ok: false }> {
  return { ok: false, state, reason };
}
