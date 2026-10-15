import type { CoreJourneyData } from "./coreJourneyState.js";
import { formalDecisionNotCapturedState } from "../../../packages/contracts/src/formalDecision.js";
import { quantDecisionEvidenceLines } from "./quantDecisionEvidencePresentation.js";

export function reviewHistoryLines(data: CoreJourneyData | null): string[] {
  const checks = data?.reviewHistory?.checks ?? [];
  return checks.slice(0, 3).map((check) => {
    const snapshot = check.contextSnapshot.availability === "preserved"
      ? "preserved historical snapshot"
      : "context snapshot unavailable and not reconstructed";
    const reviews = check.reviews.length === 0
      ? "no prior reviews"
      : check.reviews.slice(0, 2).map((review) => {
        const portfolioReview = review.portfolioReview?.availability === "preserved" && review.portfolioReview.snapshot
          ? `portfolio review ${review.portfolioReview.snapshot.comparison.status}; decision=${review.portfolioReview.snapshot.comparison.decisionTime.state}; later=${review.portfolioReview.snapshot.comparison.reviewTime.state}; comparison=${review.portfolioReview.snapshot.comparison.comparisonId}`
          : "portfolio review not captured and not reconstructed";
        return `${review.outcome} reviewed at ${review.reviewedAt}; ${portfolioReview}`;
      }).join(", ");
    const decisionSnapshot = check.decisionSnapshot.availability === "preserved" && check.decisionSnapshot.snapshot
      ? `decision snapshot ${check.decisionSnapshot.snapshot.snapshotId}; portfolio ${check.decisionSnapshot.snapshot.portfolioContext.state}; risk ${check.decisionSnapshot.snapshot.riskImpact.availability}`
      : "decision snapshot not captured and not reconstructed";
    const formalDecision = check.formalDecision ?? formalDecisionNotCapturedState();
    const personalRisk = formalDecision.availability === "preserved" && formalDecision.personalRiskAssessment
      ? `personal risk ${formalDecision.personalRiskAssessment.status}; warnings=${formalDecision.personalRiskAssessment.warnings.map((warning) => warning.code).join(",") || "none"}; override=${formalDecision.personalRiskAssessment.requiresOverride ? "second-confirmed" : "not-required"}`
      : "personal risk not captured";
    return `Prior check ${check.id}: ${check.humanCheckResult} at ${check.checkedAt}; ${reviews}; ${snapshot}; ${decisionSnapshot}; ${personalRisk}; not current decision context.`;
  });
}

export function journeyDetailLines(data: CoreJourneyData | null, pinganDisplayProvenance: string): string[] {
  if (!data) return [];
  const pinganAuthority = data.pingan
    ? `Pingan authority: display=${data.pingan.dataUse.display} riskImpact=${data.pingan.dataUse.riskImpact} brokerReconciliation=${data.pingan.dataUse.brokerReconciliation} accountTruth=${data.pingan.dataUse.accountTruth} accounting=${data.pingan.dataUse.accounting} execution=${data.pingan.dataUse.execution}`
    : "Pingan authority: missing";
  return [
    `Quote source: ${data.quote?.source.provider ?? "unknown"} fetched ${data.quote?.source.fetchedAt ?? "unknown"}`,
    `Research evidence: ${data.decisionContext?.research.evidence.length ?? 0} items as of ${data.decisionContext?.research.evidenceAsOf ?? "unknown"}`,
    `Decision context: ${data.decisionContext?.contextId ?? "missing"} hash ${data.decisionContext?.contextHash ?? "missing"}`,
    ...(data.decisionContext ? quantDecisionEvidenceLines(data.decisionContext.quantEvidence) : []),
    data.submittedCheck?.decisionSnapshot?.availability === "preserved" && data.submittedCheck.decisionSnapshot.snapshot
      ? `Decision snapshot: ${data.submittedCheck.decisionSnapshot.snapshot.snapshotId}; portfolio=${data.submittedCheck.decisionSnapshot.snapshot.portfolioContext.state}; risk=${data.submittedCheck.decisionSnapshot.snapshot.riskImpact.availability}`
      : "Decision snapshot: not captured; current facts will not be used to reconstruct it.",
    `Pingan source: ${data.pingan?.sourceSnapshotId ?? data.pingan?.status ?? "missing"} as of ${data.pingan?.sourceAsOf ?? "not available"}; provenance=${pinganDisplayProvenance}; ${data.pingan?.limitation ?? ""}`,
    pinganAuthority,
    `Review checks: ${data.reviewHistory?.checks.length ?? 0}`,
    ...reviewHistoryLines(data),
    "Advisory assistance only: this browser workflow cannot create orders, trades, fills, cash movements, fees, position mutations, or broker calls."
  ];
}
