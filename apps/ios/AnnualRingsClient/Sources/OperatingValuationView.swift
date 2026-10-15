import SwiftUI

struct OperatingValuationView: View {
    let initial: ResearchOperatingReasoning
    var body: some View {
        OperatingBoundPage(initial: initial, title: "经营情景与估值") { value in
            Text("以盈利假设检验价格").font(.system(size: 19, weight: .semibold))
            Text("Bear / Base / Bull 各自保存经营输入。缺少的假设保持 UNKNOWN；PE 是 Owner 条件，结果为情景估值。").font(.caption).foregroundStyle(Theme.textSecondary)
            NavigationLink("Current Base 版本 · 预期差 · 研究基线") { ResearchUnderwritingView(initial: value) }.accessibilityIdentifier("phase11ValuationUnderwriting")
            ForEach(value.scenarios, id: \.name) { scenario in
                NavigationLink { OperatingScenarioDetail(scenario: scenario, initial: value) } label: {
                    HStack { VStack(alignment: .leading, spacing: 6) { Text(scenario.name.capitalized).font(.system(size: 16, weight: .semibold)); Text(scenario.status == "complete" ? "正常化盈利 · \(operatingValue(scenario.normalizedProfit, currency: scenario.currency))" : "UNKNOWN · 经营或估值假设待补充").font(.system(size: 12)).foregroundStyle(Theme.textSecondary) }; Spacer(); Image(systemName: "chevron.right").font(.caption) }.padding(15).background(Theme.bgSecondary, in: RoundedRectangle(cornerRadius: 10))
                }.buttonStyle(.plain).accessibilityIdentifier("operatingScenario-\(scenario.name)")
            }
            NavigationLink("编辑三情景、Thesis 与股本汇率") { OperatingModelEditor(initial: value) }.accessibilityIdentifier("operatingModelEdit")
            Divider()
            NavigationLink("市场隐含盈利 · Reverse Valuation") { OperatingReverseView(initial: value) }.accessibilityIdentifier("operatingReverseEntry")
        }
    }
}
struct OperatingScenarioDetail: View {
    let scenario: OperatingScenarioResult; let initial: ResearchOperatingReasoning
    var body: some View {
        OperatingBoundPage(initial: initial, title: "\(scenario.name.capitalized) 情景") { _ in
            Text("HYPOTHESIS · \(scenario.period.start ?? "") 至 \(scenario.period.end) · \(scenario.currency)").foregroundStyle(Theme.gold)
            ForEach(operatingInputKeys, id: \.self) { key in
                if let input = scenario.inputs[key] {
                    VStack(alignment: .leading, spacing: 4) { HStack { Text(operatingMetricTitle(key)); Spacer(); Text(input.value.map { key == "gross_margin" ? String(format: "%.2f%%", $0 * 100) : $0.formatted() } ?? "UNKNOWN").foregroundStyle(Theme.blue) }; Text(originTitle(input.origin) + (input.note.isEmpty ? "" : " · \(input.note)")).font(.system(size: 11)).foregroundStyle(Theme.textSecondary) }
                    if let id = input.sourceValueId, let fact = initial.facts.first(where: { $0.id == id }) { NavigationLink("输入事实及来源") { OperatingFactDetail(fact: fact) } }
                }
            }
            Divider()
            Text("情景正常化盈利：\(operatingValue(scenario.normalizedProfit, currency: scenario.currency))")
            Text("情景股权价值：\(operatingValue(scenario.equityValue, currency: scenario.currency))")
            Text("每股情景值：\(operatingValue(scenario.perShareValue, currency: scenario.perShareCurrency))").foregroundStyle(Theme.blue)
            Text("当前状态：\(scenario.status == "complete" ? "可计算" : "UNKNOWN")").foregroundStyle(Theme.gold)
            if !scenario.missing.isEmpty { Text(scenario.missing.joined(separator: "\n")).font(.caption).foregroundStyle(Theme.textSecondary) }
            DisclosureGroup("计算与输入记录") { ForEach(Array(scenario.calculations.enumerated()), id: \.offset) { _, c in Text("INTERPRETATION · deterministic_calculation\n\(c.formula)\n= \(c.value.formatted())").font(.system(size: 11, design: .monospaced)).padding(.vertical, 5) } }
            ForEach(Array((initial.sensitivity ?? []).enumerated()), id: \.offset) { _, result in
                Text("Assumption sensitivity · \(result.variable) = \(result.value.formatted()) → \(operatingValue(result.perShareValue, currency: scenario.perShareCurrency))").font(.caption)
                Text(result.limitation).font(.caption).foregroundStyle(Theme.textSecondary)
            }
            NavigationLink("编辑研究草稿") { OperatingModelEditor(initial: initial) }
        }
    }
}
struct OperatingReverseView: View {
    let initial: ResearchOperatingReasoning
    var body: some View {
        OperatingBoundPage(initial: initial, title: "市场隐含盈利") { value in
            let reverse = value.reverseValuation
            Text("Observed · 可观察市场事实").fontWeight(.semibold)
            if let q = reverse.observed { Text("\(q.symbol) · \(q.price.formatted()) \(q.currency)"); Text("报价：\(q.asOf)\n读取：\(q.fetchedAt) · \(q.source)\n\(q.fresh ? "时效检查通过" : "报价已过期，不能作为当前反推输入")").font(.caption).foregroundStyle(Theme.textSecondary) } else { Text("UNKNOWN · 当前价格不可用").foregroundStyle(Theme.gold) }
            if let share = value.facts.first(where: { $0.id == value.model.sharesValueId }) { NavigationLink("股本参考 · \(operatingValue(share.value, unit: "shares")) · \(share.period.end)") { OperatingFactDetail(fact: share) } }
            if let reference = value.sharesReference { NavigationLink("股数计算 · \(operatingValue(reference.value, unit: "shares"))") { OperatingNodeDetail(node: reference, symbol: value.symbol) } }
            Divider()
            Text("Implied · 给定 PE 后的隐含盈利").fontWeight(.semibold)
            if let implied = reverse.implied { Text(operatingValue(implied.normalizedEarnings, currency: implied.currency)).foregroundStyle(Theme.blue); Text("INTERPRETATION · Owner PE \(implied.assumedPE.formatted())\n\(implied.formula)").font(.caption) }
            else { Text("UNKNOWN · 缺少反推条件").foregroundStyle(Theme.gold).accessibilityIdentifier("operatingReverseUnknown"); Text(reverse.reasons.joined(separator: "\n")).font(.caption).foregroundStyle(Theme.textSecondary) }
            Divider()
            Text("Owner View · Base 情景").fontWeight(.semibold)
            Text(operatingValue(reverse.ownerView?.normalizedEarnings, currency: reverse.ownerView?.currency))
            Text("Gap · 隐含盈利减 Owner Base").fontWeight(.semibold)
            Text(operatingValue(reverse.gap, currency: reverse.ownerView?.currency))
            if let required = value.conditionalRequirements {
                Text("conditional implied · 其他 Owner 假设固定").font(.headline)
                Text("所需毛利率：" + operatingValue(required.margin, unit: "ratio")); Text("所需收入：" + operatingValue(required.revenue, currency: reverse.ownerView?.currency))
            }
            Text(reverse.limitation).font(.caption).foregroundStyle(Theme.textSecondary)
            NavigationLink("补充明确的 Owner 假设") { OperatingModelEditor(initial: value) }
        }
    }
}
let operatingInputKeys = ["sales_volume", "asp", "revenue", "gross_margin", "opex", "net_adjustments", "normalized_profit", "pe"]
private func originTitle(_ value: String) -> String { ["unknown":"UNKNOWN", "source_fact":"来源事实", "owner_assumption":"Owner 假设", "system_calculation":"公式计算"][value] ?? value }

struct OperatingModelEditor: View {
    let initial: ResearchOperatingReasoning
    @State private var testsEdited = false
    @State private var testComparison = "increase_vs_previous"
    @State private var referencePeriod = "previous_year"
    @State private var thresholdLower = ""
    @State private var thresholdUpper = ""
    @State private var aggregationRule = "owner_review"
    @State private var preview: ResearchOperatingReasoning?
    @State private var model: OperatingResearchModel
    @State private var selectedScenario = 1
    @State private var guidedStep = 0
    @State private var revisionAssessment = "insufficient_evidence"
    @State private var retainedEvidence = ""
    @State private var weakenedParts = ""
    @State private var revisionText = ""
    @State private var revisionReason = ""
    @State private var peSensitivityText = ""
    @State private var otherRevenueText = ""
    @State private var nextValidation = ""
    @State private var newHypotheses = ""
    @State private var abandonedHypotheses = ""
    @State private var confirmRevision = false
    @State private var sensitivityVariable = "pe"
    @State private var sensitivityLower = ""
    @State private var sensitivityUpper = ""
    @State private var valueTexts: [String: String] = [:]
    @State private var fxFrom = "CNY"
    @State private var fxTo = "HKD"
    @State private var fxText = ""
    @State private var fxDate = ""
    @State private var fxNote = ""
    @State private var message = ""
    @State private var requestKey = "operating-model-\(UUID().uuidString)"
    @State private var lastSavePayload: Data?
    @State private var saving = false
    @State private var saved = false
    @ObservedObject private var api = OwnerClientStore.shared
    init(initial: ResearchOperatingReasoning) {
        self.initial = initial; _model = State(initialValue: initial.model)
        let first = initial.model.thesisTests?.first
        _testComparison = State(initialValue: first?.comparison ?? (initial.model.thesisBinding?.thesisDimension == "sales_growth" ? "above_zero" : "increase_vs_previous"))
        _referencePeriod = State(initialValue: first?.referencePeriod ?? "previous_year")
        _aggregationRule = State(initialValue: initial.model.thesisEvidencePlan?.aggregationRule ?? "owner_review")
        if let threshold = first?.threshold { switch threshold { case .number(let n): _thresholdLower = State(initialValue: String(n)); case .range(let l, let u): _thresholdLower = State(initialValue: String(l)); _thresholdUpper = State(initialValue: String(u)) } }
    }
    var body: some View {
        Form {

            Section("已有 Thesis · 显式选择") {
                if let tests = model.thesisTests, !tests.isEmpty {
                    Text("已有独立 Tests；修改其他模型输入会保留原规则。修改下方检验设置后才重建本组 Tests。").font(.caption)
                    ForEach(tests) { test in Text(test.metrics.map(operatingMetricTitle).joined(separator: "、") + " · " + operatingComparisonTitle(test.comparison)).font(.caption) }
                }
                if initial.model.thesisBinding == nil {
                    Text("正式 Thesis 请在「正式 Thesis」页面明确选择并确认。")
                        .font(.caption).foregroundStyle(.secondary)
                    if let membership = api.membershipEnvelope?.memberships.first(where: { $0.id == initial.membershipId && $0.version == initial.membershipVersion && $0.symbol == initial.symbol }) {
                        NavigationLink("进入正式 Thesis") { ThesisFormationView(membership: membership) }
                            .accessibilityIdentifier("phase15FormationFromOperatingModel")
                    }
                } else {
                    Text("当前正式 Thesis 已绑定；修订须走正式 Thesis Owner Action / new lineage。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if model.thesisBinding != nil {
                    Picker("检验维度（Owner 选择）", selection: Binding(get: { model.thesisBinding?.thesisDimension ?? "custom_unknown" }, set: { model.thesisBinding?.thesisDimension = $0; model.thesisBinding?.proposition = nil })) {
                        ForEach(["custom_unknown", "sales_growth", "product_mix", "profitability", "cash_flow", "non_operating_quality", "valuation_evidence"], id: \.self) { Text($0).tag($0) }
                    }.accessibilityIdentifier("phase5Dimension")
                }
                if model.thesisBinding != nil {
                    Picker("命题观察窗口", selection: Binding(get: { model.thesisBinding?.proposition?.periodType ?? "interim" }, set: { value in ensureProposition(); model.thesisBinding?.proposition?.periodType = value })) { Text("单月").tag("monthly"); Text("半年").tag("interim"); Text("全年").tag("annual"); Text("年初至今").tag("ytd"); Text("时点条件").tag("instant") }
                    Picker("检验方向", selection: Binding(get: { model.thesisBinding?.proposition?.direction ?? "increase" }, set: { value in ensureProposition(); model.thesisBinding?.proposition?.direction = value })) { Text("上升").tag("increase"); Text("下降").tag("decrease") }
                    ForEach(propositionMetrics, id: \.self) { metric in
                        Toggle(operatingMetricTitle(metric), isOn: Binding(get: { model.thesisBinding?.proposition?.metrics.contains(metric) ?? false }, set: { enabled in
                            ensureProposition(); model.thesisBinding?.proposition?.metrics.removeAll { $0 == metric }; if enabled { model.thesisBinding?.proposition?.metrics.append(metric) }
                        })).accessibilityIdentifier("phase5Metric-" + metric)
                    }
                    if model.thesisBinding?.thesisDimension == "product_mix" { TextField("明确产品分类（例如 Galaxy）", text: Binding(get: { model.thesisBinding?.proposition?.mixNode ?? "" }, set: { value in ensureProposition(); model.thesisBinding?.proposition?.mixNode = value })) }
                    Picker("比较规则", selection: $testComparison) { ForEach(["above_zero", "below_zero", "increase_vs_previous", "decrease_vs_previous", "at_least", "at_most", "range", "directional_change"], id: \.self) { Text(operatingComparisonTitle($0)).tag($0) } }.accessibilityIdentifier("phase6Comparison")
                    Picker("明确比较期", selection: $referencePeriod) { Text("上年同期间").tag("previous_year"); Text("紧邻前一期").tag("previous_period") }
                    if ["at_least", "at_most", "range"].contains(testComparison) { TextField("阈值 / 下界", text: $thresholdLower).keyboardType(.numbersAndPunctuation) }
                    if testComparison == "range" { TextField("上界", text: $thresholdUpper).keyboardType(.numbersAndPunctuation) }
                    Picker("原 Thesis 汇总方式", selection: $aggregationRule) { Text("需要 Owner 复核（默认）").tag("owner_review"); Text("所有已选 Test 必须通过").tag("all_required"); Text("任一已选 Test 通过").tag("any_required") }
                    Text("每个指标形成独立 Test；以下汇总仅为证据草稿，不改写原判断。").font(.caption)
                    ForEach(model.thesisBinding?.proposition?.metrics ?? [], id: \.self) { metric in
                        Text(testScopeSummary(metric)).font(.caption).foregroundStyle(.secondary)
                    }
                    Button("预览 Thesis Update · 不保存") { Task { do { try configureThesisTests(); preview = try await api.previewOperatingModel(model, for: initial) } catch { message = (error as NSError).domain } } }.accessibilityIdentifier("phase5ThesisPreview")
                }
                if let b = model.thesisBinding { Text(b.conditionText).font(.caption); Text("报告 \(b.reportId) / v\(b.reportVersion) · 假设 \(b.conditionIndex + 1)").font(.caption2).foregroundStyle(.secondary) }
            }
            Section("独立经营情景") {
                Picker("情景", selection: $selectedScenario) { ForEach(0..<3) { i in Text(["Bear", "Base", "Bull"][i]).tag(i) } }.pickerStyle(.segmented)
                Picker("预测期间", selection: Binding(get: { model.scenarios[selectedScenario].scenarioPeriodType ?? "CURRENT_FY" }, set: { type in
                    guard type != (model.scenarios[selectedScenario].scenarioPeriodType ?? "CURRENT_FY") else { return }
                    let year = Int(model.scenarios[selectedScenario].period.end.prefix(4)) ?? 2026
                    for index in model.scenarios.indices {
                        model.scenarios[index].scenarioPeriodType = type
                        model.scenarios[index].period = type == "CURRENT_FY" ? OperatingPeriod(kind: "duration", type: "annual", start: "\(year)-01-01", end: "\(year)-12-31") : OperatingPeriod(kind: "duration", type: "interim", start: "\(year)-07-01", end: "\(year)-12-31")
                    }
                    resetForecastInputs()
                })) { Text("本财年").tag("CURRENT_FY"); Text("下一个报告期").tag("NEXT_REPORTING_PERIOD") }.accessibilityIdentifier("phase11ScenarioPeriod")
                Stepper("情景年度：\(model.scenarios[selectedScenario].period.end.prefix(4))", value: Binding(get: { Int(model.scenarios[selectedScenario].period.end.prefix(4)) ?? 2026 }, set: { year in guard year != Int(model.scenarios[selectedScenario].period.end.prefix(4)) else { return }; for index in model.scenarios.indices { let next = model.scenarios[index].scenarioPeriodType == "NEXT_REPORTING_PERIOD"; model.scenarios[index].period = next ? OperatingPeriod(kind: "duration", type: "interim", start: "\(year)-07-01", end: "\(year)-12-31") : OperatingPeriod(kind: "duration", type: "annual", start: "\(year)-01-01", end: "\(year)-12-31") }; resetForecastInputs() }), in: 2000...2050)
                TextField("情景币种（CNY / HKD / USD）", text: Binding(get: { model.scenarios[selectedScenario].currency }, set: { model.scenarios[selectedScenario].currency = $0.uppercased() })).font(.caption)
                Text("\(model.scenarios[selectedScenario].period.start ?? "") 至 \(model.scenarios[selectedScenario].period.end) · \(model.scenarios[selectedScenario].currency)").font(.caption)
                TextField("业务范围（与来源一致）", text: Binding(get: { model.scenarios[selectedScenario].basis?.businessScope ?? "" }, set: { text in
                    model.scenarios[selectedScenario].basis = OperatingScenarioBasis(accountingScope: model.scenarios[selectedScenario].basis?.accountingScope ?? "consolidated", businessScope: text, salesMeasurementBasis: model.scenarios[selectedScenario].basis?.salesMeasurementBasis ?? "issuer_sales")
                })).font(.caption).accessibilityIdentifier("phase4BusinessScope")
                if model.scenarios[selectedScenario].basis != nil {
                    Picker("会计范围", selection: Binding(get: { model.scenarios[selectedScenario].basis!.accountingScope }, set: { model.scenarios[selectedScenario].basis?.accountingScope = $0 })) { Text("合并").tag("consolidated"); Text("母公司").tag("parent_company") }
                    Picker("销量口径", selection: Binding(get: { model.scenarios[selectedScenario].basis!.salesMeasurementBasis }, set: { model.scenarios[selectedScenario].basis?.salesMeasurementBasis = $0 })) { Text("发行人销量").tag("issuer_sales"); Text("月批发").tag("monthly_wholesale"); Text("月零售").tag("monthly_retail") }
                }
                Text("修改年度或币种不会自动换算原假设，请重新核对各项。").font(.caption).foregroundStyle(.secondary)
                if guidedStep == 0 {
                    Toggle("按汽车收入 + 其他收入建模", isOn: Binding(get: { model.scenarios[selectedScenario].revenueComposition != nil }, set: { enabled in
                        for index in model.scenarios.indices {
                            model.scenarios[index].revenueComposition = enabled ? OperatingRevenueComposition(otherRevenue: OperatingScenarioInput(unit: "currency", value: nil, origin: "unknown", sourceValueId: nil, note: "")) : nil
                        }
                    }))
                    if model.scenarios[selectedScenario].revenueComposition != nil {
                        TextField("其他收入 · 留空为 UNKNOWN", text: $otherRevenueText).keyboardType(.numbersAndPunctuation)
                        TextField("其他收入假设依据", text: Binding(get: { model.scenarios[selectedScenario].revenueComposition?.otherRevenue.note ?? "" }, set: { model.scenarios[selectedScenario].revenueComposition?.otherRevenue.note = $0 }))
                        Text("销量 × ASP 仅得到汽车收入；其他收入缺失时，总收入保持 UNKNOWN。").font(.caption).foregroundStyle(.secondary)
                    }
                }
                Text("金额以元为单位；毛利率填 0–1。留空表示 UNKNOWN。填入数字时必须说明 Owner 假设依据。").font(.caption).foregroundStyle(.secondary)
                Picker("步骤", selection: $guidedStep) { Text("1 经营").tag(0); Text("2 盈利").tag(1); Text("3 估值").tag(2); Text("4 复核").tag(3) }.pickerStyle(.segmented)
                ForEach(guidedStep == 0 ? ["sales_volume", "asp", "revenue"] : guidedStep == 1 ? ["gross_margin", "opex", "net_adjustments", "normalized_profit"] : guidedStep == 2 ? ["pe"] : operatingInputKeys, id: \.self) { key in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(operatingMetricTitle(key) + " · " + inputUnitTitle(key)).font(.system(size: 13, weight: .medium))
                        let eligible = initial.facts.filter { $0.metric == (key == "asp" ? "average_selling_price" : key) && $0.category == "actual" && $0.comparability == "comparable" && $0.period == model.scenarios[selectedScenario].period && ($0.currency == nil || $0.currency == model.scenarios[selectedScenario].currency) }
                        if !eligible.isEmpty && key != "pe" {
                            Menu("使用同期间来源事实") {
                                ForEach(eligible) { fact in Button("\(fact.text)") {
                                    guard var input = model.scenarios[selectedScenario].inputs[key] else { return }
                                    input.value = fact.value * fact.unitScale; input.origin = "source_fact"; input.sourceValueId = fact.id; input.note = fact.limitation
                                    model.scenarios[selectedScenario].inputs[key] = input; valueTexts["\(selectedScenario):\(key)"] = input.value?.description ?? ""
                                    if ["issuer_sales", "monthly_wholesale", "monthly_retail"].contains(fact.measurementBasis) { model.scenarios[selectedScenario].basis = OperatingScenarioBasis(accountingScope: fact.accountingScope, businessScope: fact.businessScope, salesMeasurementBasis: fact.measurementBasis) }
                                } }
                            }.font(.caption)
                        }
                        let guidance = initial.facts.filter { $0.category == "guidance" && $0.metric == key && $0.period == model.scenarios[selectedScenario].period }
                        if !guidance.isEmpty { Menu("参考 Guidance → 用作 Owner 假设") { ForEach(guidance) { fact in Button("明确采用 \(fact.text)") {
                            let number = fact.value * fact.unitScale
                            valueTexts["\(selectedScenario):\(key)"] = number.description
                            model.scenarios[selectedScenario].inputs[key]?.origin = "owner_assumption"
                            model.scenarios[selectedScenario].inputs[key]?.sourceValueId = nil
                            model.scenarios[selectedScenario].inputs[key]?.note = "Owner 明确选择参考 Guidance；非实际业绩：" + fact.limitation
                            model.scenarios[selectedScenario].inputs[key]?.rationale = OperatingAssumptionRationale(reason: "参考管理层 Guidance，仍需自行评估兑现风险", basedOnFactIds: [], confidence: "low")
                            model.scenarios[selectedScenario].inputs[key]?.rationale?.basedOnGuidanceIds = [fact.id]
                        } } }.font(.caption) }
                        TextField("UNKNOWN", text: Binding(get: { valueTexts["\(selectedScenario):\(key)"] ?? "" }, set: { valueTexts["\(selectedScenario):\(key)"] = $0 })).keyboardType(.numbersAndPunctuation).accessibilityIdentifier("phase4Input-\(key)")
                        TextField("Owner 假设依据 / 来源说明", text: Binding(get: { model.scenarios[selectedScenario].inputs[key]?.note ?? "" }, set: { model.scenarios[selectedScenario].inputs[key]?.note = $0 }))
                            .font(.system(size: 12)).accessibilityIdentifier("phase4Reason-\(key)")
                        Picker("自评信心（非 AI 评分）", selection: Binding(get: { model.scenarios[selectedScenario].inputs[key]?.rationale?.confidence ?? "low" }, set: { confidence in
                            let old = model.scenarios[selectedScenario].inputs[key]
                            model.scenarios[selectedScenario].inputs[key]?.rationale = OperatingAssumptionRationale(reason: old?.note ?? "", basedOnFactIds: old?.rationale?.basedOnFactIds ?? [], confidence: confidence)
                            model.scenarios[selectedScenario].inputs[key]?.rationale?.basedOnGuidanceIds = old?.rationale?.basedOnGuidanceIds
                        })) { Text("低").tag("low"); Text("中").tag("medium"); Text("高").tag("high") }.font(.caption)
                        Menu("关联依据事实") {
                            ForEach(initial.facts) { fact in Button(fact.text) {
                                let old = model.scenarios[selectedScenario].inputs[key]
                                var ids = old?.rationale?.basedOnFactIds ?? []; if !ids.contains(fact.id) { ids.append(fact.id) }
                                model.scenarios[selectedScenario].inputs[key]?.rationale = OperatingAssumptionRationale(reason: old?.note ?? "", basedOnFactIds: ids, confidence: old?.rationale?.confidence ?? "low")
                                model.scenarios[selectedScenario].inputs[key]?.rationale?.basedOnGuidanceIds = old?.rationale?.basedOnGuidanceIds
                            } }
                        }.font(.caption)
                        Text(originTitle(model.scenarios[selectedScenario].inputs[key]?.origin ?? "unknown")).font(.caption2).foregroundStyle(.secondary)
                    }.padding(.vertical, 4)
                }
            }
            if guidedStep == 2 || guidedStep == 3 { Section("股本与货币换算") {
                Picker("有日期的股本参考", selection: Binding(get: { model.sharesValueId ?? "" }, set: { model.sharesValueId = $0.isEmpty ? nil : $0; model.sharesReferenceConfirmed = false })) {
                    Text("未选择").tag("")
                    ForEach(initial.facts.filter { ["shares_outstanding", "issued_shares"].contains($0.metric) }) { f in Text("\(f.period.end) · \(f.value.formatted()) 股").tag(f.id) }
                }
                if let fact = initial.facts.first(where: { $0.id == model.sharesValueId }) { NavigationLink("核对股本范围与来源") { OperatingFactDetail(fact: fact) } }
                Picker("股本类别（Owner 明确确认）", selection: Binding(get: { model.sharesClass ?? "" }, set: { model.sharesClass = $0.isEmpty ? nil : $0; model.sharesReferenceConfirmed = false })) { Text("尚未确认").tag(""); Text("普通股").tag("ordinary"); Text("A 类").tag("class_a"); Text("B 类").tag("class_b") }.accessibilityIdentifier("phase11SharesClass")
                Toggle("确认该日期与口径可用于本次情景", isOn: $model.sharesReferenceConfirmed)
                TextField("换算前币种", text: $fxFrom)
                TextField("换算后币种", text: $fxTo)
                TextField("明确汇率（缺省 UNKNOWN）", text: $fxText).keyboardType(.decimalPad)
                TextField("汇率日期 YYYY-MM-DD", text: $fxDate)
                TextField("汇率依据 / Owner 假设说明", text: $fxNote)
            }
            }
            if guidedStep == 3 {
                Section("Assumption sensitivity · Owner 明确范围") {
                    TextField("PE 单独数值，例如 8,10,12", text: $peSensitivityText).keyboardType(.numbersAndPunctuation).accessibilityIdentifier("phase11PESensitivity")
                    Text("中心 PE 仍取 Base 输入；此处仅为 Owner 指定的单变量敏感性，不是市场 PE。").font(.caption)
                    Picker("变量", selection: $sensitivityVariable) { ForEach(["pe", "normalized_profit", "gross_margin", "asp"], id: \.self) { Text(operatingMetricTitle($0)).tag($0) } }
                    TextField("下界（留空不计算）", text: $sensitivityLower).keyboardType(.numbersAndPunctuation)
                    TextField("上界", text: $sensitivityUpper).keyboardType(.numbersAndPunctuation)
                    Text("只对已完成的 Base 情景计算；不默认合理范围，不是价格预测。").font(.caption)
                }
                if model.thesisBinding != nil { Section("Thesis 修订 · 可留空") {
                    Picker("Owner 修订评估", selection: $revisionAssessment) { ForEach(["supports", "partially_supports", "weakens", "invalidates", "insufficient_evidence"], id: \.self) { Text(operatingAssessmentTitle($0)).tag($0) } }
                    TextField("保留的证据（每行一条）", text: $retainedEvidence, axis: .vertical)
                    TextField("被削弱的部分（每行一条）", text: $weakenedParts, axis: .vertical)
                    TextField("新的研究判断", text: $revisionText, axis: .vertical)
                    TextField("为什么修改", text: $revisionReason, axis: .vertical)
                    TextField("新增假设（每行一条）", text: $newHypotheses, axis: .vertical)
                    TextField("放弃假设（每行一条）", text: $abandonedHypotheses, axis: .vertical)
                    TextField("下一验证事件", text: $nextValidation, axis: .vertical)
                    Toggle("我明确确认这项研究修订", isOn: $confirmRevision)
                    Text("未勾选保存为 DRAFT；确认也不会替换原报告或正式决定。").font(.caption)
                } }
            }
            Section {
                Button(saving ? "保存并核对中…" : "保存研究草稿新版本") { Task { await save() } }.disabled(saving || saved).accessibilityIdentifier("operatingModelSaveFooter")
                Text("仅保存研究上下文版本，不替换原报告、正式 Thesis 或决定。").font(.caption).foregroundStyle(.secondary)
                if !message.isEmpty { Text(message).font(.caption).foregroundStyle(saved ? .green : .orange) }
            }
        }.onChange(of: model.thesisBinding) { _, _ in testsEdited = true }
        .onChange(of: testComparison) { _, _ in testsEdited = true }.onChange(of: referencePeriod) { _, _ in testsEdited = true }
        .onChange(of: thresholdLower) { _, _ in testsEdited = true }.onChange(of: thresholdUpper) { _, _ in testsEdited = true }
        .sheet(item: $preview) { value in NavigationStack { OperatingThesisUpdateView(initial: initial, preview: value).toolbar { ToolbarItem(placement: .topBarTrailing) { Button("关闭预览") { preview = nil } } } } }.safeAreaInset(edge: .bottom) { if !message.isEmpty { Text(message).font(.caption).foregroundStyle(saved ? .green : .orange).padding(12).frame(maxWidth: .infinity).background(.regularMaterial).accessibilityIdentifier("operatingModelStatus") } }.navigationTitle("研究模型草稿").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(saving ? "保存中" : "保存") { Task { await save() } }.disabled(saving || saved).accessibilityIdentifier("operatingModelSave") } }
            .onAppear { if valueTexts.isEmpty { for (i,s) in model.scenarios.enumerated() { for (k,v) in s.inputs { valueTexts["\(i):\(k)"] = v.value.map(String.init(describing:)) ?? "" } }; fxFrom = model.fx?.from ?? model.scenarios[1].currency; fxTo = model.fx?.to ?? "HKD"; fxText = model.fx?.rate.description ?? ""; fxDate = model.fx?.asOf ?? ""; fxNote = model.fx?.note ?? ""
                revisionAssessment = model.thesisRevision?.assessment ?? initial.thesisUpdate?.assessment ?? "insufficient_evidence"; retainedEvidence = model.thesisRevision?.retainedEvidence.joined(separator: "\n") ?? ""; weakenedParts = model.thesisRevision?.weakenedParts.joined(separator: "\n") ?? ""
                newHypotheses = model.thesisRevision?.addedHypotheses.joined(separator: "\n") ?? ""; abandonedHypotheses = model.thesisRevision?.abandonedHypotheses.joined(separator: "\n") ?? ""
                revisionText = model.thesisRevision?.newThesis ?? ""; revisionReason = model.thesisRevision?.reason ?? ""; nextValidation = model.thesisRevision?.nextValidationEvent ?? initial.nextResearchQuestion
                sensitivityVariable = model.sensitivity?.variable ?? "pe"; sensitivityLower = model.sensitivity?.lower.description ?? ""; sensitivityUpper = model.sensitivity?.upper.description ?? ""
                peSensitivityText = model.peSensitivityValues?.map(String.init(describing:)).joined(separator: ",") ?? ""
                otherRevenueText = model.scenarios[selectedScenario].revenueComposition?.otherRevenue.value.map(String.init(describing:)) ?? ""
            } }
    }
    private var propositionMetrics: [String] {
        switch model.thesisBinding?.thesisDimension {
        case "sales_growth": return ["sales_volume_yoy"]
        case "product_mix": return ["mix_share"]
        case "profitability": return ["revenue", "gross_margin", "gross_profit", "operating_profit", "profit_attributable_to_owners", "core_profit_attributable_to_owners", "operating_cash_flow"]
        case "valuation_evidence": return ["valuation_inputs_ready"]
        case "cash_flow": return ["operating_cash_flow", "free_cash_flow"]
        case "non_operating_quality": return ["fx_effect", "non_financial_impairment", "core_profit_attributable_to_owners", "profit_attributable_to_owners"]
        default: return []
        }
    }
    private func resetForecastInputs() {
        for index in model.scenarios.indices {
            for key in operatingInputKeys { if let old = model.scenarios[index].inputs[key] { model.scenarios[index].inputs[key] = OperatingScenarioInput(unit: old.unit, value: nil, origin: "unknown", sourceValueId: nil, note: ""); valueTexts["\(index):\(key)"] = "" } }
            if let old = model.scenarios[index].revenueComposition?.otherRevenue { model.scenarios[index].revenueComposition?.otherRevenue = OperatingScenarioInput(unit: old.unit, value: nil, origin: "unknown", sourceValueId: nil, note: "") }
        }
        otherRevenueText = ""; model.fx = nil; model.peSensitivityValues = nil; peSensitivityText = ""; model.sharesReferenceConfirmed = false
    }
    private func testSeries(_ metric: String) -> [OperatingEvidenceSeries] {
        guard let p = model.thesisBinding?.proposition else { return [] }
        return (initial.evidenceSeries ?? []).filter { s in
            s.identity.category == "actual" && s.identity.metric == metric && s.identity.periodType == p.periodType && s.current != nil
                && (metric != "mix_share" || (s.identity.taxonomy?.dimensionValue == p.mixNode && s.shareBasis == "total"))
        }
    }
    private func testScopeSummary(_ metric: String) -> String {
        let matches = testSeries(metric)
        guard matches.count == 1, let s = matches.first else { return "\(operatingMetricTitle(metric))：口径尚不唯一或无证据，检验保持 UNKNOWN。" }
        return "确认检验口径：\(operatingMetricTitle(metric)) · \(s.current?.period.end ?? "") · \(s.identity.accountingScope) / \(s.identity.businessScope) · \(s.identity.currency ?? "无币种") / \(s.identity.unit) × \(s.identity.unitScale.formatted()) · \(s.identity.measurementBasis)" + (s.shareBasis == "total" ? " · 占总销量" : "")
    }
    private func configureThesisTests() throws {
        if !testsEdited, let tests = model.thesisTests {
            if aggregationRule != (model.thesisEvidencePlan?.aggregationRule ?? "owner_review") { model.thesisEvidencePlan = OperatingThesisEvidencePlan(requiredTestIds: aggregationRule == "owner_review" ? [] : tests.filter { $0.status != "ARCHIVED" }.map(\.testId), aggregationRule: aggregationRule) }
            return
        }
        guard let binding = model.thesisBinding, let p = binding.proposition, !p.metrics.isEmpty else { model.thesisTests = []; model.thesisEvidencePlan = OperatingThesisEvidencePlan(requiredTestIds: [], aggregationRule: "owner_review"); return }
        var threshold: OperatingTestThreshold? = nil
        if ["at_least", "at_most", "range"].contains(testComparison) {
            guard let lower = Double(thresholdLower), lower.isFinite else { throw NSError(domain: "请填写明确的比较阈值", code: 400) }
            if testComparison == "range" { guard let upper = Double(thresholdUpper), upper.isFinite, upper >= lower else { throw NSError(domain: "请填写有效上界", code: 400) }; threshold = .range(lower, upper) } else { threshold = .number(lower) }
        }
        model.thesisTests = try p.metrics.map { metric in
            var test = OperatingThesisTest(binding: binding, metric: metric, dimension: ["operating_cash_flow", "free_cash_flow"].contains(metric) ? "cash_flow" : binding.thesisDimension ?? "custom_unknown", periodType: p.periodType, comparison: testComparison, direction: p.direction, threshold: threshold, mixNode: p.mixNode, referencePeriod: referencePeriod)
            let matches = testSeries(metric)
            if matches.count == 1 { test.evidenceRequirements = [metric: try matches[0].exactRequirement()] }
            return test
        }
        model.thesisEvidencePlan = OperatingThesisEvidencePlan(requiredTestIds: aggregationRule == "owner_review" ? [] : model.thesisTests!.map(\.testId), aggregationRule: aggregationRule)
    }
    private func ensureProposition() { if model.thesisBinding?.proposition == nil { model.thesisBinding?.proposition = OperatingProposition(metrics: [], periodType: "interim", direction: "increase") } }
    private var revisionNeedsUpdate: Bool {
        guard let old = initial.model.thesisRevision else { return !revisionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        return revisionText != old.newThesis || revisionReason != old.reason || nextValidation != old.nextValidationEvent
            || revisionAssessment != old.assessment || retainedEvidence.split(separator: "\n").map(String.init) != old.retainedEvidence
            || weakenedParts.split(separator: "\n").map(String.init) != old.weakenedParts
            || newHypotheses.split(separator: "\n").map(String.init) != old.addedHypotheses
            || abandonedHypotheses.split(separator: "\n").map(String.init) != old.abandonedHypotheses
            || (confirmRevision && old.status != "OWNER_CONFIRMED")
    }
    private func inputUnitTitle(_ key: String) -> String {
        let currency = model.scenarios[selectedScenario].currency
        return key == "sales_volume" ? "辆" : key == "asp" ? "\(currency) / 辆" : key == "gross_margin" ? "比例 0–1" : key == "pe" ? "倍" : "\(currency) 基准金额"
    }
    @MainActor private func save() async {
        saving = true; defer { saving = false }
        do {
            try configureThesisTests()
            for i in model.scenarios.indices {
                for key in operatingInputKeys {
                    let text = (valueTexts["\(i):\(key)"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                    guard let old = model.scenarios[i].inputs[key] else { continue }
                    if text.isEmpty { model.scenarios[i].inputs[key] = OperatingScenarioInput(unit: old.unit, value: nil, origin: "unknown", sourceValueId: nil, note: old.note) }
                    else {
                        guard let number = Double(text), number.isFinite, !old.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw NSError(domain: "\(model.scenarios[i].name) 的 \(operatingMetricTitle(key)) 需要有效数值及假设依据", code: 400) }
                        model.scenarios[i].inputs[key] = OperatingScenarioInput(unit: old.unit, value: number, origin: old.origin == "source_fact" && old.value == number ? "source_fact" : "owner_assumption", sourceValueId: old.origin == "source_fact" && old.value == number ? old.sourceValueId : nil, note: old.note)
                        if model.scenarios[i].inputs[key]?.origin == "owner_assumption" { model.scenarios[i].inputs[key]?.rationale = OperatingAssumptionRationale(reason: old.note, basedOnFactIds: old.rationale?.basedOnFactIds ?? [], confidence: old.rationale?.confidence ?? "low"); model.scenarios[i].inputs[key]?.rationale?.basedOnGuidanceIds = old.rationale?.basedOnGuidanceIds }
                    }
                }
            }
            if fxText.trimmingCharacters(in: .whitespaces).isEmpty { model.fx = nil }
            else { guard let rate = Double(fxText), rate > 0, !fxNote.isEmpty else { throw NSError(domain: "汇率需要正数、日期和依据", code: 400) }; model.fx = OperatingFX(from: fxFrom.uppercased(), to: fxTo.uppercased(), rate: rate, asOf: fxDate, note: fxNote, ownerConfirmed: true) }
            if !sensitivityLower.isEmpty || !sensitivityUpper.isEmpty {
                guard let lower = Double(sensitivityLower), let upper = Double(sensitivityUpper), lower < upper else { throw NSError(domain: "敏感性需要明确有效的上下界", code: 400) }
                model.sensitivity = OperatingSensitivityRange(variable: sensitivityVariable, lower: lower, upper: upper)
            } else { model.sensitivity = nil }
            let peValues = peSensitivityText.split(separator: ",").map { Double($0.trimmingCharacters(in: .whitespaces)) }
            guard peValues.allSatisfy({ $0 != nil && $0! > 0 }) else { throw NSError(domain: "PE 敏感性须填写正数", code: 400) }
            model.peSensitivityValues = peValues.isEmpty ? nil : peValues.compactMap { $0 }
            if let composition = model.scenarios[selectedScenario].revenueComposition {
                let text = otherRevenueText.trimmingCharacters(in: .whitespacesAndNewlines)
                if text.isEmpty { model.scenarios[selectedScenario].revenueComposition?.otherRevenue = OperatingScenarioInput(unit: "currency", value: nil, origin: "unknown", sourceValueId: nil, note: "") }
                else {
                    guard let value = Double(text), value >= 0, !composition.otherRevenue.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw NSError(domain: "其他收入需要数值和依据", code: 400) }
                    model.scenarios[selectedScenario].revenueComposition?.otherRevenue = OperatingScenarioInput(unit: "currency", value: value, origin: "owner_assumption", sourceValueId: nil, note: composition.otherRevenue.note)
                }
            }
            if revisionNeedsUpdate, !revisionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, let binding = model.thesisBinding {
                guard !revisionReason.isEmpty, !nextValidation.isEmpty else { throw NSError(domain: "修订需要原因和下一验证事件", code: 400) }
                var revision = OperatingThesisRevision(previous: binding, assessment: revisionAssessment, evidenceFactIds: [initial.fact.id], newThesis: revisionText, reason: revisionReason, nextValidationEvent: nextValidation)
                revision.retainedEvidence = retainedEvidence.split(separator: "\n").map(String.init); revision.weakenedParts = weakenedParts.split(separator: "\n").map(String.init)
                revision.addedHypotheses = newHypotheses.split(separator: "\n").map(String.init); revision.abandonedHypotheses = abandonedHypotheses.split(separator: "\n").map(String.init)
                if confirmRevision { revision.status = "OWNER_CONFIRMED"; revision.actor = initial.actorId; revision.confirmedAt = ISO8601DateFormatter().string(from: Date()) }
                model.thesisRevision = revision
            }
            let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
            let encoded = try encoder.encode(model)
            if let lastSavePayload, lastSavePayload != encoded { requestKey = "operating-model-\(UUID().uuidString)" }
            lastSavePayload = encoded
            try await api.saveOperatingModel(model, for: initial, idempotencyKey: requestKey)
            saved = true; message = "已保存并核对新版本。请返回研究首页打开最新分析。"
        } catch { message = (error as NSError).domain }
    }
}
