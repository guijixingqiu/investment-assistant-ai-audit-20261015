import type { AnnualReviewLearningRequest } from "../../../packages/contracts/src/annualReviewLearning.js";
import { annualReviewLearningMatchesRequest, annualReviewLearningNotCapturedState, validateAnnualReviewLearningState } from "../../../packages/contracts/src/annualReviewLearning.js";
import type { AnnualConditionalDecisionSubmission } from "../../../packages/contracts/src/annualConditionalDecisionContract.js";
import { canonicalJson, type HumanCheckResult, type PreTradeDecisionCheckData } from "../../../packages/contracts/src/decisionContextBrowser.js";
import type { PostDecisionReviewData } from "../../../packages/contracts/src/decisionReview.js";
import { decisionSnapshotBindingFromState, sameDecisionSnapshotBinding, type DecisionSnapshotBinding } from "../../../packages/contracts/src/decisionSnapshotContract.js";
import type { ResearchReportDecisionBinding } from "../../../packages/contracts/src/researchReportDecision.js";
import type { DecisionActionIntent } from "../../../packages/contracts/src/research.js";
import { formalDecisionNotCapturedState, type FormalOwnerDecisionInput } from "../../../packages/contracts/src/formalDecision.js";
import { validateAnnualConditionalDecisionStateForBrowser } from "./annualConditionalDecisionBrowser.js";

export type ConsoleResponseValidation = { ok: true } | { ok: false; state: "malformed" | "conflict"; reason: string };

export async function validateSubmittedDecisionResponse(
  check: PreTradeDecisionCheckData,
  request: {
    actionIntent: DecisionActionIntent;
    humanCheckResult: HumanCheckResult;
    userFinalDecision: string | null;
    conditionalDecision?: AnnualConditionalDecisionSubmission;
    formalDecision?: FormalOwnerDecisionInput;
  },
  binding: DecisionSnapshotBinding | ResearchReportDecisionBinding
): Promise<ConsoleResponseValidation> {
  if (check.actionIntent !== request.actionIntent
    || check.humanCheckResult !== request.humanCheckResult
    || check.userFinalDecision !== request.userFinalDecision) {
    return { ok: false, state: "conflict", reason: "Decision response does not match the submitted action intent, human check result, and final decision." };
  }
  if ("bindingVersion" in binding) {
    return !request.conditionalDecision && request.formalDecision !== undefined
      && check.researchReportDecision.availability === "preserved"
      && canonicalJson(check.researchReportDecision.binding) === canonicalJson(binding)
      && check.formalDecision.availability === "preserved"
      && canonicalJson(check.formalDecision.ownerDecision) === canonicalJson(request.formalDecision)
      && (request.formalDecision.personalRisk === undefined || check.formalDecision.personalRiskAssessment !== undefined)
      && check.conditionalDecision?.availability !== "preserved"
      ? { ok: true }
      : { ok: false, state: "conflict", reason: "Decision response did not preserve the exact explicitly adopted research report binding." };
  }
  if (!request.conditionalDecision) {
    if (canonicalJson(check.formalDecision) !== canonicalJson(formalDecisionNotCapturedState())) {
      return { ok: false, state: "conflict", reason: "Decision response captured a formal report decision that was not submitted." };
    }
    if (!check.conditionalDecision) return { ok: true };
    const validation = await validateAnnualConditionalDecisionStateForBrowser(check.conditionalDecision);
    if (!validation.ok) return { ok: false, state: "malformed", reason: validation.errors.join("; ") };
    return validation.value.availability === "conditional_decision_not_captured"
      ? { ok: true }
      : { ok: false, state: "conflict", reason: "Decision response preserved a conditional decision that was not submitted." };
  }
  if (!check.conditionalDecision || !check.decisionSnapshot) {
    return { ok: false, state: "conflict", reason: "Decision response omitted the submitted conditional decision or decision snapshot." };
  }
  const validation = await validateAnnualConditionalDecisionStateForBrowser(check.conditionalDecision);
  if (!validation.ok) return { ok: false, state: "malformed", reason: validation.errors.join("; ") };
  const responseBinding = decisionSnapshotBindingFromState(check.decisionSnapshot);
  const matches = validation.value.availability === "preserved"
    && validation.value.preview?.previewId === request.conditionalDecision.preview.previewId
    && canonicalJson(validation.value.judgment) === canonicalJson(request.conditionalDecision.judgment)
    && responseBinding !== null
    && sameDecisionSnapshotBinding(responseBinding, binding);
  return matches
    ? { ok: true }
    : { ok: false, state: "conflict", reason: "Decision response does not match the submitted conditional preview, judgment, and decision snapshot binding." };
}

export function validateSubmittedReviewLearning(
  review: PostDecisionReviewData,
  check: PreTradeDecisionCheckData,
  request?: AnnualReviewLearningRequest
): ConsoleResponseValidation {
  const validation = validateAnnualReviewLearningState(review.reviewLearning ?? annualReviewLearningNotCapturedState(), check.id, check.decisionSnapshot, check.conditionalDecision);
  if (!validation.ok) return { ok: false, state: "malformed", reason: validation.errors.join("; ") };
  if (!request) return validation.value.availability === "review_learning_not_captured"
    ? { ok: true }
    : { ok: false, state: "conflict", reason: "Review response captured learning that was not submitted." };
  const matches = annualReviewLearningMatchesRequest(validation.value, request);
  return matches
    ? { ok: true }
    : { ok: false, state: "conflict", reason: "Review learning response does not match the submitted immutable decision references and fields." };
}
