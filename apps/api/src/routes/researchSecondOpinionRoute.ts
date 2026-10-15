import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { RESEARCH_SECOND_OPINION_VERSION, sameBinding, validateResearchSecondOpinionRequest,
  type ResearchSecondOpinionPreview, type ResearchSecondOpinionResult } from "../../../../packages/contracts/src/researchSecondOpinion.js";
import type { ResearchEvidenceAiConfig } from "../config.js";
import { cloudAiPolicyIsEnabled, withCloudAiPolicySendAuthorization } from "../research/cloudAiPolicyRepository.js";
import { readDeepResearchWorkspace } from "../research/deepResearchReadRepository.js";
import { prepareResearchSecondOpinionAiRequest, generateResearchSecondOpinion } from "../research/researchSecondOpinionAi.js";
import { runIdempotentResearchSecondOpinion, readResearchSecondOpinionHistory } from "../research/researchSecondOpinionRepository.js";
import { researchSecondOpinionContext } from "../research/researchSecondOpinionService.js";
import { authenticateWrite, type ResearchAuthOptions } from "./researchAuth.js";
import { isCanonicalMembershipId } from "./researchRouteValidation.js";

export interface ResearchSecondOpinionRouteOptions extends ResearchAuthOptions {
  pool: Pool;
  researchEvidenceAi: ResearchEvidenceAiConfig | null;
  repositoryRoot: string;
  rawStoreRoot: string | null;
  now?: () => Date;
}

export function registerResearchSecondOpinionRoute(app: FastifyInstance, options: ResearchSecondOpinionRouteOptions): void {
  const root = "/api/mobile/research/candidate-memberships/:id/second-opinions";
  const sourceStore = () => options.rawStoreRoot ? ({ repositoryRoot: options.repositoryRoot,
    rawStoreRoot: options.rawStoreRoot, availabilityCache: new Map() }) : undefined;
  const workspace = (id: string, actor: NonNullable<ReturnType<typeof authenticateWrite>>, now: Date) =>
    readDeepResearchWorkspace(options.pool, id, actor, now, {
      accountScopeId: null, currentPortfolioEnabled: false, currentPortfolioMaxAgeSeconds: 300,
      enforceCurrentHoldingBindings: false, sourceStore: sourceStore()
    });
  app.get(`${root}/preview`, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ error: "research-write authorization required" });
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ error: "membership id invalid" });
    if (!options.researchEvidenceAi) return reply.code(503).send({ error: "第二意见模型未配置" });
    try {
      const context = researchSecondOpinionContext(await workspace(id, actor, options.now?.() ?? new Date()),
        id, options.researchEvidenceAi.model, options.now?.() ?? new Date());
      const { manifest } = prepareResearchSecondOpinionAiRequest(context, options.researchEvidenceAi.model);
      const preview: ResearchSecondOpinionPreview = { ...context.preview,
        inputTokenUpperBound: manifest.inputTokenUpperBound,
        estimatedMaxCostUsd: manifest.estimatedMaxCostUsd };
      return reply.send(preview);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "第二意见预览不可用" });
    }
  });
  app.get(root, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ error: "research-write authorization required" });
    if (!isCanonicalMembershipId(id)) return reply.code(400).send({ error: "membership id invalid" });
    try { return reply.send({ schemaVersion: RESEARCH_SECOND_OPINION_VERSION,
      ...(await readResearchSecondOpinionHistory(options.pool, id, actor)) }); }
    catch { return reply.code(503).send({ error: "第二意见历史不可用" }); }
  });
  app.post(root, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const actor = authenticateWrite(request.headers, options, "research_write");
    if (!actor) return reply.code(401).send({ error: "research-write authorization required" });
    if (!isCanonicalMembershipId(id) || !validateResearchSecondOpinionRequest(request.body)
      || request.body.membershipId !== id) return reply.code(400).send({ error: "第二意见请求身份无效" });
    if (!options.researchEvidenceAi) return reply.code(503).send({ error: "第二意见模型未配置" });
    try {
      const typed = request.body;
      if (!await cloudAiPolicyIsEnabled(options.pool, actor)) return reply.code(403).send({ error: "Cloud AI 未经当前 Owner 策略授权" });
      const context = researchSecondOpinionContext(await workspace(id, actor, options.now?.() ?? new Date()),
        id, options.researchEvidenceAi.model, options.now?.() ?? new Date());
      if (!sameBinding(context.preview.binding, typed)) return reply.code(409).send({ error: "报告、冻结证据或材料摘录已变化；重新预览" });
      const { manifest } = prepareResearchSecondOpinionAiRequest(context, options.researchEvidenceAi.model);
      const attempt: ResearchSecondOpinionResult = {
        schemaVersion: RESEARCH_SECOND_OPINION_VERSION, status: "attempted",
        generatedAt: new Date().toISOString(), binding: context.preview.binding,
        reason: typed.reason, provider: "deepseek", model: options.researchEvidenceAi.model,
        findings: [], sendManifest: manifest, tokenUsage: "UNKNOWN", costUsd: "UNKNOWN",
        message: "发送已预留；提供方是否收到及实际费用仍为 UNKNOWN。"
      };
      const result = await runIdempotentResearchSecondOpinion(options.pool, typed, actor, attempt, async () => {
        const generated = await withCloudAiPolicySendAuthorization(options.pool, actor, authorization =>
          generateResearchSecondOpinion(context, typed.reason, options.researchEvidenceAi!, fetch, authorization));
        if (!generated) return { ...attempt, message: "发送前 Cloud AI 授权变化；预留记录保留，未调用提供方。" };
        let stillCurrent = false;
        try {
          const refreshed = researchSecondOpinionContext(await workspace(id, actor, options.now?.() ?? new Date()),
            id, options.researchEvidenceAi!.model, options.now?.() ?? new Date());
          stillCurrent = sameBinding(refreshed.preview.binding, context.preview.binding)
            && await cloudAiPolicyIsEnabled(options.pool, actor);
        } catch { stillCurrent = false; }
        if (!stillCurrent) {
          return { ...attempt, generatedAt: new Date().toISOString(),
            tokenUsage: generated.tokenUsage, costUsd: generated.costUsd,
            message: "模型返回后报告、证据或授权已变化；结果未进入成功历史。" };
        }
        return generated;
      });
      return reply.code(result.status === "available" ? 200 : 503).send(result);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "第二意见请求未完成" });
    }
  });
}
