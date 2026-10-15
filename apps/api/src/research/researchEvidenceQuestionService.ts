import {
  type DeepResearchWorkspaceEnvelope,
  type EvidenceBoundDeepResearchReportPayload,
  type EvidenceBoundResearchFact
} from "../../../../packages/contracts/src/deepResearch.js";
import {
  DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
  type DeepResearchSynthesisFact,
  type SynthesizedDeepResearchReportPayload
} from "../../../../packages/contracts/src/deepResearchSynthesisReport.js";
import {
  formatResearchEvidenceQuestionAnswer,
  isResearchEvidenceQuestionKnownFact,
  RESEARCH_EVIDENCE_QUESTION_SCHEMA_VERSION,
  type ResearchEvidenceQuestionEnvelope,
  type ResearchEvidenceQuestionContextTurn,
  type ResearchEvidenceQuestionReportContext,
  type ResearchEvidenceQuestionRequest,
  type ResearchEvidenceQuestionSendManifest,
  type ResearchEvidenceQuestionTopic
} from "../../../../packages/contracts/src/researchEvidenceQuestion.js";
import type { ResearchEvidenceQuestionFact } from "../../../../packages/contracts/src/researchEvidenceQuestion.js";
import {
  synthesizedDeepResearchReportFailures,
  deepResearchReportFingerprint,
  deepResearchReportIntegrityFailures,
  isFormalizableDeepResearchReportContractVersion
} from "./deepResearchGate.js";

type QuestionReportPayload = EvidenceBoundDeepResearchReportPayload | SynthesizedDeepResearchReportPayload;
type QuestionReportFact = EvidenceBoundResearchFact | DeepResearchSynthesisFact;

type CurrentReportResolution =
  | { ok: false; status: "not_found" | "conflict" | "unavailable"; message: string }
  | {
    ok: true;
    payload: QuestionReportPayload;
    symbol: string;
    membershipVersion: number;
    reportId: string;
    reportVersion: number;
    reportFingerprint: string;
    evidencePackId: string;
    evidencePackFingerprint: string;
  };

export function answerResearchEvidenceQuestion(
  workspace: DeepResearchWorkspaceEnvelope,
  membershipId: string,
  request: ResearchEvidenceQuestionRequest,
  now = new Date()
): ResearchEvidenceQuestionEnvelope {
  const question = request.question.trim();
  const resolution = currentReportResolution(workspace, membershipId, request, now);
  if (!resolution.ok) return failClosed(membershipId, question, resolution.status, resolution.message, now);
  const { payload } = resolution;
  const topic = classifyQuestion(question);
  const knownReportFacts = allFacts(payload).filter(isResearchEvidenceQuestionKnownFact);
  const allUnknowns = payload.researchLayer.unknowns.map((fact) => fact.statement);
  if (!conversationIsGrounded(
    request.conversation ?? [],
    resolution.reportFingerprint,
    knownReportFacts,
    allUnknowns
  )) {
    return failClosed(
      membershipId,
      question,
      "conflict",
      "本次对话上下文不再属于当前报告；旧上下文已拒绝，请从当前报告重新提问。",
      now
    );
  }
  const rawTopicFacts = factsForTopic(payload, topic).filter(isResearchEvidenceQuestionKnownFact);
  const topicFacts = boundedFacts(rawTopicFacts);
  const facts = boundedFacts([...rawTopicFacts, ...allFacts(payload)].filter(isResearchEvidenceQuestionKnownFact));
  const unknowns = boundedFacts(payload.researchLayer.unknowns).map((fact) => fact.statement);
  const sourceEvidenceIds = [...new Set(facts.flatMap((fact) => fact.evidenceIds))].sort();
  const answer = formatResearchEvidenceQuestionAnswer(
    topic === "unknowns" ? [] : topicFacts,
    unknowns
  );
  return {
    schemaVersion: RESEARCH_EVIDENCE_QUESTION_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    status: "available",
    membershipId,
    membershipVersion: resolution.membershipVersion,
    symbol: resolution.symbol,
    question,
    answer,
    topic,
    facts,
    unknowns,
    insights: [],
    sourceEvidenceIds,
    sendManifest: null,
    binding: {
      reportId: resolution.reportId,
      reportVersion: resolution.reportVersion,
      reportFingerprint: resolution.reportFingerprint,
      evidencePackId: resolution.evidencePackId,
      evidencePackFingerprint: resolution.evidencePackFingerprint,
      cutoffAt: payload.cutoffAt
    },
    reproducibility: reproducibility(),
    safety: safety(),
    message: "回答仅检索当前报告内已绑定证据；未调用模型，也未修改正式结论或资产事实。"
  };
}

function currentReportResolution(
  workspace: DeepResearchWorkspaceEnvelope,
  membershipId: string,
  request: ResearchEvidenceQuestionRequest,
  now: Date
): CurrentReportResolution {
  if (workspace.status !== "available" || !workspace.data) {
    return {
      ok: false,
      status: workspace.status === "not_found" ? "not_found" : "unavailable",
      message: workspace.message
    };
  }
  const { target, latestReport, latestPack } = workspace.data;
  if (target.membershipId !== membershipId
    || target.membershipVersion !== request.membershipVersion
    || !latestReport
    || latestReport.id !== request.reportId
    || latestReport.reportFingerprint !== request.reportFingerprint
    || latestReport.currentness.status !== "current"
    || latestReport.currentness.invalidatedBy.length
    || latestReport.currentness.evidencePackInvalidatedBy.length
    || !isFormalizableDeepResearchReportContractVersion(latestReport.contractVersion)
    || !latestPack
    || latestPack.id !== latestReport.evidencePackId
    || latestPack.currentness.status !== "current") {
    return {
      ok: false,
      status: "conflict",
      message: "membership、当前报告或证据包已变化；旧追问目标已失效，请 fresh GET 后重试。"
    };
  }
  const payload = latestReport.payload as QuestionReportPayload;
  const synthesisInvalid = payload.reportContractVersion === DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION
    && (deepResearchReportFingerprint(latestReport.evidencePackId, payload) !== latestReport.reportFingerprint
      || deepResearchReportIntegrityFailures(payload, latestPack).length > 0
      // Read-only questions require valid, current evidence; formal-confirmation
      // eligibility remains enforced separately by deepResearchGateFailures.
      || synthesizedDeepResearchReportFailures(payload, latestPack, now).length > 0);
  if (payload.reportContractVersion !== latestReport.contractVersion
    || payload.evidencePackBinding.id !== latestPack.id
    || payload.evidencePackBinding.fingerprint !== latestPack.packFingerprint
    || payload.evidencePackBinding.membershipId !== membershipId
    || payload.evidencePackBinding.membershipVersion !== target.membershipVersion
    || payload.evidencePackBinding.symbol !== target.symbol
    || synthesisInvalid) {
    return { ok: false, status: "conflict", message: "当前报告与证据包身份不一致；未返回部分回答。" };
  }
  return {
    ok: true,
    payload,
    symbol: target.symbol,
    membershipVersion: target.membershipVersion,
    reportId: latestReport.id,
    reportVersion: latestReport.version,
    reportFingerprint: latestReport.reportFingerprint,
    evidencePackId: latestPack.id,
    evidencePackFingerprint: latestPack.packFingerprint
  };
}

/**
 * The exact current report's own judgment, for server-side review only.
 * Returns null unless the same currentness/fingerprint/identity checks pass.
 * Never a fact, source, citation or new information; never built from client input.
 */
export function researchEvidenceQuestionReportContext(
  workspace: DeepResearchWorkspaceEnvelope,
  membershipId: string,
  request: ResearchEvidenceQuestionRequest,
  now = new Date()
): ResearchEvidenceQuestionReportContext | null {
  const resolution = currentReportResolution(workspace, membershipId, request, now);
  if (!resolution.ok) return null;
  const advice = resolution.payload.adviceLayer;
  return {
    conclusion: advice.conclusion,
    confidence: advice.confidence,
    assumptions: [...(advice.assumptions ?? [])],
    priceConditions: [...(advice.priceConditions ?? [])],
    nextQuestion: advice.nextQuestion ?? "UNKNOWN"
  };
}

function conversationIsGrounded(
  conversation: ResearchEvidenceQuestionContextTurn[],
  reportFingerprint: string,
  facts: QuestionReportFact[],
  unknowns: string[]
): boolean {
  const allowed = new Set([
    ...facts.map((fact) => formatResearchEvidenceQuestionAnswer([fact], [])),
    ...unknowns.map((unknown) => formatResearchEvidenceQuestionAnswer([], [unknown])),
    "UNKNOWN：当前报告没有足够的绑定事实回答该问题。"
  ]);
  return conversation.every((turn) => {
    const lines = turn.answer.split("\n");
    return turn.reportFingerprint === reportFingerprint
      && turn.question.trim().length > 0
      && turn.question.length <= 1000
      && lines.length === new Set(lines).size
      && lines.every((line) => allowed.has(line));
  });
}

export function researchEvidenceQuestionFailClosed(
  membershipId: string,
  question: string,
  status: "not_found" | "conflict" | "unavailable",
  message: string,
  now = new Date(),
  aiAttempted = false,
  sendManifest: ResearchEvidenceQuestionSendManifest | null = null
): ResearchEvidenceQuestionEnvelope {
  return failClosed(membershipId, question.trim() || "UNKNOWN", status, message, now, aiAttempted, sendManifest);
}

export function researchEvidenceQuestionBindingMatches(
  attempted: ResearchEvidenceQuestionEnvelope,
  current: ResearchEvidenceQuestionEnvelope
): boolean {
  if (attempted.status !== "available" || current.status !== "available"
    || !attempted.binding || !current.binding) return false;
  return attempted.membershipId === current.membershipId
    && attempted.membershipVersion === current.membershipVersion
    && attempted.symbol === current.symbol
    && attempted.binding.reportId === current.binding.reportId
    && attempted.binding.reportVersion === current.binding.reportVersion
    && attempted.binding.reportFingerprint === current.binding.reportFingerprint
    && attempted.binding.evidencePackId === current.binding.evidencePackId
    && attempted.binding.evidencePackFingerprint === current.binding.evidencePackFingerprint
    && attempted.binding.cutoffAt === current.binding.cutoffAt;
}

function classifyQuestion(question: string): ResearchEvidenceQuestionTopic {
  const value = question.toLowerCase();
  const matches = (terms: string[]) => terms.some((term) => value.includes(term));
  if (matches(["未知", "缺口", "还不知道", "unknown", "missing"])) return "unknowns";
  if (matches(["反证", "相反", "质疑", "counter", "against"])) return "counterevidence";
  if (matches(["量化", "组合风险", "波动", "相关性", "尾部", "quant", "volatility", "correlation"])) return "quant";
  if (matches(["风险", "失效", "下行", "risk", "invalidate"])) return "risks";
  if (matches(["估值", "价格", "倍数", "valuation", "multiple"])) return "valuation";
  if (matches(["技术", "k线", "均线", "macd", "rsi", "布林", "technical"])) return "technical";
  if (matches(["事件", "催化", "公告", "event", "catalyst"])) return "events";
  if (matches(["基本面", "财务", "业务", "收入", "利润", "fundamental", "financial"])) return "fundamentals";
  return "overview";
}

function factsForTopic(
  payload: QuestionReportPayload,
  topic: ResearchEvidenceQuestionTopic
): QuestionReportFact[] {
  const research = payload.researchLayer;
  switch (topic) {
  case "fundamentals": return research.fundamentals;
  case "valuation": return research.valuation;
  case "technical": return research.technical;
  case "quant": return research.quantPortfolio ?? [];
  case "events": return research.eventsAndCatalysts;
  case "risks": return research.risks;
  case "counterevidence": return research.counterevidence;
  case "unknowns": return research.unknowns;
  case "overview": return [
    ...research.fundamentals.slice(0, 2),
    ...("context" in research ? research.context.slice(0, 2) : []),
    ...research.valuation.slice(0, 2),
    ...research.technical.slice(0, 2),
    ...(research.quantPortfolio?.slice(0, 2) ?? []),
    ...research.eventsAndCatalysts.slice(0, 2),
    ...("operatingMonitor" in research ? research.operatingMonitor.slice(0, 2) : []),
    ...research.risks.slice(0, 2),
    ...research.counterevidence.slice(0, 2)
  ];
  }
}

function allFacts(payload: QuestionReportPayload): QuestionReportFact[] {
  const research = payload.researchLayer;
  return [
    ...research.fundamentals,
    ...("context" in research ? research.context : []),
    ...research.valuation,
    ...research.technical,
    ...(research.quantPortfolio ?? []),
    ...research.eventsAndCatalysts,
    ...("operatingMonitor" in research ? research.operatingMonitor : []),
    ...research.risks,
    ...research.counterevidence
  ];
}

function boundedFacts(facts: QuestionReportFact[]): ResearchEvidenceQuestionFact[] {
  const selected: ResearchEvidenceQuestionFact[] = [];
  const identities = new Set<string>();
  let characters = 0;
  for (const fact of facts) {
    const identity = `${fact.statement}\0${fact.evidenceIds.join(",")}\0${fact.sourceKind}\0${fact.claimType}\0${fact.stance}`;
    if (identities.has(identity)) continue;
    if (selected.length >= 24 || characters + fact.statement.length > 18000) break;
    selected.push({
      statement: fact.statement,
      evidenceIds: fact.evidenceIds,
      sourceKind: fact.sourceKind,
      ...("sourceId" in fact && typeof fact.sourceId === "string"
        ? { sourceId: fact.sourceId }
        : {}),
      claimType: fact.claimType,
      stance: fact.stance
    });
    identities.add(identity);
    characters += fact.statement.length;
  }
  return selected;
}

function failClosed(
  membershipId: string,
  question: string,
  status: "not_found" | "conflict" | "unavailable",
  message: string,
  now: Date,
  aiAttempted = false,
  sendManifest: ResearchEvidenceQuestionSendManifest | null = null
): ResearchEvidenceQuestionEnvelope {
  return {
    schemaVersion: RESEARCH_EVIDENCE_QUESTION_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    status,
    membershipId: /^[1-9]\d*$/.test(membershipId) ? membershipId : "UNKNOWN",
    membershipVersion: null,
    symbol: null,
    question,
    answer: null,
    topic: null,
    facts: [],
    unknowns: [],
    insights: [],
    sourceEvidenceIds: [],
    sendManifest,
    binding: null,
    reproducibility: reproducibility(aiAttempted),
    safety: safety(),
    message
  };
}

function reproducibility(aiAttempted = false): ResearchEvidenceQuestionEnvelope["reproducibility"] {
  if (aiAttempted) {
    return {
      generationMethod: "deepseek_chat_completions_current_report_evidence",
      model: "deepseek-flash",
      provider: "deepseek",
      prompt: "research-evidence-answer.v6",
      tokenUsage: "UNKNOWN",
      cost: "UNKNOWN"
    };
  }
  return {
    generationMethod: "deterministic_current_report_evidence_lookup",
    model: "NOT_USED",
    provider: "NOT_USED",
    prompt: "NOT_USED",
    tokenUsage: "NOT_USED",
    cost: "NOT_USED"
  };
}

function safety(): ResearchEvidenceQuestionEnvelope["safety"] {
  return {
    advisoryOnly: true,
    readOnly: true,
    createsOrder: false,
    createsTrade: false,
    callsBroker: false,
    mutatesPortfolio: false,
    mutatesOfficialConclusion: false
  };
}
