export type CoreAssistUnifiedFailureState =
  | "loading"
  | "empty"
  | "stale"
  | "unavailable"
  | "unauthorized"
  | "conflict"
  | "offline"
  | "malformed"
  | "fixture-unavailable"
  | "source-mismatch";

export function coreAssistUnifiedFailureStateForUiState(state: string): CoreAssistUnifiedFailureState | null {
  const normalized = state.replaceAll("_", "-");
  if (normalized === "loading") return "loading";
  if (normalized === "empty" || normalized === "not-found" || normalized === "no-evidence") return "empty";
  if (normalized.includes("stale")) return "stale";
  if (normalized === "unauthorized" || normalized === "research-unauthorized" || normalized === "permission-denied") return "unauthorized";
  if (normalized === "conflict" || normalized.includes("version-conflict")) return "conflict";
  if (normalized === "offline") return "offline";
  if (normalized === "malformed" || normalized.includes("malformed")) return "malformed";
  if (normalized === "fixture-unavailable") return "fixture-unavailable";
  if (
    normalized === "source-mismatch"
    || normalized === "membership-missing"
    || normalized.includes("mismatch")
    || normalized.includes("not-omitted")
  ) {
    return "source-mismatch";
  }
  if (
    normalized === "unavailable"
    || normalized.includes("unavailable")
    || normalized.startsWith("missing-")
    || normalized.includes("-missing")
    || normalized === "context-unloaded"
    || normalized === "membership-unloaded"
  ) {
    return "unavailable";
  }
  return null;
}

export function coreAssistUnifiedFailureStateSummaryForUiStates(
  lanes: Array<readonly [string, string]>,
  isLoading = false
): string[] {
  const summary = isLoading ? ["workspace=loading -> loading"] : [];
  for (const [lane, state] of lanes) {
    const unified = coreAssistUnifiedFailureStateForUiState(state);
    if (unified) summary.push(`${lane}=${state} -> ${unified}`);
  }
  return summary.length > 0
    ? summary
    : ["no-active-unified-failure-state: current lane states have no canonical failure promotion."];
}

export function coreAssistUnifiedFailureStateMetadataPolicyForUiStates(
  lanes: Array<readonly [string, string]>,
  isLoading = false
): string[] {
  const summary = isLoading
    ? ["workspace=loading -> sourceMetadata=pending; facts/localDrafts/localRecords=hidden"]
    : [];
  for (const [lane, state] of lanes) {
    const unified = coreAssistUnifiedFailureStateForUiState(state);
    summary.push(metadataPolicyLine(lane, state, unified));
  }
  return summary;
}

function metadataPolicyLine(lane: string, state: string, unified: CoreAssistUnifiedFailureState | null): string {
  const prefix = `${lane}=${state}`;
  switch (unified) {
    case "loading":
      return `${prefix} -> sourceMetadata=pending; facts/localDrafts/localRecords=hidden`;
    case "empty":
      return `${prefix} -> sourceMetadata=authenticated-empty-visible; staleSuccess=blocked; localRecords=guarded`;
    case "stale":
      return `${prefix} -> sourceMetadata=stale-or-historical-visible; freshFacts=blocked; localRecords=hidden-unless-current-signature`;
    case "unavailable":
      return `${prefix} -> sourceMetadata=absent; staleFactsDraftsRecords=cleared`;
    case "unauthorized":
      return `${prefix} -> sourceMetadata=absent; emptySuccess=blocked; localRecords=hidden`;
    case "conflict":
      return `${prefix} -> sourceMetadata=conflict-reason-visible; staleSuccess=blocked; localRecords=hidden`;
    case "offline":
      return `${prefix} -> sourceMetadata=absent; local-only-boundary-visible; networkSuccessOfficialBroker=hidden`;
    case "malformed":
      return `${prefix} -> sourceMetadata=absent; validationFailure=visible; clientFallbackSubmission=blocked`;
    case "fixture-unavailable":
      return `${prefix} -> sourceMetadata=fixture-absence-visible; realFacts=blocked; samplePromotion=blocked`;
    case "source-mismatch":
      return `${prefix} -> sourceMetadata=source-mismatch-reason-visible; staleSuccess=blocked; localRecords=hidden`;
    default:
      return `${prefix} -> sourceMetadata=current-facts-visible; localRecords=require-current-source-signature`;
  }
}
