import type { ResearchEvidenceAiConfig } from "../config.js";
import { pricedDeepSeekFlashPeakCost } from "./deepResearchSynthesisAi.js";
import { sha256 } from "./deepResearchGate.js";
import {
  CLOUD_AI_PROVIDER_POLICY,
  CLOUD_AI_PROVIDER_POLICY_VERSION,
  CLOUD_AI_PROVIDER_PRICING_IDENTITY,
  cloudAiEstimatedMaxCostUsd,
  type CloudAiSendAuthorizationSnapshot
} from "../../../../packages/contracts/src/cloudAiPolicy.js";
import {
  formatResearchEvidenceQuestionAnswer,
  isResearchEvidenceQuestionKnownFact,
  RESEARCH_EVIDENCE_QUESTION_IMPACTS,
  RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS,
  RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS_WITH_REPORT_CONTEXT,
  RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS_WITH_CARRY,
  RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS_WITH_CARRY_AND_REPORT_CONTEXT,
  RESEARCH_EVIDENCE_QUESTION_REPORT_CONTEXT_FIELDS,
  type ResearchEvidenceQuestionContextTurn,
  type ResearchEvidenceQuestionCarrySummary,
  type ResearchEvidenceQuestionEnvelope,
  type ResearchEvidenceQuestionFact,
  type ResearchEvidenceQuestionImpact,
  type ResearchEvidenceQuestionInsight,
  type ResearchEvidenceQuestionReportContext,
  type ResearchEvidenceQuestionSendManifest
} from "../../../../packages/contracts/src/researchEvidenceQuestion.js";

const PROMPT_VERSION = "research-evidence-answer.v6";
const CARRY_PROMPT_VERSION = "research-evidence-answer.v7";

export class ResearchEvidenceQuestionProviderError extends Error {
  constructor(message: string, readonly sendManifest: ResearchEvidenceQuestionSendManifest) {
    super(message);
    this.name = "ResearchEvidenceQuestionProviderError";
  }
}

export async function generateResearchEvidenceQuestionWithAi(
  grounded: ResearchEvidenceQuestionEnvelope,
  config: ResearchEvidenceAiConfig,
  conversation: ResearchEvidenceQuestionContextTurn[] = [],
  fetcher: typeof fetch = fetch,
  sendAuthorization?: CloudAiSendAuthorizationSnapshot,
  reportContext?: ResearchEvidenceQuestionReportContext,
  carrySummary?: ResearchEvidenceQuestionCarrySummary
): Promise<ResearchEvidenceQuestionEnvelope> {
  if (grounded.status !== "available" || !grounded.binding) return grounded;
  if (grounded.facts.some((fact) => !isResearchEvidenceQuestionKnownFact(fact))) {
    throw new Error("research AI grounded facts are invalid");
  }
  const { requestBodyJson, sendManifest } = prepareResearchEvidenceQuestionAiRequest(
    grounded, config.model, conversation, sendAuthorization, reportContext, carrySummary
  );
  try {
    const response = await fetcher(new URL("chat/completions", config.baseUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: requestBodyJson,
      signal: AbortSignal.timeout(config.timeoutMs)
    });
    if (!response.ok) throw new Error(`research AI provider returned HTTP ${response.status}`);
    const parsed = parseCompletion(await response.json(), config.model);
    const selection = parseSelection(parsed.content, grounded.facts, grounded.unknowns);
    return {
      ...grounded,
      answer: formatResearchEvidenceQuestionAnswer(selection.facts, selection.unknowns),
      insights: selection.insights,
      sendManifest,
      reproducibility: {
        generationMethod: "deepseek_chat_completions_current_report_evidence",
        model: parsed.model,
        provider: "deepseek",
        prompt: carrySummary ? CARRY_PROMPT_VERSION : PROMPT_VERSION,
        tokenUsage: `prompt=${parsed.promptTokens},completion=${parsed.completionTokens},total=${parsed.totalTokens}`,
        cost: parsed.cost
      },
      message: "DeepSeek 已基于当前 exact report 的绑定事实回答；结果仅供研究，不修改报告、正式决定或资产事实。"
    };
  } catch (error) {
    if (error instanceof ResearchEvidenceQuestionProviderError) throw error;
    throw new ResearchEvidenceQuestionProviderError(error instanceof Error ? error.message : "research AI provider failed", sendManifest);
  }
}

export function prepareResearchEvidenceQuestionAiRequest(
  grounded: ResearchEvidenceQuestionEnvelope,
  model: string,
  conversation: ResearchEvidenceQuestionContextTurn[] = [],
  sendAuthorization?: CloudAiSendAuthorizationSnapshot,
  reportContext?: ResearchEvidenceQuestionReportContext,
  carrySummary?: ResearchEvidenceQuestionCarrySummary
): { requestBody: unknown; requestBodyJson: string; sendManifest: ResearchEvidenceQuestionSendManifest } {
  if (grounded.status !== "available" || !grounded.binding) {
    throw new Error("research AI request requires current grounded evidence");
  }
  const requestBody = evidenceQuestionRequestBody(grounded, model, conversation, reportContext, carrySummary);
  const requestBodyJson = JSON.stringify(requestBody);
  return {
    requestBody,
    requestBodyJson,
    sendManifest: evidenceQuestionSendManifest(
      grounded, model, conversation.length, requestBodyJson, sendAuthorization,
      reportContext !== undefined, carrySummary !== undefined
    )
  };
}

function evidenceQuestionRequestBody(
  grounded: ResearchEvidenceQuestionEnvelope,
  model: string,
  conversation: ResearchEvidenceQuestionContextTurn[],
  reportContext?: ResearchEvidenceQuestionReportContext,
  carrySummary?: ResearchEvidenceQuestionCarrySummary
) {
  return {
    model,
    thinking: { type: "disabled" },
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: 800,
    messages: [
      {
        role: "system",
        content: [
          "你是港股低频研究助手。只能使用用户消息中提供的当前报告事实回答，不能补充外部事实或猜测。",
          "明确区分事实、反证与 UNKNOWN；保留重要未知项。不要改变正式报告结论，不要建议或执行下单。",
          "每条选中事实必须直接支持你的判断；当问题要求反方复核时，必须同时给出支持当前结论的事实与相反或质疑证据，并明确指出没有被证据覆盖的假设。",
          "任何情况下都不得引入报告之外的资料，不得声称掌握独立来源、外部检索结果或其他提供方的意见；缺少依据时保留 UNKNOWN。",
          "只返回严格 JSON，不要返回 Markdown 或自由文本。格式固定为 {\"factIndexes\":[整数],\"unknownIndexes\":[整数],\"insights\":[{\"source\":\"fact|unknown\",\"index\":整数,\"impact\":\"有限枚举\",\"explanation\":\"可选模型解释\"}]}。",
          `impact 只能是 ${RESEARCH_EVIDENCE_QUESTION_IMPACTS.join(",")}。`,
          "factIndexes 只能选择 facts 中与问题直接相关的条目；unknownIndexes 只能选择 unknowns 中必须保留的未知项。每个 insight 必须引用已选中的 index；unknown 只能标为 limits_confidence 或 requires_follow_up。",
          "insights 的 explanation 是可选字段，用于解释它对应的那条选中事实或 UNKNOWN：说明它如何支持或质疑当前结论、有哪些假设没有被现有证据覆盖、以及出现什么新证据或下一步核实动作会改变判断。",
          "explanation 只是模型解读，不是新事实、来源或引用：不得引入报告之外的信息、数字或来源，不得声称独立来源、外部检索或其他提供方意见。用简体中文，尽量简短，不超过 90 个汉字。",
          "有选中事实或未知项时至少返回一个 insight；最多返回 4 条 insight（宁可少而准）；没有足够依据时三个数组都留空。",
          "用户消息中的 reportContext 是当前报告既有判断本身（结论、置信、假设、价格条件、下一个问题），只作为被复核的主张，不是事实、证据、来源或新信息；不得把它当作证据或引用，也不得据此推断报告之外的内容。",
          "必须用 facts 与 unknowns 去质疑或支持 reportContext 中的结论与假设，并说明哪个假设没有被现有证据覆盖；reportContext 中为 UNKNOWN 的部分表示报告本身没有给出，不得替它补齐。",
          "如果用户消息里没有 reportContext，就不要猜测或假装知道当前报告的结论、假设或价格条件。",
          ...(carrySummary ? ["carrySummary 是用户核对的上个本机会话提示，不是事实、来源、证据或正式报告；只能用当前 facts 和 unknowns 重新核对，不得直接采信摘要。"] : [])
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          question: grounded.question,
          conversation,
          symbol: grounded.symbol,
          reportBinding: grounded.binding,
          facts: grounded.facts.map((fact, index) => ({ index, ...fact })),
          unknowns: grounded.unknowns.map((statement, index) => ({ index, statement })),
          ...(carrySummary ? { carrySummary } : {}),
          ...(reportContext ? { reportContext } : {})
        })
      }
    ]
  };
}

function evidenceQuestionSendManifest(
  grounded: ResearchEvidenceQuestionEnvelope,
  model: string,
  conversationTurnCount: number,
  requestBodyJson: string,
  sendAuthorization?: CloudAiSendAuthorizationSnapshot,
  reportContextSent = false,
  carrySummarySent = false
): ResearchEvidenceQuestionSendManifest {
  const binding = grounded.binding!;
  const maxOutputTokens = 800;
  const inputTokenUpperBound = new TextEncoder().encode(requestBodyJson).length;
  return {
    purpose: "report_evidence_question",
    preparedAt: grounded.generatedAt,
    policyVersion: CLOUD_AI_PROVIDER_POLICY_VERSION,
    policySnapshot: CLOUD_AI_PROVIDER_POLICY,
    ...(sendAuthorization ? { sendAuthorization } : {}),
    provider: "deepseek",
    model,
    membershipId: grounded.membershipId,
    membershipVersion: grounded.membershipVersion!,
    symbol: grounded.symbol!,
    reportId: binding.reportId,
    reportVersion: binding.reportVersion,
    reportFingerprint: binding.reportFingerprint,
    evidencePackId: binding.evidencePackId,
    evidencePackFingerprint: binding.evidencePackFingerprint,
    sourceEvidenceIds: [...grounded.sourceEvidenceIds],
    factCount: grounded.facts.length,
    unknownCount: grounded.unknowns.length,
    conversationTurnCount,
    payloadFields: carrySummarySent
      ? reportContextSent
        ? [...RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS_WITH_CARRY_AND_REPORT_CONTEXT]
        : [...RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS_WITH_CARRY]
      : reportContextSent
        ? [...RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS_WITH_REPORT_CONTEXT]
        : [...RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS],
    ...(reportContextSent ? { reportContextFields: [...RESEARCH_EVIDENCE_QUESTION_REPORT_CONTEXT_FIELDS] } : {}),
    requestBodySha256: sha256(requestBodyJson),
    pricingIdentity: CLOUD_AI_PROVIDER_PRICING_IDENTITY,
    inputTokenUpperBound,
    maxOutputTokens,
    estimatedMaxCostUsd: cloudAiEstimatedMaxCostUsd(inputTokenUpperBound, maxOutputTokens),
    fullPdfSent: false,
    credentialsSent: false,
    officialAssetFactsSent: false
  };
}

function parseCompletion(value: unknown, expectedModel: string): {
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: string;
} {
  if (!record(value) || value.model !== expectedModel || !Array.isArray(value.choices)) {
    throw new Error("research AI provider response is invalid");
  }
  const choice = value.choices[0];
  if (!record(choice) || !record(choice.message) || typeof choice.message.content !== "string"
    || !choice.message.content.trim() || choice.finish_reason !== "stop" || !record(value.usage)) {
    throw new Error("research AI provider response is invalid");
  }
  const usage = value.usage;
  const promptTokens = nonNegativeInteger(usage.prompt_tokens);
  const completionTokens = nonNegativeInteger(usage.completion_tokens);
  const totalTokens = nonNegativeInteger(usage.total_tokens);
  if (promptTokens === null || completionTokens === null || totalTokens === null
    || totalTokens !== promptTokens + completionTokens) {
    throw new Error("research AI provider token usage is invalid");
  }
  return {
    content: choice.message.content.trim(),
    model: value.model,
    promptTokens,
    completionTokens,
    totalTokens,
    cost: pricedDeepSeekFlashPeakCost(usage, promptTokens, completionTokens)
  };
}

function parseSelection(
  content: string,
  facts: ResearchEvidenceQuestionFact[],
  unknowns: string[]
): {
  facts: ResearchEvidenceQuestionFact[];
  unknowns: string[];
  insights: ResearchEvidenceQuestionInsight[];
} {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("research AI provider selection is invalid");
  }
  if (!record(value) || Object.keys(value).length !== 3
    || !Array.isArray(value.factIndexes) || !Array.isArray(value.unknownIndexes)
    || !Array.isArray(value.insights)) {
    throw new Error("research AI provider selection is invalid");
  }
  const factIndexes = selectedIndexes(value.factIndexes, facts.length);
  const unknownIndexes = selectedIndexes(value.unknownIndexes, unknowns.length);
  if (!factIndexes || !unknownIndexes) {
    throw new Error("research AI provider selection is invalid");
  }
  const insights = selectedInsights(
    value.insights,
    facts,
    unknowns,
    new Set(factIndexes),
    new Set(unknownIndexes)
  );
  if (!insights || ((factIndexes.length > 0 || unknownIndexes.length > 0) && insights.length === 0)
    || (!factIndexes.length && !unknownIndexes.length && insights.length)) {
    throw new Error("research AI provider selection is invalid");
  }
  return {
    facts: factIndexes.map((index) => facts[index]),
    unknowns: unknownIndexes.map((index) => unknowns[index]),
    insights
  };
}

function selectedInsights(
  value: unknown[],
  facts: ResearchEvidenceQuestionFact[],
  unknowns: string[],
  selectedFacts: Set<number>,
  selectedUnknowns: Set<number>
): ResearchEvidenceQuestionInsight[] | null {
  if (value.length > 8) return null;
  const insights: ResearchEvidenceQuestionInsight[] = [];
  const identities = new Set<string>();
  for (const item of value) {
    if (!record(item)) return null;
    const itemKeys = Object.keys(item);
    if ((itemKeys.length !== 3 && itemKeys.length !== 4)
      || !["fact", "unknown"].includes(String(item.source))
      || !Number.isInteger(item.index)
      || !RESEARCH_EVIDENCE_QUESTION_IMPACTS.includes(item.impact as ResearchEvidenceQuestionImpact)) {
      return null;
    }
    let explanation: string | undefined;
    if (item.explanation !== undefined) {
      if (typeof item.explanation !== "string") return null;
      const trimmed = item.explanation.trim();
      if (!trimmed || trimmed.length > 400) return null;
      explanation = trimmed;
    }
    const index = Number(item.index);
    const impact = item.impact as ResearchEvidenceQuestionImpact;
    if (item.source === "unknown") {
      if (!selectedUnknowns.has(index)
        || !["limits_confidence", "requires_follow_up"].includes(impact)) return null;
      const insight = {
        impact, source: "unknown" as const, statement: unknowns[index], evidenceIds: [],
        ...(explanation === undefined ? {} : { explanation })
      };
      const identity = `${insight.source}\0${index}\0${impact}`;
      if (identities.has(identity)) return null;
      identities.add(identity);
      insights.push(insight);
      continue;
    }
    if (!selectedFacts.has(index)) return null;
    const fact = facts[index];
    if ((fact.stance === "support" && impact === "weakens_current_conclusion")
      || (fact.stance === "refute" && impact === "supports_current_conclusion")) return null;
    const identity = `fact\0${index}\0${impact}`;
    if (identities.has(identity)) return null;
    identities.add(identity);
    insights.push({
      impact,
      source: "fact",
      statement: fact.statement,
      evidenceIds: fact.evidenceIds,
      ...(explanation === undefined ? {} : { explanation })
    });
  }
  return insights;
}

function selectedIndexes(value: unknown[], upperBound: number): number[] | null {
  if (value.length > 24 || value.some((index) => !Number.isInteger(index)
    || Number(index) < 0 || Number(index) >= upperBound)) return null;
  const indexes = value.map(Number);
  return new Set(indexes).size === indexes.length ? indexes : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
