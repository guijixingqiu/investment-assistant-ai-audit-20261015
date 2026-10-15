import {
  cloudAiEstimatedMaxCostUsd,
  cloudAiProviderPolicySnapshotIsKnown,
  cloudAiModelPolicyMatches, cloudAiPricingMatches, type CloudAiPolicyVersion,
  cloudAiSendAuthorizationSnapshotIsKnown,
  type CloudAiProviderPolicySnapshot,
  type CloudAiSendAuthorizationSnapshot
} from "./cloudAiPolicy.js";
export const RESEARCH_EVIDENCE_QUESTION_SCHEMA_VERSION =
  "2026-08-17.research-evidence-question.v3";
export const RESEARCH_EVIDENCE_QUESTION_NO_SUPPORTED_ANSWER =
  "UNKNOWN：当前报告没有足够的绑定事实回答该问题。";

export const RESEARCH_EVIDENCE_QUESTION_TOPICS = [
  "overview", "fundamentals", "valuation", "technical", "quant", "events",
  "risks", "counterevidence", "unknowns"
] as const;

export type ResearchEvidenceQuestionTopic =
  (typeof RESEARCH_EVIDENCE_QUESTION_TOPICS)[number];

export const RESEARCH_EVIDENCE_QUESTION_IMPACTS = [
  "supports_current_conclusion",
  "weakens_current_conclusion",
  "raises_risk",
  "changes_valuation",
  "changes_timing",
  "limits_confidence",
  "requires_follow_up"
] as const;

export type ResearchEvidenceQuestionImpact =
  (typeof RESEARCH_EVIDENCE_QUESTION_IMPACTS)[number];

/** Request body fields sent to the provider, in order. */
export const RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS = [
  "question", "conversation", "symbol", "reportBinding", "facts", "unknowns"
] as const;

export const RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS_WITH_REPORT_CONTEXT = [
  ...RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS, "reportContext"
] as const;
export const RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS_WITH_CARRY = [
  ...RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS, "carrySummary"
] as const;
export const RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS_WITH_CARRY_AND_REPORT_CONTEXT = [
  ...RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS_WITH_CARRY, "reportContext"
] as const;

/** adviceLayer keys carried as the reviewed claim; never a fact or an evidence id. */
export const RESEARCH_EVIDENCE_QUESTION_REPORT_CONTEXT_FIELDS = [
  "conclusion", "confidence", "assumptions", "priceConditions", "nextQuestion"
] as const;

export type ResearchEvidenceQuestionReportContextField =
  (typeof RESEARCH_EVIDENCE_QUESTION_REPORT_CONTEXT_FIELDS)[number];

/**
 * The exact current report's own judgment, sent only so the model can review it.
 * It is a CLAIM UNDER REVIEW, never a fact, source, citation or new information.
 * "UNKNOWN" means the report itself did not state that part.
 */
export interface ResearchEvidenceQuestionReportContext {
  conclusion: string;
  confidence: "low" | "medium" | "high" | "UNKNOWN";
  assumptions: string[];
  priceConditions: string[];
  nextQuestion: string;
}

export interface ResearchEvidenceQuestionContextTurn {
  reportFingerprint: string;
  question: string;
  answer: string;
}

export interface ResearchEvidenceQuestionRequest {
  membershipVersion: number;
  reportId: string;
  reportFingerprint: string;
  question: string;
  conversation?: ResearchEvidenceQuestionContextTurn[];
  carrySummary?: ResearchEvidenceQuestionCarrySummary;
  idempotencyKey: string;
}

/** Reviewed prior-session note; it is never a report fact or source. */
export interface ResearchEvidenceQuestionCarrySummary {
  sourceSessionId: string;
  reportFingerprint: string;
  text: string;
  reviewed: true;
}

export interface ResearchEvidenceQuestionFact {
  statement: string;
  evidenceIds: string[];
  sourceKind: "material" | "fundamental" | "research_context" | "event" | "operating_monitor"
    | "valuation_context" | "technical_context" | "quant_portfolio_context" | "source_missing";
  sourceId?: string;
  claimType: string;
  stance: "support" | "refute" | "neutral" | "UNKNOWN";
}
export interface ResearchEvidenceQuestionInsight {
  impact: ResearchEvidenceQuestionImpact;
  source: "fact" | "unknown";
  statement: string;
  evidenceIds: string[];
  /** Optional bounded MODEL INTERPRETATION. Never a fact, source or citation. */
  explanation?: string;
}
export interface ResearchEvidenceQuestionSendManifest {
  purpose: "report_evidence_question";
  preparedAt?: string;
  policyVersion: CloudAiPolicyVersion;
  policySnapshot?: CloudAiProviderPolicySnapshot;
  sendAuthorization?: CloudAiSendAuthorizationSnapshot;
  provider: "deepseek";
  model: string;
  membershipId: string;
  membershipVersion: number;
  symbol: string;
  reportId: string;
  reportVersion: number;
  reportFingerprint: string;
  evidencePackId: string;
  evidencePackFingerprint: string;
  sourceEvidenceIds: string[];
  factCount: number;
  unknownCount: number;
  conversationTurnCount: number;
  payloadFields:
    | typeof RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS
    | typeof RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS_WITH_REPORT_CONTEXT
    | typeof RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS_WITH_CARRY
    | typeof RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS_WITH_CARRY_AND_REPORT_CONTEXT;
  /** Present exactly when payloadFields includes "reportContext". */
  reportContextFields?: ResearchEvidenceQuestionReportContextField[];
  requestBodySha256: string;
  pricingIdentity?: string;
  inputTokenUpperBound?: number;
  maxOutputTokens?: 800;
  estimatedMaxCostUsd?: number;
  fullPdfSent: false;
  credentialsSent: false;
  officialAssetFactsSent: false;
}

export function isResearchEvidenceQuestionKnownFact(
  fact: { sourceKind?: unknown; claimType?: unknown; stance?: unknown }
): boolean {
  return ["material", "fundamental", "research_context", "event", "operating_monitor", "valuation_context", "technical_context", "quant_portfolio_context"].includes(String(fact.sourceKind))
    && typeof fact.claimType === "string"
    && fact.claimType.length > 0
    && fact.claimType !== "UNKNOWN"
    && ["support", "refute", "neutral"].includes(String(fact.stance));
}

export function formatResearchEvidenceQuestionAnswer(
  facts: ResearchEvidenceQuestionFact[],
  unknowns: string[]
): string {
  const lines = [
    ...facts.map((fact) => fact.evidenceIds.length
      ? `${fact.statement} ${fact.evidenceIds.map((id) => `[evidence:${id}]`).join(" ")}`
      : `${fact.statement} [context]`),
    ...unknowns.map((unknown) => `UNKNOWN：${unknown}`)
  ];
  if (!lines.length) return RESEARCH_EVIDENCE_QUESTION_NO_SUPPORTED_ANSWER;
  const selected: string[] = [];
  let characters = 0;
  for (const line of lines) {
    const next = characters + line.length + (selected.length ? 1 : 0);
    if (next > 12000) break;
    selected.push(line);
    characters = next;
  }
  return selected.join("\n") || RESEARCH_EVIDENCE_QUESTION_NO_SUPPORTED_ANSWER;
}

export interface ResearchEvidenceQuestionEnvelope {
  schemaVersion: typeof RESEARCH_EVIDENCE_QUESTION_SCHEMA_VERSION;
  generatedAt: string;
  status: "available" | "not_found" | "conflict" | "unavailable";
  membershipId: string;
  membershipVersion: number | null;
  symbol: string | null;
  question: string;
  answer: string | null;
  topic: ResearchEvidenceQuestionTopic | null;
  facts: ResearchEvidenceQuestionFact[];
  unknowns: string[];
  insights: ResearchEvidenceQuestionInsight[];
  sourceEvidenceIds: string[];
  sendManifest: ResearchEvidenceQuestionSendManifest | null;
  binding: {
    reportId: string;
    reportVersion: number;
    reportFingerprint: string;
    evidencePackId: string;
    evidencePackFingerprint: string;
    cutoffAt: string;
  } | null;
  reproducibility: {
    generationMethod:
      | "deterministic_current_report_evidence_lookup"
      | "deepseek_chat_completions_current_report_evidence";
    model: string;
    provider: string;
    prompt: string;
    tokenUsage: string;
    cost: string;
  };
  safety: {
    advisoryOnly: true;
    readOnly: true;
    createsOrder: false;
    createsTrade: false;
    callsBroker: false;
    mutatesPortfolio: false;
    mutatesOfficialConclusion: false;
  };
  message: string;
}

export function validateResearchEvidenceQuestionRequest(
  value: unknown
): { ok: true } | { ok: false; errors: string[] } {
  if (!record(value)) return { ok: false, errors: ["request must be an object"] };
  const errors: string[] = [];
  exact(value, ["membershipVersion", "reportId", "reportFingerprint", "question", "conversation", "carrySummary", "idempotencyKey"], "request", errors, ["conversation", "carrySummary"]);
  if (!Number.isInteger(value.membershipVersion) || Number(value.membershipVersion) <= 0) errors.push("membershipVersion must be a positive integer");
  if (!positiveId(value.reportId)) errors.push("reportId must be a positive integer string");
  if (!sha256(value.reportFingerprint)) errors.push("reportFingerprint must be sha256 hex");
  bounded(value.question, "question", 1, 1000, errors);
  bounded(value.idempotencyKey, "idempotencyKey", 1, 200, errors);
  validateConversation(value.conversation, errors);
  if (value.carrySummary !== undefined) {
    if (!record(value.carrySummary)) errors.push("carrySummary must be an object");
    else {
      exact(value.carrySummary, ["sourceSessionId", "reportFingerprint", "text", "reviewed"], "carrySummary", errors);
      bounded(value.carrySummary.sourceSessionId, "carrySummary.sourceSessionId", 1, 100, errors);
      if (value.carrySummary.sourceSessionId !== "legacy"
        && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value.carrySummary.sourceSessionId))) {
        errors.push("carrySummary.sourceSessionId is invalid");
      }
      if (!sha256(value.carrySummary.reportFingerprint) || value.carrySummary.reportFingerprint !== value.reportFingerprint) errors.push("carrySummary report binding is invalid");
      bounded(value.carrySummary.text, "carrySummary.text", 1, 1200, errors);
      if (value.carrySummary.reviewed !== true) errors.push("carrySummary must be reviewed");
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validateResearchEvidenceQuestionEnvelope(
  value: unknown
): { ok: true } | { ok: false; errors: string[] } {
  if (!record(value)) return { ok: false, errors: ["envelope must be an object"] };
  const errors: string[] = [];
  exact(value, [
    "schemaVersion", "generatedAt", "status", "membershipId", "membershipVersion",
    "symbol", "question", "answer", "topic", "facts", "unknowns", "insights",
    "sourceEvidenceIds", "sendManifest", "binding", "reproducibility", "safety", "message"
  ], "envelope", errors);
  if (value.schemaVersion !== RESEARCH_EVIDENCE_QUESTION_SCHEMA_VERSION) errors.push("schemaVersion is invalid");
  if (typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))) errors.push("generatedAt is invalid");
  if (!["available", "not_found", "conflict", "unavailable"].includes(String(value.status))) errors.push("status is invalid");
  bounded(value.membershipId, "membershipId", 1, 100, errors);
  bounded(value.question, "question", 1, 1000, errors);
  bounded(value.message, "message", 1, 4000, errors);
  const available = value.status === "available";
  if (available) {
    if (!positiveId(value.membershipId)) errors.push("membershipId is invalid");
    if (!Number.isInteger(value.membershipVersion) || Number(value.membershipVersion) <= 0) errors.push("membershipVersion is invalid");
    if (typeof value.symbol !== "string" || !/^HK\.\d{5}$/.test(value.symbol)) errors.push("symbol is invalid");
    bounded(value.answer, "answer", 1, 12000, errors);
    if (!RESEARCH_EVIDENCE_QUESTION_TOPICS.includes(value.topic as ResearchEvidenceQuestionTopic)) errors.push("topic is invalid");
    validateFacts(value.facts, errors);
    validateStrings(value.unknowns, "unknowns", errors);
    validateInsights(value.insights, value.facts, value.unknowns, value.answer, errors);
    validateStrings(value.sourceEvidenceIds, "sourceEvidenceIds", errors, true);
    validateSourceEvidenceIds(value.sourceEvidenceIds, value.facts, errors);
    validateBinding(value.binding, errors);
    validateAnswerGrounding(value.answer, value.facts, value.unknowns, errors);
  } else if (value.membershipVersion !== null || value.symbol !== null || value.answer !== null
    || value.topic !== null || value.binding !== null || !emptyArray(value.facts)
    || !emptyArray(value.unknowns) || !emptyArray(value.insights)
    || !emptyArray(value.sourceEvidenceIds)) {
    errors.push("fail-closed envelope must not expose partial facts or binding");
  }
  validateReproducibility(value.reproducibility, errors, available);
  if (record(value.reproducibility)
    && value.reproducibility.generationMethod === "deepseek_chat_completions_current_report_evidence") {
    validateSendManifest(value.sendManifest, value, errors, available);
    if (record(value.sendManifest) && (value.sendManifest.model !== value.reproducibility.model
      || value.sendManifest.provider !== value.reproducibility.provider)) errors.push("sendManifest model differs from response");
  } else if (value.sendManifest !== null) {
    errors.push("deterministic response must clear sendManifest");
  }
  if (available && record(value.reproducibility)
    && value.reproducibility.generationMethod === "deepseek_chat_completions_current_report_evidence"
    && value.answer !== RESEARCH_EVIDENCE_QUESTION_NO_SUPPORTED_ANSWER
    && emptyArray(value.insights)) {
    errors.push("AI answer must explain at least one bounded impact");
  }
  validateSafety(value.safety, errors);
  return errors.length ? { ok: false, errors } : { ok: true };
}

function validateSendManifest(value: unknown, envelope: Record<string, unknown>, errors: string[], available: boolean): void {
  if (!record(value)) { errors.push("AI response requires sendManifest"); return; }
  exact(value, [
    "purpose", "preparedAt", "policyVersion", "policySnapshot", "sendAuthorization", "provider", "model", "membershipId", "membershipVersion", "symbol",
    "reportId", "reportVersion", "reportFingerprint", "evidencePackId", "evidencePackFingerprint",
    "sourceEvidenceIds", "factCount", "unknownCount", "conversationTurnCount", "payloadFields",
    "reportContextFields", "requestBodySha256", "pricingIdentity", "inputTokenUpperBound", "maxOutputTokens",
    "estimatedMaxCostUsd", "fullPdfSent", "credentialsSent", "officialAssetFactsSent"
  ], "sendManifest", errors, ["preparedAt", "policySnapshot", "sendAuthorization", "reportContextFields", "pricingIdentity", "inputTokenUpperBound", "maxOutputTokens", "estimatedMaxCostUsd"]);
  if (value.purpose !== "report_evidence_question") errors.push("sendManifest.purpose is invalid");
  if (!cloudAiModelPolicyMatches(value.model, value.policyVersion)) errors.push("sendManifest.policyVersion is invalid");
  if ([value.provider !== "deepseek", !["deepseek-v4-flash", "deepseek-flash"].includes(String(value.model)), !optionalInstantNotAfter(value.preparedAt, envelope.generatedAt),
    (!optionalCurrentPolicySnapshot(value.policySnapshot) || (record(value.policySnapshot) && (value.policySnapshot.model !== value.model || value.policySnapshot.policyVersion !== value.policyVersion)))].includes(true)) {
    errors.push("sendManifest provider, preparedAt, or policySnapshot is invalid");
  }
  if (value.sendAuthorization !== undefined && !cloudAiSendAuthorizationSnapshotIsKnown(value.sendAuthorization, value.policyVersion)) {
    errors.push("sendManifest.sendAuthorization is invalid");
  }
  if ([!positiveId(value.membershipId), value.membershipId !== envelope.membershipId,
    !Number.isInteger(value.membershipVersion), Number(value.membershipVersion) <= 0,
    typeof value.symbol !== "string", !/^HK\.\d{5}$/.test(String(value.symbol))].includes(true)) errors.push("sendManifest membership binding is invalid");
  if ([!positiveId(value.reportId), !Number.isInteger(value.reportVersion), Number(value.reportVersion) <= 0,
    !sha256(value.reportFingerprint), !positiveId(value.evidencePackId), !sha256(value.evidencePackFingerprint)].includes(true)) errors.push("sendManifest report binding is invalid");
  const binding = record(envelope.binding) ? envelope.binding : null;
  if (available && [value.membershipId !== envelope.membershipId, value.membershipVersion !== envelope.membershipVersion,
    value.symbol !== envelope.symbol, !binding, value.reportId !== binding?.reportId, value.reportVersion !== binding?.reportVersion,
    value.reportFingerprint !== binding?.reportFingerprint, value.evidencePackId !== binding?.evidencePackId,
    value.evidencePackFingerprint !== binding?.evidencePackFingerprint].includes(true)) errors.push("sendManifest does not match available response");
  validateStrings(value.sourceEvidenceIds, "sendManifest.sourceEvidenceIds", errors, true);
  if (available && JSON.stringify(value.sourceEvidenceIds) !== JSON.stringify(envelope.sourceEvidenceIds)) errors.push("sendManifest source evidence is invalid");
  for (const key of ["factCount", "unknownCount"]) if (!Number.isInteger(value[key]) || Number(value[key]) < 0 || Number(value[key]) > 24) errors.push(`sendManifest.${key} is invalid`);
  if (available && [value.factCount !== (Array.isArray(envelope.facts) ? envelope.facts.length : -1),
    value.unknownCount !== (Array.isArray(envelope.unknowns) ? envelope.unknowns.length : -1)].includes(true)) errors.push("sendManifest counts do not match available response");
  if (!Number.isInteger(value.conversationTurnCount) || Number(value.conversationTurnCount) < 0 || Number(value.conversationTurnCount) > 8) errors.push("sendManifest.conversationTurnCount is invalid");
  validateSendManifestPayloadFields(value, errors);
  if (!sha256(value.requestBodySha256)) errors.push("sendManifest.requestBodySha256 is invalid");
  validateSendManifestCostEstimate(value, errors);
  for (const key of ["fullPdfSent", "credentialsSent", "officialAssetFactsSent"]) if (value[key] !== false) errors.push(`sendManifest.${key} is invalid`);
}

function validateSendManifestPayloadFields(value: Record<string, unknown>, errors: string[]): void {
  const payloadFields = JSON.stringify(value.payloadFields);
  const withReportContext = JSON.stringify(RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS_WITH_REPORT_CONTEXT);
  const withCarryAndReportContext = JSON.stringify(RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS_WITH_CARRY_AND_REPORT_CONTEXT);
  if (![JSON.stringify(RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS), withReportContext,
    JSON.stringify(RESEARCH_EVIDENCE_QUESTION_PAYLOAD_FIELDS_WITH_CARRY), withCarryAndReportContext].includes(payloadFields)) {
    errors.push("sendManifest.payloadFields is invalid");
    return;
  }
  if (payloadFields === withReportContext || payloadFields === withCarryAndReportContext) {
    if (JSON.stringify(value.reportContextFields) !== JSON.stringify(RESEARCH_EVIDENCE_QUESTION_REPORT_CONTEXT_FIELDS)) {
      errors.push("sendManifest.reportContextFields is invalid");
    }
    return;
  }
  if (value.reportContextFields !== undefined) {
    errors.push("sendManifest.reportContextFields requires the reportContext payload field");
  }
}

function validateSendManifestCostEstimate(value: Record<string, unknown>, errors: string[]): void {
  const costKeys = ["pricingIdentity", "inputTokenUpperBound", "maxOutputTokens", "estimatedMaxCostUsd"] as const;
  const costFields = costKeys.filter((key) => value[key] !== undefined);
  if (costFields.length !== 0 && costFields.length !== costKeys.length) errors.push("sendManifest cost estimate must be all-or-none");
  if (costFields.length === costKeys.length && (
    !cloudAiPricingMatches(value.model, value.pricingIdentity)
    || !Number.isInteger(value.inputTokenUpperBound) || Number(value.inputTokenUpperBound) <= 0
    || value.maxOutputTokens !== 800
    || value.estimatedMaxCostUsd !== cloudAiEstimatedMaxCostUsd(Number(value.inputTokenUpperBound), 800, String(value.pricingIdentity))
  )) errors.push("sendManifest cost estimate is invalid");
}

function validateInsights(
  value: unknown,
  facts: unknown,
  unknowns: unknown,
  answer: unknown,
  errors: string[]
): void {
  if (!Array.isArray(value) || value.length > 8) {
    errors.push("insights must contain at most 8 items");
    return;
  }
  if (!Array.isArray(facts) || !Array.isArray(unknowns) || typeof answer !== "string") return;
  const answerLines = new Set(answer.split("\n"));
  const identities = new Set<string>();
  for (const insight of value) {
    if (!record(insight)) { errors.push("insight must be an object"); continue; }
    exact(insight, ["impact", "source", "statement", "evidenceIds", "explanation"], "insight", errors, ["explanation"]);
    if (!RESEARCH_EVIDENCE_QUESTION_IMPACTS.includes(insight.impact as ResearchEvidenceQuestionImpact)) {
      errors.push("insight.impact is invalid");
    }
    if (!["fact", "unknown"].includes(String(insight.source))) errors.push("insight.source is invalid");
    bounded(insight.statement, "insight.statement", 1, 4000, errors);
    if (insight.explanation !== undefined) bounded(insight.explanation, "insight.explanation", 1, 400, errors);
    validateStrings(insight.evidenceIds, "insight.evidenceIds", errors, true);
    const evidenceIds = Array.isArray(insight.evidenceIds)
      ? insight.evidenceIds.filter((id): id is string => typeof id === "string")
      : [];
    const identity = `${insight.impact}\0${insight.source}\0${insight.statement}\0${evidenceIds.join(",")}`;
    if (identities.has(identity)) errors.push("insights must be unique");
    identities.add(identity);
    if (insight.source === "unknown") {
      if (!unknowns.includes(insight.statement) || evidenceIds.length
        || !answerLines.has(`UNKNOWN：${String(insight.statement)}`)
        || !["limits_confidence", "requires_follow_up"].includes(String(insight.impact))) {
        errors.push("unknown insight is outside the exact report");
      }
      continue;
    }
    const fact = facts.find((candidate) => record(candidate)
      && candidate.statement === insight.statement
      && Array.isArray(candidate.evidenceIds)
      && candidate.evidenceIds.length === evidenceIds.length
      && candidate.evidenceIds.every((id, index) => id === evidenceIds[index]));
    if (!record(fact) || !answerLines.has(formatResearchEvidenceQuestionAnswer([
      fact as unknown as ResearchEvidenceQuestionFact
    ], []))) {
      errors.push("fact insight is outside the exact report");
    } else if ((fact.stance === "support" && insight.impact === "weakens_current_conclusion")
      || (fact.stance === "refute" && insight.impact === "supports_current_conclusion")) {
      errors.push("fact insight contradicts its report stance");
    }
  }
}

function validateSourceEvidenceIds(sourceEvidenceIds: unknown, facts: unknown, errors: string[]): void {
  if (!Array.isArray(sourceEvidenceIds) || !Array.isArray(facts)) return;
  const exactIds = new Set(facts.flatMap((fact) =>
    record(fact) && Array.isArray(fact.evidenceIds)
      ? fact.evidenceIds.filter((id): id is string => typeof id === "string")
      : []
  ));
  if (sourceEvidenceIds.length !== exactIds.size
    || sourceEvidenceIds.some((id) => typeof id !== "string" || !exactIds.has(id))) {
    errors.push("sourceEvidenceIds do not match facts");
  }
}

function validateFacts(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) { errors.push("facts must be an array"); return; }
  for (const fact of value) {
    if (!record(fact)) { errors.push("fact must be an object"); continue; }
    exact(fact, ["statement", "evidenceIds", "sourceKind", "sourceId", "claimType", "stance"], "fact", errors, ["sourceId"]);
    bounded(fact.statement, "fact.statement", 1, 4000, errors);
    validateStrings(fact.evidenceIds, "fact.evidenceIds", errors, true);
    if (!["material", "fundamental", "research_context", "event", "operating_monitor", "valuation_context", "technical_context", "quant_portfolio_context", "source_missing"].includes(String(fact.sourceKind))) errors.push("fact.sourceKind is invalid");
    if (fact.sourceId !== undefined) bounded(fact.sourceId, "fact.sourceId", 1, 500, errors);
    bounded(fact.claimType, "fact.claimType", 1, 100, errors);
    if (!["support", "refute", "neutral", "UNKNOWN"].includes(String(fact.stance))) errors.push("fact.stance is invalid");
    if (!isResearchEvidenceQuestionKnownFact(fact)) errors.push("UNKNOWN must not be classified as a fact");
  }
}

function validateBinding(value: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("binding is required"); return; }
  exact(value, ["reportId", "reportVersion", "reportFingerprint", "evidencePackId", "evidencePackFingerprint", "cutoffAt"], "binding", errors);
  if (!positiveId(value.reportId) || !positiveId(value.evidencePackId)) errors.push("binding ids are invalid");
  if (!Number.isInteger(value.reportVersion) || Number(value.reportVersion) <= 0) errors.push("binding.reportVersion is invalid");
  if (!sha256(value.reportFingerprint) || !sha256(value.evidencePackFingerprint)) errors.push("binding fingerprints are invalid");
  if (typeof value.cutoffAt !== "string" || !Number.isFinite(Date.parse(value.cutoffAt))) errors.push("binding.cutoffAt is invalid");
}

function validateReproducibility(value: unknown, errors: string[], available: boolean): void {
  if (!record(value)) { errors.push("reproducibility is required"); return; }
  exact(value, ["generationMethod", "model", "provider", "prompt", "tokenUsage", "cost"], "reproducibility", errors);
  if (value.generationMethod === "deterministic_current_report_evidence_lookup") {
    for (const key of ["model", "provider", "prompt", "tokenUsage", "cost"]) {
      if (value[key] !== "NOT_USED") errors.push(`reproducibility.${key} must be NOT_USED`);
    }
    return;
  }
  if (value.generationMethod !== "deepseek_chat_completions_current_report_evidence") {
    errors.push("generationMethod is invalid");
    return;
  }
  if (!["deepseek-v4-flash", "deepseek-flash"].includes(String(value.model)) || value.provider !== "deepseek"
    || !["research-evidence-answer.v4", "research-evidence-answer.v5", "research-evidence-answer.v6", "research-evidence-answer.v7"].includes(String(value.prompt))
    || typeof value.tokenUsage !== "string"
    || !(available
      ? /^prompt=\d+,completion=\d+,total=\d+$/.test(value.tokenUsage)
      : value.tokenUsage === "UNKNOWN")
    || !(value.cost === "UNKNOWN" || typeof value.cost === "string"
      && /^estimated_usd=\d+\.\d{8};pricing=(2026-08-13|2026-09-10\.peak)$/.test(value.cost)
      && value.cost.endsWith(value.model === "deepseek-flash" ? "pricing=2026-09-10.peak" : "pricing=2026-08-13"))) {
    errors.push("AI reproducibility is invalid");
  }
}

function validateAnswerGrounding(
  answer: unknown,
  facts: unknown,
  unknowns: unknown,
  errors: string[]
): void {
  if (typeof answer !== "string" || !Array.isArray(facts) || !Array.isArray(unknowns)) return;
  const validFacts = facts.filter((fact): fact is ResearchEvidenceQuestionFact =>
    record(fact)
    && typeof fact.statement === "string"
    && Array.isArray(fact.evidenceIds)
    && fact.evidenceIds.every((id) => typeof id === "string")
  );
  const validUnknowns = unknowns.filter((unknown): unknown is string => typeof unknown === "string");
  const allowed = new Set([
    ...validFacts.map((fact) => formatResearchEvidenceQuestionAnswer([fact], [])),
    ...validUnknowns.map((unknown) => formatResearchEvidenceQuestionAnswer([], [unknown])),
    RESEARCH_EVIDENCE_QUESTION_NO_SUPPORTED_ANSWER
  ]);
  const lines = answer.split("\n");
  if (new Set(lines).size !== lines.length || lines.some((line) => !allowed.has(line))) {
    errors.push("answer contains statements outside the exact report");
  }
}

function validateSafety(value: unknown, errors: string[]): void {
  if (!record(value)) { errors.push("safety is required"); return; }
  exact(value, ["advisoryOnly", "readOnly", "createsOrder", "createsTrade", "callsBroker", "mutatesPortfolio", "mutatesOfficialConclusion"], "safety", errors);
  if (value.advisoryOnly !== true || value.readOnly !== true) errors.push("safety must remain advisory and read-only");
  for (const key of ["createsOrder", "createsTrade", "callsBroker", "mutatesPortfolio", "mutatesOfficialConclusion"]) if (value[key] !== false) errors.push(`safety.${key} must be false`);
}

function validateConversation(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 8) {
    errors.push("conversation must contain at most 8 turns");
    return;
  }
  let characters = 0;
  for (const turn of value) {
    if (!record(turn)) {
      errors.push("conversation turn must be an object");
      continue;
    }
    exact(turn, ["reportFingerprint", "question", "answer"], "conversation turn", errors);
    if (!sha256(turn.reportFingerprint)) errors.push("conversation reportFingerprint must be sha256 hex");
    bounded(turn.question, "conversation question", 1, 1000, errors);
    bounded(turn.answer, "conversation answer", 1, 12000, errors);
    characters += typeof turn.question === "string" ? turn.question.length : 0;
    characters += typeof turn.answer === "string" ? turn.answer.length : 0;
  }
  if (characters > 24000) errors.push("conversation is too large");
}
function validateStrings(value: unknown, field: string, errors: string[], unique = false): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) { errors.push(`${field} must contain non-empty strings`); return; }
  if (unique && new Set(value).size !== value.length) errors.push(`${field} must be unique`);
}
function exact(
  value: Record<string, unknown>,
  keys: string[],
  label: string,
  errors: string[],
  optional: string[] = []
): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`);
  for (const key of keys) if (!optional.includes(key) && !(key in value)) errors.push(`${label}.${key} is required`);
}
function bounded(value: unknown, field: string, min: number, max: number, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) errors.push(`${field} is invalid`);
}
function positiveId(value: unknown): boolean { return typeof value === "string" && /^[1-9]\d*$/.test(value); }
function sha256(value: unknown): boolean { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function emptyArray(value: unknown): boolean { return Array.isArray(value) && value.length === 0; }
function optionalInstantNotAfter(value: unknown, upper: unknown): boolean { return value === undefined || typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.parse(String(upper)); }
function optionalCurrentPolicySnapshot(value: unknown): boolean { return value === undefined || cloudAiProviderPolicySnapshotIsKnown(value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
