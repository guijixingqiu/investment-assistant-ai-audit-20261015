import type { DecisionContextEnvelope } from "./decisionContextBrowser.js";
import type {
  PortfolioDecisionContextEnvelope,
  PortfolioRiskImpactEnvelope
} from "./portfolioDecisionContext.js";

export const DECISION_SNAPSHOT_SCHEMA_VERSION = "2026-07-16.decision-snapshot.v1";

export const DECISION_SNAPSHOT_PORTFOLIO_STATES = [
  "current",
  "stale",
  "partial",
  "zero_position",
  "empty",
  "conflict",
  "unauthorized",
  "unavailable",
  "not_captured"
] as const;

export type DecisionSnapshotPortfolioState = (typeof DECISION_SNAPSHOT_PORTFOLIO_STATES)[number];
export type DecisionSnapshotRiskAvailability = "captured" | "not_captured";

export interface DecisionSnapshotBinding {
  schemaVersion: typeof DECISION_SNAPSHOT_SCHEMA_VERSION;
  portfolioContext: {
    state: DecisionSnapshotPortfolioState;
    contextId: string | null;
    portfolioSnapshotId: string | null;
    accountScopeId: string | null;
  };
  riskImpact: {
    availability: DecisionSnapshotRiskAvailability;
    impactId: string | null;
    calculationVersion: string | null;
    contextId: string | null;
    portfolioSnapshotId: string | null;
    candidateSymbol: string | null;
    hypotheticalAmount: number | null;
  };
}

export interface DecisionSnapshotSafety {
  advisoryOnly: true;
  officialPortfolioMutation: false;
  officialReviewMutation: false;
  createsOrder: false;
  createsTrade: false;
  mutatesCash: false;
  writesFee: false;
  mutatesPosition: false;
  callsBroker: false;
  productionWrite: false;
}

export interface DecisionSnapshotEnvelope {
  schemaVersion: typeof DECISION_SNAPSHOT_SCHEMA_VERSION;
  snapshotId: string;
  capturedAt: string;
  candidateSymbol: string;
  decisionContext: DecisionContextEnvelope;
  portfolioContext: {
    state: DecisionSnapshotPortfolioState;
    envelope: PortfolioDecisionContextEnvelope | null;
    limitation: string;
  };
  riskImpact: {
    availability: DecisionSnapshotRiskAvailability;
    envelope: PortfolioRiskImpactEnvelope | null;
    limitation: string;
  };
  safety: DecisionSnapshotSafety;
}

export interface DecisionSnapshotState {
  availability: "preserved" | "decision_snapshot_not_captured";
  snapshot: DecisionSnapshotEnvelope | null;
  limitation: string;
}

export function validateDecisionSnapshotBinding(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["decisionSnapshotBinding must be an object"] };
  rejectUnknownKeys(value, "decisionSnapshotBinding", ["schemaVersion", "portfolioContext", "riskImpact"], errors);
  if (value.schemaVersion !== DECISION_SNAPSHOT_SCHEMA_VERSION) errors.push(`decisionSnapshotBinding.schemaVersion must be ${DECISION_SNAPSHOT_SCHEMA_VERSION}`);
  validatePortfolioBinding(value.portfolioContext, errors);
  validateRiskBinding(value.riskImpact, value.portfolioContext, errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateDecisionSnapshotStateStructure(value: unknown): { ok: true; value: DecisionSnapshotState } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["decisionSnapshot must be an object"] };
  rejectUnknownKeys(value, "decisionSnapshot", ["availability", "snapshot", "limitation"], errors);
  requireNonEmptyString(value.limitation, "decisionSnapshot.limitation", errors);
  if (value.availability === "decision_snapshot_not_captured") {
    if (value.snapshot !== null) errors.push("decisionSnapshot.snapshot must be null when not captured");
    if (typeof value.limitation !== "string" || !value.limitation.includes("not reconstructed")) {
      errors.push("decisionSnapshot.limitation must disclose no reconstruction when not captured");
    }
  } else if (value.availability === "preserved") {
    validatePreservedSnapshotStructure(value.snapshot, errors);
  } else {
    errors.push("decisionSnapshot.availability is invalid");
  }
  return errors.length === 0
    ? { ok: true, value: value as unknown as DecisionSnapshotState }
    : { ok: false, errors };
}

export function decisionSnapshotNotCapturedState(): DecisionSnapshotState {
  return {
    availability: "decision_snapshot_not_captured",
    snapshot: null,
    limitation: "This historical decision snapshot was not captured and is not reconstructed from current candidate, quote, research, portfolio, or risk facts."
  };
}

export function decisionSnapshotBindingFromState(
  value: unknown
): DecisionSnapshotBinding | null {
  const validation = validateDecisionSnapshotStateStructure(value);
  if (!validation.ok || validation.value.availability !== "preserved" || !validation.value.snapshot) return null;
  const snapshot = validation.value.snapshot;
  return {
    schemaVersion: snapshot.schemaVersion,
    portfolioContext: {
      state: snapshot.portfolioContext.state,
      contextId: snapshot.portfolioContext.envelope?.contextId ?? null,
      portfolioSnapshotId: snapshot.portfolioContext.envelope?.portfolioSnapshotId ?? null,
      accountScopeId: snapshot.portfolioContext.envelope?.accountScopeId ?? null
    },
    riskImpact: {
      availability: snapshot.riskImpact.availability,
      impactId: snapshot.riskImpact.envelope?.impactId ?? null,
      calculationVersion: snapshot.riskImpact.envelope?.calculationVersion ?? null,
      contextId: snapshot.riskImpact.envelope?.contextId ?? null,
      portfolioSnapshotId: snapshot.riskImpact.envelope?.portfolioSnapshotId ?? null,
      candidateSymbol: snapshot.riskImpact.envelope?.candidateSymbol ?? null,
      hypotheticalAmount: snapshot.riskImpact.envelope?.hypotheticalAmount ?? null
    }
  };
}

export function sameDecisionSnapshotBinding(
  left: DecisionSnapshotBinding,
  right: DecisionSnapshotBinding
): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.portfolioContext.state === right.portfolioContext.state
    && left.portfolioContext.contextId === right.portfolioContext.contextId
    && left.portfolioContext.portfolioSnapshotId === right.portfolioContext.portfolioSnapshotId
    && left.portfolioContext.accountScopeId === right.portfolioContext.accountScopeId
    && left.riskImpact.availability === right.riskImpact.availability
    && left.riskImpact.impactId === right.riskImpact.impactId
    && left.riskImpact.calculationVersion === right.riskImpact.calculationVersion
    && left.riskImpact.contextId === right.riskImpact.contextId
    && left.riskImpact.portfolioSnapshotId === right.riskImpact.portfolioSnapshotId
    && left.riskImpact.candidateSymbol === right.riskImpact.candidateSymbol
    && left.riskImpact.hypotheticalAmount === right.riskImpact.hypotheticalAmount;
}

export function decisionSnapshotSafety(): DecisionSnapshotSafety {
  return {
    advisoryOnly: true,
    officialPortfolioMutation: false,
    officialReviewMutation: false,
    createsOrder: false,
    createsTrade: false,
    mutatesCash: false,
    writesFee: false,
    mutatesPosition: false,
    callsBroker: false,
    productionWrite: false
  };
}

export function portfolioSnapshotStateFromContextStatus(status: PortfolioDecisionContextEnvelope["status"]): Exclude<DecisionSnapshotPortfolioState, "not_captured"> {
  return status === "available" ? "current" : status;
}

function validatePortfolioBinding(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("decisionSnapshotBinding.portfolioContext must be an object");
    return;
  }
  rejectUnknownKeys(value, "decisionSnapshotBinding.portfolioContext", ["state", "contextId", "portfolioSnapshotId", "accountScopeId"], errors);
  if (!DECISION_SNAPSHOT_PORTFOLIO_STATES.includes(value.state as DecisionSnapshotPortfolioState)) {
    errors.push("decisionSnapshotBinding.portfolioContext.state is invalid");
    return;
  }
  validateNullableString(value.contextId, "decisionSnapshotBinding.portfolioContext.contextId", errors);
  validateNullableString(value.portfolioSnapshotId, "decisionSnapshotBinding.portfolioContext.portfolioSnapshotId", errors);
  validateNullableString(value.accountScopeId, "decisionSnapshotBinding.portfolioContext.accountScopeId", errors);

  if (["current", "stale", "partial", "zero_position"].includes(String(value.state))) {
    requireNonEmptyString(value.contextId, "decisionSnapshotBinding.portfolioContext.contextId", errors);
    requireNonEmptyString(value.portfolioSnapshotId, "decisionSnapshotBinding.portfolioContext.portfolioSnapshotId", errors);
    requireNonEmptyString(value.accountScopeId, "decisionSnapshotBinding.portfolioContext.accountScopeId", errors);
  } else if (value.state === "not_captured") {
    if (value.contextId !== null || value.portfolioSnapshotId !== null || value.accountScopeId !== null) {
      errors.push("not_captured portfolio binding must not expose identities");
    }
  } else if (value.contextId !== null || value.portfolioSnapshotId !== null) {
    errors.push("fail-closed portfolio binding must not expose context or snapshot identities");
  }
}

function validateRiskBinding(value: unknown, portfolio: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("decisionSnapshotBinding.riskImpact must be an object");
    return;
  }
  rejectUnknownKeys(value, "decisionSnapshotBinding.riskImpact", [
    "availability", "impactId", "calculationVersion", "contextId", "portfolioSnapshotId", "candidateSymbol", "hypotheticalAmount"
  ], errors);
  for (const field of ["impactId", "calculationVersion", "contextId", "portfolioSnapshotId", "candidateSymbol"] as const) {
    validateNullableString(value[field], `decisionSnapshotBinding.riskImpact.${field}`, errors);
  }
  if (value.hypotheticalAmount !== null && !isFiniteNonNegative(value.hypotheticalAmount)) {
    errors.push("decisionSnapshotBinding.riskImpact.hypotheticalAmount must be finite and non-negative or null");
  }
  if (value.availability === "captured") {
    for (const field of ["impactId", "calculationVersion", "contextId", "portfolioSnapshotId", "candidateSymbol"] as const) {
      requireNonEmptyString(value[field], `decisionSnapshotBinding.riskImpact.${field}`, errors);
    }
    if (!isFiniteNonNegative(value.hypotheticalAmount)) errors.push("captured risk binding requires hypotheticalAmount");
    if (typeof value.candidateSymbol !== "string" || !/^HK\.[0-9]{5}$/.test(value.candidateSymbol)) errors.push("captured risk binding requires a canonical Hong Kong candidate");
    if (!isRecord(portfolio) || portfolio.state !== "current") errors.push("captured risk binding requires current portfolio context");
    if (isRecord(portfolio)) {
      if (value.contextId !== portfolio.contextId) errors.push("risk binding contextId must match portfolio binding");
      if (value.portfolioSnapshotId !== portfolio.portfolioSnapshotId) errors.push("risk binding portfolioSnapshotId must match portfolio binding");
    }
  } else if (value.availability === "not_captured") {
    if ([value.impactId, value.calculationVersion, value.contextId, value.portfolioSnapshotId, value.candidateSymbol, value.hypotheticalAmount].some((item) => item !== null)) {
      errors.push("not_captured risk binding must not expose identities or calculations");
    }
  } else {
    errors.push("decisionSnapshotBinding.riskImpact.availability is invalid");
  }
}

function validatePreservedSnapshotStructure(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("preserved decisionSnapshot.snapshot must be an object");
    return;
  }
  rejectUnknownKeys(value, "decisionSnapshot.snapshot", [
    "schemaVersion", "snapshotId", "capturedAt", "candidateSymbol", "decisionContext", "portfolioContext", "riskImpact", "safety"
  ], errors);
  if (value.schemaVersion !== DECISION_SNAPSHOT_SCHEMA_VERSION) errors.push(`decisionSnapshot.snapshot.schemaVersion must be ${DECISION_SNAPSHOT_SCHEMA_VERSION}`);
  if (typeof value.snapshotId !== "string" || !/^decision-snapshot:[a-f0-9]{64}$/.test(value.snapshotId)) errors.push("decisionSnapshot.snapshot.snapshotId is invalid");
  requireDateTime(value.capturedAt, "decisionSnapshot.snapshot.capturedAt", errors);
  if (typeof value.candidateSymbol !== "string" || !/^HK\.[0-9]{5}$/.test(value.candidateSymbol)) errors.push("decisionSnapshot.snapshot.candidateSymbol is invalid");
  if (!isRecord(value.decisionContext)) errors.push("decisionSnapshot.snapshot.decisionContext must be an object");
  else if (value.decisionContext.requestedSymbol !== value.candidateSymbol) errors.push("decision snapshot decision context must match candidateSymbol");
  validateSnapshotPortfolio(value.portfolioContext, errors);
  validateSnapshotRisk(value.riskImpact, value.portfolioContext, value.candidateSymbol, errors);
  validateSafety(value.safety, errors);
}

function validateSnapshotPortfolio(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("decisionSnapshot.snapshot.portfolioContext must be an object");
    return;
  }
  rejectUnknownKeys(value, "decisionSnapshot.snapshot.portfolioContext", ["state", "envelope", "limitation"], errors);
  if (!DECISION_SNAPSHOT_PORTFOLIO_STATES.includes(value.state as DecisionSnapshotPortfolioState)) errors.push("decision snapshot portfolio state is invalid");
  requireNonEmptyString(value.limitation, "decisionSnapshot.snapshot.portfolioContext.limitation", errors);
  if (value.state === "not_captured") {
    if (value.envelope !== null) errors.push("not_captured decision snapshot portfolio must not expose an envelope");
  } else if (!isRecord(value.envelope)) {
    errors.push("captured decision snapshot portfolio state requires an envelope");
  } else {
    const expectedState = value.envelope.status === "available" ? "current" : value.envelope.status;
    if (value.state !== expectedState) errors.push("decision snapshot portfolio state must match the preserved envelope");
  }
}

function validateSnapshotRisk(value: unknown, portfolio: unknown, candidateSymbol: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("decisionSnapshot.snapshot.riskImpact must be an object");
    return;
  }
  rejectUnknownKeys(value, "decisionSnapshot.snapshot.riskImpact", ["availability", "envelope", "limitation"], errors);
  requireNonEmptyString(value.limitation, "decisionSnapshot.snapshot.riskImpact.limitation", errors);
  if (value.availability === "not_captured") {
    if (value.envelope !== null) errors.push("not_captured decision snapshot risk must not expose an envelope");
  } else if (value.availability === "captured") {
    if (!isRecord(value.envelope)) errors.push("captured decision snapshot risk requires an envelope");
    else {
      if (value.envelope.status !== "available") errors.push("captured decision snapshot risk must be available");
      if (value.envelope.candidateSymbol !== candidateSymbol) errors.push("decision snapshot risk candidate must match candidateSymbol");
      if (!isRecord(portfolio) || portfolio.state !== "current" || !isRecord(portfolio.envelope)) {
        errors.push("captured decision snapshot risk requires preserved current portfolio context");
      } else {
        if (value.envelope.contextId !== portfolio.envelope.contextId) errors.push("decision snapshot risk contextId must match preserved portfolio context");
        if (value.envelope.portfolioSnapshotId !== portfolio.envelope.portfolioSnapshotId) errors.push("decision snapshot risk portfolioSnapshotId must match preserved portfolio context");
      }
    }
  } else {
    errors.push("decisionSnapshot.snapshot.riskImpact.availability is invalid");
  }
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("decisionSnapshot.snapshot.safety must be an object");
    return;
  }
  rejectUnknownKeys(value, "decisionSnapshot.snapshot.safety", [
    "advisoryOnly", "officialPortfolioMutation", "officialReviewMutation", "createsOrder", "createsTrade",
    "mutatesCash", "writesFee", "mutatesPosition", "callsBroker", "productionWrite"
  ], errors);
  if (value.advisoryOnly !== true) errors.push("decision snapshot must remain advisory only");
  for (const field of [
    "officialPortfolioMutation", "officialReviewMutation", "createsOrder", "createsTrade", "mutatesCash",
    "writesFee", "mutatesPosition", "callsBroker", "productionWrite"
  ]) {
    if (value[field] !== false) errors.push(`decisionSnapshot.snapshot.safety.${field} must be false`);
  }
}

function rejectUnknownKeys(value: Record<string, unknown>, label: string, allowedKeys: string[], errors: string[]): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`);
}

function validateNullableString(value: unknown, field: string, errors: string[]): void {
  if (value !== null && (typeof value !== "string" || value.trim().length === 0)) errors.push(`${field} must be a non-empty string or null`);
}

function requireNonEmptyString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${field} must be a non-empty string`);
}

function requireDateTime(value: unknown, field: string, errors: string[]): void {
  requireNonEmptyString(value, field, errors);
  if (typeof value === "string" && !Number.isFinite(Date.parse(value))) errors.push(`${field} must be a valid date-time`);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
