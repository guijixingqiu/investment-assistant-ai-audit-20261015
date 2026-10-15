import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";
import { cloudAiPolicyAllowsUse, validateCloudAiPolicyEnvelope, type CloudAiPolicyEnvelope } from "../../../packages/contracts/src/cloudAiPolicy.js";
import type { DeepResearchWorkspaceEnvelope } from "../../../packages/contracts/src/deepResearch.js";
import type { DecisionReviewHistoryEnvelope, PostDecisionReviewData } from "../../../packages/contracts/src/decisionReview.js";
import type { ResearchEvidenceQuestionContextTurn, ResearchEvidenceQuestionEnvelope, ResearchEvidenceQuestionFact } from "../../../packages/contracts/src/researchEvidenceQuestion.js";
import { sameWebApiAuth, type WebApiAuth, type WebDecisionReviewHistoryResponse } from "./apiClient.js";
import { requestJson } from "./evidenceConflictData.js";
import { acceptResearchDocumentList, acceptResearchDocumentPage } from "./researchDocumentValidation.js";
import { documentFailureMessage, documentListPath, fetchResearchDocumentJson, fetchResearchDocumentPdf, openPdfBytes } from "./researchDocumentTransport.js";
import { cloudAiPolicySnapshotSummary, cloudAiSendAuthorizationSummary } from "./displayFormatting.js";
import { acceptAssistantCorrectionReadback, acceptAssistantCorrectionWrite, acceptExactReportAssistantWorkspace,
  acceptCurrentReportAssistantWorkspace, acceptReportAssistantAnswer, acceptReportAssistantResponse, assistantCorrectionRequest, reportAssistantQuestionRequest,
  reportAssistantAnswerFacts, reportAssistantInsightTitle, isReportAssistantCounterReviewQuestion, REPORT_ASSISTANT_COUNTER_REVIEW_QUESTION,
  resolveDailyTrackingCorrectionOffer, resolveReportAssistantCitation, trimReportAssistantConversation,
  type CurrentReportAssistantWorkspace, type DailyTrackingCorrectionOffer, type ReportAssistantSource } from "./reportAssistantData.js";
import { composeReportReviewQuestion, renderReportReviewQuestions, resolveReportReviewQuestionHandoff,
  REPORT_REVIEW_LESSONS, REPORT_REVIEW_QUESTION_LENGTH_LIMIT,
  type ReportReviewLessonKind, type ReportReviewLessonSelection } from "./reportReviewQuestionHandoff.js";
import {
  ASSIST_LOCAL_ARCHIVE_TEMPORARY_CONVERSATION_SCHEMA_VERSION,
  validateAssistLocalArchiveTemporaryConversation,
  type AssistLocalArchiveTemporaryConversation
} from "./assistLocalArchive.js";

interface ReportAssistantConsoleDependencies {
  currentSource: () => ReportAssistantSource | null; readAuth: () => WebApiAuth | null; writeAuth: () => WebApiAuth | null;
  loadReviewHistory: (source: ReportAssistantSource, auth: WebApiAuth) => Promise<WebDecisionReviewHistoryResponse>;
  invalidateDeepResearch: (message: string) => void; addFollowUpDraft: (source: ReportAssistantSource, text: string) => void;
}

type ReportCorrectionDraft = { kind: "assistant"; context: CurrentReportAssistantWorkspace; text: string }
  | { kind: "daily_tracking"; context: CurrentReportAssistantWorkspace; offer: DailyTrackingCorrectionOffer };
const DAILY_CORRECTION_INPUTS = ["report-assistant-daily-judgment", "report-assistant-daily-question", "report-assistant-daily-counterevidence"] as const;

/** Counter-review only: what to put back if the request never reached a usable provider. */
interface CounterReviewSnapshot {
  context: CurrentReportAssistantWorkspace;
  answer: ResearchEvidenceQuestionEnvelope | null;
  conversation: ResearchEvidenceQuestionContextTurn[];
  correction: ReportCorrectionDraft | null;
  citationMessage: string;
  reviewHistory: DecisionReviewHistoryEnvelope | null;
  reviewQuestionDraft: { key: string } | null;
}
/** Identity/authorization conflicts stay cleared; only transport or provider unavailability may restore. */
const REPORT_ASSISTANT_AUTH_CONFLICT = /authoriz|unauthorized|Cloud AI is disabled|does not bind|no longer binds|drift|changed during|exact current membership/i;
const REPORT_ASSISTANT_TRANSPORT_FAILURE = /^Offline:|provider|unavailable|HTTP \d|network|fetch|timeout|timed out|not be reached|failed contract validation/i;
function isRestorableCounterReviewFailure(message: string): boolean {
  return REPORT_ASSISTANT_TRANSPORT_FAILURE.test(message) && !REPORT_ASSISTANT_AUTH_CONFLICT.test(message);
}

export class ReportAssistantConsole {
  private documentRef: Document | null = null; private sourceKey = ""; private actorId = ""; private context: CurrentReportAssistantWorkspace | null = null;
  private conversation: ResearchEvidenceQuestionContextTurn[] = []; private answer: ResearchEvidenceQuestionEnvelope | null = null;
  private correction: ReportCorrectionDraft | null = null; private dailyCorrectionTarget: { decisionCheckId: string; reviewId: string } | null = null;
  private reviewHistory: DecisionReviewHistoryEnvelope | null = null; private reviewQuestionDraft: { key: string } | null = null;
  private cloudAiPolicy: CloudAiPolicyEnvelope | null = null;
  private questionRetry: { sourceKey: string; contextKey: string; question: string; request: ReturnType<typeof reportAssistantQuestionRequest> } | null = null;
  private correctionRetry: { fingerprint: string; request: ReturnType<typeof assistantCorrectionRequest>; attempts: number } | null = null;
  private suspendedDailyCorrectionSourceKey: string | null = null;
  private message = "Load a current exact report and evidence pack before asking a question."; private citationMessage = "No citation has been reopened.";
  private generation = 0; private busy = false;

  constructor(private readonly dependencies: ReportAssistantConsoleDependencies) {}

  temporaryConversationState(): string | null {
    const source = this.source(); const context = this.context;
    if (!source || !context) return null;
    const questionDraft = this.optionalInputValue("report-assistant-question");
    const conversation = trimReportAssistantConversation(this.conversation);
    return questionDraft || conversation.length
      ? canonicalJson([source.sourceKey, context.key, questionDraft, conversation]) : null;
  }

  temporaryConversationSnapshot(now = new Date()): AssistLocalArchiveTemporaryConversation | null {
    const source = this.source(); const context = this.context;
    const questionDraft = this.optionalInputValue("report-assistant-question");
    const conversation = trimReportAssistantConversation(this.conversation);
    if (!source || !context || (!questionDraft && conversation.length === 0)) return null;
    const savedAt = now.toISOString();
    return {
      schemaVersion: ASSIST_LOCAL_ARCHIVE_TEMPORARY_CONVERSATION_SCHEMA_VERSION,
      sourceKey: source.sourceKey, actorId: source.actorId,
      membershipId: source.membershipId, membershipVersion: source.membershipVersion, symbol: source.symbol,
      reportId: context.report.id, reportVersion: context.report.version,
      reportFingerprint: context.report.reportFingerprint,
      evidencePackId: context.pack.id, evidencePackFingerprint: context.pack.packFingerprint,
      savedAt, expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
      questionDraft, conversation
    };
  }

  acceptTemporaryConversation(value: unknown, now = new Date()): AssistLocalArchiveTemporaryConversation | null {
    if (value === undefined || value === null) return null;
    const source = this.source(); const context = this.context;
    if (!source || !context || !validateAssistLocalArchiveTemporaryConversation(value)
      || Date.parse(value.expiresAt) <= now.getTime()
      || value.sourceKey !== source.sourceKey || value.actorId !== source.actorId
      || value.membershipId !== source.membershipId || value.membershipVersion !== source.membershipVersion
      || value.symbol !== source.symbol || value.reportId !== context.report.id
      || value.reportVersion !== context.report.version || value.reportFingerprint !== context.report.reportFingerprint
      || value.evidencePackId !== context.pack.id || value.evidencePackFingerprint !== context.pack.packFingerprint) {
      throw new Error("Temporary report conversation is expired or no longer binds the current exact report and pack.");
    }
    return value;
  }

  restoreTemporaryConversation(value: AssistLocalArchiveTemporaryConversation | null, now = new Date()): void {
    const accepted = this.acceptTemporaryConversation(value, now);
    if (!accepted) return;
    this.answer = null;
    this.conversation = [...accepted.conversation];
    this.setInputValue("report-assistant-question", accepted.questionDraft);
    this.message = `已恢复当前 exact report 的本机临时对话（${accepted.conversation.length}/8），到期时间 ${accepted.expiresAt}；未发送新问题。`;
    this.render();
  }

  mount(documentRef: Document = document): void {
    this.documentRef = documentRef;
    this.element("report-assistant-refresh")?.addEventListener("click", () => void this.refresh());
    this.element("report-assistant-ask")?.addEventListener("click", () => void this.ask());
    this.element("report-assistant-counter-review")?.addEventListener("click", () => void this.ask(true));
    this.element("report-assistant-answer")?.addEventListener("click", (event) => void this.routeCitation(event));
    this.element("report-assistant-create-correction")?.addEventListener("click", () => void this.createCorrection());
    this.element("report-assistant-save-correction")?.addEventListener("click", () => void this.saveCorrection());
    for (const id of ["report-assistant-daily-judgment", "report-assistant-daily-question"]) this.element(id)?.addEventListener("input", () => this.render());
    this.element("report-assistant-add-todo")?.addEventListener("click", () => void this.addTodo());
    this.element("report-assistant-review-learning")?.addEventListener("click", (event) => void this.routeReviewQuestion(event));
    this.element("report-assistant-clear-session")?.addEventListener("click", () => this.clearSession());
    this.syncSource();
  }

  syncSource(): void {
    const next = this.dependencies.currentSource();
    const nextKey = next?.sourceKey ?? "";
    const nextActorId = next?.actorId ?? "";
    if (nextKey !== this.sourceKey || nextActorId !== this.actorId) {
      this.generation += 1;
      this.busy = false;
      this.clearAll();
      this.sourceKey = nextKey;
      this.actorId = nextActorId;
      this.message = nextKey
        ? "Current Research source changed. Refresh the exact report assistant before asking."
        : "Load a current exact membership, report, and pack before asking.";
    }
    this.render();
  }

  syncWorkspace(value: DeepResearchWorkspaceEnvelope | null): void {
    const source = this.source();
    if (!source || !value) {
      this.generation += 1;
      this.busy = false;
      this.suspendDailyCorrection(); this.context = null; this.clearAnswer();
      this.render();
      return;
    }
    try {
      const context = acceptCurrentReportAssistantWorkspace(value, source);
      if (this.busy) { this.generation += 1; this.busy = false; }
      this.applyContext(context);
      this.message = `Current exact report ${this.context!.report.id} v${this.context!.report.version} and pack ${this.context!.pack.id} are ready for explicit questions.`;
    } catch (error) {
      this.generation += 1;
      this.busy = false;
      this.suspendDailyCorrection(); this.context = null; this.clearAnswer();
      this.message = failureMessage(error);
    }
    this.render();
  }

  syncReviewHistory(value: DecisionReviewHistoryEnvelope | null): void {
    this.reviewHistory = value?.requestedSymbol === this.source()?.symbol ? value : null;
    if (this.reviewQuestionDraft && this.context) {
      try { resolveReportReviewQuestionHandoff(this.reviewHistory, this.requireSource(), this.context.actorId, this.reviewQuestionDraft.key); }
      catch { this.reviewQuestionDraft = null; this.setInputValue("report-assistant-question", ""); }
    }
    if (this.dailyCorrectionTarget && this.context) {
      try {
        if (!this.reviewHistory) throw new Error("最新复盘历史不可用；旧核验状态已清除，已填写草稿仍保留供显式重试。");
        this.installDailyTrackingCorrection();
      }
      catch (error) { this.context = null; this.clearAnswer(); this.message = failureMessage(error); }
    }
    this.render();
  }

  offerDailyTrackingCorrection(history: DecisionReviewHistoryEnvelope, decisionCheckId: string, reviewId: string, outcome: PostDecisionReviewData["outcome"]): void {
    if (outcome !== "thesis_weakened" && outcome !== "thesis_invalidated") {
      if (this.correction?.kind === "daily_tracking") this.correction = null;
      this.dailyCorrectionTarget = null; this.render(); return;
    }
    this.reviewHistory = history;
    this.dailyCorrectionTarget = { decisionCheckId, reviewId };
    try {
      if (this.context) this.installDailyTrackingCorrection();
      else this.message = "每日跟踪复盘已完成；请刷新当前精确报告后填写人工修正。没有自动写入。";
    } catch (error) { this.context = null; this.clearAnswer(); this.message = failureMessage(error); }
    this.render();
  }

  invalidateAuthorization(message: string): void {
    this.generation += 1;
    this.busy = false;
    this.clearAll();
    this.message = `${message} Previous report-assistant success was cleared.`;
    this.render();
  }

  private async refresh(): Promise<void> {
    this.context = null; this.clearAnswer();
    await this.run("Assistant refresh", async (generation) => {
      const source = this.requireSource();
      const auth = this.requireReadAuth();
      const value = await requestJson(`/api/mobile/research/candidate-memberships/${encodeURIComponent(source.membershipId)}/deep-research`, auth, { cache: "no-store" });
      this.ensureCurrent(source, generation, auth, this.dependencies.readAuth);
      const history = await this.freshReviewHistory(source, auth, generation);
      let policy: CloudAiPolicyEnvelope | null = null;
      try { policy = await this.freshCloudAiPolicy(source, auth, generation); }
      catch { this.ensureCurrent(source, generation, auth, this.dependencies.readAuth); }
      this.cloudAiPolicy = policy;
      if (this.restoreDailyCorrection(value, history, source)) {
        this.message = "已在原精确来源恢复复盘修正草稿；请显式使用同一提交继续核验。"; return;
      }
      const context = acceptCurrentReportAssistantWorkspace(value, source);
      this.reviewHistory = history;
      this.applyContext(context);
      this.message = `Fresh exact report ${context.report.id} v${context.report.version} and pack ${context.pack.id} are ready. No question was sent.${policy ? "" : " Cloud AI policy is unavailable, so Ask remains disabled."}`;
    });
  }

  /** One implementation for both lanes: `counterReview` swaps in the fixed question and sends
   * an empty conversation, leaving the Owner's question draft and prior history untouched. */
  private async ask(counterReview = false): Promise<void> {
    const expected = this.context;
    let question: string;
    if (counterReview) question = REPORT_ASSISTANT_COUNTER_REVIEW_QUESTION;
    else {
      try { question = this.inputValue("report-assistant-question"); }
      catch (error) { this.message = failureMessage(error); this.render(); return; }
    }
    const priorConversation = [...this.conversation];
    const reviewQuestionDraft = counterReview ? null : this.reviewQuestionDraft;
    const counterReviewSnapshot: CounterReviewSnapshot | null = counterReview && expected ? {
      context: expected, answer: this.answer, conversation: priorConversation, correction: this.correction,
      citationMessage: this.citationMessage, reviewHistory: this.reviewHistory,
      reviewQuestionDraft: this.reviewQuestionDraft
    } : null;
    this.answer = null;
    this.conversation = [];
    this.correction = null;
    this.citationMessage = "No citation has been reopened.";
    await this.run("Question", async (generation) => {
      if (!expected) throw new Error("Refresh a current exact report and pack before asking.");
      const source = this.requireSource();
      const auth = this.requireReadAuth(), writeAuth = this.requireWriteAuth();
      const before = await this.freshContext(source, auth, generation, expected.key, expected.actorId);
      this.cloudAiPolicy = null;
      this.cloudAiPolicy = await this.freshCloudAiPolicy(source, auth, generation);
      if (!reportAssistantCloudAiQuestionAllowed(this.cloudAiPolicy)) {
        throw new Error("Cloud AI is not enabled under the current Owner-confirmed provider policy. Use the Cloud AI controls above before asking.");
      }
      let reviewQuestion = null;
      if (reviewQuestionDraft) {
        this.reviewHistory = await this.freshReviewHistory(source, auth, generation);
        reviewQuestion = resolveReportReviewQuestionHandoff(
          this.reviewHistory, source, before.actorId, reviewQuestionDraft.key
        );
      }
      const retry = this.questionRetry;
      const request = retry?.sourceKey === source.sourceKey && retry.contextKey === before.key && retry.question === question
        ? retry.request
        : reportAssistantQuestionRequest(source, before, question, counterReview ? [] : priorConversation, crypto.randomUUID());
      this.questionRetry = { sourceKey: source.sourceKey, contextKey: before.key, question, request };
      const value = await this.postQuestion(
        `/api/mobile/research/candidate-memberships/${encodeURIComponent(source.membershipId)}/evidence-questions`,
        writeAuth,
        request
      );
      this.ensureCurrent(source, generation, auth, this.dependencies.readAuth);
      const answer = acceptReportAssistantResponse(value, before, source, request.question);
      const after = await this.freshContext(source, auth, generation, before.key, before.actorId);
      acceptReportAssistantResponse(answer, after, source, request.question);
      this.cloudAiPolicy = null;
      const afterPolicy = await this.freshCloudAiPolicy(source, auth, generation);
      this.cloudAiPolicy = afterPolicy;
      this.context = after;
      if (answer.status !== "available") {
        if (counterReviewSnapshot && answer.status === "unavailable"
          && isRestorableCounterReviewFailure(answer.message)
          && await this.restoreCounterReviewState(counterReviewSnapshot, this.requireSource(), generation)) {
          this.message = `反方复核未取得可验证回答（provider 或传输不可用）；已重新核验当前精确报告、证据包、actor 与授权一致，恢复此前对话与草稿，未写入任何内容：${answer.message}`;
          return;
        }
        this.answer = answer;
        this.message = answer.message;
        return;
      }
      if (!reportAssistantCloudAiQuestionAllowed(afterPolicy)) {
        throw new Error("Cloud AI authorization changed during the question; the late answer was discarded.");
      }
      this.questionRetry = null;
      this.answer = answer;
      this.conversation = trimReportAssistantConversation([...priorConversation, {
        reportFingerprint: after.report.reportFingerprint,
        question: request.question,
        answer: answer.answer!
      }]);
      if (!counterReview) this.reviewQuestionDraft = null;
      this.message = counterReview
        ? `反方复核（同模型）answer ${this.conversation.length}/8 is bound to report ${after.report.id} v${after.report.version} and pack ${after.pack.id}; it is a same-model evidence-scope check of the current report's bound facts, not independent outside-source research or a different-provider opinion. 你的问题草稿与此前对话保持不变；报告、正式决定与资产事实未变。`
        : reviewQuestion
        ? `Saved review question ${reviewQuestion.reviewId}${question === reviewQuestion.question ? "" : " (edited in this session)"} was explicitly asked against current report ${after.report.id} v${after.report.version}; answer ${this.conversation.length}/8 is exact-pack bound.`
        : `Answer ${this.conversation.length}/8 is bound to report ${after.report.id} v${after.report.version} and pack ${after.pack.id}.`;
    }, counterReviewSnapshot ? async (generation, error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!isRestorableCounterReviewFailure(message)) return false;
      const source = this.source();
      if (!source || !await this.restoreCounterReviewState(counterReviewSnapshot, source, generation)) return false;
      this.message = `反方复核请求未送达（provider 或传输不可用）；已重新核验当前精确报告、证据包、actor 与授权一致，恢复此前对话与草稿，未写入任何内容。原始提示：${documentFailureMessage(error)}`;
      return true;
    } : undefined);
  }

  /** Restores the pre-counter-review view only after a fresh exact report/pack/actor/auth recheck. */
  private async restoreCounterReviewState(snapshot: CounterReviewSnapshot, source: ReportAssistantSource,
    generation: number): Promise<boolean> {
    const auth = this.dependencies.readAuth();
    if (!auth || !this.source()) return false;
    let fresh: CurrentReportAssistantWorkspace;
    try {
      fresh = await this.freshContext(source, auth, generation, snapshot.context.key, snapshot.context.actorId);
    } catch { return false; }
    this.context = fresh;
    this.answer = snapshot.answer;
    this.conversation = [...snapshot.conversation];
    this.correction = snapshot.correction;
    this.citationMessage = snapshot.citationMessage;
    this.reviewHistory = snapshot.reviewHistory;
    this.reviewQuestionDraft = snapshot.reviewQuestionDraft;
    return true;
  }

  private async routeReviewQuestion(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-report-review-question-key]");
    if (!(button instanceof HTMLButtonElement) || !button.dataset.reportReviewQuestionKey) return;
    const key = button.dataset.reportReviewQuestionKey;
    // Capture the optional lesson checkboxes synchronously: the async refresh below re-renders this list.
    const selection = this.selectedReviewLessons(key);
    const expected = this.context;
    await this.run("Review question handoff", async (generation) => {
      if (!expected) throw new Error("Refresh a current exact report before carrying a saved review question.");
      const source = this.requireSource();
      const auth = this.requireReadAuth();
      const context = await this.freshContext(source, auth, generation, expected.key, expected.actorId);
      const history = await this.freshReviewHistory(source, auth, generation);
      const candidate = resolveReportReviewQuestionHandoff(history, source, context.actorId, key);
      const composed = composeReportReviewQuestion(candidate, selection);
      if (composed.question.trim().length > REPORT_REVIEW_QUESTION_LENGTH_LIMIT) {
        this.context = context;
        this.reviewHistory = history;
        this.message = `Review ${candidate.reviewId} 问题加所选复盘原文共 ${composed.question.trim().length} 字符，超过 ${REPORT_REVIEW_QUESTION_LENGTH_LIMIT} 字符上限；问题草稿未改变，也没有发送或截断来源。请取消勾选或先手动缩短问题。`;
        return;
      }
      this.context = context;
      this.reviewHistory = history;
      this.reviewQuestionDraft = { key: candidate.key };
      this.setInputValue("report-assistant-question", composed.question);
      const carried = composed.carriedLessons.map((kind) => kind === "judgmentCorrection" ? "判断修正（含遗漏反证）" : "流程教训");
      const attribution = `来源：复盘 ${candidate.reviewId} · 检查 ${candidate.checkId}`;
      this.message = carried.length
        ? `Saved review ${candidate.reviewId} 问题已连同所选 ${carried.join("、")}（${attribution}）成为可编辑会话草稿；只携带该复盘所选原文，未吸收其余历史。点击 Ask explicitly 才会发送到当前报告 ${context.report.id} v${context.report.version}。`
        : `Saved review ${candidate.reviewId} question is now an editable session draft. Click Ask explicitly to send it against current report ${context.report.id} v${context.report.version}.`;
    });
  }

  private selectedReviewLessons(key: string): ReportReviewLessonSelection {
    const host = this.element("report-assistant-review-learning");
    const selected = new Set<ReportReviewLessonKind>();
    for (const input of host?.querySelectorAll<HTMLInputElement>("input[data-report-review-lesson]") ?? []) {
      const kind = input.dataset.reportReviewLesson as ReportReviewLessonKind | undefined;
      if (input.checked && input.dataset.reportReviewLessonKey === key
        && REPORT_REVIEW_LESSONS.some((lesson) => lesson.kind === kind)) selected.add(kind!);
    }
    return { judgmentCorrection: selected.has("judgmentCorrection"), processLesson: selected.has("processLesson") };
  }

  private clearSession(): void {
    if (this.busy) return;
    this.reviewQuestionDraft = null;
    this.questionRetry = null;
    this.setInputValue("report-assistant-question", "");
    this.clearAnswer();
    this.message = "已清空临时对话。已保存资料、导出文件和未决的修正草稿仍保留。";
    this.render();
  }

  private async routeCitation(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-report-assistant-fact-index]");
    if (!(button instanceof HTMLButtonElement)) return;
    const index = Number(button.dataset.reportAssistantFactIndex);
    const expected = this.context;
    const answer = this.answer;
    const fact = answer?.facts[index];
    const conversation = [...this.conversation];
    if (!expected || !answer || !fact) return;
    this.answer = null;
    this.conversation = [];
    await this.run("Citation reopen", async (generation) => {
      const source = this.requireSource();
      const auth = this.requireReadAuth();
      const context = await this.freshContext(source, auth, generation, expected.key, expected.actorId);
      acceptReportAssistantAnswer(answer, context, source, answer.question);
      const resolution = resolveReportAssistantCitation(context, fact);
      if (resolution.kind === "document") {
        await this.reopenDocument(source, auth, generation, resolution);
        this.citationMessage = `Reopened exact PDF document ${resolution.documentId} page ${resolution.pageNumber} after fresh SHA-256 checks.`;
      } else if (resolution.kind === "external") {
        openExternal(resolution.url);
        this.citationMessage = `Opened exact ${resolution.label} credential-free HTTPS source.`;
      } else if (resolution.kind === "material") {
        this.citationMessage = `Exact material ${resolution.material.id} r${resolution.material.revision} · ${resolution.material.title}\n${resolution.material.contentText}`;
      } else {
        this.citationMessage = `Exact report-bound snapshot citation · ${resolution.label}`;
      }
      this.context = context;
      this.answer = answer;
      this.conversation = conversation;
      this.message = `Citation remained exact to report ${context.report.id} v${context.report.version}; no alternate source was selected.`;
    });
  }

  private async createCorrection(): Promise<void> {
    const expected = this.context;
    const answer = this.answer;
    const conversation = [...this.conversation];
    if (!expected || !answer?.answer) return;
    this.answer = null;
    this.conversation = [];
    await this.run("Correction draft", async (generation) => {
      const source = this.requireSource();
      const auth = this.requireReadAuth();
      const context = await this.freshContext(source, auth, generation, expected.key, expected.actorId);
      acceptReportAssistantAnswer(answer, context, source, answer.question);
      // Explanation stays labelled model interpretation: it is never pre-filled as a quoted source fact.
      const text = [
        answer.answer,
        ...answer.insights.map((item) => `${item.impact}：${item.statement}`),
        ...answer.insights.filter((item) => item.explanation)
          .map((item) => `模型解读（非事实/来源，仅供你判断）：${item.impact}：${item.explanation}`)
      ].join("\n").slice(0, 4_000);
      this.context = context;
      this.answer = answer;
      this.conversation = conversation;
      this.correction = { kind: "assistant", context, text };
      this.setInputValue("report-assistant-correction", text);
      this.message = "Editable correction draft created in browser memory. Click Save correction separately to write one unverified material.";
    });
  }
  private async saveCorrection(): Promise<void> {
    if (this.suspendedDailyCorrectionSourceKey) return;
    const draft = this.correction;
    if (!draft) return;
    const expected = draft.context;
    let correction;
    try {
      correction = draft.kind === "assistant" ? this.inputValue("report-assistant-correction") : {
        offer: draft.offer, judgmentCorrection: this.inputValue("report-assistant-daily-judgment"),
        nextResearchQuestion: this.inputValue("report-assistant-daily-question"),
        counterevidence: this.optionalInputValue("report-assistant-daily-counterevidence")
      };
    } catch (error) { this.message = failureMessage(error); this.render(); return; }
    const fingerprint = canonicalJson([expected.key, correction]);
    if (this.correctionRetry?.fingerprint !== fingerprint) {
      this.correctionRetry = {
        fingerprint, request: assistantCorrectionRequest(this.requireSource(), expected, correction, `web-report-correction-${crypto.randomUUID()}`, new Date()),
        attempts: 0
      };
    }
    const retry = this.correctionRetry;
    const replay = retry.attempts > 0;
    retry.attempts += 1;
    await this.run("Correction save", async (generation) => {
      const source = this.requireSource();
      const readAuth = this.requireReadAuth();
      const writeAuth = this.requireWriteAuth();
      if (draft.kind === "daily_tracking") {
        const history = await this.freshReviewHistory(source, readAuth, generation);
        this.reviewHistory = history;
        const current = resolveDailyTrackingCorrectionOffer(history, source, expected, draft.offer.decisionCheckId, draft.offer.reviewId);
        if (!current || current.key !== draft.offer.key) throw new Error("每日跟踪复盘、操作者或报告绑定已经变化。");
      }
      const workspacePath = `/api/mobile/research/candidate-memberships/${encodeURIComponent(source.membershipId)}/deep-research`;
      const beforeValue = await requestJson(workspacePath, readAuth, { cache: "no-store" });
      this.ensureCurrent(source, generation, readAuth, this.dependencies.readAuth);
      const exact = acceptExactReportAssistantWorkspace(beforeValue, source, expected.actorId);
      if (!replay) acceptCurrentReportAssistantWorkspace(beforeValue, source, expected.key, exact.requestedActorId);
      this.ensureCurrent(source, generation, writeAuth, this.dependencies.writeAuth);
      const request = retry.request;
      let material: ReturnType<typeof acceptAssistantCorrectionWrite> | null = null;
      let postError: unknown = null;
      try {
        material = acceptAssistantCorrectionWrite(await requestJson(
          `/api/mobile/research/profiles/${source.market}/${source.code}/materials`, writeAuth, { method: "POST", headers: {
            "content-type": "application/json",
            "x-research-expected-actor-id": exact.requestedActorId
          }, body: JSON.stringify(request) }
        ), expected.actorId, request);
      } catch (error) { postError = error; }
      this.ensureCurrent(source, generation, writeAuth, this.dependencies.writeAuth);
      let afterValue;
      try { afterValue = await requestJson(workspacePath, readAuth, { cache: "no-store" }); }
      catch (error) { throw this.correctionFailure(draft, error); }
      this.ensureCurrent(source, generation, readAuth, this.dependencies.readAuth);
      let saved;
      try { saved = acceptAssistantCorrectionReadback(expected, afterValue, source, material, request); }
      catch (error) { throw this.correctionFailure(draft, postError ?? error); }
      this.clearAll(false);
      this.message = draft.kind === "daily_tracking"
        ? `复盘修正材料 ${saved.material.id} 已精确回读；旧证据包和报告已转为历史。请手动重新冻结 → Deep Research → 人工判断。`
        : `Saved correction material ${saved.material.id}. The old pack/report are historical; explicitly freeze and synthesize again.`;
      this.dependencies.invalidateDeepResearch(this.message);
    });
  }
  private async addTodo(): Promise<void> {
    const expected = this.context;
    const answer = this.answer;
    const conversation = [...this.conversation];
    if (!expected || !answer) return;
    this.answer = null;
    this.conversation = [];
    await this.run("Research follow-up draft", async (generation) => {
      const source = this.requireSource();
      const auth = this.requireReadAuth();
      const context = await this.freshContext(source, auth, generation, expected.key, expected.actorId);
      acceptReportAssistantAnswer(answer, context, source, answer.question);
      const text = [
        `报告 ${context.report.id} v${context.report.version} 待核：${answer.question}`,
        ...answer.unknowns.map((item) => `UNKNOWN：${item}`)
      ].join("\n").slice(0, 1_000);
      this.dependencies.addFollowUpDraft(source, text);
      this.context = context;
      this.answer = answer;
      this.conversation = conversation;
      this.message = "Added to the existing session-local evidence-gap draft. Nothing was sent or persisted.";
    });
  }
  private async freshContext(source: ReportAssistantSource, auth: WebApiAuth, generation: number,
    expectedKey?: string, expectedActorId?: string, currentAuth: () => WebApiAuth | null = this.dependencies.readAuth): Promise<CurrentReportAssistantWorkspace> {
    const value = await requestJson(`/api/mobile/research/candidate-memberships/${encodeURIComponent(source.membershipId)}/deep-research`, auth, { cache: "no-store" });
    this.ensureCurrent(source, generation, auth, currentAuth);
    return acceptCurrentReportAssistantWorkspace(value, source, expectedKey, expectedActorId);
  }
  private async freshReviewHistory(source: ReportAssistantSource, auth: WebApiAuth, generation: number): Promise<DecisionReviewHistoryEnvelope> {
    const result = await this.dependencies.loadReviewHistory(source, auth);
    this.ensureCurrent(source, generation, auth, this.dependencies.readAuth);
    if (!result.ok) throw new Error(`Review history is unavailable: ${result.reason}`);
    if (result.value.requestedSymbol !== source.symbol) throw new Error("Review history no longer binds the current symbol.");
    return result.value;
  }
  private async reopenDocument(source: ReportAssistantSource, auth: WebApiAuth, generation: number,
    citation: { documentId: string; pageNumber: number; pageTextSha256: string }): Promise<void> {
    const membership = { id: source.membershipId, version: source.membershipVersion, symbol: source.symbol };
    const list = acceptResearchDocumentList(await fetchResearchDocumentJson(documentListPath(membership.id), auth, { cache: "no-store" }), membership);
    this.ensureCurrent(source, generation, auth, this.dependencies.readAuth);
    const documents = list.documents.filter((item) => item.id === citation.documentId && item.sourceState === "available");
    if (documents.length !== 1) throw new Error("Exact PDF document is absent, unavailable, or ambiguous in the fresh list.");
    const page = await acceptResearchDocumentPage(await fetchResearchDocumentJson(
      `${documentListPath(membership.id)}/${encodeURIComponent(citation.documentId)}/pages/${citation.pageNumber}`, auth, { cache: "no-store" }
    ), citation.documentId, citation.pageNumber, citation.pageTextSha256);
    this.ensureCurrent(source, generation, auth, this.dependencies.readAuth);
    const bytes = await fetchResearchDocumentPdf(membership, documents[0], auth);
    this.ensureCurrent(source, generation, auth, this.dependencies.readAuth);
    openPdfBytes(bytes, documents[0].originalFilename, page.pageNumber, false);
  }
  private async run(label: string, action: (generation: number) => Promise<void>,
    onFailure?: (generation: number, error: unknown) => Promise<boolean>): Promise<void> {
    if (this.busy) return;
    const generation = ++this.generation;
    this.busy = true; this.message = `${label} is fresh-reading exact identities…`;
    this.render();
    try { await action(generation); } catch (error) {
      if (generation !== this.generation) return;
      let restored = false;
      if (onFailure) { try { restored = await onFailure(generation, error); } catch { restored = false; } }
      if (!restored) {
        this.context = null; this.clearAnswer();
        this.citationMessage = "No citation was opened; no alternate source was selected.";
        this.message = `${label} blocked: ${documentFailureMessage(error)}`;
      }
    } finally {
      if (generation === this.generation) this.busy = false;
      this.render();
    }
  }

  private applyContext(context: CurrentReportAssistantWorkspace): void {
    if (this.context?.key !== context.key) {
      this.clearAnswer();
      this.reviewQuestionDraft = null;
      if (!this.suspendedDailyCorrectionSourceKey && this.correction?.context.key !== context.key) {
        this.correction = null;
        this.correctionRetry = null;
      }
    }
    this.context = context;
    if (this.dailyCorrectionTarget) this.installDailyTrackingCorrection();
  }
  private installDailyTrackingCorrection(): void {
    const source = this.source();
    if (!source || !this.context || !this.reviewHistory || !this.dailyCorrectionTarget) return;
    const offer = resolveDailyTrackingCorrectionOffer(
      this.reviewHistory, source, this.context,
      this.dailyCorrectionTarget.decisionCheckId, this.dailyCorrectionTarget.reviewId
    );
    if (!offer) { this.dailyCorrectionTarget = null; if (this.correction?.kind === "daily_tracking") this.correction = null; return; }
    if (this.correction?.kind === "daily_tracking" && this.correction.offer.key === offer.key) return;
    this.correction = { kind: "daily_tracking", context: this.context, offer };
    this.correctionRetry = null;
    for (const id of ["report-assistant-daily-judgment", "report-assistant-daily-question", "report-assistant-daily-counterevidence"]) this.setInputValue(id, "");
    this.message = `每日跟踪复盘 ${offer.reviewId} 已核验为${offer.reviewOutcome === "thesis_weakened" ? "论点减弱" : "论点失效"}；请人工填写后显式保存。`;
  }

  private correctionFailure(draft: ReportCorrectionDraft, error: unknown): unknown {
    return draft.kind === "daily_tracking"
      ? new Error(`复盘修正可能已写入，但 fresh history/workspace 核验未完成；请保留当前文字并用同一提交显式重试。${failureMessage(error)}`)
      : error;
  }

  private clearAnswer(): void { this.answer = null; this.conversation = []; this.citationMessage = "No citation has been reopened."; }
  private suspendDailyCorrection(): void {
    if (this.correction?.kind === "daily_tracking" && !this.suspendedDailyCorrectionSourceKey) this.suspendedDailyCorrectionSourceKey = this.sourceKey;
    else if (this.correction?.kind !== "daily_tracking") { this.correction = null; this.correctionRetry = null; }
  }

  private restoreDailyCorrection(value: unknown, history: DecisionReviewHistoryEnvelope, source: ReportAssistantSource): boolean {
    const draft = this.correction;
    if (draft?.kind !== "daily_tracking" || this.suspendedDailyCorrectionSourceKey !== source.sourceKey) return false;
    const offer = resolveDailyTrackingCorrectionOffer(history, source, draft.context, draft.offer.decisionCheckId, draft.offer.reviewId);
    if (!offer || offer.key !== draft.offer.key) return false;
    const exact = acceptExactReportAssistantWorkspace(value, source, draft.context.actorId);
    try { this.context = acceptCurrentReportAssistantWorkspace(exact, source, draft.context.key, draft.context.actorId); } catch (error) {
      if (!this.correctionRetry) throw error;
      acceptAssistantCorrectionReadback(draft.context, exact, source, null, this.correctionRetry.request); this.context = null;
    }
    this.reviewHistory = history; this.dailyCorrectionTarget = { decisionCheckId: offer.decisionCheckId, reviewId: offer.reviewId };
    this.suspendedDailyCorrectionSourceKey = null; return true;
  }

  private clearAll(preserveDailyCorrection = true): void {
    if (preserveDailyCorrection) this.suspendDailyCorrection(); else this.suspendedDailyCorrectionSourceKey = null;
    this.context = null; this.reviewHistory = null; this.reviewQuestionDraft = null; this.cloudAiPolicy = null; this.clearAnswer(); this.dailyCorrectionTarget = null;
    this.questionRetry = null;
    if (!preserveDailyCorrection || this.correction?.kind !== "daily_tracking") { this.correction = null; this.correctionRetry = null; }
    this.setInputValue("report-assistant-question", ""); this.setInputValue("report-assistant-correction", "");
    if (!preserveDailyCorrection) for (const id of DAILY_CORRECTION_INPUTS) this.setInputValue(id, "");
  }

  private ensureCurrent(source: ReportAssistantSource, generation: number, expectedAuth: WebApiAuth,
    currentAuth: () => WebApiAuth | null): void {
    if (generation !== this.generation || this.source()?.sourceKey !== source.sourceKey
      || !sameWebApiAuth(expectedAuth, currentAuth())) {
      throw new Error("Current membership, source, or authorization changed during the operation.");
    }
  }

  private source(): ReportAssistantSource | null { const source = this.dependencies.currentSource(); return source?.sourceKey === this.sourceKey && source.actorId === this.actorId ? source : null; }
  private requireSource(): ReportAssistantSource { const source = this.source(); if (!source) throw new Error("Current exact Research source is required."); return source; }
  private requireReadAuth(): WebApiAuth { const auth = this.dependencies.readAuth(); if (!auth) throw new Error("Research-read authorization is required."); return auth; }
  private requireWriteAuth(): WebApiAuth { const auth = this.dependencies.writeAuth(); if (!auth) throw new Error("Research-write authorization is required."); return auth; }

  private async freshCloudAiPolicy(
    source: ReportAssistantSource,
    auth: WebApiAuth,
    generation: number
  ): Promise<CloudAiPolicyEnvelope> {
    const value = await requestJson("/api/mobile/research/cloud-ai-policy", auth, { cache: "no-store" });
    this.ensureCurrent(source, generation, auth, this.dependencies.readAuth);
    return acceptReportAssistantCloudAiPolicy(value, source.actorId);
  }

  private async postQuestion(path: string, auth: WebApiAuth,
    request: ReturnType<typeof reportAssistantQuestionRequest>): Promise<unknown> {
    const headers = new Headers({ "content-type": "application/json", accept: "application/json" });
    headers.set(auth.headerName, auth.token);
    let response: Response;
    try { response = await fetch(path, { method: "POST", headers, body: JSON.stringify(request) }); }
    catch (error) { throw new Error(error instanceof Error ? `Offline: ${error.message}` : "Offline: request failed.", { cause: error }); }
    const value = await response.json().catch(() => null) as unknown;
    if (value === null) throw new Error(`Question response is not valid JSON (HTTP ${response.status}).`);
    return value;
  }

  private render(): void {
    if (!this.documentRef) return;
    const visibleCorrection = this.suspendedDailyCorrectionSourceKey ? null : this.correction;
    const dailyCorrection = visibleCorrection?.kind === "daily_tracking" ? visibleCorrection : null;
    this.renderChrome(this.documentRef, visibleCorrection, dailyCorrection);
    this.renderAnswer(this.documentRef);
    this.renderActions(visibleCorrection, dailyCorrection);
  }

  private renderChrome(documentRef: Document, visibleCorrection: ReportCorrectionDraft | null,
    dailyCorrection: Extract<ReportCorrectionDraft, { kind: "daily_tracking" }> | null): void {
    const host = this.element("report-assistant-console");
    if (host) host.dataset.state = this.busy ? "loading" : this.context ? "available" : this.source() ? "idle" : "unavailable";
    const editor = this.element("report-assistant-editor");
    if (editor) editor.hidden = !this.context && !visibleCorrection;
    const correction = this.element("report-assistant-correction-editor");
    if (correction) correction.hidden = !visibleCorrection;
    const genericFields = this.element("report-assistant-generic-correction");
    if (genericFields) genericFields.hidden = dailyCorrection !== null;
    const dailyFields = this.element("report-assistant-daily-correction");
    if (dailyFields) dailyFields.hidden = !dailyCorrection;
    this.setText("report-assistant-daily-correction-binding", dailyCorrection
      ? `${dailyCorrection.offer.reviewOutcome === "thesis_weakened" ? "论点减弱" : "论点失效"} · 复盘 ${dailyCorrection.offer.reviewId} · 检查 ${dailyCorrection.offer.decisionCheckId} · 报告 ${dailyCorrection.context.report.id} v${dailyCorrection.context.report.version} · 证据包 ${dailyCorrection.context.pack.id}`
      : "");
    this.setText("report-assistant-status", this.message);
    this.setText("report-assistant-binding", this.context
      ? `${this.context.workspace.requestedSymbol} · membership ${this.context.workspace.membershipId} v${this.context.workspace.data!.target.membershipVersion} · report ${this.context.report.id} v${this.context.report.version} · pack ${this.context.pack.id}`
      : "No fresh current report/pack binding.");
    const cloudAiState = this.cloudAiPolicy?.state;
    this.setText("report-assistant-cloud-ai-policy", this.cloudAiPolicy
      ? `${this.cloudAiPolicy.message} lifecycle=${cloudAiState?.status ?? "UNKNOWN"}; confirmedAt=${cloudAiState?.confirmedAt ?? "UNKNOWN"}; revokedAt=${cloudAiState?.revokedAt ?? "not_revoked"}; deletion=${cloudAiState?.deletionRequest.status ?? "UNKNOWN"}@${cloudAiState?.deletionRequest.requestedAt ?? "not_requested"}. Provider=${this.cloudAiPolicy.policy.provider}/${this.cloudAiPolicy.policy.model}; backup=${this.cloudAiPolicy.policy.backupProvider}; region=${this.cloudAiPolicy.policy.processingRegion}; retention=${this.cloudAiPolicy.policy.retention}; training=${this.cloudAiPolicy.policy.training}; noTrainingGuaranteed=${this.cloudAiPolicy.policy.noTrainingGuaranteed}. 将发送 question、最多 8 轮 conversation、symbol、report binding、报告 facts 与 UNKNOWN；不发送整份 PDF、凭证或官方资产事实。`
      : "尚未为当前 Owner fresh-read Cloud AI 策略；不会发送问题。请先刷新精确报告。");
    this.setText("report-assistant-citation", this.citationMessage);
    renderReportReviewQuestions(
      documentRef, this.element("report-assistant-review-learning"), this.reviewHistory,
      this.context ? this.source() : null, this.context?.actorId ?? null, this.reviewQuestionDraft?.key ?? null, this.busy
    );
  }

  private renderAnswer(documentRef: Document): void {
    const output = this.element("report-assistant-answer");
    if (output) {
      output.replaceChildren();
      if (!this.answer && this.conversation.length === 0) output.textContent = "No fresh evidence-bound answer.";
      else if (!this.answer) {
        const heading = documentRef.createElement("strong");
        heading.textContent = `已恢复临时对话 ${this.conversation.length}/8`;
        output.append(heading);
        for (const turn of this.conversation) {
          const item = documentRef.createElement("p");
          item.textContent = `问：${turn.question}\n答：${turn.answer}`;
          output.append(item);
        }
      }
      else {
        if (isReportAssistantCounterReviewQuestion(this.answer.question)) {
          const label = documentRef.createElement("strong");
          label.dataset.reportAssistantCounterReview = "true";
          label.textContent = `反方复核（同模型）· 仅依据当前报告已绑定的事实与证据；不是独立外部来源调研，也不是不同提供方模型的第二意见。`;
          output.append(label);
        }
        const summary = documentRef.createElement("p");
        summary.textContent = this.answer.status === "available"
          ? this.answer.answer
          : `未取得可用回答：${this.answer.message}`;
        output.append(summary);
        const usage = documentRef.createElement("p");
        usage.textContent = `${this.answer.reproducibility.provider}/${this.answer.reproducibility.model} · ${this.answer.reproducibility.tokenUsage} · cost=${this.answer.reproducibility.cost}`;
        output.append(usage);
        if (this.answer.sendManifest) {
          const manifest = documentRef.createElement("p");
          const estimate = this.answer.sendManifest.inputTokenUpperBound !== undefined
            && this.answer.sendManifest.maxOutputTokens !== undefined
            && this.answer.sendManifest.estimatedMaxCostUsd !== undefined
            ? ` · cost ceiling=input<=${this.answer.sendManifest.inputTokenUpperBound}+output<=${this.answer.sendManifest.maxOutputTokens} tokens, max US$${this.answer.sendManifest.estimatedMaxCostUsd.toFixed(8)}, pricing=${this.answer.sendManifest.pricingIdentity}`
            : " · cost ceiling=not captured for historical answer";
          manifest.textContent = `Actual send manifest: preparedAt=${this.answer.sendManifest.preparedAt ?? "UNKNOWN"} · facts=${this.answer.sendManifest.factCount} · unknowns=${this.answer.sendManifest.unknownCount} · conversation=${this.answer.sendManifest.conversationTurnCount} · evidence=${this.answer.sendManifest.sourceEvidenceIds.join(",") || "none"} · policy=${this.answer.sendManifest.policyVersion} · ${cloudAiPolicySnapshotSummary(this.answer.sendManifest.policySnapshot)} · ${cloudAiSendAuthorizationSummary(this.answer.sendManifest.sendAuthorization)} · requestSha256=${this.answer.sendManifest.requestBodySha256}${estimate} · fullPdf/credentials/officialAssets=false`;
          output.append(manifest);
        }
        if (this.answer.insights.length) {
          const heading = documentRef.createElement("strong"); heading.textContent = "这意味着"; output.append(heading);
          for (const insight of this.answer.insights) {
            const item = documentRef.createElement("p"); item.dataset.reportAssistantInsight = insight.impact;
            const insightText = `${reportAssistantInsightTitle(insight.impact)}：${insight.statement} · ${insight.source === "unknown" ? "待核实项" : insight.evidenceIds.join(",") || "报告上下文"}`;
            item.setAttribute("aria-label", insightText); item.textContent = insightText;
            output.append(item);
            if (insight.explanation) {
              // Model interpretation only: never quoted as a stored source fact or citation.
              const note = documentRef.createElement("p");
              note.dataset.reportAssistantInsightExplanation = insight.impact;
              note.textContent = `模型解读（非事实/来源）：${insight.explanation}`;
              output.append(note);
            }
          }
        }
        const answerFacts = new Set(reportAssistantAnswerFacts(this.answer));
        this.answer.facts.forEach((fact, index) => { if (answerFacts.has(fact)) output.append(this.factRow(fact, index)); });
        for (const unknown of this.answer.unknowns) {
          const item = documentRef.createElement("p");
          item.textContent = `UNKNOWN：${unknown}`;
          output.append(item);
        }
      }
    }
  }

  private renderActions(visibleCorrection: ReportCorrectionDraft | null,
    dailyCorrection: Extract<ReportCorrectionDraft, { kind: "daily_tracking" }> | null): void {
    const clearSession = this.element("report-assistant-clear-session");
    if (clearSession instanceof HTMLButtonElement) clearSession.disabled = this.busy;
    for (const id of ["report-assistant-refresh", "report-assistant-ask", "report-assistant-counter-review", "report-assistant-create-correction", "report-assistant-save-correction", "report-assistant-add-todo"]) {
      const button = this.element(id);
      if (!(button instanceof HTMLButtonElement)) continue;
      if (id === "report-assistant-save-correction") button.textContent = dailyCorrection ? "保存复盘修正并准备重研" : "将修正保存为未验证材料";
      button.disabled = this.busy || !this.source()
        || id !== "report-assistant-refresh" && id !== "report-assistant-save-correction" && !this.context
        || ["report-assistant-ask", "report-assistant-counter-review"].includes(id)
          && !reportAssistantCloudAiQuestionAllowed(this.cloudAiPolicy)
        || ["report-assistant-create-correction", "report-assistant-add-todo"].includes(id)
          && this.answer?.status !== "available"
        || id === "report-assistant-save-correction" && (!visibleCorrection || dailyCorrection !== null
          && (!this.optionalInputValue("report-assistant-daily-judgment") || !this.optionalInputValue("report-assistant-daily-question")));
    }
  }

  private factRow(fact: ResearchEvidenceQuestionFact, index: number): HTMLElement {
    const row = this.documentRef!.createElement("p");
    const text = this.documentRef!.createElement("span");
    text.textContent = `${fact.statement} · ${fact.sourceKind}/${fact.sourceId ?? "UNKNOWN"} · ${fact.evidenceIds.join(",") || "context"}`;
    const button = this.documentRef!.createElement("button");
    button.type = "button";
    button.dataset.reportAssistantFactIndex = String(index);
    button.disabled = this.busy;
    button.textContent = "Reopen exact citation";
    row.append(text, " ", button);
    return row;
  }

  private inputValue(id: string): string {
    const value = this.optionalInputValue(id);
    if (!value) throw new Error(`${id} is required.`);
    return value;
  }
  private optionalInputValue(id: string): string {
    const element = this.element(id);
    return typeof HTMLInputElement !== "undefined" && typeof HTMLTextAreaElement !== "undefined"
      && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) ? element.value.trim() : "";
  }
  private setInputValue(id: string, value: string): void {
    const element = this.element(id);
    if (typeof HTMLInputElement !== "undefined" && typeof HTMLTextAreaElement !== "undefined"
      && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) element.value = value;
  }
  private element(id: string): HTMLElement | null { return this.documentRef?.getElementById(id) ?? null; }
  private setText(id: string, value: string): void { const element = this.element(id); if (element) element.textContent = value; }
}

export function acceptReportAssistantCloudAiPolicy(value: unknown, actorId: string): CloudAiPolicyEnvelope {
  const validation = validateCloudAiPolicyEnvelope(value);
  if (!validation.ok) throw new Error(`Cloud AI policy is malformed: ${validation.errors.join("; ")}`);
  const envelope = value as CloudAiPolicyEnvelope;
  if (envelope.status !== "available" || envelope.requestedActorId !== actorId || envelope.state?.actorId !== actorId) {
    throw new Error("Cloud AI policy no longer matches the current Owner.");
  }
  return envelope;
}

export function reportAssistantCloudAiQuestionAllowed(policy: CloudAiPolicyEnvelope | null): boolean {
  return cloudAiPolicyAllowsUse(policy);
}

function openExternal(url: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.click();
}
function failureMessage(error: unknown): string { return error instanceof Error ? error.message : "Report assistant is unavailable."; }
