import { factNode, deriveNode, sameBasis } from "../../../../packages/contracts/src/researchOperatingCalculations.js";
import { safeProviderDecimal } from "../../../../packages/contracts/src/researchFutuFinancialHistory.js";
import type { OperatingFact } from "../../../../packages/contracts/src/researchOperatingModel.js";
import type { InvestigationEvidence, InvestigationSource } from "./personalInvestigationSources.js";

/** Read-only transcription of the statement layouts used by the current
 * investigations. Unrecognised headers/rows stay unextracted. No Fact write,
 * forecast, source-quote fabrication or general financial ETL occurs here. */
export type ReadFinancialFact = {
  id: string; metric: string; label: string; value: number; unitScale: number; currency: string;
  period: { start: string; end: string; type: string }; accountingScope: string; businessScope: string;
  measurementBasis: string; restated: boolean;
  source: { sourceId: string; pageNumber: number; url: string; quote: string; contentSha256: string; periodHeader: string; unitHeader: string };
};
export type ReadCalculation = { id: string; metric: string; label: string; value: number; unit: string; unitScale: number;
  currency: string; period: ReadFinancialFact["period"]; formula: string; operandIds: string[] };
export type InvestigationFinance = { facts: ReadFinancialFact[]; calculations: ReadCalculation[] };
const cashEffectSubjects: Array<[string, RegExp]> = [
  ["trade_receivables_cash_flow_effect", /贸易应收款|应收账款/g],
  ["trade_bills_payables_cash_flow_effect", /应付账款(?:及票据)?|应付票据/g],
  ["inventory_cash_flow_effect", /存货/g],
  ["other_payables_liabilities_accruals_cash_flow_effect", /其他应付款|其他负债|应计项目/g],
  ["restricted_deposits_cash_flow_effect", /受限(?:及质押)?(?:银行)?存款|质押存款/g]
];
export function cashEffectSubjectMentions(text: string): Array<{ metric: string; index: number }> {
  return cashEffectSubjects.flatMap(([metric, pattern]) => [...text.matchAll(pattern)]
    .map(match => ({ metric, index: match.index! }))).sort((a, b) => a.index - b.index);
}
const numberToken = "\\(?-?\\d[\\d,]*(?:\\.\\d+)?\\)?";
const rows: Array<[string, string, string, boolean?]> = [
  ["revenue", "收入", "(?<!Cost of )Revenues?"], ["gross_profit", "毛利", "Gross profit"],
  ["cost_of_sales", "销售成本总额", "Cost of sales", true],
  ["inventory_cost", "已售存货成本", "Cost of inventories sold(?:\\s*#)*", true],
  ["service_cost", "服务成本", "Cost of services provided(?:\\s*#)*", true],
  ["inventory_write_down", "存货减记至可变现净值", "Write-down of inventories to net realisable value(?:\\s*#)*", true],
  ["profit_before_tax", "税前利润", "Profit before (?:income )?tax"], ["income_tax_expense", "所得税费用", "Income tax expense", true],
  ["non_controlling_interests", "少数股东损益", "Non-controlling interests"],
  ["profit_attributable_to_owners", "法定归母利润", "(?:Owners of the parent|(?<!Non-IFRS )Profit attributable to equity holders of the Company|(?<!attributable to )Equity holders of the Company)"],
  ["associates_joint_ventures_profit_loss", "联营合营损益", "Share of profit/\\(loss\\) of associates and joint ventures, net"],
  ["investment_gains_losses", "投资及其他净损益", "Net gains/\\(losses\\) from investments and others"],
  ["other_gains_losses", "其他收益损失净额", "Other gains/\\(losses\\),? net"],
  ["other_income_and_gains", "其他收入及收益", "Other income and gains"],
  ["financial_asset_impairment_net", "金融资产减值净损益", "Impairment losses on financial assets, net"],
  ["amortised_cost_asset_disposal_loss", "摊余成本金融资产处置损失", "Loss on disposal of financial assets measured at amortised cost", true],
  ["other_expenses", "其他费用", "Other expenses", true],
  ["research_development_expense", "研发费用", "Research and development expenses", true],
  ["selling_distribution_expenses", "销售及分销费用", "Selling and distribution expenses", true],
  ["administrative_expenses", "行政费用", "Administrative expenses", true],
  ["finance_costs", "财务成本", "Finance costs", true],
  ["profit_for_period", "集团净利润", "Profit for the period"],
  ["operating_profit", "经营利润", "(?<!Non-IFRS )Operating profit"],
  ["adjusted_operating_profit", "发行人非IFRS经营利润", "Non-IFRS operating profit"],
  ["adjusted_profit_attributable_to_owners", "发行人非IFRS归母利润", "Non-IFRS profit attributable to equity holders of the Company"],
  ["operating_cash_flow", "经营现金流净额", "Net cash (?:flows (?:generated )?|generated )from operating activities"],
  ["inventory_cash_flow_effect", "存货变动对经营现金流的影响（正为流入）", "Increase in inventories"],
  ["trade_receivables_cash_flow_effect", "应收账款变动对经营现金流的影响（正为流入）", "\\(Increase\\)/decrease in trade receivables"],
  ["trade_bills_payables_cash_flow_effect", "应付账款及票据变动对经营现金流的影响（正为流入）", "Decrease in trade and bills payables"],
  ["other_payables_liabilities_accruals_cash_flow_effect", "其他应付款、负债及应计项目变动对经营现金流的影响（正为流入）", "Increase in other payables, other liabilities and accruals"],
  ["restricted_deposits_cash_flow_effect", "受限及质押存款变动对经营现金流的影响（正为流入）", "Decrease in restricted bank deposits and pledged deposits"],
  ["cash_generated_from_operations", "经营活动产生现金（缴税前）", "(?<!Net )Cash generated from operations"],
  ["operating_interest_received", "经营现金流桥接中的已收利息", "Interest received"],
  ["income_tax_paid", "所得税现金支付", "(?:Income tax(?:es)?|Tax) paid", true],
  ["fx_effect_on_cash", "汇率变动对现金及现金等价物的折算影响", "Effect of foreign exchange rate changes"],
  ["property_plant_equipment_payments", "购置物业厂房设备现金付款", "Purchase of property, plant and equipment", true],
  ["intangible_asset_addition_payments", "新增无形资产现金付款", "Additions of intangible assets", true],
  ["share_cancellation_cash_payments", "回购注销股份现金付款", "Repurchase of shares for cancellation", true],
  ["treasury_share_cash_payments", "购买库存股现金付款", "Purchase of treasury shares", true],
  ["net_fx_loss_gain", "净汇兑亏损（盈利为负数）", "(?:Net foreign exchange loss/\\(gain\\)|Foreign exchange loss/\\(gain\\), net)"],
  ["net_fx_gain_loss", "净汇兑损益", "Net foreign exchange (?:\\(loss\\)/gain|\\(losses\\)/gains|loss|gain)"],
  ["derivative_financial_gain_loss", "衍生金融工具净损益", "Net realised and unrealised loss on derivative financial instruments"],
  ["government_grants_subsidies", "政府补助及补贴", "Government grants and subsidies(?:\\s*\\(note\\))?"],
  ["asset_disposal_gain_loss", "固定及无形资产处置注销净损益", "Net gain/\\(loss\\) on disposal/written off of property, plant and equipment, and intangible assets"],
  ["research_development_costs", "研发费用总额", "Total research and development costs", true],
  ["development_amortisation", "资本化开发成本摊销", "Am\\s*ortisation of intangible assets\\s*\\(related to capitalised product development costs\\)", true],
  ["direct_research_development_costs", "直接研发支出费用", "[–-]\\s*Research and development costs", true],
  ["noncash_adjustments", "非现金项目调整总额", "Adjustments for non-cash items"],
  ["cash_before_working_capital", "营运资本变动前经营现金小计", "Operating profit before working capital changes"],
  ["working_capital_change", "营运资本变动净额", "Net changes in working capital"],
  ["nonfinancial_asset_impairment", "非金融资产减值", "Total impairment loss on non-financial assets"],
  ["nonfinancial_ppe_impairment", "物业厂房设备减值", "[–-]\\s*Property, plant and equipment"],
  ["nonfinancial_inventory_impairment", "存货减值", "[–-]\\s*Inventories"],
  ["depreciation", "折旧总额", "Total depreciation"],
  ["share_based_payments", "利润表股份支付费用", "Share-based payments", true],
  ["equity_settled_share_based_payments", "职工成本附注权益结算股份支付费用", "Equity settled share-based payments\\s*\\(note 28\\)", true],
  ["enterprise_income_tax", "当期企业所得税", "Enterprise income tax"],
  ["prior_year_tax_adjustment", "往年税项拨备调整（转回为负数）", "\\(Over\\)/Under-provision in prior years"],
  ["deferred_tax", "递延税项", "Deferred tax"],
  ["current_tax", "当期税项合计", `Current tax:\\s*[–-]\\s*Enterprise income tax\\s+${numberToken}\\s+${numberToken}\\s*[–-]\\s*\\(Over\\)/Under-provision in prior years\\s+${numberToken}\\s+${numberToken}`]
];
const n = `(${numberToken})`;
const amount = (text: string) => /^[–—-]$/.test(text) ? 0 : Number(text.replace(/[(),]/g, "")) * (text.includes("(") ? -1 : 1);

function isExpenseNote(text: string, title: string) {
  return /NOTES TO INTERIM CONDENSED CONSOLIDATED FINANCIAL INFORMATION/i.test(title)
    && /The Group.s profit before tax is arrived at after charging:/.test(text)
    && /Cost of inventories sold/.test(text) && /Foreign exchange loss\/\(gain\), net/.test(text);
}

function header(s: InvestigationSource) {
  // A segment/note table with the same row label is not automatically the
  // consolidated statement. Only these already-read statement layouts carry
  // the group accounting scope used by this bounded transcription.
  // Attribution of comprehensive income includes OCI and is not the profit
  // attribution row, even when both statements contain the same NCI label.
  const comprehensive = /condensed consolidated statement of comprehensive income/i.test(s.text.slice(0, 240));
  const comparableIncome = /management discussion and analysis/i.test(s.text.slice(0, 200)) && /comparative figures/i.test(s.text)
    && /Profit for the period[\s\S]*?Attributable to:[\s\S]*?Equity holders of the Company[\s\S]*?Non-controlling interests/i.test(s.text);
  const statementTitle = s.text.slice(0, 350).replace(/\bc\s+onsolidated\b/ig, "consolidated").replace(/\bc\s+ash\s+f\s+lows\b/ig, "cash flows");
  const statement = !comprehensive && (/condensed consolidated (?:income )?statement|financial performance highlights/i.test(statementTitle) || comparableIncome);
  const fxNote = /notes to the unaudited interim/i.test(s.text) && /other gains\/\(losses\)|\(c\) Other items/i.test(s.text) && /Net foreign exchange/.test(s.text);
  const rdNote = /notes to the unaudited interim/i.test(s.text) && /Total research and development costs/.test(s.text);
  const taxNote = /notes to the unaudited interim/i.test(s.text) && /income tax expense/i.test(s.text)
    && /Current tax:/.test(s.text) && /Deferred tax/.test(s.text);
  const impairmentNote = /notes to the unaudited interim/i.test(s.text) && /Total impairment loss on non-financial assets/.test(s.text);
  const staffNote = /notes to the unaudited interim/i.test(s.text) && /\(b\) Staff costs/.test(s.text) && /Equity settled share-based payments/.test(s.text);
  const expenseNote = isExpenseNote(s.text, statementTitle);
  if (!statement && !fxNote && !rdNote && !taxNote && !impairmentNote && !staffNote && !expenseNote) return null;
  const period = s.text.match(/(Three|Six) months ended[\s\u3400-\u9fff]{1,40}30 June[\s\u3400-\u9fff]{1,40}(20\d{2})\s+(?:30 June\s+)?(20\d{2})/i);
  const combined = statement && s.text.match(/Three months ended\s+30 June\s+Six months ended\s+30 June\s+(20\d{2})\s+(20\d{2})\s+(20\d{2})\s+(20\d{2})/i);
  const unit = s.text.match(/RMB[’']\s*000|RMB[’']\s*Million|RMB in millions/i);
  if (!unit) return null;
  const periods = combined && combined[1] === combined[3] && combined[2] === combined[4] && Number(combined[1]) === Number(combined[2]) + 1
    ? [1, 2, 3, 4].map(i => ({ year: combined[i]!, start: i <= 2 ? "04-01" : "01-01", type: i <= 2 ? "quarter" : "interim" }))
    : period && Number(period[2]) === Number(period[3]) + 1 ? [period[2]!, period[3]!].map(year => ({ year, start: period[1]!.toLowerCase() === "six" ? "01-01" : "04-01", type: period[1]!.toLowerCase() === "six" ? "interim" : "quarter" })) : null;
  if (!periods) return null;
  return { periods, scale: /000/.test(unit[0]) ? 1000 : 1000000, periodHeader: combined ? combined[0] : period![0], unitHeader: unit[0],
    noteMetrics: statement ? null : [...(fxNote ? ["net_fx_loss_gain", "net_fx_gain_loss", "derivative_financial_gain_loss", "government_grants_subsidies", "asset_disposal_gain_loss"] : []),
      ...(rdNote ? ["research_development_costs", "development_amortisation", "direct_research_development_costs", "depreciation"] : []),
      ...(taxNote ? ["enterprise_income_tax", "prior_year_tax_adjustment", "deferred_tax", "current_tax"] : []),
      ...(impairmentNote ? ["nonfinancial_asset_impairment", "nonfinancial_ppe_impairment", "nonfinancial_inventory_impairment"] : []),
      ...(staffNote ? ["equity_settled_share_based_payments"] : []),
      ...(expenseNote ? ["inventory_cost", "service_cost", "inventory_write_down", "net_fx_loss_gain"] : [])] };
}
function fact(s: InvestigationSource, metric: string, label: string, value: number, scale: number,
  year: string, start: string, type: string, quote: string, periodHeader: string, unitHeader: string, restated = false): ReadFinancialFact {
  return { id: `${s.id}:${metric}:${year}:${type}`, metric, label, value, unitScale: scale, currency: "CNY",
    period: { start: `${year}-${start}`, end: `${year}-06-30`, type }, accountingScope: "consolidated", businessScope: "group",
    measurementBasis: "financial_statement", restated,
    source: { sourceId: s.id, pageNumber: s.pageNumber!, url: s.url!, quote, contentSha256: s.contentSha256, periodHeader, unitHeader } };
}
function operating(f: ReadFinancialFact, e: InvestigationEvidence): OperatingFact {
  return { id: f.id, symbol: e.symbol, membershipId: e.membershipId, membershipVersion: e.membershipVersion,
    metric: f.metric, value: f.value, unitScale: f.unitScale, currency: f.currency, unit: "currency", period: { kind: "duration", ...f.period, type: f.period.type === "interim" ? "interim" : "other" },
    accountingScope: f.accountingScope, businessScope: f.businessScope, measurementBasis: "financial_statement", category: "actual",
    comparability: "comparable", comparabilityReason: null, semanticType: "FACT", derivationMethod: "source_transcription", revision: 1,
    limitation: "本轮已读表格转录；不是正式研究Fact。费用按支出额表示。", source: {
      materialId: f.source.sourceId, revision: 1, contentFingerprint: f.source.contentSha256, sourceClassification: "official_pdf",
      verificationStatus: "BODY_READ", assertionVerificationStatus: "source_text_verified", sourceUrl: f.source.url,
      publishedAt: "", cutoffAt: f.period.end, validUntil: "", documentId: f.source.url, pageNumber: f.source.pageNumber,
      pageTextSha256: f.source.contentSha256, documentPdfSha256: "" } };
}
function addCalculation(out: ReadCalculation[], id: string, metric: string, label: string, value: number,
  inputs: ReadFinancialFact[], formula: string, unit = "currency", scale = 1) {
  if (Number.isFinite(value)) out.push({ id, metric, label, value, unit, unitScale: scale, currency: ["percent", "percentage_points"].includes(unit) ? "dimensionless" : inputs[0]!.currency,
    period: inputs[0]!.period, operandIds: inputs.map(f => f.id), formula });
}
function uniqueFact(facts: ReadFinancialFact[]) { return facts.length === 1 ? facts[0] : undefined; }
function addSignedChanges(out: ReadCalculation[], f: ReadFinancialFact, old: ReadFinancialFact | undefined, e: InvestigationEvidence, value: number) {
    if (old && ["gross_profit", "other_gains_losses", "net_fx_gain_loss", "derivative_financial_gain_loss", "government_grants_subsidies", "asset_disposal_gain_loss", "enterprise_income_tax", "prior_year_tax_adjustment", "deferred_tax", "current_tax",
      "inventory_cash_flow_effect", "trade_receivables_cash_flow_effect", "trade_bills_payables_cash_flow_effect", "other_payables_liabilities_accruals_cash_flow_effect"].includes(f.metric)) {
      addCalculation(out, `change:${f.id}`, f.metric + "_change", f.label + "同比算术差额", value - factNode(operating(old, e)).value!,
        [f, old], f.metric.endsWith("_cash_flow_effect")
          ? "本期经营现金流影响 − 上年同期间经营现金流影响；正为流入，负为占用，不是余额或实际付款总额"
          : "本期损益 − 上年同期间损益；保留正负方向，不推断经营原因");
    }
    if (old && f.metric === "net_fx_loss_gain") addCalculation(out, `contribution:${f.id}`, "net_fx_loss_gain_profit_contribution", "净汇兑损益同比算术贡献",
      factNode(operating(old, e)).value! - value, [f, old], "上年净汇兑损失（收益为负） − 本期净汇兑损失；仅算术差额，不推断现金性质或持续性");
}
function calculations(facts: ReadFinancialFact[], e: InvestigationEvidence): ReadCalculation[] {
  const out: ReadCalculation[] = [];
  for (const f of facts) {
    const a = operating(f, e), value = factNode(a).value!;
    for (const scale of [100000000]) addCalculation(out, `amount:${f.id}:${scale}`, f.metric, f.label, value / scale, [f], `原值 × ${f.unitScale} ÷ ${scale}`, "currency", scale);
    const previousFacts = facts.filter(p => p.metric === f.metric && Number(p.period.end.slice(0, 4)) === Number(f.period.end.slice(0, 4)) - 1 && sameBasis(a, operating(p, e), true));
    const old = previousFacts.length === 1 ? previousFacts[0] : undefined;
    addSignedChanges(out, f, old, e, value);
    if (old && old.value > 0 && !f.metric.endsWith("_cash_flow_effect")) {
      const previous = factNode(operating(old, e)).value!;
      addCalculation(out, `yoy:${f.id}`, f.metric + "_yoy", f.label + "同比", (value - previous) / previous * 100, [f, old], "(本期同口径金额 − 上年同期间金额) ÷ 上年金额 × 100", "percent");
      if (["revenue", "cost_of_sales", "profit_attributable_to_owners", "profit_before_tax", "operating_profit", "operating_cash_flow", "cash_generated_from_operations", "income_tax_paid", "income_tax_expense", "non_controlling_interests", "research_development_costs", "development_amortisation", "direct_research_development_costs", "noncash_adjustments", "working_capital_change", "nonfinancial_asset_impairment", "other_income_and_gains", "other_expenses", "research_development_expense", "selling_distribution_expenses", "administrative_expenses", "finance_costs"].includes(f.metric))
        addCalculation(out, `change:${f.id}`, f.metric + "_change", f.label + "同比金额差额", value - previous, [f, old], "本期同口径金额 − 上年同期间金额；仅算术差额，不推断原因");
      if (["income_tax_expense", "non_controlling_interests"].includes(f.metric)) addCalculation(out, `contribution:${f.id}`, f.metric + "_profit_contribution", f.label + "对归母同比变动的算术贡献", previous - value, [f, old], "上年支出/归属额 − 本期支出/归属额；仅算术贡献，不推断原因");
    }
    if (f.metric === "income_tax_expense") {
      const matches = facts.filter(p => p.metric === "profit_before_tax" && sameBasis(a, operating(p, e)));
      const pbt = matches.length === 1 ? matches[0] : undefined;
      if (pbt && pbt.value > 0) {
        const derived = deriveNode("effective_tax_rate", [a, operating(pbt, e)], "所得税费用 ÷ 同期税前利润 × 100", v => v[0]! / v[1]! * 100);
        if (derived) addCalculation(out, `tax-rate:${f.id}`, "effective_tax_rate", "整体实际税率", derived.value!, [f, pbt], derived.calculation!, "percent");
        const oldPbt = old && uniqueFact(facts.filter(p => p.metric === "profit_before_tax" && sameBasis(operating(old, e), operating(p, e))));
        if (old && oldPbt && oldPbt.value > 0) addCalculation(out, `tax-rate-change:${f.id}`, "effective_tax_rate_change", "整体实际税率同比百分点变动",
          value / factNode(operating(pbt, e)).value! * 100 - factNode(operating(old, e)).value! / factNode(operating(oldPbt, e)).value! * 100,
          [f, pbt, old, oldPbt], "本期税费 ÷ 税前利润 × 100 − 同期税费 ÷ 税前利润 × 100", "percentage_points");
      }
    }
    if (f.metric === "gross_profit") {
      const revenue = uniqueFact(facts.filter(p => p.metric === "revenue" && sameBasis(a, operating(p, e))));
      if (revenue && revenue.value > 0) addCalculation(out, `gross-margin:${f.id}`, "gross_margin", "同期间毛利率",
        value / factNode(operating(revenue, e)).value! * 100, [f, revenue], "同期间毛利 ÷ 收入 × 100", "percent");
      const oldRevenue = old && uniqueFact(facts.filter(p => p.metric === "revenue" && sameBasis(operating(old, e), operating(p, e))));
      if (revenue && old && oldRevenue && revenue.value > 0 && oldRevenue.value > 0)
        addCalculation(out, `gross-margin-change:${f.id}`, "gross_margin_change", "毛利率同比百分点变动", (value / factNode(operating(revenue, e)).value!
          - factNode(operating(old, e)).value! / factNode(operating(oldRevenue, e)).value!) * 100, [f, revenue, old, oldRevenue], "本期毛利 ÷ 本期收入 × 100 − 同期毛利 ÷ 同期收入 × 100", "percentage_points");
    }
    if (f.metric === "operating_cash_flow") {
      const sameStatement = (p: ReadFinancialFact) => sameBasis(a, operating(p, e))
        && p.source.sourceId === f.source.sourceId && p.source.contentSha256 === f.source.contentSha256
        && p.source.url === f.source.url && p.source.periodHeader === f.source.periodHeader
        && p.source.unitHeader === f.source.unitHeader;
      const generated = uniqueFact(facts.filter(p => p.metric === "cash_generated_from_operations" && sameStatement(p)));
      const tax = uniqueFact(facts.filter(p => p.metric === "income_tax_paid" && sameStatement(p)));
      const source = e.sources.find(s => s.id === f.source.sourceId && s.contentSha256 === f.source.contentSha256);
      const start = generated && source ? source.text.indexOf(generated.source.quote) : -1;
      const end = start >= 0 && source ? source.text.indexOf(f.source.quote, start) : -1;
      const bridgeText = start >= 0 && end > start ? source!.text.slice(start, end) : null;
      if (bridgeText && generated && tax) {
        const withInterest = /\bInterest received\b/i.test(bridgeText);
        const interest = withInterest ? uniqueFact(facts.filter(p => p.metric === "operating_interest_received" && sameStatement(p))) : undefined;
        const inputs = withInterest ? [generated, interest, tax] : [generated, tax];
        if (inputs.every((p): p is ReadFinancialFact => !!p)) {
          const formula = withInterest
            ? "同一经营现金流表：经营活动产生现金 + 已收利息 − 所得税现金支付"
            : "同一经营现金流表：经营活动产生现金 − 所得税现金支付";
          const result = deriveNode("operating_cash_tax_reconciliation", inputs.map(p => operating(p, e)), formula,
            v => withInterest ? v[0]! + v[1]! - v[2]! : v[0]! - v[1]!);
          if (result && Math.abs(result.value! - value) < 0.01) addCalculation(out, `cash-tax:${f.id}`, "operating_cash_tax_reconciliation", "经营现金流已披露总额桥接", result.value!, inputs, result.calculation!);
        }
      }
    }
    if (f.metric === "income_tax_paid" && old) addCalculation(out, `cash-tax-contribution:${f.id}`, "income_tax_paid_cash_contribution", "所得税现金支付对经营现金流同比变动的算术贡献", factNode(operating(old, e)).value! - value, [f, old], "上年所得税现金支付 − 本期所得税现金支付；不是利润表税费变化或因果解释");
    if (f.metric === "fcf_reported") {
      const inputs = ["operating_cash_flow", "capex_cash_payments", "content_cash_payments", "lease_cash_payments"].map(metric => uniqueFact(facts.filter(p => p.metric === metric && sameBasis(a, operating(p, e)))));
      if (inputs.every((p): p is ReadFinancialFact => !!p)) {
        const result = deriveNode("free_cash_flow", inputs.map(p => operating(p, e)), "经营现金流 − 资本开支付款 − 内容付款 − 租赁付款", v => v[0]! - v[1]! - v[2]! - v[3]!);
        if (result && Math.abs(result.value! - value) < 0.01) addCalculation(out, `fcf:${f.id}`, "free_cash_flow", "本季度自由现金流构成", result.value! / f.unitScale, inputs, result.calculation!, "currency", f.unitScale);
      }
    }
    if (f.metric === "fcf_excluding_compute_prepayments") {
      const actual = uniqueFact(facts.filter(p => p.metric === "fcf_reported" && p.currency === f.currency
        && p.accountingScope === f.accountingScope && p.businessScope === f.businessScope && JSON.stringify(p.period) === JSON.stringify(f.period)));
      if (actual) addCalculation(out, `pro-forma-difference:${f.id}`, "issuer_pro_forma_fcf_difference", "实际披露FCF与发行人调整口径的数学差额（非独立付款核实）",
        value - factNode(operating(actual, e)).value!, [f, actual], "发行人调整口径FCF − 实际披露FCF；仅口径数学差额，不证明预付款科目、现金性质或付款明细");
    }
  }
  const incomeAndGrantsNet = facts.filter(f => f.metric === "profit_before_tax")
    .flatMap(f => {
      const calculation = reconciledPbtBridge(facts, e, f.period)?.incomeAndGrantsNet.calculation;
      return calculation ? [calculation] : [];
    }).filter((calculation, index, values) => values.findIndex(other => other.id === calculation.id) === index);
  return [...out, ...threeExpenseSavings(facts, e), ...incomeAndGrantsNet];
}
function threeExpenseSavings(facts: ReadFinancialFact[], e: InvestigationEvidence): ReadCalculation[] {
  const out: ReadCalculation[] = [];
  const metrics = ["research_development_expense", "selling_distribution_expenses", "administrative_expenses"];
  for (const anchor of facts.filter(f => f.metric === metrics[0] && f.period.type === "interim")) {
    const currentYear = Number(anchor.period.end.slice(0, 4));
    const sameStatement = (f: ReadFinancialFact) => f.source.sourceId === anchor.source.sourceId
      && f.source.contentSha256 === anchor.source.contentSha256 && f.source.url === anchor.source.url
      && f.source.periodHeader === anchor.source.periodHeader && f.source.unitHeader === anchor.source.unitHeader
      && f.currency === anchor.currency && f.unitScale === anchor.unitScale
      && f.accountingScope === anchor.accountingScope && f.businessScope === anchor.businessScope
      && f.measurementBasis === anchor.measurementBasis;
    const current = metrics.map(metric => uniqueFact(facts.filter(f => f.metric === metric && sameStatement(f)
      && sameBasis(operating(anchor, e), operating(f, e)))));
    const previous = metrics.map(metric => uniqueFact(facts.filter(f => f.metric === metric && sameStatement(f)
      && Number(f.period.end.slice(0, 4)) === currentYear - 1
      && sameBasis(operating(anchor, e), operating(f, e), true))));
    if (!current.every((f): f is ReadFinancialFact => !!f) || !previous.every((f): f is ReadFinancialFact => !!f)) continue;
    for (const group of [current, previous]) {
      const id = `expense-total:${group[0]!.id}`;
      if (!out.some(c => c.id === id)) addCalculation(out, id, "three_expense_total", "研发、销售及行政三项费用同期间合计",
        group.reduce((sum, f) => sum + f.value * f.unitScale, 0), group,
        "同一合并利润表、同一期间：研发费用 + 销售及分销费用 + 行政费用；仅算术合计，不证明原因");
    }
    const operands = [...current, ...previous];
    const value = previous.reduce((sum, f) => sum + f.value * f.unitScale, 0)
      - current.reduce((sum, f) => sum + f.value * f.unitScale, 0);
    addCalculation(out, `expense-savings:${anchor.id}`, "three_expense_savings", "研发、销售及行政三项费用同比节省合计", value,
      operands, "同一合并利润表：上年同期三项费用合计 − 本期同期间三项费用合计；只表示算术抵消，不证明原因");
  }
  return out;
}
function assetCashPaymentResiduals(facts: ReadFinancialFact[], e: InvestigationEvidence): ReadCalculation[] {
  const out: ReadCalculation[] = [];
  for (const cash of facts.filter(f => f.metric === "operating_cash_flow")) {
    const payments = ["property_plant_equipment_payments", "intangible_asset_addition_payments"].map(metric => uniqueFact(facts.filter(f => f.metric === metric
      && sameBasis(operating(cash, e), operating(f, e)) && f.source.contentSha256 === cash.source.contentSha256)));
    if (!payments.every((f): f is ReadFinancialFact => !!f)) continue;
    const paid = payments.reduce((sum, f) => sum + f.value * f.unitScale, 0);
    addCalculation(out, `asset-payments:${cash.id}`, "two_asset_cash_payments", "购置物业厂房设备与新增无形资产两类现金付款合计", paid, payments, "同期间两类资产现金付款合计；不是全部资本支出或股东回报");
    addCalculation(out, `cash-after-asset-payments:${cash.id}`, "operating_cash_after_two_asset_payments", "经营现金减两类资产现金付款后的算术余量（非发行人自由现金流）", cash.value * cash.unitScale - paid,
      [cash, ...payments], "经营现金流净额 − 购置物业厂房设备现金付款 − 新增无形资产现金付款；不是完整自由现金流或可分配股东现金");
  }
  return out;
}
function shareRepurchaseCashTotals(facts: ReadFinancialFact[], e: InvestigationEvidence): ReadCalculation[] {
  const out: ReadCalculation[] = [];
  for (const f of facts.filter(f => f.metric === "share_cancellation_cash_payments")) {
    const treasury = uniqueFact(facts.filter(t => t.metric === "treasury_share_cash_payments"
      && sameBasis(operating(f, e), operating(t, e)) && t.source.contentSha256 === f.source.contentSha256));
    if (treasury) addCalculation(out, `share-repurchase-cash:${f.id}`, "share_repurchase_two_cash_rows", "回购注销与库存股购买两项现金付款合计",
      f.value * f.unitScale + treasury.value * treasury.unitScale, [f, treasury], "同一现金流续表的回购注销与库存股购买现金付款之和；不包括回购费用、股息或其他股东项目");
  }
  return out;
}
export function readInvestigationFinance(e: InvestigationEvidence): InvestigationFinance {
  const facts: ReadFinancialFact[] = [];
  for (const s of e.sources.filter(s => s.symbol === e.symbol && s.readStatus === "BODY_READ" && s.sourceType === "official_pdf" && s.pageNumber && s.url)) {
    // This note is a stock at two different dates, not H1 income or a YoY flow.
    const fairValueHeader = /FAIR VALUE MEASUREMENTS OF FINANCIAL INSTRUMENTS[\s\S]*?Fair value as at (30 June (20\d{2})) (31 December (20\d{2}))[\s\S]*?RMB[’']000 RMB[’']000/i.exec(s.text);
    const forward = fairValueHeader && /Financial liabilities at FVTPL\s+(Foreign exchange forward contracts not designated as hedging instruments\s+([\d,]+)\s+([\d,]+))\s+Level 2/i.exec(s.text);
    if (fairValueHeader && forward && Number(fairValueHeader[2]) === Number(fairValueHeader[4]) + 1) {
      for (const [column, year, date] of [[2, fairValueHeader[2]!, "06-30"], [3, fairValueHeader[4]!, "12-31"]] as const) {
        const f = fact(s, "fx_forward_fvtpl_liability", "非套期外汇远期合约公允价值负债", amount(forward[column]!), 1000, year, date, "instant", forward[1]!, fairValueHeader[0], "RMB’000");
        f.period.end = f.period.start;
        f.measurementBasis = "fair_value_liability_at_reporting_date";
        facts.push(f);
      }
    }
    const h = header(s);
    if (h) for (const [metric, label, pattern, magnitude] of rows) {
      if (h.noteMetrics && !h.noteMetrics.includes(metric)) continue;
      const cashReturnRow = ["share_cancellation_cash_payments", "treasury_share_cash_payments"].includes(metric);
      const cashMovement = metric.endsWith("_cash_flow_effect");
      const cashStatement = /CONDENSED CONSOLIDATED STATEMENT OF CASH FLOWS/i.test(s.text.slice(0, 350));
      if ((cashMovement || metric === "operating_interest_received") && !cashStatement) continue;
      const column = cashReturnRow || cashMovement ? `(${numberToken}|[–—-])` : n;
      const row = s.text.match(new RegExp(`${pattern}\\s+(?:\\d{1,2}(?:\\([a-z]\\))?\\s+)?${Array(h.periods.length).fill(column).join("\\s+")}`, "i"));
      if (!row) continue;
      if (metric === "operating_interest_received") {
        const generated = s.text.search(/(?<!Net )Cash generated from operations/i);
        const net = s.text.search(/Net cash (?:flows (?:generated )?|generated )from operating activities/i);
        if (generated < 0 || net <= generated || row.index! <= generated || row.index! >= net) continue;
      }
      for (const [i, period] of h.periods.entries()) {
        const v = amount(row[i + 1]!);
        const quote = metric === "direct_research_development_costs" ? row[0].replace(/^[–-]\s*/, "") : row[0];
        const f = fact(s, metric, label, magnitude ? Math.abs(v) : v, h.scale, period.year, period.start, period.type, quote, h.periodHeader, h.unitHeader, i % 2 === 1 && /restated/i.test(s.text));
        if (!facts.some(p => p.metric === f.metric && p.period.start === f.period.start && p.period.end === f.period.end && p.value * p.unitScale === f.value * f.unitScale)) facts.push(f);
      }
    }
    const recipe = s.text.match(/negative free cash flow of RMB([\d.,]+) billion for the second quarter of (20\d{2}), as net cash generated from operating activities of RMB([\d.,]+) billion was more than offset by capital expenditure payments of RMB([\d.,]+) billion, media content payments of RMB([\d.,]+) billion and lease liability payments of RMB([\d.,]+) billion/i);
    if (recipe) for (const [metric, label, index, sign] of [["fcf_reported", "披露季度自由现金流", 1, -1], ["operating_cash_flow", "季度经营现金流", 3, 1], ["capex_cash_payments", "季度资本开支付款", 4, 1], ["content_cash_payments", "季度内容付款", 5, 1], ["lease_cash_payments", "季度租赁付款", 6, 1]] as const) {
      const patterns = { fcf_reported: "negative free cash flow of RMB[\\d.,]+ billion for the second quarter of 20\\d{2}", operating_cash_flow: "net cash generated from operating activities of RMB[\\d.,]+ billion", capex_cash_payments: "capital expenditure payments of RMB[\\d.,]+ billion", content_cash_payments: "media content payments of RMB[\\d.,]+ billion", lease_cash_payments: "lease liability payments of RMB[\\d.,]+ billion" };
      const originalQuote = recipe[0].match(new RegExp(patterns[metric], "i"))![0];
      facts.push(fact(s, metric, label, amount(recipe[index]!) * sign, 1000000000, recipe[2]!, "04-01", "quarter", originalQuote, `second quarter of ${recipe[2]}`, "RMB billion"));
    }
    // The issuer's counterfactual is separate from actual FCF. Conversion
    // requires this exact selected passage, not another figure on the page.
    const excluding = recipe && s.text.match(/Excluding the prepayments for compute procurement, our free cash flow would have been RMB([\d.,]+) billion\./i);
    if (recipe && excluding) {
      const f = fact(s, "fcf_excluding_compute_prepayments", "发行人剔除算力预付款口径自由现金流", amount(excluding[1]!), 1000000000,
        recipe[2]!, "04-01", "quarter", excluding[0], `second quarter of ${recipe[2]}`, "RMB billion");
      f.measurementBasis = "issuer_disclosed_pro_forma";
      facts.push(f);
    }
  }
  return { facts, calculations: [...calculations(facts, e), ...shareRepurchaseCashTotals(facts, e), ...assetCashPaymentResiduals(facts, e)] };
}
// A statement bridge is offered only when its mutually exclusive statement
// rows reconcile to PBT in both columns. Note details have no additive place
// here until an independently evidenced mapping exists.
function reconciledPbtBridge(facts: ReadFinancialFact[], e: InvestigationEvidence, preferredPeriod?: ReadFinancialFact["period"]) {
  const roles: Array<[string, number]> = [
    ["gross_profit", 1], ["other_income_and_gains", 1], ["government_grants_subsidies", 1],
    ["research_development_expense", -1], ["selling_distribution_expenses", -1],
    ["administrative_expenses", -1], ["financial_asset_impairment_net", 1],
    ["amortised_cost_asset_disposal_loss", -1], ["other_expenses", -1], ["finance_costs", -1]
  ];
  const mainStatement = (sourceId: string) => {
    const source = e.sources.find(s => s.id === sourceId && s.symbol === e.symbol && s.readStatus === "BODY_READ" && s.sourceType === "official_pdf");
    const title = source?.text.slice(0, 220) ?? "";
    const columnUnits = [...(source?.text.slice(0, 350) ?? "").matchAll(/(?:RMB|HKD|USD)[’']\s*(?:000|Million)/gi)]
      .map(match => match[0].replace(/\s+/g, "").toUpperCase());
    return /(?:interim\s+)?condensed consolidated (?:statement of profit or loss|income statement)/i.test(title)
      && !/notes to|segment|comprehensive income/i.test(title)
      && new Set(columnUnits).size <= 1;
  };
  const candidates = facts.filter(f => f.metric === "profit_before_tax" && f.currency === "CNY"
    && f.period.type !== "instant" && mainStatement(f.source.sourceId));
  const latestEnd = candidates.reduce((end, f) => f.period.end > end ? f.period.end : end, "");
  const target = preferredPeriod ?? (candidates.filter(f => f.period.end === latestEnd).length === 1
    ? candidates.find(f => f.period.end === latestEnd)?.period : undefined);
  const selected = candidates.filter(f => target && f.period.start === target.start && f.period.end === target.end && f.period.type === target.type);
  if (selected.length !== 1) return null;
  for (const currentPbt of selected) {
    const statement = (metric: string, year: number) => facts.filter(f => f.metric === metric
      && Number(f.period.end.slice(0, 4)) === year && f.period.type === currentPbt.period.type
      && f.period.start.slice(4) === currentPbt.period.start.slice(4)
      && f.period.end.slice(4) === currentPbt.period.end.slice(4)
      && f.currency === currentPbt.currency && f.unitScale === currentPbt.unitScale
      && f.accountingScope === currentPbt.accountingScope && f.businessScope === currentPbt.businessScope
      && f.measurementBasis === currentPbt.measurementBasis
      && f.source.sourceId === currentPbt.source.sourceId
      && f.source.contentSha256 === currentPbt.source.contentSha256
      && f.source.periodHeader === currentPbt.source.periodHeader && f.source.unitHeader === currentPbt.source.unitHeader);
    const currentYear = Number(currentPbt.period.end.slice(0, 4));
    const prior = statement("profit_before_tax", currentYear - 1);
    if (prior.length !== 1) continue;
    const pairs = roles.map(([metric, sign]) => ({ metric, sign, current: statement(metric, currentYear), prior: statement(metric, currentYear - 1) }));
    if (pairs.some(p => p.current.length !== 1 || p.prior.length !== 1)) continue;
    if (![currentPbt, prior[0]!, ...pairs.flatMap(p => [p.current[0]!, p.prior[0]!])]
      .every(f => Number.isFinite(f.value) && Number.isFinite(f.unitScale) && f.unitScale > 0)) continue;
    const signedSum = (column: "current" | "prior") => pairs.reduce((total, p) => total + p.sign * p[column][0]!.value, 0);
    if (Math.abs(signedSum("current") - currentPbt.value) > 0.000001
      || Math.abs(signedSum("prior") - prior[0]!.value) > 0.000001) continue;
    const tax = [statement("income_tax_expense", currentYear), statement("income_tax_expense", currentYear - 1)];
    const group = [statement("profit_for_period", currentYear), statement("profit_for_period", currentYear - 1)];
    const owners = [statement("profit_attributable_to_owners", currentYear), statement("profit_attributable_to_owners", currentYear - 1)];
    const nci = [statement("non_controlling_interests", currentYear), statement("non_controlling_interests", currentYear - 1)];
    const afterTax = tax.every(rows => rows.length === 1) && group.every(rows => rows.length === 1)
      && owners.every(rows => rows.length === 1)
      && [0, 1].every(i => Math.abs(([currentPbt, prior[0]!][i]!.value - tax[i]![0]!.value) - group[i]![0]!.value) < 0.000001
        && (nci[i]!.length === 1 ? Math.abs(group[i]![0]!.value - owners[i]![0]!.value - nci[i]![0]!.value) < 0.000001
          : Math.abs(group[i]![0]!.value - owners[i]![0]!.value) < 0.000001))
      ? { taxExpenseReductionContributionInCnyYi: (tax[1]![0]!.value - tax[0]![0]!.value) * currentPbt.unitScale / 100000000,
          ownerProfitChangeInCnyYi: (owners[0]![0]!.value - owners[1]![0]!.value) * currentPbt.unitScale / 100000000 } : null;
    const otherIncome = pairs.find(p => p.metric === "other_income_and_gains")!;
    const grants = pairs.find(p => p.metric === "government_grants_subsidies")!;
    const subtotalInputs = [otherIncome.current[0]!, otherIncome.prior[0]!, grants.current[0]!, grants.prior[0]!];
    const subtotalValue = ((subtotalInputs[0]!.value - subtotalInputs[1]!.value)
      + (subtotalInputs[2]!.value - subtotalInputs[3]!.value)) * currentPbt.unitScale;
    const subtotalCalculations: ReadCalculation[] = [];
    addCalculation(subtotalCalculations, `pbt-income-grants-net:${currentPbt.id}`,
      "other_income_and_grants_net_profit_contribution", "其他收入及收益与政府补助对税前利润同比变动的净算术贡献",
      subtotalValue, subtotalInputs,
      "同一主利润表：(本期其他收入及收益 − 同期其他收入及收益) + (本期政府补助 − 同期政府补助)；不包含附注汇兑或未证实重叠项");
    const subtotalCalculation = subtotalCalculations[0];
    if (!subtotalCalculation) continue;
    return { period: currentPbt.period, statementSourceId: currentPbt.source.sourceId,
      pbtChangeInCnyYi: (currentPbt.value - prior[0]!.value) * currentPbt.unitScale / 100000000,
      afterTax,
      incomeAndGrantsNet: {
        calculation: subtotalCalculation,
        reference: { calculationId: subtotalCalculation.id },
        signedPbtChangeInCnyYi: subtotalValue / 100000000,
        direction: subtotalValue > 0 ? "supports_pbt" : subtotalValue < 0 ? "drags_pbt" : "neutral",
        operands: subtotalInputs.map(f => ({ factId: f.id, metric: f.metric, period: f.period,
          amountInCnyYi: f.value * f.unitScale / 100000000 }))
      },
      components: pairs.map(p => ({ metric: p.metric,
        signedPbtChangeInCnyYi: p.sign * (p.current[0]!.value - p.prior[0]!.value) * currentPbt.unitScale / 100000000 })) };
  }
  return null;
}
// Transport each repeated source layout once. Every fact, quote, calculation,
// period and operand survives; the full signed/UI projection remains unchanged.
export function financialModelInput(e: InvestigationEvidence, question?: string, includeBridgeDetails = true) {
  const read = readInvestigationFinance(e);
  const wanted = new Set<string>();
  // A scoped note question needs its own figures, not every unrelated account.
  // The signed/displayed footer still uses the unabridged read result.
  if (question && e.mode === "earnings_quality" && !/收入|营收/.test(question)) {
    if (/汇兑|外汇|币种/.test(question)) ["net_fx_loss_gain", "net_fx_gain_loss", "other_gains_losses", "derivative_financial_gain_loss", "fx_effect_on_cash", "fx_forward_fvtpl_liability"].forEach(m => wanted.add(m));
    if (/税费|税率|所得税/.test(question)) ["profit_before_tax", "income_tax_expense", "enterprise_income_tax", "prior_year_tax_adjustment", "deferred_tax", "current_tax"].forEach(m => wanted.add(m));
    if (/少数股东|NCI/i.test(question)) ["non_controlling_interests", "profit_attributable_to_owners"].forEach(m => wanted.add(m));
  }
  const selectedFacts = wanted.size ? read.facts.filter(f => wanted.has(f.metric)) : read.facts;
  const ids = new Set(selectedFacts.map(f => f.id));
  // Avoid resending a second calculation row for every display conversion.
  // Carry the exact CNY-亿元 amount beside the original instead: real drafts
  // confused billion with 亿 even when the RMB000 header remained present.
  const full = { facts: selectedFacts, calculations: read.calculations.filter(c => c.operandIds.every(id => ids.has(id)) && (!question || !c.id.startsWith("amount:"))) };
  const sourceMetadata: Array<Omit<ReadFinancialFact["source"], "quote">> = [];
  const factMetadata: Array<Pick<ReadFinancialFact, "unitScale" | "currency" | "accountingScope" | "businessScope" | "measurementBasis" | "restated">> = [];
  const periods: ReadFinancialFact["period"][] = [];
  const calculationMetadata: Array<Omit<ReadCalculation, "id" | "value" | "operandIds" | "period">> = [];
  const periodIndex = (period: ReadFinancialFact["period"]) => {
    let index = periods.findIndex(p => JSON.stringify(p) === JSON.stringify(period));
    if (index < 0) { index = periods.length; periods.push(period); }
    return index;
  };
  const facts = full.facts.map(({ source, period, unitScale, currency, accountingScope, businessScope, measurementBasis, restated, ...fact }) => {
    const factContext = { unitScale, currency, accountingScope, businessScope, measurementBasis, restated };
    let contextIndex = factMetadata.findIndex(m => JSON.stringify(m) === JSON.stringify(factContext));
    if (contextIndex < 0) { contextIndex = factMetadata.length; factMetadata.push(factContext); }
    const { quote, ...metadata } = source;
    let metadataIndex = sourceMetadata.findIndex(s => JSON.stringify(s) === JSON.stringify(metadata));
    if (metadataIndex < 0) { metadataIndex = sourceMetadata.length; sourceMetadata.push(metadata); }
    return { ...fact, amountInCnyYi: currency === "CNY" ? fact.value * unitScale / 100000000 : undefined, contextIndex,
      periodIndex: periodIndex(period), source: { sourceId: source.sourceId, quote, metadataIndex } };
  });
  const compactCalculations = full.calculations.map(({ id, value, operandIds, period, ...metadata }) => {
    let metadataIndex = calculationMetadata.findIndex(m => JSON.stringify(m) === JSON.stringify(metadata));
    if (metadataIndex < 0) { metadataIndex = calculationMetadata.length; calculationMetadata.push(metadata); }
    // The calculation id itself remains citeable in every completion. The
    // duplicate wrapper is kept for first-answer compatibility and omitted
    // only where a signed prior answer needs the follow-up byte budget.
    return { id, ...(includeBridgeDetails ? { reference: { calculationId: id } } : {}), value,
      amountInCnyYi: metadata.unit === "currency" && metadata.currency === "CNY" ? value * metadata.unitScale / 100000000 : undefined,
      operandIds, periodIndex: periodIndex(period), metadataIndex };
  });
  const primary = primaryFinancialComparison(full);
  const primaryComparison = question && primary ? { period: primary.period, rows: primary.rows.map(row => ({ metric: row.current.metric,
    currentFactId: row.current.id, previousFactId: row.previous.id, growthCalculationId: row.growth.id })) } : primary;
  const comparisonMetrics = /收入|营收/.test(question ?? "") && /利润|盈利|毛利/.test(question ?? "")
    ? ["revenue_yoy", "gross_profit_change", "gross_margin_change", "profit_attributable_to_owners_yoy", "profit_before_tax_change",
      "net_fx_loss_gain_profit_contribution", "other_expenses_change", "income_tax_expense_profit_contribution",
      "trade_receivables_cash_flow_effect_change", "inventory_cash_flow_effect_change", "three_expense_savings"] : [];
  const latestEnd = periods.reduce((latest, period) => period.end > latest ? period.end : latest, "");
  const latestPeriods = periods.filter(period => period.end === latestEnd)
    .filter((period, index, values) => values.findIndex(other => other.start === period.start
      && other.end === period.end && other.type === period.type) === index);
  const comparisonPeriod = primary?.period ?? (latestPeriods.length === 1 ? latestPeriods[0] : undefined);
  // A single exact calculation reference selects every operand. Count the
  // distinct original rows after expansion, not the number of reference IDs.
  const comparisonSelections = comparisonMetrics.flatMap(metric => {
    const calc = full.calculations.find(c => c.metric === metric && comparisonPeriod
      && c.period.start === comparisonPeriod.start && c.period.end === comparisonPeriod.end && c.period.type === comparisonPeriod.type);
    if (!calc) return [];
    const originalRows = new Set(calc.operandIds.map(id => {
      const fact = selectedFacts.find(f => f.id === id)!;
      return JSON.stringify([fact.source.sourceId, fact.source.quote]);
    }));
    return [{ metric, reference: { calculationId: calc.id }, operandIds: calc.operandIds, originalRowCount: originalRows.size }];
  });
  // These are document layers, not inferred parent/child accounting mappings.
  // A note explains a statement amount; it is not automatically an additional
  // additive profit driver. Keep unknown reconciliation explicitly unknown.
  const readingLayers = e.sources.filter(s => s.symbol === e.symbol && s.readStatus === "BODY_READ")
    .map(source => {
      const title = source.text.slice(0, 350).replace(/\s+/g, " ");
      const role = /statement of (?:profit or loss|income)/i.test(title) && !/comprehensive income/i.test(title)
        ? "income_statement" : /statement of cash flows/i.test(title) ? "cash_flow_statement"
          : /notes to/i.test(title) ? "note_detail" : "other_read_material";
      return { sourceId: source.id, role, factIds: selectedFacts.filter(f => f.source.sourceId === source.id).map(f => f.id) };
    }).filter(layer => layer.factIds.length > 0);
  const profitBridge = includeBridgeDetails && question && /利润|盈利|税前/.test(question) ? reconciledPbtBridge(selectedFacts, e, primary?.period) : null;
  return { primaryComparison, comparisonSelections, profitBridge, facts, factMetadata, calculations: compactCalculations, calculationMetadata, sourceMetadata, periods, readingLayers };
}

/** Resolve an explicitly selected read item to its unchanged original row.
 * A calculation selects all operands. Missing/foreign/unread IDs fail; this
 * never repairs a literal quote or supplies an unselected source. */
export function resolveFinancialCitations(value: unknown, e: InvestigationEvidence): unknown {
  const read = readInvestigationFinance(e), input = financialModelInput(e, e.currentQuestion);
  const facts = new Map(read.facts.map(f => [f.id, f]));
  const allowed = new Set(input.facts.map(f => f.id));
  const calculations = new Map(input.calculations.map(c => [c.id, c]));
  // Only this completion's original factual array can be selected. Never use
  // display aliases, previous turns or a fact's generated text as evidence.
  const root = value as { facts?: unknown[] } | null;
  const currentFacts = Array.isArray(root?.facts) ? root.facts : [];
  const containsIndex = (item: unknown): boolean => !!item && typeof item === "object"
    && (Object.hasOwn(item, "factIndex") || Object.values(item).some(containsIndex));
  if (currentFacts.some(containsIndex)) throw new Error("FINANCIAL_CITATION_FACT_INDEX_CHAIN_FORBIDDEN");
  const selection = (item: unknown): Array<{ sourceId: string; quote: string }> => {
    const ref = item as { factId?: string; calculationId?: string; factIndex?: number };
    const keys = Object.keys(ref ?? {});
    if (Object.hasOwn(ref, "factIndex")) {
      // This lane retains and validates every original fact atomically; older
      // responses that filter unsupported facts cannot use cross-references.
      if (e.mode !== "earnings_quality" || !e.reasoningContext || !("investigation" in e) || !e.investigation || keys.length !== 1
        || !Number.isInteger(ref.factIndex) || ref.factIndex! < 0 || ref.factIndex! >= currentFacts.length) throw new Error("FINANCIAL_CITATION_FACT_INDEX_INVALID");
      const fact = currentFacts[ref.factIndex!] as { classification?: string; basis?: unknown[] } | null;
      if (!fact || !["FACT", "SOURCE_SUPPORTED"].includes(fact.classification ?? "") || !Array.isArray(fact.basis) || !fact.basis.length) throw new Error("FINANCIAL_CITATION_FACT_INDEX_NOT_FACT");
      return fact.basis.flatMap(b => {
        if (!b || typeof b !== "object") throw new Error("FINANCIAL_CITATION_REF_INVALID_SHAPE");
        if ("factId" in b || "calculationId" in b) return selection(b);
        const literal = b as { sourceId?: string; quote?: string };
        const source = e.sources.find(s => s.id === literal.sourceId);
        const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
        if (Object.keys(b).sort().join() !== "quote,sourceId" || typeof literal.quote !== "string"
          || literal.quote.length < 12 || literal.quote.length > 500 || !source || source.symbol !== e.symbol
          || source.readStatus !== "BODY_READ" || source.sourceType === "official_search"
          || !normalize(source.text).includes(normalize(literal.quote))) throw new Error("FINANCIAL_CITATION_FACT_INDEX_INVALID_ORIGINAL");
        return [{ sourceId: source.id, quote: literal.quote }];
      });
    }
    if (e.mode !== "earnings_quality" || keys.length !== 1 || !["factId", "calculationId"].includes(keys[0]!)) throw new Error("FINANCIAL_CITATION_REF_INVALID_SHAPE");
    // Providers sometimes place an exact calculation ID under factId. Its
    // namespace and current allowlist already identify all operands uniquely.
    // Resolve that selected calculation without altering any prose or quote;
    // unknown IDs, mixed shapes and references outside this question still fail.
    const ids = typeof ref.factId === "string" ? facts.has(ref.factId) ? [ref.factId] : calculations.get(ref.factId)?.operandIds
      : typeof ref.calculationId === "string" ? calculations.get(ref.calculationId)?.operandIds : undefined;
    if (!ids?.length || ids.some(id => !allowed.has(id) || !facts.has(id))) throw new Error(`FINANCIAL_CITATION_REF_UNKNOWN_OR_UNREAD_${ref.factId ?? ref.calculationId}`);
    return ids.map(id => ({ sourceId: facts.get(id)!.source.sourceId, quote: facts.get(id)!.source.quote }));
  };
  const walk = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(walk);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item).map(([key, child]) => {
      if (!["basis", "supportingEvidence", "contradictingEvidence"].includes(key) || !Array.isArray(child)) return [key, walk(child)];
      const isReference = (b: unknown) => b && typeof b === "object" && ("factId" in b || "calculationId" in b || "factIndex" in b);
      if (!child.some(isReference)) return [key, child];
      const expanded = child.flatMap(b => isReference(b) ? selection(b) : [b]);
      return [key, expanded.filter((b, i) => expanded.findIndex(x => JSON.stringify(x) === JSON.stringify(b)) === i)];
    }));
  };
  return walk(value);
}

/** Select the newest complete, comparable statement frame. The values and
 * quotes are existing transcriptions, not an AI conclusion or a new Fact. */
export function primaryFinancialComparison(data: InvestigationFinance) {
  const metrics = ["revenue", "profit_attributable_to_owners", "operating_cash_flow"];
  const candidates = data.facts.filter(f => f.metric === "revenue").sort((a, b) => b.period.end.localeCompare(a.period.end));
  for (const anchor of candidates) {
    const comparable = (f: ReadFinancialFact, previous = false) => f.currency === anchor.currency && f.accountingScope === anchor.accountingScope
      && f.businessScope === anchor.businessScope && f.measurementBasis === anchor.measurementBasis && (previous || f.restated === anchor.restated)
      && f.period.type === anchor.period.type && f.period.start.slice(4) === anchor.period.start.slice(4) && f.period.end.slice(4) === anchor.period.end.slice(4)
      && Number(f.period.end.slice(0, 4)) === Number(anchor.period.end.slice(0, 4)) - (previous ? 1 : 0);
    const selected = metrics.map(metric => {
      const current = uniqueFact(data.facts.filter(f => f.metric === metric && comparable(f)));
      const previous = uniqueFact(data.facts.filter(f => f.metric === metric && comparable(f, true)));
      const growth = current && data.calculations.find(c => c.metric === metric + "_yoy" && c.operandIds[0] === current.id && c.operandIds[1] === previous?.id);
      return current && previous && growth ? { current, previous, growth } : undefined;
    });
    if (selected.every((row): row is NonNullable<typeof row> => !!row) && new Set(selected.map(row => row.previous.restated)).size === 1)
      return { period: anchor.period, rows: selected };
  }
  return null;
}

export function financialNumberForms(e: InvestigationEvidence, basis: Array<{sourceId: string; quote: string}>): string[] {
  return financialNumberEvidence(e, basis).forms;
}
export function financialNumberEvidence(e: InvestigationEvidence, basis: Array<{sourceId: string; quote: string}>) {
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  // Keep provider originals separate from issuer facts and calculated comparisons.
  // Selection requires the exact structured row inside this field's literal quote.
  const selectedProviderFacts = e.sources.filter(s => s.sourceType === "provider_financial_statement"
    && s.symbol === e.symbol && s.readStatus === "BODY_READ").flatMap(s =>
    (s.providerFinancialValues ?? []).filter(v => ["CNY","HKD","USD"].includes(v.currencyCode)
      && basis.some(b => b.sourceId === s.id && normalize(b.quote).includes(normalize(v.quote))))
      .flatMap(v => {
        const raw=safeProviderDecimal(v.rawValue);
        return raw===null?[]:[{metric:v.metric,unit:"currency" as const,unitScale:1,
          period:{type:v.financialType === "Q6" ? "interim" as const : "annual" as const,
          start:v.periodStart ?? v.periodEnd,end:v.periodEnd},currency:v.currencyCode,
          value:Number(raw),quote:v.quote,sourceId:s.id}];
      }));
  // Evaluate selected rows before deduplication. An identical metric on another
  // page must neither validate an unrelated quote nor invalidate its own quote.
  const read = e.sources.filter(s => basis.some(b => b.sourceId === s.id)).map(s => readInvestigationFinance({ ...e, sources: [s] }));
  const selected = read.flatMap(d => d.facts)
    .filter(f => basis.some(b => b.sourceId === f.source.sourceId && normalize(b.quote).includes(normalize(f.source.quote))));
  const available = selected.filter((f, i) => selected.findIndex(p => p.metric === f.metric && p.period.start === f.period.start
    && p.period.end === f.period.end && p.value * p.unitScale === f.value * f.unitScale) === i);
  // The statement may confirm a cash bridge through its result row, but a
  // calculation cites its operands. Do not require a third quote for a result
  // already reproduced from the two selected original inputs.
  const selectedIds = new Set(selected.map(f => f.id));
  const derived = read.flatMap(d => d.calculations).filter(c => c.operandIds.every(id => selectedIds.has(id)));
  const selectedCalculations = [...calculations(available, e), ...derived];
  const amounts = available.map(f => ({ currency: f.currency, value: f.value * f.unitScale }))
    .concat(selectedCalculations.filter(c => c.unit === "currency").map(c => ({ currency: c.currency, value: c.value * c.unitScale })))
    .concat(selectedProviderFacts.map(f => ({currency:f.currency,value:f.value})));
  const values = selectedCalculations
    .flatMap(c => c.unit === "currency" ? [1, 1000, 1000000, 100000000, 1000000000].map(scale => c.value * c.unitScale / scale) : [c.value])
    .concat(available.flatMap(f => [1, 1000, 1000000, 100000000, 1000000000].map(scale => f.value * f.unitScale / scale)))
    .concat(selectedProviderFacts.flatMap(f => [1, 1000, 1000000, 100000000, 1000000000].map(scale => f.value / scale)));
  return { forms: values.flatMap(v => Array.from({ length: 7 }, (_, i) => String(Number(Math.abs(v).toFixed(i))))),
    amounts, selectedFacts: available, selectedCalculations, selectedProviderFacts };
}

type FinancialAssertionScope = { claim: string; context: string };
const directionalPronounGrowth = /(?:前者|后者)[^，,。；;]{0,12}(?:增速|增幅|增长速度|增长幅度)[^，,。；;]{0,12}(更快|更慢|高于|低于|快于|慢于)/;

// Keep a period or an omitted subject from the same sentence, but do not let
// a separate caveat negate an earlier affirmative financial assertion.
function financialAssertionScopes(text: string): FinancialAssertionScope[] {
  const scopes: FinancialAssertionScope[] = [];
  const negation = /是否|能否|不能|无法|不足以|不代表|不意味着|并非|不是|未必|不可|不应|不得|未证实|未经证实|尚不能|不等于/;
  const relation = /增速|增幅|增长速度|增长幅度|同步|一致|高于|低于|快于|慢于|更快|更慢|叠加|相加|合计|共同/;
  for (const sentence of text.split(/[。；;\n]/)) {
    let context = "";
    for (const contrast of sentence.split(/(?=但|然而|不过|却(?:不能|无法|不足以|不代表|不意味着|未必))/)) {
      const pieces = contrast.split(/([，,])/);
      let claim = pieces[0] ?? "";
      for (let index = 2; index < pieces.length; index += 2) {
        const next = pieces[index] ?? "", separator = pieces[index - 1] ?? "";
        const boundary = (negation.test(next) && relation.test(claim))
          || (negation.test(claim) && relation.test(next));
        if (boundary) {
          if (claim.trim()) scopes.push({ claim: claim.trim(), context });
          context += claim + separator;
          claim = next;
        } else claim += separator + next;
      }
      if (claim.trim()) scopes.push({ claim: claim.trim().replace(/^[，,]\s*/, ""), context });
      context += claim;
    }
  }
  return scopes;
}

function negatesComparisonAssertion(claim: string): boolean {
  if (/^(?:若|如果)/.test(claim.trim())) return true;
  const relation = "(?:高于|低于|快于|慢于|更快|更慢|同步|一致|不同|比较|接近)";
  return new RegExp(`(?:是否|能否)[^，,。；;]{0,60}${relation}`).test(claim)
    || new RegExp(`(?:不能|无法|不足以|不代表|不意味着|未必|不可|不应|尚不能|未证实|未经证实)(?:据此|由此|直接|仅凭|简单)?(?:说|说明|证明|确认|判断|认为|认定|推断|得出|比较|称为)[^，,。；;]{0,60}${relation}`).test(claim)
    || new RegExp(`(?:并非|不是)[^，,。；;]{0,40}${relation}`).test(claim)
    || /(?:不能|无法|未必)[^，,。；;]{0,10}(?:同步|一致)/.test(claim);
}

function assertsOtherExpensesFxAddition(scope: FinancialAssertionScope): boolean {
  const subject = scope.context + scope.claim;
  if (!/(?:其他费用|其他开支)/.test(subject) || !/汇兑/.test(subject)) return false;
  const addition = /(?:合计|总计|共同)[^。；;]{0,45}\d+(?:\.\d+)?\s*(?:十亿|百万|亿|万|千)?(?:港元|美元|元)|共同对税前利润形成(?:独立)?(?:拖累|负向贡献)|叠加(?=[^。；;]{0,40}(?:其他费用|其他开支|汇兑|拖累|压低|影响|形成|构成|导致|造成))|共同(?:导致|造成|形成|构成|压低|拖累|推低)|(?:直接|重复)?相加/;
  const matched = addition.exec(scope.claim);
  if (!matched) return false;
  const prefix = scope.claim.slice(0, matched.index);
  return !/(?:不能|不可|不得|不应|无法|尚不能|未能)(?:把|将)?[^，,。；;]{0,60}$/.test(prefix)
    && !/(?:未证实|未经证实)[^，,。；;]{0,30}(?:可|能|可以|能够)[^，,。；;]{0,15}$/.test(prefix)
    && !/不(?:直接|重复)?$/.test(prefix);
}

/** A true comparison still needs every compared row in this field's own
 * citations. Other paragraphs and other periods do not supply those operands. */
export function financialComparisonCitationErrors(text: string, e: InvestigationEvidence, selected: ReadFinancialFact[]): string[] {
  const cashPeriodErrors: string[] = [];
  const forwardFlowClaim = text.split(/[。；;\n]/).some(statement => {
    const claim = statement.replace(/(?:而非|不是|不属于|不能称为)(?:上半年|同比|上年同期)(?:损益|盈利|收入)?/g, "");
    return /(?:上半年|上年同期)[^，,。；;]{0,40}远期合约.*(?:公允价值|金融负债)|远期合约.*(?:公允价值|金融负债).*同比/.test(claim);
  });
  if (forwardFlowClaim && selected.some(f => f.metric === "fx_forward_fvtpl_liability")) cashPeriodErrors.push("FX_FORWARD_FAIR_VALUE_IS_AN_INSTANT_BALANCE_NOT_H1_OR_YOY_INCOME");
  const cashYear = text.match(/(20\d{2})年/)?.[1];
  const cashType = /上半年|半年|H1/i.test(text) ? "interim" : /季度|Q2/i.test(text) ? "quarter" : null;
  for (const [metric, pattern] of [["share_cancellation_cash_payments", /回购注销|股份回购注销/], ["treasury_share_cash_payments", /库存股/]] as const) {
    if (cashYear && cashType && pattern.test(text) && selected.some(f => f.metric === metric)
      && !selected.some(f => f.metric === metric && f.period.type === cashType && f.period.end.startsWith(cashYear))) {
      cashPeriodErrors.push(`CASH_RETURN_PERIOD_DOES_NOT_MATCH_SELECTED_ORIGINAL_${metric}`);
    }
  }
  const metrics = [
    { id: "revenue", pattern: /收入|营收/ },
    { id: "profit_attributable_to_owners", pattern: /法定归母(?:净)?利润|法定(?:净)?利润|(?<!核心)(?<!非IFRS)归母(?:净)?利润/ },
    { id: "operating_cash_flow", pattern: /经营(?:活动)?现金流/ }
  ];
  const read = readInvestigationFinance(e), frame = primaryFinancialComparison(read)?.period;
  const errors = [...cashPeriodErrors];
  for (const scope of financialAssertionScopes(text)) {
    const claim = scope.claim;
    if (negatesComparisonAssertion(claim)) continue;
    const relation = /高于|低于|快于|慢于|更快|更慢|不同|差异|一致|同步|居中|偏低/;
    const growth = /增速|增长速度|增长幅度|增幅/;
    if (!relation.test(claim) || !(growth.test(claim) || growth.test(scope.context))) continue;
    const costComparison = /销售成本/.test(claim) || /后者|前者|其|该项/.test(claim) && /销售成本/.test(scope.context);
    const availableMetrics = costComparison ? [...metrics, { id: "cost_of_sales", pattern: /销售成本/ }] : metrics;
    let named = /三项|三者|三指标|居中/.test(scope.context + claim) ? metrics : availableMetrics.filter(m => m.pattern.test(claim));
    if (named.length < 2 && scope.context) named = availableMetrics.filter(m => m.pattern.test(scope.context + claim));
    if (named.length < 2) {
      if (directionalPronounGrowth.test(claim))
        errors.push("FINANCIAL_COMPARISON_SUBJECT_AMBIGUOUS");
      continue;
    }
    const contextPeriod = [...scope.context.matchAll(/上半年|半年|H1|季度|Q2/gi)].at(-1)?.[0] ?? "";
    const type = /上半年|半年|H1/i.test(claim) ? "interim" : /季度|Q2/i.test(claim) ? "quarter"
      : /上半年|半年|H1/i.test(contextPeriod) ? "interim" : /季度|Q2/i.test(contextPeriod) ? "quarter" : frame?.type;
    const year = claim.match(/(20\d{2})年/)?.[1]
      ?? [...scope.context.matchAll(/(20\d{2})年/g)].at(-1)?.[1] ?? frame?.end.slice(0, 4);
    if (!type || !year) { errors.push("COMPARISON_CITATION_PERIOD_UNRESOLVED"); continue; }
    const ownCitationErrors = named.filter(m => ![Number(year), Number(year) - 1].every(y => selected.some(f => f.metric === m.id
      && f.period.type === type && f.period.end.startsWith(String(y)))))
      .map(m => {
        const rows = read.facts.filter(f => f.metric === m.id && f.period.type === type && f.period.end.startsWith(year))
          .map(f => ({ sourceId: f.source.sourceId, quote: f.source.quote }));
        return `COMPARISON_MISSING_OWN_SELECTED_${year}_${type}_${m.id}_current_and_comparative_rows_select_${JSON.stringify(rows)}`;
      });
    if (costComparison && ownCitationErrors.length === 0) {
      const selectedIds = new Set(selected.map(f => f.id));
      const calculations = named.map(m => read.calculations.filter(c => c.metric === `${m.id}_yoy`
        && c.period.type === type && c.period.end.startsWith(year)
        && c.operandIds.length === 2 && c.operandIds.every(id => selectedIds.has(id))));
      const operands = calculations.map(rows => rows.length === 1 ? rows[0]!.operandIds.map(id => read.facts.find(f => f.id === id)) : []);
      const sameScope = (a: ReadFinancialFact, b: ReadFinancialFact) => a.currency === b.currency
        && a.unitScale === b.unitScale && a.accountingScope === b.accountingScope
        && a.businessScope === b.businessScope && a.measurementBasis === b.measurementBasis
        && a.restated === b.restated && a.period.start === b.period.start
        && a.period.end === b.period.end && a.period.type === b.period.type;
      if (operands.some(pair => pair.length !== 2 || !pair[0] || !pair[1])
        || operands.some(pair => !sameScope(operands[0]![0]!, pair[0]!)
          || !sameScope(operands[0]![1]!, pair[1]!))) {
        ownCitationErrors.push(`COMPARISON_OWN_OPERANDS_NOT_COMPARABLE_${year}_${type}`);
      }
    }
    errors.push(...ownCitationErrors);
    if (costComparison && ownCitationErrors.length === 0) errors.push(...comparisonErrors(claim, read, Number(year), "own", [scope])
      .filter(error => /GROWTH_ORDER_CONTRADICTS_CALCULATION|FINANCIAL_COMPARISON_SUBJECT_AMBIGUOUS|FINANCIAL_COMPARISON_PERIOD_NOT_ALIGNED/.test(error)));
  }
  return errors;
}

// Repair hints are evidence, never automatic citation substitution. The next
// model completion still has to select the literal rows and pass every guard.
export function financialCitationRepairHints(text: string, e: InvestigationEvidence) {
  if (/\u884d\u751f(?:\u91d1\u878d)?\u5de5\u5177(?:\u51c0)?(?:\u4e8f\u635f|\u635f\u5931)/.test(text)) {
    const read = readInvestigationFinance(e);
    const change = read.calculations.find(c => c.metric === "derivative_financial_gain_loss_change");
    const operands = change?.operandIds.map(id => read.facts.find(f => f.id === id));
    const current = operands?.[0], prior = operands?.[1];
    if (change && change.currency === "CNY" && current && prior && current.value < 0 && prior.value < 0) {
      const lossChange = Math.abs(current.value * current.unitScale) - Math.abs(prior.value * prior.unitScale);
      return [{ metric: change.metric, calculationId: change.id, sourceId: current.source.sourceId, quote: current.source.quote,
        signedPnlChangeInCnyYi: change.value * change.unitScale / 100000000,
        absoluteLossAmountChangeInCnyYi: lossChange / 100000000,
        absoluteLossAmountDirection: lossChange > 0 ? "increase" : lossChange < 0 ? "decrease" : "unchanged",
        explanation: "A negative signed P&L change is not a decrease in the positive loss amount. Select the actual comparative row and state each direction correctly." }];
    }
  }

  if (/外汇远期|远期合约/.test(text) && /公允价值|负债/.test(text)) {
    return readInvestigationFinance(e).facts.filter(f => f.metric === "fx_forward_fvtpl_liability")
      .map(f => ({ metric: f.metric, factId: f.id, period: f.period, value: f.value, unitScale: f.unitScale,
        amountInCnyYi: f.value * f.unitScale / 100000000, sourceId: f.source.sourceId, quote: f.source.quote }));
  }
  const year = text.match(/(20\d{2})年/)?.[1];
  const type = /上半年|半年|H1/i.test(text) ? "interim" : /季度|Q2/i.test(text) ? "quarter" : null;
  const cashEffects = new Set(cashEffectSubjectMentions(text).map(item => item.metric));
  if (cashEffects.size) {
    const read = readInvestigationFinance(e);
    const changes = read.calculations.filter(c => cashEffects.has(c.metric.replace(/_change$/, ""))
      && c.metric.endsWith("_cash_flow_effect_change") && (!type || c.period.type === type)
      && (!year || c.period.end.startsWith(year)) && c.operandIds.length === 2);
    const operandIds = new Set(changes.flatMap(c => c.operandIds));
    return [
      ...read.facts.filter(f => cashEffects.has(f.metric) && (!year || f.period.end.startsWith(year) || operandIds.has(f.id))
        && (!type || f.period.type === type)).map(f => ({ metric: f.metric, factId: f.id, period: f.period,
        value: f.value, unitScale: f.unitScale, currency: f.currency,
        amountInCnyYi: f.currency === "CNY" ? f.value * f.unitScale / 100000000 : undefined,
        outputUnit: f.currency === "CNY" ? "亿元" : undefined, sourceId: f.source.sourceId, quote: f.source.quote })),
      ...changes.map(c => ({ metric: c.metric, calculationId: c.id, period: c.period,
        operandIds: c.operandIds, signedAmountInCnyYi: c.currency === "CNY" ? c.value * c.unitScale / 100000000 : undefined }))
    ];
  }
  const wanted = [
    ...(/收入|营收/.test(text) ? ["revenue"] : []),
    ...(/法定(?:口径|归母|利润|盈利)/.test(text) ? ["profit_attributable_to_owners"] : []),
    ...(/经营(?:活动)?现金流/.test(text) ? ["operating_cash_flow"] : []),
    ...(/自由现金流|FCF/i.test(text) ? ["operating_cash_flow", "capex_cash_payments", "content_cash_payments", "lease_cash_payments", "fcf_reported", "fcf_excluding_compute_prepayments"] : []),
    ...(/汇兑/.test(text) ? ["net_fx_loss_gain", "net_fx_gain_loss"] : [])
  ];
  // Missing period text must not suppress the repair evidence. Include each
  // original's explicit period; the model must still select and name its own.
  return readInvestigationFinance(e).facts.filter(f => wanted.includes(f.metric)
    && (!type || f.period.type === type) && (!year || f.period.end.startsWith(year)))
    .map(f => ({ metric: f.metric, factId: f.id, period: f.period, value: f.value, unitScale: f.unitScale, currency: f.currency,
      amountInCnyYi: f.currency === "CNY" ? f.value * f.unitScale / 100000000 : undefined,
      outputUnit: f.currency === "CNY" ? "亿元" : undefined, sourceId: f.source.sourceId, quote: f.source.quote }));
}

const groupRate = /(?:(?:整体|集团|合并|总)(?:实际|有效)?|实际(?:有效)?|有效)税率/g;
function finerTaxRate(prefix: string, term: string): boolean {
  return !/^(?:整体|集团|合并|总)/.test(term) && /(?:地区|区域|子公司|税种|各地|地方)(?:的)?\s*$/.test(prefix);
}
function futureTaxRate(prefix: string): boolean {
  return /(?:未来|后续|下期|下一期|下一季度|下半年|明年|下一财年|预测|预计)(?:的)?\s*$/.test(prefix);
}
function directTaxDirectionLead(value: string): boolean {
  const lead = value.replace(/(?:不是|并非|并不)(?:上升|增加|提高|下降|减少|降低)(?:而是|而为)/g, "");
  return /^(?:\s|的|数值|水平|同比|环比|较|比|从|由|上年|去年|同期|年|上半年|第二季度|季度|H1|Q2|[\d.,%％]|人民币|港元|美元|亿元|万元|千元|元|RMB|CNY|HKD|USD|已|有所|明显|显著|小幅|大幅|进一步|持续)*$/.test(lead);
}
function claimPeriod(text: string) {
  const years = [...new Set([...text.matchAll(/20\d{2}/g)].map(match => match[0]))];
  const year = years.length === 1 ? years[0] : undefined;
  const type = /上半年|半年|中期|H1/i.test(text) ? "interim" : /季度|Q[1-4]/i.test(text) ? "quarter" : undefined;
  return { year, type, ambiguousYear: years.length > 1 };
}
function taxDirectionPeriod(clause: string, subjectStart: number, subjectEnd: number, predicateEnd: number): { year?: string; orientation: 1 | -1 } | null {
  const years = [...new Set([...clause.matchAll(/20\d{2}/g)].map(match => match[0]))];
  if (years.length > 2) return null;
  const subjectYears = [...new Set([...clause.slice(0, subjectStart).matchAll(/20\d{2}/g)].map(match => match[0]))];
  if (subjectYears.length > 1) return null;
  const endpoint = clause.slice(predicateEnd).match(/^\s*(?:至|到)?\s*(20\d{2})年/);
  const beforePredicate = clause.slice(subjectEnd, predicateEnd);
  const attached = beforePredicate.match(/^\s*(20\d{2})年(?:上半年|下半年|第二季度|季度|H1|Q2)/i);
  const target = subjectYears[0] ?? endpoint?.[1] ?? attached?.[1];
  if (!target && years.length) return null;
  if (years.length === 2) {
    if (Math.abs(Number(years[0]) - Number(years[1])) !== 1 || !/较|比|从|由/.test(clause)) return null;
    const newer = String(Math.max(...years.map(Number)));
    return { year: newer, orientation: target === newer ? 1 : -1 };
  }
  return { year: target, orientation: 1 };
}
function claimsKnownEffectiveRateMissing(text: string, data: InvestigationFinance): boolean {
  // A missing issuer reconciliation or regional rate does not make the
  // calculable group rate unknown. Test each assertion, even when an unknown
  // cause appears in the same sentence.
  return text.split(/[，,。；;\n]/).some(clause => {
    const period = claimPeriod(clause);
    if (period.ambiguousYear || !data.calculations.some(c => c.metric === "effective_tax_rate"
      && (!period.year || c.period.end.startsWith(period.year)) && (!period.type || c.period.type === period.type))) return false;
    for (const match of clause.matchAll(groupRate)) {
      const index = match.index!, term = match[0]!, prefix = clause.slice(0, index), suffix = clause.slice(index + term.length);
      if (finerTaxRate(prefix, term) || futureTaxRate(prefix)) continue;
      if (/(?:不是|并非|并不)(?:未知|未取得|无法(?:计算|复算|判断))\s*$/.test(prefix)) continue;
      if (/^\s*(?:不是|并非|并不)(?:未知|未取得|无法(?:计算|复算|判断))/.test(suffix)) continue;
      if (/^\s*(?:的)?(?:数值|水平|百分比|本身)?\s*(?:仍|尚|还)?(?:未(?:取得|读取|获得|披露|计算|复算)|未知|缺少|无法(?:计算|复算|判断))/.test(suffix)) return true;
      if (/(?:未(?:取得|读取|获得|披露)|未知|缺少|无法(?:计算|复算))\s*$/.test(prefix)
        && !/^\s*(?:的)?(?:调节表|调节过程|调节明细|形成原因|变动原因|原因)/.test(suffix)) return true;
      if (/^\s*(?:与|及|和|、)(?:实际)?(?:税率)?(?:调节表|少数股东损益拆分)(?:均|都)?(?:未取得|未知|缺少)/.test(suffix)) return true;
    }
    return false;
  });
}

function taxDirectionErrors(text: string, data: InvestigationFinance, latest: number, path: string): string[] {
  const errors: string[] = [];
  for (const clause of text.replace(/[，,]\s*而是/g, "而是").split(/[，,。；;\n]|但是|但|并且|且|同时/)) {
    if (/若|如果|假设|是否|能否|可能|未确认|尚未确认|[？?]/.test(clause)) continue;
    const period = claimPeriod(clause);
    for (const [subject, metric] of [[/(?:所得税费用|税费)/g, "income_tax_expense_yoy"], [groupRate, "effective_tax_rate_change"]] as const) {
      for (const match of clause.matchAll(subject)) {
        const term = match[0]!, prefix = clause.slice(0, match.index!), tail = clause.slice(match.index! + term.length);
        if (metric === "effective_tax_rate_change" && (finerTaxRate(prefix, term) || futureTaxRate(prefix))) continue;
        if (metric === "income_tax_expense_yoy" && /^\s*(?:的)?(?:现金)?(?:支付|缴纳)/.test(tail)) continue;
        const nextSubject = tail.search(/所得税费用|税费|税率/);
        const assertion = tail.slice(0, nextSubject < 0 ? 60 : nextSubject);
        const direction = [...assertion.matchAll(/上升|增加|提高|升至|增至|上涨|下降|减少|降低|降至|下滑|跌至/g)]
          .find(candidate => !/(?:不是|并非|并不|不能|无法|未|不)\s*$/.test(assertion.slice(0, candidate.index)));
        if (!direction || !directTaxDirectionLead(assertion.slice(0, direction.index))
          || /(?:不能说|并非|不是|无法确认|未能确认)\s*$/.test(prefix)) continue;
        const subjectEnd = match.index! + term.length;
        const targetPeriod = taxDirectionPeriod(clause, match.index!, subjectEnd, subjectEnd + direction.index! + direction[0]!.length);
        if (!targetPeriod) continue;
        const candidates = data.calculations.filter(c => c.metric === metric && c.period.end.startsWith(targetPeriod.year ?? String(latest))
          && (!period.type || c.period.type === period.type));
        if (candidates.length !== 1) continue;
        const upward = /上升|增加|提高|升至|增至|上涨/.test(direction[0]!);
        const change = candidates[0]!.value * targetPeriod.orientation;
        if (upward ? change <= 0 : change >= 0)
          errors.push(`${path}:TAX_DIRECTION_CONTRADICTS_READ_TOTALS`);
      }
    }
  }
  return errors;
}

/** Inspect all displayed prose. The bounded rules concern actual statement
 * periods, growth-rate relations and known totals, not a universal entailment
 * engine. Fine-grained causes and future sustainability remain research gaps. */
export function financialConsistencyErrors(value: unknown, e: InvestigationEvidence): string[] {
  const d = readInvestigationFinance(e), errors: string[] = [];
  const latest = d.facts.reduce((year, f) => Math.max(year, Number(f.period.end.slice(0, 4))), 0);
  const bridge = reconciledPbtBridge(d.facts, e);
  const visible = (v: unknown, path: string) => {
    if (typeof v === "string") inspect(v, path);
    else if (Array.isArray(v)) v.forEach((x, i) => visible(x, `${path}.${i}`));
    else if (v && typeof v === "object") {
      const coverage = v as { claim?: string; assessment?: string; missingLink?: string };
      if (coverage.claim && !/其余|其他|非现金|营运资本|明细|原因/.test(coverage.claim)
        && coverage.assessment !== "direct" && /非现金|营运资本|折旧|股份酬金/.test(coverage.missingLink ?? "")
        && knownTaxCashBridge(coverage.claim, d)) errors.push(`${path}:CASH_TAX_BRIDGE_ALREADY_KNOWN_missing_adjustments_belong_to_profit_to_pretax_cash`);
      for (const [k, x] of Object.entries(v)) if (!["quote", "claim", "proposition", "sourceIds", "hypothesisId", "receipt"].includes(k)) visible(x, `${path}.${k}`);
    }
  };
  const inspect = (text: string, path: string) => {
    errors.push(...comparisonErrors(text, d, latest, path));
    errors.push(...taxProvisionLabelErrors(text, d, path));
    errors.push(...readCashSubtotalAmountErrors(text, d, latest, path));
    errors.push(...readCashContributionUnknownErrors(text, d, latest, path));
    for (const sentence of text.split(/[。；;\n]/)) {
      for (const clause of sentence.split(/但|然而|不过/)) {
        const missing = /未(?:取得|读取|获得|披露)|尚缺|缺少|未知/.exec(clause);
        if (!missing) continue;
        // A confirmed cash-flow row may precede a genuine balance/detail gap
        // in the same sentence. Scope the missing assertion after that row.
        const readRow = /(?:(?:本轮|本次)?(?:已读|已读取|已取得|已核实)(?:应付账款|应付票据|其他应付款|其他负债|应计项目)(?:等)?变动(?:对经营现金流(?:的影响)?)?|(?:应付账款|应付票据|其他应付款|其他负债|应计项目)(?:等)?变动(?:对经营现金流(?:的影响)?)?(?:本轮|本次)?(?:已读|已读取|已取得|已核实))(?=$|[，,。；;、]|但|然而|不过)/.exec(clause);
        const afterRead = readRow ? clause.slice(readRow.index + readRow[0].length) : "";
        const sharedMissingPredicate = /^\s*(?:和|及|与|、(?=[^，,。；;]*[均都]))/.test(afterRead);
        const assertion = readRow && readRow.index < missing.index && !sharedMissingPredicate
          ? clause.slice(readRow.index + readRow[0].length) : clause;
        const cashFlowAssertion = assertion.replace(/余额(?:的)?变动/g, "");
        const namedPayables = [
          { pattern: /应付账款|应付票据/, metric: "trade_bills_payables_cash_flow_effect" },
          { pattern: /其他应付款|其他负债|应计项目/, metric: "other_payables_liabilities_accruals_cash_flow_effect" }
        ].filter(item => item.pattern.test(cashFlowAssertion) && d.facts.some(f => f.metric === item.metric
          && f.period.type === "interim" && f.period.end.startsWith(String(latest))));
        const finerDetailOnly = /变动(?:的|对应的)?(?:(?:细分|具体|逐项)?(?:原因|明细)|内部构成|实际付款总额)/.test(cashFlowAssertion)
          && !/变动(?:和|及|与|、)/.test(cashFlowAssertion);
        if (namedPayables.length && /变动|经营现金流|现金流量表/.test(cashFlowAssertion)
          && /未(?:取得|读取|获得|披露)|尚缺|缺少|未知/.test(cashFlowAssertion) && !finerDetailOnly) {
          errors.push(`${path}:PAYABLES_CASH_FLOW_ROWS_ALREADY_READ_do_not_call_the_named_changes_unobtained_or_treat_them_as_balances`);
          break;
        }
      }
      if (bridge?.components.some(c => c.metric === "other_expenses")
        && d.facts.some(f => f.metric === "net_fx_loss_gain" && f.source.sourceId !== bridge.statementSourceId)
        && financialAssertionScopes(sentence).some(assertsOtherExpensesFxAddition)) {
        errors.push(`${path}:OTHER_EXPENSES_AND_FX_NOTE_NOT_INDEPENDENT_PBT_COMPONENTS_do_not_add_without_a_read_mapping`);
      }
    }
    if (!d.calculations.some(c => c.metric === "free_cash_flow") && d.calculations.some(c => c.metric === "operating_cash_after_two_asset_payments")
      && text.split(/[。；;\n]/).some(sentence => /自由现金流(?:量)?(?:净额)?\s*(?:约为|大约为|金额为|合计为|为|约|是|[：:])?\s*[-−]?\d+(?:\.\d+)?\s*(?:亿|万|千)?元/.test(sentence)
        && !/不是|并非|不等于|不能|无法|尚未确认|未取得|非完整|非发行人/.test(sentence))) {
      errors.push(`${path}:TWO_ASSET_PAYMENT_RESIDUAL_IS_NOT_DISCLOSED_FCF_use_named_cash_residual_and_its_own_calculation_operands`);
    }
    const bridgeExplicitlyKnown = /桥接[^，,。；;]{0,8}(?:已确认|已知|可复算)|(?:已确认|已完成|已复算|可复算)[^，,。；;]{0,20}桥接/.test(text);
    if (!bridgeExplicitlyKnown && text.split(/[，,。；;]/).some(part => /能否|无法|尚未|未确认|未知/.test(part) && /桥接/.test(part) && knownTaxCashBridge(part, d))) {
      errors.push(`${path}:CASH_TAX_BRIDGE_ALREADY_KNOWN_missing_adjustments_belong_to_profit_to_pretax_cash`);
    }
    const missing = /未(?:取得|读取|获得|披露)|未知|缺少|尚缺|无法计算|not (?:read|obtained)/i.test(text);
    const missingReadFcf = text.split(/[，。；;\n]/).some(part => {
      if (!/未(?:取得|读取|获得|披露)|未知|缺少|尚缺|无法计算/i.test(part) || !/自由现金流.*(?:计算|构成|公式)|FCF.*(?:calcul|compos)/i.test(part) || /已(?:读|取得|知|计算)/.test(part)) return false;
      // The actual FCF recipe does not reveal independent account/payment
      // detail behind a separately labelled issuer adjustment.
      if (/调整口径.*(?:差额|差异).*(?:具体|科目|付款|明细)/.test(part)
        && !/无法计算|未(?:计算|复算)|数学差额.*(?:未知|未取得)/.test(part)) return false;
      const period = /上半年|半年|H1|six months/i.test(part) ? "interim" : /季度|Q2|second quarter/i.test(part) ? "quarter" : null;
      const year = part.match(/(20\d{2})(?:年|[HQ][1-4])/i)?.[1] ?? String(latest - (/上年|去年|previous year|prior.year/i.test(part) ? 1 : 0));
      return d.calculations.some(c => c.metric === "free_cash_flow" && (!period || c.period.type === period) && c.period.end.startsWith(year));
    });
    if (missingReadFcf && !/自由现金流(?:的)?(?:未来|后续|持续性|下一期)/.test(text)) errors.push(`${path}:FCF_COMPONENTS_ALREADY_READ`);
    const coreDefinitionRead = e.sources.some(s => s.symbol === e.symbol && s.readStatus === "BODY_READ" && /Excluding the after-tax net foreign exchange loss[\s\S]{0,600}impairment loss on non-financial assets[\s\S]{0,250}core profit attributable/i.test(s.text));
    if ((missing || /missingLink|neededEvidence/.test(path)) && coreDefinitionRead && /核心(?:归母)?(?:净)?利润|核心盈利/.test(text)
      && /(?:完整|逐项|全部)(?:逐项)?(?:调整|调节)(?:明细|项|表)|调整项.*(?:明细|金额)/.test(text)
      && !/未舍入|舍入|精度|尾差|精确对账|子公司|地区/.test(text)) errors.push(`${path}:CORE_ADJUSTMENTS_ALREADY_READ_use_disclosed_FX_and_impairment_amounts_unknown_only_finer_precision_or_attribution`);
    if (d.facts.some(f => f.metric === "noncash_adjustments") && d.facts.some(f => f.metric === "working_capital_change")
      && /非现金(?:项目)?调整[^。；;]{0,35}(?:内部|包含|包括|由)[^。；;]{0,40}(?:营运资本|营运资金)/.test(text)) {
      errors.push(`${path}:WORKING_CAPITAL_IS_SEPARATE_FROM_NONCASH_SUBTOTAL_use_the_two_read_cash_flow_rows_separately`);
    }
    const otherComponentsRead = ["derivative_financial_gain_loss", "government_grants_subsidies", "asset_disposal_gain_loss"]
      .every(metric => d.calculations.some(c => c.metric === metric + "_change"));
    const missingOtherTotals = text.split(/[，,。；;\n]/).some(part => /未(?:取得|读取|获得|披露)|未知|缺少|尚缺|无法计算|not (?:read|obtained)/i.test(part)
      && /其他收益.*(?:各明细|明细.*贡献).*(?:金额|总额|差额|同比变动)|(?:政府补助|衍生工具|处置收益).*?(?:逐项金额|逐项贡献|总额)/.test(part)
      && !/地区|子公司|税后|政策条件|会计处理/.test(part));
    if (otherComponentsRead && missingOtherTotals) errors.push(`${path}:OTHER_GAINS_COMPONENT_TOTALS_ALREADY_READ_use_original_rows_and_changes_keep_only_finer_causes_unknown`);
    if (claimsKnownEffectiveRateMissing(text, d)) errors.push(`${path}:TAX_RATE_AND_NCI_TOTALS_ALREADY_READ_detail_scope_required`);
    const missingTaxContribution = text.split(/[，。；;\n]/).some(part => /未(?:取得|读取|获得)|未知|缺少|尚缺|无法量化/.test(part)
      && /(?:所得税|税费|税款).*支付.*(?:贡献|量化)|无法量化.*(?:所得税|税费|税款).*支付/.test(part));
    if (missingTaxContribution
      && d.calculations.some(c => c.metric === "income_tax_paid_cash_contribution") && !/季度|Q2|地区|税种|时点|因果|未来/.test(text)) errors.push(`${path}:H1_TAX_PAYMENT_CONTRIBUTION_ALREADY_CALCULABLE_limit_gap_to_missing_detail`);
    errors.push(...taxDirectionErrors(text, d, latest, path));
  };
  visible(value, "analysis");
  return [...new Set(errors)];
}

function readCashContributionUnknownErrors(text: string, data: InvestigationFinance, latest: number, path: string): string[] {
  // Known comparable subtotal changes are arithmetic contributions, while the
  // internal account detail and operating causes can still be unacquired.
  if (!/经营(?:活动)?现金流/.test(text) || !/同比|增长|增加|变动|改善|变化/.test(text)
    || !/非现金(?:项目)?(?:调整)?/.test(text) || !/营运资本|营运资金/.test(text)) return [];
  const unknown = text.match(/(?:无法|不能|尚不能)(?:判断|确定|量化|计算|复算)[^。；;]{0,100}(?:有多少来自|多少来自|哪些来自|各(?:自)?贡献|各(?:自)?占)/)?.[0]
    ?? text.match(/(?:细分|明细|对账)(?:决定|影响)[^。；;]{0,100}(?:多少来自|哪些来自)/)?.[0];
  if (!unknown) return [];
  const claimScope = unknown.replace(/^(?:细分|明细|对账)(?:决定|影响)/, "");
  if (/内部|细分|地区|子公司|明细|具体(?:项目|科目|业务)|逐项/.test(claimScope) || /未来|下期|下一期/.test(text)) return [];
  const year = text.match(/(20\d{2})年/)?.[1] ?? String(latest);
  const type = /季度|Q[1-4]/i.test(text) ? "quarter" : "interim";
  const changes = ["noncash_adjustments_change", "working_capital_change_change", "operating_cash_flow_change"]
    .map(metric => data.calculations.find(c => c.metric === metric && c.period.type === type && c.period.end.startsWith(year)));
  const first = changes[0];
  if (!first || changes.some(c => !c || c.currency !== first.currency || c.period.start !== first.period.start || c.period.end !== first.period.end)) return [];
  return [`${path}:CASH_SUBTOTAL_CONTRIBUTIONS_ALREADY_CALCULABLE_use_${changes.map(c => c!.id).join("_")}_internal_details_and_operating_causes_remain_unknown`];
}

function readCashSubtotalAmountErrors(text: string, data: InvestigationFinance, latest: number, path: string): string[] {
  // Unknowns and suggested questions have no citation list, but a known total
  // repeated there must still match its read row and currency. Do not rewrite
  // the answer or treat this consistency check as a new evidence citation.
  const errors: string[] = [];
  const scales: Record<string, number> = { 十亿: 1e9, 百万: 1e6, 亿: 1e8, 万: 1e4, 千: 1e3 };
  const matches = [...text.matchAll(/(非现金(?:项目)?调整|营运资本变动)(?:净额|总额)?\s*(-?[\d,]+(?:\.\d+)?)\s*(十亿|百万|亿|万|千)?(港元|美元|元)/g)];
  for (const match of matches) {
    const metric = match[1]!.startsWith("非现金") ? "noncash_adjustments" : "working_capital_change";
    const context = text.slice(0, match.index!).split(/[。；;]/).at(-1) ?? "";
    const year = context.match(/(20\d{2})年/g)?.at(-1)?.slice(0, 4) ?? String(latest - (/上年(?:同期)?|去年同期/.test(context.slice(-12)) ? 1 : 0));
    const type = /季度|Q2/i.test(context) ? "quarter" : /上半年|半年|H1/i.test(context) ? "interim" : null;
    const fact = uniqueFact(data.facts.filter(f => f.metric === metric && f.period.end.startsWith(year) && (!type || f.period.type === type)));
    if (!fact) continue;
    const currency = (unit: string) => unit === "港元" ? "HKD" : unit === "美元" ? "USD" : "CNY";
    const matchesAmount = (value: number, number: string, scale: string | undefined, unit: string) => currency(unit) === fact.currency
      && Number((value / (scales[scale ?? ""] ?? 1)).toFixed(number.split(".")[1]?.length ?? 0)) === Number(number.replaceAll(",", ""));
    if (!matchesAmount(fact.value * fact.unitScale, match[2]!, match[3], match[4]!)) errors.push(`${path}:READ_CASH_SUBTOTAL_AMOUNT_DOES_NOT_MATCH_${metric}_select_${fact.id}_raw_${fact.value}_scale_${fact.unitScale}_${fact.currency}_expected_${fact.value * fact.unitScale / 100000000}_CNY_YI`);
    const change = /^[（(]同比(增加|减少|下降|增长)\s*(-?[\d,]+(?:\.\d+)?)\s*(十亿|百万|亿|万|千)?(港元|美元|元)[）)]/.exec(text.slice(match.index! + match[0].length));
    const calculation = change && data.calculations.find(c => c.metric === metric + "_change" && c.operandIds[0] === fact.id);
    if (change && calculation && !matchesAmount(calculation.value * (/减少|下降/.test(change[1]!) ? -1 : 1), change[2]!, change[3], change[4]!)) {
      errors.push(`${path}:READ_CASH_SUBTOTAL_CHANGE_DOES_NOT_MATCH_${metric}_select_${calculation.id}_base_CNY_${calculation.value}_expected_${calculation.value / 100000000}_CNY_YI`);
    }
  }
  return errors;
}

function knownTaxCashBridge(text: string, data: InvestigationFinance): boolean {
  return !/利润/.test(text) && /缴税前|税前经营现金|经营活动产生现金/.test(text) && /经营现金流净额/.test(text)
    && data.calculations.some(c => c.metric === "operating_cash_tax_reconciliation"
      && (!/季度|Q2/i.test(text) || c.period.type === "quarter")
      && (!/上半年|H1/i.test(text) || c.period.type === "interim")
      && (!text.match(/(20\d{2})年/) || c.period.end.startsWith(text.match(/(20\d{2})年/)![1]!)));
}

function taxProvisionLabelErrors(text: string, data: InvestigationFinance, path: string): string[] {
  if (!/往年|以前年度|税项拨备/.test(text) || /是否|能否|不能|无法|不是|不宜|不要/.test(text)) return [];
  const errors: string[] = [];
  for (const match of text.matchAll(/(超提|超额(?:拨备|计提)|补提|补拨|拨备不足)[^\d，。；]{0,8}([\d.]+)\s*(亿|万|千)?元/g)) {
    const scale = ({ 亿: 1e8, 万: 1e4, 千: 1e3 } as Record<string, number>)[match[3] ?? ""] ?? 1;
    const decimals = match[2]!.split(".")[1]?.length ?? 0;
    const facts = data.facts.filter(f => f.metric === "prior_year_tax_adjustment"
      && Number((Math.abs(f.value * f.unitScale) / scale).toFixed(decimals)) === Number(match[2]));
    const over = /超提|超额/.test(match[1]!);
    if (facts.length && facts.every(f => over ? f.value > 0 : f.value < 0)) errors.push(`${path}:PRIOR_YEAR_TAX_PROVISION_SIGN_LABEL_MISMATCH_positive_is_underprovision_补提_negative_is_overprovision_转回`);
  }
  return errors;
}

const comparisonMetrics = [
  { metric: "revenue_yoy", pattern: "收入|营收|revenue" },
  { metric: "cost_of_sales_yoy", pattern: "销售成本|cost of sales" },
  { metric: "operating_profit_yoy", pattern: "经营利润|operating profit" },
  { metric: "profit_attributable_to_owners_yoy", pattern: "法定归母(?:净)?利润|法定(?:净)?利润|(?<!核心)(?<!非IFRS)归母净利润|statutory profit" },
  { metric: "operating_cash_flow_yoy", pattern: "经营(?:活动)?现金流|operating cash" }
];
function comparisonErrors(text: string, data: InvestigationFinance, year: number, path: string,
  scopes = financialAssertionScopes(text)): string[] {
  const errors: string[] = [];
  const growth = data.calculations.filter(c => c.metric.endsWith("_yoy") && Number(c.period.end.slice(0, 4)) === year);
  for (const scope of scopes) {
    const sentence = scope.claim, context = scope.context + sentence;
    if (negatesComparisonAssertion(sentence)) continue;
    if (/上半年|H1/i.test(context) && /季度|Q2/i.test(context)
      && /三者|两者|二者|分别.*(?:同步|增速不同|接近)|(?:收入|营收)[^。；;]{0,40}现金流[^。；;]{0,20}(?:同步|接近|一致)/.test(context)
      && /增速|同步|增长幅度/.test(sentence) && !/不同期间|不能直接比较|不可直接比较|不能组成.*比较/.test(sentence)) {
      errors.push(`${path}:FINANCIAL_COMPARISON_PERIOD_NOT_ALIGNED_mixed_period_summary`);
    }
  }
  // Distinct explicitly named periods describe separate comparisons. Never
  // select a different period merely because some other page also contains it.
  for (const scope of scopes) for (const sentence of scope.claim.split(/(?=(?:上半年|第二季度|Q2|H1))/)) {
    if (negatesComparisonAssertion(sentence)) continue;
    const different = /不同步|不同速|增速不一致|增速不同|增长幅度不同/.test(sentence);
    const equal = !different && /同步|同速|增速.*一致|增速.*接近|synchron/i.test(sentence);
    const order = /增速|增幅|增长|速度|growth/i.test(sentence) && /更快|更慢|高于|低于|超过|快于|慢于|faster|slower/i.test(sentence);
    if (!equal && !order && !different) continue;
    const pronounOrder = directionalPronounGrowth.exec(sentence);
    if (order && pronounOrder) {
      const before = scope.context + sentence.slice(0, pronounOrder.index);
      const mentionsIn = (part: string) => comparisonMetrics.flatMap(metric =>
        [...part.matchAll(new RegExp(metric.pattern, "gi"))].map(match => ({ metric: metric.metric, at: match.index! })));
      const focused = [...before.split(/[，,]/)].reverse().find(part => new Set(mentionsIn(part).map(m => m.metric)).size >= 2) ?? before;
      const lastMentions = new Map<string, number>();
      for (const mention of mentionsIn(focused)) lastMentions.set(mention.metric, mention.at);
      if (lastMentions.size !== 2) { errors.push(`${path}:FINANCIAL_COMPARISON_SUBJECT_AMBIGUOUS`); continue; }
      const ordered = [...lastMentions].sort((a, b) => a[1] - b[1]).map(([metric]) => metric);
      const subjectMetric = pronounOrder[0]!.startsWith("前者") ? ordered[0]! : ordered[1]!;
      const otherMetric = pronounOrder[0]!.startsWith("前者") ? ordered[1]! : ordered[0]!;
      const periodText = scope.context + sentence;
      const interim = /上半年|半年|中期|H1/i.test(periodText), quarter = /季度|Q2/i.test(periodText);
      if (interim && quarter) { errors.push(`${path}:FINANCIAL_COMPARISON_PERIOD_NOT_ALIGNED_or_not_explicit`); continue; }
      const subjectRows = growth.filter(c => c.metric === subjectMetric && (!interim && !quarter || c.period.type === (interim ? "interim" : "quarter")));
      const otherRows = growth.filter(c => c.metric === otherMetric && (!interim && !quarter || c.period.type === (interim ? "interim" : "quarter")));
      const pairs = subjectRows.flatMap(x => otherRows.filter(y => x.period.start === y.period.start && x.period.end === y.period.end)
        .map(y => [x, y] as const));
      if (pairs.length !== 1) { errors.push(`${path}:FINANCIAL_COMPARISON_PERIOD_NOT_ALIGNED_or_not_explicit`); continue; }
      const [subject, other] = pairs[0]!;
      const faster = /更快|高于|快于/.test(pronounOrder[1]!);
      if (faster ? subject.value <= other.value : subject.value >= other.value)
        errors.push(`${path}:GROWTH_ORDER_CONTRADICTS_CALCULATION`);
      continue;
    }
    let named = comparisonMetrics.filter(m => new RegExp(m.pattern, "i").test(sentence));
    if (named.length < 2 && scope.context) named = comparisonMetrics.filter(m => new RegExp(m.pattern, "i").test(scope.context + sentence));
    for (let i = 0; i < named.length; i++) for (const b of named.slice(i + 1)) {
      const a = named[i]!;
      // "毛利额和毛利率同步下降，销售成本增幅快于收入" does not
      // claim equal growth for the cost/revenue pair in the latter clause.
      const equalForPair = equal && sentence.split(/[，,](?=同时|但|然而|不过)/).some(part =>
        /同步|同速|增速.*一致|增速.*接近|synchron/i.test(part)
        && new RegExp(a.pattern, "i").test(part) && new RegExp(b.pattern, "i").test(part))
        || equal && /(?:二者|两者)[^，,。；;]{0,24}(?:同步|同速|增速.*一致|增速.*接近)/i.test(sentence)
        && comparisonMetrics.filter(metric => new RegExp(metric.pattern, "i").test(scope.context)).length === 2
        && new RegExp(a.pattern, "i").test(scope.context)
        && new RegExp(b.pattern, "i").test(scope.context);
      // Bind the order predicate to its nearest named subject/object. A
      // preceding reconciliation account is not the subject of a later
      // cash-flow-versus-profit growth comparison.
      const metricNames = comparisonMetrics.map(m => `(?:${m.pattern})`).join("|");
      const between = (max: number) => `(?:(?!(?:${metricNames}))[^。；;]){0,${max}}`;
      const relationText = scope.context && named.length > comparisonMetrics.filter(m => new RegExp(m.pattern, "i").test(sentence)).length
        ? scope.context + sentence : sentence;
      const relation = (from: string, predicate: string, to: string) => new RegExp(`(?:${from})${between(70)}(?:${predicate})${between(30)}(?:${to})`, "i").test(relationText);
      const aAbove = relation(a.pattern, "更快|高于|超过|快于|faster", b.pattern), aBelow = relation(a.pattern, "更慢|低于|慢于|slower", b.pattern);
      const bAbove = relation(b.pattern, "更快|高于|超过|快于|faster", a.pattern), bBelow = relation(b.pattern, "更慢|低于|慢于|slower", a.pattern);
      if (order && !equalForPair && !different && !aAbove && !aBelow && !bAbove && !bBelow) continue;
      const type = /上半年|半年|中期|H1/i.test(sentence) ? "interim" : /季度|Q2/i.test(sentence) ? "quarter"
        : /上半年|半年|中期|H1/i.test(scope.context) ? "interim" : /季度|Q2/i.test(scope.context) ? "quarter" : null;
      const av = growth.filter(c => c.metric === a.metric), bv = growth.filter(c => c.metric === b.metric);
      const types = new Set([...av, ...bv].map(c => c.period.type));
      const period = type ?? (types.size === 1 ? [...types][0] : null);
      const pairs = av.filter(x => x.period.type === period).flatMap(x => bv.filter(y => x.period.start === y.period.start && x.period.end === y.period.end).map(y => [x, y] as const));
      if (!period || pairs.length !== 1) { errors.push(`${path}:FINANCIAL_COMPARISON_PERIOD_NOT_ALIGNED_or_not_explicit`); continue; }
      const [x, y] = pairs[0]!;
      if (equalForPair && Math.abs(x.value - y.value) > 0.000001) errors.push(`${path}:POSITIVE_DIRECTION_IS_NOT_EQUAL_GROWTH_RATE`);
      if (order) {
        if (((aAbove || bBelow) && x.value <= y.value) || ((aBelow || bAbove) && x.value >= y.value)) errors.push(`${path}:GROWTH_ORDER_CONTRADICTS_CALCULATION`);
      }
    }
  }
  return errors;
}
