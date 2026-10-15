import { validateCreateResearchMaterialRequest, validateDeepResearchWorkspaceEnvelope, validateResearchMaterialData,
  type CreateResearchMaterialRequest, type DeepResearchReportData, type DeepResearchWorkspaceEnvelope,
  type ResearchEvidencePackData, type ResearchMaterialData } from "../../../packages/contracts/src/deepResearch.js";
import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";
import type { DecisionReviewHistoryEnvelope, PostDecisionReviewData } from "../../../packages/contracts/src/decisionReview.js";
import type { OwnerReportCorrectionBinding } from "../../../packages/contracts/src/researchMaterial.js";
import { RESEARCH_EVENT_KINDS, researchEventBindsMaterial, type ResearchAnnouncementEventData } from "../../../packages/contracts/src/researchEvent.js";
import { formatResearchEvidenceQuestionAnswer, validateResearchEvidenceQuestionEnvelope, validateResearchEvidenceQuestionRequest,
  type ResearchEvidenceQuestionContextTurn, type ResearchEvidenceQuestionEnvelope,
  type ResearchEvidenceQuestionFact, type ResearchEvidenceQuestionImpact, type ResearchEvidenceQuestionRequest } from "../../../packages/contracts/src/researchEvidenceQuestion.js";
import { validateResearchWriteEnvelopeBase } from "../../../packages/contracts/src/research.js";
import { safeHttpsSource, sameMaterialIdentity } from "./evidenceConflictData.js";

export interface ReportAssistantSource {
  sourceKey: string; membershipId: string; membershipVersion: number; membershipState: "tracked" | "paused";
  market: "HK"; code: string; symbol: string; actorId: string;
}

export type ReportAssistantBinding = NonNullable<ResearchEvidenceQuestionEnvelope["binding"]>;

export interface CurrentReportAssistantWorkspace {
  workspace: DeepResearchWorkspaceEnvelope; report: DeepResearchReportData; pack: ResearchEvidencePackData;
  binding: ReportAssistantBinding; actorId: string; key: string;
}

export interface DailyTrackingCorrectionOffer extends OwnerReportCorrectionBinding { key: string; outcomeEvidence: string | null; reviewNote: string | null; }
export interface DailyTrackingCorrectionDraft { offer: DailyTrackingCorrectionOffer; judgmentCorrection: string; nextResearchQuestion: string; counterevidence: string; }

export type ReportAssistantCitation =
  | { kind: "document"; documentId: string; pageNumber: number; pageTextSha256: string }
  | { kind: "external"; url: string; label: string }
  | { kind: "material"; material: ResearchMaterialData }
  | { kind: "snapshot"; label: string };

export function acceptExactReportAssistantWorkspace(value: unknown, source: ReportAssistantSource, expectedActorId?: string): DeepResearchWorkspaceEnvelope {
  const validation = validateDeepResearchWorkspaceEnvelope(value);
  if (!validation.ok) throw new Error(`Workspace is malformed: ${validation.errors.join("; ")}`);
  const workspace = value as DeepResearchWorkspaceEnvelope;
  const target = workspace.data?.target;
  if (workspace.status !== "available" || !target
    || workspace.membershipId !== source.membershipId || workspace.requestedSymbol !== source.symbol
    || workspace.requestedActorId !== source.actorId
    || target.membershipId !== source.membershipId || target.membershipVersion !== source.membershipVersion
    || target.membershipState !== source.membershipState || target.market !== source.market
    || target.code !== source.code || target.symbol !== source.symbol
    || expectedActorId !== undefined && workspace.requestedActorId !== expectedActorId) {
    throw new Error("Workspace no longer binds the exact membership, version, state, symbol, or actor.");
  }
  return workspace;
}

export function acceptCurrentReportAssistantWorkspace(value: unknown, source: ReportAssistantSource,
  expectedKey?: string, expectedActorId?: string): CurrentReportAssistantWorkspace {
  const workspace = acceptExactReportAssistantWorkspace(value, source, expectedActorId);
  const pack = workspace.data?.latestPack;
  const report = workspace.data?.latestReport;
  const cutoffAt = report?.payload.cutoffAt;
  const limited = pack?.researchMode === "limited";
  if (!pack || (limited
    ? pack.frozenResearchContext !== null
    : !pack.frozenResearchContext || pack.frozenResearchContext.actor.actorId !== workspace.requestedActorId)
    || pack.currentness.status !== "current" || pack.currentness.invalidatedBy.length
    || !report || report.currentness.status !== "current" || report.currentness.invalidatedBy.length
    || report.currentness.evidencePackInvalidatedBy.length || report.evidencePackId !== pack.id
    || !sha(report.reportFingerprint) || !sha(pack.packFingerprint)
    || typeof cutoffAt !== "string" || !Number.isFinite(Date.parse(cutoffAt))) {
    throw new Error("A current exact report and evidence pack are required.");
  }
  const binding = { reportId: report.id, reportVersion: report.version, reportFingerprint: report.reportFingerprint,
    evidencePackId: pack.id, evidencePackFingerprint: pack.packFingerprint, cutoffAt };
  const key = canonicalJson([source.sourceKey, workspace.requestedActorId, binding]);
  if (expectedKey !== undefined && key !== expectedKey) {
    throw new Error("Current report or evidence-pack identity drifted.");
  }
  return { workspace, report, pack, binding, actorId: workspace.requestedActorId, key };
}

export function acceptReportAssistantAnswer(value: unknown, context: CurrentReportAssistantWorkspace,
  source: ReportAssistantSource, question: string): ResearchEvidenceQuestionEnvelope {
  const answer = acceptReportAssistantResponse(value, context, source, question);
  if (answer.status !== "available" || !answer.answer || !answer.binding) {
    throw new Error("Assistant answer does not bind the exact current report and pack.");
  }
  for (const fact of answer.facts) exactReportFact(context.report, fact);
  return answer;
}

export function acceptReportAssistantResponse(value: unknown, context: CurrentReportAssistantWorkspace,
  source: ReportAssistantSource, question: string): ResearchEvidenceQuestionEnvelope {
  const validation = validateResearchEvidenceQuestionEnvelope(value);
  if (!validation.ok) throw new Error(`Assistant response is malformed: ${validation.errors.join("; ")}`);
  const answer = value as ResearchEvidenceQuestionEnvelope;
  if (answer.membershipId !== source.membershipId || answer.question !== question) {
    throw new Error("Assistant response does not bind the exact current membership and question.");
  }
  if (answer.status !== "available") {
    const manifest = answer.sendManifest;
    if (manifest && (manifest.membershipId !== source.membershipId
      || manifest.membershipVersion !== source.membershipVersion || manifest.symbol !== source.symbol
      || manifest.reportId !== context.report.id || manifest.reportVersion !== context.report.version
      || manifest.reportFingerprint !== context.report.reportFingerprint
      || manifest.evidencePackId !== context.pack.id
      || manifest.evidencePackFingerprint !== context.pack.packFingerprint)) {
      throw new Error("Assistant send manifest does not bind the exact current report and pack.");
    }
    return answer;
  }
  if (answer.membershipVersion !== source.membershipVersion || answer.symbol !== source.symbol
    || canonicalJson(answer.binding) !== canonicalJson(context.binding)) {
    throw new Error("Assistant response does not bind the exact current report and pack.");
  }
  return answer;
}

export function reportAssistantAnswerFacts(answer: ResearchEvidenceQuestionEnvelope): ResearchEvidenceQuestionFact[] {
  if (answer.status !== "available" || !answer.answer) return [];
  const lines = new Set(answer.answer.split("\n"));
  const counts = new Map<string, number>();
  for (const fact of answer.facts) {
    const line = formatResearchEvidenceQuestionAnswer([fact], []);
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return answer.facts.filter((fact) => {
    const line = formatResearchEvidenceQuestionAnswer([fact], []);
    return lines.has(line) && counts.get(line) === 1;
  });
}

export function reportAssistantInsightTitle(impact: ResearchEvidenceQuestionImpact): string {
  return ({
    supports_current_conclusion: "支持当前结论", weakens_current_conclusion: "削弱当前结论", raises_risk: "增加风险",
    changes_valuation: "影响估值判断", changes_timing: "影响验证时点", limits_confidence: "降低结论信心",
    requires_follow_up: "需要继续核实"
  })[impact];
}

/** Owner-triggered on-demand counter-review, sent through the existing evidence-question lane. */
export const REPORT_ASSISTANT_COUNTER_REVIEW_QUESTION =
  "请对当前报告做一次证据范围内的反方复核（同一模型，仅使用本报告已绑定的事实与证据）："
  + "1) 列出支持当前结论最强的事实及其证据编号；"
  + "2) 列出最强反证或相反证据，并说明它是否足以推翻当前结论；"
  + "3) 指出哪些关键假设没有被现有证据覆盖，哪些必须保留为无法确认；"
  + "4) 说明出现什么新证据会改变当前结论；"
  + "5) 给出一个下一步最直接的核实动作。"
  + "不要引入本报告之外的资料，也不要声称来自独立来源或其他提供方。";

export function isReportAssistantCounterReviewQuestion(question: string): boolean {
  return question.trim() === REPORT_ASSISTANT_COUNTER_REVIEW_QUESTION;
}

export function reportAssistantQuestionRequest(source: ReportAssistantSource, context: CurrentReportAssistantWorkspace,
  question: string, conversation: ResearchEvidenceQuestionContextTurn[], idempotencyKey: string): ResearchEvidenceQuestionRequest {
  const request = { membershipVersion: source.membershipVersion, reportId: context.report.id,
    reportFingerprint: context.report.reportFingerprint, question: question.trim(), conversation: trimReportAssistantConversation(conversation), idempotencyKey };
  const validation = validateResearchEvidenceQuestionRequest(request);
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  return request;
}

export function trimReportAssistantConversation(turns: ResearchEvidenceQuestionContextTurn[]): ResearchEvidenceQuestionContextTurn[] {
  const selected: ResearchEvidenceQuestionContextTurn[] = [];
  let characters = 0;
  for (const turn of turns.slice(-8).reverse()) {
    const next = turn.question.length + turn.answer.length;
    if (characters + next > 24_000) break;
    selected.unshift(turn);
    characters += next;
  }
  return selected;
}

export function resolveReportAssistantCitation(context: CurrentReportAssistantWorkspace, fact: ResearchEvidenceQuestionFact): ReportAssistantCitation {
  const reportFact = exactReportFact(context.report, fact);
  const citation = reportFact.citation;
  const material = fact.sourceKind === "material" ? exactMaterial(context, fact, citation) : null;
  const event = fact.sourceKind === "event" ? exactEvent(context, fact, citation) : null;
  if (citation.kind === "document_page") {
    const pageNumber = citation.pageNumber;
    if (!positive(citation.documentId) || !Number.isSafeInteger(citation.pageNumber)
      || pageNumber === null || pageNumber < 1 || !sha(citation.pageTextSha256)) {
      throw new Error("Exact PDF citation is malformed.");
    }
    if (material?.citation && (material.citation.documentId !== citation.documentId
      || material.citation.pageNumber !== citation.pageNumber
      || material.citation.pageTextSha256 !== citation.pageTextSha256)) {
      throw new Error("Material PDF citation drifted from the exact report fact.");
    }
    return { kind: "document", documentId: citation.documentId, pageNumber, pageTextSha256: citation.pageTextSha256 };
  }
  if (event) return { kind: "external", url: exactHttps(event.source.sourceUrl), label: `event ${event.id} v${event.eventVersion}` };
  if (material) {
    if (material.sourceUrl) return { kind: "external", url: exactHttps(safeHttpsSource(material)), label: `material ${material.id} r${material.revision}` };
    return { kind: "material", material };
  }
  if (citation.kind === "snapshot_object") {
    return { kind: "snapshot", label: `${fact.sourceKind} ${fact.sourceId ?? "UNKNOWN"} · ${fact.statement}` };
  }
  throw new Error("This exact fact has no reopenable source; no alternate source was selected.");
}

export function assistantCorrectionRequest(source: ReportAssistantSource, context: CurrentReportAssistantWorkspace,
  correction: string | DailyTrackingCorrectionDraft, idempotencyKey: string, now = new Date()): CreateResearchMaterialRequest {
  if (typeof correction !== "string") return dailyTrackingCorrectionRequest(source, context, correction, idempotencyKey);
  const text = correction.trim();
  if (!text || text.length > 4_000) throw new Error("Correction must contain 1–4,000 characters.");
  const publishedAt = now.toISOString();
  const request: CreateResearchMaterialRequest = {
    membershipId: source.membershipId, membershipVersion: source.membershipVersion,
    title: `我的助手修正 · 报告 #${context.report.id} v${context.report.version}`,
    contentText: `当前报告：#${context.report.id} v${context.report.version} ${context.report.reportFingerprint}\n你的修正：${text}`,
    sourceType: "owner_assistant_report_correction", sourceUrl: null, publishedAt,
    claimType: "model_inference", verificationStatus: "unverified", rightsStatus: "user_provided",
    sourceVersion: `report:${context.report.id}:v${context.report.version}:${idempotencyKey}`,
    replacesMaterialId: null,
    validUntil: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1_000).toISOString(),
    summary: text, variableName: "report_revision_correction", stance: "neutral",
    reliability: null, materiality: null, isRead: true,
    assistantCorrectionBinding: {
      reportId: context.report.id, reportVersion: context.report.version,
      reportFingerprint: context.report.reportFingerprint,
      evidencePackId: context.pack.id, evidencePackFingerprint: context.pack.packFingerprint
    },
    idempotencyKey
  };
  const validation = validateCreateResearchMaterialRequest(request);
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  return request;
}
export function resolveDailyTrackingCorrectionOffer(history: DecisionReviewHistoryEnvelope, source: ReportAssistantSource,
  context: CurrentReportAssistantWorkspace, decisionCheckId: string, reviewId: string): DailyTrackingCorrectionOffer | null {
  if (history.requestedSymbol !== source.symbol) throw new Error("复盘历史已不再绑定当前股票。");
  const checks = history.checks.filter((item) => item.id === decisionCheckId && item.market === source.market
    && item.code === source.code && item.symbol === source.symbol);
  if (checks.length !== 1) throw new Error("当前复盘历史没有唯一且报告绑定的 DAILY_TRACKING 检查。");
  const check = checks[0];
  const latestCheck = history.checks.find((item) => item.market === source.market && item.code === source.code && item.symbol === source.symbol);
  if (latestCheck?.id !== check.id) throw new Error("目标检查已不是当前操作者与股票的最新决策检查。");
  if (check.researchReportDecision.availability !== "preserved") throw new Error("当前复盘历史没有唯一且报告绑定的 DAILY_TRACKING 检查。");
  const binding = check.researchReportDecision.binding;
  if (!reportBindingMatchesContext(binding, source, context)) throw new Error("复盘对应的会员、报告或冻结证据已经变化。");
  const reviews = check.reviews.filter((item) => item.id === reviewId && item.decisionCheckId === check.id
    && item.market === source.market && item.code === source.code && item.symbol === source.symbol);
  if (reviews.length !== 1) throw new Error("当前复盘历史没有唯一的目标复盘。");
  const review = reviews[0];
  if (review.audit.actorType !== "user" || review.audit.actorId !== context.actorId) throw new Error("复盘审计操作者与当前报告操作者不一致。");
  const latest = check.reviews.filter((item) => item.audit.actorType === "user" && item.audit.actorId === context.actorId)
    .reduce<PostDecisionReviewData | null>((selected, item) => !selected || reviewIsNewer(item, selected) ? item : selected, null);
  if (latest?.id !== review.id) throw new Error("目标复盘已不是当前操作者的最新复盘。");
  if (review.outcome !== "thesis_weakened" && review.outcome !== "thesis_invalidated") return null;
  const offer = { decisionCheckId: check.id, reviewId: review.id, reviewOutcome: review.outcome,
    reviewedAt: review.reviewedAt, reportBinding: binding,
    outcomeEvidence: review.outcomeEvidence, reviewNote: review.reviewNote };
  return { ...offer, key: canonicalJson([source.sourceKey, context.actorId, offer]) };
}

export function acceptAssistantCorrectionWrite(value: unknown, actorId: string, request: CreateResearchMaterialRequest): ResearchMaterialData {
  const errors = validateResearchWriteEnvelopeBase(value, "write envelope");
  const data = record(value) ? value.data : null;
  const source = record(value) && record(value.source) ? value.source : null;
  if (errors.length || !source || !validateResearchMaterialData(data).ok) {
    throw new Error(`Correction response is malformed: ${errors.join("; ") || "material data is invalid"}`);
  }
  const material = data as ResearchMaterialData;
  if (source.actorType !== "user" || source.actorId !== actorId || source.correlationId !== null
    || material.revisionState !== "current" || !materialMatchesRequest(material, request)) {
    throw new Error("Correction response does not bind the exact actor and submitted draft.");
  }
  return material;
}

export function acceptAssistantCorrectionReadback(before: CurrentReportAssistantWorkspace, afterValue: unknown,
  source: ReportAssistantSource, material: ResearchMaterialData | null,
  request: CreateResearchMaterialRequest): { workspace: DeepResearchWorkspaceEnvelope; material: ResearchMaterialData } {
  const after = acceptExactReportAssistantWorkspace(afterValue, source, before.actorId);
  const materials = after.data?.materials ?? [];
  const matches = materials.filter((candidate) => candidate.revisionState === "current"
    && materialMatchesRequest(candidate, request)
    && (material === null || sameMaterialIdentity(candidate, material)));
  if (matches.length !== 1) throw new Error("Fresh workspace did not return the exact saved correction material.");
  const pack = after.data?.latestPack;
  const report = after.data?.latestReport;
  if (pack?.id !== before.pack.id || pack.packFingerprint !== before.pack.packFingerprint
    || pack.currentness.status !== "historical" || !pack.currentness.invalidatedBy.includes("material_set_changed")
    || report?.id !== before.report.id || report.version !== before.report.version
    || report.reportFingerprint !== before.report.reportFingerprint || report.currentness.status !== "historical"
    || !report.currentness.evidencePackInvalidatedBy.includes("material_set_changed")) {
    throw new Error("Fresh readback did not historicalize the exact old pack and report after correction.");
  }
  return { workspace: after, material: matches[0] };
}

function exactReportFact(report: DeepResearchReportData, fact: ResearchEvidenceQuestionFact): ReportFact {
  const matches = reportFacts(report).filter((candidate) => candidate.statement === fact.statement
    && candidate.sourceKind === fact.sourceKind && candidate.sourceId === fact.sourceId
    && candidate.claimType === fact.claimType && candidate.stance === fact.stance
    && sameStrings(candidate.evidenceIds, fact.evidenceIds));
  if (matches.length !== 1) throw new Error("Exact answer fact is absent or ambiguous in the current report.");
  return matches[0];
}

function dailyTrackingCorrectionRequest(source: ReportAssistantSource, context: CurrentReportAssistantWorkspace,
  draft: DailyTrackingCorrectionDraft, idempotencyKey: string): CreateResearchMaterialRequest {
  const judgment = ownerText(draft.judgmentCorrection, "判断修正", true);
  const question = ownerText(draft.nextResearchQuestion, "下一验证问题", true);
  const counterevidence = ownerText(draft.counterevidence, "反证/未知", false);
  const unknown = counterevidence || "未填写/UNKNOWN";
  if (!reportBindingMatchesContext(draft.offer.reportBinding, source, context)
    || draft.offer.key !== canonicalJson([source.sourceKey, context.actorId, offerIdentity(draft.offer)])) throw new Error("复盘修正草稿的报告或复盘身份已变化。");
  const publishedAt = new Date(draft.offer.reviewedAt);
  if (!Number.isFinite(publishedAt.getTime())) throw new Error("复盘时间无效。");
  const summary = `判断修正：${judgment}\n下一验证问题：${question}\n反证/未知：${unknown}`;
  const request: CreateResearchMaterialRequest = {
    membershipId: source.membershipId, membershipVersion: source.membershipVersion,
    title: `我的复盘修正 · ${compact(judgment)} · ${compact(question)} · ${compact(unknown)}`,
    contentText: `当前报告：#${context.report.id} v${context.report.version} ${context.report.reportFingerprint}\n来源复盘：#${draft.offer.reviewId} ${draft.offer.reviewOutcome}\n${summary}`,
    sourceType: "owner_report_review_correction", sourceUrl: null, publishedAt: publishedAt.toISOString(),
    claimType: "model_inference", verificationStatus: "unverified", rightsStatus: "user_provided",
    sourceVersion: `report:${context.report.id}:review:${draft.offer.reviewId}:${idempotencyKey}`,
    replacesMaterialId: null,
    validUntil: new Date(publishedAt.getTime() + 90 * 24 * 60 * 60 * 1_000).toISOString(),
    summary, variableName: "report_revision_correction", stance: "refute",
    reliability: null, materiality: null, isRead: true,
    ownerCorrectionBinding: {
      decisionCheckId: draft.offer.decisionCheckId, reviewId: draft.offer.reviewId,
      reviewOutcome: draft.offer.reviewOutcome, reviewedAt: draft.offer.reviewedAt,
      reportBinding: draft.offer.reportBinding
    },
    idempotencyKey
  };
  const validation = validateCreateResearchMaterialRequest(request);
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  return request;
}

function reportBindingMatchesContext(binding: OwnerReportCorrectionBinding["reportBinding"], source: ReportAssistantSource,
  context: CurrentReportAssistantWorkspace): boolean {
  return binding.membershipId === source.membershipId && binding.membershipVersion === source.membershipVersion
    && binding.symbol === source.symbol && binding.reportDecisionActorType === "user"
    && binding.reportDecisionActorId === context.actorId && binding.reportId === context.report.id
    && binding.reportVersion === context.report.version && binding.contractVersion === context.report.contractVersion
    && binding.reportFingerprint === context.report.reportFingerprint
    && binding.evidencePackId === context.pack.id && binding.evidencePackFingerprint === context.pack.packFingerprint
    && context.report.evidencePackId === context.pack.id;
}

function offerIdentity(offer: DailyTrackingCorrectionOffer): Omit<DailyTrackingCorrectionOffer, "key"> {
  const { key: _, ...identity } = offer; return identity;
}

function reviewIsNewer(left: PostDecisionReviewData, right: PostDecisionReviewData): boolean {
  const reviewed = Date.parse(left.reviewedAt) - Date.parse(right.reviewedAt);
  const created = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  if (!Number.isFinite(reviewed) || !Number.isFinite(created) || !positive(left.id) || !positive(right.id)) throw new Error("复盘时间或身份无效。");
  return reviewed > 0 || reviewed === 0 && (created > 0 || created === 0 && BigInt(left.id) > BigInt(right.id));
}

function ownerText(value: string, label: string, required: boolean): string {
  const text = value.trim();
  if ((required && !text) || text.length > 1_000) throw new Error(`${label}必须为 ${required ? "1–" : "0–"}1,000 个字符。`);
  return text;
}
function compact(value: string): string { return value.replace(/\s+/g, " ").slice(0, 120); }

interface ReportFact {
  statement: string;
  evidenceIds: string[];
  sourceKind: string;
  sourceId: string;
  claimType: string;
  stance: string;
  citation: { kind: string; evidenceId: string | null; documentId: string | null; pageNumber: number | null; pageTextSha256: string | null };
}

function reportFacts(report: DeepResearchReportData): ReportFact[] {
  const payload = record(report.payload) ? report.payload : null;
  const layer = payload && record(payload.researchLayer) ? payload.researchLayer : null;
  if (!layer) return [];
  const facts: ReportFact[] = [];
  for (const value of Object.values(layer)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!record(item) || typeof item.statement !== "string" || !Array.isArray(item.evidenceIds)
        || item.evidenceIds.some((id) => typeof id !== "string") || typeof item.sourceKind !== "string"
        || typeof item.sourceId !== "string" || typeof item.claimType !== "string" || typeof item.stance !== "string"
        || !record(item.citation)) continue;
      facts.push(item as unknown as ReportFact);
    }
  }
  return facts;
}

function exactMaterial(
  context: CurrentReportAssistantWorkspace,
  fact: ResearchEvidenceQuestionFact,
  citation: ReportFact["citation"]
): ResearchMaterialData {
  const id = /^material:([1-9]\d*)$/.exec(fact.sourceId ?? "")?.[1];
  const evidenceIds = citation.evidenceId === null ? fact.evidenceIds : [citation.evidenceId];
  if (!id || evidenceIds.length === 0 || evidenceIds.some((evidenceId) => !positive(evidenceId) || !fact.evidenceIds.includes(evidenceId))) {
    throw new Error("Material source identity does not bind the answer evidence.");
  }
  const packed = context.pack.items.filter((item) => item.id === id && evidenceIds.includes(item.evidenceId));
  if (packed.length !== 1) throw new Error("Exact packed material is absent or ambiguous.");
  const current = (context.workspace.data?.materials ?? []).filter((item) => sameMaterialIdentity(item, packed[0]));
  if (current.length !== 1 || current[0].revisionState !== "current") throw new Error("Exact current material drifted from the pack.");
  return current[0];
}

function exactEvent(
  context: CurrentReportAssistantWorkspace,
  fact: ResearchEvidenceQuestionFact,
  citation: ReportFact["citation"]
): ResearchAnnouncementEventData {
  const id = /^event:([1-9]\d*)$/.exec(fact.sourceId ?? "")?.[1];
  if (!id) throw new Error("Event source identity is malformed.");
  const events = (context.workspace.data?.events ?? []).filter((event) => event.id === id);
  if (events.length !== 1) throw new Error("Exact event source is absent or ambiguous.");
  const event = events[0];
  if (fact.evidenceIds.length !== 0 || event.coverageScope !== "research_stock"
    || !RESEARCH_EVENT_KINDS.includes(event.eventKind)
    || event.source.claimType !== fact.claimType || event.source.stance !== fact.stance) {
    throw new Error("Event fact does not bind one reopenable research-stock source.");
  }
  const materials = context.pack.items.filter((material) => researchEventBindsMaterial(event, material));
  if (materials.length !== 1) throw new Error("Exact event material is absent or ambiguous in the current pack.");
  const material = materials[0];
  if (citation.kind === "pack_evidence" && citation.evidenceId !== material.evidenceId
    || citation.kind === "document_page" && (!material.citation
      || material.citation.documentId !== citation.documentId
      || material.citation.pageNumber !== citation.pageNumber
      || material.citation.pageTextSha256 !== citation.pageTextSha256)) {
    throw new Error("Event citation drifted from its exact packed material.");
  }
  return event;
}

function exactHttps(value: string | null): string {
  if (!value || value.length > 2_000) throw new Error("Exact source has no HTTPS URL; no alternate source was selected.");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Exact source URL is malformed."); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new Error("Exact source URL is not credential-free HTTPS.");
  }
  return value;
}

function materialMatchesRequest(material: ResearchMaterialData, request: CreateResearchMaterialRequest): boolean {
  return material.symbol === `HK.${material.code}` && material.title === request.title
    && material.contentText === request.contentText && material.sourceType === request.sourceType
    && material.sourceUrl === (request.sourceUrl ?? null) && material.publishedAt === request.publishedAt
    && material.claimType === request.claimType && material.verificationStatus === request.verificationStatus
    && material.rightsStatus === request.rightsStatus && material.sourceVersion === request.sourceVersion
    && material.replacesMaterialId === (request.replacesMaterialId ?? null) && material.validUntil === request.validUntil
    && material.summary === request.summary && material.variableName === (request.variableName ?? null)
    && material.stance === request.stance && material.reliability === (request.reliability ?? null)
    && material.materiality === (request.materiality ?? null) && material.isRead === (request.isRead ?? false);
}

function sameStrings(left: string[], right: string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function positive(value: unknown): value is string { return typeof value === "string" && /^[1-9]\d*$/.test(value); }
function sha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
