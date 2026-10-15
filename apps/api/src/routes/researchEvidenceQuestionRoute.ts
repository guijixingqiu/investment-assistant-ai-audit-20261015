import type { FastifyInstance } from "fastify";
import { validateDeepResearchWorkspaceEnvelope } from "../../../../packages/contracts/src/deepResearch.js";
import {
  type ResearchEvidenceQuestionRequest,
  type ResearchEvidenceQuestionSendManifest,
  validateResearchEvidenceQuestionEnvelope,
  validateResearchEvidenceQuestionRequest
} from "../../../../packages/contracts/src/researchEvidenceQuestion.js";
import {
  cloudAiPolicyIsEnabled,
  withCloudAiPolicySendAuthorization
} from "../research/cloudAiPolicyRepository.js";
import { readDeepResearchWorkspace } from "../research/deepResearchReadRepository.js";
import {
  generateResearchEvidenceQuestionWithAi,
  prepareResearchEvidenceQuestionAiRequest,
  ResearchEvidenceQuestionProviderError
} from "../research/researchEvidenceQuestionAi.js";
import { runIdempotentResearchEvidenceQuestion } from "../research/researchEvidenceQuestionRepository.js";
import {
  answerResearchEvidenceQuestion,
  researchEvidenceQuestionBindingMatches,
  researchEvidenceQuestionFailClosed,
  researchEvidenceQuestionReportContext
} from "../research/researchEvidenceQuestionService.js";
import { authenticateWrite, derivePinganSnapshotAccountScope } from "./researchAuth.js";
import type { MobileResearchRouteOptions } from "./mobileResearch.js";
import { isCanonicalMembershipId } from "./researchRouteValidation.js";

export function registerResearchEvidenceQuestionRoute(app: FastifyInstance, options: MobileResearchRouteOptions): void {
  app.post("/api/mobile/research/candidate-memberships/:id/evidence-questions", async (request, reply) => {
    const now = options.now?.() ?? new Date();
    let aiAttempted = false;
    const id = (request.params as { id: string }).id;
    const actor = authenticateWrite(request.headers, options, "research_write");
    const body = request.body as unknown;
    const question = actor ? requestQuestion(body) : "UNKNOWN";
    const fail = (
      code: number,
      message: string,
      attempted = aiAttempted,
      sendManifest: ResearchEvidenceQuestionSendManifest | null = null
    ) => reply.code(code).send(researchEvidenceQuestionFailClosed(
      id, question, "unavailable", message, now, attempted, sendManifest
    ));
    if (!actor) return fail(401, "research-write authorization required");
    if (!isCanonicalMembershipId(id)) return fail(400, "candidate membership id must be a positive integer");
    const validation = validateResearchEvidenceQuestionRequest(body);
    if (!validation.ok) return fail(400, validation.errors.join("; "));
    try {
      const typed = body as ResearchEvidenceQuestionRequest;
      const workspaceOptions = () => ({ accountScopeId: derivePinganSnapshotAccountScope(actor, options), currentPortfolioEnabled: options.pinganCurrentPortfolioEnabled,
        currentPortfolioMaxAgeSeconds: options.pinganCurrentMaxAgeSeconds ?? 300,
        sourceStore:options.researchDocument?{repositoryRoot:options.researchDocument.repositoryRoot,
          rawStoreRoot:options.researchDocument.rawStoreRoot,availabilityCache:new Map()}:undefined });
      const workspace = await readDeepResearchWorkspace(options.pool, id, actor, now, workspaceOptions());
      if (!validateDeepResearchWorkspaceEnvelope(workspace).ok) return fail(503, "deep-research workspace failed contract validation");
      let response = answerResearchEvidenceQuestion(workspace, id, typed, now);
      if (response.status === "available" && options.researchEvidenceAi) {
        if (!await cloudAiPolicyIsEnabled(options.pool, actor)) return fail(403, "Cloud AI is disabled or requires current Owner confirmation");
        const grounded = response;
        // Server-side only: the exact current report's own judgment, read after the
        // service re-verified report fingerprint, currentness and identity above.
        const reportContext = researchEvidenceQuestionReportContext(workspace, id, typed, now);
        if (!reportContext) return fail(409, "当前报告的判断上下文无法确认；未调用模型，请 fresh GET 后重试。");
        const attemptManifest = prepareResearchEvidenceQuestionAiRequest(
          grounded, options.researchEvidenceAi.model, typed.conversation ?? [], undefined,
          reportContext, typed.carrySummary
        ).sendManifest;
        const attemptReservation = researchEvidenceQuestionFailClosed(
          id, question, "unavailable",
          "Cloud AI send reserved; provider receipt remains UNKNOWN until an answer is recorded.",
          now, true, attemptManifest
        );
        aiAttempted = true;
        response = await runIdempotentResearchEvidenceQuestion(
          options.pool, id, typed, actor, attemptReservation, async () => {
            let generated;
            try {
              generated = await withCloudAiPolicySendAuthorization(
                options.pool,
                actor,
                (sendAuthorization) => generateResearchEvidenceQuestionWithAi(
                  grounded, options.researchEvidenceAi!, typed.conversation ?? [], undefined, sendAuthorization,
                  reportContext, typed.carrySummary
                )
              );
              if (!generated) {
                const blockedAt = options.now?.() ?? new Date();
                return researchEvidenceQuestionFailClosed(
                  id, question, "unavailable",
                  "Cloud AI authorization changed before provider send; the provider was not called and the send manifest was retained.",
                  blockedAt, true, attemptManifest
                );
              }
            } catch (error) {
              if (error instanceof ResearchEvidenceQuestionProviderError) {
                const failedAt = options.now?.() ?? new Date();
                const failedWorkspace = await readDeepResearchWorkspace(options.pool, id, actor, failedAt, workspaceOptions());
                if (!validateDeepResearchWorkspaceEnvelope(failedWorkspace).ok) return researchEvidenceQuestionFailClosed(id, question, "unavailable", "deep-research workspace failed post-attempt validation", failedAt, true, error.sendManifest);
                const current = answerResearchEvidenceQuestion(failedWorkspace, id, typed, failedAt);
                if (!researchEvidenceQuestionBindingMatches(grounded, current)) return researchEvidenceQuestionFailClosed(id, question, "conflict", "报告、证据包或研究标的在 AI 发送尝试期间已变化；回答已丢弃，本次发送清单保留。", failedAt, true, error.sendManifest);
                if (!await cloudAiPolicyIsEnabled(options.pool, actor)) return researchEvidenceQuestionFailClosed(id, question, "unavailable", "Cloud AI authorization changed during the request; the answer was discarded and the send manifest was retained.", failedAt, true, error.sendManifest);
                return researchEvidenceQuestionFailClosed(id, question, "unavailable", `${error.message}; 本地保留了本次发送尝试清单，提供方是否收到仍为 UNKNOWN。`, failedAt, true, error.sendManifest);
              }
              throw error;
            }
            const refreshedAt = options.now?.() ?? new Date();
            const refreshedWorkspace = await readDeepResearchWorkspace(options.pool, id, actor, refreshedAt, workspaceOptions());
            if (!validateDeepResearchWorkspaceEnvelope(refreshedWorkspace).ok) return researchEvidenceQuestionFailClosed(id, question, "unavailable", "deep-research workspace failed post-provider validation", refreshedAt, true, generated.sendManifest);
            const current = answerResearchEvidenceQuestion(refreshedWorkspace, id, typed, refreshedAt);
            if (!researchEvidenceQuestionBindingMatches(generated, current)) {
              return researchEvidenceQuestionFailClosed(id, question, "conflict", "报告、证据包或研究标的在 AI 回答期间已变化；旧回答已丢弃，本次发送清单保留。", refreshedAt, true, generated.sendManifest);
            }
            if (!await cloudAiPolicyIsEnabled(options.pool, actor)) {
              return researchEvidenceQuestionFailClosed(id, question, "unavailable", "Cloud AI authorization changed during the request; the late answer was discarded and the send manifest was retained.", refreshedAt, true, generated.sendManifest);
            }
            return generated;
          }
        );
        if (response.status === "available") {
          const currentAt = options.now?.() ?? new Date();
          const currentWorkspace = await readDeepResearchWorkspace(options.pool, id, actor, currentAt, workspaceOptions());
          if (!validateDeepResearchWorkspaceEnvelope(currentWorkspace).ok) return fail(503, "deep-research workspace failed replay validation", true, response.sendManifest);
          const current = answerResearchEvidenceQuestion(currentWorkspace, id, typed, currentAt);
          if (!researchEvidenceQuestionBindingMatches(response, current)) {
            return reply.code(409).send(researchEvidenceQuestionFailClosed(id, question, "conflict", "幂等回答不再属于当前报告；已丢弃，本次发送清单保留。", currentAt, true, response.sendManifest));
          }
          if (!await cloudAiPolicyIsEnabled(options.pool, actor)) return fail(403, "Cloud AI authorization changed before the answer was displayed", true, response.sendManifest);
        }
      }
      if (!validateResearchEvidenceQuestionEnvelope(response).ok) return fail(503, "evidence-question response failed contract validation", response.reproducibility.provider === "deepseek");
      return reply.code(response.status === "not_found" ? 404 : response.status === "conflict" ? 409 : response.status === "unavailable" ? 503 : 200).send(response);
    } catch {
      return fail(503, "research AI provider, idempotency store, or evidence repository is unavailable", aiAttempted);
    }
  });
}

function requestQuestion(body: unknown): string {
  return typeof body === "object" && body !== null && "question" in body
    && typeof body.question === "string" && body.question.trim() && body.question.trim().length <= 1000
    ? body.question.trim() : "UNKNOWN";
}
