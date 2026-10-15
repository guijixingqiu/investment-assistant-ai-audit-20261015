import {
  type EvidenceBoundReportPackBinding,
  type DeepResearchReportData,
  type DeepResearchWorkspaceEnvelope,
  type ResearchEvidencePackData
} from "../../../packages/contracts/src/deepResearch.js";
import { canonicalJson } from "../../../packages/contracts/src/decisionContextBrowser.js";
import type { DeepResearchTaskSendManifest } from "../../../packages/contracts/src/deepResearchTask.js";
import { cloudAiPolicySnapshotSummary } from "./displayFormatting.js";

import { deepResearchPackBinding } from "../../../packages/contracts/src/limitedResearch.js";

type LayeredPayload = Extract<DeepResearchReportData["payload"], { adviceLayer: unknown; researchLayer: unknown }>;
type ReportFact = LayeredPayload["researchLayer"]["fundamentals"][number];

export interface DeepResearchReportSummary {
  reportId: string;
  reportVersion: number;
  reportCreatedAt: string;
  symbol: string;
  researchMode: "full" | "limited";
  reportFingerprint: string;
  evidencePackId: string;
  evidencePackVersion: number;
  evidencePackFingerprint: string;
  reportStatus: DeepResearchReportData["status"];
  identity: Record<string, unknown>;
  conclusion: string;
  confidence: string;
  applicableUntil: string;
  horizonStatement: string;
  researchQuestion: string;
  investmentThesis: string;
  sourceConflictAssessment: string;
  sourceConflicts: LayeredPayload["researchLayer"]["sourceConflicts"];
  evidence: ReportFact[];
  counterevidence: ReportFact[];
  unknowns: ReportFact[];
  missingCount: number;
  nextValidationQuestions: string[];
  changeFromPrevious: string;
  cutoffAt: string;
  longTerm: LayeredPayload["adviceLayer"]["longTerm"];
  mediumShortTerm: LayeredPayload["adviceLayer"]["mediumShortTerm"];
  conflict: LayeredPayload["adviceLayer"]["conflict"];
  direction: LayeredPayload["adviceLayer"]["direction"];
  priceConditions: LayeredPayload["adviceLayer"]["priceConditions"];
  priceRange: LayeredPayload["adviceLayer"]["priceRange"];
  researchPositionRange: LayeredPayload["adviceLayer"]["researchPositionRange"];
  assumptions: LayeredPayload["adviceLayer"]["assumptions"];
  scenarios: LayeredPayload["adviceLayer"]["scenarios"];
  nextQuestion: LayeredPayload["adviceLayer"]["nextQuestion"];
  versionChange: LayeredPayload["adviceLayer"]["versionChange"];
  quantPortfolio: EvidenceBoundReportPackBinding["quantPortfolio"] | null;
  sendManifest: DeepResearchTaskSendManifest | null;
  /** Human titles/public URLs of the exact frozen pack items; nothing is inferred. */
  sourceMaterials: DeepResearchReportSourceMaterial[];
}

export interface DeepResearchReportSourceMaterial {
  materialId: string;
  evidenceId: string;
  documentId: string | null;
  pageNumber: number | null;
  title: string;
  sourceUrl: string | null;
  sourceType: string;
}

export function deepResearchReportSummary(
  data: DeepResearchWorkspaceEnvelope["data"]
): DeepResearchReportSummary | null {
  const report = data?.latestReport;
  const pack = data?.latestPack;
  if (!report || !pack || report.currentness.status !== "current" || pack.currentness.status !== "current"
    || report.currentness.invalidatedBy.length || report.currentness.evidencePackInvalidatedBy.length
    || pack.currentness.invalidatedBy.length || report.evidencePackId !== pack.id
    || report.reportFingerprint === "UNKNOWN" || !/^[a-f0-9]{64}$/.test(pack.packFingerprint)) return null;
  return reportSummary(report, pack);
}

export function selectedDeepResearchReportSummary(
  data: DeepResearchWorkspaceEnvelope["data"],
  selection: { id: string; version: number; reportFingerprint: string }
): DeepResearchReportSummary | null {
  const reports = data?.reports.filter((report) => report.id === selection.id && report.version === selection.version
    && report.reportFingerprint === selection.reportFingerprint) ?? [];
  const report = reports.length === 1 ? reports[0] : null;
  const packs = report ? data?.evidencePacks.filter((pack) => pack.id === report.evidencePackId) ?? [] : [];
  const pack = packs.length === 1 ? packs[0] : null;
  return report && pack
    && !report.currentness.invalidatedBy.includes("report_fingerprint_invalid")
    && /^[a-f0-9]{64}$/.test(report.reportFingerprint) && /^[a-f0-9]{64}$/.test(pack.packFingerprint)
    ? reportSummary(report, pack) : null;
}

function reportSummary(report: DeepResearchReportData, pack: ResearchEvidencePackData): DeepResearchReportSummary | null {
  const payload = layeredPayload(report.payload);
  if (!payload || payload.adviceLayer.automaticTradingSignal !== false) return null;
  try {
    if (canonicalJson(payload.evidencePackBinding) !== canonicalJson(deepResearchPackBinding(pack))) return null;
  } catch { return null; }
  const research = payload.researchLayer;
  const allEvidence = [
    ...research.fundamentals,
    ...("context" in research ? research.context : []),
    ...research.valuation,
    ...research.technical,
    ...("quantPortfolio" in research ? research.quantPortfolio ?? [] : []),
    ...research.eventsAndCatalysts,
    ...("operatingMonitor" in research ? research.operatingMonitor : []),
    ...research.risks
  ];
  const evidence = allEvidence.filter((fact) => fact.sourceKind !== "source_missing");
  const counterevidence = research.counterevidence.filter((fact) => fact.sourceKind !== "source_missing");
  const unknowns = uniqueFacts([...research.unknowns,
    ...[...allEvidence, ...research.counterevidence].filter((fact) => fact.sourceKind === "source_missing")]);
  const sourceMaterials = pack.items
    .filter((item) => !/credential|temporary|debug/i.test(item.sourceType))
    .map((item) => ({
      materialId: item.id, evidenceId: item.evidenceId,
      documentId: item.citation?.documentId ?? null, pageNumber: item.citation?.pageNumber ?? null,
      title: item.title, sourceUrl: item.sourceUrl ?? null, sourceType: item.sourceType
    }));
  return {
    reportId: report.id, reportVersion: report.version, reportFingerprint: report.reportFingerprint,
    reportCreatedAt: report.createdAt, symbol: pack.symbol,
    researchMode: pack.researchMode === "limited" ? "limited" : "full",
    evidencePackId: pack.id, evidencePackVersion: pack.version, evidencePackFingerprint: pack.packFingerprint,
    reportStatus: report.status,
    identity: {
      target: { membershipId: pack.membershipId, membershipVersion: pack.membershipVersion, symbol: pack.symbol },
      report: { id: report.id, version: report.version, contractVersion: report.contractVersion, fingerprint: report.reportFingerprint },
      evidencePack: { id: pack.id, version: pack.version, fingerprint: pack.packFingerprint, frozenAt: pack.frozenAt },
      evidencePackBinding: payload.evidencePackBinding,
      snapshotBinding: "snapshotBinding" in payload ? payload.snapshotBinding : null,
      reproducibility: payload.reproducibility,
      sendManifest: "sendManifest" in payload ? payload.sendManifest ?? null : null
    },
    conclusion: payload.adviceLayer.conclusion, confidence: payload.adviceLayer.confidence,
    applicableUntil: payload.adviceLayer.applicableUntil, horizonStatement: payload.adviceLayer.horizonStatement,
    researchQuestion: payload.researchQuestion, investmentThesis: payload.investmentThesis,
    sourceConflictAssessment: payload.sourceConflictAssessment, sourceConflicts: research.sourceConflicts,
    evidence, counterevidence, unknowns, missingCount: unknowns.length,
    nextValidationQuestions: research.nextValidationQuestions,
    changeFromPrevious: payload.changeFromPrevious, cutoffAt: payload.cutoffAt,
    longTerm: payload.adviceLayer.longTerm, mediumShortTerm: payload.adviceLayer.mediumShortTerm,
    conflict: payload.adviceLayer.conflict,
    direction: payload.adviceLayer.direction, priceConditions: payload.adviceLayer.priceConditions,
    priceRange: payload.adviceLayer.priceRange, researchPositionRange: payload.adviceLayer.researchPositionRange,
    assumptions: payload.adviceLayer.assumptions, scenarios: payload.adviceLayer.scenarios,
    nextQuestion: payload.adviceLayer.nextQuestion, versionChange: payload.adviceLayer.versionChange,
    quantPortfolio: "quantPortfolio" in payload.evidencePackBinding ? payload.evidencePackBinding.quantPortfolio ?? null : null,
    sendManifest: "sendManifest" in payload ? payload.sendManifest ?? null : null,
    sourceMaterials
  };
}

export function renderDeepResearchReportSummary(
  documentRef: Document,
  data: DeepResearchWorkspaceEnvelope["data"],
  workspaceReadState: "empty" | "fresh" | "stale" = "fresh"
): void {
  renderDeepResearchReportExport(documentRef, data, workspaceReadState);
  const host = documentRef.getElementById("deep-research-report-summary");
  if (!host) return;
  host.replaceChildren();
  const summary = deepResearchReportSummary(data);
  host.dataset.state = summary ? summary.reportStatus : "unavailable";
  if (!summary) {
    host.textContent = data?.latestReport
      ? "当前报告、证据包或来源身份已变化；旧报告摘要不再显示，请刷新后重新核对。"
      : "尚无当前研究报告。完成并明确吸收 Deep Research 后，这里才显示结论。";
    return;
  }
  host.append(
    heading(documentRef, `当前研究报告 · #${summary.reportId} · v${summary.reportVersion}`),
    paragraph(documentRef, "AI 根据所选资料归纳与分析，非发行人原话；来源类型与立场是原材料标注，解释和推断请核对原文。"),
    paragraph(documentRef, `结论：${summary.conclusion}`),
    paragraph(documentRef, `信心：${presentedUnknown(summary.confidence, "证据不足，未给出信心评级")} · 适用至 ${summary.applicableUntil.slice(0, 10)} · 状态：${summary.reportStatus}`),
    paragraph(documentRef, `系统研究方向：${presentedDirection(summary.direction)} · 价格条件：${joined(summary.priceConditions ?? [])} · 研究仓位：${presentedUnknown(summary.researchPositionRange, "证据不足，暂不评估")}`),
    paragraph(documentRef, summary.quantPortfolio
      ? `量化与组合风险：个股=${summary.quantPortfolio.decision.status === "available" ? summary.quantPortfolio.decision.refinementId : "source_missing"} · 组合=${summary.quantPortfolio.portfolio.status === "available" ? summary.quantPortfolio.portfolio.evidenceId : "source_missing"} · 仅供研究`
      : "量化与组合风险：历史报告未绑定，保持 UNKNOWN。"),
    paragraph(documentRef, `已绑定 ${summary.evidence.length} 条依据 · ${summary.counterevidence.length} 条反证 · ${summary.missingCount} 项待核实`),
    list(documentRef, summary.evidence.slice(0, 3).map((fact) => `依据：${fact.statement}`), "暂无可展示的绑定依据。"),
    paragraph(documentRef, `反证：${summary.counterevidence[0]?.statement ?? "暂无独立反证，仍需主动核对。"}`),
    paragraph(documentRef, `待核实：${summary.unknowns[0]?.statement ?? "暂无待核实条目。"}`),
    paragraph(documentRef, `下一步核实：${nextActionLines(summary).principal}`),
    deepResearchReportFullDetails(documentRef, summary),
    paragraph(documentRef, "只读研究摘要；不会自动确认报告、形成正式决定、下单、交易或修改资产事实。")
  );
}

export function deepResearchReportExportStateLabel(summary: DeepResearchReportSummary): string {
  const mode = summary.researchMode === "limited" ? "限研究模式（limited，无估值/技术绑定）" : "完整研究模式";
  return `报告 #${summary.reportId} v${summary.reportVersion} · 状态码 ${summary.reportStatus} · ${mode} · 只读导出`;
}

/**
 * Self-contained, printable, human-readable report export.
 *
 * It only selects report fields and escapes every value, so no raw JSON, hash, temporary
 * conversation, credential or holding reaches the export. The result contains no script,
 * no framework and no network reference; it can be printed or saved as a PDF from the browser.
 */
export function deepResearchReportExportHtml(summary: DeepResearchReportSummary): string {
  const rows: string[] = [];
  const heading = (value: string) => rows.push(`<h2>${escapeHtml(value)}</h2>`);
  const paragraph = (value: string) => rows.push(`<p>${escapeHtml(value)}</p>`);
  const bullets = (values: string[], empty: string) => {
    const items = uniqueTexts(values);
    rows.push(`<ul>${(items.length ? items : [empty]).map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`);
  };

  heading(`${summary.symbol} 研究报告`);
  paragraph(`报告版本：v${summary.reportVersion} · 状态：${summary.reportStatus === "complete_pending_confirmation" ? "待明确确认" : "证据不足"} · ${deepResearchReportExportStateLabel(summary)}`);
  paragraph(`报告生成时间：${summary.reportCreatedAt} · 数据截止：${summary.cutoffAt} · 适用至：${summary.applicableUntil}`);
  paragraph(`报告标识：${summary.reportId} · 证据包：${summary.evidencePackId} v${summary.evidencePackVersion}`);
  paragraph("说明：AI 根据所选资料归纳与分析，非发行人原话；只读研究结论，不会自动确认报告或形成正式决定。");

  heading("结论与判断");
  paragraph(`结论：${summary.conclusion}`);
  paragraph(`信心：${presentedUnknown(summary.confidence, "证据不足，未给出信心评级")} · 方向：${presentedDirection(summary.direction)} · 研究仓位范围：${presentedUnknown(summary.researchPositionRange, "证据不足，暂不评估")}`);
  paragraph(summary.horizonStatement);
  paragraph(`长期视图：${summary.longTerm.view} · 中短期视图：${summary.mediumShortTerm.view}`);
  paragraph(`长短期关系：${summary.conflict.status} · ${summary.conflict.description}`);

  heading("相比上一版的变化");
  bullets([summary.changeFromPrevious, summary.versionChange ?? ""], "报告未声明变化。");

  // The research body is only printed when it is not already the displayed conclusion.
  const investmentThesis = summary.investmentThesis.trim();
  if (investmentThesis && investmentThesis !== summary.conclusion.trim()) {
    heading("研究正文");
    paragraph(investmentThesis);
  }

  heading("假设与估值/价格条件");
  bullets(summary.assumptions ?? [], "报告未记录假设。");
  bullets(summary.scenarios ?? [], "报告未记录情景。");
  bullets(summary.priceConditions ?? [], "报告未记录价格条件。");
  paragraph(`价格区间：${presentedUnknown(summary.priceRange, "证据不足，暂不估算")} · 研究问题：${summary.researchQuestion || "未记录"}`);
  if (summary.researchMode === "limited") {
    paragraph("限研究模式说明：本次未绑定估值与技术证据，价格区间与研究仓位不作评估，技术分析不在本报告范围内。技术值缺失不代表发行人经营风险，真实财务缺口仍保留在待核实条目中。");
  }

  heading("主要风险与失效");
  bullets([
    ...summary.longTerm.risks,
    ...summary.mediumShortTerm.risks
  ], "报告未记录风险条目。");
  bullets([
    ...summary.longTerm.invalidationConditions,
    ...summary.mediumShortTerm.invalidationConditions
  ], "报告未记录失效条件。");

  heading("反证与待核实事项");
  bullets(summary.counterevidence.map((fact) => fact.statement), "报告没有独立反证条目，仍需主动核对。");
  bullets(summary.unknowns.map((fact) => fact.statement), "报告未记录待核实条目。");
  paragraph(`来源冲突评估：${summary.sourceConflictAssessment || "报告未记录来源冲突评估。"}`);

  heading("下一步动作");
  const nextAction = nextActionLines(summary);
  paragraph(`下一步：${nextAction.principal}`);
  if (nextAction.additional.length) bullets(nextAction.additional, "没有更多待核实问题。");

  heading("来源（类型 / 文档 / 页码 / 证据 / 链接）");
  // `source_missing` facts are gaps, not usable evidence for the source list; they stay visible in
  // the pending-verification bullets above.
  const sourceLines = [...summary.evidence, ...summary.counterevidence]
    .filter((fact) => fact.sourceKind !== "source_missing")
    .map((fact) => reportExportSourceLine(fact, summary));
  bullets(sourceLines, "报告未记录可核对来源。");
  paragraph("链接只来自本次已验证证据包中材料本身记录的公开地址；缺失处标记为未记录，不补造链接。");
  return `<!doctype html>
<html lang="zh-Hans"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(summary.symbol)} 研究报告 v${summary.reportVersion}</title>
<style>
body{font:12pt/1.6 -apple-system,"PingFang SC","Helvetica Neue",Arial,sans-serif;color:#111;margin:24pt;max-width:52em}
h1{font-size:18pt}h2{font-size:14pt;margin:18pt 0 6pt;border-bottom:1px solid #ccc;padding-bottom:2pt}
p{margin:4pt 0}ul{margin:4pt 0 4pt 18pt;padding:0}li{margin:2pt 0}
@media print{body{margin:12mm}h2{break-after:avoid}}
</style></head><body>
<h1>${escapeHtml(summary.symbol)} 研究报告</h1>
${rows.join("\n")}
</body></html>`;
}

export function renderDeepResearchReportExport(
  documentRef: Document,
  data: DeepResearchWorkspaceEnvelope["data"],
  workspaceReadState: "empty" | "fresh" | "stale" = "fresh"
): void {
  const host = documentRef.getElementById("deep-research-report-export");
  if (!host) return;
  host.replaceChildren();
  const readState = workspaceReadState === "stale" ? "stale" : workspaceReadState === "empty" ? "empty" : "fresh";
  const summary = deepResearchReportSummary(data);
  host.dataset.workspaceFreshness = readState;
  if (readState === "stale") {
    host.dataset.state = "stale";
    host.textContent = "当前工作区读取已过期：本机仍显示上次成功读取的报告，但不再把它当作当前事实导出。请刷新后再导出可读报告。";
    return;
  }
  host.dataset.state = summary ? summary.reportStatus : "unavailable";
  if (!summary) {
    host.textContent = data?.latestReport
      ? "报告已删除、已失效或来源身份变化；旧报告不可导出，请刷新后重新核对当前报告。"
      : "尚无当前研究报告；完成并明确吸收 Deep Research 后才能导出可读报告。";
    return;
  }
  const note = documentRef.createElement("p");
  note.textContent = `导出状态：${deepResearchReportExportStateLabel(summary)}。导出只读，不重新生成报告、不写数据库、不上传云端。`;
  const button = documentRef.createElement("button");
  button.type = "button";
  button.textContent = "导出可读报告（HTML / 打印为 PDF）";
  button.addEventListener("click", () => {
    const blob = new Blob([deepResearchReportExportHtml(summary)], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = documentRef.createElement("a");
    anchor.href = url;
    anchor.download = `${summary.symbol}-research-report-v${summary.reportVersion}.html`;
    anchor.rel = "noopener";
    documentRef.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
  });
  host.append(button, note);
}

function reportExportSourceLine(fact: ReportFact, summary: DeepResearchReportSummary): string {
  const citation = "citation" in fact ? fact.citation ?? null : null;
  const sourceId = "sourceId" in fact && typeof fact.sourceId === "string" ? fact.sourceId : null;
  if (citation?.kind === "peer_original") {
    const owner = citation.sourceMembership
      ? `${citation.sourceMembership.symbol} 成员 ${citation.sourceMembership.membershipId} v${citation.sourceMembership.membershipVersion}`
      : `${summary.symbol} 主研究成员`;
    const base = `${fact.statement} — 类型 ${fact.sourceKind} · 来源 ${owner}`
      + ` · 材料 ${citation.materialId} r${citation.materialRevision}`
      + ` · 内容指纹 ${citation.contentFingerprint} · 来源版本 ${citation.sourceVersion}`
      + `${sourceId ? ` · 来源编号 ${sourceId}` : ""}`;
    if (citation.sourceType === "issuer_public_html") {
      const selected = citation.snapshotCitation;
      const link = publicSourceUrl(citation.sourceUrl);
      return base + ` · 已存网页快照 ${selected?.snapshotId ?? "未记录"}`
        + ` · 正文 SHA256 ${selected?.textSha256 ?? "未记录"}`
        + ` · 选段 ${selected?.startUtf16 ?? "?"}–${selected?.endUtf16 ?? "?"}`
        + ` · 选段 SHA256 ${selected?.excerptSha256 ?? "未记录"}`
        + ` · 原件 SHA256 ${citation.snapshotRawSha256 ?? "未记录"}`
        + (link ? ` · 原始公开地址 ${link}（页面可能已变化）` : " · 原始公开地址未记录");
    }
    const original = citation.providerOriginal;
    return base + ` · OpenD 第三方未核实 · 捕获 ${original?.captureId ?? "未记录"}`
      + ` · 页 ${original?.pageId ?? "未记录"} · 原始页 SHA256 ${original?.rawSha256 ?? "未记录"}`
      + ` · 报表 SHA256 ${original?.reportSha256 ?? "未记录"} · 本地提供商原件，无公开链接`;
  }
  const documentId = citation && "documentId" in citation ? citation.documentId : null;
  const pageNumber = citation && "pageNumber" in citation ? citation.pageNumber : null;
  const document = sourceMaterialForFact(fact, summary.sourceMaterials);
  const title = document ? ` · 材料标题 ${document.title}` : "";
  const link = publicSourceUrl(document?.sourceUrl ?? null);
  return `${fact.statement} — 类型 ${fact.sourceKind ?? citation?.kind ?? "UNKNOWN"}`
    + ` · 文档 ${documentId ?? "未记录文档"} · ${pageNumber ? `第${pageNumber}页` : "未记录页码"}`
    + ` · 证据 ${fact.evidenceIds.join(",") || "无证据编号"}${sourceId ? ` · 来源编号 ${sourceId}` : ""}${title}`
    + (link ? ` · 来源链接 ${link}` : " · 链接未记录（未匹配到带有公开地址的冻结材料）");
}

/**
 * Frozen pack items are addressed by their bare `id`; report facts may name the same item as
 * `material:<positiveId>` (see `exactMaterial` in reportAssistantData.ts). Only that exact
 * namespace is unwrapped — any other namespace stays untouched and matches nothing.
 */
function materialNamespaceId(sourceId: string): string | null {
  return /^material:([1-9]\d*)$/.exec(sourceId)?.[1] ?? null;
}

function sourceMaterialForFact(
  fact: ReportFact,
  materials: DeepResearchReportSourceMaterial[]
): DeepResearchReportSourceMaterial | null {
  const sourceId = "sourceId" in fact && typeof fact.sourceId === "string" ? fact.sourceId : null;
  const citation = "citation" in fact ? fact.citation ?? null : null;
  const namespacedId = sourceId === null ? null : materialNamespaceId(sourceId);
  return materials.find((material) => (sourceId !== null
    && (material.materialId === sourceId || material.evidenceId === sourceId
      || (namespacedId !== null && material.materialId === namespacedId)))
    || (citation && "documentId" in citation && citation.documentId !== null && material.documentId === citation.documentId
      && (material.pageNumber === null || citation.pageNumber === undefined || material.pageNumber === citation.pageNumber)))
    ?? null;
}

function publicSourceUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Human phrase for the exact `UNKNOWN` marker of one recorded field; other values stay verbatim. */
function presentedUnknown(value: string | null | undefined, unknown: string, missing = "未记录"): string {
  const text = value?.trim();
  if (!text) return missing;
  return text === "UNKNOWN" ? unknown : text;
}

/** The two recorded no-direction markers read as plain Chinese; any real direction stays as recorded. */
function presentedDirection(value: string | null | undefined, missing = "未记录"): string {
  const text = presentedUnknown(value, "证据不足，暂不判断方向", missing);
  return text === "wait_for_evidence" ? "等待更多证据，暂不判断方向" : text;
}

/** Trims, drops blanks and keeps only the first occurrence of each exact duplicate value. */
function uniqueTexts(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

/** One principal next action, plus only the additional distinct recorded questions. */
function nextActionLines(summary: DeepResearchReportSummary): { principal: string; additional: string[] } {
  const questions = uniqueTexts(summary.nextValidationQuestions).filter((question) => question !== "UNKNOWN");
  // A missing or exact `UNKNOWN` next question is not a recorded action, so a real question wins.
  const principal = presentedUnknown(summary.nextQuestion, "", "") || questions[0] || "未记录";
  return { principal, additional: questions.filter((question) => question !== principal) };
}

export function deepResearchReportFullDetails(documentRef: Document, value: DeepResearchReportSummary): HTMLElement {
  const details = documentRef.createElement("details");
  const summary = documentRef.createElement("summary");
  summary.textContent = "完整条件、证据与版本身份";
  details.append(
    summary,
    paragraph(documentRef, value.horizonStatement),
    paragraph(documentRef, `研究问题：${value.researchQuestion || "UNKNOWN"}`),
    paragraph(documentRef, `研究正文：${value.investmentThesis || "UNKNOWN"}`),
    paragraph(documentRef, `长期：${value.longTerm.view} · 条件 ${joined(value.longTerm.conditions)} · 失效 ${joined(value.longTerm.invalidationConditions)} · 风险 ${joined(value.longTerm.risks)}`),
    paragraph(documentRef, `中短期：${value.mediumShortTerm.view} · 条件 ${joined(value.mediumShortTerm.conditions)} · 失效 ${joined(value.mediumShortTerm.invalidationConditions)} · 风险 ${joined(value.mediumShortTerm.risks)}`),
    paragraph(documentRef, `长短期关系：${value.conflict.status} · ${value.conflict.description}`),
    paragraph(documentRef, `价格区间：${presentedUnknown(value.priceRange, "证据不足，暂不估算")} · 假设：${joined(value.assumptions ?? [])} · 情景：${joined(value.scenarios ?? [])}`),
    paragraph(documentRef, `下一问题：${value.nextQuestion ?? "UNKNOWN"} · 版本变化：${value.versionChange ?? "UNKNOWN"}`),
    paragraph(documentRef, value.sendManifest
      ? `实际发送：本地准备 ${value.sendManifest.preparedAt ?? "UNKNOWN"} · ${value.sendManifest.selectedMaterialIds.length} 份材料 · ${value.sendManifest.includedStructuredSections.join("/") || "无结构化分区"} · ${cloudAiPolicySnapshotSummary(value.sendManifest.policySnapshot)} · SHA-256 ${value.sendManifest.requestBodySha256}`
      : "实际发送清单：历史报告未记录，保持 UNKNOWN。"),
    list(documentRef, value.evidence.map(factLine), "无绑定依据。"),
    list(documentRef, value.counterevidence.map((fact) => `反证 · ${factLine(fact)}`), "无绑定反证。"),
    list(documentRef, value.unknowns.map((fact) => `待核实 · ${factLine(fact)}`), "无待核实条目。"),
    list(documentRef, value.sourceConflicts.map((item) => `来源冲突 · ${canonicalJson(item)}`), `来源冲突评估 · ${value.sourceConflictAssessment || "无"}`),
    paragraph(documentRef, `变化：${value.changeFromPrevious || "未声明"} · 截止：${value.cutoffAt}`)
  );
  const identity = documentRef.createElement("pre");
  identity.style.whiteSpace = "pre-wrap";
  identity.style.overflowWrap = "anywhere";
  identity.textContent = JSON.stringify(value.identity, null, 2);
  details.append(identity);
  return details;
}

function layeredPayload(payload: DeepResearchReportData["payload"]): LayeredPayload | null {
  return payload && typeof payload === "object" && "adviceLayer" in payload && "researchLayer" in payload ? payload : null;
}
function heading(documentRef: Document, value: string): HTMLElement { const node = documentRef.createElement("h4"); node.textContent = value; return node; }
function paragraph(documentRef: Document, value: string): HTMLElement { const node = documentRef.createElement("p"); node.textContent = value; return node; }
function list(documentRef: Document, values: string[], empty: string): HTMLElement { const node = documentRef.createElement("ul"); for (const value of values.length ? values : [empty]) { const item = documentRef.createElement("li"); item.textContent = value; node.append(item); } return node; }
function factLine(fact: ReportFact): string { return `${fact.statement} · ${fact.sourceKind}${"sourceId" in fact ? `:${fact.sourceId}` : ""} · evidence ${fact.evidenceIds.join(",") || "none"} · citation ${"citation" in fact ? canonicalJson(fact.citation) : "not captured"}`; }
function uniqueFacts(values: ReportFact[]): ReportFact[] { return [...new Map(values.map((value) => [canonicalJson(value), value])).values()]; }
function joined(values: string[]): string { return values.join("；") || "未记录"; }
