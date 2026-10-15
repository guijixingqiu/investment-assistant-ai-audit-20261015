import type { Pool, PoolClient } from "pg";
import type { DeepResearchReportData } from "../../../../packages/contracts/src/deepResearch.js";
import { researchCompletenessAllowsFormalization } from "../../../../packages/contracts/src/researchCompleteness.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import type { QuantEvidenceRuntimeOptions } from "./quantEvidenceSource.js";
import { readResearchCompletenessSnapshot } from "./researchCompletenessRepository.js";
import type { SourceSnapshotStoreOptions } from "./researchSourceSnapshotRepository.js";

export async function readReportConfirmationFailures(
  pool: Pick<Pool | PoolClient, "query">, membershipId: string, actor: AuthenticatedResearchActor,
  now: Date, quantEvidence: QuantEvidenceRuntimeOptions | null = null,
  sourceStore?:SourceSnapshotStoreOptions
): Promise<string[]> {
  try {
    const completeness = await readResearchCompletenessSnapshot(pool, membershipId, actor, now, quantEvidence, sourceStore);
    if (completeness.status === "available" && researchCompletenessAllowsFormalization(completeness.data)) return [];
    const gaps = completeness.data?.sections.flatMap((section) => section.gaps) ?? [];
    return [...new Set([completeness.message, ...gaps])].map((gap) => `confirmation_completeness: ${gap}`);
  } catch {
    return ["confirmation_completeness: 当前资料完整性暂时无法核验；报告仍可阅读，正式确认暂不可用。"];
  }
}

export function projectReportConfirmationReadiness(report: DeepResearchReportData, failures: string[]): DeepResearchReportData {
  if (report.currentness.status !== "current" || report.status !== "complete_pending_confirmation" || failures.length === 0) return report;
  return { ...report, status: "evidence_insufficient", gateFailures: [...new Set([...report.gateFailures, ...failures])] };
}
