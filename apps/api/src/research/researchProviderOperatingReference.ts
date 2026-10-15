import type { Pool, PoolClient } from "pg";
import {
  FUTU_FINANCIAL_STATEMENT_SOURCE,
  FUTU_STATEMENT_TYPES,
  type FutuFinancialMaterialPreview,
  type FutuFinancialHistoryValue
} from "../../../../packages/contracts/src/researchFutuFinancialStatement.js";
import type { ResearchContextSnapshotData } from "../../../../packages/contracts/src/researchContext.js";
import { researchContextContentHash } from "../../../../packages/contracts/src/researchContext.js";
import {
  PROVIDER_OPERATING_METRICS,
  PROVIDER_OPERATING_REFERENCE_VERSION,
  providerOperatingPeriodFingerprint,
  validateResearchProviderOperatingReference,
  type ProviderOperatingOwnerContext,
  type ProviderOperatingPeriod,
  type ResearchProviderOperatingReference
} from "../../../../packages/contracts/src/researchProviderOperatingReference.js";
import type { AuthenticatedResearchActor } from "./domain.js";
import { readFutuFinancialHistory, readFutuFinancialMaterialMatches } from "./researchFutuFinancialStatementRepository.js";
import type { SourceSnapshotStoreOptions } from "./researchSourceSnapshotRepository.js";

type Reader = Pick<Pool | PoolClient, "query">;
type Identity = { membershipId: string; membershipVersion: number; symbol: string };
const commonLimitations = [
  "OpenD 提供商原值；发行人原件未核验，不能作为正式财务事实。",
  "最新应披露期间及重述可比性 UNKNOWN；年度与累计半年不得相减冒充单季。"
];
const missingMetrics = (values: FutuFinancialHistoryValue[]) =>
  PROVIDER_OPERATING_METRICS.filter(metric => !values.some(value => value.metric === metric));
const captureWideMaterialGap = (gap: string) => gap.endsWith("仅表示本次捕获范围。")
  && FUTU_STATEMENT_TYPES.some(type => gap.startsWith(`${type}：`));

export function projectProviderOwnerContext(context: ResearchContextSnapshotData | null): ProviderOperatingOwnerContext | null {
  if (!context || context.currentness.status !== "current") return null;
  const model = context.operatingModel;
  return {
    contextId: context.id,
    contextFingerprint: researchContextContentHash(context),
    cutoffAt: context.cutoffAt,
    kpis: context.operatingKpis,
    ownerAssumptions: (model?.scenarios ?? []).flatMap(scenario =>
      Object.entries(scenario.inputs).flatMap(([metric, input]) =>
        input.origin === "owner_assumption" && input.value !== null
          ? [{ scenario: scenario.name, metric, value: input.value, unit: input.unit,
            note: input.note, periodEnd: scenario.period.end }]
          : [])),
    counterEvidence: (model?.thesisTests ?? []).filter(test => test.status !== "ARCHIVED").map(test => ({
      testId: test.testId, conditionText: test.originalThesisIdentity.conditionText,
      metrics: test.metrics, status: test.status === "ACTIVE" ? "ACTIVE" as const : "DRAFT" as const
    })),
    questions: (model?.researchQuestionDrafts ?? []).map(question => ({
      questionId: question.questionId, question: question.question, targetMetric: question.targetMetric
    })),
    unknowns: context.unknowns
  };
}

export function providerPeriodFromPreview(preview: FutuFinancialMaterialPreview,
  material: ProviderOperatingPeriod["materialMatches"][number]): ProviderOperatingPeriod {
  const values = preview.values;
  const periodBasisConflict = values.some(value => value.periodKind === "duration"
    ? value.periodStart !== `${preview.source.periodEnd.slice(0, 4)}-01-01`
    : value.periodKind !== "instant" || value.periodStart !== null);
  return {
    financialType: preview.source.financialType,
    periodEnd: preview.source.periodEnd,
    captureId: preview.source.captureId,
    sourceFingerprint: providerOperatingPeriodFingerprint(values),
    values,
    missingMetrics: missingMetrics(values),
    materialMatches: [material],
    limitations: [...commonLimitations, ...preview.source.gaps,
      ...(periodBasisConflict ? ["所选期间起止或期末时点口径冲突，不能认定同期间覆盖。"] : [])].slice(0, 10)
  };
}

export function selectedProviderOperatingReference(identity: Identity,
  periods: ProviderOperatingPeriod[], ownerContext: ProviderOperatingOwnerContext | null): ResearchProviderOperatingReference {
  const captureLimitations = [...new Set(periods.flatMap(period => period.limitations
    .filter(captureWideMaterialGap).map(gap => `整次历史捕获：${gap}`)))].slice(0, 30);
  const scopedPeriods = periods.map(period => ({ ...period,
    limitations: period.limitations.filter(gap => !captureWideMaterialGap(gap)) }));
  const annualEnds = periods.filter(period => period.financialType === "ANNUAL")
    .map(period => period.periodEnd).sort().reverse();
  const currencies = new Set(periods.flatMap(period => period.values.map(value => value.currencyCode)));
  const selectedScopeGaps = periods.length ? [
    ...(annualEnds.length === 5 && annualEnds.every((end, index) =>
      end === `${Number(annualEnds[0]!.slice(0, 4)) - index}-12-31`) ? []
      : [`本次仅选择 ${annualEnds.length} 个年度期间，尚未构成连续五年选材；未选择不等于提供商未披露。`]),
    ...(periods.some(period => period.financialType === "Q6") ? []
      : ["本次未选择累计半年期间；最新应披露期仍为 UNKNOWN。"]),
    ...(currencies.size > 1 ? ["本次所选材料跨期间含不同币种，不能合并金额或作同币种比较。"] : [])
  ] : ["本次未明确选择已保存的 OpenD 财务材料。"];
  const reference: ResearchProviderOperatingReference = {
    schemaVersion: PROVIDER_OPERATING_REFERENCE_VERSION,
    ...identity,
    sourceClassification: FUTU_FINANCIAL_STATEMENT_SOURCE,
    status: scopedPeriods.length ? scopedPeriods.some(period => period.missingMetrics.length || period.limitations.length > commonLimitations.length)
      || selectedScopeGaps.length
      ? "partial" : "available" : "unavailable",
    periods: scopedPeriods,
    gaps: selectedScopeGaps,
    captureLimitations,
    ownerContext,
    issuerOriginalVerification: "UNKNOWN",
    restatementComparability: "UNKNOWN",
    latestRequiredFiling: "UNKNOWN"
  };
  const validation = validateResearchProviderOperatingReference(reference);
  if (!validation.ok) throw new Error(`provider operating reference invalid: ${validation.errors.join("; ")}`);
  return reference;
}

/** Current, saved originals only; an unavailable provider lane leaves other research readable. */
export async function readProviderOperatingReference(reader: Reader, identity: Identity,
  actor: AuthenticatedResearchActor, store: SourceSnapshotStoreOptions | undefined,
  context: ResearchContextSnapshotData | null, now = new Date()): Promise<ResearchProviderOperatingReference> {
  const ownerContext = projectProviderOwnerContext(context);
  if (!store) {
    return { ...selectedProviderOperatingReference(identity, [], ownerContext),
      gaps: ["OpenD 已存原件读取未配置；提供商经营参考不可用。"] };
  }
  try {
    const history = await readFutuFinancialHistory(reader, identity.membershipId, actor, store);
    if (history.membershipVersion !== identity.membershipVersion || history.symbol !== identity.symbol)
      throw new Error("provider history membership changed");
    const periodKeys = [
      ...history.annualPeriodEnds.map(periodEnd => ({ financialType: "ANNUAL" as const, periodEnd, captureId: history.annualCaptureId })),
      ...history.halfYearPeriodEnds.map(periodEnd => ({ financialType: "Q6" as const, periodEnd, captureId: history.halfYearCaptureId }))
    ];
    const gaps = [...history.gaps];
    const periods: ProviderOperatingPeriod[] = [];
    for (const key of periodKeys) {
      const values = history.values.filter(value =>
        value.financialType === key.financialType && value.periodEnd === key.periodEnd);
      const captureId = values[0]?.source.captureId ?? key.captureId;
      if (values.some(value => value.source.captureId !== captureId)) {
        gaps.push(`${key.periodEnd} 来源捕获身份不一致，原值未列入参考。`);
        continue;
      }
      const sourceFingerprint = values.length ? providerOperatingPeriodFingerprint(values) : null;
      let materialMatches: ProviderOperatingPeriod["materialMatches"] = [];
      if (sourceFingerprint) {
        try {
          materialMatches = await readFutuFinancialMaterialMatches(reader, identity.membershipId, actor,
            sourceFingerprint, now);
        } catch {
          gaps.push(`${key.periodEnd} 已保存材料匹配不可用；原值仍可只读查看，不自动选材。`);
        }
      }
      periods.push({
        financialType: key.financialType,
        periodEnd: key.periodEnd,
        captureId,
        sourceFingerprint,
        values,
        missingMetrics: missingMetrics(values),
        materialMatches,
        limitations: [...commonLimitations, ...(missingMetrics(values).length
          ? ["五项关键值不完整；只展示已读取的原始值。"] : []),
          ...history.gaps.filter(gap => gap.includes(key.periodEnd))].slice(0, 10)
      });
    }
    const reference: ResearchProviderOperatingReference = {
      schemaVersion: PROVIDER_OPERATING_REFERENCE_VERSION,
      ...identity,
      sourceClassification: FUTU_FINANCIAL_STATEMENT_SOURCE,
      status: gaps.length ? periods.length ? "partial" : "unavailable" : history.status,
      periods,
      gaps: gaps.slice(0, 30),
      captureLimitations: history.captureLimitations,
      ownerContext,
      issuerOriginalVerification: "UNKNOWN",
      restatementComparability: "UNKNOWN",
      latestRequiredFiling: "UNKNOWN"
    };
    const validation = validateResearchProviderOperatingReference(reference);
    if (!validation.ok) throw new Error(`provider reference invalid: ${validation.errors.join("; ")}`);
    return reference;
  } catch {
    return { ...selectedProviderOperatingReference(identity, [], ownerContext),
      gaps: ["OpenD 已存财报历史读取或原件核验失败；本次没有可引用的提供商原值。"] };
  }
}
