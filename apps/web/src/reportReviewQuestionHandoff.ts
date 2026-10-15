import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";
import type { DecisionReviewHistoryEnvelope } from "../../../packages/contracts/src/decisionReview.js";
import type { ReportAssistantSource } from "./reportAssistantData.js";

export interface ReportReviewQuestionCandidate {
  key: string;
  checkId: string;
  reviewId: string;
  reviewedAt: string;
  outcome: string;
  question: string;
  judgmentCorrection: string;
  processLesson: string;
}

// Matches the existing research-evidence-question bound (1..1000) and the
// report-assistant-question textarea maxlength; nothing here truncates source text.
export const REPORT_REVIEW_QUESTION_LENGTH_LIMIT = 1_000;

export type ReportReviewLessonKind = "judgmentCorrection" | "processLesson";

export interface ReportReviewLessonSelection {
  judgmentCorrection: boolean;
  processLesson: boolean;
}

export const REPORT_REVIEW_LESSONS: ReadonlyArray<{ kind: ReportReviewLessonKind; label: string }> = [
  { kind: "judgmentCorrection", label: "随问携带：判断修正（含遗漏反证）" },
  { kind: "processLesson", label: "随问携带：流程教训" }
];

export function composeReportReviewQuestion(
  candidate: ReportReviewQuestionCandidate,
  selection: ReportReviewLessonSelection
): { question: string; carriedLessons: ReportReviewLessonKind[] } {
  const parts = [candidate.question.trim()];
  const carriedLessons: ReportReviewLessonKind[] = [];
  const attribution = `复盘 ${candidate.reviewId} · 检查 ${candidate.checkId}`;
  const lessonText: Record<ReportReviewLessonKind, string> = {
    judgmentCorrection: candidate.judgmentCorrection.trim(),
    processLesson: candidate.processLesson.trim()
  };
  for (const { kind, label } of REPORT_REVIEW_LESSONS) {
    if (!selection[kind] || !lessonText[kind]) continue;
    parts.push(`[${label} · ${attribution}]\n${lessonText[kind]}`);
    carriedLessons.push(kind);
  }
  return { question: parts.join("\n\n"), carriedLessons };
}

export function reportReviewQuestionCandidates(
  history: DecisionReviewHistoryEnvelope | null,
  source: ReportAssistantSource,
  actorId: string
): ReportReviewQuestionCandidate[] {
  if (!history || history.requestedSymbol !== source.symbol || history.metadata.freshness !== "fresh") return [];
  return history.checks.flatMap((check) => check.symbol !== source.symbol ? [] : check.reviews.flatMap((review) => {
    const learning = review.reviewLearning.availability === "preserved"
      ? review.reviewLearning.snapshot : null;
    const question = learning?.nextResearchQuestion?.trim();
    if (review.audit.actorType !== "user" || review.audit.actorId !== actorId
      || review.reviewLearning.availability !== "preserved" || !learning || !question
      || learning.decisionCheckId !== check.id) return [];
    return [{
      key: canonicalJson([
        check.id, review.id, review.reviewedAt, learning.decisionSnapshotId,
        learning.conditionalPreviewId, learning.reviewedFactsAt, question,
        learning.judgmentCorrection, learning.processLesson
      ]),
      checkId: check.id,
      reviewId: review.id,
      reviewedAt: review.reviewedAt,
      outcome: review.outcome,
      question,
      judgmentCorrection: learning.judgmentCorrection,
      processLesson: learning.processLesson
    }];
  }));
}

export function resolveReportReviewQuestionHandoff(
  history: DecisionReviewHistoryEnvelope | null,
  source: ReportAssistantSource,
  actorId: string,
  key: string
): ReportReviewQuestionCandidate {
  const matches = reportReviewQuestionCandidates(history, source, actorId).filter((candidate) => candidate.key === key);
  if (matches.length !== 1) throw new Error("Saved review question changed, disappeared, or no longer belongs to the current actor and symbol.");
  return matches[0];
}

export function renderReportReviewQuestions(
  documentRef: Document,
  output: HTMLElement | null,
  history: DecisionReviewHistoryEnvelope | null,
  source: ReportAssistantSource | null,
  actorId: string | null,
  activeKey: string | null,
  busy: boolean
): void {
  if (!output) return;
  output.replaceChildren();
  if (!source || !actorId) {
    output.textContent = "Refresh a current exact report to load saved review questions.";
    return;
  }
  const candidates = reportReviewQuestionCandidates(history, source, actorId);
  if (!candidates.length) {
    output.textContent = "No preserved user review contains a next research question for this symbol.";
    return;
  }
  for (const candidate of candidates) {
    const row = documentRef.createElement("div");
    const summary = documentRef.createElement("p");
    summary.textContent = `Review ${candidate.reviewId} · check ${candidate.checkId} · ${candidate.outcome} · ${candidate.reviewedAt}\n${candidate.question}\nCorrection: ${candidate.judgmentCorrection}\nProcess lesson: ${candidate.processLesson}`;
    row.append(summary);
    for (const { kind, label } of REPORT_REVIEW_LESSONS) {
      if (!candidate[kind].trim()) continue;
      const option = documentRef.createElement("label");
      const checkbox = documentRef.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = false;
      checkbox.disabled = busy;
      checkbox.dataset.reportReviewLesson = kind;
      checkbox.dataset.reportReviewLessonKey = candidate.key;
      option.append(checkbox, ` ${label}`);
      row.append(option);
    }
    const button = documentRef.createElement("button");
    button.type = "button";
    button.dataset.reportReviewQuestionKey = candidate.key;
    button.disabled = busy;
    button.textContent = activeKey === candidate.key ? "Loaded as editable session draft" : "Carry to current report assistant";
    row.append(button);
    output.append(row);
  }
}
