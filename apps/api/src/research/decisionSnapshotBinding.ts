import type { Pool, PoolClient } from "pg";
import type { DecisionContextEnvelope } from "../../../../packages/contracts/src/decisionContext.js";
import {
  computeDecisionSnapshotId,
  DECISION_SNAPSHOT_SCHEMA_VERSION,
  decisionSnapshotHashInput,
  decisionSnapshotSafety,
  portfolioSnapshotStateFromContextStatus,
  validateDecisionSnapshotBinding,
  validateDecisionSnapshotState,
  type DecisionSnapshotBinding,
  type DecisionSnapshotEnvelope,
  type DecisionSnapshotState
} from "../../../../packages/contracts/src/decisionSnapshot.js";
import {
  validatePortfolioRiskImpactEnvelope,
  type PortfolioDecisionContextEnvelope,
  type PortfolioRiskImpactEnvelope
} from "../../../../packages/contracts/src/portfolioDecisionContext.js";
import { calculatePortfolioRiskImpact } from "../portfolio/decisionContext.js";
import { readAuthorizedPortfolioDecisionContext } from "./authorizedPortfolioDecisionContext.js";
import { DecisionSnapshotMismatchError } from "./domain.js";

export interface DecisionSnapshotResolutionOptions {
  accountScopeId: string | null;
  pinganCurrentMaxAgeSeconds: number;
  quoteLiveMaxAgeSeconds: number;
  now?: Date;
}

export async function resolveDecisionSnapshot(
  pool: Pick<Pool | PoolClient, "query">,
  decisionContext: DecisionContextEnvelope,
  binding: DecisionSnapshotBinding | undefined,
  options: DecisionSnapshotResolutionOptions | undefined
): Promise<DecisionSnapshotState> {
  if (binding) {
    const validation = validateDecisionSnapshotBinding(binding);
    if (!validation.ok) throw new DecisionSnapshotMismatchError(validation.errors.join("; "));
  }

  const now = options?.now ?? new Date();
  const contextGeneratedAt = Date.parse(decisionContext.generatedAt);
  if (!Number.isFinite(contextGeneratedAt) || contextGeneratedAt > now.getTime()) {
    throw new DecisionSnapshotMismatchError(
      "decision context generatedAt must not be after the decision snapshot capture time"
    );
  }
  let portfolioContext: PortfolioDecisionContextEnvelope | null = null;
  if (binding && binding.portfolioContext.state !== "not_captured") {
    if (!options) throw new DecisionSnapshotMismatchError("decision snapshot verification options are unavailable");
    portfolioContext = await readAuthorizedPortfolioDecisionContext(pool, options, now);
    verifyPortfolioBinding(binding, portfolioContext);
  }

  let riskImpact: PortfolioRiskImpactEnvelope | null = null;
  if (binding?.riskImpact.availability === "captured") {
    if (!portfolioContext || binding.riskImpact.hypotheticalAmount === null) {
      throw new DecisionSnapshotMismatchError("captured risk impact requires verified current portfolio facts and amount");
    }
    riskImpact = calculatePortfolioRiskImpact(
      portfolioContext,
      decisionContext.requestedSymbol,
      binding.riskImpact.hypotheticalAmount
    );
    const riskValidation = validatePortfolioRiskImpactEnvelope(riskImpact);
    if (!riskValidation.ok) throw new Error(`authorized risk impact failed validation: ${riskValidation.errors.join("; ")}`);
    verifyRiskBinding(binding, riskImpact, decisionContext.requestedSymbol);
  }

  const hashInput: Omit<DecisionSnapshotEnvelope, "snapshotId"> = {
    schemaVersion: DECISION_SNAPSHOT_SCHEMA_VERSION,
    capturedAt: now.toISOString(),
    candidateSymbol: decisionContext.requestedSymbol,
    decisionContext,
    portfolioContext: {
      state: binding?.portfolioContext.state ?? "not_captured",
      envelope: portfolioContext,
      limitation: portfolioContext
        ? "This is the exact authorized read-only portfolio context visible at decision time; it is not broker reconciliation, accounting, execution, or production portfolio authority."
        : "Portfolio context was not captured for this decision and is not reconstructed from later facts."
    },
    riskImpact: {
      availability: binding?.riskImpact.availability ?? "not_captured",
      envelope: riskImpact,
      limitation: riskImpact
        ? "This is the exact neutral scenario calculated from a user-provided amount; it is not a direction, amount, weight, timing, return, or execution recommendation."
        : "No visible neutral risk scenario was captured for this decision and none is reconstructed later."
    },
    safety: decisionSnapshotSafety()
  };
  const snapshot: DecisionSnapshotEnvelope = {
    ...hashInput,
    snapshotId: computeDecisionSnapshotId(hashInput)
  };
  const state: DecisionSnapshotState = {
    availability: "preserved",
    snapshot,
    limitation: "Exact decision-time candidate, evidence, portfolio state, and any visible neutral risk scenario are preserved without mutating official facts."
  };
  const snapshotValidation = validateDecisionSnapshotState(state);
  if (!snapshotValidation.ok) throw new Error(`assembled decision snapshot failed validation: ${snapshotValidation.errors.join("; ")}`);
  if (computeDecisionSnapshotId(decisionSnapshotHashInput(snapshot)) !== snapshot.snapshotId) throw new Error("assembled decision snapshot identity is unstable");
  return state;
}

function verifyPortfolioBinding(binding: DecisionSnapshotBinding, context: PortfolioDecisionContextEnvelope): void {
  const expectedState = portfolioSnapshotStateFromContextStatus(context.status);
  const submitted = binding.portfolioContext;
  if (submitted.state !== expectedState
    || submitted.contextId !== context.contextId
    || submitted.portfolioSnapshotId !== context.portfolioSnapshotId
    || submitted.accountScopeId !== context.accountScopeId) {
    throw new DecisionSnapshotMismatchError("portfolio context status or identities no longer match the authorized read facts");
  }
}

function verifyRiskBinding(
  binding: DecisionSnapshotBinding,
  risk: PortfolioRiskImpactEnvelope,
  candidateSymbol: string
): void {
  const submitted = binding.riskImpact;
  if (risk.status !== "available"
    || submitted.impactId !== risk.impactId
    || submitted.calculationVersion !== risk.calculationVersion
    || submitted.contextId !== risk.contextId
    || submitted.portfolioSnapshotId !== risk.portfolioSnapshotId
    || submitted.candidateSymbol !== candidateSymbol
    || submitted.hypotheticalAmount !== risk.hypotheticalAmount) {
    throw new DecisionSnapshotMismatchError("neutral risk identities, amount, or calculation no longer match the authorized read facts");
  }
}
