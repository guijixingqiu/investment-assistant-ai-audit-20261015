import type { InvestigationEvidence } from "./personalInvestigationSources.js";
import { isNarrowFinancialQuestion, type InvestigatedEvidence } from "./personalInvestigationLoop.js";
import { financialNumberEvidence, primaryFinancialComparison, readInvestigationFinance } from "./personalInvestigationFinance.js";

// Bounded checks for the reviewed failure relations. The second, existing AI
// pass still audits every conclusion against its selected original passages.
// These checks are not a substitute for that audit or independent review.
type Basis = { sourceId: string; quote: string };
const coreProfitDefinitionPattern = /defined as[^.]{0,250}adjusted to exclude[^.]{0,200}foreign exchange[^.]{0,200}impairment|定义[^。]{0,200}剔除[^。]{0,150}汇兑[^。]{0,150}减值/i;
function selectedQuotes(node: Record<string, unknown>, evidence: InvestigationEvidence): string {
  const basis = [node.basis, node.supportingEvidence, node.contradictingEvidence].flatMap(v => Array.isArray(v) ? v : []) as Basis[];
  return basis.filter(b => evidence.sources.some(s => s.id === b.sourceId && s.symbol === evidence.symbol && s.readStatus === "BODY_READ" && s.text.includes(b.quote)))
    .map(b => b.quote).join("\n");
}
function selectedMechanismErrors(text: string, quotes: string, path: string): string[] {
  const errors: string[] = [];
  if (/核心(?:归母(?:利润|盈利)?|利润|盈利)/.test(text) && /口径差异/.test(text)
    && /已确认|已核对|直接支持|已完成/.test(text) && !/尚未确认|未核对|尚缺|需核查/.test(text)
    && !coreProfitDefinitionPattern.test(quotes)) {
    errors.push(`${path}:CORE_PROFIT_DEFINITION_REQUIRES_OWN_SELECTED_DEFINITION_QUOTE_amount_or_growth_passage_is_not_definition`);
  }
  if (/本地(?:货币)?成本/.test(text) && /自然对冲/.test(text)
    && !/costs denominated in local currencies|本地(?:货币)?成本/i.test(quotes)) {
    errors.push(`${path}:LOCAL_CURRENCY_COST_HEDGE_REQUIRES_OWN_COST_SENTENCE_general_natural_hedging_quote_is_not_the_cost_mechanism`);
  }
  if (/远期/.test(text) && /第二层级|第二层|Level 2/i.test(text)
    && !/classified within Level 2|第二层级|第二层/i.test(quotes)
    && !/(?:^|\n)Foreign exchange forward contracts(?: not designated as hedging instruments)?\s+[\d,()]+\s+[\d,()]+\s+Level 2(?:$|\n)/i.test(quotes)) {
    errors.push(`${path}:FAIR_VALUE_LEVEL_REQUIRES_OWN_LEVEL_SENTENCE_no_unobservable_inputs_alone_is_not_a_level_classification`);
  }
  if (/出口[^。；;]{0,30}美元/.test(text)
    && !/export sales[^.]{0,150}denominated in United States dollars|出口[^。]{0,100}美元/i.test(quotes)) {
    errors.push(`${path}:EXPORT_USD_DENOMINATION_REQUIRES_OWN_EXPORT_SENTENCE_general_currency_exposure_is_not_export_denomination`);
  }
  if (/不(?:符合|适用|采用)[^。；;]{0,15}套期会计/.test(text)
    && !/do not qualify for hedge accounting|not[^.]{0,40}hedge accounting|不(?:符合|适用|采用)[^。]{0,15}套期会计/i.test(quotes)) {
    errors.push(`${path}:HEDGE_ACCOUNTING_TREATMENT_REQUIRES_OWN_SELECTED_ORIGINAL_fair_value_valuation_quote_does_not_prove_accounting_eligibility`);
  }
  if (/税后归母[^。；;]{0,12}汇兑[^。；;]{0,60}(?:由|从)[^。；;]{0,35}(?:收益|盈利)[^。；;]{0,20}(?:转|变)[^。；;]{0,20}(?:亏损|损失)/.test(text)
    && !/after-tax net foreign exchange (?:loss|gain)[^.]{0,180}attributable to owners of the parent[^.]{0,130}(?:first half of|net gain|net loss)/i.test(quotes)) {
    errors.push(`${path}:PARENT_FX_TRANSITION_REQUIRES_OWN_AMOUNT_SENTENCE_currency_volatility_and_risk_management_are_different_claims`);
  }
  return errors;
}
function inferenceErrors(text: string, quotes: string, path: string): string[] {
  const errors: string[] = [];
  if (/出口销售[^。；;]{0,30}(?:大部分|大多数|超过一半)/.test(text) && /美元/.test(text)
    && /a significant portion/i.test(quotes) && !/majority|most of|more than half/i.test(quotes)) {
    errors.push(`${path}:SIGNIFICANT_PORTION_IS_NOT_A_MAJORITY_use_相当部分_do_not_invent_a_more_than_half_share`);
  }
  if (/通过自然对冲|以自然对冲|使用自然对冲/.test(text) && !/natural hedg|自然对冲/i.test(quotes)) {
    errors.push(`${path}:NATURAL_HEDGING_REQUIRES_OWN_SELECTED_ORIGINAL_select_the_complete_management_sentence`);
  }
  errors.push(...selectedMechanismErrors(text, quotes, path));
  // Semicolons may separate the amount from its definition while retaining
  // the same subject. Check the complete statement, not just the latter clause.
  const coreExclusionStatements = text.split(/[。\n]/).filter(statement => /核心(?:归母)?(?:利润|盈利)/.test(statement)
    && /定义为|剔除|排除|不含|不包括|差异(?:来自|源于)|口径差异[^。]{0,60}调整/.test(statement) && /汇兑/.test(statement) && /减值/.test(statement)
    && !/不代表|不等于|不能|无法|是否|尚未确认|需核查/.test(statement));
  const definitionSelected = coreProfitDefinitionPattern.test(quotes);
  // The current answer may abbreviate the subject to "核心归母" while still
  // claiming that its basis has been proved by the issuer's definition.
  if (/核心(?:归母(?:利润|盈利)?|利润|盈利)/.test(text) && /发行人定义|定义原文/.test(text) && !definitionSelected) {
    errors.push(`${path}:CORE_PROFIT_DEFINITION_REQUIRES_OWN_SELECTED_DEFINITION_QUOTE_amount_or_growth_passage_is_not_definition`);
  }
  // A quoted numeric exclusion bridge is not a claim of a general definition.
  // It must select the complete issuer sentence, not merely its amount/rate.
  const issuerExclusionBridgeSelected = /Excluding the after-tax net foreign exchange loss[^\n]{0,650}impairment loss on non-financial assets[^\n]{0,250}the core profit attributable/i.test(quotes);
  if (coreExclusionStatements.length && !definitionSelected
    && (coreExclusionStatements.some(statement => /定义|口径(?:为|是)/.test(statement)) || !issuerExclusionBridgeSelected)) {
    errors.push(`${path}:CORE_PROFIT_DEFINITION_REQUIRES_OWN_SELECTED_DEFINITION_QUOTE_amount_or_growth_passage_is_not_definition`);
  }
  for (const sentence of text.split(/[。；;\n]/)) {
    // Failure to obtain detail from the inspected pages is not evidence that
    // the issuer has never disclosed it. Check the premise even when the same
    // sentence hedges its consequence with "cannot" or "unconfirmed".
    const absence = /未披露|没有披露|未(?:在|于)[^，。；]{0,50}披露/.test(sentence);
    const inspectedScope = /已读|本轮(?:检查|读取|核查)|所(?:检查|读取|核查)|当前(?:检查|读取)|本页|本段/.test(sentence);
    const disclosedAbsence = /(?:not|never) (?:been )?disclosed|未(?:予)?披露/i.test(quotes);
    if (absence && !inspectedScope && !disclosedAbsence) {
      errors.push(`${path}:DISCLOSURE_ABSENCE_MUST_BE_LIMITED_TO_INSPECTED_SCOPE`);
    }
    // Account composition reconciles historical cash, not the future duration
    // of its economic drivers, even when phrased as a proposed next check.
    if (cashDetailRecurrenceAssertion(sentence)) {
      errors.push(`${path}:CASH_DETAILS_DO_NOT_DETERMINE_RECURRENCE_separate_historical_reconciliation_from_economic_causes_and_cross_period_drivers`);
    }
    const uncertain = /不代表|不等于|不足以|不能|无法|未必|是否|能否|尚未确认|仍未确认|需要核查|需核查/.test(sentence);
    if (/汇兑/.test(sentence) && fxSplitRecurrenceAssertion(sentence)) {
      errors.push(`${path}:FX_SPLIT_DOES_NOT_DETERMINE_RECURRENCE_separate_cash_nature_from_future_drivers`);
    }
    if (uncertain) continue;
    const expenseCauses = [...sentence.matchAll(/(?=(利润[^。]{0,35}(?:增长|改善)[^。]{0,25}(?:归因于|来自|由于|因)[^。]{0,70}(?:费用|开支|支出)[^。]{0,15}(?:增加|上升)))/g)];
    const expenseCause = expenseCauses.some(match => {
      const before = sentence.slice(Math.max(0, match.index! - 20), match.index);
      const negativeBefore = /(?:未(?:能|完全)?|没有(?:完全)?)(?:体现为|转化为|实现)?\s*$/.test(before);
      const negativeOutcome = /^利润[^，；;。]{0,20}(?:未|没有)(?:能|完全)?(?:增长|改善)/.test(match[1]!);
      return !negativeBefore && !negativeOutcome;
    });
    const profitCauseProof = /(?:operating profit|profit growth)[^.]{0,160}(?:due to|driven by|reflecting)[^.]{0,100}(?:marketing|expense|spending)/i.test(quotes);
    if (expenseCause && !profitCauseProof) errors.push(`${path}:EXPENSE_INCREASE_NOT_PROFIT_GROWTH_EXPLANATION`);
    const fxSubject = /汇兑|外汇|重估|非现金|未实现/;
    const unprovedClaim = /一次性|不再(?:发生|重复)|不会(?:重复|持续)|非经常扰动/;
    const stableClaim = /核心盈利(?:稳定|稳健)|核心利润(?:稳定|稳健)|盈利(?:不会受|保持稳定)/;
    // Bind a one-off or stable-profit claim to its own FX clause. A later
    // "但...一次性项目仍未取得" is a missing read, not an FX conclusion.
    let priorFxSubject = false;
    const claims = sentence.split(/[，,]/).map(part => {
      const continuation = part.trim().replace(/^(?:但|然而|不过)\s*/, "");
      const subjectlessContinuation = /^(?:(?:且|并且|则|从而|因此|所以|故|也)\s*)?(?:属(?:于)?|是|为|被视为|可(?:以)?视为|视作|意味着|说明|证明)/.test(continuation);
      const scoped = fxSubject.test(part) || priorFxSubject && subjectlessContinuation;
      priorFxSubject = scoped;
      const unknown = /是否|能否|未取得|未核实|尚缺|待核|尚未确认|仍未确认|不能|无法|不代表|不等于|不足以/.test(part);
      return { once: scoped && !unknown && unprovedClaim.test(part),
        stable: scoped && !unknown && stableClaim.test(part) };
    });
    const once = claims.some(claim => claim.once);
    const stable = claims.some(claim => claim.stable);
    // A one-off grant elsewhere in the same page cannot prove FX recurrence.
    const fxProof = /(?:foreign exchange|汇兑)[^。\n]{0,100}(?:one-off|non-recurring|一次性)/i.test(quotes);
    const coreProof = /(?:core profit|核心盈利)[^。\n]{0,60}(?:stable|稳定)/i.test(quotes);
    const futureCheck = /(?:核查|核对|检查)[^。]{0,120}(?:以判断|判断是否)/.test(sentence)
      && !/则|因此|证明|意味着|确定|不会/.test(sentence);
    if (!futureCheck && ((once && !fxProof) || (stable && !coreProof))) errors.push(`${path}:NONCASH_NOT_ONE_OFF_OR_FX_FUTURE_STABILITY`);
    const retainedEventGap = /(?:未|未能|未予|尚未|仍未|不能|无法)排除|(?:需|应)(?:优先|进一步)?排除或确认/.test(sentence);
    if (!retainedEventGap && /排除|不存在|没有|无/.test(sentence) && /(?:所有|任何)?公司(?:特异|特有|个别)(?:事件|因素|风险)|company-specific/i.test(sentence)) {
      errors.push(`${path}:SCOPED_SEARCH_CANNOT_EXCLUDE_ALL_COMPANY_EVENTS`);
    }
    if (/政策|会计(?:方法|口径)|摊销/.test(sentence) && /未变|不变|相同|保持一致/.test(sentence)
      && /(?:属|由|因|证明|反映).*投入扩张|阶段性|暂时|短期(?:压力|影响)|以后(?:消退|恢复)/.test(sentence)) {
      const cause = /amortis[^.]{0,100}(?:expansion|development expenditure)|摊销[^。]{0,60}(?:投入扩张|开发支出增加)/i.test(quotes);
      const temporary = /(?:amortis|摊销)[^.。]{0,100}(?:temporary|短期|阶段性)/i.test(quotes);
      if (!cause || (/阶段性|暂时|短期/.test(sentence) && !temporary)) errors.push(`${path}:UNCHANGED_POLICY_DOES_NOT_PROVE_CAUSE_OR_TEMPORARY_PRESSURE`);
    }
  }
  return errors;
}
function cashDetailRecurrenceAssertion(sentence: string): boolean {
  return /经营(?:活动)?现金流|营运资本/.test(sentence)
    && /(?:细分|明细|科目构成)[^。]{0,90}(?:决定|以判断|才能判断)[^。]{0,90}(?:可持续|一次性|复现)/.test(sentence)
    && !/(?:不能|无法|不足以|未必|不)(?:直接|单独|据此|用以)?决定|跨期|持续驱动|经济敞口|未来驱动/.test(sentence);
}
function fxSplitRecurrenceAssertion(sentence: string): boolean {
  const decisions = [...sentence.matchAll(/(?:细分|拆分|已实现|未实现)[^。]{0,60}?决定[^。]{0,45}(?:复现|重复|一次性)/g)];
  return decisions.some(match => !/(?:不能|无法|不足以|未必|不)(?:直接|单独|据此|用以)?决定/.test(match[0]));
}
export function visibleInferenceErrors(value: unknown, evidence: InvestigationEvidence, summaryFacts: Basis[][] = []): string[] {
  const errors: string[] = [];
  const root = value as { whatHappened?: Record<string, unknown>[]; confirmedInformation?: Record<string, unknown>[]; reasoning?: { explanations?: Record<string, unknown>[] }; report?: { sections?: Record<string, unknown>[] } };
  const summaryQuotes = [root?.whatHappened, root?.confirmedInformation, root?.report?.sections].flatMap(items => Array.isArray(items) ? items : [])
    .concat(summaryFacts.map(basis => ({ basis }))).map(node => selectedQuotes(node, evidence)).join("\n");
  const readPrepaymentCash = evidence.sources.some(s => s.symbol === evidence.symbol && s.readStatus === "BODY_READ"
    && s.sourceType === "official_pdf" && /included in our operating cash flow were[^.]{0,120}prepayments/i.test(s.text));
  function visit(v: unknown, path: string, quotes: string) {
    if (typeof v === "string") {
      // Summary and unknown-importance prose have no basis slot in this schema.
      // Reuse only this answer's selected factual originals, never all read pages;
      // each explanation/definition assessment keeps its own selected quotes.
      errors.push(...inferenceErrors(v, /^(?:analysis\.reasoning\.summary|analysis\.largestUnknown\.why|analysis\.reasoning\.unknowns\.\d+\.whyThisMatters\.why)$/.test(path) ? summaryQuotes : quotes, path));
      // Missing payment/account detail does not erase the issuer's already-read
      // statement that these prepayments were included in operating cash flow.
      if (readPrepaymentCash && /预付款|调整口径/.test(v)
        && /才能(?:判断|确认)[^。]{0,50}是否[^。]{0,20}(?:真实)?现金流出|现金性质[^。]{0,50}(?:未取得|尚未确认)/.test(v)) {
        errors.push(`${path}:PREPAYMENTS_ALREADY_DISCLOSED_IN_OPERATING_CASH_FLOW_keep_issuer_attribution_unknown_only_independent_amount_and_account_details`);
      }
    }
    else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${path}.${i}`, quotes));
    else if (v && typeof v === "object") {
      const node = v as Record<string, unknown>;
      // These fields are projected from this exact assessment. Preserve the
      // same selected-evidence binding used by reasoningTextErrors; never use
      // a different hypothesis or the whole source catalog as its basis.
      const assessments = typeof node.hypothesisId === "string" && /^analysis\.reasoning\.nextQuestions\.\d+$/.test(path)
        ? root.reasoning?.explanations?.filter(e => e.hypothesisId === node.hypothesisId) ?? [] : [];
      const inherited = assessments.length === 1 ? selectedQuotes(assessments[0]!, evidence) : "";
      const local = selectedQuotes(node, evidence) || inherited || quotes;
      for (const [k, x] of Object.entries(node)) if (!["quote", "claim", "proposition", "sourceIds", "hypothesisId", "receipt"].includes(k)) visit(x, `${path}.${k}`, local);
    }
  }
  visit(value, "analysis", "");
  return [...new Set(errors)];
}
const topics: Array<[string, RegExp]> = [
  ["cash", /现金流|经营现金|经营活动(?:产生现金|现金产生额)|所得税现金支付|营运资金|营运资本|现金转化|cash flow|working capital/i],
  ["adjustments", /非IFRS|non-IFRS|公允价值|股份酬金|联营/i],
  ["other_gains", /其他收益|其他损益|other gains/i],
  ["fx", /汇兑|外汇|外币|币种|重估|foreign exchange/i],
  ["rd", /研发|开发支出|摊销|research and development|amorti/i],
  ["tax", /所得税|税费|税率|少数股东|non-controlling|NCI/i],
  ["selling", /销售.*(?:费用|开支)|分销|行政(?:费|开支)/],
  ["funding", /卖空|资金面|南向|调仓|money flow/i],
  ["group", /集团|上市公司责任|主体边界/]
];
function topicSet(text: string) { return topics.filter(([, re]) => re.test(text)).map(([id]) => id); }
const questionKey = (s: string) => s.replace(/[\s，。？?；;：:、！!]/g, "").replace(/请|能否|是否|帮我|再|进一步/g, "");
export function questionAndPlanErrors(value: unknown, evidence: InvestigationEvidence): string[] {
  const data = value as { reasoning?: { summary?: string; nextQuestions?: Array<{ question: string }>; explanations?: Array<{ hypothesisId: string; claimCoverage: {claim: string; conclusion: string} }> }; nextCheck?: string;
    hypothesisResults?: Array<{ hypothesisId: string; explanation: string; proposition?: string }> };
  const investigation = (evidence as Partial<InvestigatedEvidence>).investigation;
  const question = evidence.currentQuestion, errors: string[] = [];
  if (question) {
    for (const text of [data.nextCheck, ...(data.reasoning?.nextQuestions ?? []).map(q => q.question)]) {
      if (text && questionKey(text) === questionKey(question)) errors.push("CURRENT_QUESTION_RECOMMENDED_AGAIN");
      const stoppingLimit = typeof text === "string" && text === data.nextCheck && data.reasoning?.nextQuestions?.length === 0
        && /本轮已读资料中尚未取得|本轮已读范围.*尚未取得/.test(text)
        && /无需重复取得|不能继续|需.*新.*原文/.test(text);
      const suggested = text === data.nextCheck ? text?.split(/[；;]/).at(-1) : text;
      // Rewording the same missing split is not a new path unless the new
      // question identifies a narrower source, transaction or accounting link.
      if (suggested && !stoppingLimit && isNarrowFinancialQuestion(question) && /已实现/.test(question) && /未实现/.test(question) && /已实现/.test(suggested) && /未实现/.test(suggested)
        && !/附注\s*\d|现金流调节|结算记录|衍生.*合同|外汇远期(?:合约|合同).*(?:名义金额|期限结构)|借款.*附注|子公司.*报表/.test(suggested)) errors.push("FOLLOWUP_REPEATS_SAME_FX_SCOPE_WITHOUT_NEW_PATH");
    }
    if (isNarrowFinancialQuestion(question) && /汇兑|外汇/.test(question) && /拆分|已实现|未实现|币种/.test(question)
      && !/汇兑|外汇|已实现|未实现|币种/.test(data.reasoning?.summary ?? "")) errors.push("SUMMARY_DOES_NOT_ANSWER_CURRENT_FX_QUESTION");
  }
  if (investigation) errors.push(...planPropositionErrors(data, investigation, question), ...currentEventEvidenceErrors(value, evidence, investigation), ...completedLookupCoverageErrors(value, evidence, investigation), ...requestedCashBoundaryErrors(data, evidence, investigation));
  return [...new Set(errors)];
}
function requestedCashBoundaryErrors(data: Parameters<typeof questionAndPlanErrors>[0], evidence: InvestigationEvidence, investigation: InvestigatedEvidence["investigation"]): string[] {
  const d = data as { confirmedInformation?: Array<{ text: string }>; reasoning?: { explanations?: Array<{ hypothesisId: string; supportingEvidence?: Basis[]; claimCoverage: { conclusion: string } }> } };
  const question = evidence.currentQuestion ?? "";
  if (!Array.isArray(d.confirmedInformation) || !/经营现金流/.test(question) || !/自由现金流/.test(question) || !/股东回报/.test(question)
    || !readInvestigationFinance(evidence).calculations.some(c => c.metric === "operating_cash_after_two_asset_payments")) return [];
  return investigation.plan.hypotheses.filter(h => /自由现金流边界/.test(h.explanation)).flatMap(h => {
    const assessment = d.reasoning?.explanations?.find(e => e.hypothesisId === h.id);
    const selected = financialNumberEvidence(evidence, assessment?.supportingEvidence ?? []).selectedFacts;
    const errors = ["operating_cash_flow", "property_plant_equipment_payments", "intangible_asset_addition_payments"].every(metric => selected.some(f => f.metric === metric)) ? []
      : [`${h.id}:CASH_BOUNDARY_REQUIRES_OWN_OCF_AND_TWO_PAYMENT_ROWS_tax_note_quotes_do_not_prove_cash_residual_boundary`];
    const text = [assessment?.claimCoverage.conclusion ?? "",
      ...(d.confirmedInformation ?? []).filter(c => /余量|两类资产现金付款/.test(c.text)).map(c => c.text)].join("\n");
    return /(?:不是|不等于|非|不代表)[^。]{0,35}自由现金流/.test(text)
      && /(?:不是|不等于|不代表|不能|非)[^。]{0,70}(?:可分配|股东现金|股东回报)/.test(text) ? errors
      : [...errors, `${h.id}:REQUESTED_CASH_BOUNDARY_REQUIRED_two_payment_residual_is_not_issuer_FCF_or_distributable_shareholder_cash`];
  });
}

// A descriptive check does not become incomplete because a different causal
// check remains open. Restrict this to the application's explicit lookup plan
// and figures actually selected in this assessment's original quotations.
function completedLookupCoverageErrors(value: unknown, evidence: InvestigationEvidence, investigation: InvestigatedEvidence["investigation"]): string[] {
  if (evidence.mode !== "earnings_quality" || investigation.planningOrigin !== "application_information_lookup") return [];
  const data = value as { reasoning?: { explanations?: Array<{ hypothesisId: string; claimCoverage?: { assessment: string }; supportingEvidence?: Basis[]; contradictingEvidence?: Basis[] }> } };
  const finance = readInvestigationFinance(evidence), errors: string[] = [];
  for (const h of investigation.plan.hypotheses) {
    const x = data.reasoning?.explanations?.find(e => e.hypothesisId === h.id);
    if (!x?.claimCoverage || x.claimCoverage.assessment === "direct") continue;
    const selected = financialNumberEvidence(evidence, [...(x.supportingEvidence ?? []), ...(x.contradictingEvidence ?? [])]).selectedFacts;
    const error = completedDescriptiveCheck(h.explanation, finance, selected);
    if (error) errors.push(`${h.id}:${error}`);
  }
  return errors;
}
function completedDescriptiveCheck(proposition: string, finance: ReturnType<typeof readInvestigationFinance>, selected: typeof finance.facts): string | null {
  const covers = (f: typeof finance.facts[number]) => selected.some(s => s.metric === f.metric && s.period.start === f.period.start && s.period.end === f.period.end && s.currency === f.currency && s.value * s.unitScale === f.value * f.unitScale);
  if (proposition === "核对收入、法定利润与经营现金流的同期间变化，区分增长方向与增长速度") {
    const comparison = primaryFinancialComparison(finance);
    if (comparison?.rows.every(row => covers(row.current) && covers(row.previous))) return "COMPLETED_COMPARISON_MUST_BE_DIRECT_keep_causal_gap_in_its_own_current_plan_check";
  }
  if (proposition === "核对自由现金流计算构成及列示期间，区分经营现金、资本付款和发行人调整口径") {
    const required = ["free_cash_flow", "issuer_pro_forma_fcf_difference"].map(metric => finance.calculations.find(c => c.metric === metric));
    if (required.every(c => c && c.operandIds.every(id => finance.facts.some(f => f.id === id && covers(f))))) return "READ_FCF_COMPOSITION_MUST_BE_DIRECT_keep_independent_payment_detail_separate";
  }
  return null;
}
// This is a read-completeness hint, not an accepted answer. The returned
// assessment must still select its own originals and pass every content guard.
export function sourceBoundCompletedLookupChecks(evidence: InvestigationEvidence): string[] {
  const investigation = (evidence as Partial<InvestigatedEvidence>).investigation;
  if (evidence.mode !== "earnings_quality" || investigation?.planningOrigin !== "application_information_lookup") return [];
  const finance = readInvestigationFinance(evidence);
  return investigation.plan.hypotheses.filter(h => completedDescriptiveCheck(h.explanation, finance, finance.facts)).map(h => h.id);
}

function currentEventEvidenceErrors(value: unknown, evidence: InvestigationEvidence, investigation: InvestigatedEvidence["investigation"]): string[] {
  if (evidence.mode !== "price_move") return [];
  const data = value as { reasoning?: { explanations?: Array<{ hypothesisId: string; claimCoverage?: {assessment: string}; supportingEvidence: Basis[]; contradictingEvidence: Basis[] }> } };
  const errors: string[] = [];
  for (const h of investigation.plan.hypotheses) {
    if (!h.tasks?.length || !h.tasks.every(task => ["official_disclosures", "news", "issuer_group"].includes(task))) continue;
    const explanation = data.reasoning?.explanations?.find(e => e.hypothesisId === h.id);
    if (!explanation) continue;
    const inspected = new Set((investigation.checks ?? []).filter(check => h.tasks.includes(check.task)).flatMap(check => check.sourceIds));
    const basis = [...(explanation.supportingEvidence ?? []), ...(explanation.contradictingEvidence ?? [])];
    if (basis.some(b => !inspected.has(b.sourceId))) errors.push(`${h.id}:CURRENT_EVENT_CITATION_NOT_FROM_ITS_COMPANY_NEWS_CHECKS`);
  }
  return errors;
}

function planPropositionErrors(data: Parameters<typeof questionAndPlanErrors>[0], investigation: InvestigatedEvidence["investigation"], question?: string): string[] {
  const d = data as { reasoning?: { explanations?: Array<{ hypothesisId: string; claimCoverage: {claim: string; conclusion: string} }> }; hypothesisResults?: Array<{ hypothesisId: string; explanation: string; proposition?: string }> };
  const errors: string[] = [];
  for (const h of investigation.plan.hypotheses) {
    const result = d.hypothesisResults?.find(r => r.hypothesisId === h.id);
    const coverage = d.reasoning?.explanations?.find(r => r.hypothesisId === h.id)?.claimCoverage;
    const planTopics = topicSet(h.explanation);
    for (const [field, text] of [["claim", coverage?.claim], ["conclusion", coverage?.conclusion], ["result", result?.explanation]] as const) {
      if (!text) continue;
      const actual = topicSet(text);
      const currentFxSplit = isNarrowFinancialQuestion(question ?? "") && /汇兑|外汇/.test(question ?? "") && /已实现|未实现/.test(question ?? "");
      if (currentFxSplit && /汇兑/.test(h.explanation) && !actual.includes("fx")) errors.push(`${h.id}.${field}:CURRENT_PLAN_PROPOSITION_MISMATCH_missing_fx_in_conclusion_for_${h.explanation}`);
      else if (planTopics.length && actual.length && !planTopics.some(t => actual.includes(t))) errors.push(`${h.id}.${field}:CURRENT_PLAN_PROPOSITION_MISMATCH`);
      if (/汇兑/.test(h.explanation) && /未实现/.test(h.explanation) && field === "claim" && !/未实现|重估/.test(text)) errors.push(`${h.id}.${field}:UNREALISED_FX_PROPOSITION_LOST`);
      if (/汇兑/.test(h.explanation) && /已实现/.test(h.explanation) && !/未实现/.test(h.explanation) && field === "claim" && !/已实现|结算/.test(text)) errors.push(`${h.id}.${field}:SETTLEMENT_FX_PROPOSITION_LOST`);
    }
    if (result?.proposition && result.proposition !== h.explanation) errors.push(`${h.id}:PROPOSITION_NOT_CURRENT_PLAN`);
  }
  return errors;
}
