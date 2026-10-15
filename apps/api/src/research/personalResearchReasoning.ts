import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { AuthenticatedResearchActor } from "./domain.js";
import { readResearchContextSnapshot } from "./researchContextRepository.js";
import { currentThesisText } from "../../../../packages/contracts/src/thesisFormation.js";
import type { InvestigationEvidence, InvestigationGap } from "./personalInvestigationSources.js";
import { cashEffectSubjectMentions, financialNumberEvidence, financialComparisonCitationErrors, financialCitationRepairHints, readInvestigationFinance, type ReadFinancialFact } from "./personalInvestigationFinance.js";
import {providerMetricTitles} from "./personalInvestigationProviderFinance.js";
import { visibleInferenceErrors, questionAndPlanErrors } from "./personalInvestigationCorrectness.js";

type Basis = { sourceId: string; quote: string };
// A cash bridge plus its separately labelled quarterly FCF can require five
// original rows. Bound payload size without discarding necessary operands.
export const INVESTIGATION_MAX_BASIS_QUOTES = 8;
// A projected reader section can combine several independently checked fact
// blocks. Bound the joined paragraph separately without shrinking its evidence
// to the limit for one factual or hypothesis assessment.
export const INVESTIGATION_MAX_REPORT_SECTION_QUOTES = 16;
export const INVESTIGATION_MAX_NEXT_QUESTIONS = 3;
export type ReasoningContext = { status: "active" | "none" | "unavailable" | "ended"; text: string | null; contextId: string | null; fingerprint: string };
export type ResearchImpact = "NO_CONFIRMED_IMPACT" | "SUPPORTS_EXISTING_VIEW" | "CHALLENGES_EXISTING_VIEW" | "REQUIRES_FURTHER_REVIEW";
type Impact = { classification: ResearchImpact; text: string; basis: Basis[]; missingEvidence: string };
type WhyThisMatters = { why?: string; ifConfirmed?: string; ifRejected?: string };
type ClaimCoverage = { claim: string; sourceIds: string[]; assessment: "direct" | "partial" | "insufficient"; missingLink: string; conclusion: string };
type TransmissionStep = { text: string; status: "confirmed" | "interpretation" | "unresolved"; basis: Basis[]; gap: InvestigationGap | null; whyThisMatters: WhyThisMatters };
export type ResearchReasoning = {
  summary: string;
  thesisImpact?: Impact; earningsImpact?: Impact; valuationImpact?: Impact;
  explanations: Array<{ hypothesisId: string; rank: number; investigationPriority: number; whyInvestigateFirst: string; neededEvidence: string; potentialImpact: string;
    supportingEvidence: Basis[]; contradictingEvidence: Basis[]; missingEvidence: string; confidenceReason: string; whyThisMatters: WhyThisMatters; claimCoverage: ClaimCoverage }>;
  transmission: Partial<{ operatingFact: TransmissionStep; operatingMeaning: TransmissionStep; earnings: TransmissionStep; cashFlow: TransmissionStep; valuation: TransmissionStep }>;
  unknowns: Array<InvestigationGap & { whyThisMatters: WhyThisMatters }>;
  nextQuestions: Array<{ hypothesisId: string; question: string; whyImportant: string; neededEvidence: string } & WhyThisMatters>;
};

// Reuse the actor/symbol/version-validated current context. No formal write or
// private portfolio/note access occurs in this projection.
export async function readReasoningContext(pool: Pool, id: string, actor: AuthenticatedResearchActor, symbol: string, version: number, now: Date): Promise<ReasoningContext> {
  const context = await readResearchContextSnapshot(pool, id, actor, now);
  const data = context.data;
  if (data && (data.selectedSymbol !== symbol || data.membershipVersion !== version)) throw new Error("REASONING_CONTEXT_IDENTITY_CHANGED");
  const text = data ? currentThesisText(data.operatingModel ?? null) : null;
  const missing = context.message === "research context is missing";
  const status: ReasoningContext["status"] = context.status !== "available" ? (missing ? "none" : "unavailable")
    : data?.operatingModel?.thesisOwnerAction?.action === "INVALIDATE_OR_END_THESIS" ? "ended" : text ? "active" : "none";
  const body = { status, text, contextId: data?.id ?? null };
  return { ...body, fingerprint: createHash("sha256").update(JSON.stringify({ ...body, id, symbol, version,
    reasoningRevision: "reasoning-v1.1-completed-lookup-coverage" })).digest("hex") };
}

const schemaBasis = [{ sourceId: "INPUT_SOURCE_ID", quote: "Copy an exact continuous original passage from this source" }];
const schemaWhy = { why: "Why reading this specific missing information matters; no forced binary outcomes" };
const schemaImpact = { classification: "NO_CONFIRMED_IMPACT", text: "Research meaning and evidence boundary", basis: schemaBasis, missingEvidence: "Specific missing original evidence" };
const schemaStep = { text: "One transmission point with an explicit evidence boundary", status: "unresolved", basis: schemaBasis,
  gap: { reason: "INCONCLUSIVE_AFTER_CHECK", text: "The specific unresolved transmission link after reading" }, whyThisMatters: schemaWhy };
export const reasoningSchema = {
  summary: "One sentence answering the question", thesisImpact: schemaImpact, earningsImpact: schemaImpact, valuationImpact: schemaImpact,
  explanations: [{ hypothesisId: "H1", rank: 1, investigationPriority: 1, whyInvestigateFirst: "Why investigate this first", neededEvidence: "Specific original evidence for the next check", potentialImpact: "Which research judgment this could affect",
    supportingEvidence: schemaBasis, contradictingEvidence: [], missingEvidence: "The remaining evidence gap", confidenceReason: "Why current support is limited", whyThisMatters: schemaWhy,
    claimCoverage: { claim: "The complete claim being assessed", sourceIds: ["INPUT_SOURCE_ID"], assessment: "partial", missingLink: "The causal or accounting link not supported by these quotes", conclusion: "A bounded conclusion explicitly retaining the unconfirmed link" } }],
  transmission: { operatingFact: schemaStep, operatingMeaning: schemaStep, earnings: schemaStep, cashFlow: schemaStep, valuation: schemaStep },
  unknowns: [{ reason: "INCONCLUSIVE_AFTER_CHECK", text: "Unknown question and actual reason", whyThisMatters: schemaWhy }],
  nextQuestions: [{ hypothesisId: "H1", question: "Specific suggested next question", whyImportant: "Why investigate this first", neededEvidence: "Specific original evidence", ...schemaWhy }]
};
export const reasoningInstruction = `Write narrative in Simplified Chinese, keep quotes literal. Every step, gap and explanation needs whyThisMatters:{why}. For a genuine testable proposition only, optional ifConfirmed and ifRejected must be a pair with source-supported implications; information requests do not require a binary outcome. Classify facts, interpretations, hypotheses and actual missing reads distinctly. Headlines or empty searches cannot establish or refute a claim. Never invent an active Owner Thesis, forecasts or trading advice. Unread valuation assumptions remain NOT_CHECKED. Numerical assertions require selected original passages or source-bound financialCalculations, keeping metric, period, units and scope. A reporting-year identifier is not a financial amount. Never turn other-gains amounts into export volume.`;
export const reasoningPriorityInstruction = `Keep existing V1.1 priority and coverage fields in the same reasoning object. Explanation rank is plausibility; investigationPriority is a unique 1..N research action order, based on research significance and evidence needed to discriminate explanations. They need not match. investigationPriority describes what to investigate NEXT after these reads, not the order of the original plan or checks already completed. If the only useful next question is H3, H3 must have investigationPriority 1 with a matching reason; do not put a fully answered H1 first or invent a repeated H1 question. Give concise whyInvestigateFirst, neededEvidence and potentialImpact. claimCoverage:{claim,sourceIds,assessment,missingLink,conclusion} assesses ONLY the CURRENT plan proposition against SELECTED literal quotes. For a completed same-period figure comparison or read FCF composition, use direct, verdict supported, missingLink empty; do not import missing causal explanations or independent payment detail into that descriptive check. Keep profit-to-cash causes under the plan check that actually asks those causes; put independent payment detail in the actual gap, without downgrading already-read FCF construction. direct requires full coverage and no missingLink; partial/insufficient require a concrete missing link and explicitly bounded conclusion. Synchronise hypothesisResults with that conclusion, never preserve an old meaning under a reused H ID. nextQuestions has 0..3 distinct, useful questions, with hypothesisId, question, whyImportant, neededEvidence and why; if present, first corresponds to priority 1. No current-question repeat or pointless paraphrase. No new feasible path means an empty list and nextCheck stating the actual limit or a different executable action. Do not auto-send suggestions. Each gap/step/explanation uses whyThisMatters:{why}; optional supported binary outcomes are allowed only for a genuinely testable claim.`;
export const correctnessInstruction = `Answer the CURRENT question directly, not the previous question. Previous model answers are context, never evidence. Narrow note/FX/tax information requests may have 1..3 scoped issues, without inventing broad operating explanations. Use read totals and deterministic calculations; keep only missing detail as unknown. Do not delete financial numbers to evade the task. Financial comparisons require the SAME period, metric definition, units and scope: Q2 revenue and H1 cash flow cannot be called synchronous; both growing does not mean equal growth rates. Preserve exact raw quotations separately from calculations. Inspect ALL visible fields: summary, impacts, priority, potentialImpact, why, conditional branches, unknowns and suggestions. Unchanged policy alone proves neither amortisation cause nor temporary pressure. Noncash or unrealised FX proves neither one-off occurrence nor stable future core profits. A scoped absence of announcements cannot exclude all company events. Not obtaining a split does not reject an operating hypothesis. Use one why statement for open information requests; do not force artificial binary conclusions. Preserve read facts, arithmetic and genuinely missing scope. If a detail was not obtained from the inspected sources, say '本轮已读资料中尚未取得' or name the inspected pages; never upgrade this to issuer-wide '未披露'. Apply that scope to gaps, confidence reasons, suggestions and coverage conclusions as well as the main answer. A calculable difference between actual and issuer-adjusted FCF is known arithmetic; independent payment details can still be missing.`;

const impacts = ["NO_CONFIRMED_IMPACT", "SUPPORTS_EXISTING_VIEW", "CHALLENGES_EXISTING_VIEW", "REQUIRES_FURTHER_REVIEW"];
const reasons = ["NOT_CONFIGURED", "SOURCE_UNAVAILABLE", "NOT_DISCLOSED_IN_READ_SCOPE", "NOT_CHECKED", "OWNER_INPUT_REQUIRED", "INCONCLUSIVE_AFTER_CHECK"];
// Hedging and exchange-rate stability do not establish cash/noncash settlement.
// Inspect generated prose only; original quotations remain untouched.
export function rejectUnsupportedCashInference(value: unknown): void {
  if (typeof value === "string") {
    for (const sentence of value.split(/[。；;\n]/)) {
      if (/(?:风险管理|对冲|无类似.*波动|无显著.*波动)/.test(sentence)
        && /(?:支持|证明|说明|意味着|确定|因此)[^。；;]{0,45}非现金/.test(sentence)
        && !/不能|无法|不足以|不代表|不能仅凭/.test(sentence)) throw new Error("RISK_MANAGEMENT_DOES_NOT_ESTABLISH_NONCASH_SETTLEMENT");
    }
  } else if (Array.isArray(value)) value.forEach(rejectUnsupportedCashInference);
  else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
    if (key !== "quote") rejectUnsupportedCashInference(child);
  }
}
const banned = /买入|卖出|加仓|减仓|目标价|仓位建议|Conviction|ROOT_CAUSE_UNCONFIRMED|\bUNKNOWN\b|继续关注|持续跟踪/;
function prose(value: unknown, min = 5, max = 500, field = "text"): string {
  if (typeof value !== "string") throw new Error(`REASONING_TEXT_REQUIRED_${field}`);
  if (value.trim().length < min || value.length > max) throw new Error(`REASONING_TEXT_LENGTH_${field}_expected_${min}_to_${max}_actual_${value.length}`);
  const policyText = value.replace(/(?:不提供|不推算|不估算|不生成|无法估算|无法给出|不能估算|不能给出|未推算|未估算)(?:任何|具体)?目标价(?:格)?/g, "");
  if (/(?:建议|应该|应当|可以|可考虑|值得)[^。；;]{0,40}(?:买入|卖出|加仓|减仓)(?!资金|成交额|金额|流量|占比)/.test(value)) throw new Error(`REASONING_INVESTMENT_ADVICE_${field}`);
  const factualFlow = policyText.replace(/(?:主动|净)(?:买入|卖出)|(?:买入|卖出)(?=资金|成交额|金额|流量|占比)/g, "资金流动");
  if (banned.test(factualFlow)) throw new Error(`REASONING_FORBIDDEN_TEXT_${field}_remove_literal_${banned.exec(factualFlow)?.[0]}`);
  const implication = /(?:非现金|未实现)[^。；;]{0,100}?(?:属于?|确定为|证明为|就是|意味着(?:是)?)一次性/.exec(value);
  const context = implication ? value.slice(Math.max(0, implication.index - 12), implication.index + implication[0].length) : "";
  if (implication && !/能否|是否|不能|无法|不等于|不代表|未必/.test(context)) throw new Error(`REASONING_NONCASH_NOT_ONE_OFF_${field}`);
  return value;
}
function qualitative(value: unknown, field: string, basis: Basis[] = [], evidence?: InvestigationEvidence, max = 500): string {
  const text = prose(value, 5, max, field);
  const quotes = basis.map(b => b.quote.replace(/(?<=\d),(?=\d)/g, ""));
  const financial = evidence ? financialNumberEvidence(evidence, basis) : { forms: [], amounts: [], selectedFacts: [], selectedCalculations: [], selectedProviderFacts: [] };
  const comparisonErrors = evidence ? financialComparisonCitationErrors(text, evidence, financial.selectedFacts) : [];
  if (comparisonErrors.length) throw new Error(`REASONING_${field}_${comparisonErrors.join(";")}`);
  const currency = [...financial.amounts, ...(evidence ? quotedCurrencyAmounts(basis, evidence) : [])];
  const taxBenefits = /递延税/.test(text) ? financial.selectedFacts.filter(f => f.metric === "deferred_tax" && f.value < 0)
    .map(f => ({ currency: f.currency, value: -f.value * f.unitScale })) : [];
  const fxGains = /汇兑/.test(text) ? financial.selectedFacts.filter(f => f.metric === "net_fx_loss_gain" && f.value < 0)
    .map(f => ({ currency: f.currency, value: -f.value * f.unitScale })) : [];
  const equity = evidence && /少数股东权益/.test(text) ? quotedNciEquityAmounts(basis, evidence) : [];
  const quantities = evidence ? quotedQuantities(basis, evidence) : [];
  // A quantity elsewhere in a paragraph must not turn a cited selling price
  // into a vehicle count. Keep each unit-bearing assertion in its own clause.
  const clauses = checkedPageReferences(text, field, evidence).replace(/(HK\$|RMB|US\$|USD)\s*(-?[\d,]+(?:\.\d+)?)\s*(十亿|百万|亿|万|千)(?:元)?/g,
    (_match, currency: string, amount: string, scale: string) => `${amount}${scale}${currency === "HK$" ? "港元" : currency === "RMB" ? "元" : "美元"}`)
    .replace(/(?<=\d),(?=\d)/g, "").split(/[。；;\n]/)
    .flatMap(sentence => sentence.split(/[，,]/).map((clause, index, group) => ({ clause, previous: group[index - 1] ?? "", sentence })));
  const unmatched = clauses.flatMap(({ clause, previous, sentence }) => numericalAssertions(clause).filter(n => {
    const quantity = new RegExp(n.replace(".", "\\.") + "\\s*(?:亿|万|千)?(?:股|辆)").test(clause);
    if (quantity) return !quantityAssertionMatches(clause, n, quantities);
    const money = new RegExp(n.replace(".", "\\.") + "\\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元)").test(clause);
    if (money) {
      const benefit = new RegExp("(?:收益|贷方|贷记|贷项)\\s*" + n.replace(".", "\\.") + "(?:\\D|$)").test(clause) ? taxBenefits : [];
      const fxGain = new RegExp("(?:净(?:汇兑)?收益|净盈利)\\s*(?:约|为)?\\s*" + n.replace(".", "\\.") + "(?:\\D|$)").test(clause) ? fxGains : [];
      const dragRole = new RegExp(n.replace(".", "\\.") + "\\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元)\\s*(?:的)?(?:算术拖累|负贡献)").test(clause);
      const fxDrag = dragRole && /(?:净汇兑|汇兑)[^。；;]{0,160}(?:算术拖累|负贡献)/.test(sentence)
        ? (financial.selectedCalculations ?? []).filter(c => c.metric === "net_fx_loss_gain_profit_contribution" && c.value < 0)
          .map(c => ({ currency: c.currency, value: -c.value * c.unitScale })) : [];
      const datedEquity = equity.filter(a => new RegExp(a.year + "年6月30日").test(clause));
      const comparativeLoss = /衍生(?:金融)?工具[^，；;。]{0,30}(?:亏损|损失)(?:约|为)?\s*\d+(?:\.\d+)?\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元)\s*$/.test(previous)
        && /^\s*(?:上年同期|上期|去年同期)(?:约|为)?\s*\d+(?:\.\d+)?\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元)\s*$/.test(clause);
      if (comparativeLoss) return !currencyAssertionMatches(clause, n, derivativePriorLossAmounts(previous, financial.selectedFacts), true);
      const derivativeLossChange = derivativeLossChangeMatches(clause, previous, n, financial.selectedFacts);
      if (derivativeLossChange !== null) return !derivativeLossChange;
      const parentheticDerivativePrior = derivativeParentheticPriorAmounts(clause, n, financial.selectedFacts);
      if (parentheticDerivativePrior !== null) return !currencyAssertionMatches(clause, n, parentheticDerivativePrior, true);
      const datedFxTransition = fxDatedTransitionMatches(clause, n, financial.selectedFacts);
      if (datedFxTransition !== null) return !datedFxTransition;
      const comparativeFxPrior = fxComparativePriorAmounts(clause, n, financial.selectedFacts);
      if (comparativeFxPrior !== null) return !currencyAssertionMatches(clause, n, comparativeFxPrior);
      const datedFxPrior = fxDatedPriorClaimMatches(clause, n, financial.selectedFacts);
      if (datedFxPrior !== null) return !datedFxPrior;
      const cashEffectChange = selectedCashFlowEffectChangeMatches(clause, sentence, n,
        financial.selectedFacts, financial.selectedCalculations);
      if (cashEffectChange !== null) return !cashEffectChange;
      const cashEffectDifference = selectedCashFlowEffectDifferenceMatches(clause, sentence, n,
        financial.selectedFacts, financial.selectedCalculations);
      if (cashEffectDifference !== null) return !cashEffectDifference;
      const occupationChange = cashOccupationChangeMatches(clause, sentence, n,
        text, financial.selectedFacts, financial.selectedCalculations);
      if (occupationChange !== null) return !occupationChange;
      const workingCapital = workingCapitalAssetMovementMatches(clause, previous, n, financial.selectedFacts, text);
      if (workingCapital !== null) return !workingCapital;
      const cashEffect = selectedCashFlowEffectRoleMatches(clause, previous, sentence, n, financial.selectedFacts);
      if (cashEffect !== null) return !cashEffect;
      return !currencyAssertionMatches(clause, n, currency.concat(benefit, fxGain, fxDrag, datedEquity));
    }
    const volume = /出口销量|海外销量|单车销量|新能源出口/.test(clause);
    return !(quantityAssertionMatches(clause, n, quantities) || currencyAssertionMatches(clause, n, currency)
      || (!volume && financial.forms.some(value => Number(value) === Number(n)))
      || quotes.some(q => q.match(/\d+(?:\.\d+)?/g)?.some(value => Number(value) === Number(n))
        && (!volume || /export|overseas|sales volume|销量|出口.*辆/i.test(q))));
  }));
  if (unmatched.length) throw new Error(`REASONING_QUALITATIVE_ONLY_${field}_unmatched_numeric_or_volume_role_${unmatched.join(",")}_select_the_original_metric_and_period_row_or_calculation_operands_in_basis; do_not_remove_known_facts_or_reuse_an_unrelated_quote${evidence ? "; named_period_original_rows=" + JSON.stringify(financialCitationRepairHints(text, evidence)) : ""}`);
  return text;
}

// Reader prose is subject to the same literal-source, period, currency and
// inference boundaries as the structured assessment. It is not an unchecked
// presentation string, nor a rewrite performed by the client.
export function validateReportText(value: unknown, basis: Basis[], evidence: InvestigationEvidence,
  field: string, max = 800, quoteLimit = INVESTIGATION_MAX_BASIS_QUOTES): string {
  const selected = citations(basis, evidence, true, field, quoteLimit);
  const text = qualitative(value, field, selected, evidence, max);
  validateReportPeriods(text, selected, evidence, field);
  return text;
}

function periodCurrencyCandidate(clause: string, number: string,
  value: { unit: string; metric: string; value: number; unitScale: number; currency: string }): boolean {
  if (value.unit !== "currency") return false;
  if (currencyAssertionMatches(clause, number, [{ currency: value.currency, value: value.value * value.unitScale }])) return true;
  // A larger occupation is a negative cash-flow-effect change, but its
  // stated magnitude is positive. Keep this limited to selected component
  // change calculations; the total operating-cash-flow row cannot fill it.
  if (value.metric.endsWith("_cash_flow_effect_change") && value.value < 0
    && /占用(?:同比|较上年同期)?(?:扩大|增加)/.test(clause))
    return currencyAssertionMatches(clause, number,
      [{ currency: value.currency, value: Math.abs(value.value * value.unitScale) }]);
  return value.metric === "net_fx_loss_gain" && value.value < 0 && /净汇兑(?:收益|盈利)/.test(clause)
    && currencyAssertionMatches(clause, number, [{ currency: value.currency, value: -value.value * value.unitScale }]);
}

type ReportPeriodFrame = { year: number; type: string; quarter?: number };
type SelectedCalculation = ReturnType<typeof financialNumberEvidence>["selectedCalculations"][number];
function comparableRatioOperands(old: SelectedCalculation, now: SelectedCalculation, selectedFacts: ReadFinancialFact[]): boolean {
  if (old.operandIds.length !== now.operandIds.length || !old.operandIds.length) return false;
  const byId = new Map(selectedFacts.map(fact => [fact.id, fact]));
  return old.operandIds.every((id, index) => {
    const prior = byId.get(id), current = byId.get(now.operandIds[index]!);
    return !!prior && !!current && prior.metric === current.metric && prior.currency === current.currency
      && prior.unitScale === current.unitScale && prior.accountingScope === current.accountingScope
      && prior.businessScope === current.businessScope && prior.measurementBasis === current.measurementBasis
      && prior.period.type === current.period.type
      && prior.period.start.slice(4) === current.period.start.slice(4)
      && prior.period.end.slice(4) === current.period.end.slice(4)
      && prior.source.sourceId === current.source.sourceId
      && prior.source.contentSha256 === current.source.contentSha256;
  });
}
function ratioTransitionPeriods(clause: string, frame: ReportPeriodFrame, selected: SelectedCalculation[],
  selectedFacts: ReadFinancialFact[]): Map<number, ReportPeriodFrame> {
  const ratios = [...clause.matchAll(/(\d+(?:\.\d+)?)\s*(%|％|个?百分点)/g)];
  if (ratios.length !== 2) return new Map();
  const unit = (ratio: RegExpMatchArray) => ratio[2]!.includes("百分点") ? "percentage_points" : "percent";
  if (unit(ratios[0]!) !== unit(ratios[1]!)) return new Map();
  const connector = clause.slice(ratios[0]!.index! + ratios[0]![0].length, ratios[1]!.index!);
  const decrease = /降|减|跌|收窄|缩小/.test(connector), increase = /升|增|涨|提高|扩大/.test(connector);
  if (decrease === increase) return new Map();
  const number = (ratio: RegExpMatchArray) => Number(ratio[1]);
  const matches = (calc: SelectedCalculation, ratio: RegExpMatchArray) => calc.unit === unit(ratio)
    && Number(Math.abs(calc.value).toFixed(ratio[1]!.split(".")[1]?.length ?? 0)) === number(ratio);
  const prior = selected.filter(calc => matches(calc, ratios[0]!) && calc.period.type === frame.type
    && Number(calc.period.end.slice(0, 4)) === frame.year - 1);
  const current = selected.filter(calc => matches(calc, ratios[1]!) && calc.period.type === frame.type
    && Number(calc.period.end.slice(0, 4)) === frame.year
    && (!frame.quarter || Number(calc.period.end.slice(5, 7)) === frame.quarter * 3));
  const preceding = clause.slice(0, ratios[0]!.index!);
  const namedMetric = preceding.slice(0, preceding.lastIndexOf("率") + 1);
  const ratioName = (calc: SelectedCalculation) => calc.metric === "gross_margin" ? "毛利率"
    : calc.metric === "effective_tax_rate" ? "实际税率" : calc.label;
  const bound = prior.some(old => current.some(now => old.metric === now.metric
    && namedMetric.endsWith(ratioName(old))
    && old.period.start.slice(4) === now.period.start.slice(4)
    && old.period.end.slice(4) === now.period.end.slice(4)
    && comparableRatioOperands(old, now, selectedFacts)
    && Math.sign(now.value - old.value) === (increase ? 1 : -1)));
  return bound ? new Map([[ratios[0]!.index!, { ...frame, year: frame.year - 1 }], [ratios[1]!.index!, frame]]) : new Map();
}
function clauseAmountPeriod(frame: ReportPeriodFrame, active: ReportPeriodFrame, pendingPrior: boolean, clause: string): ReportPeriodFrame {
  const dated = /^(?:较|比|相比于|对比|而)?\s*(20\d{2})年同期/.exec(clause.trim());
  return dated ? { ...frame, year: Number(dated[1]) } : pendingPrior ? { ...frame, year: frame.year - 1 } : active;
}
function comparedAmountPeriod(frame: ReportPeriodFrame, current: ReportPeriodFrame, seenEarlierAmount: boolean, prefix: string): ReportPeriodFrame {
  const change = /(?:增加|减少|增长|下降|扩大|收窄|变动|节省|差额)(?:约|了|为)?\s*[+−-]?\s*$/.test(prefix);
  const explicitComparison = /^(?:较|比|相比于|对比)\s*(20\d{2})年同期/.exec(prefix.trim());
  const validComparison = explicitComparison && Number(explicitComparison[1]) === frame.year - 1;
  return change && (seenEarlierAmount || validComparison) ? frame : current;
}

function validateReportPeriods(text: string, basis: Basis[], evidence: InvestigationEvidence, field: string) {
  const read = financialNumberEvidence(evidence, basis);
  if (read.selectedProviderFacts.length && hasFinancialNumericalAssertion(text)
    && !/20\d{2}(?:年)?\s*(?:上半年|同期|H1|全年|年度|Q[1-4]|第[一二三四1-4]季度)/i.test(text))
    throw new Error(`REASONING_REPORT_PROVIDER_PERIOD_REQUIRED_${field}`);
  const values = [...read.selectedFacts.map(f => ({ ...f, unit: "currency" })), ...read.selectedCalculations,
    ...read.selectedProviderFacts];
  let frame: ReportPeriodFrame | undefined;
  let standaloneSamePeriod: ReportPeriodFrame | undefined;
  let pendingPrior = false;
  const periodPattern = "20\\d{2}(?:年)?\\s*(?:上半年|同期|H1|全年|年度|Q[1-4]|第[一二三四1-4]季度)";
  // Split at a new explicit frame as well as sentence boundaries. Keep
  // "毛利率由上年同期的...降至..." together so both ratio operands retain
  // their named metric and can be bound to comparable original rows.
  const clauses = text.replace(/(?<=\d),(?=\d)/g, "").replace(/[。；;\n]/g, "$&\u0002")
    .split(new RegExp(`(?=${periodPattern})|(?<!率[由从])(?=上年同期|去年同期)|[，,。；;\\n]`, "i"));
  const matches = (period: ReadFinancialFact["period"], current: ReportPeriodFrame) => period.end.startsWith(String(current.year))
    && period.type === current.type && (!current.quarter || Number(period.end.slice(5, 7)) === current.quarter * 3);
  for (const [index, rawClause] of clauses.entries()) {
    if (rawClause.startsWith("\u0002")) standaloneSamePeriod = undefined;
    const clause = rawClause.replace(/^\u0002+/, "");
    const explicit = clause.match(/(20\d{2})(?:年)?\s*(上半年|同期|H1|全年|年度|Q([1-4])|第([一二三四1-4])季度)/i);
    const comparative = !!explicit && /(?:较|相比于|对比|比)\s*$/.test(clauses[index - 1] ?? "");
    let active = standaloneSamePeriod ?? frame;
    if (explicit) {
      if (/未取得|未读取|尚缺|缺少|待核/.test(clause) && !hasFinancialNumericalAssertion(clause)) continue;
      const quarter = Number(explicit[3]) || ({ 一: 1, 二: 2, 三: 3, 四: 4 } as Record<string, number>)[explicit[4] ?? ""] || Number(explicit[4]) || undefined;
      const matchingTypes = [...new Set(values.filter(v => v.period.end.startsWith(explicit[1]!)).map(v => v.period.type))];
      const declared = { year: Number(explicit[1]), type: explicit[2] === "同期" ? frame?.type ?? (matchingTypes.length === 1 ? matchingTypes[0]! : "unresolved")
        : /上半年|H1/i.test(explicit[2]!) ? "interim" : quarter ? "quarter" : "annual", quarter };
      if (!comparative && (explicit[2] !== "同期" || !frame)) frame = declared;
      // A standalone dated 同期 can govern an undated continuation within
      // this sentence. A comparison names only its operand's period.
      standaloneSamePeriod = !comparative && explicit[2] === "同期"
        && frame?.year !== declared.year ? declared : undefined;
      active = comparative && /增加|减少|增长|下降|差额|变动|节省/.test(clause) ? frame : declared;
      pendingPrior = false;
      if (values.length && !values.some(v => matches(v.period, declared))) throw new Error(`REASONING_REPORT_PERIOD_NOT_IN_SELECTED_ORIGINAL_${field}_${explicit[0]}`);
    }
    if (!active || !frame) continue;
    const primaryFrame = frame;
    const priorAmount = /^(?:上年同期|去年同期)/.test(clause.trim()) && !/^(?:上年同期|去年同期)(?:相比|比较|增加|减少|增长|下降)/.test(clause.trim());
    if (priorAmount) pendingPrior = true;
    const comparisonPrefix = comparative ? clauses[index - 1] ?? "" : "";
    const current = clauseAmountPeriod(frame, active, pendingPrior, comparisonPrefix + clause);
    const carried = standaloneSamePeriod;
    const assertionStart = clause.search(/\d+(?:\.\d+)?\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元|%|％|个?百分点)/);
    const changeLead = assertionStart < 0 ? clause : clause.slice(0, assertionStart);
    const statesChange = !!carried && comparedAmountPeriod(frame, carried, true, changeLead).year === frame.year;
    const selectedCrossPeriodResult = (calc: SelectedCalculation, prior: ReportPeriodFrame) => matches(calc.period, primaryFrame)
      && calc.operandIds.some(id => read.selectedFacts.some(f => f.id === id && matches(f.period, prior)))
      && calc.operandIds.some(id => read.selectedFacts.some(f => f.id === id && matches(f.period, primaryFrame)));
    let seenPriorAmount = false;
    for (const amount of clause.matchAll(/\d+(?:\.\d+)?\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元)/g)) {
      const number = amount[0].match(/\d+(?:\.\d+)?/)![0];
      const candidates = values.filter(v => periodCurrencyCandidate(clause, number, v));
      const providerCandidates = read.selectedProviderFacts.filter(v => periodCurrencyCandidate(clause, number, v));
      if (providerCandidates.length) {
        const prefix = clause.slice(0, amount.index);
        const exactName = Object.entries(providerMetricTitles)
          .filter(([,title]) => prefix.includes(title))
          .sort((a,b) => prefix.lastIndexOf(b[1]) - prefix.lastIndexOf(a[1]))[0]?.[0];
        // The existing revenue checks recognize 收入/营收. Here the short name
        // must be the assertion's own subject, not part of 其他/投资/利息收入.
        const named = exactName ?? (
          /(?:^|上半年|全年|年度|H1|公司|集团|[，,])\s*(?:营业收入|营收|收入)\s*(?:为|约为|约|达|达到|：)?\s*$/i.test(prefix)
            ? "revenue" : undefined);
        if (!named || !providerCandidates.some(v => v.metric === named))
          throw new Error(`REASONING_REPORT_PROVIDER_METRIC_MISMATCH_${field}_${amount[0]}`);
      }
      const prefix = comparisonPrefix + clause.slice(0, amount.index);
      const occupationTransition = /(存货|应收账款)(?:变动)?占用从/.test(clause)
        && /(?:增至|增加至|升至|减少至|降至)/.test(clause);
      let amountPeriod = occupationTransition ? { ...frame, year: seenPriorAmount ? frame.year : frame.year - 1 }
        : seenPriorAmount && current.year === frame.year - 1 && /转为(?:流入|流出|回笼|占用|收益|盈利|亏损|损失)?\s*$/.test(prefix)
          ? frame : comparedAmountPeriod(frame, current, seenPriorAmount, prefix);
      const currentCrossPeriodResult = carried && read.selectedCalculations.some(calc => candidates.includes(calc)
        && selectedCrossPeriodResult(calc, carried)
        && (statesChange || (calc.metric.endsWith("_profit_contribution") && /(?:贡献|抵消|拖累)/.test(clause))));
      if (!explicit && carried && !pendingPrior && currentCrossPeriodResult
        && !candidates.some(v => matches(v.period, amountPeriod))) amountPeriod = primaryFrame;
      // Literal management-note amounts not in the table catalogue still use
      // the existing quote checks; do not pretend they have extracted periods.
      if (candidates.length && !candidates.some(v => matches(v.period, amountPeriod))) throw new Error(`REASONING_REPORT_AMOUNT_PERIOD_MISMATCH_${field}_${amountPeriod.year}_${amount[0]}`);
      seenPriorAmount = true;
    }
    const pairedRatioPeriods = !explicit ? ratioTransitionPeriods(clause, frame, read.selectedCalculations, read.selectedFacts)
      : new Map<number, ReportPeriodFrame>();
    for (const ratio of clause.matchAll(/(\d+(?:\.\d+)?)\s*(%|％|个?百分点)/g)) {
      const decimals = ratio[1]!.split(".")[1]?.length ?? 0;
      const candidates = read.selectedCalculations.filter(c => c.unit !== "currency"
        && Number(Math.abs(c.value).toFixed(decimals)) === Number(ratio[1]));
      // A clause such as “较2025年同期增长2.02%” names the comparison
      // operand's year, while the growth result belongs to the 2026 frame.
      // Preserve the prior year for a literal 2025 ratio or a wrong-year claim.
      const ratioPrefix = comparisonPrefix + clause.slice(0, ratio.index);
      const currentRatioChange = carried && statesChange && candidates.some(calc => selectedCrossPeriodResult(calc, carried));
      const ratioPeriod = pairedRatioPeriods.get(ratio.index!)
        ?? comparedAmountPeriod(frame, !explicit && currentRatioChange ? frame : current, false, ratioPrefix);
      const dated = candidates.filter(c => matches(c.period, ratioPeriod));
      if (candidates.length && !dated.length) throw new Error(`REASONING_REPORT_RATIO_PERIOD_MISMATCH_${field}_${ratioPeriod.year}_${ratio[0]}`);
      const unit = ratio[2]!.includes("百分点") ? "percentage_points" : "percent";
      const scoped = dated.filter(c => c.unit === unit);
      if (dated.length && !scoped.length) throw new Error(`REASONING_REPORT_RATIO_UNIT_MISMATCH_${field}_${ratio[0]}`);
      const prefix = clause.slice(0, ratio.index).trim();
      const direction = /(?:下降|减少|降低|降幅|[-−])(?:约|了|为)?$/.test(prefix) ? -1 : /(?:增长|增加|上升|提高)(?:约|了|为)?$/.test(prefix) ? 1 : 0;
      if (direction && scoped.length && !scoped.some(c => Math.sign(c.value) === direction)) throw new Error(`REASONING_REPORT_RATIO_DIRECTION_MISMATCH_${field}_${ratio[0]}`);
    }
    if (/\d+(?:\.\d+)?\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元|%|％|百分点)/.test(clause)) pendingPrior = false;
  }
}
function currencyAssertionMatches(text: string, number: string, amounts: Array<{ currency: string; value: number }>, comparativeLoss = false): boolean {
  const pattern = new RegExp("(?:^|[^\\d.])" + number.replace(".", "\\.") + "\\s*(十亿|百万|亿|万|千)?(港元|美元|元)", "g");
  const decimals = number.split(".")[1]?.length ?? 0;
  return [...text.matchAll(pattern)].some(m => {
    const unit = ({ 十亿: 1e9, 百万: 1e6, 亿: 1e8, 万: 1e4, 千: 1000 } as Record<string, number>)[m[1] ?? ""] ?? 1;
    const currency = m[2] === "港元" ? "HKD" : m[2] === "美元" ? "USD" : "CNY";
    const prefix = text.slice(0, m.index! + m[0].indexOf(number));
    const negative = /(?:负|[-−])$/.test(prefix);
    const reduction = /(?:转回|减少|同比减|下降|亏损|损失|税项收益|税项抵免)[^\d，。；]{0,5}$/.test(prefix);
    // Chinese may place the loss role immediately after its own currency
    // amount. Do not inherit a loss from a later number or another clause.
    const lossSuffix = /^\s*(?:(?:集团)?净汇兑|净)?(?:亏损|损失)/.test(text.slice(m.index! + m[0].length));
    const pairedLoss = /(?:净亏损|亏损|损失)(?:金额)?(?:由|从)\s*\d+(?:\.\d+)?\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元)\s*(?:扩大|增加|上升|减少|下降|收窄|缩小)(?:至|到)\s*$/.test(prefix);
    return amounts.some(amount => amount.currency === currency
      && (parentheticCurrencyRestatement(prefix, text.slice(m.index! + m[0].length), amount)
        ?? (negative ? amount.value < 0 : amount.value >= 0 || reduction || lossSuffix || pairedLoss || comparativeLoss))
      && Number((Math.abs(amount.value) / unit).toFixed(decimals)) === Number(number));
  });
}

// A page is an identifier only when it belongs to this actual read scope.
function checkedPageReferences(text: string, field: string, evidence?: InvestigationEvidence): string {
  return text.replace(/第\s*(\d+)\s*页/g, (label, page: string) => {
    if (!evidence?.sources.some(s => s.symbol === evidence.symbol && s.readStatus === "BODY_READ" && s.pageNumber === Number(page))) {
      throw new Error(`REASONING_PAGE_NOT_READ_${field}_${label}`);
    }
    return "已读页";
  });
}

// Only an immediately parenthesised restatement may inherit its own amount's
// loss role. Both amounts must match the SAME cited monetary value and currency.
function parentheticCurrencyRestatement(prefix: string, suffix: string, amount: { currency: string; value: number }): boolean | null {
  if (!/^\s*[）)]/.test(suffix)) return null;
  const parent = /(\d+(?:\.\d+)?)\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元)\s*[（(]\s*$/.exec(prefix);
  if (!parent) return null;
  return currencyAssertionMatches(prefix.replace(/[（(]\s*$/, ""), parent[1]!, [amount]);
}

function derivativePriorLossAmounts(previous: string, facts: ReadFinancialFact[]) {
  // Inherit only the inspected derivative-loss row's same-period prior-year
  // column. A real current-year amount or another metric must not fill it.
  if (!/衍生(?:金融)?工具/.test(previous)) return [];
  const current = facts.filter(f => f.metric === "derivative_financial_gain_loss" && f.value < 0
    && numericalAssertions(previous).some(n => currencyAssertionMatches(previous, n, [{ currency: f.currency, value: f.value * f.unitScale }])));
  return facts.filter(f => f.value < 0 && current.some(c => f.metric === c.metric && f.currency === c.currency
    && f.unitScale === c.unitScale && f.accountingScope === c.accountingScope && f.businessScope === c.businessScope
    && f.measurementBasis === c.measurementBasis && f.source.sourceId === c.source.sourceId && f.period.type === c.period.type
    && Number(f.period.start.slice(0, 4)) === Number(c.period.start.slice(0, 4)) - 1
    && f.period.start.slice(4) === c.period.start.slice(4) && f.period.end.slice(4) === c.period.end.slice(4)))
    .map(f => ({ currency: f.currency, value: f.value * f.unitScale }));
}
function derivativeParentheticPriorAmounts(clause: string, number: string, facts: ReadFinancialFact[]) {
  // The parenthesis inherits only its immediately named derivative loss.
  // Both amounts still bind to the same inspected row and annual columns.
  const pair = /(衍生(?:金融)?工具(?:净)?(?:亏损|损失)(?:约|为)?\s*\d+(?:\.\d+)?\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元))\s*[（(](?:上年同期|上期|去年同期)(?:约|为)?\s*(\d+(?:\.\d+)?)\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元)[）)]/.exec(clause);
  if (!pair || Number(pair[2]) !== Number(number)) return null;
  return derivativePriorLossAmounts(pair[1]!, facts);
}
function derivativeLossChangeMatches(clause: string, previous: string, number: string, facts: ReadFinancialFact[]): boolean | null {
  const change = /同比(增加|扩大|上升|减少|下降|收窄|缩小)\s*(\d+(?:\.\d+)?)\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元)/.exec(clause);
  if (!change || Number(change[2]) !== Number(number)) return null;
  const ownContext = clause.slice(0, change.index).trim();
  const context = /^(?:亏损|损失)(?:额|金额)?$/.test(ownContext) ? previous : ownContext || previous;
  const loss = /衍生(?:金融)?工具(?:净)?(?:亏损|损失)/.exec(context);
  if (!loss || context.lastIndexOf("净损益") > loss.index || context.lastIndexOf("利润贡献") > loss.index) return null;
  const candidates = facts.filter(f => f.metric === "derivative_financial_gain_loss" && f.value < 0
    && numericalAssertions(context).some(n => currencyAssertionMatches(context, n, [{ currency: f.currency, value: f.value * f.unitScale }])));
  const latest = Math.max(...candidates.map(f => Number(f.period.end.slice(0, 4))));
  const current = candidates.filter(f => Number(f.period.end.slice(0, 4)) === latest);
  const prior = derivativePriorLossAmounts(context, facts);
  if (current.length !== 1 || prior.length !== 1 || current[0]!.currency !== prior[0]!.currency) return null;
  const changeInLoss = Math.abs(current[0]!.value * current[0]!.unitScale) - Math.abs(prior[0]!.value);
  // Positive loss amounts increase when the signed negative P&L row falls.
  if (!(changeInLoss > 0 ? /增加|扩大|上升/ : /减少|下降|收窄|缩小/).test(change[1]!)) return false;
  return currencyAssertionMatches(clause, number, [{ currency: current[0]!.currency, value: Math.abs(changeInLoss) }]);
}
function selectedCashFlowEffectChangeMatches(clause: string, sentence: string, number: string,
  facts: ReadFinancialFact[], calculations: SelectedCalculation[]): boolean | null {
  const amount = "(\\d+(?:\\.\\d+)?\\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元))";
  const asset = new RegExp(`(存货|应收账款)(?:变动)?占用(增加|减少)(?:约)?\\s*${amount}`).exec(clause);
  const payable = new RegExp(`(应付账款(?:及票据)?|应付票据)现金流出(增加|减少)(?:约)?\\s*${amount}`).exec(clause);
  const claim = asset ?? payable;
  if (!claim || Number(claim[3]!.match(/\d+(?:\.\d+)?/)![0]) !== Number(number)) return null;
  const metric = asset ? asset[1] === "存货" ? "inventory_cash_flow_effect" : "trade_receivables_cash_flow_effect"
    : "trade_bills_payables_cash_flow_effect";
  const expectedSign = claim[2] === "增加" ? -1 : 1;
  return calculations.some(calc => {
    if (calc.metric !== `${metric}_change` || calc.unit !== "currency" || calc.period.type !== "interim"
      || calc.operandIds.length !== 2 || Math.sign(calc.value) !== expectedSign) return false;
    const current = facts.find(f => f.id === calc.operandIds[0]);
    const prior = facts.find(f => f.id === calc.operandIds[1]);
    if (!current || !prior || current.metric !== metric || prior.metric !== metric
      || current.value >= 0 || prior.value >= 0 || current.period.type !== "interim"
      || prior.period.type !== "interim" || current.period.start.slice(4) !== prior.period.start.slice(4)
      || current.period.end.slice(4) !== prior.period.end.slice(4)
      || Number(current.period.end.slice(0, 4)) !== Number(prior.period.end.slice(0, 4)) + 1
      || calc.period.start !== current.period.start || calc.period.end !== current.period.end
      || !sentence.includes(`${current.period.end.slice(0, 4)}年上半年`)
      || calc.currency !== current.currency || current.currency !== prior.currency
      || current.unitScale !== prior.unitScale || current.accountingScope !== prior.accountingScope
      || current.businessScope !== prior.businessScope || current.measurementBasis !== prior.measurementBasis
      || current.source.sourceId !== prior.source.sourceId
      || current.source.contentSha256 !== prior.source.contentSha256
      || current.source.quote !== prior.source.quote
      || current.source.periodHeader !== prior.source.periodHeader
      || current.source.unitHeader !== prior.source.unitHeader) return false;
    return currencyAssertionMatches(claim[3]!, number,
      [{ currency: calc.currency, value: Math.abs(calc.value * calc.unitScale) }]);
  });
}
function selectedCashFlowEffectRoleMatches(clause: string, previousClause: string, sentence: string, number: string,
  facts: ReadFinancialFact[]): boolean | null {
  const amounts = [...clause.matchAll(/\d+(?:\.\d+)?\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元)/g)]
    .filter(match => Number(match[0].match(/\d+(?:\.\d+)?/)![0]) === Number(number));
  if (amounts.length !== 1) return null;
  const amount = amounts[0]!;
  const clausePrefix = clause.slice(0, amount.index);
  const roles = [...clausePrefix.matchAll(/占用|流出|回款|流入|回笼/g)];
  if (!roles.length) return null;
  const prefix = sentence.slice(0, sentence.indexOf(clause) + amount.index!);
  const localSubjects = cashEffectSubjectMentions(clausePrefix);
  const inherited = !localSubjects.length && /^\s*(?:20\d{2}年(?:同期)?|上年同期|去年同期)/.test(clause)
    ? cashEffectSubjectMentions(previousClause) : [];
  const subjects = localSubjects.length ? localSubjects : inherited;
  const subject = subjects.sort((a, b) => b.index - a.index)[0];
  if (!subject) return null;
  const role = roles.at(-1)![0];
  const selected = facts.filter(f => f.metric === subject.metric);
  const periods = [...prefix.matchAll(/20\d{2}年|上年同期|去年同期/g)];
  const latest = Math.max(...selected.map(f => Number(f.period.end.slice(0, 4))));
  const named = periods.at(-1)?.[0];
  const year = named?.startsWith("20") ? Number(named.slice(0, 4)) : named ? latest - 1 : undefined;
  if (!year) return false;
  const periodType = /全年|年度/.test(prefix) ? "annual" : /上半年|H1/i.test(prefix) ? "interim"
    : /季度|Q[1-4]/i.test(prefix) ? "quarter" : undefined;
  const scoped = selected.filter(f => Number(f.period.end.slice(0, 4)) === year
    && (!periodType || f.period.type === periodType));
  if (scoped.length !== 1) return false;
  const expectedSign = /回款|流入|回笼/.test(role) ? 1 : -1;
  const own = scoped[0]!;
  return Math.sign(own.value) === expectedSign && currencyAssertionMatches(amount[0], number,
    [{ currency: own.currency, value: Math.abs(own.value) * own.unitScale }]);
}
function selectedCashFlowEffectDifferenceMatches(clause: string, sentence: string, number: string,
  facts: ReadFinancialFact[], calculations: SelectedCalculation[]): boolean | null {
  const difference = /差额(?:约|为)?\s*(\d+(?:\.\d+)?\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元))/.exec(clause);
  if (!difference || Number(difference[1]!.match(/\d+(?:\.\d+)?/)![0]) !== Number(number)) return null;
  const prefix = sentence.slice(0, sentence.indexOf(clause) + difference.index);
  const metric = cashEffectSubjectMentions(prefix).at(-1)?.metric;
  if (!metric) return null;
  const roles = [...prefix.matchAll(/回款|流入|回笼|流出|占用/g)];
  const priorRole = roles.at(-2), currentRole = roles.at(-1);
  if (!priorRole || !currentRole || !prefix.slice(priorRole.index, currentRole.index).includes("转为")) return false;
  const sign = (role: string) => /回款|流入|回笼/.test(role) ? 1 : -1;
  const currentYear = Number(sentence.match(/(20\d{2})年上半年/)?.[1]);
  if (!Number.isInteger(currentYear) || currentYear < 2000) return false;
  return calculations.some(calc => {
    if (calc.metric !== `${metric}_change` || calc.unit !== "currency" || calc.period.type !== "interim"
      || calc.operandIds.length !== 2 || Math.sign(calc.value) !== sign(currentRole[0])) return false;
    const current = facts.find(f => f.id === calc.operandIds[0]);
    const prior = facts.find(f => f.id === calc.operandIds[1]);
    if (!current || !prior || current.metric !== metric || prior.metric !== metric
      || current.period.type !== "interim" || prior.period.type !== "interim"
      || current.period.start !== `${currentYear}-01-01` || current.period.end !== `${currentYear}-06-30`
      || prior.period.start !== `${currentYear - 1}-01-01` || prior.period.end !== `${currentYear - 1}-06-30`
      || calc.period.start !== current.period.start || calc.period.end !== current.period.end
      || Math.sign(current.value) !== sign(currentRole[0]) || Math.sign(prior.value) !== sign(priorRole[0])
      || current.currency !== prior.currency || current.currency !== calc.currency
      || current.unitScale !== prior.unitScale || current.accountingScope !== prior.accountingScope
      || current.businessScope !== prior.businessScope || current.measurementBasis !== prior.measurementBasis
      || current.source.sourceId !== prior.source.sourceId || current.source.contentSha256 !== prior.source.contentSha256
      || current.source.quote !== prior.source.quote || current.source.periodHeader !== prior.source.periodHeader
      || current.source.unitHeader !== prior.source.unitHeader
      || Math.abs(calc.value * calc.unitScale - (current.value - prior.value) * current.unitScale) > 0.01) return false;
    return currencyAssertionMatches(difference[1]!, number,
      [{ currency: calc.currency, value: Math.abs(calc.value * calc.unitScale) }]);
  });
}
function cashOccupationChangeMatches(clause: string, sentence: string, number: string, fullText: string,
  facts: ReadFinancialFact[], calculations: SelectedCalculation[]): boolean | null {
  const change = /(?:(多|少)占用|占用(?:同比|较上年同期)?(扩大|收窄|增加|减少))(?:约)?\s*(\d+(?:\.\d+)?\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元))/.exec(clause);
  if (!change || Number(change[3]!.match(/\d+(?:\.\d+)?/)![0]) !== Number(number)) return null;
  const before = sentence.slice(0, sentence.indexOf(clause) + change.index);
  const subject = [...before.matchAll(/存货|应收账款/g)].at(-1)?.[0];
  if (!subject) return false;
  const metric = subject === "存货" ? "inventory_cash_flow_effect" : "trade_receivables_cash_flow_effect";
  const namedYears = [...sentence.matchAll(/(20\d{2})年/g)].map(match => Number(match[1]));
  const greater = change[1] === "多" || /扩大|增加/.test(change[2] ?? "");
  return calculations.some(calculation => {
    if (calculation.metric !== `${metric}_change` || calculation.unit !== "currency"
      || calculation.period.type !== "interim"
      || calculation.operandIds.length !== 2 || Math.sign(calculation.value) !== (greater ? -1 : 1)) return false;
    const current = facts.find(f => f.id === calculation.operandIds[0]);
    const prior = facts.find(f => f.id === calculation.operandIds[1]);
    const currentYear = Number(current?.period.end.slice(0, 4));
    const priorYear = Number(prior?.period.end.slice(0, 4));
    if (!current || !prior || current.metric !== metric || prior.metric !== metric
      || current.period.type !== "interim" || prior.period.type !== "interim"
      || current.value >= 0 || prior.value >= 0
      || current.currency !== prior.currency || current.currency !== calculation.currency
      || current.unitScale !== prior.unitScale || current.accountingScope !== prior.accountingScope
      || current.businessScope !== prior.businessScope || current.measurementBasis !== prior.measurementBasis
      || current.source.sourceId !== prior.source.sourceId || current.source.contentSha256 !== prior.source.contentSha256
      || current.source.quote !== prior.source.quote || current.source.periodHeader !== prior.source.periodHeader
      || current.source.unitHeader !== prior.source.unitHeader
      || current.period.start.slice(4) !== prior.period.start.slice(4)
      || current.period.end.slice(4) !== prior.period.end.slice(4)
      || calculation.period.start !== current.period.start || calculation.period.end !== current.period.end
      || Math.abs(calculation.value * calculation.unitScale - (current.value - prior.value) * current.unitScale) > 0.01
      || currentYear !== priorYear + 1
      || !fullText.includes(`${currentYear}年上半年`)
      || namedYears.some(year => year !== currentYear && year !== priorYear)) return false;
    return currencyAssertionMatches(change[3]!, number,
      [{ currency: calculation.currency, value: Math.abs(calculation.value * calculation.unitScale) }]);
  });
}
function workingCapitalAssetMovementMatches(clause: string, previousClause: string, number: string, facts: ReadFinancialFact[], fullText: string): boolean | null {
  const pairs = [...clause.matchAll(/(存货|应收账款|受限(?:及质押)?(?:银行)?存款(?:及质押存款)?)(?:变动)?(?:由|从)(?:(20\d{2})年(?:上半年|同期)|上年(?:同期)?)(?:的)?(流入|流出|回笼|占用)(?:约)?(\d+(?:\.\d+)?(?:十亿|百万|亿|万|千)?(?:港元|美元|元))转为(?:(20\d{2})年(?:上半年|同期)(?:的)?)?(流入|流出|回笼|占用)(?:约)?(\d+(?:\.\d+)?(?:十亿|百万|亿|万|千)?(?:港元|美元|元))/g)].filter(pair => [pair[4], pair[7]].some(amount => Number(amount!.match(/^\d+(?:\.\d+)?/)![0]) === Number(number)));
  if (pairs.length) return pairs.every(pair => {
    const remainder = pairs.reduce((text, match) => text.replace(match[0], ""), clause);
    if (numericalAssertions(remainder).some(n => Number(n) === Number(number))) return false;
    const metric = pair[1] === "存货" ? "inventory_cash_flow_effect" : pair[1] === "应收账款" ? "trade_receivables_cash_flow_effect" : "restricted_deposits_cash_flow_effect";
    const matches = (f: ReadFinancialFact, year: string, role: string, amount: string) => f.metric === metric
      && f.period.type === "interim" && f.period.start === `${year}-01-01` && f.period.end === `${year}-06-30`
      && (["流入", "回笼"].includes(role) ? f.value > 0 : f.value < 0)
      && currencyAssertionMatches(amount, amount.match(/^\d+(?:\.\d+)?/)![0], [{ currency: f.currency, value: Math.abs(f.value) * f.unitScale }]);
    const periods = [...new Set(facts.filter(f => f.metric === metric && f.period.type === "interim").map(f => f.period.start.slice(0, 4)))].sort();
    const priorYear = pair[2] ?? (periods.length === 2 ? periods[0] : undefined);
    const currentYear = pair[5] ?? (periods.length === 2 ? periods[1] : undefined);
    if (!priorYear || !currentYear || Number(currentYear) !== Number(priorYear) + 1) return false;
    if ((!pair[2] || !pair[5]) && !fullText.includes(`${currentYear}年上半年`)) return false;
    const prior = facts.filter(f => matches(f, priorYear, pair[3]!, pair[4]!));
    const current = facts.filter(f => matches(f, currentYear, pair[6]!, pair[7]!));
    return prior.some(p => current.some(c => p.source.sourceId === c.source.sourceId && p.source.quote === c.source.quote
      && p.source.contentSha256 === c.source.contentSha256 && p.source.periodHeader === c.source.periodHeader && p.source.unitHeader === c.source.unitHeader
      && p.currency === c.currency && p.unitScale === c.unitScale && p.accountingScope === c.accountingScope && p.businessScope === c.businessScope));
  });
  const occupied = [...clause.matchAll(/(存货|应收账款)(?:变动)?占用从(?:约)?(\d+(?:\.\d+)?(?:十亿|百万|亿|万|千)?(?:港元|美元|元))(?:增至|增加至|升至|减少至|降至)(?:约)?(\d+(?:\.\d+)?(?:十亿|百万|亿|万|千)?(?:港元|美元|元))/g)]
    .filter(pair => [pair[2], pair[3]].some(amount => Number(amount!.match(/^\d+(?:\.\d+)?/)![0]) === Number(number)));
  if (occupied.length) return occupied.every(pair => {
    const metric = pair[1] === "存货" ? "inventory_cash_flow_effect" : "trade_receivables_cash_flow_effect";
    const own = facts.filter(f => f.metric === metric && f.period.type === "interim" && f.value < 0);
    const years = [...new Set(own.map(f => Number(f.period.end.slice(0, 4))))].sort();
    if (years.length !== 2 || years[1] !== years[0]! + 1 || !fullText.includes(`${years[1]}年上半年`)) return false;
    const previous = own.filter(f => Number(f.period.end.slice(0, 4)) === years[0]);
    const current = own.filter(f => Number(f.period.end.slice(0, 4)) === years[1]);
    const matches = (f: ReadFinancialFact, amount: string) => currencyAssertionMatches(amount, amount.match(/^\d+(?:\.\d+)?/)![0],
      [{ currency: f.currency, value: Math.abs(f.value) * f.unitScale }]);
    return previous.some(p => matches(p, pair[2]!) && current.some(c => matches(c, pair[3]!)
      && p.source.sourceId === c.source.sourceId && p.source.quote === c.source.quote
      && p.source.contentSha256 === c.source.contentSha256 && p.source.periodHeader === c.source.periodHeader
      && p.source.unitHeader === c.source.unitHeader && p.currency === c.currency && p.unitScale === c.unitScale
      && p.accountingScope === c.accountingScope && p.businessScope === c.businessScope));
  });
  const extraOccupation = /^\s*多占用(?:约)?(\d+(?:\.\d+)?(?:十亿|百万|亿|万|千)?(?:港元|美元|元))/.exec(clause);
  const subject = /(存货|应收账款)(?:变动)?占用从/.exec(previousClause)?.[1];
  if (extraOccupation && subject && Number(extraOccupation[1]!.match(/^\d+(?:\.\d+)?/)![0]) === Number(number)) {
    const metric = subject === "存货" ? "inventory_cash_flow_effect" : "trade_receivables_cash_flow_effect";
    const own = facts.filter(f => f.metric === metric && f.period.type === "interim" && f.value < 0);
    const years = [...new Set(own.map(f => Number(f.period.end.slice(0, 4))))].sort();
    if (years.length !== 2 || years[1] !== years[0]! + 1 || !fullText.includes(`${years[1]}年上半年`)) return false;
    return own.some(p => Number(p.period.end.slice(0, 4)) === years[0]
      && own.some(c => Number(c.period.end.slice(0, 4)) === years[1]
        && p.source.sourceId === c.source.sourceId && p.source.quote === c.source.quote
        && p.source.contentSha256 === c.source.contentSha256 && p.currency === c.currency && p.unitScale === c.unitScale
        && c.value < p.value && currencyAssertionMatches(extraOccupation[1]!, number,
          [{ currency: c.currency, value: (Math.abs(c.value) - Math.abs(p.value)) * c.unitScale }])));
  }
  // The cash-flow statement's negative effect means an increase in this asset,
  // not a negative balance. Only the named asset's selected original may supply
  // the amount; a deposit row elsewhere in the page supplies no permission.
  const matches = [...clause.matchAll(/(存货|应收账款|受限(?:及质押)?(?:银行)?存款(?:及质押存款)?)(增加|增长|上升|减少|下降)(?:约)?(\d+(?:\.\d+)?(?:十亿|百万|亿|万|千)?(?:港元|美元|元))/g)]
    .filter(m => Number(m[3]!.match(/^\d+(?:\.\d+)?/)![0]) === Number(number));
  if (!matches.length) return null;
  const remainder = matches.reduce((text, m) => text.replace(m[0], ""), clause);
  if (numericalAssertions(remainder).some(n => Number(n) === Number(number))) return false;
  return matches.every(m => {
    const metric = m[1] === "存货" ? "inventory_cash_flow_effect" : m[1] === "应收账款" ? "trade_receivables_cash_flow_effect" : "restricted_deposits_cash_flow_effect";
    const own = facts.filter(f => f.metric === metric);
    const prefix = clause.slice(0, m.index);
    const namedPeriod = [...prefix.matchAll(/(20\d{2})年(上半年|下半年|全年|第[一二三四]季度)?/g)].at(-1);
    if (namedPeriod?.[2] && namedPeriod[2] !== "上半年") return false;
    const year = namedPeriod?.[1] ?? String(Math.max(...own.map(f => Number(f.period.end.slice(0, 4)))));
    if (/约/.test(m[0]) && !namedPeriod) {
      const selected = own.filter(f => f.period.start === `${year}-01-01` && f.period.end === `${year}-06-30`);
      const prior = own.filter(f => f.period.start === `${Number(year) - 1}-01-01` && f.period.end === `${Number(year) - 1}-06-30`);
      if (!fullText.includes(`${year}年上半年`) || selected.length !== 1 || prior.length !== 1
        || selected[0]!.source.sourceId !== prior[0]!.source.sourceId
        || selected[0]!.source.quote !== prior[0]!.source.quote
        || selected[0]!.source.contentSha256 !== prior[0]!.source.contentSha256) return false;
    }
    return own.some(f => f.period.type === "interim" && f.period.start === `${year}-01-01` && f.period.end === `${year}-06-30`
      && (/增加|增长|上升/.test(m[2]!) ? f.value < 0 : f.value > 0)
      && currencyAssertionMatches(m[3]!, number, [{ currency: f.currency, value: Math.abs(f.value) * f.unitScale }]));
  });
}
function fxDatedTransitionMatches(clause: string, number: string, facts: ReadFinancialFact[]): boolean | null {
  // Both explicit years, or an unambiguous two-column selected original. A
  // gain/loss role must bind to its own amount; never borrow another metric.
  const pairs = [...clause.matchAll(/净汇兑由(?:(20\d{2})年(?:上半年|同期))?(收益|盈利|亏损|损失)(\d+(?:\.\d+)?(?:十亿|百万|亿|万|千)?(?:港元|美元|元))转为(?:(20\d{2})年(?:上半年|同期))?(收益|盈利|亏损|损失)(\d+(?:\.\d+)?(?:十亿|百万|亿|万|千)?(?:港元|美元|元))/g)]
    .filter(pair => [pair[3], pair[6]].some(amount => Number(amount!.match(/^\d+(?:\.\d+)?/)![0]) === Number(number)));
  if (!pairs.length) return null;
  const remainder = pairs.reduce((text, pair) => text.replace(pair[0], ""), clause);
  if (numericalAssertions(remainder).some(n => Number(n) === Number(number))) return false;
  return pairs.every(pair => {
    let priorYear = pair[1], currentYear = pair[4];
    if (!priorYear && !currentYear) {
      const periods = [...new Set(facts.filter(f => ["net_fx_loss_gain", "net_fx_gain_loss"].includes(f.metric))
        .map(f => `${f.period.start}/${f.period.end}/${f.period.type}`))].sort();
      if (periods.length !== 2) return false;
      priorYear = periods[0]!.slice(0, 4); currentYear = periods[1]!.slice(0, 4);
      const remainingPeriod = remainder.replaceAll(`${currentYear}年上半年`, "");
      if (/20\d{2}|上半年|下半年|全年|季度|\b[HQ][1-4]\b/i.test(remainingPeriod)) return false;
    }
    if (!priorYear || !currentYear || Number(currentYear) !== Number(priorYear) + 1) return false;
    const prior = facts.filter(f => fxDatedAmountMatches(f, priorYear!, pair[2]!, pair[3]!));
    const current = facts.filter(f => fxDatedAmountMatches(f, currentYear!, pair[5]!, pair[6]!));
    return prior.some(p => current.some(c => p.metric === c.metric && p.currency === c.currency
      && p.unitScale === c.unitScale && p.accountingScope === c.accountingScope && p.businessScope === c.businessScope
      && p.measurementBasis === c.measurementBasis
      && p.source.periodHeader === c.source.periodHeader && p.source.unitHeader === c.source.unitHeader
      && p.source.sourceId === c.source.sourceId && p.source.contentSha256 === c.source.contentSha256
      && p.source.quote === c.source.quote));
  });
}
function fxDatedAmountMatches(f: ReadFinancialFact, year: string, role: string, amount: string): boolean {
  if (!["net_fx_loss_gain", "net_fx_gain_loss"].includes(f.metric)
    || f.period.type !== "interim" || f.period.start !== `${year}-01-01` || f.period.end !== `${year}-06-30`) return false;
  const profit = f.metric === "net_fx_loss_gain" ? -f.value : f.value;
  if (!(/收益|盈利/.test(role) ? profit > 0 : profit < 0)) return false;
  const number = amount.match(/^\d+(?:\.\d+)?/)![0];
  return currencyAssertionMatches(amount, number, [{ currency: f.currency, value: Math.abs(f.value) * f.unitScale }]);
}
function fxDatedPriorClaimMatches(clause: string, number: string, facts: ReadFinancialFact[]): boolean | null {
  const claim = /(?:20\d{2})年同期(?:为)?净汇兑(收益|盈利|亏损|损失)(?:约|为)?\s*(\d+(?:\.\d+)?(?:十亿|百万|亿|万|千)?(?:港元|美元|元))/.exec(clause);
  if (!claim || Number(claim[2]!.match(/^\d+(?:\.\d+)?/)![0]) !== Number(number)) return null;
  const year = clause.match(/(20\d{2})年同期/)![1]!;
  const prior = facts.filter(f => fxDatedAmountMatches(f, year, claim[1]!, claim[2]!));
  return prior.some(p => facts.some(c => c.metric === p.metric && c.currency === p.currency && c.unitScale === p.unitScale
    && c.accountingScope === p.accountingScope && c.businessScope === p.businessScope && c.measurementBasis === p.measurementBasis
    && c.source.sourceId === p.source.sourceId && c.source.quote === p.source.quote && c.source.contentSha256 === p.source.contentSha256
    && c.source.periodHeader === p.source.periodHeader && c.source.unitHeader === p.source.unitHeader
    && c.period.type === p.period.type && Number(c.period.start.slice(0, 4)) === Number(year) + 1
    && c.period.start.slice(4) === p.period.start.slice(4) && c.period.end.slice(4) === p.period.end.slice(4)));
}
function fxComparativePriorAmounts(clause: string, number: string, facts: ReadFinancialFact[]) {
  // A loss/(gain) note represents the prior gain as a negative number. Permit
  // the positive word "收益" only for this explicit current-loss/prior-gain
  // pair, with both columns selected from the same inspected original row.
  const pair = /净汇兑(?:损失|亏损)(?:约|为)?\s*\d+(?:\.\d+)?\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元)\s*[（(](?:上年(?:同期)?|上期|去年同期)(?:净)?(收益|盈利|亏损|损失)\s*(\d+(?:\.\d+)?)\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元)[）)]/.exec(clause);
  if (!pair || Number(pair[2]) !== Number(number)) return null;
  const priorGain = /收益|盈利/.test(pair[1]!);
  const current = facts.filter(f => (f.metric === "net_fx_loss_gain" && f.value > 0 || f.metric === "net_fx_gain_loss" && f.value < 0)
    && numericalAssertions(pair[0]).some(n => currencyAssertionMatches(pair[0], n, [{ currency: f.currency, value: f.value * f.unitScale }])));
  // Narrative issuer after-tax/parent figures can be supported by selected
  // literal amounts without a transcribed group FX row. Do not override that
  // independent original-quote check with an empty table-column comparison.
  if (!current.length) return null;
  return facts.filter(f => (f.metric === "net_fx_loss_gain" ? priorGain ? f.value < 0 : f.value >= 0 : priorGain ? f.value > 0 : f.value <= 0)
    && current.some(c => f.metric === c.metric && f.currency === c.currency
    && f.unitScale === c.unitScale && f.accountingScope === c.accountingScope && f.businessScope === c.businessScope
    && f.measurementBasis === c.measurementBasis && f.source.sourceId === c.source.sourceId && f.period.type === c.period.type
    && Number(f.period.start.slice(0, 4)) === Number(c.period.start.slice(0, 4)) - 1
    && f.period.start.slice(4) === c.period.start.slice(4) && f.period.end.slice(4) === c.period.end.slice(4)))
    .map(f => ({ currency: f.currency, value: Math.abs(f.value) * f.unitScale }));
}
function quotedCurrencyAmounts(basis: Basis[], evidence: InvestigationEvidence): Array<{ currency: string; value: number }> {
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  return basis.flatMap(b => {
    const source = evidence.sources.find(s => s.id === b.sourceId && s.symbol === evidence.symbol && s.readStatus === "BODY_READ");
    if (!source || !normalize(source.text).includes(normalize(b.quote))
      || source.sourceType === "provider_financial_statement") return [];
    const narrative = [...b.quote.matchAll(/(RMB|HK\$|US\$|USD)\s*([\d,]+(?:\.\d+)?)\s*(billion|million|thousand)?\b/gi)]
      .map(m => ({ currency: m[1]!.toUpperCase() === "RMB" ? "CNY" : m[1]!.toUpperCase() === "HK$" ? "HKD" : "USD",
        value: Number(m[2]!.replaceAll(",", "")) * (({ billion: 1e9, million: 1e6, thousand: 1e3 } as Record<string, number>)[m[3]?.toLowerCase() ?? ""] ?? 1) }));
    const chinese = [...b.quote.matchAll(/(-?[\d,]+(?:\.\d+)?)\s*(十亿|百万|亿|万|千)?(港元|美元|元)/g)]
      .map(m => ({ currency: m[3] === "港元" ? "HKD" : m[3] === "美元" ? "USD" : "CNY",
        value: Number(m[1]!.replaceAll(",", "")) * (({ 十亿: 1e9, 百万: 1e6, 亿: 1e8, 万: 1e4, 千: 1000 } as Record<string, number>)[m[2] ?? ""] ?? 1) }));
    const table = exactCurrencyTableRows(source);
    return narrative.concat(chinese, table.rows.filter(row => normalize(b.quote).includes(normalize(row.quote))).flatMap(row => row.amounts.map(value => ({ currency: "CNY", value }))));
  });
}
function quotedQuantities(basis: Basis[], evidence: InvestigationEvidence) {
  return basis.flatMap(b => {
    const source = evidence.sources.find(s => s.id === b.sourceId && s.symbol === evidence.symbol && s.readStatus === "BODY_READ");
    if (!source || !source.text.replace(/\s+/g, " ").includes(b.quote.replace(/\s+/g, " "))) return [];
    const english = [...b.quote.matchAll(/([\d,]+)\s+(shares|vehicles|units)\b/gi)].map(m => ({ value: Number(m[1]!.replaceAll(",", "")), unit: m[2]!.toLowerCase() === "shares" ? "股" : "辆" }));
    const chinese = [...b.quote.matchAll(/([\d,]+(?:\.\d+)?)\s*(亿|万|千)?(股|辆)/g)].map(m => ({ value: Number(m[1]!.replaceAll(",", ""))
      * (({ 亿: 1e8, 万: 1e4, 千: 1000 } as Record<string, number>)[m[2] ?? ""] ?? 1), unit: m[3]! }));
    return english.concat(chinese);
  });
}
function quotedNciEquityAmounts(basis: Basis[], evidence: InvestigationEvidence) {
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  return basis.flatMap(b => {
    const s = evidence.sources.find(s => s.id === b.sourceId && s.symbol === evidence.symbol && s.readStatus === "BODY_READ" && s.sourceType === "official_pdf");
    if (!s || !/CONDENSED CONSOLIDATED STATEMENT OF CHANGES IN EQUITY/i.test(s.text)) return [];
    const header = s.text.split(/Balance at 1 January/i)[0]!;
    if (!/Sub-total\s+Non-\s*controlling interests\s+Total\s+RMB[’']000/i.test(header)) return [];
    const columns = [...header.matchAll(/RMB[’']000/g)].length;
    const token = "\\(?-?\\d[\\d,]*\\)?";
    const pattern = new RegExp(`Balance at 30 June (20\\d{2})(?: \\(restated\\))?\\s+((?:${token}\\s*)+)`, "g");
    return [...s.text.matchAll(pattern)].flatMap(row => {
      const values = row[2]!.trim().split(/\s+/).map(v => Number(v.replace(/[(),]/g, "")) * (v.includes("(") ? -1 : 1));
      if (columns < 3 || values.length !== columns || !normalize(b.quote).includes(normalize(row[0]))) return [];
      const subtotal = values.at(-3)!, nci = values.at(-2)!, total = values.at(-1)!;
      return subtotal + nci === total ? [{ currency: "CNY", value: nci * 1000, year: row[1]! }] : [];
    });
  });
}
function quantityAssertionMatches(text: string, number: string, amounts: Array<{ value: number; unit: string }>) {
  const pattern = new RegExp("(?:^|[^\\d.])" + number.replace(".", "\\.") + "\\s*(亿|万|千)?(股|辆)", "g");
  const decimals = number.split(".")[1]?.length ?? 0;
  return [...text.matchAll(pattern)].some(m => amounts.some(amount => amount.unit === m[2]
    && Number((amount.value / (({ 亿: 1e8, 万: 1e4, 千: 1e3 } as Record<string, number>)[m[1] ?? ""] ?? 1)).toFixed(decimals)) === Number(number)));
}
export function exactCurrencyTableRows(source: InvestigationEvidence["sources"][number]) {
  // These two read layouts are outside the consolidated statement extractor.
  // Convert only the two selected amount columns of a recognised row. The
  // page's other figures, dates and following percentage columns grant nothing.
  const empty = { unitHeader: "", periodHeader: "", rows: [] as Array<{ label: string; quote: string; amounts: number[] }> };
  const unit = source.text.match(/\(RMB in millions(?:, unless specified)?\)/i);
  if (source.readStatus !== "BODY_READ" || source.sourceType !== "official_pdf" || !unit) return empty;
  const revenueTable = /table sets forth revenues of the Group and its segments/i.test(source.text)
    && /Three months ended\s+30 June\s+20\d{2}\s+30 June\s+20\d{2}/i.test(source.text);
  const cashTable = /Our cash and debt positions as at\s+30 June\s+20\d{2}\s+and\s+31 March\s+20\d{2}/i.test(source.text);
  const rowLabels = [...(revenueTable ? ["VAS", "Marketing Services", "FinTech and Business Services", "Others", "The Group"] : []),
    ...(cashTable ? ["Cash and cash equivalents", "Term deposits and others", "Borrowings", "Notes payable", "Net cash"] : [])];
  const period = revenueTable ? source.text.match(/Three months ended\s+30 June\s+20\d{2}\s+30 June\s+20\d{2}/i)
    : cashTable ? source.text.match(/Our cash and debt positions as at\s+30 June\s+20\d{2}\s+and\s+31 March\s+20\d{2}/i) : null;
  const rows = rowLabels.flatMap(label => {
    const amount = "(\\(?-?\\d[\\d,]*(?:\\.\\d+)?\\)?)";
    const row = source.text.match(new RegExp(`(?:^|\\s)${label}\\s+${amount}\\s+${amount}(?![\\d.%])`, "i"));
    return row ? [{ label, quote: row[0].trim(), amounts: row.slice(1, 3).map(value => Number(value.replace(/[(),]/g, "")) * (value.includes("(") ? -1 : 1) * 1e6) }] : [];
  });
  return { unitHeader: unit[0], periodHeader: period?.[0] ?? "", rows };
}
function numericalAssertions(text: string): string[] {
  // A reporting-period identifier is necessary context, not a financial amount.
  // Amounts/ratios remain in the original, cited factual detail fields.
  return text.replace(/20\d{2}年(?:上半年|下半年|全年|第[一二三四]季度|(?:1[0-2]|0?[1-9])月(?:[0-3]?\d日)?)?|20\d{2}\s*[HQ][1-4]|20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])/g, "")
    .replace(/(?<!\d)(?:1[0-2]|0?[1-9])月(?:0?[1-9]|[12]\d|3[01])日/g, "")
    .replace(/附注\s*\d+(?:\([a-z]\))?(?![\d.])(?!\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元|股|辆|%|％|百分点))/gi, "")
    .replace(/\b[HQ][1-4]\b|第[1-4一二三四]季度/gi, "").replace(/(?<=\d),(?=\d)/g, "").match(/\d+(?:\.\d+)?/g) ?? [];
}
export function hasFinancialNumericalAssertion(text: string): boolean {
  return numericalAssertions(text).length > 0;
}
// Collect independent text failures together, so a bad citation in one
// explanation cannot hide several unit-converted quantities until retry two.
// This only improves diagnostics; the full validator still checks every quote.
export function reasoningTextErrors(value: unknown, evidence?: InvestigationEvidence): string[] {
  const v = value as { reasoning?: Partial<ResearchReasoning>; whatHappened?: Array<{ basis: Basis[] }>; confirmedInformation?: Array<{ basis: Basis[] }>; report?: { sections?: Array<{ heading: string; text: string; missingEvidence: string; basis: Basis[] }> } };
  const r = v?.reasoning;
  if (!r) return [];
  const safe = (basis: unknown): Basis[] => Array.isArray(basis) ? basis.filter(b => typeof b?.quote === "string") : [];
  const fields = [r.thesisImpact, r.earningsImpact, r.valuationImpact, ...Object.values(r.transmission ?? {})];
  const names = ["thesisImpact", "earningsImpact", "valuationImpact", ...Object.keys(r.transmission ?? {}).map(k => "transmission." + k)];
  const summaryBasis = fields.flatMap(f => safe(f?.basis)).concat(Array.isArray(r.explanations) ? r.explanations.flatMap(e => [...safe(e?.supportingEvidence), ...safe(e?.contradictingEvidence)]) : [])
    .concat([v.whatHappened, v.confirmedInformation, v.report?.sections].flatMap(c => Array.isArray(c) ? c.flatMap(x => safe(x?.basis)) : []));
  const checks = [{ text: r.summary, field: "summary", basis: summaryBasis }, ...fields.flatMap((f, i) => f ? [{ text: f.text, field: names[i] + ".text", basis: safe(f.basis) }] : [])];
  for (const [index, section] of (Array.isArray(v.report?.sections) ? v.report.sections : []).entries()) {
    for (const field of ["heading", "text", "missingEvidence"] as const) if (section?.[field]) {
      checks.push({ text: section[field], field: `report.sections.${index}.${field}`, basis: safe(section.basis) });
    }
  }
  // Source page/note numbers and dates in requested reads are identifiers,
  // not amounts. Audit added narrative fields only for explicit quantities.
  const moneyOrQuantity = (text: string) => /\d[\d,.]*\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元|股|辆|%|％|百分点)/.test(text);
  for (const e of Array.isArray(r.explanations) ? r.explanations : []) {
    const basis = [...safe(e.supportingEvidence), ...safe(e.contradictingEvidence)];
    for (const field of ["whyInvestigateFirst", "neededEvidence", "potentialImpact", "confidenceReason"] as const) {
      if (typeof e[field] === "string" && moneyOrQuantity(e[field])) checks.push({ text: e[field], field: `${e.hypothesisId}.${field}`, basis });
    }
    if (typeof e.claimCoverage?.conclusion === "string" && moneyOrQuantity(e.claimCoverage.conclusion)) checks.push({ text: e.claimCoverage.conclusion, field: `${e.hypothesisId}.conclusion`, basis });
  }
  for (const q of Array.isArray(r.nextQuestions) ? r.nextQuestions : []) {
    const explanation = r.explanations?.find(e => e.hypothesisId === q.hypothesisId);
    const basis = [...safe(explanation?.supportingEvidence), ...safe(explanation?.contradictingEvidence)];
    for (const field of ["question", "whyImportant", "neededEvidence", "why", "ifConfirmed", "ifRejected"] as const) {
      if (typeof q[field] === "string" && moneyOrQuantity(q[field])) checks.push({ text: q[field], field: `${q.hypothesisId}.nextQuestion.${field}`, basis });
    }
  }
  const claims = ["whatHappened", "confirmedInformation", "possibleExplanations", "weakenedExplanations", "operatingDrivers"].flatMap(name => {
    const group = (value as Record<string, unknown>)[name];
    return Array.isArray(group) ? group.map((c, i) => ({ text: c?.text, field: `${name}.${i}.text`, basis: safe(c?.basis) })) : [];
  });
  return [...checks, ...claims].flatMap(c => { try { qualitative(c.text, c.field, c.basis, evidence, 800); return []; } catch (error) { return [error instanceof Error ? error.message : "REASONING_TEXT_INVALID"]; } });
}
function gap(value: InvestigationGap, field = "unknown"): InvestigationGap {
  if (!value || !reasons.includes(value.reason)) throw new Error(`REASONING_UNKNOWN_REASON_REQUIRED_${field}_actual_${value?.reason ?? "null"}`);
  return { reason: value.reason, text: prose(value.text, 10) };
}
function citationLimitError(value: Basis[], evidence: InvestigationEvidence, field: string, quoteLimit = INVESTIGATION_MAX_BASIS_QUOTES): Error {
  const facts = readInvestigationFinance(evidence).facts;
  // Metric keys identify the already supplied original rows without resending
  // their current/prior values or full quotations in the correction request.
  const rows = value.map(b => {
    const selected = facts.filter(f => f.source.sourceId === b?.sourceId && f.source.quote === b?.quote);
    return selected.length ? [...new Set(selected.map(f => `${f.source.sourceId}:${f.metric}`))].join("|")
      : `${b?.sourceId}:${typeof b?.quote === "string" ? b.quote.slice(0, 40) : ""}`;
  });
  const repair = quoteLimit === INVESTIGATION_MAX_REPORT_SECTION_QUOTES
    ? "split_report_section_into_coherent_claims_keep_each_block_own_selected_rows"
    : "split_additional_metric_details_into_separate_facts_not_plan_assessments_keep_one_item_per_exact_plan_id_and_own_selected_rows";
  return new Error(`REASONING_CITATION_COUNT_${field}_maximum_${quoteLimit}_actual_${value.length}_${repair}; expanded_selected_original_rows=${JSON.stringify(rows)}; inspect_this_assessment_own_claims_and_reference_operands_keep_complete_bridges_in_factual_points_do_not_drop_required_operands`);
}
function citations(value: Basis[], evidence: InvestigationEvidence, required: boolean, field = "basis",
  quoteLimit = INVESTIGATION_MAX_BASIS_QUOTES): Basis[] {
  if (!Array.isArray(value) || (required && !value.length)) throw new Error(`REASONING_CITATION_REQUIRED_${field}_needs_actual_BODY_READ_quote_or_downgrade_hypothesis_to_unresolved`);
  if (value.length > quoteLimit) throw citationLimitError(value, evidence, field, quoteLimit);
  return value.map(b => {
    const source = evidence.sources.find(s => s.id === b?.sourceId);
    const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
    if (!source || source.symbol !== evidence.symbol || source.readStatus !== "BODY_READ" || source.sourceType === "official_search"
      || typeof b.quote !== "string" || b.quote.length < 12 || b.quote.length > 500 || !normalize(source.text).includes(normalize(b.quote))) throw new Error("REASONING_CITATION_INVALID");
    return { sourceId: b.sourceId, quote: b.quote };
  });
}
function why(value: WhyThisMatters, field: string): WhyThisMatters {
  if (!value) throw new Error(`REASONING_WHY_REQUIRED_${field}`);
  const pair = value.ifConfirmed !== undefined || value.ifRejected !== undefined;
  if (pair) return { ...(value.why ? { why: prose(value.why, 5, 250, field + ".why") } : {}), ifConfirmed: prose(value.ifConfirmed, 5, 250, field + ".ifConfirmed"), ifRejected: prose(value.ifRejected, 5, 250, field + ".ifRejected") };
  return { why: prose(value.why, 5, 250, field + ".why") };
}
function coverage(value: ClaimCoverage, basis: Basis[], field: string): ClaimCoverage {
  if (!value || !["direct", "partial", "insufficient"].includes(value.assessment)
    || !Array.isArray(value.sourceIds) || value.sourceIds.length > INVESTIGATION_MAX_BASIS_QUOTES || new Set(value.sourceIds).size !== value.sourceIds.length
    || value.sourceIds.some(id => !basis.some(b => b.sourceId === id))) throw new Error(`REASONING_COVERAGE_BINDING_${field}_sourceIds_must_be_selected_quotes_${[...new Set(basis.map(b => b.sourceId))].join(",")}`);
  if (value.assessment !== "insufficient" && !value.sourceIds.length) throw new Error(`REASONING_COVERAGE_EVIDENCE_${field}`);
  const missingLink = prose(value.missingLink, value.assessment === "direct" ? 0 : 10, 300, field + ".missingLink");
  const conclusion = prose(value.conclusion, 10, 300, field + ".conclusion");
  if (value.assessment === "direct" && missingLink.trim()) throw new Error(`REASONING_COVERAGE_DIRECT_WITH_MISSING_LINK_${field}`);
  const boundedConclusion = /尚(?!无|不缺)|未确认|未取得|未核实|不能|无法|待核查|仅|不足以|(?<!不)缺少/.test(conclusion)
    && !/不(?:再)?缺少|并(?:不|无)缺少|没有缺少/.test(conclusion);
  if (value.assessment !== "direct" && !boundedConclusion) throw new Error(`REASONING_COVERAGE_UNBOUNDED_${field}`);
  return { claim: prose(value.claim, 10, 300, field + ".claim"), sourceIds: value.assessment === "insufficient" ? [] : value.sourceIds, assessment: value.assessment, missingLink, conclusion };
}
export function validateResearchReasoning(value: unknown, evidence: InvestigationEvidence,
  hypotheses: Array<{ hypothesisId: string; verdict: string }>,
  factQuotes: Array<Basis[] | { basis: Basis[]; reportSection: true }> = []): ResearchReasoning {
  const r = value as ResearchReasoning;
  const semanticErrors = [...visibleInferenceErrors({ reasoning: r }, evidence,
    factQuotes.map(group => Array.isArray(group) ? group : group.basis)),
    ...questionAndPlanErrors({ reasoning: r }, evidence)];
  if (!r || !evidence.reasoningContext) throw new Error("REASONING_MISSING");
  const impact = (v: Impact, field: string): Impact => {
    if (!v || !impacts.includes(v.classification)) throw new Error("REASONING_INVALID_IMPACT");
    const comparison = ["SUPPORTS_EXISTING_VIEW", "CHALLENGES_EXISTING_VIEW"].includes(v.classification);
    if (comparison && evidence.reasoningContext?.status !== "active") throw new Error("REASONING_NO_CURRENT_THESIS_TO_COMPARE");
    const basis = citations(v.basis, evidence, comparison, field);
    return { classification: v.classification, text: qualitative(v.text, `${field}.text`, basis, evidence), basis, missingEvidence: prose(v.missingEvidence, 0, 500, `${field}.missingEvidence`) };
  };
  const boundValuationScope = evidence.gaps?.find(g => g.reason === "NOT_CHECKED" && g.text.includes("估值假设"));
  const step = (v: TransmissionStep, field: string): TransmissionStep => {
    if (!v || !["confirmed", "interpretation", "unresolved"].includes(v.status)) throw new Error("REASONING_INVALID_TRANSMISSION");
    const basis = citations(v.basis, evidence, v.status !== "unresolved", field);
    if (v.status === "confirmed" && basis.some(b => evidence.sources.find(s => s.id === b.sourceId)?.sourceType === "news_body")) throw new Error("REASONING_MEDIA_IS_ATTRIBUTED");
    // Use the existing application-owned unread scope before validating its
    // wording; the final projection already owns this same valuation boundary.
    const scopeGap = field === "transmission.valuation" && v.gap?.reason === "NOT_CHECKED" && boundValuationScope ? boundValuationScope : v.gap;
    return { text: qualitative(v.text, field + ".text", basis, evidence), status: v.status, basis, gap: v.status === "unresolved" ? gap(scopeGap!, field + ".gap") : scopeGap ? gap(scopeGap, field + ".gap") : null,
      whyThisMatters: why(v.whyThisMatters, field) };
  };
  if (!Array.isArray(r.explanations) || r.explanations.length !== hypotheses.length || new Set(r.explanations.map(e => e.rank)).size !== hypotheses.length) throw new Error(`REASONING_EXPLANATIONS_REQUIRED_expected_all_${hypotheses.map(h => h.hypothesisId).join(",")}_actual_${r.explanations?.map(e => e.hypothesisId).join(",")}_one_item_per_plan_hypothesis_unique_ranks_1_to_${hypotheses.length}`);
  if (new Set(r.explanations.map(e => e.investigationPriority)).size !== hypotheses.length) throw new Error("REASONING_PRIORITY_REQUIRED");
  const explanations = hypotheses.map(h => {
    const matches = r.explanations.filter(e => e.hypothesisId === h.hypothesisId), e = matches[0];
    if (matches.length !== 1 || !Number.isInteger(e.rank) || e.rank < 1 || e.rank > hypotheses.length) throw new Error("REASONING_RANK_INVALID");
    if (!Number.isInteger(e.investigationPriority) || e.investigationPriority < 1 || e.investigationPriority > hypotheses.length) throw new Error("REASONING_PRIORITY_INVALID");
    // Check every original quote, then require proof for the bounded conclusion,
    // not the model's stale pre-audit verdict. Insufficient coverage never keeps
    // an unsupported "partial" flag or promotes a related quote to counterproof.
    const originalSupport = citations(e.supportingEvidence, evidence, false, e.hypothesisId + ".support");
    const originalCounter = citations(e.contradictingEvidence, evidence, false, e.hypothesisId + ".counter");
    const claimCoverage = coverage(e.claimCoverage, [...originalSupport, ...originalCounter], e.hypothesisId);
    const supportingEvidence = originalSupport.filter(b => claimCoverage.sourceIds.includes(b.sourceId));
    const contradictingEvidence = originalCounter.filter(b => claimCoverage.sourceIds.includes(b.sourceId));
    if (claimCoverage.assessment !== "insufficient") {
      citations(supportingEvidence, evidence, ["supported", "partial"].includes(h.verdict), e.hypothesisId + ".support");
      citations(contradictingEvidence, evidence, h.verdict === "weakened", e.hypothesisId + ".counter");
    }
    return { hypothesisId: e.hypothesisId, rank: e.rank, investigationPriority: e.investigationPriority,
      whyInvestigateFirst: prose(e.whyInvestigateFirst, 10, 250), neededEvidence: prose(e.neededEvidence, 10, 300), potentialImpact: prose(e.potentialImpact, 10, 250),
      supportingEvidence, contradictingEvidence, missingEvidence: prose(e.missingEvidence, 5, 500, `explanation.${e.hypothesisId}.missingEvidence`),
      confidenceReason: prose(e.confidenceReason, 10, 500, `explanation.${e.hypothesisId}.confidenceReason`), whyThisMatters: why(e.whyThisMatters, e.hypothesisId),
      claimCoverage };
  }).sort((a, b) => a.rank - b.rank);
  if (Array.isArray(r.nextQuestions) && r.nextQuestions.length > INVESTIGATION_MAX_NEXT_QUESTIONS) {
    throw new Error(`REASONING_NEXT_QUESTION_COUNT_actual_${r.nextQuestions.length}_maximum_${INVESTIGATION_MAX_NEXT_QUESTIONS}_select_the_most_useful_distinct_unresolved_questions_or_empty_if_no_new_path_keep_all_plan_assessments`);
  }
  if (!Array.isArray(r.unknowns) || !r.unknowns.length || r.unknowns.length > 3 || !Array.isArray(r.nextQuestions)
    || new Set(r.nextQuestions.map(q => q.question)).size !== r.nextQuestions.length) throw new Error("REASONING_NEXT_QUESTION_REQUIRED");
  const priority = [...explanations].sort((a, b) => a.investigationPriority - b.investigationPriority);
  // The declared action priorities own display order, just as rank owns the
  // explanation order. Reordering keeps every model question and quotation;
  // unknown IDs, missing highest priority and duplicate questions still fail.
  const nextQuestions = [...r.nextQuestions].sort((a, b) => (priority.find(e => e.hypothesisId === a.hypothesisId)?.investigationPriority ?? 0)
    - (priority.find(e => e.hypothesisId === b.hypothesisId)?.investigationPriority ?? 0));
  const unresolved = explanations.filter(e => e.claimCoverage.assessment !== "direct");
  if (unresolved.length && nextQuestions.some(q => explanations.find(e => e.hypothesisId === q.hypothesisId)?.claimCoverage.assessment === "direct")) {
    throw new Error(`REASONING_FOLLOWUP_ALREADY_COMPLETED_PROPOSITION_use_the_matching_unresolved_${unresolved.map(e => e.hypothesisId).join("_")}_and_assign_it_priority1_do_not_relabel_its_question_as_a_completed_comparison`);
  }
  const questionPriorities = nextQuestions.map(q => priority.find(e => e.hypothesisId === q.hypothesisId)?.investigationPriority ?? 0);
  if ((questionPriorities.length && questionPriorities[0] !== 1) || questionPriorities.some((p, i) => !p || (i > 0 && p < questionPriorities[i - 1]))) {
    throw new Error(`REASONING_FOLLOWUP_PRIORITY_MISMATCH_priority1_is_${priority[0]?.hypothesisId}_but_first_suggested_question_is_${nextQuestions[0]?.hypothesisId}_assign_priority1_to_the_actual_next_unresolved_check_and_update_its_reason_do_not_invent_a_repeat_of_completed_checks`);
  }
  const summaryBasis = explanations.flatMap(e => [...e.supportingEvidence, ...e.contradictingEvidence])
    .concat([r.thesisImpact, r.earningsImpact, r.valuationImpact, ...Object.values(r.transmission ?? {})].flatMap(v => Array.isArray(v?.basis) ? v.basis : []))
    .concat(factQuotes.flatMap((group, i) => citations(Array.isArray(group) ? group : group.basis,
      evidence, false, `summaryFacts.${i}`, Array.isArray(group)
        ? INVESTIGATION_MAX_BASIS_QUOTES : INVESTIGATION_MAX_REPORT_SECTION_QUOTES)));
  const transmission: ResearchReasoning["transmission"] = {};
  for (const field of ["operatingFact", "operatingMeaning", "earnings", "cashFlow", "valuation"] as const) {
    if (r.transmission?.[field] !== undefined) transmission[field] = step(r.transmission[field]!, "transmission." + field);
  }
  if (Object.keys(r.transmission ?? {}).some(k => !["operatingFact", "operatingMeaning", "earnings", "cashFlow", "valuation"].includes(k))) throw new Error("REASONING_UNKNOWN_TRANSMISSION_FIELD");
  const result: ResearchReasoning = { summary: qualitative(r.summary, "summary", summaryBasis, evidence),
    ...(r.thesisImpact ? { thesisImpact: impact(r.thesisImpact, "thesisImpact") } : {}), ...(r.earningsImpact ? { earningsImpact: impact(r.earningsImpact, "earningsImpact") } : {}),
    ...(r.valuationImpact ? { valuationImpact: impact(r.valuationImpact, "valuationImpact") } : {}), explanations, transmission,
    unknowns: r.unknowns.map((v, i) => ({ ...gap(v, `unknowns.${i}`), whyThisMatters: why(v.whyThisMatters, `unknowns.${i}`) })),
    nextQuestions: nextQuestions.map(q => ({ hypothesisId: q.hypothesisId, question: prose(q.question, 10, 220, "nextQuestion.question"), whyImportant: prose(q.whyImportant, 10, 500, "nextQuestion.whyImportant"), neededEvidence: prose(q.neededEvidence, 10, 500, "nextQuestion.neededEvidence"), ...why(q, "nextQuestion") })) };
  const valuationScope = evidence.gaps?.find(g => g.reason === "NOT_CHECKED" && g.text.includes("估值假设"));
  if (valuationScope) {
    // Absence of a read is not absence of an Owner assumption. The app owns
    // scope metadata; the model cannot infer private inputs it never received.
    const text = "本轮未核对已有估值假设，因此无法量化估值影响；不能据此判断你是否已设置假设。";
    if (result.valuationImpact) result.valuationImpact = { classification: "NO_CONFIRMED_IMPACT", text, basis: [], missingEvidence: "现有估值假设未纳入本次调查。" };
    const whyThisMatters = { why: "核对现有估值假设后，才能判断本轮盈利证据与估值的关系。" };
    if (result.transmission.valuation) result.transmission.valuation = { text: evidence.mode === "price_move" ? "价格波动尚未确认为经营变化，不能据此推算估值影响。" : "盈利与现金流的可持续性关系到估值；本轮尚未核对估值假设，量化影响仍待研究。", status: "unresolved", basis: [], gap: { reason: "NOT_CHECKED", text }, whyThisMatters };
    result.unknowns = result.unknowns.map(g => /估值|市盈率|\bPE\b/.test(g.text) ? { reason: "NOT_CHECKED", text, whyThisMatters } : g);
  }
  if (semanticErrors.length) throw new Error(semanticErrors.join(" | "));
  return result;
}

// Report all unusable body citations together so the bounded correction fixes
// the actual set of defects, including those hidden behind an earlier error.
export function reasoningCitationErrors(value: unknown, evidence: InvestigationEvidence): string[] {
  const v = value as { whatHappened?: Array<{ basis?: unknown }>; confirmedInformation?: Array<{ basis?: unknown }>; researchJudgment?: Record<string, { basis?: unknown }>; hypothesisResults?: Array<{verdict: string; basis: unknown; hypothesisId: string}>; reasoning?: ResearchReasoning; report?: { sections?: Array<{ basis?: unknown }> } };
  if (!v) return [];
  const errors: string[] = [];
  const check = (basis: unknown, field: string) => {
    if (!Array.isArray(basis)) return;
    for (const b of basis) {
      const s = evidence.sources.find(s => s.id === b?.sourceId);
      const norm = (text: string) => text.replace(/\s+/g, " ").trim();
      if (!s || s.symbol !== evidence.symbol || s.readStatus !== "BODY_READ" || s.sourceType === "official_search") errors.push(`${field}:${b?.sourceId}:${s?.readStatus ?? "missing"}`);
      else if (typeof b.quote !== "string" || !norm(s.text).includes(norm(b.quote))) {
        const matching = typeof b.quote === "string" && b.quote.length >= 12 ? evidence.sources.filter(other => other.symbol === evidence.symbol
          && other.readStatus === "BODY_READ" && other.sourceType !== "official_search" && norm(other.text).includes(norm(b.quote))).map(other => other.id) : [];
        errors.push(`${field}:${b.sourceId}:quote_not_in_body:matching_body_sources=${matching.join(",") || "none_choose_literal_read_original"}`);
      }
    }
  };
  for (const field of ["whatHappened", "confirmedInformation"] as const) {
    for (const [index, claim] of (Array.isArray(v[field]) ? v[field]! : []).entries()) check(claim.basis, `${field}.${index}`);
  }
  for (const field of ["importance", "impact"]) check(v.researchJudgment?.[field]?.basis, `researchJudgment.${field}`);
  for (const [index, section] of (Array.isArray(v.report?.sections) ? v.report.sections : []).entries()) check(section?.basis, `report.sections.${index}`);
  for (const h of Array.isArray(v.hypothesisResults) ? v.hypothesisResults : []) if (h.verdict !== "unresolved") check(h.basis, `hypothesis.${h.hypothesisId}`);
  const r = v.reasoning;
  if (r) {
    for (const field of ["thesisImpact", "earningsImpact", "valuationImpact"]) check(r[field as "thesisImpact"]?.basis, `reasoning.${field}`);
    for (const [field, step] of Object.entries(r.transmission ?? {})) check((step as {basis?: unknown})?.basis, `reasoning.transmission.${field}`);
    for (const e of Array.isArray(r.explanations) ? r.explanations : []) { check(e.supportingEvidence, `reasoning.${e.hypothesisId}.support`); check(e.contradictingEvidence, `reasoning.${e.hypothesisId}.counter`); }
  }
  return errors.slice(0, 15);
}
