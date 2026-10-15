import type { DeepResearchWorkspaceEnvelope } from "../../../../packages/contracts/src/deepResearch.js";
import { DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION,
  type SynthesizedDeepResearchReportPayload } from "../../../../packages/contracts/src/deepResearchSynthesisReport.js";
import { validateDeepResearchSnapshotData } from "../../../../packages/contracts/src/deepResearchSnapshot.js";
import { OWNER_VERIFIED_HOLDING_LOGIC_SOURCE_TYPE } from "../../../../packages/contracts/src/researchMaterial.js";
import { RESEARCH_SECOND_OPINION_VERSION,
  type ResearchSecondOpinionBinding, type ResearchSecondOpinionPreview,
  type ResearchSecondOpinionSource } from "../../../../packages/contracts/src/researchSecondOpinion.js";
import { deepResearchReportFingerprint, sha256, synthesizedDeepResearchReportFailures,
  deepResearchReportIntegrityFailures } from "./deepResearchGate.js";

export interface ResearchSecondOpinionContext {
  preview: ResearchSecondOpinionPreview;
}

const PUBLIC_SOURCE_TYPES = new Set(["issuer_public_pdf", "issuer_public_html", "issuer_disclosure",
  "company_announcement", "company_disclosure", "filing", "official_pdf", "annual-report",
  "provider_financial_statement", "news_body", "market_data"]);

/** Resolves exactly the current synthesized report's frozen selected materials. */
export function researchSecondOpinionContext(workspace: DeepResearchWorkspaceEnvelope,
  membershipId: string, model: string, now = new Date()): ResearchSecondOpinionContext {
  if (workspace.status !== "available" || !workspace.data) throw new Error("当前研究工作区不可用");
  const { target, latestReport: report, latestPack: pack } = workspace.data;
  if (target.membershipId !== membershipId || target.membershipState !== "tracked"
    || !report || !pack || report.currentness.status !== "current"
    || report.currentness.invalidatedBy.length || report.currentness.evidencePackInvalidatedBy.length
    || pack.currentness.status !== "current" || pack.id !== report.evidencePackId
    || pack.membershipVersion !== target.membershipVersion
    || report.contractVersion !== DEEP_RESEARCH_SYNTHESIS_REPORT_CONTRACT_VERSION) {
    throw new Error("当前 exact 综合报告及证据包不可用；先重新读取或生成当前报告");
  }
  const payload = report.payload as SynthesizedDeepResearchReportPayload;
  if (!validateDeepResearchSnapshotData(payload.snapshot).ok
    || payload.snapshotBinding.snapshotId !== payload.snapshot.snapshotId
    || payload.snapshot.target.membershipId !== membershipId
    || payload.snapshot.target.membershipVersion !== target.membershipVersion
    || payload.snapshot.target.symbol !== target.symbol
    || payload.snapshot.evidencePack.id !== pack.id
    || payload.snapshot.evidencePack.packFingerprint !== pack.packFingerprint
    || payload.evidencePackBinding.id !== pack.id
    || payload.evidencePackBinding.fingerprint !== pack.packFingerprint
    || deepResearchReportFingerprint(pack.id, payload) !== report.reportFingerprint
    || deepResearchReportIntegrityFailures(payload, pack).length
    || synthesizedDeepResearchReportFailures(payload, pack, now).length) {
    throw new Error("报告内冻结快照与当前证据不一致；第二意见已停止");
  }
  const selectedIds = payload.snapshot.intent.selectedMaterialIds.length
    ? payload.snapshot.intent.selectedMaterialIds
    : pack.researchMode === "limited" ? [] : pack.items.map(item => item.id);
  if (!selectedIds.length || selectedIds.length > 40) throw new Error("选定材料数不在第二意见可发送范围内");
  const selected = selectedIds.map(id => pack.items.find(item => item.id === id));
  if (selected.some(item => !item)) throw new Error("选定材料已离开当前冻结证据包");
  const sources: ResearchSecondOpinionSource[] = selected.map(item => {
    const material = item!;
    if (material.rightsStatus !== "authorized_public"
      || material.sourceType === OWNER_VERIFIED_HOLDING_LOGIC_SOURCE_TYPE
      || !PUBLIC_SOURCE_TYPES.has(material.sourceType)
      || material.freshness !== "fresh" || material.revisionState !== "current"
      || !material.contentText.trim()) {
      throw new Error("选定材料包含非公开、过期或可能涉及资产信息的内容；未发送");
    }
    return {
      materialId: material.id, evidenceId: material.evidenceId, title: material.title,
      sourceType: material.sourceType, sourceUrl: publicSourceUrl(material.sourceUrl),
      contentFingerprint: material.contentFingerprint,
      excerpt: material.contentText.slice(0, 1200),
      excerptTruncated: material.contentText.length > 1200,
      stance: material.stance, claimType: material.claimType,
      verificationStatus: material.verificationStatus
    };
  });
  const reportConclusion = payload.adviceLayer.conclusion;
  const assumptions = payload.adviceLayer.assumptions ?? [];
  if (!secondOpinionPublicTextIsSafe(reportConclusion)
    || assumptions.some(value => !secondOpinionPublicTextIsSafe(value))
    || sources.some(source => !secondOpinionPublicTextIsSafe(source.title)
      || !secondOpinionPublicTextIsSafe(source.excerpt))) {
    throw new Error("报告判断、假设或选定摘录含个人账户、持仓成本或凭据信息；请先在原研究中修订公开研究表述，本次未发送");
  }
  const reportCounterEvidenceIds = [...new Set(payload.researchLayer.counterevidence.flatMap(fact => fact.evidenceIds))];
  const sourceSetHash = sha256(JSON.stringify(sources));
  const binding: ResearchSecondOpinionBinding = {
    membershipId, membershipVersion: target.membershipVersion, symbol: target.symbol,
    reportId: report.id, reportVersion: report.version, reportFingerprint: report.reportFingerprint,
    evidencePackId: pack.id, evidencePackFingerprint: pack.packFingerprint,
    snapshotId: payload.snapshot.snapshotId, sourceSetHash
  };
  return {
    preview: {
      schemaVersion: RESEARCH_SECOND_OPINION_VERSION, generatedAt: now.toISOString(), binding,
      reportConclusion, assumptions, reportCounterEvidenceIds, provider: "deepseek", model,
      maxOutputTokens: 1600, inputTokenUpperBound: 0, estimatedMaxCostUsd: 0,
      sources, limitations: [
        "与原研究共用已配置模型提供方；这是单独提示与单独运行，不代表跨模型共识。",
        "仅发送列出的冻结材料摘录；截断处没有进入模型，不能据此声称检查了全文。",
        "不会外部检索、发送整份 PDF、持仓资产或凭据；结果不自动修改报告或决定。"
      ]
    }
  };
}

/** This lane may send public research prose, never free-text account or credential details. */
export function secondOpinionPublicTextIsSafe(value: string): boolean {
  return !/(?:账户|账号|持仓|仓位|成本价|买入成本|平均成本|浮盈|浮亏|可用资金|我的|本人|个人持有|持有\s*[\d,.]+\s*(?:股|手)|券商|密码|密钥|口令|api[ _-]?key|access[ _-]?token|password|bearer\s+[a-z0-9._-]{8,}|(?:broker|owner|my)[ _-]?account|cost[ _-]?basis|my[ _-]?holdings|hold\s*[\d,.]+\s*shares)/i.test(value);
}

function publicSourceUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!(["https:", "http:"].includes(url.protocol))) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch { return null; }
}
