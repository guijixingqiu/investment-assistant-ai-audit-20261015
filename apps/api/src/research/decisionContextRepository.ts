import type { Pool, PoolClient } from "pg";
import type { DecisionContextEnvelope } from "../../../../packages/contracts/src/decisionContext.js";
import { decisionQuantEvidenceConfigurationUnavailable, readDecisionQuantEvidence } from "./decisionQuantEvidenceAdapter.js";
import { assembleDecisionContextEnvelope } from "./decisionContextReadService.js";
import type { DecisionQuantEvidenceOptions } from "./quantEvidenceSource.js";

export function readDecisionContextEnvelope(
  pool: Pick<Pool | PoolClient, "query">,
  market: string,
  code: string,
  liveMaxAgeSeconds: number,
  now = new Date(),
  quantEvidence: DecisionQuantEvidenceOptions | null = null
): Promise<DecisionContextEnvelope> {
  const reader = quantEvidence
    ? (symbol: string, evaluatedAt: Date) => readDecisionQuantEvidence(symbol, evaluatedAt, quantEvidence)
    : async () => decisionQuantEvidenceConfigurationUnavailable();
  return assembleDecisionContextEnvelope(pool, market, code, liveMaxAgeSeconds, reader, now);
}
